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
 * Segmented control for Compliance queues. Chips share the panel width evenly
 * (no horizontal scroll). Use `cardDense` for the card-list header only —
 * table toolbar keeps the default compact sizing.
 */
export function ComplianceSegmentedFilter<T extends string>({
  value,
  counts,
  options,
  onChange,
  embedded = false,
  compact = false,
  cardDense = false,
}: {
  value: T;
  counts: Record<T, number>;
  options: readonly ComplianceSegmentOption<T>[];
  onChange: (next: T) => void;
  /** When true, omit outer bar padding (toolbar / nested placement). */
  embedded?: boolean;
  /** Slightly denser padding for stacked Pending Docs filters. */
  compact?: boolean;
  /**
   * Card-list header only: denser chips; full label + count stay readable
   * (label may wrap to 2 lines). Leave false for table view.
   */
  cardDense?: boolean;
}) {
  return (
    <View style={[styles.bar, embedded && styles.barEmbedded, cardDense && styles.barCardDense]}>
      <View
        style={[
          styles.track,
          compact && styles.trackCompact,
          cardDense && styles.trackCardDense,
        ]}
        accessibilityRole="tablist"
      >
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
              hitSlop={{ top: 6, bottom: 6 }}
              style={({ pressed }) => [
                styles.segment,
                compact && styles.segmentCompact,
                cardDense && styles.segmentCardDense,
                active && styles.segmentActive,
                pressed && !active && styles.segmentPressed,
              ]}
            >
              {cardDense ? (
                <View style={styles.segmentInnerCardDense}>
                  {option.dot ? (
                    <View style={[styles.dotCardDense, { backgroundColor: option.dot }]} />
                  ) : (
                    <View style={styles.dotCardDenseSpacer} />
                  )}
                  <Text
                    style={[styles.cardDenseCopy, active && styles.labelActive]}
                    numberOfLines={2}
                  >
                    {option.label}{" "}
                    <Text style={[styles.cardDenseCount, active && styles.countActive]}>{count}</Text>
                  </Text>
                </View>
              ) : (
                <View style={styles.segmentInner}>
                  {option.dot ? <View style={[styles.dot, { backgroundColor: option.dot }]} /> : null}
                  <Text style={[styles.label, active && styles.labelActive]} numberOfLines={2}>
                    {option.label}
                  </Text>
                  <Text style={[styles.count, active && styles.countActive]} numberOfLines={1}>
                    {count}
                  </Text>
                </View>
              )}
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
    minWidth: "100%",
  },
  barCardDense: {
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: 0,
  },
  track: {
    flexDirection: "row",
    alignItems: "stretch",
    alignSelf: "stretch",
    width: "100%",
    minWidth: "100%",
    padding: 3,
    gap: 3,
    borderRadius: 10,
    backgroundColor: Theme.compliancePageBg,
    borderWidth: 1,
    borderColor: Theme.complianceCardBorder,
  },
  trackCompact: {
    borderRadius: 8,
    padding: 2,
    gap: 2,
  },
  trackCardDense: {
    borderRadius: 7,
    padding: 2,
    gap: 2,
  },
  segment: {
    flex: 1,
    minWidth: 0,
    minHeight: 32,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "transparent",
  },
  segmentCompact: {
    minHeight: 34,
    paddingHorizontal: 6,
    paddingVertical: 5,
    borderRadius: 6,
  },
  segmentCardDense: {
    minHeight: 30,
    paddingHorizontal: 3,
    paddingVertical: 3,
    borderRadius: 5,
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
    flexWrap: "wrap",
    gap: 5,
    width: "100%",
    minWidth: 0,
  },
  /** Dot + wrapping “Label count” so full words fit inside equal-width chips. */
  segmentInnerCardDense: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "center",
    gap: 3,
    width: "100%",
    minWidth: 0,
    paddingHorizontal: 1,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    flexShrink: 0,
  },
  dotCardDense: {
    width: 4,
    height: 4,
    borderRadius: 2,
    flexShrink: 0,
    marginTop: 3,
  },
  dotCardDenseSpacer: {
    width: 0,
    height: 4,
    flexShrink: 0,
  },
  label: {
    flexShrink: 1,
    minWidth: 0,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "500",
    color: Theme.textSecondary,
    includeFontPadding: false,
    textAlign: "center",
  },
  cardDenseCopy: {
    flex: 1,
    minWidth: 0,
    fontSize: 9,
    lineHeight: 11,
    fontWeight: "600",
    color: Theme.textSecondary,
    includeFontPadding: false,
    textAlign: "left",
  },
  labelActive: {
    color: Theme.textPrimaryDark,
    fontWeight: "700",
  },
  count: {
    flexShrink: 0,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "700",
    color: Theme.textMuted,
    fontVariant: ["tabular-nums"],
    includeFontPadding: false,
  },
  cardDenseCount: {
    fontSize: 9,
    lineHeight: 11,
    fontWeight: "700",
    color: Theme.textMuted,
    fontVariant: ["tabular-nums"],
  },
  countActive: {
    color: Theme.textPrimaryDark,
    fontWeight: "700",
  },
});
