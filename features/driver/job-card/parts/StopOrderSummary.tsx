import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Layout from '@/constants/Layout';
import { getDriverThemeColors } from '@/contexts/DriverThemeContext';
import type { CommerceProductLine } from '@/features/driver/job-card/commerceTripExecution';

type Colors = ReturnType<typeof getDriverThemeColors>;

export type StopOrderSummaryOrder = {
  id: string;
  orderNumber: string | null;
  productCount: number;
  lines: readonly CommerceProductLine[];
};

type Props = {
  colors: Colors;
  order: StopOrderSummaryOrder;
};

function productLabel(line: CommerceProductLine, index: number): string {
  return line.name?.trim() || line.sku?.trim() || `Product ${index + 1}`;
}

function orderTitle(order: StopOrderSummaryOrder): string {
  const number = order.orderNumber?.trim();
  return number ? `Order #${number}` : `Order ${order.id}`;
}

/** Compact order row. Product lines expand from memory — no network read. */
export function StopOrderSummary({ colors, order }: Props) {
  const [open, setOpen] = useState(false);
  const title = orderTitle(order);
  const countLabel = `${order.productCount} ${order.productCount === 1 ? 'product' : 'products'}`;

  return (
    <View style={styles.wrap} testID={`commerce-order-${order.id}`}>
      <Pressable
        onPress={() => setOpen((value) => !value)}
        accessibilityRole="button"
        accessibilityLabel={`${title}, ${countLabel}`}
        accessibilityState={{ expanded: open }}
        hitSlop={Layout.touchTargetHitSlop}
        style={styles.summary}
      >
        <Text style={[styles.summaryText, { color: colors.text }]} numberOfLines={1}>
          {order.orderNumber?.trim() ? 'Order #' : 'Order '}
          <Text>{order.orderNumber?.trim() || order.id}</Text>
          {` · ${countLabel}`}
        </Text>
      </Pressable>
      {open ? (
        <View testID={`commerce-order-lines-${order.id}`} style={styles.lines}>
          {order.lines.length === 0 ? (
            <Text style={[styles.missing, { color: colors.textMuted }]}>
              Product detail is not on this stop.
            </Text>
          ) : (
            order.lines.map((line, index) => {
              const name = productLabel(line, index);
              const unit = line.unit?.trim();
              const qty = line.quantity != null ? `× ${line.quantity}${unit ? ` ${unit}` : ''}` : null;
              return (
                <View
                  key={`${order.id}-${line.productId ?? line.sku ?? index}`}
                  testID={`commerce-product-line-${order.id}-${index}`}
                  style={styles.line}
                >
                  <Text style={[styles.name, { color: colors.text }]} numberOfLines={2}>
                    {name}
                  </Text>
                  {line.sku ? (
                    <Text style={[styles.sku, { color: colors.textMuted }]} numberOfLines={1}>
                      {line.sku}
                    </Text>
                  ) : null}
                  {qty ? (
                    <Text style={[styles.qty, { color: colors.textMuted }]}>{qty}</Text>
                  ) : null}
                </View>
              );
            })
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 4 },
  summary: {
    minHeight: Layout.minTouchTargetSize,
    justifyContent: 'center',
  },
  summaryText: {
    fontSize: 13,
    fontWeight: '600',
  },
  lines: {
    gap: 8,
    paddingLeft: 8,
    paddingBottom: 4,
  },
  line: { gap: 1 },
  name: {
    fontSize: 13,
    fontWeight: '600',
  },
  sku: {
    fontSize: 11,
    fontWeight: '500',
  },
  qty: {
    fontSize: 12,
    fontWeight: '600',
  },
  missing: {
    fontSize: 12,
    fontWeight: '500',
  },
});
