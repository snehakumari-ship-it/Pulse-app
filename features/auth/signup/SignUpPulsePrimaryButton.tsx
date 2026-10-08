import { memo } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {
  PULSE_PILL_BUTTON_BORDER_WIDTH,
  PULSE_PILL_BUTTON_RADIUS,
  pulsePillButtonContainerDefault,
  pulsePillButtonContainerFullWidth,
  pulsePillButtonDisabled,
  pulsePillButtonLabelLarge,
  pulsePillButtonPressed,
} from '@/constants/PulsePillButtonChrome';
import Theme from '@/constants/Theme';
import { DESKTOP_BREAKPOINT } from './signUpConstants';
import { PULSE_SIGNUP, type SignUpTheme } from './signUpPulseTheme';

export interface SignUpPulsePrimaryButtonProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'solid' | 'ready';
  style?: StyleProp<ViewStyle>;
  /** Smaller label for keypad steps that keep a large illustration. */
  dense?: boolean;
  theme?: SignUpTheme;
  testID?: string;
}

export const SignUpPulsePrimaryButton = memo(function SignUpPulsePrimaryButton({
  label,
  onPress,
  disabled = false,
  loading = false,
  variant = 'solid',
  style,
  dense = false,
  theme = PULSE_SIGNUP,
  testID,
}: SignUpPulsePrimaryButtonProps) {
  const { width } = useWindowDimensions();
  const isMobile = width < DESKTOP_BREAKPOINT;
  const inactive = disabled || loading;

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={inactive}
      style={({ pressed }) => [
        styles.btn,
        isMobile && styles.btnMobile,
        isMobile && dense && styles.btnDense,
        pulsePillButtonContainerDefault,
        pulsePillButtonContainerFullWidth,
        inactive
          ? { backgroundColor: theme.disabledBg, borderColor: theme.disabledText }
          : variant === 'ready'
            ? {
                backgroundColor: theme.primaryLight,
                borderColor: theme.primaryDark,
              }
            : {
                backgroundColor: theme.primary,
                borderColor: theme.primaryDark,
              },
        pressed && !inactive && pulsePillButtonPressed,
        inactive && pulsePillButtonDisabled,
        style,
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inactive, busy: loading }}
    >
      {loading ? (
        <ActivityIndicator color={theme.primaryButtonText ?? Theme.buttonPrimaryText} size="small" />
      ) : (
        <Text
          style={[
            pulsePillButtonLabelLarge,
            isMobile && styles.labelMobile,
            isMobile && dense && styles.labelDense,
            !inactive && theme.primaryButtonText
              ? { color: theme.primaryButtonText }
              : null,
            inactive && { color: theme.disabledText },
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  btn: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: PULSE_PILL_BUTTON_RADIUS,
    borderWidth: PULSE_PILL_BUTTON_BORDER_WIDTH,
    minHeight: 40,
    maxWidth: '100%',
    ...Platform.select({
      web: { boxSizing: 'border-box' } as object,
    }),
  },
  btnMobile: {
    minHeight: 48,
    paddingVertical: 12,
  },
  labelMobile: {
    fontSize: 15,
    letterSpacing: 0.2,
  },
  btnDense: {
    minHeight: 40,
    paddingVertical: 8,
  },
  labelDense: {
    fontSize: 13,
    lineHeight: 18,
  },
});
