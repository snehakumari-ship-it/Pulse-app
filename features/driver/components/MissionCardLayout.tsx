/**
 * Presentation-only mission info block for DriverTripFlowCard's active-trip
 * view. Hero chrome matches JobRequestCard (flush edges, shared sheet pads)
 * so assign → active → complete stay visually aligned.
 */
import Theme from '@/constants/Theme';
import {
  FLOW_EMERALD,
  TRIP_SHEET_BODY_PAD,
  TRIP_SHEET_HERO_PAD,
} from '@/components/driver/DriverTripSheetLayout';
import type { JobCardAssignerPayload } from '@/features/trips/utils/driverAssignerDisplay.util';
import {
  missionPlanRows,
  summarizePlanRows,
  type MissionPlanStop,
} from '@/features/driver/components/missionPlanRows';
import { AlertTriangle, Map } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export interface MissionCardLayoutProps {
  title: string;
  earnings: string;
  /** Defaults to EST. EARNINGS; PAY N/A when ₹ is not applicable. */
  earningsLabel?: string;
  assignedBy?: JobCardAssignerPayload | null;
  /** Opens the party sheet from the assigner block when the trip still needs a party. */
  onAssignerPress?: () => void;
  showHeroAssigner: boolean;
  /** Which stop this stage is oriented toward — drives the destination heading. Null once completed. */
  target: 'pickup' | 'drop' | null;
  pickupLabel: string;
  dropLabel: string;
  /** Ordered stops. When set, each drop is its own row instead of one clipped line. */
  planStops?: readonly MissionPlanStop[] | null;
  /** Operational trip code — shown as the small second line under the route. */
  tripIdLabel?: string | null;
  /** Scheduled trip date — small, beside the route. */
  tripDateLabel?: string | null;
  /** Road distance remaining to `target`, in km — for the progress bar fill. Null when unknown. */
  remainingKm?: number | null;
  /** Total planned route distance, in km — for the progress bar fill. Null when unknown. */
  routeTotalKm?: number | null;
  /** Pre-formatted fallback/caption (e.g. "12 km to pickup") for when a numeric fraction isn't available. */
  distanceLabel: string;
  etaLabel: string;
  /** trip.vehicle_display_number — already on the trip row. */
  vehicleNumber?: string | null;
  /** e.g. "At pickup for 12 min" — from computeTripStageMetrics(), only while a dwell is running. */
  dwellLabel?: string | null;
  /** Action-oriented translation of Operational Alerts; null when nothing worth surfacing. */
  guidanceMessage?: string | null;
  /** Opens turn-by-turn navigation to the current target. */
  onNavigate?: (() => void) | null;
  /** Opens the order and product details sheet. */
  onViewDetails?: (() => void) | null;
}

export function MissionCardLayout({
  title: _title,
  earnings,
  earningsLabel = "EST. EARNINGS",
  assignedBy = null,
  onAssignerPress,
  showHeroAssigner,
  target,
  pickupLabel,
  dropLabel,
  planStops = null,
  tripIdLabel = null,
  tripDateLabel = null,
  remainingKm: _remainingKm = null,
  routeTotalKm: _routeTotalKm = null,
  distanceLabel,
  etaLabel,
  vehicleNumber = null,
  dwellLabel = null,
  guidanceMessage = null,
  onNavigate = null,
  onViewDetails = null,
}: MissionCardLayoutProps) {
  const showVehicleRow = !!vehicleNumber?.trim();

  const destinationHeading =
    target === 'pickup' ? 'PICKUP AT' : target === 'drop' ? 'DELIVER TO' : null;
  const showPlan = (planStops?.length ?? 0) > 1;
  const planRows = showPlan
    ? summarizePlanRows(missionPlanRows(pickupLabel, dropLabel, planStops))
    : [];
  const placeHeading = [pickupLabel, dropLabel]
    .map((part) => part.trim())
    .find((part) => part && part !== '—') ?? null;
  const destinationLabel = showPlan ? planRows.length > 0 : placeHeading;
  const tripRef = tripIdLabel?.trim() || null;
  const tripDate = tripDateLabel?.trim() || null;

  const caption =
    dwellLabel ??
    [distanceLabel, etaLabel !== '—' ? `${etaLabel} remaining` : null]
      .filter(Boolean)
      .join(' • ');
  const payIsBlank = /n\/a/i.test(earnings) || /n\/a/i.test(earningsLabel) || earnings.trim() === '—' || earnings.trim() === '';
  const assignerName = assignedBy?.linePrimary?.trim() || '';
  const bannerLabel = ['ACTIVE TRIP', assignedBy?.kindLabel?.trim()]
    .filter(Boolean)
    .join(' • ');

  return (
    <>
      <LinearGradient
        colors={[Theme.driverEmerald, Theme.driverPrimary]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.flowHero}
      >
        <Text style={styles.heroEyebrow} numberOfLines={1}>
          {bannerLabel}
        </Text>
      </LinearGradient>

      <View style={styles.contentWrap}>
        {destinationLabel ? (
          <View style={styles.destinationBlock}>
            <View style={styles.destinationTopRow}>
              <View style={styles.destinationTextCol}>
                {showPlan ? (
                  <>
                    <View style={styles.planMetaRow}>
                      <Text
                        style={[
                          styles.destinationHeading,
                          styles.planMetaLabel,
                          { color: Theme.textMuted, marginTop: 0 },
                        ]}
                        numberOfLines={1}
                      >
                        {tripRef ?? destinationHeading ?? 'TRIP PLAN'}
                      </Text>
                      {tripDate ? (
                        <Text
                          style={[styles.routeDate, { color: Theme.textMuted }]}
                          numberOfLines={1}
                        >
                          {tripDate}
                        </Text>
                      ) : null}
                      {onViewDetails ? (
                        <Pressable
                          onPress={onViewDetails}
                          accessibilityRole="button"
                          accessibilityLabel="View delivery details"
                          hitSlop={8}
                          style={styles.detailsChip}
                        >
                          <Text style={styles.detailsChipText}>View details</Text>
                        </Pressable>
                      ) : null}
                    </View>
                    <View style={styles.planList} accessibilityRole="summary">
                      {planRows.map((row, index) => {
                        const drop = row.kind === 'drop';
                        const last = index === planRows.length - 1;
                        return (
                          <View key={row.key} style={styles.planRow}>
                            <View style={styles.planRail}>
                              <View
                                style={[
                                  styles.planDot,
                                  {
                                    backgroundColor: drop ? Theme.driverGold : FLOW_EMERALD,
                                    borderColor: row.isCurrent
                                      ? drop
                                        ? Theme.driverGold
                                        : FLOW_EMERALD
                                      : 'transparent',
                                  },
                                ]}
                              />
                              {last ? null : (
                                <View style={[styles.planLine, { backgroundColor: Theme.border }]} />
                              )}
                            </View>
                            <View style={styles.planCopy}>
                              <Text
                                style={[
                                  styles.planCaption,
                                  { color: drop ? Theme.driverGold : FLOW_EMERALD },
                                ]}
                                numberOfLines={1}
                              >
                                {row.caption}
                              </Text>
                              <Text
                                style={[styles.planPlace, { color: Theme.textPrimaryDark }]}
                                numberOfLines={2}
                              >
                                {row.place}
                              </Text>
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  </>
                ) : (
                  <>
                    <Text
                      style={[styles.destinationLabel, { color: Theme.textPrimaryDark }]}
                      numberOfLines={2}
                    >
                      {placeHeading}
                    </Text>
                    <View style={styles.metaNavigateRow}>
                      <View style={styles.destinationTextCol}>
                        {tripRef ? (
                          <Text
                            style={[styles.destinationHeading, { color: Theme.textPrimaryDark, marginTop: 0 }]}
                            numberOfLines={1}
                          >
                            {tripRef}
                          </Text>
                        ) : destinationHeading ? (
                          <Text
                            style={[styles.destinationHeading, { color: Theme.textPrimaryDark, marginTop: 0 }]}
                            numberOfLines={1}
                          >
                            {destinationHeading}
                          </Text>
                        ) : null}
                        <Text
                          style={[styles.destinationCaption, { color: Theme.textMuted, marginTop: 2 }]}
                          numberOfLines={1}
                        >
                          {caption}
                        </Text>
                      </View>
                      {onNavigate ? (
                        <Pressable
                          onPress={onNavigate}
                          style={({ pressed }) => [
                            styles.navigateChip,
                            pressed && { opacity: 0.88 },
                          ]}
                          accessibilityRole="button"
                          accessibilityLabel="Open navigation"
                          hitSlop={8}
                        >
                          <Map size={16} color={FLOW_EMERALD} strokeWidth={2.4} />
                          <Text style={styles.navigateChipText}>NAVIGATE</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  </>
                )}
              </View>
              {showPlan && onNavigate ? (
                <Pressable
                  onPress={onNavigate}
                  style={({ pressed }) => [
                    styles.navigateChip,
                    pressed && { opacity: 0.88 },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Open navigation"
                  hitSlop={8}
                >
                  <Map size={16} color={FLOW_EMERALD} strokeWidth={2.4} />
                  <Text style={styles.navigateChipText}>NAVIGATE</Text>
                </Pressable>
              ) : null}
            </View>

            {showPlan ? (
              <Text
                style={[styles.destinationCaption, { color: Theme.textMuted }]}
                numberOfLines={1}
              >
                {caption}
              </Text>
            ) : null}
            {!payIsBlank ? (
              <Text style={[styles.payLine, { color: Theme.textMuted }]} numberOfLines={1}>
                {earningsLabel} {earnings}
              </Text>
            ) : null}
            {showHeroAssigner && assignerName && onAssignerPress ? (
              <Pressable onPress={onAssignerPress} accessibilityRole="button" accessibilityLabel="Tag the party">
                <Text style={[styles.payLine, { color: FLOW_EMERALD }]} numberOfLines={1}>
                  Assigned by {assignerName}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {showVehicleRow ? (
          <View style={styles.metaRow}>
            <Text
              style={[styles.metaSubValue, { color: Theme.textMuted }]}
              numberOfLines={1}
            >
              {vehicleNumber}
            </Text>
          </View>
        ) : null}

        {guidanceMessage ? (
          <View
            style={[styles.guidanceBanner, { backgroundColor: Theme.accentGoldMuted }]}
          >
            <AlertTriangle size={12} color={Theme.accentGold} strokeWidth={2.2} />
            <Text
              style={[styles.guidanceText, { color: Theme.accentGoldPressed }]}
              numberOfLines={2}
            >
              {guidanceMessage}
            </Text>
          </View>
        ) : null}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  /** Flush to sheet edges — same hero width as JobRequestCard. */
  flowHero: {
    paddingTop: 14,
    paddingHorizontal: TRIP_SHEET_HERO_PAD.horizontal,
    paddingBottom: 14,
  },
  contentWrap: {
    paddingHorizontal: TRIP_SHEET_BODY_PAD.horizontal,
    paddingTop: TRIP_SHEET_BODY_PAD.top,
    gap: TRIP_SHEET_BODY_PAD.gap,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  heroEyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    flex: 1,
    minWidth: 0,
  },
  heroEyebrow: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.8,
    color: Theme.textOnPrimary,
    textTransform: 'uppercase',
  },
  destinationBlock: {
    gap: 0,
  },
  destinationTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  destinationTextCol: {
    flex: 1,
    minWidth: 0,
  },
  planMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    minWidth: 0,
    marginBottom: 8,
  },
  planMetaLabel: {
    flex: 1,
    minWidth: 0,
  },
  detailsChip: {
    flexShrink: 0,
    minHeight: 32,
    paddingHorizontal: 10,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: FLOW_EMERALD,
  },
  detailsChipText: {
    fontSize: 12,
    fontWeight: '800',
    color: Theme.textOnPrimary,
  },
  planList: {
    gap: 0,
  },
  planRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 10,
    minWidth: 0,
  },
  planRail: {
    width: 14,
    alignItems: 'center',
  },
  planDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 3,
    borderWidth: 2,
    flexShrink: 0,
  },
  planLine: {
    width: 2,
    flex: 1,
    minHeight: 14,
    marginTop: 2,
    borderRadius: 1,
  },
  planCopy: {
    flex: 1,
    minWidth: 0,
    paddingBottom: 6,
    justifyContent: 'center',
  },
  planCaption: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  planPlace: {
    marginTop: 1,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: -0.15,
    lineHeight: 16,
  },
  routeTitleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
    minWidth: 0,
  },
  destinationHeading: {
    marginTop: 5,
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  destinationLabel: {
    flexShrink: 1,
    minWidth: 0,
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.6,
    lineHeight: 34,
  },
  metaNavigateRow: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  payLine: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: '700',
  },
  routeDate: {
    flexShrink: 0,
    fontSize: 12,
    fontWeight: '600',
  },
  navigateChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: Theme.surfaceGray,
    flexShrink: 0,
  },
  navigateChipText: {
    fontSize: 13,
    fontWeight: '800',
    color: FLOW_EMERALD,
    letterSpacing: 0.4,
  },
  progressBarTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: Theme.border,
    marginTop: 14,
  },
  progressBarFill: {
    height: 4,
    borderRadius: 2,
  },
  progressBarDot: {
    position: 'absolute',
    top: -4,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#fff',
    borderWidth: 3,
    marginLeft: -6,
  },
  destinationCaption: {
    marginTop: 10,
    fontSize: 13,
    fontWeight: '600',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minWidth: 0,
  },
  metaSubValue: {
    fontSize: 11,
    fontWeight: '600',
    flexShrink: 0,
  },
  guidanceBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    minWidth: 0,
  },
  guidanceText: {
    flex: 1,
    minWidth: 0,
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 16,
  },
});
