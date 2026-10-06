/**
 * In-memory Commerce execution model for the Driver Job Card.
 *
 * Primitive A is authoritative for stop/order/product structure.
 * SES is authoritative for execution status (arrive / complete).
 * This file does not query Postgres, trips, orders, or products.
 */
import { formatStopAddress } from '@/features/driver/commerce-mission/driverCommerceMissionLabels';
import type {
  DriverTripStopOrder,
  DriverTripStopOrderLine,
  DriverTripStopOrderMission,
} from '@/features/driver/commerce-mission/driverTripStopOrders.types';
import type {
  DriverStopExecutionStatus,
  DriverStopExecutionStop,
} from '@/features/driver/execution/driverStopExecution.types';
import { deriveCurrentStop } from '@/features/driver/execution/normalizeDriverStopExecution';
import { routePlanKind, type DriverRoutePlanKind } from '@/features/driver/job-card/driverRoutePlanMap';
import { isCommerceDriverTrip } from '@/features/trips/domain/driverTripExperience';

const TERMINAL: ReadonlySet<string> = new Set(['completed', 'skipped']);
const KNOWN_STATUS: ReadonlySet<string> = new Set([
  'pending',
  'arrived',
  'completed',
  'skipped',
  'failed',
]);

export type CommerceTripOrigin = {
  id: string;
  status?: string | null;
  driver_id?: string | null;
  vehicle_id?: string | null;
  owner_vehicle_id?: string | null;
  is_commerce?: boolean;
  execution_plan_id?: string | null;
};

export type CommerceProductLine = {
  productId: string | null;
  name: string | null;
  sku: string | null;
  quantity: number | null;
  /** Catalog uom is not on Primitive A. Null until a later contract adds it. */
  unit: string | null;
};

export type CommerceOrder = {
  id: string;
  orderNumber: string | null;
  customer: { id: string | null; name: string | null; phone: string | null };
  productCount: number;
  totalQuantity: number | null;
  lines: CommerceProductLine[];
  dropStopCount: number;
  completedDropStopCount: number;
};

export type CommerceStop = {
  id: string;
  sequence: number;
  type: DriverRoutePlanKind;
  status: DriverStopExecutionStatus;
  location: string;
  address: string | null;
  contact: { name: string | null; phone: string | null };
  latitude: number | null;
  longitude: number | null;
  orderIds: string[];
  orders: CommerceOrder[];
  isCurrent: boolean;
};

export type CommerceTripSummary = {
  orderCount: number;
  stopCount: number;
  productCount: number;
  totalQuantity: number | null;
};

export type CommerceMapStop = {
  stopId: string;
  sequence: number;
  kind: DriverRoutePlanKind;
  kindIndex: number;
  latitude: number;
  longitude: number;
  status: DriverStopExecutionStatus;
};

export type CommerceTripExecution = {
  trip: {
    id: string;
    status: string | null;
    executionPlanId: string | null;
    isCommerce: boolean;
    driverId: string | null;
    vehicleId: string | null;
  };
  summary: CommerceTripSummary;
  stops: CommerceStop[];
  orders: CommerceOrder[];
  currentStopId: string | null;
  /** False when SES has not hydrated this trip — paint only, no arrive/complete. */
  executionReady: boolean;
};

export type BuildCommerceTripExecutionInput = {
  trip: CommerceTripOrigin;
  mission: DriverTripStopOrderMission | null | undefined;
  sesStops: readonly DriverStopExecutionStop[];
};

function asStatus(value: string | null | undefined): DriverStopExecutionStatus {
  const s = (value ?? 'pending').trim().toLowerCase();
  if (KNOWN_STATUS.has(s)) return s as DriverStopExecutionStatus;
  return 'pending';
}

function lineQuantity(line: Pick<DriverTripStopOrderLine, 'quantity'>): number | null {
  if (line.quantity == null || !Number.isFinite(line.quantity)) return null;
  return line.quantity;
}

function toProductLine(line: DriverTripStopOrderLine): CommerceProductLine {
  return {
    productId: line.productId?.trim() || null,
    name: line.productName?.trim() || null,
    sku: line.productSku?.trim() || null,
    quantity: lineQuantity(line),
    unit: null,
  };
}

function countsFromLines(lines: readonly CommerceProductLine[]): {
  productCount: number;
  totalQuantity: number | null;
} {
  const productIds = new Set<string>();
  let qty = 0;
  let anyQty = false;
  let unnamed = 0;
  for (const line of lines) {
    if (line.productId) productIds.add(line.productId);
    else unnamed += 1;
    if (line.quantity != null) {
      qty += line.quantity;
      anyQty = true;
    }
  }
  return {
    productCount: productIds.size + unnamed,
    totalQuantity: anyQty ? qty : null,
  };
}

function toCommerceOrder(order: DriverTripStopOrder): CommerceOrder {
  const lines = (order.lines ?? []).map(toProductLine);
  const { productCount, totalQuantity } = countsFromLines(lines);
  return {
    id: order.salesOrderId,
    orderNumber: order.orderNumber,
    customer: {
      id: order.customerId,
      name: order.customerName,
      phone: order.customerPhone,
    },
    productCount,
    totalQuantity,
    lines,
    dropStopCount: order.orderDistinctDropStopCount,
    completedDropStopCount: order.orderCompletedDropStopCount,
  };
}

function lineKey(line: CommerceProductLine): string {
  if (line.productId) return `p:${line.productId}`;
  if (line.sku) return `s:${line.sku}`;
  if (line.name) return `n:${line.name}`;
  return `q:${line.quantity ?? ''}`;
}

function mergeTripOrder(into: CommerceOrder, from: CommerceOrder): CommerceOrder {
  const byKey = new Map<string, CommerceProductLine>();
  for (const line of into.lines) byKey.set(lineKey(line), line);
  for (const line of from.lines) {
    if (!byKey.has(lineKey(line))) byKey.set(lineKey(line), line);
  }
  const lines = Array.from(byKey.values());
  const { productCount, totalQuantity } = countsFromLines(lines);
  return {
    ...into,
    customer: {
      id: into.customer.id ?? from.customer.id,
      name: into.customer.name ?? from.customer.name,
      phone: into.customer.phone ?? from.customer.phone,
    },
    orderNumber: into.orderNumber ?? from.orderNumber,
    dropStopCount: Math.max(into.dropStopCount, from.dropStopCount),
    completedDropStopCount: Math.max(into.completedDropStopCount, from.completedDropStopCount),
    lines,
    productCount,
    totalQuantity,
  };
}

function stopLocation(stop: DriverTripStopOrderMission['stops'][number]): string {
  return (
    stop.displayName?.trim()
    || stop.label?.trim()
    || stop.city?.trim()
    || `Stop ${stop.sequence}`
  );
}

function sesByStopId(
  sesStops: readonly DriverStopExecutionStop[],
): Map<string, DriverStopExecutionStop> {
  const map = new Map<string, DriverStopExecutionStop>();
  for (const stop of sesStops) {
    if (stop.stopId && !map.has(stop.stopId)) map.set(stop.stopId, stop);
  }
  return map;
}

function asSesShape(
  stopId: string,
  sequence: number,
  status: DriverStopExecutionStatus,
): DriverStopExecutionStop {
  return {
    stopId,
    sequence,
    stopType: 'stop',
    displayName: stopId,
    addressLine: null,
    city: null,
    state: null,
    pincode: null,
    latitude: null,
    longitude: null,
    contactName: null,
    contactPhone: null,
    podRequired: false,
    status,
    driverId: null,
    arrivedAt: null,
    completedAt: null,
    skipReason: null,
    failureReason: null,
  };
}

/** Gate 3 predicate. Commerce origin is execution_plan_id / is_commerce only. */
export function commerceOriginFromTrip(trip: CommerceTripOrigin | null | undefined): boolean {
  return isCommerceDriverTrip(trip);
}

export function emptyCommerceTripExecution(trip: CommerceTripOrigin): CommerceTripExecution {
  const executionPlanId = (trip.execution_plan_id ?? '').trim() || null;
  return {
    trip: {
      id: trip.id,
      status: trip.status ?? null,
      executionPlanId,
      isCommerce: commerceOriginFromTrip(trip),
      driverId: trip.driver_id ?? null,
      vehicleId: trip.vehicle_id ?? trip.owner_vehicle_id ?? null,
    },
    summary: { orderCount: 0, stopCount: 0, productCount: 0, totalQuantity: null },
    stops: [],
    orders: [],
    currentStopId: null,
    executionReady: false,
  };
}

export function summaryLabel(summary: CommerceTripSummary): string {
  const orders = `${summary.orderCount} ${summary.orderCount === 1 ? 'Order' : 'Orders'}`;
  const stops = `${summary.stopCount} ${summary.stopCount === 1 ? 'Stop' : 'Stops'}`;
  const products = `${summary.productCount} ${summary.productCount === 1 ? 'Product' : 'Products'}`;
  return `${orders} · ${stops} · ${products}`;
}

/**
 * Assemble the driver Commerce model. No IO.
 * SES status overlays Primitive A structure by stop id. Extra SES-only stops
 * are ignored so we never invent orders. Extra Primitive A stops stay
 * display-only until SES hydrates.
 */
export function buildCommerceTripExecution(
  input: BuildCommerceTripExecutionInput,
): CommerceTripExecution {
  const empty = emptyCommerceTripExecution(input.trip);
  const mission = input.mission;
  if (!mission?.stops.length) {
    return empty;
  }

  const sesMap = sesByStopId(input.sesStops);
  const tripOrders = new Map<string, CommerceOrder>();
  const stops: CommerceStop[] = [];
  const statusForCurrent: DriverStopExecutionStop[] = [];

  for (const raw of [...mission.stops].sort((a, b) => a.sequence - b.sequence || a.stopId.localeCompare(b.stopId))) {
    const ses = sesMap.get(raw.stopId);
    const status = ses ? ses.status : asStatus(raw.stopExecutionStatus);
    const stopOrders = (raw.orders ?? []).map((order) => {
      const commerce = toCommerceOrder(order);
      const existing = tripOrders.get(commerce.id);
      tripOrders.set(commerce.id, existing ? mergeTripOrder(existing, commerce) : commerce);
      return commerce;
    });
    const orderIds = stopOrders.map((o) => o.id);
    stops.push({
      id: raw.stopId,
      sequence: raw.sequence,
      type: routePlanKind(raw.stopType),
      status,
      location: stopLocation(raw),
      address: formatStopAddress(raw),
      contact: {
        name: raw.contactName,
        phone: raw.contactPhone,
      },
      latitude: raw.latitude,
      longitude: raw.longitude,
      orderIds,
      orders: stopOrders,
      isCurrent: false,
    });
    statusForCurrent.push(asSesShape(raw.stopId, raw.sequence, status));
  }

  const current = deriveCurrentStop(statusForCurrent);
  const currentStopId = current?.stopId ?? null;
  const orders = Array.from(tripOrders.values());
  const summaryParts = countsFromLines(orders.flatMap((o) => o.lines));

  return {
    ...empty,
    trip: {
      ...empty.trip,
      executionPlanId: empty.trip.executionPlanId || mission.executionPlanId,
    },
    summary: {
      orderCount: orders.length,
      stopCount: stops.length,
      productCount: summaryParts.productCount,
      totalQuantity: summaryParts.totalQuantity,
    },
    stops: stops.map((stop) => ({ ...stop, isCurrent: stop.id === currentStopId })),
    orders,
    currentStopId,
    executionReady: stops.some((stop) => sesMap.has(stop.id)),
  };
}

/** Map pins: coordinates + sequence + type + SES/merged status. No products. */
export function toCommerceMapStops(execution: CommerceTripExecution): CommerceMapStop[] {
  let pickupN = 0;
  let dropN = 0;
  const mapped: CommerceMapStop[] = [];
  for (const stop of execution.stops) {
    if (stop.latitude == null || stop.longitude == null) continue;
    const latitude = Number(stop.latitude);
    const longitude = Number(stop.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
    if (stop.type === 'pickup') pickupN += 1;
    else if (stop.type === 'drop') dropN += 1;
    mapped.push({
      stopId: stop.id,
      sequence: stop.sequence,
      kind: stop.type,
      kindIndex: stop.type === 'pickup' ? pickupN : stop.type === 'drop' ? dropN : stop.sequence,
      latitude,
      longitude,
      status: stop.status,
    });
  }
  return mapped;
}

export function isTerminalCommerceStop(status: DriverStopExecutionStatus): boolean {
  return TERMINAL.has(status);
}
