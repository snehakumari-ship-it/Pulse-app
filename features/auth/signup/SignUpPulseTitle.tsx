import { memo, type ReactNode } from 'react';
import { Platform, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { DESKTOP_BREAKPOINT } from './signUpConstants';
import { PULSE_SIGNUP } from './signUpPulseTheme';
import { createPulseSignUpTextStyles } from './signUpTypography';

export interface SignUpPulseTitleProps {
  title: string;
  subtitle?: string | ReactNode;
  centered?: boolean;
  compact?: boolean;
}

export const SignUpPulseTitle = memo(function SignUpPulseTitle({
  title,
  subtitle,
  centered = true,
  compact = false,
}: SignUpPulseTitleProps) {
  const { width } = useWindowDimensions();
  const isDesktop = width >= DESKTOP_BREAKPOINT;
  const text = createPulseSignUpTextStyles(PULSE_SIGNUP);
  const isMobile = !isDesktop;
  const compactType = compact && isDesktop;
  const compactMobile = compact && isMobile;

  return (
    <View
      style={[
        styles.wrap,
        centered && styles.centered,
        isMobile && styles.wrapMobile,
        compactMobile && styles.wrapDense,
      ]}
    >
      <Text
        style={[
          text.title,
          isDesktop && text.titleDesktop,
          isMobile && text.titleMobile,
          compactType && text.titleCompact,
          compactMobile && styles.titleDense,
          centered ? styles.titleCenter : styles.titleLeft,
        ]}
      >
        {title}
      </Text>
      {subtitle ? (
        typeof subtitle === 'string' ? (
          <Text
            style={[
              text.subtitle,
              isDesktop && text.subtitleDesktop,
              isMobile && text.subtitleMobile,
              compactType && text.subtitleCompact,
              compactMobile && styles.subtitleDense,
              centered ? styles.subtitleCenter : styles.subtitleLeft,
            ]}
          >
            {subtitle}
          </Text>
        ) : (
          <View style={centered ? styles.subtitleSlotCenter : styles.subtitleSlotLeft}>
            {subtitle}
          </View>
        )
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    marginBottom: Platform.OS === 'web' ? 8 : 10,
  },
  wrapCompact: {
    marginBottom: Platform.OS === 'web' ? 6 : 8,
  },
  wrapMobile: {
    marginBottom: Platform.OS === 'web' ? 12 : 14,
  },
  wrapDense: {
    marginBottom: 6,
  },
  titleDense: {
    fontSize: 17,
    lineHeight: 22,
    letterSpacing: -0.2,
  },
  subtitleDense: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
  },
  centered: {
    alignItems: 'center',
  },
  titleLeft: {
    textAlign: 'left',
    alignSelf: 'stretch',
  },
  titleCenter: {
    textAlign: 'center',
    alignSelf: 'center',
  },
  subtitleLeft: {
    textAlign: 'left',
    alignSelf: 'stretch',
    maxWidth: undefined,
  },
  subtitleCenter: {
    textAlign: 'center',
    alignSelf: 'center',
    maxWidth: 360,
  },
  subtitleSlotLeft: {
    alignSelf: 'stretch',
    width: '100%',
  },
  subtitleSlotCenter: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: 320,
    alignItems: 'center',
  },
});
