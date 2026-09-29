-- NIA — Suppression de compte par l'utilisateur (exigence Google Play).
-- À exécuter APRÈS 012_filters.sql dans Supabase Dashboard → SQL Editor.
-- Idempotent.
--
-- Pourquoi une fonction `security definer` et pas un simple delete client :
-- un client authentifié ne peut pas supprimer sa propre ligne dans
-- `auth.users`. La fonction s'exécute avec les droits de son propriétaire
-- (postgres via l'éditeur SQL), ce qui permet la suppression, puis la cascade
-- fait le reste.
--
-- Chaîne de cascade vérifiée dans les migrations existantes :
--   auth.users → public.profiles (001, on delete cascade)
--   public.profiles → videos, likes, comments, follows, notifications,
--                     reports, blocks, reposts, saves, sounds, events,
--                     event_attendees, live_streams, series
--                     (001 à 011, tous en on delete cascade)
-- Seul `notifications.actor_id` est en `on delete set null` : les
-- notifications reçues par d'autres perdent leur auteur sans disparaître.
--
-- Les fichiers du bucket `videos` ne sont couverts par aucune cascade : ils
-- sont supprimés explicitement ci-dessous. Convention de chemin posée par
-- lib/videos.ts : `{user_id}/{upload_id}.{ext}`.

create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'delete_own_account: aucun utilisateur authentifie'
      using errcode = '28000';
  end if;

  -- 1. Fichiers du bucket `videos` appartenant a l'utilisateur.
  delete from storage.objects
   where bucket_id = 'videos'
     and (storage.foldername(name))[1] = uid::text;

  -- 2. Le compte lui-meme. La cascade efface profil, videos, interactions.
  delete from auth.users where id = uid;
end;
$$;

-- Seul un utilisateur authentifie peut l'appeler, et uniquement pour lui-meme
-- (la fonction ne prend aucun parametre : elle lit auth.uid()).
revoke all on function public.delete_own_account() from public;
revoke all on function public.delete_own_account() from anon;
grant execute on function public.delete_own_account() to authenticated;
