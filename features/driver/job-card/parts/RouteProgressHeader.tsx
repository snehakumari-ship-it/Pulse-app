import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AlertCircle, CheckCircle2, Clock3, MapPin } from 'lucide-react-native';
import Layout from '@/constants/Layout';
import { getDriverThemeColors } from '@/contexts/DriverThemeContext';
import {
  cardBackground,
  JOB_CARD_RADIUS,
  softElevation,
  statusToneColors,
  type StatusTone,
} from '@/features/driver/job-card/parts/jobCardSurface';

type Colors = ReturnType<typeof getDriverThemeColors>;

/** Stop counts by execution status. */
export type RouteStopStats = {
  pending: number;
  arrived: number;
  completed: number;
  failed: number;
};

type Props = {
  colors: Colors;
  done: number;
  total: number;
  orderCount: number;
  remainingKmLabel: string | null;
  onViewTripPlan?: () => void;
  kicker?: string;
  summary?: string | null;
  stats?: RouteStopStats | null;
};

/** `short` must fit a quarter-width tile on a 360pt phone; `label` is the spoken name. */
const STAT_TILES: Array<{
  key: keyof RouteStopStats;
  label: string;
  short: string;
  tone: StatusTone;
  Icon: typeof Clock3;
}> = [
  { key: 'pending', label: 'Pending', short: 'Pending', tone: 'pending', Icon: Clock3 },
  { key: 'arrived', label: 'At stop', short: 'At stop', tone: 'active', Icon: MapPin },
  { key: 'completed', label: 'Completed', short: 'Done', tone: 'done', Icon: CheckCircle2 },
  { key: 'failed', label: 'Exceptions', short: 'Issues', tone: 'failed', Icon: AlertCircle },
];

export function RouteProgressHeader({
  colors,
  done,
  total,
  orderCount,
  remainingKmLabel,
  onViewTripPlan,
  kicker = "Today's route",
  summary,
  stats,
}: Props) {
  const ordersLabel = orderCount > 0
    ? `${orderCount} ${orderCount === 1 ? 'order' : 'orders'}`
    : null;
  const pct = total > 0 ? Math.min(1, done / total) : 0;
  const meta = summary
    ?? `${done} of ${total} ${total === 1 ? 'stop' : 'stops'}${ordersLabel ? ` · ${ordersLabel}` : ''}${remainingKmLabel ? ` · ${remainingKmLabel}` : ''}`;

  return (
    <View style={styles.wrap} testID="multi-order-route-header">
      <View style={[styles.card, softElevation, { backgroundColor: cardBackground(colors) }]}>
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
            <Text style={[styles.countTotal, { color: colors.textMuted }]}>{` / ${total}`}</Text>
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

      {stats ? (
        <View style={styles.stats} testID="multi-order-route-stats">
          {STAT_TILES.map(({ key, label, short, tone, Icon }) => {
            const tint = statusToneColors(colors, tone);
            return (
              <View
                key={key}
                style={[styles.stat, softElevation, { backgroundColor: cardBackground(colors) }]}
                accessible
                accessibilityLabel={`${label}: ${stats[key]}`}
              >
                <View style={[styles.statIcon, { backgroundColor: tint.bg }]}>
                  <Icon size={14} color={tint.fg} strokeWidth={2.4} />
                </View>
                <Text style={[styles.statValue, { color: colors.text }]}>{stats[key]}</Text>
                <Text style={[styles.statLabel, { color: colors.textMuted }]} numberOfLines={1}>
                  {short}
                </Text>
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  card: {
    borderRadius: JOB_CARD_RADIUS,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 6,
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
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.6,
  },
  countTotal: {
    fontSize: 20,
    fontWeight: '700',
  },
  countUnit: {
    fontSize: 12,
    fontWeight: '600',
  },
  bar: {
    height: 6,
    borderRadius: 999,
    overflow: 'hidden',
  },
  barFill: {
    height: 6,
    borderRadius: 999,
  },
  meta: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.1,
  },
  planLink: {
    minHeight: 28,
    justifyContent: 'center',
  },
  planLinkText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  stats: {
    flexDirection: 'row',
    gap: 8,
  },
  stat: {
    flex: 1,
    minWidth: 0,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 10,
    gap: 4,
  },
  statIcon: {
    width: 26,
    height: 26,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statValue: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  statLabel: {
    fontSize: 10,
    fontWeight: '600',
  },
});
