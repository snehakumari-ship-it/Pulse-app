import { renderHook, waitFor } from "@testing-library/react-native";

import { useDriverTripSettlement } from "@/features/driver/hooks/useDriverTripSettlement";
import * as driversService from "@/features/drivers/services/drivers.service";
import type { TripRow } from "@/features/trips/services/trips.service";

jest.mock("react-native", () => jest.requireActual("react-native"));

jest.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ profile: { uid: "user-1" } }),
}));

const mockGate: { resolve: () => void; promise: Promise<void> } = {
  resolve: () => undefined,
  promise: Promise.resolve(),
};
mockGate.promise = new Promise((resolve) => {
  mockGate.resolve = resolve;
});

const mockStarted: string[] = [];

jest.mock("@/features/drivers/services/drivers.service", () => ({
  getLinkedDriversForCurrentUser: jest.fn(async () => {
    mockStarted.push("links");
    await mockGate.promise;
    return { drivers: [] };
  }),
  getDriverLedgerByTripId: jest.fn(async (tripId: string) => {
    mockStarted.push(`ledger:${tripId}`);
    await mockGate.promise;
    return {
      error: null,
      entries: [
        {
          id: "led-1",
          organization_id: "org-1",
          driver_id: "drv-1",
          trip_id: tripId,
          type: "deduction",
          amount: 50,
          currency: "INR",
          description: null,
          created_at: "2026-10-01T00:00:00.000Z",
          created_by: null,
        },
        {
          id: "led-other",
          organization_id: "org-1",
          driver_id: "drv-1",
          trip_id: "other-trip",
          type: "deduction",
          amount: 999,
          currency: "INR",
          description: null,
          created_at: "2026-10-02T00:00:00.000Z",
          created_by: null,
        },
      ],
    };
  }),
  getDriverLedgerByDriverIds: jest.fn(),
  getDriverInvitesReceived: jest.fn(async () => {
    mockStarted.push("invites");
    await mockGate.promise;
    return { error: null, invites: [] };
  }),
}));

const trip = {
  id: "trip-1",
  organization_id: "org-1",
  driver_id: "drv-1",
  pickup_area: "Chennai",
  drop_location: "Bengaluru",
  status: "completed",
} as TripRow;

describe("settlement ledger scope", () => {
  beforeEach(() => {
    mockStarted.length = 0;
    mockGate.promise = new Promise((resolve) => {
      mockGate.resolve = resolve;
    });
  });

  it("starts trip ledger, fleet links, and invites together and totals only this trip", async () => {
    const { result } = renderHook(() => useDriverTripSettlement(trip));

    await waitFor(() => {
      expect(mockStarted.sort()).toEqual(["invites", "ledger:trip-1", "links"]);
    });
    expect(driversService.getDriverLedgerByDriverIds).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(true);

    mockGate.resolve();

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(driversService.getDriverLedgerByTripId).toHaveBeenCalledWith("trip-1");
    expect(result.current.settlementView?.deductionsAmount).toBe(50);
  });
});
