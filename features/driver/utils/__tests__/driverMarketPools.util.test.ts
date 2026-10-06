import type { FleetOwnerOpenLoad } from '@/features/driver/services/fleetOwnerLoads.service';
import {
  DRIVER_POOL_INCOMPLETE_MESSAGE,
  driverPoolEyebrow,
  driverPoolReadiness,
  groupDriverMarketLoads,
  summarizeDriverPool,
} from '@/features/driver/utils/driverMarketPools.util';
import {
  POOL_BID_MAX_LOADS,
  POOL_TOO_LARGE_MESSAGE,
  poolKeyId,
} from '@/features/network/utils/pooledOpportunity.util';

const load = (id: string, extra: Partial<FleetOwnerOpenLoad> = {}): FleetOwnerOpenLoad => ({
  id,
  indent_number: `IND-${id}`,
  pickup_area: 'Chennai',
  drop_location: 'Bengaluru',
  vehicle_type: '32 FT',
  load_type: 'Steel',
  pickup_date: '2026-10-08',
  status: 'broadcast',
  circulation_target: 'marketplace',
  rate_offer: 20000,
  creator_organization_name: 'Acme',
  creator_organization_id: 'org-a',
  created_at: '2026-10-01T00:00:00Z',
  ...extra,
});

describe('groupDriverMarketLoads', () => {
  it('a single load is a valid one-load pool', () => {
    const { pools, unpooled } = groupDriverMarketLoads([load('a')]);
    expect(unpooled).toEqual([]);
    expect(pools).toHaveLength(1);
    expect(pools[0].members.map((m) => m.id)).toEqual(['a']);
  });

  it('every load on the same pickup × drop × vehicle forms one pool', () => {
    const { pools } = groupDriverMarketLoads([
      load('a'),
      load('b', { creator_organization_id: 'org-b' }),
      load('c'),
    ]);
    expect(pools).toHaveLength(1);
    expect(pools[0].members.map((m) => m.id)).toEqual(['a', 'b', 'c']);
  });

  it('uses canonical membership: trim + case-fold only', () => {
    const { pools } = groupDriverMarketLoads([
      load('a'),
      load('b', { pickup_area: '  CHENNAI ', drop_location: 'bengaluru', vehicle_type: '32 ft' }),
      load('c', { vehicle_type: '32FT' }),
      load('d', { drop_location: 'Bengaluru, Karnataka' }),
    ]);
    expect(pools.map((p) => p.members.map((m) => m.id))).toEqual([['a', 'b'], ['c'], ['d']]);
    expect(pools[0].poolId).toBe(
      poolKeyId({ pickup: 'chennai', drop: 'bengaluru', vehicleType: '32 ft' }),
    );
  });

  it('keeps loads without a full pickup × drop × vehicle out of pools', () => {
    const { pools, unpooled } = groupDriverMarketLoads([
      load('a'),
      load('b', { vehicle_type: '  ' }),
      load('c', { drop_location: null }),
    ]);
    expect(pools).toHaveLength(1);
    expect(unpooled.map((l) => l.id)).toEqual(['b', 'c']);
  });
});

describe('driverPoolReadiness', () => {
  it('is ready only when the whole feed was read', () => {
    expect(driverPoolReadiness({ readComplete: true, eligibleCount: 3 })).toEqual({
      ready: true,
      blocked: null,
    });
  });

  it('blocks every pool when the feed hit its limit', () => {
    expect(driverPoolReadiness({ readComplete: false, eligibleCount: 3 })).toEqual({
      ready: false,
      blocked: DRIVER_POOL_INCOMPLETE_MESSAGE,
    });
  });

  it('blocks a pool above the per-submission cap', () => {
    expect(
      driverPoolReadiness({ readComplete: true, eligibleCount: POOL_BID_MAX_LOADS + 1 }),
    ).toEqual({ ready: false, blocked: POOL_TOO_LARGE_MESSAGE });
  });

  it('has nothing to offer when no member is open for a bid', () => {
    expect(driverPoolReadiness({ readComplete: true, eligibleCount: 0 }).ready).toBe(false);
  });
});

describe('summarizeDriverPool', () => {
  const key = { pickup: 'Chennai', drop: 'Bengaluru', vehicleType: '32 FT' };

  it('targets every eligible member and skips non-members and closed bids', () => {
    const s = summarizeDriverPool({
      key,
      loads: [load('a'), load('b'), load('c'), load('x', { vehicle_type: '20 FT' })],
      bids: [
        { indent_id: 'b', status: 'pending' },
        { indent_id: 'c', status: 'rejected' },
      ],
      canBid: true,
    });
    expect(s.members.map((m) => m.id)).toEqual(['a', 'b', 'c']);
    expect(s.biddableIds).toEqual(['a', 'b']);
    expect(s.state).toBe('submitted');
  });

  it('offers nothing to a driver who cannot bid', () => {
    const s = summarizeDriverPool({ key, loads: [load('a')], bids: [], canBid: false });
    expect(s.biddableIds).toEqual([]);
  });
});

describe('driverPoolEyebrow', () => {
  it('counts loads, marking a possibly larger pool', () => {
    expect(driverPoolEyebrow(1, true)).toBe('POOLED · 1 LOAD');
    expect(driverPoolEyebrow(3, true)).toBe('POOLED · 3 LOADS');
    expect(driverPoolEyebrow(3, false)).toBe('POOLED · 3+ LOADS');
  });
});
