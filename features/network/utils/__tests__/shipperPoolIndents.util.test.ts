import { poolKeyId } from "@/features/network/utils/pooledOpportunity.util";
import {
  buildShipperPoolModel,
  EMPTY_SHIPPER_POOL_SELECTION,
  selectShownPoolIndents,
  shipperPoolLanes,
  toggleShipperPoolIndent,
  type ShipperPoolSelection,
} from "@/features/network/utils/shipperPoolIndents.util";

type I = {
  id: string;
  pickup_area: string | null;
  drop_location: string | null;
  vehicle_type: string | null;
};

const ind = (id: string, p: string | null, d: string | null, v: string | null): I => ({
  id,
  pickup_area: p,
  drop_location: d,
  vehicle_type: v,
});

const POOL = { pickup: "Pune", drop: "Mumbai", vehicleType: "32 FT" };
const POOL_ID = poolKeyId(POOL);

const indents: I[] = [
  ind("a", "Pune", "Mumbai", "32 FT"),
  ind("b", " pune ", "MUMBAI", "32 ft"),
  ind("c", "Pune", "Navi Mumbai", "32 FT"),
  ind("d", "Pune", "Mumbai", "20 FT"),
  ind("e", "Pune", "Mumbai", null),
  ind("f", "Pune", "Mumbai", "32 FT"),
];

function model(over: Partial<Parameters<typeof buildShipperPoolModel<I>>[0]> = {}) {
  return buildShipperPoolModel<I>({
    poolSearch: POOL,
    poolIndents: indents,
    visibleIndents: indents,
    selection: EMPTY_SHIPPER_POOL_SELECTION,
    shownCount: 50,
    ...over,
  });
}

describe("shipperPoolLanes", () => {
  it("merges case/space variants into one pool and skips indents missing a route field", () => {
    const lanes = shipperPoolLanes(indents);
    const pool = lanes.find((l) => l.poolId === POOL_ID);
    expect(pool?.load_count).toBe(3);
    expect(lanes.map((l) => l.poolId)).not.toContain("pune|mumbai|");
    expect(lanes).toHaveLength(3);
    expect(lanes[0].poolId).toBe(POOL_ID);
  });
});

describe("buildShipperPoolModel", () => {
  it("shows only canonical members, never near-miss routes", () => {
    const m = model();
    expect(m.poolId).toBe(POOL_ID);
    expect(m.members.map((i) => i.id)).toEqual(["a", "b", "f"]);
    expect(m.poolTotal).toBe(3);
    expect(m.unpoolableCount).toBe(1);
  });

  it("has no pool until pickup, drop and vehicle are all chosen", () => {
    const m = model({ poolSearch: { pickup: "Pune", drop: "Mumbai", vehicleType: "" } });
    expect(m.poolId).toBeNull();
    expect(m.members).toEqual([]);
    expect(m.poolTotal).toBe(0);
  });

  it("counts the whole pool while rows follow the screen filters", () => {
    const m = model({ visibleIndents: indents.filter((i) => i.id !== "b") });
    expect(m.poolTotal).toBe(3);
    expect(m.members.map((i) => i.id)).toEqual(["a", "f"]);
    expect(m.hiddenByFilters).toBe(1);
  });

  it("pages rows and reports more to show", () => {
    const m = model({ shownCount: 2 });
    expect(m.shown.map((i) => i.id)).toEqual(["a", "b"]);
    expect(m.hasMoreToShow).toBe(true);
  });

  it("drops selected ids that are not members or belong to another pool", () => {
    const sel: ShipperPoolSelection = { poolId: POOL_ID, ids: new Set(["a", "c", "zz"]) };
    expect(model({ selection: sel }).selectedIds).toEqual(["a"]);
    const other: ShipperPoolSelection = { poolId: "x|y|z", ids: new Set(["a"]) };
    expect(model({ selection: other }).selectedIds).toEqual([]);
  });

  it("keeps a selected row that the filters hide and reports it", () => {
    const sel: ShipperPoolSelection = { poolId: POOL_ID, ids: new Set(["b"]) };
    const m = model({ selection: sel, visibleIndents: indents.filter((i) => i.id !== "b") });
    expect(m.selectedIds).toEqual(["b"]);
    expect(m.selectedHiddenCount).toBe(1);
  });
});

describe("selection", () => {
  const memberIds = new Set(["a", "b", "f"]);

  it("toggles a member on and off", () => {
    const on = toggleShipperPoolIndent(EMPTY_SHIPPER_POOL_SELECTION, POOL_ID, "a", memberIds);
    expect([...on.ids]).toEqual(["a"]);
    expect(on.poolId).toBe(POOL_ID);
    const off = toggleShipperPoolIndent(on, POOL_ID, "a", memberIds);
    expect([...off.ids]).toEqual([]);
  });

  it("never selects a non-member or without a pool", () => {
    const base = EMPTY_SHIPPER_POOL_SELECTION;
    expect(toggleShipperPoolIndent(base, POOL_ID, "c", memberIds)).toBe(base);
    expect(toggleShipperPoolIndent(base, null, "a", memberIds)).toBe(base);
  });

  it("select all adds only the shown members", () => {
    const next = selectShownPoolIndents(
      { poolId: POOL_ID, ids: new Set(["f"]) },
      POOL_ID,
      ["a", "b", "c"],
      memberIds,
    );
    expect([...next.ids].sort()).toEqual(["a", "b", "f"]);
  });

  it("a selection from another pool does not carry over", () => {
    const stale: ShipperPoolSelection = { poolId: "x|y|z", ids: new Set(["a", "b"]) };
    const next = toggleShipperPoolIndent(stale, POOL_ID, "f", memberIds);
    expect([...next.ids]).toEqual(["f"]);
  });
});

describe("canonical Indent Pool identity (shared with Marketplace)", () => {
  const rows: I[] = [
    ind("solo", "Delhi, NCR", "Hyderabad", "24 MT"),
    ind("b1", "Bangalore", "Chennai", "32 FT"),
    ind("b2", "  bangalore ", "CHENNAI", "32 ft "),
    ind("b3", "BANGALORE", " Chennai", "32 Ft"),
    ind("g1", "Bengaluru, Bangalore", "Chennai", "32 FT"),
    ind("s1", "Chennai", "Pune", "32 FT"),
    ind("s2", "Chennai warehouse, CHennai, Tamil nadu", "Pune", "32 FT"),
    ind("v1", "Navi  Mumbai", "Pune", "32 FT"),
    ind("v2", "Navi Mumbai", "Pune", "32 FT"),
  ];
  const lanes = shipperPoolLanes(rows);
  const countOf = (pickup: string, drop: string, vehicleType: string) =>
    lanes.find((l) => l.poolId === poolKeyId({ pickup, drop, vehicleType }))?.load_count;

  it("one eligible indent is a pool of one", () => {
    expect(countOf("Delhi, NCR", "Hyderabad", "24 MT")).toBe(1);
    const m = model({
      poolSearch: { pickup: "delhi, ncr", drop: "HYDERABAD", vehicleType: "24 mt" },
      poolIndents: rows,
      visibleIndents: rows,
    });
    expect(m.poolTotal).toBe(1);
    expect(m.members.map((i) => i.id)).toEqual(["solo"]);
  });

  it("case and leading/trailing whitespace variants are one pool with one count", () => {
    expect(countOf("Bangalore", "Chennai", "32 FT")).toBe(3);
    const m = model({
      poolSearch: { pickup: " BANGALORE", drop: "chennai ", vehicleType: "32 FT" },
      poolIndents: rows,
      visibleIndents: rows,
    });
    expect(m.members.map((i) => i.id)).toEqual(["b1", "b2", "b3"]);
    expect(m.poolTotal).toBe(countOf("Bangalore", "Chennai", "32 FT"));
  });

  it("similar but different values stay separate pools — no substring matching", () => {
    expect(countOf("Bengaluru, Bangalore", "Chennai", "32 FT")).toBe(1);
    expect(countOf("Chennai", "Pune", "32 FT")).toBe(1);
    expect(countOf("Chennai warehouse, CHennai, Tamil nadu", "Pune", "32 FT")).toBe(1);
    const m = model({
      poolSearch: { pickup: "Chennai", drop: "Pune", vehicleType: "32 FT" },
      poolIndents: rows,
      visibleIndents: rows,
    });
    expect(m.members.map((i) => i.id)).toEqual(["s1"]);
  });

  it("preserves meaningful inner spacing", () => {
    expect(countOf("Navi  Mumbai", "Pune", "32 FT")).toBe(1);
    expect(countOf("Navi Mumbai", "Pune", "32 FT")).toBe(1);
  });

  it("every lane count equals its canonical membership", () => {
    for (const lane of lanes) {
      const m = model({
        poolSearch: {
          pickup: lane.pickup_area,
          drop: lane.drop_location,
          vehicleType: lane.vehicle_type,
        },
        poolIndents: rows,
        visibleIndents: rows,
      });
      expect(m.poolTotal).toBe(lane.load_count);
      expect(m.poolId).toBe(lane.poolId);
    }
    expect(lanes.reduce((s, l) => s + l.load_count, 0)).toBe(rows.length);
  });
});
