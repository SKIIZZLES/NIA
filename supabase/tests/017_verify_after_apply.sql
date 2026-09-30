-- Vérification APRÈS application de 017 (lecture seule : à coller dans le
-- SQL Editor de Supabase). Chaque ligne doit afficher ok = true.
with checks(name, ok) as (
  values
  ('tables moderators, report_evidence, moderation_file_holds (RLS active)',
    (select count(*) = 3 from pg_class
      where relnamespace = 'public'::regnamespace and relrowsecurity
        and relname in ('moderators', 'report_evidence', 'moderation_file_holds'))),
  ('colonnes de modération (videos, comments, live_streams, profiles, notifications)',
    (select count(*) = 7 from information_schema.columns
      where table_schema = 'public'
        and (table_name, column_name) in (
          ('videos', 'moderation_state'), ('videos', 'moderation_reason'),
          ('comments', 'moderation_state'), ('live_streams', 'moderation_state'),
          ('profiles', 'suspended_at'), ('profiles', 'suspended_until'),
          ('notifications', 'meta')))),
  ('colonnes reports v2',
    (select count(*) = 10 from information_schema.columns
      where table_schema = 'public' and table_name = 'reports'
        and column_name in ('category', 'priority', 'details', 'target_snapshot', 'legal_status',
                            'legal_ref', 'resolution', 'resolved_by', 'resolved_at', 'auto_hidden'))),
  ('reports : 10 catégories, cibles live, un seul signalement ouvert par cible',
    ((select count(*) from pg_constraint
       where conrelid = 'public.reports'::regclass
         and (conname = 'reports_category_check'
              or (conname = 'reports_target_type_check' and pg_get_constraintdef(oid) like '%live%')))
     + (select count(*) from pg_indexes where schemaname = 'public' and indexname = 'reports_open_unique_idx')) = 3),
  ('reports : le signaleur supprimé devient anonyme (FK set null)',
    (select bool_and(confdeltype = 'n') from pg_constraint
      where conrelid = 'public.reports'::regclass and contype = 'f'
        and conkey = array[(select attnum from pg_attribute
                             where attrelid = 'public.reports'::regclass and attname = 'reporter_id')]::smallint[])),
  ('triggers de garde (videos, comments, profiles, live_streams, blocks, reports)',
    (select count(*) = 9 from pg_trigger
      where not tgisinternal and tgname in (
        'videos_10_guard', 'videos_20_moderation_files', 'comments_10_guard', 'profiles_10_guard',
        'live_streams_05_mod_guard', 'blocks_after_insert', 'reports_before_insert',
        'reports_after_insert', 'report_evidence_count'))),
  ('trigger purge Storage attend les mises à l''abri',
    (select count(*) = 1 from pg_trigger where not tgisinternal and tgname = 'storage_purge_jobs_wait_for_holds')),
  ('domaine @users.nia.app réservé (trigger différé sur auth.users)',
    (select count(*) = 1 from pg_trigger
      where tgrelid = 'auth.users'::regclass and tgname = 'nia_reserved_email_domain' and tgdeferrable and tginitdeferred)),
  ('fonctions definer à search_path vide',
    (select count(*) = 17 from pg_proc
      where pronamespace = 'public'::regnamespace and prosecdef
        and proconfig @> array['search_path=""']
        and proname in ('nia_is_moderator', 'nia_block_between', 'nia_video_reusable',
                        'nia_can_view_video', 'nia_video_accepts_comments', 'nia_live_row_visible',
                        'nia_storage_path_on_hold', 'nia_notify', 'nia_apply_moderation_state',
                        'moderation_files_claim', 'moderation_files_complete', 'moderation_files_fail',
                        'evidence_due_for_purge', 'evidence_mark_purged',
                        'mod_resolve_report', 'mod_set_moderation_state', 'mod_suspend_user'))),
  ('RPC serveur (file des fichiers, purge des preuves) interdites à l''app',
    (select bool_and(not has_function_privilege('authenticated', p.oid, 'execute')
                     and not has_function_privilege('anon', p.oid, 'execute')
                     and has_function_privilege('service_role', p.oid, 'execute'))
       from pg_proc p
      where p.pronamespace = 'public'::regnamespace
        and p.proname in ('moderation_files_claim', 'moderation_files_complete', 'moderation_files_fail',
                          'evidence_due_for_purge', 'evidence_mark_purged'))),
  ('RPC modérateur fermées aux visiteurs',
    (select bool_and(not has_function_privilege('anon', p.oid, 'execute'))
       from pg_proc p
      where p.pronamespace = 'public'::regnamespace
        and p.proname in ('mod_resolve_report', 'mod_set_moderation_state', 'mod_suspend_user'))),
  ('policy notifications_insert_system retirée',
    (select count(*) = 0 from pg_policies
      where schemaname = 'public' and tablename = 'notifications' and policyname = 'notifications_insert_system')),
  ('policies : modération et blocages appliqués',
    (select count(*) = 7 from pg_policies
      where schemaname = 'public'
        and ((tablename = 'videos' and policyname = 'videos_select_public' and qual like '%nia_video_row_visible%')
          or (tablename = 'videos' and policyname = 'videos_delete_own' and qual like '%moderation_state%')
          or (tablename = 'comments' and policyname = 'comments_select_public' and qual like '%moderation_state%')
          or (tablename = 'likes' and policyname = 'likes_insert_own' and with_check like '%nia_can_view_video%')
          or (tablename = 'saves' and policyname = 'saves_insert_own' and with_check like '%nia_can_view_video%')
          or (tablename = 'follows' and policyname = 'follows_insert_own' and with_check like '%nia_block_between%')
          or (tablename = 'live_streams' and policyname = 'live_streams_select_public'
              and (qual like '%nia_live_row_visible%' or qual like '%nia_can_view_live%'))))),
  ('policy live : un live masqué reste invisible (y compris après 019)',
    (select bool_and(qual like '%nia_live_row_visible%' or qual like '%moderation_state%') from pg_policies
      where schemaname = 'public' and tablename = 'live_streams' and policyname = 'live_streams_select_public')),
  ('storage : preuves et fichiers masqués protégés',
    (select count(*) = 5 from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and policyname in ('evidence_storage_insert_own', 'evidence_storage_select_mod',
                           'moderation_hold_storage_select_mod')
         or (schemaname = 'storage' and tablename = 'objects'
             and policyname in ('videos_storage_update_own', 'videos_storage_delete_own')
             and coalesce(qual, '') like '%nia_storage_path_on_hold%'))),
  ('buckets privés report-evidence (20 Mo) et moderation-hold',
    (select count(*) = 2 from storage.buckets
      where (id = 'report-evidence' and not public and file_size_limit = 20971520)
         or (id = 'moderation-hold' and not public))),
  ('vue moderation_queue (security_invoker)',
    (select count(*) = 1 from pg_class
      where relnamespace = 'public'::regnamespace and relname = 'moderation_queue' and relkind = 'v'
        and coalesce(reloptions, '{}') @> array['security_invoker=true'])),
  ('signalements : tous catégorisés et priorisés',
    (select count(*) = 0 from public.reports where category is null or priority is null)),
  ('rattrapage : aucun signalement P0 ouvert sur un contenu encore visible',
    (select count(*) = 0 from public.reports r
      where r.priority = 0 and r.status in ('open', 'in_review')
        and ((r.target_type = 'video' and exists (select 1 from public.videos v where v.id = r.target_id and v.moderation_state = 'visible'))
          or (r.target_type = 'comment' and exists (select 1 from public.comments c where c.id = r.target_id and c.moderation_state = 'visible'))
          or (r.target_type = 'live' and exists (select 1 from public.live_streams l where l.id = r.target_id and l.moderation_state = 'visible')))))
)
select name, coalesce(ok, false) as ok from checks;

-- À part (pas une ligne ok) : au moins un modérateur déclaré ? Doit renvoyer 1
-- ligne une fois votre compte ajouté (voir la PR) :
--   select m.user_id, u.email from public.moderators m join auth.users u on u.id = m.user_id;
