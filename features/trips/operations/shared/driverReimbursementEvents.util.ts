import type { TripCostEvent } from "@/features/finance";

export function isDriverReimbursementCostEvent(event: TripCostEvent): boolean {
  return event.incurredBy === "driver" && event.reimbursable;
}

/** DCO trip costs and no-employer notes: the driver's own record, never reviewed. */
export function isSelfRecordedCostEvent(event: TripCostEvent): boolean {
  return event.expenseContext === "dco" || event.expenseContext === "personal";
}

export function isDriverVisibleCostEvent(event: TripCostEvent): boolean {
  return isSelfRecordedCostEvent(event) || isDriverReimbursementCostEvent(event);
}

export function isDriverSubmittedOperationalExpense(row: {
  payment_owner?: string | null;
  approval_state?: string | null;
  reimbursement_state?: string | null;
}): boolean {
  if (String(row.payment_owner ?? "").toLowerCase() === "driver") return true;
  const approval = String(row.approval_state ?? "").toLowerCase();
  const reimbursement = String(row.reimbursement_state ?? "").toLowerCase();
  return approval === "reported" && reimbursement === "reported";
}
