-- NIA — 015 : suppression (soft delete) d'une vidéo par son propriétaire
-- À exécuter APRÈS 014. Idempotent.
--
-- Problème : setVideoStatus() fait UPDATE videos SET status='deleted' via
-- PostgREST, qui renvoie toujours la ligne (RETURNING). La nouvelle ligne doit
-- alors passer la policy SELECT `videos_select_public` (005/006), qui masque
-- status='deleted' même au propriétaire → erreur 42501, la suppression échoue.
--
-- Correctif : RPC security definer, limitée au propriétaire (auth.uid()).
-- Aucune policy RLS existante n'est modifiée.

create or replace function public.soft_delete_own_video(p_video_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_count integer;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  update public.videos
     set status = 'deleted'
   where id = p_video_id
     and user_id = v_uid
     and status is distinct from 'deleted';

  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;

revoke all on function public.soft_delete_own_video(uuid) from public, anon;
grant execute on function public.soft_delete_own_video(uuid) to authenticated;
