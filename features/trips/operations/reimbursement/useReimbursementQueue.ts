import { useQuery } from "@tanstack/react-query";
import { getTripOperationalDisplay } from "@/features/operations/display";
import { queryKeys } from "@/lib/queryKeys";
import { supabase } from "@/lib/supabase";
import { STALE } from "@/lib/queryClient";
import type { ReimbursementState } from "../types";
import {
  buildReimbursementMetrics,
  type ReimbursementMetrics,
} from "./reimbursementMetrics";
import {
  toEnterpriseReimbursementState,
  type EnterpriseReimbursementState,
} from "./reimbursementEngine";

interface ReimbursementQueueItem {
  id: string;
  sourceType: "fuel" | "toll" | "other";
  tripId: string;
  tripLabel: string;
  amountInr: number;
  state: EnterpriseReimbursementState;
  enteredAt: string;
  paymentOwner: string | null;
}

interface QueueResult {
  items: ReimbursementQueueItem[];
  metrics: ReimbursementMetrics;
}

type QueueRow = {
  expense_kind: "fuel" | "toll" | "other";
  id: string;
  trip_id: string;
  amount_inr: number | null;
  reimbursement_state: ReimbursementState | null;
  approval_state: string | null;
  payment_owner: string | null;
  reimbursement_notes: string | null;
  entered_at: string;
};

type QueueTripRow = {
  id: string;
  trip_operational_code?: string | null;
  trip_code?: string | null;
  display_trip_id?: string | null;
  trip_number?: string | null;
};

const QUEUE_LIMIT = 500;

/** Driver-paid employer expenses this organization reviews (fuel, toll and other). */
export function useReimbursementQueue(input: {
  organizationId: string | null;
  enabled?: boolean;
}) {
  const enabled = (input.enabled ?? true) && !!input.organizationId;
  return useQuery<QueueResult>({
    queryKey: input.organizationId
      ? queryKeys.operations.reimbursementQueue(input.organizationId)
      : ["q", "operations", "reimbursement-queue", "noop"],
    queryFn: async () => {
      const rowsRes = await supabase()
        .from("trip_expenses")
        .select(
          "expense_kind,id,trip_id,amount_inr,reimbursement_state,approval_state,payment_owner,reimbursement_notes,entered_at",
        )
        .eq("expense_context", "employer")
        .eq("employer_org_id", input.organizationId!)
        .eq("payment_owner", "driver")
        .neq("expense_status", "cancelled")
        .order("entered_at", { ascending: false })
        .limit(QUEUE_LIMIT);
      if (rowsRes.error) throw new Error(rowsRes.error.message);
      const rows = (rowsRes.data ?? []) as QueueRow[];

      const tripIds = [...new Set(rows.map((row) => row.trip_id))];
      const tripsById = new Map<string, QueueTripRow>();
      if (tripIds.length > 0) {
        const tripsRes = await supabase()
          .from("trips")
          .select("id,trip_operational_code,trip_code,display_trip_id,trip_number")
          .in("id", tripIds);
        if (tripsRes.error) throw new Error(tripsRes.error.message);
        for (const trip of (tripsRes.data ?? []) as QueueTripRow[]) tripsById.set(trip.id, trip);
      }

      const items: ReimbursementQueueItem[] = rows.map((row) => {
        const trip = tripsById.get(row.trip_id);
        return {
          id: `${row.expense_kind}:${row.id}`,
          sourceType: row.expense_kind,
          tripId: row.trip_id,
          tripLabel: getTripOperationalDisplay({
            trip_operational_code: trip?.trip_operational_code ?? null,
            trip_code: trip?.trip_code ?? null,
            display_trip_id: trip?.display_trip_id ?? null,
            trip_number: trip?.trip_number ?? null,
          }),
          amountInr: Number(row.amount_inr ?? 0),
          state: toEnterpriseReimbursementState({
            reimbursementState: row.reimbursement_state,
            approvalState: row.approval_state,
            paymentOwner: row.payment_owner,
            reimbursementNotes: row.reimbursement_notes,
          }),
          enteredAt: row.entered_at,
          paymentOwner: row.payment_owner,
        };
      });
      const metrics = buildReimbursementMetrics(
        items.map((item) => ({ amountInr: item.amountInr, state: item.state })),
      );
      return { items, metrics };
    },
    enabled,
    staleTime: STALE.frequent,
  });
}
