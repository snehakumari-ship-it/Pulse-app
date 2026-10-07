import { supabase } from "@/lib/supabase";
import { createLedgerEntry, updateLedgerEntry, type CreateLedgerEntryData } from "@/features/finance/services/finance.service";
import {
  buildLedgerSyncDescriptionLine,
  interpretLedgerRowStructured,
} from "@/features/finance/ledger/ledgerEntryModel";
import {
  isCashPaymentMode,
  normalizeComplianceRequestId,
  normalizeComplianceUtr,
  validateComplianceRequestId,
  validateComplianceUtr,
  withLedgerDescriptionRequestId,
  withLedgerDescriptionUtr,
} from "@/features/tripCompliance/utils/compliancePaymentReference.util";
import {
  normalizeComplianceTransactionDate,
  validateComplianceTransactionDate,
  withLedgerDescriptionTxnDateConfirmed,
} from "@/features/tripCompliance/utils/compliancePaymentDate.util";
import type { TripRow } from "@/features/trips/services/trips.service";
import { evaluateCompliancePaymentGuard, type ComplianceLedgerCategory } from "@/features/tripCompliance/utils/compliancePaymentGuard.util";
import { complianceSupplierLedgerCategory } from "@/features/finance/utils/complianceSupplierLedger.util";
import { recordAdvanceDocumentCostSnapshot } from "@/features/debit-control/services/debitControlPod.service";
import { fetchComplianceTransactions } from "@/features/tripCompliance/services/tripComplianceRead.service";
import {
  COMPLIANCE_DECLINE_REASON_MAX,
  COMPLIANCE_DECLINE_REASON_MIN,
  complianceDeclineReasonLength,
  type ComplianceDocumentRow,
  type ComplianceDocumentStatus,
} from "@/features/tripCompliance/tripCompliance.types";

/**
 * Verify or reject a single trip document. Goes through the
 * `verify_trip_document` SECURITY DEFINER RPC (migration 20260915162440) —
 * NOT a raw `.update()` — so the `trip_compliance.documents.verify` grant is
 * enforced server-side, not just hidden in the UI. The RPC also writes the
 * `document_audit_log` row atomically with the status change.
 */
export async function setTripDocumentVerification(params: {
  document: Pick<ComplianceDocumentRow, "id" | "status">;
  organizationId: string;
  actorId: string;
  status: Extract<ComplianceDocumentStatus, "verified" | "rejected">;
  rejectionReason?: string | null;
}): Promise<{ error: Error | null }> {
  const { document, status, rejectionReason } = params;
  if (status === "rejected" && !rejectionReason?.trim()) {
    return { error: new Error("A rejection reason is required.") };
  }
  const { error } = await supabase().rpc("verify_trip_document", {
    p_document_id: document.id,
    p_status: status,
    p_rejection_reason: status === "rejected" ? rejectionReason!.trim() : null,
  });
  return { error: error ? new Error(error.message) : null };
}

/**
 * Mark a trip's compliance fully verified. Goes through
 * `mark_trip_compliance_verified`, which re-derives the required-documents
 * gate server-side (never trusts the client's own check) and enforces
 * `trip_compliance.trip.mark_verified`. Required types are LR, invoice, and
 * e-way bill — the same set as REQUIRED_COMPLIANCE_DOCUMENT_TYPES.
 */
export async function markTripComplianceVerified(params: {
  tripId: string;
  actorId: string;
}): Promise<{ error: Error | null }> {
  const { error } = await supabase().rpc("mark_trip_compliance_verified", {
    p_trip_id: params.tripId,
  });
  return { error: error ? new Error(error.message) : null };
}

/**
 * Approve a trip's compliance despite outstanding required documents. Goes
 * through `approve_trip_compliance_with_exception`, which re-derives the
 * missing/pending/rejected snapshot server-side, enforces the same
 * `trip_compliance.trip.mark_verified` grant as normal approval, requires a
 * non-empty comment, and is safe under retry (idempotent on
 * `trip_workflow_events`). Does not post any payment or touch the Finance
 * ledger — it only makes the trip eligible for the existing advance flow,
 * exactly like `markTripComplianceVerified` does.
 */
export async function approveComplianceWithException(params: {
  tripId: string;
  comment: string;
}): Promise<{ error: Error | null }> {
  if (!params.comment.trim()) {
    return { error: new Error("A comment is required to approve compliance with an exception.") };
  }
  const { error } = await supabase().rpc("approve_trip_compliance_with_exception", {
    p_trip_id: params.tripId,
    p_comment: params.comment.trim(),
  });
  return { error: error ? new Error(error.message) : null };
}

function formatDeclineComplianceError(error: { message?: string; code?: string }): string {
  const raw = (error.message ?? "").trim();
  const lower = raw.toLowerCase();
  if (
    error.code === "PGRST202" ||
    error.code === "42883" ||
    lower.includes("could not find the function") ||
    (lower.includes("decline_trip_compliance") && lower.includes("does not exist"))
  ) {
    return "Decline isn't available yet — database update pending.";
  }
  if (lower.includes("not authorized")) {
    return "You don't have permission to decline compliance for this trip.";
  }
  if (lower.includes("already verified")) {
    return "This trip is already verified and can't be declined.";
  }
  if (lower.includes("decline reason")) {
    return `Please enter a reason between ${COMPLIANCE_DECLINE_REASON_MIN} and ${COMPLIANCE_DECLINE_REASON_MAX} characters.`;
  }
  return raw || "Couldn't decline compliance.";
}

/**
 * Decline a trip's compliance with a reason. Goes through the
 * `decline_trip_compliance` SECURITY DEFINER RPC (migration
 * 20270929162901), which enforces the `trip_compliance.trip.mark_verified`
 * grant, rejects already-verified trips, and audits to `trip_workflow_events`.
 * Pass `idempotencyKey` (stable per submit) so a retried submit is a no-op.
 * The trip stays in Compliance Pending. Throws a user-facing Error on failure.
 */
export async function declineTripCompliance(params: {
  tripId: string;
  reason: string;
  idempotencyKey?: string;
}): Promise<void> {
  const reason = params.reason.trim();
  const length = complianceDeclineReasonLength(reason);
  if (length < COMPLIANCE_DECLINE_REASON_MIN || length > COMPLIANCE_DECLINE_REASON_MAX) {
    throw new Error(
      `Please enter a reason between ${COMPLIANCE_DECLINE_REASON_MIN} and ${COMPLIANCE_DECLINE_REASON_MAX} characters.`,
    );
  }
  const { error } = await supabase().rpc("decline_trip_compliance", {
    p_trip_id: params.tripId,
    p_reason: reason,
    p_idempotency_key: params.idempotencyKey ?? undefined,
  });
  if (error) {
    throw new Error(formatDeclineComplianceError(error));
  }
}

function formatRejectComplianceError(error: { message?: string; code?: string } | null): string {
  const raw = (error?.message ?? "").trim();
  const lower = raw.toLowerCase();
  if (
    error?.code === "PGRST202" ||
    error?.code === "42883" ||
    lower.includes("could not find the function") ||
    lower.includes("function does not exist")
  ) {
    return "Reject isn't available yet — database update pending.";
  }
  if (lower.includes("not authorized to reject")) {
    return "You don't have permission to reject compliance for this trip.";
  }
  if (lower.includes("not verified") || lower.includes("use decline instead")) {
    return "This trip isn't verified yet. Use Decline instead.";
  }
  if (lower.includes("reject reason between") || lower.includes("decline reason between")) {
    return `Please enter a reason between ${COMPLIANCE_DECLINE_REASON_MIN} and ${COMPLIANCE_DECLINE_REASON_MAX} characters.`;
  }
  if (lower.includes("compliance decline fields can only be changed")) {
    return raw;
  }
  return raw || "Couldn't reject compliance.";
}

/**
 * Reject a *verified* Compliance trip with a remark. Keeps
 * `compliance_verified_at` so the trip stays under Verified with a red
 * Rejected visual. Writes via `reject_trip_compliance` (migration
 * 20270930124500).
 */
export async function rejectTripCompliance(params: {
  tripId: string;
  reason: string;
  idempotencyKey?: string;
}): Promise<void> {
  const reason = params.reason.trim();
  const length = complianceDeclineReasonLength(reason);
  if (length < COMPLIANCE_DECLINE_REASON_MIN || length > COMPLIANCE_DECLINE_REASON_MAX) {
    throw new Error(
      `Please enter a reason between ${COMPLIANCE_DECLINE_REASON_MIN} and ${COMPLIANCE_DECLINE_REASON_MAX} characters.`,
    );
  }
  const { error } = await supabase().rpc("reject_trip_compliance", {
    p_trip_id: params.tripId,
    p_reason: reason,
    p_idempotency_key: params.idempotencyKey ?? undefined,
  });
  if (error) {
    throw new Error(formatRejectComplianceError(error));
  }
}

export type { ComplianceLedgerCategory } from "@/features/tripCompliance/utils/compliancePaymentGuard.util";
export { evaluateCompliancePaymentGuard } from "@/features/tripCompliance/utils/compliancePaymentGuard.util";

export async function checkCompliancePaymentAllowed(params: {
  tripId: string;
  category: ComplianceLedgerCategory;
}): Promise<{ ok: boolean; reason?: string }> {
  const byTrip = await fetchComplianceTransactions([params.tripId]);
  const bucket = byTrip.get(params.tripId) ?? { advance: [], balance: [] };
  return evaluateCompliancePaymentGuard(params.category, bucket);
}

/**
 * The only "expected amount" concept this schema actually has is the trip's
 * total `client_price` — there is no advance/balance split ratio anywhere to
 * validate against, so this is a sanity ceiling (catches a stray extra
 * digit), not a new precise business rule. Skipped when client_price isn't
 * set (0/null), matching how the rest of Compliance treats an unset price.
 */
export function validateCompliancePaymentAmount(params: {
  amount: number;
  trip: Pick<TripRow, "client_price">;
}): { ok: boolean; reason?: string } {
  const clientPrice = Number(params.trip.client_price ?? 0);
  if (clientPrice <= 0) return { ok: true };
  if (params.amount > clientPrice) {
    return {
      ok: false,
      reason: `Amount ₹${params.amount.toLocaleString("en-IN")} exceeds the trip value ₹${clientPrice.toLocaleString("en-IN")}.`,
    };
  }
  return { ok: true };
}

/**
 * `transactions.payment_reference` (migration 20260921105432) is the
 * authoritative "already processed" signal at the DB level — a unique index
 * on (trip_id, ledger_category) for compliance rows means a concurrent or
 * retried post fails with 23505, not a generic error. Not yet applied to any
 * live database (production is frozen) — this only changes how a 23505 is
 * *worded* if/when it occurs; it doesn't fabricate protection that isn't
 * really there in the DB.
 */
function isDuplicateComplianceLedgerWrite(error: Error): boolean {
  return (error as Error & { code?: string }).code === "23505";
}

/**
 * Migration 20260921125437 (Phase 6) is the real server-side boundary: two
 * RESTRICTIVE RLS policies on `transactions` reject a compliance_advance
 * insert/update unless `trips.compliance_verified_at IS NOT NULL`, and a
 * compliance_balance one unless `trips.pod_received_at IS NOT NULL` — closing
 * the P0 Phase 5 found (compliance/POD prerequisites were UI-only). A
 * rejected write surfaces as Postgres 42501 (insufficient_privilege).
 */
function isComplianceLedgerPrerequisiteRejection(error: Error): boolean {
  return (error as Error & { code?: string }).code === "42501";
}

/**
 * Client-side mirror of the RLS prerequisite (fail fast with a specific
 * message instead of a generic RLS error) — NOT the security boundary
 * itself, which is migration 20260921125437. Exception approval counts as
 * approved: compliance_verified_at is set by both mark_trip_compliance_verified()
 * and approve_trip_compliance_with_exception(), so checking it alone (not
 * compliance_decision) already means "approved OR approved_with_exception".
 */
function checkComplianceLedgerPrerequisite(
  category: ComplianceLedgerCategory,
  trip: Pick<TripRow, "compliance_verified_at" | "pod_received_at">,
): { ok: boolean; reason?: string } {
  if (category === "compliance_advance" && !trip.compliance_verified_at) {
    return { ok: false, reason: "Compliance must be approved before an advance payment can be posted." };
  }
  if (category === "compliance_balance" && !trip.pod_received_at) {
    return { ok: false, reason: "Hard-copy POD must be received before a balance payment can be posted." };
  }
  return { ok: true };
}

type ComplianceLedgerFlags = Pick<TripRow, "compliance_verified_at" | "pod_received_at">;

/**
 * Callers pass a cached trip (list summary, bulk validation map) that can be
 * minutes old, so the prerequisite reads the live flags. A failed read falls
 * back to the cached trip; RLS still rejects the insert either way.
 */
async function readComplianceLedgerFlags(trip: TripRow): Promise<ComplianceLedgerFlags> {
  const { data, error } = await supabase()
    .from("trips")
    .select("compliance_verified_at, pod_received_at")
    .eq("id", trip.id)
    .maybeSingle();
  if (error || !data) return trip;
  return data as ComplianceLedgerFlags;
}

/**
 * Post a compliance advance/balance payment through the canonical Finance
 * ledger write path (`createLedgerEntry` → `transactions`). Customer Cash IN
 * always; when the trip has a supplier, also post supplier Cash OUT
 * (`compliance_supplier_*`) so partner Finance · Statement shows the payment.
 * Prefers atomic RPC `post_compliance_settlement_pair` (migration
 * 20261007130944); falls back to two `createLedgerEntry` calls (heal on retry).
 */
export async function postCompliancePayment(params: {
  organizationId: string;
  trip: TripRow;
  category: ComplianceLedgerCategory;
  amount: number;
  paymentModeId: string;
  paymentModeLabel: string;
  utr?: string | null;
  transactionDate?: string;
  notes?: string | null;
}): Promise<{ error: Error | null }> {
  const guard = await checkCompliancePaymentAllowed({ tripId: params.trip.id, category: params.category });
  if (!guard.ok) return { error: new Error(guard.reason) };

  const prerequisite = checkComplianceLedgerPrerequisite(params.category, await readComplianceLedgerFlags(params.trip));
  if (!prerequisite.ok) return { error: new Error(prerequisite.reason) };

  const amountCheck = validateCompliancePaymentAmount({ amount: params.amount, trip: params.trip });
  if (!amountCheck.ok) return { error: new Error(amountCheck.reason) };

  const description = buildLedgerSyncDescriptionLine({
    categoryOrKind: params.category === "compliance_advance" ? "Compliance Advance" : "Compliance Balance",
    paymentModeLabel: params.paymentModeLabel,
    paymentModeId: params.paymentModeId,
    paymentReference: params.utr,
    notes: params.notes,
  });

  const rpc = await tryPostComplianceSettlementPairRpc({
    organizationId: params.organizationId,
    trip: params.trip,
    category: params.category,
    amount: params.amount,
    description,
    transactionDate: params.transactionDate,
    utr: params.utr,
  });
  if (rpc.ok) {
    if (rpc.alreadyPosted) {
      return {
        error: new Error(
          `This ${params.category === "compliance_advance" ? "advance" : "balance"} payment has already been posted for this trip. Refresh to see the existing entry.`,
        ),
      };
    }
    if (params.category === "compliance_advance") {
      await recordAdvanceDocCostSafe(params);
    }
    return { error: null };
  }
  if (rpc.reason === "error") return { error: rpc.error };

  // RPC missing (migration not applied yet) — dual createLedgerEntry + heal.
  const entry: CreateLedgerEntryData = {
    trip_id: params.trip.id,
    trip_number: params.trip.booking_ref ?? null,
    party_name: params.trip.client_name || "Client",
    description,
    amount_in: params.amount,
    amount_out: 0,
    transaction_date: params.transactionDate,
    contact_id: params.trip.client_id,
    contact_type: params.trip.client_id ? "client" : null,
    ledger_category: params.category,
    ledger_entity_type: "client",
    ledger_flow_type: "receivable",
    payment_reference: params.utr?.trim() || null,
  };

  const { error } = await createLedgerEntry(params.organizationId, entry);
  let clientAlreadyPosted = false;
  if (error && isDuplicateComplianceLedgerWrite(error)) {
    clientAlreadyPosted = true;
  } else if (error && isComplianceLedgerPrerequisiteRejection(error)) {
    return {
      error: new Error(
        params.category === "compliance_advance"
          ? "Compliance must be approved before an advance payment can be posted. Refresh and try again."
          : "Hard-copy POD must be received before a balance payment can be posted. Refresh and try again.",
      ),
    };
  } else if (error) {
    return { error };
  }

  const mirror = await ensureComplianceSupplierMirrorPayment({
    organizationId: params.organizationId,
    trip: params.trip,
    category: params.category,
    amount: params.amount,
    description,
    transactionDate: params.transactionDate,
    utr: params.utr,
  });
  if (mirror.error) return { error: mirror.error };

  if (clientAlreadyPosted && !mirror.created) {
    return {
      error: new Error(
        `This ${params.category === "compliance_advance" ? "advance" : "balance"} payment has already been posted for this trip. Refresh to see the existing entry.`,
      ),
    };
  }

  if (!clientAlreadyPosted && params.category === "compliance_advance") {
    await recordAdvanceDocCostSafe(params);
  }
  return { error: null };
}

async function recordAdvanceDocCostSafe(params: {
  organizationId: string;
  trip: TripRow;
}): Promise<void> {
  try {
    await recordAdvanceDocumentCostSnapshot(params.trip.id, {
      organizationId: params.trip.organization_id || params.organizationId,
      supplierRate: params.trip.supplier_rate,
      supplierRateBasis:
        (params.trip as { supplier_rate_basis?: string | null }).supplier_rate_basis ?? null,
      loadTons: params.trip.load_tons ?? null,
    });
  } catch {
    // The ledger row is already posted. POD validation still resolves the slab.
  }
}

type SettlementPairRpcResult =
  | { ok: true; alreadyPosted: boolean }
  | { ok: false; reason: "missing" }
  | { ok: false; reason: "error"; error: Error };

/**
 * Atomic client+supplier post (migration 20261007130944). Returns `missing`
 * when the RPC is not on the linked DB yet so callers can fall back.
 */
async function tryPostComplianceSettlementPairRpc(params: {
  organizationId: string;
  trip: TripRow;
  category: ComplianceLedgerCategory;
  amount: number;
  description: string;
  transactionDate?: string;
  utr?: string | null;
}): Promise<SettlementPairRpcResult> {
  const supplierId = (params.trip.supplier_id ?? "").trim() || null;
  const { data, error } = await supabase().rpc("post_compliance_settlement_pair", {
    p_organization_id: params.organizationId,
    p_trip_id: params.trip.id,
    p_client_category: params.category,
    p_amount: params.amount,
    p_description: params.description,
    p_transaction_date: params.transactionDate?.slice(0, 10) ?? null,
    p_payment_reference: params.utr?.trim() || null,
    p_client_contact_id: params.trip.client_id || null,
    p_client_party_name: params.trip.client_name || "Client",
    p_supplier_contact_id: supplierId,
    p_supplier_party_name: params.trip.supplier_name || "Supplier",
    p_created_by: null,
  });
  if (error) {
    const msg = error.message ?? "";
    const code = (error as { code?: string }).code;
    if (
      code === "PGRST202" ||
      code === "42883" ||
      /could not find the function|does not exist/i.test(msg)
    ) {
      return { ok: false, reason: "missing" };
    }
    if (code === "23505" || isDuplicateComplianceLedgerWrite(Object.assign(new Error(msg), { code }))) {
      return { ok: true, alreadyPosted: true };
    }
    if (code === "42501" || isComplianceLedgerPrerequisiteRejection(Object.assign(new Error(msg), { code }))) {
      return {
        ok: false,
        reason: "error",
        error: new Error(
          params.category === "compliance_advance"
            ? "Compliance must be approved before an advance payment can be posted. Refresh and try again."
            : "Hard-copy POD must be received before a balance payment can be posted. Refresh and try again.",
        ),
      };
    }
    return { ok: false, reason: "error", error: new Error(msg) };
  }
  const payload = data as { already_posted?: boolean } | null;
  return { ok: true, alreadyPosted: payload?.already_posted === true };
}

/**
 * When the trip has a supplier, post (or no-op if present) the AP Cash OUT
 * mirror. Used when the atomic RPC is not available yet.
 */
async function ensureComplianceSupplierMirrorPayment(params: {
  organizationId: string;
  trip: TripRow;
  category: ComplianceLedgerCategory;
  amount: number;
  description: string;
  transactionDate?: string;
  utr?: string | null;
}): Promise<{ error: Error | null; created: boolean }> {
  const supplierId = (params.trip.supplier_id ?? "").trim();
  if (!supplierId) return { error: null, created: false };

  const mirrorCategory = complianceSupplierLedgerCategory(params.category);
  const { data: existing, error: readError } = await supabase()
    .from("transactions")
    .select("id")
    .eq("trip_id", params.trip.id)
    .eq("ledger_category", mirrorCategory)
    .limit(1)
    .maybeSingle();
  if (readError) return { error: new Error(readError.message), created: false };
  if (existing?.id) return { error: null, created: false };

  const { error } = await createLedgerEntry(params.organizationId, {
    trip_id: params.trip.id,
    trip_number: params.trip.booking_ref ?? null,
    party_name: params.trip.supplier_name || "Supplier",
    description: params.description,
    amount_in: 0,
    amount_out: params.amount,
    transaction_date: params.transactionDate,
    contact_id: supplierId,
    contact_type: "supplier",
    ledger_category: mirrorCategory,
    ledger_entity_type: "supplier",
    ledger_flow_type: "payable",
    payment_reference: params.utr?.trim() || null,
  });
  if (error && isDuplicateComplianceLedgerWrite(error)) {
    return { error: null, created: false };
  }
  if (error) return { error, created: false };
  return { error: null, created: true };
}

async function findComplianceSupplierMirrorId(params: {
  tripId: string;
  category: ComplianceLedgerCategory;
}): Promise<string | null> {
  const mirrorCategory = complianceSupplierLedgerCategory(params.category);
  const { data } = await supabase()
    .from("transactions")
    .select("id")
    .eq("trip_id", params.tripId)
    .eq("ledger_category", mirrorCategory)
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

/** Keep supplier mirror description / date / UTR in sync with the client row. */
async function syncComplianceSupplierMirrorRow(params: {
  tripId: string;
  category: ComplianceLedgerCategory;
  payload: Record<string, unknown>;
  fallbackPayload?: Record<string, unknown>;
}): Promise<{ error: Error | null }> {
  const mirrorId = await findComplianceSupplierMirrorId({
    tripId: params.tripId,
    category: params.category,
  });
  if (!mirrorId) return { error: null };
  return writeCompliancePaymentRow(mirrorId, params.payload, params.fallbackPayload);
}

type CompliancePaymentRowTarget = {
  tripId: string;
  transactionId: string;
  /** `finance_receipt` = a client receipt posted in Finance (feeds `trips.amount_paid`). */
  category: ComplianceLedgerCategory | "finance_receipt";
};

/**
 * Reads the payment row and confirms it is this trip's advance / receipt. Not
 * org-filtered: receipts on a shared trip may belong to the partner org; the
 * trip match plus RLS decide what this user may edit.
 */
async function readCompliancePaymentRow(
  target: CompliancePaymentRowTarget,
): Promise<{ row: { description: string | null } | null; error: Error | null }> {
  const notFound = { row: null, error: new Error("Payment not found. Refresh and try again.") };
  if (target.transactionId.startsWith("amount-paid:")) return notFound;
  const { data: row, error } = await supabase()
    .from("transactions")
    .select("id, trip_id, description, ledger_category, amount_in")
    .eq("id", target.transactionId)
    .maybeSingle();
  if (error) return { row: null, error: new Error(error.message) };
  const isComplianceRow =
    row?.ledger_category === "compliance_advance" || row?.ledger_category === "compliance_balance";
  const matches =
    row != null &&
    row.trip_id === target.tripId &&
    (target.category === "finance_receipt"
      ? !isComplianceRow && Number(row.amount_in ?? 0) > 0
      : row.ledger_category === target.category);
  return matches ? { row, error: null } : notFound;
}

async function writeCompliancePaymentRow(
  transactionId: string,
  payload: Record<string, unknown>,
  fallbackPayload?: Record<string, unknown>,
): Promise<{ error: Error | null }> {
  const update = (body: Record<string, unknown>) =>
    supabase().from("transactions").update(body).eq("id", transactionId).select("id").maybeSingle();
  let { data, error } = await update(payload);
  if (error && fallbackPayload && /payment_reference/i.test(error.message)) {
    ({ data, error } = await update(fallbackPayload));
  }
  if (error) return { error: new Error(error.message) };
  if (!data) return { error: new Error("You don't have permission to edit this payment.") };
  return { error: null };
}

/** Edit only the transaction date (Paid at / Txn Date) of a posted payment. */
export async function updateCompliancePaymentTransactionDate(
  params: CompliancePaymentRowTarget & { transactionDate: string },
): Promise<{ error: Error | null }> {
  const normalized = normalizeComplianceTransactionDate(params.transactionDate);
  const invalid = validateComplianceTransactionDate(normalized);
  if (invalid) return { error: new Error(invalid) };
  const { row, error } = await readCompliancePaymentRow(params);
  if (!row) return { error };
  const description = withLedgerDescriptionTxnDateConfirmed(row.description);
  const payload = { transaction_date: normalized, description };
  const written = await writeCompliancePaymentRow(params.transactionId, payload);
  if (written.error) return written;
  if (params.category === "compliance_advance" || params.category === "compliance_balance") {
    return syncComplianceSupplierMirrorRow({
      tripId: params.tripId,
      category: params.category,
      payload,
    });
  }
  return { error: null };
}

/**
 * Edit only the UTR of a posted compliance payment. Amount, mode, date, party and
 * notes are left untouched, so the ledger's double entry does not change.
 * `updateLedgerEntry` is not used because it truncates `transaction_date` to a
 * day (moving "Paid at") and rebuilds the description without notes.
 */
export async function updateCompliancePaymentReference(
  params: CompliancePaymentRowTarget & { utr: string },
): Promise<{ error: Error | null }> {
  const invalid = validateComplianceUtr(params.utr);
  if (invalid) return { error: new Error(invalid) };
  const utr = normalizeComplianceUtr(params.utr);
  const { row, error } = await readCompliancePaymentRow(params);
  if (!row) return { error };
  const mode = interpretLedgerRowStructured({ description: row.description }).payment_mode;
  if (isCashPaymentMode(mode)) {
    return { error: new Error("Cash payments don't carry a UTR.") };
  }
  const description = withLedgerDescriptionUtr(row.description, utr);
  const payload = { description, payment_reference: utr };
  const written = await writeCompliancePaymentRow(params.transactionId, payload, { description });
  if (written.error) return written;
  if (params.category === "compliance_advance" || params.category === "compliance_balance") {
    return syncComplianceSupplierMirrorRow({
      tripId: params.tripId,
      category: params.category,
      payload,
      fallbackPayload: { description },
    });
  }
  return { error: null };
}

/** Edit only the Request ID of a posted compliance payment (stored on its description). */
export async function updateCompliancePaymentRequestId(
  params: CompliancePaymentRowTarget & { requestId: string },
): Promise<{ error: Error | null }> {
  const invalid = validateComplianceRequestId(params.requestId);
  if (invalid) return { error: new Error(invalid) };
  const requestId = normalizeComplianceRequestId(params.requestId);
  const { row, error } = await readCompliancePaymentRow(params);
  if (!row) return { error };
  const payload = {
    description: withLedgerDescriptionRequestId(row.description, requestId),
  };
  const written = await writeCompliancePaymentRow(params.transactionId, payload);
  if (written.error) return written;
  if (params.category === "compliance_advance" || params.category === "compliance_balance") {
    return syncComplianceSupplierMirrorRow({
      tripId: params.tripId,
      category: params.category,
      payload,
    });
  }
  return { error: null };
}

/**
 * Update an already-posted compliance payment's UTR (or amount/mode) through
 * the canonical `updateLedgerEntry()` — never a direct `transactions` write.
 * Rebuilds the description with the existing encoding convention so
 * `interpretLedgerRowStructured()` keeps reading it back correctly.
 */
export async function updateCompliancePaymentUtr(params: {
  organizationId: string;
  transactionId: string;
  trip: TripRow;
  category: ComplianceLedgerCategory;
  paymentModeId: string;
  paymentModeLabel: string;
  utr?: string | null;
  amount: number;
}): Promise<{ error: Error | null }> {
  const description = buildLedgerSyncDescriptionLine({
    categoryOrKind: params.category === "compliance_advance" ? "Compliance Advance" : "Compliance Balance",
    paymentModeLabel: params.paymentModeLabel,
    paymentModeId: params.paymentModeId,
    paymentReference: params.utr,
  });
  const { error } = await updateLedgerEntry(params.organizationId, params.transactionId, {
    trip_id: params.trip.id,
    party_name: params.trip.client_name || "Client",
    description,
    amount_in: params.amount,
    amount_out: 0,
    contact_id: params.trip.client_id,
    contact_type: params.trip.client_id ? "client" : null,
    ledger_category: params.category,
    ledger_entity_type: "client",
    ledger_flow_type: "receivable",
    payment_reference: params.utr?.trim() || null,
  });
  if (error) return { error };

  const supplierId = (params.trip.supplier_id ?? "").trim();
  if (!supplierId) return { error: null };

  const mirrorId = await findComplianceSupplierMirrorId({
    tripId: params.trip.id,
    category: params.category,
  });
  if (mirrorId) {
    return updateLedgerEntry(params.organizationId, mirrorId, {
      trip_id: params.trip.id,
      party_name: params.trip.supplier_name || "Supplier",
      description,
      amount_in: 0,
      amount_out: params.amount,
      contact_id: supplierId,
      contact_type: "supplier",
      ledger_category: complianceSupplierLedgerCategory(params.category),
      ledger_entity_type: "supplier",
      ledger_flow_type: "payable",
      payment_reference: params.utr?.trim() || null,
    });
  }

  return ensureComplianceSupplierMirrorPayment({
    organizationId: params.organizationId,
    trip: params.trip,
    category: params.category,
    amount: params.amount,
    description,
    utr: params.utr,
  }).then(({ error: mirrorError }) => ({ error: mirrorError }));
}
