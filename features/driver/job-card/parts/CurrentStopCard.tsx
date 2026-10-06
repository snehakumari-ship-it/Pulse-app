import type { ReactNode } from 'react';
import Layout from '@/constants/Layout';
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
  MapPin,
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
}: {
  colors: Colors;
  label: string;
  accessibilityLabel?: string;
  icon: ReactNode;
  onPress: (() => void) | null | undefined;
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
      <View style={[styles.actionIcon, { backgroundColor: colors.emeraldMuted }]}>{icon}</View>
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
          <StopIcon size={22} color={colors.emerald} strokeWidth={2.2} />
        </View>
        <View style={styles.copy}>
          <View style={styles.metaRow}>
            <Text style={[styles.role, { color: colors.emerald }]}>{role}</Text>
            <StatusPill
              colors={colors}
              tone={arrived ? 'active' : 'next'}
              label={arrived ? 'Arrived' : delivery ? 'Out for delivery' : 'Heading to pickup'}
            />
          </View>
          <Text style={[styles.place, { color: colors.text }]} numberOfLines={2}>
            {place}
          </Text>
          {customers[0] ? (
            <Text style={[styles.customer, { color: colors.text }]} numberOfLines={1}>
              {customers.length > 1 ? `${customers[0]} +${customers.length - 1}` : customers[0]}
            </Text>
          ) : null}
          {address || stop.city ? (
            <View style={styles.addrRow}>
              <MapPin size={12} color={colors.textMuted} strokeWidth={2} />
              <Text style={[styles.addr, { color: colors.textMuted }]} numberOfLines={2}>
                {address || stop.city}
              </Text>
            </View>
          ) : null}
        </View>
        {onOpenDetails ? <ChevronRight size={18} color={colors.textMuted} strokeWidth={2.2} /> : null}
      </Pressable>

      {ordersLine || km || ordersLoading ? (
        <View style={[styles.facts, { backgroundColor: colors.surfaceElevated }]} testID="multi-order-stop-orders">
          <Text style={[styles.factText, { color: colors.text }]} numberOfLines={1}>
            {ordersLine ?? (ordersLoading ? 'Loading orders…' : '')}
            {orderNumbers ? (
              <Text style={[styles.factMuted, { color: colors.textMuted }]}>{`  ${orderNumbers}`}</Text>
            ) : null}
          </Text>
          {km ? <Text style={[styles.factKm, { color: colors.emerald }]}>{km}</Text> : null}
        </View>
      ) : null}

      <View style={styles.actions}>
        <ActionButton
          colors={colors}
          label="Call"
          accessibilityLabel={phone ? callLabel : `${callLabel} unavailable`}
          icon={<Phone size={18} color={colors.emerald} strokeWidth={2.2} />}
          onPress={phone ? () => void Linking.openURL(`tel:${phone}`) : null}
        />
        <ActionButton
          colors={colors}
          label="Navigate"
          accessibilityLabel={`Navigate to ${place}`}
          icon={<Navigation size={18} color={colors.emerald} strokeWidth={2.2} />}
          onPress={onNavigate}
        />
        <ActionButton
          colors={colors}
          label="Proof"
          accessibilityLabel={delivery ? 'Proof of delivery' : 'Proof of pickup'}
          icon={<Camera size={18} color={colors.emerald} strokeWidth={2.2} />}
          onPress={onProof}
        />
        <ActionButton
          colors={colors}
          label="Details"
          accessibilityLabel={`${role} order details`}
          icon={<FileText size={18} color={colors.emerald} strokeWidth={2.2} />}
          onPress={onOpenDetails}
        />
      </View>

      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: JOB_CARD_RADIUS,
    padding: 16,
    gap: 12,
  },
  summary: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  tile: {
    width: 48,
    height: 48,
    borderRadius: 14,
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
    flexWrap: 'wrap',
    gap: 8,
  },
  role: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.9,
    textTransform: 'uppercase',
  },
  place: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
    lineHeight: 23,
  },
  customer: {
    fontSize: 13,
    fontWeight: '600',
  },
  addrRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 5,
  },
  addr: {
    flex: 1,
    minWidth: 0,
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 16,
  },
  facts: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  factText: {
    flex: 1,
    minWidth: 0,
    fontSize: 12,
    fontWeight: '700',
  },
  factMuted: {
    fontSize: 12,
    fontWeight: '600',
  },
  factKm: {
    flexShrink: 0,
    fontSize: 12,
    fontWeight: '700',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  action: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
    minHeight: Layout.minTouchTargetSize,
  },
  actionIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
});
