-- Driver list Commerce origin.
--
-- trips_driver_view stays security_invoker and keeps its driver_id / auth.uid()
-- filter. Drivers cannot SELECT indents, so the plan id is resolved by a
-- narrowly scoped SECURITY DEFINER helper that returns only
-- indents.execution_plan_id when the caller owns a trip linked to that indent.
--
-- Plan resolution is not a COALESCE of indent ids:
--   1. plan on the indent referenced by trips.indent_id
--   2. only if that plan id is null, plan on trips.source_indent_id
-- Shipper trips set indent_id. Mover asset trips leave indent_id null and set
-- source_indent_id. Those columns are not interchangeable.
--
-- Depends on indents.execution_plan_id (20270913090000) and the view body in
-- 20270912140000. Does not depend on the DCO operating-model migrations.

BEGIN;

CREATE OR REPLACE FUNCTION public.driver_owned_indent_execution_plan_id(p_indent_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT i.execution_plan_id
  FROM public.indents i
  WHERE p_indent_id IS NOT NULL
    AND i.id = p_indent_id
    AND EXISTS (
      SELECT 1
      FROM public.trips t
      JOIN public.drivers d ON d.id = t.driver_id
      WHERE d.user_id = (SELECT auth.uid())
        AND (
          t.indent_id = p_indent_id
          OR t.source_indent_id = p_indent_id
        )
    );
$$;

COMMENT ON FUNCTION public.driver_owned_indent_execution_plan_id(uuid) IS
  'Returns indents.execution_plan_id only when auth.uid() owns a trip whose indent_id or source_indent_id is the argument. Null argument, unknown indent, or unowned indent returns null. Does not return indent, customer, order, or financial columns.';

REVOKE ALL ON FUNCTION public.driver_owned_indent_execution_plan_id(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.driver_owned_indent_execution_plan_id(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.driver_owned_indent_execution_plan_id(uuid) TO authenticated;

CREATE OR REPLACE VIEW public.trips_driver_view
WITH (security_invoker = true) AS
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
  NULL::timestamp with time zone AS dropoff_scheduled_at,
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
  commerce_origin.execution_plan_id AS execution_plan_id,
  (commerce_origin.execution_plan_id IS NOT NULL) AS is_commerce
FROM public.trips t
LEFT JOIN LATERAL (
  SELECT COALESCE(
    public.driver_owned_indent_execution_plan_id(t.indent_id),
    public.driver_owned_indent_execution_plan_id(t.source_indent_id)
  ) AS execution_plan_id
) commerce_origin ON true
WHERE t.driver_id IN (
  SELECT d.id FROM public.drivers d WHERE d.user_id = (SELECT auth.uid())
);

COMMENT ON VIEW public.trips_driver_view IS
  'Driver-scoped trip projection (security_invoker; self-scopes via auth.uid()). '
  'operating_mode + dco_payee_id (20270912140000) let the driver app treat DCO '
  'trips as driver-owned economics without collapsing them into Asset or Market. '
  'execution_plan_id + is_commerce (20261005122951) are the authoritative Commerce '
  'origin: plan id from indent_id, then source_indent_id only when that plan is null. '
  'Columns here must stay in sync with DriverTripRow in types/trip-views.ts.';

COMMIT;
