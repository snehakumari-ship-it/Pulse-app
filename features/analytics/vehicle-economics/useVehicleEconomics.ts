import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { STALE } from "@/lib/queryClient";
import { supabase } from "@/lib/supabase";
import {
  buildVehicleEconomicsRows,
  type VehicleEconomicsInput,
} from "./vehicleEconomicsEngine";
import { rankVehiclesByEfficiency } from "./vehicleEfficiencyRanking";
import { buildVehicleProfitabilitySnapshot } from "./vehicleProfitability";

export function useVehicleEconomics(input: {
  organizationId: string | null;
  enabled?: boolean;
}) {
  const enabled = (input.enabled ?? true) && !!input.organizationId;
  return useQuery({
    queryKey: input.organizationId
      ? queryKeys.operations.vehicleEconomics(input.organizationId)
      : ["q", "operations", "vehicle-economics", "noop"],
    queryFn: async () => {
      const orgId = input.organizationId!;
      const tripsRes = await supabase()
        .from("trips")
        .select(
          "id,vehicle_id,distance,trip_payout_mode,supplier_id,started_at,completed_at,pickup_date",
        )
        .eq("organization_id", orgId)
        .not("vehicle_id", "is", null)
        .or("trip_payout_mode.eq.asset,and(trip_payout_mode.is.null,supplier_id.is.null)")
        .order("created_at", { ascending: false })
        .limit(800);
      if (tripsRes.error) throw new Error(tripsRes.error.message);
      const trips = (tripsRes.data ?? []) as Array<{
        id: string;
        vehicle_id: string | null;
        distance: number | string | null;
        started_at: string | null;
        completed_at: string | null;
      }>;
      const tripIds = trips.map((trip) => trip.id);
      const vehicleIds = Array.from(
        new Set(
          trips
            .map((trip) => (trip.vehicle_id ?? "").trim())
            .filter((value): value is string => value.length > 0),
        ),
      );
      if (tripIds.length === 0 || vehicleIds.length === 0) {
        return {
          rows: [],
          rankings: [],
          profitability: buildVehicleProfitabilitySnapshot([]),
        };
      }
      const [vehiclesRes, fuelRes, tollRes, maintenanceRes] = await Promise.all([
        supabase()
          .from("vehicles")
          .select("id,vehicle_number,vehicle_type")
          .eq("organization_id", orgId)
          .in("id", vehicleIds),
        supabase()
          .from("trip_fuel_entries")
          .select("trip_id,amount_inr,approval_state,posting_state,status")
          .eq("expense_context", "employer")
          .eq("employer_org_id", orgId)
          .in("trip_id", tripIds),
        supabase()
          .from("trip_toll_entries")
          .select("trip_id,amount_inr,approval_state,posting_state,status")
          .eq("expense_context", "employer")
          .eq("employer_org_id", orgId)
          .in("trip_id", tripIds),
        supabase()
          .from("vehicle_maintenance_entries")
          .select("vehicle_id,amount_inr,status")
          .eq("organization_id", orgId)
          .in("vehicle_id", vehicleIds),
      ]);
      if (vehiclesRes.error) throw new Error(vehiclesRes.error.message);
      if (fuelRes.error) throw new Error(fuelRes.error.message);
      if (tollRes.error) throw new Error(tollRes.error.message);
      if (maintenanceRes.error) throw new Error(maintenanceRes.error.message);
      const tripToVehicle = new Map<string, string>();
      const baseByVehicle = new Map<string, VehicleEconomicsInput>();
      for (const row of vehiclesRes.data ?? []) {
        const id = String((row as { id: string }).id);
        const vehicleNumber = String(
          (row as { vehicle_number?: string | null }).vehicle_number ?? "",
        ).trim();
        const vehicleType = String(
          (row as { vehicle_type?: string | null }).vehicle_type ?? "",
        ).trim();
        baseByVehicle.set(id, {
          vehicleId: id,
          vehicleLabel: [vehicleNumber, vehicleType].filter(Boolean).join(" · ") || id,
          distanceKm: 0,
          loadedDistanceKm: 0,
          fuelSpendInr: 0,
          maintenanceSpendInr: 0,
          tollSpendInr: 0,
          idleHours: 0,
          activeTripCount: 0,
        });
      }
      for (const trip of trips) {
        const vehicleId = String(trip.vehicle_id ?? "").trim();
        if (!vehicleId || !baseByVehicle.has(vehicleId)) continue;
        tripToVehicle.set(trip.id, vehicleId);
        const current = baseByVehicle.get(vehicleId)!;
        const distance = Math.max(0, Number(trip.distance ?? 0) || 0);
        const hasMovement = trip.started_at != null || trip.completed_at != null;
        const idleHours = hasMovement ? 0 : 8;
        current.distanceKm += distance;
        current.loadedDistanceKm += distance;
        current.idleHours += idleHours;
        current.activeTripCount += 1;
      }
      for (const fuel of fuelRes.data ?? []) {
        const status = String((fuel as { status?: string | null }).status ?? "").toLowerCase();
        if (status === "voided") continue;
        const approval = String(
          (fuel as { approval_state?: string | null }).approval_state ?? "",
        ).toLowerCase();
        const posting = String(
          (fuel as { posting_state?: string | null }).posting_state ?? "",
        ).toLowerCase();
        if (posting !== "posted" && (posting || (approval !== "approved" && approval !== "settled"))) {
          continue;
        }
        const tripId = String((fuel as { trip_id: string }).trip_id);
        const vehicleId = tripToVehicle.get(tripId);
        if (!vehicleId) continue;
        baseByVehicle.get(vehicleId)!.fuelSpendInr += Math.max(
          0,
          Number((fuel as { amount_inr?: number | null }).amount_inr ?? 0) || 0,
        );
      }
      for (const toll of tollRes.data ?? []) {
        const status = String((toll as { status?: string | null }).status ?? "").toLowerCase();
        if (status === "voided") continue;
        const approval = String(
          (toll as { approval_state?: string | null }).approval_state ?? "",
        ).toLowerCase();
        const posting = String(
          (toll as { posting_state?: string | null }).posting_state ?? "",
        ).toLowerCase();
        if (posting !== "posted" && (posting || (approval !== "approved" && approval !== "settled"))) {
          continue;
        }
        const tripId = String((toll as { trip_id: string }).trip_id);
        const vehicleId = tripToVehicle.get(tripId);
        if (!vehicleId) continue;
        baseByVehicle.get(vehicleId)!.tollSpendInr += Math.max(
          0,
          Number((toll as { amount_inr?: number | null }).amount_inr ?? 0) || 0,
        );
      }
      for (const item of maintenanceRes.data ?? []) {
        const status = String((item as { status?: string | null }).status ?? "").toLowerCase();
        if (status === "void") continue;
        const vehicleId = String((item as { vehicle_id: string }).vehicle_id);
        const current = baseByVehicle.get(vehicleId);
        if (!current) continue;
        current.maintenanceSpendInr += Math.max(
          0,
          Number((item as { amount_inr?: number | null }).amount_inr ?? 0) || 0,
        );
      }
      const rows = buildVehicleEconomicsRows(Array.from(baseByVehicle.values()));
      const rankings = rankVehiclesByEfficiency(rows);
      return {
        rows,
        rankings,
        profitability: buildVehicleProfitabilitySnapshot(rows),
      };
    },
    enabled,
    staleTime: STALE.moderate,
  });
}
