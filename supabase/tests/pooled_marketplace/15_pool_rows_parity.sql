-- Parity: the current _pool_key / _marketplace_pool_rows return exactly what the
-- 20271006181500 implementation returned. t_ref_* below are verbatim copies of
-- that implementation (per-row function calls). Labels start with "Parity:".

CREATE FUNCTION t_ref_pool_key_part(p_value text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
  SELECT lower(btrim(
    coalesce(p_value, ''),
    E' \t\n\u000B\f\r\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF'
  ));
$$;

CREATE FUNCTION t_ref_pool_key(p_pickup text, p_drop text, p_vehicle_type text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
  SELECT CASE
    WHEN public.t_ref_pool_key_part(p_pickup) = ''
      OR public.t_ref_pool_key_part(p_drop) = ''
      OR public.t_ref_pool_key_part(p_vehicle_type) = ''
    THEN NULL
    ELSE public.t_ref_pool_key_part(p_pickup) || '|'
      || public.t_ref_pool_key_part(p_drop) || '|'
      || public.t_ref_pool_key_part(p_vehicle_type)
  END;
$$;

CREATE FUNCTION t_ref_pool_rows(p_pool_key text DEFAULT NULL)
RETURNS TABLE (
  pool_key text, pickup_key text, drop_key text, vehicle_key text, id uuid,
  organization_id uuid, indent_number text, pickup_area text, drop_location text,
  vehicle_type text, load_type text, pickup_date date, status text,
  circulation_target text, deleted_at timestamptz, rate_offer numeric, weight numeric,
  created_at timestamptz, sponsored boolean
)
LANGUAGE sql STABLE SET search_path TO '' AS $$
  SELECT
    k.pool_key,
    public.t_ref_pool_key_part(i.pickup_area),
    public.t_ref_pool_key_part(i.drop_location),
    public.t_ref_pool_key_part(i.vehicle_type),
    i.id, i.organization_id, i.indent_number::text, i.pickup_area::text,
    i.drop_location::text, i.vehicle_type::text, i.load_type::text, i.pickup_date,
    i.status::text, i.circulation_target::text, i.deleted_at,
    i.supplier_target::numeric, i.weight::numeric, i.created_at,
    public._indent_is_sponsored_reach(i.id)
  FROM public.indents i
  CROSS JOIN LATERAL (
    SELECT public.t_ref_pool_key(i.pickup_area, i.drop_location, i.vehicle_type) AS pool_key
  ) k
  WHERE i.deleted_at IS NULL
    AND lower(trim(coalesce(i.circulation_target, ''))) IN ('marketplace', 'both')
    AND k.pool_key IS NOT NULL
    AND (p_pool_key IS NULL OR k.pool_key = p_pool_key)
    AND public.indent_open_for_marketplace_bids(i.id);
$$;

-- Rows of the current and reference implementations that the other lacks.
CREATE FUNCTION t_pool_rows_diff(p_key text) RETURNS bigint LANGUAGE sql AS $$
  SELECT (SELECT count(*) FROM (
            SELECT * FROM public._marketplace_pool_rows(p_key)
            EXCEPT ALL SELECT * FROM t_ref_pool_rows(p_key)) a)
       + (SELECT count(*) FROM (
            SELECT * FROM t_ref_pool_rows(p_key)
            EXCEPT ALL SELECT * FROM public._marketplace_pool_rows(p_key)) b)
$$;

CREATE FUNCTION t_px(
  p_org uuid, p_pickup text, p_drop text, p_vehicle text,
  p_circ text, p_status text DEFAULT 'open', p_deleted boolean DEFAULT false
) RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO public.indents (
    organization_id, indent_number, pickup_area, drop_location, vehicle_type,
    circulation_target, status, supplier_target, client_name, load_type, pickup_date, weight, deleted_at
  ) VALUES (
    p_org, 'PX-' || substr(md5(random()::text), 1, 8), p_pickup, p_drop, p_vehicle,
    p_circ, p_status, 20000, 'Client', 'FTL', DATE '2026-10-10', 9000,
    CASE WHEN p_deleted THEN now() END
  ) RETURNING id
$$;

CREATE FUNCTION t_in_pool(p_id uuid, p_key text DEFAULT NULL) RETURNS boolean LANGUAGE sql AS $$
  SELECT EXISTS (SELECT 1 FROM public._marketplace_pool_rows(p_key) r WHERE r.id = p_id)
$$;

-- ── Canonical pool key ───────────────────────────────────────────────────
DO $$
DECLARE
  v_parts text[] := ARRAY[
    NULL, '', ' ', 'Px Lane', 'PX LANE', '  px lane  ', E'\tpx lane\n', E'\u00A0Px Lane\u3000',
    E'\uFEFFpx lane\u2009', 'px  lane', E'px\u00A0lane', 'İstanbul', 'ÄRZTE', E'\u200Bpx lane',
    E'\u0085px lane', '32 FT MXL', ' 32 ft mxl', '|', 'a|b'
  ];
  v_mismatch bigint;
  v_ws text;
BEGIN
  SELECT count(*) INTO v_mismatch
  FROM unnest(v_parts) a, unnest(v_parts) b, unnest(v_parts) c
  WHERE public._pool_key(a, b, c) IS DISTINCT FROM t_ref_pool_key(a, b, c);
  PERFORM t_ok('Parity: _pool_key equals the previous key over 6,859 part combinations (NULL, blank, Unicode whitespace, case, inner spacing)',
    v_mismatch = 0, v_mismatch::text);

  SELECT count(*) INTO v_mismatch FROM unnest(v_parts) a
  WHERE public._pool_key_part(a) IS DISTINCT FROM t_ref_pool_key_part(a);
  PERFORM t_ok('Parity: _pool_key_part equals the previous normalization', v_mismatch = 0, v_mismatch::text);

  -- Each trimmed code point on its own, at both ends.
  SELECT count(*) INTO v_mismatch
  FROM regexp_split_to_table(
    E' \t\n\u000B\f\r\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF', '') w
  WHERE public._pool_key_part(w || 'Px' || w) IS DISTINCT FROM t_ref_pool_key_part(w || 'Px' || w)
     OR public._pool_key_part(w || 'Px' || w) <> 'px';
  PERFORM t_ok('Parity: every trimmed whitespace code point is stripped identically', v_mismatch = 0, v_mismatch::text);

  SELECT count(*) INTO v_mismatch FROM public.indents i
  WHERE public._pool_key(i.pickup_area, i.drop_location, i.vehicle_type)
        IS DISTINCT FROM t_ref_pool_key(i.pickup_area, i.drop_location, i.vehicle_type);
  PERFORM t_ok('Parity: _pool_key equals the previous key for every indent row', v_mismatch = 0, v_mismatch::text);

END $$;

-- ── Pool rows: open, circulation, deleted, sponsored ─────────────────────
DO $$
DECLARE
  k text := public._pool_key('PX Pickup', 'PX Drop', 'PX Truck');
  st text;
  circ text;
  v uuid;
  ids_status jsonb := '{}';
  ids_circ jsonb := '{}';
  d_mkt uuid;
  d_both uuid;
  n_space uuid; n_tab uuid; n_nbsp uuid; n_case uuid; n_blank uuid; n_nullveh uuid;
  s_active uuid; s_post uuid; s_expired uuid; s_archived uuid; s_completed uuid; s_draft uuid; s_future uuid;
  p uuid;
BEGIN
  FOREACH st IN ARRAY ARRAY['draft', 'broadcast', 'open', 'pending', 'quoted', 'awarded', 'completed', 'expired', 'cancelled', 'closed'] LOOP
    ids_status := ids_status || jsonb_build_object(st, t_px(t_id('SHIP2'), 'PX Pickup', 'PX Drop', 'PX Truck', 'marketplace', st));
  END LOOP;
  FOREACH circ IN ARRAY ARRAY['marketplace', 'both', 'Marketplace', ' BOTH ', 'network', 'integrated_supplier', '', 'marketplace_only'] LOOP
    ids_circ := ids_circ || jsonb_build_object(circ, t_px(t_id('SHIP2'), 'PX Pickup', 'PX Drop', 'PX Truck', circ));
  END LOOP;
  v := t_px(t_id('SHIP2'), 'PX Pickup', 'PX Drop', 'PX Truck', NULL);
  ids_circ := ids_circ || jsonb_build_object('<null>', v);

  d_mkt := t_px(t_id('SHIP2'), 'PX Pickup', 'PX Drop', 'PX Truck', 'marketplace', 'open', true);
  d_both := t_px(t_id('SHIP2'), 'PX Pickup', 'PX Drop', 'PX Truck', 'both', 'broadcast', true);

  n_space := t_px(t_id('SHIP1'), '  px pickup ', 'PX DROP', ' px truck', 'marketplace');
  n_tab := t_px(t_id('SHIP1'), E'\tPX Pickup\n', 'px drop', 'PX TRUCK', 'both');
  n_nbsp := t_px(t_id('SHIP2'), E'\u00A0Px Pickup\u3000', E'px drop\uFEFF', 'px truck', 'marketplace');
  n_case := t_px(t_id('SHIP2'), 'PX  Pickup', 'PX Drop', 'PX Truck', 'marketplace');
  n_blank := t_px(t_id('SHIP2'), '   ', 'PX Drop', 'PX Truck', 'marketplace');
  n_nullveh := t_px(t_id('SHIP2'), 'PX Pickup', 'PX Drop', NULL, 'marketplace');

  s_active := t_px(t_id('SHIP2'), 'PX Pickup', 'PX Drop', 'PX Truck', 'marketplace');
  s_post := t_px(t_id('SHIP2'), 'PX Pickup', 'PX Drop', 'PX Truck', 'both');
  s_expired := t_px(t_id('SHIP2'), 'PX Pickup', 'PX Drop', 'PX Truck', 'marketplace');
  s_archived := t_px(t_id('SHIP2'), 'PX Pickup', 'PX Drop', 'PX Truck', 'marketplace');
  s_completed := t_px(t_id('SHIP2'), 'PX Pickup', 'PX Drop', 'PX Truck', 'marketplace');
  s_draft := t_px(t_id('SHIP2'), 'PX Pickup', 'PX Drop', 'PX Truck', 'marketplace');
  s_future := t_px(t_id('SHIP2'), 'PX Pickup', 'PX Drop', 'PX Truck', 'marketplace');
  PERFORM t_campaign('active', s_active);
  p := t_post(s_post);
  PERFORM t_campaign('active', NULL, p);
  PERFORM t_campaign('active', s_expired, NULL, now() - interval '1 minute');
  PERFORM t_campaign('active', s_archived, NULL, NULL, now());
  PERFORM t_campaign('completed', s_completed);
  PERFORM t_campaign('draft', s_draft);
  PERFORM t_campaign('active', s_future, NULL, now() + interval '1 hour');

  -- Open: exactly the statuses indent_open_for_marketplace_bids accepts.
  PERFORM t_ok('Parity: open/closed statuses — inclusion equals indent_open_for_marketplace_bids for all 10 statuses',
    (SELECT bool_and(t_in_pool((e.value #>> '{}')::uuid, k) = public.indent_open_for_marketplace_bids((e.value #>> '{}')::uuid))
     FROM jsonb_each(ids_status) e), ids_status::text);
  PERFORM t_ok('Parity: open, broadcast, pending, quoted are pool members; draft and terminal statuses are not',
    (SELECT array_agg(e.key ORDER BY e.key COLLATE "C") FROM jsonb_each(ids_status) e WHERE t_in_pool((e.value #>> '{}')::uuid, k))
    = ARRAY['broadcast', 'open', 'pending', 'quoted']);

  PERFORM t_ok('Parity: Marketplace circulation (any case/padding) and both are members; network, integrated, blank, unknown and NULL are not',
    (SELECT array_agg(e.key ORDER BY e.key COLLATE "C") FROM jsonb_each(ids_circ) e WHERE t_in_pool((e.value #>> '{}')::uuid, k))
    = ARRAY[' BOTH ', 'Marketplace', 'both', 'marketplace']);

  PERFORM t_ok('Parity: deleted indents are excluded', NOT t_in_pool(d_mkt) AND NOT t_in_pool(d_both));

  PERFORM t_ok('Parity: padded, tab, NBSP/ideographic/BOM spellings join the canonical lane',
    t_in_pool(n_space, k) AND t_in_pool(n_tab, k) AND t_in_pool(n_nbsp, k));
  PERFORM t_ok('Parity: inner double space is a different lane; blank or NULL part is never a member',
    NOT t_in_pool(n_case, k) AND t_in_pool(n_case) AND NOT t_in_pool(n_blank) AND NOT t_in_pool(n_nullveh));

  PERFORM t_ok('Parity: sponsored flag equals _indent_is_sponsored_reach for every pool row',
    NOT EXISTS (SELECT 1 FROM public._marketplace_pool_rows(NULL) r
                WHERE r.sponsored IS DISTINCT FROM public._indent_is_sponsored_reach(r.id)));
  PERFORM t_ok('Parity: sponsored is never NULL', NOT EXISTS (SELECT 1 FROM public._marketplace_pool_rows(NULL) r WHERE r.sponsored IS NULL));
  PERFORM t_ok('Parity: active (snapshot), active (post link) and future-expiry campaigns mark the indent sponsored',
    (SELECT bool_and(r.sponsored) FROM public._marketplace_pool_rows(k) r WHERE r.id IN (s_active, s_post, s_future))
    AND (SELECT count(*) FROM public._marketplace_pool_rows(k) r WHERE r.id IN (s_active, s_post, s_future)) = 3);
  PERFORM t_ok('Parity: expired, archived, completed and draft campaigns do not',
    (SELECT bool_and(NOT r.sponsored) FROM public._marketplace_pool_rows(k) r WHERE r.id IN (s_expired, s_archived, s_completed, s_draft))
    AND (SELECT count(*) FROM public._marketplace_pool_rows(k) r WHERE r.id IN (s_expired, s_archived, s_completed, s_draft)) = 4);

  PERFORM t_ok('Parity: PX lane rows identical to the previous implementation (all columns)', t_pool_rows_diff(k) = 0, t_pool_rows_diff(k)::text);
  PERFORM t_ok('Parity: all pool rows identical to the previous implementation (every indent in the database, all columns)',
    t_pool_rows_diff(NULL) = 0, t_pool_rows_diff(NULL)::text);
  PERFORM t_ok('Parity: every lane key returns identical rows',
    NOT EXISTS (SELECT 1 FROM (SELECT DISTINCT r.pool_key FROM t_ref_pool_rows(NULL) r) l WHERE t_pool_rows_diff(l.pool_key) <> 0));
END $$;

-- ── DCO and organization visibility on the PX lane ───────────────────────
DO $$
DECLARE
  k text := public._pool_key('PX Pickup', 'PX Drop', 'PX Truck');
  r jsonb;
  ref uuid[];
  lane record;
BEGIN
  r := t_dco_pool(t_id('u_dco'), 'PX Pickup', 'PX Drop', 'PX Truck');
  ref := t_sort(ARRAY(SELECT x.id FROM t_ref_pool_rows(k) x WHERE NOT x.sponsored));
  PERFORM t_ok('Parity: DCO manifest members equal the previous non-sponsored pool rows', t_uuids(r -> 'members', 'id') = ref, r::text);
  PERFORM t_ok('Parity: DCO excluded_sponsored_count equals the previous sponsored count',
    (r ->> 'excluded_sponsored_count')::int = (SELECT count(*) FROM t_ref_pool_rows(k) x WHERE x.sponsored));

  r := t_dco_pool(t_id('u_dco_m'), 'PX Pickup', 'PX Drop', 'PX Truck');
  PERFORM t_ok('Parity: shipper-member DCO still excludes own-shipper rows',
    t_uuids(r -> 'members', 'id') = t_sort(ARRAY(SELECT x.id FROM t_ref_pool_rows(k) x WHERE NOT x.sponsored AND x.organization_id <> t_id('SHIP1'))), r::text);

  r := t_org_pool(t_id('u_bid1'), t_id('B1'), 'PX Pickup', 'PX Drop', 'PX Truck');
  PERFORM t_ok('Parity: org manifest members equal the previous non-sponsored pool rows of other orgs',
    t_uuids(r -> 'members', 'id') = t_sort(ARRAY(SELECT x.id FROM t_ref_pool_rows(k) x WHERE NOT x.sponsored AND x.organization_id <> t_id('B1'))), r::text);

  r := t_org_pool(t_id('u_ship'), t_id('SHIP1'), 'PX Pickup', 'PX Drop', 'PX Truck');
  PERFORM t_ok('Parity: org manifest still excludes the viewing org''s own indents',
    t_uuids(r -> 'members', 'id') = t_sort(ARRAY(SELECT x.id FROM t_ref_pool_rows(k) x WHERE NOT x.sponsored AND x.organization_id <> t_id('SHIP1'))), r::text);

  r := t_exec_as(t_id('u_dco'), format(
    'SELECT to_jsonb(l) FROM public.list_dco_marketplace_pool_lanes(200, %L) l WHERE l.pool_key = %L', left(k, -1), k));
  PERFORM t_ok('Parity: DCO lane counts equal the previous pool rows',
    (r ->> 'eligible_count')::int = (SELECT count(*) FROM t_ref_pool_rows(k) x WHERE NOT x.sponsored)
    AND (r ->> 'sponsored_count')::int = (SELECT count(*) FROM t_ref_pool_rows(k) x WHERE x.sponsored), coalesce(r::text, 'no lane'));

  r := t_exec_as(t_id('u_bid1'), format(
    'SELECT to_jsonb(l) FROM public.list_marketplace_pool_lanes_for_org(%L, 200, %L) l WHERE l.pool_key = %L', t_id('B1'), left(k, -1), k));
  PERFORM t_ok('Parity: org lane counts equal the previous pool rows',
    (r ->> 'eligible_count')::int = (SELECT count(*) FROM t_ref_pool_rows(k) x WHERE NOT x.sponsored AND x.organization_id <> t_id('B1'))
    AND (r ->> 'sponsored_count')::int = (SELECT count(*) FROM t_ref_pool_rows(k) x WHERE x.sponsored AND x.organization_id <> t_id('B1')),
    coalesce(r::text, 'no lane'));
END $$;
