-- Network pool suite (get_org_network_pool, list_network_pool_lanes_for_org).
-- Runs after pooled_marketplace/05_helpers.sql and 06_fixtures_real.sql.
-- Visibility from fixtures: SHIP1 -> B1. Added here: SHIP1 -> B2, SHIP2 -> B2.

CREATE TABLE t_np (name text PRIMARY KEY, id uuid NOT NULL);
GRANT SELECT ON t_np TO PUBLIC;
CREATE FUNCTION t_np(p text) RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT id FROM t_np WHERE name = p $$;
CREATE FUNCTION t_np_put(p text, p_id uuid) RETURNS uuid LANGUAGE sql AS $$ INSERT INTO t_np VALUES (p, p_id) RETURNING id $$;

CREATE FUNCTION t_net_pool(p_uid uuid, p_org uuid, p_pickup text, p_drop text, p_vehicle text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT t_exec_as(p_uid, format('SELECT public.get_org_network_pool(%L, %L, %L, %L)', p_org, p_pickup, p_drop, p_vehicle))
$$;
CREATE FUNCTION t_net_lanes(p_uid uuid, p_org uuid, p_limit int DEFAULT 200, p_after text DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
  SELECT t_exec_as(p_uid, format(
    'SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY l.pool_key COLLATE "C"), ''[]''::jsonb) FROM public.list_network_pool_lanes_for_org(%L, %s, %L) l',
    p_org, p_limit, p_after))
$$;
CREATE FUNCTION t_ids_of(VARIADIC p text[]) RETURNS uuid[] LANGUAGE sql STABLE AS $$
  SELECT t_sort(array_agg(t_np(x))) FROM unnest(p) x
$$;

INSERT INTO public.organization_relations (from_organization_id, to_organization_id, relation_type, status) VALUES
  (t_id('SHIP1'), t_id('B2'), 'client_supplier', 'active'),
  (t_id('SHIP2'), t_id('B2'), 'client_supplier', 'active');

-- ── Lane A: channels, caller scope, Marketplace independence ─────────────
SELECT t_np_put('a_net1',  t_indent(t_id('SHIP1'), 'NP Alpha', 'NP Beta', '20FT', 'integrated_supplier'));
SELECT t_np_put('a_both1', t_indent(t_id('SHIP1'), 'NP Alpha', 'NP Beta', '20FT', 'both'));
SELECT t_np_put('a_mkt1',  t_indent(t_id('SHIP1'), 'NP Alpha', 'NP Beta', '20FT', 'marketplace'));
SELECT t_np_put('a_netv',  t_indent(t_id('SHIP1'), 'NP Alpha', 'NP Beta', '20FT', 'network'));
SELECT t_np_put('a_cxl',   t_indent(t_id('SHIP1'), 'NP Alpha', 'NP Beta', '20FT', 'integrated_supplier', 'cancelled'));
SELECT t_np_put('a_net2',  t_indent(t_id('SHIP2'), 'NP Alpha', 'NP Beta', '20FT', 'integrated_supplier'));
SELECT t_np_put('a_both2', t_indent(t_id('SHIP2'), 'NP Alpha', 'NP Beta', '20FT', 'both'));

DO $$
DECLARE
  b1 jsonb := t_net_pool(t_id('u_bid1'), t_id('B1'), 'NP Alpha', 'NP Beta', '20FT');
  b2 jsonb := t_net_pool(t_id('u_other'), t_id('B2'), 'NP Alpha', 'NP Beta', '20FT');
  mk jsonb := t_org_pool(t_id('u_bid1'), t_id('B1'), 'NP Alpha', 'NP Beta', '20FT');
  lanes jsonb := t_net_lanes(t_id('u_bid1'), t_id('B1'));
  lane jsonb := t_find(lanes, 'pool_key', 'np alpha|np beta|20ft');
BEGIN
  PERFORM t_ok('Network: integrated_supplier (Network-only) load is a member',
    t_np('a_net1') = ANY (t_uuids(b1 -> 'members', 'id')), b1::text);
  PERFORM t_ok('Network: both load is a Network member',
    t_np('a_both1') = ANY (t_uuids(b1 -> 'members', 'id')), b1::text);
  PERFORM t_ok('Network: Marketplace-only load is not a Network member',
    NOT t_np('a_mkt1') = ANY (t_uuids(b1 -> 'members', 'id')), b1::text);
  PERFORM t_ok('Network: circulation "network" is not Network-visible (market_indents_for_org via_link semantics kept)',
    NOT t_np('a_netv') = ANY (t_uuids(b1 -> 'members', 'id')), b1::text);
  PERFORM t_ok('Network: cancelled load is not a member',
    NOT t_np('a_cxl') = ANY (t_uuids(b1 -> 'members', 'id')), b1::text);
  PERFORM t_ok('Network: B1 sees exactly its visible open Network loads',
    t_uuids(b1 -> 'members', 'id') = t_ids_of('a_net1', 'a_both1')
      AND (b1 ->> 'member_count')::int = 2 AND (b1 ->> 'shipper_count')::int = 1
      AND (b1 ->> 'complete')::boolean AND t_uuids(b1 -> 'quotable_ids') = t_ids_of('a_net1', 'a_both1'),
    b1::text);
  PERFORM t_ok('Network: B2 (different visibility) gets a different membership for the same lane',
    t_uuids(b2 -> 'members', 'id') = t_ids_of('a_net1', 'a_both1', 'a_net2', 'a_both2')
      AND (b2 ->> 'member_count')::int = 4 AND (b2 ->> 'shipper_count')::int = 2,
    b2::text);
  PERFORM t_ok('Network: same lane, different viewing org -> different fingerprint and member count',
    b1 ->> 'pool_key' = b2 ->> 'pool_key' AND b1 ->> 'fingerprint' <> b2 ->> 'fingerprint'
      AND b1 ->> 'member_count' <> b2 ->> 'member_count', '');
  PERFORM t_ok('Network: manifest names its viewing organization',
    (b1 ->> 'viewing_organization_id')::uuid = t_id('B1'), b1::text);
  PERFORM t_ok('Network: both load is independently a Marketplace member; Network-only load is not',
    t_np('a_both1') = ANY (t_uuids(mk -> 'members', 'id'))
      AND t_np('a_mkt1') = ANY (t_uuids(mk -> 'members', 'id'))
      AND NOT t_np('a_net1') = ANY (t_uuids(mk -> 'members', 'id')),
    mk::text);
  PERFORM t_ok('Network: lane listing matches the manifest for the caller',
    lane IS NOT NULL AND (lane ->> 'eligible_count')::int = 2 AND (lane ->> 'shipper_count')::int = 1
      AND (lane ->> 'sponsored_count')::int = 0 AND NOT (lane ->> 'too_large')::boolean,
    coalesce(lane::text, lanes::text));
END $$;

-- Visible through via_link but not open for quotes (market_indents_for_org keeps them).
SELECT t_np_put('c_exp',   t_indent(t_id('SHIP1'), 'NP Closed', 'NP Lane', '20FT', 'integrated_supplier', 'expired'));
SELECT t_np_put('c_closed', t_indent(t_id('SHIP1'), 'NP Closed', 'NP Lane', '20FT', 'integrated_supplier', 'closed'));
SELECT t_np_put('c_open',  t_indent(t_id('SHIP1'), 'NP Closed', 'NP Lane', '20FT', 'integrated_supplier'));
DO $$
DECLARE
  v_up uuid[] := t_uuids(t_exec_as(t_id('u_bid1'), format(
    'SELECT coalesce(jsonb_agg(m.id), ''[]''::jsonb) FROM public.market_indents_for_org(%L) m', t_id('B1'))));
  p jsonb := t_net_pool(t_id('u_bid1'), t_id('B1'), 'NP Closed', 'NP Lane', '20FT');
BEGIN
  PERFORM t_ok('Network: expired and closed loads returned by market_indents_for_org are not members',
    t_np('c_exp') = ANY (v_up) AND t_np('c_closed') = ANY (v_up)
      AND t_uuids(p -> 'members', 'id') = t_ids_of('c_open'), p::text);
END $$;

-- Same members and same (empty) quote state for two orgs: fingerprint still differs.
SELECT t_np_put('same1', t_indent(t_id('SHIP1'), 'NP Same', 'NP Lane', '20FT', 'integrated_supplier'));
DO $$
DECLARE
  b1 jsonb := t_net_pool(t_id('u_bid1'), t_id('B1'), 'NP Same', 'NP Lane', '20FT');
  b2 jsonb := t_net_pool(t_id('u_other'), t_id('B2'), 'NP Same', 'NP Lane', '20FT');
BEGIN
  PERFORM t_ok('Network: identical members and quote state still give org-scoped fingerprints',
    b1 -> 'members' = b2 -> 'members' AND b1 -> 'org_quotes' = '[]'::jsonb AND b2 -> 'org_quotes' = '[]'::jsonb
      AND b1 ->> 'fingerprint' <> b2 ->> 'fingerprint', '');
END $$;

-- A Marketplace-only load stays visible through via_reach after its campaign
-- ends because the org quoted it; it is still not a Network member.
SELECT t_np_put('r_mkt', t_indent(t_id('SHIP2'), 'NP Reach', 'NP Lane', '20FT', 'marketplace'));
SELECT t_np_put('r_net', t_indent(t_id('SHIP2'), 'NP Reach', 'NP Lane', '20FT', 'integrated_supplier'));
SELECT t_np_put('r_camp_m', t_campaign('active', t_np('r_mkt')));
SELECT t_np_put('r_camp_n', t_campaign('active', t_np('r_net')));
SELECT t_target(t_np('r_camp_m'), t_id('B1'));
SELECT t_target(t_np('r_camp_n'), t_id('B1'));
SELECT t_exec_as(t_id('u_bid1'), t_quote_sql(t_np('r_mkt'), t_id('B1'), 15000));
SELECT t_exec_as(t_id('u_bid1'), t_quote_sql(t_np('r_net'), t_id('B1'), 15000));
UPDATE public.reach_campaigns SET expires_at = now() - interval '1 minute'
WHERE id IN (t_np('r_camp_m'), t_np('r_camp_n'));
DO $$
DECLARE
  v_up uuid[] := t_uuids(t_exec_as(t_id('u_bid1'), format(
    'SELECT coalesce(jsonb_agg(m.id), ''[]''::jsonb) FROM public.market_indents_for_org(%L) m', t_id('B1'))));
  p jsonb := t_net_pool(t_id('u_bid1'), t_id('B1'), 'NP Reach', 'NP Lane', '20FT');
BEGIN
  PERFORM t_ok('Network: Marketplace-only load visible via Reach is not a member; Network-circulated one is',
    t_np('r_mkt') = ANY (v_up) AND t_np('r_net') = ANY (v_up)
      AND t_uuids(p -> 'members', 'id') = t_ids_of('r_net') AND (p ->> 'excluded_sponsored_count')::int = 0,
    p::text);
END $$;

-- ── Lane H: invisible members must not leak ──────────────────────────────
SELECT t_np_put('h1', t_indent(t_id('SHIP2'), 'NP Hidden', 'NP Lane', '14FT', 'integrated_supplier'));

DO $$
DECLARE
  hid jsonb := t_net_pool(t_id('u_bid1'), t_id('B1'), 'NP Hidden', 'NP Lane', '14FT');
  none jsonb := t_net_pool(t_id('u_bid1'), t_id('B1'), 'NP Nowhere', 'NP Lane', '14FT');
  b2 jsonb := t_net_pool(t_id('u_other'), t_id('B2'), 'NP Hidden', 'NP Lane', '14FT');
  lanes jsonb := t_net_lanes(t_id('u_bid1'), t_id('B1'));
BEGIN
  PERFORM t_ok('Network: lane with only invisible loads looks exactly like a nonexistent lane',
    (hid - 'pool_key' - 'as_of') = (none - 'pool_key' - 'as_of')
      AND (hid ->> 'member_count')::int = 0 AND hid -> 'members' = '[]'::jsonb
      AND hid -> 'quotable_ids' = '[]'::jsonb AND (hid ->> 'excluded_sponsored_count')::int = 0,
    hid::text || ' vs ' || none::text);
  PERFORM t_ok('Network: invisible lane is absent from the caller''s lane listing',
    t_find(lanes, 'pool_key', 'np hidden|np lane|14ft') IS NULL, lanes::text);
  PERFORM t_ok('Network: the org that can see it gets the member',
    t_uuids(b2 -> 'members', 'id') = t_ids_of('h1'), b2::text);
END $$;
SELECT t_err_as('Network parity: invisible load is refused by submit_network_quote', t_id('u_bid1'),
  t_quote_sql(t_np('h1'), t_id('B1'), 18000), 'indent_not_visible');
SELECT t_err_as('Network auth: member of another org cannot read B1 pools', t_id('u_other'),
  format('SELECT public.get_org_network_pool(%L, %L, %L, %L)', t_id('B1'), 'NP Alpha', 'NP Beta', '20FT'),
  'Not a member of this organization');
SELECT t_err_as('Network auth: non-member cannot list B1 lanes', t_id('u_plain'),
  format('SELECT count(*) FROM public.list_network_pool_lanes_for_org(%L)', t_id('B1')),
  'Not a member of this organization');
SELECT t_err_as('Network auth: anon cannot execute the manifest', NULL,
  format('SELECT public.get_org_network_pool(%L, %L, %L, %L)', t_id('B1'), 'NP Alpha', 'NP Beta', '20FT'),
  'permission denied', 'anon');
SELECT t_err_as('Network auth: anon cannot execute the lane listing', NULL,
  format('SELECT count(*) FROM public.list_network_pool_lanes_for_org(%L)', t_id('B1')),
  'permission denied', 'anon');
SELECT t_err_as('Network auth: internal row source is not callable by clients', t_id('u_bid1'),
  format('SELECT count(*) FROM public._network_pool_rows(%L, NULL)', t_id('B1')),
  'permission denied');
SELECT t_err_as('Network: blank vehicle is an invalid pool key', t_id('u_bid1'),
  format('SELECT public.get_org_network_pool(%L, %L, %L, %L)', t_id('B1'), 'NP Alpha', 'NP Beta', '  '),
  'invalid_pool_key');

-- ── Own-organization exclusion ───────────────────────────────────────────
SELECT t_np_put('own1', t_indent(t_id('B1'), 'NP Alpha', 'NP Beta', '20FT', 'integrated_supplier'));
DO $$
DECLARE
  v_self boolean := true;
  v_upstream boolean;
  b1 jsonb;
BEGIN
  -- A self link makes market_indents_for_org return B1's own loads to B1.
  BEGIN
    INSERT INTO public.organization_relations (from_organization_id, to_organization_id, relation_type, status)
    VALUES (t_id('B1'), t_id('B1'), 'client_supplier', 'active');
  EXCEPTION WHEN OTHERS THEN v_self := false;
  END;
  v_upstream := t_np('own1') = ANY (t_uuids(t_exec_as(t_id('u_bid1'), format(
    'SELECT coalesce(jsonb_agg(m.id), ''[]''::jsonb) FROM public.market_indents_for_org(%L) m', t_id('B1')))));
  b1 := t_net_pool(t_id('u_bid1'), t_id('B1'), 'NP Alpha', 'NP Beta', '20FT');
  PERFORM t_ok(format('Network: own load is never a member (self link possible=%s, own row returned upstream=%s)', v_self, v_upstream),
    NOT t_np('own1') = ANY (t_uuids(b1 -> 'members', 'id')) AND (b1 ->> 'member_count')::int = 2, b1::text);
  DELETE FROM public.organization_relations
  WHERE from_organization_id = t_id('B1') AND to_organization_id = t_id('B1');
END $$;

-- ── Sponsored Reach exclusion ────────────────────────────────────────────
SELECT t_np_put('s_live',  t_indent(t_id('SHIP1'), 'NP Spons', 'NP Dest', '20FT', 'integrated_supplier'));
SELECT t_np_put('s_post',  t_indent(t_id('SHIP1'), 'NP Spons', 'NP Dest', '20FT', 'integrated_supplier'));
SELECT t_np_put('s_plain', t_indent(t_id('SHIP1'), 'NP Spons', 'NP Dest', '20FT', 'integrated_supplier'));
SELECT t_np_put('s_exp',   t_indent(t_id('SHIP1'), 'NP Spons', 'NP Dest', '20FT', 'integrated_supplier'));
SELECT t_np_put('s_arch',  t_indent(t_id('SHIP1'), 'NP Spons', 'NP Dest', '20FT', 'integrated_supplier'));
SELECT t_np_put('s_only',  t_indent(t_id('SHIP1'), 'NP OnlySp', 'NP Dest', '20FT', 'integrated_supplier'));
SELECT t_campaign('active', t_np('s_live'));
SELECT t_campaign('active', NULL, t_post(t_np('s_post')));
SELECT t_campaign('active', t_np('s_exp'), NULL, now() - interval '1 hour');
SELECT t_campaign('active', t_np('s_arch'), NULL, NULL, now() - interval '1 hour');
SELECT t_campaign('active', t_np('s_only'));

DO $$
DECLARE
  p jsonb := t_net_pool(t_id('u_bid1'), t_id('B1'), 'NP Spons', 'NP Dest', '20FT');
  sp_only jsonb := t_net_pool(t_id('u_bid1'), t_id('B1'), 'NP OnlySp', 'NP Dest', '20FT');
  lanes jsonb := t_net_lanes(t_id('u_bid1'), t_id('B1'));
  lane jsonb := t_find(lanes, 'pool_key', 'np spons|np dest|20ft');
BEGIN
  PERFORM t_ok('Network: live sponsored loads (snapshot and post link) are excluded and counted',
    t_uuids(p -> 'members', 'id') = t_ids_of('s_plain', 's_exp', 's_arch')
      AND (p ->> 'excluded_sponsored_count')::int = 2
      AND t_uuids(p -> 'quotable_ids') = t_ids_of('s_plain', 's_exp', 's_arch'),
    p::text);
  PERFORM t_ok('Network: expired and archived campaigns do not exclude',
    t_np('s_exp') = ANY (t_uuids(p -> 'members', 'id')) AND t_np('s_arch') = ANY (t_uuids(p -> 'members', 'id')), p::text);
  PERFORM t_ok('Network: lane counts split eligible and sponsored',
    (lane ->> 'eligible_count')::int = 3 AND (lane ->> 'sponsored_count')::int = 2, coalesce(lane::text, lanes::text));
  PERFORM t_ok('Network: lane holding only sponsored loads is not listed; its manifest is empty',
    t_find(lanes, 'pool_key', 'np onlysp|np dest|20ft') IS NULL
      AND (sp_only ->> 'member_count')::int = 0 AND (sp_only ->> 'excluded_sponsored_count')::int = 1,
    sp_only::text);
END $$;

-- ── Canonical normalization ──────────────────────────────────────────────
SELECT t_np_put('n1', t_indent(t_id('SHIP1'), 'NP Norm', 'NP Drop', '32 FT', 'integrated_supplier'));
SELECT t_np_put('n2', t_indent(t_id('SHIP1'), '  np norm  ', 'NP DROP', '32 ft', 'both'));
SELECT t_np_put('n3', t_indent(t_id('SHIP1'), E'NP Norm\t', E'np drop\u00A0', E'\u300032 FT', 'integrated_supplier'));
SELECT t_np_put('n4', t_indent(t_id('SHIP1'), 'NP Norm', 'NP Drop', '   ', 'integrated_supplier'));

DO $$
DECLARE
  p jsonb := t_net_pool(t_id('u_bid1'), t_id('B1'), E'\u00A0NP NORM', 'np drop', ' 32 Ft ');
  lanes jsonb := t_net_lanes(t_id('u_bid1'), t_id('B1'));
BEGIN
  PERFORM t_ok('Network: case and JS-trim whitespace variants form one canonical pool',
    p ->> 'pool_key' = 'np norm|np drop|32 ft' AND t_uuids(p -> 'members', 'id') = t_ids_of('n1', 'n2', 'n3'), p::text);
  PERFORM t_ok('Network: one lane for the variants; blank-vehicle load joins no lane',
    (t_find(lanes, 'pool_key', 'np norm|np drop|32 ft') ->> 'eligible_count')::int = 3
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(lanes) l WHERE l ->> 'pool_key' LIKE 'np norm|np drop|%' AND l ->> 'pool_key' <> 'np norm|np drop|32 ft'),
    lanes::text);
END $$;

-- ── 150-member boundary ──────────────────────────────────────────────────
SELECT count(t_indent(t_id('SHIP1'), 'NP Big', 'NP Lane', '20FT', 'integrated_supplier')) FROM generate_series(1, 150);
DO $$
DECLARE
  p jsonb := t_net_pool(t_id('u_bid1'), t_id('B1'), 'NP Big', 'NP Lane', '20FT');
BEGIN
  PERFORM t_ok('Network: exactly 150 members is complete',
    (p ->> 'member_count')::int = 150 AND (p ->> 'complete')::boolean AND p ->> 'fingerprint' IS NOT NULL
      AND jsonb_array_length(p -> 'members') = 150 AND jsonb_array_length(p -> 'quotable_ids') = 150,
    p ->> 'member_count');
END $$;
SELECT t_indent(t_id('SHIP1'), 'NP Big', 'NP Lane', '20FT', 'integrated_supplier');
INSERT INTO public.direct_quotes (indent_id, bidder_organization_id, amount, status)
SELECT i.id, t_id('B1'), 17000, 'pending' FROM public.indents i
WHERE i.organization_id = t_id('SHIP1') AND i.pickup_area = 'NP Big' LIMIT 1;
DO $$
DECLARE
  q0 bigint := (SELECT count(*) FROM public.direct_quotes);
  p jsonb := t_net_pool(t_id('u_bid1'), t_id('B1'), 'NP Big', 'NP Lane', '20FT');
  lane jsonb := t_find(t_net_lanes(t_id('u_bid1'), t_id('B1')), 'pool_key', 'np big|np lane|20ft');
BEGIN
  PERFORM t_ok('Network: 151 members is incomplete with no members, ids, quotes or fingerprint',
    (p ->> 'member_count')::int = 151 AND NOT (p ->> 'complete')::boolean AND p ->> 'fingerprint' IS NULL
      AND p -> 'members' = '[]'::jsonb AND p -> 'quotable_ids' = '[]'::jsonb AND p -> 'org_quotes' = '[]'::jsonb,
    p::text);
  PERFORM t_ok('Network: lane flags the 151-member pool too_large',
    (lane ->> 'eligible_count')::int = 151 AND (lane ->> 'too_large')::boolean, coalesce(lane::text, 'missing'));
  PERFORM t_ok('Network: reading pools writes nothing',
    (SELECT count(*) FROM public.direct_quotes) = q0, '');
  PERFORM t_ok('Network: manifest, lanes and row source are STABLE (a write would raise)',
    (SELECT bool_and(p.provolatile = 's') FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
       AND p.proname IN ('get_org_network_pool', 'list_network_pool_lanes_for_org', '_network_pool_rows')), '');
END $$;

-- ── Quote state, fingerprint and submit_network_quote parity ─────────────
CREATE TABLE t_fp (name text PRIMARY KEY, fp text);
GRANT ALL ON t_fp TO PUBLIC;
INSERT INTO t_fp VALUES ('a0', t_net_pool(t_id('u_bid1'), t_id('B1'), 'NP Alpha', 'NP Beta', '20FT') ->> 'fingerprint');

SELECT t_exec_as(t_id('u_bid1'), t_quote_sql(t_np('a_net1'), t_id('B1'), 18000));
DO $$
DECLARE
  p jsonb := t_net_pool(t_id('u_bid1'), t_id('B1'), 'NP Alpha', 'NP Beta', '20FT');
  q jsonb := t_find(p -> 'org_quotes', 'indent_id', t_np('a_net1')::text);
BEGIN
  PERFORM t_ok('Network: a pending uncountered quote stays quotable and is reported',
    q ->> 'status' = 'pending' AND (q ->> 'quotable')::boolean AND t_np('a_net1') = ANY (t_uuids(p -> 'quotable_ids')), p::text);
  PERFORM t_ok('Network: fingerprint changes when the organization''s quote state changes',
    p ->> 'fingerprint' <> (SELECT fp FROM t_fp WHERE name = 'a0'), '');
  INSERT INTO t_fp VALUES ('a1', p ->> 'fingerprint');
END $$;
SELECT t_exec_as(t_id('u_bid2'), t_quote_sql(t_np('a_net1'), t_id('B1'), 17500));
SELECT t_pass('Network parity: quotable pending quote is accepted by submit_network_quote (colleague revision)');

UPDATE public.direct_quotes SET counter_amount = 19000
WHERE indent_id = t_np('a_net1') AND bidder_organization_id = t_id('B1');
SELECT t_exec_as(t_id('u_bid2'), t_quote_sql(t_np('a_both1'), t_id('B1'), 18000));
UPDATE public.direct_quotes SET status = 'rejected'
WHERE indent_id = t_np('a_both1') AND bidder_organization_id = t_id('B1');
DO $$
DECLARE
  p jsonb := t_net_pool(t_id('u_bid1'), t_id('B1'), 'NP Alpha', 'NP Beta', '20FT');
BEGIN
  PERFORM t_ok('Network: countered and rejected quotes are members but not quotable',
    t_uuids(p -> 'members', 'id') = t_ids_of('a_net1', 'a_both1') AND p -> 'quotable_ids' = '[]'::jsonb
      AND NOT (t_find(p -> 'org_quotes', 'indent_id', t_np('a_net1')::text) ->> 'quotable')::boolean
      AND t_find(p -> 'org_quotes', 'indent_id', t_np('a_both1')::text) ->> 'status' = 'rejected',
    p::text);
  PERFORM t_ok('Network: fingerprint changes on counter and reject',
    p ->> 'fingerprint' <> (SELECT fp FROM t_fp WHERE name = 'a1'), '');
END $$;
SELECT t_err_as('Network parity: countered quote is refused by submit_network_quote', t_id('u_bid1'),
  t_quote_sql(t_np('a_net1'), t_id('B1'), 18500), 'quote_locked');
SELECT t_err_as('Network parity: rejected quote is refused by submit_network_quote', t_id('u_bid1'),
  t_quote_sql(t_np('a_both1'), t_id('B1'), 18500), 'quote_locked');

-- Membership and visibility changes move the fingerprint.
INSERT INTO t_fp VALUES ('a2', t_net_pool(t_id('u_bid1'), t_id('B1'), 'NP Alpha', 'NP Beta', '20FT') ->> 'fingerprint');
SELECT t_np_put('a_net3', t_indent(t_id('SHIP1'), 'NP Alpha', 'NP Beta', '20FT', 'integrated_supplier'));
DO $$
DECLARE p jsonb := t_net_pool(t_id('u_bid1'), t_id('B1'), 'NP Alpha', 'NP Beta', '20FT');
BEGIN
  PERFORM t_ok('Network: fingerprint changes when membership changes',
    p ->> 'fingerprint' <> (SELECT fp FROM t_fp WHERE name = 'a2') AND (p ->> 'member_count')::int = 3, p::text);
  INSERT INTO t_fp VALUES ('a3', p ->> 'fingerprint');
END $$;
INSERT INTO public.organization_relations (from_organization_id, to_organization_id, relation_type, status)
VALUES (t_id('SHIP2'), t_id('B1'), 'client_supplier', 'active');
DO $$
DECLARE
  p jsonb := t_net_pool(t_id('u_bid1'), t_id('B1'), 'NP Alpha', 'NP Beta', '20FT');
  b2 jsonb := t_net_pool(t_id('u_other'), t_id('B2'), 'NP Alpha', 'NP Beta', '20FT');
BEGIN
  PERFORM t_ok('Network: fingerprint changes when the caller''s visibility changes',
    p ->> 'fingerprint' <> (SELECT fp FROM t_fp WHERE name = 'a3')
      AND t_uuids(p -> 'members', 'id') = t_ids_of('a_net1', 'a_both1', 'a_net3', 'a_net2', 'a_both2')
      AND (p ->> 'shipper_count')::int = 2,
    p::text);
  PERFORM t_ok('Network: identical member sets for two orgs still give org-scoped fingerprints',
    t_uuids(p -> 'members', 'id') = t_uuids(b2 -> 'members', 'id') AND p ->> 'fingerprint' <> b2 ->> 'fingerprint', '');
END $$;

-- Every member the manifest calls quotable is visible to submit_network_quote,
-- and every visible open Network row in the lane is a member.
DO $$
DECLARE
  p jsonb := t_net_pool(t_id('u_bid1'), t_id('B1'), 'NP Alpha', 'NP Beta', '20FT');
  v_rows jsonb := t_exec_as(t_id('u_bid1'), format(
    'SELECT coalesce(jsonb_agg(to_jsonb(m)), ''[]''::jsonb) FROM public.market_indents_for_org(%L) m', t_id('B1')));
  v_vis uuid[];
BEGIN
  SELECT t_sort(coalesce(array_agg((r ->> 'id')::uuid), '{}')) INTO v_vis
  FROM jsonb_array_elements(v_rows) r
  WHERE public._pool_key(r ->> 'pickup_area', r ->> 'drop_location', r ->> 'vehicle_type') = 'np alpha|np beta|20ft'
    AND (r ->> 'circulation_target' IS NULL OR r ->> 'circulation_target' IN ('integrated_supplier', 'both'))
    AND public.indent_open_for_marketplace_bids((r ->> 'id')::uuid)
    AND (r ->> 'organization_id')::uuid <> t_id('B1');
  PERFORM t_ok('Network parity: members equal visible, open, Network-circulated rows of the lane',
    t_uuids(p -> 'members', 'id') = v_vis, format('%s vs %s', t_uuids(p -> 'members', 'id'), v_vis));
END $$;

-- ── No cross-channel locking ─────────────────────────────────────────────
SELECT t_np_put('x_both', t_indent(t_id('SHIP1'), 'NP Cross', 'NP Chan', '20FT', 'both'));
INSERT INTO t_fp VALUES
  ('x_net0', t_net_pool(t_id('u_bid1'), t_id('B1'), 'NP Cross', 'NP Chan', '20FT') ->> 'fingerprint'),
  ('x_mkt0', t_org_pool(t_id('u_bid1'), t_id('B1'), 'NP Cross', 'NP Chan', '20FT') ->> 'fingerprint');
SELECT t_bid(t_id('u_bid1'), t_np('x_both'), 15000, t_id('B1'), NULL);
INSERT INTO t_fp VALUES
  ('x_mkt1', t_org_pool(t_id('u_bid1'), t_id('B1'), 'NP Cross', 'NP Chan', '20FT') ->> 'fingerprint');
DO $$
DECLARE p jsonb := t_net_pool(t_id('u_bid1'), t_id('B1'), 'NP Cross', 'NP Chan', '20FT');
BEGIN
  PERFORM t_ok('Network: a Marketplace bid does not lock or change the Network pool',
    t_uuids(p -> 'quotable_ids') = t_ids_of('x_both') AND p ->> 'fingerprint' = (SELECT fp FROM t_fp WHERE name = 'x_net0'), p::text);
END $$;
SELECT t_exec_as(t_id('u_bid1'), t_quote_sql(t_np('x_both'), t_id('B1'), 16000));
SELECT t_pass('Network: both load accepts a Network quote while a Marketplace bid is live');
DO $$
DECLARE m jsonb := t_org_pool(t_id('u_bid1'), t_id('B1'), 'NP Cross', 'NP Chan', '20FT');
BEGIN
  PERFORM t_ok('Network: a Network quote does not lock or change the Marketplace pool',
    t_uuids(m -> 'biddable_ids') = t_ids_of('x_both')
      AND m ->> 'fingerprint' <> '' AND (t_find(m -> 'org_bids', 'indent_id', t_np('x_both')::text) ->> 'status') = 'pending',
    m::text);
END $$;
SELECT t_ok('Network: Marketplace fingerprint is unaffected by direct_quotes',
  (t_org_pool(t_id('u_bid1'), t_id('B1'), 'NP Cross', 'NP Chan', '20FT') ->> 'fingerprint')
    = (SELECT fp FROM t_fp WHERE name = 'x_mkt1'), 'fingerprint moved');
SELECT t_ok('Network: no Network function reads market_bids',
  NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname IN ('get_org_network_pool', 'list_network_pool_lanes_for_org', '_network_pool_rows')
    AND p.prosrc ILIKE '%market_bids%'), '');

-- ── Lane paging and lane/manifest consistency ────────────────────────────
DO $$
DECLARE
  all_lanes jsonb := t_net_lanes(t_id('u_bid1'), t_id('B1'));
  paged text[] := '{}';
  page jsonb;
  v_after text := NULL;
  l jsonb;
  m jsonb;
  v_mismatch text := '';
BEGIN
  LOOP
    page := t_net_lanes(t_id('u_bid1'), t_id('B1'), 2, v_after);
    EXIT WHEN jsonb_array_length(page) = 0;
    SELECT paged || array_agg(e ->> 'pool_key' ORDER BY (e ->> 'pool_key') COLLATE "C") INTO paged FROM jsonb_array_elements(page) e;
    v_after := page -> (jsonb_array_length(page) - 1) ->> 'pool_key';
  END LOOP;
  PERFORM t_ok('Network: keyset paging returns every lane once, in COLLATE "C" order',
    paged = (SELECT array_agg(e ->> 'pool_key' ORDER BY (e ->> 'pool_key') COLLATE "C") FROM jsonb_array_elements(all_lanes) e),
    format('%s', paged));
  FOR l IN SELECT * FROM jsonb_array_elements(all_lanes) LOOP
    m := t_net_pool(t_id('u_bid1'), t_id('B1'), l ->> 'pickup_area', l ->> 'drop_location', l ->> 'vehicle_type');
    IF m ->> 'pool_key' <> l ->> 'pool_key'
       OR (m ->> 'member_count')::int <> (l ->> 'eligible_count')::int
       OR (m ->> 'excluded_sponsored_count')::int <> (l ->> 'sponsored_count')::int
       OR (m ->> 'shipper_count')::int <> (l ->> 'shipper_count')::int THEN
      v_mismatch := v_mismatch || (l ->> 'pool_key') || ' ';
    END IF;
  END LOOP;
  PERFORM t_ok(format('Network: every listed lane (%s) opens to a manifest with the same counts', jsonb_array_length(all_lanes)),
    v_mismatch = '', v_mismatch);
END $$;

-- ── Security shape ───────────────────────────────────────────────────────
SELECT t_ok('Network: functions are SECURITY DEFINER with search_path ''''',
  (SELECT bool_and(p.prosecdef AND p.proconfig = ARRAY['search_path=""']) FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN ('get_org_network_pool', 'list_network_pool_lanes_for_org', '_network_pool_rows')),
  (SELECT string_agg(p.proname || '=' || coalesce(array_to_string(p.proconfig, ','), '<none>'), ' ') FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('get_org_network_pool', 'list_network_pool_lanes_for_org', '_network_pool_rows')));
SELECT t_ok('Network: grants are authenticated-only for the two public RPCs; none for the row source',
  has_function_privilege('authenticated', 'public.get_org_network_pool(uuid,text,text,text)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.list_network_pool_lanes_for_org(uuid,integer,text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.get_org_network_pool(uuid,text,text,text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.list_network_pool_lanes_for_org(uuid,integer,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._network_pool_rows(uuid,text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public._network_pool_rows(uuid,text)', 'EXECUTE'), '');
