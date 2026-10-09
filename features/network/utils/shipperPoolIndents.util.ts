/**
 * Shipper Indent Pool over the shipper's own indents. Pool identity and
 * membership come only from pooledOpportunity.util, so a pool here is the
 * same pickup + drop + vehicle pool Marketplace shows anonymously. A single
 * indent is a pool of one. Selection is a local operational aid scoped to
 * one pool; it never creates or changes a pool.
 */
import {
  canonicalPoolLanes,
  poolKey,
  poolKeyId,
  poolMembers,
  type PoolLane,
} from "@/features/network/utils/pooledOpportunity.util";
import type {
  MarketplaceLoadSearch,
  MarketplaceSearchLane,
} from "@/features/network/utils/marketplaceSearch.util";

export const SHIPPER_POOL_PAGE_SIZE = 50;

type PoolIndent = {
  id: string;
  pickup_area: string | null;
  drop_location: string | null;
  vehicle_type: string | null;
};

export type ShipperPoolSelection = {
  poolId: string | null;
  ids: ReadonlySet<string>;
};

export const EMPTY_SHIPPER_POOL_SELECTION: ShipperPoolSelection = {
  poolId: null,
  ids: new Set(),
};

function isPoolable(indent: PoolIndent): boolean {
  return Boolean(
    (indent.pickup_area ?? "").trim() &&
      (indent.drop_location ?? "").trim() &&
      (indent.vehicle_type ?? "").trim(),
  );
}

/** One lane per canonical pool among the shipper's indents; indents missing a route field form no pool. */
export function shipperPoolLanes(indents: readonly PoolIndent[]): PoolLane[] {
  const lanes: MarketplaceSearchLane[] = [];
  for (const indent of indents) {
    if (!isPoolable(indent)) continue;
    lanes.push({
      pickup_area: (indent.pickup_area ?? "").trim(),
      drop_location: (indent.drop_location ?? "").trim(),
      vehicle_type: (indent.vehicle_type ?? "").trim(),
      load_count: 1,
    });
  }
  return canonicalPoolLanes(lanes).sort(
    (a, b) =>
      b.load_count - a.load_count || a.poolId.localeCompare(b.poolId),
  );
}

export function isCompletePoolKey(key: MarketplaceLoadSearch): boolean {
  return Boolean(key.pickup && key.drop && key.vehicleType);
}

export type ShipperPoolModel<I extends PoolIndent> = {
  key: MarketplaceLoadSearch;
  /** Null until pickup, drop and vehicle are all chosen. */
  poolId: string | null;
  /** Pool members across every loaded unallocated indent, ignoring screen filters. */
  poolTotal: number;
  memberIds: ReadonlySet<string>;
  /** Members that pass the screen's search / date / status filters. */
  members: I[];
  shown: I[];
  hasMoreToShow: boolean;
  hiddenByFilters: number;
  /** Selected ids in pool order; never contains a non-member. */
  selectedIds: string[];
  selectedHiddenCount: number;
  unpoolableCount: number;
  /** Indents of this pool already allocated to a trip (outside the pool universe). */
  onTripCount: number;
};

export function effectiveSelection(
  selection: ShipperPoolSelection,
  poolId: string | null,
  memberIds: ReadonlySet<string>,
): Set<string> {
  if (!poolId || selection.poolId !== poolId) return new Set();
  return new Set([...selection.ids].filter((id) => memberIds.has(id)));
}

export function buildShipperPoolModel<I extends PoolIndent>(input: {
  poolSearch: Partial<MarketplaceLoadSearch> | null;
  /** Every loaded unallocated indent of the shipper — the pool universe. */
  poolIndents: readonly I[];
  /** The same indents after the screen's filters, in display order. */
  visibleIndents: readonly I[];
  /** The shipper's indents that already have a trip. */
  allocatedIndents?: readonly PoolIndent[];
  selection: ShipperPoolSelection;
  shownCount: number;
}): ShipperPoolModel<I> {
  const key = poolKey(input.poolSearch);
  const complete = isCompletePoolKey(key);
  const poolId = complete ? poolKeyId(key) : null;
  const all = complete ? poolMembers(input.poolIndents, key) : [];
  const memberIds = new Set(all.map((i) => i.id));
  const members = complete ? poolMembers(input.visibleIndents, key) : [];
  const shownCount = Math.max(0, input.shownCount);
  const chosen = effectiveSelection(input.selection, poolId, memberIds);
  const visibleIds = new Set(members.map((i) => i.id));
  const selectedIds = all.filter((i) => chosen.has(i.id)).map((i) => i.id);
  return {
    key,
    poolId,
    poolTotal: all.length,
    memberIds,
    members,
    shown: members.slice(0, shownCount),
    hasMoreToShow: members.length > shownCount,
    hiddenByFilters: all.length - members.length,
    selectedIds,
    selectedHiddenCount: selectedIds.filter((id) => !visibleIds.has(id)).length,
    unpoolableCount: input.poolIndents.filter((i) => !isPoolable(i)).length,
    onTripCount: complete
      ? poolMembers(input.allocatedIndents ?? [], key).filter(
          (i) => !memberIds.has(i.id),
        ).length
      : 0,
  };
}

export type ShipperPoolStage = "waiting" | "bids" | "awarded";

export type ShipperPoolSummaryRow<I extends PoolIndent> = {
  lane: PoolLane;
  members: I[];
  waiting: number;
  bids: number;
  awarded: number;
  /** Indents of this pool already allocated to a trip. */
  onTrip: number;
};

/** One summary row per pool: how many of its indents sit at each stage. */
export function shipperPoolSummaryRows<I extends PoolIndent>(input: {
  lanes: readonly PoolLane[];
  poolIndents: readonly I[];
  allocatedIndents?: readonly PoolIndent[];
  stageOf: (indent: I) => ShipperPoolStage;
}): ShipperPoolSummaryRow<I>[] {
  const byPool = new Map<string, I[]>();
  for (const indent of input.poolIndents) {
    if (!isPoolable(indent)) continue;
    const id = poolKeyId(
      poolKey({
        pickup: indent.pickup_area ?? "",
        drop: indent.drop_location ?? "",
        vehicleType: indent.vehicle_type ?? "",
      }),
    );
    const list = byPool.get(id);
    if (list) list.push(indent);
    else byPool.set(id, [indent]);
  }
  const memberIds = new Set(input.poolIndents.map((i) => i.id));
  const onTripByPool = new Map<string, number>();
  for (const indent of input.allocatedIndents ?? []) {
    if (!isPoolable(indent) || memberIds.has(indent.id)) continue;
    const id = poolKeyId(
      poolKey({
        pickup: indent.pickup_area ?? "",
        drop: indent.drop_location ?? "",
        vehicleType: indent.vehicle_type ?? "",
      }),
    );
    onTripByPool.set(id, (onTripByPool.get(id) ?? 0) + 1);
  }
  return input.lanes.map((lane) => {
    const members = byPool.get(lane.poolId) ?? [];
    let waiting = 0;
    let bids = 0;
    let awarded = 0;
    for (const indent of members) {
      const stage = input.stageOf(indent);
      if (stage === "awarded") awarded += 1;
      else if (stage === "bids") bids += 1;
      else waiting += 1;
    }
    return { lane, members, waiting, bids, awarded, onTrip: onTripByPool.get(lane.poolId) ?? 0 };
  });
}

/** Toggle one indent. Non-members and a missing pool are a no-op. */
export function toggleShipperPoolIndent(
  selection: ShipperPoolSelection,
  poolId: string | null,
  indentId: string,
  memberIds: ReadonlySet<string>,
): ShipperPoolSelection {
  if (!poolId || !memberIds.has(indentId)) return selection;
  const next = effectiveSelection(selection, poolId, memberIds);
  if (next.has(indentId)) next.delete(indentId);
  else next.add(indentId);
  return { poolId, ids: next };
}

/** Add every shown member; rows not on screen are left as they were. */
export function selectShownPoolIndents(
  selection: ShipperPoolSelection,
  poolId: string | null,
  shownIds: readonly string[],
  memberIds: ReadonlySet<string>,
): ShipperPoolSelection {
  if (!poolId) return selection;
  const next = effectiveSelection(selection, poolId, memberIds);
  for (const id of shownIds) if (memberIds.has(id)) next.add(id);
  return { poolId, ids: next };
}
