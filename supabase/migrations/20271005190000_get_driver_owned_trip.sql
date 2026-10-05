-- D1: driver-owned PK read for Home → Odometer / Expense miss path.
--
-- supabase migration new on wall-clock 2026-10-05 would emit 20261005…, which
-- sorts BEFORE the 20270913 Commerce / 20271005 DCO head. This version is the
-- next non-midnight sort key after 20271005164900 and does not edit that file.
--
-- Direct view-shaped projection from public.trips. Does NOT SELECT
-- trips_driver_view (security_invoker would re-enter the trips RLS graph).
-- Does not replace trips_driver_view. Does not change trips policies.

CREATE OR REPLACE FUNCTION public.get_driver_owned_trip(p_trip_id uuid)
RETURNS TABLE (
  id uuid,
  driver_id uuid,
  driver_display_trip_id text,
  status text,
  pickup_location text,
  pickup_address text,
  pickup_scheduled_at date,
  dropoff_location text,
  dropoff_address text,
  dropoff_scheduled_at timestamptz,
  instructions text,
  vehicle_id uuid,
  pickup_lat numeric,
  pickup_lon numeric,
  drop_lat numeric,
  drop_lon numeric,
  started_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  client_price numeric,
  supplier_rate numeric,
  driver_commission numeric,
  distance numeric,
  organization_id uuid,
  source text,
  supplier_id uuid,
  completed_at timestamptz,
  trip_number text,
  indent_id uuid,
  source_indent_id uuid,
  organization_name text,
  start_odometer_km numeric,
  end_odometer_km numeric,
  odometer_distance_km numeric,
  gps_distance_km numeric,
  distance_discrepancy_km numeric,
  distance_source text,
  odometer_verification_state text,
  odometer_notes text,
  odometer_updated_at timestamptz,
  trip_payout_mode text,
  owner_vehicle_id uuid,
  operating_mode text,
  dco_payee_id uuid,
  execution_plan_id uuid,
  is_commerce boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    t.id,
    t.driver_id,
    t.driver_display_trip_id,
    t.status,
    t.pickup_area AS pickup_location,
    t.pickup_area AS pickup_address,
    t.pickup_date AS pickup_scheduled_at,
    t.drop_location AS dropoff_location,
    t.drop_location AS dropoff_address,
    NULL::timestamptz AS dropoff_scheduled_at,
    t.notes AS instructions,
    t.vehicle_id,
    t.pickup_lat,
    t.pickup_lon,
    t.drop_lat,
    t.drop_lon,
    t.started_at,
    t.created_at,
    t.updated_at,
    t.client_price,
    t.supplier_rate,
    t.driver_commission,
    t.distance,
    t.organization_id,
    t.source,
    t.supplier_id,
    t.completed_at,
    t.trip_number,
    t.indent_id,
    t.source_indent_id,
    public.org_display_name(t.organization_id) AS organization_name,
    t.start_odometer_km,
    t.end_odometer_km,
    t.odometer_distance_km,
    t.gps_distance_km,
    t.distance_discrepancy_km,
    t.distance_source,
    t.odometer_verification_state,
    t.odometer_notes,
    t.odometer_updated_at,
    t.trip_payout_mode,
    t.owner_vehicle_id,
    t.operating_mode,
    t.dco_payee_id,
    commerce_origin.execution_plan_id,
    (commerce_origin.execution_plan_id IS NOT NULL) AS is_commerce
  FROM public.trips t
  JOIN public.drivers d ON d.id = t.driver_id
  LEFT JOIN LATERAL (
    SELECT COALESCE(
      (SELECT i.execution_plan_id FROM public.indents i WHERE i.id = t.indent_id),
      (SELECT i.execution_plan_id FROM public.indents i WHERE i.id = t.source_indent_id)
    ) AS execution_plan_id
  ) commerce_origin ON true
  WHERE t.id = p_trip_id
    AND d.user_id = (SELECT auth.uid());
$function$;

COMMENT ON FUNCTION public.get_driver_owned_trip(uuid) IS
  'D1. Driver-owned trip PK read: auth.uid() → drivers.user_id → trips.driver_id → p_trip_id. '
  'Returns the trips_driver_view-shaped projection without selecting that view. '
  'Unauthorized callers, anon (no EXECUTE), and auth.uid() IS NULL get zero rows. '
  'Does not replace trips_driver_view or general trips authorization. '
  'EXECUTE: authenticated only — never PUBLIC/anon. Re-apply REVOKE/GRANT after any DROP/CREATE.';

REVOKE ALL ON FUNCTION public.get_driver_owned_trip(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_driver_owned_trip(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_driver_owned_trip(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
