-- Tests de 022 (suppression définitive d'une vidéo, reposts conservés).
-- Postgres LOCAL jetable uniquement (run_local.sh), après 017, 018 et 022
-- appliquées (022 deux fois). Chaque groupe tourne dans une transaction annulée.
\set ON_ERROR_STOP 1

-- Appel de la RPC comme l'app (rôle authenticated + claims JWT).
create or replace function nia_test.del_for_good(p_uid uuid, p_video uuid) returns jsonb
language plpgsql as $$
declare r jsonb;
begin
  r := nia_test.exec_as('authenticated', p_uid,
         format('select public.delete_own_video_for_good(%L::uuid) as r', p_video));
  if not (r->>'ok')::boolean then
    return jsonb_build_object('error', r->>'sqlstate', 'message', r->>'message');
  end if;
  return r->'rows'->0->'r';
end $$;

-- Ancien comptage client (lib/videos.ts cheminEncoreReference) : SELECT
-- ordinaire, donc filtré par la RLS de l'appelant.
create or replace function nia_test.legacy_refs(p_uid uuid, p_video uuid, p_path text) returns int
language sql as $$
  select nia_test.seen('authenticated', p_uid,
    format('select id from public.videos where (storage_path = %L or cover_path = %L) and id <> %L::uuid',
           p_path, p_path, p_video))
$$;

create or replace function nia_test.media(p_video uuid) returns text language sql as $$
  select storage_path from public.videos where id = p_video
$$;
create or replace function nia_test.cover(p_video uuid) returns text language sql as $$
  select cover_path from public.videos where id = p_video
$$;

-- ===========================================================================
-- D1. Droits : visiteur refusé, JWT sans sub refusé, service_role refusé
-- ===========================================================================
begin;
do $$
declare
  a uuid := nia_test.mk_user('d1_a');
  v uuid := nia_test.mk_video(a, true);
  r jsonb;
begin
  r := nia_test.exec_as('anon', null, format('select public.delete_own_video_for_good(%L::uuid)', v));
  perform nia_test.eq(r->>'sqlstate', '42501', 'D1 anon : pas de droit d''exécution');
  r := nia_test.exec_as('service_role', null, format('select public.delete_own_video_for_good(%L::uuid)', v));
  perform nia_test.eq(r->>'sqlstate', '42501', 'D1 service_role : pas de droit d''exécution');
  r := nia_test.exec_as('authenticated', null, format('select public.delete_own_video_for_good(%L::uuid)', v));
  perform nia_test.eq(r->>'message', 'not_authenticated', 'D1 authenticated sans sub : not_authenticated');
  perform nia_test.eq(nia_test.n(format('select 1 from public.videos where id = %L', v)), 1::bigint,
    'D1 la vidéo est intacte');
  perform nia_test.ok('D1 droits de la RPC');
end $$;
rollback;

-- ===========================================================================
-- D2. Cas courant : aucun repost → ligne supprimée, média + couverture effaçables
-- ===========================================================================
begin;
do $$
declare
  a uuid := nia_test.mk_user('d2_a');
  c uuid := nia_test.mk_user('d2_c');
  v uuid := nia_test.mk_video(a, true);
  m text := nia_test.media(v);
  k text := nia_test.cover(v);
  n_obj bigint := nia_test.n('select 1 from storage.objects');
  r jsonb;
begin
  insert into public.likes (user_id, video_id) values (c, v);
  insert into public.comments (user_id, video_id, body) values (c, v, 'bravo');
  r := nia_test.del_for_good(a, v);
  perform nia_test.eq(r, jsonb_build_object('ok', true, 'removable', jsonb_build_array(m, k),
    'kept', '[]'::jsonb), 'D2 réponse (ordre : média puis couverture)');
  perform nia_test.eq(nia_test.n(format('select 1 from public.videos where id = %L', v)), 0::bigint,
    'D2 ligne supprimée');
  perform nia_test.eq(nia_test.n(format('select 1 from public.likes where video_id = %L', v))
    + nia_test.n(format('select 1 from public.comments where video_id = %L', v)), 0::bigint,
    'D2 likes et commentaires partis par cascade');
  perform nia_test.eq(nia_test.n('select 1 from storage.objects'), n_obj,
    'D2 la RPC ne touche jamais storage.objects (effacement par l''API Storage)');
  -- Deuxième appel : la ligne n'existe plus.
  perform nia_test.eq(nia_test.del_for_good(a, v), '{"ok": false, "reason": "not_found"}'::jsonb,
    'D2 deuxième appel : not_found');
  perform nia_test.ok('D2 suppression sans repost');
end $$;
rollback;

-- ===========================================================================
-- D3. Vidéo d'un autre compte, vidéo inexistante : même réponse, rien ne bouge
-- ===========================================================================
begin;
do $$
declare
  a uuid := nia_test.mk_user('d3_a');
  b uuid := nia_test.mk_user('d3_b');
  v uuid := nia_test.mk_video(a, true);
  r jsonb;
begin
  r := nia_test.del_for_good(b, v);
  perform nia_test.eq(r, '{"ok": false, "reason": "not_found"}'::jsonb, 'D3 vidéo d''autrui : not_found');
  perform nia_test.eq(nia_test.n(format('select 1 from public.videos where id = %L', v)), 1::bigint,
    'D3 vidéo d''autrui intacte');
  perform nia_test.eq(nia_test.del_for_good(b, gen_random_uuid()), r,
    'D3 vidéo inexistante : réponse identique (aucune fuite)');
  perform nia_test.eq(nia_test.del_for_good(a, null), '{"ok": false, "reason": "not_found"}'::jsonb,
    'D3 identifiant NULL : not_found');
  perform nia_test.ok('D3 aucune fuite, aucune suppression d''autrui');
end $$;
rollback;

-- ===========================================================================
-- D4. Vidéo masquée ou retirée par la modération : refus (preuve, 017)
-- ===========================================================================
begin;
do $$
declare
  a uuid := nia_test.mk_user('d4_a');
  v1 uuid := nia_test.mk_video(a, true);
  v2 uuid := nia_test.mk_video(a);
begin
  update public.videos set moderation_state = 'held' where id = v1;
  update public.videos set moderation_state = 'removed' where id = v2;
  perform nia_test.eq(nia_test.del_for_good(a, v1), '{"ok": false, "reason": "moderation_hold"}'::jsonb,
    'D4 vidéo retenue : moderation_hold');
  perform nia_test.eq(nia_test.del_for_good(a, v2), '{"ok": false, "reason": "moderation_hold"}'::jsonb,
    'D4 vidéo retirée : moderation_hold');
  perform nia_test.eq(nia_test.n(format('select 1 from public.videos where id in (%L, %L)', v1, v2)), 2::bigint,
    'D4 les deux lignes restent');
  perform nia_test.ok('D4 garde de modération conservée');
end $$;
rollback;

-- ===========================================================================
-- D5. Repost PUBLIC d'autrui : fichier conservé, repost toujours visible
-- ===========================================================================
begin;
do $$
declare
  a uuid := nia_test.mk_user('d5_a');
  b uuid := nia_test.mk_user('d5_b');
  c uuid := nia_test.mk_user('d5_c');
  v uuid := nia_test.mk_video(a, true);
  m text := nia_test.media(v);
  k text := nia_test.cover(v);
  rp uuid := nia_test.mk_repost(b, v);   -- copie storage_path (pas cover_path)
  r jsonb;
begin
  r := nia_test.del_for_good(a, v);
  perform nia_test.eq(r, jsonb_build_object('ok', true, 'removable', jsonb_build_array(k),
    'kept', jsonb_build_array(m)), 'D5 média conservé (repost), couverture effaçable');
  perform nia_test.eq((select repost_of from public.videos where id = rp), null::uuid,
    'D5 repost_of passé à NULL (003, on delete set null)');
  perform nia_test.eq(nia_test.media(rp), m, 'D5 le repost désigne toujours le fichier');
  perform nia_test.eq(nia_test.seen('anon', null, format('select id from public.videos where id = %L', rp)), 1,
    'D5 repost toujours visible par un visiteur');
  perform nia_test.eq(nia_test.seen('authenticated', c, format('select id from public.videos where id = %L', rp)), 1,
    'D5 repost toujours visible par un tiers connecté');
  perform nia_test.ok('D5 repost public conservé');
end $$;
rollback;

-- ===========================================================================
-- D6. Reposts INVISIBLES à l'auteur (défaut 2) : fichier conservé dans tous
--     les cas — archivé, followers, private, masqué, supprimé (soft), blocage
-- ===========================================================================
begin;
do $$
declare
  a uuid;
  b uuid;
  v uuid;
  rp uuid;
  m text;
  k text;
  r jsonb;
  cas text;
begin
  foreach cas in array array['archived', 'followers', 'private', 'held', 'removed', 'soft_deleted',
                             'blocked_by_author', 'blocked_by_reposter'] loop
    a := nia_test.mk_user('d6_a_' || cas);
    b := nia_test.mk_user('d6_b_' || cas);
    v := nia_test.mk_video(a, true);
    m := nia_test.media(v);
    k := nia_test.cover(v);
    rp := nia_test.mk_repost(b, v);
    -- Le repost reprend aussi la couverture : les deux chemins sont désignés.
    update public.videos set cover_path = k where id = rp;
    case cas
      when 'archived' then update public.videos set status = 'archived' where id = rp;
      when 'followers' then update public.videos set visibility = 'followers' where id = rp;
      when 'private' then update public.videos set visibility = 'private' where id = rp;
      when 'held' then update public.videos set moderation_state = 'held' where id = rp;
      when 'removed' then update public.videos set moderation_state = 'removed' where id = rp;
      when 'soft_deleted' then update public.videos set status = 'deleted' where id = rp;
      when 'blocked_by_author' then insert into public.blocks (blocker_id, blocked_id) values (a, b);
      when 'blocked_by_reposter' then insert into public.blocks (blocker_id, blocked_id) values (b, a);
    end case;
    -- Témoin du défaut : l'ancien comptage client ne voit pas le repost.
    perform nia_test.eq(nia_test.legacy_refs(a, v, m), 0,
      'D6 ' || cas || ' : repost invisible à l''ancien comptage (témoin du défaut 2)');
    r := nia_test.del_for_good(a, v);
    perform nia_test.eq(r, jsonb_build_object('ok', true, 'removable', '[]'::jsonb,
      'kept', jsonb_build_array(m, k)), 'D6 ' || cas || ' : média et couverture conservés');
    perform nia_test.eq(nia_test.n(format('select 1 from public.videos where id = %L', v)), 0::bigint,
      'D6 ' || cas || ' : original supprimé');
    perform nia_test.eq(nia_test.n(format('select 1 from public.videos where id = %L and storage_path = %L', rp, m)),
      1::bigint, 'D6 ' || cas || ' : repost intact');
  end loop;
  perform nia_test.ok('D6 reposts invisibles comptés (archivé, followers, private, masqué, retiré, supprimé, blocage x2)');
end $$;
rollback;

-- ===========================================================================
-- D7. Repost de sa propre vidéo : fichier conservé tant qu'une ligne le
--     désigne, effaçable avec la dernière
-- ===========================================================================
begin;
do $$
declare
  a uuid := nia_test.mk_user('d7_a');
  v uuid := nia_test.mk_video(a, false);
  m text := nia_test.media(v);
  rp uuid := nia_test.mk_repost(a, v);
begin
  perform nia_test.eq(nia_test.del_for_good(a, v),
    jsonb_build_object('ok', true, 'removable', '[]'::jsonb, 'kept', jsonb_build_array(m)),
    'D7 original supprimé, fichier gardé pour son propre repost');
  perform nia_test.eq(nia_test.del_for_good(a, rp),
    jsonb_build_object('ok', true, 'removable', jsonb_build_array(m), 'kept', '[]'::jsonb),
    'D7 dernière ligne supprimée : fichier effaçable');
  perform nia_test.ok('D7 repost de sa propre vidéo');
end $$;
rollback;

-- ===========================================================================
-- D8. Supprimer son repost de la vidéo d'autrui : aucun chemin rendu,
--     l'original et ses fichiers ne bougent pas
-- ===========================================================================
begin;
do $$
declare
  a uuid := nia_test.mk_user('d8_a');
  b uuid := nia_test.mk_user('d8_b');
  v uuid := nia_test.mk_video(a, true);
  rp uuid := nia_test.mk_repost(b, v);
begin
  perform nia_test.eq(nia_test.del_for_good(b, rp),
    '{"ok": true, "removable": [], "kept": []}'::jsonb,
    'D8 chemins hors du dossier du reposteur : ni effaçables ni rendus');
  perform nia_test.eq(nia_test.n(format('select 1 from public.videos where id = %L', v)), 1::bigint,
    'D8 original intact');
  perform nia_test.ok('D8 suppression de son repost');
end $$;
rollback;

-- ===========================================================================
-- D9. Chemin hors du dossier (ligne fabriquée) : jamais rendu ; couverture
--     désignée par le cover_path d'une autre ligne : conservée ; média et
--     couverture identiques : un seul chemin
-- ===========================================================================
begin;
do $$
declare
  a uuid := nia_test.mk_user('d9_a');
  b uuid := nia_test.mk_user('d9_b');
  vb uuid := nia_test.mk_video(b, false);
  v uuid := nia_test.mk_video(a, true);
  k text := nia_test.cover(v);
  v2 uuid := nia_test.mk_video(a, false);
  m2 text := nia_test.media(v2);
  autre uuid := nia_test.mk_video(a, false);
  m3 text := nia_test.media(autre);
  partagee text := a::text || '/covers/partagee.jpg';
begin
  -- v : son média pointe (ligne fabriquée) vers le dossier de b.
  update public.videos set storage_path = nia_test.media(vb) where id = v;
  perform nia_test.eq(nia_test.del_for_good(a, v),
    jsonb_build_object('ok', true, 'removable', jsonb_build_array(k), 'kept', '[]'::jsonb),
    'D9 le chemin du dossier de b n''est jamais rendu');
  perform nia_test.eq(nia_test.n(format('select 1 from public.videos where id = %L', vb)), 1::bigint,
    'D9 la vidéo de b est intacte');
  -- v2 : sa couverture est aussi celle d'une autre ligne (cover_path).
  update public.videos set cover_path = partagee where id in (v2, autre);
  perform nia_test.eq(nia_test.del_for_good(a, v2),
    jsonb_build_object('ok', true, 'removable', jsonb_build_array(m2), 'kept', jsonb_build_array(partagee)),
    'D9 couverture partagée conservée, média effaçable');
  -- autre : couverture = média.
  update public.videos set cover_path = storage_path where id = autre;
  perform nia_test.eq(nia_test.del_for_good(a, autre),
    jsonb_build_object('ok', true, 'removable', jsonb_build_array(m3), 'kept', '[]'::jsonb),
    'D9 média = couverture : un seul chemin');
  perform nia_test.ok('D9 préfixe du dossier respecté, cover_path compté');
end $$;
rollback;

-- ===========================================================================
-- D10. Ce qui ne change pas : 015, suppression directe (ancien chemin de
--      l'app), policy videos_delete_own de 017
-- ===========================================================================
begin;
do $$
declare
  a uuid := nia_test.mk_user('d10_a');
  b uuid := nia_test.mk_user('d10_b');
  v1 uuid := nia_test.mk_video(a);
  v2 uuid := nia_test.mk_video(a);
  v3 uuid := nia_test.mk_video(a);
  r jsonb;
begin
  r := nia_test.exec_as('authenticated', a, format('select public.soft_delete_own_video(%L::uuid) as r', v1));
  perform nia_test.eq(r->'rows'->0->>'r', 'true', 'D10 015 soft_delete_own_video inchangée');
  -- Une vidéo supprimée « en douce » (015) peut être supprimée pour de bon.
  perform nia_test.eq(nia_test.del_for_good(a, v1)->>'ok', 'true', 'D10 ligne status=deleted : supprimable par la RPC');
  r := nia_test.dml_as('authenticated', a, format('delete from public.videos where id = %L', v2));
  perform nia_test.eq(r, '{"ok": true, "n": 1}'::jsonb, 'D10 ancien chemin (DELETE direct) toujours possible');
  update public.videos set moderation_state = 'held' where id = v3;
  r := nia_test.dml_as('authenticated', a, format('delete from public.videos where id = %L', v3));
  perform nia_test.eq(r, '{"ok": true, "n": 0}'::jsonb, 'D10 videos_delete_own refuse toujours une vidéo retenue');
  r := nia_test.dml_as('authenticated', b, format('delete from public.videos where id = %L', v3));
  perform nia_test.eq(r->>'n', '0', 'D10 videos_delete_own refuse toujours la vidéo d''autrui');
  perform nia_test.ok('D10 015, 017 et ancien chemin inchangés');
end $$;
rollback;

-- ===========================================================================
-- D11. Suppression de COMPTE (014) inchangée : elle efface toujours les
--      reposts faits par d'autres du contenu du compte (différence voulue)
-- ===========================================================================
begin;
do $$
declare
  a uuid := nia_test.mk_user('d11_a');
  b uuid := nia_test.mk_user('d11_b');
  v uuid := nia_test.mk_video(a, true);
  rp uuid := nia_test.mk_repost(b, v);
begin
  perform nia_test.eq(nia_test.delete_as(a)->>'ok', 'true', 'D11 delete_own_account');
  perform nia_test.eq(nia_test.n(format('select 1 from public.videos where id in (%L, %L)', v, rp)), 0::bigint,
    'D11 compte supprimé : original ET repost d''autrui supprimés (014 inchangée)');
  perform nia_test.ok('D11 014 inchangée');
end $$;
rollback;

-- ===========================================================================
-- D12. Triggers de videos toujours appliqués au DELETE de la RPC (017) :
--      une mise à l'abri en cours reste conservée
-- ===========================================================================
begin;
do $$
declare
  a uuid := nia_test.mk_user('d12_a');
  v uuid := nia_test.mk_video(a, true);
begin
  -- Vidéo retenue puis rétablie : la ligne de moderation_file_holds existe.
  update public.videos set moderation_state = 'held' where id = v;
  update public.videos set moderation_state = 'visible' where id = v;
  perform nia_test.eq(nia_test.del_for_good(a, v)->>'ok', 'true', 'D12 suppression après rétablissement');
  perform nia_test.eq((select desired from public.moderation_file_holds where video_id = v), 'held',
    'D12 trigger videos_20_moderation_files joué sur le DELETE de la RPC');
  perform nia_test.ok('D12 triggers de 017 appliqués');
end $$;
rollback;

-- ===========================================================================
-- Z. Concurrence : un repost ne peut pas se glisser entre le comptage et la
--    suppression (deux sessions réelles, dblink)
-- ===========================================================================
create extension if not exists dblink;
do $$
declare
  a uuid := nia_test.mk_user('z22_a');
  b uuid := nia_test.mk_user('z22_b');
begin
  perform nia_test.mk_video(a, false);
end $$;
do $$
declare
  a uuid := (select u.id from auth.users u where u.email = 'z22_a@example.test');
  b uuid := (select u.id from auth.users u where u.email = 'z22_b@example.test');
  v uuid := (select id from public.videos where user_id = a);
  r jsonb;
  st text;
  conn text := format('dbname=%s host=%s port=%s user=%s',
                      current_database(), current_setting('unix_socket_directories'),
                      current_setting('port'), current_user);
begin
  perform dblink_connect('z22', conn);
  perform dblink_exec('z22', 'begin');
  perform * from dblink('z22', format('select set_config(''request.jwt.claims'', %L, true)',
                                      json_build_object('sub', a, 'role', 'authenticated')::text)) as t(x text);
  perform dblink_exec('z22', 'set local role authenticated');
  select t.r into r from dblink('z22', format('select public.delete_own_video_for_good(%L::uuid)', v)) as t(r jsonb);
  perform nia_test.eq(r->>'ok', 'true', 'Z1 RPC dans la 2e session (non validée)');
  -- La 2e session tient la ligne : un repost attend (clé étrangère).
  begin
    set local lock_timeout = '1s';
    insert into public.videos (user_id, storage_path, status, repost_of)
    values (b, a::text || '/course.mp4', 'published', v);
    st := 'inséré';
  exception when lock_not_available then
    st := 'bloqué';
  end;
  perform nia_test.eq(st, 'bloqué', 'Z1 repost concurrent bloqué par le verrou de la RPC');
  perform dblink_exec('z22', 'commit');
  perform dblink_disconnect('z22');
  begin
    insert into public.videos (user_id, storage_path, status, repost_of)
    values (b, a::text || '/course.mp4', 'published', v);
    st := 'inséré';
  exception when foreign_key_violation then
    st := 'refusé';
  end;
  perform nia_test.eq(st, 'refusé', 'Z1 après validation : repost d''un original disparu refusé');
  perform nia_test.ok('Z1 pas de repost entre le comptage et la suppression');
end $$;
-- Nettoyage des données validées de la section Z.
do $$
begin
  perform set_config('storage.allow_delete_query', 'true', true);
  delete from storage.objects o
   where o.owner in (select u.id from auth.users u where u.email like 'z22\_%@example.test');
  delete from auth.users u where u.email like 'z22\_%@example.test';
end $$;
