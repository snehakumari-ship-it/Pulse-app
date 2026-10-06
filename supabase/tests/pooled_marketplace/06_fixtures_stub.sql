-- Fixtures for the disposable stub schema (00_stub_schema.sql).

INSERT INTO public.organizations (id, name) VALUES
  (t_id('SHIP1'), 'Shipper One'), (t_id('SHIP2'), 'Shipper Two'),
  (t_id('B1'), 'Bidder One'), (t_id('B2'), 'Other Org');
INSERT INTO public.profiles (id, role) VALUES
  (t_id('u_ship'), 'member'), (t_id('u_bid1'), 'member'), (t_id('u_bid2'), 'member'),
  (t_id('u_other'), 'member'), (t_id('u_dco'), 'driver'), (t_id('u_dco_m'), 'driver'),
  (t_id('u_drv_ne'), 'driver'), (t_id('u_plain'), 'member');
INSERT INTO public.organization_members (organization_id, user_id, role) VALUES
  (t_id('SHIP1'), t_id('u_ship'), 'admin'),
  (t_id('B1'), t_id('u_bid1'), 'member'),
  (t_id('B1'), t_id('u_bid2'), 'dispatcher'),
  (t_id('B2'), t_id('u_other'), 'member'),
  (t_id('SHIP1'), t_id('u_dco_m'), 'driver');
INSERT INTO public.stub_dco_eligible (user_id) VALUES (t_id('u_dco')), (t_id('u_dco_m'));
INSERT INTO public.owner_vehicles (id, owner_user_id, vehicle_type) VALUES
  (t_id('V1'), t_id('u_dco'), '20FT'), (t_id('V2'), t_id('u_dco_m'), '20FT');
-- SHIP1 lists B1 as a supplier: SHIP1 Network loads are visible to B1.
INSERT INTO public.organization_relations (from_organization_id, to_organization_id, relation_type, status)
VALUES (t_id('SHIP1'), t_id('B1'), 'client_supplier', 'active');

INSERT INTO t_cfgs VALUES ('smb_anon_execute', false), ('raise_on_done', false);

CREATE FUNCTION t_campaign(
  p_status text, p_snapshot uuid, p_post uuid DEFAULT NULL,
  p_expires timestamptz DEFAULT NULL, p_archived timestamptz DEFAULT NULL
) RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO public.reach_campaigns (status, snapshot_source_indent_id, post_id, expires_at, archived_at)
  VALUES (p_status, p_snapshot, p_post, p_expires, p_archived) RETURNING id
$$;

CREATE FUNCTION t_post(p_source_indent uuid) RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO public.posts (type, source_indent_id) VALUES ('LOAD', p_source_indent) RETURNING id
$$;

CREATE FUNCTION t_target(p_campaign uuid, p_org uuid) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.reach_campaign_targets (campaign_id, org_id, wave, released_at)
  VALUES (p_campaign, p_org, 1, now())
$$;
