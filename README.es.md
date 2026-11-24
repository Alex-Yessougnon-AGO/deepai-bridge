# deepai-bridge

[English](README.md) · [Français](README.fr.md) · **Español** · [Deutsch](README.de.md)

Usa los modelos de **DeepAI Code** desde **Claude Code**, **opencode**, **Codex**
o cualquier cliente Anthropic/OpenAI — incluidos los modelos gratuitos de 0 teos.

```
Claude Code ─┐
opencode ────┼─> deepai-bridge (127.0.0.1:41200) ─> transporte local de la app ─> DeepAI
Codex ───────┤        traduce Anthropic/OpenAI              (claves, lane, check-in)
curl ────────┘
```

## Qué hace

- expone todos los modelos de la cuenta conectada — los 12 gratuitos (0 teos) y
  los 16 de pago — cada uno etiquetado `GRATIS` o `<n> teos`, con precio y
  ventana de contexto;
- traduce la API **Anthropic Messages** (`/v1/messages`) y la API **OpenAI**
  (`/v1/chat/completions`), con SSE y tool calls;
- **arranca con la sesión de `claude` y se detiene con ella**;
- nombra los modelos para que Claude Code los acepte sin el aviso
  « doesn't recognize the model », y oculta los modelos Claude nativos de `/model`;
- muestra el **saldo de teos** y la próxima recarga.

## Qué no hace

No suplanta la aplicación ni evita ningún control. La app sigue siendo el cliente:
su proceso `pi` lleva el token, sus cabeceras de lane, su check-in y su vínculo de
máquina. El bridge solo **traduce un protocolo**. Por eso sobrevive a las
actualizaciones y no requiere mantenimiento.

Consecuencias asumidas:

- **DeepAI Code debe estar en ejecución** — guarda las credenciales; el bridge la
  inicia si hace falta y termina cuando desaparece;
- la **concesión de teos la decide el servidor**, por máquina y por día. Nada en
  el cliente la aumenta. Ver [docs/THEOS.md](docs/THEOS.md).

## Instalación

Linux y macOS:

```bash
git clone https://github.com/<tu-usuario>/deepai-bridge ~/deepai-bridge
cd ~/deepai-bridge
./bin/deepbridge install
```

Windows: [docs/PLATFORMS.md](docs/PLATFORMS.md#windows).
Docker y acceso remoto: [docs/PLATFORMS.md](docs/PLATFORMS.md#docker).

Después, en una terminal nueva:

```bash
claude
```

Eso es todo: el bridge arranca con la sesión, Claude Code lista todos los modelos
y el bridge se detiene al salir.

Diagnóstico: `deepbridge doctor` · Desinstalar: `deepbridge uninstall`

## Comandos

| Comando | Efecto |
|---|---|
| `deepbridge models` | lista modelos, gratuitos y de pago, con precio |
| `deepbridge balance` | saldo de teos y próxima recarga |
| `deepbridge account` | cuenta DeepAI conectada |
| `deepbridge status` | estado del bridge |
| `deepbridge doctor` | diagnóstico completo |
| `deepbridge api` | coordenadas y ejemplos para otro cliente |
| `deepbridge serve` | ejecuta el bridge en primer plano |

## Otros clientes

El bridge habla ambos protocolos. `deepbridge api` imprime el token y ejemplos
listos para copiar.

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
wire_api = "responses"   # o "chat"
```

Clientes sin descubrimiento de modelos: `GET /v1/models`. Se sirven ambos
protocolos OpenAI (`responses` y `chat/completions`) y Anthropic (`messages`).
Guía completa: [docs/API.md](docs/API.md).

**curl** :

```bash
curl http://127.0.0.1:41200/v1/chat/completions \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"model":"deepseek-v4.1-flash","messages":[{"role":"user","content":"hi"}]}'
```

## Cambiar de cuenta

El bridge no tiene clave propia: relee la de la app en cada petición. Cierra
sesión en DeepAI Code y vuelve a entrar; el bridge sigue al instante.

## Modelos de pago

Permitidos por defecto. Para bloquearlos: `BRIDGE_ALLOW_PAID=0 claude`. Con saldo
cero el bridge pasa solo a un modelo gratuito, salvo
`BRIDGE_FALLBACK_ON_EMPTY=0`.

## Configuración

| Variable | Defecto | Función |
|---|---|---|
| `BRIDGE_PORT` | `41200` | puerto (loopback) |
| `BRIDGE_DEFAULT_MODEL` | `deepseek-v4.1-flash` | modelo inicial |
| `BRIDGE_ALLOW_PAID` | `1` | permite modelos de pago |
| `BRIDGE_FALLBACK_ON_EMPTY` | `1` | pasa a gratuito con saldo cero |
| `BRIDGE_NO_AUTH` | `0` | desactiva el token |
| `DEEPAI_TRANSPORT_URL` / `DEEPAI_TRANSPORT_TOKEN` | — | omite el descubrimiento |

## Seguridad

- escucha solo en `127.0.0.1`;
- token aleatorio en `~/.deepai-bridge/token` (0600), en
  `authorization: Bearer` o `x-api-key`;
- nada sale de la máquina salvo por el transporte de la app;
- registros en `~/.deepai-bridge/bridge.log`.

## Cómo funciona

- [docs/DESIGN.md](docs/DESIGN.md) — cómo llega el bridge a la app
- [docs/MODELS.md](docs/MODELS.md) — nombres de modelo y avisos
- [docs/THEOS.md](docs/THEOS.md) — concesión de teos
- [docs/PLATFORMS.md](docs/PLATFORMS.md) — Linux, macOS, Windows, Docker

## Licencia

MIT.
