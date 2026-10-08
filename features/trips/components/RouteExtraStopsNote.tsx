import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import Theme from "@/constants/Theme";
import {
  extraStopChipLabel,
  extraStopPaidLabel,
  type RouteExtraStopSummary,
} from "@/features/trips/utils/routeExtraStops.util";
import { formatINR } from "@/lib/format";

type Props = {
  summary: RouteExtraStopSummary;
  /** Which charge the viewer may see: owners "client", bidders/suppliers "supplier". */
  side: "client" | "supplier";
  /** Chip only, for dense list cards. */
  chipOnly?: boolean;
  style?: StyleProp<ViewStyle>;
};

/** "+1 stop" chip with the extra amount already folded into the shown freight. */
export function RouteExtraStopsNote({ summary, side, chipOnly = false, style }: Props) {
  const chip = extraStopChipLabel(summary.count);
  if (!chip) return null;
  const paid = chipOnly ? null : extraStopPaidLabel(summary, side, formatINR);
  return (
    <View
      style={[styles.row, style]}
      accessibilityLabel={paid ? `${chip} in between, ${paid}` : `${chip} in between`}
    >
      <View style={styles.chip}>
        <Text style={styles.chipText} numberOfLines={1}>
          {chip}
        </Text>
      </View>
      {paid ? (
        <Text style={styles.paid} numberOfLines={1}>
          {paid}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minWidth: 0,
  },
  chip: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: Theme.primaryLight,
  },
  chipText: {
    fontSize: 11,
    fontWeight: "700",
    color: Theme.textPrimaryDark,
  },
  paid: {
    flexShrink: 1,
    fontSize: 11,
    fontWeight: "600",
    color: Theme.textRouteCard,
  },
});
