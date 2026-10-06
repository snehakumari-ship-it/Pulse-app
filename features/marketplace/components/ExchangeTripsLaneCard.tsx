/**
 * Finance "Marketplace trips" lane: Exchange trips this org owes on (payer) or
 * is owed on (payee). Each row opens the org's own trip, where payments are
 * recorded and confirmed. Renders nothing when there are no such trips.
 */
import Theme from "@/constants/Theme";
import { useExchangeTripsLaneQuery } from "@/features/marketplace/hooks/useExchangeTripPayments";
import type { ExchangeSide } from "@/features/marketplace/services/exchangePayments.service";
import {
  exchangeLaneRows,
  type ExchangeLaneContactFilter,
  type ExchangeLaneRow,
  type ExchangeLaneStatus,
} from "@/features/marketplace/utils/exchangeLane.util";
import { formatINR } from "@/lib/format";
import { ROUTES } from "@/lib/routes";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

const COLLAPSED_LIMIT = 5;

const STATUS_LABEL: Record<ExchangeLaneStatus, string> = {
  settled: "Settled",
  awaiting_you: "Awaiting your confirmation",
  awaiting_them: "Awaiting their confirmation",
  open: "Open",
};

function statusColor(status: ExchangeLaneStatus): string {
  if (status === "settled") return Theme.positive;
  if (status === "open") return Theme.textMuted;
  return Theme.warning;
}

export interface ExchangeTripsLaneCardProps {
  organizationId: string | null;
  side: ExchangeSide;
  contactFilter?: ExchangeLaneContactFilter;
}

export function ExchangeTripsLaneCard({ organizationId, side, contactFilter = "all" }: ExchangeTripsLaneCardProps) {
  const router = useRouter();
  const { data: trips = [] } = useExchangeTripsLaneQuery(organizationId);
  const rows = useMemo(() => exchangeLaneRows(trips, side, contactFilter), [trips, side, contactFilter]);
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);

  if (rows.length === 0) return null;

  const outstanding = rows.reduce((sum, r) => sum + r.outstanding, 0);
  const awaitingYou = rows.filter((r) => r.status === "awaiting_you").length;
  const visible = showAll ? rows : rows.slice(0, COLLAPSED_LIMIT);

  return (
    <View style={styles.card}>
      <TouchableOpacity
        style={styles.header}
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel="Marketplace trips"
      >
        <View style={styles.headerText}>
          <Text style={styles.title}>Marketplace trips · {rows.length}</Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {formatINR(outstanding)} {side === "payer" ? "to pay" : "to receive"} through Pulse Exchange
            {awaitingYou > 0 ? ` · ${awaitingYou} awaiting your confirmation` : ""}
          </Text>
        </View>
        <Text style={styles.chevron}>{open ? "▾" : "▸"}</Text>
      </TouchableOpacity>
      {open ? (
        <View>
          {visible.map((row) => (
            <LaneRow
              key={row.trip.trip_id}
              row={row}
              onPress={() => router.push(ROUTES.tripDetail(row.trip.viewer_trip_id))}
            />
          ))}
          {rows.length > COLLAPSED_LIMIT ? (
            <TouchableOpacity style={styles.more} onPress={() => setShowAll((v) => !v)} accessibilityRole="button">
              <Text style={styles.moreText}>{showAll ? "Show fewer" : `Show all ${rows.length}`}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function LaneRow({ row, onPress }: { row: ExchangeLaneRow; onPress: () => void }) {
  const { trip } = row;
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} accessibilityRole="button">
      <View style={styles.rowMain}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {trip.viewer_trip_number ?? trip.trip_number ?? "Trip"} · {trip.ledger_contact_name ?? "—"}
        </Text>
        <Text style={[styles.rowStatus, { color: statusColor(row.status) }]} numberOfLines={1}>
          {STATUS_LABEL[row.status]}
          {row.overdue ? " · overdue" : ""}
        </Text>
      </View>
      <View style={styles.rowAmounts}>
        <Text style={styles.rowAmount}>{formatINR(row.outstanding)}</Text>
        <Text style={styles.rowAgreed}>of {formatINR(Number(trip.agreed_amount))}</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Theme.borderLight,
    backgroundColor: Theme.surface,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    minHeight: 44,
    gap: 8,
  },
  headerText: { flex: 1, minWidth: 0 },
  title: { fontSize: 13, fontWeight: "700", color: Theme.textPrimaryDark },
  subtitle: { fontSize: 11, color: Theme.textMuted, marginTop: 2 },
  chevron: { fontSize: 14, color: Theme.textMuted },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    minHeight: 44,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Theme.borderLight,
    gap: 8,
  },
  rowMain: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 13, fontWeight: "600", color: Theme.textPrimary },
  rowStatus: { fontSize: 11, marginTop: 2 },
  rowAmounts: { alignItems: "flex-end" },
  rowAmount: { fontSize: 13, fontWeight: "700", color: Theme.textPrimaryDark },
  rowAgreed: { fontSize: 11, color: Theme.textMuted },
  more: {
    paddingVertical: 10,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Theme.borderLight,
  },
  moreText: { fontSize: 12, fontWeight: "600", color: Theme.primary },
});
