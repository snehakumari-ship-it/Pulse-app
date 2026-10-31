import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ArrowLeft, Check } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DeliverySuccessMotion } from '@/components/driver/DeliverySuccessMotion';
import Layout from '@/constants/Layout';
import Theme from '@/constants/Theme';
import { getDriverThemeColors } from '@/contexts/DriverThemeContext';
import type { RouteTimelineProgress, RouteTimelineStop } from '@/features/driver/job-card/parts/RouteTimeline';
import { StatusPill } from '@/features/driver/job-card/parts/StatusPill';
import { cardBackground, JOB_CARD_RADIUS, softElevation } from '@/features/driver/job-card/parts/jobCardSurface';

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
const MARKER = 18;

function orderBrief(stop: RouteTimelineStop): string | null {
  if (stop.orders.length === 0) return null;
  return stop.orders
    .map((order) => (order.orderNumber?.trim() ? `#${order.orderNumber.trim()}` : order.id))
    .join(', ');
}

function PlanMarker({
  colors,
  progress,
}: {
  colors: Colors;
  progress: RouteTimelineProgress;
}) {
  if (progress === 'done') {
    return (
      <View
        style={[styles.marker, { backgroundColor: colors.emerald, borderColor: colors.emerald }]}
      >
        <Check size={10} color={colors.textOnPrimary} strokeWidth={3} />
      </View>
    );
  }
  if (progress === 'current') {
    return (
      <View
        style={[
          styles.marker,
          { borderColor: colors.emerald, backgroundColor: colors.surface },
        ]}
      >
        <View style={[styles.markerDot, { backgroundColor: colors.emerald }]} />
      </View>
    );
  }
  return (
    <View
      style={[
        styles.marker,
        {
          borderColor: progress === 'failed' ? Theme.negative : colors.borderLight,
          backgroundColor: colors.surfaceElevated,
        },
      ]}
    />
  );
}

export function TripPlanPage({ visible, colors, stops, summary, onClose, onOpenStop }: Props) {
  const insets = useSafeAreaInsets();
  const fill = cardBackground(colors);
  const currentStop = stops.find((s) => s.isCurrent) ?? null;
  const routeLine =
    stops.length >= 2
      ? `${stops[0]!.location}  →  ${stops[stops.length - 1]!.location}`
      : summary;

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
        <View style={styles.headerBar}>
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
        </View>

        <ScrollView
          style={styles.fill}
          contentContainerStyle={[
            styles.scroll,
            { paddingBottom: Math.max(insets.bottom, 12) + 24 },
          ]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.hero}>
            <View style={styles.heroCopy}>
              <Text style={[styles.heroTitle, { color: colors.text }]}>Trip plan</Text>
              <Text style={[styles.heroRoute, { color: colors.textMuted }]} numberOfLines={2}>
                {routeLine ?? `${stops.length} ${stops.length === 1 ? 'stop' : 'stops'}`}
              </Text>
              {summary ? (
                <Text style={[styles.heroMeta, { color: colors.textMuted }]} numberOfLines={1}>
                  {summary}
                </Text>
              ) : null}
            </View>
            {currentStop ? (
              <StatusPill
                colors={colors}
                tone={currentStop.statusTone}
                label={currentStop.statusLabel}
              />
            ) : null}
          </View>

          <View style={[styles.list, softElevation, { backgroundColor: fill }]}>
            {stops.length === 0 ? (
              <Text style={[styles.empty, { color: colors.textMuted }]}>
                No stops on this plan yet.
              </Text>
            ) : (
              stops.map((stop, index) => {
                const last = index === stops.length - 1;
                const brief = orderBrief(stop);
                const lines = stop.orders.flatMap((order) => order.lines);
                const shown = lines.slice(0, VISIBLE_LINES);
                const extra = lines.length - shown.length;
                const muted = stop.progress === 'upcoming';
                const railDone = stop.progress === 'done';
                return (
                  <Pressable
                    key={stop.id}
                    testID={`trip-plan-stop-${stop.id}`}
                    onPress={onOpenStop ? () => onOpenStop(stop.id) : undefined}
                    disabled={!onOpenStop}
                    accessibilityRole={onOpenStop ? 'button' : undefined}
                    accessibilityLabel={`${stop.sequence}. ${stop.typeLabel}, ${stop.location}`}
                    style={styles.row}
                  >
                    <View style={styles.rail}>
                      <PlanMarker colors={colors} progress={stop.progress} />
                      {!last ? (
                        <View
                          style={[
                            styles.connector,
                            {
                              backgroundColor: railDone ? colors.emerald : colors.border,
                            },
                          ]}
                        />
                      ) : null}
                    </View>

                    <View style={[styles.body, last ? null : styles.bodySpaced]}>
                      <View style={styles.titleRow}>
                        <Text
                          style={[
                            styles.place,
                            stop.isCurrent ? styles.placeCurrent : null,
                            { color: muted ? colors.textMuted : colors.text },
                          ]}
                          numberOfLines={1}
                        >
                          {stop.location}
                        </Text>
                        <Text
                          style={[styles.typeRight, { color: colors.textMuted }]}
                          numberOfLines={1}
                        >
                          {stop.typeLabel}
                        </Text>
                      </View>

                      <View style={styles.metaRow}>
                        <View style={styles.metaCopy}>
                          {stop.timeLabel ? (
                            <Text style={[styles.time, { color: colors.textMuted }]}>
                              {stop.timeLabel}
                            </Text>
                          ) : (
                            <Text style={[styles.time, { color: colors.textMuted }]}>
                              {stop.statusLabel}
                            </Text>
                          )}
                          <Text style={[styles.counts, { color: colors.textMuted }]} numberOfLines={1}>
                            {`${stop.orderCount} ${stop.orderCount === 1 ? 'order' : 'orders'}`}
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
                        <StatusPill colors={colors} tone={stop.statusTone} label={stop.statusLabel} />
                      </View>
                    </View>
                  </Pressable>
                );
              })
            )}
          </View>

          <View style={styles.motionCorner} pointerEvents="none">
            <DeliverySuccessMotion />
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
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Layout.screenPaddingHorizontal,
    paddingTop: 6,
    paddingBottom: 4,
    minHeight: 44,
  },
  back: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: Layout.screenPaddingHorizontal,
    paddingTop: 4,
  },
  hero: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 16,
    paddingTop: 4,
  },
  heroCopy: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  heroTitle: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  heroRoute: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: -0.1,
    lineHeight: 18,
  },
  heroMeta: {
    fontSize: 11,
    fontWeight: '600',
  },
  list: {
    borderRadius: JOB_CARD_RADIUS,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Theme.driverSecondaryGrey,
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 8,
  },
  empty: {
    fontSize: 12,
    fontWeight: '600',
    padding: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 12,
  },
  rail: {
    width: MARKER,
    alignItems: 'center',
    paddingTop: 2,
  },
  marker: {
    width: MARKER,
    height: MARKER,
    borderRadius: MARKER / 2,
    borderWidth: 2.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  connector: {
    flex: 1,
    width: 2.5,
    minHeight: 28,
    marginVertical: 4,
    borderRadius: 2,
  },
  body: {
    flex: 1,
    minWidth: 0,
    paddingBottom: 4,
  },
  bodySpaced: {
    marginBottom: 18,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 4,
  },
  place: {
    flex: 1,
    minWidth: 0,
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  placeCurrent: {
    fontSize: 16,
  },
  typeRight: {
    flexShrink: 0,
    maxWidth: '38%',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'right',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  metaCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  time: {
    fontSize: 12,
    fontWeight: '500',
  },
  counts: {
    fontSize: 11,
    fontWeight: '500',
  },
  brief: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: -0.1,
    marginTop: 2,
  },
  line: {
    fontSize: 11,
    fontWeight: '500',
  },
  motionCorner: {
    alignSelf: 'flex-end',
    marginTop: 20,
    marginRight: -4,
  },
});
