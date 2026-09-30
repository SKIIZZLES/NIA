-- Vérification APRÈS application de 020 (lecture seule : à coller dans le
-- SQL Editor de Supabase). Chaque ligne doit afficher ok = true.
-- Catalogue uniquement, plus deux comptages : aucune date de naissance n'est lue.
with checks(name, ok) as (
  values
  ('table user_birthdates : RLS active, lecture de sa seule ligne',
    (select c.relrowsecurity from pg_class c where c.oid = to_regclass('public.user_birthdates'))
    and (select count(*) = 1 from pg_policies
          where schemaname = 'public' and tablename = 'user_birthdates'
            and policyname = 'user_birthdates_select_own' and cmd = 'SELECT'
            and qual like '%auth.uid() = user_id%')
    and (select count(*) = 1 from pg_policies where schemaname = 'public' and tablename = 'user_birthdates')),
  ('user_birthdates : fermée aux visiteurs, aucune écriture directe par l''app',
    (select not has_table_privilege('anon', 'public.user_birthdates', 'select')
        and not has_table_privilege('anon', 'public.user_birthdates', 'insert')
        and not has_table_privilege('authenticated', 'public.user_birthdates', 'insert')
        and not has_table_privilege('authenticated', 'public.user_birthdates', 'update')
        and not has_table_privilege('authenticated', 'public.user_birthdates', 'delete'))),
  ('user_birthdates : clé étrangère vers profiles en cascade (suppression de compte)',
    (select count(*) = 1 from pg_constraint
      where conrelid = 'public.user_birthdates'::regclass and contype = 'f'
        and confrelid = 'public.profiles'::regclass and confdeltype = 'c')),
  ('aucune date de naissance dans profiles (table publique)',
    (select count(*) = 0 from information_schema.columns
      where table_schema = 'public' and table_name = 'profiles' and column_name ilike '%birth%')),
  ('âge minimum d''inscription = 13',
    (select public.nia_min_signup_age() = 13)),
  ('colonnes 18+ : videos (is_mature, mature_locked), live_streams (is_mature, mature_locked), non nulles, false par défaut',
    (select count(*) = 4 from information_schema.columns
      where table_schema = 'public' and is_nullable = 'NO' and column_default = 'false'
        and (table_name, column_name) in (('videos', 'is_mature'), ('videos', 'mature_locked'),
                                          ('live_streams', 'is_mature'), ('live_streams', 'mature_locked')))),
  ('triggers de garde 18+ (videos, live_streams)',
    (select count(*) = 2 from pg_trigger
      where not tgisinternal
        and ((tgrelid = 'public.videos'::regclass and tgname = 'videos_15_mature_guard')
          or (tgrelid = 'public.live_streams'::regclass and tgname = 'live_streams_15_mature_guard')))),
  ('ordre des triggers : garde 10 (017 / 019) < 18+ 15 < fichiers 20 / filtre 30 (017 / 018)',
    (select count(*) = 4 from pg_trigger
      where tgrelid = 'public.videos'::regclass and not tgisinternal
        and tgname in ('videos_10_guard', 'videos_15_mature_guard', 'videos_20_moderation_files',
                       'videos_30_keyword_filter'))
     and 'videos_10_guard' < 'videos_15_mature_guard'
     and 'videos_15_mature_guard' < 'videos_20_moderation_files'
     and 'live_streams_10_lifecycle_guard' < 'live_streams_15_mature_guard'
     and 'live_streams_15_mature_guard' < 'live_streams_30_keyword_filter'),
  ('policy videos_select_public : 016 / 017 conservées + 18+',
    (select count(*) = 1 from pg_policies
      where schemaname = 'public' and tablename = 'videos' and policyname = 'videos_select_public'
        and qual like '%nia_video_row_visible%' and qual like '%moderation_state%'
        and qual like '%nia_block_between%' and qual like '%nia_is_moderator%'
        and qual like '%nia_mature_ok%')),
  ('policy live_streams_select_public : 017 / 019 conservées + 18+',
    (select count(*) = 1 from pg_policies
      where schemaname = 'public' and tablename = 'live_streams' and policyname = 'live_streams_select_public'
        and qual like '%nia_live_row_visible%' and qual like '%nia_mature_ok%')),
  ('fonctions d''accès aux vidéos : 18+ appliqué (lecture, commentaires, pas de republication)',
    (select count(*) = 3 from pg_proc
      where pronamespace = 'public'::regnamespace
        and ((proname = 'nia_can_view_video' and prosrc like '%nia_mature_ok%' and prosrc like '%nia_block_between%')
          or (proname = 'nia_video_accepts_comments' and prosrc like '%nia_mature_ok%' and prosrc like '%allow_comments%')
          or (proname = 'nia_video_reusable' and prosrc like '%not v.is_mature%' and prosrc like '%moderation_state%')))),
  ('18+ lisible seulement par le créateur, un majeur ayant activé l''option, un modérateur',
    (select count(*) = 1 from pg_proc
      where pronamespace = 'public'::regnamespace and proname = 'nia_mature_ok'
        and prosrc like '%nia_viewer_sees_mature%' and prosrc like '%nia_is_moderator%'
        and prosrc like '%p_owner%')
    and (select count(*) = 1 from pg_proc
      where pronamespace = 'public'::regnamespace and proname = 'nia_viewer_sees_mature'
        and prosrc like '%show_mature%' and prosrc like '%18%')),
  ('fonctions definer à search_path vide',
    (select count(*) = 11 from pg_proc
      where pronamespace = 'public'::regnamespace and prosecdef
        and proconfig @> array['search_path=""']
        and proname in ('nia_viewer_is_adult', 'nia_viewer_sees_mature', 'nia_mature_ok',
                        'set_my_birth_date', 'set_my_mature_opt_in', 'get_my_age_status',
                        'mod_set_mature', 'mod_set_birth_date',
                        'nia_video_reusable', 'nia_can_view_video', 'nia_video_accepts_comments'))),
  ('RPC utilisateur : authenticated seulement',
    (select bool_and(has_function_privilege('authenticated', p.oid, 'execute')
                     and not has_function_privilege('anon', p.oid, 'execute'))
       from pg_proc p
      where p.pronamespace = 'public'::regnamespace
        and p.proname in ('set_my_birth_date', 'set_my_mature_opt_in', 'get_my_age_status'))),
  ('RPC modérateur (mod_set_mature, mod_set_birth_date) fermées aux visiteurs',
    (select count(*) = 2 and bool_and(not has_function_privilege('anon', p.oid, 'execute'))
       from pg_proc p
      where p.pronamespace = 'public'::regnamespace
        and p.proname in ('mod_set_mature', 'mod_set_birth_date'))),
  ('données : aucun contenu 18+ verrouillé sans être 18+',
    (select count(*) = 0 from public.videos where mature_locked and not is_mature)
    and (select count(*) = 0 from public.live_streams where mature_locked and not is_mature))
)
select name, coalesce(ok, false) as ok from checks;
