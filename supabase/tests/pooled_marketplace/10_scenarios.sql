-- Pooled Marketplace scenarios. Needs 05_helpers.sql and a 06_fixtures_*.sql.

-- ═════════════════════════════════════════════════════════════════════════
-- S1 — submit_market_bid indent checks
-- ═════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_open uuid := t_indent(t_id('SHIP1'), 'S1 Pickup', 'S1 Drop', 'S1 Truck');
  v_both uuid := t_indent(t_id('SHIP1'), 'S1 Pickup', 'S1 Drop', 'S1 Truck', 'both');
  v_closed uuid := t_indent(t_id('SHIP1'), 'S1 Pickup', 'S1 Drop', 'S1 Truck', 'marketplace', 'closed');
  v_awarded uuid := t_indent(t_id('SHIP1'), 'S1 Pickup', 'S1 Drop', 'S1 Truck', 'marketplace', 'awarded');
  v_deleted uuid := t_indent(t_id('SHIP1'), 'S1 Pickup', 'S1 Drop', 'S1 Truck');
  v_integ uuid := t_indent(t_id('SHIP1'), 'S1 Pickup', 'S1 Drop', 'S1 Truck', 'integrated_supplier');
  v_nullcirc uuid := t_indent(t_id('SHIP1'), 'S1 Pickup', 'S1 Drop', 'S1 Truck', NULL);
  v_closed_integ uuid := t_indent(t_id('SHIP1'), 'S1 Pickup', 'S1 Drop', 'S1 Truck', 'integrated_supplier', 'closed');
  v_b1_own uuid := t_indent(t_id('B1'), 'S1 Pickup', 'S1 Drop', 'S1 Truck');
  v_b1_own_integ uuid := t_indent(t_id('B1'), 'S1 Pickup', 'S1 Drop', 'S1 Truck', 'integrated_supplier');
  r jsonb;
BEGIN
  UPDATE public.indents SET deleted_at = now() WHERE id = v_deleted;

  -- Rejections
  PERFORM t_err_as('S1 closed indent rejected (organization)', t_id('u_bid1'), t_bid_sql(v_closed, 15000, t_id('B1'), NULL), 'indent_not_open');
  PERFORM t_err_as('S1 closed indent rejected (DCO)', t_id('u_dco'), t_bid_sql(v_closed, 15000, NULL, t_id('V1')), 'indent_not_open');
  PERFORM t_err_as('S1 awarded indent rejected', t_id('u_bid1'), t_bid_sql(v_awarded, 15000, t_id('B1'), NULL), 'indent_not_open');
  PERFORM t_err_as('S1 deleted indent rejected', t_id('u_bid1'), t_bid_sql(v_deleted, 15000, t_id('B1'), NULL), 'indent_not_open');
  PERFORM t_err_as('S1 nonexistent indent rejected', t_id('u_bid1'), t_bid_sql(gen_random_uuid(), 15000, t_id('B1'), NULL), 'indent_not_open');
  PERFORM t_err_as('S1 integrated_supplier circulation rejected (organization)', t_id('u_bid1'), t_bid_sql(v_integ, 15000, t_id('B1'), NULL), 'not_marketplace_circulated');
  PERFORM t_err_as('S1 integrated_supplier circulation rejected (DCO)', t_id('u_dco'), t_bid_sql(v_integ, 15000, NULL, t_id('V1')), 'not_marketplace_circulated');
  PERFORM t_err_as('S1 NULL circulation rejected', t_id('u_bid1'), t_bid_sql(v_nullcirc, 15000, t_id('B1'), NULL), 'not_marketplace_circulated');
  PERFORM t_err_as('S1 own-organization indent rejected', t_id('u_bid1'), t_bid_sql(v_b1_own, 15000, t_id('B1'), NULL), 'own_indent');
  PERFORM t_err_as('S1 DCO who is a member of the shipper rejected', t_id('u_dco_m'), t_bid_sql(v_open, 15000, NULL, t_id('V2')), 'own_indent');

  -- Check order: open, then circulation, then own indent
  PERFORM t_err_as('S1 order: closed + non-Marketplace reports indent_not_open', t_id('u_bid1'), t_bid_sql(v_closed_integ, 15000, t_id('B1'), NULL), 'indent_not_open');
  PERFORM t_err_as('S1 order: own + non-Marketplace reports not_marketplace_circulated', t_id('u_bid1'), t_bid_sql(v_b1_own_integ, 15000, t_id('B1'), NULL), 'not_marketplace_circulated');

  -- Existing checks preserved
  PERFORM t_err_as('S1 preserved: unauthenticated', NULL, t_bid_sql(v_open, 15000, t_id('B1'), NULL), 'Not authenticated');
  PERFORM t_err_as('S1 preserved: invalid amount', t_id('u_bid1'), t_bid_sql(v_open, 0, t_id('B1'), NULL), 'invalid_amount');
  PERFORM t_err_as('S1 preserved: non-member of bidder organization', t_id('u_other'), t_bid_sql(v_open, 15000, t_id('B1'), NULL), 'unauthorized: caller is not an active member');
  PERFORM t_err_as('S1 preserved: DCO eligibility', t_id('u_drv_ne'), t_bid_sql(v_open, 15000, NULL, t_id('V1')), 'unauthorized: approved');
  PERFORM t_err_as('S1 preserved: DCO vehicle required', t_id('u_dco'), t_bid_sql(v_open, 15000, NULL, NULL), 'owner_vehicle_required');
  PERFORM t_err_as('S1 preserved: DCO vehicle must be own', t_id('u_dco'), t_bid_sql(v_open, 15000, NULL, t_id('V2')), 'owner_vehicle_id must be an active vehicle');

  PERFORM t_ok('S1 rejected calls wrote nothing',
    NOT EXISTS (SELECT 1 FROM public.market_bids b WHERE b.indent_id IN
      (v_closed, v_awarded, v_deleted, v_integ, v_nullcirc, v_closed_integ, v_b1_own, v_b1_own_integ)));

  -- Valid bids still succeed
  r := t_bid(t_id('u_bid1'), v_open, 15000, t_id('B1'), NULL);
  PERFORM t_ok('S1 valid organization Marketplace bid succeeds', r ->> 'bidder_type' = 'organization', r::text);
  r := t_bid(t_id('u_bid1'), v_both, 15000, t_id('B1'), NULL);
  PERFORM t_ok('S1 valid organization bid on circulation=both succeeds', r ->> 'bidder_type' = 'organization', r::text);
  r := t_bid(t_id('u_dco'), v_open, 14000, NULL, t_id('V1'));
  PERFORM t_ok('S1 valid DCO Marketplace bid succeeds', r ->> 'bidder_type' = 'dco', r::text);
  r := t_bid(t_id('u_dco'), v_open, 14500, NULL, t_id('V1'));
  PERFORM t_ok('S1 pending bid can still be updated',
    (SELECT amount FROM public.market_bids WHERE indent_id = v_open AND bidder_user_id = t_id('u_dco')) = 14500);

  -- bid_locked preserved
  UPDATE public.market_bids SET status = 'rejected' WHERE indent_id = v_open AND bidder_user_id = t_id('u_bid1');
  PERFORM t_err_as('S1 preserved: decided bid is bid_locked', t_id('u_bid1'), t_bid_sql(v_open, 16000, t_id('B1'), NULL), 'bid_locked');
  PERFORM t_ok('S1 decided bid unchanged',
    (SELECT status = 'rejected' AND amount = 15000 FROM public.market_bids WHERE indent_id = v_open AND bidder_user_id = t_id('u_bid1')));
END $$;

-- ═════════════════════════════════════════════════════════════════════════
-- Network quote — submit_network_quote
-- ═════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  n_open uuid := t_indent(t_id('SHIP1'), 'NQ Pickup', 'NQ Drop', 'NQ Truck', 'integrated_supplier');
  n_closed uuid := t_indent(t_id('SHIP1'), 'NQ Pickup', 'NQ Drop', 'NQ Truck', 'integrated_supplier', 'closed');
  n_invisible uuid := t_indent(t_id('SHIP2'), 'NQ Pickup', 'NQ Drop', 'NQ Truck', 'integrated_supplier');
  n_own uuid := t_indent(t_id('B1'), 'NQ Pickup', 'NQ Drop', 'NQ Truck', 'integrated_supplier');
  n_rejected uuid := t_indent(t_id('SHIP1'), 'NQ Pickup', 'NQ Drop', 'NQ Truck', 'integrated_supplier');
  n_accepted uuid := t_indent(t_id('SHIP1'), 'NQ Pickup', 'NQ Drop', 'NQ Truck', 'integrated_supplier');
  n_countered uuid := t_indent(t_id('SHIP1'), 'NQ Pickup', 'NQ Drop', 'NQ Truck', 'integrated_supplier');
  n_control uuid := t_indent(t_id('SHIP1'), 'NQ Pickup', 'NQ Drop', 'NQ Truck', 'integrated_supplier');
  v_quote uuid;
  r jsonb;
BEGIN
  -- Self relation makes B1's own load visible to B1, so own_indent is reached.
  INSERT INTO public.organization_relations (from_organization_id, to_organization_id, relation_type, status)
  VALUES (t_id('B1'), t_id('B1'), 'client_supplier', 'active');

  r := t_exec_as(t_id('u_bid1'), t_quote_sql(n_open, t_id('B1'), 12000));
  PERFORM t_ok('Quote: visible open indent creates a pending quote',
    (r ->> 'created')::boolean AND r ->> 'status' = 'pending', r::text);
  v_quote := (r ->> 'quote_id')::uuid;
  r := t_exec_as(t_id('u_bid1'), t_quote_sql(n_open, t_id('B1'), 12500));
  PERFORM t_ok('Quote: pending quote can update',
    NOT (r ->> 'created')::boolean
    AND (SELECT amount = 12500 AND status = 'pending' FROM public.direct_quotes WHERE id = v_quote), r::text);

  PERFORM t_err_as('Quote: invisible indent rejected', t_id('u_bid1'), t_quote_sql(n_invisible, t_id('B1'), 12000), 'indent_not_visible');
  PERFORM t_err_as('Quote: nonexistent indent rejected', t_id('u_bid1'), t_quote_sql(gen_random_uuid(), t_id('B1'), 12000), 'indent_not_visible');
  PERFORM t_err_as('Quote: indent visible to another org only rejected', t_id('u_other'), t_quote_sql(n_open, t_id('B2'), 12000), 'indent_not_visible');
  PERFORM t_err_as('Quote: closed indent rejected', t_id('u_bid1'), t_quote_sql(n_closed, t_id('B1'), 12000), 'indent_not_open');
  PERFORM t_err_as('Quote: own indent rejected', t_id('u_bid1'), t_quote_sql(n_own, t_id('B1'), 12000), 'own_indent');
  PERFORM t_err_as('Quote: non-member of bidder organization rejected', t_id('u_other'), t_quote_sql(n_open, t_id('B1'), 12000), 'unauthorized');
  PERFORM t_err_as('Quote: unauthenticated rejected', NULL, t_quote_sql(n_open, t_id('B1'), 12000), 'Not authenticated');
  PERFORM t_ok('Quote: rejected calls wrote nothing',
    NOT EXISTS (SELECT 1 FROM public.direct_quotes WHERE indent_id IN (n_invisible, n_closed, n_own)));

  INSERT INTO public.direct_quotes (indent_id, bidder_organization_id, amount, status)
  VALUES (n_rejected, t_id('B1'), 11000, 'pending');
  UPDATE public.direct_quotes SET status = 'rejected' WHERE indent_id = n_rejected;
  PERFORM t_err_as('Quote: rejected quote cannot be resurrected', t_id('u_bid1'), t_quote_sql(n_rejected, t_id('B1'), 11500), 'quote_locked');
  PERFORM t_ok('Quote: rejected quote unchanged',
    (SELECT status = 'rejected' AND amount = 11000 FROM public.direct_quotes WHERE indent_id = n_rejected));

  INSERT INTO public.direct_quotes (indent_id, bidder_organization_id, amount, status)
  VALUES (n_accepted, t_id('B1'), 11000, 'accepted');
  PERFORM t_err_as('Quote: accepted quote cannot be resurrected', t_id('u_bid1'), t_quote_sql(n_accepted, t_id('B1'), 11500), 'quote_locked');
  PERFORM t_ok('Quote: accepted quote unchanged',
    (SELECT status = 'accepted' AND amount = 11000 FROM public.direct_quotes WHERE indent_id = n_accepted));

  INSERT INTO public.direct_quotes (indent_id, bidder_organization_id, amount, status, counter_amount)
  VALUES (n_countered, t_id('B1'), 11000, 'pending', 13000);
  PERFORM t_err_as('Quote: countered quote is locked', t_id('u_bid1'), t_quote_sql(n_countered, t_id('B1'), 11500), 'quote_locked');
  PERFORM t_ok('Quote: countered quote unchanged',
    (SELECT amount = 11000 AND counter_amount = 13000 FROM public.direct_quotes WHERE indent_id = n_countered));

  -- Gate 1A self-accept guard still applies to the bidder's direct UPDATE.
  PERFORM t_err_as('Quote: bidder self-accept remains blocked', t_id('u_bid1'),
    format('UPDATE public.direct_quotes SET status = %L WHERE id = %L', 'accepted', v_quote),
    'unauthorized: only staff of the load-owning organization');
  PERFORM t_ok('Quote: self-accept left the quote pending',
    (SELECT status = 'pending' FROM public.direct_quotes WHERE id = v_quote));

  -- Control: the indent owner can still accept, and the accepted quote is then locked.
  INSERT INTO public.direct_quotes (indent_id, bidder_organization_id, amount, status)
  VALUES (n_control, t_id('B1'), 10500, 'pending');
  UPDATE public.indents SET status = 'open' WHERE id = n_control;
  PERFORM t_exec_as(t_id('u_ship'),
    format('UPDATE public.direct_quotes SET status = %L WHERE indent_id = %L RETURNING to_jsonb(id)', 'accepted', n_control));
  PERFORM t_ok('Quote: indent owner accept still works (guard is not blanket)',
    (SELECT status = 'accepted' FROM public.direct_quotes WHERE indent_id = n_control));
  -- The real schema awards the indent on accept (trg_quote_accepted_set_indent_supplier),
  -- so the open check rejects first there; the stub has no such trigger.
  PERFORM t_err_as('Quote: owner-accepted quote cannot be resurrected', t_id('u_bid1'), t_quote_sql(n_control, t_id('B1'), 9000),
    CASE WHEN public.indent_open_for_marketplace_bids(n_control) THEN 'quote_locked' ELSE 'indent_not_open' END);

  PERFORM t_ok('Quote: existing direct_quotes policies untouched (compatibility step deferred)',
    (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'direct_quotes') = 5);
END $$;

-- ═════════════════════════════════════════════════════════════════════════
-- DCO manifest — complete pool, identity, authorization
-- ═════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  m1 uuid := t_indent(t_id('SHIP1'), 'Chennai', 'Mumbai', '20FT');
  m2 uuid := t_indent(t_id('SHIP2'), '  CHENNAI ', 'mumbai', E'\t20ft');
  m3 uuid := t_indent(t_id('SHIP1'), 'chennai' || chr(160), 'Mumbai', '20FT', 'both');
  x_substring uuid := t_indent(t_id('SHIP1'), 'Chennai Port', 'Mumbai', '20FT');
  x_closed uuid := t_indent(t_id('SHIP1'), 'Chennai', 'Mumbai', '20FT', 'marketplace', 'closed');
  x_draft uuid := t_indent(t_id('SHIP1'), 'Chennai', 'Mumbai', '20FT', 'marketplace', 'draft');
  x_integ uuid := t_indent(t_id('SHIP1'), 'Chennai', 'Mumbai', '20FT', 'integrated_supplier');
  x_deleted uuid := t_indent(t_id('SHIP1'), 'Chennai', 'Mumbai', '20FT');
  x_blank uuid := t_indent(t_id('SHIP1'), 'Chennai', 'Mumbai', '  ');
  r jsonb;
BEGIN
  UPDATE public.indents SET deleted_at = now() WHERE id = x_deleted;

  r := t_dco_pool(t_id('u_dco'), 'chennai', 'MUMBAI', '20ft');
  PERFORM t_ok('DCO: complete pool accepted', (r ->> 'complete')::boolean AND (r ->> 'member_count')::int = 3, r::text);
  PERFORM t_ok('DCO: canonical identity (trim incl. tab/NBSP + case-fold), exact match only',
    t_uuids(r -> 'members', 'id') = t_sort(ARRAY[m1, m2, m3]) AND r ->> 'pool_key' = 'chennai|mumbai|20ft', r::text);
  PERFORM t_ok('DCO: all members biddable with no prior bids', t_uuids(r -> 'biddable_ids') = t_sort(ARRAY[m1, m2, m3]));
  PERFORM t_ok('DCO: fingerprint present when complete', length(r ->> 'fingerprint') = 32);
  PERFORM t_ok('DCO: closed/draft/non-Marketplace/deleted/substring/blank-lane indents cannot enter the pool',
    NOT (t_uuids(r -> 'members', 'id') && ARRAY[x_substring, x_closed, x_draft, x_integ, x_deleted, x_blank]));

  r := t_dco_pool(t_id('u_dco_m'), 'Chennai', 'Mumbai', '20FT');
  PERFORM t_ok('DCO: shipper-member DCO sees only other shippers'' loads (own_indent boundary)',
    t_uuids(r -> 'members', 'id') = ARRAY[m2], r::text);

  PERFORM t_err_as('DCO: unauthenticated rejected', NULL, format('SELECT public.get_dco_marketplace_pool(%L,%L,%L)', 'Chennai', 'Mumbai', '20FT'), 'Not authenticated');
  PERFORM t_err_as('DCO: non-driver rejected', t_id('u_plain'), format('SELECT public.get_dco_marketplace_pool(%L,%L,%L)', 'Chennai', 'Mumbai', '20FT'), 'Only drivers');
  PERFORM t_err_as('DCO: ineligible driver rejected', t_id('u_drv_ne'), format('SELECT public.get_dco_marketplace_pool(%L,%L,%L)', 'Chennai', 'Mumbai', '20FT'), 'marketplace_access_denied');
  PERFORM t_err_as('DCO: blank pool key rejected', t_id('u_dco'), format('SELECT public.get_dco_marketplace_pool(%L,%L,%L)', 'Chennai', ' ', '20FT'), 'invalid_pool_key');
  PERFORM t_err_as('DCO lanes: ineligible driver rejected', t_id('u_drv_ne'), 'SELECT count(*) FROM public.list_dco_marketplace_pool_lanes(50, NULL)', 'marketplace_access_denied');

  -- Ids outside the manifest cannot be written either (S1 is the writer's guard).
  PERFORM t_err_as('DCO: non-member closed id cannot be bid', t_id('u_dco'), t_bid_sql(x_closed, 15000, NULL, t_id('V1')), 'indent_not_open');
  PERFORM t_err_as('DCO: non-member non-Marketplace id cannot be bid', t_id('u_dco'), t_bid_sql(x_integ, 15000, NULL, t_id('V1')), 'not_marketplace_circulated');
  PERFORM t_err_as('DCO: nonexistent id cannot be bid', t_id('u_dco'), t_bid_sql(gen_random_uuid(), 15000, NULL, t_id('V1')), 'indent_not_open');
END $$;

-- 150-member cap
DO $$
DECLARE r jsonb; v_lane jsonb; v_bids_before bigint;
BEGIN
  PERFORM t_indent(t_id('SHIP1'), 'Cap Pickup', 'Cap Drop', 'Cap Truck') FROM generate_series(1, 150);
  r := t_dco_pool(t_id('u_dco'), 'Cap Pickup', 'Cap Drop', 'Cap Truck');
  PERFORM t_ok('DCO cap: exactly 150 members is complete',
    (r ->> 'complete')::boolean AND jsonb_array_length(r -> 'members') = 150
    AND jsonb_array_length(r -> 'biddable_ids') = 150, r ->> 'member_count');

  PERFORM t_indent(t_id('SHIP2'), 'Cap Pickup', 'Cap Drop', 'Cap Truck');
  v_bids_before := (SELECT count(*) FROM public.market_bids);
  r := t_dco_pool(t_id('u_dco'), 'Cap Pickup', 'Cap Drop', 'Cap Truck');
  PERFORM t_ok('DCO cap: 151 members blocked (complete=false, no members, no biddable ids, no fingerprint)',
    NOT (r ->> 'complete')::boolean AND (r ->> 'member_count')::int = 151
    AND jsonb_array_length(r -> 'members') = 0 AND jsonb_array_length(r -> 'biddable_ids') = 0
    AND r -> 'fingerprint' = 'null'::jsonb, r::text);
  PERFORM t_ok('DCO cap: incomplete manifest produced zero writes', (SELECT count(*) FROM public.market_bids) = v_bids_before);

  v_lane := t_find(t_exec_as(t_id('u_dco'), 'SELECT jsonb_agg(to_jsonb(l)) FROM public.list_dco_marketplace_pool_lanes(200, NULL) l'),
                   'pool_key', 'cap pickup|cap drop|cap truck');
  PERFORM t_ok('DCO cap: lane reports too_large with the true count',
    (v_lane ->> 'too_large')::boolean AND (v_lane ->> 'eligible_count')::int = 151, coalesce(v_lane::text, 'lane missing'));
END $$;

-- Fingerprint
DO $$
DECLARE
  a uuid := t_indent(t_id('SHIP1'), 'FP Pickup', 'FP Drop', 'FP Truck');
  b uuid := t_indent(t_id('SHIP2'), 'FP Pickup', 'FP Drop', 'FP Truck');
  c uuid;
  f_prev text;
  f text;
BEGIN
  f_prev := t_dco_pool(t_id('u_dco'), 'FP Pickup', 'FP Drop', 'FP Truck') ->> 'fingerprint';

  UPDATE public.indents SET client_name = 'Someone else', indent_number = 'RENUMBERED',
    updated_at = now() + interval '1 day', pickup_area = ' fp pickup ' WHERE id = a;
  f := t_dco_pool(t_id('u_dco'), 'FP Pickup', 'FP Drop', 'FP Truck') ->> 'fingerprint';
  PERFORM t_ok('Fingerprint: unchanged by updated_at, display-only fields and same-key respelling', f = f_prev);

  UPDATE public.indents SET supplier_target = 21000 WHERE id = a;
  f := t_dco_pool(t_id('u_dco'), 'FP Pickup', 'FP Drop', 'FP Truck') ->> 'fingerprint';
  PERFORM t_ok('Fingerprint: rate offer change detected', f <> f_prev); f_prev := f;

  UPDATE public.indents SET circulation_target = 'both' WHERE id = a;
  f := t_dco_pool(t_id('u_dco'), 'FP Pickup', 'FP Drop', 'FP Truck') ->> 'fingerprint';
  PERFORM t_ok('Fingerprint: circulation change detected', f <> f_prev); f_prev := f;

  UPDATE public.indents SET weight = 9500 WHERE id = a;
  f := t_dco_pool(t_id('u_dco'), 'FP Pickup', 'FP Drop', 'FP Truck') ->> 'fingerprint';
  PERFORM t_ok('Fingerprint: weight change detected', f <> f_prev); f_prev := f;

  UPDATE public.indents SET load_type = 'PTL' WHERE id = a;
  f := t_dco_pool(t_id('u_dco'), 'FP Pickup', 'FP Drop', 'FP Truck') ->> 'fingerprint';
  PERFORM t_ok('Fingerprint: load type change detected', f <> f_prev); f_prev := f;

  UPDATE public.indents SET pickup_date = DATE '2026-10-12' WHERE id = a;
  f := t_dco_pool(t_id('u_dco'), 'FP Pickup', 'FP Drop', 'FP Truck') ->> 'fingerprint';
  PERFORM t_ok('Fingerprint: pickup date change detected', f <> f_prev); f_prev := f;

  -- Shared (broadcast) indents lock commercial edits, so the status flip comes last.
  UPDATE public.indents SET status = 'broadcast' WHERE id = a;
  f := t_dco_pool(t_id('u_dco'), 'FP Pickup', 'FP Drop', 'FP Truck') ->> 'fingerprint';
  PERFORM t_ok('Fingerprint: status change detected', f <> f_prev); f_prev := f;

  PERFORM t_bid(t_id('u_dco'), a, 15000, NULL, t_id('V1'));
  f := t_dco_pool(t_id('u_dco'), 'FP Pickup', 'FP Drop', 'FP Truck') ->> 'fingerprint';
  PERFORM t_ok('Fingerprint: caller''s own bid detected', f <> f_prev); f_prev := f;

  UPDATE public.market_bids SET status = 'rejected' WHERE indent_id = a AND bidder_user_id = t_id('u_dco');
  f := t_dco_pool(t_id('u_dco'), 'FP Pickup', 'FP Drop', 'FP Truck') ->> 'fingerprint';
  PERFORM t_ok('Fingerprint: caller''s bid status change detected', f <> f_prev); f_prev := f;

  PERFORM t_campaign('active', b);
  f := t_dco_pool(t_id('u_dco'), 'FP Pickup', 'FP Drop', 'FP Truck') ->> 'fingerprint';
  PERFORM t_ok('Fingerprint: sponsored classification change detected', f <> f_prev); f_prev := f;

  c := t_indent(t_id('SHIP2'), 'FP Pickup', 'FP Drop', 'FP Truck');
  f := t_dco_pool(t_id('u_dco'), 'FP Pickup', 'FP Drop', 'FP Truck') ->> 'fingerprint';
  PERFORM t_ok('Fingerprint: member added detected', f <> f_prev); f_prev := f;

  UPDATE public.indents SET status = 'closed' WHERE id = c;
  f := t_dco_pool(t_id('u_dco'), 'FP Pickup', 'FP Drop', 'FP Truck') ->> 'fingerprint';
  PERFORM t_ok('Fingerprint: member closed detected', f <> f_prev); f_prev := f;

  f_prev := t_dco_pool(t_id('u_dco'), 'FP Pickup', 'FP Drop', 'FP Truck') ->> 'fingerprint';
  PERFORM t_bid(t_id('u_bid1'), a, 15500, t_id('B1'), NULL);
  f := t_dco_pool(t_id('u_dco'), 'FP Pickup', 'FP Drop', 'FP Truck') ->> 'fingerprint';
  PERFORM t_ok('Fingerprint: another bidder''s bid does not change a DCO fingerprint', f = f_prev);
END $$;

-- ═════════════════════════════════════════════════════════════════════════
-- My Bids completeness — DCO (50-row boundary) and organization (D5)
-- ═════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  t1 uuid := t_indent(t_id('SHIP1'), 'MB Pickup', 'MB Drop', 'MB Truck');
  t2 uuid := t_indent(t_id('SHIP1'), 'MB Pickup', 'MB Drop', 'MB Truck');
  t3 uuid := t_indent(t_id('SHIP2'), 'MB Pickup', 'MB Drop', 'MB Truck');
  r jsonb;
BEGIN
  INSERT INTO public.market_bids (indent_id, bidder_type, bidder_user_id, owner_vehicle_id, amount, status, created_at, updated_at)
  VALUES (t1, 'dco', t_id('u_dco'), t_id('V1'), 10000, 'rejected', now() - interval '30 days', now() - interval '30 days'),
         (t2, 'dco', t_id('u_dco'), t_id('V1'), 10000, 'pending',  now() - interval '30 days', now() - interval '30 days');
  INSERT INTO public.market_bids (indent_id, bidder_type, bidder_user_id, owner_vehicle_id, amount, status)
  SELECT t_indent(t_id('SHIP1'), 'Noise ' || g, 'Noise Drop', 'Noise Truck'), 'dco', t_id('u_dco'), t_id('V1'), 9000, 'pending'
  FROM generate_series(1, 60) g;

  PERFORM t_ok('My Bids: precondition — the newest-50 feed hides both pool bids',
    NOT EXISTS (SELECT 1 FROM (
      SELECT indent_id FROM public.market_bids WHERE bidder_user_id = t_id('u_dco') ORDER BY created_at DESC LIMIT 50
    ) x WHERE x.indent_id IN (t1, t2)));

  r := t_dco_pool(t_id('u_dco'), 'MB Pickup', 'MB Drop', 'MB Truck');
  PERFORM t_ok('My Bids: 50-row boundary cannot hide an existing bid',
    t_find(r -> 'my_bids', 'indent_id', t1::text) ->> 'status' = 'rejected'
    AND t_find(r -> 'my_bids', 'indent_id', t2::text) ->> 'status' = 'pending', r::text);
  PERFORM t_ok('My Bids: decided member excluded from biddable ids; pending and unbid remain',
    t_uuids(r -> 'biddable_ids') = t_sort(ARRAY[t2, t3]), r::text);
  PERFORM t_err_as('My Bids: decided bid is never overwritten', t_id('u_dco'), t_bid_sql(t1, 9999, NULL, t_id('V1')), 'bid_locked');
END $$;

DO $$
DECLARE
  x1 uuid := t_indent(t_id('SHIP1'), 'OB Pickup', 'OB Drop', 'OB Truck');
  x2 uuid := t_indent(t_id('SHIP1'), 'OB Pickup', 'OB Drop', 'OB Truck');
  x3 uuid := t_indent(t_id('SHIP2'), 'OB Pickup', 'OB Drop', 'OB Truck');
  x4 uuid := t_indent(t_id('SHIP2'), 'OB Pickup', 'OB Drop', 'OB Truck');
  x5 uuid := t_indent(t_id('SHIP1'), 'OB Pickup', 'OB Drop', 'OB Truck');
  x_own uuid := t_indent(t_id('B1'), 'OB Pickup', 'OB Drop', 'OB Truck');
  u1 uuid := t_id('u_bid1');
  u2 uuid := t_id('u_bid2');
  b1 uuid := t_id('B1');
  r jsonb;
  e jsonb;
BEGIN
  INSERT INTO public.market_bids (indent_id, bidder_type, bidder_user_id, bidder_organization_id, amount, status, fee_payment_status) VALUES
    (x1, 'organization', u2, b1, 100, 'pending',    'not_required'),
    (x2, 'organization', u2, b1, 100, 'accepted',   'pending'),
    (x2, 'organization', u1, b1, 100, 'rejected',   'not_required'),
    (x3, 'organization', u1, b1, 100, 'pending',    'not_required'),
    (x3, 'organization', u2, b1, 100, 'pending',    'not_required'),
    (x4, 'organization', u2, b1, 100, 'rejected',   'not_required'),
    (x4, 'organization', t_id('u_other'), t_id('B2'), 100, 'pending', 'not_required'),
    (x5, 'organization', u2, b1, 100, 'withdrawn',  'not_required'),
    (x5, 'organization', u1, b1, 100, 'superseded', 'not_required');

  r := t_org_pool(u1, b1, 'OB Pickup', 'OB Drop', 'OB Truck');
  PERFORM t_ok('Org pool: own-organization load excluded, complete',
    (r ->> 'complete')::boolean AND t_uuids(r -> 'members', 'id') = t_sort(ARRAY[x1, x2, x3, x4, x5]), r::text);
  PERFORM t_ok('Org pool: colleague pending/accepted bid blocks duplicate submission',
    t_uuids(r -> 'organization_blocked', 'indent_id') = t_sort(ARRAY[x1, x2, x3])
    AND t_find(r -> 'organization_blocked', 'indent_id', x1::text) ->> 'message' = 'already bid by your organization', r::text);
  PERFORM t_ok('Org pool: only unblocked, undecided members are biddable', t_uuids(r -> 'biddable_ids') = ARRAY[x4], r::text);

  e := t_find(r -> 'org_bids', 'indent_id', x1::text);
  PERFORM t_ok('Precedence: colleague pending shows as organization pending', e ->> 'status' = 'pending' AND NOT (e ->> 'is_mine')::boolean, e::text);
  e := t_find(r -> 'org_bids', 'indent_id', x2::text);
  PERFORM t_ok('Precedence: accepted beats the caller''s rejected bid',
    e ->> 'status' = 'accepted' AND e ->> 'my_status' = 'rejected' AND e ->> 'fee_payment_status' = 'pending', e::text);
  e := t_find(r -> 'org_bids', 'indent_id', x3::text);
  PERFORM t_ok('Precedence: caller-owned bid wins a tie', e ->> 'status' = 'pending' AND (e ->> 'is_mine')::boolean, e::text);
  e := t_find(r -> 'org_bids', 'indent_id', x4::text);
  PERFORM t_ok('Precedence: another organization''s bid is not counted', e ->> 'status' = 'rejected', e::text);
  e := t_find(r -> 'org_bids', 'indent_id', x5::text);
  PERFORM t_ok('Precedence: superseded beats withdrawn', e ->> 'status' = 'superseded' AND (e ->> 'is_mine')::boolean, e::text);

  r := t_org_pool(u2, b1, 'OB Pickup', 'OB Drop', 'OB Truck');
  PERFORM t_ok('Org pool: colleague view — own pending stays biddable, own decided and colleague pending do not',
    t_uuids(r -> 'biddable_ids') = ARRAY[x1] AND t_uuids(r -> 'organization_blocked', 'indent_id') = t_sort(ARRAY[x3]), r::text);

  PERFORM t_err_as('Org pool: non-member rejected', t_id('u_other'),
    format('SELECT public.get_org_marketplace_pool(%L,%L,%L,%L)', b1, 'OB Pickup', 'OB Drop', 'OB Truck'), 'Not a member of this organization');
  PERFORM t_err_as('Org lanes: non-member rejected', t_id('u_other'),
    format('SELECT count(*) FROM public.list_marketplace_pool_lanes_for_org(%L, 50, NULL)', b1), 'Not a member of this organization');
END $$;

-- ═════════════════════════════════════════════════════════════════════════
-- D1 sponsored consistency
-- ═════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  s1 uuid := t_indent(t_id('SHIP1'), 'SP Pickup', 'SP Drop', 'SP Truck');
  s2 uuid := t_indent(t_id('SHIP1'), 'SP Pickup', 'SP Drop', 'SP Truck');
  s3 uuid := t_indent(t_id('SHIP2'), 'SP Pickup', 'SP Drop', 'SP Truck');
  s4 uuid := t_indent(t_id('SHIP2'), 'SP Pickup', 'SP Drop', 'SP Truck');
  s5 uuid := t_indent(t_id('SHIP1'), 'SP Pickup', 'SP Drop', 'SP Truck');
  c1 uuid;
  c2 uuid;
  p2 uuid;
  r jsonb;
  o jsonb;
  lane jsonb;
BEGIN
  PERFORM t_bid(t_id('u_bid1'), s1, 15000, t_id('B1'), NULL);

  c1 := t_campaign('active', s1);
  p2 := t_post(s2);
  c2 := t_campaign('active', NULL, p2, now() + interval '1 day');
  PERFORM t_campaign('active', s3, NULL, now() - interval '1 hour');
  PERFORM t_campaign('active', s4, NULL, NULL, now());
  PERFORM t_campaign('completed', s5);

  r := t_dco_pool(t_id('u_dco'), 'SP Pickup', 'SP Drop', 'SP Truck');
  PERFORM t_ok('Sponsored: active campaign (snapshot link) excludes indent from the DCO pool (DCOs are never Reach targets)', NOT (s1 = ANY (t_uuids(r -> 'members', 'id'))), r::text);
  PERFORM t_ok('Sponsored: active campaign (post source_indent_id link) excludes indent from pool', NOT (s2 = ANY (t_uuids(r -> 'members', 'id'))));
  PERFORM t_ok('Sponsored: expired / archived / completed campaigns do not exclude',
    t_uuids(r -> 'members', 'id') = t_sort(ARRAY[s3, s4, s5])
    AND (r ->> 'member_count')::int = 3 AND (r ->> 'excluded_sponsored_count')::int = 2, r::text);
  o := t_org_pool(t_id('u_bid1'), t_id('B1'), 'SP Pickup', 'SP Drop', 'SP Truck');
  PERFORM t_ok('Sponsored: organization pool applies the same exclusion',
    t_uuids(o -> 'members', 'id') = t_sort(ARRAY[s3, s4, s5]) AND (o ->> 'excluded_sponsored_count')::int = 2, o::text);
  PERFORM t_ok('Sponsored: sponsored indent is never biddable through the pool', NOT (s1 = ANY (t_uuids(o -> 'biddable_ids'))));

  lane := t_find(t_exec_as(t_id('u_dco'), 'SELECT jsonb_agg(to_jsonb(l)) FROM public.list_dco_marketplace_pool_lanes(200, NULL) l'),
                 'pool_key', 'sp pickup|sp drop|sp truck');
  PERFORM t_ok('Sponsored: DCO lane count matches eligible pool membership',
    (lane ->> 'eligible_count')::int = (r ->> 'member_count')::int AND (lane ->> 'sponsored_count')::int = 2, coalesce(lane::text, 'lane missing'));
  lane := t_find(t_exec_as(t_id('u_bid1'), format('SELECT jsonb_agg(to_jsonb(l)) FROM public.list_marketplace_pool_lanes_for_org(%L, 200, NULL) l', t_id('B1'))),
                 'pool_key', 'sp pickup|sp drop|sp truck');
  PERFORM t_ok('Sponsored: organization lane count matches eligible pool membership',
    (lane ->> 'eligible_count')::int = (o ->> 'member_count')::int, coalesce(lane::text, 'lane missing'));

  PERFORM t_ok('Sponsored: existing individual bid on the sponsored indent remains valid',
    (SELECT status = 'pending' FROM public.market_bids WHERE indent_id = s1 AND bidder_user_id = t_id('u_bid1')));
  r := t_bid(t_id('u_bid1'), s1, 15200, t_id('B1'), NULL);
  PERFORM t_ok('Sponsored: sponsored indent still takes an individual bid', r ->> 'bid_id' IS NOT NULL);

  UPDATE public.reach_campaigns SET archived_at = now() WHERE id = c1;
  r := t_dco_pool(t_id('u_dco'), 'SP Pickup', 'SP Drop', 'SP Truck');
  PERFORM t_ok('Sponsored: archived campaign lets the indent re-enter the pool', s1 = ANY (t_uuids(r -> 'members', 'id')), r::text);
  o := t_org_pool(t_id('u_bid1'), t_id('B1'), 'SP Pickup', 'SP Drop', 'SP Truck');
  PERFORM t_ok('Sponsored: re-entered member carries its earlier individual bid',
    t_find(o -> 'org_bids', 'indent_id', s1::text) ->> 'my_status' = 'pending', o::text);

  UPDATE public.reach_campaigns SET expires_at = now() - interval '1 second' WHERE id = c2;
  r := t_dco_pool(t_id('u_dco'), 'SP Pickup', 'SP Drop', 'SP Truck');
  PERFORM t_ok('Sponsored: expired campaign lets the indent re-enter the pool',
    s2 = ANY (t_uuids(r -> 'members', 'id')) AND (r ->> 'member_count')::int = 5, r::text);
END $$;

-- Every lane count equals its manifest, across keyset pages.
DO $$
DECLARE
  v_after text := NULL;
  v_page jsonb;
  v_lane jsonb;
  v_keys text[] := '{}';
  r jsonb;
  v_expected bigint;
BEGIN
  LOOP
    v_page := t_exec_as(t_id('u_dco'),
      format('SELECT jsonb_agg(to_jsonb(l)) FROM public.list_dco_marketplace_pool_lanes(3, %L) l', v_after));
    EXIT WHEN v_page IS NULL;
    FOR v_lane IN SELECT * FROM jsonb_array_elements(v_page) LOOP
      IF v_after IS NOT NULL AND (v_lane ->> 'pool_key') COLLATE "C" <= v_after COLLATE "C" THEN
        RAISE EXCEPTION 'FAIL Lanes keyset: % not after %', v_lane ->> 'pool_key', v_after;
      END IF;
      v_keys := v_keys || (v_lane ->> 'pool_key');
      v_after := v_lane ->> 'pool_key';
      r := t_dco_pool(t_id('u_dco'), v_lane ->> 'pickup_area', v_lane ->> 'drop_location', v_lane ->> 'vehicle_type');
      IF (r ->> 'member_count')::int <> (v_lane ->> 'eligible_count')::int
         OR (r ->> 'excluded_sponsored_count')::int <> (v_lane ->> 'sponsored_count')::int
         OR r ->> 'pool_key' <> v_lane ->> 'pool_key' THEN
        RAISE EXCEPTION 'FAIL Lane/manifest mismatch: lane % manifest %', v_lane, r - 'members' - 'biddable_ids' - 'my_bids';
      END IF;
    END LOOP;
  END LOOP;

  SELECT count(*) INTO v_expected FROM (
    SELECT r2.pool_key FROM public._marketplace_pool_rows(NULL) r2
    WHERE NOT r2.sponsored
    GROUP BY r2.pool_key
  ) k;
  PERFORM t_ok(format('Lanes: keyset pages cover all %s lanes exactly once, each count equal to its manifest', v_expected),
    cardinality(v_keys) = v_expected AND cardinality(v_keys) = (SELECT count(DISTINCT k) FROM unnest(v_keys) k),
    format('%s lanes read, %s expected', cardinality(v_keys), v_expected));
END $$;

-- Network classifier
DO $$
DECLARE
  n1 uuid := t_indent(t_id('SHIP1'), 'CL Pickup', 'CL Drop', 'CL Truck', 'both');
  n2 uuid := t_indent(t_id('SHIP1'), 'CL Pickup', 'CL Drop', 'CL Truck', 'integrated_supplier');
  n3 uuid := t_indent(t_id('SHIP2'), 'CL Pickup', 'CL Drop', 'CL Truck', 'both');
  n4 uuid := t_indent(t_id('SHIP2'), 'CL Pickup', 'CL Drop', 'CL Truck', 'both');
  c4 uuid;
  r jsonb;
BEGIN
  PERFORM t_campaign('active', n1);
  PERFORM t_campaign('active', n3);
  c4 := t_campaign('active', n4);
  PERFORM t_target(c4, t_id('B1'));

  r := t_exec_as(t_id('u_bid1'), format(
    'SELECT jsonb_agg(to_jsonb(c)) FROM public.classify_indents_for_pooling(%L, %L::uuid[]) c',
    t_id('B1'), ARRAY[n1, n2, n3, n4, gen_random_uuid()]));
  PERFORM t_ok('Classifier: invisible and nonexistent ids are dropped (no oracle)',
    t_uuids(r, 'indent_id') = t_sort(ARRAY[n1, n2, n4]), coalesce(r::text, 'null'));
  PERFORM t_ok('Classifier: sponsored flags follow D1',
    (t_find(r, 'indent_id', n1::text) ->> 'sponsored_reach')::boolean
    AND NOT (t_find(r, 'indent_id', n2::text) ->> 'sponsored_reach')::boolean
    AND (t_find(r, 'indent_id', n4::text) ->> 'sponsored_reach')::boolean, r::text);
  PERFORM t_err_as('Classifier: non-member rejected', t_id('u_other'),
    format('SELECT count(*) FROM public.classify_indents_for_pooling(%L, %L::uuid[])', t_id('B1'), ARRAY[n1]), 'Not a member of this organization');
  PERFORM t_err_as('Classifier: more than 500 ids rejected', t_id('u_bid1'),
    format('SELECT count(*) FROM public.classify_indents_for_pooling(%L, (SELECT array_agg(gen_random_uuid()) FROM generate_series(1, 501)))', t_id('B1')),
    'too_many_ids');
END $$;

-- ═════════════════════════════════════════════════════════════════════════
-- Grants
-- ═════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  PERFORM t_err_as('Grants: sponsored predicate is not callable by clients (no oracle)', t_id('u_bid1'),
    'SELECT public._indent_is_sponsored_reach(gen_random_uuid())', 'permission denied');
  PERFORM t_err_as('Grants: pool row source is not callable by clients', t_id('u_bid1'),
    'SELECT count(*) FROM public._marketplace_pool_rows(NULL)', 'permission denied');
  PERFORM t_err_as('Grants: anon cannot read a DCO pool', NULL,
    format('SELECT public.get_dco_marketplace_pool(%L,%L,%L)', 'a', 'b', 'c'), 'permission denied', 'anon');
  PERFORM t_err_as('Grants: anon cannot submit a Network quote', NULL,
    t_quote_sql(gen_random_uuid(), t_id('B1'), 1), 'permission denied', 'anon');
  PERFORM t_err_as('Grants: anon cannot classify', NULL,
    format('SELECT count(*) FROM public.classify_indents_for_pooling(%L, %L::uuid[])', t_id('B1'), '{}'), 'permission denied', 'anon');
  PERFORM t_ok('Grants: submit_market_bid grants preserved by CREATE OR REPLACE',
    has_function_privilege('authenticated', 'public.submit_market_bid(uuid, numeric, text, uuid, uuid)', 'EXECUTE')
    AND has_function_privilege('anon', 'public.submit_market_bid(uuid, numeric, text, uuid, uuid)', 'EXECUTE') = t_cfg('smb_anon_execute'));
END $$;
