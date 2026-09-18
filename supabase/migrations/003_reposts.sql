-- NIA — Reposts / republications (feed « a republié »)
-- À exécuter APRÈS 002_sprint1_engagement.sql dans Supabase Dashboard → SQL Editor.
-- Idempotent (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).

-- ---------------------------------------------------------------------------
-- videos : repost_of (pointeur vers l’original) + share_count
-- ---------------------------------------------------------------------------
alter table public.videos
  add column if not exists repost_of uuid references public.videos (id) on delete set null;

alter table public.videos
  add column if not exists share_count integer not null default 0;

create index if not exists videos_repost_of_idx on public.videos (repost_of)
  where repost_of is not null;

-- ---------------------------------------------------------------------------
-- reposts : table canonique (1 republish / user / vidéo originale)
-- ---------------------------------------------------------------------------
create table if not exists public.reposts (
  user_id uuid not null references public.profiles (id) on delete cascade,
  video_id uuid not null references public.videos (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, video_id)
);

create index if not exists reposts_video_id_idx on public.reposts (video_id);
create index if not exists reposts_user_id_idx on public.reposts (user_id);
create index if not exists reposts_created_at_idx on public.reposts (created_at desc);

alter table public.reposts enable row level security;

drop policy if exists "reposts_select_public" on public.reposts;
create policy "reposts_select_public"
  on public.reposts for select
  using (true);

drop policy if exists "reposts_insert_own" on public.reposts;
create policy "reposts_insert_own"
  on public.reposts for insert
  with check (auth.uid() = user_id);

drop policy if exists "reposts_delete_own" on public.reposts;
create policy "reposts_delete_own"
  on public.reposts for delete
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Trigger : bump share_count on original video
-- ---------------------------------------------------------------------------
create or replace function public.handle_repost_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.videos
      set share_count = coalesce(share_count, 0) + 1
      where id = new.video_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.videos
      set share_count = greatest(0, coalesce(share_count, 0) - 1)
      where id = old.video_id;
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists on_repost_count on public.reposts;
create trigger on_repost_count
  after insert or delete on public.reposts
  for each row execute function public.handle_repost_count();
