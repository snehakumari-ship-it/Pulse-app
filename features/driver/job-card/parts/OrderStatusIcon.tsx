import { getDriverThemeColors } from '@/contexts/DriverThemeContext';
import { commerceOrderStatus } from '@/features/driver/job-card/commerceOrderStatus';
import type { DriverTripStopOrder } from '@/features/driver/commerce-mission/driverTripStopOrders.types';
import { Package } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

type Colors = ReturnType<typeof getDriverThemeColors>;

type Props = {
  colors: Colors;
  order: DriverTripStopOrder;
  orderLabel: string;
};

export function OrderStatusIcon({ colors, order, orderLabel }: Props) {
  const status = commerceOrderStatus(order);
  const tone =
    status.tone === 'done' || status.tone === 'active' ? colors.emerald : colors.textMuted;

  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={`${orderLabel} status, ${status.label}`}
      style={[styles.icon, { borderColor: colors.border, backgroundColor: colors.surfaceElevated }]}
    >
      <Package size={13} color={tone} strokeWidth={2.2} />
      <View style={[styles.dot, { backgroundColor: tone, borderColor: colors.surface }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  icon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  dot: {
    position: 'absolute',
    right: 2,
    bottom: 2,
    width: 6,
    height: 6,
    borderRadius: 3,
    borderWidth: 1,
  },
});
