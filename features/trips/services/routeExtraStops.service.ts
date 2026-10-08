import { supabase } from "@/lib/supabase";
import {
  EMPTY_ROUTE_EXTRA_STOP_SUMMARY,
  type RouteExtraStopInput,
  type RouteExtraStopSummary,
} from "@/features/trips/utils/routeExtraStops.util";

/** route_extra_stops — not in generated database.types yet. */
const TABLE = "route_extra_stops";
/** Keeps the `in.(…)` filter well under PostgREST URL limits. */
const ID_CHUNK = 150;

export type RouteExtraStopRow = {
  id: string;
  organization_id: string;
  indent_id: string | null;
  trip_id: string | null;
  sequence: number;
  stop_type: "pickup" | "drop";
  location: string;
  latitude: number | null;
  longitude: number | null;
  client_charge: number;
  supplier_charge: number;
};

export type RouteExtraStopParent = { indentId: string } | { tripId: string };

const SELECT =
  "id, organization_id, indent_id, trip_id, sequence, stop_type, location, latitude, longitude, client_charge, supplier_charge";

function table() {
  return supabase().from(TABLE as never);
}

function toRow(raw: Record<string, unknown>): RouteExtraStopRow {
  return {
    id: String(raw.id),
    organization_id: String(raw.organization_id),
    indent_id: (raw.indent_id as string | null) ?? null,
    trip_id: (raw.trip_id as string | null) ?? null,
    sequence: Number(raw.sequence) || 0,
    stop_type: raw.stop_type === "pickup" ? "pickup" : "drop",
    location: String(raw.location ?? ""),
    latitude: raw.latitude == null ? null : Number(raw.latitude),
    longitude: raw.longitude == null ? null : Number(raw.longitude),
    client_charge: Number(raw.client_charge) || 0,
    supplier_charge: Number(raw.supplier_charge) || 0,
  };
}

export async function insertRouteExtraStops(
  organizationId: string,
  parent: RouteExtraStopParent,
  stops: readonly RouteExtraStopInput[],
): Promise<{ error: Error | null }> {
  if (stops.length === 0) return { error: null };
  const owner =
    "indentId" in parent
      ? { indent_id: parent.indentId, trip_id: null }
      : { indent_id: null, trip_id: parent.tripId };
  const rows = stops.map((s, i) => ({
    organization_id: organizationId,
    ...owner,
    sequence: i + 1,
    stop_type: "drop",
    location: s.location,
    latitude: s.latitude,
    longitude: s.longitude,
    client_charge: s.clientCharge,
    supplier_charge: s.supplierCharge,
  }));
  const { error } = await table().insert(rows as never);
  return { error: error ? new Error(error.message) : null };
}

/** Delete-then-insert. Used for drafts, which are only edited by their own org. */
export async function replaceRouteExtraStops(
  organizationId: string,
  parent: RouteExtraStopParent,
  stops: readonly RouteExtraStopInput[],
): Promise<{ error: Error | null }> {
  const column = "indentId" in parent ? "indent_id" : "trip_id";
  const id = "indentId" in parent ? parent.indentId : parent.tripId;
  const { error } = await table().delete().eq(column, id);
  if (error) return { error: new Error(error.message) };
  return insertRouteExtraStops(organizationId, parent, stops);
}

async function fetchBy(
  column: "indent_id" | "trip_id",
  ids: readonly string[],
): Promise<{ rows: RouteExtraStopRow[]; error: Error | null }> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return { rows: [], error: null };
  const rows: RouteExtraStopRow[] = [];
  for (let i = 0; i < unique.length; i += ID_CHUNK) {
    const { data, error } = await table()
      .select(SELECT)
      .in(column, unique.slice(i, i + ID_CHUNK))
      .order("sequence", { ascending: true });
    if (error) return { rows: [], error: new Error(error.message) };
    rows.push(...((data ?? []) as Record<string, unknown>[]).map(toRow));
  }
  return { rows, error: null };
}

export function fetchRouteExtraStopsForIndents(indentIds: readonly string[]) {
  return fetchBy("indent_id", indentIds);
}

export function fetchRouteExtraStopsForTrips(tripIds: readonly string[]) {
  return fetchBy("trip_id", tripIds);
}

/** Per-parent count and charge totals keyed by indent_id or trip_id. */
export function summarizeRouteExtraStopRows(
  rows: readonly RouteExtraStopRow[],
  key: "indent_id" | "trip_id",
): Map<string, RouteExtraStopSummary> {
  const out = new Map<string, RouteExtraStopSummary>();
  for (const row of rows) {
    const id = row[key];
    if (!id) continue;
    const prev = out.get(id) ?? EMPTY_ROUTE_EXTRA_STOP_SUMMARY;
    out.set(id, {
      count: prev.count + 1,
      clientCharge: prev.clientCharge + row.client_charge,
      supplierCharge: prev.supplierCharge + row.supplier_charge,
    });
  }
  return out;
}

/**
 * A trip created from an indent inherits the indent's stops. The indent's
 * freight already includes the charges, so prices are not touched here.
 * When another org (the awarded supplier) runs the trip, what the shipper
 * pays that supplier per stop is the supplier org's client-side charge.
 */
export async function copyIndentExtraStopsToTrip(
  tripOrganizationId: string,
  indentId: string,
  tripId: string,
): Promise<{ error: Error | null }> {
  const { rows, error } = await fetchRouteExtraStopsForIndents([indentId]);
  if (error) return { error };
  return insertRouteExtraStops(
    tripOrganizationId,
    { tripId },
    rows.map((r) => {
      const sameOrg = r.organization_id === tripOrganizationId;
      return {
        location: r.location,
        latitude: r.latitude,
        longitude: r.longitude,
        clientCharge: sameOrg ? r.client_charge : r.supplier_charge,
        supplierCharge: sameOrg ? r.supplier_charge : 0,
      };
    }),
  );
}
