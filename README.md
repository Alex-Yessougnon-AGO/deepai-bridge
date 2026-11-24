# deepai-bridge

**English** · [Français](README.fr.md) · [Español](README.es.md) · [Deutsch](README.de.md)

Use **DeepAI Code** models from **Claude Code**, **opencode**, **Codex** or any
Anthropic/OpenAI client — including the free 0-theo models.

```
Claude Code ─┐
opencode ────┼─> deepai-bridge (127.0.0.1:41200) ─> app's local transport ─> DeepAI
Codex ───────┤        translates Anthropic/OpenAI      (keys, lane, check-in)
curl ────────┘
```

## What it does

- exposes every model of the signed-in account — the 12 free (0 theo) ones and
  the 16 paid ones — each labelled `FREE` or `<n> theos`, price and context
  window included;
- translates the **Anthropic Messages** API (`/v1/messages`) and the **OpenAI**
  API (`/v1/chat/completions`), streaming SSE and tool calls included;
- **starts with the `claude` session and stops with it**;
- names the models so Claude Code accepts them with no
  "doesn't recognize the model" warning, and hides the built-in Claude models
  from `/model`;
- shows the **theos balance** and the next refill.

## What it does not do

It does not impersonate the app or bypass any control. The app stays the client:
its `pi` process holds the token, its lane headers, its check-in and its machine
binding. The bridge only **translates a protocol**. That is why it survives app
updates and needs no maintenance.

Assumed consequences:

- **DeepAI Code must be running** — it holds the credentials; the bridge starts
  it if needed and exits when it goes away;
- the **theos grant is decided server-side**, per machine and per day. Nothing on
  the client raises it. See [docs/THEOS.md](docs/THEOS.md).

## Install

Linux and macOS:

```bash
git clone https://github.com/<you>/deepai-bridge ~/deepai-bridge
cd ~/deepai-bridge
./bin/deepbridge install
```

Windows: see [docs/PLATFORMS.md](docs/PLATFORMS.md#windows).
Docker and remote setups: [docs/PLATFORMS.md](docs/PLATFORMS.md#docker).

Then open a new terminal and run:

```bash
claude
```

That is all: the bridge starts with the session, Claude Code lists every model,
and the bridge stops when you quit.

Check the chain: `deepbridge doctor` · Remove: `deepbridge uninstall`

## Commands

| Command | Effect |
|---|---|
| `deepbridge models` | list models, free and paid, with prices |
| `deepbridge balance` | theos balance and next refill |
| `deepbridge account` | signed-in DeepAI account |
| `deepbridge status` | bridge state |
| `deepbridge doctor` | full chain diagnostic |
| `deepbridge api` | coordinates and examples for another client |
| `deepbridge serve` | run the bridge in the foreground |

## Other clients

The bridge speaks both protocols; `deepbridge api` prints the token and
ready-to-paste examples.

**opencode** (`opencode.json`):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "deepai": {
      "npm": "@ai-sdk/openai-compatible",
      "options": { "baseURL": "http://127.0.0.1:41200/v1", "apiKey": "<token>" },
      "models": { "deepseek-v4.1-flash": {} }
    }
  }
}
```

**Codex** (`~/.codex/config.toml`):

```toml
model = "deepseek-v4.1-flash"
model_provider = "deepai"

[model_providers.deepai]
name = "DeepAI Code"
base_url = "http://127.0.0.1:41200/v1"
env_key = "DEEPAI_BRIDGE_TOKEN"
wire_api = "chat"
```

**curl**:

```bash
curl http://127.0.0.1:41200/v1/chat/completions \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"model":"deepseek-v4.1-flash","messages":[{"role":"user","content":"hi"}]}'
```

## Switching account

The bridge holds no key of its own: it re-reads the app's on every request. Sign
out in DeepAI Code and sign back in; the bridge follows immediately.

## Paid models

Allowed by default. To block them: `BRIDGE_ALLOW_PAID=0 claude`. When the balance
hits zero the bridge falls back to a free model by itself, unless
`BRIDGE_FALLBACK_ON_EMPTY=0`.

## Configuration

| Variable | Default | Role |
|---|---|---|
| `BRIDGE_PORT` | `41200` | listen port (loopback) |
| `BRIDGE_DEFAULT_MODEL` | `deepseek-v4.1-flash` | starting model |
| `BRIDGE_ALLOW_PAID` | `1` | allow paid models |
| `BRIDGE_FALLBACK_ON_EMPTY` | `1` | fall back to free at zero balance |
| `BRIDGE_NO_AUTH` | `0` | disable the token (trusted loopback) |
| `BRIDGE_STAY_ALIVE` | `0` | do not exit with the app |
| `BRIDGE_VERBOSE` | `0` | log on stderr |
| `DEEPAI_TRANSPORT_URL` / `DEEPAI_TRANSPORT_TOKEN` | — | bypass discovery |
| `DEEPAI_APP_BIN` | `~/AppImages/deepai_code.appimage` | app binary |
| `CLAUDE_REAL_BIN` | newest `~/.local/share/claude/versions/*` | real `claude` |

## Security

- listens on `127.0.0.1` only;
- random token in `~/.deepai-bridge/token` (0600), sent as
  `authorization: Bearer` or `x-api-key`;
- nothing leaves the machine except through the app's own transport;
- logs in `~/.deepai-bridge/bridge.log`.

## How it works

- [docs/DESIGN.md](docs/DESIGN.md) — how the bridge reaches the app
- [docs/MODELS.md](docs/MODELS.md) — model naming and warning suppression
- [docs/THEOS.md](docs/THEOS.md) — how theos are granted
- [docs/PLATFORMS.md](docs/PLATFORMS.md) — Linux, macOS, Windows, Docker

## Legal note

Adapted from reading the DeepAI Code bundle. DeepAI's terms (section 4) forbid
other applications from using the service without written consent and from
working around its limits. The bridge copies nothing: it borrows the running
app's own transport.

## License

MIT.
