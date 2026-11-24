# NosSoireesJeu — contexte du projet pour Claude Code

Web app installable (PWA) **« C-Party »** (ex-NosSoireesJeu, renommée le 24/11/2026 ; dépôt, URL et Bundle ID inchangés) pour enregistrer les parties de jeux de société d'un cercle privé
(≤ 10 personnes, toutes sur iPhone) et en tirer des statistiques. Propriétaire : Cédric.
Langue de l'interface, des commentaires et des échanges : **français**.

## Architecture (choix validés, ne pas changer sans demander)
- **Front** : HTML/CSS/JS vanilla, modules ES, **aucune étape de build**. Hébergé sur GitHub Pages
  (`https://cedriccharron.github.io/nossoireesjeu/`, branche `main`, racine du dépôt).
- **Back** : Supabase (plan gratuit) — Auth e-mail, Postgres + RLS, 2 Edge Functions (Deno).
- **App iPhone native** (depuis le 24/11/2026, Cédric a un compte Apple Developer) : emballage Capacitor 8 dans `app-ios/`,
  qui embarque une copie du site. Diffusion : **TestFlight d'abord, App Store ensuite**. La PWA reste en ligne.
- Mode démo automatique quand `js/config.js` est vide (données fictives en localStorage) ou avec `?demo`.

### Bascule vers iCloud (décidée le 24/11/2026, en cours)
Cédric a choisi de quitter Supabase pour **iCloud (CloudKit)**, sauf le relais BoardGameGeek. Décisions :
- **Partage de zone CloudKit** : les données vivent dans une zone personnalisée `CParty` de la base **privée** du
  propriétaire (Cédric), partagée par un `CKShare` de zone. Les invités la lisent dans leur base **partagée**.
  Droit `readWrite` = gestionnaire (`admin`), `readOnly` = joueur (`viewer`). Le propriétaire est toujours admin.
- **Plus de mots de passe ni d'e-mails** : identité = identifiant Apple ; invitations et droits gérés par l'écran
  de partage natif d'Apple (`UICloudSharingController`). Fiche `Member` par participant (nom affiché, `player_id`).
- **Enregistrements** : un type par entité (`Player`, `Game`, `Play`, `History`, `Member`), un champ `json` qui
  contient l'objet complet. Une partie embarque ses joueurs et ses extensions → enregistrement atomique ;
  l'historique est écrit dans la **même** opération atomique (`CKModifyRecordsOperation`, `isAtomic`).
- **App iPhone uniquement** pour les vraies données ; le site GitHub Pages ne garde que le mode démo.
- **Relais BGG** : reste une fonction Supabase, protégée par une clé propre à l'app (plus de comptes Supabase).
- **Bascule en une fois** : export Supabase (`supabase/export.sql` → `export/*.csv`, vérifié par
  `supabase/verifier-export.mjs`) puis import dans iCloud. Supabase reste en service jusqu'au feu vert de Cédric.

## Fichiers
| Fichier | Rôle |
| --- | --- |
| `index.html`, `css/app.css`, `manifest.webmanifest`, `icons/` | Coquille de l'app (mobile d'abord, clair/sombre) |
| `sw.js` | Service worker. **Incrémenter `VERSION` à chaque mise en ligne** pour forcer la mise à jour des iPhone |
| `js/app.js` | Navigation (hash `#/…`), écrans, formulaires, actions. Constante `VERSION` affichée dans Plus |
| `js/stats.js` | Calcul des statistiques (tout est recalculé depuis les parties, rien n'est stocké) |
| `js/store-icloud.js` / `js/store-supabase.js` / `js/store-demo.js` | Trois implémentations de la **même interface** de stockage — toute nouvelle fonction doit exister dans les trois. iCloud = app iPhone (logique métier en JS, calquée sur la démo) |
| `app-ios/ios/App/App/CloudStore.swift` | Module natif `CloudStore` : statut iCloud, lecture de la zone, écriture atomique, écran de partage Apple, acceptation des invitations |
| `js/secrets.js` | **Exclu de Git.** `BGG_APP_KEY`, identique au secret Supabase `APP_KEY` du relais BGG |
| `tests/store-icloud.test.mjs` | Test du stockage iCloud avec un faux iCloud : `node tests/store-icloud.test.mjs` |
| `supabase/export.sql`, `supabase/verifier-export.mjs` | Export complet en un CSV (`table`, `id`, `donnees` JSON) et son contrôle ; l'import se fait dans l'app (Plus) |
| `js/util.js`, `js/icons.js` | Formatage FR, libellés, icônes SVG |
| `js/config.js` | URL Supabase + clé publishable (publique, normal qu'elle soit dans le dépôt) |
| `supabase/schema.sql` | Schéma complet, **rejouable sans perte** (`if not exists`, `drop policy if exists`) |
| `supabase/functions/bgg/` | Relais API XML BoardGameGeek (secrets `BGG_TOKEN` et `APP_KEY`) ; accepte l'en-tête `x-app-key` ou un compte Supabase connecté |
| `supabase/functions/invite/` | Invitation d'un compte par un gestionnaire (clé secrète côté serveur) |
| `app-ios/` | App iOS Capacitor (bundle `com.cedriccharron.nossoireesjeu`, nom affiché « C-Party », iPhone seul, portrait). `npm run sync` recopie le site dans `www/` puis dans le projet Xcode ; `npm run ouvrir` ouvre Xcode |

## Règles métier
- Rôles : `admin` (gestionnaire : saisit, modifie, supprime) et `viewer` (joueur : consultation de tout).
  Comptes **sur invitation uniquement** ; le 1er compte créé devient admin ; impossible de retirer le dernier admin.
- **Compte ≠ fiche joueur** : un joueur peut exister sans compte ; lien optionnel `profiles.player_id`.
- Modes de partie : `competitive`, `teams`, `coop`, `solo`. Classement déduit des scores selon
  `games.score_rule` (`high`/`low`/`none`), égalités = même rang, départage manuel possible.
- Partie d'apprentissage : compte dans le volume (parties, heures), **exclue** des victoires/records.
- Les parties ne s'écrivent **que** via les fonctions SQL `save_play` / `delete_play` / `restore_play`
  (atomiques + historique dans `play_history`). Ne jamais écrire directement dans `plays`/`play_players`.
- Extensions = jeux avec `base_game_id` ; stats regroupées sur le jeu de base.
- Indicateur grisé sous 3 parties (`MIN_SAMPLE`).
- Le **lieu** des parties a été retiré de l'interface (décision du 23/11/2026) ; la colonne reste en base.
- Données BGG : usage non commercial, mention « Source : BoardGameGeek » obligatoire.

## Feuille de route
- **Lot 1 (fait, v1.0.1)** : comptes/invitations, ludothèque + import collection BGG, parties + historique,
  tableaux de bord de base.
- **Lot 2** : Elo par jeu (départ 1000, K=32 réparti en duels), indice de performance (victoires / victoires
  attendues 1/n), némésis (≥ 3 parties communes) et duels, records et séries, jeux délaissés (> 6 mois),
  filtres période / type-mécanique / nombre de joueurs.
- **Lot 3** : saisie hors-ligne (file d'attente locale, envoi à l'ouverture), notifications push
  (nouvelle partie, record battu ; iOS ≥ 16.4), carte résultat partageable, export CSV (séparateur `;`) + JSON,
  GitHub Action quotidienne anti-mise-en-veille Supabase + sauvegarde hebdomadaire.
- Idées en attente : statut « invitation en attente / activé » et date de dernière ouverture dans Plus → Comptes ;
  bouton « Compléter avec BGG » pour les jeux saisis à la main.

## Points d'attention connus
- E-mails : le service par défaut de Supabase n'envoie qu'aux membres de l'équipe du projet, 2 par heure.
  Un SMTP Gmail personnalisé a été proposé (Authentication > Emails) : vérifier avec Cédric s'il est en place.
- Jeton BGG demandé le 23/11/2026, validation manuelle par BGG (≈ 1 semaine) ; la fonction `bgg` n'est
  pas encore déployée tant que le jeton n'est pas reçu.
- Supabase utilise les nouvelles clés (`sb_publishable_…` / `sb_secret_…`) ; les fonctions lisent
  `SUPABASE_PUBLISHABLE_KEYS` / `SUPABASE_SECRET_KEYS` avec repli sur les anciennes variables.
- « Verify JWT » désactivé sur les deux fonctions : elles vérifient elles-mêmes l'utilisateur.

## Comment travailler
- Tester localement : `python3 -m http.server 8765` puis `http://localhost:8765/?demo` (mode démo).
- Après toute modification du schéma : l'écrire de façon rejouable dans `supabase/schema.sql`
  et donner à Cédric le bloc SQL à exécuter dans Supabase > SQL Editor.
- Avant de proposer une mise en ligne : vérifier en mode démo, incrémenter `VERSION` dans `sw.js` et `js/app.js`.
- App iOS : après toute modification du site, `cd app-ios && npm run sync`, puis augmenter le numéro de build dans Xcode
  avant chaque envoi TestFlight. Les liens d'e-mail pointent toujours vers le site public (`webUrl()` dans `store-supabase.js`).
- Pour l'examen App Store (étape 2) il faudra : politique de confidentialité, captures, compte de démo (un iCloud de test
  invité dans un groupe de démo). La « suppression de compte » = Plus → Quitter / Supprimer le groupe.
- **CloudKit** : en développement (Xcode), les types d'enregistrement se créent seuls. **Avant tout envoi TestFlight**,
  déployer le schéma en Production (CloudKit Console → conteneur `iCloud.com.cedriccharron.nossoireesjeu` → Deploy Schema Changes).
- Le simulateur n'a pas de compte iCloud par défaut : Cédric doit s'y connecter lui-même (Réglages du simulateur).
- Expliquer à Cédric les étapes manuelles (Supabase, GitHub) pas à pas, en français.
