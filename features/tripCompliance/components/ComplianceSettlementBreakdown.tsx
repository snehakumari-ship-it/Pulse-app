import { StyleSheet, Text, View } from "react-native";

import Theme from "@/constants/Theme";
import type {
  ComplianceSettlementSummary,
  SettlementLaneBreakdown,
} from "@/features/tripCompliance/utils/complianceSettlementSummary.util";
import { formatINR } from "@/lib/format";

type Row = { label: string; amount: number; sign?: "+" | "−"; strong?: boolean; muted?: boolean };

function Lane({
  title,
  rows,
  finalLabel,
  finalAmount,
  overLabel,
}: {
  title: string;
  rows: Row[];
  finalLabel: string;
  finalAmount: number;
  overLabel: string;
}) {
  const over = finalAmount < 0;
  return (
    <View style={styles.lane}>
      <Text style={styles.laneTitle}>{title}</Text>
      {rows.map((row) => (
        <View key={row.label} style={[styles.row, row.strong && styles.rowStrong]}>
          <Text style={[styles.rowLabel, row.muted && styles.rowMuted]}>{row.label}</Text>
          <Text style={[styles.rowAmount, row.strong && styles.rowAmountStrong, row.muted && styles.rowMuted]}>
            {row.sign ? `${row.sign} ` : ""}
            {formatINR(row.amount)}
          </Text>
        </View>
      ))}
      <View style={[styles.finalRow, over && styles.finalRowOver]}>
        <Text style={styles.finalLabel}>{over ? overLabel : finalLabel}</Text>
        <Text style={[styles.finalAmount, over && styles.finalAmountOver]}>{formatINR(Math.abs(finalAmount))}</Text>
      </View>
    </View>
  );
}

function noteRows(lane: SettlementLaneBreakdown, baseLabel: string): Row[] {
  return [
    { label: baseLabel, amount: lane.base },
    { label: "Debit notes (DN)", amount: lane.debitNotes, sign: "+", muted: lane.debitNotes === 0 },
    { label: "Credit notes (CN)", amount: lane.creditNotes, sign: "−", muted: lane.creditNotes === 0 },
    { label: "Revised total", amount: lane.revised, strong: true },
  ];
}

export function ComplianceSettlementBreakdown({
  summary,
  clientName,
  supplierName,
}: {
  summary: ComplianceSettlementSummary;
  clientName: string;
  supplierName: string;
}) {
  const { payable, receivable } = summary;
  return (
    <View style={styles.root}>
      <Text style={styles.title}>Final settlement</Text>
      <View style={styles.lanes}>
        <Lane
          title={`Payable to supplier · ${supplierName}`}
          rows={[
            ...noteRows(payable, "Supplier cost"),
            { label: "Advance paid", amount: payable.advancePaid, sign: "−", muted: payable.advancePaid === 0 },
            { label: "Other payments", amount: payable.otherPaid, sign: "−", muted: payable.otherPaid === 0 },
          ]}
          finalLabel="Final settlement to supplier"
          finalAmount={payable.balance}
          overLabel="Recover from supplier"
        />
        <Lane
          title={`Receivable from client · ${clientName}`}
          rows={[
            ...noteRows(receivable, "Client sale"),
            { label: "Received", amount: receivable.settled, sign: "−", muted: receivable.settled === 0 },
          ]}
          finalLabel="Balance due from client"
          finalAmount={receivable.balance}
          overLabel="Refund to client"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    marginTop: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Theme.complianceCardBorder,
    backgroundColor: Theme.cardWhite,
    gap: 10,
  },
  title: { fontSize: 15, fontWeight: "700", color: Theme.textPrimaryDark },
  lanes: { flexDirection: "row", flexWrap: "wrap", gap: 16 },
  lane: { flex: 1, minWidth: 260, gap: 6 },
  laneTitle: { fontSize: 12, fontWeight: "700", color: Theme.textSecondary, marginBottom: 2 },
  row: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  rowStrong: {
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: Theme.complianceCardBorder,
  },
  rowLabel: { fontSize: 13, color: Theme.textPrimaryDark },
  rowAmount: { fontSize: 13, color: Theme.textPrimaryDark, fontVariant: ["tabular-nums"] },
  rowAmountStrong: { fontWeight: "700" },
  rowMuted: { color: Theme.textMuted },
  finalRow: {
    marginTop: 4,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: Theme.complianceStageSuccessBg,
  },
  finalRowOver: { backgroundColor: Theme.negativeMuted },
  finalLabel: { fontSize: 13, fontWeight: "700", color: Theme.textPrimaryDark },
  finalAmount: { fontSize: 15, fontWeight: "800", color: Theme.textPrimaryDark, fontVariant: ["tabular-nums"] },
  finalAmountOver: { color: Theme.negative },
});
