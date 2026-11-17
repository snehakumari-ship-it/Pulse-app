/**
 * The single commercial action for a pooled opportunity: one rate for every
 * eligible load in the pool. The bidder never picks loads. Underneath, each
 * load still receives its own per-indent bid, so outcomes are reported as
 * counts, never as load identifiers.
 */
import Layout from "@/constants/Layout";
import Theme from "@/constants/Theme";
import { formatFindLoadsRateOffer } from "@/features/network/services/findLoadsForOrg.service";
import {
  groupPoolBidFailures,
  type PoolBidSubmissionResult,
  type PoolCommercialState,
} from "@/features/network/utils/pooledOpportunity.util";
import { AlertCircle, Check, Clock3, Minus } from "lucide-react-native";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from "react-native";

const WEB_COPY = Platform.select({
  web: { whiteSpace: "pre-wrap" } as object,
  default: {},
});

function targetRangeLabel(
  min: number | null,
  max: number | null,
): string | null {
  const lo = formatFindLoadsRateOffer(min);
  const hi = formatFindLoadsRateOffer(max);
  if (!lo || !hi) return null;
  return lo === hi ? lo : `${lo} – ${hi}`;
}

function EligibilityRow({
  ok,
  label,
  status,
}: {
  ok: boolean;
  label: string;
  status?: string | null;
}) {
  return (
    <View style={styles.eligRow}>
      {ok ? (
        <Check size={14} color={Theme.positive} strokeWidth={2.6} />
      ) : (
        <Minus size={14} color={Theme.textMuted} strokeWidth={2.6} />
      )}
      <Text style={[styles.eligText, !ok && styles.eligTextOff]} numberOfLines={2}>
        {label}
      </Text>
      {status ? (
        <View style={styles.eligStatus}>
          {ok ? (
            <Clock3 size={12} color={Theme.driverGold} strokeWidth={2.4} />
          ) : (
            <AlertCircle size={12} color={Theme.warning} strokeWidth={2.4} />
          )}
          <Text style={[styles.eligStatusText, !ok && styles.eligStatusTextOff]} numberOfLines={1}>
            {status}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function ResultCard({ result }: { result: PoolBidSubmissionResult }) {
  if (result.blocked) {
    return (
      <View style={[styles.banner, styles.bannerWarn]} accessibilityRole="alert">
        <Text style={styles.bannerWarnTitle}>Nothing was submitted</Text>
        <Text style={styles.bannerWarnText}>{result.blocked}</Text>
      </View>
    );
  }
  const ok = result.succeeded.length;
  const failed = result.failed.length;
  if (failed === 0) {
    return (
      <View style={[styles.banner, styles.bannerOk]}>
        <Text style={styles.bannerOkText}>
          Your rate has been submitted for all {plural(ok, "load")}.
        </Text>
      </View>
    );
  }
  return (
    <View style={[styles.banner, styles.bannerWarn]} accessibilityRole="alert">
      <Text style={styles.bannerWarnTitle}>
        {ok > 0
          ? `Partly submitted: your rate reached ${ok} of ${result.attempted} loads`
          : `Not submitted: none of the ${plural(result.attempted, "load")} took your rate`}
      </Text>
      {groupPoolBidFailures(result.failed).map((g) => (
        <Text key={g.message} style={styles.bannerWarnText} numberOfLines={3}>
          {plural(g.count, "load")}: {g.message}
        </Text>
      ))}
    </View>
  );
}

export function PoolBidPanel({
  state,
  eligibleCount,
  preparing,
  blockedReason,
  targetRateMin,
  targetRateMax,
  canBidCapability,
  fitsFleet,
  result,
  onBid,
}: {
  state: PoolCommercialState;
  /** Every member this org can bid on; the whole scope of the rate. */
  eligibleCount: number;
  /** Still reading pool members; the rate can't be offered yet. */
  preparing: boolean;
  blockedReason: string | null;
  targetRateMin: number | null;
  targetRateMax: number | null;
  canBidCapability: boolean;
  fitsFleet: boolean;
  result: PoolBidSubmissionResult | null;
  onBid: () => void;
}) {
  const range = targetRangeLabel(targetRateMin, targetRateMax);
  const disabled =
    !canBidCapability || preparing || blockedReason != null || eligibleCount === 0;
  const ctaLabel =
    state === "submitted" ? "Update rate for pool" : "Submit rate for pool";
  const scopeValue = preparing
    ? "Preparing…"
    : eligibleCount > 0
      ? "All"
      : "None";
  const scopeDetail = preparing
    ? "Preparing pool…"
    : `All ${plural(eligibleCount, "eligible load")}`;

  return (
    <View style={styles.wrap}>
      <Text style={styles.eyebrow}>COMMERCIAL</Text>
      <Text style={styles.title}>Your rate for this pooled opportunity</Text>
      <Text style={styles.body}>
        Submit one rate for all eligible loads in this pool.
      </Text>

      {blockedReason ? (
        <Text style={styles.blocked} accessibilityRole="alert">
          {blockedReason}
        </Text>
      ) : null}

      <Pressable
        onPress={onBid}
        disabled={disabled}
        style={({ pressed }) => [
          styles.cta,
          disabled && styles.ctaDisabled,
          pressed && !disabled && styles.ctaPressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel={ctaLabel}
        accessibilityState={{ disabled }}
      >
        {preparing ? (
          <ActivityIndicator size="small" color={Theme.textOnPrimary} />
        ) : (
          <Text style={styles.ctaText}>{ctaLabel}</Text>
        )}
      </Pressable>

      <View style={styles.statRow}>
        {range ? (
          <View style={[styles.stat, styles.statTarget]}>
            <Text style={styles.statLabelOnDark}>Shipper target</Text>
            <Text style={styles.statValueOnDark} numberOfLines={1}>
              {range}
            </Text>
          </View>
        ) : null}
        <View style={[styles.stat, styles.statApplies, !range && styles.statGrow]}>
          <Text style={styles.statLabelOnDark}>Applies to</Text>
          <Text
            style={styles.statValueOnDark}
            numberOfLines={1}
            testID="pool-bid-scope"
            accessibilityLabel={scopeDetail}
          >
            {scopeValue}
          </Text>
          {/* Keep full scope copy for tests / screen readers without crowding the tile. */}
          <Text style={styles.statHiddenDetail}>{scopeDetail}</Text>
        </View>
      </View>

      {!canBidCapability ? (
        <Text style={styles.note}>Your role can view this pool but can't bid.</Text>
      ) : !preparing && !blockedReason && eligibleCount > 0 ? (
        <Text style={styles.note}>
          Your rate will be submitted for all {plural(eligibleCount, "eligible load")} in
          this pool. The shipper reviews bids; nothing is awarded until the shipper
          accepts.
        </Text>
      ) : null}

      {result ? <ResultCard result={result} /> : null}

      <View style={styles.divider} />
      <Text style={styles.eyebrow}>ELIGIBILITY</Text>
      <EligibilityRow
        ok={canBidCapability}
        label="Bidding access"
        status={canBidCapability ? null : "Not available"}
      />
      <EligibilityRow
        ok={fitsFleet}
        label="Vehicle type in your fleet"
        status={fitsFleet ? null : "Not in fleet"}
      />
      <EligibilityRow
        ok={eligibleCount > 0}
        label="Loads open for your bid"
        status={eligibleCount > 0 ? null : "None open"}
      />
      <Text style={styles.note}>Competing bids are not shown to bidders.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Theme.surfaceBorder,
    backgroundColor: Theme.cardWhite,
    padding: 18,
    gap: 10,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.6,
    color: Theme.textMuted,
    textTransform: "uppercase",
    ...WEB_COPY,
  },
  title: {
    fontSize: 16,
    fontWeight: "700",
    color: Theme.textPrimaryDark,
    letterSpacing: -0.2,
    lineHeight: 22,
    ...WEB_COPY,
  },
  body: {
    fontSize: 13,
    color: Theme.textSecondary,
    lineHeight: 18,
    ...WEB_COPY,
  },
  statRow: { flexDirection: "row", gap: 8, marginTop: 2 },
  stat: {
    flex: 1,
    minWidth: 0,
    gap: 4,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
  },
  statGrow: { flex: 1 },
  statTarget: {
    backgroundColor: Theme.driverCtaFill,
  },
  statApplies: {
    backgroundColor: Theme.buttonDark,
  },
  statLabelOnDark: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.4,
    textTransform: "uppercase",
    color: "rgba(255,255,255,0.72)",
    ...WEB_COPY,
  },
  statValueOnDark: {
    fontSize: 18,
    fontWeight: "800",
    color: Theme.textOnPrimary,
    letterSpacing: -0.3,
    lineHeight: 22,
    ...WEB_COPY,
  },
  /** Visually hidden but queryable for tests / a11y full phrasing. */
  statHiddenDetail: {
    position: "absolute",
    width: 1,
    height: 1,
    opacity: 0,
    overflow: "hidden",
  },
  blocked: {
    fontSize: 12,
    fontWeight: "600",
    color: Theme.warning,
    lineHeight: 16,
  },
  note: { fontSize: 12, color: Theme.textMuted, lineHeight: 17, ...WEB_COPY },
  cta: {
    marginTop: 4,
    minHeight: Layout.minTouchTargetSize,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Theme.buttonPrimary,
    borderWidth: Theme.buttonPrimaryBorderWidth,
    borderColor: Theme.buttonPrimaryBorder,
    borderRadius: Theme.buttonPrimaryRadius,
  },
  ctaDisabled: { opacity: 0.45 },
  ctaPressed: { opacity: 0.88 },
  ctaText: {
    fontSize: 14,
    fontWeight: "700",
    color: Theme.buttonPrimaryText,
    letterSpacing: -0.1,
  },
  banner: { borderRadius: 10, padding: 10, gap: 3 },
  bannerOk: { backgroundColor: Theme.positiveMuted },
  bannerOkText: { fontSize: 13, fontWeight: "600", color: Theme.positive },
  bannerWarn: { backgroundColor: Theme.warningMuted },
  bannerWarnTitle: { fontSize: 13, fontWeight: "700", color: Theme.warning },
  bannerWarnText: { fontSize: 12, color: Theme.textSecondary },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Theme.surfaceBorder,
    marginVertical: 6,
  },
  eligRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 28,
  },
  eligText: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    fontWeight: "500",
    color: Theme.textPrimaryDark,
    ...WEB_COPY,
  },
  eligTextOff: { color: Theme.textMuted },
  eligStatus: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    flexShrink: 0,
    maxWidth: "42%",
  },
  eligStatusText: {
    fontSize: 11,
    fontWeight: "600",
    color: Theme.driverGold,
  },
  eligStatusTextOff: {
    color: Theme.warning,
  },
});
