# NIA

**VIDÉOS · CULTURES · TALENTS · SANS FRONTIÈRES**

Application mobile de vidéos verticales courtes centrée sur les contenus, cultures et talents africains.

- Stack : **Expo SDK 57** · **TypeScript** · **Expo Router** · **expo-video** · **Supabase** (optionnel)
- Cibles : App Store & Google Play via **EAS**
- Brand board : `assets/brand/nia-brand-board.png`

## Android preview note

- EAS preview/production : Supabase réel si `EXPO_PUBLIC_SUPABASE_*` sont définies (Expo Go reste en auth mock).
- Google Sign-In : `@react-native-google-signin/google-signin` + `signInWithIdToken` — voir **GOOGLE_AUTH.md** (projet Google Cloud **NIA APP**). Nouveau build EAS requis.
- Snapchat Login : OAuth Login Kit (`expo-auth-session`) + Edge Function `snapchat-auth` — voir **SNAPCHAT_AUTH.md** (kit.snapchat.com). Rebuild EAS en général **non** requis si scheme `nia` déjà présent.
- Video playback uses **`expo-video`** (SDK 57); `expo-av` is not used.

---



## Internationalisation

- Stack légère : **`expo-localization`** + **`i18n-js`**. Chaînes dans `locales/*.ts` ; helper `lib/i18n.ts` + `context/I18nContext.tsx`.
- **Langues supportées (20)** :
  - Europe / internationales : **FR**, **EN**, **ES**, **PT**
  - Est / Sahel / Afrique du Nord : **SW** (swahili), **HA** (haoussa), **Darija** (`ar-MA`), **SD** (`ar-SD` soudanais), **EG** (`ar-EG` égyptien), **AM** (amharique)
  - Afrique de l’Ouest (MVP haute portée) : **YO** (yoruba), **ZU** (zoulou), **WO** (wolof), **LN** (lingala), **IG** (igbo), **FF** (fulfulde), **BM** (bambara), **AK** (akan/twi), **MNK** (mandinka / mandingue), **DYO** (diola / jola-fonyi)
- **Note** : « toutes les langues d’Afrique de l’Ouest » n’est **pas** couvert — ce pack est un **MVP haute portée**. D’autres langues s’ajoutent en copiant un fichier `locales/xx.ts` (mêmes clés que `fr.ts`) puis en l’enregistrant dans `lib/i18n.ts` / `APP_LOCALES`.
- Sélecteur **dropdown** (Pressable → Modal + FlatList) avec noms complets (**Français**, **English**, **Wolof**, **Mandingue**, **Diola**, **Darija**, …) — Welcome / Profil ; persisté AsyncStorage `@nia/locale`.
- Défaut appareil : `fr*` / `en*` / `es*` / `pt*` / `sw*` / `ha*` / `yo*` / `zu*` / `am*` / `wo*` / `ln*` / `ig*` / `ff*`/`fuf*`/`ful*` / `bm*` / `ak*`/`tw*` / `mnk*` / `dyo*` ; pour `ar*` → Maghreb = Darija, `SD` = soudanais, `EG` = égyptien, sinon Darija ; sinon **français**.
- **RTL** : chaînes arabes (Darija / SD / EG) et amharique affichées ; layout reste **LTR** (pas de `I18nManager.forceRTL`) pour ne pas casser le feed vidéo vertical. L’amharique (Ge’ez) est déjà LTR. RTL natif possible plus tard si le layout est adapté.
- Pour ajouter une langue : créer `locales/xx.ts` (mêmes clés que `fr.ts`), l’enregistrer dans `lib/i18n.ts`, étendre `APP_LOCALES` et les labels `language.*`.
- Plugin `expo-localization` dans `app.json` → déjà présent ; **pas de nouveau build EAS** requis pour ces locales JS (rebuild seulement si vous activez RTL natif / changez des plugins natifs).


## Expo Go Android / iOS (important)

Sur **Expo Go** uniquement (`Constants.executionEnvironment === StoreClient` ou `appOwnership === 'expo'`), Supabase est **désactivé** → auth **mock**, même si `.env` contient des clés. Metro **ne remplace plus** `@supabase/supabase-js` sur android/ios (sinon les builds EAS n’auraient plus d’auth réelle) : shims `ws` / `zlib` / `stream`, et stub optionnel `@supabase/realtime-js` seulement. `shims/supabase-js-native.js` reste dans le repo mais **n’est pas** branché par Metro.

- **Mock auth (Expo Go)** : `npx expo start` → scanner le QR → badge **AUTH MOCK MVP**
- **Supabase réel** : `npx expo start --web`, ou **EAS preview / production** (APK/IPA standalone) avec secrets `EXPO_PUBLIC_SUPABASE_*`
- Après `git pull` : `npx expo start -c`

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

Puis scanner le QR avec Expo Go (auth **mock**), ou `npx expo start --web` (Supabase réel si `.env` rempli).

### Vérification TypeScript

```bash
npx tsc --noEmit
```


## Démo investisseur

Objectif : MVP crédible à **0 €** (Expo + Supabase Free), UI française Afro-Tech.

### Checklist Sprint 1

- [x] Auth mock **ou** Supabase (signup → login → logout)
- [x] Feed vertical (Pour toi / Abonnements / Afrique)
- [x] Like, commentaires, follow
- [x] Publier (mock local ou Storage) + profil public
- [x] Signaler (spam, harcèlement, contenu illégal, autre)
- [x] Bloquer un utilisateur (filtre hors du feed)
- [x] Partage natif (Share API) + empty/error states FR
- [x] Pas de crash si Supabase offline (messages FR / fallback mock)

### Mode mock (sans backend)

```bash
cp .env.example .env   # laisser EXPO_PUBLIC_SUPABASE_* vides
npm install
npx expo start
```

1. Créer un compte (auth mock AsyncStorage).
2. Accueil → swipe le feed démo.
3. **+** → choisir média → légende / #tags / catégorie → Publier (local).
4. Liker, ouvrir commentaires, follow depuis le rail.
5. Ouvrir un profil (`@handle`) → Bloquer / Signaler (toast démo).
6. Partager via le bouton share (Share API native).
7. Profil → se déconnecter.

### Mode Supabase Free

1. Remplir `.env` avec URL + anon key (ne jamais committer `.env`).
2. Exécuter `supabase/migrations/001_*.sql` puis `002_*.sql` dans le SQL Editor.
3. Auth → Email : désactiver « Confirm email » pour la démo.
4. Redémarrer Metro (`npx expo start -c`).
5. Même parcours : compte réel → publier (Storage) → like / comment / follow → signaler / bloquer (tables `reports` / `blocks`).

Si Supabase est down : l’app bascule sur le feed démo + toasts FR, **sans crash**.

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
  reports.ts / blocks.ts / share.ts
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
- **Durée max vidéo** : `MAX_VIDEO_DURATION_SEC` = **600 s (10 min)** dans `constants/publish.ts` (picker + validation). Pas de transcoder payant ; les longues vidéos consomment plus de Storage / bande passante sur **Supabase Free**.
- **Engagement** : likes persistés (`likes` + optimistic UI), helpers comments/follows/notifications prêts ; Découvrir filtre `videos.category`.
- **Nav** : Accueil · Découvrir · Publier (+) · Notifications · Profil (Messages = phase 2).
- **Thème** : dark brand, typo **Plus Jakarta Sans**, UI en français.
- **Budget** : 0 € — Expo + Supabase Free pour la démo investisseur.

## EAS (stores)

Fichier : `eas.json` (profil **preview** → APK Android `buildType: apk`).  
`app.json` : `"owner": "nia-corp"` ; `extra.eas.projectId` est un placeholder — lancer `eas init` pour le lier (ne pas inventer d’UUID).

### EAS Android preview

```bash
npm i -g eas-cli
cd NIA
git pull
npm install
npx expo login   # compte nia-corp
eas init         # lie le projectId si pas encore fait
eas build:configure
# secrets (ne pas committer):
eas secret:create --scope project --name EXPO_PUBLIC_SUPABASE_URL --value https://odlmbiaocdonlovjepxn.supabase.co
eas secret:create --scope project --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value <anon>
eas build -p android --profile preview
```

Puis installer l’APK depuis le lien du dashboard Expo.

## Après le MVP (hors scope Sprint 1)

1. ~~Étapes 1–7~~ ✅ nav, schéma, engagement UI, publish, profils, signalement/blocage, démo investisseur
2. OAuth Apple / Google
3. Transcoding CDN si besoin (Mux / Cloudflare Stream)
4. Messagerie (phase 2) · lives · marketplace · tips / ads
5. Modération IA / back-office reviews

## Licence

Projet privé NIA — voir `LICENSE` du template si applicable.
