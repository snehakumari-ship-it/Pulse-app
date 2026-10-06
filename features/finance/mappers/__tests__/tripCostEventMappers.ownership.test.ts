import {
  deriveTripCostFinancialSnapshot,
  mapFuelEntryToTripCostEvent,
} from '../tripCostEventMappers';
import type { TripFuelEntry } from '@/features/trips/operations/types';

function fuelRow(overrides: Partial<TripFuelEntry>): TripFuelEntry {
  return {
    id: 'fuel-1',
    trip_id: 'trip-1',
    amount_inr: 500,
    payment_owner: 'driver',
    entered_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as TripFuelEntry;
}

function event(overrides: Partial<TripFuelEntry>) {
  return mapFuelEntryToTripCostEvent({ row: fuelRow(overrides), tripOperationalCode: 'TRP001' });
}

describe('trip cost events: expense ownership', () => {
  it('a DCO expense is not a reimbursement but counts in trip economics', () => {
    const dco = event({ expense_context: 'dco', expense_status: 'personal', approval_state: 'reported' });
    expect(dco.expenseContext).toBe('dco');
    expect(dco.reimbursable).toBe(false);
    expect(dco.pnlImpact).toBe(true);
  });

  it('a personal expense is a reference only', () => {
    const personal = event({ expense_context: 'personal', expense_status: 'personal' });
    expect(personal.reimbursable).toBe(false);
    expect(personal.pnlImpact).toBe(false);
  });

  it('an employer expense is reimbursable and has P&L impact only once approved', () => {
    const pending = event({ expense_context: 'employer', employer_org_id: 'org-1', approval_state: 'reported' });
    const approved = event({ expense_context: 'employer', employer_org_id: 'org-1', approval_state: 'approved' });
    expect(pending.reimbursable).toBe(true);
    expect(pending.pnlImpact).toBe(false);
    expect(approved.pnlImpact).toBe(true);
  });

  it('carries the rejection reason', () => {
    const rejected = event({
      expense_context: 'employer',
      employer_org_id: 'org-1',
      approval_state: 'rejected',
      expense_status: 'rejected',
      rejection_reason: 'No receipt',
    });
    expect(rejected.rejectionReason).toBe('No receipt');
  });

  it('snapshot: DCO adds to operating cost, personal adds nothing, neither is pending or payable', () => {
    const snapshot = deriveTripCostFinancialSnapshot({
      events: [
        event({ id: 'a', amount_inr: 300, expense_context: 'dco', approval_state: 'reported' }),
        event({ id: 'b', amount_inr: 200, expense_context: 'personal', approval_state: 'reported' }),
        event({ id: 'c', amount_inr: 100, expense_context: 'employer', employer_org_id: 'o', approval_state: 'reported' }),
      ],
    });
    expect(snapshot.approvedOperationalCostInr).toBe(300);
    expect(snapshot.approvalPendingCount).toBe(1);
    expect(snapshot.payableOutstandingInr).toBe(0);
    expect(snapshot.postedCount).toBe(0);
  });
});
