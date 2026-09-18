# Google Sign-In — NIA (Expo 57 + EAS)

## Choix technique

**`@react-native-google-signin/google-signin` + `supabase.auth.signInWithIdToken`**

Pourquoi (vs Expo AuthSession / OAuth redirect) :

- Approche **recommandée par Supabase** pour React Native / Expo.
- Flux **natif** Android (Credential Manager / Play Services) — plus fiable sur APK EAS preview/production qu’un redirect navigateur.
- Pas de dépendance à une redirect URI deep-link fragile (`nia://…`) pour le token.
- **Nécessite un build natif EAS** (development ou preview) — **ne fonctionne pas dans Expo Go**.

En mode mock (Expo Go ou env Supabase absentes), le bouton crée une **session locale** pour ne pas bloquer la démo UI.

## Flux dans l’app

1. L’utilisateur tape **Continuer avec Google** (welcome / login / register).
2. `GoogleSignin.configure({ webClientId })` puis `GoogleSignin.signIn()`.
3. L’`idToken` Google est envoyé à Supabase : `signInWithIdToken({ provider: 'google', token })`.
4. `AuthContext` crée / enrichit la ligne `profiles` (nom, avatar Google) si besoin — le trigger SQL `handle_new_user` couvre déjà l’insert à la création du user Auth.

## Étapes Google Cloud Console

Projet Google Cloud à utiliser : **NIA APP** (nom exact).

1. Ouvrir [Google Cloud Console](https://console.cloud.google.com/) → sélectionner le projet **NIA APP** (ou le créer avec ce nom exact).
2. **APIs & Services** → **OAuth consent screen** (External / Testing OK pour MVP).
3. **Credentials** → **Create OAuth client ID** :

### A. Web application (obligatoire)

- Type : **Web application**
- Authorized redirect URIs :  
  `https://odlmbiaocdonlovjepxn.supabase.co/auth/v1/callback`
- Copier le **Client ID** → `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`  
  (c’est ce Client ID Web qui sert de `webClientId` côté app, y compris sur Android)

### B. Android (obligatoire pour APK)

- Type : **Android**
- Package name : `app.nia.mobile`
- **SHA-1** du keystore qui signe l’APK :
  - EAS : `eas credentials` → Android → fingerprint SHA-1  
  - Ou : `keytool -list -v -keystore …`
- Copier le Client ID → `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID` (doc / dashboard ; le runtime utilise surtout le **Web** client ID)

### C. iOS (quand vous builderez iOS)

- Type : **iOS**
- Bundle ID : `app.nia.mobile`
- Copier le Client ID → `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`
- **Reversed client ID** (ex. `com.googleusercontent.apps.123456-abc`) → remplacer le placeholder `iosUrlScheme` dans `app.json` (plugin `@react-native-google-signin/google-signin`)

## Étapes Supabase Dashboard

1. **Authentication → Providers → Google** → Enable.
2. **Client IDs** : coller le Web Client ID (et Android/iOS séparés par des virgules si demandé).
3. **Client Secret** : secret du client **Web** Google.
4. Pour le MVP Expo / Android idToken : activer **Skip nonce check** (le module Original Google Sign-In ne passe pas toujours un nonce compatible iOS/Android).
5. Vérifier que le callback  
   `https://odlmbiaocdonlovjepxn.supabase.co/auth/v1/callback`  
   est bien listé côté Google (client Web).

## Variables EAS à définir

Sur le projet Expo / EAS Secrets (ou `eas.json` env) pour **preview** et **production** :

| Variable | Valeur |
|----------|--------|
| `EXPO_PUBLIC_SUPABASE_URL` | `https://odlmbiaocdonlovjepxn.supabase.co` |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | anon / publishable key |
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` | Client ID **Web** |
| `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID` | Client ID **Android** (doc) |
| `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` | Client ID **iOS** (optionnel) |

Puis **nouveau build natif** :

```bash
eas build --profile preview --platform android
```

## Nouveau build EAS requis ?

**Oui.**  
`@react-native-google-signin/google-signin` ajoute du code natif + config plugin (`iosUrlScheme`). Un APK déjà publié **sans** ce module ne pourra pas ouvrir le sheet Google. Après changement de SHA-1 / package, mettre à jour aussi Google Cloud.

## Mitigations Android conservées

- Metro : shims `ws` / `stream` / `zlib` + stub `@supabase/realtime-js` (pas de remplacement total de `@supabase/supabase-js`).
- `ErrorBoundary` dans `app/_layout.tsx`.
- Pas de `newArchEnabled` dans `app.json`.
- Pas de `expo-av` (lecture via `expo-video`).
- Expo Go → auth mock ; EAS avec env → Supabase réel.
