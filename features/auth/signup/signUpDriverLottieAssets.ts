import type { AnimationObject } from 'lottie-react-native';

import DriverOtpHero from '@/assets/illustrations/OTP_Delivery_Truck_Mascot.svg';
import DriverSignInHero from '@/assets/illustrations/pulse_driver_mascot_illustration.svg';

/** Driver activation — step hero Lotties (green workforce flow). Kept for non-keypad steps. */
export const DRIVER_SIGNUP_LOTTIE = {
  phone: require('@/assets/Animated folder/phone call check.json') as AnimationObject,
  verify: require('@/assets/Animated folder/security.json') as AnimationObject,
  account: require('@/assets/Animated folder/user-info.json') as AnimationObject,
  license: require('@/assets/Animated folder/law approved.json') as AnimationObject,
  success: require('@/assets/Animated folder/delivery completed.json') as AnimationObject,
} as const;

/** Color illustration above the driver phone step. */
export const DRIVER_SIGNUP_PHONE_HERO = DriverSignInHero;

/** Color illustration above the driver OTP step. */
export const DRIVER_SIGNUP_VERIFY_HERO = DriverOtpHero;
