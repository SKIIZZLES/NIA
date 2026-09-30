-- Vérification APRÈS application de 022 (lecture seule : à coller dans le
-- SQL Editor de Supabase). Chaque ligne doit afficher ok = true.
-- N'exécute pas la RPC et ne lit aucune donnée d'utilisateur (catalogue
-- uniquement).
with checks(name, ok) as (
  values
  ('RPC delete_own_video_for_good(uuid) : security definer, search_path vide, renvoie jsonb',
    (select count(*) = 1 from pg_proc p
      where p.oid = to_regprocedure('public.delete_own_video_for_good(uuid)')
        and p.prosecdef
        and p.provolatile = 'v'
        and p.prorettype = 'jsonb'::regtype
        and p.proconfig @> array['search_path=""'])),
  ('RPC exécutable par authenticated seulement (ni anon, ni PUBLIC, ni service_role)',
    (select has_function_privilege('authenticated', 'public.delete_own_video_for_good(uuid)', 'execute')
        and not has_function_privilege('anon', 'public.delete_own_video_for_good(uuid)', 'execute')
        and not has_function_privilege('service_role', 'public.delete_own_video_for_good(uuid)', 'execute')
        and not exists (select 1 from pg_proc p, aclexplode(p.proacl) x
                         where p.oid = to_regprocedure('public.delete_own_video_for_good(uuid)')
                           and x.grantee = 0))),
  ('RPC : comptage sans filtre de visibilité, sur storage_path ET cover_path, garde de modération',
    (select p.prosrc like '%o.storage_path = v_path or o.cover_path = v_path%'
        and p.prosrc like '%for update%'
        and p.prosrc like '%moderation_state = ''visible''%'
        and p.prosrc not like '%nia_video_row_visible%'
        and p.prosrc not like '%storage.objects%'
       from pg_proc p where p.oid = to_regprocedure('public.delete_own_video_for_good(uuid)'))),
  ('index de recherche des références (storage_path, cover_path)',
    (select count(*) = 2 from pg_indexes
      where schemaname = 'public' and tablename = 'videos'
        and indexname in ('videos_storage_path_idx', 'videos_cover_path_idx'))),
  ('015 soft_delete_own_video toujours là et exécutable par authenticated',
    (select has_function_privilege('authenticated', 'public.soft_delete_own_video(uuid)', 'execute')
        and not has_function_privilege('anon', 'public.soft_delete_own_video(uuid)', 'execute'))),
  ('014 delete_own_account inchangée : efface toujours les reposts faits par d''autres',
    (select p.prosecdef and p.prosrc like '%repost_of%' and p.prosrc like '%storage_purge_jobs%'
       from pg_proc p where p.oid = to_regprocedure('public.delete_own_account()'))),
  ('017 videos_delete_own intacte (propriétaire + vidéo visible)',
    (select count(*) = 1 from pg_policies
      where schemaname = 'public' and tablename = 'videos' and policyname = 'videos_delete_own'
        and cmd = 'DELETE' and qual like '%auth.uid() = user_id%'
        and qual like '%moderation_state = ''visible''%')),
  ('016/017 videos_select_public intacte (visibilité + modération + blocage)',
    (select count(*) = 1 from pg_policies
      where schemaname = 'public' and tablename = 'videos' and policyname = 'videos_select_public'
        and qual like '%nia_video_row_visible%' and qual like '%moderation_state%'
        and qual like '%nia_block_between%' and qual like '%nia_is_moderator%')),
  ('017 videos_storage_delete_own intacte (dossier du compte, fichier non retenu)',
    (select count(*) = 1 from pg_policies
      where schemaname = 'storage' and tablename = 'objects' and policyname = 'videos_storage_delete_own'
        and qual like '%foldername%' and qual like '%nia_storage_path_on_hold%')),
  ('triggers de videos de 017 / 018 toujours en place',
    (select count(*) = 3 from pg_trigger
      where tgrelid = 'public.videos'::regclass and not tgisinternal
        and tgname in ('videos_10_guard', 'videos_20_moderation_files', 'videos_30_keyword_filter'))),
  ('repost_of : clé étrangère on delete set null (le repost survit à l''original)',
    (select count(*) = 1 from pg_constraint
      where conrelid = 'public.videos'::regclass and contype = 'f' and confdeltype = 'n'
        and confrelid = 'public.videos'::regclass
        and conkey = array[(select attnum from pg_attribute
                             where attrelid = 'public.videos'::regclass and attname = 'repost_of')]::smallint[]))
)
select name, coalesce(ok, false) as ok from checks;
