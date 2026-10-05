import { formatMarketplaceTransactionError } from '../marketplaceErrorFormat.util';

describe('formatMarketplaceTransactionError DCO boundary', () => {
  it('does not show raw PostgreSQL text for DCO employment denial', () => {
    expect(
      formatMarketplaceTransactionError(
        'dco_not_employee_driver: DCOs cannot join a business as employee drivers. You can operate independently as a DCO.',
      ),
    ).toBe(
      'DCOs cannot join a business as employee drivers. You can operate independently as a DCO.',
    );
  });

  it('does not show raw PostgreSQL text for Marketplace access denial', () => {
    expect(
      formatMarketplaceTransactionError(
        'marketplace_access_denied: approved, independent DCO status with an active vehicle is required',
      ),
    ).toBe(
      'Marketplace bidding is for DCOs with an active vehicle. You can operate independently as a DCO.',
    );
  });
});
