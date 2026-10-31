/**
 * Standard icon well for driver app rows and tiles.
 * Keeps icon size, well size, and radius consistent across screens.
 */
import {
  DRIVER_ICON_SIZE,
  DRIVER_ICON_SIZE_SM,
  DRIVER_ICON_WELL,
  DRIVER_ICON_WELL_SM,
} from '@/constants/DriverUi';
import { DriverMotionIcon } from '@/components/driver/DriverMotionIcon';
import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';

type Props = {
  children: ReactNode;
  backgroundColor: string;
  /** Optional border for soft wells. */
  borderColor?: string;
  size?: 'sm' | 'md';
  /** Stagger idle motion across neighbors. */
  motionDelay?: number;
  /** Disable idle motion for static chrome. */
  animate?: boolean;
  style?: ViewStyle;
};

export function DriverIconWell({
  children,
  backgroundColor,
  borderColor,
  size = 'md',
  motionDelay = 0,
  animate = true,
  style,
}: Props) {
  const dim = size === 'sm' ? DRIVER_ICON_WELL_SM : DRIVER_ICON_WELL;
  const content = animate ? (
    <DriverMotionIcon delay={motionDelay}>{children}</DriverMotionIcon>
  ) : (
    children
  );

  return (
    <View
      style={[
        styles.well,
        {
          width: dim,
          height: dim,
          borderRadius: size === 'sm' ? 10 : 12,
          backgroundColor,
          borderColor: borderColor ?? 'transparent',
          borderWidth: borderColor ? 1 : 0,
        },
        style,
      ]}
    >
      {content}
    </View>
  );
}

export const driverIconSize = DRIVER_ICON_SIZE;
export const driverIconSizeSm = DRIVER_ICON_SIZE_SM;

const styles = StyleSheet.create({
  well: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
