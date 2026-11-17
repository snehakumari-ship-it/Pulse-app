/**
 * Driver Profile — hero, fleet vehicle, levels, KYC shortcut to documents (single upload hub).
 */
import { useAvatar } from '@/lib/useAvatar';
import Layout from '@/constants/Layout';
import Theme from '@/constants/Theme';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useDriverAvatar } from '@/contexts/DriverAvatarContext';
import { useDriverTheme, useDriverThemeColors } from '@/contexts/DriverThemeContext';
import { EditProfileModal } from '@/features/auth/components/EditProfileModal';
import {
  computeExperienceProgress,
  countFiveStarRatings,
  getMilestoneCount,
  isMilestoneCompleted,
  isMilestoneInProgress,
  type ExperienceLevelConfig,
  type MilestoneGuideActionKind,
} from '@/features/experience/experienceProgress';
import { MilestoneHowToModal } from '@/features/experience/components/MilestoneHowToModal';
import {
  averageScore,
  getRatingsForDrivers,
} from '@/features/ratings/services/ratings.service';
import type { RatingRow } from '@/features/ratings/types';
import { ROUTES } from '@/lib/routes';
import { supabase } from '@/lib/supabase';
import { subscribeSharedPostgresChanges } from '@/lib/realtimeRegistry';
import * as driversService from '@/features/drivers/services/drivers.service';
import { getVehicleById } from '@/features/vehicles/services/vehicles.service';
import { useDcoStatusQuery } from '@/lib/queries/useDcoStatusQuery';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import {
  AlertCircle,
  ChevronDown,
  ChevronLeft,
  Info,
  Sparkles,
  ChevronRight,
  Crown,
  Edit3,
  Fuel,
  Gavel,
  Globe,
  LogOut,
  Milestone,
  Share2,
  Shield,
  Star,
  Thermometer,
  Truck,
  UserPlus,
  Wrench
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
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';

const SCREEN_PAD = Layout.screenPaddingHorizontal;

/**
 * Clear absolute DriverTabBar footer on web/native.
 * Footer = padTop(6) + dock (tabBarHeight+5) + padBottom(max(inset*0.35, 10)).
 */
function driverTabBarScrollInset(bottomInset: number): number {
  const footerPadTop = 6;
  const dockHeight = Layout.tabBarHeight + 5;
  const footerPadBottom = Math.max(Math.round(bottomInset * 0.35), 10);
  return footerPadTop + dockHeight + footerPadBottom + 24;
}

/** Reference palette — heroes stay slate-900 for brand match; page bg uses theme. */
const SLATE_900 = '#0f172a';
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

function FleetTruckArt() {
  return (
    <Svg width={108} height={72} viewBox="0 0 108 72">
      <Circle cx="78" cy="40" r="28" fill={Theme.driverEmeraldMuted} />
      <Rect x="8" y="28" width="52" height="26" rx="4" fill="#8FBF7A" />
      <Path d="M58 36h16l10 10v8H58V36z" fill="#E7C48A" />
      <Rect x="62" y="38" width="10" height="8" rx="1.5" fill="#F8FBFF" />
      <Circle cx="24" cy="56" r="6" fill={Theme.textPrimaryDark} />
      <Circle cx="24" cy="56" r="2.5" fill={Theme.cardWhite} />
      <Circle cx="72" cy="56" r="6" fill={Theme.textPrimaryDark} />
      <Circle cx="72" cy="56" r="2.5" fill={Theme.cardWhite} />
    </Svg>
  );
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
  const [openVehicleSpec, setOpenVehicleSpec] = useState<string | null>(null);
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
      // Market dock is DCO-only; send regular drivers to request/status instead.
      if (dcoStatus === 'APPROVED' || dcoStatus === 'SUSPENDED') {
        router.push(ROUTES.driverAvailableLoads());
      } else {
        router.push(ROUTES.driverDcoStatus() as Parameters<typeof router.push>[0]);
      }
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

  const pageBg = isDark ? colors.background : Theme.driverEmeraldWash;
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

  const VehicleTechnicalView = () => (
    <View style={styles.subPage}>
      <Text style={styles.fleetPageTitle}>Fleet vehicle</Text>

      <View style={[styles.fleetHero, { backgroundColor: isDark ? colors.surface : Theme.cardWhite, borderColor: cardBorder }]}>
        <View style={styles.fleetHeroCopy}>
          <View style={styles.fleetTag}>
            <Text style={styles.fleetTagText}>Fleet</Text>
          </View>
          <Text style={[styles.fleetHeroTitle, { color: colors.text }]}>{vehicleDisplay.model}</Text>
          <Text style={styles.fleetHeroPlate}>{vehicleDisplay.plate}</Text>
          <View style={styles.supervisorBox}>
            <Text style={styles.supervisorKicker}>Supervisor</Text>
            <Text style={[styles.supervisorName, { color: colors.text }]}>{vehicleDisplay.supervisor}</Text>
          </View>
        </View>
        <View style={styles.fleetHeroArt}>
          <View style={styles.connectedRow}>
            <View style={styles.pulseDot} />
            <Text style={styles.connectedText}>Connected</Text>
          </View>
          <FleetTruckArt />
        </View>
      </View>

      <View style={styles.fleetGaugeRow}>
        <View style={[styles.fleetGauge, { backgroundColor: isDark ? colors.surface : Theme.cardWhite, borderColor: cardBorder }]}>
          <View style={[styles.fleetGaugeIcon, { backgroundColor: Theme.driverEmeraldMuted }]}>
            <Fuel size={18} color={Theme.driverCtaFill} strokeWidth={2.2} />
          </View>
          <View>
            <Text style={[styles.fleetGaugeVal, { color: colors.text }]}>{vehicleDisplay.fuel}</Text>
            <Text style={styles.fleetGaugeLbl}>Fuel</Text>
          </View>
        </View>
        <View style={[styles.fleetGauge, { backgroundColor: isDark ? colors.surface : Theme.cardWhite, borderColor: cardBorder }]}>
          <View style={[styles.fleetGaugeIcon, { backgroundColor: "rgba(232,33,39,0.1)" }]}>
            <Thermometer size={18} color={Theme.negative} strokeWidth={2.2} />
          </View>
          <View>
            <Text style={[styles.fleetGaugeVal, { color: colors.text }]}>{vehicleDisplay.engineTemp}</Text>
            <Text style={styles.fleetGaugeLbl}>Temp</Text>
          </View>
        </View>
      </View>

      <View style={[styles.whiteCardLg, { backgroundColor: isDark ? colors.surface : Theme.cardWhite, borderColor: cardBorder }]}>
        <View style={styles.cardHeadRow}>
          <Sparkles size={14} color={Theme.textMuted} strokeWidth={2.2} />
          <Text style={[styles.cardHeadTitle, { color: muted, flex: 1 }]}>Tech specs</Text>
          <AlertCircle size={16} color={Theme.textPrimaryDark} strokeWidth={2.2} />
        </View>
        {vehicleDisplay.specs.map((spec, i) => {
          const open = openVehicleSpec === spec.label;
          return (
            <View key={spec.label} style={i < vehicleDisplay.specs.length - 1 ? styles.specRowBorder : null}>
              <Pressable
                style={styles.specRow}
                onPress={() => setOpenVehicleSpec(open ? null : spec.label)}
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
              >
                <Text style={[styles.specLabel, { color: colors.text }]}>{spec.label}</Text>
                <ChevronDown
                  size={16}
                  color={Theme.textMuted}
                  strokeWidth={2.2}
                  style={{ transform: [{ rotate: open ? "180deg" : "0deg" }] }}
                />
              </Pressable>
              {open ? (
                <Text style={[styles.specValue, { color: colors.text }]}>{spec.value}</Text>
              ) : null}
            </View>
          );
        })}
      </View>

      <View style={styles.healthCard}>
        <View style={styles.cardHeadRow}>
          <Wrench size={14} color={Theme.driverCtaFill} strokeWidth={2.2} />
          <Text style={[styles.cardHeadTitle, { color: Theme.driverCtaFill, flex: 1 }]}>Health diagnostics</Text>
          <Info size={16} color={Theme.driverCtaFill} strokeWidth={2.2} />
        </View>
        {vehicleDisplay.health.map((h) => (
          <View key={h.label} style={styles.healthLine}>
            <Text style={[styles.healthLabel, { color: colors.text }]}>{h.label}</Text>
            <Text style={[styles.healthValue, { color: h.value === "—" ? Theme.textMuted : h.color }]}>{h.value}</Text>
          </View>
        ))}
      </View>
    </View>
  );

  return (
    <View style={[styles.outer, { backgroundColor: pageBg }]}>
      <View
        style={[
          styles.topBar,
          {
            paddingTop: insets.top + Layout.driverHeaderTopOffset,
            paddingBottom: Layout.driverHeaderBottomPadding,
            borderBottomColor: cardBorder,
            backgroundColor: isDark ? 'rgba(15,23,42,0.92)' : Theme.driverEmeraldWash,
          },
        ]}
      >
        <TouchableOpacity style={styles.topBackBtn} onPress={handleBack} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
          <ChevronLeft size={20} color={Theme.textPrimary} strokeWidth={2.4} />
          {profileView === 'vehicle' ? <Text style={styles.topBackText}>Back</Text> : null}
        </TouchableOpacity>
        <View style={styles.titleCenter} />
        <View style={styles.topActions}>
          <TouchableOpacity
            style={[styles.topIconBtn, profileView === 'vehicle' && styles.topIconBtnSoft]}
            onPress={handleInviteDrivers}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Invite drivers"
          >
            <UserPlus size={Layout.driverHeaderActionIconSize} color={muted} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.topIconBtn, profileView === 'vehicle' && styles.topIconBtnSoft]}
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
              <View style={{ gap: 14 }}>
                <View style={styles.identityRow}>
                  <TouchableOpacity
                    style={styles.identityAvatar}
                    onPress={() => setShowEditProfileModal(true)}
                    activeOpacity={0.9}
                    accessibilityRole="button"
                    accessibilityLabel="Edit profile photo"
                  >
                    {displayAvatarSource ? (
                      <Image source={displayAvatarSource} style={styles.identityAvatarImg} resizeMode="cover" />
                    ) : (
                      <View style={[styles.identityAvatarImg, styles.identityAvatarFallback, { backgroundColor: displayAvatarColor }]}>
                        <Text style={styles.identityInitials}>{displayAvatarInitials}</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                  <View style={styles.identityCopy}>
                    <View style={styles.identityNameRow}>
                      <Text style={[styles.identityName, { color: colors.text }]} numberOfLines={1}>
                        {displayName}
                      </Text>
                      <View style={styles.liveDot} />
                    </View>
                    <View style={styles.identityChips}>
                      <View style={[styles.metaChip, { backgroundColor: isDark ? colors.surfaceElevated : '#f8fafc', borderColor: cardBorder }]}>
                        <Star size={12} color="#d97706" fill="#d97706" />
                        <Text style={[styles.metaChipText, { color: colors.text }]} numberOfLines={1}>
                          {loadingDriverRatings && driverRatings.length === 0
                            ? '—'
                            : driverRatingAvg != null
                              ? `${driverRatingAvg.toFixed(1)} (${driverRatingCount} ${driverRatingCount === 1 ? 'review' : 'reviews'})`
                              : 'No reviews'}
                        </Text>
                      </View>
                      <Pressable
                        style={[styles.metaChip, { backgroundColor: isDark ? colors.surfaceElevated : '#f8fafc', borderColor: cardBorder }]}
                        onPress={() => router.push('/(driver)/trip-history')}
                        accessibilityRole="button"
                        accessibilityLabel="Open trip history"
                      >
                        <Text style={[styles.metaChipText, { color: colors.text }]}>
                          {!tripsLoaded && loadingTrips ? '—' : `${tripsCount} Trips`}
                        </Text>
                      </Pressable>
                    </View>
                    <TouchableOpacity
                      style={styles.editProfileLink}
                      onPress={() => setShowEditProfileModal(true)}
                      accessibilityRole="button"
                      accessibilityLabel="Edit profile"
                    >
                      <Edit3 size={13} color={muted} strokeWidth={2.2} />
                      <Text style={[styles.editProfileText, { color: muted }]}>Edit Profile</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                <TouchableOpacity onPress={() => setProfileView('levels')} activeOpacity={0.9} accessibilityRole="button" accessibilityLabel="Experience progress">
                  <LinearGradient
                    colors={[Theme.driverEmerald, Theme.driverEmeraldDark]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.milestoneCard}
                  >
                    <Text style={styles.milestoneTitle}>{currentLevelConfig.name} Milestone</Text>
                    <View style={styles.milestoneInner}>
                      <View style={styles.xpTop}>
                        <Text style={styles.milestoneEyebrow}>Experience progress</Text>
                        <Text style={styles.milestonePct}>{experiencePct}%</Text>
                      </View>
                      <View style={styles.milestoneTrack}>
                        <View style={[styles.milestoneFill, { width: `${experiencePct}%` }]} />
                      </View>
                      <Text style={styles.milestoneFoot} numberOfLines={1}>
                        {nextLevelConfig
                          ? `Trusted next · ${Math.max(0, experience.currentCount.target - experience.currentCount.done)} trips to ${nextLevelConfig.name}`
                          : 'Trusted next · final milestone'}
                      </Text>
                    </View>
                  </LinearGradient>
                </TouchableOpacity>

                <View style={[styles.menuCard, { backgroundColor: colors.surface, borderColor: cardBorder }]}>

                <TouchableOpacity
                  style={[styles.menuRow, webPress]}
                  onPress={() =>
                    router.push(ROUTES.driverDcoStatus() as Parameters<typeof router.push>[0])
                  }
                  activeOpacity={0.88}
                  accessibilityRole="button"
                  accessibilityLabel={dcoStatus === 'NONE' ? 'Become a DCO' : 'DCO status'}
                >
                  <View style={styles.rowCardLeft}>
                    <View style={[styles.blueIcon, { backgroundColor: isDark ? colors.emeraldMuted : 'rgba(167,243,208,0.45)' }]}>
                      <Gavel size={20} color={colors.emerald} />
                    </View>
                    <View style={styles.rowCardText}>
                      <Text style={[styles.rowEyebrow, { color: muted }]}>
                        {dcoStatus === 'APPROVED' ? 'DCO' : 'INDEPENDENT OWNER-OPERATOR'}
                      </Text>
                      <Text style={[styles.rowTitle, { color: colors.text }]}>
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
                      <Text style={[styles.rowSub, { color: muted }]} numberOfLines={2}>
                        {dcoStatus === 'APPROVED'
                          ? 'Your vehicle · Marketplace bids & awards'
                          : 'Become an independent owner-operator'}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.chevPill}>
                    <ChevronRight size={18} color={muted} />
                  </View>
                </TouchableOpacity>

                <TouchableOpacity style={[styles.menuRow, styles.menuRowDivider, webPress, { borderTopColor: cardBorder }]} onPress={() => setProfileView('vehicle')} activeOpacity={0.88}>
                  <View style={styles.rowCardLeft}>
                    <View style={styles.blueIcon}>
                      <Truck size={20} color="#3b82f6" />
                    </View>
                    <View style={styles.rowCardText}>
                      <Text style={[styles.rowEyebrow, { color: muted }]}>FLEET ASSIGNED</Text>
                      <Text style={[styles.rowTitle, { color: colors.text }]}>{vehicleDisplay.model}</Text>
                    </View>
                  </View>
                  <View style={styles.chevPill}>
                    <ChevronRight size={18} color={muted} />
                  </View>
                </TouchableOpacity>

                <Pressable
                  style={({ pressed }) => [
                    styles.menuRow,
                    styles.menuRowDivider,
                    webPress,
                    { borderTopColor: cardBorder, opacity: pressed ? 0.88 : 1 },
                  ]}
                  onPress={() => router.push('/(driver)/documents')}
                  accessibilityRole="button"
                  accessibilityLabel="Upload and verify documents"
                >
                  <View style={styles.rowCardLeft}>
                    <View style={styles.darkIcon}>
                      <Shield size={18} color="#fff" />
                    </View>
                    <View style={styles.rowCardText}>
                      <Text style={[styles.rowEyebrow, { color: muted }]}>KYC & COMPLIANCE</Text>
                      <View style={styles.rowTitleLine}>
                        <Text style={[styles.rowTitle, { color: colors.text }]}>
                          {kycStatus?.isVerified ? 'Identity verified' : 'Upload & verify documents'}
                        </Text>
                        {kycStatus?.isVerified ? (
                          <View style={[styles.verifiedPill, { backgroundColor: colors.emeraldMuted }]}>
                            <Text style={[styles.verifiedPillText, { color: colors.emerald }]}>
                              VERIFIED
                            </Text>
                          </View>
                        ) : null}
                      </View>
                      {!kycStatus?.isVerified &&
                      kycUploadedCount > 0 &&
                      kycStatus?.reviewStatus !== 'rejected' ? (
                        <View style={styles.pendingPill}>
                          <Text style={styles.pendingPillText}>Verification pending</Text>
                        </View>
                      ) : null}
                      <Text
                        style={[
                          styles.rowSub,
                          {
                            color: kycStatus?.reviewStatus === 'rejected' ? Theme.negative : muted,
                          },
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
                    </View>
                  </View>
                  <View style={styles.chevPill}>
                    <ChevronRight size={18} color={muted} />
                  </View>
                </Pressable>

                <Pressable
                  style={({ pressed }) => [
                    styles.menuRow,
                    styles.menuRowDivider,
                    webPress,
                    { borderTopColor: cardBorder, opacity: pressed ? 0.88 : 1 },
                  ]}
                  onPress={() =>
                    router.push(
                      ROUTES.MODALS.LANGUAGE_SETTINGS as Parameters<typeof router.push>[0],
                    )
                  }
                  accessibilityRole="button"
                  accessibilityLabel="Language settings"
                >
                  <View style={styles.rowCardLeft}>
                    <View style={styles.violetIcon}>
                      <Globe size={18} color={Theme.primary} />
                    </View>
                    <View style={styles.rowCardText}>
                      <Text style={[styles.rowEyebrow, { color: muted }]}>PREFERENCES</Text>
                      <Text style={[styles.rowTitle, { color: colors.text }]}>Language</Text>
                      <Text style={[styles.rowSub, { color: muted }]} numberOfLines={1}>
                        {languageLabel}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.chevPill}>
                    <ChevronRight size={18} color={muted} />
                  </View>
                </Pressable>
                </View>

                <Pressable
                  style={({ pressed }) => [styles.signOutLink, { opacity: pressed ? 0.7 : 1 }]}
                  onPress={handleSignOut}
                  accessibilityRole="button"
                  accessibilityLabel="Sign out"
                >
                  <LogOut size={16} color="#f43f5e" />
                  <Text style={styles.signOutLbl}>Sign out</Text>
                </Pressable>
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
  topBackBtn: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingRight: 8,
  },
  topBackText: {
    fontSize: 15,
    fontWeight: '600',
    color: Theme.textPrimary,
  },
  topIconBtnSoft: {
    borderRadius: 20,
    backgroundColor: 'rgba(11,21,40,0.05)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(148,163,184,0.45)',
  },
  fleetPageTitle: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    color: Theme.textPrimary,
    marginTop: 2,
  },
  fleetHero: {
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    minHeight: 148,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  fleetHeroCopy: {
    flex: 1,
    minWidth: 0,
    paddingRight: 8,
  },
  fleetTag: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(11,21,40,0.06)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  fleetTagText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: Theme.textPrimary,
  },
  fleetHeroTitle: {
    marginTop: 10,
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  fleetHeroPlate: {
    marginTop: 4,
    fontSize: 13,
    fontWeight: '600',
    color: Theme.textMuted,
  },
  supervisorBox: {
    alignSelf: 'flex-start',
    marginTop: 14,
    backgroundColor: Theme.surfaceGray,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Theme.borderMedium,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  supervisorKicker: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    color: Theme.textMuted,
  },
  supervisorName: {
    marginTop: 2,
    fontSize: 13,
    fontWeight: '700',
  },
  fleetHeroArt: {
    width: 118,
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  fleetGaugeRow: {
    flexDirection: 'row',
    gap: 10,
  },
  fleetGauge: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  fleetGaugeIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fleetGaugeVal: {
    fontSize: 18,
    fontWeight: '800',
  },
  fleetGaugeLbl: {
    marginTop: 2,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: Theme.textMuted,
  },
  healthCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Theme.borderMedium,
    backgroundColor: Theme.cardWhite,
    padding: 16,
  },
  healthLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  titleCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  headerName: { fontSize: 14, fontWeight: '700', maxWidth: 200 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: Theme.driverEmerald },
  scroll: { flex: 1 },

  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  identityAvatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
    overflow: 'hidden',
    flexShrink: 0,
    backgroundColor: '#e2e8f0',
  },
  identityAvatarImg: { width: '100%', height: '100%' },
  identityAvatarFallback: { alignItems: 'center', justifyContent: 'center' },
  identityInitials: { color: '#fff', fontWeight: '700', fontSize: 22 },
  identityCopy: { flex: 1, minWidth: 0, gap: 6 },
  identityNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  identityName: { fontSize: 22, fontWeight: '800', letterSpacing: -0.4, flexShrink: 1 },
  identityChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  metaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    gap: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 8,
    minHeight: 26,
    maxWidth: '100%',
  },
  metaChipText: { fontSize: 11, fontWeight: '700' },
  editProfileLink: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 28, alignSelf: 'flex-start' },
  editProfileText: { fontSize: 13, fontWeight: '600' },
  milestoneCard: {
    borderRadius: 18,
    padding: 14,
    gap: 10,
  },
  milestoneTitle: { color: '#fff', fontSize: 18, fontWeight: '800', letterSpacing: -0.3 },
  milestoneInner: {
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 6,
  },
  milestoneEyebrow: { color: 'rgba(255,255,255,0.86)', fontSize: 10, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' },
  milestonePct: { color: '#fff', fontSize: 12, fontWeight: '800' },
  milestoneTrack: { height: 6, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.28)', overflow: 'hidden' },
  milestoneFill: { height: '100%', borderRadius: 999, backgroundColor: '#fff' },
  milestoneFoot: { color: 'rgba(255,255,255,0.92)', fontSize: 12, fontWeight: '600' },
  menuCard: {
    borderRadius: 18,
    borderWidth: 1,
    overflow: 'hidden',
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 44,
    gap: 10,
  },
  menuRowDivider: { borderTopWidth: StyleSheet.hairlineWidth },
  signOutLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 44,
    marginTop: 28,
  },
  profileHero: {
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 18,
    overflow: 'hidden',
    alignItems: 'center',
  },
  heroGlow: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(16,185,129,0.08)',
  },
  avatarCluster: { marginBottom: 12, alignItems: 'center' },
  avatarRing: { padding: 3, borderRadius: 26 },
  avatarInner: {
    width: 84,
    height: 84,
    borderRadius: 22,
    backgroundColor: '#1e293b',
    overflow: 'hidden',
    borderWidth: 3,
    borderColor: SLATE_900,
  },
  avatarImg: { width: '100%', height: '100%' },
  camOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  levelBadge: {
    position: 'absolute',
    right: -6,
    bottom: -2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: Theme.driverEmeraldDark,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 3,
    borderColor: SLATE_900,
  },
  levelBadgeText: { fontSize: 9, fontWeight: '800', color: '#fff' },
  profileNameHero: { fontSize: 18, fontWeight: '800', color: '#fff', letterSpacing: -0.3 },
  tierSmall: { marginTop: 4, fontSize: 10, fontWeight: '700', color: Theme.driverPrimary, letterSpacing: 1 },
  xpCard: {
    marginTop: 14,
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  xpTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  xpEyebrow: { fontSize: 9, fontWeight: '700', color: 'rgba(148,163,184,0.95)', letterSpacing: 1.2 },
  xpPct: { fontSize: 10, fontWeight: '800', color: Theme.driverPrimary },
  progressTrackDark: {
    height: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(15,23,42,0.9)',
    overflow: 'hidden',
  },
  progressFillEm: { height: '100%', borderRadius: 999 },
  xpFooter: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  xpFooterTxt: { fontSize: 10, fontWeight: '600', color: 'rgba(148,163,184,0.9)' },

  bioStatementCard: {
    borderRadius: 16,
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
    borderRadius: 16,
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
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: SLATE_900,
    alignItems: 'center',
    justifyContent: 'center',
  },
  violetIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: 'rgba(79,70,229,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowEyebrow: { fontSize: 9, fontWeight: '700', letterSpacing: 1.2, marginBottom: 2 },
  rowTitle: { fontSize: 15, fontWeight: '700' },
  rowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  verifiedPill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  verifiedPillText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  pendingPill: {
    alignSelf: 'flex-start',
    marginTop: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: Theme.warningMuted,
  },
  pendingPillText: { fontSize: 11, fontWeight: '700', color: Theme.warning },
  rowSub: { marginTop: 4, fontSize: 11, fontWeight: '500', lineHeight: 15 },
  chevPill: { padding: 8, borderRadius: 12 },
  statsRow: { flexDirection: 'row', gap: 10 },
  statBox: {
    flex: 1,
    padding: 14,
    minHeight: 44,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
  },
  amberIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: 'rgba(245,158,11,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  blueIconSm: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: 'rgba(59,130,246,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  statNum: { fontSize: 18, fontWeight: '800' },
  statLbl: { marginTop: 4, fontSize: 9, fontWeight: '700', letterSpacing: 1.2 },
  statHint: { marginTop: 3, fontSize: 10, fontWeight: '600' },
  signOutCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    minHeight: 44,
    borderRadius: 16,
    borderWidth: 1,
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
  crownBox: { width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
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

  vehicleHeroTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 18 },
  fleetBadge: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  fleetBadgeText: { fontSize: 9, fontWeight: '700', color: '#fff', letterSpacing: 1.2 },
  connectedRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pulseDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: Theme.driverEmerald },
  connectedText: { fontSize: 10, fontWeight: '600', color: Theme.driverPrimary },
  vehicleModel: { fontSize: 20, fontWeight: '800', color: '#fff', letterSpacing: -0.3 },
  vehiclePlate: { marginTop: 4, fontSize: 11, fontWeight: '700', color: 'rgba(148,163,184,0.95)', letterSpacing: 2 },
  vehicleGrid2: { flexDirection: 'row', gap: 10, marginTop: 14 },
  vehicleStatDark: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  vehicleStatLabel: { fontSize: 10, color: 'rgba(148,163,184,0.85)', fontWeight: '600', marginBottom: 4 },
  vehicleStatValue: { fontSize: 12, fontWeight: '700', color: '#fff' },
  triGaugeRow: { flexDirection: 'row', gap: 8 },
  gaugeCard: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 16,
    borderWidth: 1,
    gap: 4,
  },
  gaugeVal: { fontSize: 16, fontWeight: '800' },
  gaugeLbl: { fontSize: 8, fontWeight: '700', letterSpacing: 1.2 },
  whiteCardLg: { borderRadius: 16, padding: 14, borderWidth: 1 },
  cardHeadRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  cardHeadTitle: { fontSize: 10, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase' },
  specRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10 },
  specRowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(226,232,240,0.8)' },
  specLabel: { fontSize: 12, fontWeight: '600' },
  specValue: { fontSize: 13, fontWeight: '700', paddingBottom: 10 },
  healthValue: { fontSize: 14, fontWeight: '800' },
  healthRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 12,
    borderRadius: 14,
    marginBottom: 8,
  },
  healthLabel: { fontSize: 13, fontWeight: '600' },
});
