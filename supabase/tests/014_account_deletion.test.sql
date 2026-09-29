-- Tests de 014_account_deletion.sql. Postgres LOCAL jetable uniquement
-- (voir supabase/tests/run_local.sh). Chaque scénario tourne dans une
-- transaction annulée (rollback), sauf le test de concurrence (section Z).
\set ON_ERROR_STOP 1

-- ===========================================================================
-- A. Structure, droits, sécurité
-- ===========================================================================
begin;
do $$
declare
  r jsonb;
  u uuid := nia_test.mk_user('perm_u');
begin
  -- security definer + search_path vide sur les 4 fonctions
  perform nia_test.eq(
    (select count(*) from pg_proc p
      where p.pronamespace = 'public'::regnamespace
        and p.proname in ('delete_own_account', 'claim_storage_purge_jobs',
                          'complete_storage_purge_job', 'fail_storage_purge_job')
        and p.prosecdef
        and p.proconfig @> array['search_path=""']),
    4::bigint, 'A1 security definer + search_path="" sur les 4 fonctions');
  perform nia_test.ok('A1 security definer + search_path vide');

  -- delete_own_account n'accepte aucun argument (compatibilité AAB)
  perform nia_test.eq(
    (select pronargs::int from pg_proc where proname = 'delete_own_account'
       and pronamespace = 'public'::regnamespace), 0, 'A2 aucun argument');
  perform nia_test.ok('A2 delete_own_account() sans argument');

  -- EXECUTE
  perform nia_test.eq(has_function_privilege('anon', 'public.delete_own_account()', 'execute'), false, 'A3 anon');
  perform nia_test.eq(has_function_privilege('authenticated', 'public.delete_own_account()', 'execute'), true, 'A3 authenticated');
  perform nia_test.eq(has_function_privilege('service_role', 'public.delete_own_account()', 'execute'), false, 'A3 service_role');
  perform nia_test.eq(has_function_privilege('public', 'public.delete_own_account()', 'execute'), false, 'A3 public');
  perform nia_test.ok('A3 delete_own_account exécutable par authenticated seulement');

  perform nia_test.eq(has_function_privilege('anon', 'public.claim_storage_purge_jobs(integer, integer)', 'execute'), false, 'A4 anon claim');
  perform nia_test.eq(has_function_privilege('authenticated', 'public.claim_storage_purge_jobs(integer, integer)', 'execute'), false, 'A4 auth claim');
  perform nia_test.eq(has_function_privilege('authenticated', 'public.complete_storage_purge_job(uuid)', 'execute'), false, 'A4 auth complete');
  perform nia_test.eq(has_function_privilege('authenticated', 'public.fail_storage_purge_job(uuid, text)', 'execute'), false, 'A4 auth fail');
  perform nia_test.eq(has_function_privilege('anon', 'public.fail_storage_purge_job(uuid, text)', 'execute'), false, 'A4 anon fail');
  perform nia_test.eq(has_function_privilege('service_role', 'public.claim_storage_purge_jobs(integer, integer)', 'execute'), true, 'A4 service claim');
  perform nia_test.eq(has_function_privilege('service_role', 'public.complete_storage_purge_job(uuid)', 'execute'), true, 'A4 service complete');
  perform nia_test.eq(has_function_privilege('service_role', 'public.fail_storage_purge_job(uuid, text)', 'execute'), true, 'A4 service fail');
  perform nia_test.ok('A4 fonctions worker exécutables par service_role seulement');

  -- Appel réel : anon / authenticated rejetés
  r := nia_test.exec_as('anon', null, 'select public.delete_own_account() as r');
  perform nia_test.eq(r->>'sqlstate', '42501', 'A5 anon appelle la RPC');
  r := nia_test.exec_as('authenticated', u, 'select * from public.claim_storage_purge_jobs(10)');
  perform nia_test.eq(r->>'sqlstate', '42501', 'A5 authenticated appelle claim');
  r := nia_test.exec_as('authenticated', u, 'select * from public.storage_purge_jobs');
  perform nia_test.eq(r->>'sqlstate', '42501', 'A5 authenticated lit la file');
  r := nia_test.exec_as('anon', null, 'select * from public.storage_purge_jobs');
  perform nia_test.eq(r->>'sqlstate', '42501', 'A5 anon lit la file');
  perform nia_test.ok('A5 anon/authenticated : permission denied (RPC worker, table)');

  -- RLS activée, aucune policy
  perform nia_test.eq((select relrowsecurity from pg_class where oid = 'public.storage_purge_jobs'::regclass), true, 'A6 RLS');
  perform nia_test.eq(nia_test.n('select 1 from pg_policies where tablename = ''storage_purge_jobs'''), 0::bigint, 'A6 0 policy');
  perform nia_test.ok('A6 storage_purge_jobs : RLS activée, aucune policy');

  -- Sans claims : 28000
  r := nia_test.exec_as('authenticated', null, 'select public.delete_own_account() as r');
  perform nia_test.eq(r->>'sqlstate', '28000', 'A7 sans auth.uid()');
  perform nia_test.ok('A7 authenticated sans sub : erreur 28000, rien supprimé');

  -- Contraintes de la file : préfixe = {user_id}/, bucket connu
  begin
    insert into public.storage_purge_jobs (user_id, prefix) values (u, '');
    raise exception 'not ok - A8 préfixe vide accepté';
  exception when check_violation then null;
  end;
  begin
    insert into public.storage_purge_jobs (user_id, prefix) values (u, gen_random_uuid()::text || '/');
    raise exception 'not ok - A8 préfixe d''un autre accepté';
  exception when check_violation then null;
  end;
  begin
    insert into public.storage_purge_jobs (user_id, bucket, prefix) values (u, 'other', u::text || '/');
    raise exception 'not ok - A8 bucket inconnu accepté';
  exception when check_violation then null;
  end;
  perform nia_test.ok('A8 la file refuse préfixe vide / dossier d''autrui / bucket inconnu');
end $$;
rollback;

-- ===========================================================================
-- B. Compte sans contenu
-- ===========================================================================
begin;
do $$
declare
  a uuid := nia_test.mk_user('empty_a');
  r jsonb;
begin
  r := nia_test.delete_as(a);
  perform nia_test.eq(r->>'ok', 'true', 'B1 RPC ok');
  perform nia_test.eq(nia_test.n(format('select 1 from auth.users where id = %L', a)), 0::bigint, 'B1 auth.users');
  perform nia_test.eq(nia_test.n(format('select 1 from public.profiles where id = %L', a)), 0::bigint, 'B1 profiles');
  perform nia_test.eq(nia_test.n(format(
    'select 1 from public.storage_purge_jobs where user_id = %L and bucket = ''videos'' and prefix = %L and status = ''pending'' and attempts = 0',
    a, a::text || '/')), 2::bigint, 'B1 2 jobs pending');
  perform nia_test.eq(nia_test.n(format(
    'select 1 from public.storage_purge_jobs where user_id = %L and not_before = now()', a)), 1::bigint, 'B1 job immédiat');
  perform nia_test.eq(nia_test.n(format(
    'select 1 from public.storage_purge_jobs where user_id = %L and not_before = now() + interval ''70 minutes''', a)), 1::bigint, 'B1 balayage +70 min');
  perform nia_test.ok('B1 compte vide : auth.users + profil supprimés, 2 jobs {uid}/ (immédiat, +70 min)');
end $$;
rollback;

-- ===========================================================================
-- C. Vidéos + Storage : lignes supprimées, storage.objects intact (async)
-- ===========================================================================
begin;
do $$
declare
  a uuid := nia_test.mk_user('vid_a');
  b uuid := nia_test.mk_user('vid_b');
  bv uuid;
  soft uuid;
  objs_before bigint;
begin
  perform nia_test.mk_video(a, true);
  perform nia_test.mk_video(a, false);
  soft := nia_test.mk_video(a);
  update public.videos set status = 'deleted' where id = soft;  -- soft-deleted (005)
  bv := nia_test.mk_video(b, true);
  objs_before := nia_test.n('select 1 from storage.objects');

  perform nia_test.eq(nia_test.delete_as(a)->>'ok', 'true', 'C1 RPC ok');
  perform nia_test.eq(nia_test.n(format('select 1 from public.videos where user_id = %L', a)), 0::bigint, 'C1 vidéos (dont soft-deleted)');
  perform nia_test.eq(nia_test.n('select 1 from storage.objects'), objs_before, 'C1 aucun DELETE SQL sur storage.objects');
  perform nia_test.eq(nia_test.n(format('select 1 from public.videos where id = %L', bv)), 1::bigint, 'C1 vidéo de B intacte');
  perform nia_test.eq(nia_test.n(format('select 1 from public.storage_purge_jobs where prefix = %L', a::text || '/')), 2::bigint, 'C1 jobs');
  perform nia_test.eq(nia_test.n(format('select 1 from public.storage_purge_jobs where prefix = %L', b::text || '/')), 0::bigint, 'C1 aucun job pour B');
  perform nia_test.ok('C1 vidéos supprimées, storage.objects intact (purge async), job {uid}/ seulement');
end $$;
rollback;

-- ===========================================================================
-- D. Commentaires, likes, follows, blocks, notifications
-- ===========================================================================
begin;
do $$
declare
  a uuid := nia_test.mk_user('soc_a');
  b uuid := nia_test.mk_user('soc_b');
  c uuid := nia_test.mk_user('soc_c');
  av uuid; bv uuid;
begin
  av := nia_test.mk_video(a);
  bv := nia_test.mk_video(b);
  insert into public.comments (video_id, user_id, body) values (bv, a, 'texte privé de A sur la vidéo de B');
  insert into public.comments (video_id, user_id, body) values (av, b, 'B commente A');
  insert into public.likes (user_id, video_id) values (a, bv);
  insert into public.likes (user_id, video_id) values (c, bv);          -- témoin
  insert into public.follows (follower_id, following_id) values (a, b);
  insert into public.follows (follower_id, following_id) values (c, a);
  insert into public.follows (follower_id, following_id) values (c, b); -- témoin
  insert into public.blocks (blocker_id, blocked_id) values (a, c), (b, a);

  -- Les triggers de 002 ont créé des notifications
  perform nia_test.eq(nia_test.n(format('select 1 from public.notifications where actor_id = %L and user_id = %L and type = ''comment'' and body like ''texte privé%%''', a, b)), 1::bigint, 'D0 notif comment avec extrait');
  perform nia_test.eq((select like_count from public.videos where id = bv), 2, 'D0 like_count B');

  perform nia_test.eq(nia_test.delete_as(a)->>'ok', 'true', 'D1 RPC ok');

  perform nia_test.eq(nia_test.n(format('select 1 from public.comments where user_id = %L', a)), 0::bigint, 'D1 commentaires de A');
  perform nia_test.eq(nia_test.n(format('select 1 from public.comments where video_id = %L', av)), 0::bigint, 'D1 commentaires sur les vidéos de A');
  perform nia_test.eq(nia_test.n(format('select 1 from public.likes where user_id = %L', a)), 0::bigint, 'D1 likes de A');
  perform nia_test.eq((select like_count from public.videos where id = bv), 1, 'D1 like_count B décrémenté');
  perform nia_test.eq(nia_test.n(format('select 1 from public.follows where follower_id = %L or following_id = %L', a, a)), 0::bigint, 'D1 follows');
  perform nia_test.eq(nia_test.n(format('select 1 from public.follows where follower_id = %L and following_id = %L', c, b)), 1::bigint, 'D1 follow témoin');
  perform nia_test.eq(nia_test.n(format('select 1 from public.blocks where blocker_id = %L or blocked_id = %L', a, a)), 0::bigint, 'D1 blocks');
  perform nia_test.eq(nia_test.n(format('select 1 from public.notifications where actor_id = %L', a)), 0::bigint, 'D1 notifs dont A est acteur');
  perform nia_test.eq(nia_test.n('select 1 from public.notifications where actor_id is null'), 0::bigint, 'D1 aucune notif orpheline (actor NULL)');
  perform nia_test.eq(nia_test.n('select 1 from public.notifications where body like ''texte privé%'''), 0::bigint, 'D1 extrait du commentaire effacé');
  perform nia_test.eq(nia_test.n(format('select 1 from public.notifications where actor_id = %L and user_id = %L and type = ''like''', c, b)), 1::bigint, 'D1 notif témoin (C→B) conservée');
  perform nia_test.eq(nia_test.n(format('select 1 from public.notifications where actor_id = %L and user_id = %L and type = ''follow''', c, b)), 1::bigint, 'D1 notif follow témoin conservée');
  perform nia_test.ok('D1 commentaires, likes, follows, blocks, notifications (acteur A) supprimés ; témoins intacts');
end $$;
rollback;

-- ===========================================================================
-- E. Reposts : faits par A, et du contenu de A par d'autres (chaîne comprise)
-- ===========================================================================
begin;
do $$
declare
  a uuid := nia_test.mk_user('rp_a');
  b uuid := nia_test.mk_user('rp_b');
  c uuid := nia_test.mk_user('rp_c');
  av uuid; bv uuid; b_rep_a uuid; c_rep_brep uuid; a_rep_b uuid; bs uuid;
begin
  av := nia_test.mk_video(a);
  update public.videos set caption = 'légende de A', hashtags = array['a'] where id = av;
  bv := nia_test.mk_video(b);
  b_rep_a := nia_test.mk_repost(b, av);          -- B republie A (copie storage_path/caption)
  c_rep_brep := nia_test.mk_repost(c, b_rep_a);  -- donnée ancienne : repost d'un repost
  a_rep_b := nia_test.mk_repost(a, bv);          -- A republie B
  insert into public.likes (user_id, video_id) values (c, b_rep_a);             -- C aime le repost de B → notif à B
  insert into public.comments (video_id, user_id, body) values (b_rep_a, c, 'C sur repost');
  insert into public.saves (user_id, video_id) values (c, b_rep_a);
  insert into public.series (id, user_id, title) values (gen_random_uuid(), b, 'série B') returning id into bs;
  insert into public.series_items (series_id, video_id, position) values (bs, b_rep_a, 1), (bs, bv, 2);

  perform nia_test.eq((select share_count from public.videos where id = bv), 1, 'E0 share_count B');
  perform nia_test.eq((select storage_path from public.videos where id = b_rep_a),
                      (select storage_path from public.videos where id = av), 'E0 repost copie le storage_path de A');

  perform nia_test.eq(nia_test.delete_as(a)->>'ok', 'true', 'E1 RPC ok');

  perform nia_test.eq(nia_test.n(format('select 1 from public.videos where id in (%L, %L)', b_rep_a, c_rep_brep)), 0::bigint, 'E1 reposts du contenu de A supprimés (chaîne)');
  perform nia_test.eq(nia_test.n('select 1 from public.videos where caption = ''légende de A'''), 0::bigint, 'E1 plus aucune copie de la légende de A');
  perform nia_test.eq(nia_test.n(format('select 1 from public.videos where storage_path like %L', a::text || '/%')), 0::bigint, 'E1 plus aucune ligne vers {uid}/');
  perform nia_test.eq(nia_test.n(format('select 1 from public.reposts where video_id in (%L, %L)', av, b_rep_a)), 0::bigint, 'E1 table reposts');
  perform nia_test.eq(nia_test.n(format('select 1 from public.likes where video_id = %L', b_rep_a)), 0::bigint, 'E1 likes sur le repost');
  perform nia_test.eq(nia_test.n(format('select 1 from public.saves where video_id = %L', b_rep_a)), 0::bigint, 'E1 saves sur le repost');
  perform nia_test.eq(nia_test.n(format('select 1 from public.notifications where user_id = %L and actor_id = %L', b, c)), 0::bigint, 'E1 notifs visant le repost supprimé');
  perform nia_test.eq(nia_test.n('select 1 from public.notifications where video_id is null and type in (''like'',''comment'')'), 0::bigint, 'E1 aucune notif orpheline');
  -- Reposts faits par A
  perform nia_test.eq(nia_test.n(format('select 1 from public.videos where id = %L', a_rep_b)), 0::bigint, 'E1 repost de A supprimé');
  perform nia_test.eq(nia_test.n(format('select 1 from public.reposts where user_id = %L', a)), 0::bigint, 'E1 reposts de A');
  perform nia_test.eq((select share_count from public.videos where id = bv), 0, 'E1 share_count B décrémenté');
  perform nia_test.eq(nia_test.n(format('select 1 from public.videos where id = %L', bv)), 1::bigint, 'E1 original de B intact');
  perform nia_test.eq(nia_test.n(format('select 1 from storage.objects where name like %L', b::text || '/%')), 1::bigint, 'E1 fichier de B intact');
  perform nia_test.eq(nia_test.n(format('select 1 from public.storage_purge_jobs where prefix <> %L', a::text || '/')), 0::bigint, 'E1 aucun job hors {uid A}/');
  -- Série de B : l'épisode repost disparaît, l'autre reste
  perform nia_test.eq(nia_test.n(format('select 1 from public.series_items where series_id = %L', bs)), 1::bigint, 'E1 série B garde son propre épisode');
  perform nia_test.eq(nia_test.n(format('select 1 from public.profiles where id in (%L, %L)', b, c)), 2::bigint, 'E1 profils B et C intacts');
  perform nia_test.ok('E1 reposts : ceux de A et ceux du contenu de A (chaîne) supprimés avec dépendants ; B/C intacts');
end $$;
rollback;

-- ===========================================================================
-- F. Sons, événements, séries, lives, signalements
-- ===========================================================================
begin;
do $$
declare
  a uuid := nia_test.mk_user('misc_a');
  b uuid := nia_test.mk_user('misc_b');
  av uuid; bv uuid; s uuid; ea uuid; eb uuid; sa uuid; sb uuid; la uuid; lb uuid;
begin
  av := nia_test.mk_video(a);
  bv := nia_test.mk_video(b);
  -- Son de A utilisé par la vidéo de B
  insert into public.sounds (user_id, title, storage_path) values (a, 'son A', a::text || '/sounds/1.m4a') returning id into s;
  insert into storage.objects (bucket_id, name, owner) values ('videos', a::text || '/sounds/1.m4a', a);
  update public.videos set sound_id = s where id = bv;
  -- Événement de A avec B inscrit, et vidéo de B liée ; A inscrit à l'événement de B
  insert into public.events (title, starts_at, created_by, cover_path) values ('évt A', now(), a, a::text || '/events/1.jpg') returning id into ea;
  insert into public.events (title, starts_at, created_by) values ('évt B', now(), b) returning id into eb;
  insert into public.event_attendees (event_id, user_id) values (ea, b), (eb, a);
  update public.videos set event_id = ea where id = bv;
  -- Séries : A (avec sa vidéo), B (contient la vidéo de A et la sienne)
  insert into public.series (user_id, title) values (a, 'série A') returning id into sa;
  insert into public.series (user_id, title) values (b, 'série B') returning id into sb;
  insert into public.series_items (series_id, video_id, position) values (sa, av, 1), (sb, av, 1), (sb, bv, 2);
  -- Lives
  insert into public.live_streams (user_id, title) values (a, 'live A') returning id into la;
  insert into public.live_streams (user_id, title) values (b, 'live B') returning id into lb;
  -- Signalements
  insert into public.reports (reporter_id, target_type, target_id, reason) values (a, 'user', b, 'par A');
  insert into public.reports (reporter_id, target_type, target_id, reason) values (b, 'user', a, 'sur A');
  insert into public.reports (reporter_id, target_type, target_id, reason) values (b, 'video', av, 'sur vidéo A');

  perform nia_test.eq(nia_test.delete_as(a)->>'ok', 'true', 'F1 RPC ok');

  perform nia_test.eq(nia_test.n(format('select 1 from public.sounds where id = %L', s)), 0::bigint, 'F1 son de A');
  perform nia_test.eq((select sound_id from public.videos where id = bv), null::uuid, 'F1 vidéo de B : sound_id NULL');
  perform nia_test.eq(nia_test.n(format('select 1 from public.events where id = %L', ea)), 0::bigint, 'F1 événement de A');
  perform nia_test.eq(nia_test.n(format('select 1 from public.event_attendees where event_id = %L', ea)), 0::bigint, 'F1 inscrits (dont B) à l''événement de A');
  perform nia_test.eq(nia_test.n(format('select 1 from public.event_attendees where user_id = %L', a)), 0::bigint, 'F1 inscriptions de A');
  perform nia_test.eq(nia_test.n(format('select 1 from public.events where id = %L', eb)), 1::bigint, 'F1 événement de B intact');
  perform nia_test.eq((select event_id from public.videos where id = bv), null::uuid, 'F1 vidéo de B : event_id NULL');
  perform nia_test.eq(nia_test.n(format('select 1 from public.series where id = %L', sa)), 0::bigint, 'F1 série de A');
  perform nia_test.eq(nia_test.n(format('select 1 from public.series_items where series_id = %L', sa)), 0::bigint, 'F1 items série A');
  perform nia_test.eq(nia_test.n(format('select 1 from public.series_items where series_id = %L', sb)), 1::bigint, 'F1 série B : seul son épisode reste');
  perform nia_test.eq(nia_test.n(format('select 1 from public.live_streams where id = %L', la)), 0::bigint, 'F1 live de A');
  perform nia_test.eq(nia_test.n(format('select 1 from public.live_streams where id = %L', lb)), 1::bigint, 'F1 live de B intact');
  perform nia_test.eq(nia_test.n(format('select 1 from public.reports where reporter_id = %L', a)), 0::bigint, 'F1 signalements faits par A');
  perform nia_test.eq(nia_test.n(format('select 1 from public.reports where target_id in (%L, %L)', a, av)), 2::bigint, 'F1 signalements sur A conservés');
  perform nia_test.eq(nia_test.n(format('select 1 from storage.objects where name like %L', a::text || '/%')), 2::bigint, 'F1 fichiers de A en attente de purge (vidéo, son, pas de DELETE SQL)');
  perform nia_test.ok('F1 sons, événements (+inscrits), séries (+items), lives supprimés ; signalements sur A conservés');
end $$;
rollback;

-- ===========================================================================
-- G. Double exécution / idempotence
-- ===========================================================================
begin;
do $$
declare
  a uuid := nia_test.mk_user('twice_a');
  b uuid := nia_test.mk_user('twice_b');
  snap text;
  r jsonb;
begin
  perform nia_test.mk_video(a);
  perform nia_test.mk_video(b);
  perform nia_test.eq(nia_test.delete_as(a)->>'ok', 'true', 'G1 1er appel');
  snap := nia_test.snapshot();
  -- 2e appel avec un JWT encore valide (même sub) : no-op
  r := nia_test.delete_as(a);
  perform nia_test.eq(r->>'ok', 'true', 'G1 2e appel sans erreur');
  perform nia_test.eq(nia_test.snapshot(), snap, 'G1 aucune ligne modifiée, aucun nouveau job');
  perform nia_test.eq(nia_test.n(format('select 1 from public.storage_purge_jobs where user_id = %L', a)), 2::bigint, 'G1 toujours 2 jobs');
  perform nia_test.ok('G1 double exécution : 2e appel = no-op, aucune corruption');
end $$;
rollback;

-- ===========================================================================
-- H. Worker : claim / fail / retry / complete / reclaim / max_attempts
-- ===========================================================================
begin;
do $$
declare
  a uuid := nia_test.mk_user('wk_a');
  r jsonb;
  j uuid;
  j2 uuid;
begin
  perform nia_test.eq(nia_test.delete_as(a)->>'ok', 'true', 'H0 RPC');

  r := nia_test.claim(10);
  perform nia_test.eq(r->>'ok', 'true', 'H1 claim ok');
  perform nia_test.eq(jsonb_array_length(r->'rows'), 1, 'H1 seul le job immédiat est prêt (balayage +70 min pas encore)');
  perform nia_test.eq(r->'rows'->0->>'status', 'processing', 'H1 status');
  perform nia_test.eq((r->'rows'->0->>'attempts')::int, 1, 'H1 attempts');
  perform nia_test.eq(r->'rows'->0->>'prefix', a::text || '/', 'H1 prefix');
  j := (r->'rows'->0->>'id')::uuid;
  perform nia_test.eq(nia_test.n(format('select 1 from public.storage_purge_jobs where id = %L and locked_at is not null', j)), 1::bigint, 'H1 locked_at');
  perform nia_test.ok('H1 claim : processing, attempts+1, locked_at, seulement les jobs échus');

  r := nia_test.claim(10);
  perform nia_test.eq(jsonb_array_length(r->'rows'), 0, 'H2 double claim');
  perform nia_test.ok('H2 double claim : rien (job déjà processing)');

  -- Échec Storage simulé, message contenant des données à ne pas stocker
  r := nia_test.exec_as('service_role', null,
    format('select public.fail_storage_purge_job(%L, %L) as r', j, 'storage_remove_failed:500 <x@y.z> token=abc/def'));
  perform nia_test.eq(r->'rows'->0->>'r', 'true', 'H3 fail');
  perform nia_test.eq((select status from public.storage_purge_jobs where id = j), 'failed', 'H3 status failed');
  perform nia_test.eq((select last_error from public.storage_purge_jobs where id = j), 'storage_remove_failed:500__x_y.z__token_abc_def', 'H3 erreur nettoyée');
  perform nia_test.eq((select not_before from public.storage_purge_jobs where id = j), now() + interval '2 minutes', 'H3 backoff 2^1 min');
  perform nia_test.eq(jsonb_array_length(nia_test.claim(10)->'rows'), 0, 'H3 pas de reprise avant le backoff');
  perform nia_test.ok('H3 fail : failed, erreur nettoyée, backoff, pas repris avant échéance');

  -- Le temps passe → reprise, puis succès
  update public.storage_purge_jobs set not_before = now() - interval '1 second' where id = j;
  r := nia_test.claim(10);
  perform nia_test.eq(jsonb_array_length(r->'rows'), 1, 'H4 reprise');
  perform nia_test.eq((r->'rows'->0->>'attempts')::int, 2, 'H4 attempts 2');
  r := nia_test.exec_as('service_role', null, format('select public.complete_storage_purge_job(%L) as r', j));
  perform nia_test.eq(r->'rows'->0->>'r', 'true', 'H4 complete');
  perform nia_test.eq((select status || ':' || (done_at is not null)::text || ':' || coalesce(last_error, '-') from public.storage_purge_jobs where id = j), 'done:true:-', 'H4 done');
  r := nia_test.exec_as('service_role', null, format('select public.complete_storage_purge_job(%L) as r', j));
  perform nia_test.eq(r->'rows'->0->>'r', 'false', 'H4 complete 2x');
  r := nia_test.exec_as('service_role', null, format('select public.fail_storage_purge_job(%L, ''x'') as r', j));
  perform nia_test.eq(r->'rows'->0->>'r', 'false', 'H4 fail après done');
  perform nia_test.eq((select status from public.storage_purge_jobs where id = j), 'done', 'H4 reste done');
  perform nia_test.ok('H4 retry après échec puis succès ; complete/fail sur un job done = no-op');

  -- Worker mort : processing bloqué > 15 min → repris
  select id into j2 from public.storage_purge_jobs where user_id = a and status = 'pending';
  update public.storage_purge_jobs
     set status = 'processing', attempts = 3, locked_at = now() - interval '20 minutes', not_before = now()
   where id = j2;
  r := nia_test.claim(10);
  perform nia_test.eq(jsonb_array_length(r->'rows'), 1, 'H5 reclaim stale');
  perform nia_test.eq((r->'rows'->0->>'attempts')::int, 4, 'H5 attempts 4');
  -- processing récent : pas repris
  update public.storage_purge_jobs set locked_at = now() - interval '5 minutes' where id = j2;
  perform nia_test.eq(jsonb_array_length(nia_test.claim(10)->'rows'), 0, 'H5 lock récent respecté');
  perform nia_test.ok('H5 job processing bloqué > 15 min repris ; lock récent respecté');

  -- Stale à la dernière tentative → failed définitif ; failed à max → jamais repris
  update public.storage_purge_jobs
     set attempts = max_attempts, locked_at = now() - interval '20 minutes'
   where id = j2;
  perform nia_test.eq(jsonb_array_length(nia_test.claim(10)->'rows'), 0, 'H6 max atteint');
  perform nia_test.eq((select status || ':' || last_error from public.storage_purge_jobs where id = j2), 'failed:stale_lock_max_attempts', 'H6 failed définitif');
  update public.storage_purge_jobs set not_before = now() - interval '1 day' where id = j2;
  perform nia_test.eq(jsonb_array_length(nia_test.claim(10)->'rows'), 0, 'H6 failed à max jamais repris');
  perform nia_test.ok('H6 max_attempts : échec définitif visible, plus jamais réclamé');

  -- Bornes de p_batch
  r := nia_test.claim(0);
  perform nia_test.eq(r->>'ok', 'true', 'H7 batch 0 accepté (ramené à 1)');
  perform nia_test.ok('H7 p_batch borné');
end $$;
rollback;

-- ===========================================================================
-- Z. Concurrence : FOR UPDATE SKIP LOCKED (deux sessions réelles, dblink)
-- ===========================================================================
create extension if not exists dblink;
do $$
declare
  a uuid := nia_test.mk_user('conc_a');
  j uuid;
  r jsonb;
  conn text := format('dbname=%s host=%s port=%s user=%s',
                      current_database(), current_setting('unix_socket_directories'),
                      current_setting('port'), current_user);
begin
  perform nia_test.eq(nia_test.delete_as(a)->>'ok', 'true', 'Z0 RPC');
  select id into j from public.storage_purge_jobs where user_id = a and not_before <= now();
  -- Commit nécessaire pour que l'autre session voie le job : DO est autocommit
  -- en fin de bloc, donc on verrouille depuis une 2e connexion APRÈS.
end $$;
do $$
declare
  j uuid;
  r jsonb;
  conn text := format('dbname=%s host=%s port=%s user=%s',
                      current_database(), current_setting('unix_socket_directories'),
                      current_setting('port'), current_user);
begin
  select id into j from public.storage_purge_jobs
   where status = 'pending' and not_before <= now() order by created_at desc limit 1;
  perform dblink_connect('other', conn);
  perform dblink_exec('other', 'begin');
  perform * from dblink('other', format('select id from public.storage_purge_jobs where id = %L for update', j)) as t(id uuid);
  -- La ligne est verrouillée par l'autre session : claim ne doit NI bloquer NI la prendre.
  set local lock_timeout = '2s';
  r := nia_test.claim(10);
  perform nia_test.eq(r->>'ok', 'true', 'Z1 claim sans blocage');
  perform nia_test.eq(jsonb_array_length(r->'rows'), 0, 'Z1 ligne verrouillée ignorée');
  perform dblink_exec('other', 'rollback');
  perform dblink_disconnect('other');
  r := nia_test.claim(10);
  perform nia_test.eq(jsonb_array_length(r->'rows'), 1, 'Z1 réclamée une fois libérée');
  perform nia_test.ok('Z1 SKIP LOCKED : 2e worker ne bloque pas et ne prend pas un job verrouillé');
end $$;
-- Nettoyage des données committées de la section Z
delete from public.storage_purge_jobs;
