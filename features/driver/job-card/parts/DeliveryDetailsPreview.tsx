import Theme from '@/constants/Theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Package, X } from 'lucide-react-native';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

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

export type DeliveryPreviewStop = {
  id: string;
  caption: string;
  place: string;
  address: string | null;
  kind: 'pickup' | 'drop' | 'other';
  isCurrent: boolean;
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

export function DeliveryDetailsPreview({ visible, stops, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const orderCount = new Set(stops.flatMap((stop) => stop.orders.map((order) => order.id))).size;
  const productCount = stops.reduce(
    (sum, stop) => sum + stop.orders.reduce((inner, order) => inner + order.lines.length, 0),
    0,
  );

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View
          testID="delivery-details-preview"
          style={[
            styles.sheet,
            {
              paddingTop: Math.max(insets.top, 12),
              paddingBottom: Math.max(insets.bottom, 16),
            },
          ]}
        >
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={styles.kicker}>Delivery</Text>
              <Text style={styles.title}>Order details</Text>
              <Text style={styles.meta}>
                {stops.length} {stops.length === 1 ? 'stop' : 'stops'}
                {orderCount > 0 ? ` · ${orderCount} ${orderCount === 1 ? 'order' : 'orders'}` : ''}
                {productCount > 0 ? ` · ${productCount} ${productCount === 1 ? 'product' : 'products'}` : ''}
              </Text>
            </View>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close order details"
              hitSlop={8}
              style={styles.close}
            >
              <X size={18} color={Theme.textPrimaryDark} strokeWidth={2.4} />
            </Pressable>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {stops.length === 0 ? (
              <Text style={styles.empty}>This trip has no stops to show yet.</Text>
            ) : (
              stops.map((stop) => {
                const drop = stop.kind === 'drop';
                return (
                  <View
                    key={stop.id}
                    style={[
                      styles.stopCard,
                      stop.isCurrent ? styles.stopCardCurrent : null,
                    ]}
                  >
                    <View style={styles.stopHead}>
                      <View
                        style={[
                          styles.badge,
                          { backgroundColor: drop ? Theme.accentGoldMuted : Theme.driverEmeraldMuted },
                        ]}
                      >
                        <Text
                          style={[
                            styles.badgeText,
                            { color: drop ? Theme.accentGoldPressed : Theme.driverEmerald },
                          ]}
                        >
                          {stop.caption}
                          {stop.isCurrent ? ' · Now' : ''}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.place}>{stop.place}</Text>
                    {stop.address && stop.address !== stop.place ? (
                      <Text style={styles.address}>{stop.address}</Text>
                    ) : null}

                    {stop.orders.length === 0 ? (
                      <Text style={styles.noProducts}>No products on this stop.</Text>
                    ) : (
                      stop.orders.map((order) => (
                        <View key={order.id} style={styles.orderBlock}>
                          <Text style={styles.orderTitle}>
                            {order.orderNumber?.trim() ? `Order #${order.orderNumber.trim()}` : 'Order'}
                            {order.customerName?.trim() ? ` · ${order.customerName.trim()}` : ''}
                          </Text>
                          {order.lines.length === 0 ? (
                            <Text style={styles.noProducts}>Product detail is not on this order.</Text>
                          ) : (
                            order.lines.map((line) => (
                              <View key={line.key} style={styles.productRow}>
                                <View style={styles.productIcon}>
                                  <Package size={16} color={Theme.driverEmerald} strokeWidth={2.2} />
                                </View>
                                <View style={styles.productCopy}>
                                  <Text style={styles.productName}>{line.name}</Text>
                                  {line.sku ? <Text style={styles.productSku}>{line.sku}</Text> : null}
                                </View>
                                {qtyLabel(line.quantity) ? (
                                  <Text style={styles.productQty}>{qtyLabel(line.quantity)}</Text>
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
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '92%',
    minHeight: '62%',
    backgroundColor: Theme.screenBackground,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingBottom: 12,
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
  },
  kicker: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: Theme.driverEmerald,
  },
  title: {
    marginTop: 1,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
    color: Theme.textPrimaryDark,
  },
  meta: {
    marginTop: 4,
    fontSize: 13,
    fontWeight: '600',
    color: Theme.textMuted,
  },
  close: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Theme.surfaceLight,
  },
  scroll: { flex: 1 },
  scrollContent: {
    gap: 12,
    paddingBottom: 20,
  },
  empty: {
    fontSize: 14,
    fontWeight: '600',
    color: Theme.textMuted,
  },
  stopCard: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Theme.border,
    backgroundColor: Theme.surfaceLight,
    padding: 14,
    gap: 8,
  },
  stopCardCurrent: {
    borderColor: Theme.driverEmeraldBorder,
    backgroundColor: Theme.driverEmeraldMuted,
  },
  stopHead: {
    flexDirection: 'row',
  },
  badge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  place: {
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: -0.2,
    color: Theme.textPrimaryDark,
  },
  address: {
    fontSize: 13,
    fontWeight: '500',
    color: Theme.textMuted,
  },
  orderBlock: {
    gap: 8,
    marginTop: 4,
  },
  orderTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: Theme.textSecondary,
  },
  productRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Theme.screenBackground,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  productIcon: {
    width: 36,
    height: 36,
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
    fontSize: 12,
    fontWeight: '500',
    color: Theme.textMuted,
  },
  productQty: {
    fontSize: 14,
    fontWeight: '800',
    color: Theme.driverEmerald,
  },
  noProducts: {
    fontSize: 12,
    fontWeight: '600',
    color: Theme.textMuted,
  },
});
