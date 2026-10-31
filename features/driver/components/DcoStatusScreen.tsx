/**
 * Become a DCO (driver-come-owner / independent owner-operator) — the single
 * owner-operator onboarding path: request and view admin approval state.
 * @see supabase/migrations/20270310200000_dco_schema_foundation.sql
 * @see supabase/migrations/20270310210000_dco_eligibility_and_admin_rpcs.sql
 */
import {
  DRIVER_DETAIL_HORIZONTAL_PAD,
  DriverSubScreenHeader,
  driverDetailPageBackground,
} from '@/components/driver/DriverSubScreenHeader';
import { DriverIconWell, driverIconSizeSm } from '@/components/driver/DriverIconWell';
import { TruckDriveMotion } from '@/components/driver/TruckDriveMotion';
import {
  DRIVER_BTN_RADIUS,
  DRIVER_CARD_PAD,
  DRIVER_CARD_RADIUS,
  DRIVER_ROW_HEIGHT,
  DRIVER_SECTION_GAP,
  driverCardElevation,
} from '@/constants/DriverUi';
import Theme from '@/constants/Theme';
import { useAuth } from '@/contexts/AuthContext';
import { useDriverTheme, useDriverThemeColors } from '@/contexts/DriverThemeContext';
import { requestDcoStatus } from '@/features/driver/services/dco.service';
import type { DriverOperatingModeKind } from '@/features/drivers/domain/driverOperatingMode';
import { useDcoStatusQuery } from '@/lib/queries/useDcoStatusQuery';
import { useDriverOperatingModeQuery } from '@/lib/queries/useDriverOperatingModeQuery';
import { ROUTES } from '@/lib/routes';
import { useRouter } from 'expo-router';
import {
  CheckCircle2,
  Clock,
  Gavel,
  ShieldAlert,
  Truck,
  Wallet,
  XCircle,
} from 'lucide-react-native';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const BENEFITS = [
  { icon: Gavel, label: 'Bid in the marketplace as an independent owner-operator' },
  { icon: Truck, label: 'Bring your own vehicle to every trip' },
  { icon: Wallet, label: 'Settle directly — no employee commission' },
] as const;

export default function DcoStatusScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile } = useAuth();
  const { isDark } = useDriverTheme();
  const colors = useDriverThemeColors();
  const pageBg = driverDetailPageBackground(isDark, colors.background);
  const { status, dcoProfile, isLoading, invalidate } = useDcoStatusQuery(profile?.uid);
  const { operatingMode } = useDriverOperatingModeQuery(profile?.uid);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/(driver)/profile');
  }, [router]);

  const handleRequest = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const { error: requestError } = await requestDcoStatus();
      if (requestError) {
        setError(requestError.message);
        return;
      }
      invalidate();
    } finally {
      setBusy(false);
    }
  }, [invalidate]);

  const cardBorder = isDark ? colors.borderSubtle : 'rgba(226,232,240,0.95)';
  const hasStatus = !isLoading && status !== 'NONE';
  const showRequestCta = !isLoading && (status === 'NONE' || status === 'REJECTED');
  const showManageCta = !isLoading && status === 'APPROVED';
  /** Approved drivers lead with status; new applicants see the pitch first. */
  const statusFirst = hasStatus && status !== 'NONE';

  const heroCard = (
    <Animated.View
      entering={FadeInDown.duration(280).springify().damping(18)}
      style={[styles.heroCard, { backgroundColor: colors.surface, borderColor: cardBorder }]}
    >
      <Text style={[styles.heroEyebrow, { color: colors.emerald }]}>DCO · DRIVER-CUM-OWNER</Text>
      <Text style={[styles.heroTitle, { color: colors.text }]}>
        {status === 'APPROVED'
          ? 'You are an independent owner-operator'
          : 'Operate as an independent owner-operator'}
      </Text>
      <Text style={[styles.heroBody, { color: colors.textMuted }]}>
        {status === 'APPROVED'
          ? 'Manage your vehicle and bid in the marketplace. DCO status is separate from fleet employment.'
          : 'DCO status is reviewed and approved by Pulse admin. It is separate from employment — if you are currently an active driver in a business fleet, you are not eligible while that employment continues.'}
      </Text>
    </Animated.View>
  );

  const statusBlock = !isLoading ? (
    <Animated.View entering={FadeInDown.delay(statusFirst ? 40 : 120).duration(280).springify().damping(18)}>
      <StatusBlock
        status={status}
        operatingMode={operatingMode.mode}
        reason={dcoProfile?.decisionReason ?? null}
        isDark={isDark}
        colors={colors}
        cardBorder={cardBorder}
      />
    </Animated.View>
  ) : (
    <ActivityIndicator color={colors.emerald} style={{ marginTop: 8 }} />
  );

  const benefitsCard = (
    <Animated.View
      entering={FadeInDown.delay(statusFirst ? 80 : 50).duration(280).springify().damping(18)}
      style={[styles.listCard, { backgroundColor: colors.surface, borderColor: cardBorder }]}
    >
      {BENEFITS.map(({ icon: Icon, label }, index) => (
        <View
          key={label}
          style={[
            styles.benefitRow,
            index < BENEFITS.length - 1 && {
              borderBottomWidth: StyleSheet.hairlineWidth,
              borderBottomColor: cardBorder,
            },
          ]}
        >
          <DriverIconWell
            size="sm"
            backgroundColor={isDark ? colors.emeraldMuted : Theme.driverEmeraldMuted}
            motionDelay={index * 100}
          >
            <Icon size={driverIconSizeSm} color={colors.emerald} strokeWidth={2.3} />
          </DriverIconWell>
          <Text style={[styles.benefitLabel, { color: colors.text }]}>{label}</Text>
        </View>
      ))}
    </Animated.View>
  );

  const cta =
    showRequestCta || showManageCta ? (
      <Animated.View entering={FadeInDown.delay(statusFirst ? 60 : 160).duration(280).springify().damping(18)}>
        <Pressable
          onPress={() => {
            if (showManageCta) {
              router.push(ROUTES.driverMyFleet() as Parameters<typeof router.push>[0]);
              return;
            }
            void handleRequest();
          }}
          disabled={busy}
          style={({ pressed }) => [
            styles.cta,
            { backgroundColor: colors.emerald, opacity: pressed || busy ? 0.88 : 1 },
          ]}
          accessibilityRole="button"
          accessibilityLabel={
            showManageCta
              ? 'Manage my vehicle'
              : status === 'REJECTED'
                ? 'Request DCO status again'
                : 'Request DCO status'
          }
        >
          {busy ? (
            <ActivityIndicator color={Theme.textOnPrimary} />
          ) : (
            <Text style={styles.ctaText}>
              {showManageCta
                ? 'Manage my vehicle'
                : status === 'REJECTED'
                  ? 'Request again'
                  : 'Request DCO status'}
            </Text>
          )}
        </Pressable>
      </Animated.View>
    ) : null;

  return (
    <View style={[styles.root, { backgroundColor: pageBg }]}>
      <DriverSubScreenHeader
        title="DCO status"
        subtitle="Independent owner-operator"
        onBack={handleBack}
      />

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: DRIVER_DETAIL_HORIZONTAL_PAD,
          paddingBottom: Math.max(insets.bottom, 16) + 28,
          paddingTop: 10,
          gap: DRIVER_SECTION_GAP,
        }}
        showsVerticalScrollIndicator={false}
      >
        {statusFirst ? (
          <>
            {statusBlock}
            {cta}
            {heroCard}
            {benefitsCard}
          </>
        ) : (
          <>
            {heroCard}
            {benefitsCard}
            {statusBlock}
            {cta}
          </>
        )}

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <Text style={[styles.footnote, { color: colors.textMuted }]}>
          DCO trips settle to you directly, at your agreed bid amount — never as employee
          commission and never through a Business's supplier ledger.
        </Text>

        {!isLoading ? (
          <Animated.View
            entering={FadeInDown.delay(200).duration(300).springify().damping(18)}
            style={styles.motionSlot}
          >
            <TruckDriveMotion color={colors.emerald} size="lg" />
          </Animated.View>
        ) : null}
      </ScrollView>
    </View>
  );
}

function StatusBlock({
  status,
  operatingMode,
  reason,
  isDark,
  colors,
  cardBorder,
}: {
  status: 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';
  operatingMode: DriverOperatingModeKind;
  reason: string | null;
  isDark: boolean;
  colors: ReturnType<typeof useDriverThemeColors>;
  cardBorder: string;
}) {
  if (status === 'NONE') return null;

  const cfg = {
    PENDING: {
      icon: Clock,
      tint: '#B45309',
      bg: isDark ? 'rgba(180,83,9,0.18)' : 'rgba(253,230,138,0.55)',
      title: 'Under review',
      body: 'Pulse admin is reviewing your DCO request.',
    },
    APPROVED: {
      icon: CheckCircle2,
      tint: colors.emerald,
      bg: isDark ? colors.emeraldMuted : 'rgba(220,252,231,0.9)',
      title: 'DCO approved',
      body:
        operatingMode === 'DCO'
          ? 'You can bid in the marketplace as an independent owner-operator.'
          : operatingMode === 'DCO_EMPLOYMENT_CONFLICT'
            ? 'You are still linked to a business as an employee driver. Leave that fleet to use Marketplace.'
            : 'Add an active vehicle to your fleet to use Marketplace.',
    },
    REJECTED: {
      icon: XCircle,
      tint: Theme.negative,
      bg: isDark ? 'rgba(153,27,27,0.18)' : 'rgba(254,226,226,0.9)',
      title: 'Request rejected',
      body: reason || 'Your DCO request was not approved.',
    },
    SUSPENDED: {
      icon: ShieldAlert,
      tint: Theme.negative,
      bg: isDark ? 'rgba(153,27,27,0.18)' : 'rgba(254,226,226,0.9)',
      title: 'DCO suspended',
      body: reason || 'Your DCO status is currently suspended by Pulse admin.',
    },
  }[status];

  const Icon = cfg.icon;

  return (
    <View style={[styles.statusCard, { backgroundColor: cfg.bg, borderColor: cardBorder }]}>
      <View style={styles.statusIconSlot}>
        <Icon size={22} color={cfg.tint} strokeWidth={2.4} />
      </View>
      <View style={styles.statusTextWrap}>
        <Text style={[styles.statusTitle, { color: colors.text }]}>{cfg.title}</Text>
        <Text style={[styles.statusBody, { color: colors.textMuted }]}>{cfg.body}</Text>
        {status === 'SUSPENDED' ? (
          <Text style={[styles.statusBody, { color: colors.textMuted }]}>
            Contact Pulse support — suspension is reversed by admin, not self-service.
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  heroCard: {
    borderRadius: DRIVER_CARD_RADIUS,
    borderWidth: StyleSheet.hairlineWidth,
    padding: DRIVER_CARD_PAD,
    gap: 6,
    ...driverCardElevation,
  },
  heroEyebrow: { fontSize: 10, fontWeight: '700', letterSpacing: 0.8 },
  heroTitle: { fontSize: 18, fontWeight: '800', letterSpacing: -0.3, lineHeight: 24 },
  heroBody: { fontSize: 12, lineHeight: 17 },
  listCard: {
    borderRadius: DRIVER_CARD_RADIUS,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 2,
    ...driverCardElevation,
  },
  benefitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: DRIVER_ROW_HEIGHT,
    paddingVertical: 8,
  },
  benefitLabel: { flex: 1, fontSize: 13, fontWeight: '600', lineHeight: 18 },
  statusCard: {
    flexDirection: 'row',
    gap: 12,
    borderRadius: DRIVER_CARD_RADIUS,
    borderWidth: StyleSheet.hairlineWidth,
    padding: DRIVER_CARD_PAD,
    alignItems: 'flex-start',
    ...driverCardElevation,
  },
  statusIconSlot: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  statusTextWrap: { flex: 1, gap: 3, minWidth: 0 },
  statusTitle: { fontSize: 15, fontWeight: '700' },
  statusBody: { fontSize: 12, lineHeight: 16 },
  errorText: { fontSize: 13, fontWeight: '600', color: Theme.negative },
  cta: {
    minHeight: DRIVER_ROW_HEIGHT,
    borderRadius: DRIVER_BTN_RADIUS,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  ctaText: { fontSize: 15, fontWeight: '700', color: Theme.textOnPrimary },
  footnote: { fontSize: 11, lineHeight: 16, textAlign: 'center', paddingHorizontal: 8 },
  motionSlot: {
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
    width: '100%',
    paddingHorizontal: 4,
    minHeight: 120,
    marginTop: 4,
  },
});
