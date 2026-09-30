-- Tests de 020 (âge déclaré, contenus 18+). Postgres LOCAL jetable uniquement
-- (run_local.sh, après 020_seed_before.sql puis 020 appliquée deux fois).
-- Chaque groupe tourne dans une transaction annulée ; le script s'arrête à la
-- première assertion fausse (« not ok - … »).
\set ON_ERROR_STOP 1

-- Déclare une date de naissance comme l'app (RPC, rôle authenticated).
create or replace function nia_test.dob(p_uid uuid, p_birth date) returns jsonb
language sql as $$
  select nia_test.exec_as('authenticated', p_uid,
    format('select public.set_my_birth_date(%L::date) as adult', p_birth))
$$;

create or replace function nia_test.opt_in(p_uid uuid, p_on boolean) returns jsonb
language sql as $$
  select nia_test.exec_as('authenticated', p_uid,
    format('select public.set_my_mature_opt_in(%L::boolean) as on', p_on))
$$;

-- Majeur (30 ans) qui a activé l'affichage 18+.
create or replace function nia_test.mk_adult(p_handle text, p_opt_in boolean default true) returns uuid
language plpgsql as $$
declare v uuid := nia_test.mk_user(p_handle); r jsonb;
begin
  r := nia_test.dob(v, (current_date - interval '30 years')::date);
  if not (r->>'ok')::boolean then raise exception 'not ok - mk_adult : %', r->>'message'; end if;
  if p_opt_in then
    r := nia_test.opt_in(v, true);
    if not (r->>'ok')::boolean then raise exception 'not ok - mk_adult opt-in : %', r->>'message'; end if;
  end if;
  return v;
end $$;

create or replace function nia_test.mk_minor(p_handle text) returns uuid
language plpgsql as $$
declare v uuid := nia_test.mk_user(p_handle); r jsonb;
begin
  r := nia_test.dob(v, (current_date - interval '15 years')::date);
  if not (r->>'ok')::boolean then raise exception 'not ok - mk_minor : %', r->>'message'; end if;
  return v;
end $$;

-- ===========================================================================
-- G0. Données existantes : aucune ligne modifiée par 020 (rejouée deux fois)
-- ===========================================================================
do $$
declare n_before bigint; n_changed bigint; n_mature bigint;
begin
  select count(*) into n_before from nia_test_seed020.before;
  perform nia_test.eq(n_before > 0, true, 'G0 empreinte d''avant 020 non vide');
  with after as (
    select 'videos' as t, to_jsonb(x) - 'is_mature' - 'mature_locked' as row from public.videos x
    union all select 'live_streams', to_jsonb(x) - 'is_mature' - 'mature_locked' from public.live_streams x
    union all select 'profiles', to_jsonb(x) from public.profiles x
    union all select 'comments', to_jsonb(x) from public.comments x
    union all select 'likes', to_jsonb(x) from public.likes x
    union all select 'saves', to_jsonb(x) from public.saves x
    union all select 'reposts', to_jsonb(x) from public.reposts x
    union all select 'follows', to_jsonb(x) from public.follows x
    union all select 'reports', to_jsonb(x) from public.reports x
    union all select 'notifications', to_jsonb(x) from public.notifications x
  )
  select count(*) into n_changed from (
    (select t, row from nia_test_seed020.before except all select t, row from after)
    union all
    (select t, row from after except all select t, row from nia_test_seed020.before)
  ) d;
  perform nia_test.eq(n_changed, 0::bigint, 'G0 aucune ligne existante ajoutée, modifiée ou supprimée');
  select count(*) into n_mature from public.videos where is_mature or mature_locked;
  perform nia_test.eq(n_mature, 0::bigint, 'G0 toutes les vidéos existantes restent non 18+');
  select count(*) into n_mature from public.live_streams where is_mature or mature_locked;
  perform nia_test.eq(n_mature, 0::bigint, 'G0 tous les lives existants restent non 18+');
  perform nia_test.eq((select count(*) from public.user_birthdates), 0::bigint, 'G0 aucune date de naissance créée');
  -- Les contenus existants restent visibles comme avant, y compris déconnecté.
  perform nia_test.eq(nia_test.seen('anon', null, format(
    'select id from public.videos where id in (%L, %L)',
    (select video from nia_test_seed020.ids), (select repost from nia_test_seed020.ids))), 2,
    'G0 vidéo et repost d''avant 020 toujours visibles des visiteurs');
  perform nia_test.eq(nia_test.seen('anon', null, format(
    'select id from public.live_streams where id = %L', (select live from nia_test_seed020.ids))), 1,
    'G0 live d''avant 020 toujours visible des visiteurs');
  perform nia_test.eq(nia_test.seen('anon', null, format(
    'select id from public.comments where video_id = %L', (select video from nia_test_seed020.ids))), 1,
    'G0 commentaire d''avant 020 toujours visible');
  perform nia_test.ok('G0 données existantes intactes');
end $$;

-- ===========================================================================
-- G1. Date de naissance : table privée, saisie unique, âge minimum
-- ===========================================================================
begin;
do $$
declare a uuid := nia_test.mk_user('g1_a'); b uuid := nia_test.mk_user('g1_b');
  c uuid := nia_test.mk_user('g1_c'); d uuid := nia_test.mk_user('g1_d'); r jsonb;
begin
  perform nia_test.eq(public.nia_min_signup_age(), 13, 'G1 âge minimum = 13');
  r := nia_test.dob(a, null);
  perform nia_test.eq(r->>'message', 'birth_date_invalid', 'G1 date absente refusée');
  r := nia_test.dob(a, (current_date + 1));
  perform nia_test.eq(r->>'message', 'birth_date_invalid', 'G1 date future refusée');
  r := nia_test.dob(a, date '1899-12-31');
  perform nia_test.eq(r->>'message', 'birth_date_invalid', 'G1 date avant 1900 refusée');
  r := nia_test.dob(a, (current_date - interval '10 years')::date);
  perform nia_test.eq(r->>'sqlstate', '22023', 'G1 moins de 13 ans : 22023');
  perform nia_test.eq(r->>'message', 'too_young', 'G1 moins de 13 ans : too_young');
  r := nia_test.dob(a, ((current_date - interval '13 years')::date + 1));
  perform nia_test.eq(r->>'message', 'too_young', 'G1 13 ans demain : encore refusé');
  perform nia_test.eq((select count(*) from public.user_birthdates where user_id = a), 0::bigint,
    'G1 refus : rien n''est enregistré');
  r := nia_test.dob(a, (current_date - interval '13 years')::date);
  perform nia_test.eq(r->'rows'->0->>'adult', 'false', 'G1 13 ans aujourd''hui : accepté, mineur');
  r := nia_test.dob(b, (current_date - interval '18 years')::date);
  perform nia_test.eq(r->'rows'->0->>'adult', 'true', 'G1 18 ans aujourd''hui : majeur');
  r := nia_test.dob(c, ((current_date - interval '18 years')::date + 1));
  perform nia_test.eq(r->'rows'->0->>'adult', 'false', 'G1 18 ans demain : mineur');
  r := nia_test.dob(a, (current_date - interval '40 years')::date);
  perform nia_test.eq(r->>'sqlstate', '23505', 'G1 date déjà saisie : non modifiable par l''utilisateur');
  perform nia_test.eq((select source from public.user_birthdates where user_id = a), 'self_declared', 'G1 source self_declared');
  -- Aucune écriture directe, lecture de sa seule ligne.
  r := nia_test.dml_as('authenticated', d, format(
    'insert into public.user_birthdates (user_id, birth_date) values (%L, ''1990-01-01'')', d));
  perform nia_test.eq(r->>'sqlstate', '42501', 'G1 pas d''INSERT direct');
  r := nia_test.dml_as('authenticated', a, format(
    'update public.user_birthdates set birth_date = ''1990-01-01'' where user_id = %L', a));
  perform nia_test.eq(r->>'sqlstate', '42501', 'G1 pas d''UPDATE direct');
  r := nia_test.dml_as('authenticated', a, format('delete from public.user_birthdates where user_id = %L', a));
  perform nia_test.eq(r->>'sqlstate', '42501', 'G1 pas de DELETE direct');
  perform nia_test.eq(nia_test.seen('authenticated', b, 'select user_id from public.user_birthdates'), 1,
    'G1 chacun ne lit que sa ligne');
  perform nia_test.eq(nia_test.exec_as('anon', null, 'select user_id from public.user_birthdates')->>'sqlstate',
    '42501', 'G1 table fermée aux visiteurs');
  perform nia_test.eq(nia_test.exec_as('anon', null, format('select public.set_my_birth_date(%L::date)',
    (current_date - interval '20 years')::date))->>'sqlstate', '42501', 'G1 RPC fermée aux visiteurs');
  -- La date ne sort pas par profiles (lisible par tous).
  perform nia_test.eq((select count(*) from information_schema.columns
                        where table_schema = 'public' and table_name = 'profiles'
                          and column_name ilike '%birth%'), 0::bigint, 'G1 aucune date dans profiles');
  perform nia_test.ok('G1 date de naissance privée, saisie unique, 13 ans minimum');
end $$;
rollback;

-- ===========================================================================
-- G2. « Afficher les contenus 18+ » et état renvoyé à l'app
-- ===========================================================================
begin;
do $$
declare adult uuid := nia_test.mk_adult('g2_adult', false); minor uuid := nia_test.mk_minor('g2_minor');
  nodob uuid := nia_test.mk_user('g2_nodob'); r jsonb;
begin
  r := nia_test.exec_as('authenticated', adult, 'select public.get_my_age_status() as s');
  perform nia_test.eq(r->'rows'->0->'s', '{"adult": true, "min_age": 13, "declared": true, "show_mature": false}'::jsonb,
    'G2 majeur : 18+ désactivé par défaut');
  r := nia_test.exec_as('authenticated', nodob, 'select public.get_my_age_status() as s');
  perform nia_test.eq(r->'rows'->0->'s', '{"adult": false, "min_age": 13, "declared": false, "show_mature": false}'::jsonb,
    'G2 sans date : non déclaré');
  perform nia_test.eq(nia_test.exec_as('anon', null, 'select public.get_my_age_status() as s')->>'sqlstate',
    '42501', 'G2 état fermé aux visiteurs');
  r := nia_test.opt_in(minor, true);
  perform nia_test.eq(r->>'message', 'not_adult', 'G2 un mineur ne peut pas activer le 18+');
  perform nia_test.eq(r->>'sqlstate', '42501', 'G2 refus mineur : 42501');
  r := nia_test.opt_in(nodob, true);
  perform nia_test.eq(r->>'message', 'birth_date_missing', 'G2 sans date : activation refusée');
  perform nia_test.eq(nia_test.opt_in(nodob, false)->'rows'->0->>'on', 'false', 'G2 sans date : désactiver est sans effet');
  perform nia_test.eq(nia_test.opt_in(minor, false)->'rows'->0->>'on', 'false', 'G2 mineur : désactiver accepté');
  perform nia_test.eq(nia_test.opt_in(adult, true)->'rows'->0->>'on', 'true', 'G2 majeur : activation');
  perform nia_test.eq((select show_mature and show_mature_at is not null from public.user_birthdates where user_id = adult),
    true, 'G2 activation horodatée');
  r := nia_test.exec_as('authenticated', adult, 'select public.get_my_age_status() as s');
  perform nia_test.eq(r->'rows'->0->'s'->>'show_mature', 'true', 'G2 état : 18+ activé');
  perform nia_test.eq(nia_test.opt_in(adult, false)->'rows'->0->>'on', 'false', 'G2 majeur : désactivation');
  perform nia_test.ok('G2 choix 18+ réservé aux majeurs, désactivé par défaut');
end $$;
rollback;

-- ===========================================================================
-- G3. Vidéos : qui peut marquer 18+, qui les voit
-- ===========================================================================
begin;
do $$
declare
  owner uuid := nia_test.mk_adult('g3_owner', false);
  fan uuid := nia_test.mk_adult('g3_fan');
  adult_off uuid := nia_test.mk_adult('g3_adult_off', false);
  minor uuid := nia_test.mk_minor('g3_minor');
  nodob uuid := nia_test.mk_user('g3_nodob');
  m uuid := nia_test.mk_user('g3_mod');
  v uuid; v2 uuid; vm uuid; r jsonb;
begin
  insert into public.moderators (user_id) values (m);
  -- Marquage : réservé aux comptes majeurs (insertion et mise à jour).
  r := nia_test.dml_as('authenticated', owner, format(
    'insert into public.videos (user_id, storage_path, status, is_mature, mature_locked) values (%L, %L, ''published'', true, true)',
    owner, owner::text || '/m.mp4'));
  perform nia_test.eq(r->>'n', '1', 'G3 un majeur publie en 18+');
  v := (select id from public.videos where user_id = owner and storage_path like '%/m.mp4');
  perform nia_test.eq((select is_mature::text || '/' || mature_locked::text from public.videos where id = v), 'true/false',
    'G3 mature_locked remis à false à l''insertion');
  r := nia_test.dml_as('authenticated', minor, format(
    'insert into public.videos (user_id, storage_path, status, is_mature) values (%L, %L, ''published'', true)',
    minor, minor::text || '/m.mp4'));
  perform nia_test.eq(r->>'message', 'mature_requires_adult', 'G3 un mineur ne publie pas en 18+');
  r := nia_test.dml_as('authenticated', nodob, format(
    'insert into public.videos (user_id, storage_path, status, is_mature) values (%L, %L, ''published'', true)',
    nodob, nodob::text || '/m.mp4'));
  perform nia_test.eq(r->>'message', 'mature_requires_adult', 'G3 sans date : pas de 18+');
  vm := nia_test.mk_video(minor);
  r := nia_test.dml_as('authenticated', minor, format('update public.videos set is_mature = true where id = %L', vm));
  perform nia_test.eq(r->>'message', 'mature_requires_adult', 'G3 un mineur ne marque pas 18+ après coup');
  r := nia_test.dml_as('authenticated', minor, format('update public.videos set caption = ''ok'' where id = %L', vm));
  perform nia_test.eq(r->>'n', '1', 'G3 un mineur modifie toujours ses vidéos non 18+');
  v2 := nia_test.mk_video(owner);
  r := nia_test.dml_as('authenticated', owner, format('update public.videos set is_mature = true where id = %L', v2));
  perform nia_test.eq(r->>'n', '1', 'G3 le créateur majeur marque 18+ après coup');
  r := nia_test.dml_as('authenticated', owner, format('update public.videos set is_mature = false where id = %L', v2));
  perform nia_test.eq(r->>'n', '1', 'G3 le créateur retire son propre marquage');
  r := nia_test.dml_as('authenticated', owner, format('update public.videos set mature_locked = true where id = %L', v2));
  perform nia_test.eq(r->>'message', 'mature_locked', 'G3 mature_locked en lecture seule pour l''app');

  -- Lecture.
  perform nia_test.eq(nia_test.seen('anon', null, format('select id from public.videos where id = %L', v)), 0, 'G3 18+ invisible déconnecté');
  perform nia_test.eq(nia_test.seen('authenticated', minor, format('select id from public.videos where id = %L', v)), 0, 'G3 18+ invisible mineur');
  perform nia_test.eq(nia_test.seen('authenticated', nodob, format('select id from public.videos where id = %L', v)), 0, 'G3 18+ invisible sans date');
  perform nia_test.eq(nia_test.seen('authenticated', adult_off, format('select id from public.videos where id = %L', v)), 0, 'G3 18+ invisible majeur non activé');
  perform nia_test.eq(nia_test.seen('authenticated', fan, format('select id from public.videos where id = %L', v)), 1, 'G3 18+ visible majeur activé');
  perform nia_test.eq(nia_test.seen('authenticated', owner, format('select id from public.videos where id = %L', v)), 1, 'G3 18+ visible créateur (même non activé)');
  perform nia_test.eq(nia_test.seen('authenticated', m, format('select id from public.videos where id = %L', v)), 1, 'G3 18+ visible modérateur');
  perform nia_test.eq(nia_test.seen('anon', null, format('select id from public.videos where id = %L', v2)), 1, 'G3 vidéo non 18+ toujours publique');
  r := nia_test.exec_as('authenticated', minor, format('select public.nia_can_view_video(%L) as ok', v));
  perform nia_test.eq(r->'rows'->0->>'ok', 'false', 'G3 nia_can_view_video : non pour un mineur');
  -- 18+ et « abonnés » se cumulent.
  update public.videos set visibility = 'followers' where id = v;
  perform nia_test.eq(nia_test.seen('authenticated', fan, format('select id from public.videos where id = %L', v)), 0, 'G3 18+ abonnés : majeur non abonné exclu');
  insert into public.follows (follower_id, following_id) values (fan, owner), (minor, owner);
  perform nia_test.eq(nia_test.seen('authenticated', fan, format('select id from public.videos where id = %L', v)), 1, 'G3 18+ abonnés : majeur abonné activé');
  perform nia_test.eq(nia_test.seen('authenticated', minor, format('select id from public.videos where id = %L', v)), 0, 'G3 18+ abonnés : mineur abonné exclu');
  update public.videos set visibility = 'public' where id = v;
  -- Blocage (017) toujours appliqué.
  insert into public.blocks (blocker_id, blocked_id) values (owner, fan);
  perform nia_test.eq(nia_test.seen('authenticated', fan, format('select id from public.videos where id = %L', v)), 0, 'G3 blocage prioritaire sur le 18+');
  delete from public.blocks where blocker_id = owner and blocked_id = fan;
  -- Masquage (017) toujours appliqué.
  update public.videos set moderation_state = 'held' where id = v;
  perform nia_test.eq(nia_test.seen('authenticated', fan, format('select id from public.videos where id = %L', v)), 0, 'G3 masquage prioritaire sur le 18+');
  perform nia_test.eq(nia_test.seen('authenticated', owner, format('select id from public.videos where id = %L', v)), 1, 'G3 le créateur voit sa vidéo 18+ retenue');
  update public.videos set moderation_state = 'visible' where id = v;
  perform nia_test.ok('G3 vidéos 18+ : marquage majeur, lecture restreinte');
end $$;
rollback;

-- ===========================================================================
-- G4. Autour d'une vidéo 18+ : commentaires, j'aime, enregistrements, reposts
-- ===========================================================================
begin;
do $$
declare
  owner uuid := nia_test.mk_adult('g4_owner', false);
  fan uuid := nia_test.mk_adult('g4_fan');
  fan2 uuid := nia_test.mk_adult('g4_fan2');
  minor uuid := nia_test.mk_minor('g4_minor');
  v uuid; o uuid; rp uuid; r jsonb;
begin
  v := nia_test.mk_video(owner);
  update public.videos set is_mature = true where id = v;
  r := nia_test.dml_as('authenticated', fan, format(
    'insert into public.comments (video_id, user_id, body) values (%L, %L, ''Merci pour ce documentaire'')', v, fan));
  perform nia_test.eq(r->>'n', '1', 'G4 un majeur activé commente');
  r := nia_test.dml_as('authenticated', minor, format(
    'insert into public.comments (video_id, user_id, body) values (%L, %L, ''salut'')', v, minor));
  perform nia_test.eq(r->>'sqlstate', '42501', 'G4 un mineur ne commente pas un 18+');
  perform nia_test.eq(nia_test.seen('authenticated', minor, format('select id from public.comments where video_id = %L', v)), 0,
    'G4 commentaires d''un 18+ invisibles pour un mineur');
  perform nia_test.eq(nia_test.seen('anon', null, format('select id from public.comments where video_id = %L', v)), 0,
    'G4 commentaires d''un 18+ invisibles déconnecté');
  perform nia_test.eq(nia_test.seen('authenticated', fan2, format('select id from public.comments where video_id = %L', v)), 1,
    'G4 commentaires visibles d''un majeur activé');
  r := nia_test.dml_as('authenticated', minor, format('insert into public.likes (user_id, video_id) values (%L, %L)', minor, v));
  perform nia_test.eq(r->>'sqlstate', '42501', 'G4 un mineur n''aime pas un 18+');
  r := nia_test.dml_as('authenticated', minor, format('insert into public.saves (user_id, video_id) values (%L, %L)', minor, v));
  perform nia_test.eq(r->>'sqlstate', '42501', 'G4 un mineur n''enregistre pas un 18+');
  r := nia_test.dml_as('authenticated', fan, format('insert into public.likes (user_id, video_id) values (%L, %L)', fan, v));
  perform nia_test.eq(r->>'n', '1', 'G4 un majeur activé aime');
  -- Republication : jamais pour un 18+.
  r := nia_test.dml_as('authenticated', fan, format('insert into public.reposts (user_id, video_id) values (%L, %L)', fan, v));
  perform nia_test.eq(r->>'sqlstate', '42501', 'G4 pas de republication d''un 18+ (reposts)');
  r := nia_test.dml_as('authenticated', fan, format(
    'insert into public.videos (user_id, storage_path, status, repost_of) values (%L, ''x/y.mp4'', ''published'', %L)', fan, v));
  perform nia_test.eq(r->>'sqlstate', '42501', 'G4 pas de republication d''un 18+ (videos.repost_of)');
  -- Repost fait AVANT le marquage : disparaît avec l'original.
  o := nia_test.mk_video(owner);
  rp := nia_test.mk_repost(fan, o);
  perform nia_test.eq(nia_test.seen('anon', null, format('select id from public.videos where id = %L', rp)), 1, 'G4 repost visible avant marquage');
  update public.videos set is_mature = true where id = o;
  perform nia_test.eq(nia_test.seen('anon', null, format('select id from public.videos where id = %L', rp)), 0, 'G4 repost masqué des visiteurs après marquage');
  perform nia_test.eq(nia_test.seen('authenticated', minor, format('select id from public.videos where id = %L', rp)), 0, 'G4 repost masqué des mineurs après marquage');
  perform nia_test.eq(nia_test.seen('authenticated', fan2, format('select id from public.videos where id = %L', rp)), 0, 'G4 repost masqué pour tous (original non republiable)');
  perform nia_test.eq((select count(*) from public.videos where id = rp), 1::bigint, 'G4 le repost n''est pas supprimé');
  update public.videos set is_mature = false where id = o;
  perform nia_test.eq(nia_test.seen('anon', null, format('select id from public.videos where id = %L', rp)), 1, 'G4 repost revenu après retrait du 18+');
  perform nia_test.ok('G4 commentaires, j''aime, enregistrements et republication d''un 18+');
end $$;
rollback;

-- ===========================================================================
-- G5. Modération : 18+ imposé, verrouillé, retiré ; correction de la date
-- ===========================================================================
begin;
do $$
declare
  owner uuid := nia_test.mk_adult('g5_owner', false);
  minor uuid := nia_test.mk_minor('g5_minor');
  fan uuid := nia_test.mk_adult('g5_fan');
  someone uuid := nia_test.mk_user('g5_someone');
  m uuid := nia_test.mk_user('g5_mod');
  v uuid; vm uuid; l uuid; r jsonb;
begin
  insert into public.moderators (user_id) values (m);
  v := nia_test.mk_video(owner);
  vm := nia_test.mk_video(minor);
  r := nia_test.exec_as('authenticated', someone, format('select public.mod_set_mature(''video'', %L, true) as x', v));
  perform nia_test.eq(r->>'message', 'not_moderator', 'G5 mod_set_mature refusé hors modérateur');
  r := nia_test.exec_as('anon', null, format('select public.mod_set_mature(''video'', %L, true) as x', v));
  perform nia_test.eq(r->>'sqlstate', '42501', 'G5 mod_set_mature fermé aux visiteurs');
  r := nia_test.exec_as('authenticated', m, format('select public.mod_set_mature(''video'', %L, true) as x', v));
  perform nia_test.eq(r->>'ok', 'true', 'G5 un modérateur impose le 18+');
  perform nia_test.eq((select is_mature::text || '/' || mature_locked::text from public.videos where id = v), 'true/true', 'G5 18+ imposé et verrouillé');
  r := nia_test.dml_as('authenticated', owner, format('update public.videos set is_mature = false where id = %L', v));
  perform nia_test.eq(r->>'message', 'mature_locked', 'G5 le créateur ne retire pas un 18+ imposé');
  r := nia_test.dml_as('authenticated', owner, format('update public.videos set caption = ''nouveau'' where id = %L', v));
  perform nia_test.eq(r->>'n', '1', 'G5 le créateur modifie toujours sa légende');
  -- Contenu d'un mineur : le modérateur peut l'imposer (le garde-fou « majeur » ne le bloque pas).
  r := nia_test.exec_as('authenticated', m, format('select public.mod_set_mature(''video'', %L, true) as x', vm));
  perform nia_test.eq((select is_mature from public.videos where id = vm), true, 'G5 18+ imposé sur la vidéo d''un mineur');
  r := nia_test.dml_as('authenticated', minor, format('update public.videos set caption = ''modif'' where id = %L', vm));
  perform nia_test.eq(r->>'n', '1', 'G5 le mineur modifie sa légende d''une vidéo 18+ imposée');
  r := nia_test.exec_as('authenticated', m, format('select public.mod_set_mature(''video'', %L, false) as x', v));
  perform nia_test.eq((select is_mature::text || '/' || mature_locked::text from public.videos where id = v), 'false/false', 'G5 le modérateur retire le 18+');
  r := nia_test.exec_as('authenticated', m, format('select public.mod_set_mature(''comment'', %L, true) as x', v));
  perform nia_test.eq(r->>'message', 'bad_target', 'G5 cible inconnue refusée');
  insert into public.live_streams (user_id, title) values (owner, 'Rite') returning id into l;
  r := nia_test.exec_as('authenticated', m, format('select public.mod_set_mature(''live'', %L, true) as x', l));
  perform nia_test.eq((select is_mature::text || '/' || mature_locked::text from public.live_streams where id = l), 'true/true', 'G5 18+ imposé à un live');
  r := nia_test.dml_as('authenticated', owner, format('update public.live_streams set is_mature = false where id = %L', l));
  perform nia_test.eq(r->>'message', 'mature_locked', 'G5 l''hôte ne retire pas un 18+ imposé');
  -- SQL Editor (aucun claim) : autorisé.
  perform public.mod_set_mature('video', v, true);
  perform nia_test.eq((select mature_locked from public.videos where id = v), true, 'G5 mod_set_mature depuis le SQL Editor');
  -- Correction de la date par le support.
  r := nia_test.exec_as('authenticated', someone, format('select public.mod_set_birth_date(%L, ''2000-01-01'') as x', fan));
  perform nia_test.eq(r->>'message', 'not_moderator', 'G5 mod_set_birth_date refusé hors modérateur');
  r := nia_test.exec_as('authenticated', m, format('select public.mod_set_birth_date(%L, %L::date) as x', fan,
    (current_date - interval '16 years')::date));
  perform nia_test.eq(r->>'ok', 'true', 'G5 le support corrige une date');
  perform nia_test.eq((select source || '/' || show_mature::text from public.user_birthdates where user_id = fan),
    'corrected_by_support/false', 'G5 devenu mineur : source corrigée, 18+ désactivé');
  perform nia_test.eq(nia_test.seen('authenticated', fan, format('select id from public.videos where id = %L', v)), 0,
    'G5 devenu mineur : ne voit plus le 18+');
  r := nia_test.exec_as('authenticated', m, format('select public.mod_set_birth_date(%L, %L::date) as x', someone,
    (current_date - interval '9 years')::date));
  perform nia_test.eq((select birth_date from public.user_birthdates where user_id = someone),
    (current_date - interval '9 years')::date, 'G5 le support peut enregistrer la date réelle d''un enfant');
  r := nia_test.exec_as('authenticated', m, format('select public.mod_set_birth_date(%L, null) as x', someone));
  perform nia_test.eq((select count(*) from public.user_birthdates where user_id = someone), 0::bigint,
    'G5 date effacée : l''app la redemandera');
  perform nia_test.ok('G5 modération du 18+ et correction de la date');
end $$;
rollback;

-- ===========================================================================
-- G6. Lives 18+ (019 conservée)
-- ===========================================================================
begin;
do $$
declare
  host uuid := nia_test.mk_adult('g6_host', false);
  fan uuid := nia_test.mk_adult('g6_fan');
  adult_off uuid := nia_test.mk_adult('g6_off', false);
  minor uuid := nia_test.mk_minor('g6_minor');
  m uuid := nia_test.mk_user('g6_mod');
  l uuid; l2 uuid; r jsonb;
begin
  insert into public.moderators (user_id) values (m);
  r := nia_test.dml_as('authenticated', minor, format(
    'insert into public.live_streams (user_id, title, is_mature) values (%L, ''Direct'', true)', minor));
  perform nia_test.eq(r->>'message', 'mature_requires_adult', 'G6 un mineur ne lance pas de live 18+');
  r := nia_test.dml_as('authenticated', host, format(
    'insert into public.live_streams (user_id, title, is_mature, mature_locked, status) values (%L, ''Rite de passage'', true, true, ''live'')', host));
  perform nia_test.eq(r->>'n', '1', 'G6 un majeur lance un live 18+');
  l := (select id from public.live_streams where user_id = host and title = 'Rite de passage');
  perform nia_test.eq((select status || '/' || is_mature::text || '/' || mature_locked::text from public.live_streams where id = l),
    'scheduled/true/false', 'G6 019 force scheduled ; mature_locked remis à false');
  -- Passage à l'antenne par le webhook (service_role) : le 18+ ne change rien.
  r := nia_test.exec_as('service_role', null, format(
    'select public.live_webhook_apply(%L::uuid, ''participant_joined'', %L, 0, null, %L) as r', l, host::text, 'nia-live-' || l::text));
  perform nia_test.eq(r->'rows'->0->>'r', 'went_live', 'G6 webhook : went_live');
  perform nia_test.eq(nia_test.seen('anon', null, format('select id from public.live_streams where id = %L', l)), 0, 'G6 live 18+ invisible déconnecté');
  perform nia_test.eq(nia_test.seen('authenticated', minor, format('select id from public.live_streams where id = %L', l)), 0, 'G6 live 18+ invisible mineur (pas de jeton live-token)');
  perform nia_test.eq(nia_test.seen('authenticated', adult_off, format('select id from public.live_streams where id = %L', l)), 0, 'G6 live 18+ invisible majeur non activé');
  perform nia_test.eq(nia_test.seen('authenticated', fan, format('select id from public.live_streams where id = %L', l)), 1, 'G6 live 18+ visible majeur activé');
  perform nia_test.eq(nia_test.seen('authenticated', host, format('select id from public.live_streams where id = %L', l)), 1, 'G6 live 18+ visible hôte');
  perform nia_test.eq(nia_test.seen('authenticated', m, format('select id from public.live_streams where id = %L', l)), 1, 'G6 live 18+ visible modérateur');
  -- Audience « Abonnés » (019) + 18+.
  update public.live_streams set visibility = 'followers' where id = l;
  perform nia_test.eq(nia_test.seen('authenticated', fan, format('select id from public.live_streams where id = %L', l)), 0, 'G6 abonnés + 18+ : non abonné exclu');
  insert into public.follows (follower_id, following_id) values (fan, host), (minor, host);
  perform nia_test.eq(nia_test.seen('authenticated', fan, format('select id from public.live_streams where id = %L', l)), 1, 'G6 abonnés + 18+ : abonné majeur activé');
  perform nia_test.eq(nia_test.seen('authenticated', minor, format('select id from public.live_streams where id = %L', l)), 0, 'G6 abonnés + 18+ : abonné mineur exclu');
  -- Masquage (017) conservé.
  update public.live_streams set moderation_state = 'held' where id = l;
  perform nia_test.eq(nia_test.seen('authenticated', fan, format('select id from public.live_streams where id = %L', l)), 0, 'G6 live retenu toujours invisible');
  update public.live_streams set moderation_state = 'visible' where id = l;
  -- L'hôte termine (019) : accepté.
  r := nia_test.dml_as('authenticated', host, format('update public.live_streams set status = ''ended'' where id = %L', l));
  perform nia_test.eq(r->>'n', '1', 'G6 fin du live 18+ par l''hôte');
  -- Live ordinaire : inchangé.
  insert into public.live_streams (user_id, title) values (host, 'Cuisine') returning id into l2;
  perform nia_test.eq(nia_test.seen('anon', null, format('select id from public.live_streams where id = %L', l2)), 1, 'G6 live non 18+ toujours public');
  perform nia_test.ok('G6 lives 18+');
end $$;
rollback;

-- ===========================================================================
-- G7. Suppression de compte (014) : la date part avec le compte
-- ===========================================================================
begin;
do $$
declare a uuid := nia_test.mk_adult('g7_a'); r jsonb;
begin
  perform nia_test.eq((select count(*) from public.user_birthdates where user_id = a), 1::bigint, 'G7 date présente');
  r := nia_test.delete_as(a);
  perform nia_test.eq(r->>'ok', 'true', 'G7 delete_own_account ok');
  perform nia_test.eq((select count(*) from public.user_birthdates where user_id = a), 0::bigint, 'G7 date effacée avec le compte');
  perform nia_test.ok('G7 suppression de compte');
end $$;
rollback;

-- ===========================================================================
-- G8. Droits et fonctions
-- ===========================================================================
do $$
begin
  perform nia_test.eq((select count(*) from pg_proc
     where pronamespace = 'public'::regnamespace and prosecdef and proconfig @> array['search_path=""']
       and proname in ('nia_viewer_is_adult', 'nia_viewer_sees_mature', 'nia_mature_ok', 'set_my_birth_date',
                       'set_my_mature_opt_in', 'get_my_age_status', 'mod_set_mature', 'mod_set_birth_date',
                       'nia_video_reusable', 'nia_can_view_video', 'nia_video_accepts_comments')), 11::bigint,
    'G8 fonctions definer à search_path vide');
  perform nia_test.eq(has_function_privilege('anon', 'public.set_my_birth_date(date)', 'execute')
                   or has_function_privilege('anon', 'public.set_my_mature_opt_in(boolean)', 'execute')
                   or has_function_privilege('anon', 'public.get_my_age_status()', 'execute')
                   or has_function_privilege('anon', 'public.mod_set_mature(text, uuid, boolean)', 'execute')
                   or has_function_privilege('anon', 'public.mod_set_birth_date(uuid, date)', 'execute'),
    false, 'G8 RPC fermées aux visiteurs');
  perform nia_test.eq(has_function_privilege('authenticated', 'public.nia_mature_guard()', 'execute'), false,
    'G8 garde non exécutable directement');
  perform nia_test.eq(has_table_privilege('anon', 'public.user_birthdates', 'select'), false, 'G8 table fermée à anon');
  perform nia_test.eq(has_table_privilege('authenticated', 'public.user_birthdates', 'insert')
                   or has_table_privilege('authenticated', 'public.user_birthdates', 'update')
                   or has_table_privilege('authenticated', 'public.user_birthdates', 'delete'), false,
    'G8 aucune écriture directe pour authenticated');
  perform nia_test.ok('G8 droits');
end $$;
