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

### Bascule vers iCloud (décidée et **faite** le 24/11/2026)
Cédric a choisi de quitter Supabase pour **iCloud (CloudKit)**, sauf le relais BoardGameGeek. Décisions :
- **Partage de zone CloudKit** : les données vivent dans une zone personnalisée `CParty` de la base **privée** du
  propriétaire (Cédric), partagée par un `CKShare` de zone. Les invités la lisent dans leur base **partagée**.
  Droit `readWrite` = gestionnaire (`admin`), `readOnly` = joueur (`viewer`). Le propriétaire est toujours admin.
- **Plus de mots de passe ni d'e-mails** : identité = identifiant Apple ; invitations et droits gérés par l'écran
  de partage natif d'Apple (`UICloudSharingController`). Fiche `Member` par participant (nom affiché, `player_id`).
- **Enregistrements** : un type par entité (`Player`, `Game`, `Play`, `History`, `Member`), un champ `json` qui
  contient l'objet complet. Une partie embarque ses joueurs et ses extensions → enregistrement atomique ;
  l'historique est écrit dans la **même** opération atomique (`CKModifyRecordsOperation`, `isAtomic`).
- **Photos des parties** (ajout du 24/11/2026) : type `Photo` (`ph-<uuid>`), `json` = métadonnées + vignette 360 px
  en data URL, champ `image` (CKAsset, JPEG ≤ 1600 px) téléchargé seulement à l'ouverture (`CloudStore.image`).
  `fetchAll` ne lit que `json`. Gestionnaires seulement pour ajouter/supprimer ; gardées si la partie est supprimée
  (restauration), effacées avec un jeu supprimé. Site Supabase : pas de photos.
- **Pochette d'un jeu** : champ `cover` du jeu (data URL carrée 400 px, ≈ 30 Ko) dans le `json`, prioritaire sur l'image BGG.
- **App iPhone uniquement** pour les vraies données ; le site GitHub Pages ne garde que le mode démo.
- **Relais BGG** : reste une fonction Supabase, protégée par une clé propre à l'app (plus de comptes Supabase).
- **Fait le 24/11/2026** : données importées dans iCloud (production) depuis `export/c-party-2026-11-24.csv`
  (7 joueurs, 1 jeu, 3 parties), build 3 sur TestFlight, schéma CloudKit déployé en production.
  Le site est passé en démo (`CONFIG.WEB_SUPABASE = false`) avec un message vers l'app. Les tables Supabase restent
  en l'état (archive figée) ; `store-supabase.js` est conservé pour un éventuel retour arrière.
- **Méthode suivie** : export Supabase (`supabase/export.sql` → `export/*.csv`, vérifié par
  `supabase/verifier-export.mjs`) puis import dans iCloud. Supabase reste en service jusqu'au feu vert de Cédric.

### Plusieurs groupes (v1.3.0, 26/11/2026)
Une personne peut posséder et rejoindre **plusieurs groupes** (famille, collègues…). Chaque groupe = une zone CloudKit
`CParty` (le premier, nom historique) ou `CParty-<id>`, partagée par son propre `CKShare` ; identifiant côté JS
`<ownerName>|<zoneName>`, passé en `group` à chaque appel natif, groupe ouvert retenu dans `localStorage` (`cparty-group`).
Nom + emoji du groupe dans un enregistrement `Group` (nom `group`, champ `json`) — **type à déployer en Production**.
« C'est moi » (fiche joueur liée) : `Member` si gestionnaire, sinon retenu sur l'iPhone (`cparty-me`).
Écrans : `#/groups` (liste, créer), `#/groups/new`, `#/me` (stats tous groupes, `myStats()`), `#/games/copy` (copie de jeux).
Une partie appartient à un seul groupe ; stats/Elo par groupe ; seul le propriétaire d'un groupe invite.

### Interface « style A » (v1.2.0, 26/11/2026)
Style iOS sobre choisi par Cédric : couleurs système (fond `#f2f2f7`, bleu `#007aff`, noir en sombre), listes groupées
sans ombres, titres de section hors des cartes (`.sec-h`), avatars à initiales (`dot()` → `.av`), « + » dans l'en-tête
(`addBtn`, plus de bouton flottant). Accueil : pastille de filtres repliable, dernière partie, raccourcis, tuiles, top 3,
activité, carrousel de pochettes ; le tableau complet est sur l'écran `#/ranking`.

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
| `js/export.js`, `js/card.js` | Exports CSV (sauvegarde réimportable + parties pour tableur), partage de fichier (`CloudStore.shareFile` dans l'app), carte résultat PNG |
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
- **Lot 2 (en cours, v1.1.0)** — fait : Elo par jeu (fiche jeu, fiche joueur, écart sur chaque partie), indice de performance, face-à-face, némésis / victime favorite, filtres nombre de joueurs + type/mécanique sur l'accueil, chacun expliqué dans l'app (`explain()`). Reste : records et séries (non demandés pour l'instant). Spécification d'origine : Elo par jeu (départ 1000, K=32 réparti en duels), indice de performance (victoires / victoires
  attendues 1/n), némésis (≥ 3 parties communes) et duels, records et séries, jeux délaissés (> 6 mois),
  filtres période / type-mécanique / nombre de joueurs.
- **Lot 3** : saisie hors-ligne (file d'attente locale, envoi à l'ouverture), notifications push
  (nouvelle partie, record battu ; iOS ≥ 16.4), carte résultat partageable, export CSV (séparateur `;`) + JSON,
  GitHub Action quotidienne anti-mise-en-veille Supabase + sauvegarde hebdomadaire.
- **Synchronisation BGG** (v1.1.1, écran `#/games/import`) : nouveaux jeux, fiches à compléter (champs vides seulement, association des jeux saisis à la main par le nom, `bgg_synced_at` pour ne pas reproposer), jeux retirés de BGG → « joué ailleurs » au choix. Jamais de suppression ni de changement de nom/pochette. Fonctionne dès que le relais `bgg` est déployé (jeton BGG). Variante sans API (v1.1.2) : import du CSV exporté de la collection BGG (`js/bgg-csv.js`, test `tests/bgg-csv.test.mjs`) — année, joueurs, durée, difficulté ; pas d'image ni mécaniques, extension rattachée par le nom, `bgg_synced_at` non posé.
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
