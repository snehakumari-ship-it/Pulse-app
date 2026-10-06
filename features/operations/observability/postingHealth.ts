import { supabase } from "@/lib/supabase";

export interface PostingHealthSnapshot {
  postingFailures: number;
  retrySpikes: number;
  duplicatePreventionHits: number;
}

export async function getPostingHealthSnapshot(input: {
  organizationId: string;
}): Promise<{ error: Error | null; snapshot: PostingHealthSnapshot | null }> {
  const selectFields = "posting_state,retry_count,posting_error";
  const [fuelRes, tollRes] = await Promise.all([
    supabase()
      .from("trip_fuel_entries")
      .select(selectFields)
      .eq("expense_context", "employer")
      .eq("employer_org_id", input.organizationId)
      .limit(500),
    supabase()
      .from("trip_toll_entries")
      .select(selectFields)
      .eq("expense_context", "employer")
      .eq("employer_org_id", input.organizationId)
      .limit(500),
  ]);
  if (fuelRes.error) return { error: new Error(fuelRes.error.message), snapshot: null };
  if (tollRes.error) return { error: new Error(tollRes.error.message), snapshot: null };
  const rows = [...(fuelRes.data ?? []), ...(tollRes.data ?? [])] as Array<{
    posting_state?: string | null;
    retry_count?: number | null;
    posting_error?: string | null;
  }>;
  const postingFailures = rows.filter(
    (row) => String(row.posting_state ?? "").toLowerCase() === "failed",
  ).length;
  const retrySpikes = rows.filter((row) => Number(row.retry_count ?? 0) >= 3).length;
  const duplicatePreventionHits = rows.filter((row) => {
    const msg = String(row.posting_error ?? "").toLowerCase();
    return msg.includes("duplicate") || msg.includes("already");
  }).length;
  return {
    error: null,
    snapshot: {
      postingFailures,
      retrySpikes,
      duplicatePreventionHits,
    },
  };
}
