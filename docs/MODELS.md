# Nommage des modèles

## Les deux filtres de Claude Code

En 2.1.331, la découverte de modèles d'une gateway est doublement filtrée :

1. seuls les identifiants contenant `claude` ou `anthropic` sont repris
   (`/(claude|anthropic)/i`) ;
2. un identifiant inconnu du catalogue interne est accepté, mais **précedé d'un
   avertissement** :

```
Claude Code doesn't recognize the model "...", so it assumes a context window
of 1m tokens.
```

Cet avertissement apparaît une fois par session et par modèle, sur stderr.

## La parade retenue

Un identifiant qui **contient le nom d'un modèle Claude connu** est résolu par
Claude Code comme ce modèle : plus d'avertissement, et une fenêtre de contexte
cohérente.

D'où deux préfixes, un par classe de prix :

| Classe | Préfixe | Exemple |
|---|---|---|
| gratuit (0 théo) | `claude-3-haiku` | `claude-3-haiku--glm-5.3-flash` |
| payant | `claude-sonnet-4-5` | `claude-sonnet-4-5--claude-opus-5-5` |

Le séparateur est `--` ; le bridge le coupe pour retrouver l'identifiant réel.
`claude-3-haiku` est réservé au gratuit pour qu'un appel gratuit ne puisse jamais
ressembler à un modèle cher dans la comptabilité de Claude Code.

## Le prix dans le menu

La découverte renvoie `display_name` et `description`, affichés tels quels dans
`/model` :

```
GLM 5.3 Flash · GRATUIT
Claude Opus 5.5 · 15 théos
```

Les modèles payants portent en plus, dans la réponse API, un objet
`price.theos_per_request`.

## Défaut et routage

Le modèle de départ est le premier gratuit du catalogue
(`BRIDGE_DEFAULT_MODEL` pour en changer). Les alias `opus`, `sonnet`, `haiku` de
Claude Code pointent tous dessus, donc les appels internes (titres de session,
sous-agents) ne consomment pas de théos.

## Formes acceptées

En façade Anthropic comme OpenAI :

- l'identifiant complet (`claude-3-haiku--glm-5.3-flash`) ;
- l'identifiant brut (`glm-5.3-flash`), plus court pour `curl` ou un autre client ;
- un suffixe `[1m]` est toléré et retiré.

Un identifiant inconnu bascule sur le modèle par défaut au lieu d'échouer, et le
`message_start` porte alors `_bridge_note`.
