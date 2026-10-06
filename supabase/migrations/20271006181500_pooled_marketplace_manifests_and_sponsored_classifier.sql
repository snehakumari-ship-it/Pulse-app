-- Pooled Marketplace completion (D1, D5; design steps 3–5). Additive only:
-- no existing function, policy, grant or table is changed.
--
--   _pool_key_part / _pool_key          canonical pool identity (pooledOpportunity.util poolKeyId)
--   _indent_is_sponsored_reach          D1: sponsored is a property of the indent, not of the viewer
--   _marketplace_pool_rows              open, Marketplace-circulated indents with a complete lane
--   get_dco_marketplace_pool            complete DCO pool manifest (members, own bids, fingerprint)
--   list_dco_marketplace_pool_lanes     DCO pool lanes with eligible counts, keyset by pool_key
--   get_org_marketplace_pool            complete org pool manifest with organization bid state
--   list_marketplace_pool_lanes_for_org org pool lanes with eligible counts, keyset by pool_key
--   classify_indents_for_pooling        sponsored classification of indents the org can already see
--
-- A manifest is complete only when member_count <= 150; otherwise it returns no
-- members and no biddable ids, so a pooled submission has nothing to write.
-- The fingerprint is a client consistency check, never an authorization input:
-- every write still goes through submit_market_bid, which validates the indent.

-- ── Canonical pool identity ──────────────────────────────────────────────
-- Same as canonicalPoolField: JS String.prototype.trim() whitespace set, then lower().

CREATE OR REPLACE FUNCTION public._pool_key_part(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path TO ''
AS $$
  SELECT lower(btrim(
    coalesce(p_value, ''),
    E' \t\n\u000B\f\r\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF'
  ));
$$;

-- NULL when any part is blank: such a load is never a pool member.
CREATE OR REPLACE FUNCTION public._pool_key(p_pickup text, p_drop text, p_vehicle_type text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path TO ''
AS $$
  SELECT CASE
    WHEN public._pool_key_part(p_pickup) = ''
      OR public._pool_key_part(p_drop) = ''
      OR public._pool_key_part(p_vehicle_type) = ''
    THEN NULL
    ELSE public._pool_key_part(p_pickup) || '|'
      || public._pool_key_part(p_drop) || '|'
      || public._pool_key_part(p_vehicle_type)
  END;
$$;

-- ── D1 sponsored classification ──────────────────────────────────────────
-- Viewer release and targeting are deliberately not part of this predicate.

CREATE OR REPLACE FUNCTION public._indent_is_sponsored_reach(p_indent_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.reach_campaigns c
    WHERE c.status = 'active'
      AND c.archived_at IS NULL
      AND (c.expires_at IS NULL OR c.expires_at > now())
      AND (
        c.snapshot_source_indent_id = p_indent_id
        OR EXISTS (
          SELECT 1 FROM public.posts p
          WHERE p.id = c.post_id AND p.source_indent_id = p_indent_id
        )
      )
  );
$$;

-- ── Pool candidate rows ──────────────────────────────────────────────────
-- Open + Marketplace circulation is the same predicate as the Marketplace feeds.
-- Viewer exclusions (own organization) are applied by each caller.

CREATE OR REPLACE FUNCTION public._marketplace_pool_rows(p_pool_key text DEFAULT NULL)
RETURNS TABLE (
  pool_key text,
  pickup_key text,
  drop_key text,
  vehicle_key text,
  id uuid,
  organization_id uuid,
  indent_number text,
  pickup_area text,
  drop_location text,
  vehicle_type text,
  load_type text,
  pickup_date date,
  status text,
  circulation_target text,
  deleted_at timestamptz,
  rate_offer numeric,
  weight numeric,
  created_at timestamptz,
  sponsored boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT
    k.pool_key,
    public._pool_key_part(i.pickup_area),
    public._pool_key_part(i.drop_location),
    public._pool_key_part(i.vehicle_type),
    i.id,
    i.organization_id,
    i.indent_number::text,
    i.pickup_area::text,
    i.drop_location::text,
    i.vehicle_type::text,
    i.load_type::text,
    i.pickup_date,
    i.status::text,
    i.circulation_target::text,
    i.deleted_at,
    i.supplier_target::numeric,
    i.weight::numeric,
    i.created_at,
    public._indent_is_sponsored_reach(i.id)
  FROM public.indents i
  CROSS JOIN LATERAL (
    SELECT public._pool_key(i.pickup_area, i.drop_location, i.vehicle_type) AS pool_key
  ) k
  WHERE i.deleted_at IS NULL
    AND lower(trim(coalesce(i.circulation_target, ''))) IN ('marketplace', 'both')
    AND k.pool_key IS NOT NULL
    AND (p_pool_key IS NULL OR k.pool_key = p_pool_key)
    AND public.indent_open_for_marketplace_bids(i.id);
$$;

-- ── DCO caller gate (same gates as list_open_marketplace_loads_for_fleet_owner) ──

CREATE OR REPLACE FUNCTION public._assert_dco_marketplace_caller()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT p.role INTO v_role FROM public.profiles p WHERE p.id = v_uid;
  IF v_role IS DISTINCT FROM 'driver' THEN
    RAISE EXCEPTION 'Only drivers can list fleet-owner marketplace loads';
  END IF;

  IF NOT public.is_dco_marketplace_eligible(v_uid) THEN
    RAISE EXCEPTION 'marketplace_access_denied: approved, independent DCO status with an active vehicle is required';
  END IF;

  RETURN v_uid;
END;
$$;

-- ── DCO pool manifest ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_dco_marketplace_pool(
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
  v_uid uuid := public._assert_dco_marketplace_caller();
  v_key text := public._pool_key(p_pickup, p_drop, p_vehicle_type);
  v_result jsonb;
BEGIN
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'invalid_pool_key: pickup, drop and vehicle are required';
  END IF;

  WITH candidate AS (
    SELECT r.*, b.id AS bid_id, b.status AS bid_status, b.amount AS bid_amount,
           b.fee_payment_status AS bid_fee_payment_status, b.updated_at AS bid_updated_at
    FROM public._marketplace_pool_rows(v_key) r
    LEFT JOIN public.market_bids b
      ON b.indent_id = r.id AND b.bidder_user_id = v_uid
    -- submit_market_bid refuses own_indent for a DCO who belongs to the shipper.
    WHERE NOT EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.organization_id = r.organization_id
        AND om.user_id = v_uid
        AND om.status = 'active'
    )
  ),
  stats AS (
    SELECT
      count(*) FILTER (WHERE NOT c.sponsored)::integer AS member_count,
      count(*) FILTER (WHERE c.sponsored)::integer AS sponsored_count,
      md5(coalesce(jsonb_agg(jsonb_build_array(
        c.id, c.pickup_key, c.drop_key, c.vehicle_key, c.status, c.circulation_target,
        c.deleted_at, c.rate_offer, c.pickup_date, c.load_type, c.weight,
        c.sponsored, c.bid_status
      ) ORDER BY c.id), '[]'::jsonb)::text) AS fingerprint
    FROM candidate c
  )
  SELECT jsonb_build_object(
    'pool_key', v_key,
    'as_of', now(),
    'max_members', c_max_members,
    'member_count', s.member_count,
    'excluded_sponsored_count', s.sponsored_count,
    'complete', s.member_count <= c_max_members,
    'fingerprint', CASE WHEN s.member_count <= c_max_members THEN s.fingerprint END,
    'members', CASE WHEN s.member_count <= c_max_members THEN coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', c.id,
        'indent_number', c.indent_number,
        'pickup_area', c.pickup_area,
        'drop_location', c.drop_location,
        'vehicle_type', c.vehicle_type,
        'load_type', c.load_type,
        'pickup_date', c.pickup_date,
        'status', c.status,
        'circulation_target', c.circulation_target,
        'rate_offer', c.rate_offer,
        'weight', c.weight,
        'creator_organization_id', c.organization_id,
        'created_at', c.created_at
      ) ORDER BY c.created_at DESC, c.id)
      FROM candidate c WHERE NOT c.sponsored
    ), '[]'::jsonb) ELSE '[]'::jsonb END,
    'biddable_ids', CASE WHEN s.member_count <= c_max_members THEN coalesce((
      SELECT jsonb_agg(c.id ORDER BY c.created_at DESC, c.id)
      FROM candidate c
      WHERE NOT c.sponsored AND (c.bid_status IS NULL OR c.bid_status = 'pending')
    ), '[]'::jsonb) ELSE '[]'::jsonb END,
    'my_bids', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', c.bid_id,
        'indent_id', c.id,
        'status', c.bid_status,
        'amount', c.bid_amount,
        'fee_payment_status', c.bid_fee_payment_status,
        'updated_at', c.bid_updated_at
      ) ORDER BY c.id)
      FROM candidate c WHERE c.bid_id IS NOT NULL
    ), '[]'::jsonb)
  )
  INTO v_result
  FROM stats s;

  RETURN v_result;
END;
$$;

-- ── DCO pool lanes ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.list_dco_marketplace_pool_lanes(
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
  too_large boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
#variable_conflict use_column
DECLARE
  v_uid uuid := public._assert_dco_marketplace_caller();
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 50), 200));
BEGIN
  RETURN QUERY
  SELECT
    r.pool_key,
    mode() WITHIN GROUP (ORDER BY btrim(r.pickup_area)),
    mode() WITHIN GROUP (ORDER BY btrim(r.drop_location)),
    mode() WITHIN GROUP (ORDER BY btrim(r.vehicle_type)),
    (count(*) FILTER (WHERE NOT r.sponsored))::integer,
    (count(*) FILTER (WHERE r.sponsored))::integer,
    count(*) FILTER (WHERE NOT r.sponsored) > 150
  FROM public._marketplace_pool_rows(NULL) r
  WHERE NOT EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.organization_id = r.organization_id
        AND om.user_id = v_uid
        AND om.status = 'active'
    )
    AND (p_after_key IS NULL OR r.pool_key COLLATE "C" > p_after_key COLLATE "C")
  GROUP BY r.pool_key
  HAVING count(*) FILTER (WHERE NOT r.sponsored) > 0
  ORDER BY r.pool_key COLLATE "C"
  LIMIT v_limit;
END;
$$;

-- ── Organization pool manifest (D5 organization bid state) ───────────────
-- Organization state per indent: accepted > pending > rejected > superseded > withdrawn;
-- the caller's own bid wins a tie. A colleague's pending/accepted bid blocks the indent.

CREATE OR REPLACE FUNCTION public.get_org_marketplace_pool(
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
  v_uid uuid := auth.uid();
  v_key text;
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.is_org_member(p_org_id) THEN
    RAISE EXCEPTION 'Not a member of this organization';
  END IF;
  v_key := public._pool_key(p_pickup, p_drop, p_vehicle_type);
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'invalid_pool_key: pickup, drop and vehicle are required';
  END IF;

  WITH candidate AS (
    SELECT r.*
    FROM public._marketplace_pool_rows(v_key) r
    WHERE r.organization_id IS DISTINCT FROM p_org_id
  ),
  org_bid AS (
    SELECT b.*,
      CASE b.status
        WHEN 'accepted' THEN 5 WHEN 'pending' THEN 4 WHEN 'rejected' THEN 3
        WHEN 'superseded' THEN 2 WHEN 'withdrawn' THEN 1 ELSE 0
      END AS rank,
      b.bidder_user_id = v_uid AS is_mine
    FROM public.market_bids b
    JOIN candidate c ON c.id = b.indent_id
    WHERE b.bidder_organization_id = p_org_id
  ),
  state AS (
    SELECT
      c.*,
      shown.id AS bid_id,
      shown.status AS org_state,
      shown.amount AS bid_amount,
      shown.fee_payment_status AS bid_fee_payment_status,
      shown.is_mine AS bid_is_mine,
      shown.updated_at AS bid_updated_at,
      mine.status AS my_status,
      EXISTS (
        SELECT 1 FROM org_bid ob
        WHERE ob.indent_id = c.id AND NOT ob.is_mine AND ob.status IN ('pending', 'accepted')
      ) AS colleague_live
    FROM candidate c
    LEFT JOIN LATERAL (
      SELECT ob.* FROM org_bid ob
      WHERE ob.indent_id = c.id
      ORDER BY ob.rank DESC, ob.is_mine DESC, ob.updated_at DESC, ob.id
      LIMIT 1
    ) shown ON true
    LEFT JOIN LATERAL (
      SELECT ob.status FROM org_bid ob WHERE ob.indent_id = c.id AND ob.is_mine LIMIT 1
    ) mine ON true
  ),
  stats AS (
    SELECT
      count(*) FILTER (WHERE NOT s.sponsored)::integer AS member_count,
      count(*) FILTER (WHERE s.sponsored)::integer AS sponsored_count,
      md5(coalesce(jsonb_agg(jsonb_build_array(
        s.id, s.pickup_key, s.drop_key, s.vehicle_key, s.status, s.circulation_target,
        s.deleted_at, s.rate_offer, s.pickup_date, s.load_type, s.weight,
        s.sponsored, s.my_status, s.org_state, s.colleague_live
      ) ORDER BY s.id), '[]'::jsonb)::text) AS fingerprint
    FROM state s
  )
  SELECT jsonb_build_object(
    'pool_key', v_key,
    'as_of', now(),
    'max_members', c_max_members,
    'member_count', t.member_count,
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
        'rate_offer', s.rate_offer,
        'weight', s.weight,
        'creator_organization_id', s.organization_id,
        'created_at', s.created_at
      ) ORDER BY s.created_at DESC, s.id)
      FROM state s WHERE NOT s.sponsored
    ), '[]'::jsonb) ELSE '[]'::jsonb END,
    'biddable_ids', CASE WHEN t.member_count <= c_max_members THEN coalesce((
      SELECT jsonb_agg(s.id ORDER BY s.created_at DESC, s.id)
      FROM state s
      WHERE NOT s.sponsored
        AND NOT s.colleague_live
        AND (s.my_status IS NULL OR s.my_status = 'pending')
    ), '[]'::jsonb) ELSE '[]'::jsonb END,
    'organization_blocked', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'indent_id', s.id,
        'reason', 'already_bid_by_your_organization',
        'message', 'already bid by your organization'
      ) ORDER BY s.id)
      FROM state s WHERE NOT s.sponsored AND s.colleague_live
    ), '[]'::jsonb),
    'org_bids', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', s.bid_id,
        'indent_id', s.id,
        'status', s.org_state,
        'amount', s.bid_amount,
        'fee_payment_status', s.bid_fee_payment_status,
        'is_mine', s.bid_is_mine,
        'my_status', s.my_status,
        'updated_at', s.bid_updated_at
      ) ORDER BY s.id)
      FROM state s WHERE s.bid_id IS NOT NULL
    ), '[]'::jsonb)
  )
  INTO v_result
  FROM stats t;

  RETURN v_result;
END;
$$;

-- ── Organization pool lanes ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.list_marketplace_pool_lanes_for_org(
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
  IF NOT public.is_org_member(p_org_id) THEN
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
    count(*) FILTER (WHERE NOT r.sponsored) > 150
  FROM public._marketplace_pool_rows(NULL) r
  WHERE r.organization_id IS DISTINCT FROM p_org_id
    AND (p_after_key IS NULL OR r.pool_key COLLATE "C" > p_after_key COLLATE "C")
  GROUP BY r.pool_key
  HAVING count(*) FILTER (WHERE NOT r.sponsored) > 0
  ORDER BY r.pool_key COLLATE "C"
  LIMIT v_limit;
END;
$$;

-- ── Network pooling classifier ───────────────────────────────────────────
-- Classifies only indents market_indents_for_org already returns to this org.
-- Ids outside that set are dropped, never reported as "not sponsored".

CREATE OR REPLACE FUNCTION public.classify_indents_for_pooling(
  p_org_id uuid,
  p_indent_ids uuid[]
)
RETURNS TABLE (indent_id uuid, sponsored_reach boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
#variable_conflict use_column
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.is_org_staff(p_org_id) THEN
    RAISE EXCEPTION 'Not a member of this organization';
  END IF;
  IF coalesce(cardinality(p_indent_ids), 0) > 500 THEN
    RAISE EXCEPTION 'too_many_ids: at most 500 indent ids per call';
  END IF;

  RETURN QUERY
  SELECT v.id, public._indent_is_sponsored_reach(v.id)
  FROM (
    SELECT DISTINCT m.id
    FROM public.market_indents_for_org(p_org_id) m
    WHERE m.id = ANY (coalesce(p_indent_ids, '{}'::uuid[]))
  ) v
  ORDER BY v.id;
END;
$$;

-- ── Grants ───────────────────────────────────────────────────────────────

REVOKE ALL ON FUNCTION public._pool_key_part(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._pool_key(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._indent_is_sponsored_reach(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._marketplace_pool_rows(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._assert_dco_marketplace_caller() FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.get_dco_marketplace_pool(text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_dco_marketplace_pool_lanes(integer, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_org_marketplace_pool(uuid, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_marketplace_pool_lanes_for_org(uuid, integer, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.classify_indents_for_pooling(uuid, uuid[]) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_dco_marketplace_pool(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_dco_marketplace_pool_lanes(integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_org_marketplace_pool(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_marketplace_pool_lanes_for_org(uuid, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.classify_indents_for_pooling(uuid, uuid[]) TO authenticated;

COMMENT ON FUNCTION public._indent_is_sponsored_reach(uuid) IS
  'D1: an indent is Sponsored Reach iff a linked campaign (snapshot_source_indent_id or post source_indent_id) is active, not archived and not expired. Not viewer-relative.';
COMMENT ON FUNCTION public.get_dco_marketplace_pool(text, text, text) IS
  'Complete DCO pool manifest for one canonical pickup|drop|vehicle key. complete=false (over 150 members) returns no members and no biddable ids. fingerprint is a consistency check only.';
COMMENT ON FUNCTION public.get_org_marketplace_pool(uuid, text, text, text) IS
  'Complete organization pool manifest with D5 organization bid state. A colleague pending/accepted bid removes the indent from biddable_ids (already bid by your organization).';
COMMENT ON FUNCTION public.classify_indents_for_pooling(uuid, uuid[]) IS
  'Sponsored classification for indents already visible through market_indents_for_org; other ids are dropped.';
