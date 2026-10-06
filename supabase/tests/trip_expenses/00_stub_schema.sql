-- Hand-written stand-in for the objects 20271007190418 reads or changes.
-- No production data or schema dump. Column sets mirror the repo migrations
-- that created the expense tables (20260828170000, 20260828190000,
-- 20260828193000, 20260828203000, 20260828213000, 20260828220000,
-- 20261002000000, 20261203120000).
\set ON_ERROR_STOP on

CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

CREATE TABLE public.organizations (id uuid PRIMARY KEY, name text);
CREATE TABLE public.org_members (organization_id uuid, user_id uuid, staff boolean DEFAULT true);
CREATE TABLE public.organization_members (
  organization_id uuid, user_id uuid, role text, status text DEFAULT 'active'
);
CREATE FUNCTION public.is_org_staff(org_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (SELECT 1 FROM public.org_members m WHERE m.organization_id = org_id AND m.user_id = auth.uid() AND m.staff)
$$;
GRANT EXECUTE ON FUNCTION public.is_org_staff(uuid) TO authenticated;

CREATE TABLE public.suppliers (
  id uuid PRIMARY KEY, organization_id uuid, linked_organization_id uuid
);
CREATE TABLE public.drivers (
  id uuid PRIMARY KEY, organization_id uuid, user_id uuid,
  left_at timestamptz, deleted_at timestamptz,
  tracking_only boolean DEFAULT false, relationship_status text
);
CREATE TABLE public.driver_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_organization_id uuid NOT NULL, to_user_id uuid,
  status text NOT NULL DEFAULT 'pending', deleted_at timestamptz
);
CREATE TABLE public.dco_payees (id uuid PRIMARY KEY, user_id uuid);
CREATE TABLE public.trips (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL, operating_mode text NOT NULL DEFAULT 'FLEET',
  driver_id uuid, supplier_id uuid, dco_payee_id uuid, vehicle_id uuid
);
GRANT SELECT ON public.trips TO authenticated;

CREATE TABLE public.trip_fuel_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  amount_inr numeric(12,2) NOT NULL DEFAULT 0,
  liters numeric(12,3), fuel_type text, station_name text, notes text, bill_storage_path text,
  entered_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  entered_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'manual', status text NOT NULL DEFAULT 'active',
  payment_owner text NOT NULL DEFAULT 'organization', payment_mode text,
  approval_state text NOT NULL DEFAULT 'reported', ledger_state text NOT NULL DEFAULT 'not_posted',
  approved_by uuid, approved_at timestamptz,
  posting_state text NOT NULL DEFAULT 'pending', posting_error text, last_retry_at timestamptz,
  retry_count integer NOT NULL DEFAULT 0,
  reimbursement_state text NOT NULL DEFAULT 'reported', reimbursement_updated_at timestamptz,
  reimbursed_at timestamptz, reimbursed_by uuid, reimbursement_notes text,
  ocr_job_id uuid, idempotency_key text
);
CREATE TABLE public.trip_toll_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  amount_inr numeric(12,2) NOT NULL DEFAULT 0,
  plaza_name text, notes text, is_estimated boolean NOT NULL DEFAULT false, receipt_storage_path text,
  entered_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  entered_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'manual', status text NOT NULL DEFAULT 'active',
  payment_owner text NOT NULL DEFAULT 'organization', payment_mode text,
  approval_state text NOT NULL DEFAULT 'reported', ledger_state text NOT NULL DEFAULT 'not_posted',
  approved_by uuid, approved_at timestamptz,
  posting_state text NOT NULL DEFAULT 'pending', posting_error text, last_retry_at timestamptz,
  retry_count integer NOT NULL DEFAULT 0,
  reimbursement_state text NOT NULL DEFAULT 'reported', reimbursement_updated_at timestamptz,
  reimbursed_at timestamptz, reimbursed_by uuid, reimbursement_notes text,
  ocr_job_id uuid, idempotency_key text
);
CREATE TABLE public.trip_other_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  expense_category text NOT NULL, amount_inr numeric(12,2) NOT NULL DEFAULT 0,
  description text, location_name text, notes text, receipt_storage_path text,
  entered_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  entered_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'manual', status text NOT NULL DEFAULT 'active',
  payment_owner text NOT NULL DEFAULT 'organization', payment_mode text,
  approval_state text NOT NULL DEFAULT 'reported', ledger_state text NOT NULL DEFAULT 'not_posted',
  posting_state text NOT NULL DEFAULT 'pending', posting_error text, last_retry_at timestamptz,
  retry_count integer NOT NULL DEFAULT 0,
  reimbursement_state text NOT NULL DEFAULT 'reported', reimbursement_updated_at timestamptz,
  reimbursed_at timestamptz, reimbursed_by uuid, reimbursement_notes text,
  approved_by uuid, approved_at timestamptz, ocr_job_id uuid
);

-- The pre-migration policy: anyone who can see the trip.
DO $$
DECLARE v text;
BEGIN
  FOREACH v IN ARRAY ARRAY['trip_fuel_entries', 'trip_toll_entries', 'trip_other_expenses'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', v);
    EXECUTE format($p$CREATE POLICY %1$s_visible_trip_members ON public.%1$I FOR ALL TO authenticated
      USING (EXISTS (SELECT 1 FROM public.trips t WHERE t.id = %1$I.trip_id))
      WITH CHECK (EXISTS (SELECT 1 FROM public.trips t WHERE t.id = %1$I.trip_id))$p$, v);
  END LOOP;
END $$;

CREATE TABLE public.vehicle_operation_ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL, vehicle_id uuid, source_type text NOT NULL, source_id uuid NOT NULL,
  trip_id uuid, entry_type text NOT NULL DEFAULT 'expense', amount numeric NOT NULL DEFAULT 0,
  approval_state text NOT NULL DEFAULT 'draft', approved_by uuid, approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_type, source_id)
);
CREATE TABLE public.vehicle_ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL, vehicle_id uuid, trip_id uuid,
  source_type text NOT NULL, source_id uuid NOT NULL, entry_type text NOT NULL DEFAULT 'vehicle_operational_expense',
  amount numeric NOT NULL DEFAULT 0, posted_at timestamptz DEFAULT now(),
  UNIQUE (source_type, source_id)
);
DO $$
DECLARE v text;
BEGIN
  FOREACH v IN ARRAY ARRAY['vehicle_operation_ledger_entries', 'vehicle_ledger_entries'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON public.%I TO authenticated', v);
    EXECUTE format($p$CREATE POLICY %1$s_org ON public.%1$I FOR ALL TO authenticated
      USING (public.is_org_staff(organization_id)) WITH CHECK (public.is_org_staff(organization_id))$p$, v);
  END LOOP;
END $$;

CREATE TABLE public.trip_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  file_name text NOT NULL DEFAULT 'f.jpg', storage_path text NOT NULL UNIQUE,
  document_type text, uploaded_by uuid
);
ALTER TABLE public.trip_documents ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.trip_documents TO authenticated;
-- Stand-in for the broad permissive select (every trip reader).
CREATE POLICY trip_documents_org_member_select ON public.trip_documents FOR SELECT TO authenticated USING (true);
