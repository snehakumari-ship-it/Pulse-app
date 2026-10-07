import type { LedgerRow } from "@/features/finance/services/finance.service";
import {
  COMPLIANCE_SUPPLIER_ADVANCE_CATEGORY,
  complianceSupplierLedgerCategory,
  mergeComplianceRowsIntoSupplierLedger,
} from "@/features/finance/utils/complianceSupplierLedger.util";

function row(partial: Partial<LedgerRow> & Pick<LedgerRow, "id">): LedgerRow {
  return {
    organization_id: "org-1",
    trip_id: null,
    party_name: "—",
    description: "Compliance Advance | Mode: UPI",
    amount_in: 0,
    amount_out: 0,
    transaction_date: "2026-10-07",
    created_at: "2026-10-07T10:00:00Z",
    ...partial,
  } as LedgerRow;
}

describe("complianceSupplierLedgerCategory", () => {
  it("maps client compliance categories to supplier mirror categories", () => {
    expect(complianceSupplierLedgerCategory("compliance_advance")).toBe(
      COMPLIANCE_SUPPLIER_ADVANCE_CATEGORY,
    );
    expect(complianceSupplierLedgerCategory("compliance_balance")).toBe(
      "compliance_supplier_balance",
    );
  });
});

describe("mergeComplianceRowsIntoSupplierLedger", () => {
  const tripIds = new Set(["trip-1", "trip-2"]);

  it("projects historical client compliance advances as supplier Cash OUT", () => {
    const merged = mergeComplianceRowsIntoSupplierLedger(
      [],
      [
        row({
          id: "tx-client-adv",
          trip_id: "trip-1",
          amount_in: 38650,
          ledger_category: "compliance_advance",
          contact_type: "client",
          contact_id: "client-1",
        }),
      ],
      tripIds,
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].amount_in).toBe(0);
    expect(merged[0].amount_out).toBe(38650);
    expect(merged[0].id).toBe("tx-client-adv");
  });

  it("does not double-count when a real supplier mirror already exists", () => {
    const merged = mergeComplianceRowsIntoSupplierLedger(
      [
        row({
          id: "tx-mirror",
          trip_id: "trip-1",
          amount_out: 38650,
          ledger_category: COMPLIANCE_SUPPLIER_ADVANCE_CATEGORY,
          contact_type: "supplier",
          contact_id: "sup-1",
        }),
      ],
      [
        row({
          id: "tx-client-adv",
          trip_id: "trip-1",
          amount_in: 38650,
          ledger_category: "compliance_advance",
          contact_type: "client",
          contact_id: "client-1",
        }),
      ],
      tripIds,
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("tx-mirror");
    expect(merged[0].amount_out).toBe(38650);
  });

  it("ignores compliance rows for trips not owned by this supplier", () => {
    const merged = mergeComplianceRowsIntoSupplierLedger(
      [],
      [
        row({
          id: "tx-other",
          trip_id: "trip-other",
          amount_in: 1000,
          ledger_category: "compliance_advance",
        }),
      ],
      tripIds,
    );
    expect(merged).toHaveLength(0);
  });
});
