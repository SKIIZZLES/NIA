# Edge Function `purge-user-storage`

Worker **serveur uniquement** qui vide le dossier Storage d'un compte supprimé.
Il traite la file `public.storage_purge_jobs`, remplie par la RPC
`delete_own_account()` de la migration `014_account_deletion.sql`.

> **Rien de ce qui suit n'a été exécuté.** Ces étapes sont à faire à la main,
> après validation, dans cet ordre : 014 → secret → déploiement → test manuel → cron.

## Ce que fait la fonction

1. Refuse tout ce qui n'est pas `POST` avec l'en-tête `x-purge-secret` égal à
   `PURGE_CRON_SECRET` (comparaison en temps constant ; secret < 32 caractères
   = fonction désactivée, réponse 503).
2. Crée un client `service_role` (`SUPABASE_SERVICE_ROLE_KEY`, injecté par
   Supabase, jamais dans le dépôt).
3. `claim_storage_purge_jobs(p_batch, 15)` : réclame jusqu'à `PURGE_BATCH`
   jobs (défaut 3) avec `FOR UPDATE SKIP LOCKED`. Les jobs bloqués en
   `processing` depuis plus de 15 min sont repris.
4. Pour chaque job : vérifie que `prefix = "{user_id}/"` et que le bucket est
   `videos` (sinon `unsafe_job`, rien n'est touché). Ensuite :
   - liste **récursivement** `videos/{user_id}/…` (`list()` n'est pas récursif :
     parcours des dossiers + pagination par 100) ;
   - supprime par lots de 100 via `storage.from('videos').remove(paths)` (API
     Storage : fichiers ET métadonnées) ;
   - relit la liste : il ne doit plus rien rester ;
   - `complete_storage_purge_job(id)`, ou `fail_storage_purge_job(id, code)`.
5. En cas d'échec, `last_error` reçoit un **code** (`storage_remove_failed:500`,
   `storage_list_failed:503`, `objects_remaining`, `deadline_exceeded`,
   `unsafe_job`…), jamais un message brut. Le job est retenté avec un backoff
   de 2^tentatives minutes (plafond 6 h), jusqu'à `max_attempts` (8). Au-delà, il
   reste en `failed` : c'est à un humain d'intervenir.
6. C'est idempotent : un préfixe déjà vide donne `done` avec `removed: 0`.

Les logs ne contiennent que l'id du job, des compteurs et des codes : aucun
user_id, chemin, e-mail, légende ni jeton.

La logique est dans `core.ts` (pur, sans API Deno), testée par
`__tests__/supabase/purgeUserStorage.test.ts` (Jest).

## 1. Secret

Générer un secret aléatoire (≥ 32 caractères), **hors dépôt** :

```bash
openssl rand -base64 48 | tr -d '=+/' | cut -c1-48
```

```bash
supabase secrets set PURGE_CRON_SECRET='<secret>' --project-ref odlmbiaocdonlovjepxn
# optionnel : supabase secrets set PURGE_BATCH=3
```

`SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY` sont injectés automatiquement
dans les Edge Functions hébergées.

## 2. Déploiement

```bash
supabase functions deploy purge-user-storage --no-verify-jwt --project-ref odlmbiaocdonlovjepxn
```

**Pourquoi `--no-verify-jwt`.** La vérification JWT de la passerelle exigerait
que le cron envoie un JWT (anon ou service_role en format legacy). Le projet
utilise les nouvelles clés (`sb_publishable_…`), qui ne sont pas des JWT. Et
stocker un JWT service_role dans le cron donnerait bien plus de pouvoir qu'un
secret dédié. La fonction applique donc sa propre authentification (secret
partagé, comparé en temps constant) avant tout accès aux données. C'est le même
choix que `snapchat-auth` et que la doc Supabase pour les appels
service-à-service par `pg_cron`. Le dépôt n'a pas de `supabase/config.toml` ;
il n'en est donc pas créé : le flag est passé au déploiement.

## 3. Test manuel (après 014 et le déploiement)

```bash
curl -i -X POST \
  -H "x-purge-secret: <secret>" \
  https://odlmbiaocdonlovjepxn.supabase.co/functions/v1/purge-user-storage
# → 200 {"claimed":0,"done":0,"failed":0,"jobs":[]} si la file est vide
```

Sans l'en-tête → 401. En GET → 405.

## 4. Planification (pg_cron + pg_net + Vault)

`pg_cron` et `pg_net` sont disponibles sur le plan Free. Activez-les dans
Dashboard → Database → Extensions s'ils ne le sont pas déjà. Le secret est
lu depuis Vault : il n'est ni dans le SQL du job, ni dans le dépôt.

```sql
-- Une seule fois (SQL Editor) :
select vault.create_secret('https://odlmbiaocdonlovjepxn.supabase.co', 'nia_project_url');
select vault.create_secret('<secret>', 'nia_purge_cron_secret');

-- Toutes les 10 minutes :
select cron.schedule(
  'nia-purge-user-storage',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'nia_project_url')
           || '/functions/v1/purge-user-storage',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-purge-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'nia_purge_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
```

Vous pouvez aussi créer la même chose depuis Dashboard → Integrations → Cron.

`pg_net` ne fait que lancer l'appel : il ne relance pas après une erreur 5xx.
Ce n'est pas grave ici, car les retries sont portés par la file elle-même
(backoff, reprise des verrous expirés).

## Supervision

```sql
-- État de la file
select status, count(*), max(attempts) from public.storage_purge_jobs group by 1;

-- Échecs définitifs (à traiter à la main)
select id, attempts, last_error, updated_at
  from public.storage_purge_jobs
 where status = 'failed' and attempts >= max_attempts;

-- Relancer un job en échec définitif après correction
update public.storage_purge_jobs
   set attempts = 0, status = 'pending', not_before = now(), updated_at = now()
 where id = '<job id>';
```

Un projet Free mis en pause (inactivité) n'exécute plus le cron. Les jobs
restent alors en file et sont traités à la reprise.

## Limites connues

- Budget de 110 s par appel (limite de wall clock des Edge Functions). Un gros
  dossier finit en `deadline_exceeded` et reprend à l'appel suivant, déjà
  allégé de ce qui a été supprimé.
- Le second job, planifié à +70 min, repasse sur le dossier après expiration du
  dernier JWT de l'utilisateur. Un upload lancé juste avant la suppression est
  ainsi rattrapé.
