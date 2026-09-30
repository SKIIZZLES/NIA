#!/usr/bin/env bash
# Exécute les tests SQL (suppression de compte, 016, 017) sur un Postgres LOCAL jetable.
#
#   PGHOST=/tmp PGPORT=55432 PGUSER=postgres supabase/tests/run_local.sh
#
# Garde-fous : refuse tout hôte distant (seuls un socket Unix local ou
# localhost/127.0.0.1 sont acceptés) et travaille dans une base dédiée
# `nia_scratch_account_deletion`, recréée à chaque exécution.
# NE JAMAIS pointer ce script vers Supabase : local_stubs.sql recrée des
# doubles des schémas auth et storage.
set -euo pipefail

HOST="${PGHOST:-/tmp}"
case "$HOST" in
  /*|localhost|127.0.0.1|::1) ;;
  *) echo "Refus : PGHOST=$HOST n'est pas local." >&2; exit 2 ;;
esac
if [[ "${PGHOST:-}" == *supabase* ]] || [[ "${DATABASE_URL:-}" == *supabase* ]]; then
  echo "Refus : cible Supabase détectée." >&2; exit 2
fi

DB=nia_scratch_account_deletion
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PSQL=(psql -X -h "$HOST" -p "${PGPORT:-5432}" -U "${PGUSER:-postgres}" -v ON_ERROR_STOP=1 -q)

"${PSQL[@]}" -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null
run() { echo "--- $1"; "${PSQL[@]}" -d "$DB" -f "$1" 2>&1 | { grep -vE 'NOTICE:  (policy|trigger|constraint|relation|extension) .*(does not exist|already exists), skipping' || true; }; return "${PIPESTATUS[0]}"; }

run "$ROOT/supabase/tests/local_stubs.sql"
for f in "$ROOT"/supabase/migrations/0{01,02,03,04,05,06,07,08,09,10,11,12,13}_*.sql; do
  "${PSQL[@]}" -d "$DB" -f "$f" >/dev/null 2>&1 || { echo "échec : $f" >&2; "${PSQL[@]}" -d "$DB" -f "$f"; exit 1; }
done
echo "--- 001–013 appliquées"
run "$ROOT/supabase/tests/_helpers.sql"
run "$ROOT/supabase/tests/013_regression.test.sql"
run "$ROOT/supabase/migrations/014_account_deletion.sql"
run "$ROOT/supabase/migrations/014_account_deletion.sql"   # idempotence : 2e passage
echo "--- 014 appliquée deux fois"
run "$ROOT/supabase/tests/014_account_deletion.test.sql"
run "$ROOT/supabase/migrations/015_video_soft_delete.sql"
run "$ROOT/supabase/migrations/016_publish_options.sql"
run "$ROOT/supabase/migrations/016_publish_options.sql"   # idempotence : 2e passage
echo "--- 015 puis 016 (deux fois) appliquées"
run "$ROOT/supabase/tests/016_publish_options.test.sql"
run "$ROOT/supabase/tests/017_seed_before.sql"
run "$ROOT/supabase/migrations/017_safety_reports.sql"
run "$ROOT/supabase/migrations/017_safety_reports.sql"   # idempotence : 2e passage
echo "--- 017 appliquée deux fois"
run "$ROOT/supabase/tests/017_safety_reports.test.sql"
echo "--- 017_verify_after_apply.sql"
VERIFY="$("${PSQL[@]}" -d "$DB" -At -F '|' -f "$ROOT/supabase/tests/017_verify_after_apply.sql")"
echo "$VERIFY"
if grep -qv '|t$' <<<"$VERIFY"; then echo "échec : une ligne de vérification n'est pas ok" >&2; exit 1; fi
# Les tests 014 / 016 doivent toujours passer une fois 017 en place.
run "$ROOT/supabase/tests/_helpers.sql"
run "$ROOT/supabase/tests/014_account_deletion.test.sql"
run "$ROOT/supabase/tests/016_publish_options.test.sql"
echo "--- 014 et 016 rejoués après 017"
"${PSQL[@]}" -d postgres -c "drop database $DB" >/dev/null
echo "=== TOUS LES TESTS SQL PASSENT ==="
