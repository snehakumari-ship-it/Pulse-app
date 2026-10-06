#!/usr/bin/env bash
# Pooled Marketplace suite against the restored real schema on the Gate 1A
# TEST project only. Everything runs as one implicit transaction (a single
# multi-statement query) that ends in a deliberate HARNESS_COMPLETE error, so
# no fixture, Gate 1A body or helper is ever committed.
# Usage: WORKTREE=/path/linked/to/test bash supabase/tests/pooled_marketplace/run_real.sh
set -euo pipefail
TEST_REF=kfaqqunuxgpdhboijdsl
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
WORKTREE=${WORKTREE:?set WORKTREE to a checkout linked to $TEST_REF}
ref="$(cat "$WORKTREE/supabase/.temp/project-ref")"
if [ "$ref" != "$TEST_REF" ]; then
  echo "refusing: $WORKTREE is linked to $ref, not $TEST_REF" >&2
  exit 1
fi
OUT=${OUT:-/tmp/pm_real_harness.sql}
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
  cat "$REPO/supabase/migrations/20271005200741_gate1a_award_lock_order_and_commercial_integrity_guards.sql"
  # LOAD_PERF=1 loads 20271006183000 in-transaction (for a project without it).
  if [ "${LOAD_PERF:-0}" = "1" ]; then
    cat "$REPO/supabase/migrations/20271006183000_pooled_marketplace_pool_rows_inline_predicates.sql"
  fi
  cat "$HERE/05_helpers.sql" "$HERE/06_fixtures_real.sql" "$HERE/10_scenarios.sql" \
    "$HERE/15_pool_rows_parity.sql"
  cat "$HERE/16_pool_rows_inlined.sql"
  cat "$HERE/99_done.sql"
} > "$OUT"
cd "$WORKTREE"
supabase db query --linked -f "$OUT" -o table
