# Tests SQL — suppression de compte (013 / 014), 015 → 018, 022

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

## Suite : 022 (suppression définitive de vidéo, reposts conservés)

Jouée après 018, et après 019 si `019_live_l2.sql` est dans le dépôt (022 n'en
dépend pas ; 020 et 021 sont réservées).

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
