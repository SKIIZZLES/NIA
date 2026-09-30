-- Tests de 017 (sécurité, signalements v2, preuves, modération, fichiers des
-- vidéos masquées, domaine réservé). Postgres LOCAL jetable uniquement
-- (run_local.sh). Chaque groupe tourne dans une transaction annulée.
\set ON_ERROR_STOP 1

-- Sur Supabase, authenticated a les droits de table sur storage.objects (la
-- RLS filtre) ; pas dans les stubs.
grant select, insert, update on storage.objects to anon, authenticated;

-- ===========================================================================
-- S1. Garde-fous vidéos / commentaires / profils / lives
-- ===========================================================================
begin;
do $$
declare
  a uuid := nia_test.mk_user('g_a'); b uuid := nia_test.mk_user('g_b');
  v uuid; l uuid; r jsonb;
begin
  v := nia_test.mk_video(a);
  r := nia_test.dml_as('authenticated', a, format('update public.videos set like_count = 999 where id = %L', v));
  perform nia_test.eq(r->>'sqlstate', '42501', 'S1 like_count non modifiable');
  r := nia_test.dml_as('authenticated', a, format('update public.videos set save_count = 50, share_count = 50 where id = %L', v));
  perform nia_test.eq(r->>'sqlstate', '42501', 'S1 save/share_count non modifiables');
  r := nia_test.dml_as('authenticated', a, format('update public.videos set storage_path = %L where id = %L', a::text || '/x.mp4', v));
  perform nia_test.eq(r->>'sqlstate', '42501', 'S1 storage_path figé');
  r := nia_test.dml_as('authenticated', a, format('update public.videos set moderation_state = ''visible'', moderation_reason = ''x'' where id = %L', v));
  perform nia_test.eq(r->>'sqlstate', '42501', 'S1 moderation_reason non modifiable');
  r := nia_test.dml_as('authenticated', a, format('update public.videos set moderation_state = ''removed'' where id = %L', v));
  perform nia_test.eq(r->>'sqlstate', '42501', 'S1 moderation_state non modifiable');
  r := nia_test.dml_as('authenticated', a, format('update public.videos set status = ''archived'' where id = %L', v));
  perform nia_test.eq(r->>'n', '1', 'S1 archiver reste possible (setVideoStatus)');
  r := nia_test.dml_as('authenticated', a, format('update public.videos set status = ''published'', caption = ''Nouvelle légende'' where id = %L', v));
  perform nia_test.eq(r->>'n', '1', 'S1 republier / modifier la légende reste possible');
  update public.videos set status = 'rejected' where id = v;  -- décision modération (SQL Editor)
  r := nia_test.dml_as('authenticated', a, format('update public.videos set status = ''published'' where id = %L', v));
  perform nia_test.eq(r->>'sqlstate', '42501', 'S1 impossible de sortir de rejected');
  update public.videos set status = 'published' where id = v;
  r := nia_test.dml_as('authenticated', a, format(
    'insert into public.videos (id, user_id, storage_path, status, like_count, moderation_state) values (gen_random_uuid(), %L, %L, ''published'', 5000, ''visible'')',
    a, a::text || '/neuve.mp4'));
  perform nia_test.eq(r->>'n', '1', 'S1 publication OK');
  perform nia_test.eq((select like_count from public.videos where storage_path = a::text || '/neuve.mp4'), 0, 'S1 compteur remis à 0 à la publication');
  r := nia_test.dml_as('authenticated', a, format(
    'insert into public.videos (user_id, storage_path, status) values (%L, %L, ''rejected'')', a, a::text || '/r.mp4'));
  perform nia_test.eq(r->>'sqlstate', '42501', 'S1 publication en rejected refusée');
  -- compteur via trigger (like d'un autre) : toujours OK
  r := nia_test.dml_as('authenticated', b, format('insert into public.likes (user_id, video_id) values (%L, %L)', b, v));
  perform nia_test.eq(r->>'n', '1', 'S1 like accepté');
  perform nia_test.eq((select like_count from public.videos where id = v), 1, 'S1 like_count incrémenté par le trigger');
  -- soft delete (RPC 015) toujours OK
  r := nia_test.exec_as('authenticated', a, format('select public.soft_delete_own_video(%L) as ok', v));
  perform nia_test.eq(r->'rows'->0->>'ok', 'true', 'S1 soft_delete_own_video OK');
  r := nia_test.dml_as('authenticated', a, format('update public.profiles set suspended_at = now() where id = %L', a));
  perform nia_test.eq(r->>'sqlstate', '42501', 'S1 suspended_at non modifiable');
  r := nia_test.dml_as('authenticated', a, format('update public.profiles set suspended_until = null, created_at = now() - interval ''1 year'' where id = %L', a));
  perform nia_test.eq(r->>'sqlstate', '42501', 'S1 created_at non modifiable (ancienneté des signaleurs)');
  r := nia_test.dml_as('authenticated', a, format('update public.profiles set bio = ''Danseuse sabar'' where id = %L', a));
  perform nia_test.eq(r->>'n', '1', 'S1 updateProfile (bio) OK');
  -- lives
  r := nia_test.dml_as('authenticated', a, format(
    'insert into public.live_streams (user_id, title, moderation_state) values (%L, ''Mon live'', ''removed'')', a));
  perform nia_test.eq(r->>'n', '1', 'S1 programmer un live OK');
  l := (select id from public.live_streams where user_id = a);
  perform nia_test.eq((select moderation_state from public.live_streams where id = l), 'visible', 'S1 moderation_state du live neutralisé');
  r := nia_test.dml_as('authenticated', a, format('update public.live_streams set moderation_state = ''visible'', title = ''x'' where id = %L', l));
  perform nia_test.eq(r->>'n', '1', 'S1 modifier le titre du live OK');
  update public.live_streams set moderation_state = 'held' where id = l;
  r := nia_test.dml_as('authenticated', a, format('update public.live_streams set moderation_state = ''visible'' where id = %L', l));
  perform nia_test.eq(r->>'sqlstate', '42501', 'S1 le créateur ne rétablit pas son live');
  perform nia_test.ok('S1 garde-fous vidéos / profils / lives');
end $$;
rollback;

begin;
do $$
declare a uuid := nia_test.mk_user('c_a'); b uuid := nia_test.mk_user('c_b'); v uuid; r jsonb; i int;
begin
  v := nia_test.mk_video(a);
  r := nia_test.dml_as('authenticated', b, format('insert into public.comments (video_id, user_id, body) values (%L, %L, ''Bravo'')', v, b));
  perform nia_test.eq(r->>'n', '1', 'S1 commentaire OK');
  r := nia_test.dml_as('authenticated', b, format('insert into public.comments (video_id, user_id, body) values (%L, %L, ''Encore'')', v, b));
  perform nia_test.eq(r->>'sqlstate', '54000', 'S1 1 commentaire / 3 s');
  r := nia_test.dml_as('authenticated', b, format('update public.comments set moderation_state = ''held'' where user_id = %L', b));
  perform nia_test.eq(r->>'sqlstate', '42501', 'S1 moderation_state commentaire figé');
  r := nia_test.dml_as('authenticated', b, format('update public.comments set body = ''Bravo !'' where user_id = %L', b));
  perform nia_test.eq(r->>'n', '1', 'S1 corriger son commentaire OK');
  -- 30 / 10 min
  update public.comments set created_at = now() - interval '5 minutes' where user_id = b;
  for i in 1..29 loop
    insert into public.comments (video_id, user_id, body, created_at) values (v, b, 'c' || i, now() - interval '5 minutes');
  end loop;
  r := nia_test.dml_as('authenticated', b, format('insert into public.comments (video_id, user_id, body) values (%L, %L, ''31e'')', v, b));
  perform nia_test.eq(r->>'sqlstate', '54000', 'S1 30 commentaires / 10 min');
  r := nia_test.dml_as('authenticated', a, format('insert into public.comments (video_id, user_id, body) values (%L, %L, ''usurpé'')', v, b));
  perform nia_test.eq(r->>'sqlstate', '42501', 'S1 commentaire au nom d''un autre refusé');
  perform nia_test.ok('S1 limite de débit et garde-fou des commentaires');
end $$;
rollback;

-- ===========================================================================
-- S2. Blocage appliqué côté serveur ; S3. notifications
-- ===========================================================================
begin;
do $$
declare a uuid := nia_test.mk_user('b_a'); b uuid := nia_test.mk_user('b_b'); c uuid := nia_test.mk_user('b_c');
  v uuid; vb uuid; l uuid; cm uuid; r jsonb;
begin
  v := nia_test.mk_video(a);
  vb := nia_test.mk_video(b);
  insert into public.comments (id, video_id, user_id, body, created_at) values (gen_random_uuid(), vb, a, 'de A chez B', now() - interval '1 minute') returning id into cm;
  insert into public.live_streams (id, user_id, title) values (gen_random_uuid(), a, 'Live A') returning id into l;
  insert into public.follows (follower_id, following_id) values (b, a), (a, b);
  r := nia_test.dml_as('authenticated', a, format('insert into public.blocks (blocker_id, blocked_id) values (%L, %L)', a, b));
  perform nia_test.eq(r->>'n', '1', 'S2 blocage');
  perform nia_test.eq(nia_test.n(format('select 1 from public.follows where %L in (follower_id, following_id) and %L in (follower_id, following_id)', a, b)), 0::bigint, 'S2 abonnements supprimés dans les deux sens');
  perform nia_test.eq(nia_test.seen('authenticated', b, format('select id from public.videos where id = %L', v)), 0, 'S2 bloqué ne voit plus la vidéo');
  perform nia_test.eq(nia_test.seen('authenticated', a, format('select id from public.videos where id = %L', vb)), 0, 'S2 le bloqueur ne voit plus celles du bloqué');
  perform nia_test.eq(nia_test.seen('authenticated', c, format('select id from public.videos where id = %L', v)), 1, 'S2 un tiers la voit');
  perform nia_test.eq(nia_test.seen('authenticated', b, format('select id from public.comments where id = %L', cm)), 0, 'S2 bloqué ne voit plus les commentaires du bloqueur');
  perform nia_test.eq(nia_test.seen('authenticated', c, format('select id from public.comments where id = %L', cm)), 1, 'S2 un tiers voit le commentaire');
  perform nia_test.eq(nia_test.seen('authenticated', b, format('select id from public.live_streams where id = %L', l)), 0, 'S2 bloqué ne voit plus le live');
  perform nia_test.eq(nia_test.seen('authenticated', c, format('select id from public.live_streams where id = %L', l)), 1, 'S2 un tiers voit le live');
  perform nia_test.eq(nia_test.seen('anon', null, format('select id from public.live_streams where id = %L', l)), 1, 'S2 un visiteur voit le live public');
  r := nia_test.dml_as('authenticated', b, format('insert into public.comments (video_id, user_id, body) values (%L, %L, ''x'')', v, b));
  perform nia_test.eq(r->>'sqlstate', '42501', 'S2 bloqué ne peut pas commenter');
  r := nia_test.dml_as('authenticated', b, format('insert into public.likes (user_id, video_id) values (%L, %L)', b, v));
  perform nia_test.eq(r->>'sqlstate', '42501', 'S2 bloqué ne peut pas liker');
  r := nia_test.dml_as('authenticated', b, format('insert into public.saves (user_id, video_id) values (%L, %L)', b, v));
  perform nia_test.eq(r->>'sqlstate', '42501', 'S2 bloqué ne peut pas sauvegarder');
  r := nia_test.dml_as('authenticated', b, format('insert into public.follows (follower_id, following_id) values (%L, %L)', b, a));
  perform nia_test.eq(r->>'sqlstate', '42501', 'S2 bloqué ne peut pas suivre');
  r := nia_test.dml_as('authenticated', a, format('insert into public.follows (follower_id, following_id) values (%L, %L)', a, b));
  perform nia_test.eq(r->>'sqlstate', '42501', 'S2 le bloqueur ne peut pas suivre non plus');
  -- débloquer rétablit tout
  r := nia_test.dml_as('authenticated', a, format('delete from public.blocks where blocker_id = %L and blocked_id = %L', a, b));
  perform nia_test.eq(r->>'n', '1', 'S2 déblocage');
  perform nia_test.eq(nia_test.seen('authenticated', b, format('select id from public.videos where id = %L', v)), 1, 'S2 après déblocage : vidéo visible');
  r := nia_test.dml_as('authenticated', b, format('delete from public.blocks where blocker_id = %L', a));
  perform nia_test.eq(r->>'n', '0', 'S2 le bloqué ne peut pas lever le blocage d''un autre');
  -- notifications
  r := nia_test.dml_as('authenticated', c, format('insert into public.notifications (user_id, actor_id, type, body) values (%L, %L, ''like'', ''gagnez un iPhone'')', a, c));
  perform nia_test.eq(r->>'sqlstate', '42501', 'S3 insertion directe de notification refusée');
  r := nia_test.dml_as('authenticated', a, format('insert into public.notifications (user_id, actor_id, type, body) values (%L, %L, ''system'', ''x'')', a, a));
  perform nia_test.eq(r->>'sqlstate', '42501', 'S3 même chez soi');
  r := nia_test.dml_as('authenticated', c, format('insert into public.likes (user_id, video_id) values (%L, %L)', c, v));
  perform nia_test.eq(nia_test.n(format('select 1 from public.notifications where user_id = %L and actor_id = %L', a, c)), 1::bigint, 'S3 notification par trigger toujours créée');
  perform nia_test.ok('S2 blocage serveur ; S3 notifications');
end $$;
rollback;

-- ===========================================================================
-- S4. Signalements v2
-- ===========================================================================
begin;
do $$
declare
  a uuid := nia_test.mk_user('r_owner'); b uuid := nia_test.mk_user('r_b');
  c uuid := nia_test.mk_user('r_c'); d uuid := nia_test.mk_user('r_d'); m uuid := nia_test.mk_user('r_mod');
  v uuid; v_priv uuid; l uuid; l_priv uuid; cm uuid; r jsonb; i int;
begin
  insert into public.moderators (user_id) values (m);
  v := nia_test.mk_video(a);
  v_priv := nia_test.mk_video(a);
  update public.videos set visibility = 'private' where id = v_priv;
  insert into public.live_streams (id, user_id, title) values (gen_random_uuid(), a, 'Live public') returning id into l;
  insert into public.live_streams (id, user_id, title, visibility) values (gen_random_uuid(), a, 'Live privé', 'private') returning id into l_priv;

  -- APK actuel : reason seul
  r := nia_test.dml_as('authenticated', b, format('insert into public.reports (reporter_id, target_type, target_id, reason) values (%L, ''video'', %L, ''Harcèlement'')', b, v));
  perform nia_test.eq(r->>'n', '1', 'S4 insertion format APK actuel');
  perform nia_test.eq((select category || '/' || priority from public.reports where reporter_id = b), 'insultes_harcelement/3', 'S4 catégorie déduite du motif');
  perform nia_test.eq((select target_owner_id from public.reports where reporter_id = b), a, 'S4 propriétaire de la cible');
  perform nia_test.eq((select target_snapshot->>'storage_path' from public.reports where reporter_id = b), a::text || '/' || v::text || '.mp4', 'S4 instantané de la cible');
  r := nia_test.dml_as('authenticated', b, format('insert into public.reports (reporter_id, target_type, target_id, category) values (%L, ''video'', %L, ''homophobie'')', b, v));
  perform nia_test.eq(r->>'sqlstate', '23505', 'S4 doublon ouvert refusé');
  r := nia_test.dml_as('authenticated', a, format('insert into public.reports (reporter_id, target_type, target_id, category) values (%L, ''video'', %L, ''spam'')', a, v));
  perform nia_test.eq(r->>'sqlstate', '22023', 'S4 pas d''auto-signalement');
  r := nia_test.dml_as('authenticated', b, format('insert into public.reports (reporter_id, target_type, target_id, category) values (%L, ''video'', %L, ''spam'')', b, v_priv));
  perform nia_test.eq(r->>'sqlstate', 'P0002', 'S4 vidéo privée d''un autre : introuvable');
  r := nia_test.dml_as('authenticated', b, format('insert into public.reports (reporter_id, target_type, target_id, category, details) values (%L, ''user'', %L, ''negrophobie'', ''Insultes dans la bio'')', b, a));
  perform nia_test.eq(r->>'n', '1', 'S4 signaler un profil (négrophobie)');
  perform nia_test.eq((select reason from public.reports where reporter_id = b and target_type = 'user'), 'négrophobie', 'S4 motif texte rempli depuis la catégorie');
  r := nia_test.dml_as('authenticated', b, format('insert into public.reports (reporter_id, target_type, target_id, category) values (%L, ''live'', %L, ''menace_danger'')', b, l));
  perform nia_test.eq(r->>'n', '1', 'S4 signaler un live');
  perform nia_test.eq((select priority from public.reports where reporter_id = b and target_type = 'live'), 1::smallint, 'S4 menace = P1');
  r := nia_test.dml_as('authenticated', b, format('insert into public.reports (reporter_id, target_type, target_id, category) values (%L, ''live'', %L, ''spam'')', b, l_priv));
  perform nia_test.eq(r->>'sqlstate', 'P0002', 'S4 live privé d''un autre : introuvable');
  r := nia_test.dml_as('authenticated', b, format('insert into public.reports (reporter_id, target_type, target_id, category, status) values (%L, ''user'', %L, ''spam'', ''actioned'')', b, gen_random_uuid()));
  perform nia_test.eq(r->>'sqlstate', 'P0002', 'S4 cible inexistante');
  r := nia_test.dml_as('authenticated', b, format('insert into public.reports (reporter_id, target_type, target_id, category) values (%L, ''user'', %L, ''n_importe_quoi'')', b, c));
  perform nia_test.eq(r->>'sqlstate', '23514', 'S4 catégorie inconnue');
  r := nia_test.dml_as('authenticated', b, format('insert into public.reports (reporter_id, target_type, target_id, category, details) values (%L, ''user'', %L, ''spam'', repeat(''x'', 1001))', b, c));
  perform nia_test.eq(r->>'sqlstate', '23514', 'S4 détails > 1000 caractères refusés');
  r := nia_test.dml_as('authenticated', b, format('insert into public.reports (reporter_id, target_type, target_id, category) values (%L, ''user'', %L, ''spam'')', c, d));
  perform nia_test.eq(r->>'sqlstate', '42501', 'S4 signaler au nom d''un autre refusé');
  -- app de cette PR avant 017 : libellé français + détails
  r := nia_test.dml_as('authenticated', c, format('insert into public.reports (reporter_id, target_type, target_id, reason) values (%L, ''user'', %L, ''Propos homophobes — dans ses commentaires'')', c, a));
  perform nia_test.eq((select category from public.reports where reporter_id = c), 'homophobie', 'S4 libellé français + détails → catégorie');
  perform nia_test.eq(public.nia_report_category_from_reason('Contenu illégal'), 'injustice_autre', 'S4 « Contenu illégal » → injustice_autre');
  perform nia_test.eq(public.nia_report_category_from_reason('Pédocriminalité'), 'pedocriminalite', 'S4 « Pédocriminalité » → P0');
  -- lecture
  perform nia_test.eq(nia_test.seen('authenticated', b, 'select id from public.reports'), 3, 'S4 le signaleur voit ses signalements');
  perform nia_test.eq(nia_test.seen('authenticated', d, 'select id from public.reports'), 0, 'S4 un tiers ne voit rien');
  perform nia_test.eq(nia_test.seen('authenticated', a, 'select id from public.reports'), 0, 'S4 la personne signalée ne voit rien');
  perform nia_test.eq(nia_test.seen('authenticated', m, format('select id from public.reports where target_owner_id = %L', a)), 4, 'S4 le modérateur voit tout');
  perform nia_test.eq(nia_test.exec_as('anon', null, 'select id from public.reports')->>'sqlstate', '42501', 'S4 table interdite aux visiteurs');
  perform nia_test.eq(nia_test.seen('authenticated', m, format('select id from public.moderation_queue where target_owner_id = %L', a)), 4, 'S4 file de modération (modérateur)');
  perform nia_test.eq(nia_test.seen('authenticated', d, 'select id from public.moderation_queue'), 0, 'S4 file de modération vide pour les autres');
  r := nia_test.dml_as('authenticated', b, 'update public.reports set status = ''dismissed''');
  perform nia_test.eq(r->>'n', '0', 'S4 aucune modification par le signaleur');
  r := nia_test.dml_as('authenticated', b, 'delete from public.reports');
  perform nia_test.eq(r->>'n', '0', 'S4 aucune suppression par le signaleur');
  -- limite 20 / h
  for i in 1..18 loop
    insert into public.reports (reporter_id, target_type, target_id, category, created_at)
    values (d, 'user', b, 'spam', now()) ;
    update public.reports set status = 'dismissed' where reporter_id = d and status = 'open';
  end loop;
  r := nia_test.dml_as('authenticated', d, format('insert into public.reports (reporter_id, target_type, target_id, category) values (%L, ''user'', %L, ''spam'')', d, c));
  perform nia_test.eq(r->>'n', '1', 'S4 19e signalement dans l''heure accepté');
  r := nia_test.dml_as('authenticated', d, format('insert into public.reports (reporter_id, target_type, target_id, category) values (%L, ''user'', %L, ''spam'')', d, m));
  perform nia_test.eq(r->>'n', '1', 'S4 20e accepté');
  r := nia_test.dml_as('authenticated', d, format('insert into public.reports (reporter_id, target_type, target_id, category) values (%L, ''user'', %L, ''spam'')', d, a));
  perform nia_test.eq(r->>'sqlstate', '54000', 'S4 21e refusé (20 / h)');
  perform nia_test.ok('S4 signalements : catégories, cibles, doublons, droits, débit');
end $$;
rollback;

-- ===========================================================================
-- S5. Masquage automatique, décisions, notifications (DSA 16 / 17)
-- ===========================================================================
begin;
do $$
declare
  a uuid := nia_test.mk_user('p0_owner'); b uuid := nia_test.mk_user('p0_b');
  c uuid := nia_test.mk_user('p0_c'); d uuid := nia_test.mk_user('p0_d'); e uuid := nia_test.mk_user('p0_e');
  m uuid := nia_test.mk_user('p0_mod'); v uuid; v2 uuid; cm uuid; l uuid; rid uuid; r jsonb;
begin
  insert into public.moderators (user_id) values (m);
  update public.profiles set created_at = now() - interval '3 days' where id in (b, c, d);
  v := nia_test.mk_video(a); v2 := nia_test.mk_video(a);
  insert into public.live_streams (id, user_id, title, status) values (gen_random_uuid(), a, 'Live', 'live') returning id into l;
  -- P0 : masquage immédiat, accusé de réception, rien envoyé à l'auteur
  r := nia_test.dml_as('authenticated', e, format('insert into public.reports (reporter_id, target_type, target_id, category) values (%L, ''video'', %L, ''pedocriminalite'')', e, v));
  perform nia_test.eq(r->>'n', '1', 'S5 signalement P0 enregistré');
  perform nia_test.eq((select moderation_state from public.videos where id = v), 'held', 'S5 P0 → vidéo masquée tout de suite (compte récent compris)');
  perform nia_test.eq((select legal_status || '/' || auto_hidden from public.reports where target_id = v), 'to_report/true', 'S5 P0 → suivi légal « à signaler »');
  perform nia_test.eq(nia_test.seen('anon', null, format('select id from public.videos where id = %L', v)), 0, 'S5 masquée pour les visiteurs');
  perform nia_test.eq(nia_test.seen('authenticated', b, format('select id from public.videos where id = %L', v)), 0, 'S5 masquée pour les autres comptes');
  perform nia_test.eq(nia_test.seen('authenticated', a, format('select id, moderation_state from public.videos where id = %L', v)), 1, 'S5 le créateur la voit encore (bannière)');
  perform nia_test.eq(nia_test.seen('authenticated', m, format('select id from public.videos where id = %L', v)), 1, 'S5 le modérateur la voit');
  perform nia_test.eq(nia_test.n(format('select 1 from public.notifications where user_id = %L and type = ''report_received'' and meta->>''code'' = ''received''', e)), 1::bigint, 'S5 accusé de réception au signaleur');
  perform nia_test.eq(nia_test.n(format('select 1 from public.notifications where user_id = %L', a)), 0::bigint, 'S5 P0 : aucune notification à l''auteur');
  r := nia_test.dml_as('authenticated', b, format('insert into public.likes (user_id, video_id) values (%L, %L)', b, v));
  perform nia_test.eq(r->>'sqlstate', '42501', 'S5 like impossible sur une vidéo masquée');
  -- P0 sur un live : masqué aussi
  r := nia_test.dml_as('authenticated', e, format('insert into public.reports (reporter_id, target_type, target_id, category) values (%L, ''live'', %L, ''pedocriminalite'')', e, l));
  perform nia_test.eq((select moderation_state from public.live_streams where id = l), 'held', 'S5 P0 → live masqué');
  perform nia_test.eq(nia_test.seen('authenticated', b, format('select id from public.live_streams where id = %L', l)), 0, 'S5 live masqué invisible');
  perform nia_test.eq(nia_test.seen('authenticated', a, format('select id from public.live_streams where id = %L', l)), 1, 'S5 l''hôte voit encore son live');
  -- 3 signaleurs distincts (comptes > 24 h) → masquage + notification à l'auteur
  insert into public.comments (id, video_id, user_id, body) values (gen_random_uuid(), v2, a, 'commentaire') returning id into cm;
  perform nia_test.dml_as('authenticated', b, format('insert into public.reports (reporter_id, target_type, target_id, category) values (%L, ''comment'', %L, ''insultes_harcelement'')', b, cm));
  perform nia_test.dml_as('authenticated', e, format('insert into public.reports (reporter_id, target_type, target_id, category) values (%L, ''comment'', %L, ''insultes_harcelement'')', e, cm));
  perform nia_test.dml_as('authenticated', c, format('insert into public.reports (reporter_id, target_type, target_id, category) values (%L, ''comment'', %L, ''insultes_harcelement'')', c, cm));
  perform nia_test.eq((select moderation_state from public.comments where id = cm), 'visible', 'S5 2 comptes anciens + 1 récent : pas encore masqué');
  perform nia_test.dml_as('authenticated', d, format('insert into public.reports (reporter_id, target_type, target_id, category) values (%L, ''comment'', %L, ''insultes_harcelement'')', d, cm));
  perform nia_test.eq((select moderation_state from public.comments where id = cm), 'held', 'S5 3 comptes anciens → masqué');
  perform nia_test.eq(nia_test.n(format('select 1 from public.notifications where user_id = %L and type = ''moderation_notice'' and meta->>''code'' = ''held''', a)), 1::bigint, 'S5 l''auteur est prévenu du masquage (hors P0)');
  perform nia_test.eq(nia_test.seen('authenticated', a, format('select id from public.comments where id = %L', cm)), 1, 'S5 l''auteur voit son commentaire masqué');
  perform nia_test.eq(nia_test.seen('authenticated', b, format('select id from public.comments where id = %L', cm)), 0, 'S5 les autres ne le voient plus');
  -- décisions
  rid := (select id from public.reports where target_id = v);
  r := nia_test.exec_as('authenticated', b, format('select public.mod_resolve_report(%L, ''content_removed'') as x', rid));
  perform nia_test.eq(r->>'sqlstate', '42501', 'S5 non-modérateur refusé');
  r := nia_test.exec_as('authenticated', m, format('select public.mod_resolve_report(%L, ''reported_to_authorities'') as x', rid));
  perform nia_test.eq(r->>'sqlstate', '22023', 'S5 P0 confirmé sans référence PHAROS refusé');
  r := nia_test.exec_as('authenticated', m, format('select public.mod_resolve_report(%L, ''reported_to_authorities'', ''retiré'', ''  '') as x', rid));
  perform nia_test.eq(r->>'sqlstate', '22023', 'S5 référence vide refusée');
  r := nia_test.exec_as('authenticated', m, format('select public.mod_resolve_report(%L, ''n_importe_quoi'') as x', rid));
  perform nia_test.eq(r->>'sqlstate', '22023', 'S5 décision inconnue refusée');
  r := nia_test.exec_as('authenticated', m, format('select public.mod_resolve_report(%L, ''reported_to_authorities'', ''retiré'', ''PHAROS-TEST-1'') as x', rid));
  perform nia_test.eq(coalesce(r->>'message', r->>'ok'), 'true', 'S5 P0 résolu avec référence');
  perform nia_test.eq((select moderation_state from public.videos where id = v), 'removed', 'S5 contenu retiré');
  perform nia_test.eq((select status || '/' || legal_status || '/' || (resolved_by = m) from public.reports where id = rid), 'actioned/reported/true', 'S5 statut, suivi légal, modérateur');
  perform nia_test.eq(nia_test.n(format('select 1 from public.notifications where user_id = %L and type = ''report_decision'' and meta->>''code'' = ''actioned''', e)), 1::bigint, 'S5 décision envoyée au signaleur');
  perform nia_test.eq(nia_test.n(format('select 1 from public.notifications where user_id = %L and type = ''moderation_notice'' and meta->>''code'' = ''removed'' and body like ''%%Contestation%%''', a)), 1::bigint, 'S5 motif et contestation envoyés à l''auteur');
  rid := (select id from public.reports where target_id = cm limit 1);
  r := nia_test.exec_as('authenticated', m, format('select public.mod_resolve_report(%L, ''no_violation'') as x', rid));
  perform nia_test.eq((select moderation_state from public.comments where id = cm), 'visible', 'S5 rétabli si pas de violation');
  perform nia_test.eq(nia_test.n(format('select 1 from public.reports where target_id = %L and status = ''dismissed''', cm)), 4::bigint, 'S5 tous les signalements de la cible clos');
  perform nia_test.eq(nia_test.n(format('select 1 from public.notifications where type = ''report_decision'' and meta->>''code'' = ''dismissed'' and user_id in (%L, %L, %L, %L)', b, c, d, e)), 4::bigint, 'S5 chaque signaleur reçoit la décision une fois');
  -- SQL Editor (aucun claim) : autorisé ; suspension
  perform set_config('request.jwt.claims', '', true);
  perform public.mod_suspend_user(a, 7);
  perform nia_test.eq((select banned_until > now() from auth.users where id = a), true, 'S5 suspension depuis le SQL Editor (banned_until)');
  perform nia_test.eq((select suspended_until > now() + interval '6 days' from public.profiles where id = a), true, 'S5 suspended_until');
  perform public.mod_suspend_user(a, 0);
  perform nia_test.eq((select banned_until is null and suspended_at is null from auth.users u join public.profiles p on p.id = u.id where u.id = a), true, 'S5 levée de la suspension');
  r := nia_test.exec_as('authenticated', b, format('select public.mod_suspend_user(%L, 7) as x', a));
  perform nia_test.eq(r->>'sqlstate', '42501', 'S5 suspension refusée à un non-modérateur');
  r := nia_test.exec_as('anon', null, format('select public.mod_set_moderation_state(''video'', %L, ''visible'') as x', v));
  perform nia_test.eq(r->>'sqlstate', '42501', 'S5 RPC modérateur interdite aux visiteurs');
  perform nia_test.ok('S5 masquage automatique, décisions et notifications');
end $$;
rollback;

-- P0 : garde-fou anti-abus (5 masquages automatiques par signaleur et par 24 h)
begin;
do $$
declare a uuid := nia_test.mk_user('cap_owner'); b uuid := nia_test.mk_user('cap_b'); v uuid; i int; r jsonb;
begin
  for i in 1..6 loop
    v := nia_test.mk_video(a);
    r := nia_test.dml_as('authenticated', b, format('insert into public.reports (reporter_id, target_type, target_id, category) values (%L, ''video'', %L, ''pedocriminalite'')', b, v));
    perform nia_test.eq(r->>'n', '1', 'P0 signalement ' || i || ' accepté');
  end loop;
  perform nia_test.eq(nia_test.n(format('select 1 from public.videos where user_id = %L and moderation_state = ''held''', a)), 5::bigint, 'P0 5 masquages automatiques au plus');
  perform nia_test.eq(nia_test.n(format('select 1 from public.reports where reporter_id = %L and priority = 0', b)), 6::bigint, 'P0 le 6e reste en file, en priorité 0');
  perform nia_test.ok('P0 garde-fou anti-abus');
end $$;
rollback;

-- ===========================================================================
-- S6. Preuves jointes ; S7. suppression de compte du signaleur
-- ===========================================================================
begin;
do $$
declare
  a uuid := nia_test.mk_user('e_owner'); b uuid := nia_test.mk_user('e_b'); m uuid := nia_test.mk_user('e_mod');
  v uuid; rid uuid; rid0 uuid; r jsonb; i int; p text;
begin
  insert into public.moderators (user_id) values (m);
  v := nia_test.mk_video(a);
  perform nia_test.dml_as('authenticated', b, format('insert into public.reports (reporter_id, target_type, target_id, category) values (%L, ''video'', %L, ''actes_inhumains'')', b, v));
  rid := (select id from public.reports where reporter_id = b);
  for i in 1..3 loop
    p := b::text || '/' || rid::text || '/' || i || '.jpg';
    r := nia_test.dml_as('authenticated', b, format('insert into storage.objects (bucket_id, name, owner) values (''report-evidence'', %L, %L)', p, b));
    perform nia_test.eq(coalesce(r->>'n', r->>'message'), '1', 'S6 upload preuve ' || i);
    r := nia_test.dml_as('authenticated', b, format('insert into public.report_evidence (report_id, storage_path, mime_type, size_bytes) values (%L, %L, ''image/jpeg'', 100000)', rid, p));
    perform nia_test.eq(r->>'n', '1', 'S6 métadonnée preuve ' || i);
  end loop;
  p := b::text || '/' || rid::text || '/4.jpg';
  r := nia_test.dml_as('authenticated', b, format('insert into storage.objects (bucket_id, name, owner) values (''report-evidence'', %L, %L)', p, b));
  perform nia_test.eq(r->>'sqlstate', '42501', 'S6 4e fichier refusé');
  r := nia_test.dml_as('authenticated', b, format('insert into public.report_evidence (report_id, storage_path, mime_type, size_bytes) values (%L, %L, ''image/jpeg'', 100000)', rid, p));
  perform nia_test.eq(r->>'sqlstate', '42501', 'S6 4e métadonnée refusée');
  perform nia_test.eq((select evidence_count from public.reports where id = rid), 3::smallint, 'S6 compteur de preuves');
  r := nia_test.dml_as('authenticated', a, format('insert into storage.objects (bucket_id, name, owner) values (''report-evidence'', %L, %L)', a::text || '/' || rid::text || '/x.jpg', a));
  perform nia_test.eq(r->>'sqlstate', '42501', 'S6 impossible sur le signalement d''un autre');
  perform nia_test.eq(nia_test.seen('authenticated', b, 'select name from storage.objects where bucket_id = ''report-evidence'''), 0, 'S6 le signaleur ne relit pas les fichiers');
  perform nia_test.eq(nia_test.seen('authenticated', a, 'select id from public.report_evidence'), 0, 'S6 la personne signalée ne voit rien');
  perform nia_test.eq(nia_test.seen('authenticated', m, 'select name from storage.objects where bucket_id = ''report-evidence'''), 3, 'S6 le modérateur voit les fichiers');
  r := nia_test.dml_as('authenticated', b, format('delete from public.report_evidence where report_id = %L', rid));
  perform nia_test.eq(r->>'n', '0', 'S6 preuve non supprimable par le signaleur');
  -- une heure après : trop tard
  update public.reports set created_at = now() - interval '2 hours' where id = rid;
  perform nia_test.eq((select public.nia_evidence_upload_ok(rid)), false, 'S6 plus de preuve après 1 h');
  update public.reports set created_at = now() where id = rid;
  -- P0 : aucune preuve acceptée
  perform nia_test.dml_as('authenticated', b, format('insert into public.reports (reporter_id, target_type, target_id, category) values (%L, ''user'', %L, ''pedocriminalite'')', b, a));
  rid0 := (select id from public.reports where reporter_id = b and category = 'pedocriminalite');
  r := nia_test.dml_as('authenticated', b, format('insert into storage.objects (bucket_id, name, owner) values (''report-evidence'', %L, %L)', b::text || '/' || rid0::text || '/1.jpg', b));
  perform nia_test.eq(r->>'sqlstate', '42501', 'S6 pédocriminalité : pas de pièce jointe');
  -- purge planifiée à la décision
  perform nia_test.exec_as('authenticated', m, format('select public.mod_resolve_report(%L, ''content_removed'') as x', rid));
  perform nia_test.eq((select count(*) from public.report_evidence where report_id = rid and purge_after between now() + interval '89 days' and now() + interval '91 days'), 3::bigint, 'S6 purge à J+90');
  perform nia_test.eq(nia_test.seen('service_role', null, 'select * from public.evidence_due_for_purge(10)'), 0, 'S6 rien à purger avant l''échéance');
  perform nia_test.eq(nia_test.exec_as('authenticated', m, 'select * from public.evidence_due_for_purge(10)')->>'sqlstate', '42501', 'S6 liste de purge réservée au serveur');
  -- S7 : le signaleur supprime son compte → signalement conservé, anonymisé
  r := nia_test.delete_as(b);
  perform nia_test.eq(nia_test.n(format('select 1 from public.reports where id = %L and reporter_id is null', rid)), 1::bigint, 'S7 signalement conservé sans signaleur');
  perform nia_test.eq(nia_test.n(format('select 1 from public.report_evidence where report_id = %L', rid)), 3::bigint, 'S7 preuves conservées jusqu''à la purge');
  -- échéance atteinte
  update public.report_evidence set purge_after = now() - interval '1 minute' where report_id = rid;
  perform nia_test.eq(nia_test.seen('service_role', null, 'select * from public.evidence_due_for_purge(10)'), 3, 'S6 3 preuves à purger à l''échéance');
  r := nia_test.exec_as('service_role', null, format('select public.evidence_mark_purged(array(select id from public.report_evidence where report_id = %L)) as n', rid));
  perform nia_test.eq(r->'rows'->0->>'n', '3', 'S6 preuves marquées purgées');
  perform nia_test.eq(nia_test.seen('service_role', null, 'select * from public.evidence_due_for_purge(10)'), 0, 'S6 plus rien à purger');
  perform nia_test.ok('S6 preuves privées et purge ; S7 suppression de compte');
end $$;
rollback;

-- Décision « transmis aux autorités » : preuves gardées 180 jours
begin;
do $$
declare a uuid := nia_test.mk_user('e2_owner'); b uuid := nia_test.mk_user('e2_b'); v uuid; rid uuid; p text;
begin
  v := nia_test.mk_video(a);
  perform nia_test.dml_as('authenticated', b, format('insert into public.reports (reporter_id, target_type, target_id, category) values (%L, ''video'', %L, ''menace_danger'')', b, v));
  rid := (select id from public.reports where reporter_id = b);
  p := b::text || '/' || rid::text || '/1.mp4';
  perform nia_test.dml_as('authenticated', b, format('insert into storage.objects (bucket_id, name, owner) values (''report-evidence'', %L, %L)', p, b));
  perform nia_test.dml_as('authenticated', b, format('insert into public.report_evidence (report_id, storage_path, mime_type, size_bytes) values (%L, %L, ''video/mp4'', 15000000)', rid, p));
  perform set_config('request.jwt.claims', '', true);
  perform public.mod_resolve_report(rid, 'reported_to_authorities', 'menace de mort', 'PHAROS-2026-42');
  perform nia_test.eq((select count(*) from public.report_evidence where report_id = rid and purge_after > now() + interval '179 days'), 1::bigint, 'S6 transmis aux autorités : J+180');
  perform nia_test.eq((select legal_ref from public.reports where id = rid), 'PHAROS-2026-42', 'S6 référence enregistrée');
  perform nia_test.ok('S6 conservation 180 jours si transmis aux autorités');
end $$;
rollback;

-- ===========================================================================
-- S8. Fichiers des vidéos masquées (file moderation_file_holds)
-- ===========================================================================
begin;
do $$
declare
  a uuid := nia_test.mk_user('h_owner'); b uuid := nia_test.mk_user('h_b'); c uuid := nia_test.mk_user('h_c');
  v uuid; v2 uuid; rid uuid; r jsonb; rep uuid;
begin
  -- file vide au départ (le rattrapage B en a mis ; annulé en fin de groupe)
  delete from public.moderation_file_holds;
  v := nia_test.mk_video(a, true);
  -- une republication partage le fichier : pas de ligne pour elle
  rep := nia_test.mk_repost(c, v);
  perform nia_test.dml_as('authenticated', b, format('insert into public.reports (reporter_id, target_type, target_id, category) values (%L, ''video'', %L, ''pedocriminalite'')', b, v));
  perform nia_test.eq((select desired || '/' || actual || '/' || cardinality(paths) from public.moderation_file_holds where video_id = v), 'held/public/2', 'S8 mise à l''abri demandée (vidéo + couverture)');
  perform nia_test.eq(nia_test.n('select 1 from public.moderation_file_holds'), 1::bigint, 'S8 une seule ligne (pas la republication)');
  perform nia_test.eq(nia_test.seen('authenticated', c, format('select id from public.videos where id = %L', rep)), 0, 'S8 la republication est masquée aussi');
  -- l'auteur ne peut plus supprimer la vidéo ni son fichier
  r := nia_test.dml_as('authenticated', a, format('delete from public.videos where id = %L', v));
  perform nia_test.eq(r->>'n', '0', 'S8 vidéo masquée : suppression définitive impossible');
  r := nia_test.dml_as('authenticated', a, format('update storage.objects set name = name where bucket_id = ''videos'' and name = %L', a::text || '/' || v::text || '.mp4'));
  perform nia_test.eq(r->>'n', '0', 'S8 fichier masqué : écrasement impossible');
  perform nia_test.eq(public.nia_storage_path_on_hold(a::text || '/' || v::text || '.mp4'), true, 'S8 chemin protégé (policy delete)');
  -- droits du worker
  r := nia_test.exec_as('authenticated', a, 'select * from public.moderation_files_claim(5, 15)');
  perform nia_test.eq(r->>'sqlstate', '42501', 'S8 file réservée au serveur');
  perform nia_test.eq(nia_test.exec_as('authenticated', a, 'select * from public.moderation_file_holds')->>'sqlstate', '42501', 'S8 table illisible par l''app');
  r := nia_test.exec_as('service_role', null, 'select video_id, action, attempts from public.moderation_files_claim(5, 15)');
  perform nia_test.eq(r->'rows'->0->>'action', 'hold', 'S8 le worker réclame « hold »');
  perform nia_test.eq(jsonb_array_length(nia_test.exec_as('service_role', null, 'select * from public.moderation_files_claim(5, 15)')->'rows'), 0, 'S8 ligne verrouillée : pas réclamée deux fois');
  r := nia_test.exec_as('service_role', null, format('select public.moderation_files_fail(%L, ''storage_copy_failed:503'') as ok', v));
  perform nia_test.eq((select not_before > now() and last_error = 'storage_copy_failed:503' from public.moderation_file_holds where video_id = v), true, 'S8 échec : retenté plus tard');
  update public.moderation_file_holds set not_before = now() where video_id = v;
  perform nia_test.exec_as('service_role', null, 'select * from public.moderation_files_claim(5, 15)');
  r := nia_test.exec_as('service_role', null, format('select public.moderation_files_complete(%L, ''held'') as ok', v));
  perform nia_test.eq(r->'rows'->0->>'ok', 'true', 'S8 mise à l''abri terminée');
  perform nia_test.eq(jsonb_array_length(nia_test.exec_as('service_role', null, 'select * from public.moderation_files_claim(5, 15)')->'rows'), 0, 'S8 rien à faire tant que la décision n''est pas prise');
  -- rétablie → release
  perform set_config('request.jwt.claims', '', true);
  rid := (select id from public.reports where target_id = v);
  perform public.mod_resolve_report(rid, 'no_violation');
  r := nia_test.exec_as('service_role', null, 'select action from public.moderation_files_claim(5, 15)');
  perform nia_test.eq(r->'rows'->0->>'action', 'release', 'S8 contenu rétabli → fichiers remis en place');
  perform nia_test.exec_as('service_role', null, format('select public.moderation_files_complete(%L, ''public'') as ok', v));
  -- retirée → purge à l'échéance
  perform public.mod_set_moderation_state('video', v, 'held', 'test');
  perform nia_test.exec_as('service_role', null, 'select * from public.moderation_files_claim(5, 15)');
  perform nia_test.exec_as('service_role', null, format('select public.moderation_files_complete(%L, ''held'') as ok', v));
  perform nia_test.dml_as('authenticated', c, format('insert into public.reports (reporter_id, target_type, target_id, category) values (%L, ''user'', %L, ''spam'')', c, a));
  insert into public.reports (reporter_id, target_type, target_id, category) values (c, 'video', v, 'nudite_sexuel') returning id into rid;
  perform public.mod_resolve_report(rid, 'content_removed');
  perform nia_test.eq((select purge_after between now() + interval '89 days' and now() + interval '91 days' from public.moderation_file_holds where video_id = v), true, 'S8 retirée : copie gardée 90 jours');
  update public.moderation_file_holds set purge_after = now() - interval '1 minute' where video_id = v;
  r := nia_test.exec_as('service_role', null, 'select action from public.moderation_files_claim(5, 15)');
  perform nia_test.eq(r->'rows'->0->>'action', 'purge', 'S8 échéance → purge');
  perform nia_test.ok('S8 fichiers des vidéos masquées');
end $$;
rollback;

-- Suppression du compte de l'auteur pendant la mise à l'abri
begin;
do $$
declare a uuid := nia_test.mk_user('hd_owner'); b uuid := nia_test.mk_user('hd_b'); v uuid; r jsonb;
begin
  v := nia_test.mk_video(a);
  perform nia_test.dml_as('authenticated', b, format('insert into public.reports (reporter_id, target_type, target_id, category) values (%L, ''video'', %L, ''pedocriminalite'')', b, v));
  r := nia_test.delete_as(a);
  perform nia_test.eq(r->>'ok', 'true', 'S8 suppression du compte OK');
  perform nia_test.eq((select min(not_before) > now() + interval '29 minutes' from public.storage_purge_jobs where user_id = a), true, 'S8 purge Storage retardée tant que la copie n''est pas faite');
  perform nia_test.eq((select desired || '/' || actual || '/' || (purge_after > now() + interval '179 days') from public.moderation_file_holds where video_id = v), 'held/public/true', 'S8 copie à faire, gardée 180 jours (P0)');
  perform nia_test.eq(nia_test.n(format('select 1 from public.reports where target_id = %L and target_snapshot ? ''storage_path''', v)), 1::bigint, 'S8 signalement et instantané conservés');
  perform nia_test.ok('S8 suppression de compte pendant la mise à l''abri');
end $$;
rollback;

-- ===========================================================================
-- S9. Domaine @users.nia.app réservé à snapchat-auth
-- ===========================================================================
begin;
do $$
declare u uuid := gen_random_uuid(); ok boolean;
begin
  -- inscription publique : refusée au COMMIT (trigger différé)
  insert into auth.users (id, email, raw_app_meta_data) values (u, 'snapchat_abc@users.nia.app', '{"provider":"email"}');
  begin
    set constraints auth.nia_reserved_email_domain immediate;
    ok := true;
  exception when others then
    perform nia_test.eq(sqlerrm, 'reserved_email_domain', 'S9 inscription publique @users.nia.app refusée');
    ok := false;
  end;
  perform nia_test.eq(ok, false, 'S9 refus effectif');
end $$;
rollback;

begin;
do $$
declare u uuid := gen_random_uuid(); w uuid := gen_random_uuid(); ok boolean := true;
begin
  -- API admin (snapchat-auth) : insertion puis app_metadata dans la même transaction
  insert into auth.users (id, email, raw_app_meta_data) values (u, 'Snapchat_XYZ@users.nia.app', '{"provider":"email"}');
  update auth.users set raw_app_meta_data = raw_app_meta_data || '{"nia_origin":"snapchat-auth"}' where id = u;
  set constraints auth.nia_reserved_email_domain immediate;
  perform nia_test.eq((select count(*) from public.profiles where id = u), 1::bigint, 'S9 compte snapchat-auth accepté');
  set constraints auth.nia_reserved_email_domain deferred;
  -- changement d'adresse vers le domaine réservé : refusé
  insert into auth.users (id, email) values (w, 'awa@example.test');
  set constraints auth.nia_reserved_email_domain immediate;
  set constraints auth.nia_reserved_email_domain deferred;
  update auth.users set email = 'snapchat_awa@users.nia.app' where id = w;
  begin
    set constraints auth.nia_reserved_email_domain immediate;
  exception when others then
    ok := false;
  end;
  perform nia_test.eq(ok, false, 'S9 changement d''e-mail vers @users.nia.app refusé');
  perform nia_test.ok('S9 domaine réservé : inscription et changement d''adresse');
end $$;
rollback;

-- ===========================================================================
-- B. Rattrapage des signalements d'avant 017 (données posées par run_local.sh)
-- ===========================================================================
do $$
begin
  if to_regclass('nia_test_seed.backfill') is null then
    raise notice 'skip B (pas de données de rattrapage)';
    return;
  end if;
  perform nia_test.eq((select moderation_state from public.videos where id = (select video_p0 from nia_test_seed.backfill)), 'held', 'B ancien signalement P0 → vidéo masquée à l''application');
  perform nia_test.eq((select category || '/' || priority || '/' || legal_status from public.reports where id = (select report_p0 from nia_test_seed.backfill)), 'pedocriminalite/0/to_report', 'B ancien P0 reclassé');
  perform nia_test.eq((select moderation_state from public.videos where id = (select video_three from nia_test_seed.backfill)), 'held', 'B 3 anciens signaleurs → masquée');
  perform nia_test.eq((select moderation_state from public.videos where id = (select video_one from nia_test_seed.backfill)), 'visible', 'B un seul ancien signalement → reste visible');
  perform nia_test.eq((select count(*) from public.reports where target_id = (select video_one from nia_test_seed.backfill) and status = 'open'), 1::bigint, 'B doublon ancien fermé (un seul ouvert)');
  perform nia_test.ok('B rattrapage des signalements existants');
end $$;
