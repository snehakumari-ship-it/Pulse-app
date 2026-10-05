import { transitionDriverStopExecution } from '@/features/driver/execution/transitionDriverStopExecution';

const mockRpc = jest.fn();
const mockRefetchEq = jest.fn();
const mockFrom = jest.fn();

jest.mock('@/lib/supabase', () => ({
  supabase: () => ({ rpc: mockRpc, from: mockFrom }),
}));

jest.mock('@/lib/platform/events/InProcessEventBus', () => ({
  getPlatformEventBus: () => ({ publish: () => Promise.resolve() }),
}));

function stopSnapshot(extras: Record<string, unknown> = {}) {
  return {
    trip_id: 't1',
    stop_id: 's1',
    sequence: 1,
    driver_id: 'drv-1',
    status: 'arrived',
    arrived_at: '2026-10-05T10:00:00Z',
    completed_at: null,
    skip_reason: null,
    failure_reason: null,
    pod_required: false,
    ...extras,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFrom.mockImplementation((table: string) => {
    expect(table).toBe('stop_execution_state');
    return { select: () => ({ eq: mockRefetchEq }) };
  });
  mockRefetchEq.mockResolvedValue({
    data: [{ trip_id: 't1', stop_id: 's1', sequence: 1, status: 'pending' }],
    error: null,
  });
});

describe('transitionDriverStopExecution', () => {
  it('arrive sends ARRIVE_STOP for the stop and never writes tables directly', async () => {
    mockRpc.mockResolvedValue({
      data: { ok: true, applied: true, command: 'ARRIVE_STOP', trip_status: 'in_progress', stop: stopSnapshot() },
      error: null,
    });
    const result = await transitionDriverStopExecution({ tripId: 't1', stopId: 's1', transition: 'arrive', commandId: 'cmd-1' });

    expect(mockRpc).toHaveBeenCalledWith('driver_execute_command', {
      p_trip_id: 't1',
      p_command: 'ARRIVE_STOP',
      p_command_id: 'cmd-1',
      p_expected_status: null,
      p_payload: { stop_id: 's1' },
    });
    expect(mockFrom).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.kind).toBe('applied');
      expect(result.row).toMatchObject({ stop_id: 's1', status: 'arrived', arrived_at: '2026-10-05T10:00:00Z' });
      expect(result.command.trip_status).toBe('in_progress');
    }
  });

  it('complete sends COMPLETE_STOP and surfaces derived trip completion', async () => {
    mockRpc.mockResolvedValue({
      data: {
        ok: true, applied: true, command: 'COMPLETE_STOP', trip_status: 'completed', trip_completed: true,
        stop: stopSnapshot({ status: 'completed', completed_at: '2026-10-05T10:05:00Z' }),
      },
      error: null,
    });
    const result = await transitionDriverStopExecution({ tripId: 't1', stopId: 's1', transition: 'complete' });

    expect(mockRpc.mock.calls[0][1]).toMatchObject({ p_command: 'COMPLETE_STOP', p_payload: { stop_id: 's1' } });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.row.completed_at).toBe('2026-10-05T10:05:00Z');
      expect(result.command.trip_completed).toBe(true);
    }
  });

  it('already at target is idempotent, timestamps from the server', async () => {
    mockRpc.mockResolvedValue({
      data: { ok: true, applied: false, command: 'ARRIVE_STOP', trip_status: 'in_progress', stop: stopSnapshot({ arrived_at: 'original' }) },
      error: null,
    });
    const result = await transitionDriverStopExecution({ tripId: 't1', stopId: 's1', transition: 'arrive' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.kind).toBe('idempotent');
      expect(result.row.arrived_at).toBe('original');
    }
  });

  it.each([
    ['pod_required', 'Upload proof of delivery before completing this trip.'],
    ['stop_out_of_order', 'Finish the earlier stops on this route first.'],
    ['invalid_transition', "This step is not available for the trip's current stage."],
  ])('server rejection %s refetches authoritative stops and fabricates nothing', async (code, message) => {
    mockRpc.mockResolvedValue({
      data: { ok: false, command: 'COMPLETE_STOP', error_code: code, stop: { stop_id: 's1', status: 'pending' } },
      error: null,
    });
    const result = await transitionDriverStopExecution({ tripId: 't1', stopId: 's1', transition: 'complete' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe(message);
      expect(result.command?.error_code).toBe(code);
      expect(result.refetchedBundle?.stops[0].status).toBe('pending');
    }
    expect(mockRefetchEq).toHaveBeenCalledWith('trip_id', 't1');
  });

  it('transport error is reported, not treated as success', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'network down' } });
    const result = await transitionDriverStopExecution({ tripId: 't1', stopId: 's1', transition: 'arrive' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toBe('network down');
  });

  it('missing ids never reach the server', async () => {
    const result = await transitionDriverStopExecution({ tripId: 't1', stopId: '', transition: 'arrive' });
    expect(result.ok).toBe(false);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
