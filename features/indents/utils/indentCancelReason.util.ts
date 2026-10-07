/**
 * Why an indent left the open pool. Stored on `indents.cancel_reason`.
 * "Indent expired" is recorded as status `expired`; the other three as `cancelled`.
 */
export const INDENT_CANCEL_REASONS = [
  { id: "cancelled_by_client", label: "Cancelled by client" },
  { id: "indent_expired", label: "Indent expired" },
  { id: "no_rates_available", label: "No rates available" },
  { id: "wrong_entry", label: "Wrong entry" },
] as const;

export type IndentCancelReasonId = (typeof INDENT_CANCEL_REASONS)[number]["id"];

const REASON_IDS = new Set<string>(INDENT_CANCEL_REASONS.map((reason) => reason.id));

export function indentCancelReasonId(raw: unknown): IndentCancelReasonId | null {
  const value = String(raw ?? "").trim();
  return REASON_IDS.has(value) ? (value as IndentCancelReasonId) : null;
}

export function indentCancelReasonLabel(raw: unknown): string | null {
  const id = indentCancelReasonId(raw);
  if (!id) return null;
  return INDENT_CANCEL_REASONS.find((reason) => reason.id === id)?.label ?? null;
}

/** Cancelled or expired indents. Completed and closed stays out of Failed. */
export function isIndentFailedStatus(status: string | null | undefined): boolean {
  const value = String(status ?? "").trim().toLowerCase();
  return value === "cancelled" || value === "expired";
}

export function indentStatusForCancelReason(
  reason: IndentCancelReasonId,
): "cancelled" | "expired" {
  return reason === "indent_expired" ? "expired" : "cancelled";
}
