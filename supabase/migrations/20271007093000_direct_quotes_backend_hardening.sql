-- Release 2 Phase C: server-side prerequisites for retiring the bidder
-- INSERT/UPDATE policies on direct_quotes. Every body starts from the live
-- production definition (read-only catalog, 2026-10-07), not the older
-- in-repo text: production already gates award_direct_quote and
-- submit_pulse_bid_with_direct_quote on is_org_staff.
--
--   award_direct_quote                  search_path '', explicit auth, open/broadcast
--                                       only (same rule as the Gate 1A accept guard),
--                                       anon EXECUTE revoked.
--   set_direct_quote_assignment         new: bidder staff set driver/vehicle on their
--                                       own accepted quote (replaces the direct UPDATE
--                                       in updateDirectQuoteAssignment).
--   submit_pulse_bid_with_direct_quote  quote half follows submit_network_quote:
--                                       positive amount, indent locked before the quote,
--                                       decided or countered quotes are quote_locked.
--
-- No RLS policy, Release 1 function or Gate 1A object is changed here.

CREATE OR REPLACE FUNCTION public.award_direct_quote(p_indent_id uuid, p_winning_quote_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_indent   public.indents%ROWTYPE;
  v_winner   public.direct_quotes%ROWTYPE;
  v_status   text;
  v_rejected int;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'unauthorized: not authenticated';
  END IF;

  SELECT * INTO v_indent FROM public.indents WHERE id = p_indent_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: indent %', p_indent_id;
  END IF;
  IF NOT public.is_org_staff(v_indent.organization_id) THEN
    RAISE EXCEPTION 'unauthorized: caller is not a member of org %', v_indent.organization_id;
  END IF;

  SELECT * INTO v_winner FROM public.direct_quotes WHERE id = p_winning_quote_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: direct_quote %', p_winning_quote_id;
  END IF;
  IF v_winner.indent_id <> p_indent_id THEN
    RAISE EXCEPTION 'invalid_state: quote % does not belong to indent %', p_winning_quote_id, p_indent_id;
  END IF;

  v_status := lower(btrim(coalesce(v_indent.status, '')));

  -- A retry on an already-awarded indent with the same winner returns the
  -- current state instead of raising.
  IF v_status = 'awarded' AND v_winner.status = 'accepted' THEN
    RETURN jsonb_build_object('ok', true, 'indent_id', p_indent_id, 'accepted_quote_id', p_winning_quote_id, 'rejected_count', 0);
  END IF;

  -- reject_quote_accept_on_inactive_indent accepts only on open/broadcast indents.
  IF v_status NOT IN ('open', 'broadcast') THEN
    RAISE EXCEPTION 'indent_not_open: indent % is not open for award (status=%)', p_indent_id, v_indent.status;
  END IF;
  IF v_winner.status <> 'pending' THEN
    RAISE EXCEPTION 'invalid_state: quote already decided (current: %)', v_winner.status;
  END IF;

  UPDATE public.direct_quotes
  SET status = 'accepted', updated_at = now()
  WHERE id = p_winning_quote_id;

  UPDATE public.direct_quotes
  SET status = 'rejected', updated_at = now()
  WHERE indent_id = p_indent_id
    AND id <> p_winning_quote_id
    AND status = 'pending';
  GET DIAGNOSTICS v_rejected = ROW_COUNT;

  -- Fires deactivate_posts_for_terminal_indent, which rejects pending
  -- bids/driver_direct_bids/market_bids linked to this indent's posts.
  UPDATE public.indents SET status = 'awarded', updated_at = now() WHERE id = p_indent_id;

  RETURN jsonb_build_object('ok', true, 'indent_id', p_indent_id, 'accepted_quote_id', p_winning_quote_id, 'rejected_count', v_rejected);
END;
$function$;

REVOKE ALL ON FUNCTION public.award_direct_quote(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.award_direct_quote(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.award_direct_quote(uuid, uuid) IS
  'Owner award of an org direct quote: staff of the indent-owning org, open/broadcast indent, pending winner; accepts it, rejects competing pending quotes and marks the indent awarded in one transaction.';


CREATE OR REPLACE FUNCTION public.set_direct_quote_assignment(
  p_quote_id uuid,
  p_driver_id uuid DEFAULT NULL,
  p_vehicle_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_quote public.direct_quotes%ROWTYPE;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'unauthorized: not authenticated';
  END IF;

  SELECT * INTO v_quote FROM public.direct_quotes WHERE id = p_quote_id FOR UPDATE;
  -- One message for missing and foreign quotes, so ids cannot be probed.
  IF NOT FOUND OR NOT public.is_org_staff(v_quote.bidder_organization_id) THEN
    RAISE EXCEPTION 'not_found: no matching quote for your organization';
  END IF;

  IF v_quote.status IS DISTINCT FROM 'accepted' THEN
    RAISE EXCEPTION 'invalid_state: quote must be accepted before assigning (status=%)', v_quote.status;
  END IF;

  IF p_driver_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.drivers d
    WHERE d.id = p_driver_id AND d.organization_id = v_quote.bidder_organization_id
  ) THEN
    RAISE EXCEPTION 'invalid_driver: driver must belong to your organization';
  END IF;

  IF p_vehicle_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.vehicles v
    WHERE v.id = p_vehicle_id AND v.organization_id = v_quote.bidder_organization_id
  ) THEN
    RAISE EXCEPTION 'invalid_vehicle: vehicle must belong to your organization';
  END IF;

  UPDATE public.direct_quotes
  SET driver_id = p_driver_id, vehicle_id = p_vehicle_id, updated_at = now()
  WHERE id = p_quote_id;

  RETURN jsonb_build_object('quote_id', p_quote_id, 'driver_id', p_driver_id, 'vehicle_id', p_vehicle_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.set_direct_quote_assignment(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_direct_quote_assignment(uuid, uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.set_direct_quote_assignment(uuid, uuid, uuid) IS
  'Supplier deploy: bidder-org staff set (or clear) driver_id/vehicle_id on their own accepted direct quote before create_trip_from_direct_quote. Driver and vehicle, when given, must belong to the bidder org; both may be null (ad hoc / assign later).';


CREATE OR REPLACE FUNCTION public.submit_pulse_bid_with_direct_quote(p_post_id uuid, p_bidder_org_id uuid, p_amount numeric, p_note text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_indent_id uuid;
  v_post_org_id uuid;
  v_indent_org_id uuid;
  v_quote public.direct_quotes%ROWTYPE;
  v_quote_id uuid;
  v_bid_id uuid;
  v_already boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.is_org_staff(p_bidder_org_id) THEN
    RAISE EXCEPTION 'Not a member of bidder organization';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'invalid_amount';
  END IF;

  SELECT p.source_indent_id, p.organization_id
  INTO v_indent_id, v_post_org_id
  FROM public.posts p
  WHERE p.id = p_post_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Post not found';
  END IF;
  IF v_indent_id IS NULL THEN
    RAISE EXCEPTION 'POST_NOT_LINKED_TO_INDENT';
  END IF;
  IF p_bidder_org_id = v_post_org_id THEN
    RAISE EXCEPTION 'Cannot bid on your own organization''s post';
  END IF;

  -- Indent before quote, the same order as award_direct_quote and
  -- submit_network_quote, so the open check cannot race an award.
  SELECT i.organization_id INTO v_indent_org_id
  FROM public.indents i
  WHERE i.id = v_indent_id
  FOR SHARE;

  IF NOT FOUND OR NOT public.indent_open_for_marketplace_bids(v_indent_id) THEN
    RAISE EXCEPTION 'INDENT_NOT_OPEN_FOR_BIDS';
  END IF;
  IF v_indent_org_id IS DISTINCT FROM v_post_org_id THEN
    RAISE EXCEPTION 'Indent does not match post owner';
  END IF;

  SELECT * INTO v_quote
  FROM public.direct_quotes dq
  WHERE dq.indent_id = v_indent_id
    AND dq.bidder_organization_id = p_bidder_org_id
  FOR UPDATE;

  IF FOUND AND (v_quote.status IS DISTINCT FROM 'pending' OR v_quote.counter_amount IS NOT NULL) THEN
    RAISE EXCEPTION 'quote_locked: this quote is no longer open for changes (status=%)',
      CASE WHEN v_quote.counter_amount IS NOT NULL AND v_quote.status = 'pending'
        THEN 'countered' ELSE v_quote.status END;
  END IF;

  -- Heal projection rows wrongly deactivated by the old client 24h clock.
  UPDATE public.posts
  SET is_active = true, updated_at = now()
  WHERE id = p_post_id
    AND is_active IS DISTINCT FROM true;

  IF EXISTS (
    SELECT 1
    FROM public.bids b
    WHERE b.post_id = p_post_id
      AND b.bidder_organization_id = p_bidder_org_id
  ) THEN
    v_already := true;
    UPDATE public.bids b
    SET
      amount = p_amount,
      note = nullif(btrim(p_note), ''),
      updated_at = now()
    WHERE b.post_id = p_post_id
      AND b.bidder_organization_id = p_bidder_org_id
      AND b.status = 'pending'
    RETURNING b.id INTO v_bid_id;
    IF v_bid_id IS NULL THEN
      SELECT b.id INTO v_bid_id
      FROM public.bids b
      WHERE b.post_id = p_post_id
        AND b.bidder_organization_id = p_bidder_org_id;
    END IF;
  ELSE
    INSERT INTO public.bids (
      post_id,
      bidder_organization_id,
      bidder_user_id,
      amount,
      note,
      status
    )
    VALUES (
      p_post_id,
      p_bidder_org_id,
      v_uid,
      p_amount,
      nullif(btrim(p_note), ''),
      'pending'
    )
    RETURNING id INTO v_bid_id;
  END IF;

  INSERT INTO public.direct_quotes (indent_id, bidder_organization_id, amount, notes, status)
  VALUES (v_indent_id, p_bidder_org_id, p_amount, nullif(btrim(p_note), ''), 'pending')
  ON CONFLICT (indent_id, bidder_organization_id) DO UPDATE SET
    amount = EXCLUDED.amount,
    notes = EXCLUDED.notes,
    updated_at = now()
  WHERE public.direct_quotes.status = 'pending'
    AND public.direct_quotes.counter_amount IS NULL
  RETURNING id INTO v_quote_id;

  IF v_quote_id IS NULL THEN
    RAISE EXCEPTION 'quote_locked: this quote is no longer open for changes';
  END IF;

  RETURN jsonb_build_object('bid_id', v_bid_id, 'already_bid', v_already);
END;
$function$;

REVOKE ALL ON FUNCTION public.submit_pulse_bid_with_direct_quote(uuid, uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_pulse_bid_with_direct_quote(uuid, uuid, numeric, text) TO authenticated;
