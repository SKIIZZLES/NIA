-- NIA — Sprint 1 engagement (profiles/videos extensions + likes/comments/follows/…)
-- À exécuter APRÈS 001_nia_init.sql dans Supabase Dashboard → SQL Editor (plan Free OK).
-- Idempotent autant que possible (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).

-- ---------------------------------------------------------------------------
-- profiles : display_name
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists display_name text;

-- ---------------------------------------------------------------------------
-- videos : thumbnail_url, status, category, hashtags
-- ---------------------------------------------------------------------------
alter table public.videos
  add column if not exists thumbnail_url text;

alter table public.videos
  add column if not exists status text not null default 'published';

alter table public.videos
  add column if not exists category text;

alter table public.videos
  add column if not exists hashtags text[];

-- Contrainte status (drop + recreate pour idempotence)
alter table public.videos drop constraint if exists videos_status_check;
alter table public.videos
  add constraint videos_status_check
  check (status in ('draft', 'processing', 'published', 'rejected', 'archived'));

create index if not exists videos_category_idx on public.videos (category);
create index if not exists videos_status_idx on public.videos (status);
create index if not exists videos_hashtags_gin_idx on public.videos using gin (hashtags);

-- ---------------------------------------------------------------------------
-- likes
-- ---------------------------------------------------------------------------
create table if not exists public.likes (
  user_id uuid not null references public.profiles (id) on delete cascade,
  video_id uuid not null references public.videos (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, video_id)
);

create index if not exists likes_video_id_idx on public.likes (video_id);
create index if not exists likes_user_id_idx on public.likes (user_id);

alter table public.likes enable row level security;

drop policy if exists "likes_select_public" on public.likes;
create policy "likes_select_public"
  on public.likes for select
  using (true);

drop policy if exists "likes_insert_own" on public.likes;
create policy "likes_insert_own"
  on public.likes for insert
  with check (auth.uid() = user_id);

drop policy if exists "likes_delete_own" on public.likes;
create policy "likes_delete_own"
  on public.likes for delete
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- comments
-- ---------------------------------------------------------------------------
create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists comments_video_id_idx on public.comments (video_id, created_at desc);
create index if not exists comments_user_id_idx on public.comments (user_id);

alter table public.comments enable row level security;

drop policy if exists "comments_select_public" on public.comments;
create policy "comments_select_public"
  on public.comments for select
  using (true);

drop policy if exists "comments_insert_own" on public.comments;
create policy "comments_insert_own"
  on public.comments for insert
  with check (auth.uid() = user_id);

drop policy if exists "comments_update_own" on public.comments;
create policy "comments_update_own"
  on public.comments for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "comments_delete_own" on public.comments;
create policy "comments_delete_own"
  on public.comments for delete
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- follows
-- ---------------------------------------------------------------------------
create table if not exists public.follows (
  follower_id uuid not null references public.profiles (id) on delete cascade,
  following_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  constraint follows_no_self check (follower_id <> following_id)
);

create index if not exists follows_following_id_idx on public.follows (following_id);
create index if not exists follows_follower_id_idx on public.follows (follower_id);

alter table public.follows enable row level security;

drop policy if exists "follows_select_public" on public.follows;
create policy "follows_select_public"
  on public.follows for select
  using (true);

drop policy if exists "follows_insert_own" on public.follows;
create policy "follows_insert_own"
  on public.follows for insert
  with check (auth.uid() = follower_id);

drop policy if exists "follows_delete_own" on public.follows;
create policy "follows_delete_own"
  on public.follows for delete
  using (auth.uid() = follower_id);

-- ---------------------------------------------------------------------------
-- notifications
-- ---------------------------------------------------------------------------
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  type text not null,
  video_id uuid references public.videos (id) on delete set null,
  body text default '',
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_id_idx
  on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists "notifications_select_own" on public.notifications;
create policy "notifications_select_own"
  on public.notifications for select
  using (auth.uid() = user_id);

drop policy if exists "notifications_update_own" on public.notifications;
create policy "notifications_update_own"
  on public.notifications for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Inserts via triggers (security definer) — pas d'insert client direct en MVP
drop policy if exists "notifications_insert_system" on public.notifications;
create policy "notifications_insert_system"
  on public.notifications for insert
  with check (auth.uid() = user_id or auth.uid() = actor_id);

-- ---------------------------------------------------------------------------
-- reports
-- ---------------------------------------------------------------------------
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  target_type text not null,
  target_id uuid not null,
  reason text not null default '',
  status text not null default 'open',
  created_at timestamptz not null default now(),
  constraint reports_target_type_check
    check (target_type in ('video', 'user', 'comment')),
  constraint reports_status_check
    check (status in ('open', 'reviewed', 'dismissed'))
);

create index if not exists reports_reporter_id_idx on public.reports (reporter_id);
create index if not exists reports_status_idx on public.reports (status);

alter table public.reports enable row level security;

drop policy if exists "reports_insert_own" on public.reports;
create policy "reports_insert_own"
  on public.reports for insert
  with check (auth.uid() = reporter_id);

drop policy if exists "reports_select_own" on public.reports;
create policy "reports_select_own"
  on public.reports for select
  using (auth.uid() = reporter_id);

-- ---------------------------------------------------------------------------
-- blocks
-- ---------------------------------------------------------------------------
create table if not exists public.blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint blocks_no_self check (blocker_id <> blocked_id)
);

create index if not exists blocks_blocked_id_idx on public.blocks (blocked_id);

alter table public.blocks enable row level security;

drop policy if exists "blocks_select_own" on public.blocks;
create policy "blocks_select_own"
  on public.blocks for select
  using (auth.uid() = blocker_id);

drop policy if exists "blocks_insert_own" on public.blocks;
create policy "blocks_insert_own"
  on public.blocks for insert
  with check (auth.uid() = blocker_id);

drop policy if exists "blocks_delete_own" on public.blocks;
create policy "blocks_delete_own"
  on public.blocks for delete
  using (auth.uid() = blocker_id);

-- ---------------------------------------------------------------------------
-- Trigger : maintenir videos.like_count
-- ---------------------------------------------------------------------------
create or replace function public.bump_video_like_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.videos
      set like_count = like_count + 1
      where id = new.video_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.videos
      set like_count = greatest(0, like_count - 1)
      where id = old.video_id;
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists on_like_bump_count on public.likes;
create trigger on_like_bump_count
  after insert or delete on public.likes
  for each row execute function public.bump_video_like_count();

-- ---------------------------------------------------------------------------
-- Triggers stubs : notifications like / comment / follow (nice-to-have)
-- ---------------------------------------------------------------------------
create or replace function public.notify_on_like()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_id uuid;
begin
  select user_id into owner_id from public.videos where id = new.video_id;
  if owner_id is null or owner_id = new.user_id then
    return new;
  end if;
  insert into public.notifications (user_id, actor_id, type, video_id, body)
  values (owner_id, new.user_id, 'like', new.video_id, 'a aimé votre vidéo');
  return new;
end;
$$;

drop trigger if exists on_like_notify on public.likes;
create trigger on_like_notify
  after insert on public.likes
  for each row execute function public.notify_on_like();

create or replace function public.notify_on_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_id uuid;
begin
  select user_id into owner_id from public.videos where id = new.video_id;
  if owner_id is null or owner_id = new.user_id then
    return new;
  end if;
  insert into public.notifications (user_id, actor_id, type, video_id, body)
  values (
    owner_id,
    new.user_id,
    'comment',
    new.video_id,
    left(coalesce(new.body, ''), 120)
  );
  return new;
end;
$$;

drop trigger if exists on_comment_notify on public.comments;
create trigger on_comment_notify
  after insert on public.comments
  for each row execute function public.notify_on_comment();

create or replace function public.notify_on_follow()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.following_id = new.follower_id then
    return new;
  end if;
  insert into public.notifications (user_id, actor_id, type, video_id, body)
  values (new.following_id, new.follower_id, 'follow', null, 'a commencé à vous suivre');
  return new;
end;
$$;

drop trigger if exists on_follow_notify on public.follows;
create trigger on_follow_notify
  after insert on public.follows
  for each row execute function public.notify_on_follow();
