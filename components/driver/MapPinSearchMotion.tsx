/**
 * Fleet vehicle empty-space mark: map pin + search glass, in the driver green,
 * with a bob, soft ripples, and a ground shadow.
 */
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, ClipPath, Defs, G, Path, Rect } from 'react-native-svg';
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
import Theme from '@/constants/Theme';

const PIN_GREEN = Theme.driverPrimary;
const PIN_MAP = Theme.driverEmerald;

type Props = {
  size?: 'md' | 'lg';
};

function GreenSearchPin({ width, height }: { width: number; height: number }) {
  return (
    <Svg width={width} height={height} viewBox="0 0 86 112">
      <Path
        d="M43 2C23.1 2 7 18.2 7 38.2 7 58.8 43 110 43 110s36-51.2 36-71.8C79 18.2 62.9 2 43 2z"
        fill={PIN_GREEN}
      />
      <Circle cx="43" cy="38" r="20" fill="#FFFFFF" />
      <Defs>
        <ClipPath id="driver-map-pin-lens">
          <Circle cx="43" cy="38" r="14.2" />
        </ClipPath>
      </Defs>
      <G clipPath="url(#driver-map-pin-lens)">
        <Rect x="28" y="23" width="30" height="30" fill={PIN_MAP} />
        <Path
          d="M28 30.5h30M28 38h30M28 45.5h30M35.5 23v30M43 23v30M50.5 23v30"
          stroke="rgba(255,255,255,0.55)"
          strokeWidth="1.3"
        />
        <Path
          d="M31 23.5l7.5 29M55 23.5l-6 29"
          stroke="rgba(167,243,208,0.9)"
          strokeWidth="1.2"
        />
      </G>
      <Circle cx="43" cy="38" r="14.2" fill="none" stroke="#FFFFFF" strokeWidth="3.4" />
      <Path d="M54.2 49.2 L65.5 60.5" stroke="#FFFFFF" strokeWidth="5.4" strokeLinecap="round" />
    </Svg>
  );
}

function SoftRipple({ delayMs, diameter }: { delayMs: number; diameter: number }) {
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
    opacity: interpolate(t.value, [0, 0.18, 1], [0.32, 0.18, 0]),
    transform: [{ scale: interpolate(t.value, [0, 1], [0.4, 1.35]) }],
  }));

  return (
    <Animated.View
      style={[
        styles.ripple,
        {
          width: diameter,
          height: diameter,
          borderRadius: diameter / 2,
          borderColor: PIN_GREEN,
        },
        style,
      ]}
    />
  );
}

export function MapPinSearchMotion({ size = 'md' }: Props) {
  const bob = useSharedValue(0);
  const glow = useSharedValue(0);
  const field = size === 'lg' ? 168 : 140;
  const pinW = size === 'lg' ? 86 : 72;
  const pinH = size === 'lg' ? 112 : 94;

  useEffect(() => {
    bob.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 850, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: 850, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      false,
    );
    glow.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.quad) }),
        withTiming(0, { duration: 1100, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
  }, [bob, glow]);

  const pinStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(bob.value, [0, 1], [0, -8]) },
      { scale: interpolate(bob.value, [0, 1], [1, 1.04]) },
    ],
  }));

  const shadowStyle = useAnimatedStyle(() => ({
    opacity: interpolate(bob.value, [0, 1], [0.3, 0.12]),
    transform: [{ scaleX: interpolate(bob.value, [0, 1], [1, 0.68]) }],
  }));

  const glowStyle = useAnimatedStyle(() => ({
    opacity: interpolate(glow.value, [0, 1], [0.18, 0.4]),
    transform: [{ scale: interpolate(glow.value, [0, 1], [0.92, 1.12]) }],
  }));

  return (
    <View
      style={[styles.wrap, { width: field, height: field }]}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <SoftRipple delayMs={0} diameter={field * 0.82} />
      <SoftRipple delayMs={800} diameter={field * 0.82} />
      <SoftRipple delayMs={1600} diameter={field * 0.82} />

      <Animated.View style={[styles.glow, glowStyle]} />
      <Animated.View style={[styles.groundShadow, shadowStyle]} />

      <Animated.View style={pinStyle}>
        <GreenSearchPin width={pinW} height={pinH} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  ripple: {
    position: 'absolute',
    borderWidth: 1.5,
    backgroundColor: 'transparent',
  },
  glow: {
    position: 'absolute',
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(5, 150, 105, 0.22)',
  },
  groundShadow: {
    position: 'absolute',
    bottom: 18,
    width: 40,
    height: 9,
    borderRadius: 999,
    backgroundColor: 'rgba(4, 120, 87, 0.28)',
  },
});
