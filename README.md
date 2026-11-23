# NosSoireesJeu — guide d'installation (lot 1)

Web app installable sur iPhone pour enregistrer les parties de jeux de société.
Coût : 0 €. Durée de mise en place : environ 1 heure.

```
index.html, css/, js/, icons/, manifest.webmanifest, sw.js   → l'application (GitHub Pages)
supabase/schema.sql                                            → la base de données
supabase/functions/bgg/                                         → relais BoardGameGeek
supabase/functions/invite/                                      → invitations par e-mail
```

**Essayer sans rien installer :** ouvre `index.html` via n'importe quel petit serveur web.
Tant que `js/config.js` est vide, l'app tourne en **mode démo** avec des données fictives.

---

## Étape 1 — Supabase (base de données et comptes)

1. Crée un compte sur [supabase.com](https://supabase.com), puis **New project**.
   Choisis la région **West EU (Ireland)** ou **Central EU (Frankfurt)** et note le mot de passe de la base.
2. Menu **SQL Editor** → **New query** : colle tout le contenu de `supabase/schema.sql` → **Run**.
   Le message attendu est « Success. No rows returned ».
3. Menu **Authentication** :
   - **Sign In / Providers** → laisse **Email** activé et **désactive « Allow new users to sign up »**.
     Seules les invitations créeront des comptes.
   - **Emails → SMTP Settings** : active un SMTP personnalisé (voir étape 4), sinon aucune invitation ne partira.
   - **URL Configuration** → **Site URL** = l'adresse GitHub Pages de l'étape 3
     (ex. `https://ton-pseudo.github.io/nossoireesjeu/`). Ajoute la même adresse dans **Redirect URLs**.
4. **Crée ton propre compte** : **Authentication → Users → Add user → Create new user**,
   avec ton e-mail et un mot de passe, et coche « Auto Confirm User ».
   Le premier compte créé devient automatiquement **gestionnaire**.
5. **Project Settings → API** : copie le **Project URL** et la clé **anon / publishable**,
   puis colle-les dans `js/config.js` :

   ```js
   export const CONFIG = {
     SUPABASE_URL: "https://xxxxxxxx.supabase.co",
     SUPABASE_ANON_KEY: "eyJ...",   // ou "sb_publishable_..."
   };
   ```
   Cette clé est publique par conception. La sécurité repose sur les règles d'accès définies dans `schema.sql`.

## Étape 2 — Jeton BoardGameGeek et fonctions serveur

1. Sur [boardgamegeek.com/applications](https://boardgamegeek.com/applications), connecte-toi
   et enregistre une application (usage non commercial, « NosSoireesJeu »). Une fois l'application validée par BGG,
   tu obtiens un **jeton** (token).
   *En attendant, tu peux ajouter tes jeux en saisie manuelle.*
2. Installe l'outil Supabase sur ton Mac (Terminal) :
   ```bash
   brew install supabase/tap/supabase
   supabase login
   ```
3. Dans le dossier du projet :
   ```bash
   supabase link --project-ref xxxxxxxx          # l'identifiant visible dans l'URL du projet
   supabase secrets set BGG_TOKEN=ton_jeton_bgg
   supabase functions deploy bgg
   supabase functions deploy invite
   ```
   Sans terminal, tu peux aussi passer par **Edge Functions → Deploy a new function → Via Editor** :
   crée `bgg` puis `invite`, colle le contenu de chaque `index.ts`, et ajoute `BGG_TOKEN`
   dans **Edge Functions → Secrets**.

## Étape 3 — Mise en ligne sur GitHub Pages

1. Crée un dépôt GitHub (public ou privé avec un compte payant), par exemple `nossoireesjeu`.
2. Dépose-y tous les fichiers (sauf le dossier `supabase/` si tu préfères, il n'est pas nécessaire en ligne).
3. **Settings → Pages** → Source : **Deploy from a branch** → branche `main`, dossier `/ (root)` → **Save**.
4. L'adresse s'affiche après une minute : `https://ton-pseudo.github.io/nossoireesjeu/`.
   Reporte-la dans Supabase (étape 1.3) si ce n'est pas déjà fait.

> À chaque nouvelle version, change `VERSION` dans `sw.js` pour que les iPhone se mettent à jour.

## Étape 4 — Sur l'iPhone

1. Ouvre l'adresse dans **Safari**, connecte-toi.
2. Bouton **Partager** → **Sur l'écran d'accueil** → **Ajouter**.
3. Dans **Plus → Comptes**, invite les autres personnes. Pour chacune, choisis le rôle (gestionnaire ou joueur)
   et, si tu veux, la fiche joueur à laquelle la relier. Chaque personne reçoit un e-mail pour choisir son mot de passe.

> **Important :** sans serveur d'envoi personnalisé, Supabase n'envoie les e-mails qu'aux membres de l'équipe du projet,
> et au maximum 2 par heure. Les invitations aux autres personnes ne partiraient donc pas.
> Configure un SMTP personnalisé (ex. Gmail : Authentication → Emails → Custom SMTP, hôte `smtp.gmail.com`, port 587,
> mot de passe d'application Google), ou crée les comptes à la main dans Authentication → Users → Add user.

## Étape 5 — Importer la ludothèque

**Jeux → icône d'import** → saisis ton pseudo BGG. Vérifie que tes jeux sont marqués « possédés » (Own) dans ta collection BGG.
La première demande peut prendre une minute, le temps que BGG prépare la collection.
Contrôle ensuite les noms français proposés : BGG n'indique pas la langue de ses noms, ils sont donc devinés.

---

## Ce que contient le lot 1

- Comptes sur invitation, avec deux rôles : **gestionnaire** (saisie) et **joueur** (consultation).
- Ludothèque : import de la collection BGG, recherche BGG, saisie manuelle, extensions rattachées au jeu de base,
  statut (possédé, joué ailleurs, prêté à…), mode par défaut et règle de score par jeu.
- Parties en quatre modes (compétitif, équipes, coopératif, solo) : classement déduit des scores, égalités possibles,
  départage manuel, case « apprentissage », lieu, durée, commentaire.
- Modification et suppression avec **historique** (qui, quand, quoi), journal des suppressions et restauration.
- Tableaux de bord : global (par période), par jeu, par joueur. Les indicateurs calculés sur moins de 3 parties sont grisés.

À venir : **lot 2** (Elo, némésis et duels, records et séries, jeux délaissés, filtres par type et nombre de joueurs),
puis **lot 3** (saisie hors-ligne, notifications, carte résultat, export CSV/JSON, réveil automatique et sauvegarde).

## Dépannage

| Symptôme | Cause probable |
| --- | --- |
| « Jeton BGG refusé » | Le secret `BGG_TOKEN` est absent ou erroné ; refais `supabase secrets set` puis redéploie `bgg`. |
| Le lien d'invitation ouvre une page vide | La **Site URL** ou les **Redirect URLs** de Supabase ne correspondent pas à l'adresse GitHub Pages. |
| « permission denied for table … » | `schema.sql` n'a pas été exécuté en entier : relance-le, sans risque pour les données. |
| L'app ne se met pas à jour sur l'iPhone | Change `VERSION` dans `sw.js`, puis ferme et rouvre l'app. |
| Projet Supabase « Paused » | Plus de 7 jours sans activité (plan gratuit). Clique sur **Resume project**. Le lot 3 automatisera ce réveil. |

Données de jeux : BoardGameGeek, usage non commercial.
