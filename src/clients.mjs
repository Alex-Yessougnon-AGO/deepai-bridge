// Writes the bridge model catalogue into the clients that keep their own list.
//
// opencode: provider block in ~/.config/opencode/opencode.json (all models,
//           price in the label).
// codex:    the model names live in config.toml; Codex also discovers them from
//           GET /v1/models at runtime, so nothing else is needed here.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { catalogue } from "./catalog.mjs";
import { bridgeToken } from "./token.mjs";

const HOME = os.homedir();
const PORT = process.env.BRIDGE_PORT || "41200";
const BASE = `http://127.0.0.1:${PORT}`;

const label = (m) => (m.free ? m.label : `${m.label.split(" · ")[0]} · ${m.theos} théos`);

function backup(file) {
  if (!fs.existsSync(file)) return;
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const dest = `${file}.bak-deepbridge-${stamp}`;
  if (!fs.existsSync(dest)) fs.copyFileSync(file, dest);
}

function syncOpencode() {
  const file = path.join(HOME, ".config", "opencode", "opencode.json");
  if (!fs.existsSync(path.dirname(file))) return { skipped: "opencode absent" };
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  data.provider ||= {};

  const models = {};
  for (const m of catalogue()) {
    models[m.model] ||= { name: label(m) };
  }

  data.provider.deepai = {
    npm: "@ai-sdk/openai-compatible",
    name: "DeepAI Code (bridge)",
    options: { baseURL: `${BASE}/v1`, apiKey: bridgeToken() },
    models,
  };
  if (!data.model || String(data.model).startsWith("deepai/")) {
    data.model = `deepai/${process.env.BRIDGE_DEFAULT_MODEL || "deepseek-v4.1-flash"}`;
  }
  backup(file);
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  return { file, models: Object.keys(models).length };
}

function syncCodex() {
  // Codex asks the provider for /v1/models, so the only thing to guarantee is
  // that the provider block and the token variable are right.
  const file = path.join(HOME, ".codex", "config.toml");
  if (!fs.existsSync(file)) return { skipped: "codex absent" };
  const text = fs.readFileSync(file, "utf8");
  if (!text.includes("[model_providers.deepai]")) {
    backup(file);
    fs.writeFileSync(
      file,
      text +
        `\n[model_providers.deepai]\nname = "DeepAI Code (bridge)"\nbase_url = "${BASE}/v1"\nenv_key = "DEEPAI_BRIDGE_TOKEN"\nwire_api = "responses"\n`
    );
    return { file, added: true };
  }
  return { file, added: false };
}

function syncAgy() {
  const file = path.join(HOME, ".gemini", "antigravity-cli", "settings.json");
  if (!fs.existsSync(path.dirname(file))) return { skipped: "agy absent" };
  const data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};

  const custom = {};
  for (const m of catalogue()) {
    custom[m.id] = {
      apiProvider: "openai",
      label: label(m),
      modelName: `gemini-api://${m.model}`,
    };
  }
  data.modelProvider = "gemini";
  data.customModelsConfig = { customModels: custom };
  if (!data.model || !custom[data.model]) data.model = "deepseek";
  backup(file);
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  return { file, models: Object.keys(custom).length };
}

const which = process.argv[2];
const out =
  which === "opencode"
    ? syncOpencode()
    : which === "codex"
      ? syncCodex()
      : which === "agy"
        ? syncAgy()
        : {};
process.stdout.write(JSON.stringify(out) + "\n");
