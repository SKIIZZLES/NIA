# Snapchat Login — NIA (Expo 57 + EAS + Supabase)

## Choix technique

**OAuth 2.0 Login Kit (PKCE) via `expo-auth-session` + Edge Function `snapchat-auth`**

Pourquoi (vs SDK natif Snap Kit / `signInWithIdToken`) :

- Snap **déprécie** les anciens SDK Login Kit ; le service **OAuth 2.0** reste la voie officielle ([docs Snap](https://developers.snap.com/snap-kit/login-kit/overview)).
- Supabase **n’a pas** de provider Snapchat → pas de `signInWithIdToken({ provider: 'snapchat' })`.
- `expo-auth-session` + `expo-web-browser` = flux navigateur / Custom Tabs **sans module natif Snap** → compatible APK EAS preview si le **scheme** `nia` est déjà dans le binaire.
- Le **client secret** Snap reste **uniquement** côté Edge Function (jamais dans `EXPO_PUBLIC_*`).

### Flux MVP

1. L’utilisateur tape **Continuer avec Snapchat** (welcome / login / register).
2. L’app ouvre `https://accounts.snapchat.com/accounts/oauth2/auth` (PKCE, scopes display_name + external_id + bitmoji).
3. Redirect deep-link : `nia://snapchat-auth` (scheme déjà dans `app.json`).
4. L’app envoie `{ code, code_verifier, redirect_uri }` à  
   `{EXPO_PUBLIC_SUPABASE_URL}/functions/v1/snapchat-auth`.
5. La fonction :
   - échange le code contre un `access_token` Snapchat ;
   - appelle `POST https://kit.snapchat.com/v1/me` ;
   - crée / trouve un user Auth avec email `snapchat_{externalId}@users.nia.app` ;
   - renvoie `access_token` + `refresh_token` Supabase ;
6. Le client fait `supabase.auth.setSession(...)` et enrichit `profiles`.

En **mode mock** (Expo Go / env Supabase absentes), le bouton crée une **session locale** pour la démo UI (comme Google).

Si `EXPO_PUBLIC_SNAP_CLIENT_ID` ou la fonction manquent en mode Supabase réel, l’UI affiche clairement :  
**« Configure Snap Kit + deploy function »**.

## Ce que vous devez créer sur kit.snapchat.com

Portail gratuit : [https://kit.snapchat.com](https://kit.snapchat.com) (Snap Kit Developer Portal).

1. Créer une organisation / se connecter avec un compte Snapchat.
2. **Create App** — nom suggéré : **NIA APP** ou **nia mobile**.
3. Activer **Login Kit** pour une version (Staging d’abord).
4. Noter :
   - **OAuth Client ID** → `EXPO_PUBLIC_SNAP_CLIENT_ID` (EAS / `.env`)
   - **OAuth Client Secret** → secret Edge Function `SNAP_CLIENT_SECRET` (**jamais** dans Expo public)
5. **Redirect URIs** (exactes, une par ligne) — au minimum :

   ```text
   nia://snapchat-auth
   ```

   En développement Expo (optionnel, si vous testez hors APK) :

   ```text
   exp://127.0.0.1:8081/--/snapchat-auth
   ```

   Affichez l’URI réelle au runtime via `getSnapchatRedirectUri()` (`lib/snapchatAuth.ts`) et **copiez-la telle quelle** dans le portail. Une virgule / slash en trop casse le flux.

6. **Scopes** à activer pour la version Login Kit :
   - `https://auth.snapchat.com/oauth2/api/user.display_name`
   - `https://auth.snapchat.com/oauth2/api/user.external_id`
   - `https://auth.snapchat.com/oauth2/api/user.bitmoji.avatar` (optionnel, toggleable par l’utilisateur)

7. Package Android / Bundle iOS (si le portail le demande) : `app.nia.mobile`.

8. Passez la version en **Production** quand Staging est validé (review Snap possible).

## Variables d’environnement

### Client (EAS Secrets / `.env`)

| Variable | Où | Valeur |
|----------|-----|--------|
| `EXPO_PUBLIC_SNAP_CLIENT_ID` | EAS + `.env` | OAuth Client ID Snap |
| `EXPO_PUBLIC_SUPABASE_URL` | déjà requis | URL projet |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | déjà requis | anon key |
| `EXPO_PUBLIC_SNAPCHAT_AUTH_URL` | optionnel | override URL fonction (sinon `{SUPABASE_URL}/functions/v1/snapchat-auth`) |

### Edge Function (secrets serveur uniquement)

```bash
supabase secrets set SNAP_CLIENT_ID=... SNAP_CLIENT_SECRET=...
```

`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` sont injectés automatiquement sur le projet hébergé.

## Déployer l’Edge Function

Code versionné : `supabase/functions/snapchat-auth/index.ts`.

```bash
# CLI Supabase liée au projet odlmbiaocdonlovjepxn (ou le vôtre)
supabase login
supabase link --project-ref odlmbiaocdonlovjepxn
supabase secrets set SNAP_CLIENT_ID=... SNAP_CLIENT_SECRET=...
supabase functions deploy snapchat-auth --no-verify-jwt
```

`--no-verify-jwt` : le client envoie l’anon key ; la fonction n’exige pas de JWT utilisateur (l’utilisateur n’est pas encore connecté).

Sans accès deploy CLI, le code reste dans le repo — l’app client est complète et remontera l’erreur de configuration jusqu’au déploiement.

## Nouveau build EAS requis ?

**En général non** pour ce MVP AuthSession :

- Pas de module natif Snap Kit.
- `expo-auth-session` / `expo-web-browser` / `expo-crypto` sont déjà dans la stack SDK 57.
- Le scheme deep-link **`nia`** est déjà dans `app.json`.

**Oui**, rebuild si :

- l’APK installé a été buildé **sans** `scheme: "nia"` ;
- vous changez le scheme / path de redirect ;
- vous ajoutez plus tard le SDK natif Snap (non recommandé ici).

Après ajout des secrets EAS `EXPO_PUBLIC_SNAP_*`, un rebuild **preview** est quand même utile pour embarquer les env (ou utilisez EAS Update si vous ne changez que du JS + env runtime).

```bash
eas build --profile preview --platform android
```

## Limites / blockers honnêtes

| Point | Statut |
|-------|--------|
| OAuth Snap + PKCE via navigateur | Implémenté côté client |
| Session Supabase | Dépend du **déploiement** de `snapchat-auth` + secrets |
| Compte Snap Kit | À créer par vous (gratuit) sur kit.snapchat.com |
| Review Snap « Production » | Peut retarder le login réel hors Staging |
| Redirect custom scheme | Doit être accepté tel quel par le portail ; si Snap refuse `nia://…`, basculer vers une URL HTTPS (Universal Link / page intermédiaire) — documenté comme fallback |
| `listUsers` / createUser dans la fonction | MVP OK ; à durcir (index email / table `snapchat_identities`) si volume |

**Ne pas** simuler un login Snapchat « qui marche » sans Client ID + fonction déployée : le bouton affiche l’erreur de config.

## Fichiers touchés

- `lib/snapchatAuth.ts` — OAuth + appel fonction
- `components/SnapchatSignInButton.tsx`
- `context/AuthContext.tsx` — `signInWithSnapchat`
- `app/welcome.tsx`, `app/(auth)/login.tsx`, `app/(auth)/register.tsx`
- `supabase/functions/snapchat-auth/index.ts`
- `locales/*.ts` — clés `snapchat.*`
- `.env.example`

Google auth, i18n et limite vidéo 10 min **inchangés**.
