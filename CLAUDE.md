# NosSoireesJeu — contexte du projet pour Claude Code

Web app installable (PWA) pour enregistrer les parties de jeux de société d'un cercle privé
(≤ 10 personnes, toutes sur iPhone) et en tirer des statistiques. Propriétaire : Cédric.
Langue de l'interface, des commentaires et des échanges : **français**.

## Architecture (choix validés, ne pas changer sans demander)
- **Front** : HTML/CSS/JS vanilla, modules ES, **aucune étape de build**. Hébergé sur GitHub Pages
  (`https://cedriccharron.github.io/nossoireesjeu/`, branche `main`, racine du dépôt).
- **Back** : Supabase (plan gratuit) — Auth e-mail, Postgres + RLS, 2 Edge Functions (Deno).
- **App iPhone native** (depuis le 24/11/2026, Cédric a un compte Apple Developer) : emballage Capacitor 8 dans `app-ios/`,
  qui embarque une copie du site. Diffusion : **TestFlight d'abord, App Store ensuite**. La PWA reste en ligne.
- Mode démo automatique quand `js/config.js` est vide (données fictives en localStorage) ou avec `?demo`.

## Fichiers
| Fichier | Rôle |
| --- | --- |
| `index.html`, `css/app.css`, `manifest.webmanifest`, `icons/` | Coquille de l'app (mobile d'abord, clair/sombre) |
| `sw.js` | Service worker. **Incrémenter `VERSION` à chaque mise en ligne** pour forcer la mise à jour des iPhone |
| `js/app.js` | Navigation (hash `#/…`), écrans, formulaires, actions. Constante `VERSION` affichée dans Plus |
| `js/stats.js` | Calcul des statistiques (tout est recalculé depuis les parties, rien n'est stocké) |
| `js/store-supabase.js` / `js/store-demo.js` | Deux implémentations de la **même interface** de stockage — toute nouvelle fonction doit exister dans les deux |
| `js/util.js`, `js/icons.js` | Formatage FR, libellés, icônes SVG |
| `js/config.js` | URL Supabase + clé publishable (publique, normal qu'elle soit dans le dépôt) |
| `supabase/schema.sql` | Schéma complet, **rejouable sans perte** (`if not exists`, `drop policy if exists`) |
| `supabase/functions/bgg/` | Relais API XML BoardGameGeek (jeton `BGG_TOKEN` en secret Supabase), vérifie que l'appelant est connecté |
| `supabase/functions/invite/` | Invitation d'un compte par un gestionnaire (clé secrète côté serveur) |
| `app-ios/` | App iOS Capacitor (bundle `com.cedriccharron.nossoireesjeu`, nom « Soirées Jeu », iPhone seul, portrait). `npm run sync` recopie le site dans `www/` puis dans le projet Xcode ; `npm run ouvrir` ouvre Xcode |

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
- Pour l'examen App Store (étape 2) il faudra : suppression de compte dans l'app, politique de confidentialité, compte de démo.
- Expliquer à Cédric les étapes manuelles (Supabase, GitHub) pas à pas, en français.
