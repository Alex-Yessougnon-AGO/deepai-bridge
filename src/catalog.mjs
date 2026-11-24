/**
 * Model catalogue.
 *
 * Source of truth: the app's own catalogue
 * (~/.deepai-code/userdata/deepai/pi/deepai/models.json), which carries the
 * per-request price in theos. It is refreshed by the app; the embedded table is
 * only a bootstrap fallback.
 *
 * Naming: Claude Code only lists gateway models whose id contains "claude" or
 * "anthropic", and it warns "doesn't recognize the model" unless the id
 * resolves to a model it knows. Prefixing every id with a known Claude id
 * solves both at once (see docs/MODELS.md):
 *
 *   free  -> claude-3-haiku--<model-id>
 *   paid  -> claude-sonnet-4-5--<model-id>
 *
 * "claude-3-haiku" was chosen for the free tier so a mis-routed free call can
 * never look like an expensive model to Claude Code's own accounting.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const MODELS_FILE = path.join(
  os.homedir(),
  ".deepai-code/userdata/deepai/pi/deepai/models.json"
);

export const FREE_ANCHOR = "claude-3-haiku";
export const PAID_ANCHOR = "claude-sonnet-4-6";
const SEP = "--";

/** Bootstrap catalogue, used only when the app catalogue is unreadable. */
const FALLBACK = [
  ["glm-5.3-flash", "GLM 5.3 Flash", "0"],
  ["deepseek-v4.1-flash", "DeepSeek V4.1 Flash 1017", "0"],
  ["mimo-2.6-flash", "MiMo 2.6 Flash", "0"],
  ["qwen-3.8-flash", "Qwen 3.8 Flash", "0"],
  ["minimax-m3.1-flash", "MiniMax M3.1 Flash", "0"],
  ["muse-ember", "Muse Ember", "0"],
  ["solar-mini-4", "Solar Mini 4", "0"],
  ["gpt-6-luna", "GPT-6 Luna", "0"],
  ["claude-haiku-5-5", "Claude Haiku 5.5", "0"],
  ["mimo-2.6-pro", "MiMo 2.6 Pro", "0"],
  ["glyph-cluster", "Glyph Cluster", "0"],
  ["deepai-cyber", "DeepAI Cyber", "0"],
].map(([id, name, theosPerRequest]) => ({ id, name, theosPerRequest }));

/** Raw entries straight from the app catalogue (or the fallback). */
export function rawModels() {
  try {
    const parsed = JSON.parse(fs.readFileSync(MODELS_FILE, "utf8"));
    const list = parsed?.providers?.deepai?.models;
    if (Array.isArray(list) && list.length) return list;
  } catch {}
  return FALLBACK;
}

/** Normalised catalogue: id as Claude Code sees it, plus price metadata. */
export function catalogue() {
  const out = [];
  const seen = new Set();
  for (const m of rawModels()) {
    if (!m?.id || seen.has(m.id)) continue;
    seen.add(m.id);
    const theos = m.theosPerRequest ?? "0";
    const free = Number(theos) === 0;
    const anchor = free ? FREE_ANCHOR : PAID_ANCHOR;
    out.push({
      model: m.id,
      id: `${anchor}${SEP}${m.id}`,
      name: m.name || m.id,
      theos,
      free,
      premier: Boolean(m.premier),
      contextWindow: m.contextWindow || 200000,
      maxTokens: m.maxTokens || 32000,
      label: `${m.name || m.id} \u00b7 ${free ? "GRATUIT" : `${theos} th\u00e9os`}`,
    });
  }
  return out;
}

export const freeModels = () => catalogue().filter((m) => m.free);
export const defaultModel = () => freeModels()[0]?.id ?? catalogue()[0]?.id;

/** Claude Code id -> catalogue entry. Accepts the bare model id too. */
export function resolveModel(requested) {
  if (!requested) return null;
  const id = String(requested).replace(/\[1m\]$/i, "");
  const list = catalogue();
  const exact = list.find((m) => m.id === id);
  if (exact) return exact;
  const bare = id.includes(SEP) ? id.slice(id.indexOf(SEP) + SEP.length) : id;
  return list.find((m) => m.model === bare) ?? null;
}
