#!/usr/bin/env bash
# Network pool suite against the restored real schema on the Gate 1A TEST
# project only. One implicit transaction (a single multi-statement query) that
# loads Gate 1A and 20271007091500, runs the suite and ends in a deliberate
# HARNESS_COMPLETE error, so nothing is ever committed.
# Usage: WORKTREE=/path/linked/to/test bash supabase/tests/network_pools/run_real.sh
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
OUT=${OUT:-/tmp/np_real_harness.sql}
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
  # NETWORK_SQL overrides the migration under test (mutation runs).
  cat "${NETWORK_SQL:-$REPO/supabase/migrations/20271007091500_network_pool_manifests.sql}"
  cat "$PM/05_helpers.sql" "$PM/06_fixtures_real.sql" "$HERE/30_network_pools.sql"
  cat <<'SQL'
DO $$
BEGIN
  RAISE EXCEPTION E'HARNESS_COMPLETE: ALL % NETWORK POOL CHECKS PASSED (transaction rolled back)\n%',
    (SELECT count(*) FROM t_log), (SELECT string_agg('PASS: ' || label, E'\n' ORDER BY n) FROM t_log);
END $$;
SQL
} > "$OUT"
cd "$WORKTREE"
supabase db query --linked -f "$OUT" -o table
