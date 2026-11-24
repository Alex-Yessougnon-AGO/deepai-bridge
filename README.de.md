# deepai-bridge

> Inoffiziell. Keine Verbindung zu DeepAI, keine Billigung. Läuft gegen die
lokal installierte App; kein Dienst wird weiterverkauft oder geteilt.

[English](README.md) · [Français](README.fr.md) · [Español](README.es.md) · **Deutsch**

Nutze Modelle von **DeepAI Code** aus **Claude Code**, **opencode**, **Codex**
oder jedem Anthropic/OpenAI-Client — auch die kostenlosen Modelle mit 0 Theos.

```
Claude Code ─┐
opencode ────┼─> deepai-bridge (127.0.0.1:41200) ─> lokaler Transport der App ─> DeepAI
Codex ───────┤        übersetzt Anthropic/OpenAI         (Schlüssel, Lane, Check-in)
curl ────────┘
```

## Was es tut

- stellt alle Modelle des angemeldeten Kontos bereit — die 12 kostenlosen
  (0 Theos) und die 16 kostenpflichtigen — jeweils mit `GRATIS` bzw.
  `<n> Theos`, Preis und Kontextfenster beschriftet;
- übersetzt die **Anthropic Messages**-API (`/v1/messages`) und die
  **OpenAI**-API (`/v1/chat/completions`), inklusive SSE-Streaming und Tool-Calls;
- **startet mit der `claude`-Sitzung und endet mit ihr**;
- benennt die Modelle so, dass Claude Code sie ohne die Warnung
  „doesn't recognize the model" akzeptiert, und blendet die eingebauten
  Claude-Modelle aus `/model` aus;
- zeigt das **Theos-Guthaben** und die nächste Aufladung.

## Was es nicht tut

Es täuscht die App nicht vor und umgeht keine Kontrolle. Die App bleibt der
Client: ihr `pi`-Prozess trägt das Token, ihre Lane-Header, ihren Check-in und
ihre Maschinenbindung. Der Bridge **übersetzt nur ein Protokoll**. Deshalb
übersteht er App-Updates und braucht keine Pflege.

Hingenommene Folgen:

- **DeepAI Code muss laufen** — sie hält die Zugangsdaten; der Bridge startet sie
  bei Bedarf und beendet sich, wenn sie verschwindet;
- die **Theos-Zuteilung entscheidet der Server**, pro Maschine und pro Tag.
  Nichts im Client erhöht sie. Siehe [docs/THEOS.md](docs/THEOS.md).

## Installation

Linux und macOS:

```bash
git clone https://github.com/<du>/deepai-bridge ~/deepai-bridge
cd ~/deepai-bridge
./bin/deepbridge install
```

Windows: [docs/PLATFORMS.md](docs/PLATFORMS.md#windows).
Docker und Fernzugriff: [docs/PLATFORMS.md](docs/PLATFORMS.md#docker).

Dann in einem neuen Terminal:

```bash
claude
```

Das ist alles: der Bridge startet mit der Sitzung, Claude Code listet alle
Modelle, und beim Beenden stoppt der Bridge.

Prüfen: `deepbridge doctor` · Entfernen: `deepbridge uninstall`

## Befehle

| Befehl | Wirkung |
|---|---|
| `deepbridge models` | Modelle auflisten, kostenlos und kostenpflichtig |
| `deepbridge balance` | Theos-Guthaben und nächste Aufladung |
| `deepbridge account` | angemeldetes DeepAI-Konto |
| `deepbridge status` | Bridge-Zustand |
| `deepbridge doctor` | vollständige Diagnose |
| `deepbridge api` | Koordinaten und Beispiele für andere Clients |
| `deepbridge serve` | Bridge im Vordergrund starten |

## Andere Clients

Der Bridge spricht beide Protokolle. `deepbridge api` zeigt Token und Beispiele.

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
wire_api = "responses"   # oder "chat"
```

Clients ohne Modellerkennung: `GET /v1/models`. Beide OpenAI-Protokolle
(`responses` und `chat/completions`) und Anthropic (`messages`) werden bedient.
Vollständige Anleitung: [docs/API.md](docs/API.md).

## Konto wechseln

Der Bridge hat keinen eigenen Schlüssel: er liest den der App bei jeder Anfrage
neu. Melde dich in DeepAI Code ab und wieder an; der Bridge folgt sofort.

## Kostenpflichtige Modelle

Standardmäßig erlaubt. Sperren: `BRIDGE_ALLOW_PAID=0 claude`. Bei Null-Guthaben
wechselt der Bridge selbst auf ein kostenloses Modell, außer
`BRIDGE_FALLBACK_ON_EMPTY=0`.

## Konfiguration

| Variable | Standard | Zweck |
|---|---|---|
| `BRIDGE_PORT` | `41200` | Port (Loopback) |
| `BRIDGE_DEFAULT_MODEL` | `deepseek-v4.1-flash` | Startmodell |
| `BRIDGE_ALLOW_PAID` | `1` | kostenpflichtige Modelle erlauben |
| `BRIDGE_FALLBACK_ON_EMPTY` | `1` | Wechsel auf gratis bei 0 |
| `BRIDGE_NO_AUTH` | `0` | Token deaktivieren |
| `DEEPAI_TRANSPORT_URL` / `DEEPAI_TRANSPORT_TOKEN` | — | Erkennung umgehen |

## Sicherheit

- lauscht nur auf `127.0.0.1`;
- Zufallstoken in `~/.deepai-bridge/token` (0600), als
  `authorization: Bearer` oder `x-api-key`;
- nichts verlässt die Maschine außer über den Transport der App;
- Protokolle in `~/.deepai-bridge/bridge.log`.

## Lizenz

MIT.
