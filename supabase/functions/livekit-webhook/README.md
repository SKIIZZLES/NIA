# Edge Function `livekit-webhook` (lives LiveKit, sprint L2)

Reçoit les **webhooks de LiveKit Cloud** et tient `public.live_streams` à jour
côté serveur (`service_role`), via les RPC de la migration **019** :
`live_webhook_apply` et `live_sweep_stale`. C'est **le seul** chemin qui
passe un live en `status = 'live'` (le trigger de 019 l'interdit aux
utilisateurs).

| Événement LiveKit | Effet en base |
|---|---|
| `participant_joined` de l'hôte (identité = `user_id` du live), `track_published` de l'hôte | `scheduled` → `live`, `started_at`, `provider = 'livekit'`, `provider_stream_id = room` ; hôte revenu → `host_left_at = null` |
| `participant_joined` / `participant_left` / `participant_connection_aborted` d'un spectateur | `viewer_count` recompté (RoomService `listParticipants`, hors hôte), `peak_viewer_count` |
| `participant_left` de l'hôte | `host_left_at = now()` ; fin automatique après **2 min** d'absence (`ended_reason = 'host_timeout'`) |
| `room_finished` | `ended`, `ended_at`, `ended_reason = 'room_closed'`, `viewer_count = 0` |
| `room_started` | rien (le passage en `live` attend l'hôte) |
| Autre événement, room hors préfixe `nia-live-`, live inconnu | `200` et rien d'autre |

Idempotent : rejouer un événement ne change rien (`live` → `live` = `noop`,
un live terminé reste terminé, le compteur est recompté et non incrémenté).
Un live retenu par la modération (`moderation_state <> 'visible'`) ne passe
jamais en `live` (`held`).

À chaque appel, la fonction lance aussi `live_sweep_stale(120 s, 4 h)` :
lives dont l'hôte est absent depuis plus de 2 min, ou en direct depuis plus
de 4 h → `ended`, puis `deleteRoom` best effort pour couper la room LiveKit.
En complément, `live-token` crée la room avec `departureTimeout = 120 s` et
`emptyTimeout = 120 s` : LiveKit ferme alors la room lui-même, ce qui envoie
`room_finished`.

## Authentification

LiveKit ne peut pas envoyer de JWT Supabase : la fonction est déployée
**sans vérification JWT de la passerelle** (`--no-verify-jwt`) et vérifie
elle-même chaque requête (`core.ts`, testé par Jest) :

- en-tête `Authorization` = JWT **HS256** signé par LiveKit avec
  `LIVEKIT_API_SECRET` (comparaison de signature via WebCrypto) ;
- `iss` = `LIVEKIT_API_KEY`, `exp` obligatoire (tolérance d'horloge 10 s) ;
- claim `sha256` = SHA-256 (base64) du **corps brut** → un corps modifié est
  refusé ;
- corps limité à 64 Ko.

Refus → `401 unauthorized` (motif court dans les journaux, jamais le jeton).

| Code | Cas |
|---|---|
| 200 | traité (`outcome`) ou ignoré (`ignored`) |
| 400 | corps illisible |
| 401 | signature, émetteur, expiration ou empreinte du corps invalides |
| 405 | méthode autre que `POST` |
| 413 | corps trop gros |
| 500 | erreur base (LiveKit réessaie) |
| 503 | secrets absents |

## Secrets

**Aucun nouveau secret.** La fonction réutilise `LIVEKIT_API_KEY`,
`LIVEKIT_API_SECRET` et `LIVEKIT_URL` (déjà définis pour `live-token`) ;
`SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY` sont injectés par Supabase.

## Mise en production (dans cet ordre)

1. Appliquer `supabase/migrations/019_live_l2.sql` (SQL Editor), puis lancer
   `supabase/tests/019_verify_after_apply.sql` : toutes les lignes `ok = true`.
2. Déployer la fonction :

   ```bash
   SUPABASE_ACCESS_TOKEN=… npx supabase functions deploy livekit-webhook \
     --project-ref odlmbiaocdonlovjepxn --use-api --no-verify-jwt
   ```

3. Redéployer `live-token` (règles L2, **avec** vérification JWT) :

   ```bash
   SUPABASE_ACCESS_TOKEN=… npx supabase functions deploy live-token \
     --project-ref odlmbiaocdonlovjepxn --use-api
   ```

4. Dans LiveKit Cloud : **Settings → Webhooks → Create new webhook**
   (d'après docs.livekit.io, à vérifier dans le tableau de bord) :
   - Name : `nia-supabase`
   - URL : `https://odlmbiaocdonlovjepxn.supabase.co/functions/v1/livekit-webhook`
   - Signing API key : **la même clé API** que `LIVEKIT_API_KEY`
     (sinon la signature est refusée) ;
   - Create. Le choix des événements un par un : à vérifier (par défaut
     LiveKit envoie tous les événements ; ceux qui ne servent pas sont
     ignorés avec un `200`).
5. Tester : sur le webhook, **Actions → Send a test event** (à vérifier) ;
   la room de test n'a pas le préfixe `nia-live-` → réponse `200`
   `ignored`. Puis un vrai live depuis l'app : le badge « EN DIRECT »
   doit apparaître dans Découvrir quelques secondes après le départ.

Smoke test sans signature :

```bash
curl -i -X POST https://odlmbiaocdonlovjepxn.supabase.co/functions/v1/livekit-webhook \
  -H 'Content-Type: application/webhook+json' -d '{"event":"room_started"}'
# → 401 {"error":"unauthorized"}
```

## Optionnel : balayage planifié

Si un hôte coupe l'app et que plus aucun événement n'arrive, la fin est
déclenchée par LiveKit (`departureTimeout`) puis `room_finished`. Pour une
ceinture de plus, `pg_cron` peut appeler `select public.live_sweep_stale();`
chaque minute (ligne commentée à la fin de 019 ; ne pas l'activer sans
accord : elle consomme peu mais tourne en continu).

## Tests

- Jest : `__tests__/supabase/livekitWebhook.test.ts` (signature, émetteur,
  expiration, empreinte du corps, jeton fabriqué par `livekit-server-sdk`,
  correspondance des événements, comptage des spectateurs).
- SQL : `supabase/tests/019_live_l2.test.sql` (RPC, transitions, trigger).
- Deno : `deno check --no-config --node-modules-dir=none supabase/functions/livekit-webhook/index.ts`.
