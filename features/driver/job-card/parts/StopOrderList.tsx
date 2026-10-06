import { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { getDriverThemeColors } from '@/contexts/DriverThemeContext';
import type { DriverTripStopOrder } from '@/features/driver/commerce-mission/driverTripStopOrders.types';
import { commerceOrderStatus } from '@/features/driver/job-card/commerceOrderStatus';
import { commerceProductImageUrl } from '@/features/driver/job-card/commerceProductImageUrl';
import { OrderStatusIcon } from '@/features/driver/job-card/parts/OrderStatusIcon';
import { cardBackground, JOB_CARD_RADIUS, softElevation } from '@/features/driver/job-card/parts/jobCardSurface';
import { Package } from 'lucide-react-native';
import {
  expectedQtyLabel,
  itemRowLabel,
  orderExpectedQty,
  qtyLabel,
  stopVerificationTotals,
} from '@/features/driver/job-card/stopVerificationSummary';

type Colors = ReturnType<typeof getDriverThemeColors>;

type Props = {
  colors: Colors;
  orders: readonly DriverTripStopOrder[];
  delivery: boolean;
};

function LineThumb({
  colors,
  imagePath,
  label,
}: {
  colors: Colors;
  imagePath: string | null | undefined;
  label: string;
}) {
  const uri = commerceProductImageUrl(imagePath);
  const [failed, setFailed] = useState(false);
  if (!uri || failed) {
    return (
      <View
        style={[styles.thumb, styles.thumbEmpty, { backgroundColor: colors.surfaceElevated }]}
        accessibilityLabel={`${label} image unavailable`}
      >
        <Package size={20} color={colors.textMuted} strokeWidth={1.8} />
      </View>
    );
  }
  return (
    <Image
      testID="stop-verification-item-image"
      source={{ uri }}
      style={styles.thumb}
      accessibilityLabel={`${label} image`}
      onError={() => setFailed(true)}
    />
  );
}

export function StopOrderList({ colors, orders, delivery }: Props) {
  return (
    <View
      style={[styles.wrap, softElevation, { backgroundColor: cardBackground(colors) }]}
      testID="stop-verification-orders"
    >
      <View style={styles.sectionRow}>
        <Text style={[styles.section, { color: colors.text }]}>
          {delivery ? 'Order detail' : 'Pickup detail'}
        </Text>
        <Text style={[styles.totals, { color: colors.textMuted }]}>
          {expectedQtyLabel(stopVerificationTotals(orders))}
        </Text>
      </View>

      {orders.map((order, orderIndex) => {
        const qty = orderExpectedQty(order);
        return (
          <View
            key={order.salesOrderId}
            style={[
              styles.orderCard,
              orderIndex > 0 ? [styles.orderDivided, { borderTopColor: colors.border }] : null,
            ]}
          >
            <View style={styles.orderHead}>
              <OrderStatusIcon
                colors={colors}
                order={order}
                orderLabel={order.orderNumber ?? order.salesOrderId}
              />
              <View style={styles.orderTitle}>
                <Text style={[styles.orderNo, { color: colors.text }]} numberOfLines={1}>
                  {order.orderNumber ?? order.salesOrderId}
                </Text>
                <Text style={[styles.status, { color: colors.textMuted }]} numberOfLines={1}>
                  {commerceOrderStatus(order).label}
                </Text>
              </View>
              <Text style={[styles.orderMeta, { color: colors.textMuted }]}>
                {qty != null
                  ? `${qty} ${qty === 1 ? 'item' : 'items'}`
                  : `${order.lines?.length ?? 0} ${(order.lines?.length ?? 0) === 1 ? 'line' : 'lines'}`}
              </Text>
            </View>
            {order.customerName ? (
              <Text style={[styles.customer, { color: colors.textMuted }]} numberOfLines={1}>
                {order.customerName}
              </Text>
            ) : null}
            {order.lines?.length ? (
              order.lines.map((line, index) => {
                const name = itemRowLabel(index, line.productName);
                return (
                  <View key={line.salesOrderLineId} style={styles.itemRow}>
                    <LineThumb colors={colors} imagePath={line.productImagePath} label={name} />
                    <View style={styles.itemCopy}>
                      <Text style={[styles.itemName, { color: colors.text }]} numberOfLines={2}>
                        {name}
                      </Text>
                      {line.productSku ? (
                        <Text style={[styles.itemSku, { color: colors.textMuted }]} numberOfLines={1}>
                          {line.productSku}
                        </Text>
                      ) : null}
                    </View>
                    <Text style={[styles.itemQty, { color: colors.text }]}>
                      Expected {qtyLabel(line.quantity)}
                    </Text>
                  </View>
                );
              })
            ) : (
              <Text style={[styles.missing, { color: colors.textMuted }]}>
                Item detail is not on this trip.
              </Text>
            )}
          </View>
        );
      })}

      <Text style={[styles.gapNote, { color: colors.textMuted }]}>
        {delivery
          ? 'Package count and item delivery are not recorded on this trip.'
          : 'Package count is not on this trip.'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: JOB_CARD_RADIUS,
    padding: 16,
    gap: 10,
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 8,
  },
  section: {
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  totals: {
    flexShrink: 0,
    fontSize: 12,
    fontWeight: '600',
  },
  gapNote: {
    fontSize: 11,
    fontWeight: '500',
    lineHeight: 15,
  },
  orderCard: {
    gap: 8,
  },
  orderDivided: {
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  orderHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  orderTitle: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  orderNo: {
    fontSize: 14,
    fontWeight: '800',
  },
  status: {
    fontSize: 11,
    fontWeight: '600',
  },
  customer: {
    fontSize: 12,
    fontWeight: '600',
  },
  orderMeta: {
    flexShrink: 0,
    maxWidth: '42%',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'right',
  },
  missing: {
    fontSize: 12,
    marginTop: 2,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 4,
  },
  thumb: {
    width: 52,
    height: 52,
    borderRadius: 12,
  },
  thumbEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  itemName: {
    fontSize: 14,
    fontWeight: '700',
  },
  itemSku: {
    fontSize: 11,
    fontWeight: '500',
  },
  itemQty: {
    flexShrink: 0,
    fontSize: 12,
    fontWeight: '700',
  },
});
