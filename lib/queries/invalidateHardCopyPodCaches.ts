/**
 * Shared TanStack Query invalidation after hard-copy POD create/update.
 * Keeps Manifest Management, Log Incoming PODs, Invoicing, Trips hub,
 * POD reconciliation, and Trip Compliance in sync off the same trips.pod_* fields.
 *
 * Prefer org-scoped trip list invalidation — never wipe the entire `["q","trips"]`
 * tree (that refetches every trip detail/bundle and makes hub navigations janky).
 */
import { queryKeys } from "@/lib/queryKeys";
import type { QueryClient } from "@tanstack/react-query";

function invalidateOrgHardCopyPodSurfaces(
  queryClient: QueryClient,
  orgId: string,
  tripIds: string[],
): void {
  // Hub finite/infinite lists + POD reconciliation (`…, 'reconciliation', …`).
  void queryClient.invalidateQueries({ queryKey: queryKeys.trips.all(orgId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.logPods.trips(orgId) });
  void queryClient.invalidateQueries({
    queryKey: queryKeys.logPods.tripsIncludingReceived(orgId),
  });
  void queryClient.invalidateQueries({ queryKey: queryKeys.invoicing.trips(orgId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.invoicing.summary(orgId) });
  void queryClient.invalidateQueries({
    queryKey: ["q", "tripCompliance", "list", "vault-v2", orgId],
  });
  for (const tripId of tripIds) {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.tripCompliance.detail(orgId, tripId),
    });
  }
}

/** Invalidate all surfaces that read hard-copy POD for one trip. */
export function invalidateHardCopyPodCaches(
  queryClient: QueryClient,
  args: { tripId?: string | null; organizationId?: string | null },
): void {
  const tripId = String(args.tripId ?? "").trim();
  const orgId = String(args.organizationId ?? "").trim();
  const tripIds = tripId ? [tripId] : [];

  for (const id of tripIds) {
    void queryClient.invalidateQueries({ queryKey: queryKeys.trips.detail(id) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.trips.bundle(id) });
  }

  if (orgId) {
    invalidateOrgHardCopyPodSurfaces(queryClient, orgId, tripIds);
  } else if (tripIds.length === 0) {
    // No trip/org context — last-resort prefix (avoid on the hot path).
    void queryClient.invalidateQueries({ queryKey: ["q", "trips"] });
  }
}

/** Same as {@link invalidateHardCopyPodCaches} for a batch of trips (one org-wide pass). */
export function invalidateHardCopyPodCachesForTrips(
  queryClient: QueryClient,
  args: { tripIds: string[]; organizationId?: string | null },
): void {
  const tripIds = Array.from(
    new Set((args.tripIds ?? []).map((id) => String(id ?? "").trim()).filter(Boolean)),
  );
  const orgId = String(args.organizationId ?? "").trim();

  for (const tripId of tripIds) {
    void queryClient.invalidateQueries({ queryKey: queryKeys.trips.detail(tripId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.trips.bundle(tripId) });
  }

  if (orgId) {
    invalidateOrgHardCopyPodSurfaces(queryClient, orgId, tripIds);
  } else if (tripIds.length === 0) {
    void queryClient.invalidateQueries({ queryKey: ["q", "trips"] });
  }
}
