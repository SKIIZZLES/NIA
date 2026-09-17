# NIA

**VIDÉOS · CULTURES · TALENTS · SANS FRONTIÈRES**

Application mobile de vidéos verticales courtes centrée sur les contenus, cultures et talents africains.

- Stack : **Expo SDK 57** · **TypeScript** · **Expo Router** · **expo-av** · **Supabase** (optionnel)
- Cibles : App Store & Google Play via **EAS**
- Brand board : `assets/brand/nia-brand-board.png`

## Prérequis

- Node.js 20.19.4+ (20.19.2 fonctionne avec des warnings moteurs)
- npm 9+
- Compte Expo (pour EAS)
- (Optionnel) Projet gratuit [Supabase](https://supabase.com)

## Installation & lancement (mode mock, sans backend)

Sans `.env` (ou avec URL / clé vides), l’app tourne **offline** : auth mock + feed démo.

```bash
cd NIA
cp .env.example .env   # laisser les clés Supabase vides
npm install
npx expo start
```

Puis scanner le QR avec Expo Go, ou `npx expo start --web`.

### Vérification TypeScript

```bash
npx tsc --noEmit
```

## Brancher Supabase (~10 minutes)

### 1. Créer un projet

1. Aller sur [https://supabase.com](https://supabase.com) → **New project** (plan Free).
2. Noter la région proche de votre audience.
3. Attendre que le projet soit **Healthy**.

### 2. Récupérer les clés

**Project Settings → API** :

| Variable | Où |
|----------|-----|
| `EXPO_PUBLIC_SUPABASE_URL` | Project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | `anon` `public` key |

Coller dans `.env` (ne jamais committer `.env`) :

```bash
EXPO_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...
```

Redémarrer Metro (`npx expo start -c`) pour charger les env.

### 3. Exécuter le SQL (001 puis 002)

1. Dashboard → **SQL Editor** → New query.
2. Coller le contenu de `supabase/migrations/001_nia_init.sql` → **Run**.
3. Nouvelle query → coller `supabase/migrations/002_sprint1_engagement.sql` → **Run**.

**001** crée :

- tables `profiles` + `videos` + RLS
- trigger profil à l’inscription (`handle_new_user`)
- bucket Storage `videos` (lecture publique, upload authentifié dans `{user_id}/…`)

**002** ajoute :

- colonnes `profiles.display_name`, `videos.thumbnail_url` / `status` / `category` / `hashtags`
- tables `likes`, `comments`, `follows`, `notifications`, `reports`, `blocks` + RLS
- triggers `like_count` + stubs notifications (like / comment / follow)

### 4. (Optionnel) Vérifier le bucket

**Storage** → bucket `videos` doit exister et être **Public**.  
Si le SQL n’a pas créé le bucket (droits), créez-le manuellement nommé `videos`, Public = ON, puis relancez uniquement les policies `storage.objects` du fichier SQL.

### 5. Auth email facile à tester

**Authentication → Providers → Email** :

- Activer Email.
- Pour le MVP : **désactiver** « Confirm email » (sinon l’inscription exige un mail de confirmation).

### 6. Tester dans l’app

1. Badge **AUTH SUPABASE** sur login / inscription (vert).
2. Créer un compte → un row apparaît dans `profiles`.
3. Onglet **Créer** → choisir une vidéo / image → **Publier**.
4. Fichier dans Storage `videos/{user_id}/…` + row dans `videos`.
5. Feed recharge les vidéos distantes (sinon garde les démos si table vide / erreur réseau).

## Architecture

```
app/
  (auth)/login|register   # Auth mock ou Supabase
  (tabs)/                 # Accueil, Découvrir, +, Notifications, Profil
lib/
  supabase.ts             # Client (null si env manquantes)
  videos.ts               # list + upload + filtre category
  likes.ts / comments.ts / follows.ts / notifications.ts
constants/categories.ts   # IDs Découvrir (= videos.category)
supabase/migrations/      # 001 puis 002 dans le SQL Editor
docs/SCHEMA_SPRINT1.md    # Modèle données Sprint 1 (statut à jour)
context/                  # AuthContext, FeedContext
constants/theme.ts        # Tokens Noir / Terre / Or / Sable / Vert
data/mockVideos.ts        # Feed démo (fallback)
```

- **Auth** : Supabase si `EXPO_PUBLIC_SUPABASE_URL` + `ANON_KEY` ; sinon mock AsyncStorage.
- **Session** : SecureStore (natif, petites valeurs) + AsyncStorage (web / JWT longs).
- **Feed / Créer** : lecture `videos` + upload Storage quand configuré ; sinon mock local.
- **Engagement** : likes persistés (`likes` + optimistic UI), helpers comments/follows/notifications prêts ; Découvrir filtre `videos.category`.
- **Nav** : Accueil · Découvrir · Publier (+) · Notifications · Profil (Messages = phase 2).
- **Thème** : dark brand, typo **Plus Jakarta Sans**, UI en français.
- **Budget** : 0 € — Expo + Supabase Free pour la démo investisseur.

## EAS (stores)

Fichier stub : `eas.json`.

1. `npm i -g eas-cli` puis `eas login`
2. `eas init` — remplacer `extra.eas.projectId` dans `app.json`
3. Builds preview / production via profils `eas.json`
4. Définir aussi les secrets EAS `EXPO_PUBLIC_SUPABASE_*` pour les builds stores

## Prochaines étapes (Étape 3+)

1. ~~Migration 002 + helpers likes/comments/follows + Découvrir par category~~ ✅ Étape 2
2. Brancher un vrai projet Supabase (`.env`) + auth email réelle (Étape 3)
3. UI commentaires / boutons follow profil / notifications riches (Étapes 4–6)
4. OAuth Apple / Google
5. Transcoding CDN si besoin (Mux / Cloudflare Stream)
6. Messagerie (phase 2) · icônes / splash brand · analytics

## Licence

Projet privé NIA — voir `LICENSE` du template si applicable.
