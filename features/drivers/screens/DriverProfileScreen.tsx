/**
 * Driver Profile — hero, fleet vehicle, levels, KYC shortcut to documents (single upload hub).
 */
import { DriverIconWell, driverIconSize, driverIconSizeSm } from '@/components/driver/DriverIconWell';
import { MapPinSearchMotion } from '@/components/driver/MapPinSearchMotion';
import {
  DRIVER_CARD_RADIUS,
  DRIVER_ROW_HEIGHT,
  DRIVER_SECTION_GAP,
  driverCardElevation,
} from '@/constants/DriverUi';
import Layout from '@/constants/Layout';
import Theme from '@/constants/Theme';
import { useAuth } from '@/contexts/AuthContext';
import { useDriverAvatar } from '@/contexts/DriverAvatarContext';
import { useDriverTheme, useDriverThemeColors } from '@/contexts/DriverThemeContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { EditProfileModal } from '@/features/auth/components/EditProfileModal';
import * as driversService from '@/features/drivers/services/drivers.service';
import { MilestoneHowToModal } from '@/features/experience/components/MilestoneHowToModal';
import {
    computeExperienceProgress,
    countFiveStarRatings,
    getMilestoneCount,
    isMilestoneCompleted,
    isMilestoneInProgress,
    type ExperienceLevelConfig,
    type MilestoneGuideActionKind,
} from '@/features/experience/experienceProgress';
import {
    averageScore,
    getRatingsForDrivers,
} from '@/features/ratings/services/ratings.service';
import type { RatingRow } from '@/features/ratings/types';
import { getVehicleById } from '@/features/vehicles/services/vehicles.service';
import { useDcoStatusQuery } from '@/lib/queries/useDcoStatusQuery';
import { subscribeSharedPostgresChanges } from '@/lib/realtimeRegistry';
import { ROUTES } from '@/lib/routes';
import { supabase } from '@/lib/supabase';
import { useAvatar } from '@/lib/useAvatar';
import { useFocusEffect } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import {
    Camera,
    ChevronLeft,
    ChevronRight,
    Crown,
    Fuel,
    Gauge,
    Gavel,
    Globe,
    History,
    LogOut,
    Milestone,
    Share2,
    Shield,
    Star,
    Thermometer,
    Trophy,
    Truck,
    UserPlus,
} from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Image,
    Platform,
    Pressable,
    ScrollView,
    Share,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
    type ViewStyle,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const SCREEN_PAD = Layout.screenPaddingHorizontal;

/**
 * Clear absolute DriverTabBar footer on web/native.
 * Footer = padTop(6) + dock (tabBarHeight+5) + padBottom(max(inset*0.35, 10)).
 */
function driverTabBarScrollInset(bottomInset: number): number {
  const footerPadTop = 6;
  const dockHeight = Layout.tabBarHeight + 5;
  const footerPadBottom = Math.max(Math.round(bottomInset * 0.35), 10);
  return footerPadTop + dockHeight + footerPadBottom + 56;
}

/** Reference palette — heroes stay slate-900 for brand match; page bg uses theme. */
const SLATE_900 = '#0f172a';
const SLATE_50 = Theme.surfaceGray;
const AMBER_400 = '#fbbf24';
const AMBER_500 = '#f59e0b';

type ProfileView = 'main' | 'vehicle' | 'levels';

/** Same completion rule as trip history: status or a stamped completed_at. */
const COMPLETED_TRIP_FILTER =
  'status.in.(completed,delivered,done),completed_at.not.is.null';

const webPress: ViewStyle | null =
  Platform.OS === 'web' ? ({ cursor: 'pointer' } as ViewStyle) : null;

async function countCompletedTrips(driverIds: string[]): Promise<number> {
  const { count, error } = await supabase()
    .from('trips')
    .select('id', { count: 'exact', head: true })
    .in('driver_id', driverIds)
    .is('deleted_at', null)
    .or(COMPLETED_TRIP_FILTER);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function lookupTripVehicleNumber(driverIds: string[]): Promise<string | null> {
  const { data, error } = await supabase()
    .from('trips')
    .select('vehicle_display_number')
    .in('driver_id', driverIds)
    .not('vehicle_display_number', 'is', null)
    .limit(1);
  if (error) return null;
  const row = (data ?? [])[0] as { vehicle_display_number?: string | null } | undefined;
  const num = (row?.vehicle_display_number ?? '').trim();
  return num.length > 0 ? num : null;
}

function formatShortDate(iso?: string | null) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return '—';
  }
}

export default function DriverProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { theme } = useDriverTheme();
  const isDark = theme === 'dark';
  const colors = useDriverThemeColors();
  const { user, profile, signOut, refreshSession, patchProfile } = useAuth();
  const { status: dcoStatus } = useDcoStatusQuery(profile?.uid);
  const { locale, localeOptions } = useLanguage();
  const languageLabel =
    localeOptions.find((o) => o.value === locale)?.label ?? 'English';
  const { avatarSeed, setAvatarSeed, setPreviewUri } = useDriverAvatar();
  const [showEditProfileModal, setShowEditProfileModal] = useState(false);
  const [profileView, setProfileView] = useState<ProfileView>('main');
  const [guideLevel, setGuideLevel] = useState<ExperienceLevelConfig | null>(null);
  const [drivers, setDrivers] = useState<driversService.DriverRow[]>([]);
  const [driverIds, setDriverIds] = useState<string[]>([]);
  const [completedTripCount, setCompletedTripCount] = useState(0);
  const [loadingTrips, setLoadingTrips] = useState(true);
  const [tripsLoaded, setTripsLoaded] = useState(false);
  const [tripVehicleLabel, setTripVehicleLabel] = useState<string | null>(null);
  const [driverRatings, setDriverRatings] = useState<RatingRow[]>([]);
  const [loadingDriverRatings, setLoadingDriverRatings] = useState(false);
  const [kycUploadedCount, setKycUploadedCount] = useState(0);
  const [kycStatus, setKycStatus] = useState<{
    reviewStatus: string | null;
    isVerified: boolean;
    verifiedDocs: number;
    requiredDocs: number;
  } | null>(null);
  const [assignedVehicleLabel, setAssignedVehicleLabel] = useState<string | null>(null);
  const [assignedVehicleMeta, setAssignedVehicleMeta] = useState<{
    model?: string | null;
    type?: string | null;
    brand?: string | null;
  } | null>(null);

  const scrollBottomPad = driverTabBarScrollInset(insets.bottom);

  const displayName =
    profile?.full_name?.trim() ||
    profile?.displayName?.trim() ||
    user?.email?.split('@')[0] ||
    'Pilot';

  const {
    imageSource: displayAvatarSource,
    initials: displayAvatarInitials,
    initialsColor: displayAvatarColor,
  } = useAvatar({
    type: 'driver',
    name: displayName,
    avatarUrl: profile?.avatar_url ?? null,
    avatarSeed: profile?.avatar_url?.trim()
      ? null
      : profile?.avatar_seed?.trim() || avatarSeed,
  });

  const tripLoadGen = useRef(0);
  const loadTrips = useCallback(() => {
    const gen = ++tripLoadGen.current;
    if (!profile?.uid) {
      setLoadingTrips(false);
      setTripsLoaded(true);
      setCompletedTripCount(0);
      setTripVehicleLabel(null);
      return;
    }
    setLoadingTrips(true);
    driversService
      .getLinkedDriversForCurrentUser(profile.uid)
      .then(async (res) => {
        if (gen !== tripLoadGen.current) return;
        // All driver rows (including left fleets) — experience is cumulative.
        const allRows = res.drivers ?? [];
        const ids = allRows.map((d) => d.id);
        // UI fleet display: active fleet links only. tracking_only rows are trip-assignment
        // identities (e.g. the shipper that awarded a Marketplace bid), not a fleet.
        setDrivers(allRows.filter((d) => !d.left_at && d.tracking_only !== true));
        // Same id set the count below uses — drives the realtime subscription filter.
        setDriverIds(ids);
        if (ids.length === 0) {
          setCompletedTripCount(0);
          setTripVehicleLabel(null);
          setTripsLoaded(true);
          return;
        }
        const [count, plate] = await Promise.all([
          countCompletedTrips(ids),
          lookupTripVehicleNumber(ids),
        ]);
        if (gen !== tripLoadGen.current) return;
        setCompletedTripCount(count);
        setTripVehicleLabel(plate);
        setTripsLoaded(true);
      })
      .catch((err: unknown) => {
        if (gen !== tripLoadGen.current) return;
        console.warn('[profile] trip summary:', err instanceof Error ? err.message : err);
        setTripsLoaded(true);
      })
      .finally(() => {
        if (gen === tripLoadGen.current) setLoadingTrips(false);
      });
  }, [profile?.uid]);

  /**
   * Reads driver_kyc_status — the authoritative view over driver_kyc_documents
   * and driver_kyc_submissions. This previously inferred KYC state from auth
   * user_metadata, a driver_profiles column, and storage filename prefixes
   * (all pre-dating the driver_kyc_documents table), so it could never show
   * verification and drifted from the real rows: an approved driver still read
   * "3/3 uploaded" with no mention of being verified.
   */
  const loadKycSummary = useCallback(async () => {
    if (!profile?.uid) {
      setKycUploadedCount(0);
      setKycStatus(null);
      return;
    }
    try {
      const { data } = await supabase()
        .from('driver_kyc_status')
        .select('review_status,is_verified,verified_docs,uploaded_docs,required_docs')
        .eq('driver_user_id', profile.uid)
        .maybeSingle();

      const row = data as {
        review_status: string | null;
        is_verified: boolean | null;
        verified_docs: number | null;
        uploaded_docs: number | null;
        required_docs: number | null;
      } | null;

      if (row) {
        setKycStatus({
          reviewStatus: row.review_status,
          isVerified: !!row.is_verified,
          verifiedDocs: row.verified_docs ?? 0,
          requiredDocs: row.required_docs ?? 0,
        });
        setKycUploadedCount(row.uploaded_docs ?? 0);
        return;
      }

      // No submission yet — fall back to counting uploaded documents so the
      // row still reflects progress before the driver presses submit.
      const { count } = await supabase()
        .from('driver_kyc_documents')
        .select('id', { count: 'exact', head: true })
        .eq('driver_user_id', profile.uid)
        .is('deleted_at', null);
      setKycStatus(null);
      setKycUploadedCount(count ?? 0);
    } catch {
      setKycUploadedCount(0);
      setKycStatus(null);
    }
  }, [profile?.uid]);

  useEffect(() => {
    loadTrips();
  }, [loadTrips]);

  useFocusEffect(useCallback(() => {
    loadTrips();
  }, [loadTrips]));

  // Shared with LevelProgressionScreen's identical subscription (same signed-in user
  // resolves the same driverIds) — same key means the realtime registry dedupes to one
  // channel instead of two when both screens are mounted. Scoped to this user's own
  // driver_id(s) — a driver's trips can span multiple orgs, so organization_id can't be
  // used here; waits for driverIds to resolve before subscribing.
  const driverIdsKey = driverIds.join(',');
  useEffect(() => {
    if (!profile?.uid || driverIds.length === 0) return;
    return subscribeSharedPostgresChanges(
      `driver-app:trips:driver:${profile.uid}`,
      [{ event: '*', schema: 'public', table: 'trips', filter: `driver_id=in.(${driverIdsKey})` }],
      () => { loadTrips(); },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- driverIdsKey is the stable dep for driverIds
  }, [profile?.uid, driverIdsKey, loadTrips]);

  useEffect(() => {
    void loadKycSummary();
  }, [loadKycSummary]);

  const primaryDriver = drivers[0] ?? null;

  useEffect(() => {
    let cancelled = false;
    const orgId = String(primaryDriver?.organization_id ?? '').trim();
    const vehicleId = String(primaryDriver?.assigned_vehicle_id ?? '').trim();
    if (!orgId || !vehicleId) {
      setAssignedVehicleLabel(null);
      setAssignedVehicleMeta(null);
      return;
    }
    void getVehicleById(orgId, vehicleId).then((res) => {
      if (cancelled) return;
      const v = res.vehicle;
      if (!v) {
        setAssignedVehicleLabel(null);
        setAssignedVehicleMeta(null);
        return;
      }
      setAssignedVehicleLabel((v.vehicle_number ?? '').trim() || null);
      setAssignedVehicleMeta({
        model: v.vehicle_model,
        type: v.vehicle_type,
        brand: v.vehicle_brand,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [primaryDriver?.organization_id, primaryDriver?.assigned_vehicle_id]);

  const tripsCount = completedTripCount;

  useEffect(() => {
    if (driverIds.length === 0) {
      setDriverRatings([]);
      setLoadingDriverRatings(false);
      return;
    }
    let cancelled = false;
    setLoadingDriverRatings(true);
    void getRatingsForDrivers(driverIds)
      .then((res) => {
        if (cancelled) return;
        if (res.error) {
          setDriverRatings([]);
          return;
        }
        const rows = Object.values(res.byDriverId ?? {}).flat();
        setDriverRatings(rows);
      })
      .catch(() => {
        if (!cancelled) setDriverRatings([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingDriverRatings(false);
      });
    return () => {
      cancelled = true;
    };
    // driverIdsKey is the stable dep for driverIds
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driverIdsKey]);

  const driverRatingAvg = useMemo(() => averageScore(driverRatings), [driverRatings]);
  const driverRatingCount = driverRatings.length;

  const experience = useMemo(
    () =>
      computeExperienceProgress({
        hasSignedUp: Boolean(profile?.uid || user?.uid),
        completedTrips: tripsCount,
        isVerified: Boolean(kycStatus?.isVerified),
        fiveStarCount: countFiveStarRatings(driverRatings),
      }),
    [profile?.uid, user?.uid, tripsCount, kycStatus?.isVerified, driverRatings],
  );
  const {
    currentLevel,
    currentLevelConfig,
    nextLevelConfig,
    experiencePct,
  } = experience;

  const handleMilestoneGuideAction = (kind: MilestoneGuideActionKind) => {
    setGuideLevel(null);
    if (kind === 'documents') {
      router.push('/(driver)/documents');
      return;
    }
    if (kind === 'find_work') {
      router.push(ROUTES.driverAvailableLoads());
    }
  };

  const fleetOrgName =
    (primaryDriver?.organizations as { name?: string } | null | undefined)?.name?.trim() ||
    'Fleet';
  const plateLabel = assignedVehicleLabel || tripVehicleLabel;
  const modelParts = [
    assignedVehicleMeta?.brand?.trim(),
    assignedVehicleMeta?.model?.trim() || assignedVehicleMeta?.type?.trim(),
  ].filter(Boolean);
  const vehicleDisplay = {
    model: modelParts.length > 0 ? modelParts.join(' ') : plateLabel ? 'Assigned vehicle' : 'No vehicle assigned',
    plate: plateLabel || (primaryDriver ? 'Not linked yet' : '—'),
    fleetId: fleetOrgName.slice(0, 18).toUpperCase(),
    assignedOn: formatShortDate(primaryDriver?.created_at),
    supervisor: fleetOrgName,
    odometer: '—',
    fuel: '—',
    engineTemp: '—',
    specs: [
      { label: 'Type', value: assignedVehicleMeta?.type?.trim() || '—' },
      { label: 'Brand', value: assignedVehicleMeta?.brand?.trim() || '—' },
      { label: 'Model', value: assignedVehicleMeta?.model?.trim() || '—' },
      { label: 'Plate', value: plateLabel || '—' },
    ] as { label: string; value: string }[],
    health: [
      { label: 'Assignment', value: plateLabel ? 'Linked' : 'Pending', color: Theme.driverEmerald },
      { label: 'Fleet', value: fleetOrgName, color: Theme.driverEmerald },
      { label: 'Status', value: primaryDriver ? 'Active' : '—', color: Theme.driverEmerald },
    ] as { label: string; value: string; color: string }[],
  };

  const handleBack = () => {
    if (profileView !== 'main') {
      setProfileView('main');
      return;
    }
    if (router.canGoBack()) router.back();
    else router.replace('/(driver)');
  };

  const buildDriverInviteUrl = () => {
    const base = 'https://pulse.netlify.app/invite';
    const ref = profile?.uid;
    return ref ? `${base}?ref=${ref}` : base;
  };

  const handleShareProfile = () => {
    Share.share({
      message: `${displayName} — Pulse Driver profile`,
      title: 'Share profile',
    }).catch(() => {});
  };

  const handleInviteDrivers = () => {
    const inviteUrl = buildDriverInviteUrl();
    const message =
      `Join me on Pulse Driver! Manage trips, payouts, and network requests.\n\n` +
      `Sign up here: ${inviteUrl}`;
    Share.share({
      title: 'Join Pulse Driver',
      message,
      url: inviteUrl,
    }).catch(() => {});
  };

  const handleSignOut = () => {
    void Promise.race([
      signOut(),
      new Promise<void>((resolve) => {
        setTimeout(resolve, 4000);
      }),
    ]).finally(() => {
      router.replace(ROUTES.SIGN_IN_DIRECT);
    });
  };

  const pageBg = isDark ? colors.background : SLATE_50;
  const cardBorder = isDark ? colors.borderSubtle : 'rgba(226,232,240,0.9)';
  const muted = colors.textMuted;

  const LevelView = () => (
    <View style={styles.subPage}>
      <View style={styles.subHeaderRow}>
        <TouchableOpacity style={[styles.iconPill, { borderColor: cardBorder, backgroundColor: colors.surface }]} onPress={() => setProfileView('main')}>
          <ChevronLeft size={20} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.subTitle, { color: colors.text }]}>EXPERIENCE ROADMAP</Text>
      </View>

      <View style={styles.heroDark}>
        <View style={styles.heroWatermark}>
          <Milestone size={120} color="rgba(255,255,255,0.06)" />
        </View>
        <View style={styles.rankRow}>
          <LinearGradient colors={[AMBER_500, '#d97706']} style={styles.crownBox}>
            <Crown size={28} color="#fff" />
          </LinearGradient>
          <View>
            <Text style={styles.heroEyebrowGold}>CURRENT MILESTONE</Text>
            <Text style={styles.heroRankTitle}>
              {currentLevelConfig.tier} · {currentLevelConfig.name}
            </Text>
          </View>
        </View>

        <View style={styles.roadLineWrap}>
          <View style={styles.roadLine} />
          {experience.levels.map((step) => {
            const past = isMilestoneCompleted(step.level, experience);
            const active = isMilestoneInProgress(step.level, experience);
            const count = getMilestoneCount(step, experience.metrics);
            return (
                <Pressable
                  key={step.level}
                  style={styles.roadStep}
                  onPress={() => setGuideLevel(step)}
                  accessibilityRole="button"
                  accessibilityLabel={`L${step.level} ${step.name}. ${step.goalText}`}
                  accessibilityHint="Shows what to do to complete this level"
                >
                <View
                  style={[
                    styles.roadDot,
                    { borderColor: SLATE_900 },
                    active && { backgroundColor: AMBER_400 },
                    past && !active && { backgroundColor: Theme.driverEmerald },
                    !past && !active && { backgroundColor: '#475569' },
                  ]}
                />
                <View style={[styles.roadCard, active ? styles.roadCardActive : styles.roadCardMuted]}>
                  <View style={styles.roadCardTop}>
                    <Text style={styles.roadTier}>
                      L{step.level} {step.name}
                    </Text>
                    <Text style={styles.roadMin}>{step.goalText}</Text>
                  </View>
                  {active ? (
                    <View style={{ marginTop: 10 }}>
                      <View style={styles.roadProgLabels}>
                        <Text style={styles.roadProgLeft}>
                          {nextLevelConfig
                            ? `Progress to ${nextLevelConfig.name}`
                            : 'Final milestone'}
                        </Text>
                        <Text style={styles.roadProgPct}>{experiencePct}%</Text>
                      </View>
                      <View style={styles.progressTrack}>
                        <View style={[styles.progressFillGold, { width: `${experiencePct}%` }]} />
                      </View>
                      <Text style={[styles.roadMin, { marginTop: 6 }]}>
                        {count.done}/{count.target} · unlocks {step.privilege}
                      </Text>
                    </View>
                  ) : null}
                </View>
                </Pressable>
            );
          })}
        </View>
      </View>

      <View style={[styles.metricsCard, { backgroundColor: colors.surface, borderColor: cardBorder }]}>
        <Text style={[styles.metricsTitle, { color: muted }]}>EXPERIENCE METRICS</Text>
        <View style={styles.metricsGrid}>
          <View style={[styles.metricCell, { backgroundColor: isDark ? colors.surfaceElevated : '#f1f5f9' }]}>
            <Text style={[styles.metricLabel, { color: muted }]}>TRIPS DONE</Text>
            <Text style={[styles.metricValue, { color: colors.text }]}>{tripsCount}</Text>
          </View>
          <View style={[styles.metricCell, { backgroundColor: isDark ? colors.surfaceElevated : '#f1f5f9' }]}>
            <Text style={[styles.metricLabel, { color: muted }]}>5★ RATINGS</Text>
            <Text style={[styles.metricValue, { color: Theme.driverEmeraldDark }]}>
              {experience.metrics.fiveStarCount}
            </Text>
          </View>
        </View>
      </View>
    </View>
  );

  const VehicleTechnicalView = () => {
    const hasPlate = Boolean(plateLabel);
    const readings = [
      { key: 'fuel', label: 'Fuel', value: vehicleDisplay.fuel, icon: Fuel, tint: Theme.driverEmeraldMuted, color: Theme.driverEmerald },
      { key: 'km', label: 'Km', value: vehicleDisplay.odometer, icon: Gauge, tint: Theme.assignmentVehicleAccentSoft, color: Theme.assignmentVehicleAccent },
      { key: 'temp', label: 'Temp', value: vehicleDisplay.engineTemp, icon: Thermometer, tint: 'rgba(244,63,94,0.1)', color: '#e11d48' },
    ] as const;
    const hasLiveReadings = readings.some((r) => r.value !== '—');
    const specRows = vehicleDisplay.specs.filter((s) => s.label !== 'Plate');
    const statusRows = [
      { label: 'Assignment', value: hasPlate ? 'Linked' : 'Pending', ok: hasPlate },
      { label: 'Status', value: primaryDriver ? 'Active' : '—', ok: Boolean(primaryDriver) },
    ];

    return (
      <View style={styles.vehiclePage}>
        <View style={styles.vehicleHeader}>
          <TouchableOpacity
            style={[styles.vehicleBack, { borderColor: cardBorder, backgroundColor: colors.surface }]}
            onPress={() => setProfileView('main')}
            accessibilityRole="button"
            accessibilityLabel="Back to profile"
          >
            <ChevronLeft size={18} color={colors.text} />
          </TouchableOpacity>
          <View style={styles.vehicleHeaderCopy}>
            <Text style={[styles.vehicleHeaderTitle, { color: colors.text }]}>Fleet vehicle</Text>
            <Text style={[styles.vehicleHeaderSub, { color: muted }]} numberOfLines={1}>
              {vehicleDisplay.plate}
            </Text>
          </View>
        </View>

        <Animated.View
          entering={FadeInDown.duration(280).springify().damping(18)}
          style={[styles.identityCard, { backgroundColor: colors.surface, borderColor: cardBorder }]}
        >
          <View style={styles.identityTop}>
            <DriverIconWell backgroundColor={Theme.driverEmeraldMuted} motionDelay={0}>
              <Truck size={driverIconSize} color={Theme.driverEmerald} />
            </DriverIconWell>
            <View style={styles.identityText}>
              <Text style={[styles.identityPlate, { color: colors.text }]} numberOfLines={1}>
                {vehicleDisplay.plate}
              </Text>
              <Text style={[styles.identityModel, { color: muted }]} numberOfLines={1}>
                {vehicleDisplay.model}
              </Text>
            </View>
          </View>
          <View style={[styles.identityMeta, { borderTopColor: cardBorder }]}>
            <View style={styles.identityMetaCell}>
              <Text style={[styles.identityMetaLabel, { color: muted }]}>Fleet</Text>
              <Text style={[styles.identityMetaValue, { color: colors.text }]} numberOfLines={1}>
                {vehicleDisplay.supervisor}
              </Text>
            </View>
            <View style={[styles.identityMetaRule, { backgroundColor: cardBorder }]} />
            <View style={styles.identityMetaCell}>
              <Text style={[styles.identityMetaLabel, { color: muted }]}>Assigned</Text>
              <Text style={[styles.identityMetaValue, { color: colors.text }]} numberOfLines={1}>
                {vehicleDisplay.assignedOn}
              </Text>
            </View>
          </View>
        </Animated.View>

        <Animated.View
          entering={FadeInDown.delay(50).duration(280).springify().damping(18)}
          style={[styles.readingCard, { backgroundColor: colors.surface, borderColor: cardBorder }]}
        >
          {hasLiveReadings ? (
            readings.map((reading, index) => {
              const Icon = reading.icon;
              const empty = reading.value === '—';
              return (
                <View
                  key={reading.key}
                  style={[
                    styles.readingCell,
                    index > 0 && { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: cardBorder },
                  ]}
                >
                  <DriverIconWell size="sm" backgroundColor={reading.tint} motionDelay={index * 120} animate={false}>
                    <Icon size={driverIconSizeSm} color={reading.color} />
                  </DriverIconWell>
                  <Text style={[styles.readingValue, { color: empty ? muted : colors.text }]}>{reading.value}</Text>
                  <Text style={[styles.readingLabel, { color: muted }]}>{reading.label}</Text>
                </View>
              );
            })
          ) : (
            <View style={styles.readingEmpty}>
              <Text style={[styles.readingEmptyTitle, { color: colors.text }]}>Live telemetry</Text>
              <Text style={[styles.readingEmptyBody, { color: muted }]}>
                Fuel, distance, and temperature will show here when the vehicle is online.
              </Text>
            </View>
          )}
        </Animated.View>

        <Animated.View
          entering={FadeInDown.delay(100).duration(280).springify().damping(18)}
          style={[styles.detailCard, { backgroundColor: colors.surface, borderColor: cardBorder }]}
        >
          <Text style={[styles.detailGroup, { color: muted }]}>Specs</Text>
          {specRows.map((row, index) => (
            <View
              key={row.label}
              style={[
                styles.detailRow,
                index < specRows.length - 1 && {
                  borderBottomWidth: StyleSheet.hairlineWidth,
                  borderBottomColor: cardBorder,
                },
              ]}
            >
              <Text style={[styles.detailLabel, { color: muted }]}>{row.label}</Text>
              <Text
                style={[styles.detailValue, { color: row.value === '—' ? muted : colors.text }]}
                numberOfLines={1}
              >
                {row.value}
              </Text>
            </View>
          ))}
          <Text style={[styles.detailGroup, styles.detailGroupNext, { color: muted, borderTopColor: cardBorder }]}>
            Status
          </Text>
          {statusRows.map((row, index) => (
            <View
              key={row.label}
              style={[
                styles.detailRow,
                index < statusRows.length - 1 && {
                  borderBottomWidth: StyleSheet.hairlineWidth,
                  borderBottomColor: cardBorder,
                },
              ]}
            >
              <Text style={[styles.detailLabel, { color: muted }]}>{row.label}</Text>
              <Text
                style={[
                  styles.detailValue,
                  { color: row.value === '—' ? muted : row.ok ? Theme.driverEmerald : colors.text },
                ]}
                numberOfLines={1}
              >
                {row.value}
              </Text>
            </View>
          ))}
        </Animated.View>

        <Animated.View
          entering={FadeInDown.delay(160).duration(300).springify().damping(18)}
          style={styles.vehicleMotionSlot}
        >
          <MapPinSearchMotion size="md" />
          <Text style={[styles.vehicleMotionCaption, { color: muted }]}>Location tracking ready</Text>
        </Animated.View>
      </View>
    );
  };

  return (
    <View style={[styles.outer, { backgroundColor: pageBg }]}>
      <View
        style={[
          styles.topBar,
          {
            paddingTop: insets.top + Layout.driverHeaderTopOffset,
            paddingBottom: Layout.driverHeaderBottomPadding,
            borderBottomColor: cardBorder,
            backgroundColor: isDark ? 'rgba(15,23,42,0.92)' : 'rgba(255,255,255,0.85)',
          },
        ]}
      >
        <TouchableOpacity style={styles.topIconBtn} onPress={handleBack} hitSlop={12}>
          <ChevronLeft size={22} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.titleCenter}>
          <Text style={[styles.headerName, { color: colors.text }]} numberOfLines={1}>
            {displayName}
          </Text>
          <View style={styles.liveDot} />
        </View>
        <View style={styles.topActions}>
          <TouchableOpacity
            style={styles.topIconBtn}
            onPress={handleInviteDrivers}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Invite drivers"
          >
            <UserPlus size={Layout.driverHeaderActionIconSize} color={muted} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.topIconBtn}
            onPress={handleShareProfile}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Share profile"
          >
            <Share2 size={Layout.driverHeaderActionIconSize} color={muted} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{
          paddingTop: 12,
          paddingBottom: scrollBottomPad,
          paddingHorizontal: SCREEN_PAD,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <>
            {profileView === 'main' && (
              <View style={{ gap: DRIVER_SECTION_GAP }}>
                <Animated.View
                  entering={FadeInDown.duration(280).springify().damping(18)}
                  style={[
                    styles.profileHero,
                    {
                      backgroundColor: Theme.cardWhite,
                      borderWidth: 1,
                      borderColor: Theme.driverSecondaryGrey,
                    },
                  ]}
                >
                  <TouchableOpacity style={styles.avatarCluster} onPress={() => setShowEditProfileModal(true)} activeOpacity={0.9}>
                    <LinearGradient colors={[Theme.driverPrimary, Theme.driverEmeraldDark]} style={styles.avatarRing}>
                      <View style={[styles.avatarInner, { backgroundColor: displayAvatarColor }]}>
                        {displayAvatarSource ? (
                          <Image source={displayAvatarSource} style={styles.avatarImg} resizeMode="cover" />
                        ) : (
                          <Text style={styles.identityInitials}>{displayAvatarInitials}</Text>
                        )}
                        <View style={styles.camOverlay} pointerEvents="none">
                          <Camera size={13} color="#fff" />
                        </View>
                      </View>
                    </LinearGradient>
                    <View style={styles.levelBadge}>
                      <Trophy size={11} color="#fff" />
                      <Text style={styles.levelBadgeText}>Lvl {currentLevel}</Text>
                    </View>
                  </TouchableOpacity>
                  <Text style={styles.profileNameHero}>{displayName}</Text>
                  <Text style={styles.tierSmall}>
                    {currentLevelConfig.tier} rank · {currentLevelConfig.name}
                  </Text>
                  <TouchableOpacity style={styles.xpCard} onPress={() => setProfileView('levels')} activeOpacity={0.88}>
                    <View style={styles.xpTop}>
                      <Text style={styles.xpEyebrow}>EXPERIENCE PROGRESS</Text>
                      <Text style={styles.xpPct}>{experiencePct}%</Text>
                    </View>
                    <View style={styles.progressTrackDark}>
                      <LinearGradient
                        colors={[Theme.driverEmerald, Theme.driverPrimary]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 0 }}
                        style={[styles.progressFillEm, { width: `${Math.max(experiencePct, 0)}%` }]}
                      />
                    </View>
                    <View style={styles.xpFooter}>
                      <Text style={styles.xpFooterTxt}>
                        {experience.currentCount.done}/{experience.currentCount.target} · {tripsCount} trips
                      </Text>
                      <Text style={styles.xpFooterTxt}>{nextLevelConfig?.name ?? 'Max'} next</Text>
                    </View>
                  </TouchableOpacity>
                </Animated.View>

                <Animated.View
                  entering={FadeInDown.delay(40).duration(280).springify().damping(18)}
                  style={[styles.actionSheet, { backgroundColor: colors.surface, borderColor: cardBorder }]}
                >
                  <TouchableOpacity
                    style={styles.sheetRow}
                    onPress={() => router.push(ROUTES.driverDcoStatus() as Parameters<typeof router.push>[0])}
                    activeOpacity={0.88}
                    accessibilityRole="button"
                    accessibilityLabel={dcoStatus === 'NONE' ? 'Become a DCO' : 'DCO status'}
                  >
                    <DriverIconWell
                      backgroundColor={isDark ? colors.emeraldMuted : Theme.driverEmeraldMuted}
                      motionDelay={0}
                    >
                      <Gavel size={driverIconSize} color={Theme.driverEmerald} strokeWidth={2.25} />
                    </DriverIconWell>
                    <View style={styles.sheetRowText}>
                      <Text style={[styles.tileTitle, { color: colors.text }]}>
                        {dcoStatus === 'NONE'
                          ? 'Become a DCO'
                          : dcoStatus === 'PENDING'
                            ? 'DCO — Under review'
                            : dcoStatus === 'APPROVED'
                              ? 'DCO status'
                              : dcoStatus === 'REJECTED'
                                ? 'DCO — Request again'
                                : 'DCO — Suspended'}
                      </Text>
                      <Text style={[styles.tileSub, { color: muted }]}>
                        {dcoStatus === 'APPROVED'
                          ? 'Your vehicle · Marketplace bids & awards'
                          : 'Become an independent owner-operator'}
                      </Text>
                    </View>
                    <ChevronRight size={16} color={muted} />
                  </TouchableOpacity>

                  <View style={[styles.sheetDivider, { backgroundColor: cardBorder }]} />

                  <TouchableOpacity
                    style={styles.sheetRow}
                    onPress={() => setProfileView('vehicle')}
                    activeOpacity={0.88}
                    accessibilityRole="button"
                    accessibilityLabel="Assigned vehicle"
                  >
                    <DriverIconWell backgroundColor={Theme.assignmentVehicleAccentSoft} motionDelay={120}>
                      <Truck size={driverIconSize} color={Theme.assignmentVehicleAccent} strokeWidth={2.25} />
                    </DriverIconWell>
                    <View style={styles.sheetRowText}>
                      <Text style={[styles.tileEyebrow, { color: muted }]}>FLEET ASSIGNED</Text>
                      <Text style={[styles.tileTitle, { color: colors.text }]}>{vehicleDisplay.model}</Text>
                    </View>
                    <ChevronRight size={16} color={muted} />
                  </TouchableOpacity>
                </Animated.View>

                <Animated.View
                  entering={FadeInDown.delay(80).duration(280).springify().damping(18)}
                  style={styles.pairRow}
                >
                  <Pressable
                    style={({ pressed }) => [
                      styles.pairCard,
                      webPress,
                      { backgroundColor: colors.surface, borderColor: cardBorder, opacity: pressed ? 0.88 : 1 },
                    ]}
                    onPress={() => router.push('/(driver)/documents')}
                    accessibilityRole="button"
                    accessibilityLabel="Upload and verify documents"
                  >
                    <DriverIconWell backgroundColor={SLATE_900} motionDelay={200}>
                      <Shield size={driverIconSizeSm} color="#fff" strokeWidth={2.25} />
                    </DriverIconWell>
                    <Text style={[styles.tileEyebrow, styles.pairEyebrow, { color: muted }]}>KYC & COMPLIANCE</Text>
                    <Text style={[styles.pairTitle, { color: colors.text }]} numberOfLines={2}>
                      {kycStatus?.isVerified ? 'Identity verified' : 'Upload & verify documents'}
                    </Text>
                    <Text
                      style={[
                        styles.tileSub,
                        { color: kycStatus?.reviewStatus === 'rejected' ? Theme.negative : muted },
                      ]}
                      numberOfLines={2}
                    >
                      {kycStatus?.isVerified
                        ? `${kycStatus.verifiedDocs} document${kycStatus.verifiedDocs === 1 ? '' : 's'} verified by our team`
                        : kycStatus?.reviewStatus === 'submitted'
                          ? 'Awaiting verification — our team is reviewing'
                          : kycStatus?.reviewStatus === 'rejected'
                            ? 'Rejected — tap to see what needs fixing'
                            : `${kycUploadedCount} uploaded · tap to add or submit`}
                    </Text>
                  </Pressable>

                  <Pressable
                    style={({ pressed }) => [
                      styles.pairCard,
                      webPress,
                      { backgroundColor: colors.surface, borderColor: cardBorder, opacity: pressed ? 0.88 : 1 },
                    ]}
                    onPress={() =>
                      router.push(
                        ROUTES.MODALS.LANGUAGE_SETTINGS as Parameters<typeof router.push>[0],
                      )
                    }
                    accessibilityRole="button"
                    accessibilityLabel="Language settings"
                  >
                    <DriverIconWell backgroundColor={Theme.brandBlueSoft} motionDelay={280}>
                      <Globe size={driverIconSizeSm} color={Theme.primary} strokeWidth={2.25} />
                    </DriverIconWell>
                    <Text style={[styles.tileEyebrow, styles.pairEyebrow, { color: muted }]}>PREFERENCES</Text>
                    <Text style={[styles.pairTitle, { color: colors.text }]}>Language</Text>
                    <Text style={[styles.tileSub, { color: muted }]} numberOfLines={2}>
                      {languageLabel}
                    </Text>
                  </Pressable>
                </Animated.View>

                <Animated.View
                  entering={FadeInDown.delay(120).duration(280).springify().damping(18)}
                  style={styles.statsRow}
                >
                  <View style={[styles.statBox, { backgroundColor: colors.surface, borderColor: cardBorder }]}>
                    <DriverIconWell backgroundColor="rgba(217,119,6,0.12)" motionDelay={360}>
                      <Star size={driverIconSizeSm} color="#d97706" fill="#d97706" strokeWidth={2.25} />
                    </DriverIconWell>
                    <Text style={[styles.statNum, { color: colors.text }]}>
                      {loadingDriverRatings && driverRatings.length === 0
                        ? '–'
                        : driverRatingAvg != null
                          ? driverRatingAvg.toFixed(1)
                          : '—'}
                    </Text>
                    <Text style={[styles.statLbl, { color: muted }]}>AVG RATING</Text>
                    {!loadingDriverRatings && driverRatingCount > 0 ? (
                      <Text style={[styles.statHint, { color: muted }]} numberOfLines={1}>
                        {driverRatingCount} {driverRatingCount === 1 ? 'review' : 'reviews'}
                      </Text>
                    ) : null}
                  </View>
                  <Pressable
                    style={({ pressed }) => [
                      styles.statBox,
                      webPress,
                      { backgroundColor: colors.surface, borderColor: cardBorder, opacity: pressed ? 0.88 : 1 },
                    ]}
                    onPress={() => router.push('/(driver)/trip-history')}
                    accessibilityRole="button"
                    accessibilityLabel="Open trip history"
                  >
                    <DriverIconWell backgroundColor={Theme.assignmentVehicleAccentSoft} motionDelay={440}>
                      <History size={driverIconSizeSm} color={Theme.assignmentVehicleAccent} strokeWidth={2.25} />
                    </DriverIconWell>
                    <Text style={[styles.statNum, { color: colors.text }]}>
                      {!tripsLoaded && loadingTrips ? '–' : tripsCount}
                    </Text>
                    <Text style={[styles.statLbl, { color: muted }]}>TRIPS</Text>
                  </Pressable>
                </Animated.View>

                <Animated.View entering={FadeInDown.delay(160).duration(280).springify().damping(18)}>
                  <Pressable
                    style={({ pressed }) => [
                      styles.signOutCard,
                      webPress,
                      { backgroundColor: colors.surface, borderColor: cardBorder, opacity: pressed ? 0.85 : 1 },
                    ]}
                    onPress={handleSignOut}
                    accessibilityRole="button"
                    accessibilityLabel="Sign out"
                  >
                    <DriverIconWell backgroundColor="rgba(244,63,94,0.1)" motionDelay={520} animate={false}>
                      <LogOut size={driverIconSize} color="#f43f5e" strokeWidth={2.25} />
                    </DriverIconWell>
                    <Text style={styles.signOutLbl}>Sign out</Text>
                  </Pressable>
                </Animated.View>
              </View>
            )}
            {profileView === 'levels' && <LevelView />}
            {profileView === 'vehicle' && <VehicleTechnicalView />}
        </>
      </ScrollView>

      <MilestoneHowToModal
        visible={guideLevel != null}
        level={guideLevel}
        progress={experience}
        audience="driver"
        onClose={() => setGuideLevel(null)}
        onAction={handleMilestoneGuideAction}
      />

      <EditProfileModal
        visible={showEditProfileModal}
        layout="driver"
        avatarPresetStyle="user-2d"
        heroSubtitle={`${currentLevelConfig.tier} · ${currentLevelConfig.name}`}
        onClose={() => {
          setShowEditProfileModal(false);
          void refreshSession();
        }}
        initialFullName={profile?.full_name ?? profile?.displayName ?? ''}
        initialPhone={profile?.phone ?? ''}
        initialCompanyName={profile?.company_name ?? ''}
        email={user?.email ?? ''}
        onPhotoUpdated={async (payload) => {
          if (payload?.avatarUri?.trim()) {
            setPreviewUri(payload.avatarUri.trim());
          } else if (payload && !payload.avatarUri) {
            setPreviewUri(null);
          }
          if (payload?.avatarPath) {
            patchProfile({ avatar_url: payload.avatarPath, avatar_seed: undefined });
          } else if (payload && payload.avatarPath === null) {
            patchProfile({ avatar_url: undefined });
          }
          void refreshSession();
        }}
        initialAvatarSeed={profile?.avatar_seed?.trim() || avatarSeed}
        onPresetSelected={(seed) => {
          setAvatarSeed(seed);
          setPreviewUri(null);
          patchProfile({ avatar_url: undefined, avatar_seed: seed });
          void refreshSession();
        }}
        initialStatusText={profile?.status_text ?? ''}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  outer: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Layout.driverHeaderHorizontalPadding,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  topActions: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  topIconBtn: {
    width: Layout.driverHeaderActionSize,
    height: Layout.driverHeaderActionSize,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  headerName: { fontSize: 14, fontWeight: '700', maxWidth: 200 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: Theme.driverEmerald },
  scroll: { flex: 1 },

  identityBlock: { alignItems: 'center', paddingTop: 8, paddingBottom: 4 },
  identityAvatarBtn: { marginBottom: 12 },
  identityAvatar: {
    width: 108,
    height: 108,
    borderRadius: 54,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
  },
  identityInitials: { color: '#fff', fontWeight: '700', fontSize: 28 },
  identityCam: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(15,23,42,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  identityLevel: {
    position: 'absolute',
    right: -4,
    bottom: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: Theme.driverEmeraldDark,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 3,
  },
  identityName: { fontSize: 22, fontWeight: '800', letterSpacing: -0.3 },
  identityRank: { marginTop: 4, fontSize: 13, fontWeight: '600' },
  actionSheet: {
    borderRadius: DRIVER_CARD_RADIUS,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 2,
    ...driverCardElevation,
  },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: DRIVER_ROW_HEIGHT + 4,
    paddingVertical: 8,
    gap: 12,
  },
  sheetRowText: { flex: 1, minWidth: 0, justifyContent: 'center' },
  sheetDivider: { height: StyleSheet.hairlineWidth, marginLeft: 44 },
  progressField: {
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 44,
  },
  progressFieldLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6 },
  progressFieldPct: { fontSize: 14, fontWeight: '800' },
  progressFieldMeta: { fontSize: 12, fontWeight: '600' },
  tileRow: { flexDirection: 'row', gap: 8 },
  actionTile: {
    flex: 1,
    minWidth: 0,
    minHeight: 132,
    borderRadius: 18,
    padding: 10,
    alignItems: 'flex-start',
  },
  tileIcon: {
    width: 32,
    height: 32,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileEyebrow: { fontSize: 9, fontWeight: '700', letterSpacing: 0.5, marginBottom: 2 },
  tileTitle: { fontSize: 14, fontWeight: '700', lineHeight: 18 },
  tileSub: { marginTop: 1, fontSize: 11, fontWeight: '500', lineHeight: 14 },
  pairRow: { flexDirection: 'row', alignItems: 'stretch', gap: 8 },
  pairCard: {
    flex: 1,
    minWidth: 0,
    borderRadius: DRIVER_CARD_RADIUS,
    borderWidth: 1,
    padding: 12,
    alignItems: 'flex-start',
    ...driverCardElevation,
  },
  pairEyebrow: { marginTop: 10 },
  pairTitle: { fontSize: 14, fontWeight: '700', lineHeight: 18, marginTop: 1 },

  profileHero: {
    borderRadius: DRIVER_CARD_RADIUS,
    paddingHorizontal: 14,
    paddingTop: 16,
    paddingBottom: 14,
    overflow: 'hidden',
    alignItems: 'center',
    alignSelf: 'stretch',
    width: '100%',
    ...driverCardElevation,
  },
  heroGlow: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(16,185,129,0.08)',
  },
  avatarCluster: { marginBottom: 14, alignItems: 'center', alignSelf: 'center' },
  avatarRing: { padding: 3, borderRadius: 26 },
  avatarInner: {
    width: 84,
    height: 84,
    borderRadius: 12,
    backgroundColor: '#1e293b',
    overflow: 'hidden',
    borderWidth: 3,
    borderColor: SLATE_900,
  },
  avatarImg: { width: '100%', height: '100%' },
  camOverlay: {
    position: 'absolute',
    left: 4,
    bottom: 4,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(15,23,42,0.82)',
    borderWidth: 2,
    borderColor: Theme.cardWhite,
    alignItems: 'center',
    justifyContent: 'center',
  },
  levelBadge: {
    position: 'absolute',
    right: -2,
    bottom: -8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: Theme.driverEmeraldDark,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    borderWidth: 3,
    borderColor: SLATE_900,
  },
  levelBadgeText: { fontSize: 9, fontWeight: '800', color: '#fff' },
  profileNameHero: {
    fontSize: 18,
    fontWeight: '700',
    color: Theme.driverText,
    letterSpacing: -0.2,
    textAlign: 'center',
  },
  tierSmall: { marginTop: 4, fontSize: 12, fontWeight: '600', color: Theme.driverPrimary, textAlign: 'center' },
  xpCard: {
    marginTop: 12,
    width: '100%',
    backgroundColor: Theme.surfaceLight,
    borderRadius: DRIVER_CARD_RADIUS - 2,
    padding: 12,
    borderWidth: 1,
    borderColor: Theme.driverSecondaryGrey,
  },
  xpTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  xpEyebrow: { fontSize: 10, fontWeight: '700', color: Theme.textMuted, letterSpacing: 0.8 },
  xpPct: { fontSize: 13, fontWeight: '700', color: Theme.driverPrimary },
  progressTrackDark: {
    height: 5,
    borderRadius: 999,
    backgroundColor: Theme.driverSecondaryGrey,
    overflow: 'hidden',
  },
  progressFillEm: { height: '100%', borderRadius: 999 },
  xpFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  xpFooterTxt: { fontSize: 11, fontWeight: '600', color: Theme.textMuted },

  bioStatementCard: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 14,
    overflow: 'hidden',
  },
  bioStatementHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  bioStatementTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    minWidth: 0,
  },
  quoteIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bioStatementEyebrow: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  bioEditBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bioStatementBody: {
    fontSize: 13,
    fontWeight: '500',
    fontStyle: 'italic',
    lineHeight: 19,
    opacity: 0.92,
  },

  rowCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    gap: 10,
  },
  rowCardLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 },
  rowCardText: { flex: 1, minWidth: 0 },
  blueIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: 'rgba(59,130,246,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  darkIcon: {
    width: 32,
    height: 32,
    borderRadius: 12,
    backgroundColor: SLATE_900,
    alignItems: 'center',
    justifyContent: 'center',
  },
  violetIcon: {
    width: 32,
    height: 32,
    borderRadius: 12,
    backgroundColor: Theme.brandBlueSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowEyebrow: { fontSize: 9, fontWeight: '700', letterSpacing: 1.2, marginBottom: 2 },
  rowTitle: { fontSize: 15, fontWeight: '700' },
  rowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  verifiedPill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  verifiedPillText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  rowSub: { marginTop: 4, fontSize: 11, fontWeight: '500', lineHeight: 15 },
  chevPill: { padding: 8, borderRadius: 12 },
  statsRow: { flexDirection: 'row', alignItems: 'stretch', gap: 8 },
  statBox: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 12,
    minHeight: 96,
    borderRadius: DRIVER_CARD_RADIUS,
    borderWidth: 1,
    alignItems: 'flex-start',
    justifyContent: 'flex-start',
    gap: 8,
    ...driverCardElevation,
  },
  statNum: { fontSize: 18, fontWeight: '800', letterSpacing: -0.2 },
  statLbl: { marginTop: 0, fontSize: 10, fontWeight: '700', letterSpacing: 0.6 },
  statHint: { marginTop: 2, fontSize: 11, fontWeight: '500' },
  signOutCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    minHeight: DRIVER_ROW_HEIGHT,
    borderRadius: DRIVER_CARD_RADIUS,
    borderWidth: 1,
    ...driverCardElevation,
  },
  signOutLbl: { fontSize: 13, fontWeight: '700', color: '#f43f5e' },

  subPage: { gap: 14, paddingBottom: 8 },
  subHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 },
  iconPill: {
    padding: 8,
    borderRadius: 12,
    borderWidth: 1,
  },
  subTitle: { fontSize: 13, fontWeight: '800', letterSpacing: 0.8 },

  heroDark: {
    backgroundColor: SLATE_900,
    borderRadius: 20,
    padding: 16,
    overflow: 'hidden',
  },
  heroWatermark: { position: 'absolute', top: 0, right: 0, padding: 16 },
  rankRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  crownBox: { width: 52, height: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  heroEyebrowGold: { fontSize: 9, color: AMBER_400, fontWeight: '700', letterSpacing: 1.2 },
  heroRankTitle: { fontSize: 18, fontWeight: '800', color: '#fff' },

  roadLineWrap: { paddingLeft: 28, gap: 22 },
  roadLine: {
    position: 'absolute',
    left: 11,
    top: 10,
    bottom: 10,
    width: 2,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  roadStep: { flexDirection: 'row', gap: 12, position: 'relative' },
  roadDot: {
    position: 'absolute',
    left: -21,
    top: 14,
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 4,
    zIndex: 2,
  },
  roadCard: { flex: 1, padding: 14, borderRadius: 18, borderWidth: 1 },
  roadCardActive: { backgroundColor: 'rgba(255,255,255,0.08)', borderColor: 'rgba(255,255,255,0.18)' },
  roadCardMuted: { borderColor: 'transparent', opacity: 0.45 },
  roadCardTop: { flexDirection: 'row', justifyContent: 'space-between' },
  roadTier: { fontSize: 11, fontWeight: '900', color: '#fff', letterSpacing: 2 },
  roadMin: { fontSize: 10, fontWeight: '800', color: 'rgba(148,163,184,0.9)' },
  roadProgLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  roadProgLeft: { fontSize: 9, fontWeight: '800', color: 'rgba(148,163,184,0.85)', letterSpacing: 1 },
  roadProgPct: { fontSize: 9, fontWeight: '900', color: AMBER_400 },
  progressTrack: { height: 4, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.12)', overflow: 'hidden', marginTop: 6 },
  progressFillGold: { height: '100%', backgroundColor: AMBER_400, borderRadius: 999 },

  metricsCard: { borderRadius: 32, padding: 22, borderWidth: 1 },
  metricsTitle: { fontSize: 11, fontWeight: '900', letterSpacing: 3, marginBottom: 14 },
  metricsGrid: { flexDirection: 'row', gap: 12 },
  metricCell: { flex: 1, padding: 14, borderRadius: 18 },
  metricLabel: { fontSize: 9, fontWeight: '900', letterSpacing: 1, marginBottom: 6 },
  metricValue: { fontSize: 14, fontWeight: '900' },

  vehiclePage: { gap: DRIVER_SECTION_GAP, paddingBottom: 8 },
  vehicleHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 40 },
  vehicleBack: {
    width: 36,
    height: 36,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  vehicleHeaderCopy: { flex: 1, minWidth: 0 },
  vehicleHeaderTitle: { fontSize: 16, fontWeight: '700', letterSpacing: -0.2 },
  vehicleHeaderSub: { marginTop: 1, fontSize: 12, fontWeight: '500' },
  identityCard: {
    borderRadius: DRIVER_CARD_RADIUS,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingTop: 14,
    ...driverCardElevation,
  },
  identityTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  identityText: { flex: 1, minWidth: 0 },
  identityPlate: { fontSize: 18, fontWeight: '700', letterSpacing: 0.3 },
  identityModel: { marginTop: 2, fontSize: 13, fontWeight: '500' },
  identityMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  identityMetaCell: { flex: 1, minWidth: 0, paddingVertical: 12 },
  identityMetaRule: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch', marginVertical: 10 },
  identityMetaLabel: { fontSize: 11, fontWeight: '600' },
  identityMetaValue: { marginTop: 2, fontSize: 13, fontWeight: '700' },
  readingCard: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderRadius: DRIVER_CARD_RADIUS,
    borderWidth: 1,
    overflow: 'hidden',
    ...driverCardElevation,
  },
  readingCell: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 6,
    gap: 5,
  },
  readingEmpty: {
    flex: 1,
    paddingVertical: 16,
    paddingHorizontal: 16,
    gap: 4,
  },
  readingEmptyTitle: { fontSize: 14, fontWeight: '700' },
  readingEmptyBody: { fontSize: 12, fontWeight: '500', lineHeight: 17 },
  readingValue: { fontSize: 15, fontWeight: '700' },
  readingLabel: { fontSize: 11, fontWeight: '600' },
  detailCard: {
    borderRadius: DRIVER_CARD_RADIUS,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 4,
    ...driverCardElevation,
  },
  detailGroup: { fontSize: 11, fontWeight: '700', letterSpacing: 0.4, marginBottom: 2 },
  detailGroupNext: {
    marginTop: 8,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    minHeight: DRIVER_ROW_HEIGHT - 4,
  },
  detailLabel: { fontSize: 13, fontWeight: '500' },
  detailValue: { flex: 1, fontSize: 13, fontWeight: '600', textAlign: 'right' },
  vehicleMotionSlot: {
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
    width: '100%',
    marginTop: 4,
    minHeight: 148,
    gap: 6,
  },
  vehicleMotionCaption: { fontSize: 12, fontWeight: '600' },
});
