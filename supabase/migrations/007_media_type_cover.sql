-- NIA — media_type + cover_path for photo/cover display fix
-- À exécuter APRÈS 006_videos_rls_insert.sql dans Supabase Dashboard → SQL Editor.
-- Idempotent. Does NOT change RLS.
--
-- Root cause: thumbnail_url was often set to the media public URL (including .mp4).
-- Profile / discover grids use <Image source={{ uri: thumbnailUrl }}>, so video URLs
-- fail silently (blank tiles). Feed VideoCard always used VideoView even for photos.
--
-- Fix:
--   media_type  'video' | 'image'  — drives feed renderer + grid heuristics
--   cover_path  optional still path in bucket `videos` (cover / poster)
--   thumbnail_url must be an IMAGE URL (or null). Never a .mp4/.mov/.webm URL.

alter table public.videos
  add column if not exists media_type text not null default 'video';

alter table public.videos
  add column if not exists cover_path text;

-- Constrain media_type (drop + recreate so re-runs are safe)
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'videos_media_type_check'
      and conrelid = 'public.videos'::regclass
  ) then
    alter table public.videos
      add constraint videos_media_type_check
      check (media_type in ('video', 'image'));
  end if;
end $$;

comment on column public.videos.media_type is
  'video | image — feed uses VideoView vs Image; grids never Image-load video URLs';
comment on column public.videos.cover_path is
  'Optional still in storage bucket videos (poster). thumbnail_url should be its public URL.';

-- Best-effort backfill: rows whose storage_path looks like an image → media_type=image
update public.videos
set media_type = 'image'
where media_type = 'video'
  and (
    storage_path ~* '\.(jpe?g|png|webp|gif)$'
    or thumbnail_url ~* '\.(jpe?g|png|webp|gif)(\?|$)'
  );

-- Clear thumbnail_url when it points at a video file (forces placeholder until cover exists)
update public.videos
set thumbnail_url = null
where thumbnail_url is not null
  and thumbnail_url ~* '\.(mp4|m4v|mov|webm|qt)(\?|$)';
