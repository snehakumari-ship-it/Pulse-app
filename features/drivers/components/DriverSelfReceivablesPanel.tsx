/**
 * DCO Self — party-level receivables, same shape as Finance → Clients:
 * Marketplace (Exchange) + each shipper as a client receivable.
 */
import { EntityAvatar } from "@/components/EntityAvatar";
import {
    driverBodySecondary,
    driverUIBold,
    driverUISemiBold,
} from "@/constants/DriverTypography";
import Theme from "@/constants/Theme";
import {
    EMPTY_DRIVER_PARTY_AVATAR,
    resolveDriverPartyAvatarMap,
    type DriverPartyAvatarFields,
} from "@/features/drivers/utils/driverPartyAvatar.util";
import {
    MARKETPLACE_PARTY_ID,
    summarizeDriverPartyReceivables,
    UNTAGGED_PARTY_ID,
    type DriverPartyReceivable,
} from "@/features/drivers/utils/driverPartyReceivables.util";
import type { TripRow } from "@/features/trips/services/trips.service";
import { ROUTES } from "@/lib/routes";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";

function inr(n: number): string {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

type Colors = {
  text: string;
  textMuted: string;
  surface: string;
  border: string;
  emerald: string;
  borderSubtle?: string;
};

type Props = {
  rows: DriverPartyReceivable[];
  trips: TripRow[];
  receivedByTripId: Record<string, number>;
  isFleetDispatched: (trip: TripRow) => boolean;
  colors: Colors;
  isDark: boolean;
  /** Wallet callers may pass this; trip rollups match the 8081 Self view. */
  audience?: "dco" | "offline" | "indie";
  /** DCO settlements overview. Offline and other callers keep the table. */
  variant?: "table" | "overview";
};

export function DriverSelfReceivablesPanel({
  rows,
  trips,
  receivedByTripId,
  isFleetDispatched,
  colors,
  isDark,
  audience: _audience = "dco",
  variant = "table",
}: Props) {
  void _audience;
  const router = useRouter();
  const summary = useMemo(() => summarizeDriverPartyReceivables(rows), [rows]);
  const hairline = isDark ? colors.borderSubtle ?? colors.border : Theme.borderLight;
  const [avatarByPartyId, setAvatarByPartyId] = useState<
    Record<string, DriverPartyAvatarFields>
  >({});

  useEffect(() => {
    let cancelled = false;
    if (rows.length === 0) {
      setAvatarByPartyId({});
      return;
    }
    void resolveDriverPartyAvatarMap(rows, trips, receivedByTripId, isFleetDispatched).then(
      (map) => {
        if (!cancelled) setAvatarByPartyId(map);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [rows, trips, receivedByTripId, isFleetDispatched]);

  const openParty = (partyId: string) => router.push(ROUTES.driverPartyReceivable(partyId));

  if (variant === "overview") {
    const marketplace = rows.find((row) => row.id === MARKETPLACE_PARTY_ID) ?? null;
    const untagged = rows.find((row) => row.id === UNTAGGED_PARTY_ID) ?? null;
    const tagged = rows.filter(
      (row) => row.id !== MARKETPLACE_PARTY_ID && row.id !== UNTAGGED_PARTY_ID,
    );
    return (
      <View style={styles.wrap}>
        <View style={styles.summaryRow}>
          <LinearGradient
            colors={isDark ? [colors.surface, colors.surface] : [Theme.cardWhite, Theme.driverEmeraldWash]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.summaryCard, { borderColor: hairline }]}
          >
            <Text style={[styles.summaryLabel, { color: colors.textMuted }]}>Total outstanding</Text>
            <Text style={[styles.summaryOutstanding, { color: summary.due > 0 ? Theme.negative : colors.emerald }]}>
              {inr(summary.due)}
            </Text>
          </LinearGradient>
          <View style={[styles.collectionCard, { backgroundColor: colors.surface, borderColor: hairline }]}>
            <Text style={[styles.summaryLabel, { color: colors.textMuted }]}>Collection</Text>
            <Text style={[styles.collectionValue, { color: colors.emerald }]}>{summary.collectionPercent}%</Text>
            <Text style={[styles.collectionHint, { color: colors.textMuted }]}>
              {inr(summary.received)} of {inr(summary.billed)}
            </Text>
          </View>
        </View>

        <Text style={[styles.sectionTitle, { color: colors.text }]}>Transactions</Text>

        {rows.length === 0 ? (
          <View
            style={[
              styles.emptyTxnCard,
              {
                backgroundColor: colors.surface,
                borderColor: isDark ? colors.border : Theme.borderLight,
              },
            ]}
          >
            <View style={[styles.emptyTxnIcon, { backgroundColor: Theme.driverEmeraldMuted }]}>
              <FontAwesome name="arrow-down" size={14} color={colors.emerald} />
            </View>
            <Text style={[styles.emptyTxnTitle, { color: colors.text }]}>No receivables yet</Text>
          </View>
        ) : null}

        {marketplace ? (
          <TouchableOpacity
            style={[styles.marketCard, { borderColor: isDark ? colors.border : Theme.driverEmeraldBorderSoft }]}
            onPress={() => openParty(marketplace.id)}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={`${marketplace.name}, ${inr(marketplace.due)} outstanding`}
          >
            <EntityAvatar name={marketplace.name} initialsColorSeed={marketplace.id} entityType="supplier" isIntegrated size={32} showIntegrationBadge={false} />
            <Text style={[styles.categoryName, { color: colors.text, flex: 1 }]} numberOfLines={1}>{marketplace.name}</Text>
            <Text style={[styles.categoryDue, { color: marketplace.due > 0 ? Theme.negative : colors.emerald }]}>{inr(marketplace.due)}</Text>
            <FontAwesome name="chevron-down" size={12} color={colors.textMuted} />
          </TouchableOpacity>
        ) : null}

        {untagged ? (
          <View style={[styles.untaggedCard, { backgroundColor: colors.surface, borderColor: isDark ? colors.border : Theme.borderMedium }]}>
            <TouchableOpacity
              style={styles.untaggedTop}
              onPress={() => openParty(untagged.id)}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel={`${untagged.name}, ${inr(untagged.due)} outstanding`}
            >
              <View style={styles.untaggedBadge}>
                <FontAwesome name="briefcase" size={13} color={Theme.driverCtaFill} />
              </View>
              <View style={styles.untaggedCopy}>
                <Text style={[styles.categoryName, { color: colors.text }]}>{untagged.name}</Text>
                <Text style={[styles.untaggedHint, { color: colors.textMuted }]} numberOfLines={1}>
                  {untagged.subtitle}
                </Text>
              </View>
              <Text style={[styles.categoryDue, { color: untagged.due > 0 ? Theme.negative : colors.emerald }]}>{inr(untagged.due)}</Text>
              <FontAwesome name="chevron-down" size={12} color={colors.textMuted} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => openParty(untagged.id)}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Assign shipper"
              style={styles.assignLink}
            >
              <Text style={styles.assignLinkText}>Assign shipper</Text>
              <FontAwesome name="arrow-right" size={10} color={Theme.textPrimaryDark} />
            </TouchableOpacity>
          </View>
        ) : null}

        {tagged.length > 0 ? (
          <View style={[styles.taggedCard, { backgroundColor: colors.surface, borderColor: hairline }]}>
            <Text style={[styles.taggedLabel, { color: colors.textMuted }]}>Tagged shippers</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.avatarRow}>
              {tagged.map((row) => {
                const avatar = avatarByPartyId[row.id] ?? EMPTY_DRIVER_PARTY_AVATAR;
                return (
                  <TouchableOpacity
                    key={row.id}
                    style={styles.avatarItem}
                    onPress={() => openParty(row.id)}
                    activeOpacity={0.85}
                    accessibilityRole="button"
                    accessibilityLabel={`${row.name}, ${inr(row.due)} outstanding`}
                  >
                    <EntityAvatar
                      name={row.name}
                      initialsColorSeed={row.id}
                      avatarUrl={avatar.avatarUrl}
                      avatarSeed={avatar.avatarSeed}
                      organizationImageUrl={avatar.organizationImageUrl}
                      organizationAvatarSeed={avatar.organizationAvatarSeed}
                      entityType="client"
                      isIntegrated={avatar.isIntegrated}
                      size={40}
                      showIntegrationBadge={false}
                    />
                    <Text style={[styles.avatarName, { color: colors.text }]} numberOfLines={1}>{row.name}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Text style={[styles.title, { color: colors.text }]}>Receivables</Text>
      <Text style={[styles.sub, { color: colors.textMuted }]}>
        Marketplace Exchange and shipper (client) dues — same party view as Finance.
      </Text>

      <View style={styles.summaryRow}>
        <View
          style={[
            styles.summaryCard,
            { backgroundColor: colors.surface, borderColor: hairline },
          ]}
        >
          <Text style={[styles.summaryLabel, { color: colors.textMuted }]}>
            Total outstanding
          </Text>
          <Text
            style={[
              styles.summaryOutstanding,
              { color: summary.due > 0 ? Theme.negative : colors.emerald },
            ]}
          >
            {inr(summary.due)}
          </Text>
        </View>
        <View
          style={[
            styles.collectionCard,
            { backgroundColor: colors.surface, borderColor: hairline },
          ]}
        >
          <Text style={[styles.summaryLabel, { color: colors.textMuted }]}>
            Collection
          </Text>
          <Text style={[styles.collectionValue, { color: colors.emerald }]}>
            {summary.collectionPercent}%
          </Text>
          <Text style={[styles.collectionHint, { color: colors.textMuted }]}>
            {inr(summary.received)} of {inr(summary.billed)}
          </Text>
        </View>
      </View>

      <View style={[styles.headerRow, { borderBottomColor: hairline }]}>
        <Text style={[styles.headerCell, styles.headerParty, { color: colors.textMuted }]}>
          Party
        </Text>
        <Text style={[styles.headerCell, styles.headerTrips, { color: colors.textMuted }]}>
          Trips
        </Text>
        <Text style={[styles.headerCell, styles.headerAmt, { color: colors.textMuted }]}>
          Outstanding
        </Text>
      </View>

      {rows.length === 0 ? (
        <View style={styles.emptyCard}>
          <Image
            source={require("../../../assets/images/receivables-van-parcel.png")}
            style={styles.emptyArt}
            resizeMode="contain"
            accessibilityIgnoresInvertColors
          />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>
            No receivables yet
          </Text>
          <Text style={[styles.emptyBody, { color: colors.textMuted }]}>
            Marketplace awards and trips tagged to a Self party appear here with
            billed, received, and due.
          </Text>
        </View>
      ) : (
        <View
          style={[
            styles.table,
            { backgroundColor: colors.surface, borderColor: hairline },
          ]}
        >
          {rows.map((row, idx) => {
            const unpaid = row.due > 0;
            const isLast = idx === rows.length - 1;
            const avatar = avatarByPartyId[row.id] ?? EMPTY_DRIVER_PARTY_AVATAR;
            return (
              <TouchableOpacity
                key={row.id}
                style={[
                  styles.row,
                  !isLast && { borderBottomColor: hairline, borderBottomWidth: StyleSheet.hairlineWidth },
                ]}
                onPress={() => router.push(ROUTES.driverPartyReceivable(row.id))}
                activeOpacity={0.82}
                accessibilityRole="button"
                accessibilityLabel={`${row.name}, ${row.trips} trips, ${inr(row.due)} outstanding`}
              >
                <EntityAvatar
                  name={row.name}
                  initialsColorSeed={row.id}
                  avatarUrl={avatar.avatarUrl}
                  avatarSeed={avatar.avatarSeed}
                  organizationImageUrl={avatar.organizationImageUrl}
                  organizationAvatarSeed={avatar.organizationAvatarSeed}
                  entityType={row.kind === "marketplace" ? "supplier" : "client"}
                  isIntegrated={row.kind === "marketplace" ? true : avatar.isIntegrated}
                  size={36}
                  showIntegrationBadge={false}
                />
                <View style={styles.partyMid}>
                  <Text style={[styles.partyName, { color: colors.text }]} numberOfLines={1}>
                    {row.name}
                  </Text>
                  <Text style={[styles.partySub, { color: colors.textMuted }]} numberOfLines={1}>
                    {row.subtitle}
                    {" · "}
                    Sales {inr(row.billed)}
                  </Text>
                </View>
                <View style={styles.tripsPill}>
                  <Text style={[styles.tripsPillText, { color: colors.text }]}>{row.trips}</Text>
                </View>
                <View style={styles.amtCol}>
                  <Text
                    style={[
                      styles.dueValue,
                      { color: unpaid ? Theme.negative : colors.emerald },
                    ]}
                    numberOfLines={1}
                  >
                    {inr(row.due)}
                  </Text>
                  <Text style={[styles.receivedLine, { color: colors.textMuted }]} numberOfLines={1}>
                    Received {inr(row.received)}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

    </View>
  );
}

export { MARKETPLACE_PARTY_ID } from "@/features/drivers/utils/driverPartyReceivables.util";

const styles = StyleSheet.create({
  wrap: { gap: 10, marginBottom: 22 },
  title: {
    ...driverUIBold,
    fontSize: 12,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  sub: {
    ...driverBodySecondary,
    fontSize: 11,
    lineHeight: 15,
    marginTop: -4,
  },
  summaryRow: {
    flexDirection: "row",
    gap: 10,
  },
  summaryCard: {
    flex: 1.2,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 14,
    minHeight: 78,
    justifyContent: "center",
    overflow: "hidden",
    shadowColor: Theme.textPrimaryDark,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 2,
  },
  collectionCard: {
    flex: 1,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 14,
    minHeight: 78,
    justifyContent: "center",
  },
  summaryLabel: {
    ...driverUISemiBold,
    fontSize: 9,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  summaryOutstanding: {
    ...driverUIBold,
    fontSize: 20,
    letterSpacing: -0.4,
  },
  collectionValue: {
    ...driverUIBold,
    fontSize: 20,
    letterSpacing: -0.4,
  },
  collectionHint: {
    ...driverBodySecondary,
    fontSize: 10,
    marginTop: 2,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 4,
    paddingBottom: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerCell: {
    ...driverUISemiBold,
    fontSize: 9,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  headerParty: { flex: 1, minWidth: 0 },
  headerTrips: { width: 44, textAlign: "center" },
  headerAmt: { width: 92, textAlign: "right" },
  table: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    minHeight: 64,
  },
  partyMid: { flex: 1, minWidth: 0, gap: 2 },
  partyName: {
    ...driverUIBold,
    fontSize: 13,
  },
  partySub: {
    ...driverBodySecondary,
    fontSize: 10,
    lineHeight: 13,
  },
  tripsPill: {
    width: 36,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Theme.surfaceGray,
  },
  tripsPillText: {
    ...driverUIBold,
    fontSize: 11,
  },
  amtCol: {
    width: 92,
    alignItems: "flex-end",
    gap: 2,
  },
  dueValue: {
    ...driverUIBold,
    fontSize: 13,
    letterSpacing: -0.2,
  },
  receivedLine: {
    ...driverBodySecondary,
    fontSize: 10,
  },
  emptyCard: {
    alignItems: "center",
    gap: 8,
    paddingTop: 28,
    paddingHorizontal: 16,
  },
  emptyArt: {
    width: 168,
    height: 112,
    marginBottom: 4,
  },
  emptyIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTitle: {
    ...driverUIBold,
    fontSize: 16,
    letterSpacing: -0.2,
  },
  emptyBody: {
    ...driverBodySecondary,
    fontSize: 11,
    textAlign: "center",
    lineHeight: 15,
  },
  emptyTxnCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: 2,
    borderLeftColor: Theme.driverEmerald,
  },
  emptyTxnIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTxnTitle: {
    ...driverUIBold,
    flex: 1,
    fontSize: 12,
  },
  sectionTitle: {
    ...driverUIBold,
    fontSize: 14,
    marginTop: 6,
  },
  marketCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    backgroundColor: Theme.driverEmeraldMuted,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  untaggedCard: {
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 8,
    shadowColor: "#0f172a",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 1,
  },
  untaggedTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  untaggedBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Theme.driverEmeraldWash,
  },
  untaggedCopy: { flex: 1, minWidth: 0, gap: 1 },
  untaggedHint: {
    ...driverBodySecondary,
    fontSize: 11,
  },
  categoryName: {
    ...driverUIBold,
    fontSize: 14,
  },
  categoryDue: {
    ...driverUIBold,
    fontSize: 13,
  },
  assignLink: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 6,
    minHeight: 32,
  },
  assignLinkText: {
    ...driverUISemiBold,
    fontSize: 12,
    color: Theme.textPrimaryDark,
  },
  taggedCard: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 10,
    gap: 10,
  },
  taggedLabel: {
    ...driverUIBold,
    fontSize: 11,
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
  avatarRow: {
    gap: 12,
    paddingRight: 4,
  },
  avatarItem: {
    width: 64,
    alignItems: "center",
    gap: 4,
  },
  avatarName: {
    ...driverUISemiBold,
    fontSize: 10,
    textAlign: "center",
  },
});
