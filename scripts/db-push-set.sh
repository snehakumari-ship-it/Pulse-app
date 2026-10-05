#!/usr/bin/env bash
# Apply one named release set to the linked database via an ephemeral snapshot.
#
# The snapshot contains migrations already on Remote, plus the allowlisted
# Local-only files. Deferred and frozen files stay in supabase/migrations and
# are not copied, executed, or marked applied.
#
# Usage:
#   npm run db:push-set -- v1.0.1 --dry-run
#   MIGRATION_APPLY_CONFIRM=v1.0.1 npm run db:push-set -- v1.0.1
#
# Without --dry-run this applies SQL on the linked database. Apply stays
# behind MIGRATION_APPLY_CONFIRM so a dry-run command cannot be reused as an apply.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# shellcheck source=lib/migration-release-set.sh
source "$ROOT/scripts/lib/migration-release-set.sh"

usage() {
  echo "Usage: npm run db:push-set -- <set-name> [--dry-run]" >&2
  exit 2
}

set_name=""
mode="apply"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) mode="dry-run" ;;
    --prepare-only) mode="prepare" ;;
    -h|--help) usage ;;
    --*) echo "Unknown flag: $1" >&2; usage ;;
    *)
      if [[ -n "$set_name" ]]; then
        echo "Unexpected argument: $1" >&2
        usage
      fi
      set_name="$1"
      ;;
  esac
  shift
done

[[ -n "$set_name" ]] || usage
if [[ ! "$set_name" =~ ^[A-Za-z0-9._-]+$ ]] || [[ "$set_name" == "FROZEN" ]]; then
  echo "ERROR: invalid release set name: $set_name" >&2
  exit 2
fi

SETS="$ROOT/supabase/release-sets"
allowlist="$SETS/${set_name}.versions"
frozen="$SETS/FROZEN.versions"
[[ -f "$allowlist" ]] || { echo "ERROR: missing $allowlist" >&2; exit 1; }
[[ -f "$frozen" ]] || { echo "ERROR: missing $frozen" >&2; exit 1; }

echo "── Linked migration list (canonical tree) ──"
list_out="$(supabase migration list --linked 2>&1)" || {
  printf '%s\n' "$list_out" >&2
  echo "ERROR: could not list linked migrations." >&2
  exit 1
}
printf '%s\n' "$list_out"
echo

work="$(mktemp -d "${TMPDIR:-/tmp}/pulse-db-push-set.XXXXXX")"
keep_snapshot=0
cleanup() {
  if [[ "$keep_snapshot" -eq 0 ]]; then
    rm -rf "$work"
  else
    echo "SNAPSHOT_ROOT $work/apply-root"
  fi
}
trap cleanup EXIT

printf '%s\n' "$list_out" >"$work/list.txt"
apply_root="$work/apply-root"
build_release_snapshot "$ROOT" "$work/list.txt" "$allowlist" "$frozen" "$apply_root"

echo "── Snapshot Local-only files ──"
cat "$apply_root/snapshot-local-only.txt"
echo
echo "── Frozen versions excluded from snapshot ──"
while IFS= read -r ver; do
  [[ -n "$ver" ]] || continue
  if find "$apply_root/supabase/migrations" -maxdepth 1 -type f -name "${ver}_*.sql" | grep -q .; then
    echo "ERROR: frozen version $ver is present in the snapshot" >&2
    exit 1
  fi
  echo "EXCLUDED $ver"
done < <(read_version_file "$frozen")
echo

if [[ "$mode" == "prepare" ]]; then
  keep_snapshot=1
  echo "Prepare only. No migration list against the snapshot and no db push."
  exit 0
fi

echo "── Snapshot migration list ──"
snap_list="$(supabase --workdir "$apply_root" migration list --linked 2>&1)" || {
  printf '%s\n' "$snap_list" >&2
  echo "ERROR: could not list migrations for the snapshot." >&2
  exit 1
}
printf '%s\n' "$snap_list"
echo

parse_migration_list "$work/snap_remote" "$work/snap_local_only" <<<"$snap_list"
sort -o "$work/snap_local_only" "$work/snap_local_only"
read_version_file "$allowlist" | sort >"$work/allow_sorted"
if ! cmp -s "$work/allow_sorted" "$work/snap_local_only"; then
  echo "ERROR: snapshot linked list Local-only versions do not match $set_name" >&2
  echo "expected:" >&2
  cat "$work/allow_sorted" >&2
  echo "snapshot list:" >&2
  cat "$work/snap_local_only" >&2
  exit 1
fi

echo "Snapshot linked Local-only versions match $set_name."
echo

echo "── Dry-run ──"
dry_out="$(supabase --workdir "$apply_root" db push --linked --include-all --dry-run --yes 2>&1)" || dry_rc=$?
dry_rc="${dry_rc:-0}"
printf '%s\n' "$dry_out"
echo

while IFS= read -r ver; do
  [[ -n "$ver" ]] || continue
  if printf '%s\n' "$dry_out" | grep -q "$ver"; then
    echo "ERROR: dry-run output mentions excluded version $ver" >&2
    exit 1
  fi
done < <(read_version_file "$frozen")

while IFS= read -r ver; do
  [[ -n "$ver" ]] || continue
  if ! printf '%s\n' "$dry_out" | grep -q "$ver"; then
    echo "ERROR: dry-run output does not mention allowlisted version $ver" >&2
    exit 1
  fi
done < <(read_version_file "$allowlist")

if [[ "$dry_rc" -ne 0 ]]; then
  echo "ERROR: dry-run failed (exit $dry_rc)." >&2
  exit "$dry_rc"
fi

if [[ "$mode" == "dry-run" ]]; then
  echo "Dry-run only. No migration was applied."
  exit 0
fi

if [[ "${MIGRATION_APPLY_CONFIRM:-}" != "$set_name" ]]; then
  echo "ERROR: refusing to apply set $set_name." >&2
  echo "Dry-run passed. Apply only with MIGRATION_APPLY_CONFIRM=$set_name after a separate authorization." >&2
  exit 1
fi

echo "── Apply set $set_name ──"
supabase --workdir "$apply_root" db push --linked --include-all --yes
