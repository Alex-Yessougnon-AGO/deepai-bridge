# Les théos : d'où ils viennent, pourquoi le montant varie

## Le mécanisme

Le lane free n'est pas un quota d'API rattaché à un compte. C'est une
**subvention journalière liée à une machine** : le serveur lit
`X-DeepAI-Code-Machine` et, d'après le code de l'app, « accorde les théos du jour
une fois par machine » et « refuse la subvention à un client qui n'envoie pas
l'en-tête ».

Le montant, la date de reset et l'état sont décidés **côté serveur**. Le client
ne calcule rien : il lit et affiche `balance`, `granted` et `refresh_at`. Aucune
formule locale, aucun multiplicateur.

## Pourquoi le montant varie

Deux axes de liaison sont connus, tous deux côté serveur :

- `machine_bound` — la machine (identifiant stable, haché) ;
- `network_bound` — le réseau.

D'où la variation observée d'un jour à l'autre : le montant n'est pas une
constante, et le client n'a aucune prise dessus.

## Ce que le bridge apporte

Puisque le montant est hors de portée, le bridge agit sur ce qui est à portée :

| Levier | Effet |
|---|---|
| `deepbridge balance` | solde réel, montant accordé, prochain reset |
| prix dans le menu `/model` | on choisit en connaissance de cause |
| défaut sur un modèle gratuit | les appels internes de Claude Code ne coûtent rien |
| bascule automatique à 0 théo | plus d'échec en pleine session |
| `BRIDGE_ALLOW_PAID=0` | interdit tout débit accidentel |

## Lire le solde soi-même

Le bridge interroge le même endpoint que l'app, avec les mêmes en-têtes de lane
et la même liaison machine :

```
GET https://api.deepai.org/deepai_code/theos
api-key: <clé du compte>
X-DeepAI-Code-Theos: 7
X-DeepAI-Code-Machine: <sha256 de /etc/machine-id>
```

Réponse : `{enabled, balance, granted, refresh_at, lane_version, check_in{nonce,
seconds}}`. Le `nonce` sert au check-in suivant, en en-tête
`X-DeepAI-Code-Check-In`.

## Changer de machine

`/etc/machine-id` identifie la machine : réinstaller l'app le conserve,
réinstaller l'OS le change (et donc le grant repart). Les conteneurs qui
partagent `/etc/machine-id` de l'hôte n'y changent rien.
