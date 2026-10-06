-- D3 / R1 + R2: server-authoritative Network quote write for pooled quoting.
--
-- Checks, in order:
--   caller is an active staff-role member of the bidder organization  -> unauthorized
--   indent is returned by market_indents_for_org(bidder org)           -> indent_not_visible
--   indent is open for bids                                            -> indent_not_open
--   bidder organization does not own the indent                        -> own_indent
--   an existing quote is still pending and not countered               -> quote_locked
--
-- The write is a conditional upsert that never changes status: a rejected or
-- accepted quote cannot return to pending, and a countered quote is not
-- overwritten. Accepting stays with the indent owner; the Gate 1A guard
-- (reject_quote_accept_on_inactive_indent, live) is untouched.
--
-- The existing direct_quotes RLS policies are not changed here. Revoking the
-- bidder INSERT/UPDATE policies is a separate compatibility step, because
-- createDirectQuote and other callers still write the table directly.

CREATE OR REPLACE FUNCTION public.submit_network_quote(
  p_indent_id uuid,
  p_bidder_org_id uuid,
  p_amount numeric,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_indent_org uuid;
  v_existing public.direct_quotes%ROWTYPE;
  v_quote_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'invalid_amount';
  END IF;

  -- Same membership rule as the "Bidders can insert own direct quotes" policy.
  IF p_bidder_org_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.organization_members om
    WHERE om.organization_id = p_bidder_org_id
      AND om.user_id = v_uid
      AND om.status = 'active'
      AND om.role IN ('owner', 'admin', 'member', 'dispatcher', 'finance')
  ) THEN
    RAISE EXCEPTION 'unauthorized: caller is not an active member of bidder organization';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.market_indents_for_org(p_bidder_org_id) m
    WHERE m.id = p_indent_id
  ) THEN
    RAISE EXCEPTION 'indent_not_visible: this load is not available to your organization';
  END IF;

  SELECT i.organization_id INTO v_indent_org
  FROM public.indents i
  WHERE i.id = p_indent_id
  FOR SHARE;

  IF NOT FOUND OR NOT public.indent_open_for_marketplace_bids(p_indent_id) THEN
    RAISE EXCEPTION 'indent_not_open: this load is no longer open for quotes';
  END IF;

  IF v_indent_org = p_bidder_org_id THEN
    RAISE EXCEPTION 'own_indent: your organization cannot quote on its own load';
  END IF;

  SELECT * INTO v_existing
  FROM public.direct_quotes dq
  WHERE dq.indent_id = p_indent_id
    AND dq.bidder_organization_id = p_bidder_org_id
  FOR UPDATE;

  IF FOUND AND (v_existing.status IS DISTINCT FROM 'pending' OR v_existing.counter_amount IS NOT NULL) THEN
    RAISE EXCEPTION 'quote_locked: this quote is no longer open for changes (status=%)',
      CASE WHEN v_existing.counter_amount IS NOT NULL AND v_existing.status = 'pending'
        THEN 'countered' ELSE v_existing.status END;
  END IF;

  INSERT INTO public.direct_quotes (indent_id, bidder_organization_id, amount, notes, status)
  VALUES (p_indent_id, p_bidder_org_id, p_amount, NULLIF(btrim(coalesce(p_notes, '')), ''), 'pending')
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

  RETURN jsonb_build_object(
    'quote_id', v_quote_id,
    'indent_id', p_indent_id,
    'bidder_organization_id', p_bidder_org_id,
    'amount', p_amount,
    'status', 'pending',
    'created', v_existing.id IS NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_network_quote(uuid, uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_network_quote(uuid, uuid, numeric, text) TO authenticated;

COMMENT ON FUNCTION public.submit_network_quote(uuid, uuid, numeric, text) IS
  'Pooled Network quote write: visibility (market_indents_for_org), open, own-indent and quote-state checks, then a conditional upsert that never changes status. quote_locked when the quote is decided or countered.';
