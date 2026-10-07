import { listNetworkPoolLanes } from "@/features/network/services/networkPools.service";
import { STALE } from "@/lib/queryClient";
import { queryKeys } from "@/lib/queryKeys";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

/** Server Network pool lanes for the viewing org (list_network_pool_lanes_for_org). */
export function useNetworkPoolLanesQuery(orgId: string | null) {
  return useQuery({
    queryKey: queryKeys.networkPools.lanes(orgId ?? ""),
    queryFn: async () => {
      const res = await listNetworkPoolLanes(orgId as string);
      if (res.error) throw res.error;
      return { lanes: res.lanes, complete: res.complete };
    },
    enabled: !!orgId,
    staleTime: STALE.frequent,
  });
}

/**
 * Pool ids (server pool_key) the viewing org may see; null until every lane
 * has been listed. Client poolKeyId and server _pool_key normalize the same way.
 */
export function useServerNetworkPoolIds(orgId: string | null): ReadonlySet<string> | null {
  const { data } = useNetworkPoolLanesQuery(orgId);
  return useMemo(
    () => (data?.complete ? new Set(data.lanes.map((l) => l.pool_key)) : null),
    [data],
  );
}
