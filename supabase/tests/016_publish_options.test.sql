-- Tests de 016_publish_options.sql. Postgres LOCAL jetable uniquement
-- (voir supabase/tests/run_local.sh). Chaque scénario tourne dans une
-- transaction annulée.
\set ON_ERROR_STOP 1

-- exec_as enveloppe la requête dans un SELECT : impossible pour un INSERT.
-- dml_as exécute l'ordre tel quel sous le rôle et les claims donnés.
create or replace function nia_test.dml_as(p_role text, p_sub uuid, p_sql text)
returns jsonb language plpgsql as $$
declare
  v_n bigint;
begin
  perform set_config(
    'request.jwt.claims',
    case when p_sub is null then '' else json_build_object('sub', p_sub, 'role', p_role)::text end,
    true
  );
  execute format('set local role %I', p_role);
  begin
    execute p_sql;
    get diagnostics v_n = row_count;
  exception when others then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    return jsonb_build_object('ok', false, 'sqlstate', sqlstate, 'message', sqlerrm);
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return jsonb_build_object('ok', true, 'n', v_n);
end $$;
grant execute on function nia_test.dml_as(text, uuid, text) to anon, authenticated, service_role;

-- Nombre de lignes visibles par (rôle, utilisateur) pour une requête.
create or replace function nia_test.seen(p_role text, p_sub uuid, p_sql text)
returns int language plpgsql as $$
declare r jsonb;
begin
  r := nia_test.exec_as(p_role, p_sub, p_sql);
  if not (r->>'ok')::boolean then
    raise exception 'not ok - requête en erreur : %', r->>'message';
  end if;
  return jsonb_array_length(r->'rows');
end $$;

-- ===========================================================================
-- A. Colonnes, valeurs par défaut, contraintes
-- ===========================================================================
begin;
do $$
declare
  a uuid := nia_test.mk_user('s5_a');
  v uuid;
  r jsonb;
begin
  v := nia_test.mk_video(a);
  perform nia_test.eq(
    (select row(visibility, allow_comments, allow_reuse, ai_generated, alt_text, location_text, edit_meta)::text
       from public.videos where id = v),
    row('public', true, true, false, null::text, null::text, null::jsonb)::text,
    'A1 valeurs par défaut');
  perform nia_test.ok('A1 une vidéo existante reste publique, commentable, republiable');

  r := nia_test.dml_as('authenticated', a, format(
    'update public.videos set visibility = %L where id = %L', 'amis', v));
  perform nia_test.eq(r->>'sqlstate', '23514', 'A2 visibility inconnue');
  r := nia_test.dml_as('authenticated', a, format(
    'update public.videos set alt_text = repeat(''x'', 501) where id = %L', v));
  perform nia_test.eq(r->>'sqlstate', '23514', 'A2 alt_text > 500');
  r := nia_test.dml_as('authenticated', a, format(
    'update public.videos set location_text = repeat(''x'', 101) where id = %L', v));
  perform nia_test.eq(r->>'sqlstate', '23514', 'A2 location_text > 100');
  perform nia_test.ok('A2 CHECK visibility / alt_text / location_text');

  -- edit_meta : types et bornes, refus propre (23514, jamais un cast en erreur)
  foreach r in array array[
    '[1,2]'::jsonb,
    '{"speed": 8}',
    '{"speed": "2"}',
    '{"originalVolume": 1.5}',
    '{"sound": {"offsetMs": -5}}',
    '{"sound": {"volume": "fort"}}',
    '{"sound": 3}',
    '{"overlays": {"items": {}}}',
    jsonb_build_object('overlays', jsonb_build_object('items',
      (select jsonb_agg(jsonb_build_object('id', i)) from generate_series(1, 21) i))),
    jsonb_build_object('pad', repeat('x', 17000))
  ] loop
    perform nia_test.eq(
      nia_test.dml_as('authenticated', a, format(
        'update public.videos set edit_meta = %L::jsonb where id = %L', r, v))->>'sqlstate',
      '23514', 'A3 edit_meta refusé : ' || left(r::text, 60));
  end loop;
  perform nia_test.ok('A3 edit_meta mal formé refusé (10 cas)');

  r := nia_test.dml_as('authenticated', a, format(
    'update public.videos set edit_meta = %L::jsonb where id = %L',
    '{"v":1,"trim":{"startMs":1000,"endMs":9000,"sourceDurationMs":12000},"speed":1.5,'
    '"sound":{"offsetMs":2500,"volume":0.8},"originalVolume":0.3,'
    '"overlays":{"v":1,"aspect":0.5625,"items":[{"id":"o1","type":"text","text":"Salut","x":0.5,"y":0.4}]}}',
    v));
  perform nia_test.eq(r->>'n', '1', 'A4 edit_meta valide accepté');
  perform nia_test.ok('A4 edit_meta valide accepté');
end $$;
rollback;

-- ===========================================================================
-- B. Lecture des vidéos selon la visibilité
-- ===========================================================================
begin;
do $$
declare
  a uuid := nia_test.mk_user('s5_owner');
  b uuid := nia_test.mk_user('s5_follower');
  c uuid := nia_test.mk_user('s5_stranger');
  v_pub uuid; v_fol uuid; v_priv uuid; v_del uuid; v_arch uuid;
  q text;
begin
  v_pub := nia_test.mk_video(a);
  v_fol := nia_test.mk_video(a);
  v_priv := nia_test.mk_video(a);
  v_del := nia_test.mk_video(a);
  v_arch := nia_test.mk_video(a);
  update public.videos set visibility = 'followers' where id = v_fol;
  update public.videos set visibility = 'private' where id = v_priv;
  update public.videos set status = 'deleted' where id = v_del;
  update public.videos set status = 'archived' where id = v_arch;
  insert into public.follows (follower_id, following_id) values (b, a);
  q := format('select id from public.videos where user_id = %L', a);

  perform nia_test.eq(nia_test.seen('anon', null, q), 1, 'B1 anon : public seulement');
  perform nia_test.eq(nia_test.seen('authenticated', c, q), 1, 'B2 inconnu : public seulement');
  perform nia_test.eq(nia_test.seen('authenticated', b, q), 2, 'B3 abonné : public + abonnés');
  -- créateur : public, abonnés, privé, archivé (pas la supprimée)
  perform nia_test.eq(nia_test.seen('authenticated', a, q), 4, 'B4 créateur : tout sauf supprimée');
  perform nia_test.eq(nia_test.seen('authenticated', b,
    format('select id from public.videos where id = %L', v_priv)), 0, 'B5 privé invisible à l''abonné');
  perform nia_test.ok('B public / abonnés / privé / supprimée');

  -- nia_can_view_video suit exactement la policy
  perform nia_test.eq(nia_test.seen('authenticated', c, format(
    'select 1 where public.nia_can_view_video(%L)', v_fol)), 0, 'B6 fonction = policy (inconnu)');
  perform nia_test.eq(nia_test.seen('authenticated', b, format(
    'select 1 where public.nia_can_view_video(%L)', v_fol)), 1, 'B6 fonction = policy (abonné)');
  perform nia_test.ok('B6 nia_can_view_video cohérente avec la policy');

  -- le créateur publie une vidéo « followers » et relit la ligne (INSERT … RETURNING)
  perform nia_test.eq(nia_test.dml_as('authenticated', a, format(
    'insert into public.videos (user_id, storage_path, status, visibility) values (%L, ''x.mp4'', ''published'', ''private'') returning id',
    a))->>'ok', 'true', 'B7 insert privé + returning');
  perform nia_test.ok('B7 publication privée (INSERT … RETURNING) par le créateur');
end $$;
rollback;

-- ===========================================================================
-- C. Commentaires
-- ===========================================================================
begin;
do $$
declare
  a uuid := nia_test.mk_user('s5c_owner');
  b uuid := nia_test.mk_user('s5c_follower');
  c uuid := nia_test.mk_user('s5c_stranger');
  v_pub uuid; v_fol uuid; v_off uuid;
  r jsonb;
  ins text := 'insert into public.comments (video_id, user_id, body) values (%L, %L, ''salut'')';
begin
  v_pub := nia_test.mk_video(a);
  v_fol := nia_test.mk_video(a);
  v_off := nia_test.mk_video(a);
  update public.videos set visibility = 'followers' where id = v_fol;
  update public.videos set allow_comments = false where id = v_off;
  insert into public.follows (follower_id, following_id) values (b, a);

  perform nia_test.eq(nia_test.dml_as('authenticated', c, format(ins, v_pub, c))->>'ok', 'true', 'C1 public');
  perform nia_test.eq(nia_test.dml_as('authenticated', b, format(ins, v_fol, b))->>'ok', 'true', 'C2 abonné');
  r := nia_test.dml_as('authenticated', c, format(ins, v_fol, c));
  perform nia_test.eq(r->>'sqlstate', '42501', 'C3 inconnu sur vidéo abonnés');
  r := nia_test.dml_as('authenticated', c, format(ins, v_off, c));
  perform nia_test.eq(r->>'sqlstate', '42501', 'C4 commentaires désactivés');
  r := nia_test.dml_as('authenticated', a, format(ins, v_off, a));
  perform nia_test.eq(r->>'sqlstate', '42501', 'C5 désactivés aussi pour le créateur');
  r := nia_test.dml_as('authenticated', c, format(ins, v_pub, b));
  perform nia_test.eq(r->>'sqlstate', '42501', 'C6 user_id d''un autre');
  perform nia_test.ok('C1–C6 écriture des commentaires');

  -- lecture
  perform nia_test.eq(nia_test.seen('authenticated', c, format(
    'select id from public.comments where video_id = %L', v_fol)), 0, 'C7 commentaires abonnés cachés à l''inconnu');
  perform nia_test.eq(nia_test.seen('anon', null, format(
    'select id from public.comments where video_id = %L', v_pub)), 1, 'C8 commentaires publics lisibles par anon');

  -- la vidéo devient privée : B voit encore SON commentaire, et peut le supprimer (PR #27)
  update public.videos set visibility = 'private' where id = v_fol;
  perform nia_test.eq(nia_test.seen('authenticated', b, format(
    'select id from public.comments where video_id = %L', v_fol)), 1, 'C9 son commentaire reste lisible');
  r := nia_test.dml_as('authenticated', b, format(
    'delete from public.comments where video_id = %L and user_id = %L returning id', v_fol, b));
  perform nia_test.eq(r->>'n', '1', 'C10 suppression de son commentaire (DELETE … RETURNING)');
  perform nia_test.ok('C7–C10 lecture et suppression des commentaires');
end $$;
rollback;

-- ===========================================================================
-- D. Republication
-- ===========================================================================
begin;
do $$
declare
  a uuid := nia_test.mk_user('s5r_owner');
  b uuid := nia_test.mk_user('s5r_reposter');
  c uuid := nia_test.mk_user('s5r_viewer');
  v_ok uuid; v_noreuse uuid; v_fol uuid; v_rep uuid;
  r jsonb;
  ins_rep text := 'insert into public.reposts (user_id, video_id) values (%L, %L)';
  ins_vid text := 'insert into public.videos (user_id, storage_path, status, repost_of) values (%L, ''r.mp4'', ''published'', %L)';
begin
  v_ok := nia_test.mk_video(a);
  v_noreuse := nia_test.mk_video(a);
  v_fol := nia_test.mk_video(a);
  update public.videos set allow_reuse = false where id = v_noreuse;
  update public.videos set visibility = 'followers' where id = v_fol;
  insert into public.follows (follower_id, following_id) values (b, a);

  perform nia_test.eq(nia_test.dml_as('authenticated', b, format(ins_rep, b, v_ok))->>'ok', 'true', 'D1 reposts ok');
  perform nia_test.eq(nia_test.dml_as('authenticated', b, format(ins_vid, b, v_ok))->>'ok', 'true', 'D1 videos ok');
  select id into v_rep from public.videos where repost_of = v_ok;

  perform nia_test.eq(nia_test.dml_as('authenticated', b, format(ins_rep, b, v_noreuse))->>'sqlstate', '42501', 'D2 reposts refusé (allow_reuse)');
  perform nia_test.eq(nia_test.dml_as('authenticated', b, format(ins_vid, b, v_noreuse))->>'sqlstate', '42501', 'D2 videos refusé (allow_reuse)');
  perform nia_test.eq(nia_test.dml_as('authenticated', b, format(ins_rep, b, v_fol))->>'sqlstate', '42501', 'D3 reposts refusé (abonnés)');
  perform nia_test.eq(nia_test.dml_as('authenticated', b, format(ins_vid, b, v_fol))->>'sqlstate', '42501', 'D3 videos refusé (abonnés)');
  perform nia_test.eq(nia_test.dml_as('authenticated', c, format(ins_vid, c, v_rep))->>'sqlstate', '42501', 'D4 republier une republication');
  perform nia_test.ok('D1–D4 garde-fous de republication');

  -- l'original retire la republication : la ligne repost disparaît partout
  perform nia_test.eq(nia_test.seen('anon', null, format('select id from public.videos where id = %L', v_rep)), 1, 'D5 avant');
  update public.videos set allow_reuse = false where id = v_ok;
  perform nia_test.eq(nia_test.seen('anon', null, format('select id from public.videos where id = %L', v_rep)), 0, 'D5 après (anon)');
  perform nia_test.eq(nia_test.seen('authenticated', b, format('select id from public.videos where id = %L', v_rep)), 0, 'D5 après (reposteur)');
  update public.videos set allow_reuse = true, visibility = 'private' where id = v_ok;
  perform nia_test.eq(nia_test.seen('anon', null, format('select id from public.videos where id = %L', v_rep)), 0, 'D6 original privé');
  perform nia_test.ok('D5–D6 une republication suit les réglages de l''original');
end $$;
rollback;

-- ===========================================================================
-- E. Droits des fonctions
-- ===========================================================================
begin;
do $$
begin
  perform nia_test.eq(
    (select count(*) from pg_proc p
      where p.pronamespace = 'public'::regnamespace
        and p.proname in ('nia_is_follower', 'nia_video_reusable', 'nia_video_row_visible',
                          'nia_can_view_video', 'nia_video_accepts_comments')
        and p.prosecdef
        and p.proconfig @> array['search_path=""']),
    5::bigint, 'E1 security definer + search_path vide');
  perform nia_test.eq(has_function_privilege('anon', 'public.nia_can_view_video(uuid)', 'execute'), true, 'E2 anon');
  perform nia_test.ok('E1–E2 fonctions nia_* : definer, search_path vide, exécutables par anon');
end $$;
rollback;

-- ===========================================================================
-- F. Storage : listing limité à son propre dossier
-- ===========================================================================
begin;
grant select on storage.objects to anon, authenticated;
do $$
declare
  a uuid := nia_test.mk_user('s5s_a');
  b uuid := nia_test.mk_user('s5s_b');
  q text;
begin
  insert into storage.buckets (id, name, public) values ('videos', 'videos', true)
    on conflict (id) do nothing;
  insert into storage.objects (bucket_id, name, owner) values
    ('videos', a::text || '/prive.mp4', a),
    ('videos', a::text || '/covers/prive.jpg', a);
  q := format('select 1 from storage.objects where bucket_id = ''videos'' and name like %L', a::text || '/%');
  perform nia_test.eq(nia_test.seen('anon', null, q), 0, 'F1 anon ne liste pas le dossier de A');
  perform nia_test.eq(nia_test.seen('authenticated', b, q), 0, 'F2 B ne liste pas le dossier de A');
  perform nia_test.eq(nia_test.seen('authenticated', a, q), 2, 'F3 A liste son dossier (remove / upsert)');
  perform nia_test.eq(
    (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'videos_storage_public_read'), 0::bigint, 'F4 ancienne policy retirée');
  perform nia_test.ok('F1–F4 Storage : listing limité à son dossier');
end $$;
rollback;
