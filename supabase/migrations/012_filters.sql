-- NIA — Filters V2.6
-- À exécuter APRÈS 011_series.sql dans Supabase Dashboard → SQL Editor.
-- Idempotent. Optional filter_id text on videos — no binary filter assets.
--
-- Honesty: app stores the registry id (e.g. 'nia-ocre'). Preview uses color
-- overlays / approximate matrices. True LUT / AR face mesh = V3 (native SDK).

-- ---------------------------------------------------------------------------
-- videos.filter_id (nullable text)
-- ---------------------------------------------------------------------------
alter table public.videos
  add column if not exists filter_id text;

create index if not exists videos_filter_id_idx on public.videos (filter_id)
  where filter_id is not null;

comment on column public.videos.filter_id is
  'Optional NIA filter registry id (constants/filters.ts). Null = no filter. No binary assets.';
