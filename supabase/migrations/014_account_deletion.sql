-- NIA — Suppression de compte v2 (remplace la fonction de 013).
-- À exécuter APRÈS 013_account_deletion.sql dans Supabase Dashboard → SQL Editor.
-- Idempotent. Ne JAMAIS ré-exécuter 013 après 014 (cela réinstallerait l'ancienne
-- fonction, qui échoue sur le trigger storage.protect_delete).
--
-- Pourquoi 014
-- ------------
-- 013 faisait `delete from storage.objects`. Depuis la migration Storage
-- `0055-prevent-direct-deletes` (janvier 2026), un trigger BEFORE DELETE
-- FOR EACH STATEMENT rejette tout DELETE SQL sur storage.objects (42501), même
-- à 0 ligne : la RPC échouait pour 100 % des comptes. Et même autorisé, ce
-- DELETE n'effaçait que les métadonnées (fichiers orphelins chez le fournisseur).
--
-- Architecture retenue
-- --------------------
--   1. RPC `delete_own_account()` (même signature, sans argument : l'AAB déjà
--      construit continue de fonctionner). Dans UNE transaction :
--        a. supprime les reposts faits PAR D'AUTRES du contenu de l'utilisateur
--           (lignes `videos` avec repost_of → ses vidéos, voir plus bas) ;
--        b. supprime les notifications dont il est l'acteur, et celles qui
--           pointent vers les lignes supprimées en (a) ;
--        c. met en file deux jobs de purge Storage pour le préfixe `{uid}/` :
--           un immédiat, un « balayage » différé de 70 min (après expiration
--           du dernier JWT, qui permettrait encore un upload sous `{uid}/`) ;
--        d. supprime auth.users → cascade profil et tout le reste (001–012).
--      Si une étape échoue, rien n'est supprimé et le compte reste actif.
--   2. Edge Function `purge-user-storage` (service_role, appelée par cron avec
--      un secret partagé) : réclame les jobs, supprime les fichiers via l'API
--      Storage, marque done / failed (retry avec backoff, max_attempts).
--
-- Reposts faits par d'autres (lib/reposts.ts createRepost)
-- --------------------------------------------------------
-- Un repost crée DEUX lignes : `reposts(user_id=B, video_id=original)` et une
-- ligne `videos(user_id=B, repost_of=original)` qui COPIE storage_path,
-- thumbnail_url, cover_path, caption, region, tag, category, hashtags de
-- l'original. `videos.repost_of` est `on delete set null` (003) : sans action,
-- ces lignes survivraient avec la légende et les hashtags de l'utilisateur
-- supprimé, attribuées à B, et un média cassé après la purge (le fichier est
-- sous `{uid}/`). Ce contenu appartient à l'utilisateur supprimé : on supprime
-- ces lignes (et, par cascade, likes / commentaires / sauvegardes / reposts /
-- series_items qui les visent). On suit la chaîne repost_of récursivement
-- (données anciennes : repost d'un repost).
-- Les reposts faits PAR l'utilisateur (videos.user_id = uid, repost_of → la
-- vidéo d'un autre) partent par cascade ; leur storage_path pointe vers le
-- dossier de l'auteur original, qui n'est PAS purgé (préfixe = `{uid}/` seulement).
--
-- Notifications (002 : notify_on_like / notify_on_comment / notify_on_follow ;
-- aucun trigger repost ni autre)
-- -----------------------------------------------------------------------------
-- `notifications.actor_id` est `on delete set null` : sans action, les
-- notifications reçues par d'autres resteraient, et notify_on_comment y copie
-- `left(body, 120)` du commentaire. On supprime donc toutes les notifications
-- dont l'utilisateur est l'acteur. Celles qu'il a reçues partent par cascade
-- (user_id). Celles qui visent une ligne repost supprimée en (a) sont aussi
-- supprimées (sinon video_id passerait à NULL : notification orpheline).
--
-- Signalements (reports)
-- ----------------------
-- Ceux faits PAR l'utilisateur partent par cascade (reporter_id, 002).
-- Ceux faits PAR D'AUTRES à son sujet (target_id, sans FK) sont CONSERVÉS :
-- ils appartiennent au signaleur, servent à la modération (récidive,
-- réinscription, obligations légales en cas de contenu illicite) et ne
-- contiennent que target_type / target_id / reason. Ils ne cassent rien
-- (pas de FK) et ne sont lisibles que par leur auteur (RLS reports_select_own).

-- ---------------------------------------------------------------------------
-- File de purge Storage
-- ---------------------------------------------------------------------------
create table if not exists public.storage_purge_jobs (
  id uuid primary key default gen_random_uuid(),
  -- PAS de FK : l'utilisateur n'existe plus quand le job est traité.
  user_id uuid not null,
  bucket text not null default 'videos',
  prefix text not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  max_attempts integer not null default 8,
  last_error text,
  not_before timestamptz not null default now(),
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  done_at timestamptz,
  constraint storage_purge_jobs_status_check
    check (status in ('pending', 'processing', 'done', 'failed')),
  -- Garde-fou : un job ne peut viser QUE le dossier `{user_id}/` d'un bucket
  -- connu. Impossible de purger la racine du bucket ou le dossier d'un autre.
  constraint storage_purge_jobs_bucket_check
    check (bucket in ('videos')),
  constraint storage_purge_jobs_prefix_check
    check (prefix = user_id::text || '/'),
  constraint storage_purge_jobs_attempts_check
    check (attempts >= 0 and max_attempts >= 1)
);

create index if not exists storage_purge_jobs_claim_idx
  on public.storage_purge_jobs (status, not_before)
  where status <> 'done';

create index if not exists storage_purge_jobs_user_id_idx
  on public.storage_purge_jobs (user_id);

comment on table public.storage_purge_jobs is
  'Purges Storage asynchrones après suppression de compte (014). Traitée par l''Edge Function purge-user-storage (service_role). Aucune policy : inaccessible à anon / authenticated.';

-- RLS activée, AUCUNE policy : seul service_role (BYPASSRLS) et le
-- propriétaire des fonctions security definer y accèdent.
alter table public.storage_purge_jobs enable row level security;

revoke all on table public.storage_purge_jobs from public;
revoke all on table public.storage_purge_jobs from anon;
revoke all on table public.storage_purge_jobs from authenticated;
-- Lecture / réinitialisation manuelle d'un job en échec définitif.
grant select, update on table public.storage_purge_jobs to service_role;

-- ---------------------------------------------------------------------------
-- RPC appelée par l'app (AAB inchangé : même nom, aucun argument)
-- ---------------------------------------------------------------------------
create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_repost_ids uuid[];
begin
  if v_uid is null then
    raise exception 'delete_own_account: aucun utilisateur authentifie'
      using errcode = '28000';
  end if;

  -- Deux appels simultanés pour le même compte : le second attend le premier.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('nia.delete_own_account:' || v_uid::text, 0)
  );

  -- Déjà supprimé (réponse perdue, nouvel essai avec un JWT encore valide) :
  -- no-op, aucun nouveau job, aucune erreur.
  if not exists (select 1 from auth.users u where u.id = v_uid) then
    return;
  end if;

  -- (a) Reposts faits par d'autres du contenu de l'utilisateur, chaîne comprise.
  with recursive chain (id) as (
    select v.id
      from public.videos v
     where v.repost_of in (select o.id from public.videos o where o.user_id = v_uid)
       and v.user_id <> v_uid
    union
    select v.id
      from public.videos v
      join chain c on v.repost_of = c.id
     where v.user_id <> v_uid
  )
  select coalesce(pg_catalog.array_agg(chain.id), '{}'::uuid[])
    into v_repost_ids
    from chain;

  -- (b) Notifications : actions de l'utilisateur, et celles visant les reposts
  --     supprimés ci-dessous.
  delete from public.notifications n
   where n.actor_id = v_uid
      or n.video_id = any (v_repost_ids);

  delete from public.videos v
   where v.id = any (v_repost_ids);

  -- (c) Purge Storage : même transaction, donc impossible à perdre.
  insert into public.storage_purge_jobs (user_id, bucket, prefix, not_before)
  values
    (v_uid, 'videos', v_uid::text || '/', pg_catalog.now()),
    (v_uid, 'videos', v_uid::text || '/', pg_catalog.now() + interval '70 minutes');

  -- (d) Le compte. Cascade : profiles → videos, likes, comments, follows,
  --     notifications reçues, reports faits, blocks, reposts, saves, sounds,
  --     events (+ event_attendees), live_streams, series (+ series_items).
  delete from auth.users u where u.id = v_uid;
end;
$$;

comment on function public.delete_own_account() is
  'Supprime le compte appelant (auth.uid()) et ses données ; met en file la purge Storage de {uid}/ (014). Ne touche jamais storage.objects.';

revoke all on function public.delete_own_account() from public;
revoke all on function public.delete_own_account() from anon;
revoke all on function public.delete_own_account() from service_role;
grant execute on function public.delete_own_account() to authenticated;

-- ---------------------------------------------------------------------------
-- Fonctions du worker (service_role uniquement)
-- ---------------------------------------------------------------------------

-- Réclame jusqu'à p_batch jobs prêts : pending / failed (backoff écoulé,
-- attempts < max_attempts), ou processing bloqués depuis plus de
-- p_stale_minutes (worker mort en cours de route). FOR UPDATE SKIP LOCKED :
-- deux workers concurrents ne réclament jamais le même job.
create or replace function public.claim_storage_purge_jobs(
  p_batch integer default 3,
  p_stale_minutes integer default 15
)
returns setof public.storage_purge_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch integer := least(greatest(coalesce(p_batch, 3), 1), 50);
  v_stale interval := pg_catalog.make_interval(
    mins => least(greatest(coalesce(p_stale_minutes, 15), 1), 1440)
  );
begin
  -- Un job resté « processing » après sa dernière tentative ne serait jamais
  -- repris : on le passe en failed (échec définitif, visible pour un humain).
  update public.storage_purge_jobs j
     set status = 'failed',
         locked_at = null,
         last_error = 'stale_lock_max_attempts',
         updated_at = pg_catalog.now()
   where j.status = 'processing'
     and j.locked_at < pg_catalog.now() - v_stale
     and j.attempts >= j.max_attempts;

  return query
  with candidates as (
    select j.id
      from public.storage_purge_jobs j
     where j.attempts < j.max_attempts
       and (
         (j.status in ('pending', 'failed') and j.not_before <= pg_catalog.now())
         or (j.status = 'processing' and j.locked_at < pg_catalog.now() - v_stale)
       )
     order by j.not_before, j.created_at
     limit v_batch
     for update skip locked
  )
  update public.storage_purge_jobs j
     set status = 'processing',
         locked_at = pg_catalog.now(),
         attempts = j.attempts + 1,
         updated_at = pg_catalog.now()
    from candidates c
   where j.id = c.id
  returning j.*;
end;
$$;

create or replace function public.complete_storage_purge_job(p_job_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.storage_purge_jobs j
     set status = 'done',
         done_at = pg_catalog.now(),
         locked_at = null,
         last_error = null,
         updated_at = pg_catalog.now()
   where j.id = p_job_id
     and j.status = 'processing';
  return found;
end;
$$;

-- p_error : code court (ex. 'storage_remove_failed:500'). Re-nettoyé ici par
-- précaution : seuls [A-Za-z0-9_.:-] sont gardés, 200 caractères max.
-- Backoff : 2^attempts minutes, plafonné à 6 h.
create or replace function public.fail_storage_purge_job(p_job_id uuid, p_error text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.storage_purge_jobs j
     set status = 'failed',
         locked_at = null,
         last_error = pg_catalog.left(
           pg_catalog.regexp_replace(coalesce(p_error, 'unknown'), '[^A-Za-z0-9_.:-]', '_', 'g'),
           200
         ),
         not_before = pg_catalog.now()
           + pg_catalog.make_interval(mins => least(pg_catalog.power(2, least(j.attempts, 12))::integer, 360)),
         updated_at = pg_catalog.now()
   where j.id = p_job_id
     and j.status = 'processing';
  return found;
end;
$$;

revoke all on function public.claim_storage_purge_jobs(integer, integer) from public;
revoke all on function public.claim_storage_purge_jobs(integer, integer) from anon;
revoke all on function public.claim_storage_purge_jobs(integer, integer) from authenticated;
grant execute on function public.claim_storage_purge_jobs(integer, integer) to service_role;

revoke all on function public.complete_storage_purge_job(uuid) from public;
revoke all on function public.complete_storage_purge_job(uuid) from anon;
revoke all on function public.complete_storage_purge_job(uuid) from authenticated;
grant execute on function public.complete_storage_purge_job(uuid) to service_role;

revoke all on function public.fail_storage_purge_job(uuid, text) from public;
revoke all on function public.fail_storage_purge_job(uuid, text) from anon;
revoke all on function public.fail_storage_purge_job(uuid, text) from authenticated;
grant execute on function public.fail_storage_purge_job(uuid, text) to service_role;
