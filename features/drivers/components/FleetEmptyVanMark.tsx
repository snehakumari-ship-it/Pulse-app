/**
 * Idle truck for the empty fleet-vehicle state.
 * Decorative only — the title next to it carries the meaning.
 */
import LottieView from "lottie-react-native";
import { StyleSheet, View } from "react-native";

const TRUCK_ANIMATION = require("@/assets/Animated folder/truck.json");

export function FleetEmptyVanMark() {
  return (
    <View style={styles.frame} pointerEvents="none" accessibilityElementsHidden>
      <LottieView
        source={TRUCK_ANIMATION}
        autoPlay
        loop
        resizeMode="contain"
        style={styles.lottie}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    width: 200,
    height: 148,
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    marginBottom: 2,
  },
  lottie: {
    width: 200,
    height: 148,
  },
});
