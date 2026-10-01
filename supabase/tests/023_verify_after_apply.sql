-- Vérification APRÈS application de 023 (lecture seule : à coller dans le
-- SQL Editor de Supabase). Chaque ligne doit afficher ok = true.
-- Catalogue + comptages agrégés uniquement (aucune donnée personnelle affichée).
with checks(name, ok) as (
  values
  ('profiles.first_rank : smallint, NULL par défaut',
    (select count(*) = 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'profiles' and column_name = 'first_rank'
        and data_type = 'smallint' and is_nullable = 'YES' and column_default is null)),
  ('contraintes : rang 1..100 et unicité',
    (select count(*) = 2 from pg_constraint
      where conrelid = 'public.profiles'::regclass
        and conname in ('profiles_first_rank_check', 'profiles_first_rank_key'))),
  ('compteur : une seule ligne, RLS active, aucune policy',
    (select (select count(*) from public.nia_first_badge_counter) = 1
        and (select relrowsecurity from pg_class where oid = 'public.nia_first_badge_counter'::regclass)
        and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'nia_first_badge_counter'))),
  ('compteur : aucun droit pour anon / authenticated',
    (select not has_table_privilege('anon', 'public.nia_first_badge_counter', 'select,insert,update,delete')
        and not has_table_privilege('authenticated', 'public.nia_first_badge_counter', 'select,insert,update,delete'))),
  ('fonctions : security definer, search_path vide, non exécutables par l''app',
    (select count(*) = 2 from pg_proc p
      where p.oid in (to_regprocedure('public.nia_first_badge_eligible(uuid)'),
                      to_regprocedure('public.nia_profiles_first_rank()'))
        and p.prosecdef and p.proconfig @> array['search_path=""']
        and not has_function_privilege('anon', p.oid, 'execute')
        and not has_function_privilege('authenticated', p.oid, 'execute'))),
  ('trigger profiles_90_first_rank : BEFORE INSERT OR UPDATE, par ligne',
    (select count(*) = 1 from pg_trigger
      where tgrelid = 'public.profiles'::regclass and tgname = 'profiles_90_first_rank'
        and not tgisinternal and tgenabled = 'O'
        and pg_get_triggerdef(oid) like '%BEFORE INSERT OR UPDATE ON public.profiles FOR EACH ROW%')),
  ('trigger : rang en lecture seule pour anon / authenticated, verrou du compteur',
    (select p.prosrc like '%profile_first_rank_read_only%'
        and p.prosrc like '%issued < 100%'
        and p.prosrc like '%new.first_rank := null%'
       from pg_proc p where p.oid = to_regprocedure('public.nia_profiles_first_rank()'))),
  ('triggers de profiles de 017 / 018 toujours en place',
    (select count(*) = 2 from pg_trigger
      where tgrelid = 'public.profiles'::regclass and not tgisinternal
        and tgname in ('profiles_10_guard', 'profiles_30_keyword_filter'))),
  ('policies de profiles inchangées (lecture publique, écriture du propriétaire)',
    (select count(*) = 3 from pg_policies
      where schemaname = 'public' and tablename = 'profiles'
        and policyname in ('profiles_select_public', 'profiles_insert_own', 'profiles_update_own'))),
  ('rangs : compteur ≥ rangs attribués, rangs ≤ compteur, au plus 100',
    (select c.issued >= (select count(*) from public.profiles where first_rank is not null)
        and coalesce((select max(first_rank) from public.profiles), 0) <= c.issued
        and c.issued <= 100
       from public.nia_first_badge_counter c)),
  ('aucun compte technique classé (domaine réservé aux tests, compte anonyme)',
    (select count(*) = 0 from public.profiles p join auth.users u on u.id = p.id
      where p.first_rank is not null
        and (coalesce(lower(split_part(u.email, '@', 2)), '') ~ '(^|\.)(example\.(com|net|org)|example|test|invalid|localhost)$'
             or coalesce((to_jsonb(u) ->> 'is_anonymous')::boolean, false))))
)
select name, ok from checks;
