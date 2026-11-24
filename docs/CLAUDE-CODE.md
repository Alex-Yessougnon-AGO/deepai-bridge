# Claude Code : état, entretien et pratiques

## Version

Tu es sur **2.1.331**, qui est la dernière publiée. Rien à mettre à jour.

Mise à jour plus tard :

```bash
claude update
```

Le bridge n'a pas besoin d'être réinstallé après une mise à jour : il re-résout le
binaire `claude` à chaque lancement et n'écrit rien dans le dossier
d'installation. Vérifie quand même avec `deepbridge doctor` — il relance une
session de test et refuse toute régression.

## Permissions : ne plus être interrogé

Claude Code demande confirmation avant d'écrire ou de lancer une commande. Deux
niveaux, et un piège.

**Le piège : `auto` ne marche pas ici.** Le mode `auto` s'appuie sur un
classificateur côté serveur Anthropic ; derrière une passerelle, Claude Code
affiche « auto mode unavailable for this model ». Inutile de le sélectionner.

**Ce qui marche : `acceptEdits`.** C'est le mode par défaut posé par `install` :
les écritures passent sans demande.

**Et une liste blanche** pour les commandes : `install` écrit 60 règles dans
`~/.claude/settings.json` (lecture, git, node, npm, python, cargo, ffmpeg, ls,
cat, mkdir, curl…). `mv`, `cp`, `sed`, `rm` inclus ; une suppression franche
demande encore, ce qui est sain.

Changer de mode sans le réécrire :

```bash
claude --permission-mode acceptEdits   # écritures autorisées, commandes filtrées
claude --permission-mode bypassPermissions   # tout autorisé, aucune demande
```

`bypassPermissions` est le seul moyen d'obtenir zéro demande partout. À réserver
aux dépôts de confiance : Claude peut écrire et exécuter sans rien demander.

## Premier lancement dans un dossier

Claude Code demande « Is this a project you created or one you trust? » et
`Claude Code didn't start because this folder isn't trusted` si on valide, parce
que le curseur est sur **No, exit** par défaut.

Ce n'est pas le bridge : c'est l'autorisation d'écrire dans le dossier, une fois
par dossier. Flèche bas puis Entrée. On peut la contourner avec
`claude --dangerously-skip-permissions`, mais elle ne revient plus ensuite.

## Ce que `/` doit afficher

`/` liste :

1. les commandes intégrées (`/model`, `/context`, `/compact`, `/usage`,
   `/permissions`, `/mcp`, `/status`, `/doctor`, `/diff`, `/resume`, `/tasks`…) ;
2. tes skills (`~/.claude/skills/`) et celles des plugins installés.

Après `deepbridge install`, les entrées gstack mortes disparaissent. Les skills
orphelins sont déplacés dans `~/.claude/skills-disabled/`, pas supprimés : tu peux
les remettre en les déplaçant à la main.

`install` retire aussi les **hooks morts** — ceux dont la commande pointe vers un
fichier absent. Un hook mort s'exécute à chaque fin de tour et échoue en silence ;
c'était le cas du hook `Stop` de gstack, qui visait un dossier vide.

## `/model`

`install` remplit `availableModels` avec les seuls modèles DeepAI Code. Claude
Code masque donc les siens, et il n'y a plus de doublon « claude haiku ».

Deux garde-fous en plus :

- tous les alias (`opus`, `sonnet`, `haiku`, `default`) pointent sur le même
  modèle gratuit, donc rien de natif ne peut être sélectionné par accident ;
- si tu forces un modèle natif (`claude --model claude-opus-4-6`), il retombe sur
  le modèle du bridge au lieu d'échouer.

Défaut : `deepseek-v4.1-flash` (gratuit). Change-le avec
`BRIDGE_DEFAULT_MODEL=claude-3-haiku--<id> claude`, ou directement dans `/model`.

## Fonctionnalités récentes qui valent le détour

- **`/context`** — détaille ce qui occupe la fenêtre, catégorie par catégorie. À
  regarder avant que la session ne dérive.
- **`/tasks`** — regroupe les tâches planifiées, les réveils `/loop`, les forks ;
  `x` interrompt.
- **Code Mode** — Claude écrit un script qui enchaîne les outils au lieu d'un
  appel par tour : bien plus rapide sur les tâches répétitives.
- **`claude doctor`** — section connectivité API incluse : elle dit si l'endpoint
  répond, avec le code HTTP. C'est le premier réflexe quand un bridge ne répond
  plus.
- **Auto mode** — laisse Claude choisir son niveau d'effort selon la tâche
  (Opus 4.6 / Sonnet 4.6).
- **`/permissions`** — l'onglet Auto mode est là où l'on règle ce qui passe sans
  demander.
- **`claude mcp add-json <nom> -`** — lit la config MCP sur stdin, donc les
  jetons ne traînent pas dans l'historique du shell.
- **Hooks MCP** — un hook peut appeler un outil MCP ; `onFailure: "block"`
  interdit l'action si l'appel échoue.

## Bonnes pratiques

**Contexte**

- Un sujet par session. `/clear` entre deux sujets sans rapport.
- `/context` quand ça ralentit ; `/compact` quand la fenêtre se remplit.
- `CLAUDE.md` à la racine du projet : conventions, commandes, pièges. Il est lu au
  démarrage — court et factuel, sinon il coûte des jetons à chaque tour.

**Contrôle**

- Plan mode pour tout ce qui touche plusieurs fichiers : tu valides le plan avant
  la moindre écriture.
- `acceptEdits` pour les tâches mécaniques, `default` dès qu'il y a des
  suppressions ou des migrations.
- Relis `/diff` avant de committer. Sur ce bridge, `deepseek-v4.1-flash` est
  rapide mais moins fin qu'Opus : garde Opus pour les changements risqués.

**Délégation**

- Les sous-agents isolent la pollution de contexte : exploration, revue, tests.
  Leur modèle se règle à part (`CLAUDE_CODE_SUBAGENT_MODEL`).
- Un hook `Stop` utile vaut mieux qu'une consigne dans le prompt : il s'exécute
  toujours.

**Ce qui ne sert à rien**

- Empiler des skills jamais invoquées : elles encombrent `/` et le prompt système.
- Les hooks qui échouent silencieusement.
- `--dangerously-skip-permissions` sur un dépôt que tu ne connais pas.

## Méthodologies par type de travail

**Web (front/back)**

1. `CLAUDE.md` : stack, scripts, conventions, ce qui est interdit.
2. Plan mode sur la maquette ou le contrat d'API, validation, puis implémentation
   fichier par fichier.
3. Tests d'abord quand la logique est non triviale ; le sous-agent de test écrit,
   tu relis.
4. Vérification visuelle systématique (capture avant/après), pas seulement
   « ça compile ».
5. Revue adversarial avant fusion : un sous-agent relit avec la consigne de
   casser.

**Mobile**

- Un simulateur par plateforme, et des captures à chaque changement d'écran.
- Les contraintes de build (signature, variantes) dans `CLAUDE.md` : sans ça
  Claude improvise.
- Attention à la fenêtre de contexte : les projets mobiles ont beaucoup de
  fichiers générés, exclus-les dès le départ.

**Montage vidéo**

- Claude Code ne voit pas la timeline : décris les plans, laisse-le écrire les
  scripts `ffmpeg` ou les compositions, et vérifie sur des exports courts.
- Un dossier `rushes/` + un `plan.md` par séquence ; le reste en scripts
  réutilisables.
- Toujours un export témoin de 5 secondes avant de lancer un rendu long.

**Général**

- Petits commits, un objectif par commit.
- Quand une session part mal : `/clear` et un meilleur prompt, plutôt que de
  corriger dans le bruit.
