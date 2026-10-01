# Tests SQL — suppression de compte (013 / 014), 015 → 020, 022, 023

**Uniquement sur un Postgres local et jetable.** `local_stubs.sql` recrée des
doubles minimaux des schémas `auth` et `storage` de Supabase (`auth.users`,
`auth.uid()`, `storage.objects`, le trigger `storage.protect_delete`, les rôles
`anon` / `authenticated` / `service_role`). Ne jamais l'exécuter sur un projet
Supabase.

```bash
# Exemple : cluster jetable sur un socket local
initdb -D /tmp/pgscratch -U postgres --auth=trust
pg_ctl -D /tmp/pgscratch -o "-p 55432 -k /tmp -c listen_addresses=''" -l /tmp/pg.log start
PGHOST=/tmp PGPORT=55432 PGUSER=postgres supabase/tests/run_local.sh
```

`run_local.sh` refuse tout hôte non local, recrée la base
`nia_scratch_account_deletion`, puis enchaîne :

1. `local_stubs.sql`, puis les migrations 001 → 013 du dépôt ;
2. `_helpers.sql` : schéma `nia_test`, avec `exec_as(role, sub, sql)` qui imite
   PostgREST (rôle + claims JWT) et des fabriques de données ;
3. `013_regression.test.sql` : prouve que la RPC de 013 échoue (42501,
   `protect_delete`) et ne supprime rien ;
4. 014, appliquée **deux fois** (idempotence) ;
5. `014_account_deletion.test.sql` : droits, cascade, reposts, notifications,
   worker, double exécution, concurrence (`dblink`, extension contrib).

Chaque scénario tourne dans une transaction annulée. Le script s'arrête à la
première assertion fausse (`not ok - …`).

## Suite : 015, 016, 017

6. 015 puis 016 (deux fois) et `016_publish_options.test.sql` ;
7. `017_seed_before.sql` : signalements « d'avant 017 » (ancien motif en
   texte, doublon, P0, 3 signaleurs) pour tester le rattrapage ;
8. 017, appliquée **deux fois** (idempotence) ;
9. `017_safety_reports.test.sql` : garde-fous (compteurs, colonnes serveur,
   lives), limites de débit, blocage côté serveur (vidéos, commentaires,
   lives, likes, enregistrements, abonnements), notifications, signalements
   v2 (10 catégories, lives, précisions, doublons, 20/h), masquage P0 et à
   3 signaleurs, garde-fou anti-abus P0 (5 / 24 h), décisions et
   notifications (DSA 16/17), SQL Editor, suspension, preuves privées (3 ×
   20 Mo, purge 90 / 180 jours), suppression du compte du signaleur
   (signalement anonymisé), mise à l'abri des fichiers (`moderation_file_holds`),
   domaine `@users.nia.app` réservé, rattrapage ;
10. `017_verify_after_apply.sql` : toutes les lignes doivent être `t` ;
11. 014 et 016 rejoués après 017 (non-régression).

## Suite : 018 (filtre de mots)

12. 018, appliquée **deux fois** (idempotence ; la liste de départ est dans
    la migration, `on conflict do nothing`) ;
13. `018_keyword_filter.test.sql` (K1 → K11) : normalisation (accents,
    leetspeak, lettres répétées, séparateurs, homoglyphes, pluriels) et mots
    entiers (Niger, Nigeria, conseil, computer, PDG… non touchés), liste
    privée gérée par les seuls modérateurs, `nia_check_text`, commentaires
    (masque / retenue / notification), vidéos (légende, hashtags, texte
    alternatif, lieu ; P0 → fichiers à l'abri), lives, profils (pseudo refusé,
    bio / nom en attente, inscription), `moderation_queue` (colonnes de 017 +
    `source`) et récidive, décisions `mod_resolve_keyword_flag`, chat live
    (table factice), rejouer 018 sans écraser les modifications ;
14. `018_verify_after_apply.sql` (17 lignes) puis `017_verify_after_apply.sql` :
    toutes les lignes doivent être `t` ;
15. 014, 016 et 017 rejoués après 018 (non-régression).

## Suite : 019 (Live L2)

16. 019, appliquée **deux fois** (idempotence) ;
17. `019_live_l2.test.sql` (L1 → L10) : garde du cycle de vie (insertion
    forcée en `scheduled`, colonnes serveur en lecture seule, `live` réservé
    au serveur, transitions de l'app), droits des RPC (`service_role` seul),
    `live_webhook_apply` (passage en direct, idempotence, compteur, départ /
    retour de l'hôte, `room_finished`, événements tardifs), un seul live par
    créateur, live retenu jamais en direct, `live_sweep_stale` (hôte absent
    > 2 min, durée max 4 h), visibilité public / Abonnés / privé avec
    modération et blocage de 017 conservés, direct instantané avec titre
    masqué ou retenu (018), rejouer 019 sans rien changer ;
18. `019_verify_after_apply.sql` (12 lignes, lecture seule) : toutes `t` ;
19. `017_verify_after_apply.sql` et `018_verify_after_apply.sql` relancés
    après 019 (dont le contrôle 14 de 017 : la policy de lecture des lives
    garde le filtre modération + blocage), puis 014, 016, 017 et 018 rejoués.

## Suite : 022 (suppression définitive de vidéo, reposts conservés)

Jouée après 018, et après 019 si `019_live_l2.sql` est dans le dépôt (022 n'en
dépend pas ; 020 vient après, 021 est réservée).

- 022, appliquée **deux fois** (idempotence) ;
- `022_video_delete_refs.test.sql` (D1 → D12, Z1) : droits (anon et
  service_role refusés, JWT sans `sub` refusé), cas courant (réponse, cascade,
  `storage.objects` jamais touché), vidéo d'autrui = vidéo absente
  (`not_found`, aucune fuite), garde de modération, repost public conservé et
  toujours visible, **reposts invisibles à l'auteur comptés** (archivé,
  followers, private, retenu, retiré, supprimé, blocage dans les deux sens —
  avec témoin : l'ancien comptage client ne les voit pas), repost de sa
  propre vidéo, suppression de son repost, préfixe du dossier, `cover_path`,
  015 / 017 / ancien chemin inchangés, **014 inchangée** (la suppression de
  compte efface toujours les reposts des autres), triggers de 017 joués,
  concurrence (dblink : un repost ne peut pas se glisser entre le comptage et
  la suppression) ;
- `022_verify_after_apply.sql` (11 lignes, lecture seule) : toutes `t` ;
- `017_verify_after_apply.sql`, `018_verify_after_apply.sql` (et
  `019_verify_after_apply.sql` si présent) relancés après 022, puis 014, 016,
  017, 018 (et 019) rejoués.

## Suite : 020 (âge déclaré, contenus 18+)

Jouée en dernier, après 017, 018, 019 et 022 (même ordre que la prod).

- `020_seed_before.sql` : vidéo, repost, commentaire et live « d'avant 020 »,
  puis empreinte complète (jsonb de chaque ligne) de `videos`, `live_streams`,
  `profiles`, `comments`, `likes`, `saves`, `reposts`, `follows`, `reports`
  et `notifications` ;
- 020, appliquée **deux fois** (idempotence) ;
- `020_age_mature.test.sql` (G0 → G8) :
  - G0 : **aucune ligne existante modifiée** (empreinte identique, nouvelles
    colonnes exclues), contenus d'avant 020 toujours visibles des visiteurs ;
  - G1 : table privée (lecture de sa seule ligne, aucune écriture directe,
    fermée à `anon`), saisie unique, 13 ans minimum (à un jour près), bornes
    de date, rien d'enregistré en cas de refus ;
  - G2 : « Afficher les contenus 18+ » désactivé par défaut, réservé aux
    majeurs, `get_my_age_status` ;
  - G3 : marquage 18+ réservé aux majeurs (insertion et après coup),
    lecture limitée au créateur, aux modérateurs et aux majeurs ayant activé
    l'option ; cumul avec « Abonnés », blocage et masquage de 017 ;
  - G4 : commentaires, j'aime, enregistrements, pas de republication d'un
    18+, repost antérieur masqué puis revenu ;
  - G5 : `mod_set_mature` (verrou, retrait, SQL Editor), `mod_set_birth_date`
    (correction, effacement, 18+ remis à zéro si mineur) ;
  - G6 : lives 18+ avec 019 (webhook, Abonnés, masquage, fin par l'hôte) :
    un mineur ne voit pas la ligne, donc `live-token` lui répond 404 ;
  - G7 : la date part avec le compte (014) ;
  - G8 : droits et `search_path` des fonctions ;
- `020_verify_after_apply.sql` (16 lignes, lecture seule) : toutes `t` ;
- `017`, `018`, `019` et `022_verify_after_apply.sql` relancés après 020, puis
  014, 016, 017, 018, 019 et 022 rejoués.

## Suite : 023 (badge First, 100 premiers comptes)

Jouée après 020 (même ordre que la prod ; 021 reste réservée).

- `023_seed_before.sql` : comptes « d'avant 023 » dans un ordre d'inscription
  mélangé (réels, modérateur, `@example.com`, `.test`, `.localhost`, anonyme,
  sans e-mail, Snapchat `@users.nia.app`, `contest@latest.fr`), puis
  empreinte jsonb de `profiles`, `videos`, `comments`, `moderators`,
  `auth.users` ;
- 023, appliquée **deux fois** (idempotence : le rattrapage ne joue qu'au
  premier passage) ;
- `023_first_badge.test.sql` (F0 → F9) : rattrapage dans l'ordre
  d'inscription avec exclusions, aucune autre donnée modifiée, attribution
  à l'inscription (comptes techniques sans rang ni place consommée), colonne
  en lecture seule pour `authenticated` / `anon` / contexte modérateur,
  valeur fournie à l'insertion ignorée, corrections `service_role` / SQL
  Editor, contraintes 1..100 et unicité, compteur et fonctions fermés à
  l'app, plafond de 100, rang jamais réattribué après suppression de compte,
  inscription annulée sans trou, concurrence (dblink : la 2e inscription
  attend le verrou du compteur ; commit → plus de place, rollback → place
  reprise) ;
- `023_first_badge_stress.sh` : 150 inscriptions en parallèle (30 sessions
  psql) depuis un compteur à 0 → exactement 100 rangs, 1..100, sans doublon ;
- `023_verify_after_apply.sql` (11 lignes, lecture seule) : toutes `t` ;
- `017`, `018`, `019`, `020` et `022_verify_after_apply.sql` relancés après
  023, puis 014, 016, 017, 018, 019 et 022 rejoués (`020_age_mature.test.sql`
  n'est pas rejoué : son contrôle G0 compare l'empreinte prise juste avant 020).
