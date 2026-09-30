-- NIA — 019 : Live L2 (statut réel via webhook LiveKit, fin automatique,
-- audience « Abonnés », colonnes serveur protégées).
--
-- À exécuter APRÈS 018 (SQL Editor Supabase). Idempotente : rejouable deux
-- fois sans effet (vérifié sur un Postgres local jetable, voir
-- supabase/tests/019_live_l2.test.sql). Aucune donnée existante modifiée.
--
-- Contenu :
--   1. live_streams : + peak_viewer_count, ended_reason, host_left_at ;
--      contraintes (compteurs >= 0, raisons de fin) en NOT VALID.
--   2. Index : lives en cours (Discover) ; un seul live « live » par créateur.
--   3. Trigger live_streams_10_lifecycle_guard (entre la garde de modération
--      05 de 017 et le filtre de mots 30 de 018) : pour l'app (rôle
--      authenticated), insertion en « scheduled » uniquement, colonnes
--      serveur en lecture seule, passage à « live » réservé au serveur,
--      transitions scheduled → cancelled | ended et live → ended seulement.
--      service_role (Edge Functions) et SQL Editor ne sont pas concernés.
--   4. nia_live_row_visible (017) : + audience « Abonnés » (nia_is_follower
--      de 016). La modération (moderation_state = 'visible') et le blocage
--      (nia_block_between) de 017 sont CONSERVÉS ; la policy
--      live_streams_select_public n'est pas touchée (elle appelle déjà cette
--      fonction : 017_verify_after_apply check 14 reste vrai).
--   5. RPC service_role uniquement : live_webhook_apply (Edge Function
--      livekit-webhook) et live_sweep_stale (fin automatique).
--
-- Pas de table de chat ici (L3) : nia_kw_attach_live_chat() n'est pas appelée.
-- Rollback : en bas du fichier (commenté).

-- ===========================================================================
-- 1. Colonnes et contraintes
-- ===========================================================================
alter table public.live_streams add column if not exists peak_viewer_count integer not null default 0;
alter table public.live_streams add column if not exists ended_reason text;
alter table public.live_streams add column if not exists host_left_at timestamptz;

comment on column public.live_streams.viewer_count is
  'Spectateurs connectés (hors hôte), écrit par livekit-webhook (service_role). Lecture seule pour l''app.';
comment on column public.live_streams.peak_viewer_count is
  'Pic de spectateurs du live (livekit-webhook). Lecture seule pour l''app.';
comment on column public.live_streams.ended_reason is
  'host | room_closed | host_timeout | max_duration | replaced | moderation (serveur).';
comment on column public.live_streams.host_left_at is
  'Hôte déconnecté depuis (livekit-webhook) ; null s''il est là. Fin auto après le délai de grâce.';
comment on column public.live_streams.provider_stream_id is
  'Nom de la room LiveKit (nia-live-<id>), écrit par livekit-webhook.';

alter table public.live_streams drop constraint if exists live_streams_counts_check;
alter table public.live_streams add constraint live_streams_counts_check
  check (viewer_count >= 0 and peak_viewer_count >= 0) not valid;

alter table public.live_streams drop constraint if exists live_streams_ended_reason_check;
alter table public.live_streams add constraint live_streams_ended_reason_check
  check (ended_reason is null
         or ended_reason in ('host', 'room_closed', 'host_timeout', 'max_duration', 'replaced', 'moderation'))
  not valid;

-- ===========================================================================
-- 2. Index
-- ===========================================================================
-- Discover : « En direct maintenant », du plus récent au plus ancien.
create index if not exists live_streams_live_now_idx
  on public.live_streams (started_at desc)
  where status = 'live';

-- Un seul live « live » par créateur (live_webhook_apply termine l'ancien
-- avant). Créé seulement si les données le permettent déjà (en prod, aucun
-- live n'est jamais passé à « live » avant 019).
do $do$
begin
  if pg_catalog.to_regclass('public.live_streams_one_live_per_host_idx') is null then
    if exists (select 1 from public.live_streams where status = 'live'
                group by user_id having count(*) > 1) then
      raise notice '019 : index live_streams_one_live_per_host_idx NON créé (un créateur a plusieurs lives « live »).';
    else
      execute 'create unique index live_streams_one_live_per_host_idx
                 on public.live_streams (user_id) where status = ''live''';
    end if;
  end if;
end
$do$;

-- ===========================================================================
-- 3. Garde du cycle de vie (app = rôle authenticated)
-- ===========================================================================
create or replace function public.nia_live_streams_lifecycle_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Serveur (service_role, SQL Editor), triggers imbriqués, décisions de
  -- modération : pas de contrôle.
  if coalesce(auth.role(), '') <> 'authenticated' or pg_catalog.pg_trigger_depth() > 1
     or coalesce(pg_catalog.current_setting('nia.mod_trusted', true), '') = 'on' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- Direct instantané ou programmé : toujours « scheduled » ; le passage à
    -- « live » vient du webhook LiveKit. Colonnes serveur remises à zéro
    -- (compatible avec createScheduledStream, qui envoie déjà ces valeurs).
    new.status := 'scheduled';
    new.started_at := null;
    new.ended_at := null;
    new.viewer_count := 0;
    new.peak_viewer_count := 0;
    new.provider := null;
    new.provider_stream_id := null;
    new.ended_reason := null;
    new.host_left_at := null;
    return new;
  end if;

  -- UPDATE
  if new.started_at is distinct from old.started_at
     or new.viewer_count is distinct from old.viewer_count
     or new.peak_viewer_count is distinct from old.peak_viewer_count
     or new.provider is distinct from old.provider
     or new.provider_stream_id is distinct from old.provider_stream_id
     or new.host_left_at is distinct from old.host_left_at
     or new.ended_reason is distinct from old.ended_reason then
    raise exception 'live_server_columns_read_only' using errcode = '42501';
  end if;

  if new.status is distinct from old.status then
    if new.status = 'live' then
      raise exception 'live_status_server_only' using errcode = '42501';
    elsif old.status in ('ended', 'cancelled') then
      raise exception 'live_finished' using errcode = '42501';
    elsif not ((old.status = 'scheduled' and new.status in ('cancelled', 'ended'))
               or (old.status = 'live' and new.status = 'ended')) then
      raise exception 'live_status_transition' using errcode = '42501';
    end if;
    -- Fin par l'hôte (bouton « Terminer » ou annulation) : heure du serveur.
    new.ended_at := pg_catalog.now();
    new.ended_reason := case when new.status = 'ended' then 'host' else null end;
    new.viewer_count := 0;
    new.host_left_at := null;
  else
    new.ended_at := old.ended_at;
  end if;
  return new;
end;
$$;

revoke all on function public.nia_live_streams_lifecycle_guard() from public, anon, authenticated;

-- 10 : après live_streams_05_mod_guard (017), avant live_streams_30_keyword_filter (018).
drop trigger if exists live_streams_10_lifecycle_guard on public.live_streams;
create trigger live_streams_10_lifecycle_guard
  before insert or update on public.live_streams
  for each row execute function public.nia_live_streams_lifecycle_guard();

-- ===========================================================================
-- 4. Visibilité : 017 + audience « Abonnés »
-- ===========================================================================
-- Même signature et mêmes garanties que 017 : le créateur et les modérateurs
-- voient tout ; les autres seulement si le live n'est pas annulé, n'est pas
-- masqué (moderation_state = 'visible') et qu'aucun blocage n'existe entre
-- eux ; + public, ou « followers » si l'utilisateur suit le créateur.
create or replace function public.nia_live_row_visible(
  p_owner uuid, p_status text, p_visibility text, p_moderation_state text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (auth.uid() is not null and auth.uid() = p_owner)
      or public.nia_is_moderator()
      or (p_status <> 'cancelled'
          and coalesce(p_moderation_state, 'visible') = 'visible'
          and not public.nia_block_between(p_owner)
          and (coalesce(p_visibility, 'public') = 'public'
               or (p_visibility = 'followers' and public.nia_is_follower(p_owner))));
$$;

revoke all on function public.nia_live_row_visible(uuid, text, text, text) from public;
grant execute on function public.nia_live_row_visible(uuid, text, text, text) to anon, authenticated, service_role;

-- ===========================================================================
-- 5. RPC du webhook LiveKit (service_role uniquement)
-- ===========================================================================
-- Applique UN événement LiveKit déjà vérifié (signature contrôlée par
-- l'Edge Function livekit-webhook). Idempotente : rejouer le même événement
-- ne change rien ; un live terminé ne revient jamais à « live ».
--   p_event       : participant_joined | track_published | participant_left |
--                   participant_connection_aborted | room_started | room_finished
--   p_participant : identité LiveKit (= UUID NIA) ou null
--   p_viewers     : spectateurs connectés hors hôte (null = inconnu)
--   p_event_at    : createdAt de l'événement (sinon now())
--   p_room        : nom de la room
-- Renvoie un code court : unknown_live, went_live, host_back, host_left,
-- ended, held, viewers, noop, finished, finished_host_left, ignored_event.
create or replace function public.live_webhook_apply(
  p_live_id uuid,
  p_event text,
  p_participant text default null,
  p_viewers integer default null,
  p_event_at timestamptz default null,
  p_room text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.live_streams%rowtype;
  v_at timestamptz := least(coalesce(p_event_at, pg_catalog.now()), pg_catalog.now());
  v_host boolean;
  v_viewers integer := case when p_viewers is null then null else greatest(0, p_viewers) end;
  v_out text := 'noop';
begin
  if p_live_id is null or p_event is null then
    return 'ignored_event';
  end if;
  if p_event not in ('participant_joined', 'track_published', 'participant_left',
                     'participant_connection_aborted', 'room_started', 'room_finished') then
    return 'ignored_event';
  end if;

  select * into l from public.live_streams where id = p_live_id for update;
  if not found then
    return 'unknown_live';
  end if;

  v_host := p_participant is not null and pg_catalog.lower(p_participant) = l.user_id::text;

  if l.status in ('ended', 'cancelled') then
    -- L'hôte a terminé depuis l'app : sa déconnexion permet de fermer la room.
    if v_host and p_event in ('participant_left', 'participant_connection_aborted') then
      return 'finished_host_left';
    end if;
    return 'finished';
  end if;

  if p_event = 'room_finished' then
    if l.status = 'live' and (l.started_at is null or v_at >= l.started_at) then
      update public.live_streams
         set status = 'ended', ended_at = greatest(v_at, coalesce(started_at, v_at)),
             ended_reason = 'room_closed', viewer_count = 0, host_left_at = null
       where id = l.id;
      return 'ended';
    end if;
    return 'noop';
  end if;

  if v_host and p_event in ('participant_joined', 'track_published') then
    if l.status = 'scheduled' then
      if l.moderation_state <> 'visible' then
        return 'held';
      end if;
      -- Un seul live « live » par créateur : l'ancien (orphelin) se termine.
      update public.live_streams
         set status = 'ended', ended_at = v_at, ended_reason = 'replaced',
             viewer_count = 0, host_left_at = null
       where user_id = l.user_id and status = 'live' and id <> l.id;
      update public.live_streams
         set status = 'live', started_at = coalesce(started_at, v_at),
             provider = 'livekit', provider_stream_id = coalesce(p_room, provider_stream_id),
             host_left_at = null
       where id = l.id;
      v_out := 'went_live';
    elsif l.host_left_at is not null then
      update public.live_streams set host_left_at = null where id = l.id;
      v_out := 'host_back';
    end if;
  elsif v_host and p_event in ('participant_left', 'participant_connection_aborted') then
    if l.status = 'live' and l.host_left_at is null then
      update public.live_streams set host_left_at = v_at where id = l.id;
      v_out := 'host_left';
    end if;
  end if;

  -- Compteur : recompté par l'Edge Function à chaque événement (idempotent).
  if v_viewers is not null and p_event <> 'room_started' then
    update public.live_streams
       set viewer_count = v_viewers,
           peak_viewer_count = greatest(peak_viewer_count, v_viewers)
     where id = l.id and status = 'live'
       and (viewer_count is distinct from v_viewers or peak_viewer_count < v_viewers);
    if found and v_out = 'noop' then
      v_out := 'viewers';
    end if;
  end if;
  return v_out;
end;
$$;

-- Fin automatique : lives dont l'hôte est parti depuis plus de
-- p_host_grace_seconds, ou en cours depuis plus de p_max_live_seconds.
-- Appelée par livekit-webhook à chaque événement (et, en option, par pg_cron,
-- voir plus bas). Renvoie les lives terminés et leur room (à fermer côté LiveKit).
create or replace function public.live_sweep_stale(
  p_host_grace_seconds integer default 120,
  p_max_live_seconds integer default 14400)
returns table (live_id uuid, room text, reason text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_grace interval := pg_catalog.make_interval(secs => greatest(coalesce(p_host_grace_seconds, 120), 30));
  v_max interval := pg_catalog.make_interval(secs => greatest(coalesce(p_max_live_seconds, 14400), 600));
begin
  return query
  with stale as (
    select s.id,
           case when s.host_left_at is not null and s.host_left_at < pg_catalog.now() - v_grace
                then 'host_timeout' else 'max_duration' end as why
      from public.live_streams s
     where s.status = 'live'
       and ((s.host_left_at is not null and s.host_left_at < pg_catalog.now() - v_grace)
            or (s.started_at is not null and s.started_at < pg_catalog.now() - v_max))
     for update skip locked
  )
  update public.live_streams u
     set status = 'ended', ended_at = pg_catalog.now(), ended_reason = stale.why,
         viewer_count = 0, host_left_at = null
    from stale
   where u.id = stale.id
  returning u.id, coalesce(u.provider_stream_id, 'nia-live-' || u.id::text), stale.why;
end;
$$;

revoke all on function public.live_webhook_apply(uuid, text, text, integer, timestamptz, text) from public, anon, authenticated;
revoke all on function public.live_sweep_stale(integer, integer) from public, anon, authenticated;
grant execute on function public.live_webhook_apply(uuid, text, text, integer, timestamptz, text) to service_role;
grant execute on function public.live_sweep_stale(integer, integer) to service_role;

-- ---------------------------------------------------------------------------
-- Option (NON exécutée) : balayage toutes les 5 min par pg_cron, en plus du
-- webhook. Utile si des spectateurs restent connectés après le départ de
-- l'hôte. À lancer à part, après accord du fondateur :
--   select cron.schedule('nia-live-sweep', '*/5 * * * *', $$select public.live_sweep_stale()$$);
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- Rollback (à exécuter à la main si besoin, dans cet ordre)
-- ===========================================================================
-- drop trigger if exists live_streams_10_lifecycle_guard on public.live_streams;
-- drop function if exists public.nia_live_streams_lifecycle_guard();
-- drop function if exists public.live_webhook_apply(uuid, text, text, integer, timestamptz, text);
-- drop function if exists public.live_sweep_stale(integer, integer);
-- drop index if exists public.live_streams_one_live_per_host_idx;
-- drop index if exists public.live_streams_live_now_idx;
-- alter table public.live_streams drop constraint if exists live_streams_counts_check;
-- alter table public.live_streams drop constraint if exists live_streams_ended_reason_check;
-- nia_live_row_visible : recréer la version de 017 (section 4 de 017, sans la ligne « followers »).
-- Colonnes peak_viewer_count, ended_reason, host_left_at : peuvent rester (inoffensives).
