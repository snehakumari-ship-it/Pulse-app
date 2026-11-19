import { Check } from "lucide-react-native";
import { Platform, StyleSheet, View, type ViewStyle } from "react-native";

import Theme from "@/constants/Theme";

/** Solid forest circle with a white tick — leading icon on a selected expense chip. */
export function DriverChipCheck({ size = 15 }: { size?: number }) {
  return (
    <View
      style={[styles.circle, { width: size, height: size, borderRadius: size / 2 }]}
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      <Check size={Math.round(size * 0.66)} color={Theme.textOnPrimary} strokeWidth={3.2} />
    </View>
  );
}

/** 150ms colour ease on web; native swaps instantly and keeps the press scale. */
export const driverChipTransition = (Platform.OS === "web"
  ? {
      transitionProperty: "background-color, color, transform",
      transitionDuration: "150ms",
      transitionTimingFunction: "ease",
    }
  : {}) as ViewStyle;

const styles = StyleSheet.create({
  circle: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Theme.driverChipSelectedInk,
  },
});
