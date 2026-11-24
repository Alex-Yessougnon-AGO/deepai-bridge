# deepai-bridge

> Non officiel. Sans affiliation ni approbation de DeepAI. Fonctionne avec
l'application locale que tu as installée ; aucun service n'est revendu ni partagé.

[English](README.md) · **Français** · [Español](README.es.md) · [Deutsch](README.de.md)

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

- expose tous les modèles du compte connecté — les 12 gratuits (0 théo) et les
  16 payants — chacun étiqueté `GRATUIT` ou `<n> théos`, prix et fenêtre de
  contexte compris ;
- traduit l'API **Anthropic Messages** (`/v1/messages`) et l'API **OpenAI**
  (`/v1/chat/completions`), streaming SSE et tool calls inclus ;
- **démarre avec la session `claude` et s'arrête avec elle** ;
- nomme les modèles pour que Claude Code les accepte sans avertissement, et
  masque les modèles Claude natifs dans `/model` ;
- affiche le **solde de théos** et le prochain gain.

## Ce que ça ne fait pas

Il ne simule pas l'application et ne contourne aucun contrôle. L'app reste le
client : c'est son processus `pi` qui porte le token, ses en-têtes de lane, son
check-in et sa liaison machine. Le bridge ne fait que **traduire un protocole**.
C'est pour ça qu'il survit aux mises à jour et n'a pas de tiers à tenir à jour.

Conséquences assumées :

- **l'app DeepAI Code doit tourner** — elle porte les credentials ; le bridge la
  démarre si besoin et s'arrête quand elle disparaît ;
- le **grant de théos est décidé côté serveur**, par machine et par jour. Rien
  côté client ne l'augmente. Voir [docs/THEOS.md](docs/THEOS.md).

## Installation

Linux et macOS :

```bash
git clone https://github.com/<vous>/deepai-bridge ~/deepai-bridge
cd ~/deepai-bridge
./bin/deepbridge install
```

Windows : voir [docs/PLATFORMS.md](docs/PLATFORMS.md#windows).
Docker et accès distant : [docs/PLATFORMS.md](docs/PLATFORMS.md#docker).

Puis, dans un nouveau terminal :

```bash
claude
```

C'est tout : le bridge démarre avec la session, Claude Code liste tous les
modèles, et le bridge s'arrête quand tu quittes.

Vérifier la chaîne : `deepbridge doctor` · Désinstaller : `deepbridge uninstall`

## Service permanent

Pour que le pont tourne toujours (plusieurs clients, longues sessions) :
`deepbridge service install`. Sinon il vit avec la session et s'arrête après
inactivité.

## Lancer un client

Les lanceurs sont posés par `install` : lance `claude`, `opencode`, `codex` ou
`agy` normalement, le bridge suit. Un second client réutilise le bridge en cours
sans le couper ; il s'arrête seul après dix minutes sans trafic (`deepbridge stop`
pour couper tout de suite).

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

`install` écrit les réglages dans `~/.claude/settings.json` : URL, token,
défauts, et la liste `availableModels` qui limite `/model` aux modèles DeepAI
Code. Il retire aussi les hooks morts et les skills gstack orphelins. Le fichier
d'origine est sauvegardé, `uninstall` le restaure.

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
      "models": { "deepseek-v4.1-flash": {} }
    }
  }
}
```

**Codex** (`~/.codex/config.toml`) :

```toml
model = "deepseek-v4.1-flash"
model_provider = "deepai"

[model_providers.deepai]
name = "DeepAI Code"
base_url = "http://127.0.0.1:41200/v1"
env_key = "DEEPAI_BRIDGE_TOKEN"
wire_api = "responses"   # ou "chat"
```

Les clients sans découverte de modèles : `GET /v1/models`. Les deux
protocoles OpenAI (`responses` et `chat/completions`) et Anthropic
(`messages`) sont servis. Guide complet : [docs/API.md](docs/API.md).

**curl** :

```bash
curl http://127.0.0.1:41200/v1/chat/completions \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"model":"deepseek-v4.1-flash","messages":[{"role":"user","content":"hi"}]}'
```

## Antigravity

`deepbridge run -- agy --model deepseek -p "..."` : le bridge exporte les
variables attendues par `agy`. Pour l'IDE, ajoute le modèle dans Settings →
Models & Usage, URL `http://127.0.0.1:41200/v1/chat/completions`. Détails dans
[docs/API.md](docs/API.md#antigravity-cli-agy).

## Changer de compte

Le bridge n'a aucune clé à lui : il relit celle de l'app à chaque requête.
Déconnecte-toi dans DeepAI Code et reconnecte-toi, le bridge suit immédiatement.

## Modèles payants

Autorisés par défaut. Pour les bloquer : `BRIDGE_ALLOW_PAID=0 claude`. À solde
nul, le bridge bascule seul sur un modèle gratuit, sauf si
`BRIDGE_FALLBACK_ON_EMPTY=0`.

## Configuration

| Variable | Défaut | Rôle |
|---|---|---|
| `BRIDGE_PORT` | `41200` | port d'écoute (loopback) |
| `BRIDGE_DEFAULT_MODEL` | `deepseek-v4.1-flash` | modèle de départ |
| `BRIDGE_ALLOW_PAID` | `1` | autorise les payants |
| `BRIDGE_FALLBACK_ON_EMPTY` | `1` | bascule en gratuit à solde nul |
| `BRIDGE_NO_AUTH` | `0` | désactive le token |
| `BRIDGE_STAY_ALIVE` | `0` | ne s'arrête pas avec l'app |
| `BRIDGE_VERBOSE` | `0` | journal sur stderr |
| `DEEPAI_TRANSPORT_URL` / `DEEPAI_TRANSPORT_TOKEN` | — | contourne la découverte |
| `DEEPAI_APP_BIN` | `~/AppImages/deepai_code.appimage` | binaire de l'app |
| `CLAUDE_REAL_BIN` | dernier `~/.local/share/claude/versions/*` | vrai `claude` |

## Sécurité

- écoute sur `127.0.0.1` uniquement ;
- token aléatoire dans `~/.deepai-bridge/token` (0600), à envoyer en
  `authorization: Bearer` ou `x-api-key` ;
- rien ne quitte la machine autrement que vers le transport de l'app ;
- journaux dans `~/.deepai-bridge/bridge.log`.

## Comment ça marche

- [docs/API.md](docs/API.md) — tous les clients, les deux protocoles, limites
- [docs/DESIGN.md](docs/DESIGN.md) — comment le bridge atteint l'app
- [docs/MODELS.md](docs/MODELS.md) — nommage et suppression du warning
- [docs/THEOS.md](docs/THEOS.md) — attribution des théos
- [docs/PLATFORMS.md](docs/PLATFORMS.md) — Linux, macOS, Windows, Docker
- [docs/CLAUDE-CODE.md](docs/CLAUDE-CODE.md) — entretien de Claude Code et pratiques

## Note légale

Adapté en lisant le bundle de DeepAI Code. Les conditions de DeepAI (section 4)
interdisent à d'autres applications d'utiliser le service sans accord écrit et de
contourner ses limites. Le bridge ne copie rien : il emprunte le transport de
l'app en cours d'exécution.

## Licence

MIT.
