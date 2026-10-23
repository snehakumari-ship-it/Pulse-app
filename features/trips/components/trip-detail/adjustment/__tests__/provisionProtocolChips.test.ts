import {
  ASSET_DRIVER_DEDUCTION_PROTOCOL_CHIPS,
  ASSET_DRIVER_PAYMENT_PROTOCOL_CHIPS,
  protocolAssetDriverDeductionAdjustment,
  protocolAssetDriverPaymentAdjustment,
  provisionProtocolChips,
  reasonAfterLaneImpactChange,
} from "@/features/trips/components/trip-detail/adjustment/tripAdjustmentFlow.util";
import {
  adjustedCost,
  adjustedRevenue,
  ASSET_DRIVER_DEDUCTION_REASON_OPTIONS,
  ASSET_DRIVER_PAYMENT_REASON_OPTIONS,
  getAdjustmentReasonOptions,
  type TripAdjustment,
} from "@/features/trips/services/tripAdjustments";

jest.mock("@/lib/supabase", () => ({ supabase: jest.fn() }));

const COST_CN = ["Late Delivery", "Damages / Missing", "POD Delay Submission", "Document Cost", "Other"];
const COST_DN = ["Fuel Escalation", "Detention", "Loading Charges", "Unloading Charges", "Pass Debit", "Other"];
const SALE_CN = ["Late Delivery", "Damages / Missing", "Other"];
const SALE_DN = ["Loading Charges", "Unloading Charges", "Detention", "Other"];

const withoutOther = (list: string[]) => list.filter((r) => r !== "Other");
const chipLabels = (type: "revenue" | "cost", impact: "plus" | "minus") =>
  provisionProtocolChips(type, impact).map((c) => c.label);

describe("CN/DN reason categories", () => {
  it("cost CN shows only its approved categories", () => {
    expect([...getAdjustmentReasonOptions({ type: "cost", impact: "minus" })]).toEqual(COST_CN);
    expect(chipLabels("cost", "minus")).toEqual(withoutOther(COST_CN));
  });

  it("cost DN shows only its approved categories", () => {
    expect([...getAdjustmentReasonOptions({ type: "cost", impact: "plus" })]).toEqual(COST_DN);
    expect(chipLabels("cost", "plus")).toEqual(withoutOther(COST_DN));
    expect(chipLabels("cost", "plus")).not.toContain("Damages / Missing");
  });

  it("revenue CN and DN show their own categories", () => {
    expect([...getAdjustmentReasonOptions({ type: "revenue", impact: "minus" })]).toEqual(SALE_CN);
    expect([...getAdjustmentReasonOptions({ type: "revenue", impact: "plus" })]).toEqual(SALE_DN);
    expect(chipLabels("revenue", "minus")).toEqual(withoutOther(SALE_CN));
    expect(chipLabels("revenue", "plus")).toEqual(withoutOther(SALE_DN));
  });

  it("switching CN ↔ DN swaps the chips and drops a reason the new side doesn't offer", () => {
    expect(chipLabels("cost", "minus")).not.toEqual(chipLabels("cost", "plus"));
    expect(
      reasonAfterLaneImpactChange({ type: "cost", impact: "plus", reason: "Damages / Missing" }),
    ).toBe("");
    expect(
      reasonAfterLaneImpactChange({ type: "cost", impact: "minus", reason: "Fuel Escalation" }),
    ).toBe("");
    // Shared reasons survive the switch.
    expect(reasonAfterLaneImpactChange({ type: "cost", impact: "minus", reason: "Other" })).toBe("Other");
    expect(
      reasonAfterLaneImpactChange({ type: "revenue", impact: "plus", reason: "Detention" }),
    ).toBe("Detention");
  });

  it("each chip presets the matching reason, lane and impact", () => {
    for (const type of ["revenue", "cost"] as const) {
      for (const impact of ["plus", "minus"] as const) {
        const options = getAdjustmentReasonOptions({ type, impact }) as readonly string[];
        for (const chip of provisionProtocolChips(type, impact)) {
          expect(chip.preset).toEqual({ type, impact, reasonSeed: chip.label });
          expect(options).toContain(chip.preset.reasonSeed);
        }
      }
    }
  });

  it("asset-driver protocols are unchanged", () => {
    expect(getAdjustmentReasonOptions({ type: "cost", isAssetDriverCost: true, impact: "minus" })).toBe(
      ASSET_DRIVER_DEDUCTION_REASON_OPTIONS,
    );
    expect(getAdjustmentReasonOptions({ type: "cost", isAssetDriverCost: true, impact: "plus" })).toBe(
      ASSET_DRIVER_PAYMENT_REASON_OPTIONS,
    );
    for (const chip of ASSET_DRIVER_DEDUCTION_PROTOCOL_CHIPS) {
      expect(protocolAssetDriverDeductionAdjustment(chip)).toMatchObject({ type: "cost", impact: "minus" });
    }
    for (const chip of ASSET_DRIVER_PAYMENT_PROTOCOL_CHIPS) {
      expect(protocolAssetDriverPaymentAdjustment(chip)).toMatchObject({ type: "cost", impact: "plus" });
    }
  });

  it("saved provisions keep their signed direction", () => {
    const line = (type: "revenue" | "cost", impact: "plus" | "minus", amount: number): TripAdjustment => ({
      id: `${type}-${impact}`,
      trip_id: "t1",
      type,
      impact,
      amount,
      reason: "x",
      created_at: "2026-10-14T00:00:00Z",
    });
    expect(adjustedCost(5250, [line("cost", "minus", 300)])).toBe(4950);
    expect(adjustedCost(5250, [line("cost", "plus", 300)])).toBe(5550);
    expect(adjustedRevenue(6047, [line("revenue", "minus", 47)])).toBe(6000);
    expect(adjustedRevenue(6047, [line("revenue", "plus", 53)])).toBe(6100);
  });
});
