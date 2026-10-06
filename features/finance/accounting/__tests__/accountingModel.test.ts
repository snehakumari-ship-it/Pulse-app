import {
  getDoubleEntryFromLedgerRow,
  getDoubleEntryDisplayLabel,
  getDoubleEntryForNewEntry,
} from '../accountingModel';

describe('getDoubleEntryFromLedgerRow', () => {
  it('maps a customer payment (cash in, client) to Dr Cash / Cr AR', () => {
    const result = getDoubleEntryFromLedgerRow({
      amount_in: 500,
      amount_out: 0,
      contact_type: 'client',
    });
    expect(result).toEqual({
      debitAccount: 'CASH_BANK',
      creditAccount: 'AR',
      transactionType: 'customer_payment',
      amount: 500,
    });
  });

  it('maps a supplier payment (cash out, supplier) to Dr AP / Cr Cash', () => {
    const result = getDoubleEntryFromLedgerRow({
      amount_in: 0,
      amount_out: 300,
      contact_type: 'supplier',
    });
    expect(result).toEqual({
      debitAccount: 'AP',
      creditAccount: 'CASH_BANK',
      transactionType: 'supplier_payment',
      amount: 300,
    });
  });

  it('maps a driver payment (cash out, driver) to Dr Driver Payable / Cr Cash', () => {
    const result = getDoubleEntryFromLedgerRow({
      amount_in: 0,
      amount_out: 200,
      contact_type: 'driver',
    });
    expect(result?.debitAccount).toBe('DRIVER_PAYABLE');
    expect(result?.transactionType).toBe('driver_payment');
  });

  it('classifies a vehicle expense by description keyword when no contact', () => {
    const result = getDoubleEntryFromLedgerRow({
      amount_in: 0,
      amount_out: 150,
      description: 'FUEL',
    });
    expect(result?.transactionType).toBe('vehicle_expense');
    expect(result?.debitAccount).toBe('VEHICLE_EXPENSE');
  });

  it('classifies a vehicle expense by party_name keyword when no contact/description', () => {
    const result = getDoubleEntryFromLedgerRow({
      amount_in: 0,
      amount_out: 90,
      party_name: 'Toll booth NH8',
    });
    expect(result?.transactionType).toBe('vehicle_expense');
  });

  it('falls back to other_out for unclassified cash-out with no contact/keywords', () => {
    const result = getDoubleEntryFromLedgerRow({
      amount_in: 0,
      amount_out: 75,
      party_name: 'Misc party',
    });
    expect(result?.transactionType).toBe('other_out');
  });

  it('returns null when there is no cash movement', () => {
    expect(getDoubleEntryFromLedgerRow({ amount_in: 0, amount_out: 0 })).toBeNull();
  });
});

describe('getDoubleEntryDisplayLabel', () => {
  it('returns the friendly label for a known transaction type', () => {
    expect(
      getDoubleEntryDisplayLabel({ amount_in: 100, amount_out: 0, contact_type: 'client' }),
    ).toBe('Customer payment');
  });

  it('returns null when the row has no double-entry interpretation', () => {
    expect(getDoubleEntryDisplayLabel({ amount_in: 0, amount_out: 0 })).toBeNull();
  });
});

describe('getDoubleEntryForNewEntry', () => {
  it('returns null for a non-positive amount', () => {
    expect(
      getDoubleEntryForNewEntry({ type: 'in', amount: 0, contactType: 'client' }),
    ).toBeNull();
  });

  it('builds a customer_payment entry for type=in + client', () => {
    const result = getDoubleEntryForNewEntry({ type: 'in', amount: 100, contactType: 'client' });
    expect(result?.transactionType).toBe('customer_payment');
  });

  it('returns null for type=in without a client contact', () => {
    expect(getDoubleEntryForNewEntry({ type: 'in', amount: 100 })).toBeNull();
  });

  it('builds a supplier_payment entry for type=out + supplier', () => {
    const result = getDoubleEntryForNewEntry({ type: 'out', amount: 50, contactType: 'supplier' });
    expect(result?.transactionType).toBe('supplier_payment');
  });

  it('builds a vehicle_expense entry for type=out + known category (no contact)', () => {
    const result = getDoubleEntryForNewEntry({ type: 'out', amount: 20, category: 'FUEL' });
    expect(result?.transactionType).toBe('vehicle_expense');
  });

  it('builds a vehicle_expense entry for type=out + party_name keyword fallback', () => {
    const result = getDoubleEntryForNewEntry({ type: 'out', amount: 20, partyName: 'Maintenance charge' });
    expect(result?.transactionType).toBe('vehicle_expense');
  });

  it('returns null for type=out with no contact and no recognizable category/party', () => {
    expect(getDoubleEntryForNewEntry({ type: 'out', amount: 20, partyName: 'Random' })).toBeNull();
  });
});

describe('Pulse Exchange rows (posted on confirmation)', () => {
  it('shipper EXCHANGE_PAYMENT to the bidder\'s Marketplace account hits Cash as a supplier payment', () => {
    const result = getDoubleEntryFromLedgerRow({
      amount_in: 0,
      amount_out: 4000,
      contact_type: 'supplier',
      party_name: 'Ravi Movers',
      description: 'EXCHANGE PAYMENT | Mode: UPI | UTR: UTR77',
    });
    expect(result).toMatchObject({ debitAccount: 'AP', creditAccount: 'CASH_BANK', amount: 4000 });
  });

  it('bidder EXCHANGE_RECEIPT from the shipper\'s Marketplace account hits Cash as a customer payment', () => {
    const result = getDoubleEntryFromLedgerRow({
      amount_in: 4000,
      amount_out: 0,
      contact_type: 'client',
      party_name: 'Acme Shippers',
      description: 'EXCHANGE PAYMENT | Mode: UPI | UTR: UTR77',
    });
    expect(result).toMatchObject({ debitAccount: 'CASH_BANK', creditAccount: 'AR', amount: 4000 });
  });

  it('platform fee to Pulse Marketplace (fees) settles the fee payable from Cash', () => {
    const result = getDoubleEntryFromLedgerRow({
      amount_in: 0,
      amount_out: 250,
      contact_type: 'supplier',
      party_name: 'Pulse Marketplace (fees)',
      description: 'MARKETPLACE PLATFORM FEE | Mode: Online | UTR: pay_123',
    });
    expect(result).toMatchObject({ debitAccount: 'AP', creditAccount: 'CASH_BANK' });
  });
});
