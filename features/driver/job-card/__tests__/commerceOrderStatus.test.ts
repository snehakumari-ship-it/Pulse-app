import { commerceOrderStatus } from '@/features/driver/job-card/commerceOrderStatus';

describe('commerceOrderStatus', () => {
  it('stays awaiting until a driver drop is completed', () => {
    expect(
      commerceOrderStatus({ orderDistinctDropStopCount: 2, orderCompletedDropStopCount: 0 }),
    ).toEqual({ label: 'Awaiting', tone: 'awaiting' });
  });

  it('shows partial delivery from commerce drop counts', () => {
    expect(
      commerceOrderStatus({ orderDistinctDropStopCount: 3, orderCompletedDropStopCount: 1 }),
    ).toEqual({ label: '1 of 3 delivered', tone: 'active' });
  });

  it('shows delivered when every commerce drop is done', () => {
    expect(
      commerceOrderStatus({ orderDistinctDropStopCount: 2, orderCompletedDropStopCount: 2 }),
    ).toEqual({ label: 'Delivered', tone: 'done' });
  });
});
