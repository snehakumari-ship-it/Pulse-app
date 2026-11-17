import { useEffect } from "react";
import { Image, StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

const BELL = require("@/assets/driver-notifications/notification-bell-empty.png");

type Props = {
  size?: number;
};

/**
 * Yellow bell + red badge — soft ring animation for the empty notifications state.
 * Only mount while there are no pending notification rows.
 */
export function EmptyNotificationBell({ size = 56 }: Props) {
  const rotate = useSharedValue(0);
  const badgeScale = useSharedValue(1);

  useEffect(() => {
    rotate.value = withRepeat(
      withSequence(
        withTiming(-12, { duration: 120, easing: Easing.out(Easing.quad) }),
        withTiming(10, { duration: 120, easing: Easing.inOut(Easing.quad) }),
        withTiming(-8, { duration: 100, easing: Easing.inOut(Easing.quad) }),
        withTiming(6, { duration: 100, easing: Easing.inOut(Easing.quad) }),
        withTiming(0, { duration: 140, easing: Easing.out(Easing.quad) }),
        withDelay(1600, withTiming(0, { duration: 0 })),
      ),
      -1,
      false,
    );
    badgeScale.value = withRepeat(
      withSequence(
        withTiming(1.12, { duration: 420, easing: Easing.inOut(Easing.sin) }),
        withTiming(1, { duration: 420, easing: Easing.inOut(Easing.sin) }),
        withDelay(1200, withTiming(1, { duration: 0 })),
      ),
      -1,
      false,
    );
  }, [badgeScale, rotate]);

  const bellStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotate.value}deg` }],
  }));

  const badgePulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: badgeScale.value }],
  }));

  const badge = Math.max(8, Math.round(size * 0.16));

  return (
    <View style={[styles.wrap, { width: size, height: size }]} pointerEvents="none">
      <Animated.View style={[styles.bellWrap, { width: size, height: size }, bellStyle]}>
        <Image source={BELL} style={styles.image} resizeMode="contain" />
      </Animated.View>
      {/* Soft glow under badge pulse — image already has the red dot */}
      <Animated.View
        style={[
          styles.badgeGlow,
          badgePulseStyle,
          {
            top: Math.round(size * 0.06),
            right: Math.round(size * 0.1),
            width: badge,
            height: badge,
            borderRadius: badge / 2,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  bellWrap: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  image: {
    width: "100%",
    height: "100%",
    backgroundColor: "transparent",
  },
  badgeGlow: {
    position: "absolute",
    backgroundColor: "rgba(239,68,68,0.22)",
  },
});
