import {
  getOrgNetworkPool,
  listNetworkPoolLanes,
  submitNetworkQuote,
} from '../networkPools.service';

const mockRpc = jest.fn();
jest.mock('@/lib/supabase', () => ({ supabase: () => ({ rpc: mockRpc }) }));

const laneRow = (n: number) => ({
  pool_key: `k${String(n).padStart(4, '0')}`,
  pickup_area: 'Pune',
  drop_location: 'Mumbai',
  vehicle_type: '32 FT',
  eligible_count: 1,
  sponsored_count: 0,
  shipper_count: 1,
  too_large: false,
});
const page = (from: number, count: number) =>
  Array.from({ length: count }, (_, i) => laneRow(from + i));

beforeEach(() => {
  mockRpc.mockReset();
});

describe('listNetworkPoolLanes', () => {
  it('reads one short page as the complete lane list', async () => {
    mockRpc.mockResolvedValueOnce({ data: page(0, 3), error: null });
    const res = await listNetworkPoolLanes('org-1');
    expect(res).toMatchObject({ error: null, complete: true });
    expect(res.lanes).toHaveLength(3);
    expect(mockRpc).toHaveBeenCalledWith('list_network_pool_lanes_for_org', {
      p_org_id: 'org-1',
      p_limit: 200,
      p_after_key: null,
    });
  });

  it('pages by the last pool_key until a short page', async () => {
    mockRpc
      .mockResolvedValueOnce({ data: page(0, 200), error: null })
      .mockResolvedValueOnce({ data: page(200, 5), error: null });
    const res = await listNetworkPoolLanes('org-1');
    expect(res.complete).toBe(true);
    expect(res.lanes).toHaveLength(205);
    expect(mockRpc.mock.calls[1]![1].p_after_key).toBe('k0199');
  });

  it('reports an incomplete list when the page budget runs out', async () => {
    let n = 0;
    mockRpc.mockImplementation(async () => {
      const rows = page(n, 200);
      n += 200;
      return { data: rows, error: null };
    });
    const res = await listNetworkPoolLanes('org-1');
    expect(res.complete).toBe(false);
    expect(mockRpc).toHaveBeenCalledTimes(10);
  });

  it('surfaces an RPC error and never claims completeness', async () => {
    mockRpc
      .mockResolvedValueOnce({ data: page(0, 200), error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'unauthorized' } });
    const res = await listNetworkPoolLanes('org-1');
    expect(res.error?.message).toBe('unauthorized');
    expect(res.complete).toBe(false);
  });
});

describe('getOrgNetworkPool', () => {
  it('reads one pool by lane key for the viewing org', async () => {
    mockRpc.mockResolvedValueOnce({ data: { pool_key: 'pune|mumbai|32 ft' }, error: null });
    const res = await getOrgNetworkPool('org-1', {
      pickup: 'Pune',
      drop: 'Mumbai',
      vehicleType: '32 FT',
    });
    expect(res.pool?.pool_key).toBe('pune|mumbai|32 ft');
    expect(mockRpc).toHaveBeenCalledWith('get_org_network_pool', {
      p_org_id: 'org-1',
      p_pickup: 'Pune',
      p_drop: 'Mumbai',
      p_vehicle_type: '32 FT',
    });
  });

  it('returns the RPC error', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'unauthorized' } });
    const res = await getOrgNetworkPool('org-1', { pickup: 'a', drop: 'b', vehicleType: 'c' });
    expect(res).toEqual({ error: new Error('unauthorized'), pool: null });
  });
});

describe('submitNetworkQuote', () => {
  it('calls submit_network_quote, never a table write', async () => {
    mockRpc.mockResolvedValueOnce({ data: { quote_id: 'q1', created: true }, error: null });
    const res = await submitNetworkQuote('ind-1', 'org-1', 18000, '  ');
    expect(res.error).toBeNull();
    expect(mockRpc).toHaveBeenCalledWith('submit_network_quote', {
      p_indent_id: 'ind-1',
      p_bidder_org_id: 'org-1',
      p_amount: 18000,
      p_notes: null,
    });
  });

  it('passes the server reason through for the caller to format', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'quote_locked: quote has been countered or decided' },
    });
    const res = await submitNetworkQuote('ind-1', 'org-1', 18000);
    expect(res.error?.message).toMatch(/^quote_locked/);
    expect(res.quote).toBeNull();
  });
});
