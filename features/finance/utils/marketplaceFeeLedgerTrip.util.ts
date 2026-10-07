import type { LedgerRow } from "@/features/finance/services/finance.service";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isMarketplacePlatformFeeLedgerRow(
  row: Pick<LedgerRow, "ledger_category" | "description" | "party_name">,
): boolean {
  if ((row.ledger_category ?? "").trim() === "MARKETPLACE_PLATFORM_FEE") return true;
  const description = (row.description ?? "").toUpperCase();
  if (description.includes("MARKETPLACE PLATFORM FEE")) return true;
  const party = (row.party_name ?? "").trim().toLowerCase();
  return party === "pulse marketplace" || party.startsWith("pulse marketplace (");
}

export function marketplaceFeeBidIdFromLedgerRow(
  row: Pick<LedgerRow, "payment_ref">,
): string | null {
  const ref = (row.payment_ref ?? "").trim();
  return UUID_RE.test(ref) ? ref : null;
}

/** Prefer the trip stamped with this bid when several share an indent. */
export function pickOrgTripForMarketBid<T extends { source_market_bid_id?: string | null }>(
  rows: readonly T[],
  marketBidId: string,
): T | null {
  if (rows.length === 0) return null;
  return rows.find((row) => row.source_market_bid_id === marketBidId) ?? rows[0] ?? null;
}
