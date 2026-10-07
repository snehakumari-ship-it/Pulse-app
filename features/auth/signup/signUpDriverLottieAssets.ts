import type { AnimationObject } from 'lottie-react-native';

/** Driver activation — step hero Lotties (green workforce flow). Kept for non-keypad steps. */
export const DRIVER_SIGNUP_LOTTIE = {
  phone: require('@/assets/Animated folder/phone call check.json') as AnimationObject,
  verify: require('@/assets/Animated folder/security.json') as AnimationObject,
  account: require('@/assets/Animated folder/user-info.json') as AnimationObject,
  license: require('@/assets/Animated folder/law approved.json') as AnimationObject,
  success: require('@/assets/Animated folder/delivery completed.json') as AnimationObject,
} as const;

/** Color illustration above the driver phone step. */
export const DRIVER_SIGNUP_PHONE_HERO = require('@/assets/illustrations/Friendly Blue Mascot Delivery Scene.png');

/** Color illustration above the driver OTP step. */
export const DRIVER_SIGNUP_VERIFY_HERO = require('@/assets/illustrations/OTP Delivery Truck Mascot.png');
