import { useEffect } from "react";
import { Image, StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

const WALLET_ICON = require("@/assets/driver-expense/wallet-expense-mark.png");

type Props = {
  size?: number;
};

/**
 * Soft float + pulse for the expense wallet mark in the expense header.
 */
export function WalletExpenseIcon({ size = 52 }: Props) {
  const floatY = useSharedValue(0);
  const scale = useSharedValue(1);

  useEffect(() => {
    floatY.value = withRepeat(
      withSequence(
        withTiming(-2.5, { duration: 1000, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: 1000, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      false,
    );
    scale.value = withRepeat(
      withSequence(
        withTiming(1.03, { duration: 1000, easing: Easing.inOut(Easing.sin) }),
        withTiming(1, { duration: 1000, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      false,
    );
  }, [floatY, scale]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: floatY.value }, { scale: scale.value }],
  }));

  return (
    <View style={[styles.wrap, { width: size, height: size }]} pointerEvents="none">
      <Animated.View style={[styles.iconWrap, { width: size, height: size }, animStyle]}>
        <Image source={WALLET_ICON} style={styles.image} resizeMode="contain" />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  iconWrap: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  image: {
    width: "100%",
    height: "100%",
    backgroundColor: "transparent",
  },
});
