-- Données « d'avant 023 » : comptes existants à classer (ou à exclure) par le
-- rattrapage, puis empreinte complète des tables. Prouve que 023 ne touche
-- qu'à profiles.first_rank des comptes retenus.
-- Postgres LOCAL jetable uniquement ; lancé par run_local.sh juste avant 023.
\set ON_ERROR_STOP 1
drop schema if exists nia_test_seed023 cascade;
create schema nia_test_seed023;
create table nia_test_seed023.users (label text primary key, id uuid not null);

-- Ordre d'inscription volontairement différent de l'ordre d'insertion.
-- Une transaction : le contrôle différé du domaine @users.nia.app (017) voit
-- l'origine snapchat-auth posée juste après, comme avec l'API admin d'Auth.
begin;
insert into auth.users (id, email, created_at, is_anonymous, raw_user_meta_data) values
  ('00000000-0000-4000-8000-000000000a01', 'moderateur@nia-real.fr',  '2026-08-01 08:00+00', false, '{"username": "seed023_01"}'),
  ('00000000-0000-4000-8000-000000000a02', 'probe@example.com',       '2026-08-02 08:00+00', false, '{"username": "seed023_02"}'),
  ('00000000-0000-4000-8000-000000000a03', 'bob@nia-real.fr',         '2026-08-05 08:00+00', false, '{"username": "seed023_03"}'),
  ('00000000-0000-4000-8000-000000000a04', 'alice@nia-real.fr',       '2026-08-03 08:00+00', false, '{"username": "seed023_04"}'),
  ('00000000-0000-4000-8000-000000000a05', 'qa@ci.test',              '2026-08-03 09:00+00', false, '{"username": "seed023_05"}'),
  ('00000000-0000-4000-8000-000000000a06', null,                      '2026-08-04 08:00+00', true, '{"username": "seed023_06"}'),
  ('00000000-0000-4000-8000-000000000a07', null,                      '2026-08-06 08:00+00', false, '{"username": "seed023_07"}'),
  ('00000000-0000-4000-8000-000000000a08', 'snap_x@users.nia.app',    '2026-08-07 08:00+00', false, '{"username": "seed023_08"}'),
  ('00000000-0000-4000-8000-000000000a09', 'dev@app.localhost',       '2026-08-07 09:00+00', false, '{"username": "seed023_09"}'),
  ('00000000-0000-4000-8000-000000000a10', 'contest@latest.fr',       '2026-08-08 08:00+00', false, '{"username": "seed023_10"}');
insert into nia_test_seed023.users values
  ('moderateur', '00000000-0000-4000-8000-000000000a01'),
  ('probe',      '00000000-0000-4000-8000-000000000a02'),
  ('bob',        '00000000-0000-4000-8000-000000000a03'),
  ('alice',      '00000000-0000-4000-8000-000000000a04'),
  ('qa',         '00000000-0000-4000-8000-000000000a05'),
  ('anonyme',    '00000000-0000-4000-8000-000000000a06'),
  ('telephone',  '00000000-0000-4000-8000-000000000a07'),
  ('snap',       '00000000-0000-4000-8000-000000000a08'),
  ('dev',        '00000000-0000-4000-8000-000000000a09'),
  ('contest',    '00000000-0000-4000-8000-000000000a10');
update auth.users set raw_app_meta_data = '{"nia_origin": "snapchat-auth"}'
 where id = '00000000-0000-4000-8000-000000000a08';
commit;
insert into public.moderators (user_id) values ('00000000-0000-4000-8000-000000000a01');

-- Empreinte : chaque ligne en jsonb, par table.
create table nia_test_seed023.before as
  select 'profiles' as t, to_jsonb(x) as row from public.profiles x
  union all select 'videos', to_jsonb(x) from public.videos x
  union all select 'comments', to_jsonb(x) from public.comments x
  union all select 'moderators', to_jsonb(x) from public.moderators x
  union all select 'auth.users', to_jsonb(x) from auth.users x;
create table nia_test_seed023.counts as select nia_test.snapshot() as snap;
