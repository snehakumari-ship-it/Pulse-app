/**
 * Bidder-side counter state of a direct quote.
 *
 * accept_direct_quote_counter only sets amount = counter_amount: status stays
 * pending and counter_amount is kept. So a counter is open while the pending
 * amount differs from it, and taken once they match. submit_network_quote
 * locks any quote that carries a counter, so a countered quote can only be
 * changed by accepting that exact counter, once.
 */
import { formatINR } from "@/lib/format";

export type DirectQuoteCounterState = "none" | "open" | "taken";

export interface DirectQuoteCounterFields {
  id?: string;
  status?: string | null;
  amount?: number | string | null;
  counter_amount?: number | string | null;
}

function positive(value: number | string | null | undefined): number | null {
  const n = Number(value);
  return value != null && Number.isFinite(n) && n > 0 ? n : null;
}

export function directQuoteCounterState(
  quote: DirectQuoteCounterFields | null | undefined,
): DirectQuoteCounterState {
  if (!quote || (quote.status ?? "").trim().toLowerCase() !== "pending") return "none";
  const counter = positive(quote.counter_amount);
  if (counter == null) return "none";
  return positive(quote.amount) === counter ? "taken" : "open";
}

/** The counter the bidder can still accept, or null. */
export function openCounterAmount(
  quote: DirectQuoteCounterFields | null | undefined,
): number | null {
  return directQuoteCounterState(quote) === "open" ? positive(quote!.counter_amount) : null;
}

/** Display copy: the counter is only shown while it can still be accepted. */
export function withOpenCounterOnly<T extends DirectQuoteCounterFields>(quote: T): T {
  return directQuoteCounterState(quote) === "open" || quote.counter_amount == null
    ? quote
    : { ...quote, counter_amount: null };
}

export type DirectQuoteSubmitRoute =
  | { kind: "quote" }
  | { kind: "accept_counter"; quoteId: string; counterAmount: number }
  | { kind: "blocked"; message: string };

/** Which write a bidder's amount goes to; countered quotes never reach submit_network_quote. */
export function routeDirectQuoteSubmit(
  quote: DirectQuoteCounterFields | null | undefined,
  amount: number,
): DirectQuoteSubmitRoute {
  const state = directQuoteCounterState(quote);
  if (state === "none") return { kind: "quote" };
  const counter = positive(quote!.counter_amount)!;
  if (state === "taken") {
    return {
      kind: "blocked",
      message: `You accepted the ${formatINR(counter)} counter. This bid can no longer be changed.`,
    };
  }
  if (Number(amount) === counter && quote!.id) {
    return { kind: "accept_counter", quoteId: quote!.id, counterAmount: counter };
  }
  return {
    kind: "blocked",
    message: `The shipper countered at ${formatINR(counter)}. A countered bid can't be changed. Accept ${formatINR(counter)} or wait for their decision.`,
  };
}

/** Cache patch after a successful accept, mirroring the RPC's single write. */
export function applyAcceptedCounter<T extends DirectQuoteCounterFields & { updated_at?: string }>(
  rows: readonly T[] | undefined,
  quoteId: string,
  counterAmount: number,
  nowIso: string = new Date().toISOString(),
): T[] | undefined {
  if (!rows) return rows;
  return rows.map((row) =>
    row.id === quoteId ? { ...row, amount: counterAmount, updated_at: nowIso } : row,
  );
}
