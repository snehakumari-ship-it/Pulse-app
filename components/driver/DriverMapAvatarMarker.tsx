import Theme from '@/constants/Theme';
import {
  resolveDriverAvatarImageSource,
} from '@/constants/DriverLevels';
import { withWebSafeShadows } from '@/lib/platformViewStyle.util';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useEffect } from 'react';
import { Truck } from 'lucide-react-native';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

export type DriverMapAvatarMarkerProps = {
  avatarUri?: string | null;
  avatarSeed?: string | null;
  isOnline?: boolean;
  /** Outer diameter including ring (default 48). */
  size?: number;
  /** Tap the online status chip to focus / view this location. */
  onPressStatus?: () => void;
  /** Truck badge once the driver has reached the active stop. */
  showArrivalTruck?: boolean;
  /** Photo by default. MapLibre trip map uses the truck face. */
  variant?: 'avatar' | 'truck';
};

function resolveAvatarSource(
  avatarUri?: string | null,
  avatarSeed?: string | null,
) {
  return resolveDriverAvatarImageSource(avatarUri, avatarSeed);
}

/** Even pixel size so CSS/border triangles stay visually centered. */
function evenPx(n: number): number {
  const r = Math.round(n);
  return r % 2 === 0 ? r : r + 1;
}

export function DriverMapAvatarMarker({
  avatarUri,
  avatarSeed,
  isOnline = false,
  size = 48,
  onPressStatus,
  showArrivalTruck = false,
  variant = 'avatar',
}: DriverMapAvatarMarkerProps) {
  const ringColor = isOnline ? Theme.darkGreen : Theme.teslaRed;
  const pulse = useSharedValue(0.35);

  useEffect(() => {
    if (!isOnline) {
      pulse.value = 0.2;
      return;
    }
    pulse.value = withRepeat(
      withSequence(
        withTiming(0.65, { duration: 900, easing: Easing.inOut(Easing.ease) }),
        withTiming(0.25, { duration: 900, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      true,
    );
  }, [isOnline, pulse]);

  const pulseStyle = useAnimatedStyle(() => ({
    opacity: pulse.value,
    transform: [{ scale: 1 + pulse.value * 0.35 }],
  }));

  const truckBob = useSharedValue(0);
  useEffect(() => {
    if (!showArrivalTruck) {
      truckBob.value = 0;
      return;
    }
    truckBob.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 900, easing: Easing.inOut(Easing.ease) }),
        withTiming(0, { duration: 900, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      false,
    );
  }, [showArrivalTruck, truckBob]);

  const truckStyle = useAnimatedStyle(() => ({
    opacity: showArrivalTruck ? 0.35 + truckBob.value * 0.65 : 0,
    transform: [{ translateY: truckBob.value * -2 }],
  }));

  const ring = Math.max(3, Math.round(size * 0.1));
  const inner = size - ring * 2;
  const tailW = evenPx(Math.max(10, size * 0.22));
  const tailH = Math.max(6, Math.round(size * 0.14));
  const statusSize = evenPx(Math.max(10, size * 0.22));
  const pulsePad = 4;
  const pulseSize = size + pulsePad * 2;

  return (
    <View style={[styles.wrap, { width: size, height: size + tailH - 1 }]}>
      {showArrivalTruck ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.truckBadge,
            truckStyle,
            { left: (size - 36) / 2 },
          ]}
        >
          <Truck size={16} color={Theme.driverEmeraldDark} strokeWidth={2.4} />
        </Animated.View>
      ) : null}
      <Animated.View
        style={[
          styles.pulseRing,
          pulseStyle,
          {
            width: pulseSize,
            height: pulseSize,
            borderRadius: pulseSize / 2,
            borderColor: ringColor,
            top: -pulsePad,
            left: -pulsePad,
          },
        ]}
        pointerEvents="none"
      />
      <View style={[styles.avatarWrap, { width: size, height: size }]}>
        <View
          style={[
            styles.avatarShell,
            {
              width: size,
              height: size,
              borderRadius: size / 2,
              borderWidth: ring,
              borderColor: ringColor,
              backgroundColor: variant === 'truck' ? Theme.cardWhite : Theme.driverEmerald,
            },
          ]}
          pointerEvents="none"
        >
          {variant === 'truck' ? (
            <MaterialCommunityIcons
              name="truck"
              size={Math.round(inner * 0.62)}
              color={Theme.driverEmeraldDark}
            />
          ) : (
            <Image
              source={resolveAvatarSource(avatarUri, avatarSeed)}
              style={{
                width: inner,
                height: inner,
                borderRadius: inner / 2,
              }}
              resizeMode="cover"
            />
          )}
        </View>
        <Pressable
          onPress={onPressStatus}
          disabled={!onPressStatus}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={isOnline ? 'View live location' : 'View location'}
          style={[
            styles.statusChip,
            {
              width: statusSize,
              height: statusSize,
              borderRadius: statusSize / 2,
              backgroundColor: ringColor,
              borderColor: '#fff',
              top: -1,
              right: -1,
            },
          ]}
        />
      </View>
      <View
        style={[
          styles.pointer,
          {
            borderLeftWidth: tailW / 2,
            borderRightWidth: tailW / 2,
            borderTopWidth: tailH,
            borderTopColor: ringColor,
          },
        ]}
        pointerEvents="none"
      />
    </View>
  );
}

const styles = withWebSafeShadows(
  StyleSheet.create({
    wrap: {
      position: 'relative',
      alignItems: 'center',
      justifyContent: 'flex-start',
    },
    truckBadge: {
      position: 'absolute',
      top: -30,
      width: 36,
      height: 22,
      borderRadius: 8,
      backgroundColor: '#ffffff',
      borderWidth: 1,
      borderColor: 'rgba(4,120,87,0.28)',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 3,
      shadowColor: '#0f172a',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.16,
      shadowRadius: 4,
      elevation: 4,
    },
    pulseRing: {
      position: 'absolute',
      borderWidth: 2,
      backgroundColor: 'transparent',
    },
    avatarWrap: {
      position: 'relative',
      zIndex: 1,
    },
    avatarShell: {
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: Theme.driverEmerald,
      shadowColor: '#0f172a',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.28,
      shadowRadius: 8,
      elevation: 8,
      overflow: 'hidden',
    },
    statusChip: {
      position: 'absolute',
      borderWidth: 2,
      zIndex: 2,
    },
    pointer: {
      width: 0,
      height: 0,
      backgroundColor: 'transparent',
      borderStyle: 'solid',
      borderLeftColor: 'transparent',
      borderRightColor: 'transparent',
      alignSelf: 'center',
      marginTop: -1,
    },
  }),
);
