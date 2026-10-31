/**
 * KYC empty-space mark: papers under a magnifying glass, in the driver green.
 * The glass scans the page; the stack floats a few pixels.
 */
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Theme from '@/constants/Theme';

const PAPER = Theme.cardWhite;
const LINE_MUTED = Theme.textSecondary;
const LINE_GREEN = Theme.driverPrimary;
const GLASS = Theme.driverEmerald;
const HANDLE = Theme.driverEmeraldDark;
const LENS = Theme.driverEmeraldMuted;

const FIELD_W = 240;
const FIELD_H = 168;

function Line({
  x,
  y,
  width,
  green,
}: {
  x: number;
  y: number;
  width: number;
  green?: boolean;
}) {
  return (
    <Rect
      x={x}
      y={y}
      width={width}
      height={7}
      rx={3.5}
      fill={green ? LINE_GREEN : LINE_MUTED}
      opacity={green ? 0.85 : 0.45}
    />
  );
}

function Papers() {
  return (
    <Svg width={FIELD_W} height={FIELD_H} viewBox={`0 0 ${FIELD_W} ${FIELD_H}`}>
      <Rect x={78} y={150} width={84} height={10} rx={5} fill={Theme.driverEmeraldMuted} />

      <Rect x={8} y={74} width={72} height={34} rx={7} fill={PAPER} stroke={Theme.surfaceBorder} strokeWidth={1} />
      <Line x={16} y={84} width={36} />
      <Line x={16} y={94} width={52} green />

      <Rect x={160} y={82} width={74} height={32} rx={7} fill={PAPER} stroke={Theme.surfaceBorder} strokeWidth={1} />
      <Line x={168} y={91} width={40} />
      <Line x={168} y={101} width={56} green />

      <Rect x={52} y={14} width={136} height={140} rx={12} fill={PAPER} stroke={Theme.surfaceBorder} strokeWidth={1} />
      <Line x={66} y={32} width={46} />
      <Line x={66} y={46} width={104} green />
      <Line x={66} y={60} width={70} />
      <Line x={66} y={74} width={108} green />
      <Line x={66} y={88} width={38} />
      <Line x={66} y={102} width={92} green />
      <Line x={66} y={116} width={58} />
      <Line x={66} y={130} width={80} green />
    </Svg>
  );
}

function Magnifier() {
  return (
    <Svg width={78} height={88} viewBox="0 0 78 88">
      <Circle cx={44} cy={30} r={20} fill={LENS} />
      <Circle cx={44} cy={30} r={20} fill="none" stroke={GLASS} strokeWidth={6} />
      <Circle cx={37} cy={23} r={6} fill={PAPER} opacity={0.85} />
      <Path d="M28 44 L12 74" stroke={HANDLE} strokeWidth={8} strokeLinecap="round" />
    </Svg>
  );
}

export function DocumentSearchMotion() {
  const scan = useSharedValue(0);
  const floatY = useSharedValue(0);

  useEffect(() => {
    scan.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 2200, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: 2200, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      false,
    );
    floatY.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1800, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: 1800, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      false,
    );
  }, [scan, floatY]);

  const stackStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: interpolate(floatY.value, [0, 1], [0, -5]) }],
  }));

  const glassStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(scan.value, [0, 1], [-8, 36]) },
      { translateY: interpolate(scan.value, [0, 0.5, 1], [0, 10, 2]) },
    ],
  }));

  return (
    <View
      style={styles.wrap}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Animated.View style={stackStyle}>
        <Papers />
      </Animated.View>
      <Animated.View style={[styles.glass, glassStyle]}>
        <Magnifier />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: FIELD_W,
    height: FIELD_H,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glass: {
    position: 'absolute',
    left: 36,
    top: 8,
  },
});
