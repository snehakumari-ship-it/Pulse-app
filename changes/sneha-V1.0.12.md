# sneha V1.0.12 — Debit control POD Verification on V1

## What
- Cherry-pick Nihas's debit-control handoff (`7c52d676`) onto latest `V1`. Debit-only users open on Awaiting POD (hard copy not received, no age / All / IBond sub-tabs, Log Hard Copy POD still there). POD Verification has Fully Received and Partially Received. Fully Received opens the Credit / Debit Notes panel (list 1 : panel 3) and Mark POD Verified writes the existing `pod.debit_control_validated` record. Two conflicts in `app/compliance/index.tsx`: kept V1's stage-rail wrapper and used `podReceivedCount + podPartialPool.length`; dropped the Awaiting POD filter row and the POD Received All/IBond chips.
- Inline trip-detail CN/DN chips (the expanded trip card, and the unused provision block on trip detail) now use `provisionProtocolChips`, the same lane lists as the POD panel. A reason the new side does not offer is cleared when CN and DN are switched. Ground Ops cannot open the settlement panel: it stays debit-only, and `hideCommercials` also blocks it.

## Why
- Debit control was landing on an empty tab, and POD Verification needed the CN/DN panel without a schema change. V1's Compliance rail had moved on, so the handoff had to be merged rather than replayed. The old chip list was still offering reasons on the wrong side.

## Areas
- app/compliance/index.tsx
- features/tripCompliance/components/ComplianceDocumentWorkspace.tsx
- features/tripCompliance/components/ComplianceTripAdjustmentsPane.tsx
- features/tripCompliance/components/ComplianceSettlementBreakdown.tsx
- features/tripCompliance/utils/complianceSettlementSummary.util.ts
- features/tripCompliance/utils/podChargesFromAdjustments.util.ts
- features/trips/components/trip-detail/TripDetailFinanceView.tsx
- features/trips/components/trip-detail/TripDetailScreen.tsx
- features/trips/components/trip-detail/adjustment/tripAdjustmentFlow.util.ts
- features/trips/components/trip-detail/adjustment/ProvisionAdjustmentModal.tsx
- features/trips/services/tripAdjustments.ts

## Migrations
- None.

## Tested
- `npx jest --ci --silent`: 539 suites passed, 1 skipped; 4203 tests passed, 3 skipped. One earlier full run timed out an unrelated driver job-card test (`DriverMultiOrderJobCard.readContract`); that file passed alone (13) and in the rerun.
- Chip and settlement tests: `provisionProtocolChips.test.ts`, `ProvisionAdjustmentModal.chips.test.tsx`, `podChargesFromAdjustments.util.test.ts`, `complianceSettlementSummary.util.test.ts` (16 passed).
- ci-baseline: lint 102 (≤104), typecheck 62 (≤89, Node 26, extra heap; no new errors in files touched), cycles 111, lib-files 178. `git diff --check` clean.
- Not clicked through. Not signed in on preprod as a debit user or as Finance. Asset/DCO cost base, POD age filters, CN "Other" → Damage Value, undo after Mark POD Verified, and the RBAC doc update are waiting on the debit team (see the PR).
