-- direct_quotes hardening suite: award_direct_quote, set_direct_quote_assignment,
-- submit_pulse_bid_with_direct_quote, and the direct owner/bidder paths that stay
-- on RLS until Phase F. Runs after Gate 1A (production bodies), 20271007093000,
-- pooled_marketplace/05_helpers.sql and 06_fixtures_real.sql.
-- Fixture roles: u_ship admin SHIP1 (owner); u_bid1 member B1; u_bid2 dispatcher B1;
-- u_other member B2; u_plain no membership. Added here: u_drv_ship (driver, SHIP1),
-- u_drv_b1 (driver, B1).

CREATE TABLE t_dq (name text PRIMARY KEY, id uuid NOT NULL);
GRANT SELECT ON t_dq TO PUBLIC;
CREATE FUNCTION t_dq(p text) RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT id FROM t_dq WHERE name = p $$;
CREATE FUNCTION t_dq_put(p text, p_id uuid) RETURNS uuid LANGUAGE sql AS $$ INSERT INTO t_dq VALUES (p, p_id) RETURNING id $$;

CREATE FUNCTION t_quote_row(p_indent uuid, p_org uuid, p_amount numeric) RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO public.direct_quotes (indent_id, bidder_organization_id, amount, status)
  VALUES (p_indent, p_org, p_amount, 'pending') RETURNING id
$$;
CREATE FUNCTION t_q(p_id uuid) RETURNS public.direct_quotes LANGUAGE sql STABLE AS $$
  SELECT * FROM public.direct_quotes WHERE id = p_id
$$;
CREATE FUNCTION t_award_sql(p_indent uuid, p_quote uuid) RETURNS text LANGUAGE sql AS $$
  SELECT format('SELECT public.award_direct_quote(%L, %L)', p_indent, p_quote)
$$;
CREATE FUNCTION t_assign_sql(p_quote uuid, p_driver uuid, p_vehicle uuid) RETURNS text LANGUAGE sql AS $$
  SELECT format('SELECT public.set_direct_quote_assignment(%L, %L, %L)', p_quote, p_driver, p_vehicle)
$$;
CREATE FUNCTION t_story_sql(p_post uuid, p_org uuid, p_amount numeric) RETURNS text LANGUAGE sql AS $$
  SELECT format('SELECT public.submit_pulse_bid_with_direct_quote(%L, %L, %s, %L)', p_post, p_org,
    coalesce(p_amount::text, 'NULL'), 'harness')
$$;
-- Row count of a DML statement run as a user (RLS applies).
CREATE FUNCTION t_dml_as(p_uid uuid, p_sql text) RETURNS int LANGUAGE sql AS $$
  SELECT (t_exec_as(p_uid, format('WITH u AS (%s RETURNING 1) SELECT to_jsonb(count(*)) FROM u', p_sql)) #>> '{}')::int
$$;

INSERT INTO t_ids VALUES
  ('u_drv_ship', 'e2000000-0000-0000-0000-0000000000a1'),
  ('u_drv_b1',   'e2000000-0000-0000-0000-0000000000a2'),
  ('D_B1',       'e4000000-0000-0000-0000-000000000001'),
  ('D_B2',       'e4000000-0000-0000-0000-000000000002'),
  ('VH_B1',      'e5000000-0000-0000-0000-000000000001'),
  ('VH_B2',      'e5000000-0000-0000-0000-000000000002');
INSERT INTO auth.users (id, aud, role, email)
SELECT t_id(k), 'authenticated', 'authenticated', 'dq-harness-' || k || '@example.invalid'
FROM unnest(ARRAY['u_drv_ship', 'u_drv_b1']) k;
INSERT INTO public.profiles (id, role) VALUES (t_id('u_drv_ship'), 'user'), (t_id('u_drv_b1'), 'user')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
INSERT INTO public.organization_members (organization_id, user_id, role) VALUES
  (t_id('SHIP1'), t_id('u_drv_ship'), 'driver'),
  (t_id('B1'), t_id('u_drv_b1'), 'driver');
INSERT INTO public.organization_relations (from_organization_id, to_organization_id, relation_type, status)
VALUES (t_id('SHIP1'), t_id('B2'), 'client_supplier', 'active');
INSERT INTO public.drivers (id, organization_id, name, phone) VALUES
  (t_id('D_B1'), t_id('B1'), 'DQ Harness Driver B1', '9990000001'),
  (t_id('D_B2'), t_id('B2'), 'DQ Harness Driver B2', '9990000002');
INSERT INTO public.vehicles (id, organization_id, vehicle_number, type) VALUES
  (t_id('VH_B1'), t_id('B1'), 'DQH01AA0001', 'owned'),
  (t_id('VH_B2'), t_id('B2'), 'DQH01AA0002', 'owned');

-- ── Shape: grants, definer, search_path, untouched neighbours ────────────
DO $$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['public.award_direct_quote(uuid,uuid)', 'public.set_direct_quote_assignment(uuid,uuid,uuid)',
                           'public.submit_pulse_bid_with_direct_quote(uuid,uuid,numeric,text)'] LOOP
    PERFORM t_ok(format('DQ shape: %s is SECURITY DEFINER with search_path=""', f),
      (SELECT p.prosecdef AND p.proconfig = ARRAY['search_path=""'] FROM pg_proc p WHERE p.oid = f::regprocedure), f);
    PERFORM t_ok(format('DQ shape: %s executable by authenticated, not anon or PUBLIC', f),
      has_function_privilege('authenticated', f, 'EXECUTE') AND NOT has_function_privilege('anon', f, 'EXECUTE')
        AND NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = f::regprocedure AND a.grantee = 0), f);
  END LOOP;
  PERFORM t_ok('DQ shape: Gate 1A bodies are the production ones (accept guard, indent winner guard)',
    (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.reject_quote_accept_on_inactive_indent()'::regprocedure) LIKE '22f150c6%'
      AND (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.tg_indents_guard_commercial_winner()'::regprocedure) LIKE 'f66dd760%'
      AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_indents_guard_commercial_winner'), '');
  PERFORM t_ok('DQ shape: submit_network_quote is the Release 1 body (unchanged)',
    (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.submit_network_quote(uuid,uuid,numeric,text)'::regprocedure) LIKE 'fb618593%', '');
  PERFORM t_ok('DQ shape: all five direct_quotes policies are still present (no RLS change)',
    (SELECT array_agg(policyname::text ORDER BY policyname) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'direct_quotes')
      = ARRAY['Bidders can insert own direct quotes', 'Bidders can select own direct quotes', 'Bidders can update own direct quotes',
              'Indent owners can read quotes on their indents', 'Indent owners can update quotes on their indents'], '');
END $$;

-- ── award_direct_quote ───────────────────────────────────────────────────
SELECT t_dq_put('i1', t_indent(t_id('SHIP1'), 'DQ Alpha', 'DQ Beta', '20FT', 'integrated_supplier'));
SELECT t_dq_put('q1', t_quote_row(t_dq('i1'), t_id('B1'), 21000));
SELECT t_dq_put('q2', t_quote_row(t_dq('i1'), t_id('B2'), 22000));
SELECT t_dq_put('i_other', t_indent(t_id('SHIP1'), 'DQ Alpha', 'DQ Beta', '20FT', 'integrated_supplier'));
SELECT t_dq_put('i_draft', t_indent(t_id('SHIP1'), 'DQ Alpha', 'DQ Beta', '20FT', 'integrated_supplier', 'draft'));
SELECT t_dq_put('q_draft', t_quote_row(t_dq('i_draft'), t_id('B1'), 20000));

SELECT t_err_as('DQ award: anonymous caller cannot execute', NULL, t_award_sql(t_dq('i1'), t_dq('q1')),
  'permission denied for function award_direct_quote', 'anon');
SELECT t_err_as('DQ award: authenticated without a session uid is refused', NULL, t_award_sql(t_dq('i1'), t_dq('q1')),
  'unauthorized: not authenticated');
SELECT t_err_as('DQ award: user with no membership is refused', t_id('u_plain'), t_award_sql(t_dq('i1'), t_dq('q1')),
  'unauthorized: caller is not a member');
SELECT t_err_as('DQ award: bidder cannot award its own quote', t_id('u_bid1'), t_award_sql(t_dq('i1'), t_dq('q1')),
  'unauthorized: caller is not a member');
SELECT t_err_as('DQ award: competing bidder cannot award', t_id('u_other'), t_award_sql(t_dq('i1'), t_dq('q2')),
  'unauthorized: caller is not a member');
SELECT t_err_as('DQ award: driver-role member of the owner org cannot award', t_id('u_drv_ship'), t_award_sql(t_dq('i1'), t_dq('q1')),
  'unauthorized: caller is not a member');
SELECT t_err_as('DQ award: quote from another indent is refused', t_id('u_ship'), t_award_sql(t_dq('i_other'), t_dq('q1')),
  'invalid_state: quote');
SELECT t_err_as('DQ award: draft indent is not open for award', t_id('u_ship'), t_award_sql(t_dq('i_draft'), t_dq('q_draft')),
  'indent_not_open:');
SELECT t_err_as('DQ award: nonexistent quote', t_id('u_ship'), t_award_sql(t_dq('i1'), gen_random_uuid()), 'not_found: direct_quote');

DO $$
DECLARE
  r jsonb;
  q1 public.direct_quotes;
  q2 public.direct_quotes;
  ind public.indents;
BEGIN
  PERFORM t_ok('DQ award: refused attempts left both quotes pending and the indent open',
    (t_q(t_dq('q1'))).status = 'pending' AND (t_q(t_dq('q2'))).status = 'pending'
      AND (SELECT status FROM public.indents WHERE id = t_dq('i1')) = 'open', '');
  r := t_exec_as(t_id('u_ship'), t_award_sql(t_dq('i1'), t_dq('q1')));
  q1 := t_q(t_dq('q1')); q2 := t_q(t_dq('q2'));
  SELECT * INTO ind FROM public.indents WHERE id = t_dq('i1');
  PERFORM t_ok('DQ award: owner staff award accepts the winner, rejects the competitor and awards the indent',
    (r ->> 'ok')::boolean AND (r ->> 'rejected_count')::int = 1 AND q1.status = 'accepted' AND q2.status = 'rejected'
      AND ind.status = 'awarded' AND ind.assigned_supplier_id = t_id('B1'), r::text);
  PERFORM t_ok('DQ award: award does not change the winning amount or counter',
    q1.amount = 21000 AND q1.counter_amount IS NULL, '');
  r := t_exec_as(t_id('u_ship'), t_award_sql(t_dq('i1'), t_dq('q1')));
  PERFORM t_ok('DQ award: retry with the same winner is idempotent',
    (r ->> 'ok')::boolean AND (r ->> 'rejected_count')::int = 0, r::text);
END $$;
SELECT t_err_as('DQ award: a second winner on an awarded indent is refused', t_id('u_ship'), t_award_sql(t_dq('i1'), t_dq('q2')),
  'indent_not_open:');
SELECT t_err_as('DQ Gate 1A: owner cannot reopen an awarded indent directly', t_id('u_ship'),
  format('UPDATE public.indents SET status = ''open'' WHERE id = %L', t_dq('i1')), 'award_locked:');

-- Gate 1A accept guard inside the award: supplier already assigned elsewhere.
SELECT t_dq_put('i_assigned', t_indent(t_id('SHIP1'), 'DQ Alpha', 'DQ Beta', '20FT', 'integrated_supplier'));
UPDATE public.indents SET assigned_supplier_id = t_id('B2') WHERE id = t_dq('i_assigned');
SELECT t_dq_put('q_assigned', t_quote_row(t_dq('i_assigned'), t_id('B1'), 20000));
SELECT t_err_as('DQ Gate 1A: award refused when the indent is already assigned to another org', t_id('u_ship'),
  t_award_sql(t_dq('i_assigned'), t_dq('q_assigned')), 'already_awarded:');
DO $$
BEGIN
  PERFORM t_ok('DQ Gate 1A: refused award left the quote pending and the indent unchanged',
    (t_q(t_dq('q_assigned'))).status = 'pending'
      AND (SELECT status = 'open' AND assigned_supplier_id = t_id('B2') FROM public.indents WHERE id = t_dq('i_assigned')), '');
END $$;

-- Decided quote on an open indent.
SELECT t_dq_put('i_dec', t_indent(t_id('SHIP1'), 'DQ Alpha', 'DQ Beta', '20FT', 'integrated_supplier'));
SELECT t_dq_put('q_dec', t_quote_row(t_dq('i_dec'), t_id('B1'), 20000));
UPDATE public.direct_quotes SET status = 'rejected' WHERE id = t_dq('q_dec');
SELECT t_err_as('DQ award: rejected quote cannot be awarded', t_id('u_ship'), t_award_sql(t_dq('i_dec'), t_dq('q_dec')),
  'invalid_state: quote already decided');

-- ── set_direct_quote_assignment (q1 is B1's accepted quote) ──────────────
SELECT t_dq_put('i_pend', t_indent(t_id('SHIP1'), 'DQ Alpha', 'DQ Beta', '20FT', 'integrated_supplier'));
SELECT t_dq_put('q_pend', t_quote_row(t_dq('i_pend'), t_id('B1'), 20000));

SELECT t_err_as('DQ assign: anonymous caller cannot execute', NULL, t_assign_sql(t_dq('q1'), t_id('D_B1'), t_id('VH_B1')),
  'permission denied for function set_direct_quote_assignment', 'anon');
SELECT t_err_as('DQ assign: authenticated without a session uid is refused', NULL,
  t_assign_sql(t_dq('q1'), t_id('D_B1'), t_id('VH_B1')), 'unauthorized: not authenticated');
SELECT t_err_as('DQ assign: other bidder org cannot assign', t_id('u_other'), t_assign_sql(t_dq('q1'), t_id('D_B2'), t_id('VH_B2')),
  'not_found: no matching quote for your organization');
SELECT t_err_as('DQ assign: load owner cannot assign the supplier fleet', t_id('u_ship'), t_assign_sql(t_dq('q1'), NULL, NULL),
  'not_found: no matching quote for your organization');
SELECT t_err_as('DQ assign: driver-role member of the bidder org cannot assign', t_id('u_drv_b1'), t_assign_sql(t_dq('q1'), NULL, NULL),
  'not_found: no matching quote for your organization');
SELECT t_err_as('DQ assign: user with no membership cannot assign', t_id('u_plain'), t_assign_sql(t_dq('q1'), NULL, NULL),
  'not_found: no matching quote for your organization');
SELECT t_err_as('DQ assign: nonexistent quote gives the same answer as a foreign one', t_id('u_bid1'),
  t_assign_sql(gen_random_uuid(), NULL, NULL), 'not_found: no matching quote for your organization');
SELECT t_err_as('DQ assign: pending quote cannot be assigned', t_id('u_bid1'), t_assign_sql(t_dq('q_pend'), t_id('D_B1'), t_id('VH_B1')),
  'invalid_state: quote must be accepted before assigning (status=pending)');
SELECT t_err_as('DQ assign: rejected quote cannot be assigned', t_id('u_other'), t_assign_sql(t_dq('q2'), t_id('D_B2'), t_id('VH_B2')),
  'invalid_state: quote must be accepted before assigning (status=rejected)');
SELECT t_err_as('DQ assign: another org''s driver is refused', t_id('u_bid1'), t_assign_sql(t_dq('q1'), t_id('D_B2'), t_id('VH_B1')),
  'invalid_driver:');
SELECT t_err_as('DQ assign: another org''s vehicle is refused', t_id('u_bid1'), t_assign_sql(t_dq('q1'), t_id('D_B1'), t_id('VH_B2')),
  'invalid_vehicle:');

DO $$
DECLARE
  before public.direct_quotes := t_q(t_dq('q1'));
  after public.direct_quotes;
  n_notif int := (SELECT count(*) FROM public.network_notifications);
  ind_before public.indents := (SELECT i FROM public.indents i WHERE i.id = t_dq('i1'));
  ind_writes bigint := (SELECT n_tup_upd FROM pg_stat_xact_user_tables WHERE relid = 'public.indents'::regclass);
  r jsonb;
BEGIN
  PERFORM t_ok('DQ assign: refused attempts left the quote unassigned',
    before.driver_id IS NULL AND before.vehicle_id IS NULL, '');
  r := t_exec_as(t_id('u_bid1'), t_assign_sql(t_dq('q1'), t_id('D_B1'), t_id('VH_B1')));
  after := t_q(t_dq('q1'));
  PERFORM t_ok('DQ assign: bidder staff roster assignment sets driver and vehicle',
    after.driver_id = t_id('D_B1') AND after.vehicle_id = t_id('VH_B1') AND (r ->> 'quote_id')::uuid = t_dq('q1'), r::text);
  PERFORM t_ok('DQ assign: assignment never changes status, amount, counter, indent or bidder',
    after.status = 'accepted' AND after.amount = before.amount AND after.counter_amount IS NOT DISTINCT FROM before.counter_amount
      AND after.indent_id = before.indent_id AND after.bidder_organization_id = before.bidder_organization_id, '');
  PERFORM t_ok('DQ assign: assignment emits no quote lifecycle notification',
    (SELECT count(*) FROM public.network_notifications) = n_notif, '');
  PERFORM t_ok('DQ assign: assignment does not fire the accept trigger (indent row untouched)',
    (SELECT i FROM public.indents i WHERE i.id = t_dq('i1')) IS NOT DISTINCT FROM ind_before
      AND (SELECT n_tup_upd FROM pg_stat_xact_user_tables WHERE relid = 'public.indents'::regclass) = ind_writes,
    format('indent updates in this transaction: %s -> %s', ind_writes,
      (SELECT n_tup_upd FROM pg_stat_xact_user_tables WHERE relid = 'public.indents'::regclass)));

  r := t_exec_as(t_id('u_bid2'), t_assign_sql(t_dq('q1'), NULL, t_id('VH_B1')));
  after := t_q(t_dq('q1'));
  PERFORM t_ok('DQ assign: ad hoc (OTP) path by a colleague: no driver, own vehicle',
    after.driver_id IS NULL AND after.vehicle_id = t_id('VH_B1'), r::text);

  r := t_exec_as(t_id('u_bid1'), t_assign_sql(t_dq('q1'), NULL, NULL));
  after := t_q(t_dq('q1'));
  PERFORM t_ok('DQ assign: assign-later path clears both', after.driver_id IS NULL AND after.vehicle_id IS NULL, r::text);

  r := t_exec_as(t_id('u_bid1'), t_assign_sql(t_dq('q1'), t_id('D_B1'), t_id('VH_B1')));
  PERFORM t_ok('DQ assign: roster assignment again before trip creation', (t_q(t_dq('q1'))).driver_id = t_id('D_B1'), r::text);
END $$;

-- Hand-off to create_trip_from_direct_quote: the trip takes the assigned fleet.
DO $$
DECLARE
  tr jsonb;
BEGIN
  tr := t_exec_as(t_id('u_bid1'), format(
    'SELECT to_jsonb(t) FROM public.create_trip_from_direct_quote(%L, %L) t LIMIT 1', t_dq('q1'), 'DQH01AA0001'));
  PERFORM t_ok('DQ assign: create_trip_from_direct_quote uses the assigned driver and vehicle',
    (tr ->> 'driver_id')::uuid = t_id('D_B1') AND (tr ->> 'vehicle_id')::uuid = t_id('VH_B1'), coalesce(tr::text, 'no trip'));
END $$;

-- ── submit_pulse_bid_with_direct_quote ───────────────────────────────────
SELECT t_dq_put('i_story', t_indent(t_id('SHIP1'), 'DQ Story', 'DQ Lane', '20FT', 'both'));
SELECT t_dq_put('p_story', t_post(t_dq('i_story')));
SELECT t_dq_put('i_story_closed', t_indent(t_id('SHIP1'), 'DQ Story', 'DQ Lane', '20FT', 'marketplace', 'closed'));
SELECT t_dq_put('p_story_closed', t_post(t_dq('i_story_closed')));
INSERT INTO public.posts (id, type, source_indent_id, author_user_id, organization_id)
VALUES (gen_random_uuid(), 'LOAD', NULL, t_id('u_ship'), t_id('SHIP1')) RETURNING t_dq_put('p_unlinked', id);
INSERT INTO public.posts (id, type, source_indent_id, author_user_id, organization_id)
VALUES (gen_random_uuid(), 'LOAD', t_dq('i_story'), t_id('u_ship'), t_id('SHIP2')) RETURNING t_dq_put('p_mismatch', id);

SELECT t_err_as('DQ story: anonymous caller cannot execute', NULL, t_story_sql(t_dq('p_story'), t_id('B1'), 1000),
  'permission denied for function submit_pulse_bid_with_direct_quote', 'anon');
SELECT t_err_as('DQ story: non-member is refused', t_id('u_plain'), t_story_sql(t_dq('p_story'), t_id('B1'), 1000),
  'Not a member of bidder organization');
SELECT t_err_as('DQ story: driver-role member of the bidder org is refused', t_id('u_drv_b1'), t_story_sql(t_dq('p_story'), t_id('B1'), 1000),
  'Not a member of bidder organization');
SELECT t_err_as('DQ story: member of another org cannot bid for B1', t_id('u_other'), t_story_sql(t_dq('p_story'), t_id('B1'), 1000),
  'Not a member of bidder organization');
SELECT t_err_as('DQ story: zero amount', t_id('u_bid1'), t_story_sql(t_dq('p_story'), t_id('B1'), 0), 'invalid_amount');
SELECT t_err_as('DQ story: negative amount', t_id('u_bid1'), t_story_sql(t_dq('p_story'), t_id('B1'), -5), 'invalid_amount');
SELECT t_err_as('DQ story: null amount', t_id('u_bid1'), t_story_sql(t_dq('p_story'), t_id('B1'), NULL), 'invalid_amount');
SELECT t_err_as('DQ story: own organization''s post', t_id('u_ship'), t_story_sql(t_dq('p_story'), t_id('SHIP1'), 1000),
  'Cannot bid on your own organization''s post');
SELECT t_err_as('DQ story: closed indent', t_id('u_bid1'), t_story_sql(t_dq('p_story_closed'), t_id('B1'), 1000),
  'INDENT_NOT_OPEN_FOR_BIDS');
SELECT t_err_as('DQ story: post without an indent', t_id('u_bid1'), t_story_sql(t_dq('p_unlinked'), t_id('B1'), 1000),
  'POST_NOT_LINKED_TO_INDENT');
SELECT t_err_as('DQ story: post org differs from indent owner', t_id('u_bid1'), t_story_sql(t_dq('p_mismatch'), t_id('B1'), 1000),
  'Indent does not match post owner');
SELECT t_err_as('DQ story: awarded indent (accepted quote) is not open', t_id('u_bid1'),
  t_story_sql(t_post(t_dq('i1')), t_id('B1'), 1000), 'INDENT_NOT_OPEN_FOR_BIDS');

DO $$
DECLARE
  r jsonb;
  q public.direct_quotes;
  v_quote uuid;
BEGIN
  PERFORM t_ok('DQ story: refused attempts wrote no bid and no quote',
    NOT EXISTS (SELECT 1 FROM public.bids WHERE post_id = t_dq('p_story'))
      AND NOT EXISTS (SELECT 1 FROM public.direct_quotes WHERE indent_id = t_dq('i_story')), '');
  r := t_exec_as(t_id('u_bid1'), t_story_sql(t_dq('p_story'), t_id('B1'), 1000));
  SELECT * INTO q FROM public.direct_quotes WHERE indent_id = t_dq('i_story') AND bidder_organization_id = t_id('B1');
  PERFORM t_ok('DQ story: first bid writes the bid and a pending quote',
    NOT (r ->> 'already_bid')::boolean AND q.status = 'pending' AND q.amount = 1000
      AND (SELECT amount FROM public.bids WHERE id = (r ->> 'bid_id')::uuid) = 1000, r::text);
  v_quote := q.id;
  r := t_exec_as(t_id('u_bid1'), t_story_sql(t_dq('p_story'), t_id('B1'), 1100));
  PERFORM t_ok('DQ story: revision of a pending, uncountered quote updates bid and quote',
    (r ->> 'already_bid')::boolean AND (t_q(v_quote)).amount = 1100
      AND (SELECT amount FROM public.bids WHERE id = (r ->> 'bid_id')::uuid) = 1100, r::text);
  r := t_exec_as(t_id('u_bid2'), t_story_sql(t_dq('p_story'), t_id('B1'), 1150));
  PERFORM t_ok('DQ story: colleague revision still allowed (D5 not enforced)', (t_q(v_quote)).amount = 1150, r::text);
  PERFORM t_dq_put('q_story', v_quote);
END $$;

-- Owner counter through the existing owner UPDATE policy (submitDirectQuoteCounterOffer).
DO $$
DECLARE
  n int := t_dml_as(t_id('u_ship'), format(
    'UPDATE public.direct_quotes SET counter_amount = 1050 WHERE id = %L AND status = ''pending''', t_dq('q_story')));
BEGIN
  PERFORM t_ok('DQ owner: counter-offer through the owner UPDATE policy still works',
    n = 1 AND (t_q(t_dq('q_story'))).counter_amount = 1050, n::text);
END $$;
SELECT t_err_as('DQ story: countered quote is quote_locked', t_id('u_bid1'), t_story_sql(t_dq('p_story'), t_id('B1'), 1200),
  'quote_locked: this quote is no longer open for changes (status=countered)');
SELECT t_err_as('DQ story: countered quote is quote_locked for submit_network_quote too (parity)', t_id('u_bid1'),
  t_quote_sql(t_dq('i_story'), t_id('B1'), 1200), 'quote_locked:');
DO $$
BEGIN
  PERFORM t_ok('DQ story: locked attempt changed neither the quote nor the story bid',
    (t_q(t_dq('q_story'))).amount = 1150 AND (t_q(t_dq('q_story'))).counter_amount = 1050
      AND (SELECT amount FROM public.bids WHERE post_id = t_dq('p_story') AND bidder_organization_id = t_id('B1')) = 1150, '');
END $$;

-- Rejected quote (owner reject through the owner UPDATE policy) on an open indent.
SELECT t_dq_put('i_story_rej', t_indent(t_id('SHIP1'), 'DQ Story', 'DQ Lane', '20FT', 'marketplace'));
SELECT t_dq_put('p_story_rej', t_post(t_dq('i_story_rej')));
SELECT t_exec_as(t_id('u_other'), t_story_sql(t_dq('p_story_rej'), t_id('B2'), 900));
DO $$
DECLARE
  v_q uuid := (SELECT id FROM public.direct_quotes WHERE indent_id = t_dq('i_story_rej') AND bidder_organization_id = t_id('B2'));
  n int := t_dml_as(t_id('u_ship'), format('UPDATE public.direct_quotes SET status = ''rejected'' WHERE id = %L', v_q));
BEGIN
  PERFORM t_dq_put('q_story_rej', v_q);
  PERFORM t_ok('DQ owner: reject through the owner UPDATE policy still works', n = 1 AND (t_q(v_q)).status = 'rejected', n::text);
END $$;
SELECT t_err_as('DQ story: rejected quote cannot be revived or repriced', t_id('u_other'), t_story_sql(t_dq('p_story_rej'), t_id('B2'), 800),
  'quote_locked: this quote is no longer open for changes (status=rejected)');
-- Phase D input: a Marketplace-only story load is not Network-visible, so the
-- BidSheet edit path must stay on submit_pulse_bid_with_direct_quote.
SELECT t_dq_put('i_story_mkt', t_indent(t_id('SHIP1'), 'DQ Story', 'DQ Lane', '20FT', 'marketplace'));
SELECT t_dq_put('p_story_mkt', t_post(t_dq('i_story_mkt')));
SELECT t_exec_as(t_id('u_bid1'), t_story_sql(t_dq('p_story_mkt'), t_id('B1'), 950));
SELECT t_err_as('DQ story: Marketplace-only story quote is not reachable through submit_network_quote', t_id('u_bid1'),
  t_quote_sql(t_dq('i_story_mkt'), t_id('B1'), 960), 'indent_not_visible:');
DO $$
DECLARE
  r jsonb := t_exec_as(t_id('u_bid1'), t_story_sql(t_dq('p_story_mkt'), t_id('B1'), 970));
BEGIN
  PERFORM t_ok('DQ story: Marketplace-only story quote is revised through the story RPC',
    (r ->> 'already_bid')::boolean AND (SELECT amount FROM public.direct_quotes
      WHERE indent_id = t_dq('i_story_mkt') AND bidder_organization_id = t_id('B1')) = 970, r::text);
END $$;
DO $$
BEGIN
  PERFORM t_ok('DQ story: rejected quote keeps status and amount',
    (t_q(t_dq('q_story_rej'))).status = 'rejected' AND (t_q(t_dq('q_story_rej'))).amount = 900, '');
END $$;

-- ── Direct paths that stay on RLS until Phase F ──────────────────────────
SELECT t_dq_put('i_own', t_indent(t_id('SHIP1'), 'DQ Own', 'DQ Lane', '20FT', 'integrated_supplier'));
DO $$
DECLARE
  n int;
BEGIN
  n := t_dml_as(t_id('u_bid1'), format(
    'INSERT INTO public.direct_quotes (indent_id, bidder_organization_id, amount, status) VALUES (%L, %L, 700, ''pending'')
     ON CONFLICT (indent_id, bidder_organization_id) DO UPDATE SET amount = EXCLUDED.amount', t_dq('i_own'), t_id('B1')));
  PERFORM t_ok('DQ compat: createDirectQuote-style bidder upsert still works (policies unchanged)', n = 1, n::text);
  PERFORM t_dq_put('q_own_b1', (SELECT id FROM public.direct_quotes WHERE indent_id = t_dq('i_own') AND bidder_organization_id = t_id('B1')));
  PERFORM t_dq_put('q_own_b2', t_quote_row(t_dq('i_own'), t_id('B2'), 750));
END $$;
SELECT t_err_as('DQ Gate 1A: bidder self-accept through the bidder UPDATE policy is blocked', t_id('u_bid1'),
  format('UPDATE public.direct_quotes SET status = ''accepted'' WHERE id = %L', t_dq('q_own_b1')), 'unauthorized: only staff');
DO $$
DECLARE
  n int := t_dml_as(t_id('u_drv_ship'), format('UPDATE public.direct_quotes SET status = ''accepted'' WHERE id = %L', t_dq('q_own_b1')));
BEGIN
  PERFORM t_ok('DQ owner: driver-role member of the owner org cannot accept directly (owner policy hides the row)',
    n = 0 AND (t_q(t_dq('q_own_b1'))).status = 'pending', n::text);
END $$;
DO $$
DECLARE
  n_acc int := t_dml_as(t_id('u_ship'), format('UPDATE public.direct_quotes SET status = ''accepted'' WHERE id = %L', t_dq('q_own_b1')));
  n_rej int := t_dml_as(t_id('u_ship'), format('UPDATE public.direct_quotes SET status = ''rejected'' WHERE id = %L', t_dq('q_own_b2')));
  n_ctr int := t_dml_as(t_id('u_ship'), format(
    'UPDATE public.direct_quotes SET counter_amount = 600 WHERE id = %L AND status = ''pending''', t_dq('q_own_b1')));
BEGIN
  PERFORM t_ok('DQ owner: direct accept (useAwardQuote path) still works and assigns the supplier',
    n_acc = 1 AND (t_q(t_dq('q_own_b1'))).status = 'accepted'
      AND (SELECT assigned_supplier_id FROM public.indents WHERE id = t_dq('i_own')) = t_id('B1'), n_acc::text);
  PERFORM t_ok('DQ owner: direct reject of the competitor still works', n_rej = 1 AND (t_q(t_dq('q_own_b2'))).status = 'rejected', '');
  PERFORM t_ok('DQ owner: counter on a decided quote matches no row (pending filter)', n_ctr = 0, n_ctr::text);
END $$;
SELECT t_err_as('DQ Gate 1A: second direct accept on the same indent is blocked', t_id('u_ship'),
  format('UPDATE public.direct_quotes SET status = ''accepted'' WHERE id = %L', t_dq('q_own_b2')), 'indent_not_open:');
DO $$
DECLARE
  n int := t_dml_as(t_id('u_bid1'), format(
    'UPDATE public.direct_quotes SET driver_id = %L, vehicle_id = %L WHERE id = %L', t_id('D_B1'), t_id('VH_B1'), t_dq('q_own_b1')));
BEGIN
  PERFORM t_ok('DQ compat: updateDirectQuoteAssignment direct UPDATE still works until the client moves',
    n = 1 AND (t_q(t_dq('q_own_b1'))).driver_id = t_id('D_B1'), n::text);
END $$;
