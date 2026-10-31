/**
 * Soft brand motion for empty space on driver profile / DCO screens.
 * Expanding ripples + a heartbeat equalizer — replaces a plain outline circle.
 */
import Theme from '@/constants/Theme';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
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
  color?: string;
  /** Compact for nested cards; default fills leftover page space. */
  size?: 'md' | 'lg';
};

function Ripple({
  color,
  delayMs,
  diameter,
}: {
  color: string;
  delayMs: number;
  diameter: number;
}) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(
      delayMs,
      withRepeat(
        withTiming(1, { duration: 2400, easing: Easing.out(Easing.cubic) }),
        -1,
        false,
      ),
    );
  }, [delayMs, t]);

  const style = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0, 0.15, 1], [0.35, 0.22, 0]),
    transform: [{ scale: interpolate(t.value, [0, 1], [0.35, 1.35]) }],
  }));

  return (
    <Animated.View
      style={[
        styles.ripple,
        {
          width: diameter,
          height: diameter,
          borderRadius: diameter / 2,
          borderColor: color,
        },
        style,
      ]}
    />
  );
}

function BeatBar({
  color,
  delayMs,
  peak,
}: {
  color: string;
  delayMs: number;
  peak: number;
}) {
  const t = useSharedValue(0.28);
  useEffect(() => {
    t.value = withDelay(
      delayMs,
      withRepeat(
        withSequence(
          withTiming(peak, { duration: 280, easing: Easing.out(Easing.quad) }),
          withTiming(0.32, { duration: 320, easing: Easing.inOut(Easing.quad) }),
          withTiming(0.55, { duration: 220 }),
          withTiming(0.28, { duration: 480, easing: Easing.inOut(Easing.quad) }),
        ),
        -1,
        false,
      ),
    );
  }, [delayMs, peak, t]);

  const style = useAnimatedStyle(() => ({
    transform: [{ scaleY: t.value }],
    opacity: interpolate(t.value, [0.28, peak], [0.45, 1]),
  }));

  return <Animated.View style={[styles.bar, { backgroundColor: color }, style]} />;
}

export function PulseAmbientMotion({
  color = Theme.driverEmerald,
  size = 'lg',
}: Props) {
  const diameter = size === 'lg' ? 118 : 88;
  const core = size === 'lg' ? 44 : 36;

  return (
    <View
      style={[styles.wrap, size === 'lg' ? styles.wrapLg : styles.wrapMd]}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Ripple color={color} delayMs={0} diameter={diameter} />
      <Ripple color={color} delayMs={800} diameter={diameter} />
      <Ripple color={color} delayMs={1600} diameter={diameter} />

      <View
        style={[
          styles.core,
          {
            width: core,
            height: core,
            borderRadius: core / 2,
            backgroundColor: color,
            shadowColor: color,
          },
        ]}
      >
        <View style={styles.bars}>
          <BeatBar color="#fff" delayMs={0} peak={1} />
          <BeatBar color="#fff" delayMs={90} peak={0.92} />
          <BeatBar color="#fff" delayMs={180} peak={1.05} />
          <BeatBar color="#fff" delayMs={60} peak={0.78} />
          <BeatBar color="#fff" delayMs={140} peak={0.88} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  wrapLg: { width: 140, height: 132 },
  wrapMd: { width: 108, height: 100 },
  ripple: {
    position: 'absolute',
    borderWidth: 1.5,
    backgroundColor: 'transparent',
  },
  core: {
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28,
    shadowRadius: 12,
    elevation: 4,
  },
  bars: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    height: 18,
  },
  bar: {
    width: 3,
    height: 16,
    borderRadius: 2,
  },
});
