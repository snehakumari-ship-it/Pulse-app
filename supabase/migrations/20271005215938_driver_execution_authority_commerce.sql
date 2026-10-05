-- Driver Execution Authority — Step B (Commerce stop execution).
--
-- Adds ARRIVE_STOP / COMPLETE_STOP to public.driver_execute_command():
--   * strict stop order (every earlier stop must be terminal),
--   * per-stop POD from execution_plan_stops.pod_required,
--   * the first arrival on an assigned trip starts the trip,
--   * the final stop becoming terminal completes the trip in the same transaction.
-- FAIL_STOP / SKIP_STOP are part of the contract but not enabled for drivers.
-- Drivers lose direct UPDATE on public.stop_execution_state (a_ses_guard_driver_direct_write).
--
-- Also adds ACCEPT_TRIP (pending / scheduled / mover_asset draft -> assigned), the driver's
-- acceptance of an incoming trip. It precedes execution and is not part of the
-- allowed_commands ladder; START_TRIP still requires assigned.
--
-- Requires 20271005211835_driver_execution_authority_core.sql. Depends only on objects that
-- predate 20271005164900.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Allowed commands: Commerce gains the stop commands
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.driver_exec_allowed_commands(p_experience text, p_status text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path TO ''
AS $$
  SELECT CASE
    WHEN p_experience = 'commerce' THEN
      CASE p_status
        WHEN 'assigned'    THEN ARRAY['START_TRIP', 'ARRIVE_STOP', 'RECORD_ODOMETER']
        WHEN 'in_progress' THEN ARRAY['ARRIVE_STOP', 'COMPLETE_STOP', 'COMPLETE_TRIP', 'RECORD_ODOMETER']
        WHEN 'in_transit'  THEN ARRAY['ARRIVE_STOP', 'COMPLETE_STOP', 'COMPLETE_TRIP', 'RECORD_ODOMETER']
        WHEN 'at_drop'     THEN ARRAY['ARRIVE_STOP', 'COMPLETE_STOP', 'COMPLETE_TRIP', 'RECORD_ODOMETER']
        WHEN 'completed'   THEN ARRAY['RECORD_ODOMETER']
        ELSE ARRAY[]::text[]
      END
    ELSE
      CASE p_status
        WHEN 'assigned'    THEN ARRAY['START_TRIP', 'RECORD_ODOMETER']
        WHEN 'in_progress' THEN ARRAY['DEPART_PICKUP', 'UNDO_STEP', 'RECORD_ODOMETER']
        WHEN 'in_transit'  THEN ARRAY['ARRIVE_DROP', 'UNDO_STEP', 'RECORD_ODOMETER']
        WHEN 'at_drop'     THEN ARRAY['COMPLETE_TRIP', 'UNDO_STEP', 'RECORD_ODOMETER']
        WHEN 'completed'   THEN ARRAY['RECORD_ODOMETER']
        ELSE ARRAY[]::text[]
      END
  END;
$$;

REVOKE ALL ON FUNCTION public.driver_exec_allowed_commands(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.driver_exec_allowed_commands(text, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Supplier linkage guard, shared by COMPLETE_TRIP and derived Commerce completion
--    (server port of the former client-side validateSupplierLinkForCompletion;
--    asset / DCO / mover_asset execution is exempt). Internal: no client grant.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.driver_exec_supplier_link_missing(p_trip public.trips)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO ''
AS $$
  SELECT upper(trim(coalesce(p_trip.operating_mode, ''))) <> 'DCO'
     AND lower(trim(coalesce(p_trip.source, ''))) <> 'mover_asset'
     AND lower(trim(coalesce(p_trip.trip_payout_mode, ''))) <> 'asset'
     AND NOT (lower(trim(coalesce(p_trip.trip_payout_mode, ''))) = ''
              AND p_trip.driver_id IS NOT NULL AND p_trip.vehicle_id IS NOT NULL)
     AND (lower(trim(coalesce(p_trip.trip_payout_mode, ''))) = 'market' OR p_trip.supplier_id IS NOT NULL)
     AND (
       p_trip.supplier_id IS NULL
       OR (
         NOT EXISTS (SELECT 1 FROM public.suppliers s WHERE s.id = p_trip.supplier_id)
         AND NOT EXISTS (
           SELECT 1 FROM public.transactions x
           WHERE x.trip_id = p_trip.id AND x.contact_type = 'supplier'
         )
       )
     );
$$;

REVOKE ALL ON FUNCTION public.driver_exec_supplier_link_missing(public.trips) FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. The authority (full definition; supersedes Step A's)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.driver_execute_command(
  p_trip_id         uuid,
  p_command         text,
  p_command_id      uuid,
  p_expected_status text  DEFAULT NULL,
  p_payload         jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
-- Not '': trips triggers without their own search_path resolve unqualified names through
-- the caller's path.
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_uid            uuid  := (SELECT auth.uid());
  v_cmd            text  := upper(trim(coalesce(p_command, '')));
  v_payload        jsonb := coalesce(p_payload, '{}'::jsonb);
  v_expected       text  := CASE WHEN p_expected_status IS NULL THEN NULL
                                 ELSE public.driver_exec_canonical_status(p_expected_status) END;
  v_trip           public.trips%ROWTYPE;
  v_stop           public.stop_execution_state%ROWTYPE;
  v_state          text;
  v_experience     text;
  v_target         text;
  v_key            text;
  v_hash           text;
  v_idem           public.idempotency_keys%ROWTYPE;
  v_result         jsonb;
  v_applied        boolean := true;
  v_stops_total    integer;
  v_stops_open     integer;
  v_side           text;
  v_start_km       numeric;
  v_end_km         numeric;
  v_gps_km         numeric;
  v_odo_km         numeric;
  v_disc_km        numeric;
  v_source         text;
  v_odo_state      text;
  v_stop_id        uuid;
  v_stop_pod       boolean;
  v_stop_from      text;
  v_trip_started   boolean := false;
  v_trip_completed boolean := false;
BEGIN
  IF v_cmd NOT IN ('ACCEPT_TRIP', 'START_TRIP', 'DEPART_PICKUP', 'ARRIVE_DROP', 'COMPLETE_TRIP',
                   'UNDO_STEP', 'RECORD_ODOMETER', 'ARRIVE_STOP', 'COMPLETE_STOP', 'FAIL_STOP',
                   'SKIP_STOP')
     OR p_command_id IS NULL
     OR jsonb_typeof(v_payload) <> 'object' THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'invalid_command', 'command', v_cmd);
  END IF;

  -- Authorization + serialization: only the assigned driver's own trip, locked for the
  -- rest of the transaction. Unknown trip and foreign trip return the same answer.
  IF v_uid IS NOT NULL THEN
    SELECT t.* INTO v_trip
    FROM public.trips t
    WHERE t.id = p_trip_id
      AND t.deleted_at IS NULL
      AND EXISTS (
        SELECT 1 FROM public.drivers d
        WHERE d.id = t.driver_id AND d.user_id = v_uid
      )
    FOR UPDATE OF t;
  END IF;
  IF v_uid IS NULL OR v_trip.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'not_assigned_driver', 'command', v_cmd);
  END IF;

  v_state := public.driver_exec_canonical_status(v_trip.status);
  v_experience := CASE WHEN EXISTS (
      SELECT 1 FROM public.indents i
      WHERE i.id IN (v_trip.indent_id, v_trip.source_indent_id)
        AND i.execution_plan_id IS NOT NULL
    ) THEN 'commerce' ELSE 'core' END;

  -- Idempotency (checked under the trip lock, so same-key retries serialize).
  v_key  := 'driver_command:' || p_command_id::text;
  v_hash := md5(v_cmd || '|' || coalesce(v_expected, '') || '|' || v_payload::text);
  SELECT * INTO v_idem FROM public.idempotency_keys k WHERE k.key = v_key;
  IF FOUND AND v_idem.expires_at < now() THEN
    DELETE FROM public.idempotency_keys k WHERE k.key = v_key;
  ELSIF FOUND THEN
    IF v_idem.entity_type <> 'driver_command'
       OR v_idem.entity_id IS DISTINCT FROM v_trip.id
       OR v_idem.user_id IS DISTINCT FROM v_uid
       OR v_idem.request_hash <> v_hash THEN
      RETURN jsonb_build_object('ok', false, 'error_code', 'idempotency_conflict', 'command', v_cmd);
    END IF;
    RETURN coalesce(v_idem.response_payload, '{}'::jsonb) || jsonb_build_object('replayed', true);
  END IF;

  IF v_cmd <> 'ACCEPT_TRIP'
     AND v_state NOT IN ('assigned', 'in_progress', 'in_transit', 'at_drop', 'completed') THEN
    RETURN jsonb_build_object(
      'ok', false, 'error_code', 'trip_not_executable', 'command', v_cmd,
      'trip_status', v_state, 'experience', v_experience,
      'allowed_commands', to_jsonb(ARRAY[]::text[]));
  END IF;

  IF v_cmd IN ('FAIL_STOP', 'SKIP_STOP') THEN
    RETURN jsonb_build_object(
      'ok', false, 'error_code', 'command_not_enabled', 'command', v_cmd,
      'trip_status', v_state, 'experience', v_experience,
      'allowed_commands', to_jsonb(public.driver_exec_allowed_commands(v_experience, v_state)));
  END IF;

  IF v_cmd = 'RECORD_ODOMETER' THEN
    v_side := lower(coalesce(v_payload ->> 'side', ''));
    IF v_side NOT IN ('start', 'end', 'both')
       OR (v_side IN ('start', 'end') AND jsonb_typeof(v_payload -> 'odometer_km') NOT IN ('number', 'null'))
       OR (v_side = 'both' AND (jsonb_typeof(v_payload -> 'start_odometer_km') NOT IN ('number', 'null')
                              OR jsonb_typeof(v_payload -> 'end_odometer_km') NOT IN ('number', 'null')))
       OR (v_payload ? 'gps_distance_km' AND jsonb_typeof(v_payload -> 'gps_distance_km') NOT IN ('number', 'null')) THEN
      RETURN jsonb_build_object('ok', false, 'error_code', 'invalid_payload', 'command', v_cmd);
    END IF;

    v_start_km := CASE
      WHEN v_side = 'start' THEN (v_payload ->> 'odometer_km')::numeric
      WHEN v_side = 'both'  THEN (v_payload ->> 'start_odometer_km')::numeric
      ELSE v_trip.start_odometer_km END;
    v_end_km := CASE
      WHEN v_side = 'end'  THEN (v_payload ->> 'odometer_km')::numeric
      WHEN v_side = 'both' THEN (v_payload ->> 'end_odometer_km')::numeric
      ELSE v_trip.end_odometer_km END;
    v_gps_km := CASE WHEN v_payload ? 'gps_distance_km'
      THEN (v_payload ->> 'gps_distance_km')::numeric ELSE v_trip.gps_distance_km END;

    v_start_km := CASE WHEN v_start_km IS NULL OR v_start_km < 0 THEN NULL ELSE round(v_start_km, 1) END;
    v_end_km   := CASE WHEN v_end_km   IS NULL OR v_end_km   < 0 THEN NULL ELSE round(v_end_km, 1) END;
    v_gps_km   := CASE WHEN v_gps_km   IS NULL OR v_gps_km   < 0 THEN NULL ELSE round(v_gps_km, 1) END;
    v_odo_km   := CASE WHEN v_start_km IS NULL OR v_end_km IS NULL OR v_end_km < v_start_km
                       THEN NULL ELSE round(v_end_km - v_start_km, 1) END;
    v_disc_km  := CASE WHEN v_odo_km IS NULL OR v_gps_km IS NULL
                       THEN NULL ELSE round(abs(v_odo_km - v_gps_km), 1) END;
    v_source   := CASE
      WHEN v_odo_km IS NOT NULL AND v_gps_km IS NOT NULL THEN 'hybrid'
      WHEN v_odo_km IS NOT NULL THEN 'odometer'
      WHEN v_gps_km IS NOT NULL THEN 'gps'
      ELSE NULL END;
    v_odo_state := CASE
      WHEN v_trip.odometer_verification_state = 'business_verified' THEN 'business_verified'
      WHEN v_start_km IS NULL AND v_end_km IS NULL THEN 'none'
      WHEN (v_start_km IS NULL) <> (v_end_km IS NULL) THEN 'partial'
      WHEN v_gps_km IS NOT NULL AND v_disc_km IS NOT NULL THEN 'gps_verified'
      ELSE 'driver_verified' END;

    UPDATE public.trips t SET
      start_odometer_km           = v_start_km,
      end_odometer_km             = v_end_km,
      odometer_distance_km        = v_odo_km,
      gps_distance_km             = v_gps_km,
      distance_discrepancy_km     = v_disc_km,
      distance_source             = v_source,
      odometer_verification_state = v_odo_state,
      odometer_notes              = nullif(trim(coalesce(v_payload ->> 'notes', '')), ''),
      odometer_updated_by         = v_uid,
      odometer_updated_at         = now()
    WHERE t.id = v_trip.id
    RETURNING t.* INTO v_trip;

    v_result := jsonb_build_object(
      'ok', true, 'applied', true, 'replayed', false, 'command', v_cmd,
      'trip_id', v_trip.id, 'organization_id', v_trip.organization_id,
      'experience', v_experience, 'trip_status', v_state,
      'previous_status', v_state,
      'started_at', v_trip.started_at, 'completed_at', v_trip.completed_at,
      'updated_at', v_trip.updated_at,
      'odometer', jsonb_build_object(
        'start_odometer_km', v_trip.start_odometer_km,
        'end_odometer_km', v_trip.end_odometer_km,
        'odometer_distance_km', v_trip.odometer_distance_km,
        'gps_distance_km', v_trip.gps_distance_km,
        'distance_discrepancy_km', v_trip.distance_discrepancy_km,
        'distance_source', v_trip.distance_source,
        'odometer_verification_state', v_trip.odometer_verification_state,
        'odometer_notes', v_trip.odometer_notes,
        'odometer_updated_by', v_trip.odometer_updated_by,
        'odometer_updated_at', v_trip.odometer_updated_at),
      'allowed_commands', to_jsonb(public.driver_exec_allowed_commands(v_experience, v_state)));

  ELSIF v_cmd IN ('ARRIVE_STOP', 'COMPLETE_STOP') THEN
    IF v_experience <> 'commerce' THEN
      RETURN jsonb_build_object(
        'ok', false, 'error_code', 'invalid_transition', 'command', v_cmd,
        'trip_status', v_state, 'experience', v_experience,
        'allowed_commands', to_jsonb(public.driver_exec_allowed_commands(v_experience, v_state)));
    END IF;
    IF jsonb_typeof(v_payload -> 'stop_id') IS DISTINCT FROM 'string'
       OR (v_payload ->> 'stop_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RETURN jsonb_build_object('ok', false, 'error_code', 'invalid_payload', 'command', v_cmd);
    END IF;
    v_stop_id := (v_payload ->> 'stop_id')::uuid;

    -- Lock order: trip (above), then stop.
    SELECT s.* INTO v_stop
    FROM public.stop_execution_state s
    WHERE s.trip_id = v_trip.id AND s.stop_id = v_stop_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object(
        'ok', false, 'error_code', 'stop_not_found', 'command', v_cmd,
        'trip_status', v_state, 'experience', v_experience,
        'allowed_commands', to_jsonb(public.driver_exec_allowed_commands(v_experience, v_state)));
    END IF;

    SELECT coalesce(eps.pod_required, false) INTO v_stop_pod
    FROM public.execution_plan_stops eps
    WHERE eps.id = v_stop.stop_id;

    v_target    := CASE v_cmd WHEN 'ARRIVE_STOP' THEN 'arrived' ELSE 'completed' END;
    v_stop_from := CASE v_cmd WHEN 'ARRIVE_STOP' THEN 'pending' ELSE 'arrived' END;

    IF v_stop.status = v_target THEN
      -- Already there (lost response / expired key): report current state, change nothing.
      v_applied := false;
    ELSE
      IF v_expected IS NOT NULL AND v_expected <> v_state THEN
        RETURN jsonb_build_object(
          'ok', false, 'error_code', 'stale_state', 'command', v_cmd,
          'trip_status', v_state, 'experience', v_experience,
          'stop', jsonb_build_object('stop_id', v_stop.stop_id, 'status', v_stop.status),
          'allowed_commands', to_jsonb(public.driver_exec_allowed_commands(v_experience, v_state)));
      END IF;

      IF NOT (v_cmd = ANY (public.driver_exec_allowed_commands(v_experience, v_state)))
         OR v_stop.status <> v_stop_from THEN
        RETURN jsonb_build_object(
          'ok', false, 'error_code', 'invalid_transition', 'command', v_cmd,
          'trip_status', v_state, 'experience', v_experience,
          'stop', jsonb_build_object('stop_id', v_stop.stop_id, 'status', v_stop.status),
          'allowed_commands', to_jsonb(public.driver_exec_allowed_commands(v_experience, v_state)));
      END IF;

      -- Strict order: same (sequence, stop_id) ordering as the driver app's current stop.
      IF EXISTS (
          SELECT 1 FROM public.stop_execution_state s
          WHERE s.trip_id = v_trip.id
            AND s.id <> v_stop.id
            AND s.status NOT IN ('completed', 'skipped', 'failed')
            AND (s.sequence < v_stop.sequence
                 OR (s.sequence = v_stop.sequence
                     AND s.stop_id::text COLLATE "C" < v_stop.stop_id::text COLLATE "C"))
        ) THEN
        RETURN jsonb_build_object(
          'ok', false, 'error_code', 'stop_out_of_order', 'command', v_cmd,
          'trip_status', v_state, 'experience', v_experience,
          'stop', jsonb_build_object('stop_id', v_stop.stop_id, 'status', v_stop.status),
          'allowed_commands', to_jsonb(public.driver_exec_allowed_commands(v_experience, v_state)));
      END IF;

      IF v_cmd = 'ARRIVE_STOP' AND v_state = 'assigned' THEN
        IF EXISTS (
            SELECT 1 FROM public.trips o
            WHERE o.driver_id = v_trip.driver_id
              AND o.id <> v_trip.id
              AND o.deleted_at IS NULL
              AND public.driver_exec_canonical_status(o.status) IN ('in_progress', 'in_transit', 'at_drop')
          ) THEN
          RETURN jsonb_build_object(
            'ok', false, 'error_code', 'other_active_trip', 'command', v_cmd,
            'trip_status', v_state, 'experience', v_experience,
            'allowed_commands', to_jsonb(public.driver_exec_allowed_commands(v_experience, v_state)));
        END IF;
        v_trip_started := true;
      END IF;

      IF v_cmd = 'COMPLETE_STOP' THEN
        IF v_stop_pod AND NOT EXISTS (
            SELECT 1 FROM public.trip_documents td
            WHERE td.trip_id = v_trip.id
              AND td.stop_id = v_stop.stop_id
              AND td.document_type = 'pod'
              AND coalesce(td.status, 'pending') <> 'rejected'
          ) THEN
          RETURN jsonb_build_object(
            'ok', false, 'error_code', 'pod_required', 'command', v_cmd,
            'trip_status', v_state, 'experience', v_experience,
            'stop', jsonb_build_object('stop_id', v_stop.stop_id, 'status', v_stop.status),
            'allowed_commands', to_jsonb(public.driver_exec_allowed_commands(v_experience, v_state)));
        END IF;

        -- Final stop: the trip completes in this transaction, so its guards run first and a
        -- failure leaves the stop unchanged (all stops terminal <=> trip completed).
        IF NOT EXISTS (
            SELECT 1 FROM public.stop_execution_state s
            WHERE s.trip_id = v_trip.id
              AND s.id <> v_stop.id
              AND s.status NOT IN ('completed', 'skipped', 'failed')
          ) THEN
          IF public.driver_exec_supplier_link_missing(v_trip) THEN
            RETURN jsonb_build_object(
              'ok', false, 'error_code', 'supplier_link_required', 'command', v_cmd,
              'trip_status', v_state, 'experience', v_experience,
              'stop', jsonb_build_object('stop_id', v_stop.stop_id, 'status', v_stop.status),
              'allowed_commands', to_jsonb(public.driver_exec_allowed_commands(v_experience, v_state)));
          END IF;
          v_trip_completed := true;
        END IF;
      END IF;

      IF v_trip_started THEN
        UPDATE public.trips t SET
          status               = 'in_progress',
          started_at           = coalesce(t.started_at, now()),
          status_change_origin = 'driver_command'
        WHERE t.id = v_trip.id
        RETURNING t.* INTO v_trip;
      END IF;

      UPDATE public.stop_execution_state s SET
        status       = v_target,
        arrived_at   = CASE WHEN v_target = 'arrived' THEN now() ELSE s.arrived_at END,
        completed_at = CASE WHEN v_target = 'completed' THEN now() ELSE s.completed_at END
      WHERE s.id = v_stop.id
      RETURNING s.* INTO v_stop;

      IF v_trip_completed THEN
        UPDATE public.trips t SET
          status               = 'completed',
          completed_at         = now(),
          status_change_origin = 'driver_command'
        WHERE t.id = v_trip.id
        RETURNING t.* INTO v_trip;
      END IF;
    END IF;

    SELECT count(*), count(*) FILTER (WHERE s.status NOT IN ('completed', 'skipped', 'failed'))
      INTO v_stops_total, v_stops_open
    FROM public.stop_execution_state s
    WHERE s.trip_id = v_trip.id;

    v_result := jsonb_build_object(
      'ok', true, 'applied', v_applied, 'replayed', false, 'command', v_cmd,
      'trip_id', v_trip.id, 'organization_id', v_trip.organization_id,
      'experience', v_experience,
      'previous_status', v_state,
      'trip_status', public.driver_exec_canonical_status(v_trip.status),
      'started_at', v_trip.started_at, 'completed_at', v_trip.completed_at,
      'updated_at', v_trip.updated_at,
      'trip_started', v_trip_started, 'trip_completed', v_trip_completed,
      'stops_total', v_stops_total, 'stops_open', v_stops_open,
      'stop', jsonb_build_object(
        'trip_id', v_stop.trip_id,
        'stop_id', v_stop.stop_id,
        'sequence', v_stop.sequence,
        'driver_id', v_stop.driver_id,
        'status', v_stop.status,
        'arrived_at', v_stop.arrived_at,
        'completed_at', v_stop.completed_at,
        'skip_reason', v_stop.skip_reason,
        'failure_reason', v_stop.failure_reason,
        'pod_required', v_stop_pod),
      'allowed_commands', to_jsonb(public.driver_exec_allowed_commands(
        v_experience, public.driver_exec_canonical_status(v_trip.status))));

  ELSIF v_cmd = 'ACCEPT_TRIP' THEN
    -- The incoming states the driver dashboard offers for acceptance; draft only for
    -- mover_asset shell trips, which are dispatched in draft.
    IF v_state = 'assigned' THEN
      v_applied := false;
    ELSIF v_state IN ('pending', 'scheduled')
          OR (v_state = 'draft' AND lower(trim(coalesce(v_trip.source, ''))) = 'mover_asset') THEN
      IF v_expected IS NOT NULL AND v_expected <> v_state THEN
        RETURN jsonb_build_object(
          'ok', false, 'error_code', 'stale_state', 'command', v_cmd,
          'trip_status', v_state, 'experience', v_experience,
          'allowed_commands', to_jsonb(public.driver_exec_allowed_commands(v_experience, v_state)));
      END IF;
      UPDATE public.trips t SET
        status               = 'assigned',
        status_change_origin = 'driver_command'
      WHERE t.id = v_trip.id
      RETURNING t.* INTO v_trip;
    ELSE
      RETURN jsonb_build_object(
        'ok', false, 'error_code', 'invalid_transition', 'command', v_cmd,
        'trip_status', v_state, 'experience', v_experience,
        'allowed_commands', to_jsonb(public.driver_exec_allowed_commands(v_experience, v_state)));
    END IF;

    v_result := jsonb_build_object(
      'ok', true, 'applied', v_applied, 'replayed', false, 'command', v_cmd,
      'trip_id', v_trip.id, 'organization_id', v_trip.organization_id,
      'experience', v_experience,
      'previous_status', v_state,
      'trip_status', public.driver_exec_canonical_status(v_trip.status),
      'started_at', v_trip.started_at, 'completed_at', v_trip.completed_at,
      'updated_at', v_trip.updated_at,
      'allowed_commands', to_jsonb(public.driver_exec_allowed_commands(
        v_experience, public.driver_exec_canonical_status(v_trip.status))));

  ELSE
    -- Trip status commands. UNDO_STEP always needs the state the driver is undoing from.
    IF v_cmd = 'UNDO_STEP' AND v_expected IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error_code', 'invalid_command', 'command', v_cmd);
    END IF;

    v_target := CASE
      WHEN v_cmd = 'START_TRIP'    THEN 'in_progress'
      WHEN v_cmd = 'DEPART_PICKUP' THEN 'in_transit'
      WHEN v_cmd = 'ARRIVE_DROP'   THEN 'at_drop'
      WHEN v_cmd = 'COMPLETE_TRIP' THEN 'completed'
      WHEN v_cmd = 'UNDO_STEP'     THEN CASE v_expected
                                          WHEN 'in_progress' THEN 'assigned'
                                          WHEN 'in_transit'  THEN 'in_progress'
                                          WHEN 'at_drop'     THEN 'in_transit'
                                          ELSE NULL END
    END;

    IF v_cmd <> 'UNDO_STEP' AND v_state = v_target THEN
      v_applied := false;
    ELSE
      IF v_expected IS NOT NULL AND v_expected <> v_state THEN
        RETURN jsonb_build_object(
          'ok', false, 'error_code', 'stale_state', 'command', v_cmd,
          'trip_status', v_state, 'experience', v_experience,
          'allowed_commands', to_jsonb(public.driver_exec_allowed_commands(v_experience, v_state)));
      END IF;

      IF v_target IS NULL
         OR NOT (v_cmd = ANY (public.driver_exec_allowed_commands(v_experience, v_state))) THEN
        RETURN jsonb_build_object(
          'ok', false, 'error_code', 'invalid_transition', 'command', v_cmd,
          'trip_status', v_state, 'experience', v_experience,
          'allowed_commands', to_jsonb(public.driver_exec_allowed_commands(v_experience, v_state)));
      END IF;

      IF v_cmd = 'START_TRIP' AND EXISTS (
          SELECT 1 FROM public.trips o
          WHERE o.driver_id = v_trip.driver_id
            AND o.id <> v_trip.id
            AND o.deleted_at IS NULL
            AND public.driver_exec_canonical_status(o.status) IN ('in_progress', 'in_transit', 'at_drop')
        ) THEN
        RETURN jsonb_build_object(
          'ok', false, 'error_code', 'other_active_trip', 'command', v_cmd,
          'trip_status', v_state, 'experience', v_experience,
          'allowed_commands', to_jsonb(public.driver_exec_allowed_commands(v_experience, v_state)));
      END IF;

      IF v_cmd = 'COMPLETE_TRIP' THEN
        IF v_experience = 'commerce' THEN
          SELECT count(*), count(*) FILTER (WHERE s.status NOT IN ('completed', 'skipped', 'failed'))
            INTO v_stops_total, v_stops_open
          FROM public.stop_execution_state s
          WHERE s.trip_id = v_trip.id;
          IF v_stops_total = 0 OR v_stops_open > 0 THEN
            RETURN jsonb_build_object(
              'ok', false, 'error_code', 'stops_incomplete', 'command', v_cmd,
              'trip_status', v_state, 'experience', v_experience,
              'stops_total', v_stops_total, 'stops_open', v_stops_open,
              'allowed_commands', to_jsonb(public.driver_exec_allowed_commands(v_experience, v_state)));
          END IF;
        ELSIF coalesce(v_trip.pod_required, true) AND NOT (
            EXISTS (
              SELECT 1 FROM public.trip_documents td
              WHERE td.trip_id = v_trip.id
                AND td.document_type = 'pod'
                AND coalesce(td.status, 'pending') <> 'rejected'
            )
            OR EXISTS (
              SELECT 1 FROM storage.objects o
              WHERE o.bucket_id = 'trip-documents'
                AND o.name LIKE v_trip.id::text || '/pod/%'
            )
          ) THEN
          RETURN jsonb_build_object(
            'ok', false, 'error_code', 'pod_required', 'command', v_cmd,
            'trip_status', v_state, 'experience', v_experience,
            'allowed_commands', to_jsonb(public.driver_exec_allowed_commands(v_experience, v_state)));
        END IF;

        IF public.driver_exec_supplier_link_missing(v_trip) THEN
          RETURN jsonb_build_object(
            'ok', false, 'error_code', 'supplier_link_required', 'command', v_cmd,
            'trip_status', v_state, 'experience', v_experience,
            'allowed_commands', to_jsonb(public.driver_exec_allowed_commands(v_experience, v_state)));
        END IF;
      END IF;

      UPDATE public.trips t SET
        status               = v_target,
        started_at           = CASE
                                 WHEN v_target = 'assigned' THEN NULL
                                 WHEN v_target IN ('in_progress', 'in_transit', 'at_drop')
                                   THEN coalesce(t.started_at, now())
                                 ELSE t.started_at END,
        completed_at         = CASE WHEN v_target = 'completed' THEN now() ELSE t.completed_at END,
        status_change_origin = 'driver_command'
      WHERE t.id = v_trip.id
      RETURNING t.* INTO v_trip;
    END IF;

    v_result := jsonb_build_object(
      'ok', true, 'applied', v_applied, 'replayed', false, 'command', v_cmd,
      'trip_id', v_trip.id, 'organization_id', v_trip.organization_id,
      'experience', v_experience,
      'previous_status', v_state,
      'trip_status', public.driver_exec_canonical_status(v_trip.status),
      'started_at', v_trip.started_at, 'completed_at', v_trip.completed_at,
      'updated_at', v_trip.updated_at,
      'allowed_commands', to_jsonb(public.driver_exec_allowed_commands(
        v_experience, public.driver_exec_canonical_status(v_trip.status))));
  END IF;

  -- Plain INSERT: a concurrent same-key call on another trip raises unique_violation and
  -- rolls back its mutation, so one key never produces two mutations.
  INSERT INTO public.idempotency_keys (
    key, entity_type, entity_id, org_id, user_id, request_hash,
    response_payload, status, completed_at, expires_at
  ) VALUES (
    v_key, 'driver_command', v_trip.id, v_trip.organization_id, v_uid, v_hash,
    v_result, 'completed', now(), now() + interval '7 days'
  );

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.driver_execute_command(uuid, text, uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.driver_execute_command(uuid, text, uuid, text, jsonb) TO authenticated;

COMMENT ON FUNCTION public.driver_execute_command(uuid, text, uuid, text, jsonb) IS
  'Driver Execution Authority. The only path by which a driver accepts a trip or changes trip execution state, Commerce stop state or odometer readings.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Guard: direct (non-authority) driver writes to stop_execution_state
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ses_guard_driver_write_denied(p_trip_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.trips t
    JOIN public.drivers d ON d.id = t.driver_id
    WHERE t.id = p_trip_id
      AND d.user_id = (SELECT auth.uid())
      AND NOT public.is_org_staff(t.organization_id)
  );
$$;

REVOKE ALL ON FUNCTION public.ses_guard_driver_write_denied(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ses_guard_driver_write_denied(uuid) TO authenticated;

-- SECURITY INVOKER on purpose (see trips_guard_driver_direct_write).
CREATE OR REPLACE FUNCTION public.ses_guard_driver_direct_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $$
BEGIN
  IF current_user = 'authenticated' AND public.ses_guard_driver_write_denied(OLD.trip_id) THEN
    RAISE EXCEPTION 'driver_direct_stop_write_denied'
      USING ERRCODE = '42501',
            HINT    = 'Drivers change stop state through driver_execute_command().';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.ses_guard_driver_direct_write() FROM PUBLIC, anon;

-- Policy stop_execution_state_driver_update stays as the row gate; this trigger rejects every
-- driver UPDATE. Same lock budget as a_trips_guard_driver_direct_write (no DROP TRIGGER, no
-- COMMENT ON POLICY).
CREATE OR REPLACE TRIGGER a_ses_guard_driver_direct_write
  BEFORE UPDATE ON public.stop_execution_state
  FOR EACH ROW
  EXECUTE FUNCTION public.ses_guard_driver_direct_write();

NOTIFY pgrst, 'reload schema';
