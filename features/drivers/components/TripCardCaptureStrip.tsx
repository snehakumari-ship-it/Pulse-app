import Theme from "@/constants/Theme";
import { DriverCapturePaymentButton } from "@/features/drivers/components/DriverCapturePaymentButton";
import type { DriverCaptureLane } from "@/features/drivers/utils/driverCapturePayment.util";
import Feather from "@expo/vector-icons/Feather";
import { Pressable, StyleSheet, Text, View } from "react-native";

export type TripCardCapture = {
  received: number;
  due: number;
  tripId: string;
  lane: DriverCaptureLane;
  partyName?: string;
  /** Same gate as the party receivables row: tagged or marketplace, with money still due. */
  canCapture: boolean;
  needsTag: boolean;
  onTagPress?: () => void;
};

type Props = {
  /** Received / due block; omitted for trips with nothing to collect. */
  capture: TripCardCapture | null;
  onLogExpense: () => void;
  /** Stops the parent trip card from opening when an action is tapped. */
  onActionTouchStart?: () => void;
};

const HIT_SLOP = { top: 4, bottom: 4, left: 4, right: 4 };

function inr(amount: number): string {
  return `₹${Math.max(0, Math.round(amount)).toLocaleString("en-IN")}`;
}

/** Received, due, Log expense and Capture — the trip's money actions on the card. */
export function TripCardActionPanel({ capture, onLogExpense, onActionTouchStart }: Props) {
  const received = capture ? Math.max(0, capture.received) : 0;
  const due = capture ? Math.max(0, capture.due) : 0;
  const billed = received + due;
  const settled = Boolean(capture) && due <= 0 && received > 0;
  const collectedPct = billed > 0 ? Math.min(100, Math.round((received / billed) * 100)) : 0;

  const trailing = !capture
    ? null
    : capture.canCapture ? (
        <DriverCapturePaymentButton
          tripId={capture.tripId}
          due={due}
          lane={capture.lane}
          partyName={capture.partyName}
          pill
        />
      ) : capture.needsTag ? (
        <Pressable
          onPress={capture.onTagPress}
          disabled={!capture.onTagPress}
          accessibilityRole="button"
          accessibilityLabel="Tag the party to capture payment"
          hitSlop={HIT_SLOP}
          style={({ pressed }) => [
            styles.actionBtn,
            styles.tagBtn,
            pressed && capture.onTagPress ? styles.pressed : null,
          ]}
        >
          <Feather name="tag" size={14} color={Theme.warning} />
          <Text style={[styles.actionText, { color: Theme.warning }]}>Tag party</Text>
        </Pressable>
      ) : settled ? (
        <View style={[styles.actionBtn, styles.settledPill]}>
          <Feather name="check-circle" size={14} color={Theme.positive} />
          <Text style={[styles.actionText, { color: Theme.positive }]}>Settled</Text>
        </View>
      ) : null;

  return (
    <View style={[styles.panel, !capture && styles.panelBare]}>
      {capture ? (
        <View style={styles.metricsBlock}>
          <View style={styles.metricsRow}>
            <View style={styles.metric}>
              <Text style={styles.kicker}>Received</Text>
              <Text style={[styles.amount, { color: Theme.positive }]} numberOfLines={1}>
                {inr(received)}
              </Text>
            </View>
            <View style={styles.rule} />
            <View style={[styles.metric, styles.metricEnd]}>
              <Text style={[styles.kicker, styles.kickerEnd]}>Due</Text>
              <Text
                style={[
                  styles.amount,
                  styles.amountEnd,
                  { color: due > 0 ? Theme.negative : Theme.positive },
                ]}
                numberOfLines={1}
              >
                {inr(due)}
              </Text>
            </View>
          </View>
          {billed > 0 ? (
            <View
              style={styles.track}
              accessibilityLabel={`${collectedPct}% collected`}
            >
              <View style={[styles.trackFill, { width: `${collectedPct}%` }]} />
            </View>
          ) : null}
        </View>
      ) : null}
      <View style={styles.actionsRow}>
        {billed > 0 ? (
          <Text style={styles.collectedNote} numberOfLines={1}>
            <Text style={styles.collectedPct}>{collectedPct}%</Text> collected
          </Text>
        ) : (
          <View style={styles.spacer} />
        )}
        <View
          style={styles.actionsGroup}
          onStartShouldSetResponder={() => {
            onActionTouchStart?.();
            return false;
          }}
        >
          <Pressable
            onPressIn={onActionTouchStart}
            onPress={onLogExpense}
            accessibilityRole="button"
            accessibilityLabel="Log expense"
            hitSlop={HIT_SLOP}
            style={({ pressed }) => [
              styles.actionBtn,
              styles.expenseBtn,
              pressed ? styles.pressed : null,
            ]}
          >
            <Feather name="plus" size={14} color={Theme.driverEmeraldDark} />
            <Text style={[styles.actionText, { color: Theme.driverEmeraldDark }]} numberOfLines={1}>
              Log expense
            </Text>
          </Pressable>
          {trailing}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    marginTop: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Theme.borderLight,
    backgroundColor: Theme.cardWhite,
    padding: 10,
    gap: 10,
  },
  panelBare: {
    padding: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
  },
  metricsBlock: {
    gap: 8,
  },
  metricsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  metric: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  metricEnd: {
    alignItems: "flex-end",
  },
  kicker: {
    fontSize: 8,
    fontWeight: "700",
    letterSpacing: 0.55,
    textTransform: "uppercase",
    color: Theme.textMuted,
    lineHeight: 10,
  },
  kickerEnd: {
    textAlign: "right",
  },
  amount: {
    fontSize: 15,
    fontWeight: "800",
    letterSpacing: -0.3,
    lineHeight: 18,
  },
  amountEnd: {
    textAlign: "right",
  },
  rule: {
    width: StyleSheet.hairlineWidth,
    alignSelf: "stretch",
    backgroundColor: Theme.borderLight,
  },
  track: {
    height: 4,
    borderRadius: 2,
    backgroundColor: Theme.borderLight,
    overflow: "hidden",
  },
  trackFill: {
    height: "100%",
    borderRadius: 2,
    backgroundColor: Theme.positive,
  },
  actionsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  actionsGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexShrink: 0,
  },
  spacer: {
    flex: 1,
  },
  collectedNote: {
    flex: 1,
    minWidth: 0,
    fontSize: 11,
    fontWeight: "600",
    color: Theme.textMuted,
  },
  collectedPct: {
    fontWeight: "800",
    color: Theme.textPrimary,
  },
  actionBtn: {
    height: 36,
    minWidth: 96,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingHorizontal: 14,
  },
  actionText: {
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: -0.1,
  },
  expenseBtn: {
    borderWidth: 1,
    borderColor: Theme.driverEmeraldBorderSoft,
    backgroundColor: Theme.driverEmeraldMuted,
  },
  tagBtn: {
    borderWidth: 1,
    borderColor: Theme.warning,
    backgroundColor: Theme.warningMuted,
  },
  settledPill: {
    backgroundColor: Theme.driverEmeraldMuted,
  },
  pressed: {
    opacity: 0.82,
  },
});
