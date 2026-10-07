# sneha/V1.0.6

## What
- Advance Processed stage (Cards, Table, Export Report Excel): trips ordered by most recently posted advance first, so the trip Ops just confirmed rises to the top. Other Compliance stages unchanged.
- Advance Processed → Export Report confirm modal shows a single centered total-trips count (no UTR added / Awaiting UTR split). Export stays limited to the Advance Processed stage (not cross-stage search matches).
- Advance Processed table: Date column is not a sort toggle (order is newest posted advance).
- Compliance document checklist gap: replace the looping delivery-truck Lottie with the photo + enable-toggle illustration, centered and sized to the middle column.

## Why
- After Confirm payment, Ops expect that trip first in the Advance Processed list and in the downloaded report, not mixed by trip pickup date.
- Checklist filler should look calm and professional in the middle column, not a busy truck loop.

## Areas
- Compliance Advance Processed Cards / Table list order
- Advance Processed Export Report row order + confirm modal (stage-scoped)
- Advance Processed table Date header (non-sortable)
- Compliance document workspace checklist gap illustration

## Migrations
- None.

## Tested
- Jest: `complianceAdvanceProcessedSort.util.test.ts`

## Out of scope (later)
- Supplier ledger mirror for Compliance advances (`sneha/V1.0.6-supplier-mirror`): waiting on Finance accounting decision — see PR #8 review. Build as a proper DB/RPC change if approved.
- Advance Processed × revert as a reversal entry (never delete); 7-day admin approval per `docs/CORE_ACCOUNTING_MODEL.md`.
