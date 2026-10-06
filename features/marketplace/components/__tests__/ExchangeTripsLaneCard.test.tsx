import { fireEvent, render } from "@testing-library/react-native";
import type { ExchangeLaneTrip } from "@/features/marketplace/services/exchangePayments.service";
import { ExchangeTripsLaneCard } from "../ExchangeTripsLaneCard";

jest.mock("react-native", () => jest.requireActual("react-native"));

const mockPush = jest.fn();
let mockTrips: ExchangeLaneTrip[] = [];

jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("@/features/marketplace/hooks/useExchangeTripPayments", () => ({
  useExchangeTripsLaneQuery: () => ({ data: mockTrips }),
}));

function laneTrip(overrides: Partial<ExchangeLaneTrip>): ExchangeLaneTrip {
  return {
    trip_id: "anchor-1",
    trip_number: "SAT-TRP-1",
    viewer_side: "payee",
    payee_kind: "organization",
    payer_organization_id: "org-a",
    payer_organization_name: "Shipper Co",
    payee_organization_id: "org-b",
    payee_organization_name: "Bidder Co",
    agreed_amount: 43500,
    confirmed_amount: 3500,
    claimed_amount: 0,
    ledger_contact_type: "client",
    ledger_contact_id: "acct-a",
    payments: [],
    viewer_trip_id: "exec-1",
    viewer_trip_number: "DEV-TRP-3",
    ledger_contact_name: "Shipper Co",
    ...overrides,
  };
}

beforeEach(() => {
  mockPush.mockReset();
  mockTrips = [];
});

describe("ExchangeTripsLaneCard", () => {
  it("renders nothing when the org has no Exchange trips on this side", () => {
    mockTrips = [laneTrip({ viewer_side: "payer" })];
    const { toJSON } = render(<ExchangeTripsLaneCard organizationId="org-b" side="payee" />);
    expect(toJSON()).toBeNull();
  });

  it("summarises what is still to receive and opens the org's own trip", () => {
    mockTrips = [laneTrip({})];
    const { getByText, queryByText } = render(<ExchangeTripsLaneCard organizationId="org-b" side="payee" />);

    expect(getByText("Marketplace trips · 1")).toBeTruthy();
    expect(getByText(/to receive through Pulse Exchange/)).toBeTruthy();
    expect(queryByText(/DEV-TRP-3/)).toBeNull();

    fireEvent.press(getByText("Marketplace trips · 1"));
    fireEvent.press(getByText("DEV-TRP-3 · Shipper Co"));

    expect(mockPush).toHaveBeenCalledWith("/trip/exec-1");
  });
});
