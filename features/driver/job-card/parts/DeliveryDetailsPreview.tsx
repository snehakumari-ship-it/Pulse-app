import Theme from '@/constants/Theme';
import Layout from '@/constants/Layout';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ArrowLeft,
  Check,
  Clock3,
  MapPin,
  Navigation,
  Package,
  Truck,
} from 'lucide-react-native';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

export type DeliveryPreviewLine = {
  key: string;
  name: string;
  sku: string | null;
  quantity: number | null;
};

export type DeliveryPreviewOrder = {
  id: string;
  orderNumber: string | null;
  customerName: string | null;
  lines: readonly DeliveryPreviewLine[];
};

export type DeliveryPreviewStopStatus = 'completed' | 'arrived' | 'pending' | 'failed';

export type DeliveryPreviewStop = {
  id: string;
  caption: string;
  place: string;
  address: string | null;
  kind: 'pickup' | 'drop' | 'other';
  isCurrent: boolean;
  status: DeliveryPreviewStopStatus;
  orders: readonly DeliveryPreviewOrder[];
};

type Props = {
  visible: boolean;
  stops: readonly DeliveryPreviewStop[];
  onClose: () => void;
};

function qtyLabel(quantity: number | null): string | null {
  if (quantity == null || !Number.isFinite(quantity)) return null;
  return `× ${quantity}`;
}

function statusVisual(status: DeliveryPreviewStopStatus, isCurrent: boolean): {
  label: string;
  bg: string;
  fg: string;
  Icon: typeof Check;
} {
  if (status === 'completed') {
    return {
      label: 'Completed',
      bg: Theme.complianceStageSuccessBg,
      fg: Theme.complianceStageSuccessFg,
      Icon: Check,
    };
  }
  if (status === 'failed') {
    return {
      label: 'Issue',
      bg: Theme.complianceStageDocsBg,
      fg: Theme.complianceStageDocsFg,
      Icon: Clock3,
    };
  }
  if (status === 'arrived' || isCurrent) {
    return {
      label: isCurrent ? 'Now' : 'Arrived',
      bg: Theme.driverEmeraldMuted,
      fg: Theme.driverEmerald,
      Icon: Navigation,
    };
  }
  return {
    label: 'Upcoming',
    bg: Theme.complianceStagePendingBg,
    fg: Theme.complianceStagePendingFg,
    Icon: Clock3,
  };
}

function indexTone(
  stop: DeliveryPreviewStop,
  index: number,
  currentIndex: number,
): { bg: string; fg: string } {
  if (stop.status === 'completed') {
    return { bg: Theme.driverEmerald, fg: Theme.textOnPrimary };
  }
  if (stop.isCurrent || stop.status === 'arrived') {
    return { bg: Theme.driverPrimary, fg: Theme.textOnPrimary };
  }
  if (index === currentIndex + 1 && currentIndex >= 0) {
    return { bg: Theme.complianceStagePendingFg, fg: Theme.textOnPrimary };
  }
  return { bg: Theme.surfaceLight, fg: Theme.textMuted };
}

function orderPinLine(stop: DeliveryPreviewStop): string {
  const first = stop.orders[0];
  const orderBit = first?.orderNumber?.trim()
    ? `Order #${first.orderNumber.trim()}`
    : stop.orders.length > 1
      ? `${stop.orders.length} orders`
      : null;
  const who = first?.customerName?.trim() || null;
  const placeBit = stop.address && stop.address !== stop.place ? stop.address : stop.place;
  if (stop.kind === 'pickup') {
    return [orderBit, who].filter(Boolean).join(' · ') || placeBit;
  }
  return [placeBit, orderBit, who].filter(Boolean).join(' · ');
}

export function DeliveryDetailsPreview({ visible, stops, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const orderCount = new Set(stops.flatMap((stop) => stop.orders.map((order) => order.id))).size;
  const productCount = stops.reduce(
    (sum, stop) => sum + stop.orders.reduce((inner, order) => inner + order.lines.length, 0),
    0,
  );
  const currentIndex = stops.findIndex((s) => s.isCurrent);
  const leadOrder = stops.flatMap((s) => s.orders)[0] ?? null;
  const inProgress = stops.some((s) => s.isCurrent || s.status === 'arrived')
    && !stops.every((s) => s.status === 'completed');

  const summary = [
    `${stops.length} ${stops.length === 1 ? 'stop' : 'stops'}`,
    orderCount > 0 ? `${orderCount} ${orderCount === 1 ? 'order' : 'orders'}` : null,
    productCount > 0 ? `${productCount} ${productCount === 1 ? 'product' : 'products'}` : null,
  ].filter(Boolean).join(' · ');

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <View
        testID="delivery-details-preview"
        style={[
          styles.page,
          {
            backgroundColor: Theme.surfaceGray,
            paddingTop: insets.top,
          },
        ]}
      >
        <View style={[styles.header, { backgroundColor: Theme.cardWhite }]}>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Back"
            hitSlop={Layout.touchTargetHitSlop}
            style={styles.back}
          >
            <ArrowLeft size={18} color={Theme.textPrimaryDark} strokeWidth={2.4} />
          </Pressable>
          <View style={styles.headerCopy}>
            <Text style={styles.title}>Order details</Text>
            <Text style={styles.meta} numberOfLines={1}>{summary}</Text>
          </View>
          <View style={styles.back} />
        </View>

        <ScrollView
          style={styles.scroll}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: Math.max(insets.bottom, 16) + 12 },
          ]}
        >
          {leadOrder ? (
            <View style={styles.overviewCard}>
              <View style={styles.overviewIcon}>
                <Truck size={18} color={Theme.driverEmerald} strokeWidth={2.2} />
              </View>
              <View style={styles.overviewCopy}>
                <Text style={styles.overviewOrder} numberOfLines={1}>
                  {leadOrder.orderNumber?.trim()
                    ? `Order #${leadOrder.orderNumber.trim()}`
                    : 'Commerce delivery'}
                </Text>
                <Text style={styles.overviewWho} numberOfLines={1}>
                  {leadOrder.customerName?.trim() || summary}
                </Text>
              </View>
              <View
                style={[
                  styles.overviewStatus,
                  {
                    backgroundColor: inProgress
                      ? Theme.complianceStageSuccessBg
                      : Theme.surfaceLight,
                  },
                ]}
              >
                <View
                  style={[
                    styles.overviewDot,
                    {
                      backgroundColor: inProgress
                        ? Theme.complianceStageSuccessFg
                        : Theme.textMuted,
                    },
                  ]}
                />
                <Text
                  style={[
                    styles.overviewStatusText,
                    {
                      color: inProgress
                        ? Theme.complianceStageSuccessFg
                        : Theme.textMuted,
                    },
                  ]}
                >
                  {inProgress ? 'In progress' : 'Scheduled'}
                </Text>
              </View>
            </View>
          ) : null}

          {stops.length === 0 ? (
            <Text style={styles.empty}>This trip has no stops to show yet.</Text>
          ) : (
            stops.map((stop, index) => {
              const status = statusVisual(stop.status, stop.isCurrent);
              // First pending after current reads as Upcoming; later pendings stay Pending.
              const pendingAfterCurrent =
                stop.status === 'pending'
                && !stop.isCurrent
                && currentIndex >= 0
                && index > currentIndex + 1;
              const StatusIcon = status.Icon;
              const statusLabel = pendingAfterCurrent ? 'Pending' : status.label;
              const statusBg = pendingAfterCurrent
                ? Theme.surfaceLight
                : status.bg;
              const statusFg = pendingAfterCurrent ? Theme.textMuted : status.fg;
              const tone = indexTone(stop, index, currentIndex);
              const pinLine = orderPinLine(stop);

              return (
                <View
                  key={stop.id}
                  style={[
                    styles.stopCard,
                    stop.isCurrent ? styles.stopCardCurrent : null,
                  ]}
                >
                  <View style={styles.stopHead}>
                    <View style={styles.stopHeadLeft}>
                      <View style={[styles.indexBadge, { backgroundColor: tone.bg }]}>
                        <Text style={[styles.indexText, { color: tone.fg }]}>
                          {index + 1}
                        </Text>
                      </View>
                      <Text style={styles.caption} numberOfLines={1}>
                        {stop.caption}
                      </Text>
                      {stop.isCurrent ? (
                        <View style={styles.nowChip}>
                          <Text style={styles.nowChipText}>Now</Text>
                        </View>
                      ) : null}
                    </View>
                    {stop.isCurrent ? (
                      <View style={styles.currentLoc}>
                        <Navigation size={11} color={Theme.driverEmerald} strokeWidth={2.4} />
                        <Text style={styles.currentLocText}>Current location</Text>
                      </View>
                    ) : (
                      <View style={[styles.statusPill, { backgroundColor: statusBg }]}>
                        <StatusIcon size={11} color={statusFg} strokeWidth={2.4} />
                        <Text style={[styles.statusPillText, { color: statusFg }]}>
                          {statusLabel}
                        </Text>
                      </View>
                    )}
                  </View>

                  <View style={styles.pinRow}>
                    <MapPin size={13} color={Theme.textMuted} strokeWidth={2.2} />
                    <Text style={styles.pinText} numberOfLines={2}>
                      {pinLine}
                    </Text>
                  </View>

                  {stop.orders.length === 0 ? (
                    <Text style={styles.noProducts}>No products on this stop.</Text>
                  ) : (
                    stop.orders.map((order) => (
                      <View key={order.id} style={styles.orderBlock}>
                        {stop.orders.length > 1 ? (
                          <Text style={styles.orderTitle}>
                            {order.orderNumber?.trim()
                              ? `Order #${order.orderNumber.trim()}`
                              : 'Order'}
                            {order.customerName?.trim()
                              ? ` · ${order.customerName.trim()}`
                              : ''}
                          </Text>
                        ) : null}
                        {order.lines.length === 0 ? (
                          <Text style={styles.noProducts}>
                            Product detail is not on this order.
                          </Text>
                        ) : (
                          order.lines.map((line) => (
                            <View key={line.key} style={styles.productRow}>
                              <View style={styles.productIcon}>
                                <Package
                                  size={15}
                                  color={Theme.driverEmerald}
                                  strokeWidth={2.2}
                                />
                              </View>
                              <View style={styles.productCopy}>
                                <Text style={styles.productName} numberOfLines={1}>
                                  {line.name}
                                </Text>
                                {line.sku ? (
                                  <Text style={styles.productSku} numberOfLines={1}>
                                    {line.sku}
                                  </Text>
                                ) : null}
                              </View>
                              {qtyLabel(line.quantity) ? (
                                <Text style={styles.productQty}>
                                  {qtyLabel(line.quantity)}
                                </Text>
                              ) : null}
                            </View>
                          ))
                        )}
                      </View>
                    ))
                  )}
                </View>
              );
            })
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    width: '100%',
    ...(Platform.OS === 'web' ? { minHeight: '100vh' as unknown as number } : null),
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Layout.screenPaddingHorizontal,
    minHeight: 56,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.border,
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
  },
  back: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.2,
    color: Theme.textPrimaryDark,
  },
  meta: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: '600',
    color: Theme.textMuted,
  },
  scroll: { flex: 1 },
  scrollContent: {
    gap: 12,
    paddingHorizontal: Layout.screenPaddingHorizontal,
    paddingTop: 14,
  },
  overviewCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 12,
    backgroundColor: Theme.driverEmeraldMuted,
    borderWidth: 1,
    borderColor: Theme.driverEmeraldBorderSoft,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  overviewIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Theme.cardWhite,
  },
  overviewCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  overviewOrder: {
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: -0.2,
    color: Theme.textPrimaryDark,
  },
  overviewWho: {
    fontSize: 12,
    fontWeight: '500',
    color: Theme.textMuted,
  },
  overviewStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  overviewDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  overviewStatusText: {
    fontSize: 11,
    fontWeight: '700',
  },
  empty: {
    fontSize: 12,
    fontWeight: '600',
    color: Theme.textMuted,
  },
  stopCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Theme.driverSecondaryGrey,
    backgroundColor: Theme.cardWhite,
    padding: 12,
    gap: 8,
    ...(Platform.OS === 'ios'
      ? {
          shadowColor: '#0f172a',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.05,
          shadowRadius: 8,
        }
      : { elevation: 1 }),
  },
  stopCardCurrent: {
    borderWidth: 1.5,
    borderColor: Theme.driverEmerald,
    backgroundColor: Theme.cardWhite,
  },
  stopHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  stopHeadLeft: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  indexBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  indexText: {
    fontSize: 13,
    fontWeight: '800',
  },
  caption: {
    flexShrink: 1,
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: -0.2,
    color: Theme.textPrimaryDark,
  },
  nowChip: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: Theme.driverEmeraldMuted,
  },
  nowChipText: {
    fontSize: 10,
    fontWeight: '800',
    color: Theme.driverEmerald,
    letterSpacing: 0.2,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    flexShrink: 0,
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: '700',
  },
  currentLoc: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: Theme.driverEmeraldMuted,
    flexShrink: 0,
  },
  currentLocText: {
    fontSize: 11,
    fontWeight: '700',
    color: Theme.driverEmerald,
  },
  pinRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  pinText: {
    flex: 1,
    minWidth: 0,
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 16,
    color: Theme.textMuted,
  },
  orderBlock: {
    gap: 8,
  },
  orderTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: Theme.textSecondary,
  },
  productRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Theme.surfaceLight,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  productIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Theme.driverEmeraldMuted,
  },
  productCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  productName: {
    fontSize: 13,
    fontWeight: '700',
    color: Theme.textPrimaryDark,
  },
  productSku: {
    fontSize: 11,
    fontWeight: '500',
    color: Theme.textMuted,
  },
  productQty: {
    fontSize: 13,
    fontWeight: '800',
    color: Theme.driverEmerald,
  },
  noProducts: {
    fontSize: 12,
    fontWeight: '600',
    color: Theme.textMuted,
  },
});
