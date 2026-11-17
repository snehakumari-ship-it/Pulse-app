/**
 * Full-page party receivable (Marketplace / shipper) — Finance client layout,
 * light app chrome, compact type. Not a modal and not driver dark mode.
 */
import { CenteredLoadingView } from "@/components/CenteredLoadingView";
import { EntityAvatar } from "@/components/EntityAvatar";
import { DriverCapturePaymentButton } from "@/features/drivers/components/DriverCapturePaymentButton";
import { DriverCollectFromSheet } from "@/features/drivers/components/DriverCollectFromSheet";
import Theme from "@/constants/Theme";
import { useAuth } from "@/contexts/AuthContext";
import {
  buildDriverTripNumberMap,
  getDriverTripDisplayNumber,
} from "@/features/driver/utils/driverTripSequence.util";
import { receivedByTripFromDriverBooks } from "@/features/drivers/services/driverCapturePayment.service";
import * as driversService from "@/features/drivers/services/drivers.service";
import {
  EMPTY_DRIVER_PARTY_AVATAR,
  resolveDriverPartyAvatar,
  type DriverPartyAvatarFields,
} from "@/features/drivers/utils/driverPartyAvatar.util";
import {
  UNTAGGED_PARTY_ID,
  buildDriverPartyReceivables,
  isTripTaggedToParty,
  tripNeedsPartyTag,
  tripReceivablePartyName,
  tripsForDriverParty,
} from "@/features/drivers/utils/driverPartyReceivables.util";
import {
  listTagPartyChoices,
  type TagPartyListRow,
} from "@/features/drivers/utils/driverSelectableParties.util";
import * as tripsService from "@/features/trips/services/trips.service";
import { ROUTES } from "@/lib/routes";
import { useSafeBack } from "@/lib/useSafeBack";
import { LinearGradient } from "expo-linear-gradient";
import { type Href, useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { Building2, ChevronDown, ChevronLeft, Package, Search, SlidersHorizontal, Tag, Wallet } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

function inr(n: number): string {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

function decodePartyId(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return "";
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export default function DriverPartyReceivableScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const goSettlements = useSafeBack(ROUTES.driverWalletSelf());
  const { partyId: partyIdParam } = useLocalSearchParams<{ partyId?: string }>();
  const partyId = decodePartyId(partyIdParam);
  const { profile } = useAuth();

  const [loading, setLoading] = useState(true);
  const [trips, setTrips] = useState<tripsService.TripRow[]>([]);
  const [receivedByTripId, setReceivedByTripId] = useState<Record<string, number>>({});
  const [linkedDrivers, setLinkedDrivers] = useState<driversService.DriverRow[]>([]);
  const [tagTrip, setTagTrip] = useState<tripsService.TripRow | null>(null);
  const [seedParty, setSeedParty] = useState<TagPartyListRow | null>(null);
  const [query, setQuery] = useState("");
  const [menuTripId, setMenuTripId] = useState<string | null>(null);
  const [menuQuery, setMenuQuery] = useState("");
  const [shippers, setShippers] = useState<TagPartyListRow[]>([]);
  const [shippersReady, setShippersReady] = useState(false);
  const hasLoadedRef = useRef(false);

  const load = useCallback(async () => {
    if (!profile?.uid) {
      setLoading(false);
      return;
    }
    if (!hasLoadedRef.current) setLoading(true);
    try {
      const driversRes = await driversService.getLinkedDriversForCurrentUser(profile.uid);
      const drivers = driversRes.drivers ?? [];
      setLinkedDrivers(drivers);
      if (drivers.length === 0) {
        setTrips([]);
        setReceivedByTripId({});
        return;
      }
      const driverIds = drivers.map((d) => d.id);
      const [tRes, ledgerRes] = await Promise.all([
        tripsService.getDriverUiTripsByDriverIds(driverIds),
        driversService.getDriverLedgerByDriverIds(driverIds),
      ]);
      setTrips(tRes.trips ?? []);
      const byTrip: Record<string, number> = {};
      for (const entry of ledgerRes.entries ?? []) {
        const tid = entry.trip_id?.trim() || null;
        if (!tid || entry.type !== "settlement") continue;
        byTrip[tid] = (byTrip[tid] ?? 0) + (Number(entry.amount) || 0);
      }
      const bookReceived = await receivedByTripFromDriverBooks();
      for (const [tripId, amount] of Object.entries(bookReceived)) {
        byTrip[tripId] = (byTrip[tripId] ?? 0) + amount;
      }
      setReceivedByTripId(byTrip);
    } finally {
      hasLoadedRef.current = true;
      setLoading(false);
    }
  }, [profile?.uid]);

  useFocusEffect(
    useCallback(() => {
      if (tagTrip) return;
      void load();
    }, [load, tagTrip]),
  );

  const isFleetDispatched = useCallback(
    (trip: tripsService.TripRow) => {
      const tripOrgId = String(trip.organization_id ?? "").trim();
      if (!tripOrgId) return false;
      return linkedDrivers.some((row) => {
        if (String(row.organization_id ?? "").trim() !== tripOrgId) return false;
        if (row.tracking_only === true) return false;
        return driversService.isActiveFleetRelationshipDriver(row);
      });
    },
    [linkedDrivers],
  );

  const party = useMemo(
    () =>
      buildDriverPartyReceivables(trips, receivedByTripId, isFleetDispatched).find(
        (row) => row.id === partyId,
      ) ?? null,
    [trips, receivedByTripId, isFleetDispatched, partyId],
  );

  const partyTrips = useMemo(
    () =>
      partyId
        ? tripsForDriverParty(trips, receivedByTripId, isFleetDispatched, partyId)
        : [],
    [trips, receivedByTripId, isFleetDispatched, partyId],
  );

  const tripNumbers = useMemo(() => buildDriverTripNumberMap(trips), [trips]);
  const [avatar, setAvatar] = useState<DriverPartyAvatarFields>(EMPTY_DRIVER_PARTY_AVATAR);

  useEffect(() => {
    let cancelled = false;
    setAvatar(EMPTY_DRIVER_PARTY_AVATAR);
    void resolveDriverPartyAvatar(
      partyId,
      partyTrips.map((line) => line.trip),
    ).then((fields) => {
      if (!cancelled) setAvatar(fields);
    });
    return () => {
      cancelled = true;
    };
  }, [partyId, partyTrips]);

  const visibleTrips = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return partyTrips;
    return partyTrips.filter((line) => {
      const tripNo = getDriverTripDisplayNumber(line.trip, tripNumbers).toLowerCase();
      const hay = `${line.trip.pickup_area ?? ""} ${line.trip.drop_location ?? ""} ${tripNo}`.toLowerCase();
      return hay.includes(q);
    });
  }, [partyTrips, query, tripNumbers]);

  const menuShippers = useMemo(() => {
    const q = menuQuery.trim().toLowerCase();
    if (!q) return shippers;
    return shippers.filter((row) => row.name.toLowerCase().includes(q));
  }, [menuQuery, shippers]);

  useEffect(() => {
    if (!menuTripId || shippersReady) return;
    let cancelled = false;
    void listTagPartyChoices(profile?.uid)
      .then((rows) => {
        if (cancelled) return;
        setShippers(rows);
        setShippersReady(true);
      })
      .catch(() => {
        if (!cancelled) setShippersReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [menuTripId, profile?.uid, shippersReady]);

  if (loading) {
    return <CenteredLoadingView message="Loading…" color={Theme.primary} />;
  }

  const isMarketplace = party?.kind === "marketplace";
  const kicker = isMarketplace ? "Pulse Exchange" : "Shipper · Client";
  const entityType = isMarketplace ? "supplier" : "client";
  const captureLane = isMarketplace ? "marketplace" : "shipper";
  const billed = party?.billed ?? 0;
  const dueShare = billed > 0 ? Math.min(1, Math.max(0, party?.due ?? 0) / billed) : 0;

  if (isMarketplace) {
    return (
      <View style={styles.exchangeScreen}>
        <LinearGradient
          colors={[Theme.marketplaceExchangeWash, "#F7FCFF", Theme.cardWhite]}
          style={StyleSheet.absoluteFill}
        />
        <ScrollView
          contentContainerStyle={{
            paddingTop: insets.top + 8,
            paddingBottom: insets.bottom + 28,
            paddingHorizontal: 16,
          }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={loading} onRefresh={load} tintColor={Theme.tripsCompleted} />
          }
        >
          <View style={styles.exchangeHeader}>
            <Pressable
              onPress={goSettlements}
              style={styles.exchangeBack}
              accessibilityRole="button"
              accessibilityLabel="Back"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <ChevronLeft size={22} color={Theme.textPrimaryDark} strokeWidth={2.4} />
            </Pressable>
            <View style={styles.exchangeTitleWrap}>
              <Text style={styles.exchangeTitle}>Marketplace</Text>
              <Text style={styles.exchangeKicker}>Pulse Exchange</Text>
            </View>
            <View style={styles.exchangeBadge} accessibilityLabel="Marketplace">
              <Building2 size={18} color={Theme.textPrimary} strokeWidth={2} />
            </View>
          </View>

          <Text style={styles.exchangeSection}>Financial overview</Text>
          <Text style={styles.exchangeTotal}>{inr(billed)}</Text>
          <View style={styles.exchangeSplit}>
            <View>
              <Text style={styles.exchangeSplitLabel}>Received</Text>
              <Text style={[styles.exchangeSplitAmt, { color: Theme.positive }]}>
                {inr(party?.received ?? 0)}
              </Text>
            </View>
            <View style={styles.exchangeSplitEnd}>
              <Text style={styles.exchangeSplitLabel}>Due</Text>
              <Text
                style={[
                  styles.exchangeSplitAmt,
                  { color: (party?.due ?? 0) > 0 ? Theme.negative : Theme.positive },
                ]}
              >
                {inr(party?.due ?? 0)}
              </Text>
            </View>
          </View>
          <View style={styles.exchangeTrack}>
            <View style={[styles.exchangeFill, { width: `${Math.round(dueShare * 100)}%` }]} />
          </View>
          <View style={styles.exchangeTrackLabels}>
            <Text style={styles.exchangeTrackLabel}>Received</Text>
            <Text style={styles.exchangeTrackValue}>/ {inr(billed)}</Text>
          </View>

          <Text style={[styles.exchangeSection, styles.exchangeSectionSpaced]}>Receivables</Text>
          <View style={styles.exchangeCard}>
            {partyTrips.length === 0 ? (
              <Text style={styles.empty}>No trips for this party.</Text>
            ) : (
              partyTrips.map((line, idx) => {
                const last = idx === partyTrips.length - 1;
                const tripNo = getDriverTripDisplayNumber(line.trip, tripNumbers);
                const partyName = tripReceivablePartyName(line.trip);
                const showParty =
                  Boolean(partyName) && partyName !== "Shipper" && partyName !== "Untagged";
                const needsTag = tripNeedsPartyTag(line.trip, false);
                return (
                  <View
                    key={line.trip.id}
                    style={[styles.exchangeRow, !last && styles.exchangeRowBorder]}
                  >
                    <Pressable
                      style={styles.exchangeRowMain}
                      onPress={() => router.push(`/driver-trip/${line.trip.id}`)}
                      accessibilityRole="button"
                      accessibilityLabel={`Open trip ${tripNo}${showParty ? `, ${partyName}` : ""}`}
                    >
                      <View style={styles.exchangeMark}>
                        <Building2 size={16} color={Theme.textPrimaryDark} strokeWidth={2.2} />
                      </View>
                      <View style={styles.missionCol}>
                        <Text style={styles.exchangeName} numberOfLines={1}>
                          {showParty ? partyName : tripNo}
                        </Text>
                        <Text style={styles.exchangeTrip} numberOfLines={1}>
                          {tripNo}
                        </Text>
                      </View>
                      <Text style={styles.exchangeDue} numberOfLines={1}>
                        {inr(line.due)}
                      </Text>
                    </Pressable>
                    {needsTag ? (
                      <Pressable
                        onPress={() => setTagTrip(line.trip)}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel={`Tag party for ${tripNo}`}
                        style={({ pressed }) => [styles.tagBtn, { opacity: pressed ? 0.82 : 1 }]}
                      >
                        <Tag size={13} color={Theme.driverEmerald} strokeWidth={2.4} />
                      </Pressable>
                    ) : line.due > 0 ? (
                      <DriverCapturePaymentButton
                        tripId={line.trip.id}
                        due={line.due}
                        lane="marketplace"
                        partyName={showParty ? partyName : party?.name}
                        outline
                      />
                    ) : null}
                  </View>
                );
              })
            )}
          </View>
        </ScrollView>
        {tagTrip ? (
          <DriverCollectFromSheet
            visible
            trip={tagTrip}
            due={Math.max(0, partyTrips.find((line) => line.trip.id === tagTrip.id)?.due ?? 0)}
            lane="marketplace"
            onClose={() => setTagTrip(null)}
            onTagged={() => {
              setTagTrip(null);
              void load();
            }}
          />
        ) : null}
      </View>
    );
  }

  if (partyId === UNTAGGED_PARTY_ID) {
    const received = party?.received ?? 0;
    return (
      <View style={styles.untaggedScreen}>
        <LinearGradient
          colors={[Theme.driverEmeraldWash, Theme.driverEmeraldWash]}
          style={[styles.untaggedHeader, { paddingTop: insets.top + 12 }]}
        >
          <View style={styles.untaggedNav}>
            <Pressable
              onPress={goSettlements}
              accessibilityRole="button"
              accessibilityLabel="Back"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={styles.untaggedBack}
            >
              <ChevronLeft size={22} color={Theme.textPrimaryDark} strokeWidth={2.4} />
            </Pressable>
            <View style={styles.untaggedTitleWrap}>
              <Text style={styles.untaggedTitle} numberOfLines={1}>
                {party?.name ?? "Untagged"}
              </Text>
              <Text style={styles.untaggedKicker}>Shipper · Client</Text>
            </View>
            <View style={styles.untaggedBadge} accessibilityLabel="Untagged shipper">
              <Building2 size={18} color={Theme.warning} strokeWidth={2.1} />
            </View>
          </View>
          <View style={styles.untaggedSearch}>
            <Search size={15} color={Theme.textMuted} strokeWidth={2.2} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search by TRP ID or Location..."
              placeholderTextColor={Theme.textMuted}
              style={styles.untaggedSearchInput}
              autoCorrect={false}
              autoCapitalize="none"
              accessibilityLabel="Search by trip ID or location"
            />
            <SlidersHorizontal size={16} color={Theme.textRouteCard} strokeWidth={2.2} />
          </View>
        </LinearGradient>

        <ScrollView
          style={styles.untaggedScroll}
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingTop: 12,
            paddingBottom: insets.bottom + 28,
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={Theme.warning} />}
        >
          <View style={styles.untaggedOverview}>
            <View style={styles.untaggedOverviewCopy}>
              <Text style={styles.untaggedOverviewLabel}>Financial Overview</Text>
              <Text style={styles.untaggedOverviewAmt}>{inr(party?.billed ?? 0)}</Text>
            </View>
            {received <= 0 ? (
              <View style={styles.untaggedPill}>
                <Text style={styles.untaggedPillText}>No transactions</Text>
              </View>
            ) : null}
          </View>

          <Text style={styles.untaggedSection}>Receivables ({visibleTrips.length})</Text>
          {visibleTrips.length === 0 ? (
            <Text style={styles.empty}>
              {query.trim() ? "No trips match this search." : "No trips for this party."}
            </Text>
          ) : (
            visibleTrips.map((line) => {
              const tripNo = getDriverTripDisplayNumber(line.trip, tripNumbers);
              const needsTag = tripNeedsPartyTag(line.trip, false);
              const menuOpen = menuTripId === line.trip.id;
              return (
                <View key={line.trip.id} style={[styles.untaggedCard, menuOpen && styles.untaggedCardOpen]}>
                  <View style={styles.untaggedCardRow}>
                    <Pressable
                      style={styles.untaggedCardMain}
                      onPress={() => router.push(`/driver-trip/${line.trip.id}`)}
                      accessibilityRole="button"
                      accessibilityLabel={`Open trip ${tripNo}`}
                    >
                      <View style={styles.untaggedDot} />
                      <View style={styles.untaggedCardCopy}>
                        <Text style={styles.untaggedTrip} numberOfLines={1}>
                          {tripNo}
                        </Text>
                        <Text style={styles.untaggedMoney} numberOfLines={1}>
                          <Text style={styles.untaggedReceived}>RECEIVED {inr(line.received)}</Text>
                          <Text style={styles.untaggedDue}>{"   "}DUE {inr(line.due)}</Text>
                        </Text>
                      </View>
                    </Pressable>
                    {needsTag ? (
                      <Pressable
                        onPress={() => {
                          setMenuTripId((current) => (current === line.trip.id ? null : line.trip.id));
                          setMenuQuery("");
                        }}
                        accessibilityRole="button"
                        accessibilityState={{ expanded: menuOpen }}
                        accessibilityLabel={`Assign shipper for ${tripNo}`}
                        style={({ pressed }) => [styles.assignBtn, pressed && styles.assignBtnPressed]}
                      >
                        <Text style={styles.assignBtnText}>Assign Shipper</Text>
                        <ChevronDown size={14} color={Theme.textPrimary} strokeWidth={2.4} />
                      </Pressable>
                    ) : null}
                  </View>
                  {menuOpen ? (
                    <View style={styles.assignMenu}>
                      <View style={styles.assignSearch}>
                        <Search size={14} color={Theme.textMuted} strokeWidth={2.2} />
                        <TextInput
                          value={menuQuery}
                          onChangeText={setMenuQuery}
                          placeholder="Search shippers"
                          placeholderTextColor={Theme.textMuted}
                          style={styles.assignSearchInput}
                          autoCorrect={false}
                          autoCapitalize="none"
                          accessibilityLabel="Search shippers"
                        />
                      </View>
                      {!shippersReady ? (
                        <Text style={styles.assignEmpty}>Loading shippers…</Text>
                      ) : menuShippers.length === 0 ? (
                        <Text style={styles.assignEmpty}>No shippers match.</Text>
                      ) : (
                        <ScrollView
                          style={styles.assignList}
                          keyboardShouldPersistTaps="handled"
                          nestedScrollEnabled
                        >
                          {menuShippers.map((row) => (
                            <Pressable
                              key={row.id}
                              onPress={() => {
                                setSeedParty(row);
                                setTagTrip(line.trip);
                                setMenuTripId(null);
                                setMenuQuery("");
                              }}
                              style={({ pressed }) => [styles.assignOption, pressed && styles.assignBtnPressed]}
                              accessibilityRole="button"
                              accessibilityLabel={`Assign ${row.name}`}
                            >
                              <Text style={styles.assignOptionText} numberOfLines={1}>
                                {row.name}
                              </Text>
                            </Pressable>
                          ))}
                        </ScrollView>
                      )}
                      <Pressable
                        onPress={() => {
                          setMenuTripId(null);
                          router.push(ROUTES.driverAddClient({ tripId: line.trip.id }) as Href);
                        }}
                        style={({ pressed }) => [styles.assignAdd, pressed && styles.assignBtnPressed]}
                        accessibilityRole="button"
                        accessibilityLabel="Add a shipper"
                      >
                        <Text style={styles.assignAddText}>Add shipper</Text>
                      </Pressable>
                    </View>
                  ) : null}
                </View>
              );
            })
          )}
        </ScrollView>
        {tagTrip ? (
          <DriverCollectFromSheet
            visible
            trip={tagTrip}
            seedParty={seedParty}
            due={Math.max(0, partyTrips.find((line) => line.trip.id === tagTrip.id)?.due ?? 0)}
            lane="shipper"
            onClose={() => {
              setTagTrip(null);
              setSeedParty(null);
            }}
            onTagged={() => {
              setTagTrip(null);
              setSeedParty(null);
              setMenuTripId(null);
              void load();
            }}
          />
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <LinearGradient
        colors={[Theme.driverEmeraldWash, Theme.driverEmeraldWash]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={[styles.header, { paddingTop: insets.top + 12 }]}
      >
        <Pressable
          onPress={goSettlements}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={styles.backBtn}
        >
          <ChevronLeft size={18} color={Theme.textPrimary} strokeWidth={2.4} />
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {party?.name ?? "Receivable"}
          </Text>
          <Text style={styles.kicker}>{kicker}</Text>
        </View>
        <View style={styles.headerAvatar} accessibilityLabel={`${party?.name ?? "Party"} avatar`}>
          <EntityAvatar
            name={party?.name ?? "Party"}
            initialsColorSeed={party?.id ?? partyId}
            avatarUrl={avatar.avatarUrl}
            avatarSeed={avatar.avatarSeed}
            organizationImageUrl={avatar.organizationImageUrl}
            organizationAvatarSeed={avatar.organizationAvatarSeed}
            entityType={entityType}
            isIntegrated={avatar.isIntegrated}
            showIntegrationBadge={false}
            size={44}
          />
        </View>
      </LinearGradient>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 8,
          paddingBottom: insets.bottom + 32,
        }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.scorecard}>
          <Text style={styles.scoreLabel}>Financial overview</Text>
          <Text style={styles.scoreBilled}>{inr(party?.billed ?? 0)}</Text>
          <View style={styles.walletArt} pointerEvents="none">
            <Wallet size={58} color={Theme.driverEmerald} strokeWidth={1.4} />
          </View>
          <View style={styles.scoreGrid}>
            <View style={styles.scoreCell}>
              <View style={styles.metricLabelRow}>
                <View style={[styles.statusDot, { backgroundColor: Theme.tripsCardWashEnd }]} />
                <Text style={styles.scoreGridLabel}>Received</Text>
              </View>
              <View style={styles.metricLabelRow}>
                <View style={[styles.statusDot, { backgroundColor: Theme.positive }]} />
                <Text style={[styles.scoreAmt, { color: Theme.positive }]}>
                  {inr(party?.received ?? 0)}
                </Text>
              </View>
            </View>
            <View style={styles.scoreDivider} />
            <View style={styles.scoreCell}>
              <View style={styles.metricLabelRow}>
                <View style={[styles.statusDot, { backgroundColor: Theme.negativeMuted }]} />
                <Text style={styles.scoreGridLabel}>Due</Text>
              </View>
              <View style={styles.metricLabelRow}>
                <View
                  style={[
                    styles.statusDot,
                    { backgroundColor: (party?.due ?? 0) > 0 ? Theme.negative : Theme.positive },
                  ]}
                />
                <Text
                  style={[
                    styles.scoreAmt,
                    { color: (party?.due ?? 0) > 0 ? Theme.negative : Theme.positive },
                  ]}
                >
                  {inr(party?.due ?? 0)}
                </Text>
              </View>
            </View>
          </View>
        </View>

        <Text style={styles.sectionTitle}>List</Text>
        {partyTrips.length === 0 ? (
          <Text style={styles.empty}>No trips for this party.</Text>
        ) : (
          partyTrips.map((line, idx) => {
            const last = idx === partyTrips.length - 1;
            const tripNo = getDriverTripDisplayNumber(line.trip, tripNumbers);
            const partyName = tripReceivablePartyName(line.trip);
            const showParty =
              isMarketplace &&
              partyName &&
              partyName !== "Shipper" &&
              partyName !== "Untagged";
            const needsTag = tripNeedsPartyTag(line.trip, false);
            const route =
              [line.trip.pickup_area, line.trip.drop_location].filter(Boolean).join(", ") || "—";
            const canCapture = line.due > 0 && (isMarketplace || isTripTaggedToParty(line.trip));
            return (
              <View key={line.trip.id} style={[styles.row, !last && styles.rowBorder]}>
                <Pressable
                  style={styles.rowMain}
                  onPress={() => router.push(`/driver-trip/${line.trip.id}`)}
                  accessibilityRole="button"
                  accessibilityLabel={`Open trip ${tripNo}${showParty ? `, ${partyName}` : ""}`}
                >
                  <View style={styles.boxBadge}>
                    <Package size={18} color={Theme.driverEmerald} strokeWidth={2} />
                  </View>
                  <View style={styles.missionCol}>
                    <View style={styles.titleRow}>
                      <Text style={styles.missionId} numberOfLines={1}>
                        {tripNo}
                      </Text>
                      {line.due > 0 ? (
                        <View style={styles.pendingBadge}>
                          <Text style={styles.pendingBadgeText}>Pending settlement</Text>
                        </View>
                      ) : null}
                    </View>
                    {showParty ? (
                      <Text style={styles.partyName} numberOfLines={1}>
                        {partyName}
                      </Text>
                    ) : null}
                    <Text style={styles.missionRoute} numberOfLines={1}>
                      {route}
                    </Text>
                  </View>
                </Pressable>
                {needsTag ? (
                  <Pressable
                    onPress={() => setTagTrip(line.trip)}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={`Tag party for ${tripNo}`}
                    style={({ pressed }) => [styles.tagBtn, { opacity: pressed ? 0.82 : 1 }]}
                  >
                    <Tag size={13} color={Theme.driverEmerald} strokeWidth={2.4} />
                  </Pressable>
                ) : canCapture ? (
                  <DriverCapturePaymentButton
                    tripId={line.trip.id}
                    due={line.due}
                    lane={captureLane}
                    partyName={showParty ? partyName : party?.name}
                    outline
                  />
                ) : null}
              </View>
            );
          })
        )}
      </ScrollView>

      {tagTrip ? (
        <DriverCollectFromSheet
          visible
          trip={tagTrip}
          due={Math.max(0, partyTrips.find((line) => line.trip.id === tagTrip.id)?.due ?? 0)}
          lane={captureLane === "marketplace" ? "marketplace" : "shipper"}
          onClose={() => setTagTrip(null)}
          onTagged={() => {
            setTagTrip(null);
            void load();
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  exchangeScreen: {
    flex: 1,
    backgroundColor: Theme.cardWhite,
  },
  exchangeHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 22,
  },
  exchangeBack: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  exchangeTitleWrap: {
    flex: 1,
    minWidth: 0,
  },
  exchangeTitle: {
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: Theme.textPrimary,
  },
  exchangeKicker: {
    marginTop: 2,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: Theme.textMuted,
  },
  exchangeBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Theme.cardWhite,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Theme.borderMedium,
  },
  exchangeSection: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.1,
    textTransform: "uppercase",
    color: Theme.textMuted,
    marginBottom: 6,
  },
  exchangeSectionSpaced: {
    marginTop: 26,
  },
  exchangeTotal: {
    fontSize: 36,
    fontWeight: "300",
    letterSpacing: -0.8,
    color: Theme.textPrimary,
    marginBottom: 14,
  },
  exchangeSplit: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  exchangeSplitEnd: {
    alignItems: "flex-end",
  },
  exchangeSplitLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: Theme.textMuted,
    marginBottom: 4,
  },
  exchangeSplitAmt: {
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  exchangeTrack: {
    marginTop: 14,
    height: 6,
    borderRadius: 999,
    backgroundColor: Theme.borderMedium,
    overflow: "hidden",
  },
  exchangeFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: Theme.tripsCompleted,
  },
  exchangeTrackLabels: {
    marginTop: 8,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  exchangeTrackLabel: {
    fontSize: 12,
    fontWeight: "500",
    color: Theme.textRouteCard,
  },
  exchangeTrackValue: {
    fontSize: 12,
    fontWeight: "600",
    color: Theme.textRouteCard,
  },
  exchangeCard: {
    backgroundColor: Theme.cardWhite,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Theme.border,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  exchangeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 68,
    paddingVertical: 10,
  },
  exchangeRowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.borderMedium,
  },
  exchangeRowMain: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  exchangeMark: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Theme.driverGold,
  },
  exchangeName: {
    fontSize: 14,
    fontWeight: "700",
    color: Theme.textPrimary,
  },
  exchangeTrip: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: "600",
    color: Theme.textMuted,
  },
  exchangeDue: {
    fontSize: 14,
    fontWeight: "600",
    color: Theme.textRouteCard,
    marginRight: 4,
  },
  screen: {
    flex: 1,
    backgroundColor: Theme.driverEmeraldWash,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 22,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.72)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.85)",
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "900",
    letterSpacing: -0.4,
    textTransform: "uppercase",
    color: Theme.textPrimaryDark,
  },
  kicker: {
    marginTop: 2,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: Theme.textMuted,
  },
  headerAvatar: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  scroll: { flex: 1, marginTop: -12 },
  scorecard: {
    backgroundColor: Theme.cardWhite,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Theme.borderLight,
    paddingHorizontal: 18,
    paddingVertical: 16,
    marginBottom: 18,
    shadowColor: "#0f172a",
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  scoreLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: Theme.textMuted,
  },
  scoreBilled: {
    marginTop: 4,
    fontSize: 32,
    fontWeight: "900",
    letterSpacing: -0.8,
    color: Theme.textPrimaryDark,
  },
  walletArt: {
    position: "absolute",
    right: 18,
    top: 16,
    opacity: 0.8,
  },
  scoreGrid: {
    flexDirection: "row",
    alignItems: "stretch",
    marginTop: 16,
  },
  scoreCell: {
    flex: 1,
    minWidth: 0,
    gap: 6,
  },
  scoreDivider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: Theme.borderLight,
    marginHorizontal: 12,
  },
  metricLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  scoreGridLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: Theme.textMuted,
  },
  scoreAmt: {
    fontSize: 18,
    fontWeight: "900",
    letterSpacing: -0.3,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: Theme.textSecondary,
    marginBottom: 8,
    marginLeft: 4,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 12,
    minHeight: 64,
  },
  rowMain: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  rowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.borderLight,
  },
  boxBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Theme.driverEmeraldMuted,
  },
  missionCol: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minWidth: 0,
  },
  missionId: {
    fontSize: 16,
    fontWeight: "700",
    color: Theme.textPrimaryDark,
    flexShrink: 1,
  },
  pendingBadge: {
    backgroundColor: Theme.surfaceGray,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  pendingBadgeText: {
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 0.4,
    textTransform: "uppercase",
    color: Theme.textSecondary,
  },
  partyName: {
    fontSize: 12,
    fontWeight: "700",
    color: Theme.textPrimaryDark,
  },
  missionRoute: {
    fontSize: 12,
    fontWeight: "500",
    color: Theme.textMuted,
  },
  tagBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Theme.driverEmeraldMuted,
  },
  empty: {
    padding: 14,
    fontSize: 12,
    color: Theme.textMuted,
  },
  untaggedScreen: {
    flex: 1,
    backgroundColor: Theme.driverEmeraldWash,
  },
  untaggedHeader: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  untaggedNav: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  untaggedBack: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  untaggedTitleWrap: {
    flex: 1,
    minWidth: 0,
  },
  untaggedTitle: {
    fontSize: 20,
    fontWeight: "900",
    letterSpacing: -0.4,
    textTransform: "uppercase",
    color: Theme.textPrimary,
  },
  untaggedKicker: {
    marginTop: 2,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.1,
    textTransform: "uppercase",
    color: Theme.textMuted,
  },
  untaggedBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Theme.warningMuted,
    borderWidth: 1,
    borderColor: Theme.driverGold,
  },
  untaggedSearch: {
    marginTop: 12,
    minHeight: 42,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Theme.borderMedium,
    backgroundColor: Theme.surface,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  untaggedSearchInput: {
    flex: 1,
    minWidth: 0,
    fontSize: 12,
    fontWeight: "500",
    color: Theme.textPrimary,
    paddingVertical: 8,
  },
  untaggedScroll: {
    flex: 1,
  },
  untaggedOverview: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    backgroundColor: Theme.cardWhite,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: Theme.surfaceBorder,
    paddingHorizontal: 16,
    paddingVertical: 16,
    shadowColor: Theme.textPrimaryDark,
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  untaggedOverviewCopy: {
    flex: 1,
    minWidth: 0,
  },
  untaggedOverviewLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: Theme.textRouteCard,
  },
  untaggedOverviewAmt: {
    marginTop: 4,
    fontSize: 30,
    fontWeight: "900",
    letterSpacing: -0.8,
    color: Theme.textPrimaryDark,
  },
  untaggedPill: {
    backgroundColor: Theme.warningMuted,
    borderWidth: 1,
    borderColor: Theme.driverGold,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  untaggedPillText: {
    fontSize: 10,
    fontWeight: "700",
    color: Theme.warning,
  },
  untaggedSection: {
    marginTop: 20,
    marginBottom: 10,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
    color: Theme.textMuted,
  },
  untaggedCard: {
    backgroundColor: Theme.cardWhite,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Theme.surfaceBorder,
    padding: 16,
    marginBottom: 12,
    shadowColor: Theme.textPrimaryDark,
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  untaggedCardOpen: {
    zIndex: 2,
  },
  untaggedCardRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  untaggedCardMain: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  untaggedDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 4,
    backgroundColor: Theme.feedbackModalStarActive,
  },
  untaggedCardCopy: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  untaggedTrip: {
    fontSize: 14,
    fontWeight: "700",
    color: Theme.textPrimary,
  },
  untaggedMoney: {
    fontSize: 11,
    fontWeight: "600",
  },
  untaggedReceived: {
    color: Theme.positive,
    fontWeight: "600",
  },
  untaggedDue: {
    color: Theme.negative,
    fontWeight: "700",
  },
  assignBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: Theme.surface,
    borderWidth: 1,
    borderColor: Theme.borderMedium,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minHeight: 34,
  },
  assignBtnPressed: {
    opacity: 0.82,
  },
  assignBtnText: {
    fontSize: 12,
    fontWeight: "600",
    color: Theme.textPrimary,
  },
  assignMenu: {
    marginTop: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Theme.borderMedium,
    backgroundColor: Theme.cardWhite,
    overflow: "hidden",
  },
  assignSearch: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.surfaceBorder,
    backgroundColor: Theme.surface,
  },
  assignSearchInput: {
    flex: 1,
    minWidth: 0,
    fontSize: 12,
    fontWeight: "500",
    color: Theme.textPrimary,
    paddingVertical: 8,
  },
  assignList: {
    maxHeight: 180,
  },
  assignOption: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 40,
    justifyContent: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.surfaceBorder,
  },
  assignOptionText: {
    fontSize: 13,
    fontWeight: "600",
    color: Theme.textPrimary,
  },
  assignEmpty: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 12,
    color: Theme.textMuted,
  },
  assignAdd: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 40,
    justifyContent: "center",
    backgroundColor: Theme.surface,
  },
  assignAddText: {
    fontSize: 12,
    fontWeight: "700",
    color: Theme.textPrimary,
  },
});
