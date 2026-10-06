#!/usr/bin/env bash
# Trip expense ownership harness. Disposable local Postgres; no network, no
# production access.
set -euo pipefail
cd "$(dirname "$0")/../../.."
NAME=trip_expenses_harness
MIGRATION=supabase/migrations/20271007190418_trip_expense_ownership_and_approval.sql
H=supabase/tests/trip_expenses
docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" --network none -e POSTGRES_PASSWORD=harness postgres:17-alpine >/dev/null
for _ in $(seq 1 30); do
  docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 1
done
run() {
  echo "== $1"
  docker exec -i "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q -X -1 < "$1"
}
run $H/00_stub_schema.sql
run $H/05_fixtures.sql
run $MIGRATION
run $H/10_scenarios.sql
docker exec -i "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q -X -c "
  CREATE TABLE public.t_snapshot AS SELECT md5(string_agg(row_to_json(x)::text, ',' ORDER BY x.id)) AS digest FROM (
    SELECT id, expense_context, expense_status, owner_user_id, employer_org_id, approval_state, reimbursement_state, amount_inr
    FROM public.trip_expenses) x;"
run $MIGRATION
run $H/20_rerun.sql
echo "ALL TRIP EXPENSE SCENARIOS PASSED"
if [ "${KEEP:-}" != "1" ]; then docker rm -f "$NAME" >/dev/null; fi
