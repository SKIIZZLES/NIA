-- Doubles MINIMAUX des schémas Supabase `auth` et `storage`, pour exécuter
-- 001–014 et les tests sur un Postgres LOCAL jetable. NE JAMAIS exécuter
-- sur un projet Supabase : ces objets y existent déjà et sont gérés par Supabase.
--
-- Reproduit ce dont les migrations et les tests ont besoin :
--   rôles anon / authenticated / service_role, auth.users, auth.uid(),
--   auth.role(), storage.buckets, storage.objects, storage.foldername(),
--   et le trigger storage.protect_delete (migration Storage 0055, copie
--   fidèle) qui fait échouer 013.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

-- Comme sur Supabase : les rôles API peuvent utiliser le schéma public, et les
-- fonctions nouvellement créées y sont exécutables par défaut (d'où les revoke
-- explicites dans les migrations).
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

create table if not exists auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);
-- Colonnes réelles de Supabase Auth utilisées par 017 (app_metadata écrit par
-- l'API admin, suspension).
alter table auth.users add column if not exists raw_app_meta_data jsonb default '{}'::jsonb;
alter table auth.users add column if not exists banned_until timestamptz;

-- Même implémentation que Supabase (claims PostgREST).
create or replace function auth.uid() returns uuid
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create or replace function auth.role() returns text
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;

grant execute on function auth.uid() to anon, authenticated, service_role;
grant execute on function auth.role() to anon, authenticated, service_role;

create schema if not exists storage;
grant usage on schema storage to anon, authenticated, service_role;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text not null,
  owner uuid,
  created_at timestamptz default now(),
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;

create or replace function storage.foldername(name text) returns text[]
language plpgsql immutable as $$
declare
  _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1 : array_length(_parts, 1) - 1];
end
$$;

-- Copie de storage/migrations/tenant/0055-prevent-direct-deletes.sql.
create or replace function storage.protect_delete()
returns trigger
language plpgsql
as $$
begin
    if coalesce(current_setting('storage.allow_delete_query', true), 'false') != 'true' then
        raise exception 'Direct deletion from storage tables is not allowed. Use the Storage API instead.'
            using hint = 'This prevents accidental data loss from orphaned objects.',
                  errcode = '42501';
    end if;
    return null;
end;
$$;

drop trigger if exists protect_objects_delete on storage.objects;
create trigger protect_objects_delete
    before delete on storage.objects
    for each statement
    execute function storage.protect_delete();
