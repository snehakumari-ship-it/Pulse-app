import { act, renderHook, waitFor } from "@testing-library/react-native";
import { useTripControl } from "@/features/drivers/hooks/useTripControl";

const mockExecute = jest.fn();
const mockUpdateTripStatus = jest.fn();
const mockTripRow = {
  id: "trip-1",
  status: "at_drop",
  organization_id: "org-1",
  driver_id: "drv-1",
  vehicle_id: "veh-1",
  indent_id: null,
  started_at: "2026-10-06T00:00:00.000Z",
  completed_at: null,
};

jest.mock("@/features/driver/services/driverExecution.service", () => ({
  executeDriverCommand: (...args: unknown[]) => mockExecute(...args),
  applyDriverCommandResult: (trip: object, result: { trip_status: string; completed_at?: string | null }) => ({
    ...trip,
    status: result.trip_status,
    completed_at: result.completed_at ?? null,
  }),
}));

jest.mock("@/features/trips/services/trips.service", () => ({
  getDriverTripById: async () => ({ trip: mockTripRow }),
  driverRowToTripRow: (row: object) => row,
  updateTripStatus: (...args: unknown[]) => mockUpdateTripStatus(...args),
}));

jest.mock("@/features/drivers/services/drivers.service", () => ({
  getAcceptedDriverOfferForOrganization: async () => ({ offer: null }),
  getDriverById: async () => ({ driver: null }),
}));

jest.mock("@/features/drivers/services/tripControlProgress.storage", () => ({
  clearLrPhase: () => undefined,
  hasEnteredLrPhase: async () => false,
  markLrPhaseEntered: () => undefined,
}));

jest.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { uid: "driver-user" } }) }));
jest.mock("@/lib/queries/useInvalidateDriverHomeDashboard", () => ({
  useInvalidateDriverHomeDashboard: () => jest.fn(),
}));
jest.mock("@/lib/queries/useDriverUiTripsQuery", () => ({ driverUiTripsQueryKey: (uid: string) => ["driver-ui", uid] }));
jest.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: jest.fn() }) }));

describe("useTripControl — driver writes go through the execution authority", () => {
  beforeEach(() => jest.clearAllMocks());

  it("completeTrip sends COMPLETE_TRIP with the current status and never calls updateTripStatus", async () => {
    mockExecute.mockResolvedValue({
      error: null,
      result: { ok: true, command: "COMPLETE_TRIP", trip_status: "completed", completed_at: "2026-10-06T01:00:00.000Z" },
    });
    const { result } = renderHook(() => useTripControl("trip-1"));
    await waitFor(() => expect(result.current.trip?.id).toBe("trip-1"));

    await act(async () => {
      await result.current.completeTrip();
    });

    expect(mockExecute).toHaveBeenCalledWith(
      { tripId: "trip-1", command: "COMPLETE_TRIP", expectedStatus: "at_drop" },
      expect.objectContaining({ id: "trip-1" }),
    );
    expect(mockUpdateTripStatus).not.toHaveBeenCalled();
    expect(result.current.trip?.status).toBe("completed");
  });

  it("a server rejection (POD required) keeps the driver at drop with the server's message", async () => {
    mockExecute.mockResolvedValue({
      error: { code: "pod_required", message: "Upload proof of delivery before completing this trip." },
      result: { ok: false, command: "COMPLETE_TRIP", error_code: "pod_required", trip_status: "at_drop" },
    });
    const { result } = renderHook(() => useTripControl("trip-1"));
    await waitFor(() => expect(result.current.trip?.id).toBe("trip-1"));

    await act(async () => {
      await result.current.completeTrip();
    });

    expect(result.current.step).toBe("reached");
    expect(result.current.trip?.status).toBe("at_drop");
    expect(result.current.stepError).toBe("Upload proof of delivery before completing this trip.");
    expect(mockUpdateTripStatus).not.toHaveBeenCalled();
  });
});
