-- Omni-channel award classification (Exchange Phase 0, defect 12).
--
-- An indent with circulation_target = 'both' is ONE indent published to TWO
-- channels: Network (the shipper's approved suppliers) and Marketplace (the
-- open market). The award channel is decided by the winning offer, never by
-- where the indent was published.
--
--   Marketplace award  = an accepted market_bids row from that bidder org, OR
--                        an open-market offer: the indent circulates to the
--                        Marketplace and the bidder is NOT an approved Network
--                        supplier of the indent owner (ADR-012: no suppliers row).
--   Network award      = everything else. The supplier relationship already
--                        exists; the trip links supplier_id and keeps the
--                        shipper's customer client_price.
--
-- 20270925194500 returned true for every 'marketplace'/'both' indent, so every
-- Network-supplier deploy on a 'both' indent was created as source='market_bid',
-- supplier_id NULL, trip_payout_mode 'asset', client_price = supplier rate
-- (285 GOGOVAN trips 2026-09-25 → 2026-10-06; see
-- docs/deployment/PULSE_EXCHANGE_TRANSACTION_LAYER_AUDIT.md §12).
--
-- create_trip_from_assigned_indent additionally loses its "latest accepted bid
-- on the indent from ANY bidder" fallback: a deploy may only bind to the
-- assigned supplier's own accepted bid.
--
-- Unchanged on purpose (separate, later steps):
--   * Marketplace org-bidder trips keep trip_payout_mode 'asset' and
--     client_price = bid amount. Moving them to 'market' requires the client
--     completion guard to accept a supplier-less Marketplace trip first.
--   * The deploy-time settle_marketplace_fee_as_cash call.
--   * Historical repair of the 285 trips (separately authorized).
--
-- Callers that inherit the corrected predicate without a body change:
-- create_trip_from_direct_quote, set_indent_assigned_supplier_on_quote_accepted.

CREATE OR REPLACE FUNCTION public.is_marketplace_indent_award(
  p_indent_id uuid,
  p_bidder_org uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    p_indent_id IS NOT NULL
    AND p_bidder_org IS NOT NULL
    AND (
      EXISTS (
        SELECT 1
        FROM public.market_bids mb
        WHERE mb.indent_id = p_indent_id
          AND mb.status = 'accepted'
          AND mb.bidder_organization_id = p_bidder_org
      )
      OR EXISTS (
        SELECT 1
        FROM public.indents i
        WHERE i.id = p_indent_id
          AND lower(coalesce(i.circulation_target, '')) IN ('marketplace', 'both')
          AND NOT public.is_approved_supplier(i.organization_id, p_bidder_org)
      )
    );
$function$;

COMMENT ON FUNCTION public.is_marketplace_indent_award(uuid, uuid) IS
  'Award channel of an indent for one bidder org: Marketplace when that org holds the accepted market bid, or when it won an open-market (marketplace/both) indent without being an approved Network supplier. Otherwise Network.';

REVOKE ALL ON FUNCTION public.is_marketplace_indent_award(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_marketplace_indent_award(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_trip_from_assigned_indent(
  p_indent_id uuid,
  p_driver_id uuid DEFAULT NULL::uuid,
  p_vehicle_id uuid DEFAULT NULL::uuid,
  p_vehicle_display_number text DEFAULT NULL::text
)
RETURNS SETOF trips
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_indent             public.indents%ROWTYPE;
  v_org_id             uuid;
  v_supplier_org_id    uuid;
  v_supplier_id        uuid;
  v_trip               public.trips%ROWTYPE;
  v_vehicle_display    text;
  v_supplier_rate      numeric;
  v_actor_user_id      uuid := auth.uid();
  v_created_by_user_id uuid := NULL;
  v_try                integer := 0;
  v_market_bid         public.market_bids%ROWTYPE;
  v_is_market_award    boolean := false;
  v_source             text := 'indent';
  v_source_market_bid_id uuid := NULL;
  v_client_price       numeric;
  v_trip_platform_fee  numeric := 0;
  v_trip_fee_snapshot  jsonb := NULL;
  v_trip_sale_basis    text := NULL;
BEGIN
  v_vehicle_display := NULLIF(TRIM(COALESCE(p_vehicle_display_number, '')), '');

  IF v_actor_user_id IS NOT NULL THEN
    INSERT INTO public.users (id, name)
    VALUES (v_actor_user_id, 'User')
    ON CONFLICT (id) DO NOTHING;
  END IF;

  SELECT id INTO v_created_by_user_id
  FROM public.users
  WHERE id = v_actor_user_id
  LIMIT 1;

  SELECT * INTO v_indent FROM public.indents WHERE id = p_indent_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Indent % not found', p_indent_id;
  END IF;

  IF lower(coalesce(v_indent.status, '')) IN ('cancelled', 'closed') THEN
    RAISE EXCEPTION 'Cannot create trip: indent % is not available', p_indent_id;
  END IF;

  v_supplier_org_id := v_indent.assigned_supplier_id;
  IF v_supplier_org_id IS NULL THEN
    RAISE EXCEPTION 'Indent has no assigned supplier';
  END IF;

  IF NOT public.is_org_member(v_supplier_org_id) THEN
    RAISE EXCEPTION 'Not authorized to deploy this load';
  END IF;

  v_org_id := v_indent.organization_id;

  SELECT * INTO v_market_bid
  FROM public.market_bids
  WHERE indent_id = p_indent_id
    AND bidder_type = 'organization'
    AND bidder_organization_id = v_supplier_org_id
    AND status = 'accepted'
  LIMIT 1;
  v_is_market_award := FOUND;

  -- Open-market award without a market bid (e.g. a Pulse bid quote from a
  -- non-supplier). Never bind to another bidder's accepted bid.
  IF NOT v_is_market_award THEN
    v_is_market_award := public.is_marketplace_indent_award(p_indent_id, v_supplier_org_id);
  END IF;

  IF v_is_market_award AND v_market_bid.id IS NOT NULL
     AND v_market_bid.fee_payment_status NOT IN ('paid', 'not_required') THEN
    IF to_regprocedure('public.settle_marketplace_fee_as_cash(uuid)') IS NOT NULL THEN
      PERFORM public.settle_marketplace_fee_as_cash(v_market_bid.id);
      SELECT * INTO v_market_bid FROM public.market_bids WHERE id = v_market_bid.id;
    END IF;
    IF v_market_bid.fee_payment_status NOT IN ('paid', 'not_required') THEN
      RAISE EXCEPTION 'fee_payment_pending: platform fee must be paid before this Marketplace award can be deployed (bid %, current: %)', v_market_bid.id, v_market_bid.fee_payment_status;
    END IF;
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

  IF p_driver_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.drivers d
      WHERE d.id = p_driver_id AND d.organization_id = v_supplier_org_id
    ) THEN
      RAISE EXCEPTION 'Driver must belong to your organization';
    END IF;
  END IF;

  IF p_vehicle_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.vehicles v
      WHERE v.id = p_vehicle_id AND v.organization_id = v_supplier_org_id
    ) THEN
      RAISE EXCEPTION 'Vehicle must belong to your organization';
    END IF;
  END IF;

  SELECT t.* INTO v_trip
  FROM public.trips t
  WHERE t.indent_id = p_indent_id
  LIMIT 1;

  IF FOUND THEN
    IF lower(coalesce(v_trip.status, '')) NOT IN ('completed', 'cancelled') THEN
      UPDATE public.trips
      SET
        driver_id = COALESCE(p_driver_id, driver_id),
        vehicle_id = COALESCE(p_vehicle_id, vehicle_id),
        vehicle_display_number = CASE
          WHEN v_vehicle_display IS NOT NULL THEN v_vehicle_display
          ELSE vehicle_display_number
        END,
        updated_at = now()
      WHERE id = v_trip.id;
      SELECT * INTO v_trip FROM public.trips WHERE id = v_trip.id;
    END IF;
    UPDATE public.indents SET status = 'completed', updated_at = now() WHERE id = p_indent_id;
    RETURN NEXT v_trip;
    RETURN;
  END IF;

  IF v_is_market_award THEN
    v_supplier_rate := COALESCE(v_market_bid.amount, v_indent.assigned_supplier_rate, v_indent.supplier_target, 0);
    v_supplier_id := NULL;
    v_source := 'market_bid';
    v_source_market_bid_id := v_market_bid.id;
    v_client_price := COALESCE(v_market_bid.amount, v_indent.assigned_supplier_rate, v_indent.client_price, 0);
    v_trip_platform_fee := coalesce(v_market_bid.platform_fee_amount, 0);
    v_trip_fee_snapshot := v_market_bid.platform_fee_calc_snapshot;
    v_trip_sale_basis := 'per_trip';
  ELSE
    v_supplier_rate := COALESCE(
      (v_indent.assigned_supplier_rate)::numeric,
      v_indent.supplier_target,
      0
    );
    v_supplier_id := public.ensure_awarded_bidder_supplier(v_org_id, v_supplier_org_id);
    v_source := 'indent';
    v_source_market_bid_id := NULL;
    v_client_price := coalesce(v_indent.client_price, 0);
    v_trip_platform_fee := 0;
    v_trip_fee_snapshot := NULL;
    v_trip_sale_basis := NULL;
  END IF;

  LOOP
    v_try := v_try + 1;
    BEGIN
      INSERT INTO public.trips (
        organization_id, owner_user_id, created_by_user_id, trip_number, indent_id,
        source, source_market_bid_id, pickup_area, drop_location, client_name, client_price, supplier_rate,
        supplier_id, trip_payout_mode, driver_id, vehicle_id, status, pickup_date,
        load_type, vehicle_display_number, platform_fee, driver_commission,
        payment_status, amount_paid, platform_fee_calc_snapshot, sale_rate_basis
      ) VALUES (
        v_org_id, v_indent.owner_user_id, v_created_by_user_id, '', p_indent_id,
        v_source, v_source_market_bid_id, coalesce(v_indent.pickup_area, ''), coalesce(v_indent.drop_location, ''),
        coalesce(v_indent.client_name, ''),
        v_client_price,
        v_supplier_rate, v_supplier_id,
        CASE WHEN v_supplier_id IS NOT NULL THEN 'market' ELSE 'asset' END,
        p_driver_id, p_vehicle_id,
        CASE WHEN p_driver_id IS NOT NULL THEN 'assigned' ELSE 'draft' END,
        v_indent.pickup_date, coalesce(v_indent.load_type, ''), v_vehicle_display,
        v_trip_platform_fee, 0, 'pending', 0,
        v_trip_fee_snapshot,
        v_trip_sale_basis
      )
      RETURNING * INTO v_trip;

      UPDATE public.indents SET status = 'completed', updated_at = now() WHERE id = p_indent_id;
      RETURN NEXT v_trip;
      RETURN;
    EXCEPTION
      WHEN unique_violation THEN
        SELECT t.* INTO v_trip
        FROM public.trips t
        WHERE t.indent_id = p_indent_id
        LIMIT 1;
        IF FOUND THEN
          UPDATE public.indents SET status = 'completed', updated_at = now() WHERE id = p_indent_id;
          RETURN NEXT v_trip;
          RETURN;
        END IF;
        IF v_try >= 3 THEN
          RAISE;
        END IF;
    END;
  END LOOP;
END;
$function$;

COMMENT ON FUNCTION public.create_trip_from_assigned_indent(uuid, uuid, uuid, text) IS
  'Deploy an awarded indent. The award channel comes from the winning offer (is_marketplace_indent_award), not the indent''s circulation_target. Marketplace awards do not require a Network suppliers row; Network awards link the shipper''s supplier row.';

REVOKE ALL ON FUNCTION public.create_trip_from_assigned_indent(uuid, uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_trip_from_assigned_indent(uuid, uuid, uuid, text) TO authenticated;
