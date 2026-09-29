-- Preuve que 013 échoue sur un Supabase actuel (trigger storage.protect_delete).
-- À exécuter APRÈS 001–013 et AVANT 014. Postgres LOCAL uniquement.
\set ON_ERROR_STOP 1
begin;
do $$
declare
  a uuid := nia_test.mk_user('reg013');
  r jsonb;
begin
  perform nia_test.mk_video(a);
  r := nia_test.delete_as(a);
  perform nia_test.eq(r->>'ok', 'false', '013 : la RPC échoue');
  perform nia_test.eq(r->>'sqlstate', '42501', '013 : sqlstate 42501 (protect_delete)');
  perform nia_test.eq(nia_test.n(format('select 1 from auth.users where id = %L', a)), 1::bigint,
    '013 : rollback, le compte existe encore');
  perform nia_test.eq(nia_test.n(format('select 1 from public.videos where user_id = %L', a)), 1::bigint,
    '013 : rollback, la vidéo existe encore');
  perform nia_test.ok('013 échoue (42501 « ' || (r->>'message') || ' ») et ne supprime rien');
end $$;
rollback;
