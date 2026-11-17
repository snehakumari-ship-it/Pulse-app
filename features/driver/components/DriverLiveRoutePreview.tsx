/**
 * Compact live-route thumbnail. Tap opens the full mission map.
 * The camera is derived from the route so the line sits on the right
 * and the caption stays readable on the left.
 */
import { LeafletMap } from "@/components/driver/LeafletMap";
import type {
  LeafletLatLng,
  LeafletMarker,
  LeafletPolylineLayer,
} from "@/components/driver/LeafletMap.types";
import Theme from "@/constants/Theme";
import { withAlpha } from "@/lib/color";
import { withWebSafeShadows } from "@/lib/platformViewStyle.util";
import { LinearGradient } from "expo-linear-gradient";
import { useMemo, useRef } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

type Props = {
  points: LeafletLatLng[];
  caption: string;
  onPress: () => void;
  borderColor: string;
};

function routeCamera(points: LeafletLatLng[]): { center: LeafletLatLng; zoom: number } {
  let minLat = 90;
  let maxLat = -90;
  let minLng = 180;
  let maxLng = -180;
  for (const point of points) {
    minLat = Math.min(minLat, point.latitude);
    maxLat = Math.max(maxLat, point.latitude);
    minLng = Math.min(minLng, point.longitude);
    maxLng = Math.max(maxLng, point.longitude);
  }
  const latSpan = Math.max(maxLat - minLat, 0.004);
  const lngSpan = Math.max(maxLng - minLng, 0.004);
  const midLat = (minLat + maxLat) / 2;
  const midLng = (minLng + maxLng) / 2;
  const cos = Math.max(Math.cos((midLat * Math.PI) / 180), 0.2);
  const latZoom = Math.log2((96 * 360) / (latSpan * 256));
  // Route fills the right portion of the card; the caption owns the left.
  const lngZoom = Math.log2((150 * 360) / (lngSpan * 256 * cos));
  const zoom = Math.round(Math.max(10, Math.min(14.5, Math.min(latZoom, lngZoom))) * 10) / 10;
  const visibleLng = (340 * 360) / (256 * Math.pow(2, zoom) * cos);
  return {
    center: {
      latitude: Math.round(midLat * 1000) / 1000,
      longitude: Math.round((midLng - visibleLng * 0.18) * 1000) / 1000,
    },
    zoom,
  };
}

function routeLayers(points: LeafletLatLng[]): LeafletPolylineLayer[] {
  if (points.length < 2) return [];
  if (points.length < 6) {
    return [
      {
        id: "preview-route",
        coordinates: points,
        color: Theme.textPrimaryDark,
        width: 4,
        glowWidth: 7,
      },
    ];
  }
  const cut = Math.max(2, Math.min(points.length - 2, Math.round(points.length * 0.22)));
  return [
    {
      id: "preview-route-rest",
      coordinates: points.slice(cut),
      color: Theme.textPrimaryDark,
      width: 4,
      glowWidth: 7,
    },
    {
      id: "preview-route-lead",
      coordinates: points.slice(0, cut + 1),
      color: Theme.warning,
      width: 4,
      glowWidth: 7,
    },
  ];
}

export function DriverLiveRoutePreview({ points, caption, onPress, borderColor }: Props) {
  const pointsRef = useRef(points);
  pointsRef.current = points;
  const routeKey = points
    .map((point) =>
      Number.isFinite(point.latitude) && Number.isFinite(point.longitude)
        ? `${point.latitude.toFixed(4)},${point.longitude.toFixed(4)}`
        : "",
    )
    .filter(Boolean)
    .join("|");
  const usable = useMemo(() => {
    if (!routeKey) return [];
    return pointsRef.current.filter(
      (point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude),
    );
  }, [routeKey]);
  const camera = useMemo(() => (usable.length > 0 ? routeCamera(usable) : null), [usable]);
  const layers = useMemo(() => routeLayers(usable), [usable]);
  const markers = useMemo<LeafletMarker[]>(() => {
    if (usable.length === 0) return [];
    const start = usable[0]!;
    const end = usable[usable.length - 1]!;
    const pins: LeafletMarker[] = [
      {
        id: "preview-start",
        coordinate: start,
        color: Theme.negative,
      },
    ];
    if (
      Math.abs(end.latitude - start.latitude) > 0.00001 ||
      Math.abs(end.longitude - start.longitude) > 0.00001
    ) {
      pins.push({
        id: "preview-end",
        coordinate: end,
        color: Theme.driverEmerald,
      });
    }
    return pins;
  }, [usable]);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        { borderColor, opacity: pressed ? 0.94 : 1 },
      ]}
      accessibilityRole="button"
      accessibilityLabel="View live route"
    >
      <View style={styles.mapShell} pointerEvents="none">
        {camera ? (
          <LeafletMap
            style={styles.map}
            center={camera.center}
            zoom={camera.zoom}
            markers={markers}
            polylines={layers}
            lowPower
            interactionLocked
            showZoomControls={false}
            autoFitBoundsOnRouteChange={false}
          />
        ) : (
          <View style={styles.fallback}>
            <View style={[styles.fallbackPin, { backgroundColor: Theme.driverEmerald }]} />
            <View style={styles.fallbackTrack} />
            <View style={[styles.fallbackPin, { backgroundColor: Theme.negative }]} />
          </View>
        )}
      </View>
      <LinearGradient
        pointerEvents="none"
        colors={[
          withAlpha(Theme.cardWhite, 0.94),
          withAlpha(Theme.cardWhite, 0.72),
          withAlpha(Theme.cardWhite, 0),
        ]}
        locations={[0, 0.42, 0.78]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={styles.scrim}
      />
      <View style={styles.copy} pointerEvents="none">
        <Text style={styles.kicker}>VIEW LIVE ROUTE</Text>
        <Text style={styles.caption} numberOfLines={2}>
          {caption}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create(
  withWebSafeShadows({
    card: {
      height: 118,
      borderRadius: 22,
      borderWidth: 1,
      overflow: "hidden",
      backgroundColor: Theme.cardWhite,
      shadowColor: Theme.shadow,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.06,
      shadowRadius: 8,
      elevation: 2,
    },
    mapShell: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: Theme.surfaceGray,
    },
    map: {
      ...StyleSheet.absoluteFillObject,
    },
    fallback: {
      flex: 1,
      marginHorizontal: 16,
      marginVertical: 36,
      borderRadius: 12,
      backgroundColor: Theme.driverEmeraldMuted,
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 14,
      gap: 8,
    },
    fallbackPin: {
      width: 10,
      height: 10,
      borderRadius: 5,
    },
    fallbackTrack: {
      flex: 1,
      height: 3,
      borderRadius: 2,
      backgroundColor: Theme.driverEmeraldBorderSoft,
    },
    scrim: {
      ...StyleSheet.absoluteFillObject,
    },
    copy: {
      ...StyleSheet.absoluteFillObject,
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingTop: 14,
      paddingBottom: 14,
      maxWidth: "72%",
    },
    kicker: {
      color: Theme.textPrimaryDark,
      fontSize: 13,
      fontWeight: "800",
      letterSpacing: 0.4,
    },
    caption: {
      color: Theme.textPrimaryDark,
      fontSize: 15,
      fontWeight: "800",
      letterSpacing: 0.2,
    },
  }),
);
