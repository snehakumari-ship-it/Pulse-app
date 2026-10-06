import {
  isExchangeClaimOverdue,
  type ExchangeLaneTrip,
  type ExchangeSide,
} from "@/features/marketplace/services/exchangePayments.service";

export type ExchangeLaneStatus = "settled" | "awaiting_you" | "awaiting_them" | "open";

export interface ExchangeLaneRow {
  trip: ExchangeLaneTrip;
  outstanding: number;
  status: ExchangeLaneStatus;
  overdue: boolean;
}

/** Which counterparties a Finance tab shows: the Suppliers chip (Supplier / DCO) narrows the payer side. */
export type ExchangeLaneContactFilter = "all" | "supplier" | "dco";

export function exchangeLaneRows(
  trips: ExchangeLaneTrip[],
  side: ExchangeSide,
  contactFilter: ExchangeLaneContactFilter = "all",
  now: Date = new Date(),
): ExchangeLaneRow[] {
  return trips
    .filter((t) => t.viewer_side === side)
    .filter((t) => contactFilter === "all" || t.ledger_contact_type === contactFilter)
    .map((trip) => {
      const outstanding = Math.max(0, Number(trip.agreed_amount) - Number(trip.confirmed_amount));
      const claims = trip.payments.filter((p) => p.status === "claimed");
      const awaitingYou = claims.some((p) => p.claimed_by_side !== side);
      const status: ExchangeLaneStatus =
        outstanding <= 0
          ? "settled"
          : awaitingYou
            ? "awaiting_you"
            : claims.length > 0
              ? "awaiting_them"
              : "open";
      return { trip, outstanding, status, overdue: claims.some((p) => isExchangeClaimOverdue(p, now)) };
    });
}
