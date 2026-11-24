# deepai-bridge

Utiliser les modèles de **DeepAI Code** depuis **Claude Code**, **opencode**,
**Codex** ou n'importe quel client Anthropic/OpenAI — y compris les modèles
gratuits à 0 théo.

```
Claude Code ─┐
opencode ────┼─> deepai-bridge (127.0.0.1:41200) ─> transport local de l'app ─> DeepAI
Codex ───────┤        traduit Anthropic/OpenAI            (clés, lane, check-in)
curl ────────┘
```

## Ce que ça fait

- expose les **28 modèles** du compte connecté : les 12 gratuits (0 théo) et les
  16 payants, chacun étiqueté `GRATUIT` ou `<n> théos`, prix et fenêtre de
  contexte compris ;
- traduit l'API **Anthropic Messages** (`/v1/messages`) et l'API **OpenAI**
  (`/v1/chat/completions`), streaming SSE et tool calls inclus ;
- **démarre avec la session `claude` et s'arrête avec elle** ;
- nomme les modèles pour que Claude Code les accepte sans le moindre
  avertissement « doesn't recognize the model » ;
- affiche le **solde de théos** et le prochain gain.

## Ce que ça ne fait pas

Il ne simule pas l'application et ne contourne aucun contrôle. L'app reste le
client : c'est son processus `pi` qui porte le token, ses en-têtes de lane, son
check-in et sa liaison machine. Le bridge ne fait que **traduire un protocole**.
C'est pour ça qu'il survit aux mises à jour de l'app et qu'il n'y a pas de
tiers à tenir à jour.

Conséquences assumées :

- **l'app DeepAI Code doit tourner** — elle porte les credentials ; le bridge
  la démarre si besoin et s'arrête quand elle s'arrête ;
- Linux uniquement (le token est lu dans `/proc/<pid>/environ`) ;
- le **grant de théos est décidé côté serveur**, par machine et par jour. Rien
  côté client ne l'augmente. Voir [docs/THEOS.md](docs/THEOS.md).

## Installation

```bash
git clone <ce-depot> ~/deepai-bridge
cd ~/deepai-bridge
./bin/deepbridge install
```

Puis, dans un nouveau terminal :

```bash
claude
```

C'est tout : le bridge démarre avec la session, Claude Code liste tous les
modèles, et le bridge s'arrête quand tu quittes.

Vérifier la chaîne : `deepbridge doctor`
Désinstaller : `deepbridge uninstall`

## Commandes

| Commande | Effet |
|---|---|
| `deepbridge models` | liste les modèles, gratuits et payants, avec leur prix |
| `deepbridge balance` | solde de théos et prochain gain |
| `deepbridge account` | compte DeepAI connecté |
| `deepbridge status` | état du bridge |
| `deepbridge doctor` | diagnostic complet de la chaîne |
| `deepbridge api` | coordonnées et exemples pour un autre client |
| `deepbridge serve` | lance le bridge au premier plan |

## Autres clients

Le bridge parle les deux protocoles. `deepbridge api` affiche le token et des
exemples prêts à copier.

**opencode** (`opencode.json`) :

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "deepai": {
      "npm": "@ai-sdk/openai-compatible",
      "options": { "baseURL": "http://127.0.0.1:41200/v1", "apiKey": "<token>" },
      "models": { "glm-5.3-flash": {} }
    }
  }
}
```

**Codex** (`~/.codex/config.toml`) :

```toml
model = "glm-5.3-flash"
model_provider = "deepai"

[model_providers.deepai]
name = "DeepAI Code"
base_url = "http://127.0.0.1:41200/v1"
env_key = "DEEPAI_BRIDGE_TOKEN"
wire_api = "chat"
```

**curl** :

```bash
curl http://127.0.0.1:41200/v1/chat/completions \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"model":"glm-5.3-flash","messages":[{"role":"user","content":"hi"}]}'
```

## Changer de compte

Le bridge n'a aucune clé à lui : il relit celle de l'app à chaque requête. Pour
changer de compte, déconnecte-toi dans DeepAI Code et reconnecte-toi. Le bridge
suit immédiatement.

## Modèles payants

Ils sont autorisés par défaut. Pour les bloquer :

```bash
BRIDGE_ALLOW_PAID=0 claude
```

Ils ne sont pas bloqués quand le solde tombe à zéro : le bridge bascule alors
seul sur un modèle gratuit, sauf si `BRIDGE_FALLBACK_ON_EMPTY=0`.

## Configuration

| Variable | Défaut | Rôle |
|---|---|---|
| `BRIDGE_PORT` | `41200` | port d'écoute (loopback) |
| `BRIDGE_DEFAULT_MODEL` | premier modèle gratuit | modèle de départ |
| `BRIDGE_ALLOW_PAID` | `1` | autorise les modèles payants |
| `BRIDGE_FALLBACK_ON_EMPTY` | `1` | bascule en gratuit quand le solde est à 0 |
| `BRIDGE_NO_AUTH` | `0` | désactive le token (loopback de confiance) |
| `BRIDGE_STAY_ALIVE` | `0` | ne s'arrête pas avec l'app |
| `BRIDGE_VERBOSE` | `0` | journal sur stderr |
| `DEEPAI_APP_BIN` | `~/AppImages/deepai_code.appimage` | binaire de l'app |
| `CLAUDE_REAL_BIN` | dernier `~/.local/share/claude/versions/*` | binaire `claude` réel |

Environnement Claude Code utile : `CLAUDE_CODE_MAX_OUTPUT_TOKENS`,
`API_TIMEOUT_MS`.

## Sécurité

- écoute sur `127.0.0.1` uniquement ;
- token aléatoire dans `~/.deepai-bridge/token` (0600), à envoyer en
  `authorization: Bearer` ou `x-api-key` ;
- aucune donnée ne quitte la machine autrement que vers le transport de l'app ;
- journaux dans `~/.deepai-bridge/bridge.log`.

## Détails techniques

- [docs/DESIGN.md](docs/DESIGN.md) — comment le bridge parle à l'app
- [docs/MODELS.md](docs/MODELS.md) — nommage des modèles et suppression du warning
- [docs/THEOS.md](docs/THEOS.md) — comment les théos sont attribués

## Licence

MIT.
