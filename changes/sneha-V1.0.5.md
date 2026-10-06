# sneha/V1.0.5

## What
- Bidirectional cache sync between Finance Hub / Ledger / client Finance Statement and Compliance Settlement (shared `transactions` source of truth).
- Paid at / Txn Date stays blank until Ops confirms it in Compliance.
- Trip Finance Hub → Summary shows Compliance advance terms: base freight, advance %, documentation charges, TDS, computed payable, and posted advance.
- Compliance Pending still has no Finance tab, Advance Payment, or Hardcopy POD button (page filter AND trip stage). POD Received / IBond / charges review stay as on V1.

## Why
- Finance and Compliance were showing different dates and lists after the same payment. Ops need the Compliance TDS / doc / % math on trip Finance Summary without changing posting rules.

## Areas
- Compliance Settlement (Paid at, queue filters)
- Finance Hub Summary, ledger cache invalidation, client Finance Statement
- Compliance document workspace (Finance tab gated with Compliance Pending)

## Migrations
- None.

## Tested
- Jest: `syncFinanceComplianceCaches.test.ts`, `tripComplianceWrite.service.test.ts`
- Rebased onto `nihas/V1` after Praveen V1.0.5 (vendor document cost from processed advance)
- Handoff runs lint, TypeScript, and Jest

## Out of scope (V1.0.6)
- Advance Processed × revert. A posted `compliance_advance` must not be deleted from `transactions`; reverse it with an opposite ledger entry (and 7-day admin rule) per `docs/CORE_ACCOUNTING_MODEL.md`.
