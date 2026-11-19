import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle, G, Path, Text as SvgText } from "react-native-svg";

import Theme from "@/constants/Theme";

type Props = {
  size?: number;
};

const VIEWBOX = "0 0 64 64";
const EASE = Easing.inOut(Easing.sin);

const RECEIPT_PATH =
  "M8 9 L12 6 L16 9 L20 6 L24 9 L28 6 L32 9 L36 6 L40 9 L40 53 L36 56 L32 53 L28 56 L24 53 L20 56 L16 53 L12 56 L8 53 Z";
const ARROW_PATH = "M45 12 L55 24 L49.5 24 L49.5 40 L40.5 40 L40.5 24 L35 24 Z";
const ARROW_SHADE_PATH = "M45 12 L55 24 L49.5 24 L49.5 40 L45 40 Z";

const LINES: { y: number; short: number; long: number }[] = [
  { y: 16, short: 5, long: 14 },
  { y: 22, short: 5, long: 11 },
  { y: 28, short: 5, long: 13 },
  { y: 34, short: 5, long: 9 },
  { y: 40, short: 5, long: 6 },
];

/**
 * Expense header art: receipt with a rising arrow and a rupee coin.
 * Receipt floats, arrow lifts, coin pulses; still when reduce-motion is on.
 */
export function ExpenseReceiptIcon({ size = 64 }: Props) {
  const reduceMotion = useReducedMotion();
  const float = useSharedValue(0);
  const lift = useSharedValue(0);
  const pulse = useSharedValue(1);

  useEffect(() => {
    if (reduceMotion) return;
    float.value = withRepeat(
      withSequence(
        withTiming(-2.5, { duration: 1400, easing: EASE }),
        withTiming(0, { duration: 1400, easing: EASE }),
      ),
      -1,
      false,
    );
    lift.value = withRepeat(
      withSequence(
        withTiming(-3.5, { duration: 900, easing: EASE }),
        withTiming(0, { duration: 900, easing: EASE }),
        withDelay(600, withTiming(0, { duration: 0 })),
      ),
      -1,
      false,
    );
    pulse.value = withDelay(
      450,
      withRepeat(
        withSequence(
          withTiming(1.06, { duration: 700, easing: EASE }),
          withTiming(1, { duration: 700, easing: EASE }),
          withDelay(1000, withTiming(1, { duration: 0 })),
        ),
        -1,
        false,
      ),
    );
  }, [float, lift, pulse, reduceMotion]);

  const floatStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: float.value }],
  }));
  const liftStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: lift.value }],
  }));
  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulse.value }],
  }));
  const groundStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: 1 + float.value * 0.04 }],
    opacity: 1 + float.value * 0.08,
  }));

  const box = { width: size, height: size };

  return (
    <View style={[styles.wrap, box]} pointerEvents="none">
      <Animated.View
        style={[
          styles.ground,
          { width: size * 0.58, height: size * 0.08, borderRadius: size, bottom: size * 0.02 },
          groundStyle,
        ]}
      />
      <Animated.View style={[StyleSheet.absoluteFill, floatStyle]}>
        <Svg width={size} height={size} viewBox={VIEWBOX} style={StyleSheet.absoluteFill}>
          <Path
            d={RECEIPT_PATH}
            fill={Theme.expenseArtPaper}
            stroke={Theme.expenseArtPaperEdge}
            strokeWidth={1.2}
            strokeLinejoin="round"
          />
          <G strokeLinecap="round" strokeWidth={2.4}>
            {LINES.map((line) => (
              <G key={line.y}>
                <Path
                  d={`M12.5 ${line.y} H${12.5 + line.short}`}
                  stroke={Theme.expenseArtLine}
                />
                <Path
                  d={`M21 ${line.y} H${21 + line.long}`}
                  stroke={Theme.expenseArtLineSoft}
                />
              </G>
            ))}
          </G>
        </Svg>

        <Animated.View style={[StyleSheet.absoluteFill, liftStyle]}>
          <Svg width={size} height={size} viewBox={VIEWBOX}>
            <Path d={ARROW_PATH} fill={Theme.expenseArtArrow} />
            <Path d={ARROW_SHADE_PATH} fill={Theme.expenseArtArrowShade} />
          </Svg>
        </Animated.View>

        <Animated.View
          style={[
            styles.coin,
            {
              width: size,
              height: size,
              transformOrigin: `${(45 / 64) * 100}% ${(47 / 64) * 100}%`,
            },
            pulseStyle,
          ]}
        >
          <Svg width={size} height={size} viewBox={VIEWBOX}>
            <Circle cx={45} cy={47} r={13} fill={Theme.expenseArtCoin} />
            <Circle cx={45} cy={47} r={9.5} fill={Theme.expenseArtCoinInner} />
            <SvgText
              x={45}
              y={51.4}
              fontSize={12.5}
              fontWeight="700"
              fill={Theme.expenseArtCoinMark}
              textAnchor="middle"
            >
              ₹
            </SvgText>
          </Svg>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    justifyContent: "flex-end",
    backgroundColor: "transparent",
  },
  ground: {
    position: "absolute",
    alignSelf: "center",
    backgroundColor: Theme.expenseArtGround,
  },
  coin: {
    position: "absolute",
    left: 0,
    top: 0,
  },
});
