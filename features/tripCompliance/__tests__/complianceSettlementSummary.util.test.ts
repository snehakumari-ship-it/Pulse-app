import type { LedgerRow } from "@/features/finance/services/finance.service";
import { complianceSettlementSummary } from "@/features/tripCompliance/utils/complianceSettlementSummary.util";
import type { TripAdjustment } from "@/features/trips/services/tripAdjustments";
import type { TripRow } from "@/features/trips/services/trips.service";

jest.mock("@/lib/supabase", () => ({ supabase: jest.fn() }));

const ORG = "org-1";
const trip = {
  id: "t1",
  organization_id: ORG,
  indent_id: null,
  client_price: 6047,
  supplier_rate: 5250,
  amount_paid: 0,
  supplier_id: "s1",
  client_id: "c1",
} as unknown as TripRow;

const adj = (type: TripAdjustment["type"], impact: TripAdjustment["impact"], amount: number): TripAdjustment => ({
  id: `${type}-${impact}-${amount}`,
  trip_id: "t1",
  type,
  impact,
  amount,
  reason: "x",
  created_at: "2026-10-14T00:00:00Z",
});

const tx = (partial: Partial<LedgerRow>): LedgerRow =>
  ({
    id: Math.random().toString(36),
    organization_id: ORG,
    trip_id: "t1",
    party_name: "",
    description: "",
    amount_in: 0,
    amount_out: 0,
    transaction_date: "2026-10-01",
    created_at: "2026-10-01T00:00:00Z",
    ...partial,
  }) as LedgerRow;

describe("complianceSettlementSummary", () => {
  it("builds base → CN/DN → revised → paid → final settlement", () => {
    const s = complianceSettlementSummary({
      trip,
      viewerOrgId: ORG,
      adjustments: [adj("revenue", "plus", 500), adj("cost", "plus", 500), adj("cost", "minus", 300)],
      ledgerEntries: [
        tx({ amount_out: 4000, contact_type: "supplier", ledger_category: "compliance_advance" }),
        tx({ amount_in: 2000, contact_type: "client" }),
      ],
    });
    expect(s.payable).toEqual({
      base: 5250,
      debitNotes: 500,
      creditNotes: 300,
      revised: 5450,
      settled: 4000,
      advancePaid: 4000,
      otherPaid: 0,
      balance: 1450,
    });
    expect(s.receivable).toMatchObject({ base: 6047, debitNotes: 500, revised: 6547, settled: 2000, balance: 4547 });
  });

  it("shows a negative balance when the supplier was paid more than the revised cost", () => {
    const s = complianceSettlementSummary({
      trip,
      viewerOrgId: ORG,
      adjustments: [adj("cost", "minus", 1500)],
      ledgerEntries: [tx({ amount_out: 4000, contact_type: "supplier", ledger_category: "compliance_advance" })],
    });
    expect(s.payable.revised).toBe(3750);
    expect(s.payable.balance).toBe(-250);
  });
});
