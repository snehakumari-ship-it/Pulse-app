import { useDriverHomeDriversQuery } from '@/lib/queries/useDriverHomeDriversQuery';
import { getTripsByDriverIds } from '@/features/trips/services/trips.service';
import type { DriverTripRow } from '@/types/trip-views';
import { driverJobSource } from '@/features/drivers/domain/driverOperatingMode';
import { queryKeys } from '@/lib/queryKeys';
import {
  infrastructureRetryDelay,
  infrastructureShouldRetry,
} from '@/lib/queryRetry';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

/**
 * This driver's own Market-awarded trips (trips.source = 'market_bid'),
 * reusing the same trips_driver_view read every other driver trip list
 * already goes through — no new backend/RLS surface.
 */
export function useMyMarketAwardsQuery(userId: string | null) {
  const linkedDriversQuery = useDriverHomeDriversQuery(userId);
  const driverIds = useMemo(
    () => linkedDriversQuery.activeLinkedDrivers.map((d) => d.id),
    [linkedDriversQuery.activeLinkedDrivers],
  );
  const driverIdsKey = useMemo(() => [...driverIds].sort().join(','), [driverIds]);

  const query = useQuery({
    queryKey: queryKeys.driverApp.myMarketAwards(driverIdsKey || (userId ?? '')),
    queryFn: async (): Promise<DriverTripRow[]> => {
      if (driverIds.length === 0) return [];
      const { error, trips } = await getTripsByDriverIds(driverIds, {
        limit: 100,
        offset: 0,
      });
      if (error) throw error;
      return (trips ?? []).filter((t) => driverJobSource(t) === 'marketplace_award');
    },
    enabled: !linkedDriversQuery.isLoading,
    staleTime: 30_000,
    gcTime: 10 * 60_000,
    retry: infrastructureShouldRetry,
    retryDelay: infrastructureRetryDelay,
    refetchOnWindowFocus: true,
  });

  const queryClient = useQueryClient();
  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.driverApp.myMarketAwards(driverIdsKey || (userId ?? '')),
    });
  }, [queryClient, driverIdsKey, userId]);

  return {
    ...query,
    awards: query.data ?? [],
    isLoading: query.isLoading || linkedDriversQuery.isLoading,
    invalidate,
  };
}
