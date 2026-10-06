export type TripCostCategory =
  | "fuel"
  | "toll"
  | "parking"
  | "mileage"
  | "loading"
  | "unloading"
  | "detention"
  | "maintenance"
  | "fastag"
  | "advance"
  | "penalty"
  | "misc";

export type TripCostApprovalState = "pending" | "approved" | "rejected";

export type TripCostPostingState = "unposted" | "posted" | "failed" | "reversed";

export type TripCostSettlementState = "unpaid" | "partial" | "settled";

export type TripCostActor = "driver" | "organization" | "vendor";

export type TripCostSource = "driver_upload" | "ops_entry" | "system" | "integration";

export interface TripCostEvent {
  id: string;
  tripId: string;
  operationalCode: string;
  category: TripCostCategory;
  amount: number;
  currency: string;
  incurredBy: TripCostActor;
  payer: TripCostActor;
  reimbursable: boolean;
  approvalState: TripCostApprovalState;
  postingState: TripCostPostingState;
  settlementState: TripCostSettlementState;
  approvedAt?: string;
  approvedBy?: string;
  /** Set when ops marks driver reimbursement settled (`reimbursement_state = reimbursed`). */
  reimbursedAt?: string;
  ledgerTransactionId?: string;
  pnlImpact: boolean;
  /**
   * Server-fixed owner of the expense. `dco` and `personal` are never
   * reviewed, reimbursed or posted to an employer.
   */
  expenseContext?: "employer" | "dco" | "personal";
  rejectionReason?: string;
  source: TripCostSource;
  createdAt: string;
  updatedAt: string;
}

export interface TripCostFinancialSnapshot {
  totalEvents: number;
  approvalPendingCount: number;
  approvedAwaitingPostingCount: number;
  postedCount: number;
  settlementPendingCount: number;
  settledCount: number;
  payableOutstandingInr: number;
  postedOperationalCostInr: number;
  approvedOperationalCostInr: number;
  costPerKm: number | null;
}
