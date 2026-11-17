import Feather from "@expo/vector-icons/Feather";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from "react-native";

import Theme from "@/constants/Theme";
import Typography from "@/constants/Typography";

import { ExpenseBillScanOverlay } from "./ExpenseBillScanOverlay";

type Props = {
  uri?: string | null;
  title?: string;
  emptyTitle?: string;
  hint?: string;
  emptyHint?: string;
  scanning?: boolean;
  busy?: boolean;
  scanLabel?: string;
  compact?: boolean;
  /** Match a compact amount field: short control, no inner title row. */
  fieldSized?: boolean;
  /** Nested inside a parent card — no own border/shadow. */
  embedded?: boolean;
  onAttach: () => void;
  onPress?: () => void;
  onRetake?: () => void;
  onRemove?: () => void;
};

/**
 * Fixed-height body photo slot for driver odometer / expense entry.
 * Shows preview when attached, or a camera affordance in the same layout when empty.
 */
export function OpsEntryBodyPhotoSlot({
  uri,
  title = "Attached photo",
  emptyTitle,
  hint = "Tap image to enlarge",
  emptyHint = "Photograph the bill to auto-fill fields",
  scanning = false,
  busy = false,
  scanLabel = "AI scan",
  compact = false,
  fieldSized = false,
  embedded = false,
  onAttach,
  onPress,
  onRetake,
  onRemove,
}: Props) {
  const hasPhoto = !!uri?.trim();
  const slotTitle = hasPhoto ? title : (emptyTitle ?? title);
  const slotHint = hasPhoto ? (scanning ? "Reading photo…" : hint) : emptyHint;
  const iconColor = Theme.textMuted;

  return (
    <View
      style={[
        styles.card,
        compact && styles.cardCompact,
        compact && !fieldSized && styles.cardCompactFill,
        fieldSized && styles.cardFieldSized,
        embedded && styles.cardEmbedded,
      ]}
    >
      {!fieldSized ? (
        <View style={styles.headerRow}>
          <View style={styles.titleRow}>
            <Feather
              name={hasPhoto ? "image" : "camera"}
              size={11}
              color={iconColor}
            />
            <Text style={styles.title}>{slotTitle}</Text>
          </View>
          {hasPhoto && !compact ? (
            <View style={styles.actions}>
              {onRetake ? (
                <Pressable
                  style={styles.actionBtn}
                  onPress={onRetake}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel="Retake photo"
                >
                  <Feather name="refresh-cw" size={10} color={Theme.textMuted} />
                  <Text style={styles.actionText}>Retake</Text>
                </Pressable>
              ) : null}
              {onRemove ? (
                <Pressable
                  style={[styles.actionBtn, styles.actionBtnDanger]}
                  onPress={onRemove}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel="Remove photo"
                >
                  <Feather name="trash-2" size={10} color={Theme.destructive} />
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}

      {hasPhoto ? (
        <Pressable
          style={[
            fieldSized
              ? styles.previewWrapField
              : compact
                ? styles.previewWrapCompactFilled
                : styles.previewWrap,
            scanning && styles.previewWrapScanning,
          ]}
          onPress={onPress ?? onAttach}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={onPress ? "View attached bill full screen" : "Retake bill photo"}
        >
          <Image
            source={{ uri: uri! }}
            style={styles.previewImage}
            resizeMode="cover"
          />
          <ExpenseBillScanOverlay visible={scanning} scanTravel={108} label={scanLabel} />
          {compact && !fieldSized ? (
            <View style={styles.compactOverlay} pointerEvents="box-none">
              <View style={styles.compactOverlayTop}>
                {onRemove ? (
                  <Pressable
                    style={[styles.compactIconBtn, styles.compactIconBtnDanger]}
                    onPress={onRemove}
                    disabled={busy}
                    hitSlop={6}
                    accessibilityRole="button"
                    accessibilityLabel="Remove bill photo"
                  >
                    <Feather name="trash-2" size={11} color={Theme.destructive} />
                  </Pressable>
                ) : null}
                {onRetake ? (
                  <Pressable
                    style={styles.compactIconBtn}
                    onPress={onRetake}
                    disabled={busy}
                    hitSlop={6}
                    accessibilityRole="button"
                    accessibilityLabel="Retake bill photo"
                  >
                    <Feather name="refresh-cw" size={11} color={Theme.textPrimaryDark} />
                  </Pressable>
                ) : null}
              </View>
              <View style={styles.compactPreviewHint}>
                <Feather name="maximize-2" size={10} color="#fff" />
                <Text style={styles.compactPreviewHintText}>Preview</Text>
              </View>
            </View>
          ) : null}
          {fieldSized ? (
            <View style={styles.fieldOverlay} pointerEvents="box-none">
              {onRemove ? (
                <Pressable
                  style={[styles.compactIconBtn, styles.compactIconBtnDanger, styles.fieldIconBtn]}
                  onPress={onRemove}
                  disabled={busy}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel="Remove bill photo"
                >
                  <Feather name="trash-2" size={11} color={Theme.destructive} />
                </Pressable>
              ) : null}
              {onRetake ? (
                <Pressable
                  style={[styles.compactIconBtn, styles.fieldIconBtn]}
                  onPress={onRetake}
                  disabled={busy}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel="Retake bill photo"
                >
                  <Feather name="refresh-cw" size={11} color={Theme.textPrimaryDark} />
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </Pressable>
      ) : (
        <Pressable
          style={[
            fieldSized
              ? styles.previewWrapFieldEmpty
              : compact
                ? styles.previewWrapCompactEmpty
                : styles.emptyWrap,
            busy && styles.emptyWrapBusy,
          ]}
          onPress={onAttach}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Attach photo"
        >
          {busy ? (
            <>
              <ActivityIndicator color={Theme.driverEmeraldDark} size="small" />
              <Text style={styles.emptyBtnText}>{scanning ? "Scanning…" : "Working…"}</Text>
            </>
          ) : (
            <>
              {!fieldSized && compact ? (
                <Feather
                  name="camera"
                  size={16}
                  color={Theme.textMuted}
                  strokeWidth={2}
                />
              ) : !fieldSized ? (
                <View style={styles.emptyIconRing}>
                  <Feather name="camera" size={22} color={iconColor} />
                </View>
              ) : null}
              <Text
                style={[
                  styles.emptyBtnText,
                  compact && styles.emptyBtnTextCompact,
                  fieldSized && styles.emptyBtnTextField,
                ]}
              >
                Attach photo
              </Text>
              {!compact && !fieldSized ? (
                <Text style={styles.emptySubtext}>Camera or gallery</Text>
              ) : null}
            </>
          )}
        </Pressable>
      )}

      {!compact ? (
        <Text style={styles.hint} numberOfLines={2}>
          {slotHint}
        </Text>
      ) : null}
    </View>
  );
}

/** @deprecated Use OpsEntryBodyPhotoSlot — kept for callers that always have a uri. */
export function OpsEntryBodyPhotoPreview(
  props: Omit<Props, "onAttach"> & { uri: string; onAttach?: () => void },
) {
  return (
    <OpsEntryBodyPhotoSlot
      {...props}
      onAttach={props.onAttach ?? props.onRetake ?? (() => {})}
    />
  );
}

const COMPACT_PREVIEW_H = 96;
/** Same height as SmartInput `density="compact"` `fieldCompact`. */
const FIELD_CONTROL_H = 40;

const styles = StyleSheet.create({
  card: {
    borderRadius: 18,
    borderWidth: 0,
    borderColor: "transparent",
    backgroundColor: "transparent",
    padding: 0,
    gap: 10,
  },
  cardCompact: {
    padding: 0,
    gap: 8,
  },
  cardCompactFill: {
    flex: 1,
  },
  cardFieldSized: {
    flexGrow: 0,
    flexShrink: 0,
    alignSelf: "stretch",
  },
  cardEmbedded: {
    borderWidth: 0,
    backgroundColor: "transparent",
    borderRadius: 0,
    padding: 0,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    flex: 1,
    minWidth: 0,
  },
  title: {
    ...Typography.headerTitle,
    fontSize: 10,
    letterSpacing: 0.7,
    color: Theme.textMuted,
    flexShrink: 1,
    textTransform: "uppercase",
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    flexShrink: 0,
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(148,163,184,0.3)",
    backgroundColor: "rgba(148,163,184,0.1)",
  },
  actionBtnDanger: {
    borderColor: "rgba(239,68,68,0.25)",
    backgroundColor: "rgba(254,226,226,0.5)",
    paddingHorizontal: 6,
  },
  actionText: {
    fontSize: 9,
    fontWeight: "700",
    color: Theme.textMuted,
  },
  previewWrap: {
    position: "relative",
    height: 148,
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(15,23,42,0.08)",
    backgroundColor: "#F3F4F6",
  },
  previewWrapCompactFilled: {
    position: "relative",
    height: COMPACT_PREVIEW_H,
    minHeight: COMPACT_PREVIEW_H,
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(15,23,42,0.08)",
    backgroundColor: "#F3F4F6",
  },
  previewWrapField: {
    position: "relative",
    width: "100%",
    alignSelf: "stretch",
    height: FIELD_CONTROL_H,
    minHeight: FIELD_CONTROL_H,
    maxHeight: FIELD_CONTROL_H,
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Theme.borderInput,
    backgroundColor: Theme.whiteMuted,
  },
  previewWrapFieldEmpty: {
    width: "100%",
    alignSelf: "stretch",
    height: FIELD_CONTROL_H,
    minHeight: FIELD_CONTROL_H,
    maxHeight: FIELD_CONTROL_H,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: "solid",
    borderColor: Theme.borderInput,
    backgroundColor: Theme.whiteMuted,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
    gap: 8,
    paddingHorizontal: 12,
  },
  previewWrapCompactEmpty: {
    height: COMPACT_PREVIEW_H,
    minHeight: COMPACT_PREVIEW_H,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: "solid",
    borderColor: Theme.borderInput,
    backgroundColor: Theme.whiteMuted,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
    gap: 8,
    paddingHorizontal: 12,
  },
  previewWrapScanning: {
    borderColor: "#6ee7b7",
    shadowColor: Theme.driverEmeraldDark,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
  },
  previewImage: {
    ...StyleSheet.absoluteFillObject,
    width: "100%",
    height: "100%",
  },
  fieldOverlay: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 4,
  },
  fieldIconBtn: {
    width: 22,
    height: 22,
    borderRadius: 11,
  },
  compactOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "space-between",
    padding: 6,
  },
  compactOverlayTop: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 4,
  },
  compactIconBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.92)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(148,163,184,0.35)",
  },
  compactIconBtnDanger: {
    backgroundColor: "rgba(254,226,226,0.95)",
    borderColor: "rgba(239,68,68,0.28)",
  },
  compactPreviewHint: {
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "rgba(15,23,42,0.55)",
  },
  compactPreviewHintText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#fff",
    letterSpacing: 0.2,
  },
  emptyWrap: {
    height: 148,
    borderRadius: 18,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: "rgba(15,23,42,0.14)",
    backgroundColor: "#F3F4F6",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 16,
  },
  emptyWrapBusy: {
    borderStyle: "solid",
    borderColor: "rgba(15,23,42,0.1)",
  },
  emptyIconRing: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(15,23,42,0.08)",
  },
  emptyIconRingCompact: {
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  emptyIconRingField: {
    width: 22,
    height: 22,
    borderRadius: 11,
  },
  emptyBtnText: {
    fontSize: 13,
    fontWeight: "700",
    color: Theme.textPrimaryDark,
    letterSpacing: -0.1,
  },
  emptyBtnTextCompact: {
    fontSize: 13,
    fontWeight: "700",
    color: Theme.textPrimaryDark,
    letterSpacing: -0.15,
  },
  emptyBtnTextField: {
    fontSize: 13,
    fontWeight: "700",
    color: Theme.textPrimaryDark,
    letterSpacing: -0.15,
  },
  emptySubtext: {
    fontSize: 11,
    fontWeight: "500",
    color: Theme.textMuted,
  },
  hint: {
    fontSize: 11,
    fontWeight: "500",
    color: Theme.textMuted,
    textAlign: "center",
    lineHeight: 15,
  },
});
