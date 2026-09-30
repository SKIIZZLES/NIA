-- Tests de 019 (Live L2 : garde du cycle de vie, webhook LiveKit, fin
-- automatique, audience « Abonnés »). Postgres LOCAL jetable uniquement
-- (run_local.sh). Chaque groupe tourne dans une transaction annulée.
\set ON_ERROR_STOP 1

-- Appel du webhook comme l'Edge Function (service_role) ; renvoie le code.
create or replace function nia_test.lk(p_live uuid, p_event text, p_participant uuid default null,
  p_viewers int default null, p_at timestamptz default null)
returns text language plpgsql as $$
declare r jsonb;
begin
  r := nia_test.exec_as('service_role', null, format(
    'select public.live_webhook_apply(%L::uuid, %L, %L, %s, %L::timestamptz, %L) as r',
    p_live, p_event, p_participant::text, coalesce(p_viewers::text, 'null'), p_at,
    'nia-live-' || p_live::text));
  if not (r->>'ok')::boolean then
    raise exception 'not ok - live_webhook_apply en erreur : %', r->>'message';
  end if;
  return r->'rows'->0->>'r';
end $$;

-- ===========================================================================
-- L1. Garde : insertion et colonnes serveur (app = authenticated)
-- ===========================================================================
begin;
do $$
declare a uuid := nia_test.mk_user('l2_a'); b uuid := nia_test.mk_user('l2_b'); l uuid; r jsonb;
begin
  r := nia_test.dml_as('authenticated', a, format(
    'insert into public.live_streams (user_id, title, status, started_at, viewer_count, provider, provider_stream_id, peak_viewer_count, ended_reason)
     values (%L, ''Direct'', ''live'', now(), 999999, ''livekit'', ''x'', 5, ''host'')', a));
  perform nia_test.eq(r->>'ok', 'true', 'L1 insertion par l''app acceptée');
  l := (select id from public.live_streams where user_id = a);
  perform nia_test.eq((select format('%s/%s/%s/%s/%s/%s/%s', status, started_at, viewer_count, provider,
                                     provider_stream_id, peak_viewer_count, ended_reason)
                         from public.live_streams where id = l),
                      'scheduled//0///0/', 'L1 insertion forcée en scheduled, colonnes serveur à zéro');
  r := nia_test.dml_as('authenticated', a, format('update public.live_streams set status = ''live'' where id = %L', l));
  perform nia_test.eq(r->>'sqlstate', '42501', 'L1 l''app ne passe pas un live à « live »');
  perform nia_test.eq(r->>'message', 'live_status_server_only', 'L1 message live_status_server_only');
  r := nia_test.dml_as('authenticated', a, format('update public.live_streams set viewer_count = 999999 where id = %L', l));
  perform nia_test.eq(r->>'sqlstate', '42501', 'L1 viewer_count en lecture seule');
  r := nia_test.dml_as('authenticated', a, format('update public.live_streams set started_at = now() where id = %L', l));
  perform nia_test.eq(r->>'sqlstate', '42501', 'L1 started_at en lecture seule');
  r := nia_test.dml_as('authenticated', a, format('update public.live_streams set provider = ''livekit'', provider_stream_id = ''r'' where id = %L', l));
  perform nia_test.eq(r->>'sqlstate', '42501', 'L1 provider en lecture seule');
  r := nia_test.dml_as('authenticated', a, format('update public.live_streams set peak_viewer_count = 3 where id = %L', l));
  perform nia_test.eq(r->>'sqlstate', '42501', 'L1 peak_viewer_count en lecture seule');
  r := nia_test.dml_as('authenticated', a, format('update public.live_streams set host_left_at = now() where id = %L', l));
  perform nia_test.eq(r->>'sqlstate', '42501', 'L1 host_left_at en lecture seule');
  r := nia_test.dml_as('authenticated', a, format('update public.live_streams set title = ''Nouveau titre'', visibility = ''followers'', category = ''musique'' where id = %L', l));
  perform nia_test.eq(r->>'n', '1', 'L1 titre / audience / catégorie modifiables');
  r := nia_test.dml_as('authenticated', b, format('update public.live_streams set title = ''pirate'' where id = %L', l));
  perform nia_test.eq(r->>'n', '0', 'L1 un autre utilisateur ne modifie rien (RLS)');
  perform nia_test.ok('L1 garde insertion et colonnes serveur');
end $$;
rollback;

-- ===========================================================================
-- L2. Transitions de l'app (compatibles avec endStream de L1)
-- ===========================================================================
begin;
do $$
declare a uuid := nia_test.mk_user('l2t_a'); l uuid; l2 uuid; r jsonb;
begin
  insert into public.live_streams (user_id, title) values (a, 'Prog') returning id into l;
  insert into public.live_streams (user_id, title) values (a, 'Annulé') returning id into l2;
  -- endStream (L1) envoie status + ended_at : accepté, ended_at posé par le serveur.
  r := nia_test.dml_as('authenticated', a, format(
    'update public.live_streams set status = ''ended'', ended_at = ''2000-01-01'' where id = %L', l));
  perform nia_test.eq(r->>'n', '1', 'L2 scheduled → ended (endStream)');
  perform nia_test.eq((select ended_reason || '/' || (ended_at > now() - interval '1 minute')::text
                         from public.live_streams where id = l), 'host/true', 'L2 ended_at serveur, raison host');
  r := nia_test.dml_as('authenticated', a, format('update public.live_streams set status = ''scheduled'' where id = %L', l));
  perform nia_test.eq(r->>'message', 'live_finished', 'L2 un live terminé ne repart pas');
  r := nia_test.dml_as('authenticated', a, format('update public.live_streams set status = ''cancelled'' where id = %L', l2));
  perform nia_test.eq(r->>'n', '1', 'L2 scheduled → cancelled');
  perform nia_test.eq((select ended_reason is null from public.live_streams where id = l2), true, 'L2 annulation sans raison de fin');
  -- live → ended par l'hôte
  update public.live_streams set status = 'live', started_at = now(), viewer_count = 4, host_left_at = now() where id = l2;
  r := nia_test.dml_as('authenticated', a, format('update public.live_streams set status = ''ended'' where id = %L', l2));
  perform nia_test.eq(r->>'n', '1', 'L2 live → ended par l''hôte');
  perform nia_test.eq((select format('%s/%s/%s', status, viewer_count, host_left_at) from public.live_streams where id = l2),
                      'ended/0/', 'L2 fin : compteur à 0, hôte effacé');
  perform nia_test.ok('L2 transitions de l''app');
end $$;
rollback;

-- ===========================================================================
-- L3. RPC du webhook : droits
-- ===========================================================================
begin;
do $$
declare a uuid := nia_test.mk_user('l2r_a'); l uuid; r jsonb;
begin
  insert into public.live_streams (user_id, title) values (a, 'X') returning id into l;
  r := nia_test.exec_as('authenticated', a, format('select public.live_webhook_apply(%L::uuid, ''participant_joined'', %L) as r', l, a));
  perform nia_test.eq(r->>'sqlstate', '42501', 'L3 authenticated ne peut pas appeler live_webhook_apply');
  r := nia_test.exec_as('anon', null, format('select public.live_webhook_apply(%L::uuid, ''room_finished'') as r', l));
  perform nia_test.eq(r->>'sqlstate', '42501', 'L3 anon ne peut pas appeler live_webhook_apply');
  r := nia_test.exec_as('authenticated', a, 'select * from public.live_sweep_stale()');
  perform nia_test.eq(r->>'sqlstate', '42501', 'L3 authenticated ne peut pas appeler live_sweep_stale');
  perform nia_test.eq((select status from public.live_streams where id = l), 'scheduled', 'L3 rien n''a bougé');
  perform nia_test.ok('L3 RPC réservées au service_role');
end $$;
rollback;

-- ===========================================================================
-- L4. Webhook : passage en direct, idempotence, compteur, départ / retour
-- ===========================================================================
begin;
do $$
declare a uuid := nia_test.mk_user('l2w_a'); v uuid := nia_test.mk_user('l2w_v'); l uuid; t0 timestamptz;
begin
  insert into public.live_streams (user_id, title) values (a, 'Direct') returning id into l;
  perform nia_test.eq(nia_test.lk(gen_random_uuid(), 'participant_joined', a), 'unknown_live', 'L4 room inconnue ignorée');
  perform nia_test.eq(nia_test.lk(l, 'room_started'), 'noop', 'L4 room_started seul : rien');
  perform nia_test.eq(nia_test.lk(l, 'participant_joined', v, 1), 'noop', 'L4 un spectateur ne démarre pas le live');
  perform nia_test.eq((select status from public.live_streams where id = l), 'scheduled', 'L4 toujours programmé');
  t0 := now() - interval '10 seconds';
  perform nia_test.eq(nia_test.lk(l, 'participant_joined', a, 0, t0), 'went_live', 'L4 hôte connecté → live');
  perform nia_test.eq((select format('%s/%s/%s/%s', status, (started_at = t0)::text, provider, provider_stream_id)
                         from public.live_streams where id = l),
                      format('live/true/livekit/nia-live-%s', l), 'L4 statut, started_at, provider, room');
  perform nia_test.eq(nia_test.lk(l, 'participant_joined', a, 0, t0), 'noop', 'L4 même événement rejoué : rien');
  perform nia_test.eq(nia_test.lk(l, 'track_published', a, null, now()), 'noop', 'L4 track_published après : rien');
  perform nia_test.eq((select started_at = t0 from public.live_streams where id = l), true, 'L4 started_at inchangé');
  perform nia_test.eq(nia_test.lk(l, 'participant_joined', v, 3), 'viewers', 'L4 compteur mis à jour');
  perform nia_test.eq(nia_test.lk(l, 'participant_joined', v, 3), 'noop', 'L4 compteur identique : rien');
  perform nia_test.eq(nia_test.lk(l, 'participant_left', v, 1), 'viewers', 'L4 départ d''un spectateur');
  perform nia_test.eq((select viewer_count || '/' || peak_viewer_count from public.live_streams where id = l), '1/3', 'L4 compteur 1, pic 3');
  perform nia_test.eq(nia_test.lk(l, 'participant_joined', v, -5), 'viewers', 'L4 compteur négatif borné');
  perform nia_test.eq((select viewer_count from public.live_streams where id = l), 0, 'L4 compteur ≥ 0');
  perform nia_test.eq(nia_test.lk(l, 'participant_left', a, 0), 'host_left', 'L4 hôte parti');
  perform nia_test.eq((select host_left_at is not null and status = 'live' from public.live_streams where id = l), true, 'L4 host_left_at posé, toujours live');
  perform nia_test.eq(nia_test.lk(l, 'participant_connection_aborted', a, 0), 'noop', 'L4 départ rejoué : rien');
  perform nia_test.eq(nia_test.lk(l, 'participant_joined', a, 0), 'host_back', 'L4 hôte revenu');
  perform nia_test.eq((select host_left_at is null from public.live_streams where id = l), true, 'L4 host_left_at effacé');
  perform nia_test.eq(nia_test.lk(l, 'egress_started'), 'ignored_event', 'L4 événement inconnu ignoré');
  perform nia_test.ok('L4 webhook : direct, compteur, départ et retour de l''hôte');
end $$;
rollback;

-- ===========================================================================
-- L5. Webhook : fin de room, événements tardifs, live terminé
-- ===========================================================================
begin;
do $$
declare a uuid := nia_test.mk_user('l2f_a'); l uuid; l2 uuid;
begin
  insert into public.live_streams (user_id, title) values (a, 'Direct') returning id into l;
  -- Tentative ratée (room fermée alors que le live est encore programmé) : reste programmé.
  perform nia_test.eq(nia_test.lk(l, 'room_finished', null, null, now() - interval '5 minutes'), 'noop', 'L5 room_finished sur un programmé : rien');
  perform nia_test.eq(nia_test.lk(l, 'participant_joined', a, 0, now() - interval '1 minute'), 'went_live', 'L5 live');
  -- room_finished d'une session précédente (plus ancien que started_at) : ignoré.
  perform nia_test.eq(nia_test.lk(l, 'room_finished', null, null, now() - interval '3 minutes'), 'noop', 'L5 room_finished tardif ignoré');
  perform nia_test.eq((select status from public.live_streams where id = l), 'live', 'L5 toujours live');
  perform nia_test.eq(nia_test.lk(l, 'room_finished', null, null, now()), 'ended', 'L5 room_finished → ended');
  perform nia_test.eq((select format('%s/%s/%s', status, ended_reason, viewer_count) from public.live_streams where id = l),
                      'ended/room_closed/0', 'L5 raison room_closed');
  perform nia_test.eq(nia_test.lk(l, 'room_finished'), 'finished', 'L5 room_finished rejoué : rien');
  perform nia_test.eq(nia_test.lk(l, 'participant_joined', a, 2), 'finished', 'L5 un live terminé ne repart pas');
  perform nia_test.eq((select status || '/' || viewer_count from public.live_streams where id = l), 'ended/0', 'L5 toujours terminé');
  -- Fin par l'hôte dans l'app puis déconnexion : la room peut être fermée.
  insert into public.live_streams (user_id, title) values (a, 'Deux') returning id into l2;
  perform nia_test.eq(nia_test.lk(l2, 'participant_joined', a, 0), 'went_live', 'L5 second live');
  perform nia_test.eq(nia_test.dml_as('authenticated', a, format('update public.live_streams set status = ''ended'' where id = %L', l2))->>'n', '1', 'L5 Terminer (app)');
  perform nia_test.eq(nia_test.lk(l2, 'participant_left', a, 3), 'finished_host_left', 'L5 hôte parti après Terminer → fermer la room');
  perform nia_test.ok('L5 fin de room et idempotence');
end $$;
rollback;

-- ===========================================================================
-- L6. Un seul live par créateur ; live retenu par la modération
-- ===========================================================================
begin;
do $$
declare a uuid := nia_test.mk_user('l2o_a'); l1 uuid; l2 uuid; lh uuid; r jsonb;
begin
  insert into public.live_streams (user_id, title) values (a, 'Premier') returning id into l1;
  insert into public.live_streams (user_id, title) values (a, 'Second') returning id into l2;
  perform nia_test.eq(nia_test.lk(l1, 'participant_joined', a, 0), 'went_live', 'L6 premier live');
  perform nia_test.eq(nia_test.lk(l2, 'track_published', a), 'went_live', 'L6 second live (track_published)');
  perform nia_test.eq((select status || '/' || ended_reason from public.live_streams where id = l1), 'ended/replaced', 'L6 l''orphelin est terminé (replaced)');
  perform nia_test.eq((select count(*) from public.live_streams where user_id = a and status = 'live'), 1::bigint, 'L6 un seul live « live »');
  begin
    update public.live_streams set status = 'live', started_at = now() where id = l1;
    raise exception 'not ok - L6 index unique absent';
  exception when unique_violation then
    null;
  end;
  insert into public.live_streams (user_id, title) values (a, 'Retenu') returning id into lh;
  update public.live_streams set moderation_state = 'held' where id = lh;
  perform nia_test.eq(nia_test.lk(lh, 'participant_joined', a, 0), 'held', 'L6 live retenu : ne passe pas en direct');
  perform nia_test.eq((select status from public.live_streams where id = lh), 'scheduled', 'L6 live retenu toujours programmé');
  perform nia_test.eq((select status from public.live_streams where id = l2), 'live', 'L6 le live en cours n''est pas touché');
  perform nia_test.ok('L6 unicité et modération');
end $$;
rollback;

-- ===========================================================================
-- L7. Fin automatique (live_sweep_stale)
-- ===========================================================================
begin;
do $$
declare a uuid := nia_test.mk_user('l2s_a'); b uuid := nia_test.mk_user('l2s_b'); c uuid := nia_test.mk_user('l2s_c');
  la uuid; lb uuid; lc uuid; r jsonb;
begin
  insert into public.live_streams (user_id, title) values (a, 'Parti') returning id into la;
  insert into public.live_streams (user_id, title) values (b, 'Là') returning id into lb;
  insert into public.live_streams (user_id, title) values (c, 'Marathon') returning id into lc;
  update public.live_streams set status = 'live', started_at = now() - interval '10 minutes', provider_stream_id = 'nia-live-' || id
   where id in (la, lb);
  update public.live_streams set status = 'live', started_at = now() - interval '5 hours' where id = lc;
  update public.live_streams set host_left_at = now() - interval '3 minutes' where id = la;
  update public.live_streams set host_left_at = now() - interval '30 seconds' where id = lb;
  r := nia_test.exec_as('service_role', null, 'select live_id, room, reason from public.live_sweep_stale(120, 14400) order by reason');
  perform nia_test.eq(jsonb_array_length(r->'rows'), 2, 'L7 deux lives terminés');
  perform nia_test.eq((select status || '/' || ended_reason from public.live_streams where id = la), 'ended/host_timeout', 'L7 hôte parti > 2 min → terminé');
  perform nia_test.eq((select status from public.live_streams where id = lb), 'live', 'L7 hôte parti < 2 min → toujours live');
  perform nia_test.eq((select status || '/' || ended_reason from public.live_streams where id = lc), 'ended/max_duration', 'L7 plus de 4 h → terminé');
  perform nia_test.eq(r->'rows'->0->>'room', 'nia-live-' || la::text, 'L7 room à fermer renvoyée');
  perform nia_test.eq(r->'rows'->1->>'room', 'nia-live-' || lc::text, 'L7 room par défaut nia-live-<id>');
  r := nia_test.exec_as('service_role', null, 'select * from public.live_sweep_stale()');
  perform nia_test.eq(jsonb_array_length(r->'rows'), 0, 'L7 second balayage : rien');
  perform nia_test.ok('L7 fin automatique');
end $$;
rollback;

-- ===========================================================================
-- L8. Visibilité : public, Abonnés, privé, modération, blocage (017 conservé)
-- ===========================================================================
begin;
do $$
declare a uuid := nia_test.mk_user('l2v_a'); f uuid := nia_test.mk_user('l2v_f'); x uuid := nia_test.mk_user('l2v_x');
  bf uuid := nia_test.mk_user('l2v_bf'); m uuid := nia_test.mk_user('l2v_m');
  lf uuid; lp uuid; lpub uuid; r jsonb;
begin
  insert into public.follows (follower_id, following_id) values (f, a), (bf, a);
  insert into public.live_streams (user_id, title, visibility) values (a, 'Abonnés', 'followers') returning id into lf;
  insert into public.live_streams (user_id, title, visibility) values (a, 'Privé', 'private') returning id into lp;
  insert into public.live_streams (user_id, title) values (a, 'Public') returning id into lpub;
  perform nia_test.eq(nia_test.seen('authenticated', f, format('select id from public.live_streams where id = %L', lf)), 1, 'L8 un abonné voit le live « Abonnés »');
  perform nia_test.eq(nia_test.seen('authenticated', x, format('select id from public.live_streams where id = %L', lf)), 0, 'L8 un non-abonné ne le voit pas');
  perform nia_test.eq(nia_test.seen('anon', null, format('select id from public.live_streams where id = %L', lf)), 0, 'L8 un visiteur ne le voit pas');
  perform nia_test.eq(nia_test.seen('authenticated', a, format('select id from public.live_streams where id = %L', lf)), 1, 'L8 le créateur le voit');
  perform nia_test.eq(nia_test.seen('authenticated', f, format('select id from public.live_streams where id = %L', lp)), 0, 'L8 privé : invisible même pour un abonné');
  perform nia_test.eq(nia_test.seen('anon', null, format('select id from public.live_streams where id = %L', lpub)), 1, 'L8 public visible d''un visiteur');
  -- Blocage (017) : l'abonné bloqué ne voit plus rien.
  r := nia_test.dml_as('authenticated', a, format('insert into public.blocks (blocker_id, blocked_id) values (%L, %L)', a, bf));
  perform nia_test.eq(nia_test.seen('authenticated', bf, format('select id from public.live_streams where id in (%L, %L)', lf, lpub)), 0, 'L8 bloqué : ni Abonnés ni public');
  -- Modération (017) : masqué = invisible pour l'abonné, visible pour le créateur.
  update public.live_streams set moderation_state = 'held' where id = lf;
  perform nia_test.eq(nia_test.seen('authenticated', f, format('select id from public.live_streams where id = %L', lf)), 0, 'L8 live masqué invisible pour l''abonné');
  perform nia_test.eq(nia_test.seen('authenticated', a, format('select id from public.live_streams where id = %L', lf)), 1, 'L8 le créateur voit son live masqué');
  -- Annulé : invisible pour les autres.
  update public.live_streams set status = 'cancelled' where id = lpub;
  perform nia_test.eq(nia_test.seen('authenticated', f, format('select id from public.live_streams where id = %L', lpub)), 0, 'L8 annulé invisible');
  -- Modérateur : voit tout.
  insert into public.moderators (user_id) values (m);
  perform nia_test.eq(nia_test.seen('authenticated', m, format('select id from public.live_streams where id in (%L, %L, %L)', lf, lp, lpub)), 3, 'L8 le modérateur voit tout');
  perform nia_test.ok('L8 visibilité');
end $$;
rollback;

-- ===========================================================================
-- L9. Direct instantané + filtre de mots 018 (titre masqué ou retenu)
-- ===========================================================================
begin;
do $$
declare a uuid := nia_test.mk_user('l2k_a'); b uuid := nia_test.mk_user('l2k_b'); l uuid; lh uuid; r jsonb;
begin
  r := nia_test.dml_as('authenticated', a, format(
    'insert into public.live_streams (user_id, title, status, scheduled_at) values (%L, ''Live avec ce bâtard'', ''scheduled'', now())', a));
  perform nia_test.eq(r->>'n', '1', 'L9 direct instantané inséré');
  l := (select id from public.live_streams where user_id = a and title like 'Live avec%');
  perform nia_test.eq((select title || '/' || moderation_state || '/' || status from public.live_streams where id = l),
                      'Live avec ce b*****/visible/scheduled', 'L9 titre masqué, live visible');
  perform nia_test.eq(nia_test.lk(l, 'participant_joined', a, 0), 'went_live', 'L9 titre masqué : passe en direct');
  r := nia_test.dml_as('authenticated', a, format(
    'insert into public.live_streams (user_id, title, status, scheduled_at) values (%L, ''réservé aux blancs, pas de bougnoules'', ''scheduled'', now())', a));
  lh := (select id from public.live_streams where user_id = a and id <> l);
  perform nia_test.eq((select moderation_state from public.live_streams where id = lh), 'held', 'L9 titre retenu → held');
  perform nia_test.eq(nia_test.seen('authenticated', b, format('select id from public.live_streams where id = %L', lh)), 0, 'L9 retenu invisible pour les autres');
  perform nia_test.eq(nia_test.lk(lh, 'participant_joined', a, 0), 'held', 'L9 retenu : pas de direct');
  r := nia_test.dml_as('authenticated', a, format('update public.live_streams set status = ''cancelled'' where id = %L', lh));
  perform nia_test.eq(r->>'n', '1', 'L9 l''hôte peut annuler le live retenu');
  perform nia_test.eq((select moderation_state from public.live_streams where id = lh), 'held', 'L9 l''annulation ne lève pas la retenue');
  perform nia_test.ok('L9 direct instantané et filtre de mots');
end $$;
rollback;

-- ===========================================================================
-- L10. Rejouer 019 : aucune donnée ne bouge
-- ===========================================================================
begin;
do $$
declare a uuid := nia_test.mk_user('l2i_a'); l uuid;
begin
  insert into public.live_streams (user_id, title) values (a, 'Idem') returning id into l;
  perform nia_test.lk(l, 'participant_joined', a, 2);
end $$;
create temp table l2_before as select id, status, started_at, viewer_count, peak_viewer_count, host_left_at from public.live_streams;
\ir ../migrations/019_live_l2.sql
do $$
begin
  perform nia_test.eq((select count(*) from (
      select id, status, started_at, viewer_count, peak_viewer_count, host_left_at from public.live_streams
      except select * from l2_before) d), 0::bigint, 'L10 rejouer 019 ne modifie aucune ligne');
  perform nia_test.eq((select count(*) from pg_trigger where tgname = 'live_streams_10_lifecycle_guard'), 1::bigint, 'L10 un seul trigger');
  perform nia_test.ok('L10 019 rejouable');
end $$;
rollback;
