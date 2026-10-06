/**
 * Pulse Exchange payments — Marketplace money between a shipper (payer) and the
 * winning bidder (payee), settled through each org's default "Pulse Exchange"
 * Finance party. A DCO payee works the same rows from the Driver App.
 *
 * Gate 1: either side records a payment (claim). Gate 2: the other side
 * confirms it; only then does it post to both orgs' ledgers. All writes are
 * RPCs; `exchange_payments` is read-only to clients.
 */
import { supabase } from "@/lib/supabase";

export type ExchangePaymentMode = "CASH" | "UPI" | "BANK" | "CHEQUE";
export type ExchangePaymentStatus = "claimed" | "confirmed" | "rejected" | "cancelled";
export type ExchangeSide = "payer" | "payee";

export interface ExchangePaymentRow {
  id: string;
  trip_id: string;
  market_bid_id: string | null;
  payer_organization_id: string;
  /** Null when the payee is an individual DCO (`payee_dco_payee_id`). */
  payee_organization_id: string | null;
  payee_dco_payee_id: string | null;
  amount: number;
  payment_mode: ExchangePaymentMode;
  payment_reference: string | null;
  paid_on: string;
  notes: string | null;
  status: ExchangePaymentStatus;
  claimed_by_side: ExchangeSide;
  claimed_by: string | null;
  claimed_at: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_reason: string | null;
  payer_transaction_id: string | null;
  payee_transaction_id: string | null;
}

export interface ExchangeTripSummary {
  trip_id: string;
  trip_number: string | null;
  viewer_side: ExchangeSide;
  /** `dco`: an individual DCO, who acts from the Driver App and has no Finance ledger. */
  payee_kind: "organization" | "dco";
  payer_organization_id: string;
  payer_organization_name: string | null;
  payee_organization_id: string | null;
  /** The bidder org's name, or the DCO's name. */
  payee_organization_name: string | null;
  agreed_amount: number;
  confirmed_amount: number;
  claimed_amount: number;
  payments: ExchangePaymentRow[];
}

export interface PulseExchangeParties {
  supplierId: string;
  clientId: string;
}

export interface ClaimExchangePaymentInput {
  tripId: string;
  amount: number;
  paymentMode: ExchangePaymentMode;
  /** Stable per submit so a retried submit returns the same claim. */
  idempotencyKey: string;
  paymentReference?: string | null;
  paidOn?: string | null;
  notes?: string | null;
}

/** A claim waiting this long for the other side is flagged overdue (no auto-confirm). */
export const EXCHANGE_CONFIRMATION_SLA_HOURS = 72;

const EXCHANGE_ERROR_MESSAGES: Record<string, string> = {
  over_settlement: "This would take recorded payments past the agreed amount for this trip.",
  duplicate_reference: "This UTR / reference is already recorded on this trip.",
  not_exchange_trip: "This trip is not settled through Pulse Exchange.",
  ambiguous_side: "You belong to both organizations on this trip, so you can't record or confirm its payments.",
  award_changed: "The Marketplace award on this trip changed after this payment was recorded.",
  exchange_ledger_locked: "Pulse Exchange entries post to Finance only after the other side confirms them in Exchange.",
};

export function exchangeErrorMessage(raw: string): string {
  const code = raw.match(/^([a-z_]+):/)?.[1];
  if (code && EXCHANGE_ERROR_MESSAGES[code]) return EXCHANGE_ERROR_MESSAGES[code];
  return raw.replace(/^[a-z_]+:\s*/, "");
}

export function newExchangeIdempotencyKey(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const pendingClaimKeys = new Map<string, string>();

function claimFingerprint(orgId: string, input: Omit<ClaimExchangePaymentInput, "idempotencyKey">): string {
  return [
    orgId,
    input.tripId,
    Math.round(input.amount * 100),
    input.paymentMode,
    (input.paymentReference ?? "").trim().toLowerCase(),
    (input.paidOn ?? "").slice(0, 10),
  ].join("|");
}

/**
 * Claims from a form that has no key of its own (Finance). Resubmitting the same
 * payment reuses its key until the claim succeeds, so a retry or double-tap
 * returns the first claim instead of recording a second one.
 */
export async function claimExchangePaymentOnce(
  orgId: string,
  input: Omit<ClaimExchangePaymentInput, "idempotencyKey">,
): Promise<{ error: Error | null; payment: ExchangePaymentRow | null }> {
  const fingerprint = claimFingerprint(orgId, input);
  let key = pendingClaimKeys.get(fingerprint);
  if (!key) {
    key = newExchangeIdempotencyKey();
    pendingClaimKeys.set(fingerprint, key);
  }
  const result = await claimExchangePayment({ ...input, idempotencyKey: key });
  if (!result.error && pendingClaimKeys.get(fingerprint) === key) pendingClaimKeys.delete(fingerprint);
  return result;
}

export function isExchangeClaimOverdue(
  payment: Pick<ExchangePaymentRow, "status" | "claimed_at">,
  now: Date = new Date(),
): boolean {
  if (payment.status !== "claimed") return false;
  const claimedAt = Date.parse(payment.claimed_at);
  if (!Number.isFinite(claimedAt)) return false;
  return now.getTime() - claimedAt > EXCHANGE_CONFIRMATION_SLA_HOURS * 3_600_000;
}

/** Maps the Finance description `Mode:` label to an Exchange payment mode. */
export function exchangeModeFromLedgerLabel(label: string | null | undefined): ExchangePaymentMode {
  const v = String(label ?? "").trim().toLowerCase();
  if (v === "upi") return "UPI";
  if (v === "cheque") return "CHEQUE";
  if (v === "bank transfer" || v === "bank" || v === "neft" || v === "rtgs" || v === "imps") return "BANK";
  return "CASH";
}

const partiesByOrg = new Map<string, Promise<PulseExchangeParties | null>>();

/** The org's default Pulse Exchange parties, created on first use. Cached per org for the session. */
export function ensurePulseExchangeParties(orgId: string): Promise<PulseExchangeParties | null> {
  const cached = partiesByOrg.get(orgId);
  if (cached) return cached;
  const pending = (async () => {
    try {
      const { data, error } = await supabase().rpc("ensure_pulse_exchange_parties", { p_org_id: orgId });
      const row = data as { supplier_id?: string | null; client_id?: string | null } | null;
      if (error || !row?.supplier_id || !row?.client_id) return null;
      return { supplierId: row.supplier_id, clientId: row.client_id };
    } catch {
      return null;
    }
  })();
  partiesByOrg.set(orgId, pending);
  void pending.then((result) => {
    if (!result) partiesByOrg.delete(orgId);
  });
  return pending;
}

export async function isPulseExchangeParty(
  orgId: string,
  contactType: string | null | undefined,
  contactId: string | null | undefined,
): Promise<boolean> {
  if (!contactId || (contactType !== "supplier" && contactType !== "client")) return false;
  const parties = await ensurePulseExchangeParties(orgId);
  if (!parties) return false;
  return contactType === "supplier" ? parties.supplierId === contactId : parties.clientId === contactId;
}

export async function getExchangeTripSummary(
  tripId: string,
): Promise<{ error: Error | null; summary: ExchangeTripSummary | null }> {
  const { data, error } = await supabase().rpc("get_exchange_trip_summary", { p_trip_id: tripId });
  if (error) return { error: new Error(error.message), summary: null };
  return { error: null, summary: (data as ExchangeTripSummary | null) ?? null };
}

async function exchangeRpc(
  fn: string,
  args: Record<string, unknown>,
): Promise<{ error: Error | null; payment: ExchangePaymentRow | null }> {
  const { data, error } = await supabase().rpc(fn, args);
  if (error) return { error: new Error(exchangeErrorMessage(error.message)), payment: null };
  return { error: null, payment: data as ExchangePaymentRow };
}

export function claimExchangePayment(input: ClaimExchangePaymentInput) {
  return exchangeRpc("claim_exchange_payment", {
    p_trip_id: input.tripId,
    p_amount: input.amount,
    p_payment_mode: input.paymentMode,
    p_idempotency_key: input.idempotencyKey,
    p_payment_reference: input.paymentReference?.trim() || null,
    p_paid_on: input.paidOn?.slice(0, 10) || null,
    p_notes: input.notes?.trim() || null,
  });
}

export function confirmExchangePayment(paymentId: string) {
  return exchangeRpc("confirm_exchange_payment", { p_exchange_payment_id: paymentId });
}

export function rejectExchangePayment(paymentId: string, reason: string) {
  return exchangeRpc("reject_exchange_payment", { p_exchange_payment_id: paymentId, p_reason: reason });
}

export function cancelExchangePayment(paymentId: string) {
  return exchangeRpc("cancel_exchange_payment", { p_exchange_payment_id: paymentId });
}
