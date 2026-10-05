import Theme from "@/constants/Theme";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

export type ComplianceSegmentOption<T extends string> = {
  id: T;
  label: string;
  /** Longer name for screen readers when `label` is shortened. */
  a11yLabel?: string;
  /** Status dot color; omit or null for no dot (e.g. All). */
  dot?: string | null;
};

/**
 * Compact segmented control (All / Verified / Rejected style) used above
 * Compliance card lists and under stage chips for Pending Docs / CP slices.
 */
export function ComplianceSegmentedFilter<T extends string>({
  value,
  counts,
  options,
  onChange,
  embedded = false,
}: {
  value: T;
  counts: Record<T, number>;
  options: readonly ComplianceSegmentOption<T>[];
  onChange: (next: T) => void;
  /** When true, omit outer bar padding (toolbar / nested placement). */
  embedded?: boolean;
}) {
  return (
    <View style={[styles.bar, embedded && styles.barEmbedded]}>
      <View style={styles.track} accessibilityRole="tablist">
        {options.map((option) => {
          const active = option.id === value;
          const count = counts[option.id] ?? 0;
          return (
            <Pressable
              key={option.id}
              onPress={() => onChange(option.id)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${option.a11yLabel ?? option.label}, ${count} trips`}
              hitSlop={{ top: 8, bottom: 8 }}
              style={({ pressed }) => [
                styles.segment,
                active && styles.segmentActive,
                pressed && !active && styles.segmentPressed,
              ]}
            >
              <View style={styles.segmentInner}>
                {option.dot ? <View style={[styles.dot, { backgroundColor: option.dot }]} /> : null}
                <Text style={[styles.label, active && styles.labelActive]} numberOfLines={1}>
                  {option.label}
                </Text>
                <Text style={[styles.count, active && styles.countActive]}>{count}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.complianceCardBorder,
    backgroundColor: Theme.cardWhite,
  },
  barEmbedded: {
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: 0,
    borderBottomWidth: 0,
    backgroundColor: "transparent",
    alignSelf: "stretch",
    width: "100%",
    maxWidth: 560,
  },
  track: {
    flexDirection: "row",
    alignItems: "center",
    padding: 2,
    gap: 2,
    borderRadius: 10,
    backgroundColor: Theme.screenBackground,
    borderWidth: 1,
    borderColor: Theme.complianceCardBorder,
  },
  segment: {
    flex: 1,
    minWidth: 0,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "transparent",
  },
  segmentActive: {
    backgroundColor: Theme.cardWhite,
    borderColor: Theme.textPrimaryDark,
    shadowColor: Theme.textPrimaryDark,
    shadowOpacity: 0.06,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  segmentPressed: { opacity: 0.7 },
  segmentInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    maxWidth: "100%",
    minWidth: 0,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    flexShrink: 0,
  },
  label: {
    flexShrink: 1,
    minWidth: 0,
    fontSize: 10,
    lineHeight: 12,
    fontWeight: "500",
    color: Theme.textSecondary,
    includeFontPadding: false,
  },
  labelActive: { color: Theme.textPrimaryDark, fontWeight: "700" },
  count: {
    flexShrink: 0,
    fontSize: 10,
    lineHeight: 12,
    fontWeight: "600",
    color: Theme.textMuted,
    fontVariant: ["tabular-nums"],
    includeFontPadding: false,
  },
  countActive: { color: Theme.textPrimaryDark, fontWeight: "700" },
});
