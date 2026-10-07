-- accept_direct_quote_counter: bidder staff take the stored counter.
-- Loaded after 20271007114500, the fleet trigger and 30/40.

DO $$
DECLARE
  f text := 'public.accept_direct_quote_counter(uuid,numeric)';
BEGIN
  PERFORM t_ok('DQ counter shape: SECURITY DEFINER with search_path=""',
    (SELECT p.prosecdef AND p.proconfig = ARRAY['search_path=""'] FROM pg_proc p WHERE p.oid = f::regprocedure), f);
  PERFORM t_ok('DQ counter shape: executable by authenticated, not anon or PUBLIC',
    has_function_privilege('authenticated', f, 'EXECUTE')
      AND NOT has_function_privilege('anon', f, 'EXECUTE')
      AND NOT EXISTS (
        SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
        WHERE p.oid = f::regprocedure AND a.grantee = 0
      ), f);
  PERFORM t_ok('DQ counter shape: direct_quotes policies are still the original five',
    (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'direct_quotes') = 5, '');
END $$;

SELECT t_dq_put('i_ctr', t_indent(t_id('SHIP1'), 'DQ Counter', 'DQ Yard', '32FT', 'integrated_supplier'));
SELECT t_dq_put('q_ctr', t_quote_row(t_dq('i_ctr'), t_id('B1'), 21000));
UPDATE public.direct_quotes
SET counter_amount = 17500, notes = 'keep me', driver_id = t_id('D_B1')
WHERE id = t_dq('q_ctr');

SELECT t_dq_put('i_ctr2', t_indent(t_id('SHIP1'), 'DQ Counter', 'DQ Yard', '32FT', 'both'));
SELECT t_dq_put('q_ctr2', t_quote_row(t_dq('i_ctr2'), t_id('B1'), 18000));
UPDATE public.direct_quotes SET counter_amount = 16000 WHERE id = t_dq('q_ctr2');

SELECT t_dq_put('i_plain', t_indent(t_id('SHIP1'), 'DQ Counter', 'DQ Yard', '32FT', 'integrated_supplier'));
SELECT t_dq_put('q_plain', t_quote_row(t_dq('i_plain'), t_id('B1'), 19000));

SELECT t_dq_put('i_closed', t_indent(t_id('SHIP1'), 'DQ Counter', 'DQ Yard', '32FT', 'integrated_supplier', 'closed'));
SELECT t_dq_put('q_closed', t_quote_row(t_dq('i_closed'), t_id('B1'), 19000));
UPDATE public.direct_quotes SET counter_amount = 15000 WHERE id = t_dq('q_closed');

CREATE FUNCTION t_accept_sql(p_quote uuid, p_amount numeric) RETURNS text LANGUAGE sql AS $$
  SELECT format('SELECT public.accept_direct_quote_counter(%L, %s)', p_quote, coalesce(p_amount::text, 'NULL'))
$$;

SELECT t_err_as('DQ counter: anonymous caller cannot execute', NULL,
  t_accept_sql(t_dq('q_ctr'), 17500), 'permission denied for function accept_direct_quote_counter', 'anon');
SELECT t_err_as('DQ counter: authenticated without a session uid is refused', NULL,
  t_accept_sql(t_dq('q_ctr'), 17500), 'unauthorized: not authenticated');
SELECT t_err_as('DQ counter: a zero amount is refused', t_id('u_bid1'),
  t_accept_sql(t_dq('q_ctr'), 0), 'invalid_amount');
SELECT t_err_as('DQ counter: a null amount is refused', t_id('u_bid1'),
  t_accept_sql(t_dq('q_ctr'), NULL), 'invalid_amount');
SELECT t_err_as('DQ counter: a user with no membership is refused', t_id('u_plain'),
  t_accept_sql(t_dq('q_ctr'), 17500), 'not_found');
SELECT t_err_as('DQ counter: a driver of the bidder org is refused', t_id('u_drv_b1'),
  t_accept_sql(t_dq('q_ctr'), 17500), 'not_found');
SELECT t_err_as('DQ counter: the indent owner cannot accept the bidder counter', t_id('u_ship'),
  t_accept_sql(t_dq('q_ctr'), 17500), 'not_found');
SELECT t_err_as('DQ counter: another organization is refused', t_id('u_other'),
  t_accept_sql(t_dq('q_ctr'), 17500), 'not_found');
SELECT t_err_as('DQ counter: an unknown quote is refused', t_id('u_bid1'),
  t_accept_sql('e9000000-0000-0000-0000-000000000099', 17500), 'not_found');
SELECT t_err_as('DQ counter: a pending quote with no counter is locked', t_id('u_bid1'),
  t_accept_sql(t_dq('q_plain'), 19000), 'quote_locked');
SELECT t_err_as('DQ counter: a stale counter amount writes nothing', t_id('u_bid1'),
  t_accept_sql(t_dq('q_ctr'), 16000), 'quote_locked');
SELECT t_err_as('DQ counter: a closed indent is not open', t_id('u_bid1'),
  t_accept_sql(t_dq('q_closed'), 15000), 'indent_not_open');

SELECT t_ok('DQ counter: a refused accept leaves the original amount',
  (SELECT amount = 21000 AND status = 'pending' AND counter_amount = 17500 FROM public.direct_quotes WHERE id = t_dq('q_ctr'))
    AND (SELECT amount = 19000 AND counter_amount IS NULL FROM public.direct_quotes WHERE id = t_dq('q_plain'))
    AND (SELECT amount = 19000 AND counter_amount = 15000 FROM public.direct_quotes WHERE id = t_dq('q_closed')), '');

SELECT t_exec_as(t_id('u_bid1'), t_accept_sql(t_dq('q_ctr'), 17500));
SELECT t_ok('DQ counter: bidder staff set amount to the stored counter and change nothing else',
  (SELECT amount = 17500 AND status = 'pending' AND counter_amount = 17500
          AND notes = 'keep me' AND driver_id = t_id('D_B1') AND vehicle_id IS NULL
   FROM public.direct_quotes WHERE id = t_dq('q_ctr')), '');

SELECT t_exec_as(t_id('u_bid1'), t_accept_sql(t_dq('q_ctr'), 17500));
SELECT t_ok('DQ counter: accepting the same counter again stays pending at that amount',
  (SELECT amount = 17500 AND status = 'pending' AND counter_amount = 17500
   FROM public.direct_quotes WHERE id = t_dq('q_ctr')), '');

SELECT t_err_as('DQ counter: submit_network_quote still refuses the countered quote', t_id('u_bid1'),
  t_quote_sql(t_dq('i_ctr'), t_id('B1'), 17500), 'quote_locked');

SELECT t_exec_as(t_id('u_bid2'), t_accept_sql(t_dq('q_ctr2'), 16000));
SELECT t_ok('DQ counter: a dispatcher colleague of the bidder org can accept',
  (SELECT amount = 16000 AND status = 'pending' AND counter_amount = 16000
   FROM public.direct_quotes WHERE id = t_dq('q_ctr2')), '');

UPDATE public.direct_quotes SET status = 'rejected' WHERE id = t_dq('q_plain');
SELECT t_err_as('DQ counter: a decided quote on an open indent is locked', t_id('u_bid1'),
  t_accept_sql(t_dq('q_plain'), 19000), 'quote_locked');

SELECT t_exec_as(t_id('u_ship'), t_award_sql(t_dq('i_ctr'), t_dq('q_ctr')));
SELECT t_ok('DQ counter: the owner can still award the accepted-counter quote',
  (SELECT status = 'accepted' AND amount = 17500 FROM public.direct_quotes WHERE id = t_dq('q_ctr'))
    AND (SELECT status = 'awarded' FROM public.indents WHERE id = t_dq('i_ctr')), '');

SELECT t_err_as('DQ counter: an awarded indent is no longer open', t_id('u_bid1'),
  t_accept_sql(t_dq('q_ctr'), 17500), 'indent_not_open');
