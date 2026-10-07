-- Network pool timings and plans at synthetic volume on the Gate 1A TEST
-- project. One implicit transaction ending in a deliberate error that carries
-- the results, so no synthetic row is committed. Needs 20271007091500 loaded
-- first (run_explain.sh prepends it).
--
-- Callers: B_all is linked to all 200 shippers (worst-case visible population),
-- B_mid to 60 (supplier/client fallback links), B_small to 5.

CREATE FUNCTION pg_temp.k(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT md5('npx-' || p)::uuid $$;
CREATE TEMP TABLE npx_out (n serial, step text, k text, v text) ON COMMIT DROP;

INSERT INTO auth.users (id, aud, role, email)
SELECT pg_temp.k(u), 'authenticated', 'authenticated', 'npx-' || u || '@example.invalid'
FROM unnest(ARRAY['ship', 'u_all', 'u_mid', 'u_small']) u;
INSERT INTO public.profiles (id, role)
SELECT pg_temp.k(u), 'user' FROM unnest(ARRAY['ship', 'u_all', 'u_mid', 'u_small']) u
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

INSERT INTO public.organizations (id, name)
SELECT pg_temp.k('s' || g), 'NPX Shipper ' || g FROM generate_series(1, 200) g
UNION ALL SELECT pg_temp.k('q' || g), 'NPX Quoter ' || g FROM generate_series(1, 50) g
UNION ALL SELECT pg_temp.k(o), 'NPX ' || o FROM unnest(ARRAY['B_all', 'B_mid', 'B_small']) o;
INSERT INTO public.organization_members (organization_id, user_id, role) VALUES
  (pg_temp.k('B_all'), pg_temp.k('u_all'), 'owner'),
  (pg_temp.k('B_mid'), pg_temp.k('u_mid'), 'dispatcher'),
  (pg_temp.k('B_small'), pg_temp.k('u_small'), 'member');
INSERT INTO public.organization_relations (from_organization_id, to_organization_id, relation_type, status)
SELECT pg_temp.k('s' || g), pg_temp.k('B_all'), 'client_supplier', 'active' FROM generate_series(1, 200) g
UNION ALL
SELECT pg_temp.k('s' || g), pg_temp.k('B_small'), 'client_supplier', 'active' FROM generate_series(1, 5) g;
INSERT INTO public.suppliers (organization_id, name, linked_organization_id)
SELECT pg_temp.k('s' || g), 'NPX B_mid', pg_temp.k('B_mid') FROM generate_series(1, 50) g;
INSERT INTO public.clients (organization_id, name, phone, status, linked_organization_id)
SELECT pg_temp.k('B_mid'), 'NPX client ' || g, '+9190000' || lpad(g::text, 5, '0'), 'active', pg_temp.k('s' || g)
FROM generate_series(51, 60) g;

INSERT INTO public.reach_plans (code, name, price_inr, credit_price, estimated_reach_min, estimated_reach_max)
VALUES ('basic', 'NPX Basic', 0, 0, 1, 1) ON CONFLICT (code) DO NOTHING;

-- Indents g in (lo, hi]: 200 shippers, 300 lanes plus one hot lane (every 100th
-- indent), circulation 40% Network-only / 30% both / 30% Marketplace,
-- status 60% open.
CREATE FUNCTION pg_temp.gen(lo int, hi int) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.indents (
    organization_id, indent_number, pickup_area, drop_location, vehicle_type,
    circulation_target, status, supplier_target, client_price, client_name, load_type, pickup_date, weight,
    assigned_supplier_id
  )
  SELECT
    pg_temp.k('s' || (g % 200 + 1)), 'NPX-' || g,
    CASE WHEN g % 100 = 0 THEN 'Hot Pickup' ELSE 'Lane ' || (g % 300) || ' Pickup' END,
    CASE WHEN g % 100 = 0 THEN 'Hot Drop' ELSE 'Lane ' || (g % 300) || ' Drop' END,
    CASE WHEN g % 100 = 0 THEN '32 FT MXL' ELSE (ARRAY['32 FT MXL', '20FT', '14FT'])[(g % 300) % 3 + 1] END,
    (ARRAY['integrated_supplier', 'integrated_supplier', 'integrated_supplier', 'integrated_supplier',
           'both', 'both', 'both', 'marketplace', 'marketplace', 'marketplace'])[(g / 7) % 10 + 1],
    CASE WHEN g % 100 = 0 THEN 'open'
         ELSE (ARRAY['open', 'open', 'open', 'open', 'open', 'open', 'completed', 'cancelled', 'expired', 'closed'])[(g / 3) % 10 + 1] END,
    20000 + g % 500, 25000, 'Client', 'FTL', DATE '2026-10-10' + (g % 30), 9000,
    CASE WHEN g % 211 = 0 THEN pg_temp.k('B_all') END
  FROM generate_series(lo + 1, hi) g;

  -- ~2 background quotes per indent from 50 quoter orgs, 20% from B_all.
  INSERT INTO public.direct_quotes (indent_id, bidder_organization_id, amount, status)
  SELECT i.id, pg_temp.k('q' || ((x.r + n.g) % 50 + 1)), 15000, (ARRAY['pending', 'rejected'])[(x.r % 2) + 1]
  FROM (SELECT id, (substr(indent_number, 5))::int AS r FROM public.indents
        WHERE indent_number LIKE 'NPX-%' AND (substr(indent_number, 5))::int > lo AND (substr(indent_number, 5))::int <= hi) i
  CROSS JOIN LATERAL (SELECT i.r) x
  CROSS JOIN generate_series(0, 1) n(g)
  ON CONFLICT (indent_id, bidder_organization_id) DO NOTHING;
  INSERT INTO public.direct_quotes (indent_id, bidder_organization_id, amount, status)
  SELECT id, pg_temp.k('B_all'), 15000, 'pending' FROM public.indents
  WHERE indent_number LIKE 'NPX-%' AND (substr(indent_number, 5))::int > lo AND (substr(indent_number, 5))::int <= hi
    AND (substr(indent_number, 5))::int % 5 = 0
  ON CONFLICT (indent_id, bidder_organization_id) DO NOTHING;
$$;

-- 60 live Reach campaigns (one sponsor org each) targeting B_all.
CREATE FUNCTION pg_temp.reach() RETURNS void LANGUAGE plpgsql AS $$
DECLARE r record; v_c uuid; n int := 0;
BEGIN
  FOR r IN SELECT id FROM public.indents WHERE indent_number LIKE 'NPX-%' AND status = 'open'
           AND circulation_target <> 'marketplace' ORDER BY indent_number LIMIT 60 LOOP
    n := n + 1;
    INSERT INTO public.organizations (id, name) VALUES (pg_temp.k('sp' || n), 'NPX Sponsor ' || n);
    INSERT INTO public.reach_campaigns (status, snapshot_source_indent_id, org_id, created_by, plan_id)
    VALUES ('active', r.id, pg_temp.k('sp' || n), pg_temp.k('ship'), (SELECT id FROM public.reach_plans WHERE code = 'basic'))
    RETURNING id INTO v_c;
    INSERT INTO public.reach_campaign_targets (campaign_id, org_id, wave, released_at) VALUES (v_c, pg_temp.k('B_all'), 1, now());
  END LOOP;
END $$;

-- Wall time of p_sql run p_reps times as p_uid (authenticated): "min / median ms".
CREATE FUNCTION pg_temp.ms(p_uid uuid, p_sql text, p_reps int DEFAULT 5, p_role text DEFAULT 'authenticated') RETURNS text LANGUAGE plpgsql AS $$
DECLARE t timestamptz; d numeric[] := '{}'; v text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', p_role, true);
  FOR i IN 1..p_reps LOOP
    t := clock_timestamp();
    EXECUTE p_sql INTO v;
    d := d || round(extract(epoch FROM clock_timestamp() - t) * 1000, 1);
  END LOOP;
  PERFORM set_config('role', 'none', true);
  RETURN format('min %s / med %s ms -> %s',
    (SELECT min(x) FROM unnest(d) x),
    (SELECT percentile_disc(0.5) WITHIN GROUP (ORDER BY x) FROM unnest(d) x),
    left(v, 60));
END $$;

CREATE FUNCTION pg_temp.measure(p_step text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  o record;
  v_lane text;
BEGIN
  ANALYZE public.indents;
  ANALYZE public.direct_quotes;
  ANALYZE public.organization_relations;
  INSERT INTO npx_out (step, k, v) VALUES
    (p_step, 'volume', format('indents=%s direct_quotes=%s',
      (SELECT count(*) FROM public.indents), (SELECT count(*) FROM public.direct_quotes)));
  FOR o IN SELECT * FROM (VALUES ('B_all', 'u_all'), ('B_mid', 'u_mid'), ('B_small', 'u_small')) v(org, usr) LOOP
    INSERT INTO npx_out (step, k, v) VALUES
      (p_step, o.org || ' market_indents_for_org (visibility only)',
        pg_temp.ms(pg_temp.k(o.usr), format('SELECT count(*)::text FROM public.market_indents_for_org(%L)', pg_temp.k(o.org)))),
      (p_step, o.org || ' list_network_pool_lanes_for_org(200)',
        pg_temp.ms(pg_temp.k(o.usr), format('SELECT count(*)::text || '' lanes, '' || coalesce(sum(eligible_count), 0) || '' members'' FROM public.list_network_pool_lanes_for_org(%L, 200)', pg_temp.k(o.org)))),
      (p_step, o.org || ' get_org_network_pool(one ordinary lane)',
        pg_temp.ms(pg_temp.k(o.usr), format('SELECT (p ->> ''member_count'') || '' members, complete='' || (p ->> ''complete'') FROM public.get_org_network_pool(%L, ''Lane 1 Pickup'', ''Lane 1 Drop'', ''20FT'') p', pg_temp.k(o.org))));
  END LOOP;
  INSERT INTO npx_out (step, k, v) VALUES
    (p_step, 'B_all _network_pool_rows(one lane) [internal]',
      pg_temp.ms(pg_temp.k('u_all'), format('SELECT count(*)::text FROM public._network_pool_rows(%L, %L)', pg_temp.k('B_all'), 'lane 1 pickup|lane 1 drop|20ft'), 5, 'none')),
    (p_step, 'B_all _network_pool_rows(all lanes) [internal]',
      pg_temp.ms(pg_temp.k('u_all'), format('SELECT count(*)::text FROM public._network_pool_rows(%L, NULL)', pg_temp.k('B_all')), 5, 'none')),
    (p_step, 'B_all _pool_key over visible rows [internal]',
      pg_temp.ms(pg_temp.k('u_all'), format('SELECT count(public._pool_key(m.pickup_area, m.drop_location, m.vehicle_type))::text FROM public.market_indents_for_org(%L) m', pg_temp.k('B_all')), 5, 'none')),
    (p_step, 'B_all get_org_network_pool(hot lane, >150)',
      pg_temp.ms(pg_temp.k('u_all'), format('SELECT (p ->> ''member_count'') || '' members, complete='' || (p ->> ''complete'') FROM public.get_org_network_pool(%L, ''Hot Pickup'', ''Hot Drop'', ''32 FT MXL'') p', pg_temp.k('B_all')))),
    (p_step, 'B_all 20 manifests (20 different lanes, one call each)',
      pg_temp.ms(pg_temp.k('u_all'), format(
        'SELECT sum((public.get_org_network_pool(%L, ''Lane '' || l || '' Pickup'', ''Lane '' || l || '' Drop'', (ARRAY[''32 FT MXL'', ''20FT'', ''14FT''])[l %% 3 + 1]) ->> ''member_count'')::int)::text || '' members'' FROM generate_series(1, 20) l',
        pg_temp.k('B_all')), 1)),
    (p_step, 'B_all Marketplace org pool (reference, one lane)',
      pg_temp.ms(pg_temp.k('u_all'), format('SELECT (p ->> ''member_count'') FROM public.get_org_marketplace_pool(%L, ''Lane 1 Pickup'', ''Lane 1 Drop'', ''20FT'') p', pg_temp.k('B_all'))));
END $$;

-- Plans: market_indents_for_org body and the Network manifest rows, B_all.
CREATE FUNCTION pg_temp.plans(p_step text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_src text := (SELECT prosrc FROM pg_proc WHERE oid = 'public.market_indents_for_org(uuid)'::regprocedure);
  v_body text;
  v_line text;
  v_plan text := '';
BEGIN
  v_body := substr(v_src, position('RETURN QUERY' IN v_src) + length('RETURN QUERY'));
  v_body := left(v_body, length(v_body) - position(reverse('END;') IN reverse(v_body)) - 3);
  v_body := replace(v_body, 'p_org_id', quote_literal(pg_temp.k('B_all')) || '::uuid');
  FOR v_line IN EXECUTE 'EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, SUMMARY ON) ' || rtrim(btrim(v_body), ';') LOOP
    v_plan := v_plan || v_line || E'\n';
  END LOOP;
  INSERT INTO npx_out (step, k, v) VALUES (p_step, 'PLAN market_indents_for_org body (B_all)', v_plan);

  PERFORM set_config('request.jwt.claim.sub', pg_temp.k('u_all')::text, true);
  v_plan := '';
  FOR v_line IN EXECUTE format(
    'EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, SUMMARY ON) SELECT r.id, q.status FROM public._network_pool_rows(%L, %L) r
       LEFT JOIN public.direct_quotes q ON q.indent_id = r.id AND q.bidder_organization_id = %L',
    pg_temp.k('B_all'), 'lane 1 pickup|lane 1 drop|20ft', pg_temp.k('B_all')) LOOP
    v_plan := v_plan || v_line || E'\n';
  END LOOP;
  INSERT INTO npx_out (step, k, v) VALUES (p_step, 'PLAN manifest rows (B_all, one lane)', v_plan);
END $$;

-- Candidate row-source shape: cheap filters first, pool key computed once per survivor.
CREATE FUNCTION pg_temp.v2_rows(p_org_id uuid, p_pool_key text DEFAULT NULL)
RETURNS TABLE (pool_key text, id uuid, organization_id uuid, sponsored boolean)
LANGUAGE sql STABLE AS $$
  WITH v AS MATERIALIZED (
    SELECT m.id, m.organization_id, public._pool_key(m.pickup_area, m.drop_location, m.vehicle_type) AS pool_key
    FROM public.market_indents_for_org(p_org_id) m
    WHERE (m.circulation_target IS NULL OR m.circulation_target IN ('integrated_supplier', 'both'))
      AND m.organization_id IS DISTINCT FROM p_org_id
      AND lower(trim(coalesce(m.status, ''))) <> ALL (
        ARRAY['awarded', 'completed', 'cancelled', 'closed', 'expired', 'draft']::text[])
  )
  SELECT v.pool_key, v.id, v.organization_id, false FROM v
  WHERE v.pool_key IS NOT NULL AND (p_pool_key IS NULL OR v.pool_key = p_pool_key)
$$;

CREATE FUNCTION pg_temp.variants(p_step text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO npx_out (step, k, v) VALUES
    (p_step, 'VARIANT current _network_pool_rows(one lane)',
      pg_temp.ms(pg_temp.k('u_all'), format('SELECT count(*)::text FROM public._network_pool_rows(%L, %L)', pg_temp.k('B_all'), 'lane 1 pickup|lane 1 drop|20ft'), 7, 'none')),
    (p_step, 'VARIANT filter-first (one lane)',
      pg_temp.ms(pg_temp.k('u_all'), format('SELECT count(*)::text FROM pg_temp.v2_rows(%L, %L)', pg_temp.k('B_all'), 'lane 1 pickup|lane 1 drop|20ft'), 7, 'none')),
    (p_step, 'VARIANT current _network_pool_rows(all)',
      pg_temp.ms(pg_temp.k('u_all'), format('SELECT count(*)::text FROM public._network_pool_rows(%L, NULL)', pg_temp.k('B_all')), 7, 'none')),
    (p_step, 'VARIANT filter-first (all)',
      pg_temp.ms(pg_temp.k('u_all'), format('SELECT count(*)::text FROM pg_temp.v2_rows(%L, NULL)', pg_temp.k('B_all')), 7, 'none')),
    (p_step, 'VARIANT visibility count only',
      pg_temp.ms(pg_temp.k('u_all'), format('SELECT count(*)::text FROM public.market_indents_for_org(%L)', pg_temp.k('B_all')), 7, 'none'));
END $$;

-- One volume per run (npx.target, set by run_explain.sh) keeps each run under
-- the query API gateway timeout.
-- Synthetic rows only: skip row triggers while generating, restore before measuring.
SET LOCAL session_replication_role = replica;
SELECT pg_temp.gen(0, current_setting('npx.target')::int);
SET LOCAL session_replication_role = origin;
SELECT pg_temp.reach();
SELECT pg_temp.variants(current_setting('npx.target') || ' indents')
WHERE current_setting('npx.variants', true) = 'on';
SELECT pg_temp.measure(current_setting('npx.target') || ' indents')
WHERE coalesce(current_setting('npx.variants', true), 'off') <> 'on';
SELECT pg_temp.plans(current_setting('npx.target') || ' indents')
WHERE current_setting('npx.plans') = 'on';

DO $$
BEGIN
  RAISE EXCEPTION E'NPX_RESULTS\n%', (SELECT string_agg(format('[%s] %s: %s', step, k, v), E'\n' ORDER BY n) FROM npx_out);
END $$;
