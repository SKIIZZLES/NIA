-- Tests de 018 (filtre de mots). Postgres LOCAL jetable uniquement
-- (run_local.sh), après 017 et 018 appliquées (018 deux fois). Chaque groupe
-- tourne dans une transaction annulée.
\set ON_ERROR_STOP 1

-- Verdict de l'analyse pour un texte (en tant que postgres).
create or replace function nia_test.kw(p text) returns text language sql as $$
  select a.action || coalesce(':' || a.category, '') from public.nia_kw_analyze(p) a
$$;
create or replace function nia_test.kw_masked(p text) returns text language sql as $$
  select a.masked from public.nia_kw_analyze(p) a
$$;
-- Le compteur de 017 (1 commentaire / 3 s) : on vieillit les commentaires.
create or replace function nia_test.age_comments() returns void language sql as $$
  update public.comments set created_at = created_at - interval '1 hour'
$$;

-- ===========================================================================
-- K1. Normalisation et correspondance (mot entier, pas de Scunthorpe)
-- ===========================================================================
do $$
declare
  c record;
begin
  for c in select * from (values
    -- insultes : masquées
    ('quel connard', 'mask:insultes_harcelement'),
    ('QUEL CONNNNNARD', 'mask:insultes_harcelement'),     -- majuscules + lettres répétées
    ('c o n n a r d', 'mask:insultes_harcelement'),       -- lettres séparées
    ('c.o.n.n.a.r.d !', 'mask:insultes_harcelement'),
    ('c0nn4rd', 'mask:insultes_harcelement'),             -- leetspeak
    ('$alope', 'mask:insultes_harcelement'),
    ('4sshole', 'mask:insultes_harcelement'),
    ('con-nard', 'mask:insultes_harcelement'),            -- séparateur dans le mot
    ('@connard', 'mask:insultes_harcelement'),            -- mention
    ('connard93', 'mask:insultes_harcelement'),           -- chiffres collés
    ('des connards', 'mask:insultes_harcelement'),        -- pluriel
    ('bitches', 'mask:insultes_harcelement'),
    ('Enculé de fdp', 'mask:insultes_harcelement'),       -- accents
    ('fils de putes', 'mask:insultes_harcelement'),       -- expression + pluriel
    ('fuuuuck', 'mask:insultes_harcelement'),
    ('cоnnard', 'mask:insultes_harcelement'),             -- о cyrillique
    ('Ｃｏｎｎａｒｄ', 'mask:insultes_harcelement'),       -- pleine chasse (NFKD)
    ('ᴄᴏɴɴᴀʀᴅ', 'mask:insultes_harcelement'),             -- petites capitales
    -- retenus
    ('sale noir', 'hold:negrophobie'),
    ('sales noirs', 'hold:negrophobie'),
    ('sale_noir', 'hold:negrophobie'),
    ('Sale-Noir', 'hold:negrophobie'),
    ('nègre', 'hold:negrophobie'),
    ('nè' || chr(8203) || 'gre', 'hold:negrophobie'),    -- espace de largeur nulle
    ('niggggger', 'hold:negrophobie'),
    ('t''es un pd', 'hold:homophobie'),
    ('p.d', 'hold:homophobie'),
    ('pédés', 'hold:homophobie'),
    ('bougnoule', 'hold:racisme_haine'),
    ('onlyfans en bio', 'hold:nudite_sexuel'),
    ('suicide-toi', 'hold:menace_danger'),
    ('kys', 'hold:menace_danger'),
    ('xchildpornx', 'hold:pedocriminalite'),              -- sous-chaîne (terme non ambigu)
    ('connard et sale noir', 'hold:negrophobie'),         -- la retenue l'emporte
    -- rien (Scunthorpe, homonymes, langues)
    ('Bravo, magnifique danse sabar !', 'none'),
    ('Niger', 'none'), ('Niiiiger !!!', 'none'), ('NIGERIA', 'none'),
    ('conseil', 'none'), ('Scunthorpe', 'none'), ('computer', 'none'),
    ('députée', 'none'), ('assassin', 'none'), ('classe', 'none'),
    ('le PDG', 'none'), ('p.d.g', 'none'),
    ('je n''ai pas pu te voir', 'none'),                  -- « pu te » ≠ pute
    ('tout nu de la tête', 'none'),
    ('la Négritude de Césaire', 'none'),
    ('fuuck', 'none'),                                    -- 2 lettres ≠ 1 : pas une répétition insistante
    ('#foodporn', 'none'),                                -- mot entier seulement
    ('rouge à lèvres nude', 'none'),                      -- terme désactivé
    ('nigga', 'none'),                                    -- terme désactivé (décision du fondateur)
    ('negro', 'none'),                                    -- exclu (es / pt)
    ('2024 et 13 ans', 'none'),
    ('', 'none')
  ) as t(txt, expected)
  loop
    perform nia_test.eq(nia_test.kw(c.txt), c.expected, 'K1 « ' || c.txt || ' »');
  end loop;
  perform nia_test.eq(nia_test.kw_masked('quel connard !'), 'quel c****** !', 'K1 masque : première lettre + astérisques');
  perform nia_test.eq(nia_test.kw_masked('c o n n a r d'), 'c * * * * * *', 'K1 masque des lettres séparées');
  perform nia_test.eq(nia_test.kw_masked('fils de pute'), 'f*** ** ****', 'K1 masque d''une expression');
  perform nia_test.eq(nia_test.kw_masked('connard et sale noir'), 'c****** et sale noir', 'K1 insulte masquée même si retenu');
  perform nia_test.eq(nia_test.kw_masked('Salut 🌍 connard 😀'), 'Salut 🌍 c****** 😀', 'K1 émojis conservés');
  perform nia_test.eq(nia_test.kw(repeat('a ', 4001)), 'hold:spam', 'K1 texte démesuré retenu sans analyse');
  perform nia_test.ok('K1 normalisation et mots entiers');
end $$;

-- ===========================================================================
-- K2. La liste n'est jamais lisible par l'app ; gestion par les modérateurs
-- ===========================================================================
begin;
do $$
declare a uuid := nia_test.mk_user('k2_a'); m uuid := nia_test.mk_user('k2_m'); r jsonb;
begin
  insert into public.moderators (user_id) values (m);
  perform nia_test.eq(nia_test.seen('authenticated', a, 'select term from public.moderation_terms'), 0, 'K2 utilisateur : aucune ligne');
  r := nia_test.exec_as('anon', null, 'select term from public.moderation_terms');
  perform nia_test.eq(r->>'sqlstate', '42501', 'K2 visiteur : table interdite');
  r := nia_test.exec_as('authenticated', a, 'select * from public.nia_kw_analyze(''connard'')');
  perform nia_test.eq(r->>'sqlstate', '42501', 'K2 analyse détaillée interdite à l''app');
  r := nia_test.exec_as('anon', null, 'select * from public.nia_kw_analyze(''connard'')');
  perform nia_test.eq(r->>'sqlstate', '42501', 'K2 analyse détaillée interdite aux visiteurs');
  r := nia_test.dml_as('authenticated', a, 'insert into public.moderation_terms (term, category) values (''bonjour'', ''insultes_harcelement'')');
  perform nia_test.eq(r->>'sqlstate', '42501', 'K2 utilisateur : ajout refusé');
  r := nia_test.dml_as('authenticated', a, 'update public.moderation_terms set enabled = false');
  perform nia_test.eq(r->>'n', '0', 'K2 utilisateur : aucune modification');
  perform nia_test.eq(nia_test.seen('authenticated', a, 'select id from public.keyword_flags'), 0, 'K2 utilisateur : aucune trace lisible');
  perform nia_test.eq(nia_test.seen('authenticated', m, 'select term from public.moderation_terms') > 50, true, 'K2 modérateur : liste lisible');
  r := nia_test.dml_as('authenticated', m, 'insert into public.moderation_terms (term, lang, category) values (''  Grôs-TÊST '', ''fr'', ''insultes_harcelement'')');
  perform nia_test.eq(r->>'n', '1', 'K2 modérateur : ajout');
  perform nia_test.eq((select term || '/' || action || '/' || word_count from public.moderation_terms where term = 'gros test'),
    'gros test/mask/2', 'K2 terme normalisé, action par défaut (insulte → mask)');
  perform nia_test.eq(nia_test.kw('un gros-test ici'), 'mask:insultes_harcelement', 'K2 nouveau terme actif aussitôt');
  r := nia_test.dml_as('authenticated', m, 'insert into public.moderation_terms (term, category) values (''gros  test'', ''negrophobie'')');
  perform nia_test.eq(r->>'sqlstate', '23505', 'K2 doublon (après normalisation) refusé');
  r := nia_test.dml_as('authenticated', m, 'insert into public.moderation_terms (term, category) values (''!!!'', ''negrophobie'')');
  perform nia_test.eq(r->>'sqlstate', '22023', 'K2 terme vide refusé');
  r := nia_test.dml_as('authenticated', m, 'insert into public.moderation_terms (term, category) values (''k1ll3r'', ''menace_danger'')');
  perform nia_test.eq(r->>'n', '1', 'K2 terme en leetspeak accepté');
  perform nia_test.eq((select action from public.moderation_terms where term = 'killer'), 'hold', 'K2 « k1ll3r » → killer, action par défaut hold');
  r := nia_test.dml_as('authenticated', m, 'update public.moderation_terms set enabled = true where term = ''nigga''');
  perform nia_test.eq(r->>'n', '1', 'K2 modérateur : activer un terme désactivé');
  perform nia_test.eq(nia_test.kw('nigga'), 'hold:negrophobie', 'K2 terme activé pris en compte');
  perform nia_test.ok('K2 liste privée, gérée par les modérateurs');
end $$;
rollback;

-- ===========================================================================
-- K3. Vérification avant envoi (verdict seul)
-- ===========================================================================
do $$
declare r jsonb;
begin
  r := nia_test.exec_as('anon', null, $q$select public.nia_check_text('Bravo !', 'comment') as v,
    public.nia_check_text('quel connard', 'comment') as m, public.nia_check_text('sale noir', 'caption') as h,
    public.nia_check_text('connard_du_93', 'username') as u, public.nia_check_text('awa_dakar', 'username') as ok,
    public.nia_check_text(null, 'bio') as n$q$);
  perform nia_test.eq(r->>'ok', 'true', 'K3 appel anonyme possible (inscription)');
  perform nia_test.eq(r->'rows'->0->>'v', 'ok', 'K3 texte propre');
  perform nia_test.eq(r->'rows'->0->>'m', 'masked', 'K3 insulte → masked');
  perform nia_test.eq(r->'rows'->0->>'h', 'held', 'K3 terme retenu → held');
  perform nia_test.eq(r->'rows'->0->>'u', 'refused', 'K3 pseudo → refused');
  perform nia_test.eq(r->'rows'->0->>'ok', 'ok', 'K3 pseudo propre');
  perform nia_test.eq(r->'rows'->0->>'n', 'ok', 'K3 texte vide');
  perform nia_test.eq(position('negrophobie' in r::text), 0, 'K3 aucune catégorie révélée');
  perform nia_test.ok('K3 nia_check_text');
end $$;

-- ===========================================================================
-- K4. Commentaires
-- ===========================================================================
begin;
do $$
declare
  a uuid := nia_test.mk_user('k4_a'); b uuid := nia_test.mk_user('k4_b'); c uuid := nia_test.mk_user('k4_c');
  v uuid; cid uuid; r jsonb;
begin
  v := nia_test.mk_video(a);
  r := nia_test.dml_as('authenticated', b, format('insert into public.comments (video_id, user_id, body) values (%L, %L, ''Magnifique !'')', v, b));
  perform nia_test.eq(r->>'n', '1', 'K4 commentaire propre accepté');
  perform nia_test.eq((select count(*) from public.keyword_flags), 0::bigint, 'K4 aucune trace pour un texte propre');
  perform nia_test.age_comments();
  r := nia_test.dml_as('authenticated', b, format('insert into public.comments (video_id, user_id, body) values (%L, %L, ''T''''es un c0nnard !'')', v, b));
  perform nia_test.eq(r->>'n', '1', 'K4 insulte : publié');
  cid := (select id from public.comments where user_id = b order by created_at desc limit 1);
  perform nia_test.eq((select body || '/' || moderation_state from public.comments where id = cid), 'T''es un c****** !/visible', 'K4 insulte masquée, visible');
  perform nia_test.eq(nia_test.seen('authenticated', c, format('select id from public.comments where id = %L', cid)), 1, 'K4 insulte masquée visible par les autres');
  perform nia_test.eq((select count(*) from public.keyword_flags), 0::bigint, 'K4 masquage sans trace (minimisation)');
  perform nia_test.age_comments();
  r := nia_test.dml_as('authenticated', b, format('insert into public.comments (video_id, user_id, body) values (%L, %L, ''retourne chez toi sale noir'')', v, b));
  perform nia_test.eq(r->>'n', '1', 'K4 terme retenu : enregistré');
  cid := (select id from public.comments where user_id = b order by created_at desc limit 1);
  perform nia_test.eq((select moderation_state from public.comments where id = cid), 'held', 'K4 retenu → held');
  perform nia_test.eq(nia_test.seen('authenticated', b, format('select id from public.comments where id = %L', cid)), 1, 'K4 l''auteur le voit');
  perform nia_test.eq(nia_test.seen('authenticated', c, format('select id from public.comments where id = %L', cid)), 0, 'K4 invisible pour les autres');
  perform nia_test.eq(nia_test.seen('anon', null, format('select id from public.comments where id = %L', cid)), 0, 'K4 invisible pour les visiteurs');
  perform nia_test.eq(nia_test.seen('authenticated', a, format('select id from public.comments where id = %L', cid)), 0, 'K4 invisible pour le créateur de la vidéo');
  perform nia_test.eq((select status || '/' || category || '/' || priority || '/' || (original->>'body') from public.keyword_flags where target_id = cid),
    'open/negrophobie/3/retourne chez toi sale noir', 'K4 trace ouverte (texte d''origine)');
  perform nia_test.eq((select meta->>'code' from public.notifications where user_id = b and type = 'moderation_notice'), 'held_keywords', 'K4 notification NIA à l''auteur');
  perform nia_test.eq((select actor_id is null and body like 'Ton contenu est en cours de vérification%' from public.notifications where user_id = b and type = 'moderation_notice'),
    true, 'K4 notification signée NIA (sans acteur), texte de secours');
  -- modification d'un commentaire visible vers un terme retenu
  perform nia_test.age_comments();
  r := nia_test.dml_as('authenticated', c, format('insert into public.comments (video_id, user_id, body) values (%L, %L, ''Super'')', v, c));
  cid := (select id from public.comments where user_id = c);
  r := nia_test.dml_as('authenticated', c, format('update public.comments set body = ''espèce de tarlouze'' where id = %L', cid));
  perform nia_test.eq(r->>'n', '1', 'K4 modification acceptée');
  perform nia_test.eq((select moderation_state from public.comments where id = cid), 'held', 'K4 modification retenue → held');
  r := nia_test.dml_as('authenticated', c, format('update public.comments set body = ''Super'' where id = %L', cid));
  perform nia_test.eq((select moderation_state from public.comments where id = cid), 'held', 'K4 corriger le texte ne rétablit pas seul (décision humaine)');
  -- P0 : retenu, priorité 0, pas de notification
  perform nia_test.age_comments();
  r := nia_test.dml_as('authenticated', a, format('insert into public.comments (video_id, user_id, body) values (%L, %L, ''pthc'')', v, a));
  cid := (select id from public.comments where user_id = a);
  perform nia_test.eq((select moderation_state from public.comments where id = cid), 'held', 'K4 P0 retenu');
  perform nia_test.eq((select priority from public.keyword_flags where target_id = cid), 0::smallint, 'K4 P0 en tête de file');
  perform nia_test.eq((select count(*) from public.notifications where user_id = a and type = 'moderation_notice'), 0::bigint, 'K4 P0 : aucune notification à l''auteur');
  -- SQL Editor / service_role : non filtré (corrections manuelles)
  insert into public.comments (video_id, user_id, body) values (v, a, 'connard (SQL Editor)');
  perform nia_test.eq((select count(*) from public.comments where body = 'connard (SQL Editor)'), 1::bigint, 'K4 SQL Editor non filtré');
  perform nia_test.age_comments();
  r := nia_test.dml_as('service_role', a, format('insert into public.comments (video_id, user_id, body) values (%L, %L, ''connard (service)'')', v, a));
  perform nia_test.eq((select count(*) from public.comments where body = 'connard (service)'), 1::bigint, 'K4 service_role non filtré');
  perform nia_test.ok('K4 commentaires : masque, retenue, notification');
end $$;
rollback;

-- ===========================================================================
-- K5. Vidéos (légende, hashtags, texte alternatif, lieu)
-- ===========================================================================
begin;
do $$
declare
  a uuid := nia_test.mk_user('k5_a'); b uuid := nia_test.mk_user('k5_b'); v uuid; r jsonb;
begin
  r := nia_test.dml_as('authenticated', a, format(
    'insert into public.videos (user_id, storage_path, caption, hashtags, status) values (%L, %L, ''Ma danse, bande de connards'', array[''sabar'', ''fdp''], ''published'')',
    a, a::text || '/k5-1.mp4'));
  perform nia_test.eq(r->>'n', '1', 'K5 publication avec insultes');
  v := (select id from public.videos where storage_path = a::text || '/k5-1.mp4');
  perform nia_test.eq((select caption || '/' || array_to_string(hashtags, ',') || '/' || moderation_state from public.videos where id = v),
    'Ma danse, bande de c*******/sabar,f**/visible', 'K5 légende et hashtags masqués, vidéo visible');
  r := nia_test.dml_as('authenticated', a, format(
    'insert into public.videos (user_id, storage_path, caption, hashtags, alt_text, status) values (%L, %L, ''Soirée'', array[''sale_noir''], ''Des amis'', ''published'')',
    a, a::text || '/k5-2.mp4'));
  v := (select id from public.videos where storage_path = a::text || '/k5-2.mp4');
  perform nia_test.eq((select moderation_state || '/' || moderation_reason from public.videos where id = v), 'held/auto:keywords', 'K5 hashtag retenu → vidéo held');
  perform nia_test.eq(nia_test.seen('authenticated', a, format('select id from public.videos where id = %L', v)), 1, 'K5 l''auteur la voit');
  perform nia_test.eq(nia_test.seen('authenticated', b, format('select id from public.videos where id = %L', v)), 0, 'K5 invisible pour les autres');
  perform nia_test.eq(nia_test.seen('anon', null, format('select id from public.videos where id = %L', v)), 0, 'K5 invisible pour les visiteurs');
  perform nia_test.eq((select field || '/' || (original->'hashtags'->>0) from public.keyword_flags where target_id = v), 'hashtags/sale_noir', 'K5 trace : champ et texte d''origine');
  perform nia_test.eq((select count(*) from public.moderation_file_holds where video_id = v), 0::bigint, 'K5 fichiers laissés en place (hors P0)');
  r := nia_test.dml_as('authenticated', b, format('insert into public.comments (video_id, user_id, body) values (%L, %L, ''?'')', v, b));
  perform nia_test.eq(r->>'sqlstate', '42501', 'K5 pas de commentaire sur une vidéo retenue');
  -- légende modifiée après coup
  r := nia_test.dml_as('authenticated', a, format(
    'insert into public.videos (user_id, storage_path, caption, status) values (%L, %L, ''Propre'', ''published'')', a, a::text || '/k5-3.mp4'));
  v := (select id from public.videos where storage_path = a::text || '/k5-3.mp4');
  r := nia_test.dml_as('authenticated', a, format('update public.videos set location_text = ''Rue des gouines'' where id = %L', v));
  perform nia_test.eq((select moderation_state from public.videos where id = v), 'held', 'K5 lieu modifié retenu');
  r := nia_test.dml_as('authenticated', a, format('update public.videos set status = ''archived'' where id = %L', v));
  perform nia_test.eq(r->>'n', '1', 'K5 archiver reste possible');
  perform nia_test.eq((select count(*) from public.keyword_flags where target_id = v), 1::bigint, 'K5 une seule trace (champs inchangés non réexaminés)');
  -- P0 : fichiers mis à l'abri tout de suite
  insert into storage.objects (bucket_id, name, owner) values ('videos', a::text || '/k5-4.mp4', a);
  r := nia_test.dml_as('authenticated', a, format(
    'insert into public.videos (user_id, storage_path, caption, status) values (%L, %L, ''jailbait'', ''published'')', a, a::text || '/k5-4.mp4'));
  v := (select id from public.videos where storage_path = a::text || '/k5-4.mp4');
  perform nia_test.eq((select desired || '/' || actual || '/' || array_to_string(paths, ',') from public.moderation_file_holds where video_id = v),
    'held/public/' || a::text || '/k5-4.mp4', 'K5 P0 : fichiers en file moderation-hold');
  perform nia_test.eq((select legal_status from public.moderation_queue where id = (select id from public.keyword_flags where target_id = v)), 'to_report', 'K5 P0 : à signaler (PHAROS)');
  perform nia_test.ok('K5 vidéos : masque, retenue, P0');
end $$;
rollback;

-- ===========================================================================
-- K6. Lives (titre, description)
-- ===========================================================================
begin;
do $$
declare a uuid := nia_test.mk_user('k6_a'); b uuid := nia_test.mk_user('k6_b'); l uuid; r jsonb;
begin
  r := nia_test.dml_as('authenticated', a, format('insert into public.live_streams (user_id, title, description) values (%L, ''Live avec ce bâtard'', ''Venez'')', a));
  l := (select id from public.live_streams where user_id = a);
  perform nia_test.eq((select title || '/' || moderation_state from public.live_streams where id = l), 'Live avec ce b*****/visible', 'K6 titre masqué');
  r := nia_test.dml_as('authenticated', a, format('update public.live_streams set description = ''réservé aux blancs, pas de bougnoules'' where id = %L', l));
  perform nia_test.eq(r->>'n', '1', 'K6 description modifiée');
  perform nia_test.eq((select moderation_state from public.live_streams where id = l), 'held', 'K6 description retenue → live held');
  perform nia_test.eq(nia_test.seen('authenticated', a, format('select id from public.live_streams where id = %L', l)), 1, 'K6 l''hôte voit son live');
  perform nia_test.eq(nia_test.seen('authenticated', b, format('select id from public.live_streams where id = %L', l)), 0, 'K6 invisible pour les autres');
  perform nia_test.ok('K6 lives');
end $$;
rollback;

-- ===========================================================================
-- K7. Profils (pseudo, nom affiché, bio) et inscription
-- ===========================================================================
begin;
do $$
declare a uuid := nia_test.mk_user('k7_a'); b uuid := nia_test.mk_user('k7_b'); u uuid := gen_random_uuid(); r jsonb;
begin
  r := nia_test.dml_as('authenticated', a, format('update public.profiles set username = ''sale_negre_75'' where id = %L', a));
  perform nia_test.eq(r->>'sqlstate' || '/' || (r->>'message'), '22023/text_refused', 'K7 pseudo refusé (text_refused)');
  r := nia_test.dml_as('authenticated', a, format('update public.profiles set username = ''connard'' where id = %L', a));
  perform nia_test.eq(r->>'sqlstate', '22023', 'K7 pseudo : même une insulte est refusée');
  r := nia_test.dml_as('authenticated', a, format('update public.profiles set username = ''awa_sabar'' where id = %L', a));
  perform nia_test.eq(r->>'n', '1', 'K7 pseudo propre accepté');
  r := nia_test.dml_as('authenticated', a, format('update public.profiles set bio = ''Danseuse, pas une salope'' where id = %L', a));
  perform nia_test.eq((select bio from public.profiles where id = a), 'Danseuse, pas une s*****', 'K7 bio : insulte masquée');
  r := nia_test.dml_as('authenticated', a, format('update public.profiles set bio = ''Je déteste les pédés'', display_name = ''Awa'' where id = %L', a));
  perform nia_test.eq(r->>'n', '1', 'K7 bio retenue : pas d''erreur');
  perform nia_test.eq((select bio || '/' || display_name from public.profiles where id = a), 'Danseuse, pas une s*****/Awa',
    'K7 bio retenue : l''ancienne reste affichée, le nom propre passe');
  perform nia_test.eq((select status || '/' || pending_text from public.keyword_flags where target_id = a and field = 'bio'), 'open/Je déteste les pédés', 'K7 bio en attente');
  perform nia_test.eq((select meta->>'field' from public.notifications where user_id = a and type = 'moderation_notice'), 'bio', 'K7 notification (champ)');
  r := nia_test.dml_as('authenticated', a, format('update public.profiles set bio = ''Nouvelle bio sale noir'' where id = %L', a));
  perform nia_test.eq((select count(*) from public.keyword_flags where target_id = a and field = 'bio' and status = 'open'), 1::bigint, 'K7 une seule valeur en attente par champ');
  r := nia_test.dml_as('authenticated', a, format('update public.profiles set bio = ''Danseuse sabar'' where id = %L', a));
  perform nia_test.eq((select bio from public.profiles where id = a), 'Danseuse sabar', 'K7 nouvelle bio propre appliquée');
  perform nia_test.eq((select count(*) from public.keyword_flags where target_id = a and field = 'bio' and status = 'open'), 0::bigint, 'K7 valeur en attente remplacée');
  r := nia_test.dml_as('authenticated', b, format('update public.profiles set display_name = ''Tafiole'' where id = %L', b));
  perform nia_test.eq((select display_name is null from public.profiles where id = b), true, 'K7 nom affiché retenu (ancienne valeur vide)');
  -- inscription : pseudo remplacé, jamais d'échec
  insert into auth.users (id, email, raw_user_meta_data) values (u, 'k7_u@example.test', '{"username": "Sale_Negre"}');
  perform nia_test.eq((select username from public.profiles where id = u), 'createur_' || left(md5(u::text), 8), 'K7 inscription : pseudo remplacé');
  perform nia_test.eq((select action || '/' || status || '/' || (original->>'username') from public.keyword_flags where target_id = u),
    'refuse/logged/sale_negre', 'K7 inscription : journalisé, hors file');
  -- ensureProfileRow (app) : upsert propre inchangé
  r := nia_test.dml_as('authenticated', b, format(
    'insert into public.profiles (id, username, display_name) values (%L, ''k7_b'', ''Bineta'') on conflict (id) do update set display_name = excluded.display_name', b));
  perform nia_test.eq(r->>'n', '1', 'K7 upsert de profil propre OK');
  perform nia_test.ok('K7 profils');
end $$;
rollback;

-- ===========================================================================
-- K8. File de modération et récidive
-- ===========================================================================
begin;
do $$
declare
  a uuid := nia_test.mk_user('k8_a'); b uuid := nia_test.mk_user('k8_b'); m uuid := nia_test.mk_user('k8_m');
  v uuid; i int; r jsonb;
begin
  insert into public.moderators (user_id) values (m);
  v := nia_test.mk_video(a);
  for i in 1..3 loop
    perform nia_test.age_comments();
    r := nia_test.dml_as('authenticated', b, format('insert into public.comments (video_id, user_id, body) values (%L, %L, %L)', v, b, 'gouine n°' || i));
  end loop;
  perform nia_test.eq(nia_test.seen('authenticated', m, 'select id from public.moderation_queue where source = ''keyword_filter'''), 3, 'K8 3 contenus retenus dans moderation_queue');
  perform nia_test.eq(nia_test.seen('authenticated', b, 'select id from public.moderation_queue'), 0, 'K8 file vide pour l''auteur');
  perform nia_test.eq(nia_test.seen('authenticated', a, 'select id from public.moderation_queue'), 0, 'K8 file vide pour les autres');
  perform nia_test.eq((select count(*) from public.moderation_queue where source = 'keyword_filter' and details like '%récidive : 3%'), 3::bigint, 'K8 récidive signalée dans la file');
  perform nia_test.eq((select holds_7d from public.moderation_keyword_offenders where author_id = b), 3::bigint, 'K8 vue des récidivistes');
  perform nia_test.eq(nia_test.seen('authenticated', a, 'select author_id from public.moderation_keyword_offenders'), 0, 'K8 récidivistes : modérateurs seulement');
  perform nia_test.eq((select string_agg(attname, ',' order by attnum) from pg_attribute
                        where attrelid = 'public.moderation_queue'::regclass and attnum > 0),
    'id,priority,category,target_type,target_id,target_owner_id,target_owner_username,status,legal_status,legal_ref,auto_hidden,evidence_count,details,target_snapshot,created_at,reports_on_target,source',
    'K8 colonnes de 017 conservées, « source » ajoutée à la fin');
  perform nia_test.ok('K8 file de modération');
end $$;
rollback;

-- ===========================================================================
-- K9. Décisions des modérateurs
-- ===========================================================================
begin;
do $$
declare
  a uuid := nia_test.mk_user('k9_a'); b uuid := nia_test.mk_user('k9_b'); c uuid := nia_test.mk_user('k9_c');
  m uuid := nia_test.mk_user('k9_m'); v uuid; v2 uuid; cid uuid; f uuid; r jsonb;
begin
  insert into public.moderators (user_id) values (m);
  v := nia_test.mk_video(a);
  r := nia_test.dml_as('authenticated', b, format('insert into public.comments (video_id, user_id, body) values (%L, %L, ''La Négritude : « nègre » je le revendique'')', v, b));
  cid := (select id from public.comments where user_id = b);
  f := (select id from public.keyword_flags where target_id = cid);
  r := nia_test.exec_as('authenticated', c, format('select public.mod_resolve_keyword_flag(%L, ''approve'')', f));
  perform nia_test.eq(r->>'sqlstate', '42501', 'K9 non-modérateur refusé');
  r := nia_test.exec_as('anon', null, format('select public.mod_resolve_keyword_flag(%L, ''approve'')', f));
  perform nia_test.eq(r->>'sqlstate', '42501', 'K9 visiteur refusé');
  r := nia_test.exec_as('authenticated', m, format('select public.mod_resolve_keyword_flag(%L, ''peut-être'')', f));
  perform nia_test.eq(r->>'sqlstate', '22023', 'K9 décision inconnue refusée');
  r := nia_test.exec_as('authenticated', m, format('select public.mod_resolve_keyword_flag(%L, ''approve'', ''citation'')', f));
  perform nia_test.eq(r->>'ok', 'true', 'K9 validation par un modérateur');
  perform nia_test.eq((select moderation_state from public.comments where id = cid), 'visible', 'K9 validé → visible');
  perform nia_test.eq(nia_test.seen('authenticated', c, format('select id from public.comments where id = %L', cid)), 1, 'K9 visible pour les autres');
  perform nia_test.eq((select status || '/' || (reviewed_by = m) || '/' || review_note from public.keyword_flags where id = f), 'approved/true/citation', 'K9 trace close');
  perform nia_test.eq((select count(*) from public.notifications where user_id = b and meta->>'code' = 'approved'), 1::bigint, 'K9 notification « validé »');
  r := nia_test.exec_as('authenticated', m, format('select public.mod_resolve_keyword_flag(%L, ''reject'')', f));
  perform nia_test.eq(r->>'sqlstate', '22023', 'K9 déjà traité');
  -- refus d'une vidéo : retirée, fichiers mis à l'abri 90 jours, notification
  r := nia_test.dml_as('authenticated', a, format(
    'insert into public.videos (user_id, storage_path, caption, status) values (%L, %L, ''sale singe'', ''published'')', a, a::text || '/k9.mp4'));
  v2 := (select id from public.videos where storage_path = a::text || '/k9.mp4');
  f := (select id from public.keyword_flags where target_id = v2);
  perform public.mod_resolve_keyword_flag(f, 'reject', 'négrophobie');   -- SQL Editor (connexion directe)
  perform nia_test.eq((select moderation_state from public.videos where id = v2), 'removed', 'K9 refusé → removed');
  perform nia_test.eq((select desired || '/' || (purge_after between now() + interval '89 days' and now() + interval '91 days')
                         from public.moderation_file_holds where video_id = v2), 'held/true', 'K9 fichiers à l''abri, purge à 90 jours');
  perform nia_test.eq((select meta->>'code' || '/' || (meta->>'category') from public.notifications where user_id = a and meta->>'code' = 'removed'),
    'removed/negrophobie', 'K9 notification « retiré » (motif, contestation)');
  perform nia_test.eq((select reviewed_by is null and status = 'rejected' from public.keyword_flags where id = f), true, 'K9 SQL Editor accepté');
  -- contenu aussi signalé : la validation ne le rétablit pas
  perform nia_test.age_comments();
  r := nia_test.dml_as('authenticated', b, format('insert into public.comments (video_id, user_id, body) values (%L, %L, ''faggot'')', v, b));
  cid := (select id from public.comments where user_id = b and body = 'faggot');
  r := nia_test.dml_as('authenticated', a, format('insert into public.reports (reporter_id, target_type, target_id, category) values (%L, ''comment'', %L, ''homophobie'')', a, cid));
  perform nia_test.eq(r->>'n', '1', 'K9 signalement du commentaire retenu');
  perform public.mod_resolve_keyword_flag((select id from public.keyword_flags where target_id = cid), 'approve');
  perform nia_test.eq((select moderation_state from public.comments where id = cid), 'held', 'K9 signalement ouvert : reste masqué');
  -- profil : la valeur en attente s'applique à la validation
  r := nia_test.dml_as('authenticated', c, format('update public.profiles set bio = ''Militante contre les « sale noir » et autres insultes'' where id = %L', c));
  f := (select id from public.keyword_flags where target_id = c and field = 'bio');
  perform nia_test.eq((select bio from public.profiles where id = c) is distinct from 'Militante contre les « sale noir » et autres insultes', true, 'K9 bio en attente');
  r := nia_test.exec_as('authenticated', m, format('select public.mod_resolve_keyword_flag(%L, ''approve'')', f));
  perform nia_test.eq((select bio from public.profiles where id = c), 'Militante contre les « sale noir » et autres insultes', 'K9 bio validée appliquée');
  r := nia_test.dml_as('authenticated', c, format('update public.profiles set display_name = ''Tapette'' where id = %L', c));
  f := (select id from public.keyword_flags where target_id = c and field = 'display_name');
  r := nia_test.exec_as('authenticated', m, format('select public.mod_resolve_keyword_flag(%L, ''reject'')', f));
  perform nia_test.eq((select display_name is distinct from 'Tapette' from public.profiles where id = c), true, 'K9 nom refusé non appliqué');
  perform nia_test.eq((select status from public.keyword_flags where id = f), 'rejected', 'K9 trace refusée');
  perform nia_test.ok('K9 décisions des modérateurs');
end $$;
rollback;

-- ===========================================================================
-- K10. Chat live (table de la future migration 019, simulée)
-- ===========================================================================
begin;
do $$
declare a uuid := nia_test.mk_user('k10_a'); b uuid := nia_test.mk_user('k10_b'); l uuid; r jsonb;
begin
  create table public.live_comments (
    id uuid primary key default gen_random_uuid(),
    live_id uuid not null references public.live_streams (id) on delete cascade,
    user_id uuid not null references public.profiles (id) on delete cascade,
    body text not null,
    created_at timestamptz not null default now(),
    hidden_at timestamptz);
  alter table public.live_comments enable row level security;
  create policy lc_all on public.live_comments for all using (true) with check (auth.uid() = user_id);
  grant select, insert, update on public.live_comments to authenticated;
  perform nia_test.eq(public.nia_kw_attach_live_chat(), true, 'K10 filtre attaché au chat');
  perform nia_test.eq(public.nia_kw_attach_live_chat(), true, 'K10 rattachement idempotent');
  insert into public.live_streams (user_id, title) values (a, 'Live') returning id into l;
  r := nia_test.dml_as('authenticated', b, format('insert into public.live_comments (live_id, user_id, body) values (%L, %L, ''ntm'')', l, b));
  perform nia_test.eq((select body || '/' || (hidden_at is null) from public.live_comments where user_id = b), 'n**/true', 'K10 insulte masquée dans le chat');
  r := nia_test.dml_as('authenticated', b, format('insert into public.live_comments (live_id, user_id, body) values (%L, %L, ''sale arabe'')', l, b));
  perform nia_test.eq((select hidden_at is not null from public.live_comments where body = 'sale arabe'), true, 'K10 message retenu (hidden_at)');
  perform nia_test.eq((select count(*) from public.keyword_flags where target_type = 'live_comment'), 1::bigint, 'K10 trace du message');
  perform nia_test.eq((select count(*) from public.notifications where user_id = b and type = 'moderation_notice'), 0::bigint, 'K10 pas de notification pour le chat');
  perform public.mod_resolve_keyword_flag((select id from public.keyword_flags where target_type = 'live_comment'), 'approve');
  perform nia_test.eq((select hidden_at is null from public.live_comments where body = 'sale arabe'), true, 'K10 validé → réaffiché');
  perform nia_test.ok('K10 chat live');
end $$;
rollback;

-- ===========================================================================
-- K11. Rejouer 018 : la liste n'est ni doublée ni écrasée
-- ===========================================================================
begin;
update public.moderation_terms set enabled = true where term = 'nigga';
update public.moderation_terms set action = 'hold' where term = 'fuck';
\ir ../migrations/018_keyword_filter.sql
do $$
begin
  perform nia_test.eq((select count(*) from public.moderation_terms), 63::bigint, 'K11 liste non doublée (63 termes)');
  perform nia_test.eq((select enabled from public.moderation_terms where term = 'nigga'), true, 'K11 activation conservée');
  perform nia_test.eq((select action from public.moderation_terms where term = 'fuck'), 'hold', 'K11 action modifiée conservée');
  perform nia_test.ok('K11 rejouer 018 respecte les modifications');
end $$;
rollback;
