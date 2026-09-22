/**
 * Compact Hard Copy POD status card for Manifest Assets sidebar.
 */
import Theme from "@/constants/Theme";
import type {
  HardCopyPodStatus,
  TripHardCopyPodState,
} from "@/features/trips/services/tripDocumentLrPod.service";
import Feather from "@expo/vector-icons/Feather";
import { Pressable, StyleSheet, Text, View } from "react-native";

function statusColor(status: HardCopyPodStatus): string {
  if (status === "RECEIVED") return Theme.positive;
  if (status === "IN_TRANSIT") return Theme.warning;
  return Theme.textMuted;
}

function statusLabel(status: HardCopyPodStatus): string {
  if (status === "IN_TRANSIT") return "IN TRANSIT";
  return status;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const raw = String(iso).trim();
  const d = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? new Date(`${raw}T12:00:00`)
    : new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function HardCopyPodStatusCard({
  state,
  canManage,
  tripCompleted,
  onViewDetails,
  onUpdatePod,
  onLogPod,
}: {
  state: TripHardCopyPodState | null;
  canManage: boolean;
  tripCompleted: boolean;
  onViewDetails: () => void;
  onUpdatePod: () => void;
  onLogPod: () => void;
}) {
  const status = state?.status ?? "PENDING";
  const color = statusColor(status);
  const canLog = canManage && tripCompleted;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Feather name="file-text" size={13} color={Theme.textMuted} />
          <Text style={styles.title}>Hard Copy POD</Text>
        </View>
        <View style={[styles.pill, { backgroundColor: `${color}18` }]}>
          <View style={[styles.dot, { backgroundColor: color }]} />
          <Text style={[styles.pillText, { color }]}>{statusLabel(status)}</Text>
        </View>
      </View>

      {status === "RECEIVED" ? (
        <View style={styles.body}>
          {state?.receiptMethod === "courier" ? (
            <Text style={styles.meta}>Courier · {state.courier ?? "—"}</Text>
          ) : null}
          {state?.receivedBy ? (
            <Text style={styles.meta}>Received by · {state.receivedBy}</Text>
          ) : null}
          <Text style={styles.meta}>
            Date ·{" "}
            {formatDate(state?.receivedDate) !== "—"
              ? formatDate(state?.receivedDate)
              : formatDate(state?.receivedAt)}
          </Text>
          <Pressable
            onPress={onViewDetails}
            style={styles.linkBtn}
            accessibilityRole="button"
            accessibilityLabel="View POD details"
          >
            <Text style={styles.linkText}>View Details</Text>
          </Pressable>
        </View>
      ) : null}

      {status === "IN_TRANSIT" ? (
        <View style={styles.body}>
          <Text style={styles.metaStrong}>{state?.courier ?? "Courier"}</Text>
          <Text style={styles.awb}>AWB · {state?.awbNumber ?? "—"}</Text>
          {state?.dispatchDate ? (
            <Text style={styles.meta}>
              Dispatch · {formatDate(state.dispatchDate)}
            </Text>
          ) : null}
          {state?.expectedDeliveryDate ? (
            <Text style={styles.meta}>
              Expected · {formatDate(state.expectedDeliveryDate)}
            </Text>
          ) : null}
          <View style={styles.actionsRow}>
            <Pressable
              onPress={onViewDetails}
              style={styles.linkBtn}
              accessibilityRole="button"
              accessibilityLabel="View POD details"
            >
              <Text style={styles.linkText}>View Details</Text>
            </Pressable>
            {canManage ? (
              <Pressable
                onPress={onUpdatePod}
                style={styles.updateBtn}
                accessibilityRole="button"
                accessibilityLabel="Update POD"
              >
                <Text style={styles.updateBtnText}>Update POD</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}

      {status === "PENDING" ? (
        <View style={styles.body}>
          <Text style={styles.meta}>
            {tripCompleted
              ? "No hard-copy POD logged yet."
              : "Available after the trip is completed."}
          </Text>
          {canManage ? (
            <Pressable
              onPress={canLog ? onLogPod : undefined}
              disabled={!canLog}
              style={[styles.linkBtn, !canLog && styles.linkBtnLocked]}
              accessibilityRole="button"
              accessibilityState={{ disabled: !canLog }}
              accessibilityLabel={
                canLog
                  ? "Log Hard Copy POD"
                  : "Log Hard Copy POD locked until trip is completed"
              }
            >
              <Text style={[styles.linkText, !canLog && styles.linkTextLocked]}>
                Log Hard Copy POD
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    backgroundColor: Theme.surfaceGray,
    borderWidth: 1,
    borderColor: Theme.borderLight,
    padding: 12,
    gap: 8,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexShrink: 1,
  },
  title: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: Theme.textMuted,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  pillText: { fontSize: 10, fontWeight: "800", letterSpacing: 0.4 },
  body: { gap: 3 },
  meta: {
    fontSize: 12,
    color: Theme.textSecondary,
    fontWeight: "500",
  },
  metaStrong: {
    fontSize: 13,
    fontWeight: "700",
    color: Theme.textPrimaryDark,
  },
  awb: {
    fontSize: 12,
    fontWeight: "700",
    color: Theme.analyticsHeroBg,
    letterSpacing: 0.3,
  },
  actionsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 4,
    flexWrap: "wrap",
  },
  linkBtn: {
    minHeight: 36,
    justifyContent: "center",
  },
  linkBtnLocked: {
    opacity: 0.45,
  },
  linkText: {
    fontSize: 12,
    fontWeight: "700",
    color: Theme.analyticsHeroBg,
  },
  linkTextLocked: {
    color: Theme.textMuted,
  },
  updateBtn: {
    minHeight: 32,
    borderRadius: 8,
    paddingHorizontal: 10,
    backgroundColor: Theme.warningMuted,
    borderWidth: 1,
    borderColor: Theme.warning,
    alignItems: "center",
    justifyContent: "center",
  },
  updateBtnText: {
    fontSize: 11,
    fontWeight: "800",
    color: Theme.warning,
    letterSpacing: 0.3,
  },
});
