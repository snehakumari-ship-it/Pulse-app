import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ArrowLeft } from 'lucide-react-native';
import Layout from '@/constants/Layout';
import { getDriverThemeColors } from '@/contexts/DriverThemeContext';

type Colors = ReturnType<typeof getDriverThemeColors>;

type Props = {
  colors: Colors;
  role: 'Pickup' | 'Delivery';
  stopIndex: number;
  stopTotal: number;
  review?: boolean;
  onBack: () => void;
};

export function StopVerificationHeader({ colors, role, stopIndex, stopTotal, review, onBack }: Props) {
  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel="Back"
        hitSlop={Layout.touchTargetHitSlop}
        style={({ pressed }) => [
          styles.back,
          { backgroundColor: colors.surfaceElevated, opacity: pressed ? 0.7 : 1 },
        ]}
      >
        <ArrowLeft size={20} color={colors.text} strokeWidth={2.4} />
      </Pressable>
      <View style={styles.center}>
        <Text style={[styles.role, { color: colors.text }]}>{role}</Text>
        <Text style={[styles.meta, { color: colors.textMuted }]} numberOfLines={1}>
          {review ? 'Details' : 'Verify'} · Stop {stopIndex} of {stopTotal}
        </Text>
      </View>
      <View style={styles.side} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Layout.screenPaddingHorizontal,
    paddingVertical: 8,
    minHeight: 60,
    gap: 12,
  },
  back: {
    width: Layout.minTouchTargetSize,
    height: Layout.minTouchTargetSize,
    borderRadius: Layout.minTouchTargetSize / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  side: {
    width: Layout.minTouchTargetSize,
  },
  center: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  role: {
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  meta: {
    fontSize: 12,
    fontWeight: '600',
  },
});
