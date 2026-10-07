#!/usr/bin/env bash
# Network pool volume timings/plans on the Gate 1A TEST project only. One
# implicit transaction ending in a deliberate NPX_RESULTS error; nothing commits.
# Usage: WORKTREE=/path/linked/to/test [NPX_TARGET=10000] [NPX_PLANS=on] \
#          bash supabase/tests/network_pools/run_explain.sh
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
OUT=${OUT:-/tmp/np_explain.sql}
{
  echo "SET LOCAL statement_timeout = '110s';"
  echo "SET LOCAL npx.target = '${NPX_TARGET:-1200}';"
  echo "SET LOCAL npx.plans = '${NPX_PLANS:-off}';"
  echo "SET LOCAL npx.variants = '${NPX_VARIANTS:-off}';"
  cat "${NETWORK_SQL:-$REPO/supabase/migrations/20271007091500_network_pool_manifests.sql}"
  cat "$HERE/40_explain_volume.sql"
} > "$OUT"
cd "$WORKTREE"
supabase db query --linked -f "$OUT" -o table
