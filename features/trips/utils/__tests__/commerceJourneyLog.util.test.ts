import type { DriverStopExecutionStop } from "@/features/driver/execution/driverStopExecution.types";
import {
  buildCommerceManifestJourneyLogs,
  getCommerceManifestStepIndex,
  isCommerceJourney,
} from "@/features/trips/utils/commerceJourneyLog.util";
import {
  buildManifestJourneyLogs,
  getVisibleManifestJourneyLogs,
} from "@/features/trips/utils/manifestJourneyLog.util";
import type { TripRow } from "@/features/trips/services/trips.service";

function stop(
  sequence: number,
  stopType: string,
  displayName: string,
  patch: Partial<DriverStopExecutionStop> = {},
): DriverStopExecutionStop {
  return {
    stopId: `s${sequence}`,
    sequence,
    stopType,
    displayName,
    addressLine: null,
    city: "Chennai",
    state: "Tamil Nadu",
    pincode: null,
    latitude: null,
    longitude: null,
    contactName: null,
    contactPhone: null,
    podRequired: false,
    status: "pending",
    driverId: null,
    arrivedAt: null,
    completedAt: null,
    skipReason: null,
    failureReason: null,
    ...patch,
  };
}

const trip = {
  status: "in_progress",
  pickup_area: "Chennai",
  drop_location: "Chennai",
  started_at: "2026-10-07T11:15:00.000Z",
  completed_at: null,
  updated_at: "2026-10-07T11:15:00.000Z",
  created_at: "2026-10-07T10:00:00.000Z",
  driver_id: "driver-1",
} as TripRow;

function journey(stops: DriverStopExecutionStop[], tr: TripRow = trip) {
  const ftlLogs = buildManifestJourneyLogs({ trip: tr, assignmentAuditRows: [] });
  const logs = buildCommerceManifestJourneyLogs({ trip: tr, stops, ftlLogs });
  const index = getCommerceManifestStepIndex(tr, stops, 2);
  return { logs, index, visible: getVisibleManifestJourneyLogs(logs, index) };
}

describe("commerce manifest journey", () => {
  it("needs at least two stops", () => {
    expect(isCommerceJourney([stop(1, "pickup", "Hub")])).toBe(false);
    expect(
      isCommerceJourney([stop(1, "pickup", "Hub"), stop(2, "drop", "A")]),
    ).toBe(true);
  });

  it("shows Loading while the driver is at the first pickup", () => {
    const { visible, index } = journey([
      stop(1, "pickup", "Hub", { status: "arrived", arrivedAt: "2026-10-07T11:20:00.000Z" }),
      stop(2, "drop", "Store A"),
      stop(3, "drop", "Store B"),
    ]);
    expect(index).toBe(2);
    expect(visible.map((l) => l.status)).toEqual([
      "Assigned",
      "Driver Accepted",
      "Loading",
    ]);
  });

  it("treats every stop between the first and last as in transit", () => {
    const { visible, index } = journey([
      stop(1, "pickup", "Hub", { status: "completed", completedAt: "2026-10-07T11:40:00.000Z" }),
      stop(2, "drop", "Store A", { status: "completed", completedAt: "2026-10-07T12:10:00.000Z" }),
      stop(3, "drop", "Store B"),
      stop(4, "drop", "Store C"),
    ]);
    expect(index).toBe(3);
    const transit = visible[visible.length - 1]!;
    expect(transit.status).toBe("In-Transit");
    expect(transit.location).toBe("2 stops en route · Next: Store B");
    expect(transit.details).toContain("1 of 2 en-route stops done");
    expect(visible.find((l) => l.stepKey === "loading")?.status).toBe("Loaded");
  });

  it("shows Unloading at the last stop, then Completed", () => {
    const arrived = journey([
      stop(1, "pickup", "Hub", { status: "completed", completedAt: "2026-10-07T11:40:00.000Z" }),
      stop(2, "drop", "Store A", { status: "arrived", arrivedAt: "2026-10-07T12:30:00.000Z" }),
    ]);
    expect(arrived.index).toBe(4);
    expect(arrived.visible[arrived.visible.length - 1]?.status).toBe("Unloading");

    const done = journey([
      stop(1, "pickup", "Hub", { status: "completed", completedAt: "2026-10-07T11:40:00.000Z" }),
      stop(2, "drop", "Store A", {
        status: "completed",
        arrivedAt: "2026-10-07T12:30:00.000Z",
        completedAt: "2026-10-07T12:45:00.000Z",
      }),
    ]);
    expect(done.index).toBe(5);
    expect(done.visible.map((l) => l.status)).toEqual([
      "Assigned",
      "Driver Accepted",
      "Loaded",
      "In-Transit",
      "Unloaded",
      "Completed",
    ]);
  });
});
