import React from 'react';
import { act, fireEvent, render, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { FleetOwnerOpenLoad } from '@/features/driver/services/fleetOwnerLoads.service';
import { FindLoadsContent } from '@/features/driver/components/AvailableLoadsScreen';
import DriverMarketPoolScreen from '@/features/driver/components/DriverMarketPoolScreen';
import {
  POOL_CHANGED_MESSAGE,
  POOL_TOO_LARGE_MESSAGE,
} from '@/features/network/utils/pooledOpportunity.util';
import { ROUTES } from '@/lib/routes';

jest.mock('react-native', () => jest.requireActual('react-native'));

const mockPush = jest.fn();
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  useRouter: () => ({ canGoBack: () => true, back: jest.fn(), replace: jest.fn(), push: mockPush }),
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@react-navigation/native', () => ({ useFocusEffect: jest.fn() }));
jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ status: 'ready', profile: { uid: 'u1' } }),
}));
jest.mock('@/contexts/DriverThemeContext', () => ({
  useDriverTheme: () => ({ isDark: false }),
  useDriverThemeColors: () => ({
    background: '#fff',
    text: '#000',
    textMuted: '#666',
    emerald: '#0a0',
    borderSubtle: '#ddd',
    surface: '#fff',
    surfaceElevated: '#fff',
  }),
}));
jest.mock('@/components/driver/DriverSubScreenHeader', () => {
  const RN = jest.requireActual('react-native');
  return {
    DRIVER_DETAIL_HORIZONTAL_PAD: 16,
    driverDetailPageBackground: () => '#fff',
    DriverSubScreenHeader: ({ title }: { title: string }) => <RN.Text>{title}</RN.Text>,
  };
});
jest.mock('@/features/reach/screens/DriverStoriesScreen', () => ({
  cityOf: (v: string | null) => (v ?? '').split(',')[0].trim(),
  StoriesContent: () => null,
}));
jest.mock('@/features/driver/components/MyBidsScreen', () => ({ MyBidsContent: () => null }));

let mockLoads: FleetOwnerOpenLoad[] = [];
let mockReadComplete = true;
let mockBids: { indent_id: string; status: string }[] = [];
jest.mock('@/lib/queries/useDriverOperatingModeQuery', () => ({
  useDriverOperatingModeQuery: () => ({
    isDco: true,
    marketplaceAllowed: true,
    isLoading: false,
    operatingMode: { mode: 'DCO_ACTIVE' },
  }),
}));
jest.mock('@/lib/queries/useFleetOwnerOpenLoadsQuery', () => ({
  useFleetOwnerOpenLoadsQuery: () => ({
    loads: mockLoads,
    readComplete: mockReadComplete,
    isLoading: false,
    error: null,
    refetch: jest.fn(),
  }),
}));
jest.mock('@/lib/queries/useMyMarketBidsQuery', () => ({
  useMyMarketBidsQuery: () => ({ bids: mockBids, refetch: jest.fn(), invalidate: jest.fn() }),
}));
jest.mock('@/lib/queries/useOwnerVehiclesQuery', () => ({
  useOwnerVehiclesQuery: () => ({
    vehicles: [{ id: 'veh-1', status: 'active', vehicle_type: '32 FT' }],
  }),
}));
const mockRpc = jest.fn();
jest.mock('@/lib/supabase', () => ({ supabase: () => ({ rpc: mockRpc }) }));
jest.mock('@/features/driver/components/MarketLoadBidSheet', () => {
  const RN = jest.requireActual('react-native');
  return {
    MarketLoadBidSheet: (props: {
      visible: boolean;
      shipperName?: string;
      entryLabel?: string;
      contextLine?: string;
      submitLabel?: string;
      validationError?: string;
      onSubmitAmount: (n: number) => Promise<boolean>;
      onClose: () => void;
    }) =>
      props.visible ? (
        <RN.View testID="bid-sheet">
          <RN.Text>{props.shipperName}</RN.Text>
          <RN.Text>{props.entryLabel}</RN.Text>
          <RN.Text>{props.contextLine}</RN.Text>
          {props.validationError ? <RN.Text>{props.validationError}</RN.Text> : null}
          <RN.Pressable
            accessibilityLabel={`Sheet: ${props.submitLabel}`}
            onPress={async () => {
              if (await props.onSubmitAmount(18500)) props.onClose();
            }}
          >
            <RN.Text>{props.submitLabel}</RN.Text>
          </RN.Pressable>
        </RN.View>
      ) : null,
  };
});

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
  creator_organization_name: 'Acme Steel',
  creator_organization_id: 'org-a',
  creator_organization_logo_url: null,
  creator_organization_avatar_seed: null,
  created_at: '2026-10-01T00:00:00Z',
  ...extra,
});

const IDENTITY = /IND-|Acme Steel|Bolt|org-a|org-b/;
const KEY = { pickup: 'Chennai', drop: 'Bengaluru', vehicleType: '32 FT' };

function wrap(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}
const text = (s: ReturnType<typeof wrap>) => JSON.stringify(s.toJSON());

beforeEach(() => {
  jest.clearAllMocks();
  mockRpc.mockReset();
  mockParams = { pickup: 'Chennai', drop: 'Bengaluru', vehicle: '32 FT' };
  mockReadComplete = true;
  mockBids = [];
  mockLoads = [
    load('a'),
    load('b', {
      pickup_area: ' chennai ',
      vehicle_type: '32 ft',
      creator_organization_name: 'Bolt',
      creator_organization_id: 'org-b',
    }),
    load('x', { vehicle_type: '20 FT', creator_organization_name: 'Other Co' }),
  ];
});

describe('Driver Marketplace list', () => {
  const filters = { pickup: null, drop: null, fitsFleet: false } as never;

  it('shows each canonical pool as one anonymous card with no individual Bid', () => {
    const s = wrap(<FindLoadsContent uid="u1" filters={filters} />);
    expect(s.getByText('POOLED · 2 LOADS')).toBeTruthy();
    expect(s.getByText('POOLED · 1 LOAD')).toBeTruthy();
    expect(s.getAllByText('Pooled opportunity')).toHaveLength(2);
    expect(s.queryByText('Bid Now')).toBeNull();
    expect(text(s)).not.toMatch(IDENTITY);
    expect(text(s)).not.toMatch(/Other Co/);
  });

  it('opens the pool by its canonical key, not by an indent', () => {
    mockLoads = [load('a'), load('b')];
    const s = wrap(<FindLoadsContent uid="u1" filters={filters} />);
    fireEvent.press(s.getByText('Quote for pool'));
    expect(mockPush).toHaveBeenCalledWith(ROUTES.driverAvailableLoadPool(KEY));
  });

  it('marks a pool as possibly larger when the feed hit its limit', () => {
    mockReadComplete = false;
    const s = wrap(<FindLoadsContent uid="u1" filters={filters} />);
    expect(s.getByText('POOLED · 2+ LOADS')).toBeTruthy();
  });

  it('keeps the existing single-load card for loads without a full lane', () => {
    mockLoads = [load('a'), load('n', { vehicle_type: null, creator_organization_name: 'Legacy Co' })];
    const s = wrap(<FindLoadsContent uid="u1" filters={filters} />);
    expect(s.getByText('POOLED · 1 LOAD')).toBeTruthy();
    expect(s.getByText('Legacy Co')).toBeTruthy();
    expect(s.getByText('Bid Now')).toBeTruthy();
  });
});

describe('Driver Marketplace pool screen', () => {
  /** get_dco_marketplace_pool shape: members carry no shipper names. */
  function manifest(loads: FleetOwnerOpenLoad[], over: Record<string, unknown> = {}) {
    return {
      pool_key: 'chennai|bengaluru|32 ft',
      as_of: '2026-10-07T00:00:00Z',
      max_members: 150,
      member_count: loads.length,
      excluded_sponsored_count: 0,
      complete: true,
      fingerprint: 'fp-1',
      members: loads.map(
        ({
          creator_organization_name: _n,
          creator_organization_logo_url: _l,
          creator_organization_avatar_seed: _s,
          ...m
        }) => ({ weight: null, ...m }),
      ),
      biddable_ids: loads.map((l) => l.id),
      my_bids: [],
      ...over,
    };
  }

  let pools: ReturnType<typeof manifest>[] = [];
  let submitResults: { data: unknown; error: unknown }[] = [];
  const poolReads = () => mockRpc.mock.calls.filter((c) => c[0] === 'get_dco_marketplace_pool');
  const bidCalls = () => mockRpc.mock.calls.filter((c) => c[0] === 'submit_market_bid');

  beforeEach(() => {
    pools = [manifest([load('a'), mockLoads[1]!])];
    submitResults = [];
    mockRpc.mockImplementation(async (name: string) => {
      if (name === 'get_dco_marketplace_pool') {
        return { data: pools.length > 1 ? pools.shift() : pools[0], error: null };
      }
      return submitResults.shift() ?? { data: { bid_id: 'bid' }, error: null };
    });
  });

  async function openAndSubmit(s: ReturnType<typeof wrap>) {
    fireEvent.press(await s.findByLabelText('Submit rate for pool'));
    await act(async () => {
      fireEvent.press(s.getByLabelText('Sheet: Submit rate for pool'));
    });
  }

  it('reads the pool from the server by its canonical key', async () => {
    const s = wrap(<DriverMarketPoolScreen />);
    await s.findByText('POOLED · 2 LOADS');
    expect(poolReads()[0]?.[1]).toEqual({
      p_pickup: 'Chennai',
      p_drop: 'Bengaluru',
      p_vehicle_type: '32 FT',
    });
  });

  it('a one-load pool is a pool with one rate', async () => {
    pools = [manifest([load('a')])];
    const s = wrap(<DriverMarketPoolScreen />);
    expect(await s.findByText('POOLED · 1 LOAD')).toBeTruthy();
    expect(s.getByText('All 1 eligible load')).toBeTruthy();
  });

  it('is anonymous, offers exactly one pooled rate and no per-load choice', async () => {
    const s = wrap(<DriverMarketPoolScreen />);
    expect(await s.findByText('POOLED · 2 LOADS')).toBeTruthy();
    expect(s.getByText('Chennai → Bengaluru')).toBeTruthy();
    expect(s.getByText('Identity hidden')).toBeTruthy();
    expect(s.getByText('Your rate for this pooled opportunity')).toBeTruthy();
    expect(s.getAllByLabelText('Submit rate for pool')).toHaveLength(1);
    expect(s.queryByText(/Bid Now|Select/)).toBeNull();
    expect(text(s)).not.toMatch(IDENTITY);
    expect(text(s)).not.toMatch(/Other Co/);
  });

  it('submits one rate to every eligible member, after re-reading the pool', async () => {
    const s = wrap(<DriverMarketPoolScreen />);
    fireEvent.press(await s.findByLabelText('Submit rate for pool'));
    const sheet = s.getByTestId('bid-sheet');
    expect(within(sheet).getByText('Applies to all 2 eligible loads in this pool')).toBeTruthy();
    expect(text(s)).not.toMatch(IDENTITY);
    await act(async () => {
      fireEvent.press(s.getByLabelText('Sheet: Submit rate for pool'));
    });
    expect(bidCalls().map((c) => [c[1].p_indent_id, c[1].p_amount])).toEqual([
      ['a', 18500],
      ['b', 18500],
    ]);
    const order = mockRpc.mock.invocationCallOrder;
    const names = mockRpc.mock.calls.map((c) => c[0]);
    expect(order[names.indexOf('get_dco_marketplace_pool', 1)]).toBeLessThan(
      order[names.indexOf('submit_market_bid')]!,
    );
    expect(s.queryByTestId('bid-sheet')).toBeNull();
  });

  it('reports a partial backend failure honestly', async () => {
    submitResults = [
      { data: { bid_id: '1' }, error: null },
      { data: null, error: { message: 'indent_not_open' } },
    ];
    const s = wrap(<DriverMarketPoolScreen />);
    await openAndSubmit(s);
    expect(s.getByText('Partly submitted: your rate reached 1 of 2 loads')).toBeTruthy();
    expect(text(s)).not.toMatch(IDENTITY);
  });

  it('submits nothing when the pool changed between display and submit', async () => {
    pools = [
      manifest([load('a'), mockLoads[1]!]),
      manifest([load('a'), mockLoads[1]!], { fingerprint: 'fp-2' }),
    ];
    const s = wrap(<DriverMarketPoolScreen />);
    await openAndSubmit(s);
    expect(bidCalls()).toHaveLength(0);
    expect(s.queryByTestId('bid-sheet')).toBeNull();
    expect(s.getByText(POOL_CHANGED_MESSAGE)).toBeTruthy();
  });

  it('blocks submission when the pool is larger than the server lists', async () => {
    pools = [
      manifest([], { member_count: 200, complete: false, fingerprint: null, biddable_ids: [] }),
    ];
    const s = wrap(<DriverMarketPoolScreen />);
    expect(await s.findByText(POOL_TOO_LARGE_MESSAGE)).toBeTruthy();
    expect(s.getByText('POOLED · 200 LOADS')).toBeTruthy();
    const cta = s.getByLabelText('Submit rate for pool');
    expect(cta.props.accessibilityState).toEqual({ disabled: true });
    fireEvent.press(cta);
    expect(s.queryByTestId('bid-sheet')).toBeNull();
    expect(bidCalls()).toHaveLength(0);
  });

  it("only targets the server's biddable members", async () => {
    pools = [
      manifest([load('a'), mockLoads[1]!], {
        biddable_ids: ['a'],
        my_bids: [
          {
            id: 'bid-b',
            indent_id: 'b',
            status: 'rejected',
            amount: 19000,
            fee_payment_status: 'not_required',
            updated_at: '2026-10-06T00:00:00Z',
          },
        ],
      }),
    ];
    const s = wrap(<DriverMarketPoolScreen />);
    await openAndSubmit(s);
    expect(bidCalls().map((c) => c[1].p_indent_id)).toEqual(['a']);
  });
});
