/**
 * Moving city route for the trip-assignment card.
 * Place names and the fare come from the trip. The van follows the drawn road.
 */
import Theme from "@/constants/Theme";
import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle, Defs, Ellipse, LinearGradient, Path, Polygon, Rect, Stop } from "react-native-svg";

const SCENE_W = 340;
const SCENE_H = 220;

type Props = {
  pickup: string;
  dropoff: string;
  earnings: string;
};

function placeLabel(value: string): string {
  const primary = value.split(",")[0]?.trim() || value.trim();
  if (primary.length <= 16) return primary;
  return `${primary.slice(0, 15)}…`;
}

function bezier(t: number, p0: number, p1: number, p2: number, p3: number): number {
  "worklet";
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

function Building({
  x,
  y,
  s,
  h,
}: {
  x: number;
  y: number;
  s: number;
  h: number;
}) {
  const k = 0.46;
  const shadow = `${x - s * 0.2},${y + 4} ${x + s * 1.3},${y - s * k + 4} ${x + s * 0.2},${y - s * 1.5 + 6} ${x - s * 1.2},${y - s * k + 6}`;
  const left = `${x - s},${y - s * k} ${x},${y} ${x},${y - h} ${x - s},${y - h - s * k}`;
  const right = `${x},${y} ${x + s},${y - s * k} ${x + s},${y - h - s * k} ${x},${y - h}`;
  const top = `${x},${y - h} ${x + s},${y - h - s * k} ${x},${y - h - 2 * s * k} ${x - s},${y - h - s * k}`;
  const windowY = y - h * 0.55;
  const pane = `${x + s * 0.28},${windowY} ${x + s * 0.72},${windowY - s * 0.22} ${x + s * 0.72},${windowY - s * 0.22 + 8} ${x + s * 0.28},${windowY + 8}`;
  return (
    <>
      <Polygon points={shadow} fill={Theme.borderLight} />
      <Polygon points={left} fill={Theme.surfaceGray} />
      <Polygon points={right} fill={Theme.borderInput} />
      <Polygon points={top} fill={Theme.cardWhite} />
      <Polygon points={pane} fill={Theme.tripsCardWashEnd} />
    </>
  );
}

function Tree({ x, y }: { x: number; y: number }) {
  return (
    <>
      <Ellipse cx={x} cy={y + 3} rx={6} ry={2.2} fill={Theme.borderLight} />
      <Circle cx={x} cy={y - 5} r={7} fill={Theme.positiveMuted} />
      <Circle cx={x - 2} cy={y - 7} r={3.5} fill={Theme.driverEmerald} opacity={0.55} />
    </>
  );
}

export function AssignmentCityArt({ pickup, dropoff, earnings }: Props) {
  const progress = useSharedValue(0);
  const sceneW = useSharedValue(SCENE_W);
  const sceneH = useSharedValue(SCENE_H);

  useEffect(() => {
    progress.value = withRepeat(
      withTiming(1, { duration: 5200, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
  }, [progress]);

  const vanStyle = useAnimatedStyle(() => {
    const t = progress.value;
    const leg = t < 0.5 ? t / 0.5 : (t - 0.5) / 0.5;
    const ahead = Math.min(1, leg + 0.04);
    const x = t < 0.5
      ? bezier(leg, 62, 118, 146, 188)
      : bezier(leg, 188, 230, 246, 300);
    const y = t < 0.5
      ? bezier(leg, 78, 96, 58, 108)
      : bezier(leg, 108, 158, 172, 146);
    const nx = t < 0.5
      ? bezier(ahead, 62, 118, 146, 188)
      : bezier(ahead, 188, 230, 246, 300);
    const ny = t < 0.5
      ? bezier(ahead, 78, 96, 58, 108)
      : bezier(ahead, 108, 158, 172, 146);
    const turn = Math.atan2(ny - y, nx - x) * (180 / Math.PI);
    return {
      transform: [
        { translateX: (x / SCENE_W) * sceneW.value - 22 },
        { translateY: (y / SCENE_H) * sceneH.value - 16 },
        { rotate: `${turn}deg` },
      ],
    };
  });

  const glowStyle = useAnimatedStyle(() => ({
    opacity: 0.35 + progress.value * 0.35,
  }));

  return (
    <View
      style={styles.frame}
      pointerEvents="none"
      accessibilityElementsHidden
      onLayout={(event) => {
        sceneW.value = event.nativeEvent.layout.width;
        sceneH.value = event.nativeEvent.layout.height;
      }}
    >
      <Svg width="100%" height="100%" viewBox={`0 0 ${SCENE_W} ${SCENE_H}`}>
        <Defs>
          <LinearGradient id="routeGlow" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={Theme.positiveMuted} />
            <Stop offset="0.5" stopColor={Theme.driverEmerald} />
            <Stop offset="1" stopColor={Theme.chartSeries5} />
          </LinearGradient>
        </Defs>
        <Ellipse cx={170} cy={118} rx={150} ry={78} fill={Theme.cardWhite} opacity={0.55} />
        <Building x={34} y={108} s={16} h={36} />
        <Building x={96} y={58} s={14} h={28} />
        <Building x={156} y={48} s={18} h={44} />
        <Building x={236} y={54} s={15} h={32} />
        <Building x={292} y={86} s={13} h={24} />
        <Building x={42} y={176} s={15} h={26} />
        <Building x={112} y={190} s={13} h={20} />
        <Building x={210} y={188} s={16} h={28} />
        <Building x={286} y={170} s={13} h={22} />
        <Tree x={78} y={148} />
        <Tree x={142} y={78} />
        <Tree x={198} y={70} />
        <Tree x={88} y={168} />
        <Tree x={246} y={158} />
        <Path
          d="M62 78 C118 96, 146 58, 188 108 S246 172, 300 146"
          stroke={Theme.positiveMuted}
          strokeWidth={26}
          fill="none"
          strokeLinecap="round"
        />
        <Path
          d="M62 78 C118 96, 146 58, 188 108 S246 172, 300 146"
          stroke="url(#routeGlow)"
          strokeWidth={12}
          fill="none"
          strokeLinecap="round"
        />
        <Path
          d="M62 78 C118 96, 146 58, 188 108 S246 172, 300 146"
          stroke={Theme.cardWhite}
          strokeWidth={2}
          fill="none"
          strokeLinecap="round"
          strokeDasharray="7 11"
          opacity={0.85}
        />
        <Circle cx={62} cy={78} r={11} fill={Theme.positiveMuted} />
        <Circle cx={62} cy={78} r={5.5} fill={Theme.cardWhite} stroke={Theme.driverEmerald} strokeWidth={2.5} />
        <Circle cx={300} cy={146} r={11} fill={Theme.positiveMuted} />
        <Circle cx={300} cy={146} r={5.5} fill={Theme.cardWhite} stroke={Theme.driverEmerald} strokeWidth={2.5} />
      </Svg>

      <Animated.View style={[styles.pulse, styles.pulseStart, glowStyle]} />
      <Animated.View style={[styles.pulse, styles.pulseEnd, glowStyle]} />

      <View style={styles.pickupChip}>
        <View style={styles.pinDot} />
        <Text style={styles.chipText} numberOfLines={1}>
          {placeLabel(pickup)}
        </Text>
      </View>
      <View style={styles.dropChip}>
        <View style={styles.pinDot} />
        <Text style={styles.chipText} numberOfLines={1}>
          {placeLabel(dropoff)}
        </Text>
      </View>
      <View style={styles.fareChip}>
        <Text style={styles.fareText} numberOfLines={1}>
          {earnings}
        </Text>
      </View>

      <Animated.View style={[styles.van, vanStyle]}>
        <Svg width={44} height={28} viewBox="0 0 44 28">
          <Ellipse cx={22} cy={24} rx={14} ry={3} fill={Theme.borderInput} />
          <Rect x={2} y={8} width={24} height={12} rx={3} fill={Theme.driverEmerald} />
          <Path d="M24 9 H34 L40 15 V20 H24 Z" fill={Theme.driverEmeraldDark} />
          <Path d="M30 11 H34 L37 15 H30 Z" fill={Theme.tripsCardWashEnd} />
          <Circle cx={12} cy={21} r={3.2} fill={Theme.buttonDark} />
          <Circle cx={12} cy={21} r={1.3} fill={Theme.cardWhite} />
          <Circle cx={33} cy={21} r={3.2} fill={Theme.buttonDark} />
          <Circle cx={33} cy={21} r={1.3} fill={Theme.cardWhite} />
        </Svg>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    width: "100%",
    aspectRatio: SCENE_W / SCENE_H,
    borderRadius: 18,
    overflow: "hidden",
    marginTop: 8,
    backgroundColor: Theme.tripsCardWashMid,
  },
  pulse: {
    position: "absolute",
    width: 22,
    height: 22,
    marginLeft: -11,
    marginTop: -11,
    borderRadius: 11,
    backgroundColor: Theme.positiveMuted,
  },
  pulseStart: {
    left: `${(62 / SCENE_W) * 100}%`,
    top: `${(78 / SCENE_H) * 100}%`,
  },
  pulseEnd: {
    left: `${(300 / SCENE_W) * 100}%`,
    top: `${(146 / SCENE_H) * 100}%`,
  },
  pickupChip: {
    position: "absolute",
    left: 10,
    top: 10,
    maxWidth: "46%",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: Theme.cardWhite,
    borderWidth: 1,
    borderColor: Theme.borderLight,
  },
  dropChip: {
    position: "absolute",
    right: 10,
    bottom: 12,
    maxWidth: "44%",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: Theme.cardWhite,
    borderWidth: 1,
    borderColor: Theme.borderLight,
  },
  fareChip: {
    position: "absolute",
    right: 10,
    top: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: Theme.cardWhite,
    borderWidth: 1,
    borderColor: Theme.driverEmeraldBorderSoft,
  },
  pinDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Theme.driverEmerald,
  },
  chipText: {
    flexShrink: 1,
    fontSize: 12,
    fontWeight: "700",
    color: Theme.textPrimaryDark,
  },
  fareText: {
    fontSize: 14,
    fontWeight: "800",
    color: Theme.driverEmeraldDark,
  },
  van: {
    position: "absolute",
    left: 0,
    top: 0,
    width: 44,
    height: 28,
  },
});
