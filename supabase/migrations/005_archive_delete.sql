-- NIA — Soft delete + archive (owner actions)
-- À exécuter APRÈS 004_saves.sql dans Supabase Dashboard → SQL Editor.
-- Idempotent.

-- ---------------------------------------------------------------------------
-- Extend status enum-like check: add 'deleted'
-- (archived already exists from 002)
-- ---------------------------------------------------------------------------
alter table public.videos drop constraint if exists videos_status_check;
alter table public.videos
  add constraint videos_status_check
  check (status in (
    'draft',
    'processing',
    'published',
    'rejected',
    'archived',
    'deleted'
  ));

-- ---------------------------------------------------------------------------
-- Public SELECT: published for everyone; owner sees own non-deleted rows
-- (deleted soft-hidden from all clients via RLS)
-- ---------------------------------------------------------------------------
drop policy if exists "videos_select_public" on public.videos;
create policy "videos_select_public"
  on public.videos for select
  using (
    status = 'published'
    or (
      auth.uid() = user_id
      and status is distinct from 'deleted'
    )
  );

-- Owner update / delete policies already exist (videos_update_own / videos_delete_own).
-- Soft delete & archive are UPDATEs to status — covered by videos_update_own.
