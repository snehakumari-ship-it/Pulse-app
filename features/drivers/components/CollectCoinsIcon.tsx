import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  type SharedValue,
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

const PALM_PATH =
  "M50 41.5 C44 40 39 41.4 33.5 41 L17.5 39.4 C13.6 39.1 12.2 42.6 14.6 44.1 C12.4 45.6 12.9 49 15.9 49.2 C13.9 50.9 14.9 54 17.9 54.1 C16.8 55.9 18.2 58.2 21.2 58.1 L36.5 58.8 C42.5 59 47.5 58 52 56.6 Z";
const PALM_SHADE_PATH =
  "M26.5 46.6 C31 48 35 49.2 38.2 48.1 C41.2 46.8 39.8 44 36.6 42.6 C41 43.4 46 44.6 51 45.4 L51.8 56 C47 57.6 42 58.6 36.4 58.4 Z";
const THUMB_PATH = "M33.5 41 C38.4 43.4 41.4 46.4 38.2 48.1 C35 49.4 30 47.8 26.5 46.6";
const FINGER_LINES = ["M14.6 44.1 H26.5", "M15.9 49.2 H28.5", "M17.9 54.1 H29.5"];
const CUFF_PATH =
  "M49.6 38.6 L57.8 36.4 C59.3 36 60.4 36.8 60.6 38.3 L62.4 54.6 C62.6 56 61.8 57 60.4 57.2 L53.8 58.2 C52.4 58.4 51.5 57.7 51.3 56.3 Z";
const CUFF_SHADE_PATH =
  "M56.3 36.8 L57.8 36.4 C59.3 36 60.4 36.8 60.6 38.3 L62.4 54.6 C62.6 56 61.8 57 60.4 57.2 L59 57.4 Z";

type CoinSpec = { cx: number; cy: number; r: number; sparkle?: boolean };

const COINS: { left: CoinSpec; centre: CoinSpec; right: CoinSpec } = {
  left: { cx: 13, cy: 13, r: 7.5 },
  centre: { cx: 31, cy: 24, r: 11 },
  right: { cx: 51, cy: 11, r: 7.5, sparkle: true },
};

function Coin({ cx, cy, r, sparkle }: CoinSpec) {
  const face = r * 0.74;
  const s = r * 0.5;
  return (
    <G>
      <Circle cx={cx + r * 0.16} cy={cy + r * 0.1} r={r} fill={Theme.collectArtInk} />
      <Circle cx={cx} cy={cy} r={r} fill={Theme.collectArtCoinRim} />
      <Circle cx={cx} cy={cy} r={face} fill={Theme.collectArtCoinFace} />
      {sparkle ? (
        <Path
          d={`M${cx} ${cy - s * 1.5} L${cx + s * 0.22} ${cy - s * 0.22} L${cx + s * 1.5} ${cy} L${cx + s * 0.22} ${cy + s * 0.22} L${cx} ${cy + s * 1.5} L${cx - s * 0.22} ${cy + s * 0.22} L${cx - s * 1.5} ${cy} L${cx - s * 0.22} ${cy - s * 0.22} Z`}
          fill={Theme.collectArtSparkle}
          opacity={0.5}
        />
      ) : null}
      <SvgText
        x={cx}
        y={cy + r * 0.36}
        fontSize={r * 1.05}
        fontWeight="800"
        fill={Theme.collectArtCoinMark}
        textAnchor="middle"
      >
        ₹
      </SvgText>
    </G>
  );
}

function useBob(value: SharedValue<number>, distance: number, duration: number, delay: number, reduceMotion: boolean) {
  useEffect(() => {
    if (reduceMotion) return;
    value.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(-distance, { duration, easing: EASE }),
          withTiming(0, { duration, easing: EASE }),
        ),
        -1,
        false,
      ),
    );
  }, [delay, distance, duration, reduceMotion, value]);
}

/**
 * Collect payment header art: open palm with three rupee coins floating above.
 * Side coins bob out of phase, the centre coin settles towards the palm and the
 * hand lifts to meet it; still when reduce-motion is on.
 */
export function CollectCoinsIcon({ size = 64 }: Props) {
  const reduceMotion = useReducedMotion();
  const leftBob = useSharedValue(0);
  const rightBob = useSharedValue(0);
  const centreDrop = useSharedValue(0);

  useBob(leftBob, 2.4, 1300, 0, reduceMotion);
  useBob(rightBob, 2.4, 1300, 650, reduceMotion);
  useBob(centreDrop, -2.8, 1100, 250, reduceMotion);

  const unit = size / 64;
  const leftStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: leftBob.value * unit }],
  }));
  const rightStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: rightBob.value * unit }],
  }));
  const centreStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: centreDrop.value * unit }],
  }));
  const handStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -centreDrop.value * 0.35 * unit }],
  }));

  const layer = [StyleSheet.absoluteFill];

  return (
    <View style={[styles.wrap, { width: size, height: size }]} pointerEvents="none">
      <Animated.View style={[layer, handStyle]}>
        <Svg width={size} height={size} viewBox={VIEWBOX}>
          <Path
            d={PALM_PATH}
            fill={Theme.collectArtSkin}
            stroke={Theme.collectArtInk}
            strokeWidth={1.6}
            strokeLinejoin="round"
          />
          <Path d={PALM_SHADE_PATH} fill={Theme.collectArtSkinShade} opacity={0.55} />
          <G stroke={Theme.collectArtInk} strokeWidth={1.5} strokeLinecap="round" fill="none">
            <Path d={THUMB_PATH} />
            {FINGER_LINES.map((d) => (
              <Path key={d} d={d} />
            ))}
          </G>
          <Path
            d={CUFF_PATH}
            fill={Theme.collectArtCuff}
            stroke={Theme.collectArtInk}
            strokeWidth={1.6}
            strokeLinejoin="round"
          />
          <Path d={CUFF_SHADE_PATH} fill={Theme.collectArtCuffShade} />
          <Circle cx={57} cy={51} r={1.7} fill={Theme.cardWhite} />
        </Svg>
      </Animated.View>

      <Animated.View style={[layer, leftStyle]}>
        <Svg width={size} height={size} viewBox={VIEWBOX}>
          <Coin {...COINS.left} />
        </Svg>
      </Animated.View>
      <Animated.View style={[layer, rightStyle]}>
        <Svg width={size} height={size} viewBox={VIEWBOX}>
          <Coin {...COINS.right} />
        </Svg>
      </Animated.View>
      <Animated.View style={[layer, centreStyle]}>
        <Svg width={size} height={size} viewBox={VIEWBOX}>
          <Coin {...COINS.centre} />
        </Svg>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: "transparent",
  },
});
