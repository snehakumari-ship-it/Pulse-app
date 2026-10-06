-- Pooled Marketplace backend regression + security suite (S1, Network quote,
-- DCO manifest, My Bids completeness, D1 sponsored consistency, grants).
-- Each check prints "PASS: ..."; the first failure raises "FAIL ..." and stops.
-- Shared helpers. Fixtures: 06_fixtures_stub.sql (local) or 06_fixtures_real.sql.

SET client_min_messages = notice;

-- ── Harness helpers ──────────────────────────────────────────────────────

CREATE TABLE t_ids (name text PRIMARY KEY, id uuid NOT NULL);
INSERT INTO t_ids VALUES
  ('SHIP1',    'e1000000-0000-0000-0000-000000000001'),
  ('SHIP2',    'e1000000-0000-0000-0000-000000000002'),
  ('B1',       'e1000000-0000-0000-0000-000000000003'),
  ('B2',       'e1000000-0000-0000-0000-000000000004'),
  ('u_ship',   'e2000000-0000-0000-0000-000000000001'),
  ('u_bid1',   'e2000000-0000-0000-0000-000000000002'),
  ('u_bid2',   'e2000000-0000-0000-0000-000000000003'),
  ('u_other',  'e2000000-0000-0000-0000-000000000004'),
  ('u_dco',    'e2000000-0000-0000-0000-000000000005'),
  ('u_dco_m',  'e2000000-0000-0000-0000-000000000006'),
  ('u_drv_ne', 'e2000000-0000-0000-0000-000000000007'),
  ('u_plain',  'e2000000-0000-0000-0000-000000000008'),
  ('V1',       'e3000000-0000-0000-0000-000000000001'),
  ('V2',       'e3000000-0000-0000-0000-000000000002');
GRANT SELECT ON t_ids TO PUBLIC;

CREATE FUNCTION t_id(p_name text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT id FROM t_ids WHERE name = p_name
$$;

CREATE FUNCTION t_as(p_uid uuid, p_role text DEFAULT 'authenticated') RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), false);
  PERFORM set_config('role', p_role, false);
END $$;

CREATE FUNCTION t_admin() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'none', false);
  PERFORM set_config('request.jwt.claim.sub', '', false);
END $$;

CREATE TABLE t_log (n serial PRIMARY KEY, label text NOT NULL);
GRANT ALL ON t_log TO PUBLIC;
GRANT ALL ON SEQUENCE t_log_n_seq TO PUBLIC;

-- Environment switches set by the fixture file (stub vs real schema).
CREATE TABLE t_cfgs (k text PRIMARY KEY, v boolean NOT NULL);
GRANT SELECT ON t_cfgs TO PUBLIC;
CREATE FUNCTION t_cfg(p_k text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT v FROM t_cfgs WHERE k = p_k
$$;

CREATE FUNCTION t_pass(p_label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO t_log (label) VALUES (p_label);
  RAISE NOTICE 'PASS: %', p_label;
END $$;

-- psql runs print the banner; the real-schema run (one implicit transaction)
-- raises it so that nothing the suite wrote is ever committed.
CREATE FUNCTION t_done() RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_scen int := (SELECT count(*) FROM t_log WHERE label NOT LIKE 'Parity:%');
  v_par int := (SELECT count(*) FROM t_log WHERE label LIKE 'Parity:%');
BEGIN
  IF t_cfg('raise_on_done') THEN
    RAISE EXCEPTION 'HARNESS_COMPLETE: ALL % POOLED MARKETPLACE BACKEND CHECKS PASSED + % PARITY CHECKS (transaction rolled back)', v_scen, v_par;
  END IF;
  RAISE NOTICE 'ALL % POOLED MARKETPLACE BACKEND CHECKS PASSED + % PARITY CHECKS', v_scen, v_par;
END $$;

CREATE FUNCTION t_ok(p_label text, p_cond boolean, p_detail text DEFAULT '') RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_cond IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL %: %', p_label, p_detail;
  END IF;
  PERFORM t_pass(p_label);
END $$;

CREATE FUNCTION t_exec_as(p_uid uuid, p_sql text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v jsonb;
BEGIN
  PERFORM t_as(p_uid);
  BEGIN
    EXECUTE p_sql INTO v;
  EXCEPTION WHEN OTHERS THEN
    PERFORM t_admin();
    RAISE;
  END;
  PERFORM t_admin();
  RETURN v;
END $$;

CREATE FUNCTION t_err_as(p_label text, p_uid uuid, p_sql text, p_prefix text, p_role text DEFAULT 'authenticated')
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_err text;
BEGIN
  PERFORM t_as(p_uid, p_role);
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;
  PERFORM t_admin();
  IF v_err IS NULL THEN
    RAISE EXCEPTION 'FAIL %: expected "%", call succeeded', p_label, p_prefix;
  END IF;
  IF position(p_prefix IN v_err) <> 1 THEN
    RAISE EXCEPTION 'FAIL %: expected "%", got "%"', p_label, p_prefix, v_err;
  END IF;
  PERFORM t_pass(format('%s [%s]', p_label, v_err));
END $$;

CREATE FUNCTION t_indent(
  p_org uuid, p_pickup text, p_drop text, p_vehicle text,
  p_circ text DEFAULT 'marketplace', p_status text DEFAULT 'open'
) RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO public.indents (
    organization_id, indent_number, pickup_area, drop_location, vehicle_type,
    circulation_target, status, supplier_target, client_name, load_type, pickup_date, weight
  ) VALUES (
    p_org, 'T-' || substr(md5(random()::text), 1, 8), p_pickup, p_drop, p_vehicle,
    p_circ, p_status, 20000, 'Client', 'FTL', DATE '2026-10-10', 9000
  ) RETURNING id
$$;

CREATE FUNCTION t_sort(p uuid[]) RETURNS uuid[] LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(array_agg(x ORDER BY x), '{}') FROM unnest(p) x
$$;

-- Sorted uuids from a jsonb array of strings, or of objects when p_key is set.
CREATE FUNCTION t_uuids(p jsonb, p_key text DEFAULT NULL) RETURNS uuid[] LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(array_agg(x ORDER BY x), '{}') FROM (
    SELECT CASE WHEN p_key IS NULL THEN (e #>> '{}')::uuid ELSE (e ->> p_key)::uuid END AS x
    FROM jsonb_array_elements(coalesce(p, '[]'::jsonb)) e
  ) s
$$;

CREATE FUNCTION t_find(p jsonb, p_key text, p_val text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT e FROM jsonb_array_elements(coalesce(p, '[]'::jsonb)) e WHERE e ->> p_key = p_val LIMIT 1
$$;

CREATE FUNCTION t_dco_pool(p_uid uuid, p_pickup text, p_drop text, p_vehicle text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT t_exec_as(p_uid, format('SELECT public.get_dco_marketplace_pool(%L, %L, %L)', p_pickup, p_drop, p_vehicle))
$$;

CREATE FUNCTION t_org_pool(p_uid uuid, p_org uuid, p_pickup text, p_drop text, p_vehicle text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT t_exec_as(p_uid, format('SELECT public.get_org_marketplace_pool(%L, %L, %L, %L)', p_org, p_pickup, p_drop, p_vehicle))
$$;

CREATE FUNCTION t_bid(p_uid uuid, p_indent uuid, p_amount numeric, p_org uuid, p_vehicle uuid) RETURNS jsonb LANGUAGE sql AS $$
  SELECT t_exec_as(p_uid, format('SELECT public.submit_market_bid(%L, %s, NULL, %L, %L)', p_indent, p_amount, p_org, p_vehicle))
$$;

CREATE FUNCTION t_bid_sql(p_indent uuid, p_amount numeric, p_org uuid, p_vehicle uuid) RETURNS text LANGUAGE sql AS $$
  SELECT format('SELECT public.submit_market_bid(%L, %s, NULL, %L, %L)', p_indent, p_amount, p_org, p_vehicle)
$$;

CREATE FUNCTION t_quote_sql(p_indent uuid, p_org uuid, p_amount numeric) RETURNS text LANGUAGE sql AS $$
  SELECT format('SELECT public.submit_network_quote(%L, %L, %s, NULL)', p_indent, p_org, p_amount)
$$;
