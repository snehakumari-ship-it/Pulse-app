import {
  computeTripSettlementDues,
  rollupTripSettlementLedger,
  tripPayableCostTarget,
} from "@/features/finance/utils/tripSettlement.util";
import type { LedgerRow } from "@/features/finance/services/finance.service";
import type { TripRow } from "@/features/trips/services/trips.service";

function trip(overrides: Partial<TripRow> = {}): TripRow {
  return {
    id: "trip-1",
    organization_id: "org-1",
    client_price: 15000,
    supplier_rate: 0,
    driver_id: "driver-1",
    trip_payout_mode: "asset",
    amount_paid: 0,
    ...overrides,
  } as TripRow;
}

function ledger(partial: Partial<LedgerRow>): LedgerRow {
  return {
    id: "tx-1",
    trip_id: "trip-1",
    amount_in: 0,
    amount_out: 0,
    ...partial,
  } as LedgerRow;
}

describe("tripSettlement.util", () => {
  it("counts driver commission as asset payable target", () => {
    const target = tripPayableCostTarget(
      trip(),
      "org-1",
      null,
      { commissionPercent: 10, payableAmount: null, commissionPerKm: null },
    );
    expect(target).toBe(1500);
  });

  it("uses driver-tagged payouts for asset payable due", () => {
    const settlement = computeTripSettlementDues({
      trip: trip(),
      viewerOrgId: "org-1",
      ledgerEntries: [
        ledger({
          id: "in-1",
          contact_type: "client",
          amount_in: 21000,
        }),
        ledger({
          id: "out-1",
          contact_type: "driver",
          amount_out: 500,
        }),
      ],
      driverOffer: {
        commissionPercent: 10,
        payableAmount: null,
        commissionPerKm: null,
      },
    });

    expect(settlement.receivableTarget).toBe(15000);
    expect(settlement.receivableDue).toBe(0);
    expect(settlement.payableTarget).toBe(1500);
    expect(settlement.payableDue).toBe(1000);
    expect(settlement.payablePaid).toBe(500);
  });

  it("reflects the aggregator's supplier payout as received in the partner view", () => {
    // Aggregator (org-1) owns the trip and paid the awarded supplier (org-2)
    // ₹63,000 (stored as a supplier-tagged amount_out on the owner's books).
    // The partner viewing this trip should see ₹63,000 as received.
    const partnerTrip = trip({
      organization_id: "org-1",
      indent_id: "indent-1",
      trip_payout_mode: "market",
      supplier_rate: 70000,
      client_price: 80000,
    });
    const settlement = computeTripSettlementDues({
      trip: partnerTrip,
      viewerOrgId: "org-2", // awarded supplier (partner), not the owner
      ledgerEntries: [
        ledger({ id: "out-63k", contact_type: "supplier", amount_out: 63000 }),
      ],
    });
    // Partner receivable target = supplier_rate ₹70k; received = ₹63k; due ₹7k.
    expect(settlement.receivableTarget).toBe(70000);
    expect(settlement.clientReceived).toBe(63000);
    expect(settlement.receivableDue).toBe(7000);
    expect(settlement.payableTarget).toBe(0);
    expect(settlement.payableDue).toBe(0);
  });

  it("does not treat supplier payout as received for the trip owner", () => {
    const ownerTrip = trip({
      organization_id: "org-1",
      indent_id: "indent-1",
      trip_payout_mode: "market",
      supplier_rate: 70000,
      client_price: 80000,
    });
    const settlement = computeTripSettlementDues({
      trip: ownerTrip,
      viewerOrgId: "org-1", // the owner
      ledgerEntries: [
        ledger({ id: "out-63k", contact_type: "supplier", amount_out: 63000 }),
      ],
    });
    // Owner's payout is NOT a receipt; clientReceived stays 0.
    expect(settlement.clientReceived).toBe(0);
    expect(settlement.payablePaid).toBe(63000);
  });

  it("uses DCO settlement (supplier_rate + dco ledger) instead of driver commission", () => {
    const dcoTrip = trip({
      operating_mode: "DCO",
      dco_payee_id: "payee-1",
      supplier_id: null,
      trip_payout_mode: "market",
      supplier_rate: 19000,
      driver_commission: 0,
      client_price: 25000,
    });
    expect(tripPayableCostTarget(dcoTrip, "org-1")).toBe(19000);
    const settlement = computeTripSettlementDues({
      trip: dcoTrip,
      viewerOrgId: "org-1",
      ledgerEntries: [
        ledger({
          id: "dco-out",
          contact_type: "dco",
          amount_out: 5000,
        }),
      ],
    });
    expect(settlement.payableTarget).toBe(19000);
    expect(settlement.payablePaid).toBe(5000);
    expect(settlement.payableDue).toBe(14000);
  });

  it("counts confirmed Exchange payments to the DCO payee on a Marketplace DCO award", () => {
    const exchangeDcoTrip = trip({
      operating_mode: "DCO",
      dco_payee_id: "payee-1",
      supplier_id: null,
      source: "market_bid",
      trip_payout_mode: "market",
      supplier_rate: 15000,
      driver_commission: 0,
      client_price: 17000,
    });
    const settlement = computeTripSettlementDues({
      trip: exchangeDcoTrip,
      viewerOrgId: "org-1",
      ledgerEntries: [
        ledger({ id: "exp", contact_type: "dco", amount_out: 7000 }),
        ledger({ id: "other", contact_type: "supplier", amount_out: 900 }),
      ],
    });
    expect(settlement.payableTarget).toBe(15000);
    expect(settlement.payablePaid).toBe(7000);
    expect(settlement.payableDue).toBe(8000);
  });

  it("rolls client receipts separately from other inflows", () => {
    const rollup = rollupTripSettlementLedger(
      [
        ledger({ id: "a", contact_type: "client", amount_in: 12000 }),
        ledger({ id: "b", contact_type: "driver", amount_in: 3000 }),
      ],
      { amountPaidFallback: 15000 },
    );
    expect(rollup.clientReceived).toBe(15000);
  });
});
