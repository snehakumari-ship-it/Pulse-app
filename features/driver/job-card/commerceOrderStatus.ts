import type { DriverTripStopOrder } from '@/features/driver/commerce-mission/driverTripStopOrders.types';

export type CommerceOrderStatusTone = 'awaiting' | 'active' | 'done';

export type CommerceOrderStatus = {
  label: string;
  tone: CommerceOrderStatusTone;
};

/**
 * Status Primitive A already returns after driver stop actions.
 * Drop completion counts move when the driver finishes a drop — this does not
 * invent a sales-order status.
 */
export function commerceOrderStatus(
  order: Pick<DriverTripStopOrder, 'orderDistinctDropStopCount' | 'orderCompletedDropStopCount'>,
): CommerceOrderStatus {
  const total = Math.max(0, Number(order.orderDistinctDropStopCount) || 0);
  const done = Math.max(0, Number(order.orderCompletedDropStopCount) || 0);
  if (total > 0 && done >= total) return { label: 'Delivered', tone: 'done' };
  if (done > 0) {
    return {
      label: total > 0 ? `${done} of ${total} delivered` : 'In progress',
      tone: 'active',
    };
  }
  return { label: 'Awaiting', tone: 'awaiting' };
}
