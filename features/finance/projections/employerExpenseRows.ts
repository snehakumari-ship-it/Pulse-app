import type { TripExpenseOwnership } from "@/features/trips/operations/types";

/**
 * Active employer expenses. DCO and personal rows never belong to an
 * employer's Finance; rows read before 20271007190418 carry no context and
 * were always employer rows.
 */
export function isEmployerFinanceRow(
  row: TripExpenseOwnership & { status?: string | null },
): boolean {
  if (String(row.status ?? "active").toLowerCase() === "voided") return false;
  return (row.expense_context ?? "employer") === "employer";
}
