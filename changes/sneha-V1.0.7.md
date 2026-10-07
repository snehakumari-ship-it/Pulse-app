# sneha/V1.0.7

## What
- Compliance advance/balance posts **both** legs: customer Cash IN and (when the trip has a supplier) supplier Cash OUT under `compliance_supplier_advance` / `compliance_supplier_balance`, so partner Finance · Statement shows the payment.
- Prefers atomic RPC `post_compliance_settlement_pair`; falls back to dual `createLedgerEntry` with heal-on-retry until the migration is on the linked DB.
- Txn Date / UTR / Request ID / amount-mode edits on the client compliance row sync to the supplier mirror row.
- Migration: unique index + RLS for supplier categories, atomic RPC, and backfill of real supplier rows from existing client compliance posts (no projected fake Out rows on the statement).

## Why
- Ops credits the advance to the supplier in Compliance, but only the customer ledger was updated — partner ledgers stayed empty (e.g. FR8 / RAJASTHAN ROADWAYS).

## Areas
- `postCompliancePayment` / payment edit sync (`tripComplianceWrite.service`)
- `complianceSupplierLedger.util`
- `supabase/migrations/20261007130944_compliance_supplier_ledger_dual_post.sql`

## Migrations
- `20261007130944_compliance_supplier_ledger_dual_post.sql` (Nihas applies via db push — not run from this branch)

## Tested
- Jest: `complianceSupplierLedger.util.test.ts`, `tripComplianceWrite.service.test.ts` (supplier mirror case)
