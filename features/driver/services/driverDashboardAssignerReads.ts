/**
 * Independent "Assigned by" reads for the driver dashboard.
 * Wave 1 has no dependency between the assigner RPC and the assignment audit.
 * Wave 2 starts only after those ids exist. Profile and branding reads inside
 * wave 2 do not depend on each other.
 */
import { fetchOrgBrandingByIds } from "@/lib/orgBrandingFetch";
import { supabase } from "@/lib/supabase";
import { getLatestAssignmentAuditByTripIds } from "@/features/trips/services/trip-assignment-audit.service";

export function startDriverAssignerIdentityReads(tripIds: string[]) {
  return Promise.all([
    supabase().rpc("get_trip_assigner_displays_for_driver", { p_trip_ids: tripIds }),
    getLatestAssignmentAuditByTripIds(tripIds),
  ]);
}

export function startDriverAssignerFollowupReads(
  userIds: readonly string[],
  organizationIds: readonly string[],
) {
  const profiles =
    userIds.length > 0
      ? Promise.all([
          supabase()
            .from("profiles")
            .select("id, full_name, email, company_name")
            .in("id", [...userIds]),
          supabase()
            .from("organizations")
            .select("owner_id, name")
            .in("owner_id", [...userIds]),
          supabase()
            .from("organization_members")
            .select("user_id, organization_id")
            .in("user_id", [...userIds])
            .eq("status", "active"),
        ])
      : Promise.resolve(null);

  const organizations =
    organizationIds.length > 0
      ? Promise.all([
          supabase()
            .from("organizations")
            .select("id, name")
            .in("id", [...organizationIds]),
          fetchOrgBrandingByIds(organizationIds),
        ])
      : Promise.resolve(null);

  return Promise.all([profiles, organizations]);
}
