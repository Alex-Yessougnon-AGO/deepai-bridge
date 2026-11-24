/**
 * Claude Code settings, managed on behalf of the user.
 *
 * `install` rewrites only what the bridge owns:
 *   - env: base URL, token, defaults, discovery
 *   - model + availableModels: so /model lists DeepAI Code models only
 *   - dead hooks (a Stop hook pointing at a missing script)
 * Everything else (theme, other hooks, permissions) is preserved, and the
 * original file is backed up once so `uninstall` can restore it.
 *
 * Filtering note: `availableModels` is the only supported way to keep the
 * built-in Claude models out of the picker. It is an allowlist matched by full
 * id; entries that are not listed disappear from /model. Combined with every
 * default pointing at one bridge model, whatever is still reachable (the
 * "Default" row, a resumed session, `--model <native>`) lands on a bridge model
 * instead of erroring.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { catalogue, defaultModel } from "./catalog.mjs";
import { bridgeToken } from "./token.mjs";

export const CLAUDE_DIR = path.join(os.homedir(), ".claude");
export const SETTINGS = path.join(CLAUDE_DIR, "settings.json");
export const BACKUP = path.join(CLAUDE_DIR, "settings.json.deepbridge-backup");

function readJson(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** A hook command is dead when it points at a path that does not exist. */
function hookAlive(hook) {
  const cmd = hook?.command;
  if (typeof cmd !== "string" || !cmd.trim()) return true;
  const file = cmd.trim().split(/\s+/)[0];
  if (!file.startsWith("/")) return true;
  return fs.existsSync(file);
}

export function pruneHooks(settings) {
  const removed = [];
  if (!settings.hooks || typeof settings.hooks !== "object") return removed;
  for (const [event, groups] of Object.entries(settings.hooks)) {
    if (!Array.isArray(groups)) continue;
    const kept = [];
    for (const group of groups) {
      const hooks = Array.isArray(group?.hooks) ? group.hooks : [];
      const alive = hooks.filter(hookAlive);
      for (const hook of hooks) if (!hookAlive(hook)) removed.push({ event, command: hook.command });
      if (!alive.length) continue;
      kept.push(alive.length === hooks.length ? group : { ...group, hooks: alive });
    }
    if (kept.length) settings.hooks[event] = kept;
    else delete settings.hooks[event];
  }
  if (!Object.keys(settings.hooks).length) delete settings.hooks;
  return removed;
}

/** Dead hooks currently in the file, without changing it. */
export function findDeadHooks() {
  return pruneHooks(structuredClone(readJson(SETTINGS)));
}

/** Build the settings object the bridge wants, given the user's current one. */
export function buildSettings(base, { port = 41200, model } = {}) {
  const ids = catalogue().map((m) => m.id);
  const pick = model || defaultModel();
  const next = structuredClone(base ?? {});

  next.env = {
    ...(next.env || {}),
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`,
    ANTHROPIC_AUTH_TOKEN: bridgeToken(),
    ANTHROPIC_API_KEY: "",
    CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: "1",
    CLAUDE_CODE_MAX_OUTPUT_TOKENS: next.env?.CLAUDE_CODE_MAX_OUTPUT_TOKENS || "32768",
    API_TIMEOUT_MS: next.env?.API_TIMEOUT_MS || "600000",
    ANTHROPIC_MODEL: pick,
    ANTHROPIC_DEFAULT_OPUS_MODEL: pick,
    ANTHROPIC_DEFAULT_SONNET_MODEL: pick,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: pick,
    ANTHROPIC_DEFAULT_FABLE_MODEL: pick,
    CLAUDE_CODE_SUBAGENT_MODEL: pick,
    ANTHROPIC_CUSTOM_MODEL_OPTION: pick,
    ANTHROPIC_CUSTOM_MODEL_OPTION_NAME: "DeepAI Code (bridge)",
    ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION: "Modeles DeepAI Code, dont les gratuits",
  };

  next.model = pick;
  next.availableModels = ids;
  pruneHooks(next);
  return next;
}

export function writeSettings({ port = 41200, model } = {}) {
  fs.mkdirSync(CLAUDE_DIR, { recursive: true });
  const current = readJson(SETTINGS);
  if (!fs.existsSync(BACKUP) && Object.keys(current).length) fs.writeFileSync(BACKUP, JSON.stringify(current, null, 2));
  const next = buildSettings(current, { port, model });
  fs.writeFileSync(SETTINGS, JSON.stringify(next, null, 2));
  return next;
}

/** Remove bridge-owned keys, keeping the user's own settings. */
export function restoreSettings() {
  const current = readJson(SETTINGS);
  delete current.availableModels;
  if (current.env) {
    for (const key of Object.keys(current.env)) {
      if (/^ANTHROPIC_(BASE_URL|AUTH_TOKEN|API_KEY|MODEL|DEFAULT_|CUSTOM_MODEL_OPTION)|^CLAUDE_CODE_(ENABLE_GATEWAY_MODEL_DISCOVERY|SUBAGENT_MODEL|MAX_OUTPUT_TOKENS)|^API_TIMEOUT_MS$/.test(key)) delete current.env[key];
    }
    if (!Object.keys(current.env).length) delete current.env;
  }
  if (fs.existsSync(BACKUP)) {
    const saved = readJson(BACKUP);
    fs.writeFileSync(SETTINGS, JSON.stringify(saved, null, 2));
    fs.unlinkSync(BACKUP);
    return;
  }
  fs.writeFileSync(SETTINGS, JSON.stringify(current, null, 2));
}

// Direct invocation: node src/settings.mjs [write|restore|dead]
if (process.argv[1] && process.argv[1].endsWith("settings.mjs")) {
  const cmd = process.argv[2] || "write";
  if (cmd === "write") writeSettings({ port: Number(process.env.BRIDGE_PORT || 41200) });
  else if (cmd === "restore") restoreSettings();
  else if (cmd === "dead") console.log(JSON.stringify(findDeadHooks()));
}
