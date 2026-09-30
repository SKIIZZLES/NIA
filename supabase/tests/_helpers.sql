-- Aides de test (Postgres LOCAL jetable uniquement). Schéma nia_test, supprimé
-- par 99_cleanup. Voir supabase/tests/README.md.
\set ON_ERROR_STOP 1

drop schema if exists nia_test cascade;
create schema nia_test;
grant usage on schema nia_test to anon, authenticated, service_role;

-- Exécute p_sql sous p_role avec les claims JWT {sub, role} (comme PostgREST).
-- Renvoie {"ok": true, "rows": [...]} ou {"ok": false, "sqlstate": ..., "message": ...}.
create function nia_test.exec_as(p_role text, p_sub uuid, p_sql text)
returns jsonb language plpgsql as $$
declare
  v_rows jsonb;
begin
  perform set_config(
    'request.jwt.claims',
    case when p_sub is null then '' else json_build_object('sub', p_sub, 'role', p_role)::text end,
    true
  );
  execute format('set local role %I', p_role);
  begin
    execute format('select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from (%s) t', p_sql)
      into v_rows;
  exception when others then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    return jsonb_build_object('ok', false, 'sqlstate', sqlstate, 'message', sqlerrm);
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return jsonb_build_object('ok', true, 'rows', v_rows);
end $$;
grant execute on function nia_test.exec_as(text, uuid, text) to anon, authenticated, service_role;

create function nia_test.delete_as(p_uid uuid) returns jsonb language sql as $$
  select nia_test.exec_as('authenticated', p_uid, 'select public.delete_own_account() as r')
$$;

create function nia_test.claim(p_batch int default 10) returns jsonb language sql as $$
  select nia_test.exec_as('service_role', null,
    format('select id, status, attempts, prefix from public.claim_storage_purge_jobs(%s)', p_batch))
$$;

create function nia_test.eq(p_actual anyelement, p_expected anyelement, p_label text)
returns void language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'not ok - % : attendu %, obtenu %', p_label, p_expected, p_actual;
  end if;
end $$;

create function nia_test.ok(p_label text) returns void language plpgsql as $$
begin
  raise notice 'ok - %', p_label;
end $$;

-- Crée un utilisateur Auth (le trigger handle_new_user crée le profil).
create function nia_test.mk_user(p_handle text) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email) values (v, p_handle || '@example.test');
  return v;
end $$;

-- Crée une vidéo + son objet Storage simulé sous {owner}/.
create function nia_test.mk_video(p_owner uuid, p_with_cover boolean default false)
returns uuid language plpgsql as $$
declare
  v uuid := gen_random_uuid();
  v_path text := p_owner::text || '/' || v::text || '.mp4';
  v_cover text := case when p_with_cover then p_owner::text || '/covers/' || v::text || '.jpg' end;
begin
  insert into public.videos (id, user_id, storage_path, cover_path, status)
  values (v, p_owner, v_path, v_cover, 'published');
  insert into storage.objects (bucket_id, name, owner) values ('videos', v_path, p_owner);
  if v_cover is not null then
    insert into storage.objects (bucket_id, name, owner) values ('videos', v_cover, p_owner);
  end if;
  return v;
end $$;

-- Reproduit lib/reposts.ts createRepost : ligne `reposts` + ligne `videos`
-- appartenant au reposteur, copiant storage_path / caption de l'original.
create function nia_test.mk_repost(p_reposter uuid, p_original uuid) returns uuid
language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into public.reposts (user_id, video_id) values (p_reposter, p_original);
  insert into public.videos (id, user_id, storage_path, caption, hashtags, status, repost_of)
  select v, p_reposter, o.storage_path, o.caption, o.hashtags, 'published', p_original
    from public.videos o where o.id = p_original;
  return v;
end $$;

create function nia_test.n(p_sql text) returns bigint language plpgsql as $$
declare c bigint;
begin
  execute format('select count(*) from (%s) t', p_sql) into c;
  return c;
end $$;

-- Empreinte de toutes les tables (double exécution : rien ne doit bouger).
create function nia_test.snapshot() returns text language sql as $$
  select string_agg(format('%s=%s', t, nia_test.n('select 1 from ' || t)), ',' order by t)
    from unnest(array[
      'auth.users', 'public.profiles', 'public.videos', 'public.likes', 'public.comments',
      'public.follows', 'public.notifications', 'public.reports', 'public.blocks',
      'public.reposts', 'public.saves', 'public.sounds', 'public.events',
      'public.event_attendees', 'public.live_streams', 'public.series',
      'public.series_items', 'public.storage_purge_jobs', 'storage.objects'
    ]) as t
$$;

-- Comme exec_as, pour un INSERT / UPDATE / DELETE : {"ok": true, "n": lignes}.
create function nia_test.dml_as(p_role text, p_sub uuid, p_sql text)
returns jsonb language plpgsql as $$
declare v_n bigint;
begin
  perform set_config('request.jwt.claims',
    case when p_sub is null then '' else json_build_object('sub', p_sub, 'role', p_role)::text end, true);
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

-- Nombre de lignes vues par p_role / p_sub (lève si la requête échoue).
create function nia_test.seen(p_role text, p_sub uuid, p_sql text)
returns int language plpgsql as $$
declare r jsonb;
begin
  r := nia_test.exec_as(p_role, p_sub, p_sql);
  if not (r->>'ok')::boolean then
    raise exception 'not ok - requête en erreur : %', r->>'message';
  end if;
  return jsonb_array_length(r->'rows');
end $$;
