import { render, screen } from "@testing-library/react-native";

import { RouteStopsTimeline } from "@/features/trips/components/RouteExtraStopsPlan";

jest.mock("react-native", () => jest.requireActual("react-native"));

const stops = [
  {
    id: "s2",
    sequence: 2,
    stop_type: "drop" as const,
    location: "Pune, Maharashtra",
    client_charge: 0,
    supplier_charge: 900,
  },
  {
    id: "s1",
    sequence: 1,
    stop_type: "drop" as const,
    location: "Mumbai, Maharashtra",
    client_charge: 2500,
    supplier_charge: 2000,
  },
];

describe("RouteStopsTimeline", () => {
  it("lays out pickup, ordered stops and final drop with the viewer's charge", () => {
    render(
      <RouteStopsTimeline
        stops={stops}
        side="client"
        origin="Chennai, Tamil Nadu"
        destination="Delhi, Delhi"
        summary="+2 stops · incl. ₹ 2,500 extra paid"
      />,
    );

    expect(screen.getByText("ROUTE PLAN")).toBeTruthy();
    expect(screen.getByText("+2 stops · incl. ₹ 2,500 extra paid")).toBeTruthy();
    const kickers = screen.getAllByText(/^(PICKUP|STOP \d · DROP|FINAL DROP)$/).map(
      (node) => node.props.children,
    );
    expect(kickers).toEqual(["PICKUP", "STOP 1 · DROP", "STOP 2 · DROP", "FINAL DROP"]);
    expect(screen.getByText("Mumbai")).toBeTruthy();
    expect(screen.getByText("+₹ 2,500")).toBeTruthy();
    expect(screen.queryByText("+₹ 900")).toBeNull();
  });

  it("renders nothing without stops", () => {
    const { toJSON } = render(
      <RouteStopsTimeline stops={[]} side="supplier" origin="A" destination="B" />,
    );
    expect(toJSON()).toBeNull();
  });
});
