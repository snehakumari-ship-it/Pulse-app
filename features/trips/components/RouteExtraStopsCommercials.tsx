import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import Theme from "@/constants/Theme";
import {
  extraStopChipLabel,
  freightWithExtraStops,
  type RouteExtraStopSummary,
} from "@/features/trips/utils/routeExtraStops.util";
import { formatINR } from "@/lib/format";

type Props = {
  summary: RouteExtraStopSummary;
  /** Base client freight (before stops). */
  clientBase: number;
  /** Base supplier freight (before stops). Omit to hide the supplier side. */
  supplierBase?: number | null;
  /** Per-MT supplier rates are not trip totals; stop charges are not folded in. */
  supplierPerMt?: boolean;
  style?: StyleProp<ViewStyle>;
};

function Row({
  label,
  base,
  extra,
  total,
}: {
  label: string;
  base: number;
  extra: number;
  total: number | null;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={styles.rowMath} numberOfLines={1}>
        {base > 0 ? formatINR(base) : "—"}
        <Text style={styles.rowExtra}>{`  + ${formatINR(extra)}`}</Text>
      </Text>
      <Text style={styles.rowTotal} numberOfLines={1}>
        {total != null && total > 0 ? formatINR(total) : "—"}
      </Text>
    </View>
  );
}

/** Base + extra-stop charges = saved freight, for client, supplier and margin. */
export function RouteExtraStopsCommercials({
  summary,
  clientBase,
  supplierBase = null,
  supplierPerMt = false,
  style,
}: Props) {
  const chip = extraStopChipLabel(summary.count);
  if (!chip) return null;
  const showSupplier = supplierBase != null && !supplierPerMt;
  const totals = freightWithExtraStops(
    { client: clientBase, supplier: showSupplier ? supplierBase : 0 },
    summary,
  );
  const margin =
    showSupplier && totals.client > 0 && totals.supplier > 0
      ? totals.client - totals.supplier
      : null;

  return (
    <View style={[styles.card, style]} accessibilityLabel={`${chip} in between, commercials`}>
      <View style={styles.header}>
        <View style={styles.chip}>
          <Text style={styles.chipText}>{chip}</Text>
        </View>
        <Text style={styles.headerText} numberOfLines={2}>
          Extra stop charges are added to the freight
        </Text>
      </View>
      <View style={styles.colHeads}>
        <Text style={styles.colHead}> </Text>
        <Text style={[styles.colHead, styles.colHeadMath]}>Base + stops</Text>
        <Text style={[styles.colHead, styles.colHeadTotal]}>Total</Text>
      </View>
      <Row
        label="Client pays"
        base={clientBase}
        extra={summary.clientCharge}
        total={totals.client}
      />
      {showSupplier ? (
        <Row
          label="Supplier paid"
          base={supplierBase ?? 0}
          extra={summary.supplierCharge}
          total={totals.supplier}
        />
      ) : null}
      {margin != null ? (
        <View style={[styles.row, styles.marginRow]}>
          <Text style={styles.rowLabel}>Margin incl. stops</Text>
          <Text style={styles.rowMath} />
          <Text
            style={[styles.rowTotal, margin >= 0 ? styles.positive : styles.negative]}
            numberOfLines={1}
          >
            {formatINR(margin)}
          </Text>
        </View>
      ) : null}
      {supplierPerMt && summary.supplierCharge > 0 ? (
        <Text style={styles.note}>
          Supplier target is per MT — supplier stop charges ({formatINR(summary.supplierCharge)}) are
          settled on top of the trip total.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: "100%",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Theme.borderLight,
    backgroundColor: Theme.cardWhite,
    padding: 12,
    gap: 6,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 2,
  },
  chip: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: Theme.primaryLight,
  },
  chipText: {
    fontSize: 11,
    fontWeight: "700",
    color: Theme.textPrimaryDark,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
    fontSize: 12,
    fontWeight: "600",
    color: Theme.textRouteCard,
  },
  colHeads: {
    flexDirection: "row",
    alignItems: "center",
  },
  colHead: {
    flex: 1,
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    color: Theme.textMuted,
  },
  colHeadMath: {
    flex: 1.4,
  },
  colHeadTotal: {
    textAlign: "right",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 28,
  },
  marginRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Theme.borderLight,
    paddingTop: 4,
  },
  rowLabel: {
    flex: 1,
    minWidth: 0,
    fontSize: 12,
    fontWeight: "600",
    color: Theme.textPrimaryDark,
  },
  rowMath: {
    flex: 1.4,
    minWidth: 0,
    fontSize: 12,
    fontWeight: "500",
    color: Theme.textRouteCard,
  },
  rowExtra: {
    fontWeight: "700",
    color: Theme.primary,
  },
  rowTotal: {
    flex: 1,
    minWidth: 0,
    textAlign: "right",
    fontSize: 13,
    fontWeight: "800",
    color: Theme.textPrimaryDark,
  },
  positive: {
    color: Theme.positive,
  },
  negative: {
    color: Theme.warning,
  },
  note: {
    fontSize: 11,
    lineHeight: 15,
    color: Theme.textRouteCard,
  },
});
