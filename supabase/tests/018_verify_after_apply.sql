-- Vérification APRÈS application de 018 (lecture seule : à coller dans le
-- SQL Editor de Supabase). Chaque ligne doit afficher ok = true.
-- Ne lit aucun terme de la liste (seulement des comptes), et n'exécute
-- nia_kw_analyze que sur des phrases de contrôle fixes.
with checks(name, ok) as (
  values
  ('tables moderation_terms et keyword_flags (RLS active)',
    (select count(*) = 2 from pg_class
      where relnamespace = 'public'::regnamespace and relrowsecurity
        and relname in ('moderation_terms', 'keyword_flags'))),
  ('liste privée : aucun droit pour anon, lecture authenticated filtrée par la RLS modérateur',
    (select not has_table_privilege('anon', 'public.moderation_terms', 'select')
        and not has_table_privilege('anon', 'public.keyword_flags', 'select')
        and (select count(*) = 1 from pg_policies
              where schemaname = 'public' and tablename = 'moderation_terms'
                and qual like '%nia_is_moderator%')
        and (select count(*) = 1 from pg_policies
              where schemaname = 'public' and tablename = 'keyword_flags'
                and cmd = 'SELECT' and qual like '%nia_is_moderator%')
        and (select count(*) = 1 from pg_policies
              where schemaname = 'public' and tablename = 'keyword_flags'))),
  ('liste de départ : 63 termes, 7 catégories, 58 actifs',
    (select count(*) = 63 and count(distinct category) = 7 and count(*) filter (where enabled) = 58
       from public.moderation_terms)),
  ('termes normalisés (clés calculées)',
    (select bool_and(compact_key <> '' and phrase_key <> '' and word_count >= 1)
       from public.moderation_terms)),
  ('insultes masquées, autres catégories retenues',
    (select bool_and(case when category = 'insultes_harcelement' then action = 'mask' else action = 'hold' end)
       from public.moderation_terms)),
  ('triggers du filtre (comments, videos, live_streams, profiles, moderation_terms)',
    (select count(*) = 5 from pg_trigger
      where not tgisinternal and tgname in (
        'comments_30_keyword_filter', 'videos_30_keyword_filter', 'live_streams_30_keyword_filter',
        'profiles_30_keyword_filter', 'moderation_terms_normalize'))),
  ('triggers du filtre après les gardes de 017 (ordre alphabétique)',
    (select count(*) = 4 from pg_trigger t
      where not t.tgisinternal and t.tgname like '%\_30\_keyword\_filter'
        and exists (select 1 from pg_trigger g
                     where g.tgrelid = t.tgrelid and not g.tgisinternal
                       and g.tgname in ('comments_10_guard', 'videos_10_guard', 'profiles_10_guard',
                                        'live_streams_05_mod_guard')
                       and g.tgname < t.tgname))),
  ('chat live : filtre attaché si la table existe',
    (to_regclass('public.live_comments') is null
     or exists (select 1 from pg_trigger where tgname = 'live_comments_keyword_filter'))),
  ('fonctions definer à search_path vide',
    (select count(*) = 13 from pg_proc
      where pronamespace = 'public'::regnamespace and prosecdef
        and proconfig @> array['search_path=""']
        and proname in ('nia_kw_analyze', 'nia_check_text', 'nia_kw_scan_fields', 'nia_kw_record',
                        'nia_kw_hold_video_files', 'nia_kw_terms_normalize', 'nia_kw_attach_live_chat',
                        'nia_comments_keyword_filter', 'nia_videos_keyword_filter',
                        'nia_live_streams_keyword_filter', 'nia_profiles_keyword_filter',
                        'nia_live_comments_keyword_filter', 'mod_resolve_keyword_flag'))),
  ('analyse détaillée et fonctions internes interdites à l''app',
    (select bool_and(not has_function_privilege('anon', p.oid, 'execute')
                     and not has_function_privilege('authenticated', p.oid, 'execute'))
       from pg_proc p
      where p.pronamespace = 'public'::regnamespace
        and p.proname in ('nia_kw_analyze', 'nia_kw_scan_fields', 'nia_kw_record',
                          'nia_kw_hold_video_files', 'nia_kw_attach_live_chat'))),
  ('nia_check_text ouverte à l''app et aux visiteurs (verdict seul)',
    (select has_function_privilege('anon', 'public.nia_check_text(text, text)', 'execute')
        and has_function_privilege('authenticated', 'public.nia_check_text(text, text)', 'execute'))),
  ('mod_resolve_keyword_flag fermée aux visiteurs',
    (select has_function_privilege('authenticated', 'public.mod_resolve_keyword_flag(uuid, text, text)', 'execute')
        and not has_function_privilege('anon', 'public.mod_resolve_keyword_flag(uuid, text, text)', 'execute'))),
  ('moderation_queue : colonnes de 017 conservées + source (security_invoker)',
    (select string_agg(attname, ',' order by attnum)
              = 'id,priority,category,target_type,target_id,target_owner_id,target_owner_username,status,legal_status,legal_ref,auto_hidden,evidence_count,details,target_snapshot,created_at,reports_on_target,source'
       from pg_attribute where attrelid = 'public.moderation_queue'::regclass and attnum > 0)
     and (select coalesce(reloptions, '{}') @> array['security_invoker=true'] from pg_class
           where oid = 'public.moderation_queue'::regclass)),
  ('vue moderation_keyword_offenders (security_invoker)',
    (select count(*) = 1 from pg_class
      where relnamespace = 'public'::regnamespace and relname = 'moderation_keyword_offenders' and relkind = 'v'
        and coalesce(reloptions, '{}') @> array['security_invoker=true'])),
  ('contrôle : texte propre non touché, insulte masquée, terme retenu',
    ((select action from public.nia_kw_analyze('Bravo pour cette danse, Niger et Nigeria représentent !')) = 'none'
     and (select masked from public.nia_kw_analyze('quel c0nnnnard')) = 'quel c********'
     and (select action from public.nia_kw_analyze('sale_noir')) = 'hold')),
  ('contrôle : pas de faux positif Scunthorpe',
    ((select action from public.nia_kw_analyze('Conseil municipal, computer, députée, assassin, le PDG')) = 'none')),
  ('aucune trace ouverte sans contenu retenu correspondant (cohérence)',
    (select count(*) = 0 from public.keyword_flags k
      where k.status = 'open'
        and ((k.target_type = 'video' and exists (select 1 from public.videos v where v.id = k.target_id and v.moderation_state = 'visible'))
          or (k.target_type = 'comment' and exists (select 1 from public.comments c where c.id = k.target_id and c.moderation_state = 'visible'))
          or (k.target_type = 'live' and exists (select 1 from public.live_streams l where l.id = k.target_id and l.moderation_state = 'visible')))))
)
select name, coalesce(ok, false) as ok from checks;
