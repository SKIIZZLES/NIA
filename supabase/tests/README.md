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
