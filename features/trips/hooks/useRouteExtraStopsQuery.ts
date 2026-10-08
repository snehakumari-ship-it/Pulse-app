import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import {
  fetchRouteExtraStopsForIndents,
  fetchRouteExtraStopsForTrips,
  summarizeRouteExtraStopRows,
  type RouteExtraStopRow,
} from "@/features/trips/services/routeExtraStops.service";
import {
  EMPTY_ROUTE_EXTRA_STOP_SUMMARY,
  type RouteExtraStopSummary,
} from "@/features/trips/utils/routeExtraStops.util";
import { queryKeys } from "@/lib/queryKeys";

const EMPTY_ROWS: RouteExtraStopRow[] = [];

/** Saved extra stops for a set of indents or trips, in sequence order, batched into one read. */
export function useRouteExtraStopRows(
  parent: "indent" | "trip",
  ids: readonly (string | null | undefined)[],
): RouteExtraStopRow[] {
  const sorted = useMemo(
    () => [...new Set(ids.filter((id): id is string => !!id))].sort(),
    [ids],
  );
  const idsKey = sorted.join(",");
  const query = useQuery({
    queryKey: queryKeys.trips.routeExtraStops(parent, idsKey),
    enabled: sorted.length > 0,
    queryFn: async () => {
      const { rows, error } =
        parent === "indent"
          ? await fetchRouteExtraStopsForIndents(sorted)
          : await fetchRouteExtraStopsForTrips(sorted);
      if (error) throw error;
      return rows;
    },
    staleTime: 60_000,
    retry: 1,
  });
  return query.data ?? EMPTY_ROWS;
}

/** Extra-stop count and charges per indent or trip id. */
export function useRouteExtraStopsSummaries(
  parent: "indent" | "trip",
  ids: readonly (string | null | undefined)[],
): Map<string, RouteExtraStopSummary> {
  const rows = useRouteExtraStopRows(parent, ids);
  return useMemo(
    () => summarizeRouteExtraStopRows(rows, parent === "indent" ? "indent_id" : "trip_id"),
    [rows, parent],
  );
}

export function useRouteExtraStopsSummary(
  parent: "indent" | "trip",
  id: string | null | undefined,
): RouteExtraStopSummary {
  const ids = useMemo(() => [id], [id]);
  const map = useRouteExtraStopsSummaries(parent, ids);
  return (id ? map.get(id) : undefined) ?? EMPTY_ROUTE_EXTRA_STOP_SUMMARY;
}

/** One trip's or indent's stops, in order. */
export function useRouteExtraStopRowsFor(
  parent: "indent" | "trip",
  id: string | null | undefined,
): RouteExtraStopRow[] {
  const ids = useMemo(() => [id], [id]);
  return useRouteExtraStopRows(parent, ids);
}
