-- Driver vs DCO operating model — server-side boundary.
--
-- Reuses the existing canonical model; introduces no new table or column:
--   DCO status ............ dco_profiles.status (20270310200000)
--   Vehicle attachment .... owner_vehicles (owner_user_id, deleted_at, status)
--   Employee-driver ....... organization_members (role='driver', status='active')
--                           OR drivers (user_id, left_at IS NULL,
--                           relationship_status='active_employee')
--   DCO trip .............. trips.operating_mode = 'DCO' (+ dco_payee_id)
--
-- Gaps closed here:
--   1. is_dco_eligible() only looked at organization_members(role='driver').
--      accept_driver_invite() never writes that table -- it writes a drivers
--      row with relationship_status='active_employee' -- so an invited, still-
--      employed driver read as "independent". Both signals now count.
--   2. Marketplace listing was gated on is_driver_fleet_owner() (the legacy,
--      self-service, unapproved Fleet Owner flag), so an employed driver could
--      browse Marketplace and an approved DCO without that flag could not.
--      Listing and bidding now share one predicate:
--      is_dco_marketplace_eligible() = approved DCO, not employed, with at
--      least one active, non-deleted owner vehicle.
--   3. Nothing stopped an approved/suspended DCO from taking employee-driver
--      membership (invite accept, manual roster link, org membership) or a
--      Business from assigning FLEET trips to a DCO's driver row. Triggers on
--      drivers, organization_members and trips now refuse those transitions.
--      Historical rows (left_at set, disconnected) are never touched.
--   4. platform_approve_dco / platform_reinstate_dco could approve someone who
--      is still employed. They now refuse until the employment is ended via the
--      existing leave_fleet flow.
--
-- Explicit resulting states (get_my_driver_operating_mode):
--   DRIVER                  no DCO status (NONE / PENDING / REJECTED)
--   DCO                     APPROVED, not employed, active vehicle -> Marketplace
--   DCO_VEHICLE_REQUIRED    APPROVED, not employed, no active vehicle. Still a
--                           DCO (never falls back to employee-driver); no
--                           Marketplace until a vehicle is attached again.
--   DCO_SUSPENDED           SUSPENDED by Pulse admin; no Marketplace.
--   DCO_EMPLOYMENT_CONFLICT APPROVED and employed -- only reachable by data that
--                           predates this migration; no Marketplace.
--
-- Already-awarded work is unaffected: create_market_trip_after_fee_payment()
-- still classifies from the persisted bid (bidder_type='dco'), not live state.
--
-- Employment is EITHER organization_members(role='driver', active) OR
-- drivers.relationship_status='active_employee' (left_at IS NULL). Those
-- sources are not consolidated; _is_active_employee_driver() ORs them.
-- leave_fleet() is unchanged for normal drivers. An APPROVED DCO cannot
-- use invite/relink to become an employee again.

-- ── Internal predicates (not client-callable) ─────────────────────────────

CREATE OR REPLACE FUNCTION public._is_active_employee_driver(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT
    EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.user_id = p_user_id AND om.role = 'driver' AND om.status = 'active'
    )
    OR EXISTS (
      SELECT 1 FROM public.drivers d
      WHERE d.user_id = p_user_id
        AND d.left_at IS NULL
        AND d.relationship_status = 'active_employee'
    );
$function$;

REVOKE ALL ON FUNCTION public._is_active_employee_driver(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._is_active_employee_driver(uuid) FROM anon;
REVOKE ALL ON FUNCTION public._is_active_employee_driver(uuid) FROM authenticated;

CREATE OR REPLACE FUNCTION public._has_active_owner_vehicle(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.owner_vehicles ov
    WHERE ov.owner_user_id = p_user_id
      AND ov.deleted_at IS NULL
      AND ov.status = 'active'
  );
$function$;

REVOKE ALL ON FUNCTION public._has_active_owner_vehicle(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._has_active_owner_vehicle(uuid) FROM anon;
REVOKE ALL ON FUNCTION public._has_active_owner_vehicle(uuid) FROM authenticated;

-- Same signature and grants as 20270310210000 / 20270310230000; only the
-- employment check widens. Vehicle is deliberately NOT part of this predicate:
-- owner_vehicles RLS uses it, and an approved DCO must be able to add their
-- first vehicle.
CREATE OR REPLACE FUNCTION public.is_dco_eligible(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT
    EXISTS (
      SELECT 1 FROM public.dco_profiles dp
      WHERE dp.user_id = p_user_id AND dp.status = 'APPROVED'
    )
    AND NOT public._is_active_employee_driver(p_user_id);
$function$;

CREATE OR REPLACE FUNCTION public.is_dco_marketplace_eligible(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT public.is_dco_eligible(p_user_id)
    AND public._has_active_owner_vehicle(p_user_id);
$function$;

REVOKE ALL ON FUNCTION public.is_dco_marketplace_eligible(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_dco_marketplace_eligible(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.is_dco_marketplace_eligible(uuid) FROM authenticated;

-- Read-only conflict census. Does not update or delete any row.
DO $$
DECLARE
  v_conflicts integer;
BEGIN
  SELECT count(*) INTO v_conflicts
  FROM public.dco_profiles dp
  WHERE dp.status IN ('APPROVED', 'SUSPENDED')
    AND public._is_active_employee_driver(dp.user_id);
  RAISE NOTICE 'DCO_EMPLOYMENT_CONFLICT candidates (APPROVED/SUSPENDED + employed): % — rows not modified', v_conflicts;
END;
$$;

-- ── Self-scoped read for the Driver App ───────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_my_driver_operating_mode()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_uid        uuid := (select auth.uid());
  v_dco_status text;
  v_employed   boolean;
  v_vehicle    boolean;
  v_mode       text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT dp.status INTO v_dco_status FROM public.dco_profiles dp WHERE dp.user_id = v_uid;
  v_employed := public._is_active_employee_driver(v_uid);
  v_vehicle := public._has_active_owner_vehicle(v_uid);

  v_mode := CASE
    WHEN v_dco_status = 'APPROVED' AND v_employed THEN 'DCO_EMPLOYMENT_CONFLICT'
    WHEN v_dco_status = 'APPROVED' AND v_vehicle THEN 'DCO'
    WHEN v_dco_status = 'APPROVED' THEN 'DCO_VEHICLE_REQUIRED'
    WHEN v_dco_status = 'SUSPENDED' THEN 'DCO_SUSPENDED'
    ELSE 'DRIVER'
  END;

  RETURN jsonb_build_object(
    'mode', v_mode,
    'dco_status', coalesce(v_dco_status, 'NONE'),
    'is_employee_driver', v_employed,
    'has_active_vehicle', v_vehicle,
    'marketplace_allowed', v_mode = 'DCO'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_driver_operating_mode() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_driver_operating_mode() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_driver_operating_mode() TO authenticated;

-- ── Marketplace listing: DCO capability, not the Fleet Owner flag ─────────
-- Body identical to 20270310100000 except the capability gate.

CREATE OR REPLACE FUNCTION public.list_open_marketplace_loads_for_fleet_owner(
  p_limit integer DEFAULT 50
)
RETURNS TABLE (
  id uuid,
  indent_number text,
  pickup_area text,
  drop_location text,
  vehicle_type text,
  load_type text,
  pickup_date date,
  status text,
  circulation_target text,
  rate_offer numeric,
  creator_organization_name text,
  created_at timestamptz,
  creator_organization_id uuid,
  creator_organization_logo_url text,
  creator_organization_avatar_seed text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 50), 100));
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT p.role INTO v_role
  FROM public.profiles p
  WHERE p.id = v_uid;

  IF v_role IS DISTINCT FROM 'driver' THEN
    RAISE EXCEPTION 'Only drivers can list fleet-owner marketplace loads';
  END IF;

  IF NOT public.is_dco_marketplace_eligible(v_uid) THEN
    RAISE EXCEPTION 'marketplace_access_denied: approved, independent DCO status with an active vehicle is required';
  END IF;

  RETURN QUERY
  SELECT
    i.id,
    i.indent_number,
    i.pickup_area,
    i.drop_location,
    i.vehicle_type,
    i.load_type,
    i.pickup_date,
    i.status::text,
    i.circulation_target::text,
    i.supplier_target::numeric AS rate_offer,
    o.name AS creator_organization_name,
    i.created_at,
    o.id AS creator_organization_id,
    o.logo_url AS creator_organization_logo_url,
    o.avatar_seed AS creator_organization_avatar_seed
  FROM public.indents i
  LEFT JOIN public.organizations o ON o.id = i.organization_id
  WHERE i.deleted_at IS NULL
    AND public.indent_open_for_marketplace_bids(i.id)
    AND lower(trim(coalesce(i.circulation_target, ''))) IN ('marketplace', 'both')
  ORDER BY i.created_at DESC
  LIMIT v_limit;
END;
$$;

-- ── Marketplace bidding: same capability; bid vehicle must be active ──────
-- Body identical to 20270310220000 except the DCO gate and vehicle status.

CREATE OR REPLACE FUNCTION public.submit_market_bid(
  p_indent_id uuid,
  p_amount numeric,
  p_note text DEFAULT NULL,
  p_bidder_organization_id uuid DEFAULT NULL,
  p_owner_vehicle_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_bidder_type text;
  v_bid_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'invalid_amount';
  END IF;

  -- p_bidder_organization_id NULL => DCO path. Set => Business path.
  IF p_bidder_organization_id IS NULL THEN
    v_bidder_type := 'dco';

    IF NOT public.is_dco_marketplace_eligible(v_uid) THEN
      RAISE EXCEPTION 'unauthorized: approved, currently-independent DCO status with an active vehicle is required for a DCO bid';
    END IF;

    IF NOT public.is_driver_available(v_uid) THEN
      RAISE EXCEPTION 'driver_unavailable: you are on an active trip -- complete it before bidding on another load';
    END IF;

    IF p_owner_vehicle_id IS NULL THEN
      RAISE EXCEPTION 'owner_vehicle_required: a DCO bid must specify the vehicle that will operate this trip';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.owner_vehicles ov
      WHERE ov.id = p_owner_vehicle_id
        AND ov.owner_user_id = v_uid
        AND ov.deleted_at IS NULL
        AND ov.status = 'active'
    ) THEN
      RAISE EXCEPTION 'owner_vehicle_id must be an active vehicle in the caller''s own fleet';
    END IF;
  ELSE
    v_bidder_type := 'organization';

    IF NOT EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.organization_id = p_bidder_organization_id
        AND om.user_id = v_uid
        AND om.status = 'active'
    ) THEN
      RAISE EXCEPTION 'unauthorized: caller is not an active member of bidder organization';
    END IF;
  END IF;

  INSERT INTO public.market_bids (
    indent_id, bidder_type, bidder_user_id, bidder_organization_id, owner_vehicle_id, amount, note
  )
  VALUES (
    p_indent_id, v_bidder_type, v_uid, p_bidder_organization_id, p_owner_vehicle_id, p_amount,
    NULLIF(TRIM(COALESCE(p_note, '')), '')
  )
  ON CONFLICT (indent_id, bidder_user_id) DO UPDATE SET
    amount = EXCLUDED.amount,
    note = EXCLUDED.note,
    owner_vehicle_id = EXCLUDED.owner_vehicle_id,
    updated_at = now()
  WHERE public.market_bids.status = 'pending'
  RETURNING id INTO v_bid_id;

  IF v_bid_id IS NULL THEN
    RAISE EXCEPTION 'bid_locked: an existing decided bid cannot be changed';
  END IF;

  RETURN jsonb_build_object(
    'bid_id', v_bid_id, 'indent_id', p_indent_id, 'bidder_type', v_bidder_type, 'amount', p_amount
  );
END;
$function$;

-- ── DCO approval requires the employment to be ended first ────────────────
-- Bodies identical to 20270310210000 plus the employment check.

CREATE OR REPLACE FUNCTION public.platform_approve_dco(p_user_id uuid)
RETURNS public.dco_profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_row public.dco_profiles;
BEGIN
  IF NOT public.can_review_dco() THEN
    RAISE EXCEPTION 'unauthorized: dco.review permission required';
  END IF;

  IF public._is_active_employee_driver(p_user_id) THEN
    RAISE EXCEPTION 'employment_conflict: user % is still an active employee driver -- they must leave that fleet before DCO approval', p_user_id;
  END IF;

  UPDATE public.dco_profiles
  SET status = 'APPROVED', reviewed_at = now(), reviewed_by = (select auth.uid()),
      decision_reason = NULL, updated_at = now()
  WHERE user_id = p_user_id AND status = 'PENDING'
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_state: no PENDING dco_profiles row for user %', p_user_id;
  END IF;

  INSERT INTO public.dco_payees (user_id)
  VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  PERFORM public.emit_platform_event(
    'DcoApproved', NULL, jsonb_build_object('user_id', p_user_id)
  );

  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.platform_reinstate_dco(p_user_id uuid)
RETURNS public.dco_profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_row public.dco_profiles;
BEGIN
  IF NOT public.can_review_dco() THEN
    RAISE EXCEPTION 'unauthorized: dco.review permission required';
  END IF;

  IF public._is_active_employee_driver(p_user_id) THEN
    RAISE EXCEPTION 'employment_conflict: user % is an active employee driver -- cannot reinstate DCO status while employed', p_user_id;
  END IF;

  UPDATE public.dco_profiles
  SET status = 'APPROVED', reviewed_at = now(), reviewed_by = (select auth.uid()),
      decision_reason = NULL, updated_at = now()
  WHERE user_id = p_user_id AND status = 'SUSPENDED'
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_state: no SUSPENDED dco_profiles row for user %', p_user_id;
  END IF;

  PERFORM public.emit_platform_event(
    'DcoReinstated', NULL, jsonb_build_object('user_id', p_user_id)
  );

  RETURN v_row;
END;
$function$;

-- ── A DCO cannot take up employee-driver membership ───────────────────────
-- APPROVED and SUSPENDED both mean "this person holds DCO status". PENDING is
-- not blocked here: approval itself refuses while employed (above).

CREATE OR REPLACE FUNCTION public._holds_dco_status(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.dco_profiles dp
    WHERE dp.user_id = p_user_id AND dp.status IN ('APPROVED', 'SUSPENDED')
  );
$function$;

REVOKE ALL ON FUNCTION public._holds_dco_status(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._holds_dco_status(uuid) FROM anon;
REVOKE ALL ON FUNCTION public._holds_dco_status(uuid) FROM authenticated;

CREATE OR REPLACE FUNCTION public.enforce_dco_not_employee_driver_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF NEW.user_id IS NULL
     OR NEW.left_at IS NOT NULL
     OR NEW.relationship_status IS DISTINCT FROM 'active_employee' THEN
    RETURN NEW;
  END IF;

  -- Only a transition INTO active employment is checked; an existing active
  -- row being edited (pay terms, name) is left alone.
  IF TG_OP = 'UPDATE'
     AND OLD.user_id IS NOT DISTINCT FROM NEW.user_id
     AND OLD.left_at IS NULL
     AND OLD.relationship_status IS NOT DISTINCT FROM 'active_employee' THEN
    RETURN NEW;
  END IF;

  IF public._holds_dco_status(NEW.user_id) THEN
    RAISE EXCEPTION 'dco_not_employee_driver: DCOs cannot join a business as employee drivers. You can operate independently as a DCO.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS enforce_dco_not_employee_driver_row ON public.drivers;
CREATE TRIGGER enforce_dco_not_employee_driver_row
  BEFORE INSERT OR UPDATE OF user_id, left_at, relationship_status ON public.drivers
  FOR EACH ROW EXECUTE FUNCTION public.enforce_dco_not_employee_driver_row();

CREATE OR REPLACE FUNCTION public.enforce_dco_not_driver_member()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF NEW.user_id IS NULL OR NEW.role IS DISTINCT FROM 'driver' OR NEW.status IS DISTINCT FROM 'active' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.user_id IS NOT DISTINCT FROM NEW.user_id
     AND OLD.role IS NOT DISTINCT FROM 'driver'
     AND OLD.status IS NOT DISTINCT FROM 'active' THEN
    RETURN NEW;
  END IF;

  IF public._holds_dco_status(NEW.user_id) THEN
    RAISE EXCEPTION 'dco_not_employee_driver: DCOs cannot join a business as employee drivers. You can operate independently as a DCO.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS enforce_dco_not_driver_member ON public.organization_members;
CREATE TRIGGER enforce_dco_not_driver_member
  BEFORE INSERT OR UPDATE OF user_id, role, status ON public.organization_members
  FOR EACH ROW EXECUTE FUNCTION public.enforce_dco_not_driver_member();

-- ── A Business cannot assign FLEET (employee-driver) work to a DCO ────────
-- DCO trips (operating_mode='DCO') are created by the Marketplace award path
-- and are allowed. Existing trip rows are only checked when driver_id changes.

CREATE OR REPLACE FUNCTION public.enforce_dco_not_assigned_fleet_trip()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_driver_user_id uuid;
BEGIN
  IF NEW.driver_id IS NULL OR NEW.operating_mode IS DISTINCT FROM 'FLEET' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.driver_id IS NOT DISTINCT FROM NEW.driver_id THEN
    RETURN NEW;
  END IF;

  SELECT d.user_id INTO v_driver_user_id FROM public.drivers d WHERE d.id = NEW.driver_id;

  IF v_driver_user_id IS NOT NULL AND public._holds_dco_status(v_driver_user_id) THEN
    RAISE EXCEPTION 'dco_not_employee_driver: DCOs cannot receive employee-driver assignments from a business. You can operate independently as a DCO.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS enforce_dco_not_assigned_fleet_trip ON public.trips;
CREATE TRIGGER enforce_dco_not_assigned_fleet_trip
  BEFORE INSERT OR UPDATE OF driver_id ON public.trips
  FOR EACH ROW EXECUTE FUNCTION public.enforce_dco_not_assigned_fleet_trip();

REVOKE ALL ON FUNCTION public.enforce_dco_not_employee_driver_row() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_dco_not_driver_member() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_dco_not_assigned_fleet_trip() FROM PUBLIC, anon, authenticated;

-- ── Invite accept: explicit DCO deny (do not rely on Driver App hiding it) ─
-- Body is the current accept_driver_invite (20270211150000) plus an early
-- business-error guard. Triggers remain the fail-closed backstop if any
-- other writer tries to create active_employee / driver membership.

CREATE OR REPLACE FUNCTION public.accept_driver_invite(p_invite_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_invite       public.driver_invites;
  v_driver_id    uuid;
  v_name         text;
  v_phone        text;
  v_email        text;
  v_phone_last10 text;
BEGIN
  IF public._holds_dco_status(auth.uid()) THEN
    RAISE EXCEPTION 'dco_not_employee_driver: DCOs cannot join a business as employee drivers. You can operate independently as a DCO.'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT *
  INTO v_invite
  FROM public.driver_invites
  WHERE id = p_invite_id
    AND to_user_id = auth.uid()
    AND status = 'pending'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invite not found or already responded';
  END IF;

  SELECT
    coalesce(
      nullif(trim(p.full_name), ''),
      nullif(trim(u.raw_user_meta_data->>'full_name'), ''),
      nullif(trim(u.raw_user_meta_data->>'name'), ''),
      'Driver'
    ),
    nullif(trim(coalesce(p.phone, u.raw_user_meta_data->>'phone')), ''),
    nullif(trim(coalesce(p.email, u.email)), '')
  INTO v_name, v_phone, v_email
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  WHERE u.id = auth.uid();

  v_phone_last10 := public.normalize_phone_last10(v_phone);

  IF length(coalesce(v_phone_last10, '')) = 10 THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(v_invite.from_organization_id::text || ':' || v_phone_last10, 0)
    );
  END IF;

  SELECT id
  INTO v_driver_id
  FROM public.drivers
  WHERE organization_id = v_invite.from_organization_id
    AND user_id = auth.uid()
    AND left_at IS NULL
  LIMIT 1
  FOR UPDATE;

  IF v_driver_id IS NOT NULL THEN
    UPDATE public.drivers
       SET name               = coalesce(nullif(trim(v_name), ''), name),
           email              = coalesce(nullif(trim(v_email), ''), email),
           tracking_only      = false,
           payable_amount     = coalesce(v_invite.payable_amount, payable_amount),
           commission_percent = coalesce(v_invite.commission_percent, commission_percent),
           commission_per_km  = coalesce(v_invite.commission_per_km, commission_per_km),
           relationship_status = 'active_employee',
           updated_at         = now()
     WHERE id = v_driver_id;
  END IF;

  IF v_driver_id IS NULL THEN
    IF length(coalesce(v_phone_last10, '')) = 10 THEN
      SELECT d.id
      INTO v_driver_id
      FROM public.drivers d
      WHERE d.organization_id = v_invite.from_organization_id
        AND d.user_id IS NULL
        AND d.left_at IS NULL
        AND d.phone IS NOT NULL
        AND public.normalize_phone_last10(d.phone) = v_phone_last10
      ORDER BY d.updated_at DESC
      LIMIT 1
      FOR UPDATE;
    END IF;

    IF v_driver_id IS NOT NULL THEN
      UPDATE public.drivers
      SET user_id          = auth.uid(),
          name             = coalesce(nullif(trim(v_name), ''), name),
          email            = coalesce(nullif(trim(v_email), ''), email),
          tracking_only    = false,
          status           = 'offline',
          payable_amount   = coalesce(v_invite.payable_amount, payable_amount),
          commission_percent = coalesce(v_invite.commission_percent, commission_percent),
          commission_per_km  = coalesce(v_invite.commission_per_km, commission_per_km),
          relationship_status = 'active_employee',
          updated_at       = now()
      WHERE id = v_driver_id;
    ELSE
      INSERT INTO public.drivers (
        organization_id,
        name,
        phone,
        email,
        user_id,
        status,
        tracking_only,
        hired_at,
        payable_amount,
        commission_percent,
        commission_per_km,
        relationship_origin,
        relationship_status
      )
      VALUES (
        v_invite.from_organization_id,
        coalesce(nullif(trim(v_name), ''), 'Driver'),
        v_phone,
        v_email,
        auth.uid(),
        'offline',
        false,
        now(),
        v_invite.payable_amount,
        v_invite.commission_percent,
        v_invite.commission_per_km,
        'invite_accepted',
        'active_employee'
      )
      ON CONFLICT (organization_id, phone) WHERE (left_at IS NULL AND phone IS NOT NULL)
      DO NOTHING
      RETURNING id INTO v_driver_id;

      IF v_driver_id IS NULL THEN
        SELECT id
        INTO v_driver_id
        FROM public.drivers
        WHERE organization_id = v_invite.from_organization_id
          AND phone = v_phone
          AND left_at IS NULL
        LIMIT 1;

        UPDATE public.drivers
        SET user_id    = auth.uid(),
            updated_at = now()
        WHERE id = v_driver_id
          AND user_id IS NULL;
      END IF;
    END IF;
  END IF;

  UPDATE public.driver_invites
  SET status       = 'accepted',
      responded_at = now(),
      responded_by = auth.uid()
  WHERE id = p_invite_id;

  RETURN jsonb_build_object(
    'driver_id',       v_driver_id,
    'organization_id', v_invite.from_organization_id
  );
END;
$function$;

COMMENT ON FUNCTION public.accept_driver_invite(uuid) IS
  'Accept a fleet invite as an employee driver. APPROVED/SUSPENDED DCOs are refused with dco_not_employee_driver.';
