-- Minimal stand-in for the production objects the pooled-marketplace migrations
-- depend on. Disposable local Postgres only (run.sh, --network none).
-- Function bodies marked "verbatim" are copied from the named migration and are
-- the production-verified definitions (D4, 2026-10-06).

CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;

CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated;
GRANT USAGE ON SCHEMA public TO anon, authenticated;

CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

CREATE TABLE public.organizations (
  id uuid PRIMARY KEY, name text, logo_url text, avatar_seed text
);
CREATE TABLE public.profiles (id uuid PRIMARY KEY, role text);
CREATE TABLE public.organization_members (
  organization_id uuid NOT NULL,
  user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'active',
  role text NOT NULL DEFAULT 'member',
  PRIMARY KEY (organization_id, user_id)
);

-- verbatim: 20260518070000_security_fix_search_path_and_is_org_member.sql
CREATE OR REPLACE FUNCTION public.is_org_member(org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE organization_id = org_id
      AND user_id = (SELECT auth.uid())
      AND status = 'active'
  );
$$;

-- Stub: is_org_staff has no repository definition. Assumed semantics: active, non-driver member.
CREATE FUNCTION public.is_org_staff(org_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE organization_id = org_id
      AND user_id = (SELECT auth.uid())
      AND status = 'active'
      AND role <> 'driver'
  );
$$;

-- Stub: DCO eligibility is its own released predicate; the harness only needs a switch.
CREATE TABLE public.stub_dco_eligible (user_id uuid PRIMARY KEY);
CREATE FUNCTION public.is_dco_marketplace_eligible(p_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.stub_dco_eligible e WHERE e.user_id = p_user_id);
$$;
CREATE FUNCTION public.is_driver_available(p_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT true $$;

CREATE TABLE public.owner_vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL,
  vehicle_type text,
  status text NOT NULL DEFAULT 'active',
  deleted_at timestamptz
);

CREATE TABLE public.indents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  indent_number text,
  pickup_area text,
  drop_location text,
  client_name text,
  client_price numeric,
  supplier_target numeric,
  status text NOT NULL DEFAULT 'open',
  vehicle_type text,
  load_type text,
  pickup_date date,
  circulation_target text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  assigned_supplier_id uuid,
  assigned_supplier_rate numeric,
  weight numeric
);

CREATE TABLE public.market_bids (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  indent_id uuid NOT NULL,
  bidder_type text NOT NULL,
  bidder_user_id uuid NOT NULL,
  bidder_organization_id uuid,
  owner_vehicle_id uuid,
  amount numeric NOT NULL,
  note text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status = ANY (ARRAY['pending', 'accepted', 'rejected', 'withdrawn', 'superseded'])),
  fee_payment_status text NOT NULL DEFAULT 'not_required',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (indent_id, bidder_user_id)
);

CREATE TABLE public.direct_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  indent_id uuid NOT NULL,
  bidder_organization_id uuid NOT NULL,
  amount numeric NOT NULL,
  notes text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  counter_amount numeric CHECK (counter_amount IS NULL OR counter_amount > 0),
  driver_id uuid,
  vehicle_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (indent_id, bidder_organization_id)
);

CREATE TABLE public.posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text,
  source_indent_id uuid
);
CREATE TABLE public.reach_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'completed', 'cancelled')),
  archived_at timestamptz,
  expires_at timestamptz,
  snapshot_source_indent_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.reach_campaign_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL,
  org_id uuid NOT NULL,
  wave smallint NOT NULL DEFAULT 1,
  released_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, org_id)
);

-- Tables read by market_indents_for_org (20270923135205).
CREATE TABLE public.organization_relations (
  from_organization_id uuid, to_organization_id uuid, relation_type text,
  status text, created_at timestamptz DEFAULT now()
);
CREATE TABLE public.suppliers (
  organization_id uuid, linked_organization_id uuid, updated_at timestamptz DEFAULT now()
);
CREATE TABLE public.clients (
  organization_id uuid, linked_organization_id uuid, status text, created_at timestamptz DEFAULT now()
);

-- verbatim: 20270128104000_reach_story_lifetime_from_indent.sql
CREATE OR REPLACE FUNCTION public.indent_open_for_marketplace_bids(p_indent_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.indents i
    WHERE i.id = p_indent_id
      AND i.deleted_at IS NULL
      AND lower(trim(coalesce(i.status::text, ''))) <> ALL (
        ARRAY[
          'awarded',
          'completed',
          'cancelled',
          'closed',
          'expired',
          'draft'
        ]::text[]
      )
  );
$$;

-- verbatim: 20260502160500_pulse_bid_direct_quote_atomic.sql
CREATE OR REPLACE FUNCTION public.set_indent_quoted_on_direct_quote()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM 'pending' THEN
    RETURN NEW;
  END IF;
  UPDATE public.indents i
  SET
    status = 'quoted',
    updated_at = now()
  WHERE i.id = NEW.indent_id
    AND lower(trim(i.status::text)) = ANY (
      ARRAY['pending', 'broadcast', 'open', 'draft']::text[]
    );
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_direct_quotes_set_indent_quoted
  AFTER INSERT OR UPDATE OF amount, notes, status ON public.direct_quotes
  FOR EACH ROW
  WHEN (NEW.status = 'pending')
  EXECUTE FUNCTION public.set_indent_quoted_on_direct_quote();

-- verbatim: 20271005200741 C2 (live body, D4).
CREATE OR REPLACE FUNCTION public.reject_quote_accept_on_inactive_indent()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_status   text;
  v_indent   public.indents%ROWTYPE;
  v_uid      uuid := (SELECT auth.uid());
  v_other    uuid;
BEGIN
  IF lower(coalesce(NEW.status, '')) = 'accepted'
     AND lower(coalesce(OLD.status, '')) IS DISTINCT FROM 'accepted'
  THEN
    SELECT * INTO v_indent
    FROM public.indents
    WHERE id = NEW.indent_id
    FOR UPDATE;

    v_status := lower(coalesce(v_indent.status, ''));
    IF v_status IN ('cancelled', 'closed', 'expired') THEN
      RAISE EXCEPTION 'indent_not_active: reactivate this indent before awarding it (status=%)', v_status
        USING ERRCODE = '23514';
    END IF;

    IF v_uid IS NULL OR NOT public.is_org_staff(v_indent.organization_id) THEN
      RAISE EXCEPTION 'unauthorized: only staff of the load-owning organization can accept a quote'
        USING ERRCODE = '42501';
    END IF;

    IF v_status NOT IN ('open', 'broadcast') THEN
      RAISE EXCEPTION 'indent_not_open: indent % is not open for award (status=%)', NEW.indent_id, v_indent.status
        USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.market_bids mb
      WHERE mb.indent_id = NEW.indent_id
        AND mb.status = 'accepted'
    ) THEN
      RAISE EXCEPTION 'already_awarded: indent % already has an accepted Marketplace bid', NEW.indent_id
        USING ERRCODE = '23514';
    END IF;

    IF v_indent.assigned_supplier_id IS NOT NULL
       AND v_indent.assigned_supplier_id IS DISTINCT FROM NEW.bidder_organization_id THEN
      v_other := v_indent.assigned_supplier_id;
      RAISE EXCEPTION 'already_awarded: indent % is already assigned to organization %', NEW.indent_id, v_other
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
-- Live binding (D4).
CREATE TRIGGER trg_reject_quote_accept_on_inactive_indent
  BEFORE UPDATE OF status ON public.direct_quotes
  FOR EACH ROW EXECUTE FUNCTION public.reject_quote_accept_on_inactive_indent();

-- Live direct_quotes policies (D4), verbatim.
ALTER TABLE public.direct_quotes ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.direct_quotes TO authenticated;
CREATE POLICY "Bidders can insert own direct quotes" ON public.direct_quotes FOR INSERT
  WITH CHECK (EXISTS ( SELECT 1 FROM public.organization_members om
    WHERE om.organization_id = direct_quotes.bidder_organization_id AND om.user_id = ( SELECT auth.uid() AS uid)
      AND om.status = 'active'::text AND om.role = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text, 'dispatcher'::text, 'finance'::text])));
CREATE POLICY "Bidders can select own direct quotes" ON public.direct_quotes FOR SELECT
  USING (EXISTS ( SELECT 1 FROM public.organization_members om
    WHERE om.organization_id = direct_quotes.bidder_organization_id AND om.user_id = ( SELECT auth.uid() AS uid)
      AND om.status = 'active'::text AND om.role = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text, 'dispatcher'::text, 'finance'::text])));
CREATE POLICY "Bidders can update own direct quotes" ON public.direct_quotes FOR UPDATE
  USING (EXISTS ( SELECT 1 FROM public.organization_members om
    WHERE om.organization_id = direct_quotes.bidder_organization_id AND om.user_id = ( SELECT auth.uid() AS uid)
      AND om.status = 'active'::text AND om.role = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text, 'dispatcher'::text, 'finance'::text])))
  WITH CHECK (EXISTS ( SELECT 1 FROM public.organization_members om
    WHERE om.organization_id = direct_quotes.bidder_organization_id AND om.user_id = ( SELECT auth.uid() AS uid)
      AND om.status = 'active'::text AND om.role = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text, 'dispatcher'::text, 'finance'::text])));
CREATE POLICY "Indent owners can read quotes on their indents" ON public.direct_quotes FOR SELECT
  USING (EXISTS ( SELECT 1 FROM public.indents i JOIN public.organization_members om
    ON om.organization_id = i.organization_id AND om.user_id = ( SELECT auth.uid() AS uid) AND om.status = 'active'::text
      AND om.role = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text, 'dispatcher'::text, 'finance'::text])
    WHERE i.id = direct_quotes.indent_id));
CREATE POLICY "Indent owners can update quotes on their indents" ON public.direct_quotes FOR UPDATE
  USING (EXISTS ( SELECT 1 FROM public.indents i JOIN public.organization_members om
    ON om.organization_id = i.organization_id AND om.user_id = ( SELECT auth.uid() AS uid) AND om.status = 'active'::text
      AND om.role = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text, 'dispatcher'::text, 'finance'::text])
    WHERE i.id = direct_quotes.indent_id))
  WITH CHECK (EXISTS ( SELECT 1 FROM public.indents i JOIN public.organization_members om
    ON om.organization_id = i.organization_id AND om.user_id = ( SELECT auth.uid() AS uid) AND om.status = 'active'::text
      AND om.role = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text, 'dispatcher'::text, 'finance'::text])
    WHERE i.id = direct_quotes.indent_id));

-- The policies read indents and organization_members as the calling role.
GRANT SELECT ON public.indents, public.organization_members TO authenticated;

-- Placeholder with the production signature so the S1 migration replaces an
-- existing function (CREATE OR REPLACE keeps grants), as it will in production.
CREATE FUNCTION public.submit_market_bid(
  p_indent_id uuid, p_amount numeric, p_note text DEFAULT NULL,
  p_bidder_organization_id uuid DEFAULT NULL, p_owner_vehicle_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE sql AS $$ SELECT NULL::jsonb $$;
REVOKE ALL ON FUNCTION public.submit_market_bid(uuid, numeric, text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_market_bid(uuid, numeric, text, uuid, uuid) TO authenticated;
