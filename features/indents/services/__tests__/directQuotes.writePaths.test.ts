import {
  acceptDirectQuoteCounter,
  updateDirectQuoteAssignment,
} from '../direct-quotes.service';

const mockRpc = jest.fn();
const mockFrom = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: () => ({ rpc: mockRpc, from: mockFrom }),
}));

beforeEach(() => {
  mockRpc.mockReset();
  mockFrom.mockReset();
});

describe('updateDirectQuoteAssignment', () => {
  it('assigns through set_direct_quote_assignment, never a table update', async () => {
    mockRpc.mockResolvedValueOnce({ data: { id: 'q1' }, error: null });
    const res = await updateDirectQuoteAssignment('q1', 'd1', 'v1');
    expect(res.error).toBeNull();
    expect(mockRpc).toHaveBeenCalledWith('set_direct_quote_assignment', {
      p_quote_id: 'q1',
      p_driver_id: 'd1',
      p_vehicle_id: 'v1',
    });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('keeps the ad hoc (no driver) path', async () => {
    mockRpc.mockResolvedValueOnce({ data: { id: 'q1' }, error: null });
    await updateDirectQuoteAssignment('q1', null, 'v1');
    expect(mockRpc.mock.calls[0]![1]).toMatchObject({ p_driver_id: null, p_vehicle_id: 'v1' });
  });

  it.each([
    ['invalid_driver: driver must belong to your organization', /driver is not in your organization/],
    ['invalid_vehicle: vehicle must belong to your organization', /vehicle is not in your organization/],
    ['invalid_state: quote is not accepted', /no longer awarded/],
    ['not_found', /Could not find this awarded quote/],
    ['unauthorized', /don't have permission/],
  ])('maps %s to a user-facing message', async (raw, expected) => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: raw } });
    const res = await updateDirectQuoteAssignment('q1', 'd1', 'v1');
    expect(res.error?.message).toMatch(expected);
  });

  it('keeps an unknown reason as-is', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'network down' } });
    const res = await updateDirectQuoteAssignment('q1', 'd1', 'v1');
    expect(res.error?.message).toBe('network down');
  });
});

describe('acceptDirectQuoteCounter', () => {
  it('accepts through accept_direct_quote_counter, never a table update', async () => {
    mockRpc.mockResolvedValueOnce({ data: { quote_id: 'q1' }, error: null });
    const res = await acceptDirectQuoteCounter('q1', 17500);
    expect(res.error).toBeNull();
    expect(mockRpc).toHaveBeenCalledWith('accept_direct_quote_counter', {
      p_quote_id: 'q1',
      p_counter_amount: 17500,
    });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('leaves quote_locked for the shared formatter', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'quote_locked: this counter offer is no longer open' },
    });
    const res = await acceptDirectQuoteCounter('q1', 17500);
    expect(res.error?.message).toMatch(/^quote_locked/);
  });

  it('explains a quote the caller cannot accept', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'not_found: no matching quote for your organization' },
    });
    const res = await acceptDirectQuoteCounter('q1', 17500);
    expect(res.error?.message).toBe('This counter offer is no longer open.');
  });
});
