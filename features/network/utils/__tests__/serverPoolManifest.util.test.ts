import {
  buildNetworkLoadPools,
  describeQuoteFailure,
  keepServerPools,
} from "@/features/network/utils/networkLoadPools.util";
import {
  POOL_CHANGED_MESSAGE,
  manifestFetchProgress,
  poolDriftResult,
  summarizeServerPool,
  type PoolBidStatus,
} from "@/features/network/utils/pooledOpportunity.util";

const member = (id: string, org = "s1") => ({
  id,
  pickup_area: "Pune",
  drop_location: "Mumbai",
  vehicle_type: "32 FT",
  pickup_date: "2026-10-08",
  load_type: "Steel",
  rate_offer: 20000,
  creator_organization_id: org,
  is_sponsored: false,
});
const bid = (indentId: string, status: PoolBidStatus) => ({ indent_id: indentId, status });

describe("keepServerPools", () => {
  const pools = buildNetworkLoadPools([
    { id: "a", organization_id: "o1", pickup_area: "Pune", drop_location: "Mumbai", vehicle_type: "32 FT" },
    { id: "b", organization_id: "o2", pickup_area: "Delhi", drop_location: "Agra", vehicle_type: "24 MT" },
  ] as never).pools;

  it("keeps every local pool until the server list is known", () => {
    expect(keepServerPools(pools, null)).toHaveLength(2);
  });

  it("keeps only pools whose id the server lists", () => {
    const kept = keepServerPools(pools, new Set(["pune|mumbai|32 ft"]));
    expect(kept.map((p) => p.id)).toEqual(["pune|mumbai|32 ft"]);
  });

  it("an empty server list hides every pool", () => {
    expect(keepServerPools(pools, new Set())).toEqual([]);
  });
});

describe("Network quote failure wording for the server RPC", () => {
  it.each(["quote_locked", "indent_not_visible", "own_indent", "invalid_amount"])(
    "humanizes %s",
    (code) => {
      expect(describeQuoteFailure(`${code}: detail`)).not.toMatch(code);
    },
  );
});

describe("manifestFetchProgress", () => {
  it("is not complete before the manifest arrives", () => {
    expect(manifestFetchProgress(null)).toMatchObject({ complete: false, truncated: false });
  });

  it("is the whole pool or, when too large, truncated", () => {
    expect(manifestFetchProgress({ complete: true })).toMatchObject({ complete: true });
    expect(manifestFetchProgress({ complete: false })).toMatchObject({
      complete: false,
      truncated: true,
    });
  });
});

describe("summarizeServerPool", () => {
  const manifest = (over: Record<string, unknown> = {}) => ({
    member_count: 3,
    complete: true,
    members: [member("i1"), member("i2"), member("i3", "s2")],
    biddable_ids: ["i1", "i2", "i3"],
    bids: [] as ReturnType<typeof bid>[],
    ...over,
  });

  it("is biddable only where the server says so and the viewer can bid", () => {
    const summary = summarizeServerPool({
      manifest: manifest({ biddable_ids: ["i1", "i3"] }),
      canBid: (l) => l.id !== "i3",
    });
    expect(summary.biddableIds).toEqual(["i1"]);
    expect(summary.shipperCount).toBe(2);
  });

  it("counts the server's member_count, also for a pool too large to list", () => {
    const summary = summarizeServerPool({
      manifest: manifest({ member_count: 200, complete: false, members: [], biddable_ids: [] }),
      canBid: () => true,
    });
    expect(summary.poolSize).toBe(200);
    expect(summary.biddableIds).toEqual([]);
  });

  it("lets the later (manifest) bid state win for a member", () => {
    const summary = summarizeServerPool({
      manifest: manifest({ bids: [bid("i1", "rejected"), bid("i1", "pending")] }),
      canBid: () => true,
    });
    expect(summary.state).toBe("submitted");
  });

  it("attributes an award on a load that already left the pool", () => {
    const summary = summarizeServerPool({
      manifest: manifest({ bids: [bid("gone", "accepted")] }),
      priorMemberIds: new Set(["gone"]),
      canBid: () => true,
    });
    expect(summary.awardedBids.map((b) => b.indent_id)).toEqual(["gone"]);
  });
});

describe("poolDriftResult", () => {
  it("explains a changed pool without any write", () => {
    expect(poolDriftResult(true)).toEqual({
      blocked: POOL_CHANGED_MESSAGE,
      attempted: 0,
      succeeded: [],
      failed: [],
    });
  });

  it("leaves a pool that became too large to the bid panel", () => {
    expect(poolDriftResult(false)).toBeNull();
  });
});
