-- NIA — Series (Séries) V2.5
-- À exécuter APRÈS 010_live_streams.sql dans Supabase Dashboard → SQL Editor.
-- Idempotent. Pas de données fictives.
-- Lien vidéo↔série via series_items uniquement (pas de videos.series_id).

-- ---------------------------------------------------------------------------
-- series
-- ---------------------------------------------------------------------------
create table if not exists public.series (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  description text,
  cover_path text,
  created_at timestamptz not null default now()
);

create index if not exists series_user_id_idx on public.series (user_id);
create index if not exists series_created_at_idx on public.series (created_at desc);

comment on table public.series is
  'Creator video series (ordered episodes). Owner = user_id → profiles.';
comment on column public.series.cover_path is
  'Optional cover image path in Storage bucket videos under {user_id}/series/…';

-- ---------------------------------------------------------------------------
-- series_items (junction: ordered episodes)
-- ---------------------------------------------------------------------------
create table if not exists public.series_items (
  series_id uuid not null references public.series (id) on delete cascade,
  video_id uuid not null references public.videos (id) on delete cascade,
  position int not null check (position >= 1),
  created_at timestamptz not null default now(),
  primary key (series_id, video_id)
);

-- Soft unique on position within a series (enforce in app; DB unique prevents dupes)
create unique index if not exists series_items_series_id_position_uidx
  on public.series_items (series_id, position);

create index if not exists series_items_video_id_idx on public.series_items (video_id);
create index if not exists series_items_series_id_position_idx
  on public.series_items (series_id, position asc);

comment on table public.series_items is
  'Ordered episodes in a series. PK (series_id, video_id); unique (series_id, position).';

-- ---------------------------------------------------------------------------
-- RLS — series
-- ---------------------------------------------------------------------------
alter table public.series enable row level security;

drop policy if exists "series_select_public" on public.series;
create policy "series_select_public"
  on public.series for select
  using (true);

drop policy if exists "series_insert_own" on public.series;
create policy "series_insert_own"
  on public.series for insert
  to authenticated
  with check (
    auth.uid() is not null
    and auth.uid() = user_id
  );

drop policy if exists "series_update_own" on public.series;
create policy "series_update_own"
  on public.series for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "series_delete_own" on public.series;
create policy "series_delete_own"
  on public.series for delete
  to authenticated
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- RLS — series_items (write = series owner)
-- ---------------------------------------------------------------------------
alter table public.series_items enable row level security;

drop policy if exists "series_items_select_public" on public.series_items;
create policy "series_items_select_public"
  on public.series_items for select
  using (true);

drop policy if exists "series_items_insert_own" on public.series_items;
create policy "series_items_insert_own"
  on public.series_items for insert
  to authenticated
  with check (
    auth.uid() is not null
    and exists (
      select 1 from public.series s
      where s.id = series_id and s.user_id = auth.uid()
    )
  );

drop policy if exists "series_items_update_own" on public.series_items;
create policy "series_items_update_own"
  on public.series_items for update
  to authenticated
  using (
    exists (
      select 1 from public.series s
      where s.id = series_id and s.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.series s
      where s.id = series_id and s.user_id = auth.uid()
    )
  );

drop policy if exists "series_items_delete_own" on public.series_items;
create policy "series_items_delete_own"
  on public.series_items for delete
  to authenticated
  using (
    exists (
      select 1 from public.series s
      where s.id = series_id and s.user_id = auth.uid()
    )
  );
