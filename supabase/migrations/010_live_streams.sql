-- NIA — Live streams V2.3 (préparation uniquement)
-- À exécuter APRÈS 009_events.sql dans Supabase Dashboard → SQL Editor.
-- Idempotent. Pas de streaming réel (Mux / LiveKit) — métadonnées + UI seulement.
-- provider / provider_stream_id restent NULL jusqu’à branchement infra.

-- ---------------------------------------------------------------------------
-- live_streams
-- ---------------------------------------------------------------------------
create table if not exists public.live_streams (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  description text,
  category text not null default 'other'
    check (category in (
      'culture', 'musique', 'sport', 'food',
      'tech', 'education', 'business', 'other'
    )),
  thumbnail_path text,
  visibility text not null default 'public'
    check (visibility in ('public', 'followers', 'private')),
  status text not null default 'scheduled'
    check (status in ('scheduled', 'live', 'ended', 'cancelled')),
  scheduled_at timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  viewer_count integer not null default 0,
  provider text,
  provider_stream_id text,
  created_at timestamptz not null default now()
);

create index if not exists live_streams_status_idx on public.live_streams (status);
create index if not exists live_streams_scheduled_at_idx on public.live_streams (scheduled_at asc nulls last);
create index if not exists live_streams_viewer_count_idx on public.live_streams (viewer_count desc);
create index if not exists live_streams_user_id_idx on public.live_streams (user_id);
create index if not exists live_streams_category_idx on public.live_streams (category);

comment on table public.live_streams is
  'Live stream metadata only (V2.3 prep). No playback URL. provider null until Mux/LiveKit.';
comment on column public.live_streams.provider is
  'Future: mux | livekit | null (not connected yet).';
comment on column public.live_streams.provider_stream_id is
  'Future provider stream/session id. Null until infra is wired.';
comment on column public.live_streams.thumbnail_path is
  'Optional thumbnail in Storage bucket videos under {user_id}/live/…';
comment on column public.live_streams.viewer_count is
  'Display / ranking only until realtime viewer tracking exists.';

-- ---------------------------------------------------------------------------
-- RLS — live_streams
-- ---------------------------------------------------------------------------
alter table public.live_streams enable row level security;

-- Public can see non-cancelled public streams; owners see their own (any status/visibility).
drop policy if exists "live_streams_select_public" on public.live_streams;
create policy "live_streams_select_public"
  on public.live_streams for select
  using (
    (status <> 'cancelled' and visibility = 'public')
    or auth.uid() = user_id
  );

drop policy if exists "live_streams_insert_own" on public.live_streams;
create policy "live_streams_insert_own"
  on public.live_streams for insert
  to authenticated
  with check (
    auth.uid() is not null
    and auth.uid() = user_id
  );

drop policy if exists "live_streams_update_own" on public.live_streams;
create policy "live_streams_update_own"
  on public.live_streams for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "live_streams_delete_own" on public.live_streams;
create policy "live_streams_delete_own"
  on public.live_streams for delete
  to authenticated
  using (auth.uid() = user_id);
