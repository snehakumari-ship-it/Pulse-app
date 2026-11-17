/**
 * Quiet mark for a list that has no trips or no transactions yet.
 * Unmounts with the empty branch as soon as rows exist.
 */
import Theme from '@/constants/Theme';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

type Kind = 'trips' | 'money';

export function DriverListEmptyArt({ kind }: { kind: Kind }) {
  const lift = useSharedValue(0);

  useEffect(() => {
    lift.value = withRepeat(
      withTiming(1, { duration: 2400, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
  }, [lift]);

  const artStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: lift.value * -4 }],
  }));

  return (
    <View style={styles.wrap} pointerEvents="none" accessibilityElementsHidden>
      <Animated.View style={artStyle}>
        <Svg width={72} height={72} viewBox="0 0 72 72">
          <Circle cx={36} cy={36} r={32} fill={Theme.driverEmeraldMuted} />
          {kind === 'trips' ? (
            <>
              <Path
                d="M18 48 C 30 46, 34 30, 54 22"
                stroke={Theme.driverEmerald}
                strokeWidth={2.4}
                fill="none"
                strokeLinecap="round"
              />
              <Circle cx={18} cy={48} r={3.4} fill={Theme.driverCtaFill} />
              <Circle cx={54} cy={22} r={3.4} fill={Theme.driverEmerald} />
            </>
          ) : (
            <>
              <Rect
                x={24}
                y={18}
                width={24}
                height={34}
                rx={4}
                fill={Theme.cardWhite}
                stroke={Theme.driverCtaFill}
                strokeWidth={1.6}
              />
              <Path
                d="M30 28 H42 M30 34 H42 M30 40 H38"
                stroke={Theme.driverEmerald}
                strokeWidth={1.6}
                strokeLinecap="round"
              />
            </>
          )}
        </Svg>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: 72,
    height: 72,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
