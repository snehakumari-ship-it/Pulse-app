/**
 * Historical employer/fleet rows vs DCO Marketplace award stubs.
 * A DCO working with a business is a supplier relationship, not employee membership.
 */
jest.mock('@/lib/supabase', () => ({
  supabase: () => ({ from: jest.fn(), rpc: jest.fn() }),
}));

import {
  isFinanceLedgerDriver,
  isSalaryEligibleDriver,
} from '../drivers.service';

describe('isSalaryEligibleDriver', () => {
  it('a current employer driver can still bill that fleet', () => {
    expect(
      isSalaryEligibleDriver({
        organization_id: 'org-1',
        relationship_status: 'active_employee',
        relationship_origin: 'invite_accepted',
      }),
    ).toBe(true);
  });

  it('a historical disconnected employer is not restored as an employee billing authority', () => {
    expect(
      isSalaryEligibleDriver({
        organization_id: 'org-1',
        relationship_status: 'disconnected',
        relationship_origin: 'invite_accepted',
      }),
    ).toBe(false);
  });

  it('a DCO Marketplace award stub is never employee salary eligibility', () => {
    expect(
      isSalaryEligibleDriver({
        organization_id: 'org-1',
        relationship_status: 'independent',
        relationship_origin: 'market_award',
      }),
    ).toBe(false);
  });
});

describe('isFinanceLedgerDriver', () => {
  it('keeps a former employer visible on the finance ledger (history, not current authority)', () => {
    expect(
      isFinanceLedgerDriver({
        relationship_status: 'disconnected',
        left_at: '2026-09-01T00:00:00Z',
        tracking_only: false,
        status: 'inactive',
        relationship_origin: 'invite_accepted',
      }),
    ).toBe(true);
  });

  it('a DCO award stub settles as supplier/DCO, not a Finance → Drivers employee row', () => {
    expect(
      isFinanceLedgerDriver({
        relationship_status: 'independent',
        left_at: null,
        tracking_only: false,
        status: 'active',
        relationship_origin: 'market_award',
      }),
    ).toBe(false);
  });
});
