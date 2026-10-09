import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import Theme from "@/constants/Theme";
import { splitHubRouteLocationDisplay } from "@/features/trips/utils/tripLocationDisplay.util";
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

type TimelineProps = Props & {
  origin: string;
  destination: string;
  /** Right-aligned header summary, e.g. "1 stop · incl. ₹ 2,500 extra paid". */
  summary?: string | null;
};

type TimelinePoint = {
  key: string;
  kicker: string;
  city: string;
  detail: string;
  charge: number;
  tone: "pickup" | "stop" | "drop";
  index?: number;
};

/** Horizontal pickup → stops → drop plan for wide layouts. */
export function RouteStopsTimeline({ stops, side, origin, destination, summary, style }: TimelineProps) {
  if (stops.length === 0) return null;
  const ordered = [...stops].sort((a, b) => a.sequence - b.sequence);
  const end = (key: string, kicker: string, location: string, tone: "pickup" | "drop"): TimelinePoint => {
    const { city, state } = splitHubRouteLocationDisplay(location);
    return { key, kicker, city, detail: state, charge: 0, tone };
  };
  const points: TimelinePoint[] = [
    end("origin", "PICKUP", origin, "pickup"),
    ...ordered.map((stop, i) => {
      const { city, state } = splitHubRouteLocationDisplay(stop.location);
      return {
        key: stop.id,
        kicker: `STOP ${i + 1} · ${stop.stop_type === "pickup" ? "PICKUP" : "DROP"}`,
        city,
        detail: state,
        charge: side === "client" ? stop.client_charge : stop.supplier_charge,
        tone: "stop" as const,
        index: i + 1,
      };
    }),
    end("destination", "FINAL DROP", destination, "drop"),
  ];
  const last = points.length - 1;

  return (
    <View style={[timeline.wrap, style]} accessibilityRole="list">
      <View style={timeline.header}>
        <Text style={timeline.title}>ROUTE PLAN</Text>
        {summary ? (
          <Text style={timeline.summary} numberOfLines={1}>
            {summary}
          </Text>
        ) : null}
      </View>
      <View style={timeline.track}>
        <View style={timeline.line} />
        {points.map((p, i) => {
          const align = i === 0 ? "flex-start" : i === last ? "flex-end" : "center";
          const textAlign = i === 0 ? "left" : i === last ? "right" : "center";
          return (
            <View
              key={p.key}
              style={[timeline.point, { alignItems: align }]}
              accessibilityLabel={`${p.kicker}, ${p.city}${p.detail ? `, ${p.detail}` : ""}${p.charge > 0 ? `, ${formatINR(p.charge)} extra` : ""}`}
            >
              {p.tone === "stop" ? (
                <View style={timeline.stopBadge}>
                  <Text style={timeline.stopBadgeText}>{p.index}</Text>
                </View>
              ) : (
                <View style={timeline.endRing}>
                  <View
                    style={[
                      timeline.endDot,
                      { backgroundColor: p.tone === "pickup" ? Theme.routePickupPin : Theme.positive },
                    ]}
                  />
                </View>
              )}
              <Text style={[timeline.kicker, { textAlign }]} numberOfLines={1}>
                {p.kicker}
              </Text>
              <Text style={[timeline.city, { textAlign }]} numberOfLines={1}>
                {p.city}
              </Text>
              {p.detail ? (
                <Text style={[timeline.detail, { textAlign }]} numberOfLines={1}>
                  {p.detail}
                </Text>
              ) : null}
              {p.charge > 0 ? (
                <View style={timeline.chargePill}>
                  <Text style={timeline.chargeText}>+{formatINR(p.charge)}</Text>
                </View>
              ) : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}

const MARKER = 22;

const timeline = StyleSheet.create({
  wrap: {
    gap: 12,
    minWidth: 0,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  title: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.8,
    color: Theme.textMuted,
  },
  summary: {
    flexShrink: 1,
    fontSize: 11,
    fontWeight: "700",
    color: Theme.textRouteCard,
  },
  track: {
    flexDirection: "row",
    minWidth: 0,
  },
  line: {
    position: "absolute",
    top: MARKER / 2 - 1,
    left: MARKER / 2,
    right: MARKER / 2,
    height: 2,
    borderRadius: 1,
    backgroundColor: Theme.borderInput,
  },
  point: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  endRing: {
    width: MARKER,
    height: MARKER,
    borderRadius: MARKER / 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Theme.surface,
    borderWidth: 1,
    borderColor: Theme.borderInput,
    marginBottom: 6,
  },
  endDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  stopBadge: {
    width: MARKER,
    height: MARKER,
    borderRadius: MARKER / 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Theme.textPrimaryDark,
    marginBottom: 6,
  },
  stopBadgeText: {
    fontSize: 11,
    fontWeight: "800",
    color: Theme.surface,
  },
  kicker: {
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.6,
    color: Theme.textMuted,
    maxWidth: "100%",
  },
  city: {
    fontSize: 14,
    fontWeight: "800",
    color: Theme.textPrimaryDark,
    maxWidth: "100%",
  },
  detail: {
    fontSize: 11,
    fontWeight: "500",
    color: Theme.textRouteCard,
    maxWidth: "100%",
  },
  chargePill: {
    marginTop: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: Theme.positiveMuted,
  },
  chargeText: {
    fontSize: 11,
    fontWeight: "800",
    color: Theme.positive,
  },
});

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
