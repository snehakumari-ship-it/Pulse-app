-- Server-side Network pools (Release 2, Phase A). Additive only: no existing
-- function, policy, grant or table is changed.
--
--   _network_pool_rows                 Network pool candidates for one viewing organization
--   get_org_network_pool               complete caller-scoped pool manifest with quote state
--   list_network_pool_lanes_for_org    caller-scoped Network lanes, keyset by pool_key
--
-- Visibility is market_indents_for_org(p_org_id), unchanged: the same set
-- submit_network_quote checks. A pool member is a visible row that is
-- Network-circulated (the via_link circulation test: NULL, integrated_supplier
-- or both), open, not the viewer's own load and has a complete lane. Sponsored
-- Reach indents (_indent_is_sponsored_reach, D1) are counted and kept out of
-- the pool, as on Marketplace.
--
-- Membership, completeness and the fingerprint are scoped to the viewing
-- organization: two organizations can see different members for one lane.
-- A manifest is complete only when member_count <= 150; otherwise it returns no
-- members and no quotable ids. The fingerprint is a consistency check, never an
-- authorization input: every write still goes through submit_network_quote.
-- Network and Marketplace stay independent: market_bids is never read here, so a
-- `both` load is quotable on Network whatever its Marketplace bid state.

CREATE OR REPLACE FUNCTION public._network_pool_rows(p_org_id uuid, p_pool_key text DEFAULT NULL)
RETURNS TABLE (
  pool_key text,
  pickup_key text,
  drop_key text,
  vehicle_key text,
  id uuid,
  organization_id uuid,
  creator_organization_name text,
  indent_number text,
  pickup_area text,
  drop_location text,
  vehicle_type text,
  load_type text,
  pickup_date date,
  status text,
  circulation_target text,
  supplier_target numeric,
  client_price numeric,
  weight numeric,
  created_at timestamptz,
  sponsored boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  -- Cheap row filters first; the pool key is then computed once per survivor
  -- (MATERIALIZED stops the planner from re-expanding it per reference).
  WITH v AS MATERIALIZED (
    SELECT
      public._pool_key(m.pickup_area, m.drop_location, m.vehicle_type) AS row_pool_key,
      m.id, m.organization_id, m.creator_organization_name, m.indent_number,
      m.pickup_area, m.drop_location, m.vehicle_type, m.load_type, m.pickup_date,
      m.status, m.circulation_target, m.supplier_target, m.client_price, m.weight, m.created_at
    FROM public.market_indents_for_org(p_org_id) m
    WHERE (m.circulation_target IS NULL OR m.circulation_target IN ('integrated_supplier', 'both'))
      AND m.organization_id IS DISTINCT FROM p_org_id
      -- indent_open_for_marketplace_bids on the returned row (deleted rows never come back).
      AND lower(trim(coalesce(m.status, ''))) <> ALL (
        ARRAY['awarded', 'completed', 'cancelled', 'closed', 'expired', 'draft']::text[]
      )
  )
  SELECT
    v.row_pool_key,
    public._pool_key_part(v.pickup_area),
    public._pool_key_part(v.drop_location),
    public._pool_key_part(v.vehicle_type),
    v.id,
    v.organization_id,
    v.creator_organization_name,
    v.indent_number,
    v.pickup_area,
    v.drop_location,
    v.vehicle_type,
    v.load_type,
    v.pickup_date,
    v.status,
    v.circulation_target,
    v.supplier_target,
    v.client_price,
    v.weight,
    v.created_at,
    -- _indent_is_sponsored_reach as one set (same shape as _marketplace_pool_rows).
    v.id IN (
      SELECT c.snapshot_source_indent_id
      FROM public.reach_campaigns c
      WHERE c.status = 'active'
        AND c.archived_at IS NULL
        AND (c.expires_at IS NULL OR c.expires_at > now())
        AND c.snapshot_source_indent_id IS NOT NULL
      UNION ALL
      SELECT p.source_indent_id
      FROM public.reach_campaigns c
      JOIN public.posts p ON p.id = c.post_id
      WHERE c.status = 'active'
        AND c.archived_at IS NULL
        AND (c.expires_at IS NULL OR c.expires_at > now())
        AND p.source_indent_id IS NOT NULL
    )
  FROM v
  WHERE v.row_pool_key IS NOT NULL
    AND (p_pool_key IS NULL OR v.row_pool_key = p_pool_key);
$$;

-- ── Caller-scoped Network pool manifest ──────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_org_network_pool(
  p_org_id uuid,
  p_pickup text,
  p_drop text,
  p_vehicle_type text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  c_max_members constant integer := 150;
  v_key text;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  -- Same role set as submit_network_quote and market_indents_for_org.
  IF NOT public.is_org_staff(p_org_id) THEN
    RAISE EXCEPTION 'Not a member of this organization';
  END IF;
  v_key := public._pool_key(p_pickup, p_drop, p_vehicle_type);
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'invalid_pool_key: pickup, drop and vehicle are required';
  END IF;

  WITH state AS (
    SELECT
      r.*,
      q.id AS quote_id,
      q.status AS quote_status,
      q.amount AS quote_amount,
      q.counter_amount AS quote_counter_amount,
      q.updated_at AS quote_updated_at,
      -- submit_network_quote accepts a new quote or an uncountered pending one.
      (q.id IS NULL OR (q.status = 'pending' AND q.counter_amount IS NULL)) AS quotable
    FROM public._network_pool_rows(p_org_id, v_key) r
    LEFT JOIN public.direct_quotes q
      ON q.indent_id = r.id AND q.bidder_organization_id = p_org_id
  ),
  stats AS (
    SELECT
      count(*) FILTER (WHERE NOT s.sponsored)::integer AS member_count,
      count(*) FILTER (WHERE s.sponsored)::integer AS sponsored_count,
      (count(DISTINCT s.organization_id) FILTER (WHERE NOT s.sponsored))::integer AS shipper_count,
      md5(jsonb_build_array(
        p_org_id,
        coalesce(jsonb_agg(jsonb_build_array(
          s.id, s.pickup_key, s.drop_key, s.vehicle_key, s.status, s.circulation_target,
          s.supplier_target, s.client_price, s.pickup_date, s.load_type, s.weight,
          s.sponsored, s.quote_id, s.quote_status, s.quote_amount, s.quote_counter_amount
        ) ORDER BY s.id), '[]'::jsonb)
      )::text) AS fingerprint
    FROM state s
  )
  SELECT jsonb_build_object(
    'pool_key', v_key,
    'viewing_organization_id', p_org_id,
    'as_of', now(),
    'max_members', c_max_members,
    'member_count', t.member_count,
    'shipper_count', t.shipper_count,
    'excluded_sponsored_count', t.sponsored_count,
    'complete', t.member_count <= c_max_members,
    'fingerprint', CASE WHEN t.member_count <= c_max_members THEN t.fingerprint END,
    'members', CASE WHEN t.member_count <= c_max_members THEN coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', s.id,
        'indent_number', s.indent_number,
        'pickup_area', s.pickup_area,
        'drop_location', s.drop_location,
        'vehicle_type', s.vehicle_type,
        'load_type', s.load_type,
        'pickup_date', s.pickup_date,
        'status', s.status,
        'circulation_target', s.circulation_target,
        'supplier_target', s.supplier_target,
        'client_price', s.client_price,
        'weight', s.weight,
        'organization_id', s.organization_id,
        'creator_organization_name', s.creator_organization_name,
        'created_at', s.created_at
      ) ORDER BY s.created_at DESC, s.id)
      FROM state s WHERE NOT s.sponsored
    ), '[]'::jsonb) ELSE '[]'::jsonb END,
    'quotable_ids', CASE WHEN t.member_count <= c_max_members THEN coalesce((
      SELECT jsonb_agg(s.id ORDER BY s.created_at DESC, s.id)
      FROM state s WHERE NOT s.sponsored AND s.quotable
    ), '[]'::jsonb) ELSE '[]'::jsonb END,
    'org_quotes', CASE WHEN t.member_count <= c_max_members THEN coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', s.quote_id,
        'indent_id', s.id,
        'status', s.quote_status,
        'amount', s.quote_amount,
        'counter_amount', s.quote_counter_amount,
        'quotable', s.quotable,
        'updated_at', s.quote_updated_at
      ) ORDER BY s.id)
      FROM state s WHERE NOT s.sponsored AND s.quote_id IS NOT NULL
    ), '[]'::jsonb) ELSE '[]'::jsonb END
  )
  INTO v_result
  FROM stats t;

  RETURN v_result;
END;
$$;

-- ── Caller-scoped Network pool lanes ─────────────────────────────────────

CREATE OR REPLACE FUNCTION public.list_network_pool_lanes_for_org(
  p_org_id uuid,
  p_limit integer DEFAULT 50,
  p_after_key text DEFAULT NULL
)
RETURNS TABLE (
  pool_key text,
  pickup_area text,
  drop_location text,
  vehicle_type text,
  eligible_count integer,
  sponsored_count integer,
  shipper_count integer,
  too_large boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
#variable_conflict use_column
DECLARE
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 50), 200));
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.is_org_staff(p_org_id) THEN
    RAISE EXCEPTION 'Not a member of this organization';
  END IF;

  RETURN QUERY
  SELECT
    r.pool_key,
    mode() WITHIN GROUP (ORDER BY btrim(r.pickup_area)),
    mode() WITHIN GROUP (ORDER BY btrim(r.drop_location)),
    mode() WITHIN GROUP (ORDER BY btrim(r.vehicle_type)),
    (count(*) FILTER (WHERE NOT r.sponsored))::integer,
    (count(*) FILTER (WHERE r.sponsored))::integer,
    (count(DISTINCT r.organization_id) FILTER (WHERE NOT r.sponsored))::integer,
    count(*) FILTER (WHERE NOT r.sponsored) > 150
  FROM public._network_pool_rows(p_org_id, NULL) r
  WHERE p_after_key IS NULL OR r.pool_key COLLATE "C" > p_after_key COLLATE "C"
  GROUP BY r.pool_key
  HAVING count(*) FILTER (WHERE NOT r.sponsored) > 0
  ORDER BY r.pool_key COLLATE "C"
  LIMIT v_limit;
END;
$$;

-- ── Grants ───────────────────────────────────────────────────────────────

REVOKE ALL ON FUNCTION public._network_pool_rows(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_org_network_pool(uuid, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_network_pool_lanes_for_org(uuid, integer, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_org_network_pool(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_network_pool_lanes_for_org(uuid, integer, text) TO authenticated;

COMMENT ON FUNCTION public.get_org_network_pool(uuid, text, text, text) IS
  'Complete Network pool manifest for one canonical pickup|drop|vehicle key, scoped to the viewing organization (market_indents_for_org). complete=false (over 150 members) returns no members and no quotable ids. fingerprint is a consistency check only; writes go through submit_network_quote.';
COMMENT ON FUNCTION public.list_network_pool_lanes_for_org(uuid, integer, text) IS
  'Network pool lanes visible to the viewing organization with eligible, sponsored and shipper counts, keyset by pool_key (COLLATE "C").';
