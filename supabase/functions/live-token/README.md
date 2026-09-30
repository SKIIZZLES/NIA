# Edge Function `live-token` (lives LiveKit, sprint L1)

Délivre un **jeton LiveKit court** à un utilisateur NIA connecté, pour
diffuser (créateur) ou regarder (spectateur) un live de `public.live_streams`.
C'est le **seul** endroit qui signe des jetons LiveKit : le secret API n'existe
que dans les secrets de fonction Supabase (jamais dans l'app, jamais dans
`EXPO_PUBLIC_*`, jamais dans le dépôt).

## Contrat

`POST /functions/v1/live-token` avec `Authorization: Bearer <JWT Supabase>`
(ce que fait `supabase.functions.invoke`, voir `lib/liveToken.ts`).

```json
{ "live_id": "<uuid>", "role": "publisher" | "viewer" }
```

Réponse 200 :

```json
{ "token": "<jwt LiveKit>", "url": "wss://….livekit.cloud", "room": "nia-live-<uuid>", "role": "viewer", "expires_in": 600 }
```

| Code | `error` | Cas |
|---|---|---|
| 400 | `bad_request` | corps illisible, `live_id` non UUID, rôle inconnu |
| 401 | `unauthorized` | pas de JWT, JWT invalide ou expiré |
| 403 | `not_owner` | jeton publisher demandé par quelqu'un d'autre que le créateur |
| 404 | `not_found` | live inexistant **ou invisible sous la RLS** (indiscernables exprès) |
| 409 | `live_not_active` | live `ended` ou `cancelled` |
| 500 | `db_error` | erreur PostgREST |
| 503 | `not_configured` | secrets LiveKit absents |

## Règles d'attribution (logique pure dans `core.ts`, testée par Jest)

- La ligne `live_streams` est lue **avec le JWT de l'appelant** (clé anon +
  en-tête `Authorization`), jamais en `service_role` : la RLS existante (010)
  décide de ce qui est visible.
- **publisher** : `live.user_id === uid` et statut `scheduled` ou `live`.
  Grant : `roomJoin`, `canPublish` (sources `camera` et `microphone`
  uniquement), `canPublishData`, `canSubscribe`.
- **viewer** : live visible et statut `scheduled` ou `live`. Grant :
  `roomJoin`, `canSubscribe` ; **aucune** publication (`canPublish: false`,
  `canPublishData: false`).
- Jamais `roomAdmin`, `roomCreate`, `roomList`, `roomRecord`.
- Room = `nia-live-<live_id>` ; identité = UUID de l'utilisateur ; durée de
  vie **10 min** (connexion initiale, LiveKit rafraîchit ensuite la session).
- Journaux : codes courts seulement (jamais de jeton, JWT ou identifiant).

### Limite volontaire du L1 (resserrée au L2)

La migration 017 n'est pas appliquée : on ne peut pas encore passer un live
en `status='live'` côté serveur de façon sûre (colonnes serveur non
protégées). **L1 n'écrit donc rien en base** : un jeton spectateur est
accordé dès que le live existe, est visible et n'est pas terminé/annulé
(donc aussi pour un live encore `scheduled`). Au **L2**, avec 017 :
spectateur seulement si `status='live'`, pas exclu (`live_bans`), pas bloqué
par l'hôte (`blocks`), visibilité « abonnés » corrigée ; passage en `live`
et création de room par `service_role`.

## Secrets

À définir une fois (Dashboard → Edge Functions → Secrets, ou CLI) :

```bash
supabase secrets set LIVEKIT_API_KEY=… LIVEKIT_API_SECRET=… LIVEKIT_URL=wss://….livekit.cloud \
  --project-ref odlmbiaocdonlovjepxn
```

`SUPABASE_URL` et `SUPABASE_ANON_KEY` sont injectés automatiquement.

## Déploiement

Vérification JWT de la passerelle **activée** (pas de `--no-verify-jwt`) ;
la fonction revérifie de toute façon l'utilisateur avec `auth.getUser()`.

```bash
SUPABASE_ACCESS_TOKEN=… npx supabase functions deploy live-token \
  --project-ref odlmbiaocdonlovjepxn --use-api
```

`--use-api` fait le bundle côté Supabase (pas besoin de Docker). Sans
`--prune`, seules les fonctions nommées sont touchées.

## Tests

- Jest : `__tests__/supabase/liveToken.test.ts` (règles d'attribution) et
  `__tests__/lib/liveToken.test.ts` (client, correspondance des erreurs).
- Test local complet possible avec Deno : lancer `index.ts` avec un faux
  Supabase (Auth + PostgREST) et les vrais secrets LiveKit, puis vérifier les
  jetons émis avec `GET https://<projet>.livekit.cloud/rtc/validate?access_token=…`
  (réponse `200 success`). Lancer Deno avec `--node-modules-dir=none --no-config`
  depuis ce dépôt (sinon Deno cherche `livekit-server-sdk` dans `node_modules`).

Smoke test après déploiement :

```bash
curl -i -X POST https://odlmbiaocdonlovjepxn.supabase.co/functions/v1/live-token \
  -H 'Content-Type: application/json' -d '{"live_id":"00000000-0000-4000-8000-000000000000","role":"viewer"}'
# → 401 (pas de JWT)
```
