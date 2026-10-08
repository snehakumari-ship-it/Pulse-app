import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ArrowLeft } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Layout from '@/constants/Layout';
import { getDriverThemeColors } from '@/contexts/DriverThemeContext';
import type { RouteTimelineStop } from '@/features/driver/job-card/parts/RouteTimeline';
import { StatusPill } from '@/features/driver/job-card/parts/StatusPill';
import { cardBackground } from '@/features/driver/job-card/parts/jobCardSurface';

type Colors = ReturnType<typeof getDriverThemeColors>;

type Props = {
  visible: boolean;
  colors: Colors;
  stops: readonly RouteTimelineStop[];
  summary: string | null;
  onClose: () => void;
  onOpenStop?: (stopId: string) => void;
};

const VISIBLE_LINES = 2;

function orderBrief(stop: RouteTimelineStop): string | null {
  if (stop.orders.length === 0) return null;
  return stop.orders
    .map((order) => (order.orderNumber?.trim() ? `#${order.orderNumber.trim()}` : order.id))
    .join(', ');
}

export function TripPlanPage({ visible, colors, stops, summary, onClose, onOpenStop }: Props) {
  const insets = useSafeAreaInsets();
  const fill = cardBackground(colors);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <View
        testID="trip-plan-page"
        style={[styles.page, { backgroundColor: colors.background, paddingTop: insets.top }]}
      >
        <View style={styles.header}>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Back"
            hitSlop={Layout.touchTargetHitSlop}
            style={({ pressed }) => [
              styles.back,
              { backgroundColor: colors.surfaceElevated, opacity: pressed ? 0.72 : 1 },
            ]}
          >
            <ArrowLeft size={16} color={colors.text} strokeWidth={2.4} />
          </Pressable>
          <View style={styles.headerCopy}>
            <Text style={[styles.title, { color: colors.text }]}>Trip plan</Text>
            <Text style={[styles.subtitle, { color: colors.textMuted }]} numberOfLines={1}>
              {summary ?? `${stops.length} ${stops.length === 1 ? 'stop' : 'stops'}`}
            </Text>
          </View>
          <View style={styles.backSpacer} />
        </View>

        <ScrollView
          style={styles.fill}
          contentContainerStyle={[
            styles.scroll,
            { paddingBottom: Math.max(insets.bottom, 12) + 16 },
          ]}
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.list, { backgroundColor: fill }]}>
            {stops.length === 0 ? (
              <Text style={[styles.empty, { color: colors.textMuted }]}>No stops on this plan yet.</Text>
            ) : (
              stops.map((stop, index) => {
                const last = index === stops.length - 1;
                const brief = orderBrief(stop);
                const lines = stop.orders.flatMap((order) => order.lines);
                const shown = lines.slice(0, VISIBLE_LINES);
                const extra = lines.length - shown.length;
                return (
                  <Pressable
                    key={stop.id}
                    testID={`trip-plan-stop-${stop.id}`}
                    onPress={onOpenStop ? () => onOpenStop(stop.id) : undefined}
                    disabled={!onOpenStop}
                    accessibilityRole={onOpenStop ? 'button' : undefined}
                    accessibilityLabel={`${stop.sequence}. ${stop.typeLabel}, ${stop.location}`}
                    style={[
                      styles.row,
                      !last ? { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth } : null,
                      stop.isCurrent ? { backgroundColor: colors.emeraldMuted } : null,
                    ]}
                  >
                    <View
                      style={[
                        styles.seq,
                        {
                          backgroundColor: stop.isCurrent ? colors.emerald : colors.surfaceElevated,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.seqText,
                          { color: stop.isCurrent ? colors.textOnPrimary : colors.text },
                        ]}
                      >
                        {stop.sequence}
                      </Text>
                    </View>
                    <View style={styles.copy}>
                      <View style={styles.titleRow}>
                        <Text style={[styles.place, { color: colors.text }]} numberOfLines={1}>
                          {stop.location}
                        </Text>
                        <StatusPill colors={colors} tone={stop.statusTone} label={stop.statusLabel} />
                      </View>
                      <Text style={[styles.meta, { color: colors.textMuted }]} numberOfLines={1}>
                        {stop.typeLabel}
                        {` · ${stop.orderCount} ${stop.orderCount === 1 ? 'order' : 'orders'}`}
                        {` · ${stop.productCount} ${stop.productCount === 1 ? 'product' : 'products'}`}
                      </Text>
                      {brief ? (
                        <Text style={[styles.brief, { color: colors.text }]} numberOfLines={1}>
                          {brief}
                        </Text>
                      ) : null}
                      {shown.map((line, lineIndex) => {
                        const name = line.name?.trim() || line.sku?.trim() || 'Product';
                        const qty = line.quantity != null ? ` × ${line.quantity}` : '';
                        return (
                          <Text
                            key={`${stop.id}-line-${lineIndex}`}
                            style={[styles.line, { color: colors.textMuted }]}
                            numberOfLines={1}
                          >
                            {name}
                            {qty}
                          </Text>
                        );
                      })}
                      {extra > 0 ? (
                        <Text style={[styles.line, { color: colors.textMuted }]}>
                          {`+${extra} more`}
                        </Text>
                      ) : null}
                    </View>
                  </Pressable>
                );
              })
            )}
          </View>
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
  fill: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Layout.screenPaddingHorizontal,
    paddingTop: 6,
    paddingBottom: 8,
    gap: 10,
    minHeight: 48,
  },
  back: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backSpacer: {
    width: 36,
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  subtitle: {
    marginTop: 1,
    fontSize: 11,
    fontWeight: '600',
  },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: Layout.screenPaddingHorizontal,
    paddingTop: 4,
  },
  list: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  empty: {
    fontSize: 12,
    fontWeight: '600',
    padding: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  seq: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  seqText: {
    fontSize: 11,
    fontWeight: '700',
  },
  copy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  place: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: -0.15,
  },
  meta: {
    fontSize: 11,
    fontWeight: '600',
  },
  brief: {
    fontSize: 11,
    fontWeight: '600',
  },
  line: {
    fontSize: 11,
    fontWeight: '500',
  },
});
