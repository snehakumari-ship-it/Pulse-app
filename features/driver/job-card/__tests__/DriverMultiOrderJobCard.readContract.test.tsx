/**
 * Commerce Job Card read/command contract at the supabase() boundary.
 * Real hooks, fetchers, normalizers and command service; only the client is mocked.
 */
import React from 'react';
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DriverJobCard } from '@/features/driver/job-card/DriverJobCard';
import { updateTripStatus } from '@/features/trips/services/trips.service';
import type { TripRow } from '@/features/trips/services/trips.service';

type Call = { kind: 'from' | 'rpc'; name: string; args?: Record<string, unknown> };

const mockCalls: Call[] = [];
let mockSesRows: Array<Record<string, unknown>> = [];
let mockPrimitiveARows: Array<Record<string, unknown>> = [];
let mockCommandResult: (args: Record<string, unknown>) => Record<string, unknown> = () => ({ ok: false });

jest.mock('react-native', () => jest.requireActual('react-native'));

jest.mock('@/lib/supabase', () => ({
  supabase: () => ({
    from: (table: string) => {
      mockCalls.push({ kind: 'from', name: table });
      return {
        select: () => ({
          eq: () => Promise.resolve({ data: mockSesRows, error: null }),
        }),
      };
    },
    rpc: (name: string, args: Record<string, unknown>) => {
      mockCalls.push({ kind: 'rpc', name, args });
      if (name === 'get_driver_trip_stop_orders') {
        return Promise.resolve({ data: mockPrimitiveARows, error: null });
      }
      if (name === 'driver_execute_command') {
        return Promise.resolve({ data: mockCommandResult(args), error: null });
      }
      return Promise.resolve({ data: null, error: { message: `unexpected rpc ${name}` } });
    },
  }),
}));

jest.mock('@/lib/platform/events/InProcessEventBus', () => ({
  getPlatformEventBus: () => ({ publish: () => Promise.resolve() }),
}));

jest.mock('@/components/driver/DriverTripSheetLayout', () => ({
  TRIP_SHEET_TOP_RADIUS: 16,
  TRIP_SHEET_BODY_PAD: { horizontal: 18, top: 12, bottom: 10, gap: 8 },
}));

jest.mock('@/features/driver/components/MissionCardLayout', () => {
  const { View } = require('react-native');
  return { MissionCardLayout: () => <View testID="mission-card-layout" /> };
});

jest.mock('@/features/driver/components/DriverTripFlowCard', () => {
  const { View } = require('react-native');
  return { DriverTripFlowCard: () => <View testID="legacy-job-card" /> };
});

jest.mock('@/components/LoadingIndicator', () => ({ LoadingIndicator: () => null }));

jest.mock('@/contexts/DriverThemeContext', () => {
  const colors = {
    background: '#f8fafc',
    surface: '#fff',
    surfaceElevated: '#f1f5f9',
    border: '#e2e8f0',
    text: '#0f172a',
    textMuted: '#64748b',
    textOnPrimary: '#fff',
    primary: '#059669',
    emerald: '#047857',
    emeraldMuted: 'rgba(4,120,87,0.12)',
    emeraldBorder: 'rgba(4,120,87,0.38)',
  };
  return { useDriverThemeColors: () => colors, getDriverThemeColors: () => colors };
});

jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ profile: { uid: 'user-1' } }),
}));

jest.mock('@/features/trips/services/trips.service', () => ({
  updateTripStatus: jest.fn(),
  resolveDriverFacingTripLabel: () => 'TRP-C',
}));

jest.mock('@/features/driver/job-card/persistStopDeliveryProof', () => ({
  persistStopDeliveryProof: jest.fn().mockResolvedValue({ ok: true }),
}));

const TRIP_ID = 'trip-c';

const PLAN_STOPS = {
  pu: { id: 'pu', stop_type: 'pickup', display_name: 'Guindy Warehouse', lat: 13.01, lon: 80.21 },
  d1: { id: 'd1', stop_type: 'drop', display_name: 'Anna Nagar', lat: 13.08, lon: 80.21 },
  d2: { id: 'd2', stop_type: 'drop', display_name: 'Adyar', lat: 13.0, lon: 80.25 },
  d3: { id: 'd3', stop_type: 'drop', display_name: 'Velachery', lat: 12.97, lon: 80.22 },
} as const;
type StopKey = keyof typeof PLAN_STOPS;
const SEQ: Record<StopKey, number> = { pu: 1, d1: 2, d2: 3, d3: 4 };

function sesRow(key: StopKey, status: string) {
  const p = PLAN_STOPS[key];
  return {
    trip_id: TRIP_ID,
    stop_id: p.id,
    sequence: SEQ[key],
    status,
    driver_id: 'drv-1',
    arrived_at: null,
    completed_at: null,
    skip_reason: null,
    failure_reason: null,
    execution_plan_stops: {
      id: p.id,
      stop_type: p.stop_type,
      display_name: p.display_name,
      label: null,
      address_line: `${p.display_name} Main Rd`,
      city: 'Chennai',
      state: 'TN',
      pincode: null,
      latitude: p.lat,
      longitude: p.lon,
      contact_name: null,
      contact_phone: null,
      pod_required: false,
    },
  };
}

function paRow(key: StopKey, order: string, line: string, productId: string, productName: string, quantity: number) {
  const p = PLAN_STOPS[key];
  return {
    trip_id: TRIP_ID,
    indent_id: 'ind-1',
    execution_plan_id: 'plan-1',
    stop_id: p.id,
    sequence: SEQ[key],
    stop_type: p.stop_type,
    source_type: null,
    display_name: p.display_name,
    label: null,
    address_line: `${p.display_name} Main Rd`,
    city: 'Chennai',
    state: 'TN',
    pincode: null,
    contact_name: null,
    contact_phone: null,
    latitude: p.lat,
    longitude: p.lon,
    pod_required: false,
    stop_execution_status: 'pending',
    arrived_at: null,
    completed_at: null,
    failure_reason: null,
    attachment_role: key === 'pu' ? 'pickup' : 'drop',
    sales_order_id: `so-${order}`,
    order_number: `SO-${order}`,
    customer_id: `c-${order}`,
    customer_name: `Customer ${order}`,
    customer_phone: null,
    sales_order_line_id: line,
    quantity,
    delivery_window_start: null,
    delivery_window_end: null,
    notes: null,
    priority: null,
    order_total_amount: null,
    currency: null,
    stop_distinct_drop_order_count: 1,
    order_distinct_drop_stop_count: 1,
    order_completed_drop_stop_count: 0,
    product_id: productId,
    product_name: productName,
    product_sku: `SKU-${productId}`,
    product_image_path: null,
  };
}

/** 3 orders / 4 stops. Pickup carries all three orders; order A has two lines. */
const PRIMITIVE_A = [
  paRow('pu', 'A', 'la1', 'p1', 'Rice 5kg', 2),
  paRow('pu', 'A', 'la2', 'p2', 'Atta 10kg', 1),
  paRow('pu', 'B', 'lb1', 'p3', 'Sugar 1kg', 4),
  paRow('pu', 'C', 'lc1', 'p4', 'Oil 1L', 6),
  paRow('d1', 'A', 'la1', 'p1', 'Rice 5kg', 2),
  paRow('d1', 'A', 'la2', 'p2', 'Atta 10kg', 1),
  paRow('d2', 'B', 'lb1', 'p3', 'Sugar 1kg', 4),
  paRow('d3', 'C', 'lc1', 'p4', 'Oil 1L', 6),
];

function commerceTrip(): TripRow {
  return { id: TRIP_ID, status: 'in_progress', is_commerce: true, execution_plan_id: 'plan-1' } as TripRow;
}

const clients: QueryClient[] = [];

afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
});

function renderCard(trip: TripRow, props: Record<string, unknown> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>
      <DriverJobCard trip={trip} {...props} />
    </QueryClientProvider>,
  );
}

const sesReads = () => mockCalls.filter((c) => c.kind === 'from' && c.name === 'stop_execution_state').length;
const primitiveAReads = () => mockCalls.filter((c) => c.kind === 'rpc' && c.name === 'get_driver_trip_stop_orders').length;
const commands = () => mockCalls.filter((c) => c.kind === 'rpc' && c.name === 'driver_execute_command');
const nonSesTables = () => mockCalls.filter((c) => c.kind === 'from' && c.name !== 'stop_execution_state');

async function waitForLoaded(view: ReturnType<typeof render>) {
  await waitFor(() => expect(view.getByText('3 Orders · 4 Stops · 4 Products')).toBeTruthy());
  await waitFor(() => expect(view.queryByText('Route setup pending')).toBeNull());
}

describe('Commerce Job Card — read contract', () => {
  beforeEach(() => {
    mockCalls.length = 0;
    mockSesRows = [sesRow('d2', 'pending'), sesRow('pu', 'completed'), sesRow('d3', 'pending'), sesRow('d1', 'pending')];
    mockPrimitiveARows = PRIMITIVE_A;
    mockCommandResult = () => ({ ok: false, error_code: 'invalid_command' });
    (updateTripStatus as jest.Mock).mockClear();
  });

  it('loads with exactly one SES read and one Primitive A read, and renders the summary', async () => {
    const view = renderCard(commerceTrip());
    await waitForLoaded(view);
    expect(view.getByText('Commerce Delivery')).toBeTruthy();
    expect(sesReads()).toBe(1);
    expect(primitiveAReads()).toBe(1);
    expect(mockCalls.find((c) => c.name === 'get_driver_trip_stop_orders')?.args).toEqual({ p_trip_id: TRIP_ID });
    expect(nonSesTables()).toEqual([]);
    expect(commands()).toEqual([]);
  });

  it('orders the timeline by execution sequence and marks done / current / upcoming', async () => {
    const view = renderCard(commerceTrip());
    await waitForLoaded(view);
    const ids = view.getAllByTestId(/^commerce-timeline-stop-/).map((node) => node.props.testID);
    expect(ids).toEqual([
      'commerce-timeline-stop-pu',
      'commerce-timeline-stop-d1',
      'commerce-timeline-stop-d2',
      'commerce-timeline-stop-d3',
    ]);
    const pu = within(view.getByTestId('commerce-timeline-stop-pu'));
    const d1 = within(view.getByTestId('commerce-timeline-stop-d1'));
    const d2 = within(view.getByTestId('commerce-timeline-stop-d2'));
    expect(pu.getByTestId('commerce-timeline-marker-done')).toBeTruthy();
    expect(d1.getByTestId('commerce-timeline-marker-current')).toBeTruthy();
    expect(d2.getByTestId('commerce-timeline-marker-upcoming')).toBeTruthy();
    expect(pu.getByText('1 · Pickup')).toBeTruthy();
    expect(pu.getByText('Done')).toBeTruthy();
    expect(d1.getByText('2 · Delivery')).toBeTruthy();
    expect(d1.getByText('Next up')).toBeTruthy();
  });

  it('expands only the current stop by default; collapsed stops show a concise order list', async () => {
    const view = renderCard(commerceTrip());
    await waitForLoaded(view);
    expect(view.getByTestId('commerce-timeline-orders-d1')).toBeTruthy();
    expect(view.queryByTestId('commerce-timeline-orders-pu')).toBeNull();
    expect(view.queryByTestId('commerce-timeline-orders-d2')).toBeNull();
    expect(view.getByTestId('commerce-timeline-brief-pu').props.children).toBe('#SO-A, #SO-B, #SO-C');
    expect(within(view.getByTestId('commerce-timeline-stop-pu')).getByText('3 orders · 4 products')).toBeTruthy();
  });

  it('stop, order and product expansion and the map control make zero requests', async () => {
    const onShowRouteOnMap = jest.fn();
    const view = renderCard(commerceTrip(), { onShowRouteOnMap });
    await waitForLoaded(view);
    const baseline = mockCalls.length;

    fireEvent.press(view.getByTestId('commerce-timeline-toggle-pu'));
    const puOrders = within(view.getByTestId('commerce-timeline-orders-pu'));
    expect(puOrders.getByTestId('commerce-order-so-A')).toBeTruthy();
    expect(puOrders.getByTestId('commerce-order-so-B')).toBeTruthy();
    expect(puOrders.getByTestId('commerce-order-so-C')).toBeTruthy();
    expect(mockCalls.length).toBe(baseline);

    fireEvent.press(puOrders.getByLabelText('Order #SO-A, 2 products'));
    const lines = within(view.getByTestId('commerce-order-lines-so-A'));
    expect(lines.getByText('Rice 5kg')).toBeTruthy();
    expect(lines.getByText('Atta 10kg')).toBeTruthy();
    expect(lines.getByText('× 2')).toBeTruthy();
    expect(lines.getByText('× 1')).toBeTruthy();
    expect(mockCalls.length).toBe(baseline);

    fireEvent.press(view.getByTestId('commerce-timeline-toggle-d1'));
    expect(view.queryByTestId('commerce-timeline-orders-d1')).toBeNull();
    fireEvent.press(view.getByTestId('commerce-timeline-toggle-pu'));
    expect(view.queryByTestId('commerce-timeline-orders-pu')).toBeNull();

    fireEvent.press(view.getByLabelText('View trip plan on map'));
    expect(view.getByTestId('trip-plan-page')).toBeTruthy();
    expect(onShowRouteOnMap).not.toHaveBeenCalled();
    expect(mockCalls.length).toBe(baseline);
  });

  it('never fabricates a unit when Primitive A has no UOM', async () => {
    const view = renderCard(commerceTrip());
    await waitForLoaded(view);
    const d1Orders = within(view.getByTestId('commerce-timeline-orders-d1'));
    fireEvent.press(d1Orders.getByLabelText('Order #SO-A, 2 products'));
    const line = within(view.getByTestId('commerce-product-line-so-A-0'));
    expect(line.getByText('Rice 5kg')).toBeTruthy();
    expect(line.getByText('× 2')).toBeTruthy();
    expect(line.queryByText(/^×\s*2\s+\S/)).toBeNull();
  });

  it('publishes stop pins only to the map', async () => {
    const onRoutePlanMapChange = jest.fn();
    const view = renderCard(commerceTrip(), { onRoutePlanMapChange });
    await waitForLoaded(view);
    const map = onRoutePlanMapChange.mock.calls.map(([arg]) => arg).filter(Boolean).pop();
    expect(map.stops.map((s: { stopId: string; sequence: number }) => [s.stopId, s.sequence])).toEqual([
      ['pu', 1], ['d1', 2], ['d2', 3], ['d3', 4],
    ]);
    for (const pin of map.stops) {
      expect(Object.keys(pin).sort()).toEqual(
        ['isCurrent', 'kind', 'kindIndex', 'label', 'latitude', 'longitude', 'sequence', 'stopId'],
      );
    }
    expect(primitiveAReads()).toBe(1);
  });

  it('empty SES renders Route setup pending from the plan and offers no stop action', async () => {
    mockSesRows = [];
    const view = renderCard(commerceTrip());
    await waitFor(() => expect(view.getByText('3 Orders · 4 Stops · 4 Products')).toBeTruthy());
    expect(view.getAllByText('Route setup pending').length).toBeGreaterThan(0);
    expect(view.getAllByTestId(/^commerce-timeline-stop-/)).toHaveLength(4);
    expect(view.queryByLabelText('Ready to deliver')).toBeNull();
    expect(view.queryByLabelText('Ready to pick up')).toBeNull();
    expect(sesReads()).toBe(1);
    expect(primitiveAReads()).toBe(1);
    expect(commands()).toEqual([]);
  });
});

describe('Commerce Job Card — command path', () => {
  beforeEach(() => {
    mockCalls.length = 0;
    mockPrimitiveARows = PRIMITIVE_A;
    (updateTripStatus as jest.Mock).mockClear();
  });

  it('ARRIVE_STOP goes through driver_execute_command with the current stop id', async () => {
    mockSesRows = [sesRow('pu', 'completed'), sesRow('d1', 'pending'), sesRow('d2', 'pending'), sesRow('d3', 'pending')];
    mockCommandResult = () => ({
      ok: true, applied: true, command: 'ARRIVE_STOP', trip_status: 'in_progress', previous_status: 'in_progress',
      stop: { trip_id: TRIP_ID, stop_id: 'd1', sequence: 2, status: 'arrived', arrived_at: 'a' },
    });
    const view = renderCard(commerceTrip());
    await waitForLoaded(view);
    fireEvent.press(view.getByLabelText('Ready to deliver'));
    await waitFor(() => expect(commands()).toHaveLength(1));
    expect(commands()[0].args).toEqual(expect.objectContaining({
      p_trip_id: TRIP_ID,
      p_command: 'ARRIVE_STOP',
      p_payload: { stop_id: 'd1' },
    }));
    await waitFor(() => expect(view.getByLabelText('Verify delivery')).toBeTruthy());
    expect(nonSesTables()).toEqual([]);
    expect(updateTripStatus).not.toHaveBeenCalled();
  });

  it('renders the server message when ARRIVE_STOP is rejected as stop_out_of_order', async () => {
    mockSesRows = [sesRow('pu', 'completed'), sesRow('d1', 'pending'), sesRow('d2', 'pending'), sesRow('d3', 'pending')];
    mockCommandResult = () => ({ ok: false, command: 'ARRIVE_STOP', error_code: 'stop_out_of_order' });
    const view = renderCard(commerceTrip());
    await waitForLoaded(view);
    fireEvent.press(view.getByLabelText('Ready to deliver'));
    await waitFor(() => expect(view.getByText('Finish the earlier stops on this route first.')).toBeTruthy());
    expect(updateTripStatus).not.toHaveBeenCalled();
  });

  it('final COMPLETE_STOP: server result completes the trip, with no COMPLETE_TRIP or trips write', async () => {
    mockSesRows = [sesRow('pu', 'completed'), sesRow('d1', 'completed'), sesRow('d2', 'completed'), sesRow('d3', 'arrived')];
    mockCommandResult = () => ({
      ok: true, applied: true, command: 'COMPLETE_STOP', trip_status: 'completed', previous_status: 'in_progress',
      trip_completed: true, completed_at: 'c', trip_id: TRIP_ID, organization_id: 'org-1',
      stop: { trip_id: TRIP_ID, stop_id: 'd3', sequence: 4, status: 'completed', completed_at: 'c' },
    });
    const onTripCompleted = jest.fn();
    const onTripUpdated = jest.fn();
    const view = renderCard(commerceTrip(), { onTripCompleted, onTripUpdated });
    await waitForLoaded(view);
    fireEvent.press(view.getByLabelText('Verify delivery'));
    fireEvent.press(view.getByLabelText('Handed to recipient'));
    fireEvent.press(view.getByLabelText('Confirm delivery'));
    await waitFor(() => expect(onTripCompleted).toHaveBeenCalledTimes(1));
    expect(commands().map((c) => c.args?.p_command)).toEqual(['COMPLETE_STOP']);
    expect(commands()[0].args?.p_payload).toEqual({ stop_id: 'd3' });
    expect(onTripUpdated).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }));
    expect(nonSesTables()).toEqual([]);
    expect(updateTripStatus).not.toHaveBeenCalled();
  });

  it('COMPLETE_STOP that leaves stops open does not complete the trip locally', async () => {
    mockSesRows = [sesRow('pu', 'completed'), sesRow('d1', 'arrived'), sesRow('d2', 'pending'), sesRow('d3', 'pending')];
    mockCommandResult = () => ({
      ok: true, applied: true, command: 'COMPLETE_STOP', trip_status: 'in_progress', previous_status: 'in_progress',
      stop: { trip_id: TRIP_ID, stop_id: 'd1', sequence: 2, status: 'completed', completed_at: 'c' },
    });
    const onTripCompleted = jest.fn();
    const view = renderCard(commerceTrip(), { onTripCompleted });
    await waitForLoaded(view);
    fireEvent.press(view.getByLabelText('Verify delivery'));
    fireEvent.press(view.getByLabelText('Handed to recipient'));
    fireEvent.press(view.getByLabelText('Confirm delivery'));
    await waitFor(() => expect(commands()).toHaveLength(1));
    expect(commands()[0].args?.p_command).toBe('COMPLETE_STOP');
    expect(onTripCompleted).not.toHaveBeenCalled();
  });
});

describe('FTL regression at the client boundary', () => {
  beforeEach(() => {
    mockCalls.length = 0;
  });

  it('a plain FTL trip renders the FTL card and makes no SES or Commerce request', async () => {
    const view = renderCard({ id: 'trip-ftl', status: 'assigned' } as TripRow);
    expect(view.getByTestId('legacy-job-card')).toBeTruthy();
    expect(view.queryByTestId('commerce-route-timeline')).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockCalls).toEqual([]);
  });

  it('a TRP011-style at_drop FTL trip with stops/orders lookalike fields stays FTL', async () => {
    const view = renderCard({
      id: 'trip-011', status: 'at_drop', execution_plan_id: '  ', is_commerce: false,
    } as TripRow);
    expect(view.getByTestId('legacy-job-card')).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockCalls).toEqual([]);
  });
});
