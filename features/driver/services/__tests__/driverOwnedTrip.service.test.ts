import { getDriverOwnedTrip } from "@/features/driver/services/driverOwnedTrip.service";

const mockRpc = jest.fn();

jest.mock("@/lib/supabase", () => ({
  supabase: () => ({ rpc: mockRpc }),
}));

jest.mock("@/types/trip-views", () => ({
  driverRowToTripRow: (row: { id: string; pickup_location: string | null }) => ({
    id: row.id,
    pickup_area: row.pickup_location ?? "",
  }),
}));

describe("getDriverOwnedTrip", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("calls get_driver_owned_trip with p_trip_id only", async () => {
    mockRpc.mockResolvedValue({
      data: [{ id: "trip-1", pickup_location: "Chennai" }],
      error: null,
    });

    const res = await getDriverOwnedTrip("trip-1");

    expect(mockRpc).toHaveBeenCalledWith("get_driver_owned_trip", { p_trip_id: "trip-1" });
    expect(res.error).toBeNull();
    expect(res.trip).toEqual({ id: "trip-1", pickup_area: "Chennai" });
  });

  it("returns null trip when the RPC returns no rows", async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    const res = await getDriverOwnedTrip("trip-missing");

    expect(res.error).toBeNull();
    expect(res.trip).toBeNull();
  });

  it("surfaces RPC errors without a trip", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "permission denied" } });

    const res = await getDriverOwnedTrip("trip-1");

    expect(res.trip).toBeNull();
    expect(res.error?.message).toBe("permission denied");
  });
});
