import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

import Theme from "@/constants/Theme";
import type { IndianStateLabel } from "@/features/drivers/utils/indianStateCode.util";

type Props = {
  originCity: string;
  destinationCity: string;
  originState: IndianStateLabel | null;
  destinationState: IndianStateLabel | null;
  /** Card press feedback: nudges the truck toward the destination. */
  pressed?: boolean;
  inkColor?: string;
  mutedColor?: string;
};

const ACCENT = Theme.driverMintHeaderInk;
const DOTS = 10;

/** Inline origin → destination route for trip cards (no frame of its own). */
export function TripRouteSplit({
  originCity,
  destinationCity,
  originState,
  destinationState,
  pressed = false,
  inkColor = Theme.routeSplitInk,
  mutedColor = Theme.routeSplitMuted,
}: Props) {
  const nudge = useSharedValue(0);

  useEffect(() => {
    nudge.value = withTiming(pressed ? 6 : 0, { duration: 180 });
  }, [nudge, pressed]);

  const truckStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: nudge.value }],
  }));
  return (
    <View
      style={styles.wrap}
      accessible
      accessibilityLabel={`Route from ${originCity}${originState ? `, ${originState.name}` : ""} to ${destinationCity}${destinationState ? `, ${destinationState.name}` : ""}`}
    >
      <View style={styles.row}>
        <View style={styles.end}>
          <Text style={[styles.city, { color: inkColor }]} numberOfLines={1}>
            {originCity}
          </Text>
          {originState ? (
            <Text style={[styles.code, { color: mutedColor }]}>{originState.code}</Text>
          ) : null}
        </View>

        <View style={styles.transit}>
          <Animated.View style={truckStyle}>
            <MaterialCommunityIcons name="truck-fast" size={21} color={ACCENT} />
          </Animated.View>
          <View style={styles.arrow}>
            <View style={styles.dots}>
              {Array.from({ length: DOTS }, (_, index) => (
                <View key={index} style={styles.dot} />
              ))}
            </View>
            <MaterialCommunityIcons
              name="chevron-right"
              size={20}
              color={ACCENT}
              style={styles.arrowHead}
            />
          </View>
        </View>

        <View style={[styles.end, styles.endRight]}>
          <Text style={[styles.city, styles.right, { color: inkColor }]} numberOfLines={1}>
            {destinationCity}
          </Text>
          {destinationState ? (
            <Text style={[styles.code, styles.right, { color: mutedColor }]}>
              {destinationState.code}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 4,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  end: {
    flex: 1,
    minWidth: 0,
  },
  endRight: {
    alignItems: "flex-end",
  },
  city: {
    fontSize: 17,
    fontWeight: "800",
    letterSpacing: -0.4,
    lineHeight: 21,
    textTransform: "uppercase",
  },
  code: {
    fontSize: 13,
    fontWeight: "500",
    letterSpacing: 0.2,
    lineHeight: 16,
  },
  right: {
    textAlign: "right",
  },
  transit: {
    flex: 0.9,
    minWidth: 64,
    alignItems: "center",
    justifyContent: "center",
  },
  arrow: {
    alignSelf: "stretch",
    flexDirection: "row",
    alignItems: "center",
    marginTop: 2,
  },
  dots: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  dot: {
    width: 3.5,
    height: 3.5,
    borderRadius: 2,
    backgroundColor: ACCENT,
  },
  arrowHead: {
    marginLeft: -5,
  },
});
