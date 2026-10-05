-- Driver Execution Authority — Step A (Core FTL + Commerce trip-level start / guarded complete).
--
-- Drivers change trip execution state only through public.driver_execute_command().
-- Direct driver writes to public.trips are limited to `notes` (status-note append) and
-- `updated_at` by the a_trips_guard_driver_direct_write trigger. Commerce stop commands,
-- per-stop POD and derived Commerce completion are Step B and are not in this file.
--
-- Depends only on objects that predate 20271005164900 (is_org_staff, idempotency_keys,
-- trips, drivers, indents, trip_documents, stop_execution_state, suppliers, transactions).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Canonical status (read-side tolerance for legacy values; never written)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.driver_exec_canonical_status(p_status text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO ''
AS $$
  SELECT CASE lower(trim(coalesce(p_status, '')))
    WHEN 'active'      THEN 'assigned'
    WHEN 'picked_up'   THEN 'in_progress'
    WHEN 'at_pickup'   THEN 'in_progress'
    WHEN 'loading'     THEN 'in_progress'
    WHEN 'transit'     THEN 'in_transit'
    WHEN 'unloading'   THEN 'at_drop'
    WHEN 'delivered'   THEN 'completed'
    WHEN 'done'        THEN 'completed'
    ELSE lower(trim(coalesce(p_status, '')))
  END;
$$;

REVOKE ALL ON FUNCTION public.driver_exec_canonical_status(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.driver_exec_canonical_status(text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Allowed commands for a (experience, canonical status) pair
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
        WHEN 'assigned'    THEN ARRAY['START_TRIP', 'RECORD_ODOMETER']
        WHEN 'in_progress' THEN ARRAY['COMPLETE_TRIP', 'RECORD_ODOMETER']
        WHEN 'in_transit'  THEN ARRAY['COMPLETE_TRIP', 'RECORD_ODOMETER']
        WHEN 'at_drop'     THEN ARRAY['COMPLETE_TRIP', 'RECORD_ODOMETER']
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
-- 3. The authority
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
-- Not '': trips triggers without their own search_path (fill_driver_commission) resolve
-- unqualified names through the caller's path.
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_uid          uuid  := (SELECT auth.uid());
  v_cmd          text  := upper(trim(coalesce(p_command, '')));
  v_payload      jsonb := coalesce(p_payload, '{}'::jsonb);
  v_expected     text  := CASE WHEN p_expected_status IS NULL THEN NULL
                               ELSE public.driver_exec_canonical_status(p_expected_status) END;
  v_trip         public.trips%ROWTYPE;
  v_state        text;
  v_experience   text;
  v_target       text;
  v_key          text;
  v_hash         text;
  v_idem         public.idempotency_keys%ROWTYPE;
  v_result       jsonb;
  v_applied      boolean := true;
  v_stops_total  integer;
  v_stops_open   integer;
  v_payout       text;
  v_side         text;
  v_start_km     numeric;
  v_end_km       numeric;
  v_gps_km       numeric;
  v_odo_km       numeric;
  v_disc_km      numeric;
  v_source       text;
  v_odo_state    text;
BEGIN
  IF v_cmd NOT IN ('START_TRIP', 'DEPART_PICKUP', 'ARRIVE_DROP', 'COMPLETE_TRIP', 'UNDO_STEP', 'RECORD_ODOMETER')
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

  IF v_state NOT IN ('assigned', 'in_progress', 'in_transit', 'at_drop', 'completed') THEN
    RETURN jsonb_build_object(
      'ok', false, 'error_code', 'trip_not_executable', 'command', v_cmd,
      'trip_status', v_state, 'experience', v_experience,
      'allowed_commands', to_jsonb(ARRAY[]::text[]));
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
  ELSE
    -- Status commands. UNDO_STEP always needs the state the driver is undoing from.
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
      -- Already there (lost response / expired key): report current state, change nothing.
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

        -- Supplier linkage guard (server port of the former client-side
        -- validateSupplierLinkForCompletion; asset / DCO / mover_asset execution is exempt).
        v_payout := lower(trim(coalesce(v_trip.trip_payout_mode, '')));
        IF upper(trim(coalesce(v_trip.operating_mode, ''))) <> 'DCO'
           AND lower(trim(coalesce(v_trip.source, ''))) <> 'mover_asset'
           AND v_payout <> 'asset'
           AND NOT (v_payout = '' AND v_trip.driver_id IS NOT NULL AND v_trip.vehicle_id IS NOT NULL)
           AND (v_payout = 'market' OR v_trip.supplier_id IS NOT NULL)
           AND (
             v_trip.supplier_id IS NULL
             OR (
               NOT EXISTS (SELECT 1 FROM public.suppliers s WHERE s.id = v_trip.supplier_id)
               AND NOT EXISTS (
                 SELECT 1 FROM public.transactions x
                 WHERE x.trip_id = v_trip.id AND x.contact_type = 'supplier'
               )
             )
           ) THEN
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
  'Driver Execution Authority (Step A). The only path by which a driver changes trip execution state or odometer readings.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Guard: direct (non-authority) driver writes to trips
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trips_guard_caller_is_trip_driver(p_driver_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT p_driver_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.drivers d
    WHERE d.id = p_driver_id AND d.user_id = (SELECT auth.uid())
  );
$$;

REVOKE ALL ON FUNCTION public.trips_guard_caller_is_trip_driver(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trips_guard_caller_is_trip_driver(uuid) TO authenticated;

-- SECURITY INVOKER on purpose: current_user is the role running the UPDATE, so writes made
-- inside SECURITY DEFINER functions (driver_execute_command, office RPCs) are not guarded here.
CREATE OR REPLACE FUNCTION public.trips_guard_driver_direct_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $$
DECLARE
  v_changed text[];
BEGIN
  IF current_user <> 'authenticated' THEN
    RETURN NEW;
  END IF;
  IF NOT public.trips_guard_caller_is_trip_driver(OLD.driver_id) THEN
    RETURN NEW;
  END IF;
  IF public.is_org_staff(OLD.organization_id) THEN
    RETURN NEW;
  END IF;

  SELECT array_agg(n.key ORDER BY n.key) INTO v_changed
  FROM jsonb_each(to_jsonb(NEW)) n
  WHERE n.key NOT IN ('notes', 'updated_at')
    AND n.value IS DISTINCT FROM (to_jsonb(OLD) -> n.key)
    -- Stored generated columns (margin) are not yet computed in a BEFORE trigger.
    AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute a
      WHERE a.attrelid = TG_RELID AND a.attname = n.key AND a.attgenerated <> ''
    );

  IF v_changed IS NOT NULL THEN
    RAISE EXCEPTION 'driver_direct_trip_write_denied'
      USING ERRCODE = '42501',
            DETAIL  = 'columns: ' || array_to_string(v_changed, ', '),
            HINT    = 'Drivers change trip execution state through driver_execute_command().';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trips_guard_driver_direct_write() FROM PUBLIC, anon;

-- Named to fire before every other BEFORE UPDATE trigger on trips (triggers fire in name
-- order), so it compares the client's row against OLD before other triggers adjust NEW.
-- Policy drivers_update_own_trip_status stays as the row gate; this trigger restricts columns
-- (notes, updated_at) and execution state goes through driver_execute_command().
-- Lock budget: only SHARE ROW EXCLUSIVE on trips (blocks writes, not reads). DROP TRIGGER and
-- COMMENT ON POLICY both take ACCESS EXCLUSIVE on the table here, so neither is used.
CREATE OR REPLACE TRIGGER a_trips_guard_driver_direct_write
  BEFORE UPDATE ON public.trips
  FOR EACH ROW
  EXECUTE FUNCTION public.trips_guard_driver_direct_write();

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Retire the unguarded driver status RPC (no client callers)
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.driver_update_trip_status(uuid, text, timestamptz, timestamptz)
  FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Harden the office status + chat notification RPC
--    Caller must be staff of the trip's organization; organization comes from the trip;
--    sender comes from auth.uid(). p_user_id / p_user_name are accepted but ignored.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.change_trip_status_with_notification(
  p_trip_id         uuid,
  p_organization_id uuid,
  p_new_status      text,
  p_user_id         uuid DEFAULT NULL,
  p_user_name       text DEFAULT 'Dispatcher'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid         uuid := (SELECT auth.uid());
  v_org         uuid;
  v_prev_status text;
  v_changed_at  text;
  v_sender_name text;
BEGIN
  SELECT t.organization_id, t.status INTO v_org, v_prev_status
  FROM public.trips t
  WHERE t.id = p_trip_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_uid IS NULL
     OR NOT public.is_org_staff(v_org)
     OR (p_organization_id IS NOT NULL AND p_organization_id IS DISTINCT FROM v_org) THEN
    RAISE EXCEPTION 'trip_not_found: %', p_trip_id USING ERRCODE = '42501';
  END IF;

  SELECT nullif(trim(p.full_name), '') INTO v_sender_name
  FROM public.profiles p
  WHERE p.id = v_uid;
  v_sender_name := coalesce(v_sender_name, 'Dispatcher');

  UPDATE public.trips
  SET    status     = p_new_status,
         updated_at = NOW()
  WHERE  id = p_trip_id;

  v_changed_at := to_char(
    now() AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );

  INSERT INTO public.trip_messages (
    conversation_id, organization_id,
    sender_user_id, sender_role, sender_name,
    content, message_type, metadata,
    is_read, is_delivered
  )
  SELECT
    tc.id,
    tc.organization_id,
    v_uid,
    'system',
    'System',
    v_sender_name || ' changed status: '
      || COALESCE(v_prev_status, '—') || ' → ' || p_new_status,
    'status_change',
    jsonb_build_object(
      'event_type',      'status_change',
      'previous_status', v_prev_status,
      'new_status',      p_new_status,
      'changed_by',      v_uid,
      'changed_by_name', v_sender_name,
      'changed_at',      v_changed_at
    ),
    TRUE,
    TRUE
  FROM public.trip_conversations tc
  WHERE tc.trip_id = p_trip_id;

  RETURN jsonb_build_object(
    'ok',              TRUE,
    'previous_status', v_prev_status,
    'new_status',      p_new_status,
    'changed_at',      v_changed_at
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.change_trip_status_with_notification(uuid, uuid, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.change_trip_status_with_notification(uuid, uuid, text, uuid, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. fill_driver_commission runs on every completion (driver and office) and reads
--    `drivers` unqualified; pin its search_path instead of inheriting the caller's.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER FUNCTION public.fill_driver_commission() SET search_path = public;

NOTIFY pgrst, 'reload schema';
