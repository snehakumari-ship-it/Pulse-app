/**
 * Sanitized open marketplace loads for a DCO (owner-operator). The RPC name is
 * historical; eligibility is the server-resolved DCO operating mode, not a
 * separate Fleet Owner identity.
 */
import { supabase } from '@/lib/supabase';
import { isVehicleTypeCompatibleWithFleet } from '@/features/marketplace/utils/fleetFit.util';

export type FleetOwnerOpenLoad = {
  id: string;
  indent_number: string | null;
  pickup_area: string | null;
  drop_location: string | null;
  vehicle_type: string | null;
  load_type: string | null;
  pickup_date: string | null;
  status: string | null;
  circulation_target: string | null;
  rate_offer: number | null;
  creator_organization_name: string | null;
  creator_organization_id?: string | null;
  creator_organization_logo_url?: string | null;
  creator_organization_avatar_seed?: string | null;
  created_at: string | null;
};

/**
 * list_open_marketplace_loads_for_fleet_owner returns the newest open loads up
 * to p_limit (clamped to 100) and takes no offset. A response shorter than the
 * limit is every open load; a full response may have left some unread.
 */
export const FLEET_OWNER_OPEN_LOADS_LIMIT = 50;

export async function listOpenMarketplaceLoadsForFleetOwner(
  limit = FLEET_OWNER_OPEN_LOADS_LIMIT,
): Promise<{ error: Error | null; loads: FleetOwnerOpenLoad[] }> {
  const { data, error } = await supabase().rpc(
    'list_open_marketplace_loads_for_fleet_owner',
    { p_limit: limit },
  );
  if (error) return { error: new Error(error.message), loads: [] };
  return { error: null, loads: (data ?? []) as FleetOwnerOpenLoad[] };
}

export function fleetOwnerLoadRouteLabel(load: FleetOwnerOpenLoad): string {
  const from = (load.pickup_area ?? '').trim() || 'Pickup';
  const to = (load.drop_location ?? '').trim() || 'Drop';
  return `${from} → ${to}`;
}

export function fleetOwnerLoadDisplayId(load: FleetOwnerOpenLoad): string {
  const n = (load.indent_number ?? '').trim();
  return n || load.id.slice(0, 8).toUpperCase();
}

export function formatFleetOwnerRateOffer(
  rate: number | null | undefined,
): string | null {
  if (rate == null || !Number.isFinite(Number(rate))) return null;
  return `₹${Number(rate).toLocaleString('en-IN')}`;
}

/** Soft compatibility: true when load vehicle_type loosely matches any owned vehicle. */
export function isLoadCompatibleWithFleet(
  load: FleetOwnerOpenLoad,
  fleetVehicleTypes: Array<string | null | undefined>,
): boolean {
  return isVehicleTypeCompatibleWithFleet(load.vehicle_type, fleetVehicleTypes);
}
