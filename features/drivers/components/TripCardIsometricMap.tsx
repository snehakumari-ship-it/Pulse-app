/**
 * Decorative isometric map for a trip card.
 * The live map still opens on tap — this mark is only the thumbnail.
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
import Svg, { Circle, Path, Rect } from "react-native-svg";

type Point = { x: number; y: number };

type Scene = {
  road: string;
  dash: string;
  blocks: { x: number; y: number; w: number; h: number; fill: string }[];
  start: Point;
  end: Point;
  startFill: string;
  endFill: string;
  truck: Point[];
};

const BLOCK = {
  mint: Theme.positiveMuted,
  sky: Theme.tripsCardWashEnd,
  sand: Theme.warningMuted,
  wash: Theme.complianceIconWash,
  slate: Theme.surfaceGray,
};

/** Art stays above the caption band (y < 68) and clear of the layers chip. */
const SCENES: Scene[] = [
  {
    road: "M16 58 C 30 54, 38 40, 50 34 S 68 16, 78 12",
    dash: "M16 58 C 30 54, 38 40, 50 34 S 68 16, 78 12",
    blocks: [
      { x: 6, y: 6, w: 16, h: 12, fill: BLOCK.mint },
      { x: 28, y: 6, w: 14, h: 10, fill: BLOCK.sky },
      { x: 58, y: 28, w: 14, h: 12, fill: BLOCK.sand },
      { x: 6, y: 28, w: 14, h: 12, fill: BLOCK.wash },
      { x: 62, y: 46, w: 16, h: 12, fill: BLOCK.mint },
    ],
    start: { x: 18, y: 8 },
    end: { x: 36, y: 46 },
    startFill: Theme.complianceStageInfoFg,
    endFill: Theme.negative,
    truck: [
      { x: 22, y: 52 },
      { x: 46, y: 36 },
      { x: 68, y: 18 },
    ],
  },
  {
    road: "M18 14 C 28 26, 36 32, 48 38 S 64 52, 76 58",
    dash: "M18 14 C 28 26, 36 32, 48 38 S 64 52, 76 58",
    blocks: [
      { x: 6, y: 6, w: 14, h: 10, fill: BLOCK.sand },
      { x: 40, y: 6, w: 16, h: 12, fill: BLOCK.mint },
      { x: 6, y: 32, w: 14, h: 12, fill: BLOCK.sky },
      { x: 62, y: 24, w: 14, h: 12, fill: BLOCK.wash },
      { x: 8, y: 50, w: 16, h: 12, fill: BLOCK.slate },
    ],
    start: { x: 46, y: 8 },
    end: { x: 22, y: 44 },
    startFill: Theme.negative,
    endFill: Theme.driverEmerald,
    truck: [
      { x: 24, y: 20 },
      { x: 46, y: 36 },
      { x: 66, y: 52 },
    ],
  },
  {
    road: "M14 18 C 28 24, 36 34, 48 38 S 62 48, 74 56",
    dash: "M14 18 C 28 24, 36 34, 48 38 S 62 48, 74 56",
    blocks: [
      { x: 6, y: 6, w: 16, h: 10, fill: BLOCK.sky },
      { x: 42, y: 6, w: 14, h: 12, fill: BLOCK.sand },
      { x: 6, y: 36, w: 14, h: 12, fill: BLOCK.mint },
      { x: 60, y: 28, w: 16, h: 12, fill: BLOCK.wash },
      { x: 28, y: 48, w: 16, h: 12, fill: BLOCK.slate },
    ],
    start: { x: 20, y: 6 },
    end: { x: 58, y: 44 },
    startFill: Theme.complianceStageInfoFg,
    endFill: Theme.driverEmerald,
    truck: [
      { x: 20, y: 22 },
      { x: 44, y: 36 },
      { x: 66, y: 50 },
    ],
  },
];

function sceneIndex(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return hash % SCENES.length;
}

function pinPath(at: Point): string {
  const x = at.x;
  const y = at.y;
  return `M${x} ${y + 2} C${x} ${y - 6}, ${x + 10} ${y - 6}, ${x + 10} ${y + 2} C${x + 10} ${y + 8}, ${x + 5} ${y + 13}, ${x + 5} ${y + 13} C${x + 5} ${y + 13}, ${x} ${y + 8}, ${x} ${y + 2} Z`;
}

export function TripCardIsometricMap({ seed }: { seed: string }) {
  const scene = SCENES[sceneIndex(seed)] ?? SCENES[0];
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withRepeat(
      withTiming(1, { duration: 3200, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
  }, [progress]);

  const ax = scene.truck[0].x;
  const ay = scene.truck[0].y;
  const bx = scene.truck[1].x;
  const by = scene.truck[1].y;
  const cx = scene.truck[2].x;
  const cy = scene.truck[2].y;
  const truckStyle = useAnimatedStyle(() => {
    const t = progress.value;
    const fromX = t < 0.5 ? ax : bx;
    const fromY = t < 0.5 ? ay : by;
    const toX = t < 0.5 ? bx : cx;
    const toY = t < 0.5 ? by : cy;
    const local = t < 0.5 ? t / 0.5 : (t - 0.5) / 0.5;
    const x = fromX + (toX - fromX) * local;
    const y = fromY + (toY - fromY) * local;
    return {
      transform: [
        { translateX: (x / 100) * THUMB_W },
        { translateY: (y / 100) * THUMB_H },
      ],
    };
  });

  return (
    <View style={styles.frame} pointerEvents="none">
      <Svg width="100%" height="100%" viewBox="0 0 100 100">
        <Rect width="100" height="100" fill={Theme.tripsCardWashMid} />
        <Path
          d="M0 24 H100 M0 48 H100 M28 0 V68 M62 0 V68"
          stroke={Theme.cardWhite}
          strokeWidth={4}
        />
        {scene.blocks.map((block) => (
          <Rect
            key={`${block.x}-${block.y}`}
            x={block.x}
            y={block.y}
            width={block.w}
            height={block.h}
            rx={2.5}
            fill={block.fill}
          />
        ))}
        <Path
          d={scene.road}
          stroke={Theme.buttonDark}
          strokeWidth={5}
          fill="none"
          strokeLinecap="round"
        />
        <Path
          d={scene.dash}
          stroke={Theme.driverGold}
          strokeWidth={1.2}
          fill="none"
          strokeLinecap="round"
          strokeDasharray="3 3.5"
        />
        <Path d={pinPath(scene.start)} fill={scene.startFill} />
        <Circle cx={scene.start.x + 5} cy={scene.start.y + 2} r={2.1} fill={Theme.cardWhite} />
        <Path d={pinPath(scene.end)} fill={scene.endFill} />
        <Circle cx={scene.end.x + 5} cy={scene.end.y + 2} r={2.1} fill={Theme.cardWhite} />
      </Svg>
      <Animated.View style={[styles.truck, truckStyle]}>
        <View style={styles.truckBody} />
        <View style={styles.truckCab} />
      </Animated.View>
    </View>
  );
}

const THUMB_W = 80;
const THUMB_H = 80;

const styles = StyleSheet.create({
  frame: {
    ...StyleSheet.absoluteFillObject,
    overflow: "hidden",
  },
  truck: {
    position: "absolute",
    left: 0,
    top: 0,
    width: 11,
    height: 7,
    marginLeft: -5,
    marginTop: -3,
    flexDirection: "row",
    alignItems: "center",
  },
  truckBody: {
    width: 7,
    height: 6,
    borderRadius: 1.5,
    backgroundColor: Theme.driverGold,
  },
  truckCab: {
    width: 4,
    height: 5,
    borderTopRightRadius: 1.5,
    borderBottomRightRadius: 1.5,
    backgroundColor: Theme.driverEmerald,
  },
});
