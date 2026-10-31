import type { ViewStyle } from 'react-native';
import Theme from '@/constants/Theme';
import { DRIVER_CARD_RADIUS, driverCardElevation } from '@/constants/DriverUi';
import { getDriverThemeColors } from '@/contexts/DriverThemeContext';

type Colors = ReturnType<typeof getDriverThemeColors>;

/** Card radius for Commerce job-card surfaces (AgriFlow). */
export const JOB_CARD_RADIUS = DRIVER_CARD_RADIUS;

/** Soft lift used instead of heavy borders on Commerce job-card cards. */
export const softElevation: ViewStyle = driverCardElevation;

/** Card fill that lifts off the sheet surface in both driver themes. */
export function cardBackground(colors: Colors): string {
  return colors.background === Theme.driverBackground ? colors.surfaceElevated : Theme.cardWhite;
}

export type StatusTone = 'done' | 'active' | 'next' | 'pending' | 'failed';

/** Pill colours per stop/order status. Driver palette only. */
export function statusToneColors(colors: Colors, tone: StatusTone): { bg: string; fg: string } {
  switch (tone) {
    case 'done':
      return { bg: colors.emeraldMuted, fg: colors.emerald };
    case 'active':
      return { bg: Theme.accentGoldMuted, fg: Theme.warning };
    case 'next':
      return { bg: colors.emeraldMuted, fg: colors.emerald };
    case 'failed':
      return { bg: colors.negativeMuted, fg: Theme.negative };
    default:
      return { bg: colors.surfaceElevated, fg: colors.textMuted };
  }
}
