import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  cancelExchangePayment,
  claimExchangePayment,
  confirmExchangePayment,
  getExchangeTripSummary,
  listExchangeTrips,
  rejectExchangePayment,
  type ClaimExchangePaymentInput,
  type ExchangeLaneTrip,
  type ExchangePaymentRow,
  type ExchangeTripSummary,
} from "@/features/marketplace/services/exchangePayments.service";
import { queryKeys } from "@/lib/queryKeys";
import { STALE } from "@/lib/queryClient";

export function useExchangeTripSummaryQuery(tripId: string | null | undefined) {
  return useQuery<ExchangeTripSummary | null, Error>({
    queryKey: queryKeys.exchange.tripSummary(tripId ?? ""),
    queryFn: async () => {
      const { error, summary } = await getExchangeTripSummary(tripId!);
      if (error) throw error;
      return summary;
    },
    enabled: !!tripId,
    staleTime: STALE.frequent,
  });
}

export function useExchangeTripsLaneQuery(orgId: string | null | undefined) {
  return useQuery<ExchangeLaneTrip[], Error>({
    queryKey: queryKeys.exchange.lane(orgId ?? ""),
    queryFn: async () => {
      const { error, trips } = await listExchangeTrips(orgId!);
      if (error) throw error;
      return trips;
    },
    enabled: !!orgId,
    staleTime: STALE.frequent,
  });
}

type ExchangeAction =
  | { kind: "claim"; input: Omit<ClaimExchangePaymentInput, "tripId"> }
  | { kind: "confirm"; paymentId: string }
  | { kind: "reject"; paymentId: string; reason: string }
  | { kind: "cancel"; paymentId: string };

async function runExchangeAction(tripId: string, action: ExchangeAction): Promise<ExchangePaymentRow> {
  const result =
    action.kind === "claim"
      ? await claimExchangePayment({ ...action.input, tripId })
      : action.kind === "confirm"
        ? await confirmExchangePayment(action.paymentId)
        : action.kind === "reject"
          ? await rejectExchangePayment(action.paymentId, action.reason)
          : await cancelExchangePayment(action.paymentId);
  if (result.error || !result.payment) throw result.error ?? new Error("Exchange payment failed.");
  return result.payment;
}

/**
 * Claim / confirm / reject / withdraw on one trip. A confirmation refreshes the
 * trip and, when the viewer has an org (not an individual DCO), its Finance views.
 */
export function useExchangeTripPaymentAction(tripId: string, organizationId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation<ExchangePaymentRow, Error, ExchangeAction>({
    mutationFn: (action) => runExchangeAction(tripId, action),
    onSuccess: (payment) => {
      void qc.invalidateQueries({ queryKey: queryKeys.exchange.tripSummary(tripId) });
      void qc.invalidateQueries({ queryKey: queryKeys.exchange.lanesAll() });
      if (payment.status !== "confirmed") return;
      void qc.invalidateQueries({ queryKey: queryKeys.trips.detail(tripId) });
      if (!organizationId) return;
      void qc.invalidateQueries({ queryKey: queryKeys.transactions.all(organizationId) });
      void qc.invalidateQueries({ queryKey: queryKeys.suppliers.all(organizationId) });
      void qc.invalidateQueries({ queryKey: queryKeys.clients.all(organizationId) });
    },
  });
}
