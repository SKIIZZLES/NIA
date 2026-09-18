-- NIA — Fix videos RLS (INSERT own + SELECT/UPDATE/DELETE)
-- À exécuter APRÈS 005_archive_delete.sql dans Supabase Dashboard → SQL Editor.
-- Idempotent: drop + recreate. Does NOT disable RLS.
--
-- Root cause of publish failure ("new row violates row-level security policy"):
-- INSERT into public.videos was blocked when insert policy was missing / stale,
-- or when INSERT…RETURNING could not see the new row under SELECT RLS.
-- Column for creator is user_id (FK → profiles.id), NOT creator_id.

alter table public.videos enable row level security;

-- ---------------------------------------------------------------------------
-- Drop all known videos row policies (recreate below)
-- ---------------------------------------------------------------------------
drop policy if exists "videos_select_public" on public.videos;
drop policy if exists "videos_insert_own" on public.videos;
drop policy if exists "videos_update_own" on public.videos;
drop policy if exists "videos_delete_own" on public.videos;

-- ---------------------------------------------------------------------------
-- SELECT: published visible to everyone; owner sees own non-deleted
-- (same semantics as 005)
-- ---------------------------------------------------------------------------
create policy "videos_select_public"
  on public.videos for select
  using (
    status = 'published'
    or (
      auth.uid() = user_id
      and status is distinct from 'deleted'
    )
  );

-- ---------------------------------------------------------------------------
-- INSERT: only authenticated creator, user_id must equal auth.uid()
-- ---------------------------------------------------------------------------
create policy "videos_insert_own"
  on public.videos for insert
  to authenticated
  with check (
    auth.uid() IS NOT NULL
    and auth.uid() = user_id
  );

-- ---------------------------------------------------------------------------
-- UPDATE / DELETE: owner only (archive / soft-delete / restore via status)
-- ---------------------------------------------------------------------------
create policy "videos_update_own"
  on public.videos for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "videos_delete_own"
  on public.videos for delete
  to authenticated
  using (auth.uid() = user_id);
