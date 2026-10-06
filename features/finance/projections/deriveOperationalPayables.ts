import type { TripFuelEntry, TripTollEntry } from "@/features/trips/operations/types";
import { isEmployerFinanceRow } from "./employerExpenseRows";

export interface OperationalPayablesProjection {
  driverReimbursementPayableInr: number;
  supplierOperationalPayableInr: number;
  unclassifiedOperationalPayableInr: number;
}

/** Payables owed by the employer: approved employer expenses only. */
export function deriveOperationalPayables(input: {
  fuelEntries: TripFuelEntry[];
  tollEntries: TripTollEntry[];
}): OperationalPayablesProjection {
  const rows = [...input.fuelEntries, ...input.tollEntries].filter(
    (row) => isEmployerFinanceRow(row) && row.expense_status !== "rejected",
  );
  let driverReimbursementPayableInr = 0;
  let supplierOperationalPayableInr = 0;
  let unclassifiedOperationalPayableInr = 0;
  for (const row of rows) {
    const amount = Math.max(0, Number(row.amount_inr ?? 0) || 0);
    const owner = String(row.payment_owner ?? "").toLowerCase();
    const reimbursement = String(row.reimbursement_state ?? "").toLowerCase();
    const approved = String(row.approval_state ?? "").toLowerCase();
    if (approved !== "approved" && approved !== "settled") continue;
    if (owner === "driver") {
      if (reimbursement === "approved" || reimbursement === "reimbursement_pending") {
        driverReimbursementPayableInr += amount;
      }
    } else if (owner === "supplier") {
      supplierOperationalPayableInr += amount;
    } else if (owner !== "organization" && owner !== "fleet_card") {
      unclassifiedOperationalPayableInr += amount;
    }
  }
  return {
    driverReimbursementPayableInr: Math.round(driverReimbursementPayableInr * 100) / 100,
    supplierOperationalPayableInr: Math.round(supplierOperationalPayableInr * 100) / 100,
    unclassifiedOperationalPayableInr: Math.round(unclassifiedOperationalPayableInr * 100) / 100,
  };
}
