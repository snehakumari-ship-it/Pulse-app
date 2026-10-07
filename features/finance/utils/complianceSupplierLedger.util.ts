/**
 * Compliance advance/balance posts as customer Cash IN (AR). Aggregate trips
 * also post supplier Cash OUT (AP) via `compliance_supplier_*` categories so
 * partner Finance · Statement shows the same settlement as real ledger rows.
 */
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

export function isComplianceSupplierLedgerCategory(
  category: string | null | undefined,
): category is ComplianceSupplierLedgerCategory {
  return (
    category === COMPLIANCE_SUPPLIER_ADVANCE_CATEGORY ||
    category === COMPLIANCE_SUPPLIER_BALANCE_CATEGORY
  );
}
