/**
 * Commerce Job Card acceptance: stop → orders → lines semantics, server-authoritative
 * POD and completion, and driver edge cases. Only the supabase() client is mocked.
 */
import fs from 'fs';
import path from 'path';
import React from 'react';
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DriverJobCard } from '@/features/driver/job-card/DriverJobCard';
import { persistStopDeliveryProof } from '@/features/driver/job-card/persistStopDeliveryProof';
import { updateTripStatus } from '@/features/trips/services/trips.service';
import type { TripRow } from '@/features/trips/services/trips.service';

type Call = { kind: 'from' | 'rpc'; name: string; args?: Record<string, unknown> };

const mockCalls: Call[] = [];
let mockSesRows: Array<Record<string, unknown>> = [];
let mockPrimitiveA: { data: Array<Record<string, unknown>> | null; error: { message: string } | null } = {
  data: [],
  error: null,
};
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
      if (name === 'get_driver_trip_stop_orders') return Promise.resolve(mockPrimitiveA);
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
    negativeMuted: 'rgba(220,38,38,0.12)',
  };
  return { useDriverThemeColors: () => colors, getDriverThemeColors: () => colors };
});

jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ profile: { uid: 'user-1' } }),
}));

jest.mock('@/features/trips/services/trips.service', () => ({
  updateTripStatus: jest.fn(),
  resolveDriverFacingTripLabel: () => 'TRP-M',
}));

const mockUploadTripDocument = jest.fn();

jest.mock('@/features/trips/services/tripDocuments.service', () => ({
  uploadTripDocument: (...args: unknown[]) => mockUploadTripDocument(...args),
}));

jest.mock('@/features/driver/job-card/persistStopDeliveryProof', () => {
  const actual = jest.requireActual('@/features/driver/job-card/persistStopDeliveryProof');
  return { persistStopDeliveryProof: jest.fn(actual.persistStopDeliveryProof) };
});

const TRIP_ID = 'trip-m';

type PlanStop = {
  id: string;
  sequence: number;
  type: 'pickup' | 'drop';
  name: string;
  lat?: number | null;
  lon?: number | null;
  phone?: string | null;
  pod?: boolean;
};

function sesRow(stop: PlanStop, status: string) {
  return {
    trip_id: TRIP_ID,
    stop_id: stop.id,
    sequence: stop.sequence,
    status,
    driver_id: 'drv-1',
    arrived_at: status === 'arrived' ? '2026-10-06T05:00:00Z' : null,
    completed_at: status === 'completed' ? '2026-10-06T04:30:00Z' : null,
    skip_reason: null,
    failure_reason: status === 'failed' ? 'Customer unavailable' : null,
    execution_plan_stops: {
      id: stop.id,
      stop_type: stop.type,
      display_name: stop.name,
      label: null,
      address_line: `${stop.name} Main Rd`,
      city: 'Chennai',
      state: 'TN',
      pincode: null,
      latitude: stop.lat === undefined ? 13 : stop.lat,
      longitude: stop.lon === undefined ? 80.2 : stop.lon,
      contact_name: null,
      contact_phone: stop.phone ?? null,
      pod_required: stop.pod ?? true,
    },
  };
}

type Line = {
  stop: PlanStop;
  order: string;
  line: string;
  productId: string;
  productName: string;
  quantity: number;
  drops?: number;
  dropsDone?: number;
  notes?: string | null;
  phone?: string | null;
};

function paRow(l: Line) {
  return {
    trip_id: TRIP_ID,
    indent_id: 'ind-1',
    execution_plan_id: 'plan-1',
    stop_id: l.stop.id,
    sequence: l.stop.sequence,
    stop_type: l.stop.type,
    source_type: null,
    display_name: l.stop.name,
    label: null,
    address_line: `${l.stop.name} Main Rd`,
    city: 'Chennai',
    state: 'TN',
    pincode: null,
    contact_name: null,
    contact_phone: null,
    latitude: 13,
    longitude: 80.2,
    pod_required: true,
    stop_execution_status: 'pending',
    arrived_at: null,
    completed_at: null,
    failure_reason: null,
    attachment_role: l.stop.type,
    sales_order_id: `so-${l.order}`,
    order_number: `SO-${l.order}`,
    customer_id: `c-${l.order}`,
    customer_name: `Customer ${l.order}`,
    customer_phone: l.phone ?? null,
    sales_order_line_id: l.line,
    quantity: l.quantity,
    delivery_window_start: null,
    delivery_window_end: null,
    notes: l.notes ?? null,
    priority: null,
    order_total_amount: null,
    currency: null,
    stop_distinct_drop_order_count: 1,
    order_distinct_drop_stop_count: l.drops ?? 1,
    order_completed_drop_stop_count: l.dropsDone ?? 0,
    product_id: l.productId,
    product_name: l.productName,
    product_sku: `SKU-${l.productId}`,
    product_image_path: null,
  };
}

const PU: PlanStop = { id: 'pu', sequence: 1, type: 'pickup', name: 'Guindy Warehouse' };
const D1: PlanStop = { id: 'd1', sequence: 2, type: 'drop', name: 'Anna Nagar' };
const D2: PlanStop = { id: 'd2', sequence: 3, type: 'drop', name: 'Adyar' };

/**
 * Order X: two lines, both at Adyar.
 * Order Y: split across two drops — Sugar at Anna Nagar (done), Oil at Adyar.
 * Order Z: one line at Anna Nagar.
 * Adyar therefore carries two orders (X and Y) with their own lines.
 */
const MULTI_ORDER_STOP: Line[] = [
  { stop: PU, order: 'X', line: 'x1', productId: 'p1', productName: 'Rice 5kg', quantity: 2 },
  { stop: PU, order: 'X', line: 'x2', productId: 'p2', productName: 'Atta 10kg', quantity: 1 },
  { stop: PU, order: 'Y', line: 'y1', productId: 'p3', productName: 'Sugar 1kg', quantity: 4, drops: 2, dropsDone: 1 },
  { stop: PU, order: 'Y', line: 'y2', productId: 'p4', productName: 'Oil 1L', quantity: 6, drops: 2, dropsDone: 1 },
  { stop: PU, order: 'Z', line: 'z1', productId: 'p5', productName: 'Salt 1kg', quantity: 3, dropsDone: 1 },
  { stop: D1, order: 'Y', line: 'y1', productId: 'p3', productName: 'Sugar 1kg', quantity: 4, drops: 2, dropsDone: 1 },
  { stop: D1, order: 'Z', line: 'z1', productId: 'p5', productName: 'Salt 1kg', quantity: 3, dropsDone: 1 },
  { stop: D2, order: 'X', line: 'x1', productId: 'p1', productName: 'Rice 5kg', quantity: 2 },
  { stop: D2, order: 'X', line: 'x2', productId: 'p2', productName: 'Atta 10kg', quantity: 1 },
  { stop: D2, order: 'Y', line: 'y2', productId: 'p4', productName: 'Oil 1L', quantity: 6, drops: 2, dropsDone: 1 },
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

async function loaded(view: ReturnType<typeof render>, summary: string) {
  await waitFor(() => expect(view.getByText(summary)).toBeTruthy());
  await waitFor(() => expect(view.queryByText('Route setup pending')).toBeNull());
}

function seed(lines: Line[], ses: Array<Record<string, unknown>>) {
  mockCalls.length = 0;
  mockPrimitiveA = { data: lines.map(paRow), error: null };
  mockSesRows = ses;
  mockCommandResult = () => ({ ok: false, error_code: 'invalid_command' });
  (updateTripStatus as jest.Mock).mockClear();
  (persistStopDeliveryProof as jest.Mock).mockClear();
  mockUploadTripDocument.mockReset();
  mockUploadTripDocument.mockResolvedValue({ doc: { id: 'pod-doc-1' }, error: null });
}

describe('Commerce semantics — multiple orders at one stop', () => {
  beforeEach(() => {
    seed(MULTI_ORDER_STOP, [sesRow(PU, 'completed'), sesRow(D1, 'completed'), sesRow(D2, 'arrived')]);
  });

  it('counts orders, stops and distinct products across the trip', async () => {
    const view = renderCard(commerceTrip());
    await loaded(view, '3 Orders · 3 Stops · 5 Products');
    expect(within(view.getByTestId('multi-order-stop-orders')).getByText(/^2 orders · 9 items/)).toBeTruthy();
  });

  it('timeline shows each order at the stop with only that order\'s lines for that stop', async () => {
    const view = renderCard(commerceTrip());
    await loaded(view, '3 Orders · 3 Stops · 5 Products');
    const d2 = within(view.getByTestId('commerce-timeline-orders-d2'));
    expect(d2.getByTestId('commerce-order-so-X')).toBeTruthy();
    expect(d2.getByTestId('commerce-order-so-Y')).toBeTruthy();
    expect(d2.queryByTestId('commerce-order-so-Z')).toBeNull();

    fireEvent.press(d2.getByLabelText('Order #SO-X, 2 products'));
    const x = within(view.getByTestId('commerce-order-lines-so-X'));
    expect(x.getByText('Rice 5kg')).toBeTruthy();
    expect(x.getByText('Atta 10kg')).toBeTruthy();
    expect(x.queryByText('Oil 1L')).toBeNull();

    fireEvent.press(d2.getByLabelText('Order #SO-Y, 1 product'));
    const y = within(view.getByTestId('commerce-order-lines-so-Y'));
    expect(y.getByText('Oil 1L')).toBeTruthy();
    expect(y.queryByText('Sugar 1kg')).toBeNull();
  });

  it('order details keep each order distinct, with server-derived order status', async () => {
    const view = renderCard(commerceTrip());
    await loaded(view, '3 Orders · 3 Stops · 5 Products');
    fireEvent.press(view.getByLabelText('Verify delivery'));
    expect(within(view.getByTestId('stop-verification-location')).getByText('#SO-X, #SO-Y')).toBeTruthy();
    const list = within(view.getByTestId('stop-verification-orders'));
    expect(list.getByText('SO-X')).toBeTruthy();
    expect(list.getByText('SO-Y')).toBeTruthy();
    expect(list.getByText('Awaiting')).toBeTruthy();
    expect(list.getByText('1 of 2 delivered')).toBeTruthy();
    expect(list.getByText('Rice 5kg')).toBeTruthy();
    expect(list.getByText('Atta 10kg')).toBeTruthy();
    expect(list.getByText('Oil 1L')).toBeTruthy();
    expect(list.queryByText('Sugar 1kg')).toBeNull();
    expect(view.getByText('Confirming completes this stop, not each item.')).toBeTruthy();
  });

  it('one stop-level proof and one COMPLETE_STOP for the stop, never per order', async () => {
    mockCommandResult = () => ({
      ok: true, applied: true, command: 'COMPLETE_STOP', trip_status: 'completed', previous_status: 'in_progress',
      trip_completed: true, trip_id: TRIP_ID, organization_id: 'org-1',
      stop: { trip_id: TRIP_ID, stop_id: 'd2', sequence: 3, status: 'completed', completed_at: 'c' },
    });
    const onTripCompleted = jest.fn();
    const view = renderCard(commerceTrip(), { onTripCompleted });
    await loaded(view, '3 Orders · 3 Stops · 5 Products');
    fireEvent.press(view.getByLabelText('Verify delivery'));
    expect(view.getByLabelText('Confirm delivery').props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: true }),
    );
    fireEvent.press(view.getByLabelText('Handed to recipient'));
    fireEvent.press(view.getByLabelText('Confirm delivery'));
    await waitFor(() => expect(onTripCompleted).toHaveBeenCalledTimes(1));

    expect(persistStopDeliveryProof).toHaveBeenCalledTimes(1);
    expect(persistStopDeliveryProof).toHaveBeenCalledWith(
      expect.objectContaining({ tripId: TRIP_ID, stopId: 'd2', kind: 'delivery' }),
    );
    expect(commands().map((c) => c.args?.p_command)).toEqual(['COMPLETE_STOP']);
    expect(commands()[0].args?.p_payload).toEqual({ stop_id: 'd2' });
    expect(nonSesTables()).toEqual([]);
    expect(updateTripStatus).not.toHaveBeenCalled();
  });

  it('server pod_required rejection keeps the stop open and shows the server message', async () => {
    mockCommandResult = () => ({
      ok: false, command: 'COMPLETE_STOP', error_code: 'pod_required', trip_status: 'in_progress',
      stop: { stop_id: 'd2', status: 'arrived' },
    });
    const onTripCompleted = jest.fn();
    const view = renderCard(commerceTrip(), { onTripCompleted });
    await loaded(view, '3 Orders · 3 Stops · 5 Products');
    fireEvent.press(view.getByLabelText('Verify delivery'));
    fireEvent.press(view.getByLabelText('Handed to recipient'));
    fireEvent.press(view.getByLabelText('Confirm delivery'));
    await waitFor(() =>
      expect(view.getAllByText('Upload proof of delivery before completing this trip.').length).toBeGreaterThan(0),
    );
    expect(view.queryByTestId('stop-verification-done')).toBeNull();
    expect(onTripCompleted).not.toHaveBeenCalled();
    expect(commands()).toHaveLength(1);
  });

  it('no invoice, payment or amount is shown on the driver card or order details', async () => {
    const view = renderCard(commerceTrip());
    await loaded(view, '3 Orders · 3 Stops · 5 Products');
    fireEvent.press(view.getByLabelText('Verify delivery'));
    expect(view.queryByText(/invoice|payment|₹|cash on delivery|\bCOD\b/i)).toBeNull();
  });
});

describe('Commerce semantics — single order', () => {
  const lines: Line[] = [
    { stop: PU, order: 'S', line: 's1', productId: 'p1', productName: 'Rice 5kg', quantity: 2 },
    { stop: D1, order: 'S', line: 's1', productId: 'p1', productName: 'Rice 5kg', quantity: 2 },
  ];

  it('1 order / 2 stops reads in singular and arrives through ARRIVE_STOP only', async () => {
    seed(lines, [sesRow(PU, 'completed'), sesRow(D1, 'pending')]);
    mockCommandResult = () => ({
      ok: true, applied: true, command: 'ARRIVE_STOP', trip_status: 'in_progress', previous_status: 'in_progress',
      stop: { trip_id: TRIP_ID, stop_id: 'd1', sequence: 2, status: 'arrived', arrived_at: 'a' },
    });
    const view = renderCard(commerceTrip());
    await loaded(view, '1 Order · 2 Stops · 1 Product');
    expect(within(view.getByTestId('multi-order-stop-orders')).getByText(/^1 order · 2 items/)).toBeTruthy();
    expect(view.getByLabelText('Proof of delivery').props.accessibilityState).toEqual({ disabled: true });
    fireEvent.press(view.getByLabelText('Ready to deliver'));
    await waitFor(() => expect(view.getByLabelText('Verify delivery')).toBeTruthy());
    expect(commands().map((c) => c.args?.p_command)).toEqual(['ARRIVE_STOP']);
    expect(view.getByLabelText('Proof of delivery').props.accessibilityState).toEqual({ disabled: false });
    expect(updateTripStatus).not.toHaveBeenCalled();
  });
});

describe('POD follows the server stop flag', () => {
  const noPod: PlanStop = { ...D1, pod: false };
  const lines: Line[] = [
    { stop: PU, order: 'S', line: 's1', productId: 'p1', productName: 'Rice 5kg', quantity: 2 },
    { stop: noPod, order: 'S', line: 's1', productId: 'p1', productName: 'Rice 5kg', quantity: 2 },
  ];

  it('POD not required: Confirm is enabled without proof and COMPLETE_STOP is still the only mutation', async () => {
    seed(lines, [sesRow(PU, 'completed'), sesRow(noPod, 'arrived')]);
    mockCommandResult = () => ({
      ok: true, applied: true, command: 'COMPLETE_STOP', trip_status: 'completed', previous_status: 'in_progress',
      trip_completed: true, trip_id: TRIP_ID, organization_id: 'org-1',
      stop: { trip_id: TRIP_ID, stop_id: 'd1', sequence: 2, status: 'completed', completed_at: 'c' },
    });
    const onTripCompleted = jest.fn();
    const view = renderCard(commerceTrip(), { onTripCompleted });
    await loaded(view, '1 Order · 2 Stops · 1 Product');
    fireEvent.press(view.getByLabelText('Verify delivery'));
    expect(view.getByText('Optional for this stop.')).toBeTruthy();
    expect(view.getByLabelText('Confirm delivery').props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: false }),
    );
    fireEvent.press(view.getByLabelText('Confirm delivery'));
    await waitFor(() => expect(onTripCompleted).toHaveBeenCalledTimes(1));
    expect(commands().map((c) => c.args?.p_command)).toEqual(['COMPLETE_STOP']);
    expect(commands()[0].args?.p_payload).toEqual({ stop_id: 'd1' });
    expect(updateTripStatus).not.toHaveBeenCalled();
  });

  it('POD not required: proof the driver adds is still saved before COMPLETE_STOP', async () => {
    seed(lines, [sesRow(PU, 'completed'), sesRow(noPod, 'arrived')]);
    mockCommandResult = () => ({
      ok: true, applied: true, command: 'COMPLETE_STOP', trip_status: 'completed', previous_status: 'in_progress',
      stop: { trip_id: TRIP_ID, stop_id: 'd1', sequence: 2, status: 'completed', completed_at: 'c' },
    });
    const view = renderCard(commerceTrip());
    await loaded(view, '1 Order · 2 Stops · 1 Product');
    fireEvent.press(view.getByLabelText('Verify delivery'));
    fireEvent.press(view.getByLabelText('Left at door'));
    fireEvent.press(view.getByLabelText('Confirm delivery'));
    await waitFor(() => expect(commands()).toHaveLength(1));
    expect(persistStopDeliveryProof).toHaveBeenCalledWith(
      expect.objectContaining({ stopId: 'd1', draft: expect.objectContaining({ place: 'left_at_door' }) }),
    );
  });

  it('POD required: Confirm stays disabled until proof is chosen', async () => {
    const podStop: PlanStop = { ...D1, pod: true };
    seed(
      [lines[0], { ...lines[1], stop: podStop }],
      [sesRow(PU, 'completed'), sesRow(podStop, 'arrived')],
    );
    const view = renderCard(commerceTrip());
    await loaded(view, '1 Order · 2 Stops · 1 Product');
    fireEvent.press(view.getByLabelText('Verify delivery'));
    expect(view.getByText('Choose a drop location or add a photo to confirm.')).toBeTruthy();
    expect(view.getByLabelText('Confirm delivery').props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: true }),
    );
    fireEvent.press(view.getByLabelText('Handed to recipient'));
    expect(view.getByLabelText('Confirm delivery').props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: false }),
    );
    expect(commands()).toEqual([]);
  });
});

describe('Server exception state and command surface', () => {
  it('a server-failed stop shows as an exception with no driver FAIL/SKIP action', async () => {
    seed(MULTI_ORDER_STOP, [sesRow(PU, 'completed'), sesRow(D1, 'failed'), sesRow(D2, 'pending')]);
    const view = renderCard(commerceTrip());
    await loaded(view, '3 Orders · 3 Stops · 5 Products');
    expect(view.getByLabelText('Exceptions: 1')).toBeTruthy();
    const d1 = within(view.getByTestId('commerce-timeline-stop-d1'));
    expect(d1.getByText('Failed')).toBeTruthy();
    expect(d1.getByTestId('commerce-timeline-marker-failed')).toBeTruthy();
    expect(view.queryByLabelText(/skip|mark (as )?failed|fail stop|report issue/i)).toBeNull();
  });

  it('the Commerce driver path only issues ARRIVE_STOP, COMPLETE_STOP and COMPLETE_TRIP', () => {
    const dir = path.join(__dirname, '..');
    const files = [
      'DriverMultiOrderJobCard.tsx',
      'DriverStopVerificationScreen.tsx',
      'DriverTripCompletionScreen.tsx',
      ...fs.readdirSync(path.join(dir, 'parts')).map((f) => `parts/${f}`),
    ];
    for (const file of files) {
      const src = fs.readFileSync(path.join(dir, file), 'utf8');
      expect({ file, hit: /FAIL_STOP|SKIP_STOP|UNDO_STEP/.test(src) }).toEqual({ file, hit: false });
    }
    const card = fs.readFileSync(path.join(dir, 'DriverMultiOrderJobCard.tsx'), 'utf8');
    expect(card.match(/command: '([A-Z_]+)'/g)).toEqual(["command: 'COMPLETE_TRIP'"]);
  });
});

describe('Driver usability edge cases', () => {
  it('missing phone disables Call; missing coordinates disables Navigate', async () => {
    const noCoord: PlanStop = { ...D1, lat: null, lon: null };
    seed(
      [
        { stop: PU, order: 'S', line: 's1', productId: 'p1', productName: 'Rice 5kg', quantity: 2 },
        { stop: noCoord, order: 'S', line: 's1', productId: 'p1', productName: 'Rice 5kg', quantity: 2 },
      ],
      [sesRow(PU, 'completed'), sesRow(noCoord, 'pending')],
    );
    const view = renderCard(commerceTrip());
    await loaded(view, '1 Order · 2 Stops · 1 Product');
    expect(view.getByLabelText('Call customer unavailable').props.accessibilityState).toEqual({ disabled: true });
    expect(view.getByLabelText('Navigate to Anna Nagar').props.accessibilityState).toEqual({ disabled: true });
  });

  it('customer phone from Primitive A enables Call; coordinates enable Navigate', async () => {
    seed(
      [
        { stop: PU, order: 'S', line: 's1', productId: 'p1', productName: 'Rice 5kg', quantity: 2 },
        { stop: D1, order: 'S', line: 's1', productId: 'p1', productName: 'Rice 5kg', quantity: 2, phone: '9876543210' },
      ],
      [sesRow(PU, 'completed'), sesRow(D1, 'pending')],
    );
    const view = renderCard(commerceTrip());
    await loaded(view, '1 Order · 2 Stops · 1 Product');
    expect(view.getByLabelText('Call customer').props.accessibilityState).toEqual({ disabled: false });
    expect(view.getByLabelText('Navigate to Anna Nagar').props.accessibilityState).toEqual({ disabled: false });
  });

  it('no instructions renders no info card; long instructions render in full', async () => {
    const longNote = `Call before arriving. ${'Use the side gate near the pharmacy, '.repeat(6)}ask for Priya.`;
    seed(
      [
        { stop: PU, order: 'S', line: 's1', productId: 'p1', productName: 'Rice 5kg', quantity: 2 },
        { stop: D1, order: 'S', line: 's1', productId: 'p1', productName: 'Rice 5kg', quantity: 2, notes: longNote },
        { stop: PU, order: 'T', line: 't1', productId: 'p2', productName: 'Atta 10kg', quantity: 1 },
        { stop: D2, order: 'T', line: 't1', productId: 'p2', productName: 'Atta 10kg', quantity: 1 },
      ],
      [sesRow(PU, 'completed'), sesRow(D1, 'arrived'), sesRow(D2, 'pending')],
    );
    const view = renderCard(commerceTrip());
    await loaded(view, '2 Orders · 3 Stops · 2 Products');
    fireEvent.press(view.getByLabelText('Verify delivery'));
    expect(within(view.getByTestId('stop-delivery-info')).getByText(longNote)).toBeTruthy();
    fireEvent.press(view.getByLabelText('Back'));

    fireEvent.press(view.getByLabelText('View Adyar details'));
    expect(view.getByTestId('driver-stop-verification')).toBeTruthy();
    expect(view.queryByTestId('stop-delivery-info')).toBeNull();
  });

  it('future stop opens read-only details with no confirm action', async () => {
    seed(MULTI_ORDER_STOP, [sesRow(PU, 'completed'), sesRow(D1, 'arrived'), sesRow(D2, 'pending')]);
    const view = renderCard(commerceTrip());
    await loaded(view, '3 Orders · 3 Stops · 5 Products');
    fireEvent.press(view.getByLabelText('View Adyar details'));
    expect(view.getByText('Details · Stop 3 of 3')).toBeTruthy();
    expect(view.queryByLabelText('Confirm delivery')).toBeNull();
  });

  it('completed stop opens as a review with no confirm action', async () => {
    seed(MULTI_ORDER_STOP, [sesRow(PU, 'completed'), sesRow(D1, 'completed'), sesRow(D2, 'arrived')]);
    const view = renderCard(commerceTrip());
    await loaded(view, '3 Orders · 3 Stops · 5 Products');
    fireEvent.press(view.getByLabelText('View Anna Nagar details'));
    expect(view.getByTestId('stop-verification-done')).toBeTruthy();
    expect(view.queryByLabelText('Confirm delivery')).toBeNull();
    expect(commands()).toEqual([]);
  });

  it('Primitive A failure blocks Confirm and offers Retry; a successful retry restores normal rules', async () => {
    seed([], [sesRow(PU, 'completed'), sesRow(D1, 'arrived')]);
    mockPrimitiveA = { data: null, error: { message: 'network down' } };
    const view = renderCard(commerceTrip());
    await waitFor(() => expect(view.getByLabelText('Verify delivery')).toBeTruthy());
    fireEvent.press(view.getByLabelText('Verify delivery'));
    await waitFor(() => expect(view.getByText('Could not load orders for this stop.')).toBeTruthy());
    fireEvent.press(view.getByLabelText('Handed to recipient'));
    expect(view.getByLabelText('Confirm delivery').props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: true }),
    );
    fireEvent.press(view.getByLabelText('Confirm delivery'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(primitiveAReads()).toBe(1);
    expect(commands()).toEqual([]);

    mockPrimitiveA = {
      data: [
        { stop: PU, order: 'S', line: 's1', productId: 'p1', productName: 'Rice 5kg', quantity: 2 },
        { stop: D1, order: 'S', line: 's1', productId: 'p1', productName: 'Rice 5kg', quantity: 2 },
      ].map((l) => paRow(l as Line)),
      error: null,
    };
    fireEvent.press(view.getByLabelText('Retry loading orders'));
    await waitFor(() =>
      expect(within(view.getByTestId('stop-verification-orders')).getByText('Rice 5kg')).toBeTruthy(),
    );
    expect(view.queryByText('Could not load orders for this stop.')).toBeNull();
    expect(primitiveAReads()).toBe(2);
    expect(view.getByLabelText('Confirm delivery').props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: false }),
    );
    expect(sesReads()).toBe(1);
  });

  it('a failed COMPLETE_STOP retried by the driver reuses the saved proof instead of uploading again', async () => {
    seed(MULTI_ORDER_STOP, [sesRow(PU, 'completed'), sesRow(D1, 'completed'), sesRow(D2, 'arrived')]);
    let attempt = 0;
    mockCommandResult = () => {
      attempt += 1;
      if (attempt === 1) return { ok: false, command: 'COMPLETE_STOP', error_code: 'stale_state' };
      return {
        ok: true, applied: true, command: 'COMPLETE_STOP', trip_status: 'completed', previous_status: 'in_progress',
        trip_completed: true, trip_id: TRIP_ID, organization_id: 'org-1',
        stop: { trip_id: TRIP_ID, stop_id: 'd2', sequence: 3, status: 'completed', completed_at: 'c' },
      };
    };
    const onTripCompleted = jest.fn();
    const view = renderCard(commerceTrip(), { onTripCompleted });
    await loaded(view, '3 Orders · 3 Stops · 5 Products');
    fireEvent.press(view.getByLabelText('Verify delivery'));
    fireEvent.press(view.getByLabelText('Left at door'));
    fireEvent.press(view.getByLabelText('Confirm delivery'));
    await waitFor(() =>
      expect(view.getAllByText('This trip was updated elsewhere. Refresh and try again.').length).toBeGreaterThan(0),
    );
    expect(view.queryByTestId('stop-verification-done')).toBeNull();
    expect(onTripCompleted).not.toHaveBeenCalled();
    expect(mockUploadTripDocument).toHaveBeenCalledTimes(1);

    fireEvent.press(view.getByLabelText('Confirm delivery'));
    await waitFor(() => expect(onTripCompleted).toHaveBeenCalledTimes(1));
    expect(commands().map((c) => c.args?.p_command)).toEqual(['COMPLETE_STOP', 'COMPLETE_STOP']);
    expect(mockUploadTripDocument).toHaveBeenCalledTimes(1);
    expect(mockUploadTripDocument).toHaveBeenCalledWith(
      TRIP_ID, 'user-1', expect.objectContaining({ fileName: 'delivery-place.txt' }), 'pod', 'left_at_door', { stopId: 'd2' },
    );
  });

  it('a proof upload failure does not send COMPLETE_STOP, and the retry uploads it once', async () => {
    seed(MULTI_ORDER_STOP, [sesRow(PU, 'completed'), sesRow(D1, 'completed'), sesRow(D2, 'arrived')]);
    mockUploadTripDocument.mockResolvedValueOnce({ doc: null, error: new Error('Upload failed') });
    mockCommandResult = () => ({
      ok: true, applied: true, command: 'COMPLETE_STOP', trip_status: 'completed', previous_status: 'in_progress',
      stop: { trip_id: TRIP_ID, stop_id: 'd2', sequence: 3, status: 'completed', completed_at: 'c' },
    });
    const view = renderCard(commerceTrip());
    await loaded(view, '3 Orders · 3 Stops · 5 Products');
    fireEvent.press(view.getByLabelText('Verify delivery'));
    fireEvent.press(view.getByLabelText('Left at door'));
    fireEvent.press(view.getByLabelText('Confirm delivery'));
    await waitFor(() => expect(view.getAllByText('Upload failed').length).toBeGreaterThan(0));
    expect(commands()).toEqual([]);

    fireEvent.press(view.getByLabelText('Confirm delivery'));
    await waitFor(() => expect(commands()).toHaveLength(1));
    expect(mockUploadTripDocument).toHaveBeenCalledTimes(2);
  });
});

describe('Performance at the client boundary', () => {
  it('40 drops × 2 orders still loads with one SES read and one Primitive A read', async () => {
    const drops: PlanStop[] = Array.from({ length: 40 }, (_, i) => ({
      id: `d${i + 1}`,
      sequence: i + 2,
      type: 'drop',
      name: `Drop ${i + 1} ${'Very Long Apartment Complex Name '.repeat(2)}`,
    }));
    const lines: Line[] = [];
    drops.forEach((stop, i) => {
      for (const suffix of ['a', 'b']) {
        const order = `${i + 1}${suffix}`;
        lines.push({ stop: PU, order, line: `l${order}`, productId: `p${order}`, productName: `Item ${order}`, quantity: 1 });
        lines.push({ stop, order, line: `l${order}`, productId: `p${order}`, productName: `Item ${order}`, quantity: 1 });
      }
    });
    seed(lines, [sesRow(PU, 'completed'), ...drops.map((stop) => sesRow(stop, 'pending'))]);
    const onRoutePlanMapChange = jest.fn();
    const view = renderCard(commerceTrip(), { onRoutePlanMapChange });
    await loaded(view, '80 Orders · 41 Stops · 80 Products');
    expect(view.getAllByTestId(/^commerce-timeline-stop-/)).toHaveLength(41);

    const settled = mockCalls.length;
    const mapPublishes = onRoutePlanMapChange.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mockCalls.length).toBe(settled);
    expect(onRoutePlanMapChange.mock.calls.length).toBe(mapPublishes);

    fireEvent.press(view.getByTestId('commerce-timeline-toggle-d40'));
    expect(view.getByTestId('commerce-timeline-orders-d40')).toBeTruthy();
    expect(mockCalls.length).toBe(settled);
    expect(sesReads()).toBe(1);
    expect(primitiveAReads()).toBe(1);
  });
});
