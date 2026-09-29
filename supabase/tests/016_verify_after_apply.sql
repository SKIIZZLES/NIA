-- Vérification APRÈS application de 016 (lecture seule : à coller dans le
-- SQL Editor de Supabase). Chaque ligne doit afficher ok = true.
with checks(name, ok) as (
  values
  ('7 colonnes videos',
    (select count(*) = 7 from information_schema.columns
      where table_schema = 'public' and table_name = 'videos'
        and column_name in ('visibility','allow_comments','allow_reuse','ai_generated',
                            'alt_text','location_text','edit_meta'))),
  ('4 contraintes CHECK',
    (select count(*) = 4 from pg_constraint
      where conrelid = 'public.videos'::regclass
        and conname in ('videos_visibility_check','videos_alt_text_len_check',
                        'videos_location_text_len_check','videos_edit_meta_check'))),
  ('5 fonctions definer, search_path vide',
    (select count(*) = 5 from pg_proc
      where pronamespace = 'public'::regnamespace and prosecdef
        and proconfig @> array['search_path=""']
        and proname in ('nia_is_follower','nia_video_reusable','nia_video_row_visible',
                        'nia_can_view_video','nia_video_accepts_comments'))),
  ('policy videos_select_public',
    (select bool_and(qual like '%nia_video_row_visible%') from pg_policies
      where schemaname = 'public' and tablename = 'videos' and policyname = 'videos_select_public')),
  ('policy videos_insert_own',
    (select bool_and(with_check like '%nia_video_reusable%') from pg_policies
      where schemaname = 'public' and tablename = 'videos' and policyname = 'videos_insert_own')),
  ('policy comments_select_public',
    (select bool_and(qual like '%nia_can_view_video%') from pg_policies
      where schemaname = 'public' and tablename = 'comments' and policyname = 'comments_select_public')),
  ('policy comments_insert_own',
    (select bool_and(with_check like '%nia_video_accepts_comments%') from pg_policies
      where schemaname = 'public' and tablename = 'comments' and policyname = 'comments_insert_own')),
  ('policy reposts_insert_own',
    (select bool_and(with_check like '%nia_video_reusable%') from pg_policies
      where schemaname = 'public' and tablename = 'reposts' and policyname = 'reposts_insert_own')),
  ('storage : read_own présent, public_read retiré',
    (select count(*) filter (where policyname = 'videos_storage_read_own') = 1
        and count(*) filter (where policyname = 'videos_storage_public_read') = 0
       from pg_policies where schemaname = 'storage' and tablename = 'objects')),
  ('vidéos existantes : toutes publiques, commentables, republiables',
    (select count(*) = 0 from public.videos
      where visibility <> 'public' or not allow_comments or not allow_reuse
        or ai_generated or edit_meta is not null))
)
select name, coalesce(ok, false) as ok from checks;
-- Note : la ligne « vidéos existantes » n'est vraie que juste après
-- l'application (avant toute publication avec options).
