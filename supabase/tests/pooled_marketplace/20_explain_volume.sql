-- Query plans for the pooled Marketplace functions at synthetic volume on the
-- Gate 1A TEST project. One implicit transaction; the plans are returned as the
-- text of a final deliberate error, so the synthetic rows are never committed.
-- Run from a checkout linked to kfaqqunuxgpdhboijdsl:
--   supabase db query --linked -f supabase/tests/pooled_marketplace/20_explain_volume.sql

SET LOCAL pm_harness.single_txn = 'on';
DO $$
BEGIN
  IF current_setting('pm_harness.single_txn', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'GUARD: statements are not running in one transaction';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_indents_guard_commercial_winner') THEN
    RAISE EXCEPTION 'GUARD: Gate 1A already live here; this is not the rollback-state test project';
  END IF;
END $$;

CREATE FUNCTION pg_temp.k(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT md5('pmx-' || p)::uuid $$;

INSERT INTO auth.users (id, aud, role, email)
SELECT pg_temp.k(u), 'authenticated', 'authenticated', 'pmx-' || u || '@example.invalid'
FROM unnest(ARRAY['ship', 'ub1', 'ub2', 'dco']) u;
INSERT INTO public.profiles (id, role) VALUES
  (pg_temp.k('ship'), 'user'), (pg_temp.k('ub1'), 'user'), (pg_temp.k('ub2'), 'user'), (pg_temp.k('dco'), 'driver')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

INSERT INTO public.organizations (id, name)
SELECT pg_temp.k('s' || g), 'PMX Shipper ' || g FROM generate_series(1, 20) g
UNION ALL SELECT pg_temp.k('B'), 'PMX Bidder';
INSERT INTO public.organization_members (organization_id, user_id, role) VALUES
  (pg_temp.k('B'), pg_temp.k('ub1'), 'owner'), (pg_temp.k('B'), pg_temp.k('ub2'), 'dispatcher');
INSERT INTO public.organization_relations (from_organization_id, to_organization_id, relation_type, status)
SELECT pg_temp.k('s' || g), pg_temp.k('B'), 'client_supplier', 'active' FROM generate_series(1, 5) g;
INSERT INTO public.dco_profiles (user_id, status) VALUES (pg_temp.k('dco'), 'APPROVED');
INSERT INTO public.owner_vehicles (id, owner_user_id, vehicle_type, vehicle_number)
VALUES (pg_temp.k('veh'), pg_temp.k('dco'), '20FT', 'PMX01AA0001');

-- 10,000 indents: 20 shippers x 200 lanes; 70% Marketplace-circulated, 60% open.
INSERT INTO public.indents (
  organization_id, indent_number, pickup_area, drop_location, vehicle_type,
  circulation_target, status, supplier_target, client_name, load_type, pickup_date, weight
)
SELECT
  pg_temp.k('s' || (g % 20 + 1)), 'PMX-' || g,
  'Lane ' || (g % 200) || ' Pickup', 'Lane ' || (g % 200) || ' Drop',
  (ARRAY['32 FT MXL', '20FT', '14FT'])[(g % 200) % 3 + 1],
  (ARRAY['marketplace', 'marketplace', 'marketplace', 'marketplace', 'both', 'both', 'both',
         'integrated_supplier', 'integrated_supplier', 'integrated_supplier'])[(g / 200) % 10 + 1],
  (ARRAY['open', 'open', 'open', 'open', 'open', 'broadcast', 'completed', 'completed', 'cancelled', 'expired'])[(g / 2000) % 10 + 1],
  20000 + g % 500, 'Client', 'FTL', DATE '2026-10-10' + (g % 30), 9000
FROM generate_series(1, 10000) g;

CREATE TEMP TABLE pmx_ind ON COMMIT DROP AS
SELECT i.id, i.organization_id, i.circulation_target, i.status, i.pickup_area,
       row_number() OVER (ORDER BY i.indent_number) AS n
FROM public.indents i WHERE i.indent_number LIKE 'PMX-%';

-- 100 live Reach campaigns (one sponsor org each: one live campaign per org).
INSERT INTO public.reach_plans (code, name, price_inr, credit_price, estimated_reach_min, estimated_reach_max)
VALUES ('basic', 'PMX Basic', 0, 0, 1, 1) ON CONFLICT (code) DO NOTHING;
INSERT INTO public.organizations (id, name)
SELECT pg_temp.k('sp' || g), 'PMX Sponsor ' || g FROM generate_series(1, 100) g;
INSERT INTO public.reach_campaigns (status, snapshot_source_indent_id, org_id, created_by, plan_id)
SELECT 'active', x.id, pg_temp.k('sp' || x.r), pg_temp.k('ship'), (SELECT id FROM public.reach_plans WHERE code = 'basic')
FROM (
  SELECT id, row_number() OVER (ORDER BY n) AS r FROM pmx_ind
  WHERE status = 'open' AND circulation_target IN ('marketplace', 'both') AND n % 37 = 0
) x WHERE x.r <= 100;

-- Bids and quotes.
INSERT INTO public.market_bids (indent_id, bidder_type, bidder_user_id, bidder_organization_id, amount, status)
SELECT id, 'organization', pg_temp.k(CASE WHEN n % 3 = 0 THEN 'ub2' ELSE 'ub1' END), pg_temp.k('B'), 15000,
       (ARRAY['pending', 'pending', 'rejected', 'withdrawn'])[n % 4 + 1]
FROM pmx_ind WHERE circulation_target IN ('marketplace', 'both') AND n % 2 = 0;
INSERT INTO public.market_bids (indent_id, bidder_type, bidder_user_id, owner_vehicle_id, amount, status)
SELECT id, 'dco', pg_temp.k('dco'), pg_temp.k('veh'), 14000, (ARRAY['pending', 'rejected'])[n % 2 + 1]
FROM pmx_ind WHERE circulation_target IN ('marketplace', 'both') AND n % 5 = 0;
INSERT INTO public.direct_quotes (indent_id, bidder_organization_id, amount, status)
SELECT id, pg_temp.k('B'), 15000, 'pending'
FROM pmx_ind
WHERE circulation_target IN ('both', 'integrated_supplier')
  AND organization_id IN (SELECT pg_temp.k('s' || g) FROM generate_series(1, 5) g)
  AND n % 3 = 0;

DO $$
DECLARE
  out text := '';
  line text;
  v_lane_p text := 'Lane 7 Pickup';
  v_lane_d text := 'Lane 7 Drop';
  v_lane_v text := '20FT';
  v_key text := public._pool_key('Lane 7 Pickup', 'Lane 7 Drop', '20FT');
  v_b uuid := pg_temp.k('B');
  v_sponsored uuid := (SELECT snapshot_source_indent_id FROM public.reach_campaigns
                       WHERE org_id = pg_temp.k('sp1'));
  v_ids uuid[];
  v_quote_target uuid;
  v_bid_target uuid;
  v_dco_target uuid;
  q text;
  label text;
  stmts text[][];
  i int;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', pg_temp.k('ub1')::text, true);
  SELECT array_agg(id) INTO v_ids FROM (
    SELECT id FROM public.market_indents_for_org(v_b) LIMIT 500
  ) x;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  SELECT id INTO v_quote_target FROM pmx_ind
  WHERE status = 'open' AND circulation_target = 'both'
    AND organization_id = pg_temp.k('s1')
    AND id NOT IN (SELECT indent_id FROM public.direct_quotes WHERE bidder_organization_id = v_b)
  LIMIT 1;
  SELECT id INTO v_bid_target FROM pmx_ind
  WHERE status = 'open' AND circulation_target = 'marketplace'
    AND id NOT IN (SELECT indent_id FROM public.market_bids WHERE bidder_user_id = pg_temp.k('ub1'))
    AND id NOT IN (SELECT snapshot_source_indent_id FROM public.reach_campaigns WHERE snapshot_source_indent_id IS NOT NULL)
  LIMIT 1;
  SELECT id INTO v_dco_target FROM pmx_ind
  WHERE status = 'open' AND circulation_target = 'marketplace'
    AND id NOT IN (SELECT indent_id FROM public.market_bids WHERE bidder_user_id = pg_temp.k('dco'))
    AND id NOT IN (SELECT snapshot_source_indent_id FROM public.reach_campaigns WHERE snapshot_source_indent_id IS NOT NULL)
  LIMIT 1;

  out := format(E'VOLUME indents=%s market_bids=%s direct_quotes=%s reach_campaigns=%s visible_to_B=%s lane_key=%s\n',
    (SELECT count(*) FROM public.indents), (SELECT count(*) FROM public.market_bids),
    (SELECT count(*) FROM public.direct_quotes), (SELECT count(*) FROM public.reach_campaigns),
    cardinality(v_ids), v_key);

  stmts := ARRAY[
    ['P1 _marketplace_pool_rows body, one lane', 'admin',
     format($q$SELECT k.pool_key, i.id, public._indent_is_sponsored_reach(i.id)
       FROM public.indents i
       CROSS JOIN LATERAL (SELECT public._pool_key(i.pickup_area, i.drop_location, i.vehicle_type) AS pool_key) k
       WHERE i.deleted_at IS NULL
         AND lower(trim(coalesce(i.circulation_target, ''))) IN ('marketplace', 'both')
         AND k.pool_key IS NOT NULL AND k.pool_key = %L
         AND public.indent_open_for_marketplace_bids(i.id)$q$, v_key)],
    ['P2 _marketplace_pool_rows body, all lanes (lanes RPCs)', 'admin',
     $q$SELECT k.pool_key, count(*)
       FROM public.indents i
       CROSS JOIN LATERAL (SELECT public._pool_key(i.pickup_area, i.drop_location, i.vehicle_type) AS pool_key) k
       WHERE i.deleted_at IS NULL
         AND lower(trim(coalesce(i.circulation_target, ''))) IN ('marketplace', 'both')
         AND k.pool_key IS NOT NULL
         AND public.indent_open_for_marketplace_bids(i.id)
         AND NOT public._indent_is_sponsored_reach(i.id)
       GROUP BY k.pool_key ORDER BY k.pool_key COLLATE "C" LIMIT 50$q$],
    ['P3 _indent_is_sponsored_reach body', 'admin',
     format($q$SELECT EXISTS (SELECT 1 FROM public.reach_campaigns c
       WHERE c.status = 'active' AND c.archived_at IS NULL AND (c.expires_at IS NULL OR c.expires_at > now())
         AND (c.snapshot_source_indent_id = %L
              OR EXISTS (SELECT 1 FROM public.posts p WHERE p.id = c.post_id AND p.source_indent_id = %L)))$q$,
       v_sponsored, v_sponsored)],
    ['P4 org_bid CTE (org manifest)', 'admin',
     format($q$SELECT b.* FROM public.market_bids b
       JOIN public._marketplace_pool_rows(%L) c ON c.id = b.indent_id
       WHERE b.bidder_organization_id = %L$q$, v_key, v_b)],
    ['D1 cost: _pool_key(...) IS NOT NULL over all indents', 'time',
     $q$SELECT count(*) FROM public.indents i WHERE public._pool_key(i.pickup_area, i.drop_location, i.vehicle_type) IS NOT NULL$q$],
    ['D2 cost: same pool key, inline expression', 'time',
     $q$SELECT count(*) FROM public.indents i WHERE (CASE WHEN lower(btrim(coalesce(i.pickup_area, ''), E' \t\n\u000B\f\r\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF')) = '' OR lower(btrim(coalesce(i.drop_location, ''), E' \t\n\u000B\f\r\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF')) = '' OR lower(btrim(coalesce(i.vehicle_type, ''), E' \t\n\u000B\f\r\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF')) = '' THEN NULL ELSE lower(btrim(coalesce(i.pickup_area, ''), E' \t\n\u000B\f\r\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF')) || '|' || lower(btrim(coalesce(i.drop_location, ''), E' \t\n\u000B\f\r\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF')) || '|' || lower(btrim(coalesce(i.vehicle_type, ''), E' \t\n\u000B\f\r\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF')) END) IS NOT NULL$q$],
    ['D3 cost: indent_open_for_marketplace_bids(id) over all indents', 'time',
     $q$SELECT count(*) FROM public.indents i WHERE public.indent_open_for_marketplace_bids(i.id)$q$],
    ['D4 cost: same open check on the scanned row, inline', 'time',
     $q$SELECT count(*) FROM public.indents i WHERE i.deleted_at IS NULL AND lower(trim(coalesce(i.status::text, ''))) <> ALL (ARRAY['awarded','completed','cancelled','closed','expired','draft'])$q$],
    ['D5 cost: _indent_is_sponsored_reach(id) over all indents', 'time',
     $q$SELECT count(*) FROM public.indents i WHERE public._indent_is_sponsored_reach(i.id)$q$],
    ['D6 cost: same sponsored check, inline EXISTS', 'time',
     $q$SELECT count(*) FROM public.indents i WHERE EXISTS (SELECT 1 FROM public.reach_campaigns c WHERE c.status = 'active' AND c.archived_at IS NULL AND (c.expires_at IS NULL OR c.expires_at > now()) AND (c.snapshot_source_indent_id = i.id OR EXISTS (SELECT 1 FROM public.posts p WHERE p.id = c.post_id AND p.source_indent_id = i.id)))$q$],
    ['D7 prototype: one-lane pool rows with all three inlined', 'admin',
     format($q$SELECT i.id, EXISTS (SELECT 1 FROM public.reach_campaigns c WHERE c.status = 'active' AND c.archived_at IS NULL AND (c.expires_at IS NULL OR c.expires_at > now()) AND (c.snapshot_source_indent_id = i.id OR EXISTS (SELECT 1 FROM public.posts p WHERE p.id = c.post_id AND p.source_indent_id = i.id))) AS sponsored FROM public.indents i
       WHERE i.deleted_at IS NULL
         AND lower(trim(coalesce(i.circulation_target, ''))) IN ('marketplace', 'both')
         AND lower(trim(coalesce(i.status::text, ''))) <> ALL (ARRAY['awarded','completed','cancelled','closed','expired','draft'])
         AND (CASE WHEN lower(btrim(coalesce(i.pickup_area, ''), E' \t\n\u000B\f\r\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF')) = '' OR lower(btrim(coalesce(i.drop_location, ''), E' \t\n\u000B\f\r\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF')) = '' OR lower(btrim(coalesce(i.vehicle_type, ''), E' \t\n\u000B\f\r\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF')) = '' THEN NULL ELSE lower(btrim(coalesce(i.pickup_area, ''), E' \t\n\u000B\f\r\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF')) || '|' || lower(btrim(coalesce(i.drop_location, ''), E' \t\n\u000B\f\r\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF')) || '|' || lower(btrim(coalesce(i.vehicle_type, ''), E' \t\n\u000B\f\r\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF')) END) = %L$q$, v_key)],
    ['D8 prototype: all-lane pool rows with all three inlined', 'time',
     $q$SELECT k, count(*) FROM (SELECT (CASE WHEN lower(btrim(coalesce(i.pickup_area, ''), E' \t\n\u000B\f\r\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF')) = '' OR lower(btrim(coalesce(i.drop_location, ''), E' \t\n\u000B\f\r\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF')) = '' OR lower(btrim(coalesce(i.vehicle_type, ''), E' \t\n\u000B\f\r\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF')) = '' THEN NULL ELSE lower(btrim(coalesce(i.pickup_area, ''), E' \t\n\u000B\f\r\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF')) || '|' || lower(btrim(coalesce(i.drop_location, ''), E' \t\n\u000B\f\r\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF')) || '|' || lower(btrim(coalesce(i.vehicle_type, ''), E' \t\n\u000B\f\r\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF')) END) AS k FROM public.indents i
       WHERE i.deleted_at IS NULL
         AND lower(trim(coalesce(i.circulation_target, ''))) IN ('marketplace', 'both')
         AND lower(trim(coalesce(i.status::text, ''))) <> ALL (ARRAY['awarded','completed','cancelled','closed','expired','draft']) AND NOT EXISTS (SELECT 1 FROM public.reach_campaigns c WHERE c.status = 'active' AND c.archived_at IS NULL AND (c.expires_at IS NULL OR c.expires_at > now()) AND (c.snapshot_source_indent_id = i.id OR EXISTS (SELECT 1 FROM public.posts p WHERE p.id = c.post_id AND p.source_indent_id = i.id)))) x
       WHERE k IS NOT NULL GROUP BY k ORDER BY k COLLATE "C" LIMIT 50$q$],
    ['F0a _marketplace_pool_rows(one lane)', 'time',
     format('SELECT count(*) FROM public._marketplace_pool_rows(%L)', v_key)],
    ['F0b _marketplace_pool_rows(all lanes)', 'time',
     'SELECT count(*) FROM public._marketplace_pool_rows(NULL)'],
    ['F1 get_dco_marketplace_pool (as DCO)', 'dco',
     format('SELECT public.get_dco_marketplace_pool(%L, %L, %L)', v_lane_p, v_lane_d, v_lane_v)],
    ['F2 list_dco_marketplace_pool_lanes(50) (as DCO)', 'dco',
     'SELECT * FROM public.list_dco_marketplace_pool_lanes(50, NULL)'],
    ['F3 get_org_marketplace_pool (as org owner)', 'ub1',
     format('SELECT public.get_org_marketplace_pool(%L, %L, %L, %L)', v_b, v_lane_p, v_lane_d, v_lane_v)],
    ['F4 list_marketplace_pool_lanes_for_org(50) (as org owner)', 'ub1',
     format('SELECT * FROM public.list_marketplace_pool_lanes_for_org(%L, 50, NULL)', v_b)],
    ['F5 classify_indents_for_pooling, 500 ids (as org owner)', 'ub1',
     format('SELECT * FROM public.classify_indents_for_pooling(%L, %L::uuid[])', v_b, v_ids)],
    ['F6 market_indents_for_org (existing, baseline)', 'ub1',
     format('SELECT * FROM public.market_indents_for_org(%L)', v_b)],
    ['F7 submit_network_quote (as org owner)', 'ub1',
     format('SELECT public.submit_network_quote(%L, %L, 9000, NULL)', v_quote_target, v_b)],
    ['F8 submit_market_bid, organization path (as org owner)', 'ub1',
     format('SELECT public.submit_market_bid(%L, 9000, NULL, %L, NULL)', v_bid_target, v_b)],
    ['F9 submit_market_bid, DCO path (as DCO)', 'dco',
     format('SELECT public.submit_market_bid(%L, 9000, NULL, NULL, %L)', v_dco_target, pg_temp.k('veh'))]
  ];

  FOR i IN 1 .. array_length(stmts, 1) LOOP
    label := stmts[i][1];
    IF stmts[i][2] = 'time' THEN
      PERFORM set_config('request.jwt.claim.sub', '', true);
      out := out || E'\n== ' || label || E'\n';
      FOR line IN EXECUTE 'EXPLAIN (ANALYZE, SUMMARY) ' || stmts[i][3] LOOP
        IF line ~ 'Execution Time' THEN out := out || line || E'\n'; END IF;
      END LOOP;
    ELSIF stmts[i][2] IN ('dco', 'ub1') THEN
      PERFORM set_config('request.jwt.claim.sub', pg_temp.k(stmts[i][2])::text, true);
      q := stmts[i][3];
      out := out || E'\n== ' || label || E'\n';
      -- Function bodies are SECURITY DEFINER and not inlined; only totals are visible.
      FOR line IN EXECUTE 'EXPLAIN (ANALYZE, BUFFERS, SUMMARY) ' || q LOOP
        IF line ~ '(Execution Time|Planning Time|Buffers: shared)' OR line ~ '^[A-Z].*actual' THEN
          out := out || line || E'\n';
        END IF;
      END LOOP;
    ELSE
      PERFORM set_config('request.jwt.claim.sub', '', true);
      q := stmts[i][3];
      out := out || E'\n== ' || label || E'\n';
      FOR line IN EXECUTE 'EXPLAIN (ANALYZE, BUFFERS, SUMMARY) ' || q LOOP
        out := out || line || E'\n';
      END LOOP;
    END IF;
  END LOOP;

  RAISE EXCEPTION E'EXPLAIN_COMPLETE (transaction rolled back)\n%', out;
END $$;
