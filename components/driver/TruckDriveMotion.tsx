/**
 * DCO status empty-space mark: delivery truck with a soft drive loop on a road.
 */
import Theme from '@/constants/Theme';
import { useEffect } from 'react';
import { Image, StyleSheet, View } from 'react-native';
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

const TRUCK_ASSET = require('../../assets/images/dco-truck-mark.png');

type Props = {
  color?: string;
  size?: 'md' | 'lg';
};

function RoadDash({ delayMs, color }: { delayMs: number; color: string }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(
      delayMs,
      withRepeat(withTiming(1, { duration: 1600, easing: Easing.linear }), -1, false),
    );
  }, [delayMs, t]);

  const style = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0, 0.5, 1], [0.2, 0.65, 0.2]),
    transform: [{ translateX: interpolate(t.value, [0, 1], [22, -30]) }],
  }));

  return <Animated.View style={[styles.dash, { backgroundColor: color }, style]} />;
}

export function TruckDriveMotion({
  color = Theme.driverEmerald,
  size = 'lg',
}: Props) {
  const drive = useSharedValue(0);
  const bounce = useSharedValue(0);
  const width = size === 'lg' ? 240 : 200;
  const height = size === 'lg' ? 112 : 96;
  const truckW = size === 'lg' ? 88 : 72;
  const truckH = size === 'lg' ? 56 : 46;

  useEffect(() => {
    drive.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 2400, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: 2400, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      false,
    );
    bounce.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 320, easing: Easing.inOut(Easing.quad) }),
        withTiming(0, { duration: 320, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
  }, [bounce, drive]);

  const truckStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(drive.value, [0, 1], [-22, 22]) },
      { translateY: interpolate(bounce.value, [0, 1], [0, -2] ) },
    ],
  }));

  const shadowStyle = useAnimatedStyle(() => ({
    opacity: interpolate(bounce.value, [0, 1], [0.26, 0.12]),
    transform: [
      { translateX: interpolate(drive.value, [0, 1], [-22, 22]) },
      { scaleX: interpolate(bounce.value, [0, 1], [1, 0.78]) },
    ],
  }));

  return (
    <View
      style={[styles.wrap, { width, height }]}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View style={[styles.stage, { backgroundColor: `${color}0F`, borderColor: `${color}22` }]}>
        <View style={[styles.road, { backgroundColor: `${color}28` }]} />
        <View style={styles.dashLane}>
          <RoadDash delayMs={0} color={color} />
          <RoadDash delayMs={400} color={color} />
          <RoadDash delayMs={800} color={color} />
        </View>

        <Animated.View style={[styles.shadow, { backgroundColor: color }, shadowStyle]} />
        <Animated.View style={[styles.truckWrap, truckStyle]}>
          <Image
            source={TRUCK_ASSET}
            style={{ width: truckW, height: truckH }}
            resizeMode="contain"
            accessibilityIgnoresInvertColors
          />
        </Animated.View>
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
  stage: {
    width: '100%',
    height: '100%',
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  road: {
    position: 'absolute',
    bottom: 22,
    left: 20,
    right: 20,
    height: 3,
    borderRadius: 999,
  },
  dashLane: {
    position: 'absolute',
    bottom: 28,
    left: 28,
    right: 28,
    height: 3,
    flexDirection: 'row',
    justifyContent: 'space-between',
    overflow: 'hidden',
  },
  dash: {
    width: 16,
    height: 2,
    borderRadius: 999,
  },
  shadow: {
    position: 'absolute',
    bottom: 18,
    width: 48,
    height: 7,
    borderRadius: 999,
  },
  truckWrap: {
    marginBottom: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
