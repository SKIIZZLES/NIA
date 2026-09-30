# Tests SQL — suppression de compte (013 / 014)

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
