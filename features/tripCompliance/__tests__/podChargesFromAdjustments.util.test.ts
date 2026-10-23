import { netChargeTotal } from "@/features/debit-control/utils/podChargeTotals.util";
import { podChargesFromAdjustments } from "@/features/tripCompliance/utils/podChargesFromAdjustments.util";
import {
  adjustedCost,
  adjustedRevenue,
  type TripAdjustment,
} from "@/features/trips/services/tripAdjustments";

jest.mock("@/lib/supabase", () => ({ supabase: jest.fn() }));

let n = 0;
const line = (
  type: TripAdjustment["type"],
  impact: TripAdjustment["impact"],
  amount: number,
  reason: string,
  extra: Partial<TripAdjustment> = {},
): TripAdjustment => ({
  id: `a${(n += 1)}`,
  trip_id: "t1",
  type,
  impact,
  amount,
  reason,
  created_at: "2026-10-14T00:00:00Z",
  ...extra,
});

describe("podChargesFromAdjustments", () => {
  it("maps CN/DN reasons to POD charge fields", () => {
    const { client, vendor } = podChargesFromAdjustments({
      clientPrice: 6047,
      supplierRate: 5250,
      adjustments: [
        line("revenue", "plus", 500, "Unloading Charges"),
        line("revenue", "minus", 100, "Late Delivery"),
        line("cost", "plus", 500, "Loading Charges"),
        line("cost", "plus", 200, "Fuel Escalation"),
        line("cost", "minus", 300, "POD Delay Submission"),
        line("cost", "minus", 50, "Document Cost"),
        line("cost", "minus", 75, "Damages / Missing"),
      ],
    });
    expect(client).toMatchObject({ cost: 6047, unloading: 500, delay: 100 });
    expect(vendor).toMatchObject({
      cost: 5250,
      loading: 500,
      other: 200,
      podDelaySubmission: 300,
      documentCost: 50,
      damage: 75,
    });
  });

  it("totals equal the revised sale and cost after CN/DN", () => {
    const adjustments = [
      line("revenue", "plus", 500, "Detention"),
      line("revenue", "minus", 40, "Other"),
      line("cost", "minus", 300, "POD Delay Submission"),
      line("cost", "plus", 120, "Other"),
      line("cost", "minus", 999, "Damages / Missing", { voided_at: "2026-10-14T01:00:00Z" } as Partial<TripAdjustment>),
    ];
    const { client, vendor } = podChargesFromAdjustments({ clientPrice: 6047, supplierRate: 5250, adjustments });
    expect(netChargeTotal(client)).toBe(adjustedRevenue(6047, adjustments));
    expect(netChargeTotal(vendor)).toBe(adjustedCost(5250, adjustments));
  });

  it("vendor-only deductions fall back to Damage on the client side", () => {
    const { client } = podChargesFromAdjustments({
      clientPrice: 1000,
      supplierRate: 0,
      adjustments: [line("revenue", "minus", 10, "Document Cost")],
    });
    expect(client.documentCost).toBe(0);
    expect(client.damage).toBe(10);
  });
});
