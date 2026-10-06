import { updateTripStatus } from '../trips.service';

const mockFrom = jest.fn();

jest.mock('@/lib/supabase', () => ({
  supabase: () => ({ from: mockFrom }),
}));

jest.mock('@/lib/platform/events/InProcessEventBus', () => ({
  getPlatformEventBus: () => ({ publish: jest.fn().mockResolvedValue(undefined) }),
}));

function awaitable(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {
    select: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    limit: jest.fn(() => builder),
    insert: jest.fn(() => Promise.resolve({ data: null, error: null })),
    maybeSingle: jest.fn(() => Promise.resolve(result)),
    then: (resolve: (v: typeof result) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  return builder;
}

function updateBuilder(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {
    update: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    select: jest.fn(() => builder),
    maybeSingle: jest.fn(() => Promise.resolve(result)),
  };
  return builder;
}

const completedAt = '2026-10-06T12:00:00.000Z';

function marketplaceTrip(overrides: Record<string, unknown>) {
  return {
    id: 'trip-mkt',
    organization_id: 'shipper-org',
    indent_id: 'indent-1',
    source: 'market_bid',
    supplier_id: null,
    driver_id: 'bidder-driver',
    vehicle_id: 'bidder-vehicle',
    client_price: 32500,
    supplier_rate: 32500,
    platform_fee: 500,
    status: 'completed',
    started_at: '2026-10-06T08:00:00.000Z',
    completed_at: completedAt,
    ...overrides,
  };
}

function tablesQueried(): string[] {
  return mockFrom.mock.calls.map((call) => call[0] as string);
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('updateTripStatus — Marketplace award completion', () => {
  it('completes a supplier-less Marketplace award in the market lane', async () => {
    const trip = marketplaceTrip({ trip_payout_mode: 'market' });
    mockFrom
      .mockReturnValueOnce(awaitable({ data: trip, error: null }))
      .mockReturnValueOnce(awaitable({ data: { status: 'in_transit', completed_at: null }, error: null }))
      .mockReturnValueOnce(updateBuilder({ data: trip, error: null }));

    const { error, trip: result } = await updateTripStatus('trip-mkt', {
      status: 'completed',
      completed_at: completedAt,
    });

    expect(error).toBeNull();
    expect(result).not.toBeNull();
  });

  it('never posts shipper-ledger auto-entries for a Marketplace award, even when labeled asset', async () => {
    const trip = marketplaceTrip({ trip_payout_mode: 'asset' });
    mockFrom
      .mockReturnValueOnce(awaitable({ data: trip, error: null }))
      .mockReturnValueOnce(awaitable({ data: { status: 'in_transit', completed_at: null }, error: null }))
      .mockReturnValueOnce(updateBuilder({ data: trip, error: null }))
      .mockReturnValue(awaitable({ data: [], error: null }));

    const { error } = await updateTripStatus('trip-mkt', {
      status: 'completed',
      completed_at: completedAt,
    });

    expect(error).toBeNull();
    expect(tablesQueried()).not.toContain('transactions');
  });

  it('still posts asset auto-entries for a non-Marketplace asset trip', async () => {
    const trip = marketplaceTrip({ source: 'indent', trip_payout_mode: 'asset', platform_fee: 0 });
    mockFrom
      .mockReturnValueOnce(awaitable({ data: trip, error: null }))
      .mockReturnValueOnce(awaitable({ data: { status: 'in_transit', completed_at: null }, error: null }))
      .mockReturnValueOnce(updateBuilder({ data: trip, error: null }))
      .mockReturnValue(awaitable({ data: [], error: null }));

    await updateTripStatus('trip-mkt', { status: 'completed', completed_at: completedAt });

    expect(tablesQueried()).toContain('transactions');
  });
});
