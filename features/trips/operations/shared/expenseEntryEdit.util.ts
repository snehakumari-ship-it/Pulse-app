import type { TripCostEvent } from "@/features/finance";
import type { TripExpenseOwnership } from "../types";

export function canEditTripCostEvent(event: TripCostEvent): boolean {
  if (event.postingState === "posted") return false;
  if (event.settlementState === "settled") return false;
  return true;
}

/**
 * Only employer expenses of `organizationId` may be mirrored into that
 * organization's vehicle ledgers; the server refuses anything else.
 */
export function isEmployerExpenseOf(
  row: TripExpenseOwnership | null | undefined,
  organizationId: string | null | undefined,
): boolean {
  if (!row || row.expense_context !== "employer") return false;
  const org = String(organizationId ?? "").trim();
  return !org || row.employer_org_id === org;
}

export function isAwaitingEmployerReview(row: TripExpenseOwnership | null | undefined): boolean {
  return row?.expense_context === "employer" && row.expense_status === "pending_approval";
}
