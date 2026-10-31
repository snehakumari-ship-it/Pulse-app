/**
 * Subtle idle motion for driver icons.
 * Keep movement tiny so rows stay professional and aligned.
 */
import { useEffect, type ReactNode } from 'react';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

type Props = {
  children: ReactNode;
  /** Offset so neighboring icons do not move in step. */
  delay?: number;
};

export function DriverMotionIcon({ children, delay = 0 }: Props) {
  const motion = useSharedValue(0);

  useEffect(() => {
    motion.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 2200, easing: Easing.inOut(Easing.sin) }),
          withTiming(0, { duration: 2200, easing: Easing.inOut(Easing.sin) }),
        ),
        -1,
        false,
      ),
    );
  }, [delay, motion]);

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(motion.value, [0, 1], [0, -1.5]) },
      { scale: interpolate(motion.value, [0, 1], [1, 1.04]) },
    ],
    opacity: interpolate(motion.value, [0, 1], [0.92, 1]),
  }));

  return <Animated.View style={style}>{children}</Animated.View>;
}
