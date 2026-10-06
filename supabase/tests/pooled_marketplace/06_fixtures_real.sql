-- Fixtures for a restored real schema (test project only). Must run inside
-- the single rolled-back transaction built by run_real.sh; nothing persists.

INSERT INTO t_cfgs VALUES ('smb_anon_execute', true), ('raise_on_done', true);

INSERT INTO auth.users (id, aud, role, email)
SELECT t_id(k), 'authenticated', 'authenticated', 'pm-harness-' || k || '@example.invalid'
FROM unnest(ARRAY['u_ship', 'u_bid1', 'u_bid2', 'u_other', 'u_dco', 'u_dco_m', 'u_drv_ne', 'u_plain']) k;

INSERT INTO public.organizations (id, name) VALUES
  (t_id('SHIP1'), 'PM Harness Shipper One'), (t_id('SHIP2'), 'PM Harness Shipper Two'),
  (t_id('B1'), 'PM Harness Bidder One'), (t_id('B2'), 'PM Harness Other Org');
INSERT INTO public.profiles (id, role) VALUES
  (t_id('u_ship'), 'user'), (t_id('u_bid1'), 'user'), (t_id('u_bid2'), 'user'),
  (t_id('u_other'), 'user'), (t_id('u_dco'), 'driver'), (t_id('u_dco_m'), 'driver'),
  (t_id('u_drv_ne'), 'driver'), (t_id('u_plain'), 'user')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
-- A DCO may not hold a driver-role membership (enforce_dco_not_driver_member),
-- so the shipper-member DCO is a plain member of SHIP1.
INSERT INTO public.organization_members (organization_id, user_id, role) VALUES
  (t_id('SHIP1'), t_id('u_ship'), 'admin'),
  (t_id('B1'), t_id('u_bid1'), 'member'),
  (t_id('B1'), t_id('u_bid2'), 'dispatcher'),
  (t_id('B2'), t_id('u_other'), 'member'),
  (t_id('SHIP1'), t_id('u_dco_m'), 'member');
INSERT INTO public.dco_profiles (user_id, status) VALUES
  (t_id('u_dco'), 'APPROVED'), (t_id('u_dco_m'), 'APPROVED');
INSERT INTO public.owner_vehicles (id, owner_user_id, vehicle_type, vehicle_number) VALUES
  (t_id('V1'), t_id('u_dco'), '20FT', 'PMH01AA0001'), (t_id('V2'), t_id('u_dco_m'), '20FT', 'PMH01AA0002');
-- SHIP1 lists B1 as a supplier: SHIP1 Network loads are visible to B1.
INSERT INTO public.organization_relations (from_organization_id, to_organization_id, relation_type, status)
VALUES (t_id('SHIP1'), t_id('B1'), 'client_supplier', 'active');

INSERT INTO public.reach_plans (code, name, price_inr, credit_price, estimated_reach_min, estimated_reach_max)
VALUES ('basic', 'PM Harness Basic', 0, 0, 1, 1)
ON CONFLICT (code) DO NOTHING;

CREATE FUNCTION t_plan() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT id FROM public.reach_plans WHERE code = 'basic'
$$;

CREATE FUNCTION t_post(p_source_indent uuid) RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO public.posts (type, source_indent_id, author_user_id, organization_id)
  SELECT 'LOAD', i.id, t_id('u_ship'), i.organization_id FROM public.indents i WHERE i.id = p_source_indent
  RETURNING id
$$;

-- idx_reach_campaigns_one_active_per_org allows one draft/active campaign per
-- org, but scenarios hold several live at once. Classification keys only on
-- the campaign's indent link, never on reach_campaigns.org_id, so each
-- campaign gets its own sponsor org.
CREATE FUNCTION t_campaign(
  p_status text, p_snapshot uuid, p_post uuid DEFAULT NULL,
  p_expires timestamptz DEFAULT NULL, p_archived timestamptz DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  v_sponsor uuid;
  v_id uuid;
BEGIN
  INSERT INTO public.organizations (name) VALUES ('PM Harness Sponsor') RETURNING id INTO v_sponsor;
  INSERT INTO public.reach_campaigns
    (status, snapshot_source_indent_id, post_id, expires_at, archived_at, org_id, created_by, plan_id)
  VALUES (p_status, p_snapshot, p_post, p_expires, p_archived, v_sponsor, t_id('u_ship'), t_plan())
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE FUNCTION t_target(p_campaign uuid, p_org uuid) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.reach_campaign_targets (campaign_id, org_id, wave, released_at)
  VALUES (p_campaign, p_org, 1, now())
$$;
