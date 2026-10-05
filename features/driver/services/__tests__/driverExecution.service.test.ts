import {
  applyDriverCommandResult,
  driverCommandErrorMessage,
  executeDriverCommand,
} from "@/features/driver/services/driverExecution.service";

const mockRpc = jest.fn();
const mockPublish = jest.fn().mockResolvedValue(undefined);

jest.mock("@/lib/supabase", () => ({
  supabase: () => ({ rpc: mockRpc }),
}));

jest.mock("@/lib/platform/events/InProcessEventBus", () => ({
  getPlatformEventBus: () => ({ publish: mockPublish }),
}));

jest.mock("@/lib/uuidv7", () => ({ uuidv7: () => "generated-id" }));

const okStart = {
  ok: true,
  applied: true,
  replayed: false,
  command: "START_TRIP",
  trip_id: "trip-1",
  organization_id: "org-1",
  experience: "core",
  previous_status: "assigned",
  trip_status: "in_progress",
  started_at: "2026-10-06T00:00:00.000Z",
  completed_at: null,
  updated_at: "2026-10-06T00:00:00.000Z",
  allowed_commands: ["DEPART_PICKUP", "UNDO_STEP", "RECORD_ODOMETER"],
};

describe("executeDriverCommand", () => {
  beforeEach(() => jest.clearAllMocks());

  it("sends intent only — command, id, expected status, payload — to driver_execute_command", async () => {
    mockRpc.mockResolvedValue({ data: okStart, error: null });

    await executeDriverCommand({
      tripId: "trip-1",
      command: "START_TRIP",
      expectedStatus: "assigned",
      commandId: "cmd-1",
    });

    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith("driver_execute_command", {
      p_trip_id: "trip-1",
      p_command: "START_TRIP",
      p_command_id: "cmd-1",
      p_expected_status: "assigned",
      p_payload: {},
    });
  });

  it("generates a command id when the caller does not supply one", async () => {
    mockRpc.mockResolvedValue({ data: okStart, error: null });

    await executeDriverCommand({ tripId: "trip-1", command: "START_TRIP" });

    expect(mockRpc.mock.calls[0][1].p_command_id).toBe("generated-id");
    expect(mockRpc.mock.calls[0][1].p_expected_status).toBeNull();
  });

  it("maps a server rejection to a coded error with the driver-facing message", async () => {
    mockRpc.mockResolvedValue({
      data: { ok: false, command: "COMPLETE_TRIP", error_code: "pod_required", trip_status: "at_drop" },
      error: null,
    });

    const { error, result } = await executeDriverCommand({ tripId: "trip-1", command: "COMPLETE_TRIP" });

    expect(error?.code).toBe("pod_required");
    expect(error?.message).toBe("Upload proof of delivery before completing this trip.");
    expect(result?.trip_status).toBe("at_drop");
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it("surfaces transport errors as rpc_error", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "permission denied for function driver_execute_command" } });

    const { error, result } = await executeDriverCommand({ tripId: "trip-1", command: "START_TRIP" });

    expect(error?.code).toBe("rpc_error");
    expect(error?.message).toContain("permission denied");
    expect(result).toBeNull();
  });

  it("publishes TripStarted once for an applied first start, never for a replay", async () => {
    mockRpc.mockResolvedValueOnce({ data: okStart, error: null });
    await executeDriverCommand({ tripId: "trip-1", command: "START_TRIP" }, {
      indent_id: "ind-1",
      driver_id: "drv-1",
      vehicle_id: "veh-1",
    });
    expect(mockPublish).toHaveBeenCalledTimes(1);
    expect(mockPublish.mock.calls[0][0]).toMatchObject({
      name: "TripStarted",
      workspaceId: "org-1",
      payload: { tripId: "trip-1", indentId: "ind-1", driverId: "drv-1", vehicleId: "veh-1" },
    });

    mockRpc.mockResolvedValueOnce({ data: { ...okStart, replayed: true }, error: null });
    await executeDriverCommand({ tripId: "trip-1", command: "START_TRIP" });
    mockRpc.mockResolvedValueOnce({ data: { ...okStart, applied: false }, error: null });
    await executeDriverCommand({ tripId: "trip-1", command: "START_TRIP" });
    expect(mockPublish).toHaveBeenCalledTimes(1);
  });

  it("publishes TripDelivered for an applied completion", async () => {
    mockRpc.mockResolvedValue({
      data: {
        ...okStart,
        command: "COMPLETE_TRIP",
        previous_status: "at_drop",
        trip_status: "completed",
        completed_at: "2026-10-06T01:00:00.000Z",
      },
      error: null,
    });

    await executeDriverCommand({ tripId: "trip-1", command: "COMPLETE_TRIP" });

    expect(mockPublish).toHaveBeenCalledTimes(1);
    expect(mockPublish.mock.calls[0][0]).toMatchObject({
      name: "TripDelivered",
      payload: { tripId: "trip-1", deliveredAt: "2026-10-06T01:00:00.000Z" },
    });
  });

  it("publishes from the trip transition the server reports, including stop commands", async () => {
    mockRpc.mockResolvedValueOnce({
      data: { ...okStart, command: "ARRIVE_STOP", trip_started: true },
      error: null,
    });
    await executeDriverCommand({ tripId: "trip-1", command: "ARRIVE_STOP", payload: { stop_id: "s1" } });
    mockRpc.mockResolvedValueOnce({
      data: {
        ...okStart,
        command: "COMPLETE_STOP",
        previous_status: "in_progress",
        trip_status: "completed",
        trip_completed: true,
        completed_at: "2026-10-06T02:00:00.000Z",
      },
      error: null,
    });
    await executeDriverCommand({ tripId: "trip-1", command: "COMPLETE_STOP", payload: { stop_id: "s3" } });
    mockRpc.mockResolvedValueOnce({
      data: { ...okStart, command: "COMPLETE_STOP", previous_status: "in_progress", trip_status: "in_progress" },
      error: null,
    });
    await executeDriverCommand({ tripId: "trip-1", command: "COMPLETE_STOP", payload: { stop_id: "s2" } });

    expect(mockPublish.mock.calls.map(([event]) => event.name)).toEqual(["TripStarted", "TripDelivered"]);
  });

  it("sends ACCEPT_TRIP as intent only and publishes no lifecycle event", async () => {
    mockRpc.mockResolvedValue({
      data: {
        ...okStart,
        command: "ACCEPT_TRIP",
        previous_status: "draft",
        trip_status: "assigned",
        started_at: null,
        allowed_commands: ["START_TRIP", "RECORD_ODOMETER"],
      },
      error: null,
    });

    const { error, result } = await executeDriverCommand(
      { tripId: "trip-1", command: "ACCEPT_TRIP" },
      { indent_id: null, driver_id: "drv-1", vehicle_id: "veh-1" },
    );

    expect(mockRpc).toHaveBeenCalledWith("driver_execute_command", {
      p_trip_id: "trip-1",
      p_command: "ACCEPT_TRIP",
      p_command_id: "generated-id",
      p_expected_status: null,
      p_payload: {},
    });
    expect(error).toBeNull();
    expect(result?.trip_status).toBe("assigned");
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it("maps an ACCEPT_TRIP rejection to the driver-facing message", async () => {
    mockRpc.mockResolvedValue({
      data: { ok: false, command: "ACCEPT_TRIP", error_code: "not_assigned_driver" },
      error: null,
    });

    const { error } = await executeDriverCommand({ tripId: "trip-1", command: "ACCEPT_TRIP" });

    expect(error?.code).toBe("not_assigned_driver");
    expect(error?.message).toBe("You are not the assigned driver for this trip.");
  });

  it("maps the Commerce stop rejections to driver-facing messages", () => {
    expect(driverCommandErrorMessage("stop_out_of_order")).toBe("Finish the earlier stops on this route first.");
    expect(driverCommandErrorMessage("stop_not_found")).toBe("This stop is not part of the trip.");
    expect(driverCommandErrorMessage("command_not_enabled")).toBe("This action is not available yet.");
  });
});

describe("applyDriverCommandResult", () => {
  it("takes status and timestamps from the server, keeping the rest of the row", () => {
    const local = {
      id: "trip-1",
      status: "in_progress",
      started_at: "client-time",
      completed_at: null,
      client_price: 52000,
    };

    const merged = applyDriverCommandResult(local, {
      ...okStart,
      command: "UNDO_STEP",
      trip_status: "assigned",
      started_at: null,
    });

    expect(merged).toEqual({
      id: "trip-1",
      status: "assigned",
      started_at: null,
      completed_at: null,
      updated_at: "2026-10-06T00:00:00.000Z",
      client_price: 52000,
    });
  });
});
