/**
 * Header for Network loads that cannot form an Indent Pool. Without pickup,
 * drop and vehicle there is no pool identity, so the load is not quotable —
 * its cards below are review-only.
 */
import Theme from "@/constants/Theme";
import { StyleSheet, Text, View } from "react-native";

export const INCOMPLETE_LANE_TITLE = "Incomplete lane";
export const INCOMPLETE_LANE_DETAIL =
  "Pickup, drop and vehicle are required before this load can be quoted.";

export function IncompleteLaneNotice() {
  return (
    <View
      style={styles.wrap}
      accessible
      accessibilityLabel={`${INCOMPLETE_LANE_TITLE}. ${INCOMPLETE_LANE_DETAIL}`}
      testID="network-incomplete-lane-notice"
    >
      <Text style={styles.title}>{INCOMPLETE_LANE_TITLE}</Text>
      <Text style={styles.detail}>{INCOMPLETE_LANE_DETAIL}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 8, marginBottom: 4, gap: 2, minWidth: 0 },
  title: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    color: Theme.textMuted,
  },
  detail: { fontSize: 12, fontWeight: "500", color: Theme.textSecondary },
});
