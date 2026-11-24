# API

The bridge exposes one box with three doors. Anything that speaks OpenAI or
Anthropic can use it — no key, no sign-up, no account of its own.

```
http://127.0.0.1:41200
├── POST /v1/messages            Anthropic Messages (Claude Code, SDK Anthropic)
├── POST /v1/chat/completions    OpenAI chat completions
├── POST /v1/responses           OpenAI Responses (Codex, SDK OpenAI récents)
├── GET  /v1/models              model discovery, with prices
├── GET  /balance                theos balance
└── GET  /health                 bridge and transport state
```

All three message routes accept the same body shapes their official APIs
document: `system`/`instructions`, multi-turn, images as URLs, `tools`, streaming
(SSE), `max_tokens`/`max_output_tokens`. Streams are re-emitted in the shape the
calling API expects, so SDK parsers work unchanged.

Authentication is the bridge token, on every route except `/health`:

```
authorization: Bearer <token>
x-api-key: <token>          (alternative)
```

The token is in `~/.deepai-bridge/token` and printed by `deepbridge api`.

Model ids come in two forms for the same model — pick the one your client's
schema allows:

- Anthropic clients: `claude-3-haiku--deepseek-v4.1-flash`
- OpenAI clients: `deepseek-v4.1-flash`

`GET /v1/models` returns both, plus `price.theos_per_request` and
`price.free`.

## Claude Code

Covered by `deepbridge install`: it writes `ANTHROPIC_BASE_URL`,
`ANTHROPIC_AUTH_TOKEN`, the model defaults and the `availableModels` allowlist
into `~/.claude/settings.json`, so `/model` shows only DeepAI Code models.

## Codex

`~/.codex/config.toml`:

```toml
model = "deepseek-v4.1-flash"
model_provider = "deepai"

[model_providers.deepai]
name = "DeepAI Code"
base_url = "http://127.0.0.1:41200/v1"
env_key = "DEEPAI_BRIDGE_TOKEN"
wire_api = "responses"
```

```bash
export DEEPAI_BRIDGE_TOKEN="$(cat ~/.deepai-bridge/token)"
codex
```

Set `wire_api = "chat"` if your Codex build predates the Responses API.

## opencode

`opencode.json` at the project root, or `~/.config/opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "deepai": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "DeepAI Code",
      "options": {
        "baseURL": "http://127.0.0.1:41200/v1",
        "apiKey": "<token>"
      },
      "models": {
        "deepseek-v4.1-flash": { "name": "DeepSeek V4.1 Flash (gratuit)" }
      }
    }
  },
  "model": "deepai/deepseek-v4.1-flash"
}
```

## SDK OpenAI (Python)

```python
from openai import OpenAI

client = OpenAI(base_url="http://127.0.0.1:41200/v1", api_key=token)

r = client.chat.completions.create(
    model="deepseek-v4.1-flash",
    messages=[{"role": "user", "content": "explique ce traceback"}],
)
print(r.choices[0].message.content)
```

Streaming, tools and the `responses` resource behave as documented upstream — the
base URL is the only change:

```python
for ev in client.responses.create(model="deepseek-v4.1-flash", input="hi", stream=True):
    ...
```

## SDK OpenAI (Node)

```js
import OpenAI from "openai";

const client = new OpenAI({ baseURL: "http://127.0.0.1:41200/v1", apiKey: token });
const r = await client.chat.completions.create({
  model: "deepseek-v4.1-flash",
  messages: [{ role: "user", content: "hi" }],
});
console.log(r.choices[0].message.content);
```

## SDK Anthropic (Python)

```python
from anthropic import Anthropic

client = Anthropic(base_url="http://127.0.0.1:41200", api_key=token)

msg = client.messages.create(
    model="claude-3-haiku--deepseek-v4.1-flash",
    max_tokens=1024,
    messages=[{"role": "user", "content": "hi"}],
)
print(msg.content[0].text)
```

## curl

```bash
TOKEN="$(cat ~/.deepai-bridge/token)"

curl http://127.0.0.1:41200/v1/chat/completions \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"model":"deepseek-v4.1-flash","messages":[{"role":"user","content":"hi"}]}'
```

## Migrer depuis un autre fournisseur

Si un client ne propose que « Azure OpenAI », « Ollama » ou « compatible OpenAI »,
prends cette entrée : ce sont les mêmes champs. Côté Anthropic, Bedrock et Vertex
ne conviennent pas — le bridge parle l'API Messages publique.

## Antigravity CLI (`agy`)

Antigravity reaches custom models through the Gemini API, which the bridge also
serves. Use `deepbridge run`, which exports the two variables for you:

```bash
deepbridge run -- agy --model deepseek -p "explique ce fichier"
```

By hand: `GOOGLE_GEMINI_BASE_URL` is the **root** URL without `/v1beta`
(the CLI appends it), and the key goes in `GEMINI_API_KEY`.

```bash
export GOOGLE_GEMINI_BASE_URL=http://127.0.0.1:41200
export GEMINI_API_KEY="$(cat ~/.deepai-bridge/token)"
```

`~/.gemini/antigravity-cli/settings.json`:

```json
{
  "modelProvider": "gemini",
  "model": "deepseek",
  "customModelsConfig": {
    "customModels": {
      "deepseek": { "apiProvider": "openai", "label": "DeepSeek (gratuit)", "modelName": "gemini-api://deepseek-v4.1-flash" }
    }
  }
}
```

`modelName` is `gemini-api://` followed by the **bare** model id. Without
`--model deepseek`, the CLI asks for `gemini-3.1-pro-preview`; the bridge maps
any unknown id to the default model, so it still works.

## Antigravity IDE

Settings → **Models & Usage** → **Custom Models** → **Add model**, provider
*OpenAI compatible*, then:

| Champ | Valeur |
|---|---|
| URL | `http://127.0.0.1:41200/v1/chat/completions` |
| Clé | `cat ~/.deepai-bridge/token` |
| Modèle | `deepseek-v4.1-flash` |

Test the connection, save, then pick the model in the chat picker. The IDE holds
a token copy: `deepbridge install` does not rewrite it, so regenerate the token
(`rm ~/.deepai-bridge/token`) and paste it again if you ever rotate it.

## Gemini API

The Gemini dialect exists for Antigravity and anything else that speaks it:

```
GET  /v1beta/models
POST /v1beta/models/<id>:generateContent
POST /v1beta/models/<id>:streamGenerateContent?alt=sse
```

Auth by `x-goog-api-key` or `?key=`. Unknown model ids fall back to the default.

## Anything else

Anything with a **custom base URL** setting works: Continue, Cline, Roo Code,
LangChain (`ChatOpenAI(base_url=...)`), LlamaIndex, Aider
(`OPENAI_API_BASE`), n8n, a shell script.

Two environment-variable conventions cover most of them:

```bash
export OPENAI_BASE_URL=http://127.0.0.1:41200/v1
export OPENAI_API_KEY="$(cat ~/.deepai-bridge/token)"
```

## Tool calling

Both protocols carry tools. The bridge translates Anthropic `tool_use` /
`tool_result` blocks to OpenAI `tool_calls` and back, so agent loops work — that
is how Claude Code edits files through it.

Tool calling is real but the model behind it decides quality: free models with
weaker tool support mis-sequence calls. If an agent loop stalls, switch to a paid
model before blaming the bridge.

## Streaming

`stream: true` returns SSE in the calling API's event vocabulary:

- Anthropic: `message_start`, `content_block_delta`, `message_stop` …
- Responses: `response.created`, `response.output_text.delta`, `response.completed` …
- chat completions: `data: {choices:[{delta:…}]}` then `[DONE]`

Usage figures arrive on the last chunk where the API defines one.

## Limits

- **loopback only** — from another machine, tunnel it (SSH, Tailscale) or see
  [PLATFORMS.md](PLATFORMS.md#docker);
- **the app must run** — it holds the credentials. Without it the bridge answers
  `503`;
- **64 MB request bodies**, `CLAUDE_CODE_MAX_OUTPUT_TOKENS` default 32768;
- **theos are consumed per request** by the app's own metering. `GET /balance`
  reports the remainder; at zero the bridge downgrades to a free model unless
  `BRIDGE_FALLBACK_ON_EMPTY=0`;
- no embeddings, no audio, no image generation, no `batch` — text in, text out;
- **no tool-result round-trip in `responses` yet**: a `function_call` item is
  returned, but sending it back as `function_call_output` is mapped to a plain
  user message rather than a native tool result. Codex works; exotic Responses
  loops may lose a little fidelity.

## Errors

| Code | Meaning |
|---|---|
| `401` | missing or wrong bridge token |
| `404` | path outside the table above |
| `400` | invalid JSON body, or the lane refused the request |
| `503` | no transport (app closed) or no model left |

Error bodies follow the caller's format: `{"error":{"type":…,"message":…}}` for
OpenAI, `{"type":"error","error":{…}}` for Anthropic.
