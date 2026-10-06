import { StyleSheet, Text, View } from 'react-native';
import { Clock3, FileText } from 'lucide-react-native';
import { getDriverThemeColors } from '@/contexts/DriverThemeContext';
import type { DriverTripStopOrder } from '@/features/driver/commerce-mission/driverTripStopOrders.types';
import { cardBackground, JOB_CARD_RADIUS, softElevation } from '@/features/driver/job-card/parts/jobCardSurface';
import { formatTime } from '@/lib/format';

type Colors = ReturnType<typeof getDriverThemeColors>;

type Props = {
  colors: Colors;
  orders: readonly DriverTripStopOrder[];
  delivery: boolean;
};

function windowLabel(order: DriverTripStopOrder): string | null {
  const start = order.deliveryWindowStart ? formatTime(order.deliveryWindowStart) : null;
  const end = order.deliveryWindowEnd ? formatTime(order.deliveryWindowEnd) : null;
  if (start && end) return `${start} – ${end}`;
  if (start) return `From ${start}`;
  if (end) return `By ${end}`;
  return null;
}

/** Delivery window and instructions exactly as Primitive A supplies them; renders nothing when absent. */
export function StopDeliveryInfo({ colors, orders, delivery }: Props) {
  const windows = [...new Set(orders.map(windowLabel).filter((w): w is string => Boolean(w)))];
  const notes = [...new Set(orders.map((o) => o.notes?.trim()).filter((n): n is string => Boolean(n)))];
  if (windows.length === 0 && notes.length === 0) return null;

  return (
    <View style={[styles.card, softElevation, { backgroundColor: cardBackground(colors) }]} testID="stop-delivery-info">
      {windows.length > 0 ? (
        <View style={styles.row}>
          <View style={[styles.tile, { backgroundColor: colors.emeraldMuted }]}>
            <Clock3 size={18} color={colors.emerald} strokeWidth={2.2} />
          </View>
          <View style={styles.copy}>
            <Text style={[styles.label, { color: colors.textMuted }]}>
              {delivery ? 'Delivery window' : 'Pickup window'}
            </Text>
            {windows.map((w) => (
              <Text key={w} style={[styles.value, { color: colors.text }]}>{w}</Text>
            ))}
          </View>
        </View>
      ) : null}
      {windows.length > 0 && notes.length > 0 ? (
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
      ) : null}
      {notes.length > 0 ? (
        <View style={styles.row}>
          <View style={[styles.tile, { backgroundColor: colors.surfaceElevated }]}>
            <FileText size={18} color={colors.textMuted} strokeWidth={2.2} />
          </View>
          <View style={styles.copy}>
            <Text style={[styles.label, { color: colors.textMuted }]}>
              {delivery ? 'Delivery instructions' : 'Pickup instructions'}
            </Text>
            {notes.map((n) => (
              <Text key={n} style={[styles.note, { color: colors.text }]}>{n}</Text>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: JOB_CARD_RADIUS,
    padding: 16,
    gap: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  tile: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  value: {
    fontSize: 15,
    fontWeight: '700',
  },
  note: {
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 18,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
  },
});
