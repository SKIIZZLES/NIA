-- NIA — Saves / bookmarks (enregistrement de vidéos)
-- À exécuter APRÈS 003_reposts.sql dans Supabase Dashboard → SQL Editor.
-- Idempotent (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).

-- ---------------------------------------------------------------------------
-- videos : save_count
-- ---------------------------------------------------------------------------
alter table public.videos
  add column if not exists save_count integer not null default 0;

-- ---------------------------------------------------------------------------
-- saves : 1 bookmark / user / vidéo
-- ---------------------------------------------------------------------------
create table if not exists public.saves (
  user_id uuid not null references public.profiles (id) on delete cascade,
  video_id uuid not null references public.videos (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, video_id)
);

create index if not exists saves_video_id_idx on public.saves (video_id);
create index if not exists saves_user_id_idx on public.saves (user_id);
create index if not exists saves_created_at_idx on public.saves (created_at desc);

alter table public.saves enable row level security;

drop policy if exists "saves_select_public" on public.saves;
create policy "saves_select_public"
  on public.saves for select
  using (true);

drop policy if exists "saves_insert_own" on public.saves;
create policy "saves_insert_own"
  on public.saves for insert
  with check (auth.uid() = user_id);

drop policy if exists "saves_delete_own" on public.saves;
create policy "saves_delete_own"
  on public.saves for delete
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Trigger : bump save_count
-- ---------------------------------------------------------------------------
create or replace function public.bump_video_save_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.videos
      set save_count = coalesce(save_count, 0) + 1
      where id = new.video_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.videos
      set save_count = greatest(0, coalesce(save_count, 0) - 1)
      where id = old.video_id;
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists on_save_bump_count on public.saves;
create trigger on_save_bump_count
  after insert or delete on public.saves
  for each row execute function public.bump_video_save_count();
