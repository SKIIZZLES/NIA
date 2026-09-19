-- NIA — Sounds (Sons) V2.1
-- À exécuter APRÈS 007_media_type_cover.sql dans Supabase Dashboard → SQL Editor.
-- Idempotent. User-uploaded / original audio only — NO commercial music catalog.
--
-- Storage: extends existing public bucket `videos` with audio MIME types
-- (audio/mpeg, audio/mp4, audio/wav, audio/x-m4a, audio/aac).
-- Paths: {user_id}/sounds/{timestamp}.{ext}

-- ---------------------------------------------------------------------------
-- sounds table
-- ---------------------------------------------------------------------------
create table if not exists public.sounds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  storage_path text not null,
  duration_ms integer,
  use_count integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists sounds_user_id_idx on public.sounds (user_id);
create index if not exists sounds_created_at_idx on public.sounds (created_at desc);
create index if not exists sounds_use_count_idx on public.sounds (use_count desc);

comment on table public.sounds is
  'User-uploaded / original sounds only. No licensed commercial catalog.';
comment on column public.sounds.storage_path is
  'Path in Storage bucket videos under {user_id}/sounds/…';
comment on column public.sounds.use_count is
  'How many times this sound has been attached / used on publish.';

-- ---------------------------------------------------------------------------
-- videos.sound_id nullable FK
-- ---------------------------------------------------------------------------
alter table public.videos
  add column if not exists sound_id uuid references public.sounds (id) on delete set null;

create index if not exists videos_sound_id_idx on public.videos (sound_id)
  where sound_id is not null;

comment on column public.videos.sound_id is
  'Optional linked sound (user-uploaded). Null = no attached sound.';

-- ---------------------------------------------------------------------------
-- RLS on sounds
-- ---------------------------------------------------------------------------
alter table public.sounds enable row level security;

drop policy if exists "sounds_select_public" on public.sounds;
create policy "sounds_select_public"
  on public.sounds for select
  using (true);

drop policy if exists "sounds_insert_own" on public.sounds;
create policy "sounds_insert_own"
  on public.sounds for insert
  to authenticated
  with check (
    auth.uid() is not null
    and auth.uid() = user_id
  );

drop policy if exists "sounds_update_own" on public.sounds;
create policy "sounds_update_own"
  on public.sounds for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "sounds_delete_own" on public.sounds;
create policy "sounds_delete_own"
  on public.sounds for delete
  to authenticated
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Storage: allow audio MIME on bucket `videos`
-- Existing object policies already allow authenticated upload under {auth.uid()}/…
-- ---------------------------------------------------------------------------
update storage.buckets
set allowed_mime_types = array[
  'video/mp4', 'video/quicktime', 'video/webm',
  'image/jpeg', 'image/png', 'image/webp',
  'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/x-wav',
  'audio/x-m4a', 'audio/aac', 'audio/m4a'
]
where id = 'videos';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'videos',
  'videos',
  true,
  52428800,
  array[
    'video/mp4', 'video/quicktime', 'video/webm',
    'image/jpeg', 'image/png', 'image/webp',
    'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/x-wav',
    'audio/x-m4a', 'audio/aac', 'audio/m4a'
  ]
)
on conflict (id) do nothing;
