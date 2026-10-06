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
import type { MarketplaceLoadSearch } from "@/features/network/utils/marketplaceSearch.util";
import type { PoolLane } from "@/features/network/utils/pooledOpportunity.util";
import type { ShipperPoolModel } from "@/features/network/utils/shipperPoolIndents.util";
import { formatStoryDate } from "@/features/network/utils/storyDisplay";
import {
  indentHasAwardRevokedTag,
  indentHubLifecycleStatus,
  indentHubLoadSpecLine,
  indentHubSourceTags,
} from "@/features/trips/utils/indentHubCardPresentation";
import { ArrowRight, Check, ChevronRight, Layers } from "lucide-react-native";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

const QUICK_POOL_LIMIT = 6;

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
  listCapped,
  compact,
  onOpenIndent,
  cards,
}: {
  state: ReturnType<typeof useShipperPoolIndentView<IndentRow>>;
  canView: boolean;
  canSelect: boolean;
  bidCountById: Record<string, number>;
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
          poolSearch={state.poolSearch}
          onPoolSearchChange={state.setPoolSearch}
          model={state.model}
          canSelect={canSelect}
          bidCountById={bidCountById}
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
  poolSearch: MarketplaceLoadSearch | null;
  onPoolSearchChange: (next: MarketplaceLoadSearch) => void;
  model: ShipperPoolModel<IndentRow>;
  canSelect: boolean;
  bidCountById: Record<string, number>;
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
function compactLane(lane: { pickup_area: string; drop_location: string }) {
  const from = splitPlace(lane.pickup_area);
  const to = splitPlace(lane.drop_location);
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

export function IndentStagePoolView({
  lanes,
  poolSearch,
  onPoolSearchChange,
  model,
  canSelect,
  bidCountById,
  listCapped,
  compact,
  onToggle,
  onSelectAllShown,
  onClear,
  onShowMore,
  onOpenIndent,
}: Props) {
  const selected = new Set(model.selectedIds);
  const shownUnselected = model.shown.filter((i) => !selected.has(i.id)).length;
  const stage = poolStageCounts(model.members, bidCountById);
  const summary: { label: string; short: string; value: number }[] = [
    { label: "Waiting for bid", short: "Waiting", value: stage.waiting },
    { label: "Bids received", short: "Bids", value: stage.bids },
    { label: "Awarded", short: "Awarded", value: stage.awarded },
    { label: "On a trip", short: "On trip", value: model.onTripCount },
  ];
  const quickLanes = lanes.slice(0, QUICK_POOL_LIMIT);

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
                  {quickLanes.length < lanes.length
                    ? `Top ${quickLanes.length} of ${lanes.length}`
                    : plural(lanes.length, "pool")}
                </Text>
              </View>
              <View style={styles.quickList}>
                {quickLanes.map((lane, i) => (
                  <Pressable
                    key={lane.poolId}
                    onPress={() =>
                      onPoolSearchChange({
                        pickup: lane.pickup_area,
                        drop: lane.drop_location,
                        vehicleType: lane.vehicle_type,
                      })
                    }
                    style={({ pressed }) => [
                      styles.quickRow,
                      i > 0 && styles.rowDivider,
                      pressed && styles.pressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={`Open indent pool ${laneTitle(lane)}, ${lane.vehicle_type}, ${plural(lane.load_count, "indent")}`}
                  >
                    <View style={styles.quickBody}>
                      <Text style={styles.quickRoute} numberOfLines={1}>
                        {compactLane(lane).route}
                      </Text>
                      <Text style={styles.quickMeta} numberOfLines={1}>
                        {[lane.vehicle_type, compactLane(lane).regions]
                          .filter(Boolean)
                          .join(" · ")}
                      </Text>
                    </View>
                    <View style={styles.countBadge}>
                      <Text style={styles.countBadgeText}>{lane.load_count}</Text>
                    </View>
                    <ChevronRight size={14} color={Theme.textMuted} strokeWidth={2.2} />
                  </Pressable>
                ))}
              </View>
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
            <View style={styles.tableHead}>
              <Text style={styles.tableHeadText}>Indent</Text>
              <Text style={styles.tableHeadText}>Status</Text>
            </View>

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
              const meta = [
                indent.client_name?.trim() || null,
                indentHubLoadSpecLine(indent),
                indent.pickup_date ? formatStoryDate(indent.pickup_date) : null,
                ...indentHubSourceTags(indent.circulation_target).map(titleCaseWord),
              ].filter(Boolean);
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
                    <View style={styles.rowBody}>
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
                    <View style={styles.rowSide}>
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
                      <View style={styles.review}>
                        <Text style={styles.reviewText}>Review</Text>
                        <ChevronRight size={12} color={Theme.primary} strokeWidth={2.4} />
                      </View>
                    </View>
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
});
