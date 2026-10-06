/**
 * One pooled Marketplace opportunity in the Find Loads list: a live lane and
 * its open load count. Deliberately no per-load detail or bid status — bids
 * carry no lane identity, so status is only attributed on the pool detail
 * screen, by indent.
 */
import Theme from "@/constants/Theme";
import {
  MarketplaceRouteGrid,
  MarketplaceSpecChips,
  titleCaseWord,
} from "@/features/network/components/MarketplaceLoadCardChrome";
import { PoolStatusPill } from "@/features/network/components/pooled/PoolStatusPill";
import type { PoolLane } from "@/features/network/utils/pooledOpportunity.util";
import { ChevronRight, Layers } from "lucide-react-native";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

export function PooledOpportunityCard({
  lane,
  fitsFleet,
  isDesktop = false,
  onPress,
}: {
  lane: PoolLane;
  fitsFleet: boolean;
  isDesktop?: boolean;
  onPress: () => void;
}) {
  const vehicle = titleCaseWord(lane.vehicle_type);
  const loadCount = Number(lane.load_count) || 0;
  const loadsLabel = `${loadCount} load${loadCount === 1 ? "" : "s"}`;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        isDesktop && styles.cardDesktop,
        pressed && styles.cardPressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={`Pooled opportunity, ${lane.pickup_area} to ${lane.drop_location}, ${vehicle}, ${loadsLabel}`}
    >
      <View style={styles.top}>
        <View style={styles.poolTag}>
          <Layers size={12} color={Theme.primary} strokeWidth={2.4} />
          <Text style={styles.poolTagText}>
            POOLED · {loadsLabel.toUpperCase()}
          </Text>
        </View>
        <View style={styles.badges}>
          {fitsFleet ? (
            <View style={styles.fitBadge}>
              <Text style={styles.fitBadgeText}>Fleet fit</Text>
            </View>
          ) : null}
          <PoolStatusPill state={loadCount > 0 ? "open" : "closed"} />
        </View>
      </View>

      <MarketplaceRouteGrid
        pickup={lane.pickup_area}
        drop={lane.drop_location}
      />
      <MarketplaceSpecChips chips={[vehicle].filter(Boolean)} />

      <View style={styles.footer}>
        <View style={styles.footerText}>
          <Text style={styles.footerLabel}>One rate for the pool</Text>
          <Text style={styles.footerValue} numberOfLines={1}>
            {loadsLabel} open for bids
          </Text>
        </View>
        <View style={styles.cta}>
          <Text style={styles.ctaText}>View pool</Text>
          <ChevronRight
            size={13}
            color={Theme.buttonPrimaryText}
            strokeWidth={2.4}
          />
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Theme.surfaceBorder,
    padding: 16,
    backgroundColor: Theme.cardWhite,
    marginBottom: 12,
    gap: 12,
    overflow: "hidden",
    ...Platform.select({
      web: { boxShadow: `0 8px 20px ${Theme.actionAccentShadow}` } as object,
      default: {
        shadowColor: Theme.primaryText,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.06,
        shadowRadius: 8,
        elevation: 2,
      },
    }),
  },
  cardDesktop: {
    width: "calc((100% - 32px) / 3)" as unknown as number,
    maxWidth: "calc((100% - 32px) / 3)" as unknown as number,
    minWidth: 0,
    flexGrow: 0,
    flexShrink: 0,
    marginBottom: 0,
  },
  cardPressed: { opacity: 0.92 },
  top: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  poolTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    minWidth: 0,
    flexShrink: 1,
  },
  poolTagText: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.6,
    color: Theme.primary,
  },
  badges: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 0 },
  fitBadge: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: Theme.positiveMuted,
  },
  fitBadgeText: {
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 0.3,
    textTransform: "uppercase",
    color: Theme.positive,
  },
  footer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    gap: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Theme.surfaceBorder,
  },
  footerText: { flex: 1, minWidth: 0, gap: 2 },
  footerLabel: {
    fontSize: 9,
    fontWeight: "600",
    letterSpacing: 0.45,
    textTransform: "uppercase",
    color: Theme.textMuted,
  },
  footerValue: {
    fontSize: 13,
    fontWeight: "700",
    color: Theme.textPrimaryDark,
  },
  cta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingHorizontal: 12,
    paddingVertical: 7,
    minHeight: 32,
    borderRadius: 999,
    backgroundColor: Theme.buttonPrimary,
    borderWidth: Theme.buttonPrimaryBorderWidth,
    borderColor: Theme.buttonPrimaryBorder,
  },
  ctaText: { fontSize: 12, fontWeight: "700", color: Theme.buttonPrimaryText },
});
