/**
 * Editorial empty mark for the Independent transactions list.
 * Decorative only — the title and subtitle next to it carry the meaning.
 */
import Theme from "@/constants/Theme";
import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle, Ellipse, G, Path, Rect } from "react-native-svg";

function Spark({
  x,
  y,
  size,
  color,
}: {
  x: number;
  y: number;
  size: number;
  color: string;
}) {
  return (
    <Path
      d={`M${x} ${y - size} L${x + size * 0.22} ${y - size * 0.22} L${x + size} ${y} L${x + size * 0.22} ${y + size * 0.22} L${x} ${y + size} L${x - size * 0.22} ${y + size * 0.22} L${x - size} ${y} L${x - size * 0.22} ${y - size * 0.22} Z`}
      fill={color}
    />
  );
}

export function IndependentTransactionsEmptyArt() {
  const lift = useSharedValue(0);

  useEffect(() => {
    lift.value = withRepeat(
      withTiming(1, { duration: 2800, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
  }, [lift]);

  const artStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: lift.value * -5 }],
  }));

  return (
    <View style={styles.wrap} pointerEvents="none" accessibilityElementsHidden>
      <Animated.View style={artStyle}>
        <Svg width={220} height={188} viewBox="0 0 220 188">
          <Spark x={78} y={28} size={7} color={Theme.chartSeries5} />
          <Spark x={168} y={22} size={8} color={Theme.driverGold} />
          <Spark x={186} y={48} size={4.5} color={Theme.chartSeries5} />
          <Spark x={58} y={52} size={4} color={Theme.driverGold} />
          <Circle cx={148} cy={14} r={2.2} fill={Theme.chartSeries5} />
          <Circle cx={104} cy={18} r={1.6} fill={Theme.driverGold} />

          <Path
            d="M36 132 C 28 96, 46 62, 78 48"
            stroke={Theme.borderFocus}
            strokeWidth={1.4}
            strokeDasharray="1.5 4"
            fill="none"
            strokeLinecap="round"
          />
          <Path
            d="M24 146 C 14 100, 40 54, 86 36"
            stroke={Theme.borderFocus}
            strokeWidth={1.4}
            strokeDasharray="1.5 4"
            fill="none"
            strokeLinecap="round"
          />

          <Ellipse cx={112} cy={168} rx={58} ry={8} fill={Theme.textPrimaryDark} opacity={0.06} />

          <G transform="translate(74 46) rotate(-8)">
            <Rect width={86} height={108} rx={7} fill={Theme.surfaceGray} stroke={Theme.borderMedium} strokeWidth={1} />
            <Rect x={0} y={10} width={7} height={88} rx={2} fill={Theme.buttonDark} opacity={0.72} />
          </G>
          <G transform="translate(82 52) rotate(-3)">
            <Rect width={86} height={108} rx={7} fill={Theme.border} stroke={Theme.borderInput} strokeWidth={1} />
            <Rect x={0} y={10} width={7} height={88} rx={2} fill={Theme.buttonDark} opacity={0.85} />
          </G>
          <G>
            <Rect x={90} y={58} width={88} height={110} rx={7} fill={Theme.cardWhite} stroke={Theme.borderInput} strokeWidth={1.2} />
            <Rect x={90} y={70} width={8} height={86} rx={2} fill={Theme.buttonDark} />
            <Path
              d="M110 82 H160 M110 94 H160 M110 106 H152 M110 118 H144"
              stroke={Theme.borderFocus}
              strokeWidth={2.2}
              strokeLinecap="round"
            />
          </G>

          <Ellipse cx={168} cy={156} rx={16} ry={5} fill="none" stroke={Theme.borderFocus} strokeWidth={1.2} />
          <Ellipse cx={168} cy={156} rx={8} ry={2.6} fill="none" stroke={Theme.borderMedium} strokeWidth={1.2} />

          <G>
            <Circle cx={156} cy={118} r={24} fill={Theme.cardWhite} fillOpacity={0.55} stroke={Theme.textPrimaryDark} strokeWidth={5} />
            <Path
              d="M146 108 C 150 104, 156 104, 160 108"
              stroke={Theme.cardWhite}
              strokeWidth={2.4}
              strokeLinecap="round"
              fill="none"
            />
            <Rect
              x={172}
              y={132}
              width={8}
              height={26}
              rx={4}
              fill={Theme.textPrimaryDark}
              transform="rotate(42 176 145)"
            />
          </G>
        </Svg>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: 220,
    height: 188,
    alignItems: "center",
    justifyContent: "center",
  },
});
