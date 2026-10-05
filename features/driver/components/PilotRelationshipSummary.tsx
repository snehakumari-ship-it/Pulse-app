/**
 * Relationship summary above DriverHomeScreen, keyed on the server-resolved
 * operating mode (get_my_driver_operating_mode):
 *   Driver — "Working with <business>", jobs assigned by that business.
 *            No Marketplace row.
 *   DCO    — own vehicle + Marketplace (opportunities, bids, awards).
 *            Previous fleets are shown as history only.
 * Reuses existing hooks; the only new read is the operating mode itself.
 */
import Theme from '@/constants/Theme';
import { useDriverThemeColors } from '@/contexts/DriverThemeContext';
import { splitEmployerRelationships } from '@/features/drivers/domain/driverOperatingMode';
import { useDriverHomeDriversQuery } from '@/lib/queries/useDriverHomeDriversQuery';
import { useDriverOperatingModeQuery } from '@/lib/queries/useDriverOperatingModeQuery';
import { useFleetOwnerOpenLoadsQuery } from '@/lib/queries/useFleetOwnerOpenLoadsQuery';
import { useMyMarketAwardsQuery } from '@/lib/queries/useMyMarketAwardsQuery';
import { useMyMarketBidsQuery } from '@/lib/queries/useMyMarketBidsQuery';
import { useOwnerVehiclesQuery } from '@/lib/queries/useOwnerVehiclesQuery';
import { usePilotWorkSummaryQuery } from '@/lib/queries/usePilotWorkSummaryQuery';
import { ownerVehicleTitle } from '@/features/driver/services/ownerVehicles.service';
import { ROUTES } from '@/lib/routes';
import { useRouter, type Href } from 'expo-router';
import { Briefcase, ChevronRight, History, ShoppingBag, Truck } from 'lucide-react-native';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type React from 'react';

const TERMINAL_TRIP_STATUSES = new Set(['completed', 'cancelled']);

function orgNames(rows: { organizations?: { name?: string | null } | null }[]): string[] {
  const names = new Set<string>();
  for (const r of rows) {
    const n = r.organizations?.name?.trim();
    if (n) names.add(n);
  }
  return [...names];
}

export function PilotRelationshipSummary({ uid }: { uid: string | null }) {
  const router = useRouter();
  const colors = useDriverThemeColors();
  const cardBorder = colors.border;

  const { operatingMode, isDco, marketplaceAllowed } = useDriverOperatingModeQuery(uid);

  const linkedDriversQuery = useDriverHomeDriversQuery(uid);
  const { current, previous } = useMemo(
    () => splitEmployerRelationships(linkedDriversQuery.drivers),
    [linkedDriversQuery.drivers],
  );
  const currentNames = useMemo(() => orgNames(current), [current]);
  const previousNames = useMemo(() => orgNames(previous), [previous]);
  const activeDriverIds = useMemo(
    () => linkedDriversQuery.activeLinkedDrivers.map((d) => d.id),
    [linkedDriversQuery.activeLinkedDrivers],
  );
  const { activeCount, upcomingCount } = usePilotWorkSummaryQuery(activeDriverIds);

  const { vehicles } = useOwnerVehiclesQuery(uid);
  const activeVehicles = useMemo(() => vehicles.filter((v) => v.status === 'active'), [vehicles]);
  const { loads } = useFleetOwnerOpenLoadsQuery(uid);
  const { bids } = useMyMarketBidsQuery(uid);
  const { awards } = useMyMarketAwardsQuery(uid);
  const pendingBids = useMemo(() => bids.filter((b) => b.status === 'pending').length, [bids]);
  const activeAwards = useMemo(
    () => awards.filter((t) => !TERMINAL_TRIP_STATUSES.has(String(t.status ?? ''))).length,
    [awards],
  );

  if (isDco) {
    const vehicleLine =
      activeVehicles.length > 0
        ? activeVehicles.length === 1
          ? ownerVehicleTitle(activeVehicles[0])
          : `${ownerVehicleTitle(activeVehicles[0])} +${activeVehicles.length - 1}`
        : 'No active vehicle';
    const dcoSecondary = {
      DCO: 'Independent operator',
      DCO_VEHICLE_REQUIRED: 'Add an active vehicle to operate as DCO',
      DCO_SUSPENDED: 'DCO suspended by Pulse admin',
      DCO_EMPLOYMENT_CONFLICT: 'Still linked as an employee driver — leave that fleet',
      DRIVER: '',
    }[operatingMode.mode];
    const dcoNeedsStatus =
      operatingMode.mode === 'DCO_SUSPENDED' || operatingMode.mode === 'DCO_EMPLOYMENT_CONFLICT';

    return (
      <View style={styles.stack}>
        <Row
          icon={<Truck size={16} color={colors.emerald} />}
          colors={colors}
          cardBorder={cardBorder}
          title="DCO · Vehicle"
          primary={vehicleLine}
          secondary={dcoSecondary}
          onPress={() =>
            router.push(
              (dcoNeedsStatus ? ROUTES.driverDcoStatus() : ROUTES.driverMyFleet()) as Href,
            )
          }
        />

        {marketplaceAllowed ? (
          <Row
            icon={<ShoppingBag size={16} color={colors.emerald} />}
            colors={colors}
            cardBorder={cardBorder}
            title="Marketplace"
            primary={`${loads.length} opportunit${loads.length === 1 ? 'y' : 'ies'} available`}
            secondary={`${pendingBids} pending bid${pendingBids === 1 ? '' : 's'} · ${awards.length} awarded · ${activeAwards} active`}
            onPress={() => router.push(ROUTES.driverAvailableLoads() as Href)}
          />
        ) : null}

        {previousNames.length > 0 ? (
          <Row
            icon={<History size={16} color={colors.textMuted} />}
            colors={colors}
            cardBorder={cardBorder}
            title="Previous fleets"
            primary={previousNames.join(', ')}
            secondary="History only — not current employment"
          />
        ) : null}
      </View>
    );
  }

  if (currentNames.length === 0) return null;

  return (
    <View style={styles.stack}>
      <Row
        icon={<Briefcase size={16} color={colors.emerald} />}
        colors={colors}
        cardBorder={cardBorder}
        title="Driver · Working with"
        primary={currentNames.length === 1 ? currentNames[0] : `${currentNames.length} businesses`}
        secondary={`Jobs assigned by your business · ${activeCount} active · ${upcomingCount} upcoming`}
      />
    </View>
  );
}

function Row({
  icon,
  colors,
  cardBorder,
  title,
  primary,
  secondary,
  onPress,
}: {
  icon: React.ReactNode;
  colors: ReturnType<typeof useDriverThemeColors>;
  cardBorder: string;
  title: string;
  primary: string;
  secondary: string;
  onPress?: () => void;
}) {
  const content = (
    <>
      <View style={styles.iconWrap}>{icon}</View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.title, { color: colors.textMuted }]}>{title.toUpperCase()}</Text>
        <Text style={[styles.primary, { color: colors.text }]} numberOfLines={1}>
          {primary}
        </Text>
        <Text style={[styles.secondary, { color: colors.textMuted }]} numberOfLines={1}>
          {secondary}
        </Text>
      </View>
      {onPress ? <ChevronRight size={16} color={colors.textMuted} /> : null}
    </>
  );

  if (!onPress) {
    return (
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: cardBorder }]}>
        {content}
      </View>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: colors.surface, borderColor: cardBorder, opacity: pressed ? 0.9 : 1 },
      ]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 8, marginBottom: 12 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Theme.surfaceGray,
  },
  title: { fontSize: 10, fontWeight: '700', letterSpacing: 0.4 },
  primary: { fontSize: 15, fontWeight: '800', marginTop: 1 },
  secondary: { fontSize: 12, fontWeight: '600', marginTop: 1 },
});
