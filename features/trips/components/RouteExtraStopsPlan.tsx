import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import Theme from "@/constants/Theme";
import { formatINR } from "@/lib/format";

type StopRow = {
  id: string;
  sequence: number;
  stop_type: "pickup" | "drop";
  location: string;
  client_charge: number;
  supplier_charge: number;
};

type Props = {
  stops: readonly StopRow[];
  /** Which charge the viewer may see: owners "client", bidders/suppliers "supplier". */
  side: "client" | "supplier";
  style?: StyleProp<ViewStyle>;
};

/** Numbered list of the FTL stops between pickup and final drop, with each stop's charge. */
export function RouteExtraStopsPlan({ stops, side, style }: Props) {
  if (stops.length === 0) return null;
  const ordered = [...stops].sort((a, b) => a.sequence - b.sequence);
  return (
    <View style={[styles.wrap, style]} accessibilityRole="list">
      <Text style={styles.title}>
        {ordered.length === 1 ? "STOP IN BETWEEN" : `${ordered.length} STOPS IN BETWEEN`}
      </Text>
      {ordered.map((stop, i) => {
        const charge = side === "client" ? stop.client_charge : stop.supplier_charge;
        const kind = stop.stop_type === "pickup" ? "Extra pickup" : "Extra drop";
        const place = stop.location.trim() || "—";
        return (
          <View
            key={stop.id}
            style={styles.row}
            accessibilityLabel={`Stop ${i + 1}, ${kind}, ${place}${charge > 0 ? `, ${formatINR(charge)} extra` : ""}`}
          >
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{i + 1}</Text>
            </View>
            <View style={styles.body}>
              <Text style={styles.place} numberOfLines={2}>
                {place}
              </Text>
              <Text style={styles.kind}>{kind}</Text>
            </View>
            {charge > 0 ? (
              <Text style={styles.charge} numberOfLines={1}>
                +{formatINR(charge)}
              </Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 8,
    minWidth: 0,
  },
  title: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.6,
    color: Theme.textMuted,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minWidth: 0,
  },
  badge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Theme.primaryLight,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "800",
    color: Theme.textPrimaryDark,
  },
  body: {
    flex: 1,
    minWidth: 0,
  },
  place: {
    fontSize: 13,
    fontWeight: "700",
    color: Theme.textPrimaryDark,
  },
  kind: {
    marginTop: 1,
    fontSize: 10,
    fontWeight: "600",
    color: Theme.textRouteCard,
  },
  charge: {
    fontSize: 12,
    fontWeight: "700",
    color: Theme.positive,
  },
});
