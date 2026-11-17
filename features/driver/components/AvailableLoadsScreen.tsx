/**
 * Market tab: Find Work + My Bids for admin-approved DCOs.
 * Regular drivers do not see this dock entry; the route stays registered for
 * deep links and redirects home until DCO approval unlocks the surface.
 */
import { CenteredLoadingView } from '@/components/CenteredLoadingView';
import { DRIVER_DETAIL_HORIZONTAL_PAD } from '@/components/driver/DriverSubScreenHeader';
import Theme from '@/constants/Theme';
import { useAuth } from '@/contexts/AuthContext';
import { useDriverTheme, useDriverThemeColors } from '@/contexts/DriverThemeContext';
import { DriverWorkOpportunityCard } from '@/features/driver/components/DriverWorkOpportunityCard';
import { MyBidsContent } from '@/features/driver/components/MyBidsScreen';
import {
    formatFleetOwnerRateOffer,
    isLoadCompatibleWithFleet,
    type FleetOwnerOpenLoad,
} from '@/features/driver/services/fleetOwnerLoads.service';
import {
    marketBidStatusLabel,
    type MarketBidRow,
    type MarketBidStatus,
} from '@/features/driver/services/marketBids.service';
import {
    driverPoolEyebrow,
    groupDriverMarketLoads,
    summarizeDriverPool,
    type DriverMarketPool,
} from '@/features/driver/utils/driverMarketPools.util';
import type { DriverOperatingModeKind } from '@/features/drivers/domain/driverOperatingMode';
import { cityOf, StoriesContent, type SharedFeedFilters } from '@/features/reach/screens/DriverStoriesScreen';
import { useDriverOperatingModeQuery } from '@/lib/queries/useDriverOperatingModeQuery';
import { useFleetOwnerOpenLoadsQuery } from '@/lib/queries/useFleetOwnerOpenLoadsQuery';
import { useMyMarketBidsQuery } from '@/lib/queries/useMyMarketBidsQuery';
import { useOwnerVehiclesQuery } from '@/lib/queries/useOwnerVehiclesQuery';
import { ROUTES } from '@/lib/routes';
import { useFocusEffect } from '@react-navigation/native';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { MapPin } from 'lucide-react-native';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function AvailableLoadsScreen() {
  const { profile } = useAuth();
  const uid = profile?.uid ?? '';
  const { isDark } = useDriverTheme();
  const colors = useDriverThemeColors();
  const insets = useSafeAreaInsets();
  const pageBg = isDark ? colors.background : Theme.driverEmeraldWash;
  // A7.3: the DCO Available surface's "My Bids" entry deep-links here with
  // ?segment=mybids so it lands directly on this segment instead of Find Work.
  const { segment: initialSegment } = useLocalSearchParams<{ segment?: string }>();
  const [selectedSegment, setSegment] = useState<'find' | 'mybids'>(
    initialSegment === 'mybids' ? 'mybids' : 'find',
  );
  const { isDco, modeLoading } = useDriverOperatingModeQuery(uid);
  const segment = selectedSegment;
  const cardBorder = isDark ? colors.borderSubtle : Theme.borderLight;

  if (modeLoading) {
    return <CenteredLoadingView style={{ flex: 1, backgroundColor: pageBg }} />;
  }

  if (!isDco) {
    return <Redirect href={ROUTES.DRIVER_ROOT} />;
  }

  // Earnings-page pattern: Market chrome scrolls with the feed (not pinned).
  const marketListHeader = (
    <>
      <View style={[styles.marketTitleBlock, { paddingTop: insets.top + 8, backgroundColor: pageBg }]}>
        <Text style={styles.marketDisplayTitle} accessibilityRole="header">
          MARKET.
        </Text>
      </View>
      <View
        style={[
          styles.segmentTrack,
          {
            backgroundColor: isDark ? colors.surfaceElevated : Theme.surfaceGray,
            borderColor: cardBorder,
          },
        ]}
      >
        {(
          [
            { id: 'find' as const, label: 'Find Work' },
            { id: 'mybids' as const, label: 'My Bids' },
          ] as const
        ).map((seg) => {
          const on = segment === seg.id;
          return (
            <Pressable
              key={seg.id}
              onPress={() => setSegment(seg.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              style={[styles.segmentBtn, on && styles.segmentBtnOn]}
            >
              <Text
                style={[
                  styles.segmentText,
                  on ? styles.segmentTextOn : { color: colors.textMuted },
                ]}
              >
                {seg.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </>
  );

  return (
    <View style={[styles.root, { backgroundColor: pageBg }]}>
      {segment === 'mybids' ? (
        uid ? <MyBidsContent uid={uid} listHeader={marketListHeader} /> : null
      ) : uid ? (
        <MarketFindWorkScreen uid={uid} listHeader={marketListHeader} />
      ) : null}
    </View>
  );
}

/**
 * Market → Find Work: the existing Reach opportunities feed (`StoriesContent`,
 * unchanged) with formal open-Market loads composed in as its last section,
 * so both opportunity sources read as one feed instead of two stacked
 * screens. No new sorting/business logic — same components, same queries,
 * new composition only.
 */
function MarketFindWorkScreen({
  uid,
  listHeader,
}: {
  uid: string;
  listHeader?: ReactNode;
}) {
  const { loads, refetch: refetchLoads } = useFleetOwnerOpenLoadsQuery(uid);
  const { refetch: refetchBids } = useMyMarketBidsQuery(uid);

  // Shared pickup/drop filter chips should represent both sources (see
  // DriverStoriesScreen.tsx's extraPickupCities/extraDropCities) — derived
  // here, at the composition layer, from the same open-Market loads
  // FindLoadsContent already renders. No new query, no DB change.
  const extraPickupCities = useMemo(() => {
    const set = new Set<string>();
    for (const l of loads) {
      const c = cityOf(l.pickup_area);
      if (c) set.add(c);
    }
    return [...set];
  }, [loads]);
  const extraDropCities = useMemo(() => {
    const set = new Set<string>();
    for (const l of loads) {
      const c = cityOf(l.drop_location);
      if (c) set.add(c);
    }
    return [...set];
  }, [loads]);

  return (
    <StoriesContent
      listHeader={listHeader}
      footer={(filters) => <FindLoadsContent uid={uid} filters={filters} />}
      onRefreshExtra={() => {
        void refetchLoads();
        void refetchBids();
      }}
      extraPickupCities={extraPickupCities}
      extraDropCities={extraDropCities}
    />
  );
}

/**
 * Presentation-only content adapter — the same open-Market load list previously rendered inline
 * in this screen, now embeddable at the bottom of the unified Find Work feed as the Marketplace
 * (tender-board) layer. Shared pickup/drop/fits-my-fleet filters come from the parent feed rather
 * than owning a separate filter bar -- this reads as one filtered work surface, not two.
 */
export function FindLoadsContent({ uid, filters }: { uid: string; filters: SharedFeedFilters }) {
  const router = useRouter();
  const { isDark } = useDriverTheme();
  const colors = useDriverThemeColors();
  const {
    operatingMode,
    marketplaceAllowed,
    isLoading: modeLoading,
  } = useDriverOperatingModeQuery(uid);
  const {
    loads,
    readComplete,
    isLoading,
    error,
    refetch: refetchLoads,
  } = useFleetOwnerOpenLoadsQuery(uid);
  const { vehicles } = useOwnerVehiclesQuery(uid);
  const { bids } = useMyMarketBidsQuery(uid);
  const cardBorder = isDark ? colors.borderSubtle : 'rgba(226,232,240,0.95)';

  // refetchOnWindowFocus is inert on React Native without an app-wide
  // TanStack Query focus manager registered (none exists in this app), so
  // returning to Find Work -- including right after completing a trip --
  // otherwise shows stale indents until a manual pull-to-refresh. Mirrors
  // the same useFocusEffect pattern DriverTripHistoryScreen.tsx already
  // uses for itself.
  useFocusEffect(
    useCallback(() => {
      if (!uid || !marketplaceAllowed) return;
      void refetchLoads();
    }, [uid, marketplaceAllowed, refetchLoads]),
  );

  const fleetTypes = useMemo(
    () => vehicles.map((v) => v.vehicle_type),
    [vehicles],
  );

  const bidStatusByIndentId = useMemo(() => {
    const map = new Map<string, MarketBidStatus>();
    for (const b of bids) map.set(b.indent_id, b.status);
    return map;
  }, [bids]);

  const { visiblePools, visible } = useMemo(() => {
    const passes = (l: FleetOwnerOpenLoad) => {
      if (filters.pickup) {
        const origin = cityOf(l.pickup_area);
        if (origin.toLowerCase() !== filters.pickup.toLowerCase()) return false;
      }
      if (filters.drop) {
        const dest = cityOf(l.drop_location);
        if (dest.toLowerCase() !== filters.drop.toLowerCase()) return false;
      }
      if (filters.fitsFleet && !isLoadCompatibleWithFleet(l, fleetTypes)) return false;
      return true;
    };
    const { pools, unpooled } = groupDriverMarketLoads(loads);
    return {
      visiblePools: pools.filter((p) => p.members[0] != null && passes(p.members[0])),
      visible: unpooled.filter(passes),
    };
  }, [loads, filters, fleetTypes]);

  if (!modeLoading && !marketplaceAllowed) {
    const gate = marketplaceGate(operatingMode.mode);
    return (
      <View style={styles.marketGate}>
        <Text style={[styles.marketplaceLabel, { color: colors.textMuted }]}>MARKETPLACE</Text>
        <View
          style={[
            styles.gateCard,
            {
              backgroundColor: isDark ? colors.surfaceElevated : Theme.cardWhite,
              borderColor: cardBorder,
            },
          ]}
        >
          <Text style={[styles.gateTitle, { color: colors.text }]}>Almost ready to bid</Text>
          <Text style={[styles.gateBody, { color: colors.textMuted }]}>{gate.body}</Text>
          <Pressable
            onPress={() =>
              router.push(
                (gate.target === 'my-fleet'
                  ? ROUTES.driverMyFleet()
                  : gate.target === 'wallet-self'
                    ? ROUTES.driverWalletSelf()
                    : ROUTES.driverDcoStatus()) as Parameters<typeof router.push>[0],
              )
            }
            style={({ pressed }) => [
              styles.cta,
              { backgroundColor: colors.emerald, opacity: pressed ? 0.88 : 1 },
            ]}
          >
            <Text style={styles.ctaText}>{gate.cta}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const marketCount = visiblePools.length + visible.length;

  return (
    <View style={styles.marketSection}>
      <View style={styles.marketplaceDivider} />
      <Text style={[styles.marketplaceLabel, { color: colors.textMuted }]}>
        {isLoading ? 'MARKETPLACE' : `MARKETPLACE · ${marketCount}`}
      </Text>

      <View style={styles.marketListPad}>
        {error ? (
          <Text style={styles.errorText}>
            {error instanceof Error ? error.message : 'Could not load marketplace.'}
          </Text>
        ) : isLoading ? (
          <ActivityIndicator color={colors.emerald} style={{ marginTop: 28 }} />
        ) : visible.length === 0 && visiblePools.length === 0 ? (
          <View
            style={[
              styles.empty,
              {
                backgroundColor: isDark ? colors.surface : Theme.cardWhite,
                borderColor: cardBorder,
              },
            ]}
          >
            <View style={[styles.emptyIcon, { backgroundColor: isDark ? colors.emeraldMuted : Theme.driverEmeraldMuted }]}>
              <MapPin size={18} color={colors.emerald} />
            </View>
            <Text style={[styles.emptyTitle, { color: colors.text }]}>
              No open loads right now
            </Text>
            <Text style={[styles.emptyBody, { color: colors.textMuted }]}>
              When businesses broadcast marketplace demand, it appears here.
            </Text>
          </View>
        ) : (
          <>
            {visiblePools.map((pool) => (
              <PoolCard
                key={pool.poolId}
                pool={pool}
                loads={loads}
                bids={bids}
                readComplete={readComplete}
                canBid={marketplaceAllowed && vehicles.some((v) => v.status === 'active')}
                compatible={isLoadCompatibleWithFleet(pool.members[0]!, fleetTypes)}
                onOpen={() =>
                  router.push(
                    ROUTES.driverAvailableLoadPool(pool.key) as Parameters<typeof router.push>[0],
                  )
                }
              />
            ))}
            {visible.map((load) => (
              <LoadCard
                key={load.id}
                load={load}
                compatible={isLoadCompatibleWithFleet(load, fleetTypes)}
                bidStatus={bidStatusByIndentId.get(load.id)}
                onOpenDetail={() =>
                  router.push(
                    ROUTES.driverAvailableLoad(load.id) as Parameters<typeof router.push>[0],
                  )
                }
                onBid={() =>
                  router.push(
                    ROUTES.driverAvailableLoad(load.id, { bid: true }) as Parameters<
                      typeof router.push
                    >[0],
                  )
                }
              />
            ))}
          </>
        )}
      </View>
    </View>
  );
}

/** One canonical pool: anonymous shipper, no per-load identity, one route into the pool rate. */
function PoolCard({
  pool,
  loads,
  bids,
  readComplete,
  canBid,
  compatible,
  onOpen,
}: {
  pool: DriverMarketPool;
  loads: readonly FleetOwnerOpenLoad[];
  bids: readonly MarketBidRow[];
  readComplete: boolean;
  canBid: boolean;
  compatible: boolean;
  onOpen: () => void;
}) {
  const summary = summarizeDriverPool({ key: pool.key, loads, bids, canBid });
  const lo = formatFleetOwnerRateOffer(summary.targetRateMin);
  const hi = formatFleetOwnerRateOffer(summary.targetRateMax);
  const target = lo && hi ? (lo === hi ? lo : `${lo} – ${hi}`) : null;
  const awarded = summary.state === 'awarded';
  const quoted = summary.state === 'submitted';
  const open = summary.state === 'open';

  return (
    <DriverWorkOpportunityCard
      orgName="Pooled opportunity"
      orgSeed={pool.poolId}
      kicker={driverPoolEyebrow(pool.members.length, readComplete)}
      badge={awarded ? 'awarded' : quoted ? 'quoted' : open ? 'open' : null}
      origin={pool.key.pickup}
      destination={pool.key.drop}
      vehicleType={pool.key.vehicleType}
      material={summary.loadTypes.join(', ') || null}
      pickupDate={summary.earliestPickup}
      fleetMatch={compatible && !awarded}
      targetLabel="Shipper target"
      targetValue={target}
      primaryCta={{
        title: quoted ? 'Update pool rate' : open ? 'Quote for pool' : summary.stateLabel,
        hint: open || quoted ? 'One rate for every load in this pool' : null,
        variant: quoted ? 'quoted' : open ? 'primary' : 'info',
        onPress: onOpen,
      }}
      secondaryCta={null}
    />
  );
}

function marketplaceGate(mode: DriverOperatingModeKind): {
  body: string;
  cta: string;
  target: 'dco-status' | 'my-fleet' | 'wallet-self';
} {
  switch (mode) {
    case 'DCO_VEHICLE_REQUIRED':
      return {
        body: 'Add an active vehicle to your fleet to see and bid on Marketplace loads.',
        cta: 'Manage my vehicle',
        target: 'my-fleet',
      };
    case 'DCO_SUSPENDED':
      return {
        body: 'Your DCO status is suspended, so Marketplace is unavailable.',
        cta: 'View DCO status',
        target: 'dco-status',
      };
    case 'DCO_EMPLOYMENT_CONFLICT':
      return {
        body: 'You are still linked to a business as an employee driver. Leave that fleet to operate independently as a DCO.',
        cta: 'View linked fleets',
        target: 'wallet-self',
      };
    default:
      // Non-DCO drivers are redirected off this screen; keep a calm fallback.
      return {
        body: 'Marketplace opens after your DCO request is approved.',
        cta: 'View DCO status',
        target: 'dco-status',
      };
  }
}

function LoadCard({
  load,
  compatible,
  bidStatus,
  onOpenDetail,
  onBid,
}: {
  load: FleetOwnerOpenLoad;
  compatible: boolean;
  bidStatus?: MarketBidStatus;
  onOpenDetail: () => void;
  onBid: () => void;
}) {
  const rate = formatFleetOwnerRateOffer(load.rate_offer);
  const shipper = (load.creator_organization_name ?? '').trim() || 'Shipper';
  const isAwarded = bidStatus === 'accepted';
  const isQuoted = bidStatus === 'pending';
  const isClosed =
    bidStatus === 'rejected' || bidStatus === 'superseded' || bidStatus === 'withdrawn';

  let primary: Parameters<typeof DriverWorkOpportunityCard>[0]['primaryCta'] = {
    title: 'Bid Now',
    hint: rate ? `Shipper target ${rate}` : 'Offer your rate to the shipper',
    onPress: onBid,
  };
  if (isAwarded) {
    primary = { title: 'Open job', hint: 'Awarded — continue on Dashboard', onPress: onOpenDetail };
  } else if (isQuoted) {
    primary = {
      title: 'Revise bid',
      hint: rate ? `Target ${rate}` : 'Update your quoted bid',
      onPress: onBid,
      variant: 'quoted',
    };
  } else if (isClosed) {
    primary = {
      title: marketBidStatusLabel(bidStatus!),
      variant: 'info',
      onPress: onOpenDetail,
    };
  }

  return (
    <DriverWorkOpportunityCard
      orgName={shipper}
      orgLogoUrl={load.creator_organization_logo_url}
      orgAvatarSeed={load.creator_organization_avatar_seed}
      orgSeed={load.creator_organization_id ?? load.id}
      kicker={
        isAwarded
          ? 'Job · Awarded'
          : isQuoted
            ? 'Quoted bid'
            : isClosed
              ? marketBidStatusLabel(bidStatus!)
              : 'Market'
      }
      badge={isAwarded ? 'awarded' : isQuoted ? 'quoted' : isClosed ? null : 'open'}
      origin={load.pickup_area}
      destination={load.drop_location}
      vehicleType={load.vehicle_type}
      material={load.load_type}
      pickupDate={load.pickup_date}
      fleetMatch={compatible && !isAwarded}
      targetLabel={isAwarded ? 'Awarded rate' : isQuoted ? 'Shipper target' : 'Shipper target'}
      targetValue={rate}
      primaryCta={primary}
      secondaryCta={{
        title: isAwarded ? 'Open job' : 'Full view',
        onPress: onOpenDetail,
      }}
    />
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  gateBody: { fontSize: 12, lineHeight: 17 },
  marketSection: { paddingTop: 14, gap: 8, paddingBottom: 8 },
  marketGate: {
    paddingHorizontal: DRIVER_DETAIL_HORIZONTAL_PAD,
    paddingTop: 14,
    paddingBottom: 8,
    gap: 10,
  },
  gateCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 10,
  },
  gateTitle: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  marketListPad: { paddingHorizontal: DRIVER_DETAIL_HORIZONTAL_PAD, gap: 8 },
  marketplaceDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(148,163,184,0.35)',
    marginHorizontal: DRIVER_DETAIL_HORIZONTAL_PAD,
    marginBottom: 2,
  },
  marketplaceLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.55,
    lineHeight: 13,
    paddingHorizontal: DRIVER_DETAIL_HORIZONTAL_PAD,
    marginBottom: 2,
    includeFontPadding: false,
  },
  marketTitleBlock: {
    paddingHorizontal: DRIVER_DETAIL_HORIZONTAL_PAD,
    paddingBottom: 2,
  },
  marketDisplayTitle: {
    fontSize: 40,
    fontWeight: '900',
    fontStyle: 'italic',
    letterSpacing: -1.6,
    lineHeight: 44,
    color: Theme.driverCtaFill,
    textTransform: 'uppercase',
    marginTop: -4,
  },
  segmentTrack: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: DRIVER_DETAIL_HORIZONTAL_PAD,
    marginTop: 10,
    marginBottom: 4,
    padding: 4,
    gap: 4,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  segmentBtn: {
    flex: 1,
    borderRadius: 11,
    paddingVertical: 10,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentBtnOn: {
    backgroundColor: Theme.buttonDark,
  },
  segmentText: { fontSize: 13, fontWeight: '600', letterSpacing: -0.1, lineHeight: 18 },
  segmentTextOn: { color: Theme.buttonDarkText, fontWeight: '700' },
  empty: {
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 22,
    paddingHorizontal: 16,
    gap: 6,
    alignItems: 'center',
  },
  emptyIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: { fontSize: 13, fontWeight: '700', letterSpacing: -0.15 },
  emptyBody: { fontSize: 12, lineHeight: 17 },
  cta: {
    minHeight: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  ctaText: { color: Theme.textOnPrimary, fontSize: 13, fontWeight: '700' },
  errorText: { color: Theme.negative, fontSize: 12, fontWeight: '600' },
});
