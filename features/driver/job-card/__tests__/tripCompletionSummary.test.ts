import {
  allStopsFinished,
  buildTripCompletionSummary,
  tripCompletionHeadline,
} from '@/features/driver/job-card/tripCompletionSummary';
import type { DriverStopExecutionStop } from '@/features/driver/execution/driverStopExecution.types';
import type { DriverTripStopOrderMission } from '@/features/driver/commerce-mission/driverTripStopOrders.types';

function stop(
  extras: Partial<DriverStopExecutionStop> & Pick<DriverStopExecutionStop, 'stopId' | 'sequence' | 'stopType' | 'status'>,
): DriverStopExecutionStop {
  return {
    displayName: extras.displayName ?? extras.stopId,
    addressLine: null,
    city: null,
    state: null,
    pincode: null,
    latitude: null,
    longitude: null,
    contactName: null,
    contactPhone: null,
    podRequired: false,
    driverId: null,
    arrivedAt: null,
    completedAt: null,
    skipReason: null,
    failureReason: null,
    ...extras,
  };
}

describe('tripCompletionSummary', () => {
  it('is finished only when every stop is completed or skipped', () => {
    expect(allStopsFinished([])).toBe(false);
    expect(
      allStopsFinished([
        stop({ stopId: 'a', sequence: 1, stopType: 'pickup', status: 'completed' }),
        stop({ stopId: 'b', sequence: 2, stopType: 'drop', status: 'pending' }),
      ]),
    ).toBe(false);
    expect(
      allStopsFinished([
        stop({ stopId: 'a', sequence: 1, stopType: 'pickup', status: 'completed' }),
        stop({ stopId: 'b', sequence: 2, stopType: 'drop', status: 'skipped' }),
      ]),
    ).toBe(true);
  });

  it('counts delivery items once across pickup and drop of the same order', () => {
    const mission = {
      tripId: 't1',
      indentId: null,
      executionPlanId: 'p1',
      stops: [
        {
          stopId: 'pu',
          orders: [
            {
              salesOrderId: 'so-1',
              orderNumber: 'SO-1',
              customerId: null,
              customerName: 'Acme',
              customerPhone: null,
              attachmentRole: 'pickup',
              lines: [{ salesOrderLineId: 'l1', quantity: 15 }],
            },
          ],
        },
        {
          stopId: 'dr',
          orders: [
            {
              salesOrderId: 'so-1',
              orderNumber: 'SO-1',
              customerId: null,
              customerName: 'Acme',
              customerPhone: null,
              attachmentRole: 'drop',
              lines: [{ salesOrderLineId: 'l1', quantity: 15 }],
            },
          ],
        },
      ],
    } as unknown as DriverTripStopOrderMission;
    const summary = buildTripCompletionSummary(
      [
        stop({ stopId: 'pu', sequence: 1, stopType: 'pickup', status: 'completed', displayName: 'WH' }),
        stop({ stopId: 'dr', sequence: 2, stopType: 'drop', status: 'completed', displayName: 'Drop E' }),
      ],
      mission,
    );
    expect(summary.pickupStops).toBe(1);
    expect(summary.deliveryStops).toBe(1);
    expect(summary.distinctOrders).toBe(1);
    expect(summary.expectedItems).toBe(15);
    expect(tripCompletionHeadline(summary)).toContain('15 items on trip');
    expect(summary.stops[1]?.orderLabels).toEqual(['SO-1']);
  });

  it('counts every line of an order split across two drops', () => {
    const order = (lines: Array<{ salesOrderLineId: string; quantity: number }>) => ({
      salesOrderId: 'so-4',
      orderNumber: 'SO-4',
      customerId: null,
      customerName: 'Kumar Traders',
      customerPhone: null,
      lines,
    });
    const mission = {
      tripId: 't1',
      indentId: null,
      executionPlanId: 'p1',
      stops: [
        { stopId: 'pu', orders: [order([{ salesOrderLineId: 'a', quantity: 6 }, { salesOrderLineId: 'b', quantity: 20 }])] },
        { stopId: 'd1', orders: [order([{ salesOrderLineId: 'a', quantity: 6 }])] },
        { stopId: 'd2', orders: [order([{ salesOrderLineId: 'b', quantity: 20 }])] },
      ],
    } as unknown as DriverTripStopOrderMission;
    const summary = buildTripCompletionSummary(
      [
        stop({ stopId: 'pu', sequence: 1, stopType: 'pickup', status: 'completed' }),
        stop({ stopId: 'd1', sequence: 2, stopType: 'drop', status: 'completed' }),
        stop({ stopId: 'd2', sequence: 3, stopType: 'drop', status: 'completed' }),
      ],
      mission,
    );
    expect(summary.distinctOrders).toBe(1);
    expect(summary.expectedItems).toBe(26);
    expect(summary.stops.map((s) => s.expectedQty)).toEqual([26, 6, 20]);
  });
});
