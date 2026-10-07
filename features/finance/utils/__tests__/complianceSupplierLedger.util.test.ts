import {
  COMPLIANCE_SUPPLIER_ADVANCE_CATEGORY,
  COMPLIANCE_SUPPLIER_BALANCE_CATEGORY,
  complianceSupplierLedgerCategory,
  isComplianceSupplierLedgerCategory,
} from "@/features/finance/utils/complianceSupplierLedger.util";

describe("complianceSupplierLedgerCategory", () => {
  it("maps client categories to supplier mirror categories", () => {
    expect(complianceSupplierLedgerCategory("compliance_advance")).toBe(
      COMPLIANCE_SUPPLIER_ADVANCE_CATEGORY,
    );
    expect(complianceSupplierLedgerCategory("compliance_balance")).toBe(
      COMPLIANCE_SUPPLIER_BALANCE_CATEGORY,
    );
  });
});

describe("isComplianceSupplierLedgerCategory", () => {
  it("recognizes supplier mirror categories only", () => {
    expect(isComplianceSupplierLedgerCategory("compliance_supplier_advance")).toBe(true);
    expect(isComplianceSupplierLedgerCategory("compliance_supplier_balance")).toBe(true);
    expect(isComplianceSupplierLedgerCategory("compliance_advance")).toBe(false);
    expect(isComplianceSupplierLedgerCategory(null)).toBe(false);
  });
});
