/**
 * Delivery-progress mark: truck, parcels, and a green success badge.
 * Truck rolls a little; the badge breathes; boxes float — Pulse greens only.
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

const TRUCK = Theme.text;
const WINDOW = Theme.cardWhite;
const BOX = '#d6b48a';
const BOX_TAPE = Theme.cardWhite;
const BADGE = Theme.driverPrimary;
const BADGE_DARK = Theme.driverEmerald;
const ACCENT = Theme.driverEmeraldMuted;
const GROUND = Theme.driverEmeraldMuted;

const FIELD_W = 118;
const FIELD_H = 78;

function Boxes() {
  return (
    <Svg width={48} height={FIELD_H} viewBox={`0 0 48 ${FIELD_H}`}>
      <Rect x={4} y={46} width={22} height={18} rx={2} fill={BOX} />
      <Path d="M4 52 H26 M15 46 V64" stroke={BOX_TAPE} strokeWidth={1.6} opacity={0.9} />
      <Rect x={14} y={34} width={20} height={16} rx={2} fill={BOX} />
      <Path d="M14 40 H34 M24 34 V50" stroke={BOX_TAPE} strokeWidth={1.5} opacity={0.9} />
      <Rect x={24} y={42} width={16} height={14} rx={2} fill={BOX} />
      <Path d="M24 47 H40 M32 42 V56" stroke={BOX_TAPE} strokeWidth={1.4} opacity={0.85} />
    </Svg>
  );
}

function Truck() {
  return (
    <Svg width={FIELD_W} height={FIELD_H} viewBox={`0 0 ${FIELD_W} ${FIELD_H}`}>
      <Rect x={18} y={70} width={82} height={6} rx={3} fill={GROUND} />
      <Rect x={44} y={28} width={52} height={30} rx={4} fill={TRUCK} />
      <Rect x={48} y={36} width={10} height={8} rx={1.5} fill={Theme.driverEmerald} opacity={0.85} />
      <Path d="M96 36 H108 Q112 36 112 40 V58 H96 V36 Z" fill={TRUCK} />
      <Path d="M98 38 H108 Q109.5 38 109.5 40 V48 H98 V38 Z" fill={WINDOW} />
      <Circle cx={58} cy={60} r={7} fill={WINDOW} />
      <Circle cx={58} cy={60} r={3.5} fill={TRUCK} />
      <Circle cx={98} cy={60} r={7} fill={WINDOW} />
      <Circle cx={98} cy={60} r={3.5} fill={TRUCK} />
      <Circle cx={72} cy={22} r={3} fill={ACCENT} />
    </Svg>
  );
}

function SuccessBadge() {
  return (
    <Svg width={34} height={34} viewBox="0 0 34 34">
      <Circle cx={17} cy={17} r={16} fill={BADGE} />
      <Circle cx={12} cy={14} r={14} fill={BADGE_DARK} opacity={0.35} />
      <Path
        d="M10 17.5 L14.5 22 L24 12"
        fill="none"
        stroke={WINDOW}
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function DeliverySuccessMotion() {
  const roll = useSharedValue(0);
  const badge = useSharedValue(0);
  const boxes = useSharedValue(0);

  useEffect(() => {
    roll.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 2200, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: 2200, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      false,
    );
    badge.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1600, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: 1600, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      false,
    );
    boxes.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1900, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: 1900, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      false,
    );
  }, [roll, badge, boxes]);

  const truckStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(roll.value, [0, 1], [0, 4]) },
      { translateY: interpolate(roll.value, [0, 0.5, 1], [0, -1.5, 0]) },
    ],
  }));

  const badgeStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: interpolate(badge.value, [0, 1], [1, 1.08]) },
      { translateY: interpolate(badge.value, [0, 1], [0, -1]) },
    ],
  }));

  const boxesStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: interpolate(boxes.value, [0, 1], [0, -3]) }],
  }));

  return (
    <View
      style={styles.wrap}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Animated.View style={[styles.truck, truckStyle]}>
        <Truck />
      </Animated.View>
      <Animated.View style={[styles.boxes, boxesStyle]}>
        <Boxes />
      </Animated.View>
      <Animated.View style={[styles.badge, badgeStyle]}>
        <SuccessBadge />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: FIELD_W,
    height: FIELD_H,
  },
  truck: {
    ...StyleSheet.absoluteFillObject,
  },
  boxes: {
    position: 'absolute',
    left: 0,
    top: 0,
  },
  badge: {
    position: 'absolute',
    left: 38,
    top: 8,
  },
});
