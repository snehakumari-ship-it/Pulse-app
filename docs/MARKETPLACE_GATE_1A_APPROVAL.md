# Marketplace Gate 1A — Approval Package

**Status:** Technically passed. Migration frozen. Validated on the dedicated test project `kfaqqunuxgpdhboijdsl` (see *Test environment / Gate 1A validation evidence*). **Applied to production (`nafxpivddesgsrthmosv`) on 2026-10-06 and verified (see *Production deployment*). Not applied to preprod. Production is frozen after this deployment.**

Gate 1A enforces one commercial winner per indent before pooled Marketplace bidding is built on top of it. It contains five controls (C1–C5) in a single migration and nothing else: no pool tables, no new schema, no data changes.

## Frozen artifact

| | |
|---|---|
| File | `supabase/migrations/20271005200741_gate1a_award_lock_order_and_commercial_integrity_guards.sql` |
| Lines | 588 |
| SHA-256 | `75a06a928f58e7d256e7f055872640cbd9783133da685a5f7f06317cb2afa933` |
| Version ordering | Sorts after remote max `20271005164900` and every local file; no collision; not a `000000` timestamp |
| Release set | `supabase/release-sets/gate-1a.versions` → `20271005200741` only. Preflight classifies it `THIS-SET gate-1a`; `db:push-set -- gate-1a --dry-run` would push only this file, with frozen `20271005130000` excluded |

Any change to the file after this point invalidates the evidence below and requires re-running it.

## Controls

| Control | Object | Change |
|---|---|---|
| C1 | `award_market_bid(uuid)` | Locks the indent before the bid (was bid-first); re-checks the bid still belongs to that indent |
| C2 | `reject_quote_accept_on_inactive_indent()` | On accept: locks the indent; requires load-owner staff; indent must be open/broadcast; no accepted market bid; no different assigned supplier |
| C3 | `award_indent_to_trip(...)` | `FOR UPDATE` on the indent; refuses when a market bid is accepted (fee gate) or the requested supplier differs from the assigned one |
| C4 | new `tg_indents_guard_commercial_winner()` + `BEFORE UPDATE OF status, assigned_supplier_id` trigger | While a winner exists (accepted bid, accepted quote, or active trip): no supplier change except to the winner, no reopen |
| C5 | `batch_award_indents_to_trips(uuid)` | Skips indents with an accepted market bid |

The machine diff against the production function bodies shows only these changes. Grants on the replaced functions are unchanged.

## Evidence summary

All runs used a disposable container restored from the production schema dump (`supabase db dump --linked`, 0 restore errors). Production was only read.

- **Baseline reproduces the defects.** On the unpatched schema, a market award racing a quote accept left one indent with an accepted Carrier A bid *and* an accepted Carrier B quote, with the supplier overwritten to B. A direct indents UPDATE overwrote the supplier while A's fee was due.
- **Concurrency A–F, both orderings:** at most one winner, no supplier overwrite, no fee bypass, no trip for a different winner in every run. The losing session always waited on the indent lock and rolled back cleanly.
- **Regression matrix:** 35/35 pass with the migration; 26/35 on baseline, where the 9 failures are exactly the holes Gate 1A closes. All lifecycle paths (org and DCO award, fee snapshot and status, superseding, revoke → re-award, org and DCO trip conversion) behave identically before and after.
- **Legacy accepted-quote rows** (completed, supplier NULL, existing trip): unchanged for read, cancel, filling in the winning supplier, non-commercial edits, revoke, and trip conversion. Newly blocked, as intended: reopening and setting a non-winner supplier.
- **C4 cost:** all three winner lookups use existing `indent_id` indexes in production (≤1.3 ms, no sequential scans). UPDATE overhead with the trigger is within measurement noise. No index is needed.
- **Service-role acceptance:** no legitimate path accepts a quote without a signed-in user. No edge function or cron job writes `direct_quotes`.

## Known transient: Scenario H (`40P01`)

`create_market_trip_after_fee_payment` locks the bid and then the indent. After C1, `award_market_bid` locks the indent and then the bid. When both run at once on the **same already-accepted DCO bid** (the award call is a no-op retry), Postgres detects a deadlock and aborts one of them with SQLSTATE `40P01`. Observed result: trip created, fee paid, one trip, no partial commercial state.

- This is an expected transient, not a correctness failure. No double winner, fee bypass, or inconsistent supplier can result.
- It cannot involve the fee webhook path: `confirm_marketplace_fee_payment` and both cash-settlement functions lock only the bid.
- **Decision:** no automatic retry at the DB layer, and no change to C1 or the fee/trip path in this gate. A caller that receives `40P01` may simply retry the user action.

## Housekeeping done

- `supabase/tests/marketplace_visibility_predicate.sql` now accepts the quote as the shipper user instead of relying on bidder self-accept. Verified on the migrated disposable DB through section 5 and the late-bid check; the original file fails there with `unauthorized`. Sections 6–7 need `reach_plans` seed data the schema-only container did not have and are untouched by the change.
- Disposable container removed. Temporary C4 EXPLAIN scripts removed.

## Not part of Gate 1A

- `batch_award_indents_to_trips` already fails in production (`column tc.pickup_lat does not exist`). C5 is inert until that is fixed separately.
- After `award_indent_to_trip`, `assigned_supplier_id` stays NULL (existing behavior). C4 then blocks setting a supplier later; no current caller does this.

## Test environment / Gate 1A validation evidence

**Result: PASS — 35/35 matrix, 14/14 races, Scenario H accepted as a documented environment/timing deviation, visibility predicate 21/21.**
**Production status: APPLIED 2026-10-06 (see *Production deployment*).**

Validated on 2026-10-06 against a dedicated, disposable Supabase project. Production (`nafxpivddesgsrthmosv`) and preprod (`mhedvagyuplkbrfaoctl`) were not changed; preprod was not accessed. The main checkout stayed linked to production and the test run used a separate worktree (`Pulse-app-gate1a-test`) linked to the test project. The migration applied was the frozen file, SHA-256 `75a06a928f58e7d256e7f055872640cbd9783133da685a5f7f06317cb2afa933`.

### Environment

| | |
|---|---|
| Test project | `kfaqqunuxgpdhboijdsl` |
| PostgreSQL | 17.11 on test vs 17.6.1.063 in production (accepted deviation; same major version) |
| Schema | Schema-only restore of the preserved production dump (`schema.sql`, SHA-256 `ce793c6b2c986c8751a63fbbfa5286aa13bc63c4605fc189bdcd7dc49424adf7`), applied with native `psql` in one transaction with `ON_ERROR_STOP`; exit 0. No production data, no fresh production dump |
| Restored objects | 206 tables, 669 functions, 151 triggers, 394 policies, 728 indexes, 13 views, 1 materialized view; 0 rows; no migration history before Gate 1A |
| Isolation | Hardcoded production URLs in restored function bodies neutralized to `.invalid` hosts; `auth`, `storage`, `vault`, `cron` and `net` empty; only publication is `supabase_realtime` |

Accepted restore deviations, none of which touch Gate 1A logic:

- `roles.sql` was not applied, so the test project keeps Supabase's default per-role statement timeouts.
- Triggers on `auth.*` and `storage.*` tables are not part of the application-schema dump and do not exist on the test project.

### ACL reconciliation

Supabase's default privileges over-grant on objects created by a restore, so every restored object was reset to `acldefault` and the dump's own `GRANT`/`REVOKE` statements were replayed (4,317 statements). Afterwards all 900 objects match the dump-derived production grants exactly, plus the 5 column grants on `shared_ledger_notifications`. `market_bids` grants SELECT only to `authenticated` and ALL to `service_role`. `award_indent_to_trip` and `batch_award_indents_to_trips` have no `anon` grant. The migration itself contains no `GRANT` or `REVOKE`, and the replaced functions kept their grants.

### Operational side effect: CLI login role

Two early `db:push-set --dry-run` attempts ran without the database password in the environment. The Supabase CLI then created, and later refreshed, a temporary `cli_login_postgres` role on the test project. This is an operational side effect of CLI authentication; there was no schema, data or migration change. The role was left in place. All later CLI runs used the password directly and did not touch it.

### Pre-apply checks (I–K)

- **I — migration history:** empty on the test project before the apply.
- **J — dry run / release set:** `db:push-set -- gate-1a --dry-run` PASS with the password set: no login-role step, exactly one migration would be pushed (`20271005200741`), frozen `20271005130000` excluded, nothing applied.
- **K — repository integrity:** the four Gate 1A artifacts in the worktree match the main checkout byte for byte; the migration SHA matches the frozen value; the release set contains only `20271005200741`.
- **Baseline match:** before the apply, the four existing functions on the test project hash-match the preserved production definitions.

### Baseline (unpatched schema)

The full 35-case matrix reproduced the container baseline case for case: 26 PASS / 9 FAIL, with the same failing cases (1, 2, 15, 16, X1, X3, X4, X5, X6) and the same final states. Races A and E reproduced the double-winner defect.

### Apply

The migration was applied once with `MIGRATION_APPLY_CONFIRM=gate-1a npm run db:push-set -- gate-1a` from the test worktree. The snapshot contained only `20271005200741`, with `20271005130000` excluded. Migration history holds exactly that one version, and `trg_indents_guard_commercial_winner` is enabled on `indents`. The four replaced functions hash-match the post-migration definitions validated in the container.

### Post-migration results

- **Regression matrix: 35/35 PASS.** Every case is identical to the container post-migration run in verdict, final state and error codes. The 9 baseline failures are closed. Case 17 still hits the known `pickup_lat` error (see *Not part of Gate 1A*).
- **Races A–G, both orderings: 14/14** identical to the container post-migration evidence in errors, final state and lock waits. In every run at most one winner exists. The second session always waits for the first to commit; it then either fails and rolls back, or, in race D where it acts for the same winner, commits consistently.
- **Scenario H: accepted deviation.** The safety property held in every run: one winner and no partial commercial state.
  - In the first variant, the session that pre-locks the bid row with `SELECT … FOR UPDATE` as `authenticated` was refused (`permission denied for table market_bids`), because the test project carries production's SELECT-only grant. The container had over-granted, so that step ran there. That lock path is therefore not reachable by an authenticated client in production.
  - In H2, the deadlock (`40P01`) aborted the trip conversion instead of the award, the reverse of the container run. Deadlock victim selection depends on timing. Final state: indent awarded, fee paid, no trip. The conversion can be retried by the caller, consistent with the no-DB-retry decision above.

- **Visibility predicate: 21/21 PASS.** `supabase/tests/marketplace_visibility_predicate.sql` ran end to end, unmodified (SHA-256 `dc17ff19032b061e8b08dc5ffcb26d19e7700a022794563bed3ea98a730c0855`), and ended with `ALL CHECKS PASSED`. That covers all 7 sections, including the Gate 1A C2 shipper-staff quote accept, the award hiding the story, and the late-bid rejection.
  - Sections 6–7 need active `reach_plans` rows, which a schema-only restore does not carry. The repository's three seed plans (`basic`, `boost`, `max`, from `20261224020000_reach_plans.sql`) were inserted transiently in the same transaction as the test, and the test's own `ROLLBACK` removed them.
  - Afterwards the test project had 0 `reach_plans` rows, 0 test users and orgs, 0 `reach_campaigns`, and history still only `20271005200741`.

The test project (now in its post-rollback-test state, see *Production deployment*), the harness fixtures and helpers, and the local evidence directories are kept until the production gate decision is complete.

## Production deployment

**Gate 1A is applied to production (`nafxpivddesgsrthmosv`).** The apply succeeded and post-apply verification passed. Production is frozen after this deployment.

### Rollback (prepared, not applied)

- **Migration:** `20271005223000_gate1a_rollback_restore_pre_gate1a_award_functions.sql`, SHA-256 `c6f66ed56e0395abc57cee258ca97bff0c21fd614e97bc76aae1713f1089b492`, release set `gate-1a-rollback` (`20271005223000` only).
- **Contents:** it drops `trg_indents_guard_commercial_winner` and `tg_indents_guard_commercial_winner()`, then restores the four pre-Gate-1A production definitions byte for byte.
- **Tested on `kfaqqunuxgpdhboijdsl`:** after the rollback, the four functions hash to the production baseline (`38e7bbfc…`, `817ece13…`, `6f1b4807…`, `df2a4274…`) with unchanged owner, volatility and grants, and both guard objects are gone.
  - `reject_quote_accept_on_inactive_indent` returns to production's original `SECURITY INVOKER` with `search_path=public`.
  - Migration history was not edited.
- **Production:** not applied.

### Preflight

- **P1–P9 pass** on production.
  - **P5:** the four functions matched the preserved baseline exactly.
  - **P6:** both guard objects were absent.
  - **P8:** no long or idle transactions, and no locks on `indents`.
  - **P9:** 0 existing double winners.
- **P2** `db:preflight` passed on content. Its exit 1 is the standing refusal over the frozen `20271005130000`.
- **P4** `db:push-set -- gate-1a --dry-run` exited 0 and would push only `20271005200741`.
- **Lock bounds:** production's `postgres` role has `lock_timeout = 8s` and `statement_timeout = 60s`, so a blocked `CREATE TRIGGER` would have rolled back rather than queue writes on `indents` indefinitely.

### Apply

- **Command:** `MIGRATION_APPLY_CONFIRM=gate-1a npm run db:push-set -- gate-1a`, from the main checkout.
- **Result:** exit 0. Exactly one migration was applied: `20271005200741_gate1a_award_lock_order_and_commercial_integrity_guards.sql`.
- **Login:** the CLI connected with the database password. No `cli_login_*` role was created or refreshed by this deployment.

### Post-apply verification (read-only)

| Check | Result |
|---|---|
| Ledger | `20271005200741` recorded. `20271005223000`, `20271005130000` and `20271006015124` not recorded |
| `award_market_bid` | `43bc4e53…`, SECURITY DEFINER, `search_path=""`, grants unchanged |
| `reject_quote_accept_on_inactive_indent` | `61cb71d7…`, now SECURITY DEFINER with `search_path=""` (C2), grants unchanged |
| `award_indent_to_trip` | `872a3ca7…`, SECURITY DEFINER, `search_path=public`, grants unchanged |
| `batch_award_indents_to_trips` | `65496a37…`, SECURITY DEFINER, `search_path=public`, grants unchanged |
| Guard function | `tg_indents_guard_commercial_winner` `0c21b8bf…`, owner `postgres`, SECURITY DEFINER, `search_path=""` |
| Guard trigger | `trg_indents_guard_commercial_winner` `BEFORE UPDATE OF status, assigned_supplier_id ON public.indents FOR EACH ROW`, enabled |
| `indents` triggers | The 10 pre-existing triggers unchanged, plus the guard; all enabled. Table grants unchanged |
| Locks / transactions | No long or idle-in-transaction sessions and nothing waiting. Two transient `indents` locks seen once were gone on an immediate re-check |
| Integrity | 0 double winners, 0 indents with multiple active trips, 0 non-winner suppliers, 0 winners with a reopenable status. 604 of 1,097 indents have a winner (602 at the previous night's preflight; normal award activity) |

All five function hashes equal the definitions validated on the test project.

### Not changed by this deployment

- Rollback `20271005223000` and `20271006015124` remain unapplied.
- Two production changes happened before the apply and outside this deployment: migrations `20271005211835` and `20271005215938` (driver execution authority), and a refresh of `cli_login_postgres` by another CLI session.

### Evidence

- The apply and preflight logs, the apply runner and a post-apply verification record are preserved outside the repository in the agent evidence folder `gate1a-evidence-2026-10-06-production/`, with a `SHA256SUMS` manifest.
- The test-run evidence is in `gate1a-evidence-2026-10-06/`.
- Both folders were checksum-verified against their sources and contain no credentials.

## Next controlled steps

1. **Completed.** Add `20271005200741` to a named release set; `npm run db:preflight`; `npm run db:push-set -- <name> --dry-run`.
2. **Completed.** Apply to the designated non-production/test environment only.
3. **Completed.** Smoke and regression verification there, including `marketplace_visibility_predicate.sql` end to end.
4. **Completed.** Separate, explicit production migration authorization.

After that: the pooled Marketplace foundation. Its UI keeps the existing Marketplace card view as the default, with a view toggle into an indent view (IND001, IND002, …). There is no separate shipper table page.
