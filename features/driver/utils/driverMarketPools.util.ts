/**
 * Driver Marketplace pools over the DCO open-loads feed, using the canonical
 * pool identity and membership from pooledOpportunity.util. A pool is one
 * pickup × drop × vehicle (trim + case-fold); a pool of one load is a pool.
 *
 * The DCO feed has no offset and no lane counts, so a pool is known to be
 * complete only when the whole feed was read (see readComplete on
 * useFleetOwnerOpenLoadsQuery). An incomplete read blocks every pool rate.
 */
import type { FleetOwnerOpenLoad } from '@/features/driver/services/fleetOwnerLoads.service';
import type {
  DcoMarketplacePoolManifest,
  DcoMarketplacePoolMember,
} from '@/features/driver/services/marketBids.service';
import type { MarketplaceLoadSearch } from '@/features/network/utils/marketplaceSearch.util';
import {
  poolBidReadiness,
  poolKey,
  poolKeyId,
  poolMembers,
  summarizePool,
  summarizeServerPool,
  type PoolBid,
  type PoolFetchProgress,
} from '@/features/network/utils/pooledOpportunity.util';

export const DRIVER_POOL_INCOMPLETE_MESSAGE =
  "Marketplace can't show you every load in this pool right now, so a pool rate can't be submitted. Nothing has been submitted.";

export type DriverPoolLoad = FleetOwnerOpenLoad & {
  creator_organization_id: string | null;
  is_sponsored: boolean | null;
};

export type DriverMarketPool = {
  poolId: string;
  key: MarketplaceLoadSearch;
  members: DriverPoolLoad[];
};

export function toDriverPoolLoad(load: FleetOwnerOpenLoad): DriverPoolLoad {
  return {
    ...load,
    creator_organization_id: load.creator_organization_id ?? null,
    is_sponsored: null,
  };
}

/** The load's pool, or null when pickup, drop or vehicle is blank. */
export function driverPoolKeyOf(load: FleetOwnerOpenLoad): MarketplaceLoadSearch | null {
  const key = poolKey({
    pickup: load.pickup_area ?? '',
    drop: load.drop_location ?? '',
    vehicleType: load.vehicle_type ?? '',
  });
  return key.pickup && key.drop && key.vehicleType ? key : null;
}

/**
 * Groups the feed into canonical pools, in feed order of each pool's first
 * load. Loads without a complete pickup × drop × vehicle stay unpooled.
 */
export function groupDriverMarketLoads(loads: readonly FleetOwnerOpenLoad[]): {
  pools: DriverMarketPool[];
  unpooled: FleetOwnerOpenLoad[];
} {
  const rows = loads.map(toDriverPoolLoad);
  const keys = new Map<string, MarketplaceLoadSearch>();
  const unpooled: FleetOwnerOpenLoad[] = [];
  for (const load of loads) {
    const key = driverPoolKeyOf(load);
    if (!key) {
      unpooled.push(load);
      continue;
    }
    const id = poolKeyId(key);
    if (!keys.has(id)) keys.set(id, key);
  }
  const pools = [...keys.entries()].map(([poolId, key]) => ({
    poolId,
    key,
    members: poolMembers(rows, key),
  }));
  return { pools, unpooled };
}

export function driverMarketFetchProgress(readComplete: boolean): PoolFetchProgress {
  return readComplete
    ? { nextOffset: null, complete: true, truncated: false }
    : { nextOffset: null, complete: false, truncated: true };
}

/** Why a pool rate can't be offered, or null; an unread feed always blocks. */
export function driverPoolReadiness(input: {
  readComplete: boolean;
  eligibleCount: number;
}): { ready: boolean; blocked: string | null } {
  if (!input.readComplete) return { ready: false, blocked: DRIVER_POOL_INCOMPLETE_MESSAGE };
  return poolBidReadiness({
    fetch: driverMarketFetchProgress(true),
    eligibleCount: input.eligibleCount,
  });
}

export function summarizeDriverPool<B extends PoolBid>(input: {
  key: MarketplaceLoadSearch;
  loads: readonly FleetOwnerOpenLoad[];
  bids: readonly B[];
  priorMemberIds?: ReadonlySet<string>;
  canBid: boolean;
}) {
  return summarizePool({
    key: input.key,
    rows: input.loads.map(toDriverPoolLoad),
    bids: input.bids,
    laneLoadCount: null,
    priorMemberIds: input.priorMemberIds,
    canBidLoad: () => input.canBid,
  });
}

/** A get_dco_marketplace_pool member as a pool load; sponsored loads are never members. */
export function dcoManifestMemberAsLoad(member: DcoMarketplacePoolMember): DriverPoolLoad {
  return { ...member, creator_organization_name: null, is_sponsored: false };
}

/**
 * Summary of the server DCO pool manifest: members, biddable set and own bids
 * are the server's. `bids` adds the DCO's bid list so awards on loads that
 * already left the pool this session stay attributable; manifest bids win.
 */
export function summarizeDcoManifestPool<B extends PoolBid>(input: {
  manifest: DcoMarketplacePoolManifest | null | undefined;
  bids: readonly B[];
  priorMemberIds?: ReadonlySet<string>;
  canBid: boolean;
}) {
  const { manifest } = input;
  return summarizeServerPool<PoolBid, DriverPoolLoad>({
    manifest: {
      member_count: manifest?.member_count ?? 0,
      complete: manifest?.complete ?? false,
      members: (manifest?.members ?? []).map(dcoManifestMemberAsLoad),
      biddable_ids: manifest?.biddable_ids ?? [],
      bids: [...input.bids, ...(manifest?.my_bids ?? [])],
    },
    priorMemberIds: input.priorMemberIds,
    canBid: () => input.canBid,
  });
}

/** "POOLED · 3 LOADS", with "+" when the feed may hold more members unread. */
export function driverPoolEyebrow(count: number, readComplete: boolean): string {
  return `POOLED · ${count}${readComplete ? '' : '+'} LOAD${count === 1 && readComplete ? '' : 'S'}`;
}
