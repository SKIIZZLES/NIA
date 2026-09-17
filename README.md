# NIA

**VIDÉOS · CULTURES · TALENTS · SANS FRONTIÈRES**

Application mobile de vidéos verticales courtes centrée sur les contenus, cultures et talents africains.

- Stack : **Expo SDK 57** · **TypeScript** · **Expo Router** · **expo-av**
- Cibles : App Store & Google Play via **EAS**
- Brand board : `assets/brand/nia-brand-board.png`

## Prérequis

- Node.js 20.19.4+ (20.19.2 fonctionne avec des warnings moteurs)
- npm 9+
- Compte Expo (pour EAS)

## Installation & lancement

```bash
cd /workspace/NIA
cp .env.example .env   # optionnel pour le MVP
npm install
npx expo start
```

Puis scanner le QR avec Expo Go (iOS/Android), ou :

```bash
npx expo start --web
npx expo start --android
npx expo start --ios
```

### Vérification TypeScript

```bash
npx tsc --noEmit
```

## Architecture

```
app/
  index.tsx              # Auth gate (redirect)
  welcome.tsx            # Splash / bienvenue
  (auth)/login|register  # Auth mock MVP
  (tabs)/                # Accueil, Recherche, +, Messages, Profil
components/              # VideoCard, FeedPager, Button, NiaWordmark
constants/theme.ts       # Tokens Noir / Terre / Or / Sable / Vert
context/                 # AuthContext, FeedContext
data/mockVideos.ts       # Feed démo
assets/brand/            # Brand board de référence
```

- **Auth** : mock locale via AsyncStorage (`AuthContext`). Badge « AUTH MOCK MVP ».
- **Feed** : pager vertical plein écran, onglets Pour toi | Abonnements | Afrique | Découvrir.
- **Création** : ImagePicker + publication dans l’état local du feed.
- **Thème** : dark brand (`constants/theme.ts`), typo **Plus Jakarta Sans**.

Prêt pour un futur backend **Supabase** (Auth + Storage) — voir `.env.example`.

## EAS (stores)

Fichier stub : `eas.json`.

1. `npm i -g eas-cli` puis `eas login`
2. `eas init` — remplacer `extra.eas.projectId` dans `app.json`
3. Builds :
   - Preview APK : `eas build -p android --profile preview`
   - Production : `eas build -p all --profile production`
4. Soumission : `eas submit -p ios|android --profile production`

Configurer `ios.bundleIdentifier` / `android.package` (`app.nia.mobile`) et les identifiants Apple / Play dans `eas.json`.

## Prochaines étapes

1. Remplacer l’auth mock par **Supabase Auth**
2. CDN vidéo (Mux / Cloudflare Stream / Supabase Storage)
3. Upload réel depuis l’écran Créer
4. Messagerie & recherche backend
5. Icônes / splash brand (logo NIA avec A-continent)
6. Analytics & moderation

## Licence

Projet privé NIA — voir `LICENSE` du template si applicable.
