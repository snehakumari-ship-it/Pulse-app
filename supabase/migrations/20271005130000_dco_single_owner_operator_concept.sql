-- DCO vehicle / capacity authorization. Fleet Owner is not a second identity.
--
-- 20271005120000 already makes Marketplace list+bid use
-- is_dco_marketplace_eligible() and blocks employee reconnection.
-- This migration only moves DCO operating surfaces (own vehicles, vehicle
-- documents, own-vehicle capacity stories) off the Fleet Owner flag.
--
-- NOT done here (deliberate):
--   * driver_fleet_owner_profiles is kept; rows are not deleted.
--   * enable_driver_fleet_owner() is NOT revoked.
--   * is_driver_fleet_owner() still reads the legacy table — Reach
--     fleet-channel visibility/direct-bid still uses that helper. Changing
--     Reach is a separate product decision (employer "Recommend to Fleet
--     Owner" vs independent DCO). Do not silently retarget it.
--   * is_fleet_owner columns on bid list RPCs stay display/compatibility.
--
-- Canonical vehicle/capacity gate: is_current_user_dco_eligible()
-- (APPROVED DCO, not employed). Vehicle is not required so the first one
-- can be attached.

-- ── Owner vehicles: DCO only (not every driver; not FO-only) ──────────────

DROP POLICY IF EXISTS "Fleet owners and DCOs manage own vehicles" ON public.owner_vehicles;
DROP POLICY IF EXISTS "Fleet owners manage own vehicles" ON public.owner_vehicles;
DROP POLICY IF EXISTS "DCOs manage own vehicles" ON public.owner_vehicles;
CREATE POLICY "DCOs manage own vehicles"
  ON public.owner_vehicles
  FOR ALL
  TO authenticated
  USING (
    owner_user_id = (SELECT auth.uid())
    AND public.is_current_user_dco_eligible()
  )
  WITH CHECK (
    owner_user_id = (SELECT auth.uid())
    AND public.is_current_user_dco_eligible()
  );

DROP POLICY IF EXISTS "Fleet owners manage own vehicle documents" ON public.owner_vehicle_documents;
DROP POLICY IF EXISTS "DCOs manage own vehicle documents" ON public.owner_vehicle_documents;
CREATE POLICY "DCOs manage own vehicle documents"
  ON public.owner_vehicle_documents
  FOR ALL
  TO authenticated
  USING (
    owner_user_id = (SELECT auth.uid())
    AND public.is_current_user_dco_eligible()
  )
  WITH CHECK (
    owner_user_id = (SELECT auth.uid())
    AND public.is_current_user_dco_eligible()
    AND EXISTS (
      SELECT 1
      FROM public.owner_vehicles ov
      WHERE ov.id = owner_vehicle_id
        AND ov.owner_user_id = (SELECT auth.uid())
        AND ov.deleted_at IS NULL
    )
  );

DROP POLICY IF EXISTS "Owners upload own vehicle documents" ON storage.objects;
CREATE POLICY "Owners upload own vehicle documents"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'owner-vehicle-documents'
  AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  AND public.is_current_user_dco_eligible()
);

DROP POLICY IF EXISTS "Owners read own vehicle documents" ON storage.objects;
CREATE POLICY "Owners read own vehicle documents"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'owner-vehicle-documents'
  AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  AND public.is_current_user_dco_eligible()
);

DROP POLICY IF EXISTS "Owners update own vehicle documents" ON storage.objects;
CREATE POLICY "Owners update own vehicle documents"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'owner-vehicle-documents'
  AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  AND public.is_current_user_dco_eligible()
)
WITH CHECK (
  bucket_id = 'owner-vehicle-documents'
  AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  AND public.is_current_user_dco_eligible()
);

DROP POLICY IF EXISTS "Owners delete own vehicle documents" ON storage.objects;
CREATE POLICY "Owners delete own vehicle documents"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'owner-vehicle-documents'
  AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  AND public.is_current_user_dco_eligible()
);

-- ── Capacity stories: DCO own-vehicle availability (not employer Reach) ──

DROP POLICY IF EXISTS posts_insert_fo_capacity ON public.posts;
CREATE POLICY posts_insert_fo_capacity ON public.posts
  FOR INSERT
  TO authenticated
  WITH CHECK (
    organization_id IS NULL
    AND type = 'VEHICLE_AVAILABILITY'
    AND source_indent_id IS NULL
    AND author_user_id = (SELECT auth.uid())
    AND public.is_current_user_dco_eligible()
  );

DROP POLICY IF EXISTS posts_update_fo_capacity ON public.posts;
CREATE POLICY posts_update_fo_capacity ON public.posts
  FOR UPDATE
  TO authenticated
  USING (
    organization_id IS NULL
    AND author_user_id = (SELECT auth.uid())
    AND public.is_current_user_dco_eligible()
  )
  WITH CHECK (
    organization_id IS NULL
    AND type = 'VEHICLE_AVAILABILITY'
    AND source_indent_id IS NULL
    AND author_user_id = (SELECT auth.uid())
    AND public.is_current_user_dco_eligible()
  );

DROP POLICY IF EXISTS posts_delete_fo_capacity ON public.posts;
CREATE POLICY posts_delete_fo_capacity ON public.posts
  FOR DELETE
  TO authenticated
  USING (
    organization_id IS NULL
    AND author_user_id = (SELECT auth.uid())
    AND public.is_current_user_dco_eligible()
  );

-- RPC gates match RLS. Name kept for compatibility.
CREATE OR REPLACE FUNCTION public.create_fleet_owner_capacity_story(
  p_owner_vehicle_id uuid,
  p_available_from date DEFAULT NULL,
  p_origin text DEFAULT NULL,
  p_destination text DEFAULT NULL,
  p_rate_offer numeric DEFAULT NULL,
  p_content text DEFAULT NULL,
  p_expires_at timestamptz DEFAULT NULL
)
RETURNS public.posts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_origin text := nullif(btrim(coalesce(p_origin, '')), '');
  v_destination text := nullif(btrim(coalesce(p_destination, '')), '');
  v_content text := nullif(btrim(coalesce(p_content, '')), '');
  v_vehicle public.owner_vehicles%ROWTYPE;
  v_row public.posts;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT public.is_dco_eligible(v_uid) THEN
    RAISE EXCEPTION 'dco_required: approved, independent DCO status is required to share vehicle availability';
  END IF;

  IF v_origin IS NULL THEN
    RAISE EXCEPTION 'origin is required';
  END IF;

  IF p_rate_offer IS NOT NULL AND p_rate_offer <= 0 THEN
    RAISE EXCEPTION 'rate_offer must be positive when provided';
  END IF;

  IF p_owner_vehicle_id IS NULL THEN
    RAISE EXCEPTION 'owner_vehicle_id is required';
  END IF;

  SELECT *
  INTO v_vehicle
  FROM public.owner_vehicles ov
  WHERE ov.id = p_owner_vehicle_id
    AND ov.owner_user_id = v_uid
    AND ov.deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vehicle not found in My Fleet';
  END IF;

  IF v_vehicle.status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'Vehicle must be active to share as Story';
  END IF;

  INSERT INTO public.posts (
    organization_id,
    author_user_id,
    type,
    content,
    origin,
    destination,
    load_date,
    vehicle_type,
    weight_tonnes,
    rate_offer,
    material,
    expires_at,
    is_active,
    source_indent_id,
    owner_vehicle_id
  ) VALUES (
    NULL,
    v_uid,
    'VEHICLE_AVAILABILITY',
    v_content,
    v_origin,
    v_destination,
    p_available_from,
    nullif(btrim(coalesce(v_vehicle.vehicle_type, '')), ''),
    NULL,
    p_rate_offer,
    nullif(btrim(coalesce(v_vehicle.capacity, '')), ''),
    COALESCE(p_expires_at, now() + interval '7 days'),
    true,
    NULL,
    v_vehicle.id
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

COMMENT ON FUNCTION public.create_fleet_owner_capacity_story IS
  'DCO publishes a VEHICLE_AVAILABILITY Story for an owned vehicle. Legacy function name; authorization is is_dco_eligible().';

CREATE OR REPLACE FUNCTION public.deactivate_fleet_owner_capacity_story(p_post_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_updated int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT public.is_dco_eligible(v_uid) THEN
    RAISE EXCEPTION 'dco_required: approved, independent DCO status is required to manage vehicle availability';
  END IF;

  UPDATE public.posts p
  SET is_active = false
  WHERE p.id = p_post_id
    AND p.organization_id IS NULL
    AND p.type = 'VEHICLE_AVAILABILITY'
    AND p.author_user_id = v_uid
    AND p.is_active = true;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

COMMENT ON FUNCTION public.deactivate_fleet_owner_capacity_story(uuid) IS
  'DCO takes own capacity Story offline. Legacy function name; authorization is is_dco_eligible().';

COMMENT ON TABLE public.driver_fleet_owner_profiles IS
  'Legacy Fleet Owner capability rows. Not an authorization model for Marketplace, vehicles, or DCO identity. Canonical owner-operator state is dco_profiles.';

COMMENT ON FUNCTION public.is_driver_fleet_owner(uuid) IS
  'Legacy helper: true when driver_fleet_owner_profiles has a row. Must not grant Marketplace. Still used by Reach fleet-channel until that product decision is made.';
