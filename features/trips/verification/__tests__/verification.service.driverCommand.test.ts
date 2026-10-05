import {
  saveTripVerification,
  saveTripVerificationBoth,
} from "@/features/trips/verification/verification.service";

const mockRpc = jest.fn();
const mockUpdate = jest.fn();
const mockAppendTimeline = jest.fn().mockResolvedValue(undefined);

function mockTripsTable() {
  const chain: Record<string, jest.Mock> = {};
  chain.select = jest.fn(() => chain);
  chain.eq = jest.fn(() => chain);
  chain.maybeSingle = jest.fn().mockResolvedValue({
    data: {
      id: "trip-1",
      organization_id: "org-1",
      start_odometer_km: 100,
      end_odometer_km: null,
      gps_distance_km: null,
      odometer_verification_state: "partial",
    },
    error: null,
  });
  chain.update = jest.fn((updates: unknown) => {
    mockUpdate(updates);
    return chain;
  });
  return chain;
}

jest.mock("@/lib/supabase", () => ({
  supabase: () => ({ rpc: mockRpc, from: () => mockTripsTable() }),
}));

jest.mock("@/lib/platform/events/InProcessEventBus", () => ({
  getPlatformEventBus: () => ({ publish: jest.fn().mockResolvedValue(undefined) }),
}));

jest.mock("@/features/trips/operations/timeline/timelineEvents.service", () => ({
  appendTripOperationalTimelineEventSafe: (...args: unknown[]) => mockAppendTimeline(...args),
}));

const odometerOk = {
  ok: true,
  applied: true,
  replayed: false,
  command: "RECORD_ODOMETER",
  trip_id: "trip-1",
  organization_id: "org-1",
  trip_status: "in_progress",
  odometer: {
    start_odometer_km: 12345.7,
    end_odometer_km: null,
    odometer_distance_km: null,
    gps_distance_km: null,
    distance_discrepancy_km: null,
    distance_source: null,
    odometer_verification_state: "partial",
    odometer_notes: null,
    odometer_updated_by: "driver-user",
    odometer_updated_at: "2026-10-06T00:00:00.000Z",
  },
};

describe("odometer writes — driver command path", () => {
  beforeEach(() => jest.clearAllMocks());

  it("assigned driver: sends RECORD_ODOMETER and never writes trips directly", async () => {
    mockRpc.mockResolvedValue({ data: odometerOk, error: null });

    const res = await saveTripVerification({
      tripId: "trip-1",
      side: "start",
      odometerKm: 12345.67,
      notes: " ",
      updatedBy: "driver-user",
      commandId: "cmd-odo-1",
    });

    expect(res.error).toBeNull();
    expect(mockRpc).toHaveBeenCalledWith("driver_execute_command", {
      p_trip_id: "trip-1",
      p_command: "RECORD_ODOMETER",
      p_command_id: "cmd-odo-1",
      p_expected_status: null,
      p_payload: { side: "start", odometer_km: 12345.7, notes: " " },
    });
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockAppendTimeline).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "odometer_added", organizationId: "org-1", tripId: "trip-1" }),
    );
  });

  it("does not append timeline events for a replayed command", async () => {
    mockRpc.mockResolvedValue({ data: { ...odometerOk, replayed: true }, error: null });

    await saveTripVerification({ tripId: "trip-1", side: "start", odometerKm: 1, updatedBy: "u" });

    expect(mockAppendTimeline).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("server rejection for the driver is returned, not retried as a direct write", async () => {
    mockRpc.mockResolvedValue({
      data: { ok: false, command: "RECORD_ODOMETER", error_code: "invalid_payload" },
      error: null,
    });

    const res = await saveTripVerification({ tripId: "trip-1", side: "end", odometerKm: 5, updatedBy: "u" });

    expect(res.error?.message).toBe("Some of the values entered are not valid.");
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("not the trip's driver (office / staff): falls back to the existing direct write", async () => {
    mockRpc.mockResolvedValue({
      data: { ok: false, command: "RECORD_ODOMETER", error_code: "not_assigned_driver" },
      error: null,
    });

    await saveTripVerification({ tripId: "trip-1", side: "end", odometerKm: 150, updatedBy: "staff-user" });

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate.mock.calls[0][0]).toMatchObject({
      start_odometer_km: 100,
      end_odometer_km: 150,
      odometer_distance_km: 50,
      odometer_updated_by: "staff-user",
    });
  });

  it("business verification is office-only and skips the driver command", async () => {
    await saveTripVerification({
      tripId: "trip-1",
      side: "end",
      odometerKm: 150,
      updatedBy: "staff-user",
      markBusinessVerified: true,
    });

    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockUpdate.mock.calls[0][0]).toMatchObject({ odometer_verification_state: "business_verified" });
  });

  it("both readings go through one RECORD_ODOMETER with side=both", async () => {
    mockRpc.mockResolvedValue({ data: odometerOk, error: null });

    await saveTripVerificationBoth({
      tripId: "trip-1",
      startOdometerKm: 100,
      endOdometerKm: 154.36,
      gpsDistanceKm: 50,
      updatedBy: "driver-user",
    });

    expect(mockRpc.mock.calls[0][1].p_payload).toEqual({
      side: "both",
      start_odometer_km: 100,
      end_odometer_km: 154.4,
      gps_distance_km: 50,
      notes: null,
    });
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
