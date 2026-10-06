-- Pooled Marketplace: make the pool-row predicates inlinable. Same results as
-- 20271006181500; only the query shape changes.
--
-- A function with a SET clause or SECURITY DEFINER is never inlined, so the
-- previous _marketplace_pool_rows paid up to 14 out-of-line calls (each with a
-- search_path switch) per scanned indent: ~2 s per manifest at 10k indents.
--
--   _pool_key_part / _pool_key   no SET clause; every function and operator is
--                                pg_catalog-qualified, so they are independent
--                                of the caller's search_path when not inlined
--   _marketplace_pool_rows       open and sponsored predicates evaluated on the
--                                scanned row instead of per-row function calls
--
-- The inlined predicates must stay identical to indent_open_for_marketplace_bids
-- and _indent_is_sponsored_reach; supabase/tests/pooled_marketplace parity
-- checks compare them row by row. Grants are unchanged (CREATE OR REPLACE keeps
-- the ACL).

CREATE OR REPLACE FUNCTION public._pool_key_part(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT pg_catalog.lower(pg_catalog.btrim(
    coalesce(p_value, ''),
    E' \t\n\u000B\f\r\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF'
  ));
$$;

CREATE OR REPLACE FUNCTION public._pool_key(p_pickup text, p_drop text, p_vehicle_type text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN public._pool_key_part(p_pickup) OPERATOR(pg_catalog.=) ''
      OR public._pool_key_part(p_drop) OPERATOR(pg_catalog.=) ''
      OR public._pool_key_part(p_vehicle_type) OPERATOR(pg_catalog.=) ''
    THEN NULL
    ELSE public._pool_key_part(p_pickup) OPERATOR(pg_catalog.||) '|'
      OPERATOR(pg_catalog.||) public._pool_key_part(p_drop) OPERATOR(pg_catalog.||) '|'
      OPERATOR(pg_catalog.||) public._pool_key_part(p_vehicle_type)
  END;
$$;

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
    -- _indent_is_sponsored_reach as one set: indents linked to a live campaign
    -- by snapshot or by the campaign post's source indent.
    i.id IN (
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
  FROM public.indents i
  CROSS JOIN LATERAL (
    SELECT public._pool_key(i.pickup_area, i.drop_location, i.vehicle_type) AS pool_key
  ) k
  WHERE i.deleted_at IS NULL
    AND lower(trim(coalesce(i.circulation_target, ''))) IN ('marketplace', 'both')
    AND k.pool_key IS NOT NULL
    AND (p_pool_key IS NULL OR k.pool_key = p_pool_key)
    -- indent_open_for_marketplace_bids on the scanned row.
    AND lower(trim(coalesce(i.status::text, ''))) <> ALL (
      ARRAY['awarded', 'completed', 'cancelled', 'closed', 'expired', 'draft']::text[]
    );
$$;
