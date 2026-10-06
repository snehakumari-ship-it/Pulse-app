#!/usr/bin/env bash
# Pooled Marketplace backend regression suite on a disposable local Postgres.
# No network (--network none), no Supabase project, no production access.
# Usage: bash supabase/tests/pooled_marketplace/run.sh   (KEEP=1 keeps the container)
set -euo pipefail
cd "$(dirname "$0")/../../.."
NAME=pooled_marketplace_harness
IMAGE=${IMAGE:-postgres:17-alpine}
docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" --network none -e POSTGRES_PASSWORD=harness "$IMAGE" >/dev/null
for _ in $(seq 1 30); do
  docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 1
done
sleep 1
run() {
  echo "== $1"
  docker exec -i "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q -X < "$1"
}
run supabase/tests/pooled_marketplace/00_stub_schema.sql
run supabase/migrations/20270923135205_market_indents_show_open_loads_for_new_friends.sql
run supabase/migrations/20271006181500_pooled_marketplace_manifests_and_sponsored_classifier.sql
run supabase/migrations/20271006182000_submit_market_bid_indent_checks.sql
run supabase/migrations/20271006182500_submit_network_quote_rpc.sql
if [ "${WITH_PERF:-1}" = "1" ]; then
  run supabase/migrations/20271006183000_pooled_marketplace_pool_rows_inline_predicates.sql
fi
run supabase/tests/pooled_marketplace/05_helpers.sql
run supabase/tests/pooled_marketplace/06_fixtures_stub.sql
run supabase/tests/pooled_marketplace/10_scenarios.sql
run supabase/tests/pooled_marketplace/15_pool_rows_parity.sql
if [ "${WITH_PERF:-1}" = "1" ]; then run supabase/tests/pooled_marketplace/16_pool_rows_inlined.sql; fi
run supabase/tests/pooled_marketplace/99_done.sql
if [ "${KEEP:-}" != "1" ]; then docker rm -f "$NAME" >/dev/null; fi
