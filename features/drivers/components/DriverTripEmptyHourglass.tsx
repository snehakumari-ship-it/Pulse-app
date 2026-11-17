/**
 * Empty trip mark. The list replaces this as soon as a trip exists.
 */
import { useEffect } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

const TRIP_EMPTY_ART = require('../../../assets/images/trip-empty-search.png') as number;

export function DriverTripEmptyHourglass() {
  const lift = useSharedValue(0);

  useEffect(() => {
    lift.value = withRepeat(
      withTiming(1, { duration: 2200, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
  }, [lift]);

  const artStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: lift.value * -4 }],
  }));

  return (
    <View style={styles.wrap} accessibilityElementsHidden pointerEvents="none">
      <Animated.View style={artStyle}>
        <Image
          source={TRIP_EMPTY_ART}
          style={styles.art}
          resizeMode="contain"
          accessibilityIgnoresInvertColors
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: 196,
    height: 152,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  art: {
    width: 196,
    height: 152,
  },
});
