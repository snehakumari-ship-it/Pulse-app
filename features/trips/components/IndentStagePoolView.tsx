/**
 * Indent stage: [Card View] [Indent Pool] toggle and the Network projection
 * of one pool (pickup + drop + vehicle) of the shipper's own indents, with
 * full indent identity. Marketplace shows the same pool anonymously in its
 * own components; nothing here is reused there. Pool membership and
 * selection rules live in shipperPoolIndents.util; award, vehicle and driver
 * stay on each indent's existing Review flow.
 */
import Layout from "@/constants/Layout";
import Theme from "@/constants/Theme";
import {
  getIndentDisplayNumber,
  type IndentRow,
} from "@/features/indents/services/indents.service";
import { titleCaseWord } from "@/features/network/components/MarketplaceLoadCardChrome";
import { MarketplaceLaneFilters } from "@/features/network/components/MarketplaceLaneFilters";
import type {
  ShipperIndentStageView,
  useShipperPoolIndentView,
} from "@/features/network/hooks/useShipperPoolIndentView";
import type { IndentBidSnapshot } from "@/features/network/services/bids.service";
import type { MarketplaceLoadSearch } from "@/features/network/utils/marketplaceSearch.util";
import type { PoolLane } from "@/features/network/utils/pooledOpportunity.util";
import {
  shipperPoolSummaryRows,
  type ShipperPoolModel,
  type ShipperPoolSummaryRow,
} from "@/features/network/utils/shipperPoolIndents.util";
import { formatStoryDate, formatStoryDateTime } from "@/features/network/utils/storyDisplay";
import {
  indentHasAwardRevokedTag,
  indentHubLifecycleStatus,
  indentHubLoadSpecLine,
  indentHubSourceTags,
} from "@/features/trips/utils/indentHubCardPresentation";
import { formatINR } from "@/lib/format";
import { ArrowRight, Check, ChevronRight, Layers } from "lucide-react-native";
import { useMemo, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

const QUICK_POOL_LIMIT = 6;
const NO_SNAPSHOTS: Record<string, IndentBidSnapshot> = {};

export function IndentStageViewToggle({
  value,
  onChange,
}: {
  value: ShipperIndentStageView;
  onChange: (next: ShipperIndentStageView) => void;
}) {
  const options: { id: ShipperIndentStageView; label: string }[] = [
    { id: "cards", label: "Card View" },
    { id: "indents", label: "Indent Pool" },
  ];
  return (
    <View style={styles.toggle} accessibilityRole="tablist">
      {options.map((o) => {
        const on = value === o.id;
        return (
          <Pressable
            key={o.id}
            onPress={() => onChange(o.id)}
            style={[styles.toggleOption, on && styles.toggleOptionOn]}
            hitSlop={Layout.touchTargetHitSlop}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={o.label}
          >
            <Text style={[styles.toggleText, on && styles.toggleTextOn]}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * Indent stage body. Card View (the existing cards) is the default; the
 * toggle needs `tripops.indents.view`, row selection `tripops.indents.allocate`.
 */
export function IndentStageViews({
  state,
  canView,
  canSelect,
  bidCountById,
  bidSnapshotById = NO_SNAPSHOTS,
  listCapped,
  compact,
  onOpenIndent,
  cards,
}: {
  state: ReturnType<typeof useShipperPoolIndentView<IndentRow>>;
  canView: boolean;
  canSelect: boolean;
  bidCountById: Record<string, number>;
  /** Lowest and latest pending bid per indent, when loaded. */
  bidSnapshotById?: Record<string, IndentBidSnapshot>;
  listCapped: boolean;
  compact: boolean;
  onOpenIndent: (indent: IndentRow) => void;
  cards: ReactNode;
}) {
  const showIndents = canView && state.view === "indents";
  return (
    <>
      {canView ? (
        <IndentStageViewToggle value={state.view} onChange={state.setView} />
      ) : null}
      {showIndents ? (
        <IndentStagePoolView
          lanes={state.lanes}
          poolIndents={state.poolIndents}
          allocatedIndents={state.allocatedIndents}
          poolSearch={state.poolSearch}
          onPoolSearchChange={state.setPoolSearch}
          model={state.model}
          canSelect={canSelect}
          bidCountById={bidCountById}
          bidSnapshotById={bidSnapshotById}
          listCapped={listCapped}
          compact={compact}
          onToggle={state.toggle}
          onSelectAllShown={state.selectAllShown}
          onClear={state.clearSelection}
          onShowMore={state.showMore}
          onOpenIndent={onOpenIndent}
        />
      ) : (
        cards
      )}
    </>
  );
}

type Props = {
  lanes: PoolLane[];
  /** Every loaded unallocated indent — the pool universe. */
  poolIndents?: readonly IndentRow[];
  allocatedIndents?: readonly {
    id: string;
    pickup_area: string | null;
    drop_location: string | null;
    vehicle_type: string | null;
  }[];
  poolSearch: MarketplaceLoadSearch | null;
  onPoolSearchChange: (next: MarketplaceLoadSearch) => void;
  model: ShipperPoolModel<IndentRow>;
  canSelect: boolean;
  bidCountById: Record<string, number>;
  bidSnapshotById?: Record<string, IndentBidSnapshot>;
  /** The indent list hit the finite fetch cap, so a pool may be incomplete. */
  listCapped: boolean;
  compact: boolean;
  onToggle: (indentId: string) => void;
  onSelectAllShown: () => void;
  onClear: () => void;
  onShowMore: () => void;
  onOpenIndent: (indent: IndentRow) => void;
};

function laneTitle(lane: { pickup_area: string; drop_location: string }) {
  return `${titleCaseWord(lane.pickup_area)} → ${titleCaseWord(lane.drop_location)}`;
}

/** "Bengaluru, Bangalore" → city "Bengaluru", region "Bangalore". */
function splitPlace(raw: string): { city: string; region: string | null } {
  const [city, ...rest] = raw.split(",");
  const region = rest.join(",").trim();
  return { city: titleCaseWord((city ?? "").trim()), region: region ? titleCaseWord(region) : null };
}

/** City-only route plus the regions, for one-line rows. */
function compactLane(lane: { pickup_area: string | null; drop_location: string | null }) {
  const from = splitPlace(lane.pickup_area ?? "");
  const to = splitPlace(lane.drop_location ?? "");
  const regions =
    from.region || to.region
      ? `${from.region ?? from.city} → ${to.region ?? to.city}`
      : null;
  return { route: `${from.city} → ${to.city}`, regions };
}

type Lifecycle = "waiting" | "bids" | "awarded";

function lifecycleOf(indent: IndentRow, bids: number): Lifecycle {
  const life = indentHubLifecycleStatus(indent.status, bids);
  if (life === "AWARDED") return "awarded";
  if (life === "RECEIVING BIDS") return "bids";
  return "waiting";
}

function lifecycleLabel(life: Lifecycle, bids: number): string {
  if (life === "awarded") return "Awarded";
  if (life === "bids") return `${bids} bid${bids === 1 ? "" : "s"}`;
  return "Waiting for bid";
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function poolStageCounts(
  members: readonly IndentRow[],
  bidCountById: Record<string, number>,
) {
  let waiting = 0;
  let bids = 0;
  let awarded = 0;
  for (const indent of members) {
    const life = lifecycleOf(indent, bidCountById[indent.id] ?? 0);
    if (life === "awarded") awarded += 1;
    else if (life === "bids") bids += 1;
    else waiting += 1;
  }
  return { waiting, bids, awarded };
}

function lowestBidOf(
  members: readonly IndentRow[],
  snapshots: Record<string, IndentBidSnapshot>,
): number | null {
  let lowest: number | null = null;
  for (const indent of members) {
    const amount = snapshots[indent.id]?.lowestAmount ?? null;
    if (amount != null && (lowest == null || amount < lowest)) lowest = amount;
  }
  return lowest;
}

function nextPickupOf(members: readonly IndentRow[]): string | null {
  let next: string | null = null;
  for (const indent of members) {
    const d = (indent.pickup_date ?? "").trim();
    if (d && (next == null || d < next)) next = d;
  }
  return next;
}

const STAGE_STEPS: { id: "posted" | Lifecycle; label: string }[] = [
  { id: "posted", label: "Posted" },
  { id: "bids", label: "Bids" },
  { id: "awarded", label: "Awarded" },
];

/** Posted → Bids → Awarded, filled up to the indent's current stage. */
function StageStepper({ life }: { life: Lifecycle }) {
  const reached = life === "awarded" ? 2 : life === "bids" ? 1 : 0;
  return (
    <View
      style={styles.stepper}
      accessible
      accessibilityLabel={`Stage ${STAGE_STEPS[reached]!.label}`}
    >
      {STAGE_STEPS.map((step, i) => {
        const done = i <= reached;
        return (
          <View key={step.id} style={styles.step}>
            {i > 0 ? (
              <View style={[styles.stepLine, done && styles.stepLineDone]} />
            ) : null}
            <View style={styles.stepNode}>
              <View
                style={[
                  styles.stepDot,
                  done && styles.stepDotDone,
                  i === reached && styles.stepDotCurrent,
                ]}
              />
              <Text
                style={[styles.stepLabel, i === reached && styles.stepLabelCurrent]}
                numberOfLines={1}
              >
                {step.label}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

/** Segmented bar of a pool's indents by stage. */
function StageBar({
  waiting,
  bids,
  awarded,
  onTrip,
}: {
  waiting: number;
  bids: number;
  awarded: number;
  onTrip: number;
}) {
  const parts = [
    { key: "waiting", value: waiting, style: styles.barWaiting },
    { key: "bids", value: bids, style: styles.barBids },
    { key: "awarded", value: awarded, style: styles.barAwarded },
    { key: "trip", value: onTrip, style: styles.barTrip },
  ].filter((p) => p.value > 0);
  return (
    <View style={styles.bar} pointerEvents="none">
      {parts.map((p) => (
        <View key={p.key} style={[styles.barPart, p.style, { flex: p.value }]} />
      ))}
    </View>
  );
}

function StageLegend() {
  const items = [
    { label: "Waiting", style: styles.barWaiting },
    { label: "Bids", style: styles.barBids },
    { label: "Awarded", style: styles.barAwarded },
    { label: "On trip", style: styles.barTrip },
  ];
  return (
    <View style={styles.legend}>
      {items.map((it) => (
        <View key={it.label} style={styles.legendItem}>
          <View style={[styles.legendDot, it.style]} />
          <Text style={styles.legendText}>{it.label}</Text>
        </View>
      ))}
    </View>
  );
}

function BidStatus({
  life,
  bids,
  snapshot,
  revoked,
}: {
  life: Lifecycle;
  bids: number;
  snapshot: IndentBidSnapshot | undefined;
  revoked: boolean;
}) {
  const lowest = snapshot?.lowestAmount ?? null;
  const latest = snapshot?.latestAt ? formatStoryDateTime(snapshot.latestAt) : "";
  return (
    <View style={styles.bidStatus}>
      <View
        style={[
          styles.status,
          life === "awarded"
            ? styles.statusAwarded
            : life === "bids"
              ? styles.statusBids
              : styles.statusWaiting,
        ]}
      >
        <Text
          style={[
            styles.statusText,
            life === "awarded"
              ? styles.statusTextAwarded
              : life === "bids"
                ? styles.statusTextBids
                : styles.statusTextWaiting,
          ]}
          numberOfLines={1}
        >
          {revoked ? "Award revoked · " : ""}
          {lifecycleLabel(life, bids)}
        </Text>
      </View>
      {lowest != null ? (
        <Text style={styles.bidAmount} numberOfLines={1}>
          Lowest {formatINR(lowest)}
        </Text>
      ) : null}
      {latest ? (
        <Text style={styles.bidMeta} numberOfLines={1}>
          Last bid · {latest}
        </Text>
      ) : null}
    </View>
  );
}

function PoolsSummaryTable({
  rows,
  compact,
  snapshots,
  onOpen,
}: {
  rows: ShipperPoolSummaryRow<IndentRow>[];
  compact: boolean;
  snapshots: Record<string, IndentBidSnapshot>;
  onOpen: (lane: PoolLane) => void;
}) {
  return (
    <View style={styles.table} testID="indent-pool-summary-table">
      {!compact ? (
        <View style={[styles.tableHead, styles.sumRowLayout]}>
          <Text style={[styles.tableHeadText, styles.colPool]}>Pool</Text>
          <Text style={[styles.tableHeadText, styles.colStages]}>Stages</Text>
          <Text style={[styles.tableHeadText, styles.colNum]}>Indents</Text>
          <Text style={[styles.tableHeadText, styles.colNum]}>Waiting</Text>
          <Text style={[styles.tableHeadText, styles.colNum]}>Bids</Text>
          <Text style={[styles.tableHeadText, styles.colNum]}>Awarded</Text>
          <Text style={[styles.tableHeadText, styles.colNum]}>On trip</Text>
          <Text style={[styles.tableHeadText, styles.colMoney]}>Lowest bid</Text>
          <Text style={[styles.tableHeadText, styles.colDate]}>Next pickup</Text>
          <View style={styles.colChevron} />
        </View>
      ) : null}
      {rows.map((row, i) => {
        const { lane } = row;
        const lowest = lowestBidOf(row.members, snapshots);
        const nextPickup = nextPickupOf(row.members);
        const parts = compactLane(lane);
        const stageText = `${row.waiting} waiting, ${row.bids} with bids, ${row.awarded} awarded, ${row.onTrip} on trip`;
        return (
          <Pressable
            key={lane.poolId}
            onPress={() => onOpen(lane)}
            style={({ pressed }) => [
              compact ? styles.sumRowCompact : [styles.sumRow, styles.sumRowLayout],
              i > 0 && styles.rowDivider,
              pressed && styles.pressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel={`Open indent pool ${laneTitle(lane)}, ${lane.vehicle_type}, ${plural(lane.load_count, "indent")}`}
            accessibilityHint={stageText}
            testID={`indent-pool-summary-${lane.poolId}`}
          >
            {compact ? (
              <>
                <View style={styles.sumCompactTop}>
                  <View style={styles.quickBody}>
                    <Text style={styles.quickRoute} numberOfLines={1}>
                      {parts.route}
                    </Text>
                    <Text style={styles.quickMeta} numberOfLines={1}>
                      {[lane.vehicle_type, parts.regions].filter(Boolean).join(" · ")}
                    </Text>
                  </View>
                  <View style={styles.countBadge}>
                    <Text style={styles.countBadgeText}>{lane.load_count}</Text>
                  </View>
                  <ChevronRight size={14} color={Theme.textMuted} strokeWidth={2.2} />
                </View>
                <StageBar
                  waiting={row.waiting}
                  bids={row.bids}
                  awarded={row.awarded}
                  onTrip={row.onTrip}
                />
                <Text style={styles.sumCompactStages} numberOfLines={1}>
                  {[
                    `${row.waiting} waiting`,
                    `${row.bids} bids`,
                    `${row.awarded} awarded`,
                    row.onTrip > 0 ? `${row.onTrip} on trip` : null,
                    lowest != null ? `Lowest ${formatINR(lowest)}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </Text>
              </>
            ) : (
              <>
                <View style={styles.colPool}>
                  <Text style={styles.quickRoute} numberOfLines={1}>
                    {parts.route}
                  </Text>
                  <Text style={styles.quickMeta} numberOfLines={1}>
                    {[lane.vehicle_type, parts.regions].filter(Boolean).join(" · ")}
                  </Text>
                </View>
                <View style={styles.colStages}>
                  <StageBar
                    waiting={row.waiting}
                    bids={row.bids}
                    awarded={row.awarded}
                    onTrip={row.onTrip}
                  />
                </View>
                <Text style={[styles.cellNum, styles.colNum]}>{lane.load_count}</Text>
                <Text style={[styles.cellNum, styles.colNum, row.waiting > 0 && styles.cellWaiting]}>
                  {row.waiting}
                </Text>
                <Text style={[styles.cellNum, styles.colNum, row.bids > 0 && styles.cellBids]}>
                  {row.bids}
                </Text>
                <Text style={[styles.cellNum, styles.colNum, row.awarded > 0 && styles.cellAwarded]}>
                  {row.awarded}
                </Text>
                <Text style={[styles.cellNum, styles.colNum]}>{row.onTrip}</Text>
                <Text style={[styles.cellText, styles.colMoney]} numberOfLines={1}>
                  {lowest != null ? formatINR(lowest) : "—"}
                </Text>
                <Text style={[styles.cellText, styles.colDate]} numberOfLines={1}>
                  {nextPickup ? formatStoryDate(nextPickup) : "—"}
                </Text>
                <View style={styles.colChevron}>
                  <ChevronRight size={14} color={Theme.textMuted} strokeWidth={2.2} />
                </View>
              </>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

export function IndentStagePoolView({
  lanes,
  poolIndents,
  allocatedIndents,
  poolSearch,
  onPoolSearchChange,
  model,
  canSelect,
  bidCountById,
  bidSnapshotById = NO_SNAPSHOTS,
  listCapped,
  compact,
  onToggle,
  onSelectAllShown,
  onClear,
  onShowMore,
  onOpenIndent,
}: Props) {
  const [showAllPools, setShowAllPools] = useState(false);
  const selected = new Set(model.selectedIds);
  const shownUnselected = model.shown.filter((i) => !selected.has(i.id)).length;
  const stage = poolStageCounts(model.members, bidCountById);
  const summary: { label: string; short: string; value: number }[] = [
    { label: "Waiting for bid", short: "Waiting", value: stage.waiting },
    { label: "Bids received", short: "Bids", value: stage.bids },
    { label: "Awarded", short: "Awarded", value: stage.awarded },
    { label: "On a trip", short: "On trip", value: model.onTripCount },
  ];
  const poolLowest = lowestBidOf(model.members, bidSnapshotById);

  const summaryRows = useMemo(
    () =>
      shipperPoolSummaryRows({
        lanes,
        poolIndents: poolIndents ?? [],
        allocatedIndents,
        stageOf: (indent) => lifecycleOf(indent, bidCountById[indent.id] ?? 0),
      }),
    [lanes, poolIndents, allocatedIndents, bidCountById],
  );
  const visibleRows = showAllPools ? summaryRows : summaryRows.slice(0, QUICK_POOL_LIMIT);
  const totals = summaryRows.reduce(
    (acc, r) => ({
      indents: acc.indents + r.lane.load_count,
      waiting: acc.waiting + r.waiting,
      bids: acc.bids + r.bids,
      awarded: acc.awarded + r.awarded,
      onTrip: acc.onTrip + r.onTrip,
    }),
    { indents: 0, waiting: 0, bids: 0, awarded: 0, onTrip: 0 },
  );
  const totalsStrip: { label: string; value: number }[] = [
    { label: "Pools", value: summaryRows.length },
    { label: "Indents", value: totals.indents },
    { label: "Waiting", value: totals.waiting },
    { label: "Bids", value: totals.bids },
    { label: "Awarded", value: totals.awarded },
    { label: "On trip", value: totals.onTrip },
  ];

  const openLane = (lane: PoolLane) =>
    onPoolSearchChange({
      pickup: lane.pickup_area,
      drop: lane.drop_location,
      vehicleType: lane.vehicle_type,
    });

  return (
    <View style={styles.wrap} testID="indent-pool-view">
      <View style={styles.card}>
        <View style={styles.cardHead}>
          <Text style={styles.sectionLabel}>Find a pool</Text>
          <Text style={styles.sectionHint}>Pickup · Drop · Vehicle</Text>
        </View>
        <MarketplaceLaneFilters
          lanes={lanes}
          value={poolSearch}
          onChange={onPoolSearchChange}
          stacked={compact}
          density="compact"
        />
        {!model.poolId ? (
          lanes.length === 0 ? (
            <Text style={styles.note}>
              None of your open indents has a pickup, drop and vehicle yet, so
              there is no pool to show.
            </Text>
          ) : (
            <View style={styles.quick}>
              <View style={styles.cardHead}>
                <Text style={styles.sectionLabel}>Your pools</Text>
                <Text style={styles.sectionHint}>
                  {visibleRows.length < summaryRows.length
                    ? `Top ${visibleRows.length} of ${summaryRows.length}`
                    : plural(summaryRows.length, "pool")}
                </Text>
              </View>

              <View style={styles.stats} testID="indent-pools-totals">
                {totalsStrip.map((s, i) => (
                  <View
                    key={s.label}
                    style={[styles.stat, i > 0 && styles.statDivider]}
                    accessible
                    accessibilityLabel={`All pools ${s.label}: ${s.value}`}
                  >
                    <Text style={styles.statValue}>{s.value}</Text>
                    <Text style={styles.statLabel} numberOfLines={1}>
                      {s.label}
                    </Text>
                  </View>
                ))}
              </View>
              <StageLegend />

              <PoolsSummaryTable
                rows={visibleRows}
                compact={compact}
                snapshots={bidSnapshotById}
                onOpen={openLane}
              />
              {summaryRows.length > QUICK_POOL_LIMIT ? (
                <Pressable
                  onPress={() => setShowAllPools((v) => !v)}
                  style={styles.more}
                  accessibilityRole="button"
                  accessibilityLabel={
                    showAllPools ? "Show top pools only" : `Show all ${summaryRows.length} pools`
                  }
                >
                  <Text style={styles.moreText}>
                    {showAllPools ? "Show fewer" : `Show all ${summaryRows.length} pools`}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          )
        ) : null}
      </View>

      {model.poolId ? (
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <View style={styles.eyebrowRow}>
              <Layers size={12} color={Theme.primary} strokeWidth={2.4} />
              <Text style={styles.eyebrow}>INDENT POOL</Text>
            </View>
            <View style={styles.vehicleBadge}>
              <Text style={styles.vehicleBadgeText} numberOfLines={1}>
                {model.key.vehicleType}
              </Text>
            </View>
          </View>

          <View style={styles.routeGrid}>
            <RoutePlace raw={model.key.pickup} align="left" />
            <ArrowRight size={14} color={Theme.textMuted} strokeWidth={2} />
            <RoutePlace raw={model.key.drop} align="right" />
          </View>
          <Text style={styles.countLine} testID="indent-pool-count">
            {plural(model.poolTotal, "indent")} in pool
            {model.hiddenByFilters > 0
              ? ` · ${model.members.length} match current filters`
              : ""}
          </Text>

          <View style={styles.stats} testID="indent-pool-summary">
            {summary.map((s, i) => (
              <View
                key={s.label}
                style={[styles.stat, i > 0 && styles.statDivider]}
                accessible
                accessibilityLabel={`${s.label}: ${s.value}`}
              >
                <Text style={styles.statValue}>{s.value}</Text>
                <Text style={styles.statLabel} numberOfLines={1}>
                  {s.short}
                </Text>
              </View>
            ))}
          </View>
          <StageBar
            waiting={stage.waiting}
            bids={stage.bids}
            awarded={stage.awarded}
            onTrip={model.onTripCount}
          />
          {poolLowest != null ? (
            <Text style={styles.countLine} testID="indent-pool-lowest">
              Lowest bid in pool · {formatINR(poolLowest)}
            </Text>
          ) : null}

          <View style={styles.toolbar}>
            <View style={styles.toolbarText}>
              <Text style={styles.selectedCount} testID="indent-pool-selected-count">
                {model.selectedIds.length} selected for bulk actions
              </Text>
              <Text style={styles.note}>
                {canSelect
                  ? "Selecting indents does not change the pool."
                  : "View only. Selecting indents needs indent allocation access."}
              </Text>
            </View>
            {canSelect ? (
              <View style={styles.toolbarActions}>
                <Pressable
                  onPress={onSelectAllShown}
                  disabled={shownUnselected === 0}
                  hitSlop={8}
                  style={[styles.toolBtn, shownUnselected === 0 && styles.disabled]}
                  accessibilityRole="button"
                  accessibilityLabel={`Select all ${model.shown.length} shown indents`}
                >
                  <Text style={styles.toolBtnText}>
                    Select all ({model.shown.length})
                  </Text>
                </Pressable>
                <Pressable
                  onPress={onClear}
                  disabled={model.selectedIds.length === 0}
                  hitSlop={8}
                  style={[
                    styles.toolBtn,
                    model.selectedIds.length === 0 && styles.disabled,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Clear selection"
                >
                  <Text style={styles.toolBtnText}>Clear</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
          {model.selectedHiddenCount > 0 ? (
            <Text style={styles.note}>
              {model.selectedHiddenCount} selected indent
              {model.selectedHiddenCount === 1 ? " is" : "s are"} hidden by the
              current filters.
            </Text>
          ) : null}

          <View style={styles.table}>
            {compact ? (
              <View style={styles.tableHead}>
                <Text style={styles.tableHeadText}>Indent</Text>
                <Text style={styles.tableHeadText}>Bid status</Text>
              </View>
            ) : (
              <View style={[styles.tableHead, styles.detailHead]}>
                {canSelect ? <View style={styles.colCheck} /> : null}
                <Text style={[styles.tableHeadText, styles.colIndent]}>Indent</Text>
                <Text style={[styles.tableHeadText, styles.colPickup]}>Pickup</Text>
                <Text style={[styles.tableHeadText, styles.colStage]}>Stage</Text>
                <Text style={[styles.tableHeadText, styles.colBid]}>Bid status</Text>
                <View style={styles.colAction} />
              </View>
            )}

            {model.members.length === 0 ? (
              <Text style={[styles.note, styles.empty]}>
                No indents in this pool match the current filters.
              </Text>
            ) : null}

            {model.shown.map((indent) => {
              const ref = getIndentDisplayNumber(indent);
              const bids = bidCountById[indent.id] ?? 0;
              const on = selected.has(indent.id);
              const life = lifecycleOf(indent, bids);
              const revoked = indentHasAwardRevokedTag(
                indent.status,
                (indent.award_revoked_at as string | null | undefined) ?? null,
              );
              const pickupLabel = indent.pickup_date ? formatStoryDate(indent.pickup_date) : null;
              const meta = [
                indent.client_name?.trim() || null,
                indentHubLoadSpecLine(indent),
                compact ? pickupLabel : null,
                ...indentHubSourceTags(indent.circulation_target).map(titleCaseWord),
              ].filter(Boolean);
              const bidStatus = (
                <BidStatus
                  life={life}
                  bids={bids}
                  snapshot={bidSnapshotById[indent.id]}
                  revoked={revoked}
                />
              );
              return (
                <View
                  key={indent.id}
                  style={[styles.row, on && styles.rowOn]}
                  testID={`indent-pool-row-${indent.id}`}
                >
                  {canSelect ? (
                    <Pressable
                      onPress={() => onToggle(indent.id)}
                      hitSlop={Layout.touchTargetHitSlop}
                      style={[styles.check, on && styles.checkOn]}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}
                      accessibilityLabel={`Select indent ${ref}`}
                    >
                      {on ? (
                        <Check size={11} color={Theme.textOnPrimary} strokeWidth={3} />
                      ) : null}
                    </Pressable>
                  ) : null}
                  <Pressable
                    onPress={() => onOpenIndent(indent)}
                    style={({ pressed }) => [styles.rowMain, pressed && styles.pressed]}
                    accessibilityRole="button"
                    accessibilityLabel={`Review indent ${ref}`}
                  >
                    <View style={compact ? styles.rowBody : [styles.rowBody, styles.colIndent]}>
                      <Text style={styles.ref} numberOfLines={1}>
                        {ref}
                      </Text>
                      <Text style={styles.route} numberOfLines={1}>
                        {compactLane(indent).route}
                      </Text>
                      {meta.length > 0 ? (
                        <Text style={styles.meta} numberOfLines={1}>
                          {meta.join(" · ")}
                        </Text>
                      ) : null}
                    </View>
                    {compact ? (
                      <View style={styles.rowSide}>
                        {bidStatus}
                        <View style={styles.review}>
                          <Text style={styles.reviewText}>Review</Text>
                          <ChevronRight size={12} color={Theme.primary} strokeWidth={2.4} />
                        </View>
                      </View>
                    ) : (
                      <>
                        <Text style={[styles.cellText, styles.colPickup]} numberOfLines={1}>
                          {pickupLabel ?? "—"}
                        </Text>
                        <View style={styles.colStage}>
                          <StageStepper life={life} />
                        </View>
                        <View style={styles.colBid}>{bidStatus}</View>
                        <View style={[styles.review, styles.colAction]}>
                          <Text style={styles.reviewText}>Review</Text>
                          <ChevronRight size={12} color={Theme.primary} strokeWidth={2.4} />
                        </View>
                      </>
                    )}
                  </Pressable>
                </View>
              );
            })}
          </View>

          {model.members.length > 0 ? (
            <Text style={styles.footer} testID="indent-pool-shown">
              Showing {model.shown.length} of {model.members.length}
              {model.members.length < model.poolTotal
                ? ` matching (${model.poolTotal} in pool)`
                : ""}
              {model.hasMoreToShow ? " · Select all only adds the rows shown" : ""}
            </Text>
          ) : null}
          {model.hasMoreToShow ? (
            <Pressable
              onPress={onShowMore}
              style={styles.more}
              accessibilityRole="button"
              accessibilityLabel="Show more indents in this pool"
            >
              <Text style={styles.moreText}>Show more</Text>
            </Pressable>
          ) : null}
          <Text style={styles.note}>
            Award, vehicle and driver stay per indent in Review.
          </Text>
          {listCapped ? (
            <Text style={styles.note}>
              Only your most recent indents are loaded, so this pool may have
              more indents than shown.
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function RoutePlace({ raw, align }: { raw: string; align: "left" | "right" }) {
  const { city, region } = splitPlace(raw);
  const right = align === "right";
  return (
    <View style={[styles.place, right && styles.placeRight]}>
      <Text style={[styles.placeLabel, right && styles.textRight]}>
        {right ? "DROP" : "PICKUP"}
      </Text>
      <Text style={[styles.placeCity, right && styles.textRight]} numberOfLines={1}>
        {city}
      </Text>
      {region ? (
        <Text style={[styles.placeRegion, right && styles.textRight]} numberOfLines={1}>
          {region}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  toggle: {
    flexDirection: "row",
    alignSelf: "flex-start",
    padding: 2,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Theme.borderInput,
    backgroundColor: Theme.cardWhite,
    marginBottom: 10,
  },
  toggleOption: {
    minHeight: 28,
    paddingHorizontal: 12,
    borderRadius: 6,
    justifyContent: "center",
  },
  toggleOptionOn: { backgroundColor: Theme.primaryLight },
  toggleText: { fontSize: 12, fontWeight: "600", color: Theme.textRouteCard },
  toggleTextOn: { color: Theme.primary, fontWeight: "700" },

  wrap: { gap: 10 },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Theme.borderInput,
    backgroundColor: Theme.cardWhite,
    padding: 12,
    gap: 10,
  },
  cardHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: Theme.textRouteCard,
  },
  sectionHint: { fontSize: 10.5, fontWeight: "500", color: Theme.textMuted },
  note: { fontSize: 10.5, lineHeight: 14, color: Theme.textMuted },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.35 },

  quick: { gap: 6 },
  quickList: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Theme.borderInput,
    overflow: "hidden",
  },
  quickRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: Layout.minTouchTargetSize,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  rowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Theme.borderInput,
  },
  quickBody: { flex: 1, minWidth: 0, gap: 1 },
  quickRoute: { fontSize: 12, fontWeight: "600", color: Theme.textPrimaryDark },
  quickMeta: { fontSize: 10.5, color: Theme.textRouteCard },
  countBadge: {
    minWidth: 20,
    height: 18,
    paddingHorizontal: 6,
    borderRadius: 9,
    backgroundColor: Theme.brandBlueSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  countBadgeText: { fontSize: 10.5, fontWeight: "700", color: Theme.primary },

  eyebrowRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  eyebrow: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.6,
    color: Theme.primary,
  },
  vehicleBadge: {
    maxWidth: "50%",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Theme.borderInput,
    backgroundColor: Theme.whiteMuted,
  },
  vehicleBadgeText: { fontSize: 10.5, fontWeight: "700", color: Theme.textPrimaryDark },

  routeGrid: { flexDirection: "row", alignItems: "center", gap: 10 },
  place: { flex: 1, minWidth: 0, gap: 1 },
  placeRight: { alignItems: "flex-end" },
  textRight: { textAlign: "right" },
  placeLabel: {
    fontSize: 9.5,
    fontWeight: "700",
    letterSpacing: 0.5,
    color: Theme.textMuted,
  },
  placeCity: { fontSize: 14, fontWeight: "700", color: Theme.textPrimaryDark },
  placeRegion: { fontSize: 11, color: Theme.textRouteCard },
  countLine: { fontSize: 11, fontWeight: "500", color: Theme.textRouteCard },

  stats: {
    flexDirection: "row",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Theme.borderInput,
    backgroundColor: Theme.whiteMuted,
  },
  stat: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 8,
    paddingHorizontal: 6,
    alignItems: "center",
    gap: 1,
  },
  statDivider: {
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: Theme.borderInput,
  },
  statValue: { fontSize: 15, fontWeight: "800", color: Theme.textPrimaryDark },
  statLabel: {
    fontSize: 9.5,
    fontWeight: "700",
    letterSpacing: 0.4,
    textTransform: "uppercase",
    color: Theme.textMuted,
  },

  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  toolbarText: { flex: 1, minWidth: 0, gap: 1 },
  selectedCount: { fontSize: 11.5, fontWeight: "700", color: Theme.textPrimaryDark },
  toolbarActions: { flexDirection: "row", alignItems: "center", gap: 6 },
  toolBtn: {
    height: 28,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Theme.borderInput,
    backgroundColor: Theme.cardWhite,
    justifyContent: "center",
  },
  toolBtnText: { fontSize: 11, fontWeight: "700", color: Theme.primary },

  table: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Theme.borderInput,
    overflow: "hidden",
  },
  tableHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: Theme.whiteMuted,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.borderInput,
  },
  tableHeadText: {
    fontSize: 9.5,
    fontWeight: "800",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    color: Theme.textMuted,
  },
  empty: { paddingHorizontal: 10, paddingVertical: 12 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingLeft: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Theme.borderInput,
  },
  rowOn: { backgroundColor: Theme.brandBlueWashSubtle },
  check: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: Theme.borderInput,
    backgroundColor: Theme.cardWhite,
    alignItems: "center",
    justifyContent: "center",
  },
  checkOn: { backgroundColor: Theme.primary, borderColor: Theme.primary },
  rowMain: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 9,
    paddingRight: 10,
    minHeight: Layout.minTouchTargetSize,
  },
  rowBody: { flex: 1, minWidth: 0, gap: 2 },
  rowSide: { flexShrink: 0, alignItems: "flex-end", gap: 6, maxWidth: "45%" },
  ref: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.2,
    color: Theme.textPrimaryDark,
  },
  status: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  statusWaiting: { backgroundColor: Theme.warningMuted },
  statusBids: { backgroundColor: Theme.brandBlueSoft },
  statusAwarded: { backgroundColor: Theme.positiveMuted },
  statusText: { fontSize: 10, fontWeight: "700" },
  statusTextWaiting: { color: Theme.warning },
  statusTextBids: { color: Theme.primary },
  statusTextAwarded: { color: Theme.positive },
  route: { fontSize: 11.5, fontWeight: "500", color: Theme.textRouteCard },
  meta: { fontSize: 10.5, color: Theme.textMuted },
  review: { flexDirection: "row", alignItems: "center", gap: 1 },
  reviewText: { fontSize: 11, fontWeight: "700", color: Theme.primary },

  footer: { fontSize: 10.5, color: Theme.textMuted },
  more: {
    minHeight: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Theme.borderInput,
  },
  moreText: { fontSize: 11.5, fontWeight: "700", color: Theme.primary },
  sumRowLayout: { flexDirection: "row", alignItems: "center", gap: 8 },
  sumRow: {
    minHeight: Layout.minTouchTargetSize,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  sumRowCompact: {
    minHeight: Layout.minTouchTargetSize,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 6,
  },
  sumCompactTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  sumCompactStages: { fontSize: 10.5, fontWeight: "600", color: Theme.textRouteCard },
  colPool: { flex: 2.4, minWidth: 0, gap: 1 },
  colStages: { flex: 1.4, minWidth: 0 },
  colNum: { flex: 0.7, minWidth: 0, textAlign: "center" },
  colMoney: { flex: 1, minWidth: 0, textAlign: "right" },
  colDate: { flex: 1, minWidth: 0, textAlign: "right" },
  colChevron: { width: 14, alignItems: "flex-end" },
  cellNum: { fontSize: 12.5, fontWeight: "700", color: Theme.textPrimaryDark },
  cellText: { fontSize: 11.5, fontWeight: "600", color: Theme.textPrimaryDark },
  cellWaiting: { color: Theme.warning },
  cellBids: { color: Theme.primary },
  cellAwarded: { color: Theme.positive },

  bar: {
    flexDirection: "row",
    height: 6,
    borderRadius: 3,
    overflow: "hidden",
    backgroundColor: Theme.borderInput,
    gap: 1,
  },
  barPart: { height: "100%" },
  barWaiting: { backgroundColor: Theme.warning },
  barBids: { backgroundColor: Theme.primary },
  barAwarded: { backgroundColor: Theme.positive },
  barTrip: { backgroundColor: Theme.textMuted },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 10, fontWeight: "600", color: Theme.textRouteCard },

  stepper: { flexDirection: "row", alignItems: "flex-start" },
  step: { flexDirection: "row", alignItems: "flex-start" },
  stepLine: {
    width: 16,
    height: 2,
    marginTop: 4,
    backgroundColor: Theme.borderInput,
  },
  stepLineDone: { backgroundColor: Theme.positive },
  stepNode: { alignItems: "center", gap: 3, minWidth: 40 },
  stepDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: Theme.borderInput,
    backgroundColor: Theme.cardWhite,
  },
  stepDotDone: { backgroundColor: Theme.positive, borderColor: Theme.positive },
  stepDotCurrent: { borderColor: Theme.positiveMuted, borderWidth: 2 },
  stepLabel: { fontSize: 9.5, fontWeight: "600", color: Theme.textMuted },
  stepLabelCurrent: { color: Theme.textPrimaryDark, fontWeight: "800" },

  bidStatus: { alignItems: "flex-start", gap: 2, minWidth: 0 },
  bidAmount: { fontSize: 12, fontWeight: "800", color: Theme.textPrimaryDark },
  bidMeta: { fontSize: 10, color: Theme.textMuted },

  detailHead: { justifyContent: "flex-start", alignItems: "center", gap: 8 },
  colCheck: { width: 18, marginRight: 2 },
  colIndent: { flex: 2.2, minWidth: 0 },
  colPickup: { flex: 1, minWidth: 0 },
  colStage: { flex: 1.6, minWidth: 0 },
  colBid: { flex: 1.6, minWidth: 0 },
  colAction: { width: 64, justifyContent: "flex-end" },
});
