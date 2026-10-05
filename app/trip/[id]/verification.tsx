import { CenteredLoadingView } from "@/components/CenteredLoadingView";
import { useAuth } from "@/contexts/AuthContext";
import { getDriverOwnedTrip } from "@/features/driver/services/driverOwnedTrip.service";
import {
  OdometerEntryScreen,
  OdometerStartEndScreen,
  type VerificationSide,
} from "@/features/trips/verification";
import { getAccessibleTripById, type TripRow } from "@/features/trips/services/trips.service";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";

export default function TripVerificationRoute() {
  const { profile } = useAuth();
  const params = useLocalSearchParams<{ id?: string | string[]; side?: string | string[] }>();
  const tripId =
    typeof params.id === "string" ? params.id : Array.isArray(params.id) ? params.id[0] : "";
  const sideRaw =
    typeof params.side === "string"
      ? params.side
      : Array.isArray(params.side)
        ? params.side[0]
        : "start";
  const side: VerificationSide | "both" =
    sideRaw === "end" ? "end" : sideRaw === "both" ? "both" : "start";
  const [trip, setTrip] = useState<TripRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    if (!tripId) {
      setTrip(null);
      setLoading(false);
      setError("Trip not found.");
      return;
    }
    setLoading(true);
    const load =
      profile?.role === "driver" ? getDriverOwnedTrip(tripId) : getAccessibleTripById(tripId);
    void load.then((res) => {
      if (!mounted) return;
      setTrip(res.trip ?? null);
      setError(res.error ? res.error.message : res.trip ? null : "Trip not found.");
      setLoading(false);
    });
    return () => {
      mounted = false;
    };
  }, [profile?.role, tripId]);

  const content = useMemo(() => {
    if (loading) return <CenteredLoadingView message="Loading verification..." />;
    if (error || !trip) {
      return (
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 16 }}>
          <Text style={{ color: "#64748b", fontSize: 14 }}>{error ?? "Trip not found"}</Text>
        </View>
      );
    }
    return side === "both" ? (
      <OdometerStartEndScreen trip={trip} />
    ) : (
      <OdometerEntryScreen trip={trip} side={side} />
    );
  }, [error, loading, side, trip]);

  return content;
}
