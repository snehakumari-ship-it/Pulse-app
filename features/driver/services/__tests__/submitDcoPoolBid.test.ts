import { submitDcoPoolBid } from '@/features/driver/services/marketBids.service';

const mockRpc = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: () => ({ rpc: mockRpc }),
}));

beforeEach(() => mockRpc.mockReset());

const members = new Set(['a', 'b', 'c']);

describe('submitDcoPoolBid', () => {
  it('writes the same rate to every target through submit_market_bid', async () => {
    mockRpc.mockResolvedValue({ data: { bid_id: 'bid' }, error: null });
    const r = await submitDcoPoolBid({ indentIds: ['a', 'b', 'c'], memberIds: members }, 18500, 'veh-1');
    expect(r).toEqual({ blocked: null, attempted: 3, succeeded: ['a', 'b', 'c'], failed: [] });
    expect(mockRpc).toHaveBeenCalledTimes(3);
    for (const [i, id] of ['a', 'b', 'c'].entries()) {
      expect(mockRpc).toHaveBeenNthCalledWith(i + 1, 'submit_market_bid', {
        p_indent_id: id,
        p_amount: 18500,
        p_note: null,
        p_bidder_organization_id: null,
        p_owner_vehicle_id: 'veh-1',
      });
    }
  });

  it('reports partial backend failures per load without stopping', async () => {
    mockRpc
      .mockResolvedValueOnce({ data: { bid_id: '1' }, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'indent_not_open' } })
      .mockRejectedValueOnce(new Error('network down'));
    const r = await submitDcoPoolBid({ indentIds: ['a', 'b', 'c'], memberIds: members }, 100, null);
    expect(r.succeeded).toEqual(['a']);
    expect(r.failed).toEqual([
      { indentId: 'b', message: 'indent_not_open' },
      { indentId: 'c', message: 'network down' },
    ]);
  });

  it('refuses a subset that includes a non-member before any write', async () => {
    const r = await submitDcoPoolBid({ indentIds: ['a', 'z'], memberIds: members }, 100, null);
    expect(r.blocked).toMatch(/not part of this pool/);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('refuses an empty or over-cap pool before any write', async () => {
    expect((await submitDcoPoolBid({ indentIds: [], memberIds: members }, 1, null)).blocked).toBeTruthy();
    const ids = Array.from({ length: 151 }, (_, i) => `m${i}`);
    const r = await submitDcoPoolBid({ indentIds: ids, memberIds: new Set(ids) }, 1, null);
    expect(r.blocked).toMatch(/more loads than Marketplace can currently process/);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
