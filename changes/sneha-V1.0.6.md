# sneha/V1.0.6

## What
- Advance Processed stage (Cards, Table, Export Report Excel): trips ordered by most recently posted advance first, so the trip Ops just confirmed rises to the top. Other Compliance stages unchanged.
- Advance Processed → Export Report confirm modal shows a single centered total-trips count (no UTR added / Awaiting UTR split).
- Compliance document checklist gap: replace the looping delivery-truck Lottie with the photo + enable-toggle illustration, centered and sized to the middle column.
- Compliance finance posts (advance / balance): still Cash IN on the customer ledger; for aggregate trips also post a supplier Cash OUT mirror and show trip-linked compliance rows on the partner Finance Statement (historical client-tagged advances projected as Out).

## Why
- After Confirm payment, Ops expect that trip first in the Advance Processed list and in the downloaded report, not mixed by trip pickup date.
- Checklist filler should look calm and professional in the middle column, not a busy truck loop.
- Partner / supplier Finance Statement was empty for Compliance advances even though the same trips showed on the customer ledger.

## Areas
- Compliance Advance Processed Cards / Table list order
- Advance Processed Export Report row order + confirm modal
- Compliance document workspace checklist gap illustration
- `postCompliancePayment` supplier AP mirror + supplier Finance Statement merge

## Migrations
- None.

## Tested
- Jest: `complianceAdvanceProcessedSort.util.test.ts`, `complianceSupplierLedger.util.test.ts`, `tripComplianceWrite.service.test.ts`

## Out of scope (later)
- Advance Processed × revert as a reversal entry (never delete); 7-day admin approval per `docs/CORE_ACCOUNTING_MODEL.md`.
