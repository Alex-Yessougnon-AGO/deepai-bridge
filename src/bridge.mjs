#!/usr/bin/env node
/**
 * DeepAI Code <-> Anthropic / OpenAI bridge.
 *
 * Why: DeepAI Code talks to its service with a local OpenAI-compatible transport
 * owned by the app. Claude Code (and opencode, Codex, anything else) speaks
 * Anthropic Messages or OpenAI chat completions. This server translates, and
 * keeps every request going through the app's own transport, so the app stays
 * the client: same lane headers, same check-in, same machine binding, same
 * metering.
 *
 * Design notes that matter:
 *  - The transport capability token is per launch and lives in the `pi` child's
 *    environment. It is re-read on every request, so an app restart is
 *    transparent and a stale token never sticks.
 *  - Claude Code emits exactly one message_start per stream. Reasoning deltas are
 *    therefore buffered out and text is flushed before the first tool call, so
 *    block indices stay monotonic.
 *  - The lane rejects a request with no system message: one is always injected.
 */
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

import { findTransport, sleep } from "./transport.mjs";
import { catalogue, defaultModel, freeModels, resolveModel } from "./catalog.mjs";
import { allowance, account } from "./account.mjs";

const PORT = Number(process.env.BRIDGE_PORT || 41200);
const HOST = "127.0.0.1";
const STATE = path.join(os.homedir(), ".deepai-bridge");
const LOG = path.join(STATE, "bridge.log");
const PID_FILE = path.join(STATE, "bridge.pid");
const TOKEN_FILE = path.join(STATE, "token");
const ALLOW_PAID = process.env.BRIDGE_ALLOW_PAID !== "0";
const FALLBACK_ON_EMPTY = process.env.BRIDGE_FALLBACK_ON_EMPTY !== "0";
const MAX_OUTPUT = 131072;

// --------------------------------------------------------------------- utils
function log(...parts) {
  const line = `[${new Date().toISOString()}] ${parts.join(" ")}`;
  try {
    fs.mkdirSync(STATE, { recursive: true });
    fs.appendFileSync(LOG, line + "\n");
  } catch {}
  if (process.env.BRIDGE_VERBOSE) console.error(line);
}

function token() {
  try {
    return fs.readFileSync(TOKEN_FILE, "utf8").trim();
  } catch {
    const t = `dbr_${crypto.randomBytes(24).toString("hex")}`;
    try {
      fs.mkdirSync(STATE, { recursive: true });
      fs.writeFileSync(TOKEN_FILE, t, { mode: 0o600 });
    } catch {}
    return t;
  }
}

const TOKEN = process.env.BRIDGE_TOKEN || token();

function authorised(req) {
  if (process.env.BRIDGE_NO_AUTH === "1") return true;
  const auth = req.headers.authorization || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const key = req.headers["x-api-key"] || req.headers["x-goog-api-key"] || "";
  const given = String(bearer || key);
  if (given.length !== TOKEN.length) return false;
  return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(TOKEN));
}

const err = (message, type = "api_error") => ({ type: "error", error: { type, message } });

function send(res, code, obj) {
  if (res.writableEnded) return;
  const body = Buffer.from(JSON.stringify(obj));
  res.writeHead(code, { "content-type": "application/json", "content-length": body.length });
  res.end(body);
}

// -------------------------------------------------------------- translation
function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((p) => p && p.type === "text" && typeof p.text === "string")
    .map((p) => p.text)
    .join("\n");
}

function toParts(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts = [];
  for (const p of content) {
    if (p?.type === "text") parts.push({ type: "text", text: p.text });
    else if (p?.type === "image" && p.source) {
      const url =
        p.source.type === "base64" ? `data:${p.source.media_type};base64,${p.source.data}` : p.source.url;
      if (url) parts.push({ type: "image_url", image_url: { url } });
    }
  }
  if (parts.every((p) => p.type === "text")) return parts.map((p) => p.text).join("\n");
  return parts;
}

/** Anthropic Messages request -> OpenAI chat/completions request. */
function translate(body, model) {
  const messages = [];
  const system = Array.isArray(body.system)
    ? body.system.map((s) => s?.text ?? "").join("\n")
    : body.system;
  messages.push({
    role: "system",
    content: String(system ?? "").trim() || "You are a helpful coding assistant.",
  });

  for (const m of body.messages || []) {
    if (m.role === "assistant") {
      const calls = (Array.isArray(m.content) ? m.content : [])
        .filter((b) => b?.type === "tool_use")
        .map((b) => ({
          id: b.id,
          type: "function",
          function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
        }));
      messages.push({
        role: "assistant",
        content: textOf(m.content),
        ...(calls.length ? { tool_calls: calls } : {}),
      });
      continue;
    }
    const results = Array.isArray(m.content) ? m.content.filter((b) => b?.type === "tool_result") : [];
    if (results.length) {
      for (const r of results) {
        messages.push({
          role: "tool",
          tool_call_id: r.tool_use_id,
          content: textOf(r.content) || JSON.stringify(r.content ?? ""),
        });
      }
      const rest = m.content.filter((b) => b?.type === "text").map((b) => b.text).join("\n");
      if (rest.trim()) messages.push({ role: "user", content: rest });
      continue;
    }
    messages.push({ role: "user", content: toParts(m.content) });
  }

  const budget = body.thinking?.budget_tokens;
  const out = {
    model,
    messages,
    stream: true,
    max_tokens: Math.max(256, Math.min(Number(body.max_tokens) || 32000, MAX_OUTPUT)),
    reasoning_effort:
      body.thinking?.type === "enabled" ? (budget > 12000 ? "high" : budget > 4000 ? "medium" : "low") : "none",
    stream_options: { include_usage: true },
  };

  const tools = (body.tools || []).filter((t) => t?.name);
  if (tools.length) {
    out.tools = tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description || "",
        parameters: t.input_schema || { type: "object", properties: {} },
      },
    }));
    out.tool_choice = body.tool_choice?.type === "auto" ? "auto" : "auto";
  }
  if (typeof body.temperature === "number") out.temperature = body.temperature;
  out.prompt_cache_key = body.metadata?.user_id
    ? String(body.metadata.user_id).slice(0, 256)
    : crypto.randomUUID();
  return out;
}

const stopReason = (r) => (r === "tool_calls" ? "tool_use" : r === "length" ? "max_tokens" : "end_turn");

/** Resolve the requested model, honouring the paid guard. */
async function choose(requested) {
  const wanted = resolveModel(requested);
  const fallback = resolveModel(process.env.BRIDGE_DEFAULT_MODEL) || resolveModel(defaultModel());

  if (!wanted) {
    log("model-miss", String(requested).slice(0, 80), "->", fallback?.model);
    return { entry: fallback, note: `unknown model, using ${fallback?.model}` };
  }
  if (wanted.free || ALLOW_PAID) return { entry: wanted };
  if (!FALLBACK_ON_EMPTY) return { entry: wanted };

  const bal = await allowance();
  if (bal && bal.balance > 0) return { entry: wanted };
  log("paid-but-empty", wanted.model, "->", fallback?.model);
  return { entry: fallback, note: `no theos left, using ${fallback?.model}` };
}

// ------------------------------------------------------------------ upstream
async function upstream(payload) {
  const t = findTransport();
  if (!t) return { error: { code: 503, message: "DeepAI Code is not running." } };
  try {
    const res = await fetch(`${t.url}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${t.token}`,
        ...(t.thread ? { "x-session-affinity": t.thread } : {}),
      },
      body: JSON.stringify(payload),
    });
    return { res };
  } catch (e) {
    return { error: { code: 502, message: `transport unreachable: ${e.message}` } };
  }
}

// --------------------------------------------------------------- Anthropic
async function messages(req, res, body) {
  const { entry, note } = await choose(body.model);
  if (!entry) return send(res, 503, err("No model available in the DeepAI catalogue.", "overloaded_error"));
  const payload = translate(body, entry.model);

  const { res: up, error } = await upstream(payload);
  if (error) return send(res, error.code, err(error.message, "overloaded_error"));
  if (!up.ok) {
    const text = await up.text().catch(() => "");
    log("upstream", up.status, entry.model, text.slice(0, 240));
    let message = text.slice(0, 400);
    try {
      message = JSON.parse(text)?.error?.message || message;
    } catch {}
    return send(res, up.status, err(message, up.status === 404 ? "not_found_error" : "api_error"));
  }

  log("anthropic", entry.model, `${payload.messages.length}msg`, `${payload.tools?.length || 0}tool`);

  const mid = `msg_${crypto.randomBytes(12).toString("hex")}`;
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });

  const write = (event, data) => {
    if (res.writableEnded) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  write("message_start", {
    type: "message_start",
    message: {
      id: mid,
      type: "message",
      role: "assistant",
      model: entry.id,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
      ...(note ? { _bridge_note: note } : {}),
    },
  });
  write("ping", { type: "ping" });

  let textIndex = -1;
  let next = 0;
  let buffered = "";
  const toolBlocks = new Map();
  let usage = { input_tokens: 0, output_tokens: 0 };
  let finish = null;

  const flushText = () => {
    if (textIndex < 0) {
      textIndex = next++;
      write("content_block_start", {
        type: "content_block_start",
        index: textIndex,
        content_block: { type: "text", text: "" },
      });
    }
    if (!buffered) return;
    write("content_block_delta", {
      type: "content_block_delta",
      index: textIndex,
      delta: { type: "text_delta", text: buffered },
    });
    buffered = "";
  };

  const reader = up.body.getReader();
  const decoder = new TextDecoder();
  let carry = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      carry += decoder.decode(value, { stream: true });
      const lines = carry.split("\n");
      carry = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const raw = line.slice(5).trim();
        if (!raw || raw === "[DONE]") continue;
        let chunk;
        try {
          chunk = JSON.parse(raw);
        } catch {
          continue;
        }
        if (chunk.usage) {
          usage = {
            input_tokens: chunk.usage.prompt_tokens ?? usage.input_tokens,
            output_tokens: chunk.usage.completion_tokens ?? usage.output_tokens,
          };
        }
        const choice = chunk.choices?.[0];
        if (!choice) continue;
        const delta = choice.delta || {};
        if (typeof delta.reasoning === "string" && delta.reasoning) continue; // reasoning is dropped on purpose
        if (typeof delta.content === "string" && delta.content) {
          if (textIndex < 0) {
            textIndex = next++;
            write("content_block_start", {
              type: "content_block_start",
              index: textIndex,
              content_block: { type: "text", text: "" },
            });
          }
          buffered += delta.content;
        }
        for (const call of delta.tool_calls || []) {
          const slot = call.index ?? 0;
          let block = toolBlocks.get(slot);
          if (block) {
            if (call.function?.arguments)
              write("content_block_delta", {
                type: "content_block_delta",
                index: block.index,
                delta: { type: "input_json_delta", partial_json: call.function.arguments },
              });
            continue;
          }
          if (textIndex >= 0) {
            flushText();
            write("content_block_stop", { type: "content_block_stop", index: textIndex });
            textIndex = -1;
          }
          block = {
            index: next++,
            id: call.id || `toolu_${crypto.randomBytes(8).toString("hex")}`,
            name: call.function?.name || "",
          };
          toolBlocks.set(slot, block);
          write("content_block_start", {
            type: "content_block_start",
            index: block.index,
            content_block: { type: "tool_use", id: block.id, name: block.name, input: {} },
          });
          if (call.function?.arguments)
            write("content_block_delta", {
              type: "content_block_delta",
              index: block.index,
              delta: { type: "input_json_delta", partial_json: call.function.arguments },
            });
        }
        if (choice.finish_reason) finish = choice.finish_reason;
      }
    }
  } catch (e) {
    log("stream-error", e.message);
  }

  if (buffered || textIndex >= 0) {
    flushText();
    if (textIndex >= 0) write("content_block_stop", { type: "content_block_stop", index: textIndex });
  }
  for (const block of toolBlocks.values())
    write("content_block_stop", { type: "content_block_stop", index: block.index });

  write("message_delta", {
    type: "message_delta",
    delta: { stop_reason: stopReason(finish), stop_sequence: null },
    usage,
  });
  write("message_stop", { type: "message_stop" });
  if (!res.writableEnded) res.end();
}

// ------------------------------------------------------------------- OpenAI
async function chatCompletions(req, res, body) {
  const { entry } = await choose(body.model);
  if (!entry) return send(res, 503, err("No model available.", "overloaded_error"));

  const payload = { ...body, model: entry.model };
  if (Array.isArray(payload.messages) && !payload.messages.some((m) => m.role === "system")) {
    payload.messages = [{ role: "system", content: "You are a helpful coding assistant." }, ...payload.messages];
  }
  payload.stream = Boolean(body.stream);
  if (payload.stream) payload.stream_options = { include_usage: true };

  log("openai", entry.model, `${payload.messages?.length || 0}msg`, payload.stream ? "stream" : "once");

  const { res: up, error } = await upstream(payload);
  if (error) return send(res, error.code, err(error.message));
  if (!up.ok) {
    const text = await up.text().catch(() => "");
    return send(res, up.status, JSON.parse(text || "{}") ?? err(text));
  }

  if (!payload.stream) {
    const data = await up.json();
    if (data.model) data.model = entry.id;
    return send(res, 200, data);
  }

  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  const reader = up.body.getReader();
  const decoder = new TextDecoder();
  let carry = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      carry += decoder.decode(value, { stream: true });
      const lines = carry.split("\n");
      carry = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data:")) {
          if (line.trim()) res.write(line + "\n");
          continue;
        }
        const raw = line.slice(5).trim();
        if (raw && raw !== "[DONE]") {
          try {
            const chunk = JSON.parse(raw);
            if (chunk.model) chunk.model = entry.id;
            res.write(`data: ${JSON.stringify(chunk)}\n\n`);
            continue;
          } catch {}
        }
        res.write(line + "\n\n");
      }
    }
  } catch (e) {
    log("openai-stream-error", e.message);
  }
  if (!res.writableEnded) res.end();
}

// ------------------------------------------------------------------ responses
// Codex and the OpenAI SDKs' `responses` API. Translated onto the chat
// completion lane, then re-shaped into Responses events.
function responsesInput(body) {
  const out = [];
  const push = (role, content) => {
    const text = typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content.map((p) => (typeof p === "string" ? p : p?.text ?? p?.content ?? "")).join("")
        : "";
    if (text) out.push({ role, content: text });
  };
  if (typeof body.input === "string") push("user", body.input);
  else if (Array.isArray(body.input)) {
    for (const item of body.input) {
      if (!item) continue;
      if (item.type === "message" || item.role) push(item.role === "developer" ? "system" : item.role, item.content);
      else if (item.type === "function_call_output") push("tool", item.output);
      else if (item.content) push("user", item.content);
    }
  }
  if (typeof body.instructions === "string" && body.instructions) out.unshift({ role: "system", content: body.instructions });
  return out;
}

function responsesShape(id, model, text, usage, status = "completed") {
  return {
    id,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    status,
    model,
    output: text
      ? [{ type: "message", id: `${id}_msg`, status: "completed", role: "assistant", content: [{ type: "output_text", text, annotations: [] }] }]
      : [],
    output_text: text || "",
    usage: usage
      ? { input_tokens: usage.prompt_tokens ?? 0, output_tokens: usage.completion_tokens ?? 0, total_tokens: usage.total_tokens ?? 0 }
      : undefined,
  };
}

async function responsesApi(req, res, body) {
  const { entry } = await choose(body.model);
  if (!entry) return send(res, 503, err("No model available.", "overloaded_error"));

  const messages = responsesInput(body);
  if (!messages.some((m) => m.role === "system"))
    messages.unshift({ role: "system", content: "You are a helpful coding assistant." });

  const payload = {
    model: entry.model,
    messages,
    stream: Boolean(body.stream),
  };
  // Responses puts name/parameters at the top level; the chat lane wants them
  // nested under `function`.
  const tools = body.tools || body.functions;
  if (Array.isArray(tools)) {
    payload.tools = tools
      .filter((t) => t && (t.function || t.name))
      .map((t) =>
        t.function
          ? t
          : { type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }
      );
    if (body.tool_choice) payload.tool_choice = body.tool_choice;
    if (body.parallel_tool_calls !== undefined) payload.parallel_tool_calls = body.parallel_tool_calls;
  }
  if (body.max_output_tokens) payload.max_tokens = Math.min(body.max_output_tokens, MAX_OUTPUT);
  const id = `resp_${Math.random().toString(36).slice(2, 12)}`;

  log("responses", entry.model, `${messages.length}msg`, payload.stream ? "stream" : "once");

  const { res: up, error } = await upstream(payload);
  if (error) return send(res, error.code, err(error.message));
  if (!up.ok) {
    const text = await up.text().catch(() => "");
    return send(res, up.status, JSON.parse(text || "{}") ?? err(text));
  }

  if (!payload.stream) {
    const data = await up.json();
    const text = data.choices?.[0]?.message?.content ?? "";
    const shape = responsesShape(id, entry.id, text, data.usage);
    for (const call of data.choices?.[0]?.message?.tool_calls || []) {
      shape.output.push({
        type: "function_call",
        id: `${id}_call${call.index ?? shape.output.length}`,
        call_id: call.id,
        name: call.function?.name,
        arguments: call.function?.arguments ?? "{}",
        status: "completed",
      });
    }
    return send(res, 200, shape);
  }

  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  const emit = (type, data) => {
    if (!res.writableEnded) res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  };
  emit("response.created", { response: responsesShape(id, entry.id, "", null, "in_progress") });
  // Items are announced lazily so the reasoning item, when there is one, keeps
  // index 0 and the message follows it.
  let reasoningIndex = null;
  let textIndex = null;
  const openItem = (kind) => {
    if (kind === "reasoning") {
      if (reasoningIndex !== null) return reasoningIndex;
      reasoningIndex = reasoningIndex === null ? 0 : reasoningIndex;
      emit("response.output_item.added", {
        output_index: reasoningIndex,
        item: { type: "reasoning", id: `${id}_rs`, summary: [] },
      });
      return reasoningIndex;
    }
    if (textIndex !== null) return textIndex;
    textIndex = reasoningIndex === null ? 0 : 1;
    emit("response.output_item.added", {
      output_index: textIndex,
      item: { type: "message", id: `${id}_msg`, status: "in_progress", role: "assistant", content: [] },
    });
    return textIndex;
  };

  const reader = up.body.getReader();
  const decoder = new TextDecoder();
  let carry = "";
  let text = "";
  let usage = null;
  let index = 0;
  let finish = null;
  const calls = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      carry += decoder.decode(value, { stream: true });
      const lines = carry.split("\n");
      carry = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const raw = line.slice(5).trim();
        if (!raw || raw === "[DONE]") continue;
        let chunk;
        try {
          chunk = JSON.parse(raw);
        } catch {
          continue;
        }
        if (chunk.usage) usage = chunk.usage;
        const fin = chunk.choices?.[0]?.finish_reason;
        if (fin) finish = fin;
        const thinking = chunk.choices?.[0]?.delta?.reasoning;
        if (thinking) {
          emit("response.reasoning_summary_text.delta", {
            item_id: `${id}_rs`,
            output_index: openItem("reasoning"),
            summary_index: 0,
            delta: thinking,
          });
        }
        for (const call of chunk.choices?.[0]?.delta?.tool_calls || []) {
          const slot = (calls[call.index ?? 0] ||= { id: call.id, name: "", args: "" });
          if (call.id) slot.id = call.id;
          if (call.function?.name) slot.name = call.function.name;
          if (call.function?.arguments) slot.args += call.function.arguments;
        }
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) {
          text += delta;
          emit("response.output_text.delta", {
            item_id: `${id}_msg`,
            output_index: openItem("text"),
            content_index: 0,
            delta,
          });
          index++;
        }
      }
    }
  } catch (e) {
    log("responses-stream-error", e.message);
  }
  if (text) {
    const ti = textIndex ?? 0;
    emit("response.output_text.done", { item_id: `${id}_msg`, output_index: ti, content_index: 0, text });
    emit("response.output_item.done", {
      output_index: ti,
      item: {
        type: "message",
        id: `${id}_msg`,
        status: "completed",
        role: "assistant",
        content: [{ type: "output_text", text, annotations: [] }],
      },
    });
  }
  if (reasoningIndex !== null) {
    emit("response.output_item.done", {
      output_index: reasoningIndex,
      item: { type: "reasoning", id: `${id}_rs`, summary: [{ type: "summary_text", text: "" }] },
    });
  }

  const truncated = finish === "length";
  const shape = responsesShape(id, entry.id, text, usage, truncated ? "incomplete" : "completed");
  if (truncated) shape.incomplete_details = { reason: "max_output_tokens" };
  calls.forEach((call, i) => {
    const callId = `${id}_call${i}`;
    const item = { type: "function_call", id: callId, call_id: call.id || callId, name: call.name, arguments: "" };
    emit("response.output_item.added", { output_index: shape.output.length + i, item });
    emit("response.function_call_arguments.delta", { item_id: callId, output_index: shape.output.length + i, delta: call.args });
    emit("response.function_call_arguments.done", { item_id: callId, output_index: shape.output.length + i, arguments: call.args });
    shape.output.push({ ...item, arguments: call.args, status: "completed" });
  });

  emit("response.completed", { response: shape });
  if (!res.writableEnded) res.end();
  void index;
}

// --------------------------------------------------------------------- gemini
// Antigravity (IDE and `agy`) reaches custom models through the Gemini API
// shape. Translated onto the chat lane like the other two dialects.
function geminiRequest(body) {
  const text = (parts) => (parts || []).map((p) => p?.text ?? "").join("");
  const messages = [];
  const sys = body.systemInstruction || body.system_instruction;
  if (sys) messages.push({ role: "system", content: text(sys.parts) });
  for (const c of body.contents || []) {
    const role = c.role === "model" ? "assistant" : c.role === "system" ? "system" : "user";
    const content = text(c.parts);
    if (content) messages.push({ role, content });
  }
  if (!messages.some((m) => m.role === "system"))
    messages.unshift({ role: "system", content: "You are a helpful coding assistant." });

  const payload = { model: null, messages, stream: false };
  const gen = body.generationConfig || body.generation_config || {};
  if (gen.maxOutputTokens || gen.max_output_tokens)
    payload.max_tokens = Math.min(gen.maxOutputTokens || gen.max_output_tokens, MAX_OUTPUT);
  if (gen.temperature !== undefined) payload.temperature = gen.temperature;

  const decls = (body.tools || []).flatMap((t) => t.functionDeclarations || t.function_declarations || []);
  if (decls.length)
    payload.tools = decls.map((d) => ({
      type: "function",
      function: { name: d.name, description: d.description, parameters: d.parameters },
    }));
  return payload;
}

function geminiShape(model, text, finish, usage) {
  return {
    candidates: [
      {
        content: { role: "model", parts: text ? [{ text }] : [] },
        finishReason: finish === "length" ? "MAX_TOKENS" : "STOP",
        index: 0,
      },
    ],
    usageMetadata: {
      promptTokenCount: usage?.prompt_tokens ?? 0,
      candidatesTokenCount: usage?.completion_tokens ?? 0,
      totalTokenCount: usage?.total_tokens ?? 0,
    },
    modelVersion: model,
  };
}

async function geminiGenerate(req, res, body, modelId, stream) {
  const { entry } = await choose(modelId);
  if (!entry) return send(res, 503, err("No model available.", "overloaded_error"));

  const payload = geminiRequest(body);
  payload.model = entry.model;
  payload.stream = stream;
  log("gemini", entry.model, `${payload.messages.length}msg`, stream ? "stream" : "once");

  const { res: up, error } = await upstream(payload);
  if (error) return send(res, error.code, err(error.message));
  if (!up.ok) {
    const text = await up.text().catch(() => "");
    return send(res, up.status, JSON.parse(text || "{}") ?? err(text));
  }

  if (!stream) {
    const data = await up.json();
    const msg = data.choices?.[0]?.message || {};
    return send(res, 200, geminiShape(entry.id, msg.content || "", data.choices?.[0]?.finish_reason, data.usage));
  }

  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  const reader = up.body.getReader();
  const decoder = new TextDecoder();
  let carry = "";
  let finish = null;
  let text = "";
  let usage = null;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      carry += decoder.decode(value, { stream: true });
      const lines = carry.split("\n");
      carry = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const raw = line.slice(5).trim();
        if (!raw || raw === "[DONE]") continue;
        let chunk;
        try {
          chunk = JSON.parse(raw);
        } catch {
          continue;
        }
        if (chunk.usage) usage = chunk.usage;
        const fin = chunk.choices?.[0]?.finish_reason;
        if (fin) finish = fin;
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) {
          text += delta;
          if (!res.writableEnded)
            res.write(`data: ${JSON.stringify(geminiShape(entry.id, delta, null, null))}\n\n`);
        }
      }
    }
  } catch (e) {
    log("gemini-stream-error", e.message);
  }
  if (!res.writableEnded) {
    res.write(`data: ${JSON.stringify(geminiShape(entry.id, "", finish, usage))}\n\n`);
    res.end();
  }
  void text;
}

// ------------------------------------------------------------------ routing
function modelList(origin) {
  const free = new Set(freeModels().map((m) => m.id));
  void free;
  return {
    object: "list",
    data: catalogue().map((m) => ({
      id: m.id,
      object: "model",
      type: "model",
      display_name: m.label,
      description: `${m.model} \u2014 ${m.free ? "gratuit (0 th\u00e9o)" : `${m.theos} th\u00e9os`} \u2014 ${m.contextWindow} ctx`,
      owned_by: "deepai",
      // Anthropic-shaped extras so both clients can reason about the model
      context_window: m.contextWindow,
      max_output_tokens: Math.min(m.maxTokens, MAX_OUTPUT),
      capabilities: { tool_calling: true, reasoning: true, thinking: true },
      price: { theos_per_request: Number(m.theos), free: m.free },
      origin,
    })),
    has_more: false,
  };
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);
  const p = url.pathname.replace(/\/+$/, "") || "/";

  if (p === "/" || p === "/health") {
    const t = findTransport();
    return send(res, 200, {
      ok: Boolean(t),
      transport: t?.url || null,
      pid: t?.pid || null,
      account: account()?.username ?? null,
      models: catalogue().length,
      free: freeModels().length,
      allowPaid: ALLOW_PAID,
    });
  }

  if (!authorised(req) && !url.searchParams.get("key") && p !== "/" && p !== "/health") {
    return send(res, 401, err("Missing or invalid bridge token.", "authentication_error"));
  }

  if (p === "/v1/models" || p === "/models") return send(res, 200, modelList(url.origin));

  const gm = p.match(/^\/(?:v1beta|v1)\/(models(?:\/[^/:]+)?)(?::(generateContent|streamGenerateContent))?$/);
  if (gm) {
    const name = gm[1] === "models" ? null : gm[1].slice(7);
    if (!gm[2]) {
      const data = catalogue().map((m) => ({
        name: `models/${m.id}`,
        displayName: m.label,
        description: m.model,
        inputTokenLimit: m.contextWindow,
        outputTokenLimit: Math.min(m.maxTokens, MAX_OUTPUT),
        supportedGenerationMethods: ["generateContent", "streamGenerateContent"],
      }));
      return send(res, 200, { models: name ? data.filter((x) => x.name === `models/${name}`) : data });
    }
  }

  if (p === "/balance" || p === "/v1/balance") {
    return allowance({ refresh: url.searchParams.get("refresh") === "1" }).then(
      (a) => send(res, a ? 200 : 503, a ?? err("Allowance unavailable.", "overloaded_error")),
      (e) => send(res, 500, err(e.message))
    );
  }

  const isGemini = Boolean(gm && gm[2]);
  const isMessages = p === "/v1/messages" || p === "/messages";
  const isChat = p === "/v1/chat/completions" || p === "/chat/completions";
  const isResponses = p === "/v1/responses" || p === "/responses";
  if (!isMessages && !isChat && !isResponses && !isGemini)
    return send(res, 404, err(`Unsupported path ${p}`, "not_found_error"));

  const chunks = [];
  let size = 0;
  req.on("data", (c) => {
    size += c.length;
    if (size > 64 * 1024 * 1024) {
      req.destroy();
      return;
    }
    chunks.push(c);
  });
  req.on("end", () => {
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      return send(res, 400, err("Invalid JSON body.", "invalid_request_error"));
    }
    const run = isGemini
      ? (rq, rs, b) => geminiGenerate(rq, rs, b, gm[1].slice(7), gm[2] === "streamGenerateContent")
      : isMessages
        ? messages
        : isResponses
          ? responsesApi
          : chatCompletions;
    run(req, res, body).catch((e) => {
      log("handler", e.message);
      if (!res.headersSent) send(res, 500, err(e.message));
      else if (!res.writableEnded) res.end();
    });
  });
});

// -------------------------------------------------------------------- boot
server.listen(PORT, HOST, async () => {
  fs.mkdirSync(STATE, { recursive: true });
  fs.writeFileSync(PID_FILE, String(process.pid));
  log(`listening ${HOST}:${PORT} models=${catalogue().length} free=${freeModels().length} allowPaid=${ALLOW_PAID}`);
  if (process.env.BRIDGE_VERBOSE) {
    console.error(`bridge on http://${HOST}:${PORT}`);
    console.error(`token: ${TOKEN}`);
  }
  // Follow the app: exit when its transport disappears.
  if (process.env.BRIDGE_STAY_ALIVE !== "1") {
    setInterval(() => {
      if (!findTransport()) {
        log("transport gone; exiting");
        server.close(() => process.exit(0));
        setTimeout(() => process.exit(0), 1500).unref();
      }
    }, 4000).unref();
  }
});

for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => process.exit(0));
process.on("unhandledRejection", (e) => log("unhandled", String(e)));

void sleep;
