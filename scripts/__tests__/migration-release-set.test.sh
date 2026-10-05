#!/usr/bin/env bash
# Unit tests for release-set snapshot construction. No network. No db push.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=../lib/migration-release-set.sh
source "$ROOT/scripts/lib/migration-release-set.sh"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_eq() {
  local got="$1"
  local want="$2"
  local label="$3"
  [[ "$got" == "$want" ]] || fail "$label: got [$got] want [$want]"
}

tmp="$(mktemp -d "${TMPDIR:-/tmp}/pulse-release-set-test.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT

repo="$tmp/repo"
mkdir -p "$repo/supabase/migrations" "$repo/supabase/release-sets" "$repo/supabase/.temp"
printf '%s\n' 'project_id = "pulse"' >"$repo/supabase/config.toml"
printf '%s\n' 'test-ref' >"$repo/supabase/.temp/project-ref"

printf '%s\n' 'select 1;' >"$repo/supabase/migrations/20270101010101_already_remote.sql"
printf '%s\n' 'select 2;' >"$repo/supabase/migrations/20270913091000_driver_commerce_origin_read_boundary.sql"
printf '%s\n' 'select 3;' >"$repo/supabase/migrations/20260928122336_vendor_onboarding_pack.sql"
printf '%s\n' 'select 4;' >"$repo/supabase/migrations/20271005120000_dco_operating_model_boundary.sql"
printf '%s\n' 'select 5;' >"$repo/supabase/migrations/20271005130000_dco_single_owner_operator_concept.sql"

printf '%s\n' '20271005120000' '20271005130000' >"$repo/supabase/release-sets/FROZEN.versions"
printf '%s\n' '20270913091000' >"$repo/supabase/release-sets/v1.0.1.versions"

cat >"$tmp/list.txt" <<'EOF'
Connecting to remote database...

Local          | Remote         | Time (UTC)
----------------|----------------|---------------------
20270101010101 | 20270101010101 | 2027-01-01 01:01:01
20260928122336 |                | 2026-09-28 12:23:36
20270913091000 |                | 2027-09-13 09:10:00
20271005120000 |                | 2027-10-05 12:00:00
20271005130000 |                | 2027-10-05 13:00:00
EOF

dest="$tmp/snap"
build_release_snapshot "$repo" "$tmp/list.txt" \
  "$repo/supabase/release-sets/v1.0.1.versions" \
  "$repo/supabase/release-sets/FROZEN.versions" \
  "$dest"

local_only="$(cat "$dest/snapshot-local-only.txt")"
assert_eq "$local_only" "20270913091000_driver_commerce_origin_read_boundary.sql" "snapshot local-only"

[[ -f "$dest/supabase/migrations/20270101010101_already_remote.sql" ]] || fail "remote file missing from snapshot"
[[ -f "$dest/supabase/migrations/20270913091000_driver_commerce_origin_read_boundary.sql" ]] || fail "commerce file missing"
[[ ! -f "$dest/supabase/migrations/20260928122336_vendor_onboarding_pack.sql" ]] || fail "deferred file was copied"
[[ ! -f "$dest/supabase/migrations/20271005120000_dco_operating_model_boundary.sql" ]] || fail "frozen DCO boundary was copied"
[[ ! -f "$dest/supabase/migrations/20271005130000_dco_single_owner_operator_concept.sql" ]] || fail "frozen DCO concept was copied"
[[ -f "$dest/supabase/config.toml" ]] || fail "config missing"
[[ "$(cat "$dest/supabase/.temp/project-ref")" == "test-ref" ]] || fail "link metadata missing"

count="$(find "$dest/supabase/migrations" -maxdepth 1 -type f -name '*.sql' | wc -l | tr -d ' ')"
assert_eq "$count" "2" "snapshot migration count"

# Remote history with no local file gets a snapshot-only comment stand-in.
# It must not become a Local-only migration and must not be written into the repo.
cat >"$tmp/list-with-remote-gap.txt" <<'EOF'
Local          | Remote         | Time (UTC)
----------------|----------------|---------------------
20270101010101 | 20270101010101 | 2027-01-01 01:01:01
               | 20260929141531 | 2026-09-29 14:15:31
20260928122336 |                | 2026-09-28 12:23:36
20270913091000 |                | 2027-09-13 09:10:00
20271005120000 |                | 2027-10-05 12:00:00
20271005130000 |                | 2027-10-05 13:00:00
EOF
gap="$tmp/snap-gap"
build_release_snapshot "$repo" "$tmp/list-with-remote-gap.txt" \
  "$repo/supabase/release-sets/v1.0.1.versions" \
  "$repo/supabase/release-sets/FROZEN.versions" \
  "$gap"
gap_only="$(cat "$gap/snapshot-local-only.txt")"
assert_eq "$gap_only" "20270913091000_driver_commerce_origin_read_boundary.sql" "gap snapshot local-only"
[[ -f "$gap/supabase/migrations/20260929141531_remote_history_placeholder.sql" ]] || fail "remote placeholder missing"
grep -q "Already recorded" "$gap/supabase/migrations/20260929141531_remote_history_placeholder.sql" || fail "placeholder is empty or unmarked"
[[ ! -f "$repo/supabase/migrations/20260929141531_remote_history_placeholder.sql" ]] || fail "placeholder leaked into the repo"
[[ ! -f "$gap/supabase/migrations/20260928122336_vendor_onboarding_pack.sql" ]] || fail "deferred copied in gap snapshot"
[[ ! -f "$gap/supabase/migrations/20271005120000_dco_operating_model_boundary.sql" ]] || fail "frozen copied in gap snapshot"

# Frozen version named by a set is rejected.
printf '%s\n' '20271005120000' >"$tmp/bad.versions"
if build_release_snapshot "$repo" "$tmp/list.txt" "$tmp/bad.versions" \
  "$repo/supabase/release-sets/FROZEN.versions" "$tmp/bad-snap" 2>"$tmp/bad.err"; then
  fail "frozen allowlist was accepted"
fi
grep -q "frozen version" "$tmp/bad.err" || fail "missing frozen rejection message"

# Already-remote version is not a Local-only introduction.
printf '%s\n' '20270101010101' >"$tmp/applied.versions"
if build_release_snapshot "$repo" "$tmp/list.txt" "$tmp/applied.versions" \
  "$repo/supabase/release-sets/FROZEN.versions" "$tmp/applied-snap" 2>"$tmp/applied.err"; then
  fail "already-remote allowlist was accepted"
fi
grep -q "not Local-only" "$tmp/applied.err" || fail "missing not-local-only message"

# Default push gate: frozen + deferred + one approved version.
printf '%s\n' \
  '20260928122336' \
  '20270913091000' \
  '20271005120000' \
  '20271005130000' >"$tmp/pending.txt"
if reason="$(default_push_block_reason "$tmp/pending.txt" "$repo/supabase/release-sets" 2>"$tmp/gate.err")"; then
  fail "default push was allowed for a mixed queue: $reason"
fi
printf '%s\n' "$reason" | grep -q "frozen pending version 20271005120000" || fail "gate missed frozen boundary"
printf '%s\n' "$reason" | grep -q "frozen pending version 20271005130000" || fail "gate missed frozen concept"
printf '%s\n' "$reason" | grep -q "unapproved pending version 20260928122336" || fail "gate missed deferred vendor"
printf '%s\n' "$reason" | grep -q "20270913091000" && fail "gate treated commerce as blocked"

# Commerce alone is in the release set, so the default gate allows it.
printf '%s\n' '20270913091000' >"$tmp/commerce-only.txt"
if ! reason="$(default_push_block_reason "$tmp/commerce-only.txt" "$repo/supabase/release-sets")"; then
  fail "commerce-only pending was blocked: $reason"
fi

# Real repository release files.
repo_allow="$(read_version_file "$ROOT/supabase/release-sets/v1.0.1.versions")"
assert_eq "$repo_allow" "20270913091000" "repo v1.0.1 set"
repo_frozen="$(read_version_file "$ROOT/supabase/release-sets/FROZEN.versions" | sort | tr '\n' ' ' | sed 's/ $//')"
assert_eq "$repo_frozen" "20271005120000 20271005130000" "repo frozen set"
[[ -f "$ROOT/supabase/migrations/20270913091000_driver_commerce_origin_read_boundary.sql" ]] || fail "commerce migration missing"
[[ -f "$ROOT/supabase/migrations/20271005120000_dco_operating_model_boundary.sql" ]] || fail "frozen boundary file missing from tree"
[[ -f "$ROOT/supabase/migrations/20271005130000_dco_single_owner_operator_concept.sql" ]] || fail "frozen concept file missing from tree"

echo "migration-release-set tests passed"
