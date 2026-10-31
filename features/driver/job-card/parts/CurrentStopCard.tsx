import type { ReactNode } from 'react';
import { DriverMotionIcon } from '@/components/driver/DriverMotionIcon';
import Layout from '@/constants/Layout';
import Theme from '@/constants/Theme';
import { getDriverThemeColors } from '@/contexts/DriverThemeContext';
import { formatStopAddress } from '@/features/driver/commerce-mission/driverCommerceMissionLabels';
import type { DriverTripStopOrder } from '@/features/driver/commerce-mission/driverTripStopOrders.types';
import type { DriverStopExecutionStop } from '@/features/driver/execution/driverStopExecution.types';
import {
  callActionLabel,
  formatStopKm,
  formatStopPlace,
  isDeliveryStop,
  stopRoleLabel,
} from '@/features/driver/job-card/multiOrderStopCopy';
import { orderExpectedQty } from '@/features/driver/job-card/stopVerificationSummary';
import { cardBackground, JOB_CARD_RADIUS, softElevation } from '@/features/driver/job-card/parts/jobCardSurface';
import { StatusPill } from '@/features/driver/job-card/parts/StatusPill';
import {
  Camera,
  ChevronRight,
  FileText,
  Navigation,
  Package,
  Phone,
  Warehouse,
} from 'lucide-react-native';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

type Colors = ReturnType<typeof getDriverThemeColors>;

type Props = {
  colors: Colors;
  stop: DriverStopExecutionStop;
  orders: DriverTripStopOrder[];
  ordersLoading: boolean;
  distanceKm: number | null | undefined;
  /** Opens the stop's delivery details. */
  onOpenDetails?: () => void;
  /** Opens external navigation to this stop; null when the stop has no coordinates. */
  onNavigate?: (() => void) | null;
  /** Opens proof capture; null until the stop can be completed. */
  onProof?: (() => void) | null;
  children?: ReactNode;
};

function ActionButton({
  colors,
  label,
  accessibilityLabel,
  icon,
  onPress,
  iconDelay = 0,
}: {
  colors: Colors;
  label: string;
  accessibilityLabel?: string;
  icon: ReactNode;
  onPress: (() => void) | null | undefined;
  iconDelay?: number;
}) {
  const disabled = !onPress;
  return (
    <Pressable
      onPress={onPress ?? undefined}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled }}
      hitSlop={Layout.touchTargetHitSlop}
      style={({ pressed }) => [styles.action, { opacity: disabled ? 0.38 : pressed ? 0.7 : 1 }]}
    >
      <View style={[styles.actionIcon, { backgroundColor: colors.emeraldMuted }]}>
        <DriverMotionIcon delay={iconDelay}>{icon}</DriverMotionIcon>
      </View>
      <Text style={[styles.actionLabel, { color: colors.text }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

export function CurrentStopCard({
  colors,
  stop,
  orders,
  ordersLoading,
  distanceKm,
  onOpenDetails,
  onNavigate = null,
  onProof = null,
  children,
}: Props) {
  const place = formatStopPlace(stop);
  const address = formatStopAddress(stop);
  const role = stopRoleLabel(String(stop.stopType));
  const delivery = isDeliveryStop(String(stop.stopType));
  const customers = [...new Set(orders.map((o) => o.customerName?.trim()).filter(Boolean))] as string[];
  const phone =
    stop.contactPhone?.trim()
    || orders.find((o) => o.customerPhone?.trim())?.customerPhone?.trim()
    || null;
  const km = formatStopKm(distanceKm ?? undefined);
  const arrived = stop.status === 'arrived';
  const orderNumbers = orders
    .map((o) => (o.orderNumber?.trim() ? `#${o.orderNumber.trim()}` : null))
    .filter(Boolean)
    .join(', ');
  const items = orders.reduce((sum, o) => sum + (orderExpectedQty(o) ?? 0), 0);
  const ordersLine = orders.length > 0
    ? `${orders.length} ${orders.length === 1 ? 'order' : 'orders'}${items > 0 ? ` · ${items} ${items === 1 ? 'item' : 'items'}` : ''}`
    : null;
  const StopIcon = delivery ? Package : Warehouse;
  const callLabel = callActionLabel(String(stop.stopType));

  return (
    <View
      testID="multi-order-current-stop"
      style={[styles.card, softElevation, { backgroundColor: cardBackground(colors) }]}
    >
      <Pressable
        onPress={onOpenDetails}
        disabled={!onOpenDetails}
        accessibilityRole="button"
        accessibilityLabel={`${role} details, ${place}`}
        style={styles.summary}
      >
        <View style={[styles.tile, { backgroundColor: colors.emeraldMuted }]}>
          <DriverMotionIcon>
            <StopIcon size={18} color={colors.emerald} strokeWidth={2.2} />
          </DriverMotionIcon>
        </View>
        <View style={styles.copy}>
          <View style={styles.metaRow}>
            <Text style={[styles.role, { color: colors.emerald }]}>{role}</Text>
            <StatusPill
              colors={colors}
              tone={arrived ? 'active' : 'next'}
              label={arrived ? 'Arrived' : delivery ? 'Out for delivery' : 'Heading to pickup'}
            />
            {onOpenDetails ? <ChevronRight size={16} color={colors.textMuted} strokeWidth={2.2} /> : null}
          </View>
          <Text style={[styles.place, { color: colors.text }]} numberOfLines={1}>
            {place}
          </Text>
          {customers[0] ? (
            <Text style={[styles.customer, { color: colors.text }]} numberOfLines={1}>
              {customers.length > 1 ? `${customers[0]} +${customers.length - 1}` : customers[0]}
            </Text>
          ) : null}
          {address || stop.city ? (
            <Text style={[styles.addr, { color: colors.textMuted }]} numberOfLines={2}>
              {address || stop.city}
            </Text>
          ) : null}
          {ordersLine || km || ordersLoading ? (
            <Text
              testID="multi-order-stop-orders"
              style={[styles.ordersLine, { color: colors.textMuted }]}
              numberOfLines={2}
            >
              {ordersLine ?? (ordersLoading ? 'Loading orders…' : '')}
              {orderNumbers ? `  ${orderNumbers}` : ''}
              {km ? `  ·  ${km}` : ''}
            </Text>
          ) : null}
        </View>
      </Pressable>

      <View style={styles.stopTrack}>
        <View style={[styles.stopTrackLine, { backgroundColor: colors.border }]} />
        {(['Heading', 'At stop', 'Done'] as const).map((label, index) => {
          const stage =
            stop.status === 'completed' || stop.status === 'skipped' ? 2 : stop.status === 'arrived' ? 1 : 0;
          const reached = index <= stage;
          return (
            <View key={label} style={styles.stopStep}>
              <View
                style={[
                  styles.stopDot,
                  {
                    backgroundColor: reached ? colors.emerald : cardBackground(colors),
                    borderColor: reached ? colors.emerald : colors.border,
                  },
                ]}
              />
              <Text style={[styles.stopStepLabel, { color: reached ? colors.text : colors.textMuted }]}>
                {label}
              </Text>
            </View>
          );
        })}
      </View>

      <View style={styles.actions}>
        <ActionButton
          colors={colors}
          label="Call"
          accessibilityLabel={phone ? callLabel : `${callLabel} unavailable`}
          icon={<Phone size={16} color={colors.emerald} strokeWidth={2.2} />}
          onPress={phone ? () => void Linking.openURL(`tel:${phone}`) : null}
          iconDelay={120}
        />
        <ActionButton
          colors={colors}
          label="Navigate"
          accessibilityLabel={`Navigate to ${place}`}
          icon={<Navigation size={16} color={colors.emerald} strokeWidth={2.2} />}
          onPress={onNavigate}
          iconDelay={280}
        />
        <ActionButton
          colors={colors}
          label="Proof"
          accessibilityLabel={delivery ? 'Proof of delivery' : 'Proof of pickup'}
          icon={<Camera size={16} color={colors.emerald} strokeWidth={2.2} />}
          onPress={onProof}
          iconDelay={440}
        />
        <ActionButton
          colors={colors}
          label="Details"
          accessibilityLabel={`${role} order details`}
          icon={<FileText size={16} color={colors.emerald} strokeWidth={2.2} />}
          onPress={onOpenDetails}
          iconDelay={600}
        />
      </View>

      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: JOB_CARD_RADIUS,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Theme.driverSecondaryGrey,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 10,
  },
  summary: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  tile: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  role: {
    flex: 1,
    minWidth: 0,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  place: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: -0.2,
    lineHeight: 20,
  },
  customer: {
    fontSize: 12,
    fontWeight: '600',
  },
  addr: {
    fontSize: 11,
    fontWeight: '500',
    lineHeight: 15,
  },
  ordersLine: {
    fontSize: 10,
    fontWeight: '600',
  },
  stopTrack: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingTop: 4,
  },
  stopTrackLine: {
    position: 'absolute',
    left: 28,
    right: 28,
    top: 10,
    height: 2,
    borderRadius: 1,
  },
  stopStep: { flex: 1, alignItems: 'center', gap: 6 },
  stopDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
  },
  stopStepLabel: { fontSize: 11, fontWeight: '600', textAlign: 'center' },
  actions: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  action: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
    minHeight: Layout.minTouchTargetSize,
  },
  actionIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: {
    fontSize: 10,
    fontWeight: '600',
  },
});
