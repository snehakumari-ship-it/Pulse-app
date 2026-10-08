import type { DriverStopExecutionStop } from '@/features/driver/execution/driverStopExecution.types';

export type DriverRoutePlanKind = 'pickup' | 'drop' | 'other';

export type DriverRoutePlanMapStop = {
  stopId: string;
  sequence: number;
  /** 1-based index among pickups or among drops. */
  kindIndex: number;
  kind: DriverRoutePlanKind;
  latitude: number;
  longitude: number;
  label: string;
  isCurrent: boolean;
};

export type DriverRoutePlanMap = {
  tripId: string;
  focusKind: 'pickup' | 'drop';
  previewStopId: string | null;
  /** Fit every stop; do not follow a single pin. */
  overview: boolean;
  stops: DriverRoutePlanMapStop[];
};

export function routePlanKind(stopType: string | null | undefined): DriverRoutePlanKind {
  const t = (stopType ?? '').trim().toLowerCase();
  if (t === 'pickup') return 'pickup';
  if (t === 'drop') return 'drop';
  return 'other';
}

function asCoord(lat: number | null | undefined, lon: number | null | undefined): {
  latitude: number;
  longitude: number;
} | null {
  if (lat == null || lon == null) return null;
  const latitude = Number(lat);
  const longitude = Number(lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude };
}

export function buildDriverRoutePlanMap(
  tripId: string,
  stops: readonly DriverStopExecutionStop[],
  currentStopId: string | null,
  focusKind: 'pickup' | 'drop',
  previewStopId: string | null = null,
  overview = true,
): DriverRoutePlanMap {
  const mapped: DriverRoutePlanMapStop[] = [];
  for (const stop of stops) {
    const coord = asCoord(stop.latitude, stop.longitude);
    if (!coord) continue;
    mapped.push({
      stopId: stop.stopId,
      sequence: stop.sequence,
      kindIndex: 0,
      kind: routePlanKind(String(stop.stopType)),
      latitude: coord.latitude,
      longitude: coord.longitude,
      label: stop.displayName?.trim() || stop.city?.trim() || stop.addressLine?.trim() || `Stop ${stop.sequence}`,
      isCurrent: stop.stopId === currentStopId,
    });
  }
  mapped.sort((a, b) => a.sequence - b.sequence);
  let pickupN = 0;
  let dropN = 0;
  const numbered = mapped.map((stop) => {
    if (stop.kind === 'pickup') {
      pickupN += 1;
      return { ...stop, kindIndex: pickupN };
    }
    if (stop.kind === 'drop') {
      dropN += 1;
      return { ...stop, kindIndex: dropN };
    }
    return { ...stop, kindIndex: stop.sequence };
  });
  return { tripId, focusKind, previewStopId, overview, stops: numbered };
}

export function buildTripRowRoutePlanMap(
  tripId: string,
  pickup: { latitude: number; longitude: number; label: string } | null,
  drop: { latitude: number; longitude: number; label: string } | null,
  /** FTL stops between pickup and drop; ones without coordinates stay off the map. */
  via: readonly {
    id: string;
    latitude: number | null;
    longitude: number | null;
    label: string;
  }[] = [],
): DriverRoutePlanMap {
  const stops: DriverRoutePlanMapStop[] = [];
  const viaStops: DriverRoutePlanMapStop[] = [];
  for (const stop of via) {
    const coord = asCoord(stop.latitude, stop.longitude);
    if (!coord) continue;
    viaStops.push({
      stopId: `${tripId}-via-${stop.id}`,
      sequence: 2 + viaStops.length,
      kindIndex: viaStops.length + 1,
      kind: 'drop',
      latitude: coord.latitude,
      longitude: coord.longitude,
      label: stop.label,
      isCurrent: false,
    });
  }
  if (pickup) {
    stops.push({
      stopId: `${tripId}-pickup`,
      sequence: 1,
      kindIndex: 1,
      kind: 'pickup',
      latitude: pickup.latitude,
      longitude: pickup.longitude,
      label: pickup.label,
      isCurrent: true,
    });
  }
  stops.push(...viaStops);
  if (drop) {
    stops.push({
      stopId: `${tripId}-drop`,
      sequence: 2 + viaStops.length,
      kindIndex: viaStops.length + 1,
      kind: 'drop',
      latitude: drop.latitude,
      longitude: drop.longitude,
      label: drop.label,
      isCurrent: false,
    });
  }
  return {
    tripId,
    focusKind: 'pickup',
    previewStopId: null,
    overview: true,
    stops,
  };
}

export function routePlanStopCaption(stop: DriverRoutePlanMapStop): string {
  if (stop.kind === 'drop') return `Drop ${stop.kindIndex}`;
  if (stop.kind === 'pickup') return `Pickup ${stop.kindIndex}`;
  return `Stop ${stop.sequence}`;
}

export function routePlanLeafletMarkerId(stop: DriverRoutePlanMapStop): string {
  if (stop.kind === 'drop') return `drop-${stop.kindIndex}`;
  if (stop.kind === 'pickup') return `pickup-${stop.kindIndex}`;
  return `plan-${stop.stopId}`;
}

const SAME_STOP_DEGREES = 0.003;

/** Stops that share a map point, kept in route order. */
export function clusterRoutePlanStops(
  stops: readonly DriverRoutePlanMapStop[],
): DriverRoutePlanMapStop[][] {
  const clusters: DriverRoutePlanMapStop[][] = [];
  for (const stop of stops) {
    const hit = clusters.find((group) => {
      const lead = group[0];
      if (!lead) return false;
      return (
        Math.abs(lead.latitude - stop.latitude) < SAME_STOP_DEGREES &&
        Math.abs(lead.longitude - stop.longitude) < SAME_STOP_DEGREES
      );
    });
    if (hit) hit.push(stop);
    else clusters.push([stop]);
  }
  return clusters;
}

/** Current stop, plus “+1 next · Drop 2” when more stops share the point. */
export function routeClusterCopy(stops: readonly DriverRoutePlanMapStop[]): {
  label: string;
  nextLabel: string | null;
} {
  if (stops.length === 0) return { label: '', nextLabel: null };
  const focus = Math.max(0, stops.findIndex((stop) => stop.isCurrent));
  const label = routePlanStopCaption(stops[focus] ?? stops[0]!);
  const upcoming = stops.slice(focus + 1);
  const next = upcoming[0];
  if (!next) return { label, nextLabel: null };
  return {
    label,
    nextLabel: `+${upcoming.length} next · ${routePlanStopCaption(next)}`,
  };
}

/**
 * Horizontal pixel shift for stop chips that sit on nearly the same point,
 * so Drop 2 is not painted on top of Drop 1.
 */
export function routePlanMarkerNudges(
  stops: readonly { stopId: string; latitude: number; longitude: number }[],
): Record<string, number> {
  const nudges: Record<string, number> = {};
  const placed: { latitude: number; longitude: number; slot: number }[] = [];
  for (const stop of stops) {
    const hit = placed.find(
      (prior) =>
        Math.abs(prior.latitude - stop.latitude) < 0.003 &&
        Math.abs(prior.longitude - stop.longitude) < 0.003,
    );
    if (!hit) {
      placed.push({ latitude: stop.latitude, longitude: stop.longitude, slot: 0 });
      nudges[stop.stopId] = 0;
      continue;
    }
    hit.slot += 1;
    const direction = hit.slot % 2 === 1 ? 1 : -1;
    nudges[stop.stopId] = direction * Math.ceil(hit.slot / 2) * 76;
  }
  return nudges;
}

export function routePlanPolyline(
  plan: DriverRoutePlanMap | null,
): Array<{ latitude: number; longitude: number }> {
  if (!plan || plan.stops.length < 2) return [];
  return plan.stops.map((s) => ({ latitude: s.latitude, longitude: s.longitude }));
}
