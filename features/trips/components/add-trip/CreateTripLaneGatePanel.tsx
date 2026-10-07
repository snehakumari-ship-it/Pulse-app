/**
 * Full-page gate after billing client is chosen: pick a contract lane or continue as adhoc.
 */
import Theme from "@/constants/Theme";
import { ClientLaneSearchPicker } from "@/features/clients/components/ClientLaneSearchPicker";
import type { ClientLaneRate } from "@/features/clients/types/clientManagement.types";
import { METRONIC } from "@/features/clients/components/desktop/clientProfileHub.styles";
import { FileText, Route } from "lucide-react-native";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

type Props = {
  clientName?: string | null;
  lanes: readonly ClientLaneRate[];
  loading?: boolean;
  selectedLaneId: string | null;
  onSelectLane: (lane: ClientLaneRate) => void;
  onClearLane?: () => void;
  onChooseAdhoc: () => void;
  onChangeClient?: () => void;
  laneSearch?: string;
  onLaneSearchChange?: (value: string) => void;
  compact?: boolean;
};

export function CreateTripLaneGatePanel({
  clientName,
  lanes,
  loading = false,
  selectedLaneId,
  onSelectLane,
  onClearLane,
  onChooseAdhoc,
  onChangeClient,
  laneSearch,
  onLaneSearchChange,
  compact = false,
}: Props) {
  return (
    <View style={[styles.root, !compact && styles.rootFill, compact && styles.rootCompact]}>
      <View style={[styles.header, compact && styles.headerCompact]}>
        <Text style={[styles.kicker, compact && styles.kickerCompact]}>Lane preference</Text>
        <Text style={[styles.title, compact && styles.titleCompact]} numberOfLines={compact ? 1 : 2}>
          {clientName?.trim() ? `${clientName.trim()} · contracts` : "Contract or adhoc"}
        </Text>
        {!compact ? (
          <Text style={styles.sub}>
            Pick a contract lane to auto-fill route and sale, or continue as an adhoc trip.
          </Text>
        ) : (
          <Text style={styles.subCompact} numberOfLines={2}>
            Pick a lane to auto-fill route & sale, or continue adhoc.
          </Text>
        )}
        {onChangeClient ? (
          <Pressable
            onPress={onChangeClient}
            hitSlop={8}
            style={[styles.changeClientBtn, compact && styles.changeClientBtnCompact]}
          >
            <Text style={[styles.changeClientText, compact && styles.changeClientTextCompact]}>
              Change client
            </Text>
          </Pressable>
        ) : null}
      </View>

      <View style={[styles.modeRow, compact && styles.modeRowCompact]}>
        <View style={[styles.modeChip, compact && styles.modeChipCompact, styles.modeChipActive]}>
          <FileText
            size={compact ? 11 : 13}
            color={Theme.textOnPrimary}
            strokeWidth={2.3}
          />
          <Text
            style={[styles.modeChipTextActive, compact && styles.modeChipTextCompact]}
            numberOfLines={1}
          >
            Contract
          </Text>
        </View>
        <Pressable
          onPress={onChooseAdhoc}
          style={[styles.modeChip, compact && styles.modeChipCompact]}
          accessibilityRole="button"
          accessibilityLabel="Continue as adhoc trip"
        >
          <Route size={compact ? 11 : 13} color={METRONIC.text} strokeWidth={2.3} />
          <Text
            style={[styles.modeChipText, compact && styles.modeChipTextCompact]}
            numberOfLines={1}
          >
            Adhoc
          </Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={[styles.loadingWrap, compact && styles.loadingWrapCompact]}>
          <ActivityIndicator color={METRONIC.link} />
          <Text style={styles.loadingText}>Loading contract lanes…</Text>
        </View>
      ) : (
        <>
          <ClientLaneSearchPicker
            lanes={lanes}
            loading={false}
            selectedLaneId={selectedLaneId}
            onSelect={onSelectLane}
            onClear={onClearLane}
            search={laneSearch}
            onSearchChange={onLaneSearchChange}
            compact={compact}
          />
          <Pressable
            onPress={onChooseAdhoc}
            style={({ pressed }) => [
              styles.adhocCta,
              compact && styles.adhocCtaCompact,
              pressed && { opacity: 0.92 },
            ]}
            accessibilityRole="button"
          >
            <Text style={[styles.adhocCtaTitle, compact && styles.adhocCtaTitleCompact]}>
              Continue as adhoc
            </Text>
            <Text
              style={[styles.adhocCtaSub, compact && styles.adhocCtaSubCompact]}
              numberOfLines={compact ? 1 : 2}
            >
              {compact
                ? "Skip contracts — enter route & sale manually."
                : "Skip contracts — enter route and sale manually on the next screen."}
            </Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: 12,
    paddingBottom: 8,
    width: "100%",
    alignSelf: "stretch",
  },
  rootFill: {
    flex: 1,
    minHeight: 0,
  },
  rootCompact: {
    gap: 10,
    paddingBottom: 8,
  },
  header: {
    gap: 4,
  },
  headerCompact: {
    gap: 2,
  },
  kicker: {
    fontSize: 10,
    fontWeight: "800",
    color: METRONIC.muted,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  kickerCompact: {
    fontSize: 9,
    letterSpacing: 0.45,
  },
  title: {
    fontSize: 16,
    fontWeight: "800",
    color: METRONIC.text,
  },
  titleCompact: {
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: -0.2,
  },
  sub: {
    fontSize: 12,
    fontWeight: "500",
    color: METRONIC.subtle,
    lineHeight: 16,
  },
  subCompact: {
    fontSize: 11,
    fontWeight: "500",
    color: METRONIC.subtle,
    lineHeight: 14,
    marginTop: 1,
  },
  changeClientBtn: {
    alignSelf: "flex-start",
    marginTop: 4,
    paddingVertical: 2,
  },
  changeClientBtnCompact: {
    marginTop: 2,
    paddingVertical: 4,
    minHeight: 28,
    justifyContent: "center",
  },
  changeClientText: {
    fontSize: 12,
    fontWeight: "700",
    color: METRONIC.link,
  },
  changeClientTextCompact: {
    fontSize: 11,
  },
  modeRow: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 8,
    width: "100%",
    flexShrink: 0,
  },
  modeRowCompact: {
    gap: 8,
  },
  modeChip: {
    flex: 1,
    flexBasis: 0,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: METRONIC.border,
    backgroundColor: Theme.cardWhite,
    paddingHorizontal: 10,
  },
  modeChipCompact: {
    minHeight: 44,
    borderRadius: 10,
    gap: 6,
    paddingHorizontal: 8,
  },
  modeChipActive: {
    backgroundColor: Theme.textPrimaryDark,
    borderColor: Theme.textPrimaryDark,
  },
  modeChipText: {
    fontSize: 12,
    fontWeight: "700",
    color: METRONIC.text,
  },
  modeChipTextActive: {
    fontSize: 12,
    fontWeight: "700",
    color: Theme.textOnPrimary,
  },
  modeChipTextCompact: {
    fontSize: 11,
  },
  loadingWrap: {
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 28,
  },
  loadingWrapCompact: {
    paddingVertical: 18,
    gap: 6,
  },
  loadingText: {
    fontSize: 12,
    fontWeight: "500",
    color: METRONIC.muted,
  },
  adhocCta: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: METRONIC.border,
    backgroundColor: Theme.surfaceGray,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 2,
  },
  adhocCtaCompact: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 1,
  },
  adhocCtaTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: METRONIC.text,
  },
  adhocCtaTitleCompact: {
    fontSize: 12,
  },
  adhocCtaSub: {
    fontSize: 11,
    fontWeight: "500",
    color: METRONIC.subtle,
    lineHeight: 15,
  },
  adhocCtaSubCompact: {
    fontSize: 10,
    lineHeight: 13,
  },
});
