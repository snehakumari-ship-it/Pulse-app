import {
  pickOrgTripForMarketBid,
} from "@/features/finance/utils/marketplaceFeeLedgerTrip.util";
import { supabase } from "@/lib/supabase";

export type MarketplaceFeeLinkedTrip = {
  id: string;
  trip_number: string | null;
  pickup_area: string | null;
  drop_location: string | null;
  pickup_date: string | null;
};

const TRIP_SELECT =
  "id, trip_number, display_trip_id, trip_code, trip_operational_code, pickup_area, drop_location, pickup_date, source_market_bid_id";

/**
 * Trip this org created for a Marketplace award. Fee ledger rows store the
 * bid on payment_ref and leave trip_id null.
 */
export async function findOrgTripForMarketBid(
  orgId: string,
  marketBidId: string,
): Promise<{ trip: MarketplaceFeeLinkedTrip | null; error: Error | null }> {
  const { data: bid, error: bidError } = await supabase()
    .from("market_bids")
    .select("id, indent_id")
    .eq("id", marketBidId)
    .maybeSingle();
  if (bidError) return { trip: null, error: bidError };
  if (!bid) return { trip: null, error: null };

  let query = supabase()
    .from("trips")
    .select(TRIP_SELECT)
    .eq("organization_id", orgId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(10);

  query = bid.indent_id
    ? query.or(
        `source_market_bid_id.eq.${marketBidId},source_indent_id.eq.${bid.indent_id}`,
      )
    : query.eq("source_market_bid_id", marketBidId);

  const { data, error } = await query;
  if (error) return { trip: null, error };
  const row = pickOrgTripForMarketBid(data ?? [], marketBidId);
  if (!row) return { trip: null, error: null };

  return {
    trip: {
      id: row.id,
      trip_number:
        row.trip_operational_code ??
        row.trip_code ??
        row.display_trip_id ??
        row.trip_number ??
        null,
      pickup_area: row.pickup_area ?? null,
      drop_location: row.drop_location ?? null,
      pickup_date: row.pickup_date ?? null,
    },
    error: null,
  };
}
