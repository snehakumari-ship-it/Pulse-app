#!/usr/bin/env bash
# direct_quotes hardening suite against the restored real schema on the Gate 1A
# TEST project only. One implicit transaction (a single multi-statement query)
# that loads the production Gate 1A bodies, 20271007091500, 20271007093000,
# 20271007094500 and 20271007114500, runs the suite and ends in a deliberate HARNESS_COMPLETE error, so nothing is
# ever committed.
# Usage: WORKTREE=/path/linked/to/test bash supabase/tests/direct_quotes_hardening/run_real.sh
set -euo pipefail
TEST_REF=kfaqqunuxgpdhboijdsl
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
PM="$REPO/supabase/tests/pooled_marketplace"
WORKTREE=${WORKTREE:?set WORKTREE to a checkout linked to $TEST_REF}
ref="$(cat "$WORKTREE/supabase/.temp/project-ref")"
if [ "$ref" != "$TEST_REF" ]; then
  echo "refusing: $WORKTREE is linked to $ref, not $TEST_REF" >&2
  exit 1
fi
GATE1A_SQL=${GATE1A_SQL:-$REPO/supabase/migrations/20271005200741_gate1a_award_lock_order_and_commercial_integrity_guards.sql}
if [ ! -f "$GATE1A_SQL" ]; then
  echo "missing Gate 1A migration; set GATE1A_SQL to 20271005200741_gate1a_award_lock_order_and_commercial_integrity_guards.sql" >&2
  exit 1
fi
OUT=${OUT:-/tmp/dq_real_harness.sql}
{
  cat <<'SQL'
SET LOCAL pm_harness.single_txn = 'on';
DO $$
BEGIN
  IF current_setting('pm_harness.single_txn', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'GUARD: statements are not running in one transaction';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_indents_guard_commercial_winner') THEN
    RAISE EXCEPTION 'GUARD: Gate 1A already live here; this is not the rollback-state test project';
  END IF;
END $$;
SQL
  cat "$GATE1A_SQL"
  cat "$REPO/supabase/migrations/20271007091500_network_pool_manifests.sql"
  # HARDENING_SQL overrides the migration under test (mutation runs).
  cat "${HARDENING_SQL:-$REPO/supabase/migrations/20271007093000_direct_quotes_backend_hardening.sql}"
  cat <<'SQL'
CREATE TABLE t_dq_md5 AS
SELECT 'create_trip'::text AS k, md5(prosrc) AS v
FROM pg_proc WHERE oid = 'public.create_trip_from_direct_quote(uuid,text)'::regprocedure;
SQL
  # FLEET_SQL overrides the fleet trust-boundary migration (mutation runs).
  cat "${FLEET_SQL:-$REPO/supabase/migrations/20271007094500_direct_quotes_fleet_belongs_to_bidder.sql}"
  cat "${COUNTER_SQL:-$REPO/supabase/migrations/20271007114500_accept_direct_quote_counter.sql}"
  cat "$PM/05_helpers.sql" "$PM/06_fixtures_real.sql" "$HERE/30_direct_quotes_hardening.sql" \
    "$HERE/40_fleet_belongs_to_bidder.sql" "$HERE/50_accept_direct_quote_counter.sql"
  cat <<'SQL'
DO $$
BEGIN
  RAISE EXCEPTION E'HARNESS_COMPLETE: ALL % DIRECT_QUOTES HARDENING CHECKS PASSED (transaction rolled back)\n%',
    (SELECT count(*) FROM t_log), (SELECT string_agg('PASS: ' || label, E'\n' ORDER BY n) FROM t_log);
END $$;
SQL
} > "$OUT"
cd "$WORKTREE"
supabase db query --linked -f "$OUT" -o table
