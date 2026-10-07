-- Release 2: the last bidder direct write on direct_quotes.
--
-- acceptDirectQuoteCounter used to UPDATE amount on the bidder's own pending
-- quote when the supplier took the owner's counter. submit_network_quote and
-- submit_pulse_bid_with_direct_quote both refuse a countered quote
-- (quote_locked), so that accept had no RPC. This one does only that step:
-- amount becomes the stored counter, and status, counter_amount, notes and
-- fleet are left alone. Award still sees a pending quote.
--
-- No RLS policy, Release 1 function or Gate 1A object is changed. The bidder
-- INSERT/UPDATE policies stay until every writer, including this one, is off
-- the table.

CREATE OR REPLACE FUNCTION public.accept_direct_quote_counter(
  p_quote_id uuid,
  p_counter_amount numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_indent_id uuid;
  v_bidder_org uuid;
  v_status text;
  v_quote public.direct_quotes%ROWTYPE;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'unauthorized: not authenticated';
  END IF;

  IF p_counter_amount IS NULL OR p_counter_amount <= 0 THEN
    RAISE EXCEPTION 'invalid_amount';
  END IF;

  -- Peek without locking so a missing or foreign quote reveals nothing.
  SELECT dq.indent_id, dq.bidder_organization_id
    INTO v_indent_id, v_bidder_org
  FROM public.direct_quotes dq
  WHERE dq.id = p_quote_id;
  IF NOT FOUND OR NOT public.is_org_staff(v_bidder_org) THEN
    RAISE EXCEPTION 'not_found: no matching quote for your organization';
  END IF;

  -- Indent first, then the quote: the same order as award_direct_quote.
  SELECT lower(btrim(coalesce(i.status, ''))) INTO v_status
  FROM public.indents i
  WHERE i.id = v_indent_id
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: no matching quote for your organization';
  END IF;

  SELECT * INTO v_quote
  FROM public.direct_quotes
  WHERE id = p_quote_id
  FOR UPDATE;
  IF NOT FOUND OR NOT public.is_org_staff(v_quote.bidder_organization_id) THEN
    RAISE EXCEPTION 'not_found: no matching quote for your organization';
  END IF;

  IF v_status NOT IN ('open', 'broadcast') THEN
    RAISE EXCEPTION 'indent_not_open: this load is no longer open for quotes (status=%)', v_status;
  END IF;

  IF v_quote.status IS DISTINCT FROM 'pending'
     OR v_quote.counter_amount IS NULL
     OR v_quote.counter_amount IS DISTINCT FROM p_counter_amount THEN
    RAISE EXCEPTION 'quote_locked: this counter offer is no longer open';
  END IF;

  UPDATE public.direct_quotes
  SET amount = v_quote.counter_amount, updated_at = now()
  WHERE id = p_quote_id
    AND status = 'pending'
    AND counter_amount = p_counter_amount;

  RETURN jsonb_build_object(
    'quote_id', p_quote_id,
    'amount', v_quote.counter_amount,
    'status', 'pending'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.accept_direct_quote_counter(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_direct_quote_counter(uuid, numeric) TO authenticated;

COMMENT ON FUNCTION public.accept_direct_quote_counter(uuid, numeric) IS
  'Bidder staff accept the owner counter on their own pending quote: amount becomes the stored counter_amount. Status, counter, notes and fleet stay unchanged. quote_locked when the quote is decided, uncountered, or the counter the caller saw no longer matches.';
