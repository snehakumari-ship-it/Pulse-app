import type { TextStyle } from 'react-native';

/**
 * Poppins — loaded in `app/(driver)/_layout.tsx`.
 * PostScript names must match `useFonts({ ... })` keys from `@expo-google-fonts/poppins`.
 */
export const DriverFontFamily = {
  regular: 'Poppins_400Regular',
  medium: 'Poppins_500Medium',
  semiBold: 'Poppins_600SemiBold',
  bold: 'Poppins_700Bold',
  extraBold: 'Poppins_800ExtraBold',
} as const;

/** Default body text for driver screens (AgriFlow-style). */
export const driverBody: TextStyle = {
  fontFamily: DriverFontFamily.regular,
  letterSpacing: 0.1,
};

/**
 * Wallet trip row secondary line (route / meta): regular + tracking — match existing sizes/weights via merge order.
 */
export const driverBodySecondary: TextStyle = {
  fontFamily: DriverFontFamily.regular,
  letterSpacing: 0.1,
};

/** Primary title line on compact rows (15/500 etc.) */
export const driverBodyPrimary: TextStyle = {
  fontFamily: DriverFontFamily.medium,
  letterSpacing: 0.05,
};

export const driverUISemiBold: TextStyle = {
  fontFamily: DriverFontFamily.semiBold,
  letterSpacing: 0.08,
};

export const driverUIBold: TextStyle = {
  fontFamily: DriverFontFamily.bold,
  letterSpacing: 0.06,
};

export const driverUIExtraBold: TextStyle = {
  fontFamily: DriverFontFamily.extraBold,
  letterSpacing: 0.06,
};

/** Tab bar micro labels — keeps Typography sizing; adds family only */
export const driverTabMicroLabel: TextStyle = {
  fontFamily: DriverFontFamily.bold,
};

/** Section / card titles */
export const driverSectionTitle: TextStyle = {
  fontFamily: DriverFontFamily.semiBold,
  fontSize: 15,
  letterSpacing: -0.2,
};

/** Compact meta / secondary labels */
export const driverMeta: TextStyle = {
  fontFamily: DriverFontFamily.regular,
  fontSize: 11,
  letterSpacing: 0.1,
};
