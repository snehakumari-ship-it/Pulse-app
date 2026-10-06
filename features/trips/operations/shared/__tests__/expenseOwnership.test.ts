import type { TripCostEvent } from "@/features/finance";
import { isEmployerFinanceRow } from "@/features/finance/projections/employerExpenseRows";
import {
  isDriverVisibleCostEvent,
  isSelfRecordedCostEvent,
} from "../driverReimbursementEvents.util";
import { isAwaitingEmployerReview, isEmployerExpenseOf } from "../expenseEntryEdit.util";

function costEvent(overrides: Partial<TripCostEvent>): TripCostEvent {
  return { incurredBy: "driver", reimbursable: false, ...overrides } as TripCostEvent;
}

describe("isEmployerExpenseOf", () => {
  it("accepts only employer rows of the given organization", () => {
    expect(isEmployerExpenseOf({ expense_context: "employer", employer_org_id: "o1" }, "o1")).toBe(true);
    expect(isEmployerExpenseOf({ expense_context: "employer", employer_org_id: "o2" }, "o1")).toBe(false);
    expect(isEmployerExpenseOf({ expense_context: "dco", employer_org_id: null }, "o1")).toBe(false);
    expect(isEmployerExpenseOf({ expense_context: "personal", employer_org_id: null }, null)).toBe(false);
  });

  it("without an organization, accepts any employer row", () => {
    expect(isEmployerExpenseOf({ expense_context: "employer", employer_org_id: "o2" }, null)).toBe(true);
  });

  it("rejects rows without a context", () => {
    expect(isEmployerExpenseOf({}, "o1")).toBe(false);
    expect(isEmployerExpenseOf(null, "o1")).toBe(false);
  });
});

describe("isAwaitingEmployerReview", () => {
  it("is true only for pending employer rows", () => {
    expect(isAwaitingEmployerReview({ expense_context: "employer", expense_status: "pending_approval" })).toBe(true);
    expect(isAwaitingEmployerReview({ expense_context: "employer", expense_status: "approved" })).toBe(false);
    expect(isAwaitingEmployerReview({ expense_context: "dco", expense_status: "personal" })).toBe(false);
  });
});

describe("isEmployerFinanceRow", () => {
  it("keeps employer rows and context-less legacy rows, drops DCO, personal and voided", () => {
    expect(isEmployerFinanceRow({ expense_context: "employer" })).toBe(true);
    expect(isEmployerFinanceRow({})).toBe(true);
    expect(isEmployerFinanceRow({ expense_context: "dco" })).toBe(false);
    expect(isEmployerFinanceRow({ expense_context: "personal" })).toBe(false);
    expect(isEmployerFinanceRow({ expense_context: "employer", status: "voided" })).toBe(false);
  });
});

describe("driver-visible cost events", () => {
  it("shows self-recorded rows and the driver's reimbursements, not fleet-paid rows", () => {
    const dco = costEvent({ expenseContext: "dco" });
    const personal = costEvent({ expenseContext: "personal" });
    const claim = costEvent({ expenseContext: "employer", reimbursable: true });
    const fleetPaid = costEvent({ expenseContext: "employer", incurredBy: "organization", reimbursable: false });
    expect(isSelfRecordedCostEvent(dco)).toBe(true);
    expect(isSelfRecordedCostEvent(personal)).toBe(true);
    expect(isSelfRecordedCostEvent(claim)).toBe(false);
    expect([dco, personal, claim, fleetPaid].filter(isDriverVisibleCostEvent)).toEqual([dco, personal, claim]);
  });
});
