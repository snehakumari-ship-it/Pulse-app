/**
 * Compliance advance/balance posts as a customer Cash IN (AR). Aggregate trips
 * also need a supplier Cash OUT (AP) so partner Finance Statement / payable
 * aging see the same settlement. Mirror rows use distinct ledger_category
 * values so they do not collide with
 * `ux_transactions_compliance_trip_category` (one client compliance_* per trip).
 */
import type { LedgerRow } from "@/features/finance/services/finance.service";

export type ComplianceClientLedgerCategory = "compliance_advance" | "compliance_balance";

export const COMPLIANCE_SUPPLIER_ADVANCE_CATEGORY = "compliance_supplier_advance";
export const COMPLIANCE_SUPPLIER_BALANCE_CATEGORY = "compliance_supplier_balance";

export type ComplianceSupplierLedgerCategory =
  | typeof COMPLIANCE_SUPPLIER_ADVANCE_CATEGORY
  | typeof COMPLIANCE_SUPPLIER_BALANCE_CATEGORY;

export function complianceSupplierLedgerCategory(
  category: ComplianceClientLedgerCategory,
): ComplianceSupplierLedgerCategory {
  return category === "compliance_advance"
    ? COMPLIANCE_SUPPLIER_ADVANCE_CATEGORY
    : COMPLIANCE_SUPPLIER_BALANCE_CATEGORY;
}

export function isComplianceClientLedgerCategory(
  category: string | null | undefined,
): category is ComplianceClientLedgerCategory {
  return category === "compliance_advance" || category === "compliance_balance";
}

export function isComplianceSupplierLedgerCategory(
  category: string | null | undefined,
): category is ComplianceSupplierLedgerCategory {
  return (
    category === COMPLIANCE_SUPPLIER_ADVANCE_CATEGORY ||
    category === COMPLIANCE_SUPPLIER_BALANCE_CATEGORY
  );
}

function clientCategoryForSupplierMirror(
  category: string | null | undefined,
): ComplianceClientLedgerCategory | null {
  if (category === COMPLIANCE_SUPPLIER_ADVANCE_CATEGORY) return "compliance_advance";
  if (category === COMPLIANCE_SUPPLIER_BALANCE_CATEGORY) return "compliance_balance";
  return null;
}

/**
 * Merge contact-scoped supplier ledger rows with trip-linked Compliance posts.
 * Historical client-tagged compliance advances (amount_in) are projected as
 * amount_out so payable aging / Cash OUT match Ops expectation — unless a real
 * supplier mirror already exists for that trip + category.
 */
export function mergeComplianceRowsIntoSupplierLedger(
  supplierContactRows: readonly LedgerRow[],
  tripLinkedRows: readonly LedgerRow[],
  supplierTripIds: ReadonlySet<string>,
): LedgerRow[] {
  const byId = new Map<string, LedgerRow>();
  for (const row of supplierContactRows) {
    byId.set(row.id, row);
  }

  const mirroredClientCategories = new Set<string>();
  for (const row of byId.values()) {
    if (!row.trip_id || !isComplianceSupplierLedgerCategory(row.ledger_category)) continue;
    const clientCat = clientCategoryForSupplierMirror(row.ledger_category);
    if (clientCat) mirroredClientCategories.add(`${row.trip_id}:${clientCat}`);
  }

  for (const row of tripLinkedRows) {
    if (!row.trip_id || !supplierTripIds.has(row.trip_id)) continue;
    if (byId.has(row.id)) continue;

    if (isComplianceSupplierLedgerCategory(row.ledger_category) && Number(row.amount_out ?? 0) > 0) {
      byId.set(row.id, row);
      const clientCat = clientCategoryForSupplierMirror(row.ledger_category);
      if (clientCat) mirroredClientCategories.add(`${row.trip_id}:${clientCat}`);
      continue;
    }

    if (!isComplianceClientLedgerCategory(row.ledger_category)) continue;
    const inAmt = Number(row.amount_in ?? 0);
    if (inAmt <= 0) continue;
    if (mirroredClientCategories.has(`${row.trip_id}:${row.ledger_category}`)) continue;

    byId.set(row.id, {
      ...row,
      amount_in: 0,
      amount_out: inAmt,
    });
  }

  return Array.from(byId.values()).sort((a, b) => {
    const da = (a.transaction_date || a.created_at || "").slice(0, 10);
    const db = (b.transaction_date || b.created_at || "").slice(0, 10);
    if (da !== db) return db.localeCompare(da);
    return (b.created_at || "").localeCompare(a.created_at || "");
  });
}
