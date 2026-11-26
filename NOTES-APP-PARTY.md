# C-Party — notes de projet

*État au 26 novembre 2026 · version 1.2.0 (site) · app iPhone version 1.2, build 10*

---

## 1. Objectif

**C-Party** (ancien nom : NosSoireesJeu, renommée le 24/11/2026) est une app pour **enregistrer les parties de jeux de société
d'un cercle privé** (10 personnes au plus, toutes sur iPhone) et **en tirer des statistiques** : qui gagne, à quoi on joue,
combien de temps, niveau de chacun par jeu, rivalités…

- Propriétaire : Cédric (gestionnaire principal du groupe).
- Langue de l'interface, des commentaires et des échanges : **français**.
- Gratuite, sans publicité, sans suivi ; usage strictement privé.

---

## 2. Architecture

### Vue d'ensemble

| Couche | Choix | Remarques |
| --- | --- | --- |
| Interface | HTML / CSS / JavaScript « vanilla », modules ES, **aucune étape de build** | Même code pour le site et l'app iPhone |
| App iPhone | Emballage **Capacitor 8** (`app-ios/`), qui embarque une copie du site | Diffusion par **TestFlight**, App Store plus tard |
| Données (app iPhone) | **iCloud / CloudKit**, zone partagée | Aucune donnée chez le développeur |
| Site web | **GitHub Pages** : https://cedriccharron.github.io/nossoireesjeu/ | **Mode démo uniquement** (données fictives) |
| Relais BoardGameGeek | Fonction **Supabase** (Deno) `bgg`, protégée par une clé propre à l'app | En attente du jeton BGG |
| Ancien back-end | Supabase (Auth e-mail, Postgres + RLS) | **Archive figée**, conservée pour un retour arrière |

### Stockage iCloud (CloudKit)

- Conteneur `iCloud.com.cedriccharron.nossoireesjeu`, zone personnalisée **`CParty`** dans la base **privée** du propriétaire,
  partagée par un **`CKShare` de zone**. Les invités la lisent dans leur base **partagée**.
- Droits : `readWrite` = **gestionnaire** (`admin`), `readOnly` = **joueur** (`viewer`). Le propriétaire est toujours gestionnaire.
- **Pas de mot de passe ni d'e-mail** : l'identité est l'identifiant Apple ; invitations et droits passent par l'écran de partage
  natif d'Apple (`UICloudSharingController`).
- Un type d'enregistrement par entité : `Player`, `Game`, `Play`, `History`, `Member`, `Photo`, chacun avec un champ `json`
  contenant l'objet complet.
- Une partie embarque ses joueurs et ses extensions ; elle est écrite **avec son historique dans la même opération atomique**
  (`CKModifyRecordsOperation`, `isAtomic`).
- **Photos** : type `Photo` (`ph-<uuid>`), vignette 360 px dans le `json`, image complète (JPEG ≤ 1600 px) dans un `CKAsset`
  téléchargé seulement à l'ouverture. La lecture générale (`fetchAll`) ne télécharge que les `json`.
- **Pochette d'un jeu** : champ `cover` (image carrée 400 px, ≈ 30 Ko) dans le `json` du jeu, prioritaire sur l'image BGG.

### Trois implémentations du stockage, une seule interface

`js/store-icloud.js` (app iPhone), `js/store-demo.js` (démo, localStorage) et `js/store-supabase.js` (ancien back-end).
**Toute nouvelle fonction doit exister dans les trois.** Le mode démo s'active tout seul quand `js/config.js` est vide,
ou avec `?demo` dans l'adresse.

---

## 3. Fichiers importants

| Fichier | Rôle |
| --- | --- |
| `index.html`, `css/app.css`, `manifest.webmanifest`, `icons/` | Coquille de l'app (mobile d'abord, clair et sombre) |
| `sw.js` | Service worker. **Incrémenter `VERSION` à chaque mise en ligne** |
| `js/app.js` | Navigation (`#/…`), tous les écrans, formulaires et actions. Constante `VERSION` affichée dans Plus |
| `js/stats.js` | Calcul de toutes les statistiques (rien n'est stocké, tout est recalculé depuis les parties) : classement, Elo, indice, face-à-face, filtres |
| `js/store-icloud.js` | Stockage iCloud (logique métier en JS, calquée sur la démo) |
| `js/store-demo.js` | Stockage de démo avec données fictives et faux catalogue BGG |
| `js/store-supabase.js` | Ancien stockage Supabase (conservé) |
| `js/export.js` | Exports CSV (sauvegarde réimportable + parties pour tableur) et partage de fichier |
| `js/card.js` | Carte résultat d'une partie en image PNG, à partager |
| `js/bgg-csv.js` | Lecture du fichier CSV exporté de la collection BoardGameGeek |
| `js/util.js`, `js/icons.js` | Formatage français, libellés, préparation des photos, icônes SVG |
| `js/config.js` | URL Supabase + clé publique (normal qu'elle soit dans le dépôt) |
| `js/secrets.js` | **Exclu de Git.** `BGG_APP_KEY`, identique au secret Supabase `APP_KEY` du relais BGG |
| `app-ios/ios/App/App/CloudStore.swift` | Module natif : statut iCloud, lecture de la zone, écriture atomique, partage Apple, invitations, images, partage de fichiers |
| `app-ios/` | Projet Capacitor (bundle `com.cedriccharron.nossoireesjeu`, nom affiché « C-Party », iPhone seul, portrait) |
| `confidentialite.html` | Politique de confidentialité (exigée par TestFlight externe et l'App Store) |
| `supabase/schema.sql` | Schéma Supabase complet, rejouable sans perte |
| `supabase/export.sql`, `supabase/verifier-export.mjs` | Export complet des données Supabase en CSV et son contrôle |
| `supabase/functions/bgg/` | Relais vers l'API XML de BoardGameGeek |
| `supabase/functions/invite/` | Ancienne invitation par e-mail (époque Supabase) |
| `tests/store-icloud.test.mjs` | Test du stockage iCloud avec un faux iCloud : `node tests/store-icloud.test.mjs` |
| `tests/bgg-csv.test.mjs` | Test de la lecture du CSV BGG : `node tests/bgg-csv.test.mjs` |
| `export/` | Exports de données réelles — **ne jamais commiter** |
| `CLAUDE.md` | Contexte de travail détaillé pour Claude Code |

*Le dépôt contient aussi deux projets voisins, sans lien avec C-Party : `4forwin/` (pages de l'app 4 for Win) et `c-patrimoine/`.*

---

## 4. Règles métier

- **Rôles** : gestionnaire (saisit, modifie, supprime) et joueur (consulte tout). Groupe **sur invitation uniquement**.
- **Compte ≠ fiche joueur** : un joueur peut exister sans compte ; un membre peut être lié à une fiche joueur.
- **Modes de partie** : compétitif, équipes, coopératif, solo. Le classement est déduit des scores selon la règle du jeu
  (le plus haut gagne / le plus bas gagne / sans score) ; égalités = même rang ; départage manuel possible.
- **Partie d'apprentissage** : compte dans le volume (parties, heures) mais **exclue** des victoires, de l'Elo et des records.
- **Historique** : chaque création, modification, suppression ou restauration de partie est tracée (avant / après).
  Une partie supprimée reste restaurable.
- **Extensions** = jeux rattachés à un jeu de base ; les statistiques sont regroupées sur le jeu de base.
- **Indicateurs peu fiables grisés** sous 3 parties (`MIN_SAMPLE`).
- **Elo par jeu** : départ 1000, K = 32 réparti en duels ; en équipes, chaque équipe compte pour la moyenne de ses joueurs.
- **Indice de performance** = victoires ÷ victoires attendues (1 / nombre de camps).
- **Némésis / victime favorite** : au moins 3 parties en commun.
- **Données BGG** : usage non commercial, mention « Source : BoardGameGeek » obligatoire.

---

## 5. Ce qui est fait

### Lot 1 (v1.0.x)
- Comptes et invitations, ludothèque, recherche et import de jeux BGG, saisie des parties avec historique.
- Tableaux de bord : chiffres clés, parties par mois, classement, jeux les plus joués.

### Passage à l'app iPhone et à iCloud (24/11/2026)
- App Capacitor, compte Apple Developer, TestFlight (testeurs internes puis groupe externe « Joueurs »).
- Bascule complète de Supabase vers iCloud : données réelles importées (7 joueurs, 1 jeu, 3 parties),
  schéma CloudKit déployé en production, site web passé en démo.
- Invitations par le partage natif d'Apple, droits joueur / gestionnaire fixés par l'app.
- Politique de confidentialité publiée.

### Améliorations (v1.0.7 → v1.1.0)
- **Photos des parties** (une ou plusieurs, visionneuse plein écran).
- **Actualisation automatique** au retour dans l'app et sur Plus (un nouvel invité apparaît sans relancer).
- **Classement triable** (parties, victoires, taux, indice).
- **Pochette personnalisée** d'un jeu (photo prise par le groupe).
- **« Que jouer ce soir ? »** : filtre par nombre de joueurs, tri par nom / plus joués / délaissés.
- **Export CSV** : sauvegarde complète réimportable et tableau des parties pour Excel / Numbers.
- **Carte résultat** à partager (image PNG).

### Lot 2 — statistiques (v1.1.0)
- Elo par jeu (fiche jeu, fiche joueur, écart sur chaque partie), indice de performance, face-à-face,
  némésis et victime favorite, filtres nombre de joueurs + type / mécanique sur l'accueil.
- Chaque indicateur est **expliqué directement dans l'app** (encadrés « C'est quoi ? »).

### Synchronisation BoardGameGeek (v1.1.1 et v1.1.2)
- Écran **« Synchroniser avec BGG »** : nouveaux jeux, fiches à compléter (champs vides uniquement, association des jeux
  saisis à la main par le nom), jeux retirés de la collection → « joué ailleurs » au choix.
  Jamais de suppression ni de changement de nom ou de pochette.
- **Import du fichier CSV** exporté de la collection BGG : fonctionne dès maintenant, sans API (année, joueurs, durée,
  difficulté ; pas d'images ni de mécaniques ; extensions rattachées par le nom).

### Nouveau look « style A » (v1.2.0, build 10)
- Style iOS sobre : couleurs système, listes groupées sans ombres, titres de section hors des cartes,
  avatars ronds à initiales, « + » dans l'en-tête au lieu du bouton flottant, mode sombre noir.
- **Accueil repensé** : pastille de filtres repliable, dernière partie, raccourcis « Nouvelle partie » / « Que jouer ? »,
  tuiles de chiffres, top 3 « En forme », activité, carrousel des jeux les plus joués, dernières parties.
- **Nouvel écran Classement** (`#/ranking`) avec le tableau complet, les tris et les explications.
- **Fiche partie** : avatars, scores seulement s'il y en a, points Elo sur chaque ligne.

### Historique des envois TestFlight
| Version | Builds | Contenu |
| --- | --- | --- |
| 1.0 | 1 à 6 | 1 = Supabase ; 2 à 6 = iCloud, corrections, photos, actualisation |
| 1.1 | 7, 8, 9 | Lot 2, synchronisation BGG, import CSV BGG |
| 1.2 | 10 | Nouveau look (style A) |

---

## 6. Ce qui reste à faire

### Immédiat
- Dans App Store Connect : ajouter le **build 10 (version 1.2)** au groupe **Joueurs**, avec un texte « À tester », puis le soumettre ;
  faire expirer les anciens builds.

### Dès réception du jeton BGG (demandé le 23/11/2026, validation manuelle ≈ 1 semaine)
- Dans Supabase : définir les secrets **`BGG_TOKEN`** et **`APP_KEY`** (même valeur que `BGG_APP_KEY` dans `js/secrets.js`),
  puis **déployer la fonction `bgg`**. La recherche de jeux et le bouton « Synchroniser » marcheront alors en direct.

### Idées validées en principe, non lancées
- **Scan de la feuille de score** (photo du carnet → scores pré-remplis, à vérifier avant d'enregistrer), avec une case
  « Feuille de score » sur les jeux compatibles. Lecture sur l'iPhone, sans envoi. La lecture de la piste de score
  ou des cartes posées sur la table a été jugée peu fiable pour l'instant.
- Masquer complètement la colonne des scores quand aucun score n'est saisi (fait sur la fiche partie ; à étendre si besoin).

### Feuille de route (non commencé)
- **Records et séries** (lot 2) : non demandés pour l'instant.
- **Lot 3** : saisie hors-ligne (file d'attente), notifications (nouvelle partie, record battu).
- Statut « invitation en attente / activé » et date de dernière ouverture dans Plus → Comptes.

### Pour l'App Store (étape 2)
- Captures d'écran, fiche, compte de démo (un iCloud de test invité dans un groupe de démo).
- La « suppression de compte » demandée par Apple = Plus → Quitter / Supprimer le groupe.

### Échéance technique
- **Avril 2027** : Apple exigera le SDK iOS 27 → mettre Xcode à jour avant tout nouvel envoi.

---

## 7. Décisions prises

| Date | Décision |
| --- | --- |
| 23/11/2026 | Le **lieu** des parties est retiré de l'interface (la colonne reste en base Supabase) |
| 25/11/2026 | Durée par défaut des parties : **ne rien changer** (pas de durée BGG imposée) |
| 24/11/2026 | Renommage en **C-Party** (dépôt, URL et Bundle ID inchangés) |
| 24/11/2026 | App iPhone native via Capacitor ; **TestFlight d'abord, App Store ensuite** ; la PWA reste en ligne |
| 24/11/2026 | **Quitter Supabase pour iCloud** (sauf le relais BGG) ; plus de mots de passe ni d'e-mails |
| 24/11/2026 | Le site web ne garde que le **mode démo** ; Supabase reste en archive figée jusqu'au feu vert de Cédric |
| 24/11/2026 | Photos : gestionnaires seulement ; conservées si la partie est supprimée, effacées avec un jeu supprimé ; pas de photos côté Supabase |
| 25/11/2026 | Lot 2 : Elo, indice, face-à-face, némésis **expliqués dans l'app** ; filtres OK ; **jeux délaissés : ne rien changer** ; records et séries : plus tard |
| 25/11/2026 | BGG : **bouton « Synchroniser »** manuel (une synchronisation automatique en arrière-plan est impossible avec iCloud) |
| 26/11/2026 | Import du **fichier CSV de collection BGG** en attendant l'API (conservé ensuite comme solution de secours) |
| 26/11/2026 | Scan des scores : partir, le moment venu, sur la **feuille de score**, pas sur la photo de la table |
| 26/11/2026 | Interface : **style A** (iOS soigné) ; le classement complet passe sur son propre écran |

---

## 8. Méthode de travail

- **Tester en local** : `python3 -m http.server 8765`, puis http://localhost:8765/?demo (mode démo).
- **Avant une mise en ligne** : vérifier en démo, incrémenter `VERSION` dans `sw.js` et `js/app.js`, lancer les tests.
- **App iPhone** : `cd app-ios && npm run sync`, augmenter le numéro de build (`CURRENT_PROJECT_VERSION`), archiver puis
  envoyer sur App Store Connect (en ligne de commande avec `xcodebuild`, ou depuis Xcode).
- **CloudKit** : en développement, les types d'enregistrement se créent seuls ; **avant tout envoi TestFlight** qui ajoute
  un type ou un champ, déployer le schéma en Production (CloudKit Console → Deploy Schema Changes).
- Le simulateur n'a pas de compte iCloud par défaut : s'y connecter dans ses Réglages.
- **Jamais dans Git** : `js/secrets.js`, `export/`.
- Envoi sur GitHub et TestFlight : uniquement avec le feu vert de Cédric.
