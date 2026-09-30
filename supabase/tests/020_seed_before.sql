-- Données « d'avant 020 » : prouvent que 020 ne modifie aucune ligne
-- existante (empreinte complète de chaque table touchée, prise juste avant
-- 020 et comparée après, colonnes nouvelles exclues).
-- Postgres LOCAL jetable uniquement ; lancé par run_local.sh juste avant 020.
\set ON_ERROR_STOP 1
drop schema if exists nia_test_seed020 cascade;
create schema nia_test_seed020;
create table nia_test_seed020.ids (owner uuid, video uuid, repost uuid, live uuid);
do $$
declare
  o uuid := nia_test.mk_user('s20_owner'); f uuid := nia_test.mk_user('s20_fan');
  v uuid := nia_test.mk_video(o); rp uuid; l uuid;
begin
  rp := nia_test.mk_repost(f, v);
  insert into public.comments (video_id, user_id, body) values (v, f, 'Avant 020');
  insert into public.live_streams (user_id, title) values (o, 'Live d''avant 020') returning id into l;
  insert into nia_test_seed020.ids values (o, v, rp, l);
end $$;

-- Empreinte : chaque ligne en jsonb, par table.
create table nia_test_seed020.before as
  select 'videos' as t, to_jsonb(x) as row from public.videos x
  union all select 'live_streams', to_jsonb(x) from public.live_streams x
  union all select 'profiles', to_jsonb(x) from public.profiles x
  union all select 'comments', to_jsonb(x) from public.comments x
  union all select 'likes', to_jsonb(x) from public.likes x
  union all select 'saves', to_jsonb(x) from public.saves x
  union all select 'reposts', to_jsonb(x) from public.reposts x
  union all select 'follows', to_jsonb(x) from public.follows x
  union all select 'reports', to_jsonb(x) from public.reports x
  union all select 'notifications', to_jsonb(x) from public.notifications x;
