-- NIA — Events (Événements) V2.2
-- À exécuter APRÈS 008_sounds.sql dans Supabase Dashboard → SQL Editor.
-- Idempotent. Pas de données fictives.

-- ---------------------------------------------------------------------------
-- events
-- ---------------------------------------------------------------------------
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  cover_path text,
  location_text text,
  city text,
  country text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  category text not null default 'other'
    check (category in (
      'culture', 'musique', 'sport', 'food',
      'tech', 'education', 'business', 'other'
    )),
  created_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists events_starts_at_idx on public.events (starts_at asc);
create index if not exists events_category_idx on public.events (category);
create index if not exists events_created_by_idx on public.events (created_by);
create index if not exists events_city_idx on public.events (city);

comment on table public.events is
  'Community events (concerts, meetups, culture). Organizer = created_by → profiles.';
comment on column public.events.cover_path is
  'Optional cover image path in Storage bucket videos under {user_id}/events/…';
comment on column public.events.category is
  'culture | musique | sport | food | tech | education | business | other';

-- ---------------------------------------------------------------------------
-- event_attendees
-- ---------------------------------------------------------------------------
create table if not exists public.event_attendees (
  event_id uuid not null references public.events (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'going'
    check (status in ('going', 'interested')),
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

create index if not exists event_attendees_user_id_idx
  on public.event_attendees (user_id);
create index if not exists event_attendees_event_id_idx
  on public.event_attendees (event_id);

comment on table public.event_attendees is
  'RSVP: going | interested. PK (event_id, user_id).';

-- ---------------------------------------------------------------------------
-- videos.event_id nullable FK (optional link video → event)
-- ---------------------------------------------------------------------------
alter table public.videos
  add column if not exists event_id uuid references public.events (id) on delete set null;

create index if not exists videos_event_id_idx on public.videos (event_id)
  where event_id is not null;

comment on column public.videos.event_id is
  'Optional linked event. Null = not tied to an event.';

-- ---------------------------------------------------------------------------
-- RLS — events
-- ---------------------------------------------------------------------------
alter table public.events enable row level security;

drop policy if exists "events_select_public" on public.events;
create policy "events_select_public"
  on public.events for select
  using (true);

drop policy if exists "events_insert_own" on public.events;
create policy "events_insert_own"
  on public.events for insert
  to authenticated
  with check (
    auth.uid() is not null
    and auth.uid() = created_by
  );

drop policy if exists "events_update_own" on public.events;
create policy "events_update_own"
  on public.events for update
  to authenticated
  using (auth.uid() = created_by)
  with check (auth.uid() = created_by);

drop policy if exists "events_delete_own" on public.events;
create policy "events_delete_own"
  on public.events for delete
  to authenticated
  using (auth.uid() = created_by);

-- ---------------------------------------------------------------------------
-- RLS — event_attendees
-- ---------------------------------------------------------------------------
alter table public.event_attendees enable row level security;

drop policy if exists "event_attendees_select_public" on public.event_attendees;
create policy "event_attendees_select_public"
  on public.event_attendees for select
  using (true);

drop policy if exists "event_attendees_insert_own" on public.event_attendees;
create policy "event_attendees_insert_own"
  on public.event_attendees for insert
  to authenticated
  with check (
    auth.uid() is not null
    and auth.uid() = user_id
  );

drop policy if exists "event_attendees_update_own" on public.event_attendees;
create policy "event_attendees_update_own"
  on public.event_attendees for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "event_attendees_delete_own" on public.event_attendees;
create policy "event_attendees_delete_own"
  on public.event_attendees for delete
  to authenticated
  using (auth.uid() = user_id);
