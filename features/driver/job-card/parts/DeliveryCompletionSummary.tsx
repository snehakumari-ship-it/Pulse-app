import { StyleSheet, Text, View } from 'react-native';
import { getDriverThemeColors } from '@/contexts/DriverThemeContext';
import { cardBackground, JOB_CARD_RADIUS, softElevation } from '@/features/driver/job-card/parts/jobCardSurface';
import { ITEM_LEVEL_DELIVERY_PERSISTED } from '@/features/driver/job-card/stopVerificationSummary';
import type { StopVerificationTotals } from '@/features/driver/job-card/stopVerificationSummary';
import { expectedQtyLabel } from '@/features/driver/job-card/stopVerificationSummary';

type Colors = ReturnType<typeof getDriverThemeColors>;

type Props = {
  colors: Colors;
  delivery: boolean;
  totals: StopVerificationTotals;
};

export function DeliveryCompletionSummary({ colors, delivery, totals }: Props) {
  if (!delivery) {
    return (
      <View
        testID="pickup-completion-summary"
        style={[styles.box, { backgroundColor: colors.emeraldMuted }]}
      >
        <Text style={[styles.title, { color: colors.emerald }]}>Ready to confirm pickup</Text>
        <Text style={[styles.body, { color: colors.text }]}>{expectedQtyLabel(totals)}</Text>
      </View>
    );
  }

  return (
    <View
      testID="delivery-completion-summary"
      style={[styles.box, softElevation, { backgroundColor: cardBackground(colors) }]}
    >
      <Text style={[styles.title, { color: colors.text }]}>Stop-level confirm</Text>
      <Text style={[styles.body, { color: colors.textMuted }]}>
        {ITEM_LEVEL_DELIVERY_PERSISTED
          ? expectedQtyLabel(totals)
          : 'Confirming completes this stop, not each item.'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    borderRadius: JOB_CARD_RADIUS,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 3,
  },
  title: {
    fontSize: 13,
    fontWeight: '700',
  },
  body: {
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 16,
  },
});
