import { Pressable, StyleSheet, Text, View } from 'react-native';
import Layout from '@/constants/Layout';
import { getDriverThemeColors } from '@/contexts/DriverThemeContext';
import {
  cardBackground,
  JOB_CARD_RADIUS,
  softElevation,
} from '@/features/driver/job-card/parts/jobCardSurface';

type Colors = ReturnType<typeof getDriverThemeColors>;

type Props = {
  colors: Colors;
  done: number;
  total: number;
  orderCount: number;
  remainingKmLabel: string | null;
  onViewTripPlan?: () => void;
  kicker?: string;
  summary?: string | null;
};

export function RouteProgressHeader({
  colors,
  done,
  total,
  orderCount,
  remainingKmLabel,
  onViewTripPlan,
  kicker = "Today's route",
  summary,
}: Props) {
  const ordersLabel = orderCount > 0
    ? `${orderCount} ${orderCount === 1 ? 'order' : 'orders'}`
    : null;
  const pct = total > 0 ? Math.min(1, done / total) : 0;
  const meta = summary
    ?? `${done} of ${total} ${total === 1 ? 'stop' : 'stops'}${ordersLabel ? ` · ${ordersLabel}` : ''}${remainingKmLabel ? ` · ${remainingKmLabel}` : ''}`;

  return (
    <View style={styles.wrap} testID="multi-order-route-header">
      <View
        style={[
          styles.card,
          softElevation,
          { backgroundColor: cardBackground(colors), borderColor: colors.border },
        ]}
      >
        <View style={styles.top}>
          <Text style={[styles.kicker, { color: colors.emerald }]}>{kicker}</Text>
          {onViewTripPlan ? (
            <Pressable
              onPress={onViewTripPlan}
              accessibilityRole="button"
              accessibilityLabel="View trip plan on map"
              hitSlop={Layout.touchTargetHitSlop}
              style={styles.planLink}
            >
              <Text style={[styles.planLinkText, { color: colors.emerald }]}>View plan</Text>
            </Pressable>
          ) : null}
        </View>
        <View style={styles.countRow}>
          <Text style={[styles.count, { color: colors.text }]}>
            {done}
            <Text style={[styles.countTotal, { color: colors.textMuted }]}>{`/${total}`}</Text>
          </Text>
          <Text style={[styles.countUnit, { color: colors.textMuted }]}>
            {total === 1 ? 'stop done' : 'stops done'}
          </Text>
        </View>
        <View style={[styles.bar, { backgroundColor: colors.surfaceElevated }]}>
          <View
            testID="multi-order-route-progress"
            style={[styles.barFill, { backgroundColor: colors.emerald, width: `${pct * 100}%` }]}
          />
        </View>
        <Text style={[styles.meta, { color: colors.textMuted }]} numberOfLines={1}>
          {meta}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  card: {
    borderRadius: JOB_CARD_RADIUS,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  kicker: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.9,
    textTransform: 'uppercase',
  },
  countRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  count: {
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  countTotal: {
    fontSize: 16,
    fontWeight: '600',
  },
  countUnit: {
    fontSize: 12,
    fontWeight: '500',
  },
  bar: {
    height: 4,
    borderRadius: 999,
    overflow: 'hidden',
  },
  barFill: {
    height: 4,
    borderRadius: 999,
  },
  meta: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.1,
  },
  planLink: {
    minHeight: 28,
    justifyContent: 'center',
  },
  planLinkText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.1,
  },
});
