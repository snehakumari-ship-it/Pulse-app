# Pulse Deployment Changelog

Pulse-app is the source application. This file records the next deployment candidate. It is built from `git log` and `git diff` of `17cf7325..b6b7a0a6`. Commit subjects were not used as the only source.

Nothing after `17cf7325` has been pushed. Nothing in this range is deployed. The working tree is not part of this range.

## Current Deployment Baseline

- Previous deployed: `17cf7325aaa5880a974bb3723c07b00045598d75` — `fix(loads): fetch Get Load catalog on production cold start` (`origin/V1.0.1`)
- Next release HEAD: `b6b7a0a68c8d939e1f6d2bcacef0cc55acab2b6f` — `feat(driver): add authoritative commerce trip origin`
- Branch: `V1.0.1` (`origin/V1.0.1`, ahead 2)
- Status: Committed but not pushed
- Generated: 2026-10-05

| State | Identity |
| --- | --- |
| DEPLOYED | `17cf7325aaa5880a974bb3723c07b00045598d75` |
| COMMITTED — NOT DEPLOYED | `26533561c0f6becdd075a4bc97b2fa06e37c1846` |
| COMMITTED — NOT DEPLOYED | `b6b7a0a68c8d939e1f6d2bcacef0cc55acab2b6f` |
| DATABASE MIGRATION | `20270913091000_driver_commerce_origin_read_boundary.sql` — CODE PRESENT, MIGRATION NOT APPLIED, DEPLOYMENT PENDING |

Commits in order:

1. `26533561` (2026-10-05 17:27 +0530, Vasanth) — Driver web Metro chunk resolution
2. `b6b7a0a6` (2026-10-05 18:11 +0530, Vasanth) — authoritative Commerce trip origin

---

## DEP-2026-001 — Driver Web Metro Chunk Resolution

Status: COMMITTED — NOT DEPLOYED

Source commit: `26533561c0f6becdd075a4bc97b2fa06e37c1846`

Domain: Driver Web / Platform

Business purpose: On Driver web, a nested route was requesting a second lazy chunk under the current pathname (`/<route>/features/...bundle`). Metro serves bundles from the repo root (`/features/...bundle`), so that fetch failed and the screen did not load. Drivers on those web routes need the chunk request to hit the path Metro actually serves.

Technical changes:

- `polyfills/webChunkRecovery.js` is new in this commit. `metro.config.js` already lists it in `getModulesRunBeforeMainModule`. That config file is not in this diff. The new file is what that existing hook loads.
- `rewriteMetroBundleUrl` rewrites a same-origin URL whose path ends in `.bundle` and whose path contains a Metro root (`/features/`, `/node_modules/`, `/app/`, and the other roots named in the file) after a route prefix. It strips the prefix. URLs that already start at one of those roots are unchanged. Non-bundle URLs are unchanged. A different origin is unchanged.
- The installer runs only when `window` and `document` exist, and only once (`window.__qWebChunkRecoveryInstalled`). Native and SSR do not attach it.
- Five Driver routes no longer use `React.lazy` / `Suspense`. They import the screen module directly:
  - `app/(driver)/available-loads/index.tsx`
  - `app/(driver)/available-loads/[indentId].tsx`
  - `app/(driver)/profile.tsx`
  - `app/(driver)/trip-history/index.tsx`
  - `app/(driver)/wallet.tsx`
- Other routes that still use `React.lazy` are outside this diff. This changelog does not treat that remaining lazy loading as a defect.

Files changed (7):

- `polyfills/webChunkRecovery.js`
- `polyfills/__tests__/rewriteMetroBundleUrl.test.ts`
- `app/(driver)/available-loads/index.tsx`
- `app/(driver)/available-loads/[indentId].tsx`
- `app/(driver)/profile.tsx`
- `app/(driver)/trip-history/index.tsx`
- `app/(driver)/wallet.tsx`

Database impact: NONE

RPC/API impact: NONE

Production infrastructure: NONE. No schema, no edge function, no gateway change.

AWS impact: NOT APPLICABLE. This is the web client bundler. It is not a service boundary.

Tests: `polyfills/__tests__/rewriteMetroBundleUrl.test.ts` is added in the commit. It covers the URL rewrite. It does not boot Metro.

Backward compatibility: BACKWARD COMPATIBLE. No API, RPC, or database contract changes. Native apps do not install the fetch rewrite. The five routes still render the same screens; they no longer suspend on a lazy import.

Rollback: Revert `26533561`. No database rollback. Those five routes return to `React.lazy`, and the polyfill file disappears. `metro.config.js` would again point at a missing file until that revert is paired with a config change, or until the file is restored. Check `metro.config.js` before reverting only the polyfill.

---

## DEP-2026-002 — Authoritative Commerce Trip Origin

Status: COMMITTED — NOT DEPLOYED

Source commit: `b6b7a0a68c8d939e1f6d2bcacef0cc55acab2b6f`

Migration: `supabase/migrations/20270913091000_driver_commerce_origin_read_boundary.sql`

Migration state: CODE PRESENT. MIGRATION NOT APPLIED. DEPLOYMENT PENDING.

Domain: Commerce / Driver Execution

Business purpose: The Driver trip list classified Commerce trips as standard FTL. The list view exposed `indent_id` and `source_indent_id` but not the Commerce origin. The client then selected `indents.id, execution_plan_id` in the Driver session. Driver RLS blocks that read, so the origin was missing. Commerce is a non-null `indents.execution_plan_id` on an indent linked to a trip that driver owns. Stop count, order count, and `client_price` are not Commerce signals.

Technical changes:

Driver trip list → `trips_driver_view` → driver-owned Commerce origin boundary → `indents.execution_plan_id` → `execution_plan_id` / `is_commerce` → `getDriverTripExperience`.

`getDriverTripExperience` returns `COMMERCE_MULTI_ORDER` when `is_commerce` is true or `execution_plan_id` is non-empty. Otherwise it returns `STANDARD_FTL`.

Trip linkage is ordered. The columns are not interchangeable.

1. Resolve the plan id from the indent referenced by `trips.indent_id`.
2. If that plan id is null, resolve it from the indent referenced by `trips.source_indent_id`.

Shipper, marketplace, and network trips set `trips.indent_id` and leave `source_indent_id` null. Mover asset trips leave `indent_id` null and set `source_indent_id` so `trips_one_per_indent` does not apply. The plan lives on the load indent either column points at.

`getDriverUiTripsByDriverIds` no longer calls `stampCommerceOriginOnTripRows`. That function selected `indents`. The list does not call `get_driver_trip_stop_orders`. Pagination (`.in("driver_id")`, `.order("created_at")`, `.range`) is unchanged in this commit.

Files changed (9):

- `supabase/migrations/20270913091000_driver_commerce_origin_read_boundary.sql`
- `features/trips/services/trips.service.ts`
- `features/trips/domain/driverTripExperience.ts`
- `features/trips/domain/__tests__/driverTripExperience.test.ts`
- `features/trips/services/__tests__/driverCommerceOrigin.migration.contract.test.ts`
- `features/trips/services/__tests__/getDriverUiTripsByDriverIds.commerceOrigin.test.ts`
- `lib/database.types.ts` (six lines on `trips_driver_view` only)
- `types/trip-views.ts` (comment only; `execution_plan_id` and `is_commerce` were already on `DriverTripRow`)
- `types/__tests__/trip-views.test.ts`

Database changes:

The migration does not create `indents.execution_plan_id`. That column already exists (`20270913090000`). This migration reads it.

- Creates `public.driver_owned_indent_execution_plan_id(uuid)`.
  - `RETURNS uuid`, `LANGUAGE sql`, `STABLE`, `SECURITY DEFINER`, `SET search_path TO 'public'`.
  - Null input returns null (`p_indent_id IS NOT NULL`).
  - Returns `indents.execution_plan_id` only when `drivers.user_id = auth.uid()` and that driver’s trip has `indent_id` or `source_indent_id` equal to the argument.
  - Does not return customer, order, or financial columns. Does not accept an `execution_plan_id` argument.
- `REVOKE ALL` from `PUBLIC` and from `anon`. `GRANT EXECUTE` to `authenticated` only. No `service_role` grant. No `SELECT` grant on `indents`.
- Replaces `public.trips_driver_view` `WITH (security_invoker = true)`.
  - Keeps the `20270912140000` column list and the filter `driver_id IN (SELECT d.id FROM drivers WHERE user_id = auth.uid())`.
  - Adds one lateral lookup. Exposes `execution_plan_id` and `is_commerce` (`execution_plan_id IS NOT NULL`).
  - The `COALESCE` is of the two plan-id lookups, not of the two indent ids.
- No new index, trigger, RLS policy, or storage policy.

Sort position: `20270913091000`, after `20270913090000` and `20270912140000`, before `20270913091416`. No later migration in this repo replaces `trips_driver_view`. This file does not depend on the untracked DCO migrations.

Security:

- The view stays `security_invoker`. Driver ownership filtering is unchanged.
- The helper is `SECURITY DEFINER` because a Driver session cannot select `indents`.
- Ownership is `auth.uid()` through `drivers.user_id` and `trips.driver_id`.
- An unowned or unknown indent returns null.
- Another driver’s trip is not in the view.
- Drivers do not gain direct `SELECT` on `indents`.

Deployment dependency:

Application commit `b6b7a0a6` and migration `20270913091000` are one coordinated deployment.

Current state: CODE COMMITTED. MIGRATION NOT APPLIED. The client commit is not deployed, so this is not a production failure today.

When this release is deployed, apply the migration before or as part of shipping the client. If the client ships without the migration, `trips_driver_view` has no `execution_plan_id` or `is_commerce`, and Driver Commerce classification falls back to `STANDARD_FTL`.

Older clients that still select `indents` stay fail-closed for the same reason Driver RLS already blocks that read. They do not start erroring because these columns were added.

Backward compatibility: REQUIRES COORDINATED DEPLOYMENT for the feature to turn on. Not a breaking crash for the current Business app or for an older Driver build. No existing RPC signature changed.

AWS impact: MIGRATE LATER. Current owner: PULSE-APP / SHARED DB. Future AWS service: TBD. Extraction design: TBD. The business contract is in `docs/deployment/MICROSERVICE_MIGRATION_LEDGER.md`. Do not treat the SQL function as the required future shape.

Future extraction: A later Driver client may call a service API that returns `execution_plan_id` and `is_commerce` for a trip that driver owns. The service must enforce that ownership. It must not expose `indents.execution_plan_id` to arbitrary clients. It must keep `indent_id` then `source_indent_id` semantics. It must not infer Commerce from order or stop counts.

Rollback:

- If the migration has not been applied: do not push `b6b7a0a6`, or revert that commit. No database rollback.
- If the migration has been applied and must be undone: restore the `20270912140000` view and drop `driver_owned_indent_execution_plan_id(uuid)`. Do not drop `indents.execution_plan_id`.
- A new client against the restored view classifies trips as `STANDARD_FTL`.

Tests in the commit:

- `features/trips/domain/__tests__/driverTripExperience.test.ts`
- `types/__tests__/trip-views.test.ts`
- `features/trips/services/__tests__/driverCommerceOrigin.migration.contract.test.ts` (SQL text, not an executed database)
- `features/trips/services/__tests__/getDriverUiTripsByDriverIds.commerceOrigin.test.ts` (one view read, no `indents` query, no `get_driver_trip_stop_orders`)

Local run of those four files after the commit: 4 suites, 24 tests, passed. That run did not apply the migration.

---

## Future deployment process

Before every later deployment:

1. Identify the previous pushed commit.
2. Identify the current release HEAD.
3. Generate the git delta between them.
4. Inspect the diffs, not only the commit subjects.
5. Classify each change.
6. Identify database migrations, RPCs, and API changes.
7. Identify AWS microservice impact. Use TBD when the future service is not decided.
8. Update `docs/deployment/CHANGELOG.md`.
9. Update `docs/deployment/MICROSERVICE_MIGRATION_LEDGER.md`.
10. Verify deployment order from real dependencies.
11. Verify backward compatibility: BACKWARD COMPATIBLE, BREAKING, or REQUIRES COORDINATED DEPLOYMENT.
12. Only then prepare the release.

Every change that affects a capability that may move to AWS needs a ledger entry. Uncommitted work stays out of the deployment entries until it is committed and is inside the delta.

---

## Migration apply path for V1.0.1

Tooling only. This section does not record an applied migration.

`npm run db:push` applies every Local-only file in `supabase/migrations/`. That queue includes unapproved migrations and the frozen DCO pair, so it is not the V1.0.1 database release.

When a separate authorization allows the database change, the production command is:

`MIGRATION_APPLY_CONFIRM=v1.0.1 npm run db:push-set -- v1.0.1`

The release set `supabase/release-sets/v1.0.1.versions` names one version: `20270913091000`. The command builds a snapshot of migrations already on Remote plus that file, then runs `supabase db push --linked --include-all` against the snapshot. `--include-all` is required because `20270913091000` sorts between versions already on Remote. Remote history versions that exist only in the sibling repo are represented by comment-only files inside that snapshot, not by new files in `supabase/migrations/`. Those versions are already recorded, so they are not executed.

`supabase/release-sets/FROZEN.versions` names `20271005120000` and `20271005130000`. Those files stay in `supabase/migrations/`, are not copied into the snapshot, are not executed, and are not marked applied.

A dry-run is `npm run db:push-set -- v1.0.1 --dry-run`. It does not apply SQL.

---

## UNRELEASED / WORKING TREE

Not in `17cf7325..b6b7a0a6`. Not part of DEP-2026-001 or DEP-2026-002. Not deployed.

- DCO and Fleet Owner retirement (modified driver layout, deleted Become Fleet Owner route, fleet and DCO screens, driver queries, navigation registry, `lib/queryKeys.ts`, `lib/routes.ts`, untracked `driverOperatingMode` client code)
- DCO migrations `20271005120000` and `20271005130000`, plus `supabase/tests/dco_operating_model_boundary.sql` (untracked, not applied)
- Marketplace wording still uncommitted (`marketplaceErrorFormat.util.ts`, `marketBids.service.ts`, and that util’s untracked test)
- Untracked `20270930173000_collapse_long_haul_health_odometer_scan.sql` (not applied)
- Untracked `features/trips/components/trip-detail/VaultUploadedDocPreviewStrip.tsx`
- Temporary QA and SQL: `nihas-tests/_tmp-commerce-order-invoice-qa*.mjs`, `scripts/sql/_tmp_db_health_*.sql`
- `.worktrees/`
