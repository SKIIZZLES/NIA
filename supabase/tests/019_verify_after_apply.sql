-- Vérification APRÈS application de 019 (lecture seule : à coller dans le
-- SQL Editor de Supabase). Chaque ligne doit afficher ok = true.
with checks(name, ok) as (
  values
  ('colonnes live_streams : peak_viewer_count, ended_reason, host_left_at',
    (select count(*) = 3 from information_schema.columns
      where table_schema = 'public' and table_name = 'live_streams'
        and column_name in ('peak_viewer_count', 'ended_reason', 'host_left_at'))),
  ('contraintes compteurs >= 0 et raisons de fin',
    (select count(*) = 2 from pg_constraint
      where conrelid = 'public.live_streams'::regclass
        and conname in ('live_streams_counts_check', 'live_streams_ended_reason_check'))),
  ('index : lives en cours (Discover) et un seul live « live » par créateur',
    (select count(*) = 2 from pg_indexes
      where schemaname = 'public' and tablename = 'live_streams'
        and indexname in ('live_streams_live_now_idx', 'live_streams_one_live_per_host_idx'))),
  ('trigger live_streams_10_lifecycle_guard présent',
    (select count(*) = 1 from pg_trigger
      where tgrelid = 'public.live_streams'::regclass and not tgisinternal
        and tgname = 'live_streams_10_lifecycle_guard')),
  ('ordre des triggers : garde 05 (017) < cycle de vie 10 (019) < filtre 30 (018)',
    (select count(*) = 3 from pg_trigger
      where tgrelid = 'public.live_streams'::regclass and not tgisinternal
        and tgname in ('live_streams_05_mod_guard', 'live_streams_10_lifecycle_guard',
                       'live_streams_30_keyword_filter'))
     and 'live_streams_05_mod_guard' < 'live_streams_10_lifecycle_guard'
     and 'live_streams_10_lifecycle_guard' < 'live_streams_30_keyword_filter'),
  ('RPC live_webhook_apply et live_sweep_stale : service_role seulement',
    (select count(*) = 2
            and bool_and(not has_function_privilege('anon', p.oid, 'execute')
                         and not has_function_privilege('authenticated', p.oid, 'execute')
                         and has_function_privilege('service_role', p.oid, 'execute'))
       from pg_proc p
      where p.pronamespace = 'public'::regnamespace
        and p.proname in ('live_webhook_apply', 'live_sweep_stale'))),
  ('fonctions definer à search_path vide (webhook, balayage, visibilité)',
    (select count(*) = 3 from pg_proc
      where pronamespace = 'public'::regnamespace and prosecdef
        and proconfig @> array['search_path=""']
        and proname in ('live_webhook_apply', 'live_sweep_stale', 'nia_live_row_visible'))),
  ('policy live_streams_select_public : modération et blocage de 017 conservés',
    (select count(*) = 1 from pg_policies
      where schemaname = 'public' and tablename = 'live_streams'
        and policyname = 'live_streams_select_public'
        and qual like '%nia_live_row_visible%')),
  ('nia_live_row_visible : modération + blocage + audience Abonnés',
    (select count(*) = 1 from pg_proc
      where pronamespace = 'public'::regnamespace and proname = 'nia_live_row_visible'
        and prosrc like '%moderation_state%' and prosrc like '%nia_block_between%'
        and prosrc like '%nia_is_follower%' and prosrc like '%cancelled%')),
  ('filtre de mots 018 toujours attaché aux lives',
    (select count(*) = 1 from pg_trigger
      where tgrelid = 'public.live_streams'::regclass and not tgisinternal
        and tgname = 'live_streams_30_keyword_filter')),
  ('données : aucun créateur avec deux lives « live »',
    (select count(*) = 0 from (select user_id from public.live_streams where status = 'live'
                                group by user_id having count(*) > 1) d)),
  ('données : tout live « live » a un started_at',
    (select count(*) = 0 from public.live_streams where status = 'live' and started_at is null))
)
select name, coalesce(ok, false) as ok from checks;
