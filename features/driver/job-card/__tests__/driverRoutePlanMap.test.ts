import {
  buildDriverRoutePlanMap,
  buildTripRowRoutePlanMap,
  clusterRoutePlanStops,
  routeClusterCopy,
  routePlanLeafletMarkerId,
  routePlanPolyline,
  routePlanStopCaption,
} from '@/features/driver/job-card/driverRoutePlanMap';
import type { DriverStopExecutionStop } from '@/features/driver/execution/driverStopExecution.types';

function stop(
  extras: Partial<DriverStopExecutionStop> & Pick<DriverStopExecutionStop, 'stopId' | 'sequence' | 'stopType'>,
): DriverStopExecutionStop {
  return {
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
    status: 'pending',
    driverId: null,
    arrivedAt: null,
    completedAt: null,
    skipReason: null,
    failureReason: null,
    ...extras,
  };
}

describe('buildDriverRoutePlanMap', () => {
  it('keeps only stops with coordinates and sorts by sequence', () => {
    const plan = buildDriverRoutePlanMap(
      'trip-1',
      [
        stop({ stopId: 'd', sequence: 2, stopType: 'drop', latitude: 13.1, longitude: 80.3, displayName: 'Drop C' }),
        stop({ stopId: 'p', sequence: 1, stopType: 'pickup', latitude: 13.0, longitude: 80.2, displayName: 'Pickup A' }),
        stop({ stopId: 'ghost', sequence: 3, stopType: 'drop' }),
      ],
      'p',
      'pickup',
    );
    expect(plan.stops.map((s) => s.stopId)).toEqual(['p', 'd']);
    expect(plan.stops[0].isCurrent).toBe(true);
    expect(plan.stops[1].kind).toBe('drop');
    expect(plan.overview).toBe(true);
    expect(routePlanPolyline(plan)).toHaveLength(2);
  });

  it('builds an overview plan from trip pickup and drop', () => {
    const plan = buildTripRowRoutePlanMap(
      'trip-1',
      { latitude: 13, longitude: 80.2, label: 'WH' },
      { latitude: 13.1, longitude: 80.3, label: 'Customer' },
    );
    expect(plan.overview).toBe(true);
    expect(plan.stops.map((s) => s.kind)).toEqual(['pickup', 'drop']);
    expect(plan.stops.map((s) => s.kindIndex)).toEqual([1, 1]);
    expect(plan.stops.map(routePlanStopCaption)).toEqual(['Pickup 1', 'Drop 1']);
  });

  it('numbers pickups and drops independently for multi-order plans', () => {
    const plan = buildDriverRoutePlanMap(
      'trip-1',
      [
        stop({ stopId: 'p1', sequence: 1, stopType: 'pickup', latitude: 13.0, longitude: 80.2 }),
        stop({ stopId: 'p2', sequence: 2, stopType: 'pickup', latitude: 13.02, longitude: 80.22 }),
        stop({ stopId: 'd1', sequence: 3, stopType: 'drop', latitude: 13.04, longitude: 80.24 }),
        stop({ stopId: 'd2', sequence: 4, stopType: 'drop', latitude: 13.06, longitude: 80.26 }),
        stop({ stopId: 'd3', sequence: 5, stopType: 'drop', latitude: 13.08, longitude: 80.28 }),
      ],
      'p1',
      'pickup',
    );
    expect(plan.stops.map((s) => s.kindIndex)).toEqual([1, 2, 1, 2, 3]);
    expect(plan.stops.map(routePlanStopCaption)).toEqual([
      'Pickup 1',
      'Pickup 2',
      'Drop 1',
      'Drop 2',
      'Drop 3',
    ]);
    expect(plan.stops.map(routePlanLeafletMarkerId)).toEqual([
      'pickup-1',
      'pickup-2',
      'drop-1',
      'drop-2',
      'drop-3',
    ]);
  });

  it('keeps both drop icons and summarizes the next stop when they share a point', () => {
    const plan = buildDriverRoutePlanMap(
      'trip-1',
      [
        stop({ stopId: 'd1', sequence: 1, stopType: 'drop', latitude: 13.08, longitude: 80.27, displayName: 'A' }),
        stop({ stopId: 'd2', sequence: 2, stopType: 'drop', latitude: 13.0802, longitude: 80.2702, displayName: 'B' }),
      ],
      'd1',
      'drop',
    );
    const clusters = clusterRoutePlanStops(plan.stops);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.map((item) => item.kindIndex)).toEqual([1, 2]);
    expect(routeClusterCopy(clusters[0] ?? [])).toEqual({
      label: 'Drop 1',
      nextLabel: '+1 next · Drop 2',
    });
  });
});

describe('buildTripRowRoutePlanMap with FTL stops', () => {
  it('numbers en-route stops as drops before the final drop and skips stops without coordinates', () => {
    const plan = buildTripRowRoutePlanMap(
      't1',
      { latitude: 12.9, longitude: 77.6, label: 'Bengaluru' },
      { latitude: 13.0, longitude: 80.2, label: 'Chennai' },
      [
        { id: 'a', latitude: 12.7, longitude: 77.8, label: 'Hosur' },
        { id: 'b', latitude: null, longitude: null, label: 'Unknown' },
        { id: 'c', latitude: 12.5, longitude: 78.2, label: 'Krishnagiri' },
      ],
    );
    expect(plan.stops.map((s) => [routePlanStopCaption(s), s.label, s.sequence])).toEqual([
      ['Pickup 1', 'Bengaluru', 1],
      ['Drop 1', 'Hosur', 2],
      ['Drop 2', 'Krishnagiri', 3],
      ['Drop 3', 'Chennai', 4],
    ]);
  });
});
