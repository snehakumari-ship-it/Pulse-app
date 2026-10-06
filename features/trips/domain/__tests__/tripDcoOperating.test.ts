import { isDcoOperatingTrip } from "@/features/trips/domain/tripDcoOperating";
import { getTripExecutionModel } from "@/features/trips/domain/tripExecutionModel";
import { getTripOperationalCapabilities } from "@/features/trips/capabilities/capabilityEngine";
import { decideFuelPostingRule } from "@/features/ledger/vehicle/vehiclePostingRules";
import { defaultPaymentOwnerForTrip } from "@/features/trips/operations/shared/operationsEntryOptions";
import { driverOpsTripCapabilities } from "@/features/driver/utils/driverActiveOpsTrip.util";
import { tripEarningsDetailForDriver } from "@/features/drivers/utils/driverUtils.util";
import { tripPayableCostTarget } from "@/features/finance/utils/tripSettlement.util";
import { selectOperationsHubSections } from "@/features/trips/capabilities/selectors";
import type { TripRow } from "@/features/trips/services/trips.service";

function trip(overrides: Partial<TripRow> = {}): TripRow {
  return {
    id: "trip-1",
    organization_id: "org-1",
    ...overrides,
  } as TripRow;
}

describe("isDcoOperatingTrip", () => {
  it("recognizes only operating_mode DCO", () => {
    expect(isDcoOperatingTrip({ operating_mode: "DCO" })).toBe(true);
    expect(isDcoOperatingTrip({ operating_mode: "dco" })).toBe(true);
    expect(isDcoOperatingTrip({ operating_mode: "FLEET" })).toBe(false);
    expect(isDcoOperatingTrip({ operating_mode: null })).toBe(false);
    expect(isDcoOperatingTrip({})).toBe(false);
  });

  it("does not infer DCO from missing supplier or market payout", () => {
    const inferred = trip({
      supplier_id: null,
      trip_payout_mode: "market",
      source: "market_bid",
      operating_mode: "FLEET",
    });
    expect(isDcoOperatingTrip(inferred)).toBe(false);
  });
});

describe("DCO vs Asset vs Market classification", () => {
  it("keeps a normal Asset trip as asset with org vehicle P&L", () => {
    const asset = trip({
      driver_id: "d1",
      vehicle_id: "v1",
      trip_payout_mode: "asset",
      operating_mode: "FLEET",
    });
    expect(getTripExecutionModel(asset)).toBe("asset");
    expect(isDcoOperatingTrip(asset)).toBe(false);
    const caps = getTripOperationalCapabilities(asset);
    expect(caps.canTrackFuel).toBe(true);
    expect(caps.canTrackVehicleEconomics).toBe(true);
    expect(caps.operationalOwner).toBe("organization_vehicle");
    expect(
      decideFuelPostingRule({
        trip: asset,
        candidate: {
          sourceType: "fuel",
          sourceId: "f1",
          amount: 100,
          tripId: asset.id,
          paymentOwner: "organization",
          approvalState: "approved",
          ledgerState: "not_posted",
        },
      }),
    ).toBe("post_vehicle_expense");
  });

  it("keeps a normal supplier Market trip as aggregate", () => {
    const market = trip({
      supplier_id: "sup-1",
      trip_payout_mode: "market",
      operating_mode: "FLEET",
    });
    expect(getTripExecutionModel(market)).toBe("aggregate");
    expect(isDcoOperatingTrip(market)).toBe(false);
    const caps = getTripOperationalCapabilities(market);
    expect(caps.canTrackFuel).toBe(false);
    expect(caps.canTrackVehicleEconomics).toBe(false);
    expect(selectOperationsHubSections(market)).not.toContain("Fuel");
  });

  it("gives DCO asset-like capture without org vehicle P&L even if payout is market", () => {
    const dco = trip({
      operating_mode: "DCO",
      dco_payee_id: "payee-1",
      supplier_id: null,
      trip_payout_mode: "market",
      source: "market_bid",
      supplier_rate: 12000,
      driver_commission: 0,
      client_price: 15000,
    });
    expect(isDcoOperatingTrip(dco)).toBe(true);
    expect(getTripExecutionModel(dco)).toBe("aggregate");
    const caps = getTripOperationalCapabilities(dco);
    expect(caps.canTrackFuel).toBe(true);
    expect(caps.canTrackToll).toBe(true);
    expect(caps.canTrackMileage).toBe(true);
    expect(caps.canTrackVehicleEconomics).toBe(false);
    expect(caps.operationalOwner).toBe("dco_owned");
    expect(defaultPaymentOwnerForTrip(dco, "user")).toBe("driver");
    expect(
      decideFuelPostingRule({
        trip: dco,
        candidate: {
          sourceType: "fuel",
          sourceId: "f1",
          amount: 100,
          tripId: dco.id,
          paymentOwner: "driver",
          approvalState: "approved",
          ledgerState: "not_posted",
        },
      }),
    ).toBe("skip");
    const ops = driverOpsTripCapabilities(dco);
    expect(ops.showExpense).toBe(true);
    expect(ops.showOdometer).toBe(true);
    expect(selectOperationsHubSections(dco)).toEqual(
      expect.arrayContaining(["Verification", "Fuel", "Toll", "Mileage"]),
    );
    expect(selectOperationsHubSections(dco)).not.toContain("Vehicle Economics");
    const earnings = tripEarningsDetailForDriver(dco);
    expect(earnings.isEstimated).toBe(false);
    expect(earnings.basis).toBe("dco_settlement");
    expect(earnings.amount).toBe(12000);
    expect(tripPayableCostTarget(dco, "org-1")).toBe(12000);
  });

  it("does not treat DCO as org Asset economics when supplier_id is absent", () => {
    const dco = trip({
      operating_mode: "DCO",
      dco_payee_id: "payee-1",
      supplier_id: null,
      trip_payout_mode: null,
      source: "market_bid",
    });
    expect(getTripExecutionModel(dco)).toBe("asset");
    const caps = getTripOperationalCapabilities(dco);
    expect(caps.canTrackFuel).toBe(true);
    expect(caps.canTrackVehicleEconomics).toBe(false);
    expect(caps.accountingMode).toBe("dco_operations");
    expect(defaultPaymentOwnerForTrip(dco, "user")).toBe("driver");
    expect(
      decideFuelPostingRule({
        trip: dco,
        candidate: {
          sourceType: "fuel",
          sourceId: "f1",
          amount: 100,
          tripId: dco.id,
          paymentOwner: "driver",
          approvalState: "approved",
          ledgerState: "not_posted",
        },
      }),
    ).toBe("skip");
  });

  it("keeps Asset org-paid posting and org default owner", () => {
    const asset = trip({
      driver_id: "d1",
      vehicle_id: "v1",
      trip_payout_mode: "asset",
      operating_mode: "FLEET",
    });
    expect(defaultPaymentOwnerForTrip(asset, "user")).toBe("organization");
    expect(
      decideFuelPostingRule({
        trip: asset,
        candidate: {
          sourceType: "fuel",
          sourceId: "f1",
          amount: 100,
          tripId: asset.id,
          paymentOwner: "driver",
          approvalState: "approved",
          ledgerState: "not_posted",
        },
      }),
    ).toBe("post_vehicle_expense");
  });
});
