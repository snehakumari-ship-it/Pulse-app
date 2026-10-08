import { useQuery } from "@tanstack/react-query";

import { fetchDriverStopExecution } from "@/features/driver/execution/fetchDriverStopExecution";
import type { DriverStopExecutionStop } from "@/features/driver/execution/driverStopExecution.types";
import { queryKeys } from "@/lib/queryKeys";

const EMPTY: DriverStopExecutionStop[] = [];

/** Commerce stop progress for a trip; empty for FTL trips (no stop_execution_state rows). */
export function useTripStopExecutionQuery(tripId: string | null | undefined, live: boolean) {
  const query = useQuery({
    queryKey: queryKeys.trips.stopExecution(tripId ?? ""),
    enabled: !!tripId,
    queryFn: async () => {
      const result = await fetchDriverStopExecution(tripId!);
      if (!result.ok) throw result.error;
      return result.bundle.stops;
    },
    staleTime: 15_000,
    refetchInterval: live ? 30_000 : false,
  });
  return query.data ?? EMPTY;
}
