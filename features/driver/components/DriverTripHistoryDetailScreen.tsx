/**
 * Full-screen trip history detail (stack route).
 */
import { LoadingIndicator } from "@/components/LoadingIndicator";
import Layout from "@/constants/Layout";
import Theme from "@/constants/Theme";
import { useAuth } from "@/contexts/AuthContext";
import { useDriverTheme, useDriverThemeColors } from "@/contexts/DriverThemeContext";
import { useRegisterDriverContextTrip } from "@/contexts/DriverTripOpsContext";
import { DriverDocumentGalleryPreview } from "@/features/driver/components/DriverDocumentGalleryPreview";
import { DriverTripOperationsTab } from "@/features/driver/components/DriverTripOperationsTab";
import { TripDetailSettlementPanel } from "@/features/driver/components/TripDetailSettlementPanel";
import { getTripAppLocationsForTimeline } from "@/features/driver/services/driverLocation.service";
import { tripHistoryDetailStyles as styles } from "@/features/driver/tripHistory/tripHistoryDetail.styles";
import {
    attachDriverAppLocations,
    buildMissionLog,
    getTripProgressTitle,
    isCompleted,
    isInTransitStatus,
    parseTripCoordinate,
    toEtaInterval,
    type DriverAppLocationPoint,
} from "@/features/driver/tripHistory/tripHistoryDetail.util";
import {
    buildDriverTripNumberMap,
    getDriverTripDisplayNumber,
} from "@/features/driver/utils/driverTripSequence.util";
import { DriverCollectFromSheet } from "@/features/drivers/components/DriverCollectFromSheet";
import * as driversService from "@/features/drivers/services/drivers.service";
import * as salaryRequestsService from "@/features/drivers/services/salaryRequests.service";
import { driverCaptureLaneForTrip } from "@/features/drivers/utils/driverCapturePayment.util";
import {
    canTagPartyOnTrip,
    isTripTaggedToParty,
    tripNeedsPartyTag,
    tripReceivablePartyName,
} from "@/features/drivers/utils/driverPartyReceivables.util";
import { resolveDriverTripPayoutTerms } from "@/features/drivers/utils/driverUtils.util";
import {
    formatEtaFromRouteSeconds,
    formatRoadDistanceM,
} from "@/features/trips/domain/tripStageEta";
import { getLatestAssignmentAuditByTripIds } from "@/features/trips/services/trip-assignment-audit.service";
import * as tripDocumentsService from "@/features/trips/services/tripDocuments.service";
import * as tripsService from "@/features/trips/services/trips.service";
import {
    buildAssignerDisplayForTrip,
} from "@/features/trips/utils/driverAssignerDisplay.util";
import { releaseStoragePreviewUrl } from "@/features/trips/utils/storagePreviewObjectUrl.util";
import { splitHubRouteLocationDisplay } from "@/features/trips/utils/tripLocationDisplay.util";
import { useTripVerificationSync } from "@/features/trips/verification";
import { formatLedgerDateTime } from "@/lib/format";
import { formatEstimatedDuration } from "@/lib/formatEstimatedDuration";
import { haversineKm, lookupIndianCityCoordinate } from "@/lib/indianCityCoordinates.util";
import { withWebSafeShadows } from "@/lib/platformViewStyle.util";
import { useDriverOperatingModeQuery } from "@/lib/queries/useDriverOperatingModeQuery";
import { reverseGeocodeCityStateLabel } from "@/lib/reverseGeocodePlace.util";
import { ROUTES } from "@/lib/routes";
import { getOptimalRoute } from "@/lib/routingService";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useFocusEffect } from "@react-navigation/native";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter, type Href } from "expo-router";
import {
    Calendar,
    CheckCircle2,
    ChevronDown,
    ChevronUp,
    Clock,
    FileImage,
    Flag,
    MapPin,
    MessageSquare,
    MoreVertical,
    Navigation,
    Share2,
    ShieldCheck,
    Tag,
    Truck,
} from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
    Alert,
    Image,
    ScrollView,
    Share,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import Animated, {
    cancelAnimation,
    useAnimatedStyle,
    useSharedValue,
    withRepeat,
    withSequence,
    withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const HERO_GRADIENT_LIGHT = [
  Theme.tripsCardWashStart,
  Theme.tripsCardWashMid,
  Theme.cardWhite,
] as const;
const HERO_GRADIENT_DARK = ["#042421", "#06332C", "#0A4D40"] as const;

function webMercator(lat: number, lon: number, zoom: number) {
  const scale = 256 * 2 ** zoom;
  const x = ((lon + 180) / 360) * scale;
  const sine = Math.sin((lat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI)) * scale;
  return { x, y };
}

function resolveHistoryStop(
  lat: unknown,
  lon: unknown,
  label: string,
): { latitude: number; longitude: number } | null {
  const latitude = parseTripCoordinate(lat);
  const longitude = parseTripCoordinate(lon);
  if (latitude != null && longitude != null) return { latitude, longitude };
  const hub = splitHubRouteLocationDisplay(label);
  return lookupIndianCityCoordinate(hub.city) ?? lookupIndianCityCoordinate(label);
}

function humanizeDurationLabel(raw: string | null | undefined): string {
  const formatted = formatEstimatedDuration(raw);
  if (!formatted || formatted === "—") return "—";
  const hm = formatted.match(/^(\d+)H(?:\s+(\d+)M)?$/i);
  if (hm) {
    const hours = Number(hm[1]);
    const minutes = hm[2] ? Number(hm[2]) : 0;
    if (hours <= 0) return `${minutes} min`;
    return minutes > 0 ? `${hours} hr ${minutes} min` : `${hours} hr`;
  }
  const onlyM = formatted.match(/^(\d+)M$/i);
  if (onlyM) return `${onlyM[1]} min`;
  const onlyH = formatted.match(/^(\d+(?:\.\d+)?)H$/i);
  if (onlyH) {
    const hours = Number(onlyH[1]);
    if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
    const whole = Math.floor(hours);
    const minutes = Math.round((hours - whole) * 60);
    return minutes > 0 ? `${whole} hr ${minutes} min` : `${whole} hr`;
  }
  return formatted;
}

function partyInitials(name: string): string {
  const parts = name.split(/\s+/).filter((part) => /[A-Za-z0-9]/.test(part));
  const letters = parts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "");
  return letters.join("") || "•";
}

function TimelineStepIcon({ status }: { status: string }) {
  const key = status.trim().toLowerCase();
  const color = Theme.textOnPrimary;
  if (key.includes("deliver") || key.includes("complete") || key.includes("done")) {
    return <Flag size={11} color={color} />;
  }
  if (key.includes("transit")) return <Truck size={11} color={color} />;
  if (key.includes("pick")) return <MapPin size={11} color={color} />;
  return <CheckCircle2 size={11} color={color} />;
}

function HeroRouteBackdrop({
  from,
  to,
  width,
  height,
  light,
}: {
  from: { latitude: number; longitude: number } | null;
  to: { latitude: number; longitude: number } | null;
  width: number;
  height: number;
  light: boolean;
}) {
  const focus = from ?? to;
  const end = to ?? from;
  const [failed, setFailed] = useState(false);
  if (!focus || !end || width < 8 || height < 8) return null;

  let zoom = 12;
  for (let z = 13; z >= 5; z -= 1) {
    const a = webMercator(focus.latitude, focus.longitude, z);
    const b = webMercator(end.latitude, end.longitude, z);
    zoom = z;
    if (Math.abs(a.x - b.x) <= width * 0.42 && Math.abs(a.y - b.y) <= 90) break;
  }
  const mid = {
    latitude: (focus.latitude + end.latitude) / 2,
    longitude: (focus.longitude + end.longitude) / 2,
  };
  const world = webMercator(mid.latitude, mid.longitude, zoom);
  const tileX = Math.floor(world.x / 256);
  const tileY = Math.floor(world.y / 256);
  const scale = Math.max(width, 420) / 256;
  const anchorX = width * 0.7;
  const anchorY = 78;
  const left = anchorX - (world.x - tileX * 256) * scale;
  const top = anchorY - (world.y - tileY * 256) * scale;

  return (
    <View style={styles.tdHeroMap} pointerEvents="none">
      {failed ? null : (
        <Image
          source={{
            uri: `https://basemaps.cartocdn.com/${light ? "light_nolabels" : "dark_all"}/${zoom}/${tileX}/${tileY}@2x.png`,
          }}
          style={[styles.tdHeroMapTile, { width: 256 * scale, height: 256 * scale, left, top }]}
          onError={() => setFailed(true)}
        />
      )}
      <LinearGradient
        colors={
          light
            ? [Theme.cardWhite, "rgba(255,255,255,0.92)", "rgba(244,251,250,0.55)"]
            : ["#042421", "rgba(4,36,33,0.78)", "rgba(4,36,33,0.2)"]
        }
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.35 }}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

function PartyMark({ name, logoUrl }: { name: string; logoUrl?: string | null }) {
  return (
    <View style={styles.tdHeroPartyMark}>
      {logoUrl ? (
        <Image source={{ uri: logoUrl }} style={styles.tdHeroPartyLogo} />
      ) : (
        <Text style={styles.tdHeroPartyInitials}>{partyInitials(name)}</Text>
      )}
    </View>
  );
}

function TimelinePulseIcon({
  expanded,
  children,
  style,
}: {
  expanded: boolean;
  children: ReactNode;
  style?: object;
}) {
  const scale = useSharedValue(1);
  useEffect(() => {
    cancelAnimation(scale);
    if (expanded) {
      scale.value = withRepeat(
        withSequence(withTiming(1.07, { duration: 700 }), withTiming(1, { duration: 700 })),
        -1,
        false,
      );
    } else {
      scale.value = withTiming(1, { duration: 220 });
    }
  }, [expanded, scale]);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));
  return <Animated.View style={[animatedStyle, style]}>{children}</Animated.View>;
}

export type DriverTripHistoryDetailScreenProps = {
  tripId: string;
  initialTab?: "journey" | "operations" | "settlement";
  initialSelectedExpenseId?: string | null;
};

const mountedDriverDetailTrips = new Map<string, tripsService.TripRow>();

/** Currently mounted Driver Trip Detail trip, if any. Used by Odometer/Expense routes to skip a redundant fetch. */
export function peekMountedDriverDetailTrip(tripId: string): tripsService.TripRow | null {
  const id = tripId.trim();
  if (!id) return null;
  return mountedDriverDetailTrips.get(id) ?? null;
}

export function rememberMountedDriverDetailTrip(
  tripId: string,
  trip: tripsService.TripRow | null,
): void {
  const id = tripId.trim();
  if (!id) return;
  if (trip && trip.id === id) mountedDriverDetailTrips.set(id, trip);
  else mountedDriverDetailTrips.delete(id);
}

export function forgetMountedDriverDetailTrip(tripId: string): void {
  const id = tripId.trim();
  if (id) mountedDriverDetailTrips.delete(id);
}

export function DriverTripHistoryDetailScreen({
  tripId,
  initialTab,
  initialSelectedExpenseId,
}: DriverTripHistoryDetailScreenProps) {
  const insets = useSafeAreaInsets();
  const { profile } = useAuth();
  const colors = useDriverThemeColors();
  const { theme } = useDriverTheme();
  const isDark = theme === "dark";
  const router = useRouter();
  useTripVerificationSync();
  const [trip, setTrip] = useState<tripsService.TripRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [driver, setDriver] = useState<driversService.DriverRow | null>(null);
  const [invites, setInvites] = useState<
    Awaited<ReturnType<typeof driversService.getDriverInvitesReceived>>["invites"]
  >([]);
  const [assignmentActorByTripId, setAssignmentActorByTripId] = useState<Record<string, string>>({});
  const [routeMetricsByTripId, setRouteMetricsByTripId] = useState<
    Record<string, { distance: number; estimated_duration: string; meters: number; seconds: number }>
  >({});
  const [heroStops, setHeroStops] = useState<{
    from: { latitude: number; longitude: number } | null;
    to: { latitude: number; longitude: number } | null;
  }>({ from: null, to: null });
  const [heroCardSize, setHeroCardSize] = useState({ width: 0, height: 0 });
  const [detailTab, setDetailTab] = useState<"journey" | "operations" | "settlement">(
    initialTab ?? (initialSelectedExpenseId ? "settlement" : "journey"),
  );
  const [collectFromOpen, setCollectFromOpen] = useState(false);
  const [expandedLogIndex, setExpandedLogIndex] = useState<number | null>(null);
  const [detailPodDocuments, setDetailPodDocuments] = useState<tripDocumentsService.TripDocumentRow[]>([]);
  const [detailPodLoading, setDetailPodLoading] = useState(false);
  const [detailPodViewUrls, setDetailPodViewUrls] = useState<Record<string, string>>({});
  const detailPodUrlRequestedRef = useRef<Set<string>>(new Set());
  const [podPreviewIndex, setPodPreviewIndex] = useState<number | null>(null);
  const resolveDetailPodPreview = useCallback(
    async (doc: tripDocumentsService.TripDocumentRow): Promise<string | null> => {
      const cached = detailPodViewUrls[doc.id];
      if (cached) return cached;
      const url = await tripDocumentsService.tryGetDocumentViewUrl(doc.storage_path);
      if (!url) return null;
      setDetailPodViewUrls((prev) => ({ ...prev, [doc.id]: url }));
      return url;
    },
    [detailPodViewUrls],
  );

  useRegisterDriverContextTrip(trip);
  const heldPodPreviewUrls = useRef<Map<string, string>>(new Map());
  useEffect(() => () => {
    for (const url of heldPodPreviewUrls.current.values()) releaseStoragePreviewUrl(url);
    heldPodPreviewUrls.current.clear();
  }, []);
  const retainPodPreview = (docId: string, url: string | null) => {
    const previous = heldPodPreviewUrls.current.get(docId);
    if (previous) {
      releaseStoragePreviewUrl(previous);
      heldPodPreviewUrls.current.delete(docId);
    }
    if (url) heldPodPreviewUrls.current.set(docId, url);
    return url;
  };
  useEffect(() => {
    const live = new Set(detailPodDocuments.map((doc) => doc.id));
    for (const [id, url] of heldPodPreviewUrls.current) {
      if (live.has(id)) continue;
      releaseStoragePreviewUrl(url);
      heldPodPreviewUrls.current.delete(id);
    }
  }, [detailPodDocuments]);

  useEffect(() => {
    if (detailTab !== "journey") return;
    if (!trip?.id) {
      setAppLocationPoints([]);
      return;
    }
    let mounted = true;
    void getTripAppLocationsForTimeline(
      trip.id,
      trip.driver_id,
      trip.created_at,
      trip.completed_at ?? trip.updated_at,
    ).then(async ({ points }) => {
      if (!mounted) return;
      const labeled = points.map((point) => ({
        latitude: point.latitude,
        longitude: point.longitude,
        recorded_at: point.recorded_at,
        address_label: point.address_label,
        source: point.source,
      }));
      setAppLocationPoints(labeled);

      const missing = labeled.filter((point) => !point.address_label?.trim());
      const seen = new Set<string>();
      const unique = missing.filter((point) => {
        const key = `${point.latitude.toFixed(3)},${point.longitude.toFixed(3)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }).slice(0, 8);

      if (unique.length === 0) return;
      const resolved = new Map<string, string>();
      await Promise.all(
        unique.map(async (point) => {
          const label = await reverseGeocodeCityStateLabel(point.latitude, point.longitude);
          if (label?.trim()) {
            resolved.set(`${point.latitude.toFixed(3)},${point.longitude.toFixed(3)}`, label.trim());
          }
        }),
      );
      if (!mounted || resolved.size === 0) return;
      setAppLocationPoints((current) =>
        current.map((point) => {
          if (point.address_label?.trim()) return point;
          const key = `${point.latitude.toFixed(3)},${point.longitude.toFixed(3)}`;
          const label = resolved.get(key);
          return label ? { ...point, address_label: label } : point;
        }),
      );
    });
    return () => {
      mounted = false;
    };
  }, [detailTab, trip?.id, trip?.driver_id, trip?.created_at, trip?.completed_at, trip?.updated_at]);

  const { canTagOfflineParty } = useDriverOperatingModeQuery();
  const [linkedDriversFull, setLinkedDriversFull] = useState<driversService.DriverRow[]>([]);
  const [attrSalaryRequests, setAttrSalaryRequests] = useState<
    salaryRequestsService.SalaryRequestRow[]
  >([]);
  const [attributeLoading, setAttributeLoading] = useState(false);

  const tripRef = useRef<tripsService.TripRow | null>(null);
  tripRef.current = trip;

  const loadTrip = useCallback(async (isMounted: () => boolean) => {
    const hasLoadedTrip = tripRef.current != null && tripRef.current.id === tripId;
    // Only the first load for this tripId may take the full-screen spinner.
    if (isMounted() && !hasLoadedTrip) setLoading(true);
    const res = await tripsService.getDriverTripById(tripId);
    if (!isMounted()) return;
    if (res.trip) {
      setTrip(tripsService.driverRowToTripRow(res.trip));
    } else if (!hasLoadedTrip) {
      setTrip(null);
    }
    if (isMounted()) setLoading(false);
  }, [tripId]);

  // useFocusEffect also runs on first focus (initial mount). Do not also fetch in a
  // mount useEffect — that duplicated getDriverTripById and blanked the screen on back.
  useFocusEffect(
    useCallback(() => {
      let mounted = true;
      void loadTrip(() => mounted);
      return () => {
        mounted = false;
      };
    }, [loadTrip]),
  );

  useEffect(() => {
    rememberMountedDriverDetailTrip(tripId, trip);
    return () => {
      forgetMountedDriverDetailTrip(tripId);
    };
  }, [trip, tripId]);

  useEffect(() => {
    const uid = profile?.uid;
    if (!uid) return;
    let mounted = true;
    void driversService.getLinkedDriversForCurrentUser(uid).then((res) => {
      if (!mounted) return;
      const d = res.drivers?.[0] ?? null;
      setDriver(d);
      // Keep ALL rows (including left_at) so former-employer trips classify as fleet trips.
      const allRows = res.drivers ?? [];
      setLinkedDriversFull(allRows);
      if (!d?.id) return;
      void driversService.getDriverInvitesReceived().then((inv) => {
        if (!mounted || inv.error) return;
        setInvites(inv.invites);
      });
      const activeRows = allRows.filter((r) => !r.left_at);
      if (activeRows.length > 0) {
        void salaryRequestsService
          .getSalaryRequestsByDriverIds(activeRows.map((r) => r.id))
          .then((sRes) => {
            if (mounted) setAttrSalaryRequests(sRes.requests ?? []);
          });
      }
    });
    return () => {
      mounted = false;
    };
  }, [profile?.uid]);

  useEffect(() => {
    if (!tripId) return;
    let mounted = true;
    void getLatestAssignmentAuditByTripIds([tripId]).then(({ byTripId }) => {
      if (!mounted) return;
      const map: Record<string, string> = {};
      byTripId.forEach((value, key) => {
        const actorId = String(value.changed_by ?? "").trim();
        if (actorId) map[key] = actorId;
      });
      setAssignmentActorByTripId(map);
    });
    return () => {
      mounted = false;
    };
  }, [tripId]);

  const seenTripIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (seenTripIdRef.current === tripId) return;
    const isTripSwitch = seenTripIdRef.current != null;
    seenTripIdRef.current = tripId;
    setExpandedLogIndex(null);
    if (isTripSwitch) {
      setDetailTab(initialTab ?? (initialSelectedExpenseId ? "settlement" : "journey"));
    }
  }, [tripId, initialTab, initialSelectedExpenseId]);

  useEffect(() => {
    if (!trip?.id) {
      setDetailPodDocuments([]);
      setDetailPodViewUrls({});
      detailPodUrlRequestedRef.current.clear();
      setPodPreviewIndex(null);
      return;
    }
    const tid = trip.id;
    detailPodUrlRequestedRef.current.clear();
    setDetailPodViewUrls({});
    setDetailPodLoading(true);
    let cancelled = false;
    tripDocumentsService.getDocumentsByTripId(tid).then(({ documents, error }) => {
      if (cancelled) return;
      setDetailPodLoading(false);
      if (!error) setDetailPodDocuments(documents.filter((d) => d.document_type === 'pod'));
      else setDetailPodDocuments([]);
    });
    return () => {
      cancelled = true;
    };
  }, [trip?.id]);

  useEffect(() => {
    let cancelled = false;
    detailPodDocuments.forEach((doc) => {
      const requestKey = `${doc.id}:${doc.storage_path}`;
      if (detailPodUrlRequestedRef.current.has(requestKey)) return;
      detailPodUrlRequestedRef.current.add(requestKey);
      void tripDocumentsService.tryGetDocumentViewUrl(doc.storage_path).then((url) => {
        if (cancelled) {
          detailPodUrlRequestedRef.current.delete(requestKey);
          releaseStoragePreviewUrl(url);
          return;
        }
        retainPodPreview(doc.id, url);
        if (!url) return;
        setDetailPodViewUrls((prev) => ({ ...prev, [doc.id]: url }));
      });
    });
    return () => {
      cancelled = true;
    };
  }, [detailPodDocuments]);

  const handleUnusablePodDocument = useCallback(
    (doc: tripDocumentsService.TripDocumentRow) => {
      setDetailPodDocuments((prev) => prev.filter((d) => d.id !== doc.id));
      setDetailPodViewUrls((prev) => {
        if (!prev[doc.id]) return prev;
        const next = { ...prev };
        delete next[doc.id];
        return next;
      });
    },
    [],
  );

  useEffect(() => {
    if (!trip) {
      setHeroStops({ from: null, to: null });
      return;
    }
    const from = resolveHistoryStop(trip.pickup_lat, trip.pickup_lon, trip.pickup_area);
    const to = resolveHistoryStop(
      trip.drop_lat,
      trip.drop_lon,
      trip.drop_location || trip.drop_area || "",
    );
    setHeroStops({ from, to });
    const tid = String(trip.id ?? "").trim();
    const hasDistance = trip.distance != null && String(trip.distance).trim() !== "";
    const hasEta = trip.estimated_duration != null && trip.estimated_duration.trim() !== "";
    if (!tid || !from || !to || (hasDistance && hasEta)) return;
    if (haversineKm(from.latitude, from.longitude, to.latitude, to.longitude) < 0.3) return;
    let cancelled = false;
    void getOptimalRoute(from, to).then((route) => {
      if (cancelled || !route || route.distance < 100) return;
      const distanceKm = Math.max(1, Math.round(route.distance / 1000));
      const etaInterval = toEtaInterval(route.duration);
      setRouteMetricsByTripId((prev) => ({
        ...prev,
        [tid]: {
          distance: distanceKm,
          estimated_duration: etaInterval,
          meters: route.distance,
          seconds: route.duration,
        },
      }));
    });
    return () => {
      cancelled = true;
    };
  }, [trip]);

  const driverTripNumberById = useMemo(
    () => (trip ? buildDriverTripNumberMap([trip]) : {}),
    [trip],
  );

  const assignerDisplay = useMemo(() => {
    if (!trip) return "Fleet dispatcher";
    return (
      buildAssignerDisplayForTrip(trip, invites, driver?.organization_id ?? null, {
        assignmentActorByTripId,
        assignerNamesByUserId: {},
        assignerOrgNameByUserId: {},
        assignerDisplayByTripId: {},
        assignerTripOrgNameByTripId: {},
        organizationNamesById: {},
      }).assignedByName || "Fleet dispatcher"
    );
  }, [trip, invites, driver?.organization_id, assignmentActorByTripId]);

  const [appLocationPoints, setAppLocationPoints] = useState<DriverAppLocationPoint[]>([]);

  const archiveMissionLog = useMemo(() => {
    if (!trip) return [];
    return attachDriverAppLocations(buildMissionLog(trip), appLocationPoints);
  }, [trip, appLocationPoints]);
  const pickupHub = useMemo(
    () => splitHubRouteLocationDisplay(trip?.pickup_area),
    [trip?.pickup_area],
  );
  const dropHub = useMemo(
    () => splitHubRouteLocationDisplay(trip?.drop_location || trip?.drop_area),
    [trip?.drop_location, trip?.drop_area],
  );
  const routeFallback = useMemo(() => {
    if (!trip) return null;
    return routeMetricsByTripId[String(trip.id)] ?? null;
  }, [trip, routeMetricsByTripId]);
  const assignerLogoUrl = useMemo(() => {
    if (!trip) return null;
    const orgId = String(trip.organization_id ?? "");
    const invite = invites.find((row) => String(row.from_organization_id ?? "") === orgId);
    return invite?.from_org_logo_url || invite?.from_org_avatar_url || null;
  }, [trip, invites]);
  const distanceDisplay = useMemo(() => {
    if (!trip) return "—";
    if (routeFallback && routeFallback.meters >= 100) return formatRoadDistanceM(routeFallback.meters);
    const raw = trip.distance;
    if (raw == null || String(raw).trim() === "") return "—";
    const km = typeof raw === "string" ? parseFloat(raw.replace(/[^0-9.]/g, "")) : Number(raw);
    if (!Number.isFinite(km) || km < 0) return "—";
    return `${km.toFixed(1)} km`;
  }, [trip, routeFallback]);
  const durationDisplay = useMemo(() => {
    if (!trip) return "—";
    if (routeFallback && routeFallback.seconds >= 30) {
      return formatEtaFromRouteSeconds(routeFallback.seconds);
    }
    if (trip.estimated_duration?.trim()) return humanizeDurationLabel(trip.estimated_duration);
    if (trip.started_at && trip.completed_at) {
      const seconds =
        (new Date(trip.completed_at).getTime() - new Date(trip.started_at).getTime()) / 1000;
      if (seconds >= 60) return formatEtaFromRouteSeconds(seconds);
    }
    if (routeFallback?.estimated_duration) return humanizeDurationLabel(routeFallback.estimated_duration);
    return "—";
  }, [trip, routeFallback]);

  const historyEmployerOrgIdSet = useMemo(() => {
    const set = new Set<string>();
    linkedDriversFull.forEach((d) => {
      if (
        (d.payable_amount != null && d.payable_amount > 0) ||
        (d.commission_percent != null && d.commission_percent > 0) ||
        (d.commission_per_km != null && d.commission_per_km > 0)
      ) {
        const orgId = String(d.organization_id ?? "");
        if (orgId) set.add(orgId);
      }
    });
    return set;
  }, [linkedDriversFull]);

  const historyCurrentEmployer = useMemo(() => {
    const d =
      linkedDriversFull.find((row) => !row.left_at && historyEmployerOrgIdSet.has(String(row.organization_id ?? ""))) ??
      linkedDriversFull.find((row) => historyEmployerOrgIdSet.has(String(row.organization_id ?? "")));
    if (!d) return null;
    const orgName =
      invites.find((i) => String(i.from_organization_id ?? "") === String(d.organization_id ?? ""))?.from_org_name?.trim() ||
      "Employer";
    return { orgId: String(d.organization_id ?? ""), driverRowId: d.id, orgName };
  }, [linkedDriversFull, historyEmployerOrgIdSet, invites]);

  const isTripHistoryFleet = useMemo(() => {
    if (!trip) return false;
    const tripOrgId = String(trip.organization_id ?? "").trim();
    if (!tripOrgId) return false;
    if (String(trip.source ?? "").trim() === "market_bid") return false;
    return linkedDriversFull.some((row) => {
      if (String(row.organization_id ?? "").trim() !== tripOrgId) return false;
      if (row.tracking_only === true) return false;
      if (String(row.relationship_origin ?? "").trim().toLowerCase() === "market_award") {
        return false;
      }
      return (
        driversService.isActiveFleetRelationshipDriver(row) ||
        row.relationship_status === "disconnected" ||
        (row.left_at != null && String(row.left_at).trim() !== "")
      );
    });
  }, [trip, linkedDriversFull]);

  const historyCaptureLane = trip
    ? driverCaptureLaneForTrip(trip, isTripHistoryFleet)
    : "shipper";

  const isTripHistoryAttributed = useMemo(() => {
    if (!historyCurrentEmployer || !trip) return false;
    return attrSalaryRequests.some(
      (r) =>
        r.request_type === "trip_based" &&
        String(r.organization_id ?? "") === historyCurrentEmployer.orgId &&
        (r.trip_ids ?? []).includes(trip.id),
    );
  }, [attrSalaryRequests, historyCurrentEmployer, trip]);

  const handleHistoryAttributeTrip = useCallback(async () => {
    if (!historyCurrentEmployer || !trip) return;
    setAttributeLoading(true);
    try {
      const driverRow = linkedDriversFull.find(
        (d) => d.id === historyCurrentEmployer.driverRowId,
      );
      const invite = invites.find(
        (i) =>
          String(i.status ?? "").toLowerCase() === "accepted" &&
          String(i.from_organization_id ?? "") === historyCurrentEmployer.orgId,
      );
      const { hasAgreedPayoutTerms, commissionDetail } = resolveDriverTripPayoutTerms(trip, {
        commissionPercent: invite?.commission_percent ?? driverRow?.commission_percent ?? null,
        commissionPerKm: invite?.commission_per_km ?? driverRow?.commission_per_km ?? null,
        payableAmount: invite?.payable_amount ?? driverRow?.payable_amount ?? null,
      });
      if (!hasAgreedPayoutTerms || commissionDetail.amount <= 0) {
        Alert.alert(
          "No agreed payout terms",
          "This trip has no agreed payout terms and can't be attributed.",
        );
        return;
      }
      const earnings = Math.round(commissionDetail.amount);
      const tripDate = trip.pickup_date ?? trip.started_at ?? trip.created_at ?? "";
      const tripDateStr = tripDate
        ? new Date(tripDate).toLocaleDateString("en-IN", {
            day: "2-digit",
            month: "short",
            year: "numeric",
          })
        : "";
      const tripRef = getDriverTripDisplayNumber(trip, driverTripNumberById);
      const attrNote = [`Fleet trip · ${tripRef}`, tripDateStr, `₹${earnings.toLocaleString("en-IN")}`]
        .filter(Boolean)
        .join(" · ");
      const { error } = await salaryRequestsService.createSalaryRequest(
        historyCurrentEmployer.driverRowId,
        historyCurrentEmployer.orgId,
        "trip_based",
        earnings,
        { tripIds: [trip.id], note: attrNote, createdBy: profile?.uid ?? null },
      );
      if (error) {
        Alert.alert("Error", error.message);
      } else {
        Alert.alert("Trip attributed", `Sent to ${historyCurrentEmployer.orgName} for review.`);
        void salaryRequestsService
          .getSalaryRequestsByDriverIds(linkedDriversFull.map((d) => d.id))
          .then((sRes) => setAttrSalaryRequests(sRes.requests ?? []));
      }
    } finally {
      setAttributeLoading(false);
    }
  }, [
    historyCurrentEmployer,
    trip,
    driverTripNumberById,
    linkedDriversFull,
    invites,
    profile?.uid,
  ]);

  const pageBg = isDark ? colors.background : Theme.driverEmeraldWash;

  const onBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/(driver)/trip-history");
  };

  if (loading || !trip) {
    return (
      <View style={[styles.detailWrap, { paddingTop: insets.top, backgroundColor: pageBg }]}>
        <View style={styles.detailLoading}>
          <LoadingIndicator color={colors.emerald} />
          <Text style={{ color: colors.textMuted, marginTop: 12 }}>Loading trip…</Text>
        </View>
      </View>
    );
  }

  const selectedTrip = trip;
  const isOfflinePartyTrip =
    canTagOfflineParty && canTagPartyOnTrip(trip, isTripHistoryFleet);
  const needsOfflinePartyTag =
    isOfflinePartyTrip && tripNeedsPartyTag(trip, isTripHistoryFleet);
  const taggedOfflineParty =
    isOfflinePartyTrip && isTripTaggedToParty(trip)
      ? tripReceivablePartyName(trip)
      : null;
  const showHistoryAttributionBar =
    detailTab === "settlement" && !isTripHistoryFleet && !!historyCurrentEmployer;
  const showTagPartyBar =
    detailTab === "settlement" && needsOfflinePartyTag && !showHistoryAttributionBar;

  return (
    <View
      style={[
        styles.detailWrap,
        {
          paddingTop: insets.top,
          backgroundColor: pageBg,
        },
      ]}
    >
            <View
              style={[
                styles.detailHeaderRef,
                styles.detailHeaderStyled,
                {
                  paddingTop: 12,
                  paddingBottom: 12,
                  paddingHorizontal: Layout.screenPaddingHorizontal,
                  backgroundColor: pageBg,
                  borderBottomColor: colors.border,
                },
              ]}
            >
              <TouchableOpacity
                onPress={() => onBack()}
                style={[
                  styles.detailBack,
                  styles.detailBackStyled,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                  },
                ]}
                hitSlop={{ top: 12, right: 16, bottom: 12, left: 16 }}
                activeOpacity={0.75}
                accessibilityLabel="Back"
              >
                <FontAwesome
                  name="chevron-left"
                  size={18}
                  color={colors.text}
                />
              </TouchableOpacity>
              <View style={styles.tdHeaderCenter}>
                <Text
                  style={[
                    styles.detailHeaderLabelRef,
                    { color: colors.textMuted },
                  ]}
                >
                  {detailTab === "operations" ? "OPERATIONS" : "TRIP HISTORY"}
                </Text>
                <View style={styles.detailHeaderIdRowRef}>
                  <Text
                    style={[styles.detailTitleRef, { color: colors.text }]}
                    numberOfLines={1}
                  >
                    {getDriverTripDisplayNumber(selectedTrip, driverTripNumberById)}
                  </Text>
                  <View
                    style={[
                      styles.tdStatusDot,
                      { backgroundColor: Theme.tripsMint },
                    ]}
                  />
                </View>
              </View>
              <View style={styles.detailHeaderActions}>
                {detailTab === "operations" ? (
                  <TouchableOpacity
                    style={[
                      styles.detailBack,
                      styles.detailBackStyled,
                      {
                        backgroundColor: colors.surface,
                        borderColor: colors.border,
                      },
                    ]}
                    onPress={() => {
                      const tripRef = getDriverTripDisplayNumber(
                        selectedTrip,
                        driverTripNumberById,
                      );
                      Alert.alert(tripRef, undefined, [
                        ...(selectedTrip.driver_id
                          ? [
                              {
                                text: "Trip chat",
                                onPress: () => {
                                  const id = encodeURIComponent(String(selectedTrip.id));
                                  router.push(`/(driver)/chat?tripId=${id}` as Href);
                                },
                              },
                            ]
                          : []),
                        {
                          text: "Share trip",
                          onPress: () => {
                            void Share.share({ message: `Trip ${tripRef}` }).catch(() => {});
                          },
                        },
                        { text: "Cancel", style: "cancel" },
                      ]);
                    }}
                    activeOpacity={0.75}
                    accessibilityLabel="Trip options"
                  >
                    <MoreVertical size={17} color={colors.text} />
                  </TouchableOpacity>
                ) : (
                  <>
                {selectedTrip.driver_id ? (
                  <TouchableOpacity
                    style={[
                      styles.detailBack,
                      styles.detailBackStyled,
                      {
                        backgroundColor: colors.surface,
                        borderColor: colors.border,
                      },
                    ]}
                    onPress={() => {
                      const id = encodeURIComponent(String(selectedTrip.id));
                      router.push(`/(driver)/chat?tripId=${id}` as Href);
                    }}
                    activeOpacity={0.75}
                    accessibilityLabel="Trip chat"
                  >
                    <MessageSquare size={17} color={colors.text} />
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity
                  style={[
                    styles.detailBack,
                    styles.detailBackStyled,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                    },
                  ]}
                  onPress={() => {
                    void Share.share({
                      message: `Trip ${getDriverTripDisplayNumber(selectedTrip, driverTripNumberById)}`,
                    }).catch(() => {});
                  }}
                  activeOpacity={0.75}
                  accessibilityLabel="Share trip"
                >
                  <Share2 size={17} color={colors.text} />
                </TouchableOpacity>
                  </>
                )}
              </View>
            </View>
            <ScrollView
              style={[
                styles.detailScrollRef,
                { backgroundColor: pageBg },
              ]}
              contentContainerStyle={[
                styles.detailContentRef,
                {
                  paddingHorizontal: Layout.screenPaddingHorizontal,
                  paddingBottom:
                    Layout.modalBottomPadding +
                    insets.bottom +
                    Layout.tabBarDockHeight +
                    (showTagPartyBar || showHistoryAttributionBar ? 88 : 0),
                  paddingTop: 16,
                },
              ]}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
              bounces
            >
              <View
                style={[
                  styles.tdHeroOuter,
                  isDark && {
                    backgroundColor: "#042421",
                    borderColor: "rgba(255,255,255,0.12)",
                  },
                ]}
              >
                <LinearGradient
                  colors={isDark ? HERO_GRADIENT_DARK : HERO_GRADIENT_LIGHT}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.tdHeroCard}
                  onLayout={(event) => {
                    const { width, height } = event.nativeEvent.layout;
                    setHeroCardSize((prev) =>
                      prev.width === width && prev.height === height ? prev : { width, height },
                    );
                  }}
                >
                  <HeroRouteBackdrop
                    from={heroStops.from}
                    to={heroStops.to}
                    width={heroCardSize.width}
                    height={heroCardSize.height}
                    light={!isDark}
                  />
                  <View style={styles.tdHeroInner}>
                    <Text
                      style={[
                        styles.tdHeroKicker,
                        isDark && { color: "rgba(153,246,228,0.92)" },
                      ]}
                    >
                      Route Logic History
                    </Text>
                    <View style={styles.tdHeroRouteRow}>
                      <View style={styles.tdHeroRouteSide}>
                        <Text
                          style={[styles.tdHeroCity, isDark && { color: Theme.textOnPrimary }]}
                          numberOfLines={1}
                          adjustsFontSizeToFit
                          minimumFontScale={0.7}
                        >
                          {pickupHub.city.toUpperCase()}
                        </Text>
                        {pickupHub.state ? (
                          <Text
                            style={[styles.tdHeroState, isDark && { color: "rgba(153,246,228,0.72)" }]}
                            numberOfLines={1}
                          >
                            {pickupHub.state.toUpperCase()}
                          </Text>
                        ) : null}
                      </View>
                      <Text style={[styles.tdHeroArrow, isDark && { color: "rgba(255,255,255,0.88)" }]}>
                        →
                      </Text>
                      <View style={[styles.tdHeroRouteSide, styles.tdHeroRouteSideRight]}>
                        <Text
                          style={[
                            styles.tdHeroCity,
                            styles.tdHeroCityRight,
                            isDark && { color: Theme.textOnPrimary },
                          ]}
                          numberOfLines={1}
                          adjustsFontSizeToFit
                          minimumFontScale={0.7}
                        >
                          {dropHub.city.toUpperCase()}
                        </Text>
                        {dropHub.state ? (
                          <Text
                            style={[
                              styles.tdHeroState,
                              styles.tdHeroStateRight,
                              isDark && { color: "rgba(153,246,228,0.72)" },
                            ]}
                            numberOfLines={1}
                          >
                            {dropHub.state.toUpperCase()}
                          </Text>
                        ) : null}
                      </View>
                    </View>

                    <View style={styles.tdHeroMetaRow}>
                      <View
                        style={[
                          styles.tdHeroPill,
                          isDark && {
                            backgroundColor: "rgba(255,255,255,0.12)",
                            borderColor: "rgba(255,255,255,0.16)",
                          },
                        ]}
                      >
                        <Navigation size={14} color={isDark ? Theme.textOnPrimary : Theme.driverEmerald} />
                        <Text style={[styles.tdHeroPillText, isDark && { color: Theme.textOnPrimary }]}>
                          {distanceDisplay}
                        </Text>
                      </View>
                      <View
                        style={[
                          styles.tdHeroPill,
                          isDark && {
                            backgroundColor: "rgba(255,255,255,0.12)",
                            borderColor: "rgba(255,255,255,0.16)",
                          },
                        ]}
                      >
                        <Clock size={14} color={isDark ? Theme.textOnPrimary : Theme.driverEmerald} />
                        <Text style={[styles.tdHeroPillText, isDark && { color: Theme.textOnPrimary }]}>
                          {durationDisplay}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.tdHeroPartyRow}>
                      <View style={styles.tdHeroPartyCol}>
                        <View style={styles.tdHeroPartyKickerRow}>
                          <ShieldCheck size={12} color={isDark ? "rgba(153,246,228,0.9)" : Theme.driverEmerald} />
                          <Text style={[styles.tdHeroPartyKicker, isDark && { color: "rgba(153,246,228,0.8)" }]}>
                            Assigned by
                          </Text>
                        </View>
                        <View
                          style={[
                            styles.tdHeroPartyCard,
                            isDark && {
                              backgroundColor: "rgba(255,255,255,0.1)",
                              borderColor: "rgba(255,255,255,0.14)",
                            },
                          ]}
                        >
                          <PartyMark name={assignerDisplay} logoUrl={assignerLogoUrl} />
                          <Text
                            style={[styles.tdHeroPartyName, isDark && { color: Theme.textOnPrimary }]}
                            numberOfLines={1}
                          >
                            {assignerDisplay}
                          </Text>
                        </View>
                      </View>
                      <TouchableOpacity
                        style={styles.tdHeroPartyCol}
                        disabled={!needsOfflinePartyTag && !taggedOfflineParty}
                        onPress={() => {
                          if (taggedOfflineParty) {
                            router.push(
                              ROUTES.driverAddClient({
                                tripId: trip.id,
                                partyName: trip.client_name || undefined,
                              }) as Href,
                            );
                            return;
                          }
                          if (needsOfflinePartyTag) setCollectFromOpen(true);
                        }}
                        activeOpacity={0.85}
                        accessibilityRole="button"
                        accessibilityLabel={
                          taggedOfflineParty
                            ? `Tagged ${taggedOfflineParty}`
                            : needsOfflinePartyTag
                              ? "Tag party"
                              : "Tagged party"
                        }
                      >
                        <View style={styles.tdHeroPartyKickerRow}>
                          <Tag size={12} color={isDark ? "rgba(153,246,228,0.9)" : Theme.driverEmerald} />
                          <Text style={[styles.tdHeroPartyKicker, isDark && { color: "rgba(153,246,228,0.8)" }]}>
                            Tagged
                          </Text>
                        </View>
                        <View
                          style={[
                            styles.tdHeroPartyCard,
                            isDark && {
                              backgroundColor: "rgba(255,255,255,0.1)",
                              borderColor: "rgba(255,255,255,0.14)",
                            },
                          ]}
                        >
                          <PartyMark
                            name={taggedOfflineParty || trip.client_name || "Party"}
                          />
                          <Text
                            style={[styles.tdHeroPartyName, isDark && { color: Theme.textOnPrimary }]}
                            numberOfLines={1}
                          >
                            {taggedOfflineParty ||
                              (needsOfflinePartyTag ? "Tag a party" : trip.client_name || "—")}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    </View>
                  </View>
                </LinearGradient>
              </View>

              <View
                style={[
                  styles.tdTabBar,
                  { backgroundColor: isDark ? colors.surface : Theme.surfaceGray },
                ]}
              >
                <TouchableOpacity
                  style={[
                    styles.tdTabBtn,
                    detailTab === "journey" && [
                      styles.tdTabBtnActive,
                      { backgroundColor: Theme.buttonDark },
                    ],
                  ]}
                  onPress={() => setDetailTab("journey")}
                  activeOpacity={0.88}
                >
                  <Text
                    style={[
                      styles.tdTabLabel,
                      {
                        color: detailTab === "journey" ? Theme.buttonDarkText : colors.textMuted,
                      },
                    ]}
                  >
                    Journey
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.tdTabBtn,
                    detailTab === "operations" && [
                      styles.tdTabBtnActive,
                      { backgroundColor: Theme.buttonDark },
                    ],
                  ]}
                  onPress={() => setDetailTab("operations")}
                  activeOpacity={0.88}
                >
                  <Text
                    style={[
                      styles.tdTabLabel,
                      {
                        color: detailTab === "operations" ? Theme.buttonDarkText : colors.textMuted,
                      },
                    ]}
                  >
                    Operations
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.tdTabBtn,
                    detailTab === "settlement" && [
                      styles.tdTabBtnActive,
                      { backgroundColor: Theme.buttonDark },
                    ],
                  ]}
                  onPress={() => setDetailTab("settlement")}
                  activeOpacity={0.88}
                >
                  <Text
                    style={[
                      styles.tdTabLabel,
                      {
                        color: detailTab === "settlement" ? Theme.buttonDarkText : colors.textMuted,
                      },
                    ]}
                  >
                    Settlement
                  </Text>
                </TouchableOpacity>
              </View>

              {detailTab === "journey" ? (
                <View style={{ marginBottom: 12 }}>
                  <View style={styles.tdTimelineHeader}>
                    <View style={styles.tdTimelineHeaderIcon}>
                      <Calendar size={13} color="#ffffff" />
                    </View>
                    <Text style={[styles.tdTimelineHeaderTitle, { color: colors.text }]}>
                      Trip Timeline
                    </Text>
                  </View>

                  {archiveMissionLog.length === 0 ? (
                    <View
                      style={[
                        styles.tdTimelineCard,
                        {
                          backgroundColor: colors.surface,
                          borderColor: colors.border,
                        },
                      ]}
                    >
                      <Text style={[styles.tdEmptyTimeline, { color: colors.textMuted }]}>
                        No timeline events for this trip yet.
                      </Text>
                    </View>
                  ) : (
                    <View
                      style={[
                        styles.tdTimelineCard,
                        {
                          backgroundColor: colors.surface,
                          borderColor: colors.border,
                        },
                      ]}
                    >
                      {archiveMissionLog.map((log, i) => {
                        const isLast = i === archiveMissionLog.length - 1;
                        const expanded = expandedLogIndex === i;
                        return (
                          <View key={`${log.status}-${i}`} style={styles.tdLogRowWrap}>
                            {!isLast ? (
                              <View
                                style={[styles.tdLogConnector, { backgroundColor: Theme.tripsMint }]}
                              />
                            ) : null}
                            <TouchableOpacity
                              activeOpacity={0.85}
                              style={[
                                styles.tdLogTouchable,
                                expanded && {
                                  backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "#f8fafc",
                                  borderRadius: 10,
                                },
                              ]}
                              onPress={() =>
                                setExpandedLogIndex(expanded ? null : i)
                              }
                            >
                              <View style={styles.tdLogMarkerCol}>
                                <TimelinePulseIcon expanded={expanded}>
                                  <View
                                    style={[
                                      styles.tdLogCircle,
                                      {
                                        backgroundColor: colors.emerald,
                                        borderColor: colors.surface,
                                      },
                                    ]}
                                  >
                                    <TimelineStepIcon status={log.status} />
                                  </View>
                                </TimelinePulseIcon>
                              </View>
                              <View style={styles.tdLogBody}>
                                <View style={styles.tdLogHead}>
                                  <Text style={[styles.tdLogStatus, { color: colors.text }]}>
                                    {log.status}
                                  </Text>
                                  <View style={styles.tdLogHeadRight}>
                                    <Text style={[styles.tdLogTime, { color: colors.textMuted }]}>
                                      {log.time}
                                    </Text>
                                    {expanded ? (
                                      <ChevronUp size={14} color={colors.textMuted} />
                                    ) : (
                                      <ChevronDown size={14} color={colors.textMuted} />
                                    )}
                                  </View>
                                </View>
                                <Text
                                  style={[styles.tdLogLoc, { color: colors.textMuted }]}
                                  numberOfLines={expanded ? undefined : 2}
                                >
                                  {log.driverLoc ?? log.loc}
                                </Text>
                                {expanded ? (
                                  <View style={styles.tdLogExpanded}>
                                    <View
                                      style={[
                                        styles.tdLogFactCard,
                                        {
                                          backgroundColor: colors.background,
                                          borderColor: colors.border,
                                        },
                                      ]}
                                    >
                                      <View style={styles.tdLogDriverLocRow}>
                                        <View
                                          style={[
                                            styles.tdLogDriverLocIcon,
                                            { backgroundColor: isDark ? "rgba(255,255,255,0.08)" : Theme.surfaceGray },
                                          ]}
                                        >
                                          <Navigation size={12} color={colors.textMuted} />
                                        </View>
                                        <View style={styles.tdLogDriverLocCopy}>
                                          <Text style={[styles.tdLogFactLabel, { color: colors.textMuted }]}>
                                            {log.driverLocKind === "business"
                                              ? "Business location"
                                              : "Driver location"}
                                          </Text>
                                          <Text style={[styles.tdLogFactValue, { color: colors.text }]}>
                                            {log.driverLoc ?? "Not captured"}
                                          </Text>
                                        </View>
                                      </View>
                                      <View style={[styles.tdLogFactDivider, { backgroundColor: colors.border }]} />
                                      <View style={styles.tdLogFactGrid}>
                                        <View style={styles.tdLogFactCol}>
                                          <Text style={[styles.tdLogFactLabel, { color: colors.textMuted }]}>
                                            Scheduled stop
                                          </Text>
                                          <Text style={[styles.tdLogFactValue, { color: colors.text }]} numberOfLines={2}>
                                            {log.loc}
                                          </Text>
                                        </View>
                                        <View style={[styles.tdLogFactRule, { backgroundColor: colors.border }]} />
                                        <View style={styles.tdLogFactCol}>
                                          <Text style={[styles.tdLogFactLabel, { color: colors.textMuted }]}>
                                            Timestamp
                                          </Text>
                                          <Text style={[styles.tdLogFactValue, { color: colors.text }]}>
                                            {formatLedgerDateTime(log.atIso)}
                                          </Text>
                                        </View>
                                      </View>
                                    </View>
                                    {log.status.trim().toLowerCase() === "delivered" &&
                                    detailPodDocuments.length > 0 ? (
                                      <View style={styles.tdLogDocRow}>
                                        {detailPodDocuments.map((doc, docIndex) => {
                                          const previewUrl = detailPodViewUrls[doc.id];
                                          const isImage =
                                            (doc.mime_type ?? "").startsWith("image/") ||
                                            /\.(jpe?g|png|webp|gif)$/i.test(doc.file_name || doc.storage_path);
                                          return (
                                            <TouchableOpacity
                                              key={doc.id}
                                              style={[
                                                styles.tdLogDocThumb,
                                                { borderColor: colors.border, backgroundColor: colors.background },
                                              ]}
                                              onPress={() => setPodPreviewIndex(docIndex)}
                                              activeOpacity={0.85}
                                              accessibilityRole="button"
                                              accessibilityLabel={`Preview ${doc.file_name || "document"}`}
                                            >
                                              {isImage && previewUrl ? (
                                                <Image
                                                  source={{ uri: previewUrl }}
                                                  style={styles.tdLogDocImage}
                                                  resizeMode="cover"
                                                />
                                              ) : (
                                                <FileImage size={16} color={colors.textMuted} />
                                              )}
                                            </TouchableOpacity>
                                          );
                                        })}
                                      </View>
                                    ) : null}
                                    {isInTransitStatus(log.status) ? null : (
                                      <>
                                        <Text style={[styles.tdLogDetailsKicker, { color: colors.textMuted }]}>
                                          Details
                                        </Text>
                                        <View
                                          style={[
                                            styles.tdLogDetailsBox,
                                            {
                                              backgroundColor: colors.background,
                                              borderColor: colors.border,
                                            },
                                          ]}
                                        >
                                          <Text style={[styles.tdLogDetailsText, { color: colors.text }]}>
                                            {log.details}
                                          </Text>
                                        </View>
                                      </>
                                    )}
                                  </View>
                                ) : null}
                              </View>
                            </TouchableOpacity>
                          </View>
                        );
                      })}
                    </View>
                  )}

                  <View style={styles.tdTimelineHeader}>
                    <View style={styles.tdTimelineHeaderIcon}>
                      <FileImage size={13} color="#ffffff" />
                    </View>
                    <Text
                      style={[styles.tdTimelineHeaderTitle, { color: colors.text }]}
                    >
                      Proof of delivery
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.tdTimelineCard,
                      {
                        backgroundColor: colors.surface,
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    {detailPodLoading ? (
                      <LoadingIndicator
                        style={{ paddingVertical: 22 }}
                        color={colors.emerald}
                      />
                    ) : detailPodDocuments.length >= 1 ? (
                      detailPodDocuments.map((doc, index) => {
                        const name =
                          doc.file_name ||
                          doc.storage_path.split("/").pop() ||
                          "POD";
                        const previewUrl = detailPodViewUrls[doc.id];
                        const isImage =
                          (doc.mime_type ?? "").startsWith("image/") ||
                          /\.(jpe?g|png|webp|gif)$/i.test(doc.file_name || doc.storage_path);
                        return (
                          <TouchableOpacity
                            key={doc.id}
                            style={[
                              styles.tdPodRow,
                              index < detailPodDocuments.length - 1
                                ? { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth }
                                : null,
                            ]}
                            onPress={() => setPodPreviewIndex(index)}
                            activeOpacity={0.85}
                            accessibilityRole="button"
                            accessibilityLabel={`Preview ${name}`}
                          >
                            <View
                              style={[
                                styles.tdLogDocThumb,
                                { borderColor: colors.border, backgroundColor: colors.background },
                              ]}
                            >
                              {isImage && previewUrl ? (
                                <Image
                                  source={{ uri: previewUrl }}
                                  style={styles.tdLogDocImage}
                                  resizeMode="cover"
                                />
                              ) : (
                                <FileImage size={16} color={colors.textMuted} />
                              )}
                            </View>
                            <Text
                              style={[styles.tdPodFileName, { color: colors.text }]}
                              numberOfLines={1}
                            >
                              {name}
                            </Text>
                            <Text style={styles.tdPodPreview}>Preview</Text>
                          </TouchableOpacity>
                        );
                      })
                    ) : (
                      <Text
                        style={[
                          styles.tdEmptyTimeline,
                          { paddingVertical: 14, fontSize: 13 },
                        ]}
                      >
                        No proof of delivery uploaded for this trip.
                      </Text>
                    )}
                  </View>

                  {isCompleted(selectedTrip.status) ? (
                    <LinearGradient
                      colors={[Theme.driverEmeraldDark, Theme.driverEmerald]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.tdDeliveredBanner}
                    >
                      <View>
                        <Text style={styles.tdDeliveredKicker}>Status</Text>
                        <Text style={styles.tdDeliveredTitle}>DELIVERED SUCCESSFULLY</Text>
                      </View>
                      <View style={styles.tdDeliveredIconCircle}>
                        <CheckCircle2 size={24} color="#ffffff" />
                      </View>
                    </LinearGradient>
                  ) : (
                    <View
                      style={[
                        styles.tdProgressBanner,
                        {
                          backgroundColor: colors.surface,
                          borderColor: colors.border,
                        },
                      ]}
                    >
                      <View>
                        <Text style={[styles.tdProgressKicker, { color: colors.textMuted }]}>
                          Status
                        </Text>
                        <Text style={[styles.tdProgressTitle, { color: colors.text }]}>
                          {getTripProgressTitle(selectedTrip)}
                        </Text>
                      </View>
                      <View
                        style={[
                          styles.tdDeliveredIconCircle,
                          { backgroundColor: `${colors.emerald}22` },
                        ]}
                      >
                        <Clock size={22} color={colors.emerald} />
                      </View>
                    </View>
                  )}
                </View>
              ) : null}

              {detailTab === "operations" && trip ? (
                <View style={{ marginBottom: 12 }}>
                  <DriverTripOperationsTab
                    trip={trip}
                    documents={detailPodDocuments}
                    documentUrls={detailPodViewUrls}
                    documentsLoading={detailPodLoading}
                    onPreviewDocument={(documentId) => {
                      const index = detailPodDocuments.findIndex((doc) => doc.id === documentId);
                      if (index >= 0) setPodPreviewIndex(index);
                    }}
                  />
                </View>
              ) : null}

              {detailTab === "settlement" ? (
                <>
                  <TripDetailSettlementPanel
                    trip={selectedTrip}
                    isFleetLinked={isTripHistoryFleet}
                    initialSelectedExpenseId={initialSelectedExpenseId}
                    onPartyTagged={() => void loadTrip(() => true)}
                  />
                </>
              ) : null}
            </ScrollView>

            {showHistoryAttributionBar ? (
              <View
                style={[
                  histAttrStyles.stickyWrap,
                  {
                    bottom: Layout.tabBarDockHeight + 8,
                    backgroundColor: colors.surface,
                    borderTopColor: colors.border,
                  },
                ]}
              >
                <Text style={[histAttrStyles.label, { color: colors.textMuted }]}>
                  Fleet attribution
                </Text>
                {isTripHistoryAttributed ? (
                  <View style={histAttrStyles.doneBadge}>
                    <FontAwesome name="check-circle" size={14} color="#d97706" />
                    <Text style={histAttrStyles.doneBadgeText}>
                      Sent to {historyCurrentEmployer?.orgName} for review
                    </Text>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={[histAttrStyles.btn, { backgroundColor: "#fffbeb", borderColor: "#d97706" }]}
                    onPress={() => void handleHistoryAttributeTrip()}
                    disabled={attributeLoading}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityLabel="Attribute to employer"
                  >
                    <FontAwesome name="building" size={13} color="#d97706" />
                    <Text style={[histAttrStyles.btnText, { color: "#d97706" }]}>
                      {attributeLoading
                        ? "Attributing…"
                        : `Attribute to ${historyCurrentEmployer?.orgName}`}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : null}

            {showTagPartyBar ? (
              <View
                style={[
                  histAttrStyles.stickyWrap,
                  {
                    bottom: Layout.tabBarDockHeight + 8,
                    backgroundColor: colors.surface,
                    borderTopColor: colors.border,
                  },
                ]}
              >
                <Text style={[histAttrStyles.label, { color: colors.textMuted }]}>
                  Tag party to track AR
                </Text>
                <TouchableOpacity
                  style={histAttrStyles.btn}
                  onPress={() => setCollectFromOpen(true)}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel="Tag party"
                >
                  <FontAwesome name="tag" size={13} color="#0f172a" />
                  <Text style={histAttrStyles.btnText}>Tag party</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {trip && canTagOfflineParty ? (
              <DriverCollectFromSheet
                visible={collectFromOpen}
                trip={trip}
                due={0}
                lane="shipper"
                assignerName={assignerDisplay}
                onClose={() => setCollectFromOpen(false)}
                onTagged={() => void loadTrip(() => true)}
              />
            ) : null}

            <DriverDocumentGalleryPreview
              visible={podPreviewIndex != null}
              documents={detailPodDocuments}
              viewUrls={detailPodViewUrls}
              initialIndex={podPreviewIndex ?? 0}
              onClose={() => setPodPreviewIndex(null)}
              onResolvePreview={resolveDetailPodPreview}
              onUnusableDocument={handleUnusablePodDocument}
              fallbackLabel="POD"
            />
    </View>
  );
}

const histAttrStyles = withWebSafeShadows(
  StyleSheet.create({
  stickyWrap: {
    position: "absolute",
    left: Layout.screenPaddingHorizontal,
    right: Layout.screenPaddingHorizontal,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "transparent",
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 12,
    gap: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 4,
  },
  label: {
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  btn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Theme.primary,
    backgroundColor: Theme.primary,
    alignSelf: "flex-start",
  },
  btnText: {
    fontSize: 13,
    fontWeight: "600",
    color: Theme.buttonDarkText,
  },
  doneBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#fde68a",
    backgroundColor: "#fef3c7",
    alignSelf: "flex-start",
  },
  doneBadgeText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#b45309",
  },
  }),
);

const histCollectStyles = StyleSheet.create({
  heroActions: {
    marginTop: 14,
    gap: 8,
    width: "100%",
  },
  heroCollectBtn: {
    minHeight: 48,
    width: "100%",
    borderRadius: 16,
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  heroCollectText: {
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: -0.2,
    color: Theme.actionBtnInk,
  },
  heroTagBtn: {
    minHeight: 44,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.28)",
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  heroTagText: {
    fontSize: 13,
    fontWeight: "600",
    color: "rgba(255,255,255,0.92)",
  },
});

