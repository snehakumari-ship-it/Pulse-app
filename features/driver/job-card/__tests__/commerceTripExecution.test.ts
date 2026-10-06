import { emptyDriverTripStopOrderMission } from '@/features/driver/commerce-mission/normalizeDriverTripStopOrders';
import type {
  DriverTripStopOrder,
  DriverTripStopOrderMission,
  DriverTripStopOrderStop,
} from '@/features/driver/commerce-mission/driverTripStopOrders.types';
import type { DriverStopExecutionStop } from '@/features/driver/execution/driverStopExecution.types';
import {
  buildCommerceTripExecution,
  commerceOriginFromTrip,
  summaryLabel,
  toCommerceMapStops,
} from '@/features/driver/job-card/commerceTripExecution';

function trip(extras: { is_commerce?: boolean; execution_plan_id?: string | null } = {}) {
  return {
    id: 'trip-1',
    status: 'in_progress',
    driver_id: 'drv-1',
    vehicle_id: 'veh-1',
    ...extras,
  };
}

function ses(
  extras: Partial<DriverStopExecutionStop> & Pick<DriverStopExecutionStop, 'stopId' | 'sequence' | 'status'>,
): DriverStopExecutionStop {
  return {
    stopType: extras.stopType ?? 'pickup',
    displayName: extras.displayName ?? extras.stopId,
    addressLine: null,
    city: null,
    state: null,
    pincode: null,
    latitude: extras.latitude ?? null,
    longitude: extras.longitude ?? null,
    contactName: null,
    contactPhone: null,
    podRequired: false,
    driverId: 'drv-1',
    arrivedAt: null,
    completedAt: null,
    skipReason: null,
    failureReason: null,
    ...extras,
  };
}

function order(
  extras: Partial<DriverTripStopOrder> & Pick<DriverTripStopOrder, 'salesOrderId'>,
): DriverTripStopOrder {
  return {
    orderNumber: extras.orderNumber ?? extras.salesOrderId,
    customerId: extras.customerId ?? `cust-${extras.salesOrderId}`,
    customerName: extras.customerName ?? `Customer ${extras.salesOrderId}`,
    customerPhone: extras.customerPhone ?? null,
    attachmentRole: extras.attachmentRole ?? 'drop',
    deliveryWindowStart: null,
    deliveryWindowEnd: null,
    notes: null,
    priority: null,
    orderTotalAmount: null,
    currency: 'INR',
    orderDistinctDropStopCount: extras.orderDistinctDropStopCount ?? 1,
    orderCompletedDropStopCount: extras.orderCompletedDropStopCount ?? 0,
    lines: extras.lines ?? [],
    ...extras,
  };
}

function stop(
  extras: Partial<DriverTripStopOrderStop> & Pick<DriverTripStopOrderStop, 'stopId' | 'sequence' | 'stopType'>,
): DriverTripStopOrderStop {
  return {
    sourceType: extras.sourceType ?? 'warehouse',
    displayName: extras.displayName ?? extras.stopId,
    label: extras.label ?? extras.stopId,
    addressLine: extras.addressLine ?? '1 Main',
    city: extras.city ?? 'Chennai',
    state: extras.state ?? 'TN',
    pincode: extras.pincode ?? '600001',
    contactName: extras.contactName ?? 'Ada',
    contactPhone: extras.contactPhone ?? '90000',
    latitude: extras.latitude ?? 13.08,
    longitude: extras.longitude ?? 80.27,
    podRequired: extras.stopType === 'drop',
    stopExecutionStatus: extras.stopExecutionStatus ?? 'pending',
    arrivedAt: null,
    completedAt: null,
    failureReason: null,
    stopDistinctDropOrderCount: extras.stopDistinctDropOrderCount ?? 0,
    orders: extras.orders ?? [],
    ...extras,
  };
}

function mission(stops: DriverTripStopOrderStop[]): DriverTripStopOrderMission {
  return {
    tripId: 'trip-1',
    indentId: 'indent-1',
    executionPlanId: 'plan-1',
    stops,
  };
}

describe('commerceOriginFromTrip', () => {
  it('is false without is_commerce or execution_plan_id', () => {
    expect(commerceOriginFromTrip(trip())).toBe(false);
  });

  it('is true from is_commerce', () => {
    expect(commerceOriginFromTrip(trip({ is_commerce: true }))).toBe(true);
  });

  it('is true from execution_plan_id even when is_commerce is unset', () => {
    expect(commerceOriginFromTrip(trip({ execution_plan_id: 'plan-1' }))).toBe(true);
  });

  it('does not infer Commerce from empty plan id', () => {
    expect(commerceOriginFromTrip(trip({ execution_plan_id: '  ' }))).toBe(false);
  });
});

describe('buildCommerceTripExecution', () => {
  const gpu = order({
    salesOrderId: 'so-1',
    orderNumber: '10021',
    customerName: 'Customer A',
    attachmentRole: 'pickup',
    lines: [
      { salesOrderLineId: 'l1', quantity: 2, productId: 'p-gpu', productName: 'GPU kit', productSku: 'NV-A' },
      { salesOrderLineId: 'l2', quantity: 1, productId: 'p-cbl', productName: 'Cable', productSku: 'CB-1' },
    ],
  });
  const parts = order({
    salesOrderId: 'so-2',
    orderNumber: '10024',
    customerName: 'Customer B',
    attachmentRole: 'pickup',
    lines: [
      { salesOrderLineId: 'l3', quantity: 5, productId: 'p-box', productName: 'Parts box', productSku: 'BX-5' },
    ],
  });

  const pickup = stop({
    stopId: 'pu-1',
    sequence: 1,
    stopType: 'pickup',
    displayName: 'ABC Warehouse',
    orders: [gpu, parts],
  });
  const dropA = stop({
    stopId: 'dr-1',
    sequence: 2,
    stopType: 'drop',
    displayName: 'Customer A',
    orders: [
      order({
        salesOrderId: 'so-1',
        orderNumber: '10021',
        customerName: 'Customer A',
        attachmentRole: 'drop',
        lines: gpu.lines,
      }),
    ],
  });
  const dropB = stop({
    stopId: 'dr-2',
    sequence: 3,
    stopType: 'drop',
    displayName: 'Customer B',
    orders: [
      order({
        salesOrderId: 'so-2',
        orderNumber: '10024',
        customerName: 'Customer B',
        attachmentRole: 'drop',
        lines: parts.lines,
      }),
    ],
  });

  it('empty Primitive A yields empty stops even if SES has rows', () => {
    const result = buildCommerceTripExecution({
      trip: trip({ is_commerce: true, execution_plan_id: 'plan-1' }),
      mission: emptyDriverTripStopOrderMission('trip-1'),
      sesStops: [ses({ stopId: 'pu-1', sequence: 1, status: 'pending' })],
    });
    expect(result.stops).toEqual([]);
    expect(result.orders).toEqual([]);
    expect(result.executionReady).toBe(false);
    expect(result.trip.isCommerce).toBe(true);
  });

  it('does not classify Commerce from Primitive A when the trip origin is empty', () => {
    const result = buildCommerceTripExecution({
      trip: trip(),
      mission: mission([pickup, dropA]),
      sesStops: [],
    });
    expect(result.trip.isCommerce).toBe(false);
    expect(result.stops).toHaveLength(2);
  });

  it('groups three orders across four stops without merging order identity', () => {
    const so3 = order({
      salesOrderId: 'so-3',
      orderNumber: '10030',
      customerName: 'Customer C',
      attachmentRole: 'pickup',
      lines: [
        { salesOrderLineId: 'l4', quantity: 3, productId: 'p-fan', productName: 'Fan', productSku: 'FN-1' },
      ],
    });
    const dropC = stop({
      stopId: 'dr-3',
      sequence: 4,
      stopType: 'drop',
      displayName: 'Customer C',
      orders: [
        order({
          salesOrderId: 'so-3',
          orderNumber: '10030',
          customerName: 'Customer C',
          attachmentRole: 'drop',
          lines: so3.lines,
        }),
      ],
    });
    const result = buildCommerceTripExecution({
      trip: trip({ is_commerce: true, execution_plan_id: 'plan-trp051' }),
      mission: mission([
        stop({
          stopId: 'pu-1',
          sequence: 1,
          stopType: 'pickup',
          displayName: 'ABC Warehouse',
          orders: [gpu, parts, so3],
        }),
        dropA,
        dropB,
        dropC,
      ]),
      sesStops: [
        ses({ stopId: 'pu-1', sequence: 1, status: 'completed', stopType: 'pickup' }),
        ses({ stopId: 'dr-1', sequence: 2, status: 'arrived', stopType: 'drop' }),
        ses({ stopId: 'dr-2', sequence: 3, status: 'pending', stopType: 'drop' }),
        ses({ stopId: 'dr-3', sequence: 4, status: 'pending', stopType: 'drop' }),
      ],
    });
    expect(result.stops.map((s) => [s.id, s.type])).toEqual([
      ['pu-1', 'pickup'],
      ['dr-1', 'drop'],
      ['dr-2', 'drop'],
      ['dr-3', 'drop'],
    ]);
    expect(result.stops[0].orderIds).toEqual(['so-1', 'so-2', 'so-3']);
    expect(result.orders.map((o) => o.id)).toEqual(['so-1', 'so-2', 'so-3']);
    expect(result.stops[1].orders[0].lines[0].quantity).toBe(2);
    expect(result.stops[3].orders[0].lines[0].quantity).toBe(3);
    expect(result.stops[0].status).toBe('completed');
    expect(result.stops[1].status).toBe('arrived');
    expect(result.currentStopId).toBe('dr-1');
    expect(result.summary).toEqual({
      orderCount: 3,
      stopCount: 4,
      productCount: 4,
      totalQuantity: 11,
    });
  });

  it('groups shared pickup and two drops without duplicating trip-level orders', () => {
    const result = buildCommerceTripExecution({
      trip: trip({ is_commerce: true, execution_plan_id: 'plan-1' }),
      mission: mission([pickup, dropA, dropB]),
      sesStops: [
        ses({ stopId: 'pu-1', sequence: 1, status: 'pending', stopType: 'pickup' }),
        ses({ stopId: 'dr-1', sequence: 2, status: 'pending', stopType: 'drop' }),
        ses({ stopId: 'dr-2', sequence: 3, status: 'pending', stopType: 'drop' }),
      ],
    });
    expect(result.stops.map((s) => s.id)).toEqual(['pu-1', 'dr-1', 'dr-2']);
    expect(result.stops[0].orderIds).toEqual(['so-1', 'so-2']);
    expect(result.stops[1].orderIds).toEqual(['so-1']);
    expect(result.stops[2].orderIds).toEqual(['so-2']);
    expect(result.orders.map((o) => o.id)).toEqual(['so-1', 'so-2']);
    expect(result.summary).toEqual({
      orderCount: 2,
      stopCount: 3,
      productCount: 3,
      totalQuantity: 8,
    });
    expect(summaryLabel(result.summary)).toBe('2 Orders · 3 Stops · 3 Products');
    expect(result.executionReady).toBe(true);
  });

  it('keeps each stop on its own allocation quantity', () => {
    const pickupQty = order({
      salesOrderId: 'so-1',
      attachmentRole: 'pickup',
      lines: [{ salesOrderLineId: 'l1', quantity: 8, productId: 'p-gpu', productName: 'GPU kit', productSku: 'NV-A' }],
    });
    const dropQty = order({
      salesOrderId: 'so-1',
      attachmentRole: 'drop',
      lines: [{ salesOrderLineId: 'l1', quantity: 3, productId: 'p-gpu', productName: 'GPU kit', productSku: 'NV-A' }],
    });
    const result = buildCommerceTripExecution({
      trip: trip({ is_commerce: true }),
      mission: mission([
        stop({ stopId: 'pu-1', sequence: 1, stopType: 'pickup', orders: [pickupQty] }),
        stop({ stopId: 'dr-1', sequence: 2, stopType: 'drop', orders: [dropQty] }),
      ]),
      sesStops: [],
    });
    expect(result.stops[0].orders[0].lines[0].quantity).toBe(8);
    expect(result.stops[1].orders[0].lines[0].quantity).toBe(3);
    expect(result.orders).toHaveLength(1);
    expect(result.orders[0].lines[0].unit).toBeNull();
  });

  it('does not double-count product lines that appear at pickup and drop', () => {
    const result = buildCommerceTripExecution({
      trip: trip({ execution_plan_id: 'plan-1' }),
      mission: mission([pickup, dropA, dropB]),
      sesStops: [],
    });
    expect(result.orders.find((o) => o.id === 'so-1')?.productCount).toBe(2);
    expect(result.orders.find((o) => o.id === 'so-1')?.totalQuantity).toBe(3);
    expect(result.summary.totalQuantity).toBe(8);
  });

  it('lets SES status win over Primitive A stop_execution_status', () => {
    const stalePickup = { ...pickup, stopExecutionStatus: 'pending' };
    const result = buildCommerceTripExecution({
      trip: trip({ is_commerce: true }),
      mission: mission([stalePickup, dropA]),
      sesStops: [
        ses({ stopId: 'pu-1', sequence: 1, status: 'completed', stopType: 'pickup' }),
        ses({ stopId: 'dr-1', sequence: 2, status: 'arrived', stopType: 'drop' }),
      ],
    });
    expect(result.stops[0].status).toBe('completed');
    expect(result.stops[1].status).toBe('arrived');
    expect(result.currentStopId).toBe('dr-1');
    expect(result.stops[1].isCurrent).toBe(true);
    expect(result.stops[0].isCurrent).toBe(false);
  });

  it('selects the first non-completed stop as current when SES is empty', () => {
    const result = buildCommerceTripExecution({
      trip: trip({ is_commerce: true }),
      mission: mission([
        { ...pickup, stopExecutionStatus: 'completed' },
        dropA,
        dropB,
      ]),
      sesStops: [],
    });
    expect(result.currentStopId).toBe('dr-1');
    expect(result.executionReady).toBe(false);
  });

  it('ignores SES-only stops so orders are never invented', () => {
    const result = buildCommerceTripExecution({
      trip: trip({ is_commerce: true }),
      mission: mission([pickup]),
      sesStops: [
        ses({ stopId: 'pu-1', sequence: 1, status: 'arrived' }),
        ses({ stopId: 'ghost', sequence: 9, status: 'pending', stopType: 'drop' }),
      ],
    });
    expect(result.stops.map((s) => s.id)).toEqual(['pu-1']);
    expect(result.stops[0].status).toBe('arrived');
  });

  it('keeps compact order lines on the model so expand needs no extra fetch', () => {
    const result = buildCommerceTripExecution({
      trip: trip({ is_commerce: true }),
      mission: mission([pickup]),
      sesStops: [ses({ stopId: 'pu-1', sequence: 1, status: 'pending' })],
    });
    const so1 = result.stops[0].orders.find((o) => o.id === 'so-1');
    expect(so1?.productCount).toBe(2);
    expect(so1?.lines).toEqual([
      { productId: 'p-gpu', name: 'GPU kit', sku: 'NV-A', quantity: 2, unit: null },
      { productId: 'p-cbl', name: 'Cable', sku: 'CB-1', quantity: 1, unit: null },
    ]);
  });

  it('single-order Commerce trip stays one pickup, one drop, one order', () => {
    const result = buildCommerceTripExecution({
      trip: trip({ is_commerce: true }),
      mission: mission([
        stop({
          stopId: 'pu-1',
          sequence: 1,
          stopType: 'pickup',
          orders: [gpu],
        }),
        stop({
          stopId: 'dr-1',
          sequence: 2,
          stopType: 'drop',
          orders: [
            order({
              salesOrderId: 'so-1',
              orderNumber: '10021',
              attachmentRole: 'drop',
              lines: gpu.lines,
            }),
          ],
        }),
      ]),
      sesStops: [
        ses({ stopId: 'pu-1', sequence: 1, status: 'pending' }),
        ses({ stopId: 'dr-1', sequence: 2, status: 'pending' }),
      ],
    });
    expect(result.summary.orderCount).toBe(1);
    expect(result.summary.stopCount).toBe(2);
    expect(result.orders).toHaveLength(1);
    expect(result.stops[0].type).toBe('pickup');
    expect(result.stops[1].type).toBe('drop');
  });

  it('same customer with two orders stays two order ids on one drop', () => {
    const result = buildCommerceTripExecution({
      trip: trip({ is_commerce: true }),
      mission: mission([
        stop({
          stopId: 'dr-shared',
          sequence: 1,
          stopType: 'drop',
          displayName: 'Customer A',
          stopDistinctDropOrderCount: 2,
          orders: [
            order({ salesOrderId: 'so-1', customerName: 'Customer A', lines: gpu.lines }),
            order({ salesOrderId: 'so-2', customerName: 'Customer A', lines: parts.lines }),
          ],
        }),
      ]),
      sesStops: [ses({ stopId: 'dr-shared', sequence: 1, status: 'pending', stopType: 'drop' })],
    });
    expect(result.stops[0].orderIds).toEqual(['so-1', 'so-2']);
    expect(result.orders).toHaveLength(2);
    expect(result.orders.every((o) => o.customer.name === 'Customer A')).toBe(true);
  });

  it('one order across two drop stops stays one trip-level order', () => {
    const split = order({
      salesOrderId: 'so-1',
      orderNumber: '10021',
      orderDistinctDropStopCount: 2,
      orderCompletedDropStopCount: 1,
      lines: gpu.lines,
    });
    const result = buildCommerceTripExecution({
      trip: trip({ is_commerce: true }),
      mission: mission([
        stop({ stopId: 'dr-1', sequence: 1, stopType: 'drop', orders: [split] }),
        stop({ stopId: 'dr-2', sequence: 2, stopType: 'drop', orders: [split] }),
      ]),
      sesStops: [
        ses({ stopId: 'dr-1', sequence: 1, status: 'completed', stopType: 'drop' }),
        ses({ stopId: 'dr-2', sequence: 2, status: 'pending', stopType: 'drop' }),
      ],
    });
    expect(result.orders).toHaveLength(1);
    expect(result.orders[0].dropStopCount).toBe(2);
    expect(result.orders[0].completedDropStopCount).toBe(1);
    expect(result.currentStopId).toBe('dr-2');
  });

  it('missing catalog fields stay null and still count as products', () => {
    const result = buildCommerceTripExecution({
      trip: trip({ is_commerce: true }),
      mission: mission([
        stop({
          stopId: 'dr-1',
          sequence: 1,
          stopType: 'drop',
          orders: [
            order({
              salesOrderId: 'so-1',
              lines: [{ salesOrderLineId: 'l1', quantity: 4 }],
            }),
          ],
        }),
      ]),
      sesStops: [],
    });
    expect(result.orders[0].lines[0]).toEqual({
      productId: null,
      name: null,
      sku: null,
      quantity: 4,
      unit: null,
    });
    expect(result.summary.productCount).toBe(1);
    expect(result.summary.totalQuantity).toBe(4);
  });
});

describe('toCommerceMapStops', () => {
  it('emits numbered pickup/drop pins without product fields', () => {
    const execution = buildCommerceTripExecution({
      trip: trip({ is_commerce: true }),
      mission: {
        tripId: 'trip-1',
        indentId: null,
        executionPlanId: 'plan-1',
        stops: [
          stop({
            stopId: 'pu-1',
            sequence: 1,
            stopType: 'pickup',
            latitude: 13,
            longitude: 80.2,
            orders: [],
          }),
          stop({
            stopId: 'dr-1',
            sequence: 2,
            stopType: 'drop',
            latitude: 13.1,
            longitude: 80.3,
            orders: [],
          }),
          stop({
            stopId: 'ghost',
            sequence: 3,
            stopType: 'drop',
            latitude: null,
            longitude: null,
            orders: [],
          }),
        ],
      },
      sesStops: [
        ses({ stopId: 'pu-1', sequence: 1, status: 'completed', stopType: 'pickup' }),
        ses({ stopId: 'dr-1', sequence: 2, status: 'pending', stopType: 'drop' }),
      ],
    });
    const pins = toCommerceMapStops(execution);
    expect(pins.map((p) => p.stopId)).toEqual(['pu-1', 'dr-1']);
    expect(pins.map((p) => p.kindIndex)).toEqual([1, 1]);
    expect(pins[0].status).toBe('completed');
    expect(pins[1].kind).toBe('drop');
    expect(pins[0]).not.toHaveProperty('orders');
    expect(pins[0]).not.toHaveProperty('lines');
  });
});
