import {
  startDriverAssignerFollowupReads,
  startDriverAssignerIdentityReads,
} from "@/features/driver/services/driverDashboardAssignerReads";

const mockRpc = jest.fn();
const mockFrom = jest.fn();
const mockAudit = jest.fn();
const mockBranding = jest.fn();

jest.mock("@/lib/supabase", () => ({
  supabase: () => ({ rpc: mockRpc, from: mockFrom }),
}));

jest.mock("@/features/trips/services/trip-assignment-audit.service", () => ({
  getLatestAssignmentAuditByTripIds: (...args: unknown[]) => mockAudit(...args),
}));

jest.mock("@/lib/orgBrandingFetch", () => ({
  fetchOrgBrandingByIds: (...args: unknown[]) => mockBranding(...args),
}));

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function query() {
  const chain: Record<string, unknown> = {};
  chain.select = jest.fn(() => chain);
  chain.in = jest.fn(() => chain);
  chain.eq = jest.fn(() => chain);
  chain.then = (
    resolve: (value: { data: unknown[]; error: null }) => unknown,
    reject?: (reason: unknown) => unknown,
  ) => Promise.resolve({ data: [], error: null }).then(resolve, reject);
  return chain;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFrom.mockImplementation(() => query());
});

describe("driver dashboard assigner reads", () => {
  it("starts the assigner RPC and assignment audit together", async () => {
    const rpc = deferred<{ data: []; error: null }>();
    const audit = deferred<{ byTripId: Map<string, never> }>();
    mockRpc.mockReturnValue(rpc.promise);
    mockAudit.mockReturnValue(audit.promise);

    const pending = startDriverAssignerIdentityReads(["trip-1"]);

    expect(mockRpc).toHaveBeenCalledWith("get_trip_assigner_displays_for_driver", {
      p_trip_ids: ["trip-1"],
    });
    expect(mockAudit).toHaveBeenCalledWith(["trip-1"]);

    rpc.resolve({ data: [], error: null });
    audit.resolve({ byTripId: new Map() });
    await pending;
  });

  it("starts profile and branding reads together after ids are known", async () => {
    const branding = deferred<Record<string, never>>();
    mockBranding.mockReturnValue(branding.promise);

    const pending = startDriverAssignerFollowupReads(["user-1"], ["org-1"]);

    expect(mockFrom).toHaveBeenCalledWith("profiles");
    expect(mockFrom).toHaveBeenCalledWith("organizations");
    expect(mockFrom).toHaveBeenCalledWith("organization_members");
    expect(mockBranding).toHaveBeenCalledWith(["org-1"]);

    branding.resolve({});
    await pending;
  });
});
