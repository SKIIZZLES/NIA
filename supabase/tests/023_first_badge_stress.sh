#!/usr/bin/env bash
# 023 : course réelle. 150 inscriptions en parallèle (30 sessions psql) depuis
# un compteur à 0. Attendu : exactement 100 rangs, 1..100, sans doublon.
# Postgres LOCAL jetable uniquement (appelé par run_local.sh, mêmes garde-fous).
set -euo pipefail
DB="$1"
PSQL=(psql -X -h "${PGHOST:-/tmp}" -p "${PGPORT:-5432}" -U "${PGUSER:-postgres}" -v ON_ERROR_STOP=1 -q -d "$DB")
"${PSQL[@]}" -c "create table nia_test.stress_saved as select id, first_rank from public.profiles where first_rank is not null" \
             -c "create table nia_test.stress_counter as select issued from public.nia_first_badge_counter" \
             -c "update public.profiles set first_rank = null where first_rank is not null" \
             -c "update public.nia_first_badge_counter set issued = 0"
WORKERS=30; PER=5
for w in $(seq 1 $WORKERS); do
  (
    for i in $(seq 1 $PER); do
      "${PSQL[@]}" -c "insert into auth.users (id, email) values (gen_random_uuid(), 'stress-$w-$i@gmail.com')"
    done
  ) &
done
wait
OUT="$("${PSQL[@]}" -At -c "
  select count(*) filter (where p.first_rank is not null),
         count(distinct p.first_rank),
         min(p.first_rank), max(p.first_rank),
         (select issued from public.nia_first_badge_counter),
         count(*)
    from public.profiles p join auth.users u on u.id = p.id
   where u.email like 'stress-%@gmail.com'")"
echo "course 023 (classés|distincts|min|max|compteur|inscrits) : $OUT"
[[ "$OUT" == "100|100|1|100|100|150" ]] || { echo "échec : course 023" >&2; exit 1; }
"${PSQL[@]}" -c "delete from auth.users where email like 'stress-%@gmail.com'" \
             -c "update public.profiles p set first_rank = s.first_rank from nia_test.stress_saved s where s.id = p.id" \
             -c "update public.nia_first_badge_counter set issued = (select issued from nia_test.stress_counter)" \
             -c "drop table nia_test.stress_saved, nia_test.stress_counter"
echo "--- 023 course parallèle ok (150 inscriptions, 100 rangs uniques)"
