-- Tests 023 (badge First). Postgres LOCAL jetable uniquement : lancé par
-- run_local.sh après 023_seed_before.sql et deux passages de 023.
-- Chaque scénario tourne dans une transaction annulée, sauf F9 (concurrence,
-- deux sessions dblink réelles) qui nettoie derrière lui.
\set ON_ERROR_STOP 1

create or replace function nia_test.rank_of(p_label text) returns smallint language sql as $$
  select p.first_rank from public.profiles p
    join nia_test_seed023.users s on s.id = p.id where s.label = p_label
$$;
create or replace function nia_test.issued() returns smallint language sql as $$
  select issued from public.nia_first_badge_counter
$$;
-- Inscription « réelle » (comme GoTrue : insertion dans auth.users, le profil
-- est créé par handle_new_user).
create or replace function nia_test.signup(p_email text, p_anon boolean default false) returns uuid
language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, is_anonymous, raw_user_meta_data)
  values (v, p_email, p_anon, jsonb_build_object('username', 't023_' || replace(v::text, '-', '')));
  return v;
end $$;
create or replace function nia_test.rank_by_id(p uuid) returns smallint language sql as $$
  select first_rank from public.profiles where id = p
$$;

-- ---------------------------------------------------------------------------
-- F0. Rattrapage : ordre d'inscription, comptes techniques exclus
-- ---------------------------------------------------------------------------
do $$
begin
  perform nia_test.eq(nia_test.rank_of('alice'), 1::smallint, 'F0 alice (1re inscription retenue) = #1');
  perform nia_test.eq(nia_test.rank_of('bob'), 2::smallint, 'F0 bob = #2');
  perform nia_test.eq(nia_test.rank_of('telephone'), 3::smallint, 'F0 compte sans e-mail (téléphone) = #3');
  perform nia_test.eq(nia_test.rank_of('snap'), 4::smallint, 'F0 compte Snapchat @users.nia.app = #4');
  perform nia_test.eq(nia_test.rank_of('contest'), 5::smallint, 'F0 contest@latest.fr (pas un domaine .test) = #5');
  perform nia_test.eq(nia_test.rank_of('moderateur'), null::smallint, 'F0 modérateur exclu');
  perform nia_test.eq(nia_test.rank_of('probe'), null::smallint, 'F0 probe @example.com exclu');
  perform nia_test.eq(nia_test.rank_of('qa'), null::smallint, 'F0 domaine .test exclu');
  perform nia_test.eq(nia_test.rank_of('anonyme'), null::smallint, 'F0 compte anonyme exclu');
  perform nia_test.eq(nia_test.rank_of('dev'), null::smallint, 'F0 domaine .localhost exclu');
  perform nia_test.eq(
    (select count(*) from public.profiles p join auth.users u on u.id = p.id
      where p.first_rank is not null and u.email like '%@example.test'), 0::bigint,
    'F0 aucun compte de test (@example.test) classé');
  perform nia_test.eq(nia_test.issued()::bigint,
    (select count(*) from public.profiles where first_rank is not null),
    'F0 compteur = nombre de rangs attribués');
  perform nia_test.eq(
    (select max(first_rank)::bigint = count(*) from public.profiles where first_rank is not null), true,
    'F0 rangs contigus 1..n');
  perform nia_test.ok('F0 rattrapage');
end $$;

-- F1. Rien d'autre n'a bougé (empreinte d'avant 023, first_rank exclue), et
-- le 2e passage n'a rien reclassé (F0 tient après deux passages).
do $$
declare v_diff bigint;
begin
  with after as (
    select 'profiles' as t, to_jsonb(x) - 'first_rank' as row from public.profiles x
    union all select 'videos', to_jsonb(x) from public.videos x
    union all select 'comments', to_jsonb(x) from public.comments x
    union all select 'moderators', to_jsonb(x) from public.moderators x
    union all select 'auth.users', to_jsonb(x) from auth.users x
  )
  select count(*) into v_diff from (
    (select t, row from nia_test_seed023.before except all select t, row from after)
    union all
    (select t, row from after except all select t, row from nia_test_seed023.before)
  ) d;
  perform nia_test.eq(v_diff, 0::bigint, 'F1 aucune autre donnée modifiée par 023');
  perform nia_test.eq(nia_test.snapshot(), (select snap from nia_test_seed023.counts), 'F1 aucun ajout / suppression de ligne');
  perform nia_test.ok('F1 données intactes, idempotence');
end $$;

-- ---------------------------------------------------------------------------
-- F2. Nouvelles inscriptions
-- ---------------------------------------------------------------------------
begin;
do $$
declare
  n0 smallint := nia_test.issued();
  a uuid; b uuid; t1 uuid; t2 uuid; t3 uuid; t4 uuid;
begin
  a := nia_test.signup('awa@gmail.com');
  perform nia_test.eq(nia_test.rank_by_id(a), (n0 + 1)::smallint, 'F2 inscription réelle : rang suivant');
  t1 := nia_test.signup('probe9@example.com');
  t2 := nia_test.signup('x@sub.example.org');
  t3 := nia_test.signup('ci@nia.test');
  t4 := nia_test.signup(null, true);
  perform nia_test.eq(nia_test.rank_by_id(t1), null::smallint, 'F2 @example.com : pas de rang');
  perform nia_test.eq(nia_test.rank_by_id(t2), null::smallint, 'F2 sous-domaine example.org : pas de rang');
  perform nia_test.eq(nia_test.rank_by_id(t3), null::smallint, 'F2 .test : pas de rang');
  perform nia_test.eq(nia_test.rank_by_id(t4), null::smallint, 'F2 anonyme : pas de rang');
  perform nia_test.eq(nia_test.issued(), (n0 + 1)::smallint, 'F2 comptes techniques : compteur inchangé');
  b := nia_test.signup('Kofi@Outlook.com');
  perform nia_test.eq(nia_test.rank_by_id(b), (n0 + 2)::smallint, 'F2 inscription suivante : pas de trou');
  perform nia_test.ok('F2 attribution à l''inscription');
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- F3. Colonne en lecture seule pour l'app
-- ---------------------------------------------------------------------------
begin;
do $$
declare
  alice uuid := (select id from nia_test_seed023.users where label = 'alice');
  probe uuid := (select id from nia_test_seed023.users where label = 'probe');
  r jsonb;
begin
  r := nia_test.dml_as('authenticated', probe,
    format('update public.profiles set first_rank = 50 where id = %L', probe));
  perform nia_test.eq(r->>'sqlstate', '42501', 'F3 un compte ne peut pas se donner un rang');
  r := nia_test.dml_as('authenticated', alice,
    format('update public.profiles set first_rank = null where id = %L', alice));
  perform nia_test.eq(r->>'sqlstate', '42501', 'F3 ni retirer / changer le sien');
  r := nia_test.dml_as('authenticated', alice,
    format('update public.profiles set first_rank = 99 where id = %L', alice));
  perform nia_test.eq(r->>'sqlstate', '42501', 'F3 ni le changer');
  r := nia_test.dml_as('authenticated', probe,
    format('update public.profiles set first_rank = null where id = %L', alice));
  perform nia_test.eq((r->>'n')::int, 0, 'F3 profil d''autrui : 0 ligne (RLS)');
  r := nia_test.dml_as('anon', null,
    format('update public.profiles set first_rank = 7 where id = %L', probe));
  perform nia_test.eq(coalesce(r->>'sqlstate', '0 ligne:' || (r->>'n')), '0 ligne:0', 'F3 anon : 0 ligne');
  -- Contexte modérateur (RPC SECURITY DEFINER, nia.mod_trusted) : toujours refusé.
  perform set_config('nia.mod_trusted', 'on', true);
  r := nia_test.dml_as('authenticated', probe,
    format('update public.profiles set first_rank = 50 where id = %L', probe));
  perform set_config('nia.mod_trusted', '', true);
  perform nia_test.eq(r->>'sqlstate', '42501', 'F3 contexte modérateur : refusé aussi');
  -- Les autres colonnes restent modifiables, le rang ne bouge pas.
  r := nia_test.dml_as('authenticated', alice,
    format('update public.profiles set bio = %L where id = %L', 'Nouvelle bio', alice));
  perform nia_test.eq((r->>'n')::int, 1, 'F3 modifier sa bio : ok');
  perform nia_test.eq(nia_test.rank_of('alice'), 1::smallint, 'F3 rang conservé après modification du profil');
  perform nia_test.eq(nia_test.rank_of('probe'), null::smallint, 'F3 probe toujours sans rang');
  perform nia_test.ok('F3 lecture seule (authenticated, anon, modérateur)');
end $$;
rollback;

-- F3b. Insertion directe (profiles_insert_own) : la valeur fournie est ignorée.
begin;
do $$
declare
  u uuid := nia_test.signup('direct@gmail.com');
  n smallint;
  r jsonb;
begin
  delete from public.profiles where id = u;   -- profil absent (cas limite)
  n := nia_test.issued();
  r := nia_test.dml_as('authenticated', u,
    format('insert into public.profiles (id, username, first_rank) values (%L, %L, 1)', u, 'direct_' || left(u::text, 6)));
  perform nia_test.eq((r->>'n')::int, 1, 'F3b insertion de son propre profil : ok');
  perform nia_test.eq(nia_test.rank_by_id(u), (n + 1)::smallint, 'F3b first_rank fourni ignoré, rang serveur attribué');
  u := nia_test.signup('probe-direct@example.com');
  delete from public.profiles where id = u;
  r := nia_test.dml_as('authenticated', u,
    format('insert into public.profiles (id, username, first_rank) values (%L, %L, 42)', u, 'tech_' || left(u::text, 6)));
  perform nia_test.eq((r->>'n')::int, 1, 'F3b insertion compte technique : ok');
  perform nia_test.eq(nia_test.rank_by_id(u), null::smallint, 'F3b compte technique : rang fourni ignoré (NULL)');
  perform nia_test.ok('F3b insertion directe');
end $$;
rollback;

-- F4. service_role et SQL Editor peuvent corriger un rang.
begin;
do $$
declare
  probe uuid := (select id from nia_test_seed023.users where label = 'probe');
  r jsonb;
begin
  r := nia_test.dml_as('service_role', null,
    format('update public.profiles set first_rank = 90 where id = %L', probe));
  perform nia_test.eq((r->>'n')::int, 1, 'F4 service_role : correction possible');
  update public.profiles set first_rank = null where id = probe;   -- SQL Editor
  perform nia_test.eq(nia_test.rank_of('probe'), null::smallint, 'F4 SQL Editor : correction possible');
  r := nia_test.dml_as('service_role', null,
    format('update public.profiles set first_rank = 101 where id = %L', probe));
  perform nia_test.eq(r->>'sqlstate', '23514', 'F4 rang > 100 refusé (contrainte)');
  r := nia_test.dml_as('service_role', null,
    format('update public.profiles set first_rank = 1 where id = %L', probe));
  perform nia_test.eq(r->>'sqlstate', '23505', 'F4 rang en double refusé (unicité)');
  perform nia_test.ok('F4 corrections serveur et contraintes');
end $$;
rollback;

-- F5. Lecture publique du rang ; compteur et fonctions fermés à l'app.
do $$
declare r jsonb;
begin
  perform nia_test.eq(nia_test.seen('anon', null,
    'select id, username, first_rank from public.profiles where first_rank is not null') >= 5, true,
    'F5 anon lit first_rank (badge public)');
  r := nia_test.exec_as('authenticated', (select id from nia_test_seed023.users where label = 'alice'),
    'select * from public.nia_first_badge_counter');
  perform nia_test.eq(r->>'sqlstate', '42501', 'F5 compteur illisible pour authenticated');
  r := nia_test.exec_as('anon', null, 'select * from public.nia_first_badge_counter');
  perform nia_test.eq(r->>'sqlstate', '42501', 'F5 compteur illisible pour anon');
  r := nia_test.dml_as('authenticated', (select id from nia_test_seed023.users where label = 'alice'),
    'update public.nia_first_badge_counter set issued = 0');
  perform nia_test.eq(r->>'sqlstate', '42501', 'F5 compteur non modifiable');
  perform nia_test.eq(has_function_privilege('authenticated', 'public.nia_first_badge_eligible(uuid)', 'execute'), false, 'F5 eligible : pas pour authenticated');
  perform nia_test.eq(has_function_privilege('anon', 'public.nia_first_badge_eligible(uuid)', 'execute'), false, 'F5 eligible : pas pour anon');
  perform nia_test.eq(has_function_privilege('authenticated', 'public.nia_profiles_first_rank()', 'execute'), false, 'F5 fonction de trigger : pas pour authenticated');
  perform nia_test.ok('F5 droits');
end $$;

-- ---------------------------------------------------------------------------
-- F6. Plafond de 100
-- ---------------------------------------------------------------------------
begin;
do $$
declare a uuid; b uuid;
begin
  update public.nia_first_badge_counter set issued = 99;
  a := nia_test.signup('n100@gmail.com');
  b := nia_test.signup('n101@gmail.com');
  perform nia_test.eq(nia_test.rank_by_id(a), 100::smallint, 'F6 100e compte : First #100');
  perform nia_test.eq(nia_test.rank_by_id(b), null::smallint, 'F6 101e compte : pas de badge');
  perform nia_test.eq(nia_test.issued(), 100::smallint, 'F6 compteur bloqué à 100');
  perform nia_test.ok('F6 plafond');
end $$;
rollback;

-- F7. Un rang n'est jamais réattribué (suppression de compte).
begin;
do $$
declare n smallint := nia_test.issued(); a uuid;
begin
  delete from auth.users where id = (select id from nia_test_seed023.users where label = 'bob');
  a := nia_test.signup('after-delete@gmail.com');
  perform nia_test.eq(nia_test.rank_by_id(a), (n + 1)::smallint, 'F7 place de #2 non réutilisée');
  perform nia_test.eq((select count(*) from public.profiles where first_rank = 2), 0::bigint, 'F7 #2 reste libre');
  perform nia_test.ok('F7 rangs définitifs');
end $$;
rollback;

-- F8. Inscription annulée : son rang est rendu (pas de trou).
begin;
do $$
declare n smallint := nia_test.issued(); a uuid;
begin
  begin
    perform nia_test.signup('rollback@gmail.com');
    raise exception 'annulation';
  exception when raise_exception then null;
  end;
  perform nia_test.eq(nia_test.issued(), n, 'F8 inscription annulée : compteur rendu');
  a := nia_test.signup('next@gmail.com');
  perform nia_test.eq(nia_test.rank_by_id(a), (n + 1)::smallint, 'F8 pas de trou');
  perform nia_test.ok('F8 annulation');
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- F9. Concurrence : deux inscriptions simultanées (sessions dblink réelles)
-- ---------------------------------------------------------------------------
create extension if not exists dblink;
do $$
declare
  conn text := format('dbname=%s host=%s port=%s user=%s',
                      current_database(), current_setting('unix_socket_directories'),
                      current_setting('port'), current_user);
  n0 smallint := nia_test.issued();
  ua uuid := gen_random_uuid(); ub uuid := gen_random_uuid();
  uc uuid := gen_random_uuid(); ud uuid := gen_random_uuid();
  busy int;
begin
  perform dblink_connect('fa', conn);
  perform dblink_connect('fb', conn);

  -- Cas 1 : il reste une place ; A la prend, B attend puis n'a rien.
  perform dblink_exec('fa', 'update public.nia_first_badge_counter set issued = 99');
  perform dblink_exec('fa', 'begin');
  perform dblink_exec('fa', format('insert into auth.users (id, email) values (%L, %L)', ua, 'race-a@gmail.com'));
  perform dblink_send_query('fb', format('insert into auth.users (id, email) values (%L, %L)', ub, 'race-b@gmail.com'));
  perform pg_sleep(0.3);
  busy := dblink_is_busy('fb');
  perform nia_test.eq(busy, 1, 'F9 B attend le verrou du compteur pendant l''inscription de A');
  perform dblink_exec('fa', 'commit');
  perform * from dblink_get_result('fb') as t(r text);
  perform * from dblink_get_result('fb') as t(r text);
  perform nia_test.eq(nia_test.rank_by_id(ua), 100::smallint, 'F9 A : First #100');
  perform nia_test.eq(nia_test.rank_by_id(ub), null::smallint, 'F9 B : plus de place');

  -- Cas 2 : A annule ; B prend la place libérée.
  perform dblink_exec('fa', 'update public.nia_first_badge_counter set issued = 99');
  perform dblink_exec('fa', format('update public.profiles set first_rank = null where id = %L', ua));
  perform dblink_exec('fa', 'begin');
  perform dblink_exec('fa', format('insert into auth.users (id, email) values (%L, %L)', uc, 'race-c@gmail.com'));
  perform dblink_send_query('fb', format('insert into auth.users (id, email) values (%L, %L)', ud, 'race-d@gmail.com'));
  perform pg_sleep(0.3);
  perform nia_test.eq(dblink_is_busy('fb'), 1, 'F9 B attend encore');
  perform dblink_exec('fa', 'rollback');
  perform * from dblink_get_result('fb') as t(r text);
  perform * from dblink_get_result('fb') as t(r text);
  perform nia_test.eq((select count(*) from auth.users where id = uc), 0::bigint, 'F9 C annulé');
  perform nia_test.eq(nia_test.rank_by_id(ud), 100::smallint, 'F9 D : prend la place rendue par C');
  perform nia_test.eq((select count(*) from public.profiles where first_rank = 100), 1::bigint, 'F9 un seul #100');

  -- Nettoyage (données commitées par les sessions dblink).
  perform dblink_exec('fa', format('delete from auth.users where id in (%L, %L, %L)', ua, ub, ud));
  perform dblink_exec('fa', format('update public.nia_first_badge_counter set issued = %s', n0));
  perform dblink_disconnect('fa');
  perform dblink_disconnect('fb');
  perform nia_test.eq(nia_test.issued(), n0, 'F9 compteur restauré');
  perform nia_test.ok('F9 concurrence');
end $$;

do $$ begin perform nia_test.ok('023 : tous les scénarios passent'); end $$;
