/**
 * Shared layout tokens for the Pulse driver app.
 * Use these instead of one-off magic numbers so screens stay aligned.
 */
import { Platform, type ViewStyle } from 'react-native';
import Theme from '@/constants/Theme';

/** Card / sheet corner radius. */
export const DRIVER_CARD_RADIUS = 14;

/** Primary CTA / filled button radius. */
export const DRIVER_BTN_RADIUS = 12;

/** Compact inner padding for white cards. */
export const DRIVER_CARD_PAD = 14;

/** Vertical gap between page sections. */
export const DRIVER_SECTION_GAP = 10;

/** List / settings row height (touch target). */
export const DRIVER_ROW_HEIGHT = 48;

/** Icon well sizes. */
export const DRIVER_ICON_WELL = 32;
export const DRIVER_ICON_WELL_SM = 28;
export const DRIVER_ICON_SIZE = 15;
export const DRIVER_ICON_SIZE_SM = 13;

/** Soft card lift on white backgrounds. */
export const driverCardElevation: ViewStyle = Platform.select<ViewStyle>({
  web: {
    boxShadow: '0 2px 10px rgba(15, 23, 42, 0.06), 0 1px 2px rgba(15, 23, 42, 0.04)',
  } as ViewStyle,
  default: {
    shadowColor: Theme.textPrimaryDark,
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
}) as ViewStyle;

/** Outlined field / secondary control border. */
export const driverFieldBorder = {
  borderWidth: 1,
  borderColor: Theme.driverSecondaryGrey,
  borderRadius: DRIVER_CARD_RADIUS,
} as const;

/** Standard white card shell. */
export const driverCardShell: ViewStyle = {
  borderRadius: DRIVER_CARD_RADIUS,
  borderWidth: 1,
  borderColor: Theme.driverSecondaryGrey,
  backgroundColor: Theme.cardWhite,
  padding: DRIVER_CARD_PAD,
  ...driverCardElevation,
};
