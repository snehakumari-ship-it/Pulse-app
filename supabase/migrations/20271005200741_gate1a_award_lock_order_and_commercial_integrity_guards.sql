-- Gate 1A: one-winner-per-indent commercial integrity.
--
-- C1 award_market_bid                          lock order: indent before bid
-- C2 reject_quote_accept_on_inactive_indent    guard the real quote-accept path
-- C3 award_indent_to_trip                      lock + marketplace/supplier guard
-- C4 tg_indents_guard_commercial_winner        guard direct client UPDATE on indents
-- C5 batch_award_indents_to_trips              exclude marketplace-awarded indents
--
-- C1/C3/C5 are the production bodies with only the regions below changed.

-- ===========================================================================
-- C1
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.award_market_bid(p_bid_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_bid          public.market_bids;
  v_indent       public.indents;
  v_indent_id    uuid;
  v_fee_calc     jsonb;
  v_platform_fee numeric;
  v_fee_status   text;
BEGIN
  -- Gate 1A: resolve the target indent WITHOUT a row lock, so the indent is
  -- always the first lock this function takes. Every other writer that can
  -- decide a commercial winner locks the indent first; taking the bid first
  -- was the one inversion in the system.
  SELECT indent_id INTO v_indent_id FROM public.market_bids WHERE id = p_bid_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: bid %', p_bid_id;
  END IF;

  -- Lock the INDENT first -- unchanged concurrency rule from accept_market_bid.
  SELECT * INTO v_indent FROM public.indents WHERE id = v_indent_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: indent % for bid %', v_indent_id, p_bid_id;
  END IF;

  SELECT * INTO v_bid FROM public.market_bids WHERE id = p_bid_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: bid %', p_bid_id;
  END IF;
  IF v_bid.indent_id IS DISTINCT FROM v_indent_id THEN
    RAISE EXCEPTION 'invalid_state: bid % no longer belongs to indent %', p_bid_id, v_indent_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.organization_members om
    WHERE om.organization_id = v_indent.organization_id
      AND om.user_id = (select auth.uid())
      AND om.status = 'active'
      AND om.role <> 'driver'
  ) THEN
    RAISE EXCEPTION 'unauthorized: caller must be a non-driver member of the organization that owns this indent';
  END IF;

  -- No trip is ever created by this function for either branch now, so
  -- "already decided" is fully expressed by market_bids.status alone -- no
  -- trips lookup needed here at all (a simplification vs. the old
  -- accept_market_bid, which had to special-case "accepted, no trip yet"
  -- only for the organization branch; here it is uniform for both).
  IF v_bid.status = 'accepted' THEN
    RETURN jsonb_build_object(
      'ok', true, 'bid_id', p_bid_id, 'status', 'accepted',
      'fee_payment_status', v_bid.fee_payment_status,
      'platform_fee_amount', v_bid.platform_fee_amount
    );
  END IF;

  IF v_bid.status <> 'pending' THEN
    RAISE EXCEPTION 'invalid_state: bid already decided (current: %)', v_bid.status;
  END IF;

  IF lower(trim(coalesce(v_indent.status, ''))) NOT IN ('open', 'broadcast') THEN
    RAISE EXCEPTION 'indent_not_open: indent % is not open for award (status=%)', v_indent.id, v_indent.status;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.trips t
    WHERE t.indent_id = v_indent.id AND t.status <> 'cancelled'
  ) THEN
    RAISE EXCEPTION 'already_awarded: indent % already has an active canonical trip', v_indent.id;
  END IF;

  -- A8.6.2: fee resolution now runs for BOTH bidder types (previously DCO
  -- only) -- this is the one genuinely new behavior for the organization
  -- branch. Never recompute after this; locked into market_bids row below.
  v_fee_calc     := public.calculate_marketplace_platform_fee(v_bid.amount);
  v_platform_fee := coalesce((v_fee_calc->>'resolved_fee')::numeric, 0);
  v_fee_status   := CASE WHEN v_platform_fee > 0 THEN 'required' ELSE 'not_required' END;

  IF v_bid.bidder_type = 'organization' THEN
    IF v_bid.bidder_organization_id IS NULL THEN
      RAISE EXCEPTION 'invalid_bid: organization bid % has no bidder_organization_id', v_bid.id;
    END IF;

    UPDATE public.market_bids
    SET status = 'accepted', accepted_at = now(), updated_at = now(),
        platform_fee_amount = v_platform_fee,
        platform_fee_calc_snapshot = v_fee_calc,
        fee_payment_status = v_fee_status
    WHERE id = p_bid_id;

    UPDATE public.market_bids
    SET status = 'rejected', updated_at = now()
    WHERE indent_id = v_indent.id AND id <> v_bid.id AND status = 'pending';

    UPDATE public.indents
    SET status = 'awarded',
        assigned_supplier_id = v_bid.bidder_organization_id,
        updated_at = now()
    WHERE id = v_indent.id;

    RETURN jsonb_build_object(
      'ok', true, 'bid_id', p_bid_id, 'status', 'accepted',
      'fee_payment_status', v_fee_status, 'platform_fee_amount', v_platform_fee
    );
  END IF;

  IF v_bid.bidder_type <> 'dco' THEN
    RAISE EXCEPTION 'unexpected_bidder_type: %', v_bid.bidder_type;
  END IF;

  IF NOT public.is_driver_available(v_bid.bidder_user_id) THEN
    RAISE EXCEPTION 'driver_unavailable: this driver is already on an active trip';
  END IF;

  IF v_bid.owner_vehicle_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.owner_vehicles ov
    WHERE ov.id = v_bid.owner_vehicle_id
      AND ov.owner_user_id = v_bid.bidder_user_id
      AND ov.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'vehicle_no_longer_eligible: owner_vehicle % is no longer valid for bidder %', v_bid.owner_vehicle_id, v_bid.bidder_user_id;
  END IF;

  -- _resolve_or_create_market_driver() deliberately NOT called here anymore
  -- -- it moves to create_market_trip_after_fee_payment(), the moment a
  -- trip actually gets created. Creating the drivers-row stub before a fee
  -- is even paid would be premature side-effecting for a bid that might
  -- never convert.

  UPDATE public.market_bids
  SET status = 'accepted', accepted_at = now(), updated_at = now(),
      platform_fee_amount = v_platform_fee,
      platform_fee_calc_snapshot = v_fee_calc,
      fee_payment_status = v_fee_status
  WHERE id = p_bid_id;

  UPDATE public.market_bids
  SET status = 'rejected', updated_at = now()
  WHERE indent_id = v_indent.id AND id <> v_bid.id AND status = 'pending';

  -- A6.3 superseding: unchanged timing -- runs at AWARD, not at eventual
  -- trip creation. NOTE (A8.6.2 known gap, documented in the plan): this
  -- only closes out bids that are already PENDING at award time. A driver
  -- can still submit and be awarded a second bid while this one sits
  -- fee-pending, since is_driver_available() has no visibility into an
  -- accepted-but-unpaid market_bids row. Not fixed in this phase.
  UPDATE public.market_bids
  SET status = 'superseded', updated_at = now()
  WHERE bidder_user_id = v_bid.bidder_user_id
    AND status = 'pending'
    AND id <> v_bid.id;

  UPDATE public.driver_direct_bids
  SET status = 'superseded', updated_at = now()
  WHERE driver_user_id = v_bid.bidder_user_id
    AND status = 'pending';

  UPDATE public.indents SET status = 'awarded', updated_at = now() WHERE id = v_indent.id;

  RETURN jsonb_build_object(
    'ok', true, 'bid_id', p_bid_id, 'status', 'accepted',
    'fee_payment_status', v_fee_status, 'platform_fee_amount', v_platform_fee
  );
END;
$function$;

-- ===========================================================================
-- C2
-- ===========================================================================
-- SECURITY DEFINER is required: this runs on the bidder's own UPDATE, and the
-- bidder cannot see the indent, competing market bids, or indent-owner
-- membership under RLS. Without it the guard would read nothing and pass.
-- The trigger definition itself is unchanged.
CREATE OR REPLACE FUNCTION public.reject_quote_accept_on_inactive_indent()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_status   text;
  v_indent   public.indents%ROWTYPE;
  v_uid      uuid := (SELECT auth.uid());
  v_other    uuid;
BEGIN
  IF lower(coalesce(NEW.status, '')) = 'accepted'
     AND lower(coalesce(OLD.status, '')) IS DISTINCT FROM 'accepted'
  THEN
    -- Gate 1A: take the indent lock before reading its state, so this
    -- serializes against award_market_bid / award_direct_quote /
    -- award_indent_to_trip instead of racing them on a stale read.
    SELECT * INTO v_indent
    FROM public.indents
    WHERE id = NEW.indent_id
    FOR UPDATE;

    v_status := lower(coalesce(v_indent.status, ''));
    IF v_status IN ('cancelled', 'closed', 'expired') THEN
      RAISE EXCEPTION 'indent_not_active: reactivate this indent before awarding it (status=%)', v_status
        USING ERRCODE = '23514';
    END IF;

    -- Only the indent-owning organization awards. Closes bidder self-accept:
    -- the bidder UPDATE policy on direct_quotes checks bidder-org membership
    -- only, so without this a bidder could accept its own quote.
    IF v_uid IS NULL OR NOT public.is_org_staff(v_indent.organization_id) THEN
      RAISE EXCEPTION 'unauthorized: only staff of the load-owning organization can accept a quote'
        USING ERRCODE = '42501';
    END IF;

    IF v_status NOT IN ('open', 'broadcast') THEN
      RAISE EXCEPTION 'indent_not_open: indent % is not open for award (status=%)', NEW.indent_id, v_indent.status
        USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.market_bids mb
      WHERE mb.indent_id = NEW.indent_id
        AND mb.status = 'accepted'
    ) THEN
      RAISE EXCEPTION 'already_awarded: indent % already has an accepted Marketplace bid', NEW.indent_id
        USING ERRCODE = '23514';
    END IF;

    IF v_indent.assigned_supplier_id IS NOT NULL
       AND v_indent.assigned_supplier_id IS DISTINCT FROM NEW.bidder_organization_id THEN
      v_other := v_indent.assigned_supplier_id;
      RAISE EXCEPTION 'already_awarded: indent % is already assigned to organization %', NEW.indent_id, v_other
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- ===========================================================================
-- C3
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.award_indent_to_trip(p_indent_id uuid, p_supplier_rate numeric DEFAULT NULL::numeric, p_supplier_id uuid DEFAULT NULL::uuid, p_supplier_org_id uuid DEFAULT NULL::uuid, p_driver_id uuid DEFAULT NULL::uuid, p_vehicle_id uuid DEFAULT NULL::uuid, p_vehicle_display_number text DEFAULT NULL::text)
 RETURNS SETOF trips
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_indent        public.indents%ROWTYPE;
  v_org_id        uuid;
  v_trip          public.trips%ROWTYPE;
  v_supplier_id   uuid;
  v_supplier_rate numeric;
  v_vehicle_disp  text;
  v_bidder_org_id uuid;
  v_requested_org uuid;
BEGIN
  SELECT * INTO v_indent FROM public.indents WHERE id = p_indent_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Indent % not found', p_indent_id;
  END IF;

  IF lower(coalesce(v_indent.status, '')) = 'cancelled' THEN
    RAISE EXCEPTION 'Cannot create trip: indent % is cancelled', p_indent_id;
  END IF;

  IF coalesce(trim(v_indent.pickup_area), '') = '' THEN
    RAISE EXCEPTION 'Cannot create trip: indent % has no pickup_area', p_indent_id;
  END IF;
  IF coalesce(trim(v_indent.drop_location), '') = '' THEN
    RAISE EXCEPTION 'Cannot create trip: indent % has no drop_location', p_indent_id;
  END IF;
  IF NOT public.indent_has_convertible_sale(v_indent) THEN
    RAISE EXCEPTION 'Cannot create trip: indent % has no client_price', p_indent_id;
  END IF;

  v_org_id := v_indent.organization_id;

  IF NOT public.is_org_staff(v_org_id) THEN
    RAISE EXCEPTION 'Not authorized: caller is not a member of org %', v_org_id;
  END IF;

  SELECT t.* INTO v_trip
  FROM public.trips t
  WHERE t.indent_id = p_indent_id
  LIMIT 1;

  IF FOUND THEN
    IF lower(coalesce(v_trip.status, '')) NOT IN ('completed', 'cancelled') THEN
      UPDATE public.trips
      SET
        driver_id             = COALESCE(p_driver_id,  driver_id),
        vehicle_id            = COALESCE(p_vehicle_id, vehicle_id),
        vehicle_display_number = CASE
          WHEN p_vehicle_display_number IS NOT NULL AND trim(p_vehicle_display_number) <> ''
          THEN trim(p_vehicle_display_number)
          ELSE vehicle_display_number
        END,
        updated_at = now()
      WHERE id = v_trip.id;
      SELECT * INTO v_trip FROM public.trips WHERE id = v_trip.id;
    END IF;
    RETURN NEXT v_trip;
    RETURN;
  END IF;

  -- Gate 1A: a Marketplace award converts through
  -- create_trip_from_assigned_indent / create_market_trip_after_fee_payment,
  -- which apply the platform-fee gate. Creating the trip here would skip it.
  IF EXISTS (
    SELECT 1 FROM public.market_bids mb
    WHERE mb.indent_id = p_indent_id
      AND mb.status = 'accepted'
  ) THEN
    RAISE EXCEPTION 'already_awarded: indent % has an accepted Marketplace bid -- deploy it through the Marketplace award instead of manual trip assignment', p_indent_id
      USING ERRCODE = '23514';
  END IF;

  -- Gate 1A: never create a trip for a supplier other than the one already
  -- holding this indent.
  v_requested_org := p_supplier_org_id;
  IF v_requested_org IS NULL AND p_supplier_id IS NOT NULL THEN
    SELECT s.linked_organization_id INTO v_requested_org
    FROM public.suppliers s
    WHERE s.id = p_supplier_id
      AND s.organization_id = v_org_id
    LIMIT 1;
  END IF;

  IF v_indent.assigned_supplier_id IS NOT NULL
     AND v_requested_org IS NOT NULL
     AND v_requested_org IS DISTINCT FROM v_indent.assigned_supplier_id THEN
    RAISE EXCEPTION 'already_awarded: indent % is already assigned to organization % -- revoke that award before assigning a different supplier', p_indent_id, v_indent.assigned_supplier_id
      USING ERRCODE = '23514';
  END IF;

  -- Resolve the bidder org id the same way supplier_id resolution below
  -- does, so the eligibility check covers every way the caller can name
  -- the bidder (assigned_supplier_id on the indent, or an explicit param).
  v_bidder_org_id := COALESCE(v_indent.assigned_supplier_id, p_supplier_org_id);

  IF v_bidder_org_id IS NOT NULL AND NOT public.is_approved_supplier(v_org_id, v_bidder_org_id) THEN
    RAISE EXCEPTION 'Bidder is not an approved supplier of this load owner. Add and approve them as a supplier before awarding.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_supplier_rate := COALESCE(
    p_supplier_rate,
    (v_indent.assigned_supplier_rate)::numeric,
    v_indent.supplier_target,
    0
  );

  v_supplier_id := p_supplier_id;

  IF v_supplier_id IS NULL AND v_indent.assigned_supplier_id IS NOT NULL THEN
    SELECT id INTO v_supplier_id
    FROM public.suppliers
    WHERE organization_id = v_org_id
      AND linked_organization_id = v_indent.assigned_supplier_id
    LIMIT 1;
  END IF;

  IF v_supplier_id IS NULL AND p_supplier_org_id IS NOT NULL THEN
    SELECT id INTO v_supplier_id
    FROM public.suppliers
    WHERE organization_id = v_org_id
      AND linked_organization_id = p_supplier_org_id
    LIMIT 1;
  END IF;

  v_vehicle_disp := NULLIF(TRIM(COALESCE(p_vehicle_display_number, '')), '');

  INSERT INTO public.trips (
    organization_id, trip_number, indent_id, source, pickup_area, drop_location,
    client_name, client_price, supplier_rate, supplier_id, trip_payout_mode,
    driver_id, vehicle_id, vehicle_display_number, status, pickup_date, load_type,
    platform_fee, driver_commission, payment_status, amount_paid
  ) VALUES (
    v_org_id, '', p_indent_id, 'indent',
    coalesce(v_indent.pickup_area, ''), coalesce(v_indent.drop_location, ''),
    coalesce(v_indent.client_name, ''), coalesce(v_indent.client_price, 0),
    v_supplier_rate, v_supplier_id,
    CASE WHEN v_supplier_id IS NOT NULL THEN 'market' ELSE 'asset' END,
    p_driver_id, p_vehicle_id, v_vehicle_disp,
    CASE WHEN p_driver_id IS NOT NULL THEN 'assigned' ELSE 'draft' END,
    v_indent.pickup_date, coalesce(v_indent.load_type, ''), 0, 0, 'pending', 0
  )
  RETURNING * INTO v_trip;

  UPDATE public.indents
  SET status = 'completed', updated_at = now()
  WHERE id = p_indent_id;

  RETURN NEXT v_trip;
  RETURN;
END;
$function$;

-- ===========================================================================
-- C4
-- ===========================================================================
-- The "Org members can manage indents" policy lets shipper staff UPDATE any
-- indent column from the client. After a winner commits, that can clear or
-- replace assigned_supplier_id, or reopen the indent so a second Marketplace
-- bid can be awarded on top of the first. No existing trigger guards either.
--
-- SECURITY DEFINER: the winner lookup must see every accepted bid, quote and
-- trip regardless of the caller's RLS. It only raises -- it returns no data.
-- VOLATILE (default): after waiting on the indent row lock this must read the
-- committed winner, not a snapshot taken before the wait.
CREATE OR REPLACE FUNCTION public.tg_indents_guard_commercial_winner()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_mb_org      uuid;
  v_mb_found    boolean := false;
  v_dq_org      uuid;
  v_dq_found    boolean := false;
  v_has_trip    boolean := false;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status
     AND OLD.assigned_supplier_id IS NOT DISTINCT FROM NEW.assigned_supplier_id THEN
    RETURN NEW;
  END IF;

  SELECT mb.bidder_organization_id, true INTO v_mb_org, v_mb_found
  FROM public.market_bids mb
  WHERE mb.indent_id = NEW.id
    AND mb.status = 'accepted'
  ORDER BY mb.accepted_at DESC NULLS LAST, mb.updated_at DESC
  LIMIT 1;

  SELECT dq.bidder_organization_id, true INTO v_dq_org, v_dq_found
  FROM public.direct_quotes dq
  WHERE dq.indent_id = NEW.id
    AND dq.status = 'accepted'
  ORDER BY dq.updated_at DESC
  LIMIT 1;

  -- Same predicate revoke_indent_award uses for "an active trip exists", so a
  -- revoke that passes its own check is never blocked here.
  SELECT EXISTS (
    SELECT 1 FROM public.trips t
    WHERE t.indent_id = NEW.id
      AND t.deleted_at IS NULL
      AND t.status IS DISTINCT FROM 'cancelled'
  ) INTO v_has_trip;

  IF NOT (coalesce(v_mb_found, false) OR coalesce(v_dq_found, false) OR v_has_trip) THEN
    RETURN NEW;
  END IF;

  -- Supplier: only a value consistent with the committed winner. NULL ->
  -- winner is how both award paths write it. Clearing it back to NULL is a
  -- rejection too: revoke_indent_award resets the bids/quotes first, so no
  -- winner remains by the time it clears the supplier.
  IF OLD.assigned_supplier_id IS DISTINCT FROM NEW.assigned_supplier_id
     AND NOT (
       NEW.assigned_supplier_id IS NOT NULL
       AND (
         NEW.assigned_supplier_id IS NOT DISTINCT FROM v_mb_org
         OR NEW.assigned_supplier_id IS NOT DISTINCT FROM v_dq_org
       )
     ) THEN
    RAISE EXCEPTION 'award_locked: indent % already has a committed commercial winner -- revoke the award before changing the assigned supplier', NEW.id
      USING ERRCODE = '23514';
  END IF;

  -- Status: no transition back into a state that accepts another award.
  IF OLD.status IS DISTINCT FROM NEW.status
     AND lower(trim(coalesce(NEW.status, ''))) NOT IN (
       'awarded', 'completed', 'cancelled', 'closed', 'expired'
     ) THEN
    RAISE EXCEPTION 'award_locked: indent % already has a committed commercial winner -- revoke the award before reopening it (requested status=%)', NEW.id, NEW.status
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_indents_guard_commercial_winner
  BEFORE UPDATE OF status, assigned_supplier_id ON public.indents
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_indents_guard_commercial_winner();

-- ===========================================================================
-- C5
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.batch_award_indents_to_trips(p_org_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inserted integer;
  v_skipped record;
BEGIN
  IF NOT public.is_org_staff(p_org_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  -- Surface skipped rows in Postgres logs (not silently discarded), without
  -- changing the function's integer return contract.
  FOR v_skipped IN
    SELECT i.id, i.assigned_supplier_id
    FROM public.indents i
    LEFT JOIN public.trips t ON t.indent_id = i.id
    WHERE i.organization_id = p_org_id
      AND i.status = 'awarded'
      AND t.id IS NULL
      AND (
        i.assigned_supplier_id IS NULL
        OR NOT public.is_approved_supplier(p_org_id, i.assigned_supplier_id)
      )
  LOOP
    RAISE WARNING 'batch_award_indents_to_trips: skipping indent % — assigned_supplier_id % is not an active approved supplier of org %',
      v_skipped.id, v_skipped.assigned_supplier_id, p_org_id;
  END LOOP;

  WITH to_convert AS (
    SELECT i.*
    FROM public.indents i
    LEFT JOIN public.trips t ON t.indent_id = i.id
    WHERE i.organization_id = p_org_id
      AND i.status = 'awarded'
      AND t.id IS NULL
      AND i.assigned_supplier_id IS NOT NULL
      AND public.is_approved_supplier(p_org_id, i.assigned_supplier_id)
      -- Gate 1A: a Marketplace award must convert through the fee-gated path.
      AND NOT EXISTS (
        SELECT 1 FROM public.market_bids mb
        WHERE mb.indent_id = i.id
          AND mb.status = 'accepted'
      )
  ),
  inserted AS (
    INSERT INTO public.trips (
      organization_id, owner_user_id, created_by_user_id, trip_number, indent_id,
      source, pickup_area, drop_location, pickup_lat, pickup_lon, drop_lat, drop_lon,
      distance, estimated_duration, client_name, client_id, client_price, supplier_rate,
      supplier_id, trip_payout_mode, status, pickup_date, load_type, notes,
      platform_fee, driver_commission, payment_status, amount_paid
    )
    SELECT
      tc.organization_id, tc.owner_user_id, auth.uid(), '', tc.id, 'batch_conversion',
      tc.pickup_area, tc.drop_location, tc.pickup_lat, tc.pickup_lon, tc.drop_lat, tc.drop_lon,
      tc.distance, tc.estimated_duration, tc.client_name, tc.client_id, tc.client_price,
      tc.supplier_target, tc.assigned_supplier_id,
      CASE WHEN tc.assigned_supplier_id IS NOT NULL THEN 'market' ELSE 'asset' END,
      'assigned', tc.pickup_date, tc.load_type, tc.notes, 0, 0, 'pending', 0
    FROM to_convert tc
    RETURNING id
  )
  SELECT count(*) INTO v_inserted FROM inserted;

  UPDATE public.indents
  SET status = 'completed', updated_at = now()
  WHERE id IN (
    SELECT tc.id FROM public.indents tc
    LEFT JOIN public.trips t ON t.indent_id = tc.id
    WHERE tc.organization_id = p_org_id
      AND tc.status = 'awarded'
      AND t.id IS NOT NULL
  );

  RETURN v_inserted;
END;
$function$;
