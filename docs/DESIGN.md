# Comment le bridge parle à l'application

## La chaîne réelle

DeepAI Code (Electron) lance un processus enfant `pi`. Ce processus démarre un
serveur HTTP sur un port loopback aléatoire et porte, dans son environnement :

| Variable | Rôle |
|---|---|
| `T3_DEEPAI_URL` | base URL du transport local |
| `T3_DEEPAI_TOKEN` | secret de capacité, 32 octets aléatoires par lancement |

Toutes les requêtes de modèle partent de là. Le processus relit ses credentials
à chaque requête, ajoute lui-même :

- `api-key` — la clé du compte connecté ;
- `X-DeepAI-Code-Theos` — version de lane (`7`) ;
- `X-DeepAI-Code-Instance` — identité d'instance, aléatoire par lancement ;
- `X-DeepAI-Code-Machine` — SHA‑256 d'un identifiant machine stable (sur Linux,
  `/etc/machine-id`) ;
- `X-Session-Affinity` — affinité de session ;
- le nonce `X-DeepAI-Code-Check-In` et le beacon `X-DeepAI-Code-Beacon`.

Le bridge n'a donc **aucun credential** et ne rejoue rien : il relaie vers
`http://127.0.0.1:<port>/chat/completions` avec le token de capacité. Toute la
couche d'identité reste celle de l'app.

## Récupération du token

```js
// src/transport.mjs
const env = fs.readFileSync(`/proc/${pid}/environ`, "utf8");
```

`kernel.yama.ptrace_scope = 1` interdit `/proc/<pid>/mem` mais **pas**
`/proc/<pid>/environ` : le token est lisible par le même utilisateur, sans
privilège. Il est relu à **chaque requête**, donc un redémarrage de l'app est
transparent et aucun token périmé ne subsiste.

Le processus est identifié par son `comm` (`pi` ou `bun`) et la présence des deux
variables, ce qui évite de confondre le transport avec un autre processus.

## Contraintes du transport, découvertes empiriquement

| Contrainte | Traitement |
|---|---|
| Un message `system` est **obligatoire** (400 `This request cannot be
  accepted` sinon) | un système est injecté s'il manque |
| L'API est `openai-completions` (`/chat/completions`) | `/v1/messages` et
  `/v1/chat/completions` sont acceptés en façade et traduits |
| Seuls `/chat/completions` et `/responses` existent en amont | le bridge ne
  relaie que ceux-là |
| Le flux porte `delta.reasoning` | ignoré : Claude Code n'a pas de bloc
  « reasoning » sans thinking explicite, et un second bloc avant l'instant de
  départ casserait les index |
| Claude Code émet **un seul** `message_start` | le texte est mis en tampon et
  vidé avant le premier tool call, sinon un second bloc s'ouvre sur un index
  déjà utilisé |

## Pourquoi pas de fausse identité

Rien n'est forgé : `X-DeepAI-Code-Theos`, `-Instance`, `-Machine`, le check-in et
le beacon sont produits par le processus de l'app, pas par le bridge. Le bridge
n'est qu'un traducteur de protocole devant un client légitime.
