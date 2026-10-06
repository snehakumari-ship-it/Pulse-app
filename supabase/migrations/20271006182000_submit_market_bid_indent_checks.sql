-- D2 / S1: submit_market_bid validates the indent again.
-- Live body is 20271005120000 (production-verified 2026-10-06). The indent
-- open check (removed in 20270310220000) and the own-organization check are
-- restored, and Marketplace circulation is now required:
--
--   1. indent open for Marketplace bids        -> indent_not_open
--   2. circulation_target marketplace | both   -> not_marketplace_circulated
--   3. bidder organization owns the indent, or
--      a DCO caller is an active member of it   -> own_indent
--
-- Everything else is unchanged: authentication, amount, DCO eligibility,
-- availability, owned active vehicle, bidder-organization membership and the
-- bid_locked protection on decided bids. Signature, defaults, return shape,
-- SECURITY DEFINER and search_path are unchanged, so existing grants stay.
--
-- The indent row is share-locked before the checks so an award or close that
-- commits concurrently is seen before the bid is written. Lock order (indent,
-- then bid) matches award_market_bid.

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
  v_indent_org uuid;
  v_circulation text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'invalid_amount';
  END IF;

  SELECT i.organization_id, lower(trim(coalesce(i.circulation_target, '')))
    INTO v_indent_org, v_circulation
  FROM public.indents i
  WHERE i.id = p_indent_id
  FOR SHARE;

  IF NOT FOUND OR NOT public.indent_open_for_marketplace_bids(p_indent_id) THEN
    RAISE EXCEPTION 'indent_not_open: this load is no longer open for bids';
  END IF;

  IF v_circulation NOT IN ('marketplace', 'both') THEN
    RAISE EXCEPTION 'not_marketplace_circulated: this load is not offered on Marketplace';
  END IF;

  IF p_bidder_organization_id IS NOT NULL THEN
    IF p_bidder_organization_id = v_indent_org THEN
      RAISE EXCEPTION 'own_indent: you cannot bid on your own organization''s load';
    END IF;
  ELSIF EXISTS (
    SELECT 1 FROM public.organization_members om
    WHERE om.organization_id = v_indent_org
      AND om.user_id = v_uid
      AND om.status = 'active'
  ) THEN
    RAISE EXCEPTION 'own_indent: you cannot bid on your own organization''s load';
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
