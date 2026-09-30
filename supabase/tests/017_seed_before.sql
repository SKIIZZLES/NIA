-- Données « d'avant 017 » pour vérifier le rattrapage (section 11 de 017).
-- Postgres LOCAL jetable uniquement ; lancé par run_local.sh juste avant 017.
\set ON_ERROR_STOP 1
drop schema if exists nia_test_seed cascade;
create schema nia_test_seed;
create table nia_test_seed.backfill (video_p0 uuid, report_p0 uuid, video_three uuid, video_one uuid);
do $$
declare
  o uuid := nia_test.mk_user('bf_owner');
  r1 uuid := nia_test.mk_user('bf_r1'); r2 uuid := nia_test.mk_user('bf_r2'); r3 uuid := nia_test.mk_user('bf_r3');
  v0 uuid := nia_test.mk_video(o); v3 uuid := nia_test.mk_video(o); v1 uuid := nia_test.mk_video(o);
  rp uuid;
begin
  update public.profiles set created_at = now() - interval '10 days' where id in (r1, r2, r3);
  -- ancienne app : le motif est le libellé français (+ « — précisions »)
  insert into public.reports (reporter_id, target_type, target_id, reason)
  values (r1, 'video', v0, 'Pédocriminalité — vu ce soir') returning id into rp;
  insert into public.reports (reporter_id, target_type, target_id, reason) values
    (r1, 'video', v3, 'Harcèlement'), (r2, 'video', v3, 'spam'), (r3, 'video', v3, 'illegal'),
    (r1, 'video', v1, 'Spam'), (r1, 'video', v1, 'Spam — encore');
  insert into nia_test_seed.backfill values (v0, rp, v3, v1);
end $$;
