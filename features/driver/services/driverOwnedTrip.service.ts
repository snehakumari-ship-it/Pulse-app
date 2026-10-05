import { supabase } from "@/lib/supabase";
import type { TripRow } from "@/features/trips/services/trips.service";
import { driverRowToTripRow, type DriverTripRow } from "@/types/trip-views";

/**
 * D1 miss-path read: Home → Odometer / Expense when the mounted parent trip
 * is absent. Identity is auth.uid() inside get_driver_owned_trip. Not a
 * replacement for getAccessibleTripById (office / dispatcher).
 */
export async function getDriverOwnedTrip(
  tripId: string,
): Promise<{ error: Error | null; trip: TripRow | null }> {
  const { data, error } = await supabase().rpc("get_driver_owned_trip", {
    p_trip_id: tripId,
  });
  if (error) return { error: new Error(error.message), trip: null };
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { error: null, trip: null };
  return { error: null, trip: driverRowToTripRow(row as DriverTripRow) };
}
