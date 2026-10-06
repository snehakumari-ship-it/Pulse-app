/**
 * Pooled Marketplace opportunity detail: one live lane as an anonymous
 * requirement, one rate for every eligible load, and the identity / award →
 * trip handoff. Reads only the existing Find Loads RPCs (lanes, lane loads,
 * this org's bids) under the same query keys as the Find Loads list. Load
 * rows are read page by page automatically to define the bid scope and are
 * never listed: no indent ids, shipper names or per-load details are shown.
 */
import { ChromeBelowTopNavLoadingScreen } from "@/components/chromeLoadingScreens";
import Layout from "@/constants/Layout";
import Theme from "@/constants/Theme";
import { useOptionalOrganization } from "@/contexts/OrganizationContext";
import { MarketLoadBidSheet } from "@/features/driver/components/MarketLoadBidSheet";
import { isVehicleTypeCompatibleWithFleet } from "@/features/marketplace/utils/fleetFit.util";
import { formatMarketplaceTransactionError } from "@/features/marketplace/utils/marketplaceErrorFormat.util";
import {
  MarketplaceRouteGrid,
  titleCaseWord,
} from "@/features/network/components/MarketplaceLoadCardChrome";
import {
  PoolBidPanel,
  plural,
} from "@/features/network/components/pooled/PoolBidPanel";
import { PoolHandoffPanel } from "@/features/network/components/pooled/PoolHandoffPanel";
import { PoolStatusPill } from "@/features/network/components/pooled/PoolStatusPill";
import {
  composeFindLoadsOpportunity,
  listMarketplaceSearchLanes,
  listMyOrgMarketBids,
  listOpenMarketplaceLoadsPage,
  marketBidsFromQueryData,
  submitOrgPoolBid,
  type OrgOpenMarketplaceLoad,
} from "@/features/network/services/findLoadsForOrg.service";
import { MARKETPLACE_LOAD_PAGE_SIZE } from "@/features/network/utils/marketplaceLoadsPage.util";
import { isMarketplaceSearchReady } from "@/features/network/utils/marketplaceSearch.util";
import {
  POOL_STATE_COPY,
  findPoolLane,
  poolBidReadiness,
  poolFetchProgress,
  readCompletePool,
  poolKey,
  poolKeyId,
  poolSubmissionBlockReason,
  summarizePool,
  type PoolBidSubmissionResult,
} from "@/features/network/utils/pooledOpportunity.util";
import { formatStoryDate } from "@/features/network/utils/storyDisplay";
import { getVehiclesByOrganization } from "@/features/vehicles/services/vehicles.service";
import { formatINR } from "@/lib/format";
import { useLayoutInsets } from "@/lib/layoutInsets";
import { STALE } from "@/lib/queryClient";
import { queryKeys } from "@/lib/queryKeys";
import { ROUTES } from "@/lib/routes";
import { useMemberAccess } from "@/lib/useMemberAccess";
import {
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { ArrowLeft, Layers } from "lucide-react-native";
import { useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

const TWO_COLUMN_MIN_WIDTH = 900;
/** list_my_org_market_bids caps p_limit at 100. */
const POOL_BIDS_LIMIT = 100;

function paramString(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function dateRangeLabel(
  earliest: string | null,
  latest: string | null,
): string | null {
  if (!earliest) return null;
  const a = formatStoryDate(earliest);
  if (!latest || latest === earliest) return a;
  const b = formatStoryDate(latest);
  return a === b ? a : `${a} – ${b}`;
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

export function PooledOpportunityScreen() {
  const layout = useLayoutInsets();
  const { width } = useWindowDimensions();
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{
    pickup?: string;
    drop?: string;
    vehicle?: string;
  }>();
  const key = useMemo(
    () =>
      poolKey({
        pickup: paramString(params.pickup),
        drop: paramString(params.drop),
        vehicleType: paramString(params.vehicle),
      }),
    [params.pickup, params.drop, params.vehicle],
  );
  const keyReady = isMarketplaceSearchReady(key);
  const searchKey = keyReady ? `pool:${poolKeyId(key)}` : "";

  const orgCtx = useOptionalOrganization();
  const organization = orgCtx?.currentOrganization ?? null;
  const orgLoading = orgCtx?.isLoading ?? orgCtx == null;
  const { can: canSurface, isLoading: accessLoading } = useMemberAccess();
  const canViewFindLoads = canSurface("tripops.pulse_loads");
  const orgId = canViewFindLoads ? (organization?.id ?? null) : null;
  const viewerCanBidCapability =
    (organization?.capabilities?.canBid ?? true) &&
    canSurface("sales.marketplace.bid");

  const [priorMemberIds, setPriorMemberIds] = useState<Set<string>>(
    () => new Set(),
  );
  /** Snapshot of the whole eligible pool taken when the rate sheet opens. */
  const [bidTargets, setBidTargets] = useState<string[] | null>(null);
  const [bidError, setBidError] = useState<string | undefined>();
  const [result, setResult] = useState<PoolBidSubmissionResult | null>(null);

  const loadsQ = useQuery({
    queryKey: [
      ...queryKeys.findLoadsForOrg.infinite(
        orgId ?? "",
        MARKETPLACE_LOAD_PAGE_SIZE,
        searchKey,
      ),
      "complete",
    ],
    queryFn: () =>
      readCompletePool(async (offset) => {
        const { error, loads, nextOffset } = await listOpenMarketplaceLoadsPage(
          orgId as string,
          offset,
          MARKETPLACE_LOAD_PAGE_SIZE,
          key,
        );
        if (error) throw error;
        return { loads, nextOffset };
      }),
    enabled: !!orgId && keyReady,
    staleTime: STALE.frequent,
  });
  const loadsError = loadsQ.isError;
  const rows = useMemo(() => loadsQ.data?.rows ?? [], [loadsQ.data]);
  const fetchProgress = useMemo(
    () => loadsQ.data?.progress ?? poolFetchProgress([]),
    [loadsQ.data],
  );

  const lanesQ = useQuery({
    queryKey: queryKeys.findLoadsForOrg.searchLanes(orgId ?? ""),
    queryFn: async () => {
      const { error, lanes } = await listMarketplaceSearchLanes(
        orgId as string,
      );
      if (error && lanes.length === 0) throw error;
      return lanes;
    },
    enabled: !!orgId,
    staleTime: STALE.moderate,
  });
  const myBidsQ = useQuery({
    queryKey: [
      ...queryKeys.findLoadsForOrg.myBids(orgId ?? ""),
      "pool",
      POOL_BIDS_LIMIT,
    ],
    queryFn: () => listMyOrgMarketBids(orgId as string, POOL_BIDS_LIMIT),
    enabled: !!orgId,
  });
  const vehiclesQ = useQuery({
    queryKey: queryKeys.vehicles.all(orgId ?? ""),
    queryFn: () => getVehiclesByOrganization(orgId as string),
    enabled: !!orgId,
  });

  const lanes = useMemo(() => lanesQ.data ?? [], [lanesQ.data]);
  const myBids = marketBidsFromQueryData(myBidsQ.data);
  const lane = lanesQ.isSuccess ? findPoolLane(lanes, key) : null;
  const fitsFleet = isVehicleTypeCompatibleWithFleet(
    key.vehicleType,
    (vehiclesQ.data?.vehicles ?? []).map((v) => v.vehicle_type),
  );

  const summary = useMemo(
    () =>
      summarizePool({
        key,
        rows,
        bids: myBids,
        laneLoadCount: lane ? lane.load_count : null,
        priorMemberIds,
        canBidLoad: (load: OrgOpenMarketplaceLoad) =>
          composeFindLoadsOpportunity(load, orgId, viewerCanBidCapability)
            .bidding.canBid,
      }),
    [key, rows, myBids, lane, priorMemberIds, orgId, viewerCanBidCapability],
  );
  const members = summary.members;
  const eligibleCount = summary.biddableIds.length;
  const readiness = poolBidReadiness({ fetch: fetchProgress, eligibleCount });
  const preparing =
    !loadsError && !fetchProgress.complete && !fetchProgress.truncated;

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace(ROUTES.FIND_LOADS as Href);
  };

  const refreshAfterBid = () => {
    if (!orgId) return;
    queryClient.invalidateQueries({
      queryKey: queryKeys.findLoadsForOrg.myBids(orgId),
    });
    queryClient.invalidateQueries({
      queryKey: queryKeys.findLoadsForOrg.infinite(
        orgId,
        MARKETPLACE_LOAD_PAGE_SIZE,
        searchKey,
      ),
    });
  };

  /** Returns true only when every eligible load took the rate; anything less never celebrates. */
  const submitPoolRate = async (amount: number): Promise<boolean> => {
    if (!orgId || !bidTargets) return false;
    if (!readiness.ready) {
      setBidError(readiness.blocked ?? "This pool is still being prepared.");
      return false;
    }
    const blocked = poolSubmissionBlockReason(bidTargets, summary.memberIds);
    if (blocked) {
      setBidError(blocked);
      return false;
    }
    const outcome = await submitOrgPoolBid(
      orgId,
      { indentIds: bidTargets, memberIds: summary.memberIds },
      amount,
    );
    setResult(outcome);
    if (outcome.blocked) {
      setBidError(outcome.blocked);
      return false;
    }
    if (outcome.succeeded.length > 0) {
      setPriorMemberIds((prev) => new Set([...prev, ...outcome.succeeded]));
    }
    if (outcome.succeeded.length === 0) {
      setBidError(
        `None of the ${outcome.attempted} loads took your rate. ${formatMarketplaceTransactionError(
          outcome.failed[0]?.message ?? "",
        )}`,
      );
      return false;
    }
    if (outcome.failed.length > 0) {
      setBidTargets(null);
      setBidError(undefined);
      refreshAfterBid();
      return false;
    }
    return true;
  };

  const contentTopInset = layout.isDesktopWeb
    ? Layout.desktopTopNavOffset
    : layout.top;

  if (accessLoading)
    return <ChromeBelowTopNavLoadingScreen variant="preparing" />;
  if (!canViewFindLoads) {
    return (
      <View style={[styles.centered, { paddingTop: contentTopInset }]}>
        <Text style={styles.message}>
          You don't have access to Marketplace Loads.
        </Text>
      </View>
    );
  }
  if (!orgId) {
    return (
      <ChromeBelowTopNavLoadingScreen
        variant={orgLoading ? "preparing" : "generic"}
      />
    );
  }

  const twoColumn = !!layout.isDesktopWeb && width >= TWO_COLUMN_MIN_WIDTH;
  /** Lane count while reading; once every row is read, the members actually found. */
  const poolCount = fetchProgress.complete
    ? members.length
    : (summary.poolSize ?? members.length);
  const countLabel = plural(poolCount, "load");
  const vehicleLabel = titleCaseWord(key.vehicleType);
  const targetCount = bidTargets?.length ?? 0;
  const targetsLabel = plural(targetCount, "eligible load");
  const bidsSaturated = myBids.length >= POOL_BIDS_LIMIT;
  const dates = dateRangeLabel(summary.earliestPickup, summary.latestPickup);

  const header = (
    <View style={styles.header}>
      <View style={styles.headerTop}>
        <Pressable
          onPress={handleBack}
          style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Back to Marketplace Loads"
          hitSlop={Layout.touchTargetHitSlop}
        >
          <ArrowLeft
            size={18}
            color={Theme.textPrimaryDark}
            strokeWidth={2.2}
          />
        </Pressable>
        <View style={styles.headerEyebrow}>
          <Layers size={13} color={Theme.primary} strokeWidth={2.4} />
          <Text style={styles.eyebrow}>POOLED OPPORTUNITY</Text>
        </View>
        <PoolStatusPill state={summary.state} label={summary.stateLabel} />
      </View>
      <Text style={styles.title} numberOfLines={2}>
        {keyReady ? `${key.pickup} → ${key.drop}` : "Pooled opportunity"}
      </Text>
      <Text style={styles.subtitle} numberOfLines={2}>
        {vehicleLabel} · {countLabel} · one rate for the pool
      </Text>
      <Text style={styles.stateDetail}>
        {POOL_STATE_COPY[summary.state].detail}
      </Text>
    </View>
  );

  const summaryCard = (
    <View style={styles.card} testID="pool-requirement">
      <Text style={styles.cardEyebrow}>
        {countLabel.toUpperCase()} IN THIS POOL
      </Text>
      <MarketplaceRouteGrid
        pickup={key.pickup}
        drop={key.drop}
        dropLabel="Destination"
      />
      <View style={styles.facts}>
        <Fact label="Vehicle" value={vehicleLabel || "—"} />
        <Fact label="Loads in pool" value={String(poolCount)} />
        <Fact label="Pickup window" value={dates ?? "Not listed"} />
        <Fact
          label="Material"
          value={
            summary.loadTypes.length > 0
              ? summary.loadTypes.map(titleCaseWord).join(", ")
              : "Not listed"
          }
        />
        <Fact
          label="Shippers"
          value={
            summary.shipperCount > 0
              ? `${summary.shipperCount} · identity hidden`
              : "Identity hidden"
          }
        />
      </View>
    </View>
  );

  const bidPanel = (
    <View style={styles.stack}>
      <PoolBidPanel
        state={summary.state}
        eligibleCount={eligibleCount}
        preparing={preparing}
        blockedReason={readiness.blocked}
        targetRateMin={summary.targetRateMin}
        targetRateMax={summary.targetRateMax}
        canBidCapability={viewerCanBidCapability}
        fitsFleet={fitsFleet}
        result={result}
        onBid={() => {
          if (!readiness.ready) return;
          setBidError(undefined);
          setResult(null);
          setBidTargets([...summary.biddableIds]);
        }}
      />
      {bidsSaturated ? (
        <Text style={styles.footnote}>
          Bid status here reflects your organization's latest {POOL_BIDS_LIMIT}{" "}
          Marketplace bids. Older bids on these loads may not show.
        </Text>
      ) : null}
    </View>
  );

  const handoff = (
    <PoolHandoffPanel
      awardedBids={summary.awardedBids}
      onOpenAwarded={() => router.push(ROUTES.FIND_LOADS_MY_BIDS as Href)}
    />
  );

  const loadsBody = !keyReady ? (
    <Text style={styles.message}>
      This pool link is incomplete. Go back and pick a pool.
    </Text>
  ) : loadsQ.isError ? (
    <View style={styles.stateBox}>
      <Text style={styles.message}>Couldn't load this pool.</Text>
      <Pressable
        onPress={() => loadsQ.refetch()}
        style={({ pressed }) => [styles.retryBtn, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel="Retry"
      >
        <Text style={styles.retryBtnText}>Retry</Text>
      </Pressable>
    </View>
  ) : preparing ? (
    <Text style={styles.message} testID="pool-preparing">
      {poolCount > 0 ? `Preparing ${countLabel}…` : "Preparing pool…"}
    </Text>
  ) : fetchProgress.complete && members.length === 0 ? (
    <Text style={styles.message}>
      No loads in this pool are open right now.
    </Text>
  ) : null;
  const showCommercial = keyReady && !loadsQ.isError;

  return (
    <View style={[styles.root, { paddingTop: contentTopInset }]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          layout.isDesktopWeb && styles.contentDesktop,
          { paddingBottom: layout.bottom + 32 },
        ]}
      >
        {header}
        {twoColumn ? (
          <View style={styles.columns}>
            <View style={styles.mainCol}>
              {summaryCard}
              {loadsBody}
            </View>
            <View style={styles.sideCol}>
              {showCommercial ? bidPanel : null}
              {handoff}
            </View>
          </View>
        ) : (
          <View style={styles.stack}>
            {summaryCard}
            {showCommercial ? bidPanel : null}
            {handoff}
            {loadsBody}
          </View>
        )}
      </ScrollView>

      <MarketLoadBidSheet
        visible={bidTargets != null}
        onClose={() => {
          setBidTargets(null);
          setBidError(undefined);
        }}
        onSubmitAmount={submitPoolRate}
        onSuccessDone={refreshAfterBid}
        shipperName={`Pooled opportunity · ${countLabel}`}
        pickup={key.pickup}
        drop={key.drop}
        vehicleType={key.vehicleType}
        targetRateInr={summary.targetRateMin}
        entryLabel="Your rate for this pooled opportunity"
        contextLine={`Applies to all ${targetsLabel} in this pool`}
        submitLabel="Submit rate for pool"
        confirmCopy={{
          scopeNote: `Your rate will be submitted for all ${targetsLabel} in this pool. The shipper reviews bids; nothing is awarded until the shipper accepts.`,
          feeNote: (fee) =>
            `The Marketplace fee is per awarded load: you pay Pulse ${formatINR(fee)} for each load the shipper awards you at this rate.`,
          successTitle: "Rate submitted for pool",
          successSubtitle: `Your rate has been submitted for all ${plural(targetCount, "load")}.`,
        }}
        validationError={bidError}
        onClearValidationError={() => setBidError(undefined)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Theme.analyticsCanvas },
  scroll: { flex: 1, width: "100%" },
  content: { paddingHorizontal: 16, paddingTop: 12, gap: 16 },
  contentDesktop: { paddingHorizontal: 32, paddingTop: 20 },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  header: { gap: 4 },
  headerTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 6,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Theme.borderInput,
    backgroundColor: Theme.cardWhite,
    alignItems: "center",
    justifyContent: "center",
  },
  headerEyebrow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    flex: 1,
    minWidth: 0,
  },
  eyebrow: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.1,
    color: Theme.primary,
  },
  title: {
    fontSize: 24,
    fontWeight: "800",
    color: Theme.textPrimaryDark,
    letterSpacing: -0.5,
    lineHeight: 30,
  },
  subtitle: { fontSize: 13, fontWeight: "600", color: Theme.textSecondary },
  stateDetail: { fontSize: 12, color: Theme.textMuted },
  footnote: {
    fontSize: 12,
    color: Theme.textMuted,
    lineHeight: 16,
    paddingHorizontal: 4,
  },
  columns: { flexDirection: "row", alignItems: "flex-start", gap: 20 },
  mainCol: { flex: 1, minWidth: 0, gap: 16 },
  sideCol: { width: 360, flexShrink: 0, gap: 16 },
  stack: { gap: 16 },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Theme.surfaceBorder,
    backgroundColor: Theme.cardWhite,
    padding: 16,
    gap: 14,
  },
  cardEyebrow: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.1,
    color: Theme.textMuted,
  },
  facts: { flexDirection: "row", flexWrap: "wrap", rowGap: 12, columnGap: 16 },
  fact: { minWidth: 120, flexGrow: 1, flexBasis: "40%", gap: 2 },
  factLabel: {
    fontSize: 9,
    fontWeight: "600",
    letterSpacing: 0.45,
    textTransform: "uppercase",
    color: Theme.textMuted,
  },
  factValue: { fontSize: 13, fontWeight: "700", color: Theme.textPrimaryDark },
  stateBox: { alignItems: "center", gap: 12, paddingVertical: 24 },
  message: {
    fontSize: 15,
    color: Theme.textSecondary,
    textAlign: "center",
    paddingVertical: 16,
  },
  retryBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    minHeight: Layout.minTouchTargetSize,
    justifyContent: "center",
    borderRadius: 10,
    backgroundColor: Theme.buttonPrimary,
  },
  retryBtnText: {
    fontSize: 14,
    fontWeight: "700",
    color: Theme.buttonPrimaryText,
  },
  pressed: { opacity: 0.85 },
});
