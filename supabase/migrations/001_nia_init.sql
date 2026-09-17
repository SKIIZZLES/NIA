-- NIA — schéma initial (Auth profiles + vidéos + storage)
-- À exécuter dans Supabase Dashboard → SQL Editor (projet gratuit OK).

-- Extensions
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text unique,
  bio text default '',
  avatar_url text default '',
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles_select_public"
  on public.profiles for select
  using (true);

create policy "profiles_insert_own"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- ---------------------------------------------------------------------------
-- videos
-- ---------------------------------------------------------------------------
create table if not exists public.videos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  storage_path text not null,
  caption text default '',
  region text,
  tag text,
  like_count integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists videos_created_at_idx on public.videos (created_at desc);
create index if not exists videos_user_id_idx on public.videos (user_id);

alter table public.videos enable row level security;

create policy "videos_select_public"
  on public.videos for select
  using (true);

create policy "videos_insert_own"
  on public.videos for insert
  with check (auth.uid() = user_id);

create policy "videos_update_own"
  on public.videos for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "videos_delete_own"
  on public.videos for delete
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Trigger : profil à l'inscription
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  handle text;
begin
  handle := coalesce(
    nullif(trim(new.raw_user_meta_data->>'username'), ''),
    split_part(new.email, '@', 1),
    'createur'
  );
  handle := lower(regexp_replace(handle, '[^a-zA-Z0-9._]', '', 'g'));
  if handle = '' then
    handle := 'createur';
  end if;

  insert into public.profiles (id, username, bio, avatar_url)
  values (
    new.id,
    handle,
    'Créateur·rice sur NIA · cultures & talents 🌍',
    coalesce(
      nullif(new.raw_user_meta_data->>'avatar_url', ''),
      'https://i.pravatar.cc/200?u=' || handle
    )
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Storage bucket « videos »
-- (si le bucket existe déjà via le Dashboard, ces INSERT sont no-op / ignorez l'erreur)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'videos',
  'videos',
  true,
  52428800, -- 50 Mo
  array['video/mp4', 'video/quicktime', 'video/webm', 'image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Lecture publique
drop policy if exists "videos_storage_public_read" on storage.objects;
create policy "videos_storage_public_read"
  on storage.objects for select
  using (bucket_id = 'videos');

-- Upload authentifié dans son dossier {user_id}/...
drop policy if exists "videos_storage_insert_own" on storage.objects;
create policy "videos_storage_insert_own"
  on storage.objects for insert
  with check (
    bucket_id = 'videos'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "videos_storage_update_own" on storage.objects;
create policy "videos_storage_update_own"
  on storage.objects for update
  using (
    bucket_id = 'videos'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "videos_storage_delete_own" on storage.objects;
create policy "videos_storage_delete_own"
  on storage.objects for delete
  using (
    bucket_id = 'videos'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
