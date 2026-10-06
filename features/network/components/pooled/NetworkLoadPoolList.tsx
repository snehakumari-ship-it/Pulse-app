/**
 * Get Load → Network Loads on the phone list: partner loads grouped into
 * canonical Indent Pools (pickup + drop + vehicle). One rate per pool; an
 * opened pool lists its indents for review only. A load without a complete
 * lane cannot be pooled and is review-only too: no normal Network indent is
 * individually biddable.
 *
 * Pools are built from every open Network load, not the searched subset, so
 * "Quote for pool" always covers the whole pool. Search only decides which
 * pools are shown.
 */
import Theme from "@/constants/Theme";
import { IncompleteLaneNotice } from "@/features/network/components/pooled/IncompleteLaneNotice";
import { NetworkLoadPoolCard } from "@/features/network/components/pooled/NetworkLoadPoolCard";
import {
  buildNetworkLoadPools,
  type NetworkLoadPool,
} from "@/features/network/utils/networkLoadPools.util";
import type { IndentRow } from "@/features/indents/services/indents.service";
import { ChevronLeft } from "lucide-react-native";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

export function NetworkLoadPoolList({
  openLoads,
  shownLoads,
  canQuote,
  onQuotePool,
  renderPoolMemberCard,
  onViewIndents,
}: {
  openLoads: readonly IndentRow[];
  shownLoads: readonly IndentRow[];
  canQuote: boolean;
  onQuotePool: (pool: NetworkLoadPool<IndentRow>) => void;
  /** Review-only card: pool members, and loads that cannot form a pool. */
  renderPoolMemberCard: (load: IndentRow) => ReactNode;
  /** Opens the pool elsewhere (desktop column view) instead of inline. */
  onViewIndents?: (pool: NetworkLoadPool<IndentRow>) => void;
}) {
  const [openPoolId, setOpenPoolId] = useState<string | null>(null);

  const { pools, unpooled } = useMemo(
    () => buildNetworkLoadPools([...openLoads]),
    [openLoads],
  );
  const shownIds = useMemo(
    () => new Set(shownLoads.map((l) => l.id)),
    [shownLoads],
  );
  const shownPools = useMemo(
    () => pools.filter((p) => p.members.some((m) => shownIds.has(m.id))),
    [pools, shownIds],
  );
  const shownUnpooled = useMemo(
    () => unpooled.filter((l) => shownIds.has(l.id)),
    [unpooled, shownIds],
  );
  const openPool = openPoolId
    ? (pools.find((p) => p.id === openPoolId) ?? null)
    : null;

  useEffect(() => {
    if (openPoolId && !openPool) setOpenPoolId(null);
  }, [openPoolId, openPool]);

  if (openPool) {
    return (
      <View style={styles.wrap}>
        <Pressable
          onPress={() => setOpenPoolId(null)}
          style={styles.back}
          accessibilityRole="button"
          accessibilityLabel="Back to all pools"
          hitSlop={8}
        >
          <ChevronLeft size={14} color={Theme.primary} strokeWidth={2.4} />
          <Text style={styles.backText}>All pools</Text>
        </Pressable>
        <NetworkLoadPoolCard
          pool={openPool}
          canQuote={canQuote}
          showIndentsAction={false}
          onQuote={() => onQuotePool(openPool)}
        />
        <Text style={styles.sectionTitle}>Indents in this pool</Text>
        {openPool.members.map((load) => (
          <View key={load.id}>{renderPoolMemberCard(load)}</View>
        ))}
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.summary}>
        {shownPools.length} pool{shownPools.length === 1 ? "" : "s"} · one quote
        per pool
      </Text>
      {shownPools.map((pool) => (
        <NetworkLoadPoolCard
          key={pool.id}
          pool={pool}
          canQuote={canQuote}
          onQuote={() => onQuotePool(pool)}
          onViewIndents={() =>
            onViewIndents ? onViewIndents(pool) : setOpenPoolId(pool.id)
          }
        />
      ))}
      {shownUnpooled.length > 0 ? (
        <>
          <IncompleteLaneNotice />
          {shownUnpooled.map((load) => (
            <View key={load.id}>{renderPoolMemberCard(load)}</View>
          ))}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  summary: {
    fontSize: 12,
    fontWeight: "700",
    color: Theme.textSecondary,
  },
  back: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    minHeight: 44,
  },
  backText: { fontSize: 13, fontWeight: "700", color: Theme.primary },
  sectionTitle: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    color: Theme.textMuted,
    marginTop: 8,
  },
});
