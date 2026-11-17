/**
 * Empty trip-inbox mark. Shown only while the driver has no conversations.
 * The inbox replaces it with the real list as soon as a chat exists.
 */
import Theme from '@/constants/Theme';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

export function DriverChatEmptyArt() {
  const lift = useSharedValue(0);
  const dot = useSharedValue(0);

  useEffect(() => {
    lift.value = withRepeat(
      withTiming(1, { duration: 2200, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
    dot.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 680, easing: Easing.inOut(Easing.sin) }),
        withTiming(0.25, { duration: 680, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      false,
    );
  }, [dot, lift]);

  const backStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: lift.value * -6 }],
  }));
  const frontStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - lift.value) * -5 }],
  }));
  const dotStyle = useAnimatedStyle(() => ({
    opacity: 0.45 + dot.value * 0.55,
    transform: [{ scale: 0.86 + dot.value * 0.28 }],
  }));

  return (
    <View style={styles.stage} accessibilityElementsHidden pointerEvents="none">
      <Animated.View style={[styles.backBubble, backStyle]}>
        <View style={styles.dots}>
          <View style={styles.dotMuted} />
          <Animated.View style={[styles.dotHot, dotStyle]} />
        </View>
      </Animated.View>
      <Animated.View style={[styles.frontBubble, frontStyle]}>
        <View style={styles.line} />
        <View style={[styles.line, styles.lineShort]} />
        <View style={styles.tail} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  stage: {
    width: 148,
    height: 112,
    marginBottom: 6,
  },
  backBubble: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Theme.tripsMint,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Theme.driverCtaFill,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.16,
    shadowRadius: 12,
    elevation: 3,
  },
  dots: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  dotMuted: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Theme.cardWhite,
    opacity: 0.55,
  },
  dotHot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Theme.negative,
  },
  frontBubble: {
    position: 'absolute',
    right: 0,
    bottom: 10,
    width: 96,
    height: 68,
    borderRadius: 22,
    backgroundColor: Theme.driverCtaFill,
    justifyContent: 'center',
    gap: 8,
    paddingLeft: 16,
    shadowColor: Theme.driverCtaFill,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.22,
    shadowRadius: 14,
    elevation: 4,
  },
  line: {
    width: 52,
    height: 4,
    borderRadius: 2,
    backgroundColor: Theme.cardWhite,
    opacity: 0.92,
  },
  lineShort: {
    width: 34,
    opacity: 0.62,
  },
  tail: {
    position: 'absolute',
    left: 16,
    bottom: -6,
    width: 14,
    height: 14,
    borderRadius: 3,
    backgroundColor: Theme.driverCtaFill,
    transform: [{ rotate: '45deg' }],
  },
});
