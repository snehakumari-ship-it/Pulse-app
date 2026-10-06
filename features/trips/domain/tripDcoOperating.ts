/**
 * DCO commercial operating mode. Independent of TripExecutionModel
 * (`asset` | `aggregate`), which stays the physical/ledger-lane classifier.
 *
 * Discriminator is ONLY `trips.operating_mode === 'DCO'`. Do not infer DCO from
 * supplier_id, trip_payout_mode, source, or driver relationship.
 */
export function isDcoOperatingTrip(
  trip: { operating_mode?: string | null } | null | undefined,
): boolean {
  return String(trip?.operating_mode ?? "").trim().toUpperCase() === "DCO";
}

/**
 * A Marketplace DCO award settled through Pulse Exchange. The database only
 * lets a DCO trip carry a supplier when it is the shipper's Pulse Exchange
 * party, so the shipper pays Pulse Exchange, not the DCO payee.
 */
export function isExchangeSettledDcoTrip(
  trip: { operating_mode?: string | null; supplier_id?: string | null } | null | undefined,
): boolean {
  return isDcoOperatingTrip(trip) && !!trip?.supplier_id;
}
