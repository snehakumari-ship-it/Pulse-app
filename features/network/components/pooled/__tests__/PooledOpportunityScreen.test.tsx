import React from "react";
import {
  act,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PooledOpportunityScreen } from "@/features/network/components/pooled/PooledOpportunityScreen";
import * as findLoadsForOrgService from "@/features/network/services/findLoadsForOrg.service";

jest.mock("react-native", () => jest.requireActual("react-native"));

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({
    canGoBack: () => true,
    back: jest.fn(),
    replace: jest.fn(),
    push: mockPush,
  }),
  useLocalSearchParams: () => ({
    pickup: "Bhandara",
    drop: "Bengaluru",
    vehicle: "40 FT",
  }),
}));
let mockDesktop = false;
jest.mock("@/lib/layoutInsets", () => ({
  useLayoutInsets: () => ({
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    isDesktopWeb: mockDesktop,
  }),
}));
let mockCanBid = true;
jest.mock("@/lib/useMemberAccess", () => ({
  useMemberAccess: () => ({
    can: (surface: string) =>
      surface === "sales.marketplace.bid" ? mockCanBid : true,
    isLoading: false,
  }),
}));
jest.mock("@/contexts/OrganizationContext", () => ({
  useOptionalOrganization: () => ({
    currentOrganization: { id: "org-1" },
    isLoading: false,
  }),
}));
jest.mock("@/features/vehicles/services/vehicles.service", () => ({
  getVehiclesByOrganization: jest
    .fn()
    .mockResolvedValue({ error: null, vehicles: [] }),
}));
jest.mock("@/features/network/services/findLoadsForOrg.service", () => {
  const actual = jest.requireActual(
    "@/features/network/services/findLoadsForOrg.service",
  );
  return {
    ...actual,
    listOpenMarketplaceLoadsPage: jest.fn(),
    listMarketplaceSearchLanes: jest.fn(),
    listMyOrgMarketBids: jest.fn(),
    submitOrgPoolBid: jest.fn(),
  };
});
jest.mock("@/features/driver/components/MarketLoadBidSheet", () => {
  const RN = jest.requireActual("react-native");
  return {
    MarketLoadBidSheet: (props: {
      visible: boolean;
      shipperName?: string;
      entryLabel?: string;
      contextLine?: string;
      submitLabel?: string;
      confirmCopy?: { scopeNote?: string; successSubtitle?: string };
      validationError?: string;
      onSubmitAmount: (n: number) => Promise<boolean>;
      onSuccessDone?: () => void;
      onClose: () => void;
    }) =>
      props.visible ? (
        <RN.View testID="bid-sheet">
          <RN.Text>{props.shipperName}</RN.Text>
          <RN.Text>{props.entryLabel}</RN.Text>
          <RN.Text>{props.contextLine}</RN.Text>
          <RN.Text>{props.confirmCopy?.scopeNote}</RN.Text>
          <RN.Text>{props.confirmCopy?.successSubtitle}</RN.Text>
          {props.validationError ? (
            <RN.Text>{props.validationError}</RN.Text>
          ) : null}
          <RN.Pressable
            accessibilityLabel={`Sheet: ${props.submitLabel}`}
            onPress={async () => {
              const ok = await props.onSubmitAmount(18500);
              if (ok) {
                props.onSuccessDone?.();
                props.onClose();
              }
            }}
          >
            <RN.Text>{props.submitLabel}</RN.Text>
          </RN.Pressable>
        </RN.View>
      ) : null,
  };
});

const svc = findLoadsForOrgService as jest.Mocked<
  typeof findLoadsForOrgService
>;

const load = (id: string, n: string, extra: Record<string, unknown> = {}) => ({
  id,
  indent_number: n,
  pickup_area: "Bhandara",
  drop_location: "Bengaluru",
  vehicle_type: "40 FT",
  load_type: "Steel",
  pickup_date: "2026-10-08",
  status: "broadcast",
  circulation_target: "both",
  rate_offer: 20000,
  creator_organization_id: "shipper-1",
  creator_organization_name: "acme steel",
  created_at: "2026-10-01T00:00:00Z",
  is_sponsored: false,
  reach_campaign_id: null,
  ...extra,
});

const LOADS = [
  load("i1", "IND-001"),
  load("i2", "IND-002"),
  load("i3", "IND-003", {
    creator_organization_id: "shipper-2",
    creator_organization_name: "Bolt Logistics",
  }),
];

const IDENTITY = /IND-0|acme steel|Acme Steel|Bolt Logistics|shipper-1|shipper-2/;

function lane(count: number) {
  return {
    error: null,
    lanes: [
      {
        pickup_area: "Bhandara",
        drop_location: "Bengaluru",
        vehicle_type: "40 FT",
        load_count: count,
      },
    ],
  };
}

function pagedLoads(total: number) {
  const all = Array.from({ length: total }, (_, i) =>
    load(`p${i}`, `IND-P${i}`),
  );
  svc.listOpenMarketplaceLoadsPage.mockImplementation(async (_org, offset = 0) => {
    const page = all.slice(offset, offset + 15);
    return {
      error: null,
      loads: page as never,
      hasMore: page.length === 15,
      nextOffset: page.length === 15 ? offset + 15 : undefined,
    };
  });
  return all;
}

function renderScreen() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <PooledOpportunityScreen />
    </QueryClientProvider>,
  );
}

function allText(screen: ReturnType<typeof renderScreen>): string {
  return JSON.stringify(screen.toJSON());
}

async function openSheetAndSubmit(screen: ReturnType<typeof renderScreen>) {
  await screen.findByText(/^All \d+ eligible loads?$/);
  fireEvent.press(screen.getByLabelText("Submit rate for pool"));
  await act(async () => {
    fireEvent.press(screen.getByLabelText("Sheet: Submit rate for pool"));
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDesktop = false;
  mockCanBid = true;
  svc.listMarketplaceSearchLanes.mockResolvedValue(lane(3));
  svc.listOpenMarketplaceLoadsPage.mockResolvedValue({
    error: null,
    loads: LOADS as never,
    hasMore: false,
    nextOffset: undefined,
  });
  svc.listMyOrgMarketBids.mockResolvedValue({ error: null, bids: [] });
});

describe("PooledOpportunityScreen — anonymous pooled requirement", () => {
  it("shows the pool as a requirement: route, vehicle, count, window, material", async () => {
    const screen = renderScreen();
    expect(await screen.findByText("Bhandara → Bengaluru")).toBeTruthy();
    expect(
      await screen.findByText("40 Ft · 3 loads · one rate for the pool"),
    ).toBeTruthy();
    expect(screen.getByText("3 LOADS IN THIS POOL")).toBeTruthy();
    expect(screen.getByText("Pickup window")).toBeTruthy();
    expect(screen.getByText("Steel")).toBeTruthy();
    expect(screen.getByText("2 · identity hidden")).toBeTruthy();
    expect(screen.getByLabelText("Pool status: Open for bids")).toBeTruthy();
  });

  it("never shows indent ids, shipper names or per-load rows", async () => {
    const screen = renderScreen();
    await screen.findByText("3 LOADS IN THIS POOL");
    expect(allText(screen)).not.toMatch(IDENTITY);
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.queryByText(/selected/i)).toBeNull();
    expect(screen.queryByText(/Load more/i)).toBeNull();
    expect(screen.queryByText(/Select all|Clear/)).toBeNull();
  });

  it("treats a one-indent lane as a pool of one", async () => {
    svc.listMarketplaceSearchLanes.mockResolvedValue(lane(1));
    svc.listOpenMarketplaceLoadsPage.mockResolvedValue({
      error: null,
      loads: [LOADS[0]] as never,
      hasMore: false,
      nextOffset: undefined,
    });
    const screen = renderScreen();
    expect(await screen.findByText("1 LOAD IN THIS POOL")).toBeTruthy();
    expect(await screen.findByText("All 1 eligible load")).toBeTruthy();
    expect(screen.getByLabelText("Submit rate for pool")).toBeTruthy();
  });

  it("drops contaminated RPC rows from the count and the bid scope", async () => {
    svc.listOpenMarketplaceLoadsPage.mockResolvedValue({
      error: null,
      loads: [
        ...LOADS,
        load("x1", "IND-RURAL", { pickup_area: "Bhandara Rural" }),
        load("x2", "IND-CONT", { vehicle_type: "Container 40 FT" }),
        load("i4", "IND-004", {
          pickup_area: " bhandara ",
          drop_location: "BENGALURU",
          vehicle_type: "40 ft",
        }),
      ] as never,
      hasMore: false,
      nextOffset: undefined,
    });
    svc.submitOrgPoolBid.mockResolvedValue({
      blocked: null,
      attempted: 4,
      succeeded: ["i1", "i2", "i3", "i4"],
      failed: [],
    });
    const screen = renderScreen();
    expect(await screen.findByText("4 LOADS IN THIS POOL")).toBeTruthy();
    await openSheetAndSubmit(screen);
    const [, pool] = svc.submitOrgPoolBid.mock.calls[0]!;
    expect(pool.indentIds).toEqual(["i1", "i2", "i3", "i4"]);
    expect(pool.memberIds.has("x1") || pool.memberIds.has("x2")).toBe(false);
  });
});

describe("PooledOpportunityScreen — one rate for the whole pool", () => {
  it("submits one rate to every eligible member, with no load picking", async () => {
    svc.submitOrgPoolBid.mockResolvedValue({
      blocked: null,
      attempted: 3,
      succeeded: ["i1", "i2", "i3"],
      failed: [],
    });
    const screen = renderScreen();
    expect(await screen.findByText("All 3 eligible loads")).toBeTruthy();
    expect(screen.getAllByLabelText("Submit rate for pool")).toHaveLength(1);
    fireEvent.press(screen.getByLabelText("Submit rate for pool"));
    expect(screen.getByText("Pooled opportunity · 3 loads")).toBeTruthy();
    expect(
      within(screen.getByTestId("bid-sheet")).getByText(
        "Your rate will be submitted for all 3 eligible loads in this pool. The shipper reviews bids; nothing is awarded until the shipper accepts.",
      ),
    ).toBeTruthy();
    expect(allText(screen)).not.toMatch(IDENTITY);
    await act(async () => {
      fireEvent.press(screen.getByLabelText("Sheet: Submit rate for pool"));
    });
    expect(svc.submitOrgPoolBid).toHaveBeenCalledTimes(1);
    const [orgId, pool, amount] = svc.submitOrgPoolBid.mock.calls[0]!;
    expect(orgId).toBe("org-1");
    expect(amount).toBe(18500);
    expect(pool.indentIds).toEqual(["i1", "i2", "i3"]);
    expect(
      await screen.findByText("Your rate has been submitted for all 3 loads."),
    ).toBeTruthy();
  });

  it("reads every page of a 43-load pool automatically and bids on all 43", async () => {
    svc.listMarketplaceSearchLanes.mockResolvedValue(lane(43));
    const all = pagedLoads(43);
    svc.submitOrgPoolBid.mockResolvedValue({
      blocked: null,
      attempted: 43,
      succeeded: all.map((l) => l.id),
      failed: [],
    });
    const screen = renderScreen();
    expect(await screen.findByText("All 43 eligible loads")).toBeTruthy();
    expect(
      svc.listOpenMarketplaceLoadsPage.mock.calls.map((c) => c[1]),
    ).toEqual([0, 15, 30]);
    expect(screen.queryByText(/Load more/i)).toBeNull();
    await openSheetAndSubmit(screen);
    const [, pool] = svc.submitOrgPoolBid.mock.calls[0]!;
    expect(pool.indentIds).toHaveLength(43);
    expect(pool.indentIds).toEqual(all.map((l) => l.id));
  });

  it("blocks a pool larger than Marketplace can read instead of bidding on part of it", async () => {
    svc.listMarketplaceSearchLanes.mockResolvedValue(lane(200));
    pagedLoads(200);
    const screen = renderScreen();
    expect(
      await screen.findByText(
        "This pool contains more loads than Marketplace can currently process. Nothing was submitted.",
      ),
    ).toBeTruthy();
    const offsets = svc.listOpenMarketplaceLoadsPage.mock.calls.map((c) => c[1]);
    expect(Math.max(...(offsets as number[]))).toBe(150);
    expect(offsets).not.toContain(165);
    const cta = screen.getByLabelText("Submit rate for pool");
    expect(cta.props.accessibilityState).toMatchObject({ disabled: true });
    fireEvent.press(cta);
    expect(screen.queryByTestId("bid-sheet")).toBeNull();
    expect(svc.submitOrgPoolBid).not.toHaveBeenCalled();
  });

  it("reports a partial submission as partial, without load identifiers", async () => {
    svc.submitOrgPoolBid.mockResolvedValue({
      blocked: null,
      attempted: 3,
      succeeded: ["i1", "i2"],
      failed: [{ indentId: "i3", message: "indent_not_open" }],
    });
    const screen = renderScreen();
    await openSheetAndSubmit(screen);
    expect(
      await screen.findByText("Partly submitted: your rate reached 2 of 3 loads"),
    ).toBeTruthy();
    expect(screen.getByText("1 load: indent_not_open")).toBeTruthy();
    expect(screen.queryByText(/has been submitted for all/)).toBeNull();
    expect(allText(screen)).not.toMatch(IDENTITY);
    expect(allText(screen)).not.toContain("i3");
  });

  it("keeps the sheet open with an error when no load takes the rate", async () => {
    svc.submitOrgPoolBid.mockResolvedValue({
      blocked: null,
      attempted: 3,
      succeeded: [],
      failed: [{ indentId: "i1", message: "network down" }],
    });
    const screen = renderScreen();
    await openSheetAndSubmit(screen);
    expect(screen.getByLabelText("Sheet: Submit rate for pool")).toBeTruthy();
    expect(screen.getByText(/None of the 3 loads took your rate/)).toBeTruthy();
  });

  it("shows the submitted state and offers to update the pool rate", async () => {
    svc.listMyOrgMarketBids.mockResolvedValue({
      error: null,
      bids: [{ id: "b1", indent_id: "i1", status: "pending" }] as never,
    });
    const screen = renderScreen();
    expect(
      await screen.findByLabelText("Pool status: Your bid submitted"),
    ).toBeTruthy();
    expect(screen.getByLabelText("Update rate for pool")).toBeTruthy();
    expect(svc.listMyOrgMarketBids).toHaveBeenCalledWith("org-1", 100);
  });

  it("disables the rate for roles without the bid capability", async () => {
    mockCanBid = false;
    const screen = renderScreen();
    expect(
      await screen.findByText("Your role can view this pool but can't bid."),
    ).toBeTruthy();
    const cta = await screen.findByLabelText("Submit rate for pool");
    expect(cta.props.accessibilityState).toMatchObject({ disabled: true });
  });
});

describe("PooledOpportunityScreen — identity gate", () => {
  const award = (fee: string) => ({
    error: null,
    bids: [
      {
        id: "b9",
        indent_id: "i1",
        status: "accepted",
        fee_payment_status: fee,
        owner_organization_name: "acme steel",
        owner_phone: fee === "paid" ? "+919999900000" : null,
      },
    ] as never,
  });

  it("keeps identity hidden while discovering and bidding", async () => {
    const screen = renderScreen();
    expect(await screen.findByTestId("pool-identity-gate-hidden")).toBeTruthy();
    expect(screen.getByText("SHIPPER IDENTITY HIDDEN")).toBeTruthy();
    expect(screen.queryByText("From award to trip")).toBeNull();
  });

  it("keeps identity locked after award until the commercial gate clears", async () => {
    svc.listMyOrgMarketBids.mockResolvedValue(award("required"));
    const screen = renderScreen();
    expect(
      await screen.findByTestId("pool-identity-gate-pending_acceptance"),
    ).toBeTruthy();
    expect(screen.getByText("Locked — pending commercial acceptance")).toBeTruthy();
    expect(screen.getByText("0 of 1 cleared")).toBeTruthy();
    expect(allText(screen)).not.toMatch(IDENTITY);
  });

  it("marks identity eligible only after the fee gate, and still never renders it here", async () => {
    svc.listMyOrgMarketBids.mockResolvedValue(award("paid"));
    const screen = renderScreen();
    expect(await screen.findByTestId("pool-identity-gate-eligible")).toBeTruthy();
    expect(screen.getByText("Available in My Bids for 1 awarded load")).toBeTruthy();
    expect(
      await screen.findByLabelText("Pool status: Open · 1 awarded"),
    ).toBeTruthy();
    expect(allText(screen)).not.toMatch(IDENTITY);
    expect(allText(screen)).not.toContain("+919999900000");
    fireEvent.press(screen.getByLabelText("Open awarded loads"));
    expect(mockPush).toHaveBeenCalledWith("/find-loads?segment=my-bids");
  });

  it("does not let a historical award on the same route open this pool's gate", async () => {
    svc.listMyOrgMarketBids.mockResolvedValue({
      error: null,
      bids: [
        { id: "b9", indent_id: "old-award", status: "accepted", fee_payment_status: "paid" },
      ] as never,
    });
    const screen = renderScreen();
    expect(
      await screen.findByLabelText("Pool status: Open for bids"),
    ).toBeTruthy();
    expect(screen.getByTestId("pool-identity-gate-hidden")).toBeTruthy();
  });
});

describe("PooledOpportunityScreen — states and layout", () => {
  it("shows error with Retry, then empty copy", async () => {
    svc.listOpenMarketplaceLoadsPage.mockResolvedValueOnce({
      error: new Error("timeout"),
      loads: [],
      hasMore: false,
      nextOffset: undefined,
    });
    const screen = renderScreen();
    expect(await screen.findByText("Couldn't load this pool.")).toBeTruthy();
    svc.listOpenMarketplaceLoadsPage.mockResolvedValueOnce({
      error: null,
      loads: [],
      hasMore: false,
      nextOffset: undefined,
    });
    fireEvent.press(screen.getByText("Retry"));
    expect(
      await screen.findByText("No loads in this pool are open right now."),
    ).toBeTruthy();
  });

  it("renders the two-column desktop layout without losing any section", async () => {
    mockDesktop = true;
    const screen = renderScreen();
    expect(await screen.findByText("3 LOADS IN THIS POOL")).toBeTruthy();
    expect(screen.getByText("Your rate for this pooled opportunity")).toBeTruthy();
    expect(screen.getByTestId("pool-identity-gate-hidden")).toBeTruthy();
  });

  it("fetches only this pool's lane loads", async () => {
    const screen = renderScreen();
    await waitFor(() =>
      expect(svc.listOpenMarketplaceLoadsPage).toHaveBeenCalledTimes(1),
    );
    expect(svc.listOpenMarketplaceLoadsPage.mock.calls[0]?.[3]).toEqual({
      pickup: "Bhandara",
      drop: "Bengaluru",
      vehicleType: "40 FT",
    });
    await screen.findByText("3 LOADS IN THIS POOL");
  });
});
