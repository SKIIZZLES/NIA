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

## Spike app-switch Android (PR `haby/snap-app-switch`, 30/09/2026)

But : sur Android, quand Snapchat est installé, « Continuer avec Snapchat »
ouvre **l'app Snapchat** plutôt qu'une page web. Sans SDK natif (le SDK Login
Kit est déprécié par Snap), sans changement de base.

| Variante | Lien ouvert | Remarque |
|---|---|---|
| `https` (défaut) | `https://accounts.snapchat.com/accounts/oauth2/auth?…` via `Linking.openURL`, **même URL octet pour octet que le Custom Tab** | Snapchat Android est vérifié pour ce domaine (`assetlinks.json`) : s'il revendique ce chemin, Android l'ouvre ; sinon navigateur par défaut |
| `snapchat` | `snapchat://oauth2?…&package_name=app.nia.mobile&kit_version=3.0.0&link=<client_id>` | Lien construit par le SDK Login Kit Android 3.0.0 (lu dans l'AAR, **non documenté**) |
| `web` | Custom Tab (flux historique) | Toujours utilisé si Snapchat est absent, si le lien ne s'ouvre pas en 4 s, ou sur iOS |

- Choix : constante `SNAP_APP_SWITCH_DEFAULT` (`lib/snapchatAppSwitch.ts`) ou
  **appui long (1,5 s) sur le bouton** (réglage caché, gardé sur le téléphone,
  rappelé sous le bouton tant qu'il diffère du défaut).
- PKCE S256 + `state` générés par `expo-auth-session` ; la demande (state +
  code_verifier) est gardée dans SecureStore, usage unique, 10 min max.
- Retour : `nia://snapchat-auth` → écran `app/snapchat-auth.tsx` (valide le
  `state`, envoie code + verifier à `snapchat-auth`). Marche même si Android a
  fermé NIA pendant le passage dans Snapchat.
- Retour sur NIA sans valider : message « Connexion Snapchat non terminée… »
  après 2,5 s ; pas de réponse en 5 min : message de délai dépassé.
- `plugins/withSnapchatQueries.js` : `<queries>` `com.snapchat.android` +
  scheme `snapchat` (Android 11+), **rebuild nécessaire**.

### « Erreur d'autorisation — Échec du chargement des données d'autorisation » (30/09/2026)

Page `accounts.snapchat.com` : c'est la nouvelle page d'autorisation de Snap
(Next.js `/v2/oauth2/authorize`). Une fois l'utilisateur connecté, elle envoie
les paramètres de l'URL à `POST /oauth2/api/auth` ; **toute** réponse d'erreur
de Snap (hors « allowlist ») affiche ce même texte générique. Avec un compte
non connecté, on voit la page de connexion, pas cette erreur.

- L'URL de la variante `https` était déjà la même que celle du Custom Tab de
  `main` (mêmes 7 paramètres et mêmes valeurs, aucun `package_name` /
  `kit_version` / `link`) ; seuls l'ordre et l'encodage des espaces du scope
  (`%20` au lieu de `+`) différaient. Depuis ce correctif, elle ouvre
  **exactement** `request.url` d'expo-auth-session (test Jest octet pour octet).
  `package_name`, `kit_version` et `link` restent dans le seul lien `snapchat://`.
- Sans compte connecté, Snap traite les deux URL de la même façon (vérifié
  avec un navigateur headless) ; `POST /oauth2/api/auth` répond `401` sans session.
- Le refus vient donc de la configuration de l'app Snap, côté portail. À
  vérifier sur kit.snapchat.com → app NIA → **Staging** → Login Kit :
  1. Redirect URI **exactement** `nia://snapchat-auth` (sans `/` final, sans
     espace, en minuscules) ;
  2. le compte Snapchat utilisé dans la liste **Demo Users** de Staging ;
  3. les scopes Display Name, External ID **et** Bitmoji avatar activés (sinon
     retirer `user.bitmoji.avatar` de `SNAP_SCOPES`) ;
  4. le Client ID utilisé est bien celui de **Staging** (`7ea8f803-…`), avec
     la config Staging enregistrée (bouton Save).
- Pour lire le message exact de Snap : sur ordinateur, se connecter à
  accounts.snapchat.com dans Chrome, ouvrir l'URL d'autorisation, DevTools →
  Network → requête `auth` (`/oauth2/api/auth`) → onglet Response.

### Edge Function v7 — client public

Le Client ID Staging `7ea8f803-…` est **public** (fondateur, 30/09/2026).
L'app envoie désormais `client_type: 'public'` + `client_id` : la fonction
échange le code en **PKCE seul, sans en-tête Basic** (`core.ts`). Le
client_id doit être `SNAP_CLIENT_ID` ou figurer dans le secret optionnel
`SNAP_PUBLIC_CLIENT_IDS` (virgules ; ex. l'ID Production plus tard).
L'ancien corps `{ code, code_verifier, redirect_uri }` (anciens APK) garde le
chemin Basic, avec une seule nouvelle tentative en public si Snap refuse le
client (`invalid_client` / `unauthorized_client`, jamais sur `invalid_grant`).

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
