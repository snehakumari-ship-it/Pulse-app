-- Trip expense ownership, approval and Finance boundary.
--
-- trip_fuel_entries, trip_toll_entries and trip_other_expenses carried a
-- single FOR ALL policy (EXISTS trips): anyone who could see the trip could
-- read, insert, edit, void or approve any expense on it, and the client
-- decided who owned an expense. This migration moves ownership to the server.
--
-- Every row gets an expense_context fixed at insert:
--   dco       trip.operating_mode = 'DCO'. Only the DCO records expenses.
--             Own trip economics: never reviewed, never in a shipper's or
--             employer's Finance.
--   employer  Entered by staff of the trip organization or of the trip
--             supplier's linked organization, or by a driver whose employer is
--             one of those. employer_org_id reviews it; only approved rows may
--             reach that organization's vehicle ledgers.
--   personal  Entered by a driver with no employer on this trip. Reference
--             only: no review, no Finance.
--
-- A driver's employer is an organization that sent the driver a
-- driver_invites invite that is accepted or consumed (both mean the driver
-- joined) and where the driver's roster row has not left (left_at IS NULL,
-- deleted_at IS NULL). The trip organization is checked before the supplier's
-- linked organization. organization_members never decides employment. A
-- driver who is staff of the trip supplier's linked organization (an owner
-- who drives) is that organization's employer row.
--
-- expense_status is derived from the legacy approval columns, which the
-- posting engine still reads:
--   personal | pending_approval | approved | rejected | cancelled
-- dco and personal rows are only 'personal' or 'cancelled'.
--
-- Access (RLS): a row is visible to its owner, and employer rows to staff of
-- employer_org_id. Staff-entered employer expenses are owned by the staff
-- member, so the trip's driver does not see them. No DELETE; voiding is a
-- status change. Trigger rules on UPDATE:
--   * trip_id, expense_context, owner_user_id, employer_org_id, entered_by and
--     entered_at are frozen;
--   * approval / posting / reimbursement columns change only for staff of
--     employer_org_id (never on dco or personal rows);
--   * an owner's edit to a pending or rejected employer row resubmits it as
--     pending; approved or posted rows refuse owner edits; a staff edit to an
--     approved, unposted row returns it to review.
--
-- Finance boundary: vehicle_operation_ledger_entries and vehicle_ledger_entries
-- rows sourced from a trip expense (fuel / toll / manual_adjustment) must
-- belong to an employer row of the same organization; vehicle_ledger_entries
-- (posted) and approved drafts also require the expense to be approved.
--
-- Receipts: a RESTRICTIVE policy on trip_documents narrows expense receipt
-- document types to the uploader or a reader of an expense that references
-- the file. It only narrows the existing permissive policies.
--
-- No-trip expenses: driver_personal_expenses is owner-only reference storage,
-- replacing device-local notes. It has no Finance link.
--
-- Backfill: existing rows get a context from the trip and entered_by. Rows
-- already approved or posted on a non-DCO trip stay employer rows of the trip
-- organization so historical Finance stays consistent. Ledger drafts for
-- non-employer rows are set to 'ignored' (not deleted).

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------

ALTER TABLE public.trip_fuel_entries
  ADD COLUMN IF NOT EXISTS expense_context text,
  ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS employer_org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS expense_status text,
  ADD COLUMN IF NOT EXISTS rejection_reason text;

ALTER TABLE public.trip_toll_entries
  ADD COLUMN IF NOT EXISTS expense_context text,
  ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS employer_org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS expense_status text,
  ADD COLUMN IF NOT EXISTS rejection_reason text;

ALTER TABLE public.trip_other_expenses
  ADD COLUMN IF NOT EXISTS expense_context text,
  ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS employer_org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS expense_status text,
  ADD COLUMN IF NOT EXISTS rejection_reason text;

-- ---------------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._trip_expense_driver_employer(
  p_user_id uuid,
  p_trip_org_id uuid,
  p_supplier_org_id uuid
)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT c.org_id
  FROM (VALUES (1, p_trip_org_id), (2, p_supplier_org_id)) AS c(rank, org_id)
  WHERE c.org_id IS NOT NULL
    AND p_user_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.driver_invites i
      WHERE i.from_organization_id = c.org_id
        AND i.to_user_id = p_user_id
        AND i.status IN ('accepted', 'consumed')
        AND i.deleted_at IS NULL
    )
    AND EXISTS (
      SELECT 1 FROM public.drivers d
      WHERE d.organization_id = c.org_id
        AND d.user_id = p_user_id
        AND d.left_at IS NULL
        AND d.deleted_at IS NULL
    )
  ORDER BY c.rank
  LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION public._trip_expense_driver_employer(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._trip_expense_status_from_legacy(
  p_context text,
  p_status text,
  p_approval_state text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN p_status = 'voided' THEN 'cancelled'
    WHEN p_context <> 'employer' THEN 'personal'
    WHEN p_approval_state IN ('approved', 'settled') THEN 'approved'
    WHEN p_approval_state = 'rejected' THEN 'rejected'
    ELSE 'pending_approval'
  END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. Backfill (before any trigger exists)
-- ---------------------------------------------------------------------------

DO $backfill$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['trip_fuel_entries', 'trip_toll_entries', 'trip_other_expenses'] LOOP
    EXECUTE format($sql$
      UPDATE public.%1$I e
      SET expense_context = r.ctx,
          employer_org_id = r.employer_org_id,
          owner_user_id = r.owner_user_id,
          expense_status = public._trip_expense_status_from_legacy(r.ctx, e.status, e.approval_state)
      FROM (
        SELECT
          e2.id,
          CASE
            WHEN c.is_dco THEN 'dco'
            WHEN e2.entered_by IS DISTINCT FROM c.driver_user_id
              OR e2.ledger_state = 'posted'
              OR e2.posting_state = 'posted'
              OR e2.approval_state IN ('approved', 'settled') THEN 'employer'
            WHEN emp.org_id IS NOT NULL THEN 'employer'
            ELSE 'personal'
          END AS ctx,
          CASE
            WHEN c.is_dco THEN NULL
            WHEN e2.entered_by IS DISTINCT FROM c.driver_user_id
              OR e2.ledger_state = 'posted'
              OR e2.posting_state = 'posted'
              OR e2.approval_state IN ('approved', 'settled') THEN c.trip_org_id
            ELSE emp.org_id
          END AS employer_org_id,
          CASE WHEN c.is_dco THEN coalesce(e2.entered_by, c.dco_user_id) ELSE e2.entered_by END AS owner_user_id
        FROM public.%1$I e2
        JOIN (
          SELECT
            t.id AS trip_id,
            t.organization_id AS trip_org_id,
            (t.operating_mode = 'DCO') AS is_dco,
            dp.user_id AS dco_user_id,
            d.user_id AS driver_user_id,
            s.linked_organization_id AS supplier_org_id
          FROM public.trips t
          LEFT JOIN public.drivers d ON d.id = t.driver_id
          LEFT JOIN public.dco_payees dp ON dp.id = t.dco_payee_id
          LEFT JOIN public.suppliers s ON s.id = t.supplier_id
        ) c ON c.trip_id = e2.trip_id
        LEFT JOIN LATERAL (
          SELECT coalesce(
            public._trip_expense_driver_employer(e2.entered_by, c.trip_org_id, c.supplier_org_id),
            (SELECT om.organization_id
             FROM public.organization_members om
             WHERE om.user_id = e2.entered_by
               AND om.organization_id = c.supplier_org_id
               AND om.status = 'active'
               AND om.role IS DISTINCT FROM 'driver'
             LIMIT 1)
          ) AS org_id
        ) emp ON true
        WHERE e2.expense_context IS NULL
      ) r
      WHERE r.id = e.id
        AND e.expense_context IS NULL
    $sql$, v_table);
  END LOOP;
END
$backfill$;

-- Ledger drafts mirrored from rows that are not employer expenses of that org.
UPDATE public.vehicle_operation_ledger_entries v
SET approval_state = 'ignored', approved_by = NULL, approved_at = NULL
WHERE v.approval_state = 'draft'
  AND (
    (v.source_type = 'fuel' AND EXISTS (
      SELECT 1 FROM public.trip_fuel_entries e
      WHERE e.id = v.source_id
        AND (e.expense_context <> 'employer' OR e.employer_org_id IS DISTINCT FROM v.organization_id)))
    OR (v.source_type = 'toll' AND EXISTS (
      SELECT 1 FROM public.trip_toll_entries e
      WHERE e.id = v.source_id
        AND (e.expense_context <> 'employer' OR e.employer_org_id IS DISTINCT FROM v.organization_id)))
    OR (v.source_type = 'manual_adjustment' AND EXISTS (
      SELECT 1 FROM public.trip_other_expenses e
      WHERE e.id = v.source_id
        AND (e.expense_context <> 'employer' OR e.employer_org_id IS DISTINCT FROM v.organization_id)))
  );

-- ---------------------------------------------------------------------------
-- 4. Constraints and indexes
-- ---------------------------------------------------------------------------

DO $constraints$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['trip_fuel_entries', 'trip_toll_entries', 'trip_other_expenses'] LOOP
    EXECUTE format('ALTER TABLE public.%1$I ALTER COLUMN expense_context SET NOT NULL', v_table);
    EXECUTE format('ALTER TABLE public.%1$I ALTER COLUMN expense_status SET NOT NULL', v_table);
    EXECUTE format('ALTER TABLE public.%1$I DROP CONSTRAINT IF EXISTS %1$s_expense_context_check', v_table);
    EXECUTE format($sql$
      ALTER TABLE public.%1$I ADD CONSTRAINT %1$s_expense_context_check CHECK (
        (expense_context = 'employer' AND employer_org_id IS NOT NULL
          AND expense_status IN ('pending_approval', 'approved', 'rejected', 'cancelled'))
        OR (expense_context IN ('dco', 'personal') AND employer_org_id IS NULL
          AND expense_status IN ('personal', 'cancelled'))
      )
    $sql$, v_table);
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %1$s_owner_idx ON public.%1$I (owner_user_id, entered_at DESC)',
      v_table);
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %1$s_employer_status_idx ON public.%1$I (employer_org_id, expense_status, entered_at DESC) WHERE expense_context = ''employer''',
      v_table);
  END LOOP;
END
$constraints$;

-- ---------------------------------------------------------------------------
-- 5. Insert: derive ownership
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._trip_expense_assign_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_actor uuid;
  v_trip_org uuid;
  v_mode text;
  v_driver_user uuid;
  v_dco_user uuid;
  v_supplier_org uuid;
  v_employer uuid;
BEGIN
  SELECT t.organization_id, t.operating_mode, d.user_id, dp.user_id, s.linked_organization_id
    INTO v_trip_org, v_mode, v_driver_user, v_dco_user, v_supplier_org
  FROM public.trips t
  LEFT JOIN public.drivers d ON d.id = t.driver_id
  LEFT JOIN public.dco_payees dp ON dp.id = t.dco_payee_id
  LEFT JOIN public.suppliers s ON s.id = t.supplier_id
  WHERE t.id = NEW.trip_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'expense_trip_missing: trip % not found', NEW.trip_id USING ERRCODE = 'P0001';
  END IF;

  -- Authenticated callers are always the actor; trusted backend callers
  -- (no JWT) act as the row's entered_by.
  v_actor := coalesce(v_uid, NEW.entered_by);
  NEW.entered_by := v_actor;

  IF v_mode = 'DCO' THEN
    IF v_uid IS NOT NULL AND v_uid IS DISTINCT FROM v_dco_user AND v_uid IS DISTINCT FROM v_driver_user THEN
      RAISE EXCEPTION 'expense_dco_only: only the DCO can record expenses on a DCO trip'
        USING ERRCODE = '42501';
    END IF;
    NEW.expense_context := 'dco';
    NEW.employer_org_id := NULL;
  ELSIF v_uid IS NOT NULL AND public.is_org_staff(v_trip_org) THEN
    NEW.expense_context := 'employer';
    NEW.employer_org_id := v_trip_org;
  ELSIF v_actor IS NOT NULL AND v_actor = v_driver_user THEN
    v_employer := public._trip_expense_driver_employer(v_actor, v_trip_org, v_supplier_org);
    IF v_employer IS NULL AND v_supplier_org IS NOT NULL AND v_uid IS NOT NULL
       AND public.is_org_staff(v_supplier_org) THEN
      v_employer := v_supplier_org;
    END IF;
    NEW.expense_context := CASE WHEN v_employer IS NULL THEN 'personal' ELSE 'employer' END;
    NEW.employer_org_id := v_employer;
  ELSIF v_uid IS NOT NULL AND v_supplier_org IS NOT NULL AND public.is_org_staff(v_supplier_org) THEN
    NEW.expense_context := 'employer';
    NEW.employer_org_id := v_supplier_org;
  ELSIF v_uid IS NULL THEN
    NEW.expense_context := 'employer';
    NEW.employer_org_id := v_trip_org;
  ELSE
    RAISE EXCEPTION 'expense_not_allowed: only the trip driver or the trip organization''s staff can record this expense'
      USING ERRCODE = '42501';
  END IF;

  NEW.owner_user_id := v_actor;
  NEW.rejection_reason := NULL;

  IF NEW.expense_context <> 'employer'
     OR (v_uid IS NOT NULL AND NOT public.is_org_staff(NEW.employer_org_id)) THEN
    -- Only the employer's staff may create a row that is already reviewed.
    NEW.approval_state := 'reported';
    NEW.posting_state := 'pending';
    NEW.posting_error := NULL;
    NEW.ledger_state := 'not_posted';
    NEW.reimbursement_state := 'reported';
    NEW.approved_by := NULL;
    NEW.approved_at := NULL;
    NEW.reimbursed_at := NULL;
    NEW.reimbursed_by := NULL;
  END IF;

  NEW.expense_status := public._trip_expense_status_from_legacy(
    NEW.expense_context, NEW.status, NEW.approval_state);
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public._trip_expense_assign_owner() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Update: freeze ownership, gate review columns
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._trip_expense_guard_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_reviewer boolean;
  v_review_cols text[] := ARRAY[
    'approval_state', 'posting_state', 'posting_error', 'ledger_state',
    'reimbursement_state', 'reimbursement_updated_at', 'reimbursed_at', 'reimbursed_by',
    'reimbursement_notes', 'approved_by', 'approved_at', 'retry_count', 'last_retry_at',
    'rejection_reason', 'expense_status', 'updated_at'
  ];
  v_review_changed boolean;
  v_content_changed boolean;
  v_new jsonb;
  v_old jsonb;
BEGIN
  IF NEW.trip_id IS DISTINCT FROM OLD.trip_id
     OR NEW.expense_context IS DISTINCT FROM OLD.expense_context
     OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
     OR NEW.employer_org_id IS DISTINCT FROM OLD.employer_org_id
     OR NEW.entered_by IS DISTINCT FROM OLD.entered_by
     OR NEW.entered_at IS DISTINCT FROM OLD.entered_at THEN
    RAISE EXCEPTION 'expense_ownership_frozen: an expense''s trip, owner and context cannot change'
      USING ERRCODE = '42501';
  END IF;

  v_new := to_jsonb(NEW);
  v_old := to_jsonb(OLD);
  -- updated_at and expense_status are maintained here, not by the caller.
  v_review_changed := EXISTS (
    SELECT 1 FROM unnest(v_review_cols) AS k(col)
    WHERE k.col NOT IN ('updated_at', 'expense_status')
      AND (v_new -> k.col) IS DISTINCT FROM (v_old -> k.col)
  );
  v_content_changed := (v_new - v_review_cols) IS DISTINCT FROM (v_old - v_review_cols);

  IF v_uid IS NULL THEN
    NEW.expense_status := public._trip_expense_status_from_legacy(
      NEW.expense_context, NEW.status, NEW.approval_state);
    RETURN NEW;
  END IF;

  IF OLD.expense_context <> 'employer' THEN
    IF v_review_changed THEN
      RAISE EXCEPTION 'expense_no_review: DCO and personal expenses are not approved, posted or reimbursed'
        USING ERRCODE = '42501';
    END IF;
    IF OLD.status = 'voided' AND v_content_changed THEN
      RAISE EXCEPTION 'expense_cancelled: a cancelled expense cannot be edited' USING ERRCODE = 'P0001';
    END IF;
    NEW.expense_status := public._trip_expense_status_from_legacy(
      NEW.expense_context, NEW.status, NEW.approval_state);
    RETURN NEW;
  END IF;

  v_reviewer := public.is_org_staff(OLD.employer_org_id);

  IF OLD.status = 'voided' AND v_content_changed THEN
    RAISE EXCEPTION 'expense_cancelled: a cancelled expense cannot be edited' USING ERRCODE = 'P0001';
  END IF;

  IF v_content_changed AND (OLD.ledger_state = 'posted' OR OLD.posting_state = 'posted') THEN
    RAISE EXCEPTION 'expense_posted: a posted expense cannot be edited' USING ERRCODE = 'P0001';
  END IF;

  IF NOT v_reviewer THEN
    IF v_review_changed THEN
      RAISE EXCEPTION 'expense_review_only: only the employer can approve, reject or post this expense'
        USING ERRCODE = '42501';
    END IF;
    IF v_content_changed THEN
      IF OLD.expense_status = 'approved' THEN
        RAISE EXCEPTION 'expense_approved: an approved expense cannot be edited' USING ERRCODE = 'P0001';
      END IF;
      NEW.approval_state := 'reported';
      NEW.posting_state := 'pending';
      NEW.posting_error := NULL;
      NEW.reimbursement_state := 'reported';
      NEW.approved_by := NULL;
      NEW.approved_at := NULL;
      NEW.rejection_reason := NULL;
    END IF;
  ELSIF v_content_changed AND OLD.expense_status = 'approved'
        AND NEW.approval_state IS NOT DISTINCT FROM OLD.approval_state THEN
    NEW.approval_state := 'review_pending';
    NEW.posting_state := 'pending';
    NEW.approved_by := NULL;
    NEW.approved_at := NULL;
  END IF;

  IF NEW.approval_state IN ('approved', 'settled')
     AND OLD.approval_state NOT IN ('approved', 'settled') THEN
    NEW.approved_by := coalesce(NEW.approved_by, v_uid);
    NEW.approved_at := coalesce(NEW.approved_at, now());
    NEW.rejection_reason := NULL;
  END IF;

  NEW.expense_status := public._trip_expense_status_from_legacy(
    NEW.expense_context, NEW.status, NEW.approval_state);
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public._trip_expense_guard_update() FROM PUBLIC, anon, authenticated;

DO $triggers$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['trip_fuel_entries', 'trip_toll_entries', 'trip_other_expenses'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_assign_owner ON public.%1$I', v_table);
    EXECUTE format(
      'CREATE TRIGGER trg_%1$s_assign_owner BEFORE INSERT ON public.%1$I FOR EACH ROW EXECUTE FUNCTION public._trip_expense_assign_owner()',
      v_table);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_guard_update ON public.%1$I', v_table);
    EXECUTE format(
      'CREATE TRIGGER trg_%1$s_guard_update BEFORE UPDATE ON public.%1$I FOR EACH ROW EXECUTE FUNCTION public._trip_expense_guard_update()',
      v_table);
  END LOOP;
END
$triggers$;

-- ---------------------------------------------------------------------------
-- 7. RLS: replace every existing policy
-- ---------------------------------------------------------------------------

DO $policies$
DECLARE
  v_table text;
  v_policy record;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['trip_fuel_entries', 'trip_toll_entries', 'trip_other_expenses'] LOOP
    FOR v_policy IN
      SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = v_table
    LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', v_policy.policyname, v_table);
    END LOOP;

    EXECUTE format('ALTER TABLE public.%1$I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format('REVOKE DELETE ON public.%1$I FROM authenticated, anon', v_table);
    EXECUTE format('REVOKE ALL ON public.%1$I FROM anon', v_table);

    EXECUTE format($sql$
      CREATE POLICY %1$s_select ON public.%1$I FOR SELECT TO authenticated
      USING (
        owner_user_id = (SELECT auth.uid())
        OR (expense_context = 'employer' AND public.is_org_staff(employer_org_id))
      )
    $sql$, v_table);
    EXECUTE format($sql$
      CREATE POLICY %1$s_insert ON public.%1$I FOR INSERT TO authenticated
      WITH CHECK (
        owner_user_id = (SELECT auth.uid())
        OR (expense_context = 'employer' AND public.is_org_staff(employer_org_id))
      )
    $sql$, v_table);
    EXECUTE format($sql$
      CREATE POLICY %1$s_update ON public.%1$I FOR UPDATE TO authenticated
      USING (
        owner_user_id = (SELECT auth.uid())
        OR (expense_context = 'employer' AND public.is_org_staff(employer_org_id))
      )
      WITH CHECK (
        owner_user_id = (SELECT auth.uid())
        OR (expense_context = 'employer' AND public.is_org_staff(employer_org_id))
      )
    $sql$, v_table);
  END LOOP;
END
$policies$;

-- ---------------------------------------------------------------------------
-- 8. Unified read view and review RPCs
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.trip_expenses
WITH (security_invoker = true)
AS
SELECT
  'fuel'::text AS expense_kind, f.id, f.trip_id, f.amount_inr, 'fuel'::text AS category,
  f.notes AS description, f.expense_context, f.owner_user_id, f.employer_org_id, f.expense_status,
  f.rejection_reason, f.approval_state, f.posting_state, f.ledger_state, f.reimbursement_state, f.reimbursement_notes,
  f.payment_owner, f.payment_mode, f.bill_storage_path AS receipt_storage_path,
  f.entered_by, f.entered_at, f.approved_by, f.approved_at, f.reimbursed_at
FROM public.trip_fuel_entries f
WHERE f.status = 'active'
UNION ALL
SELECT
  'toll'::text, t.id, t.trip_id, t.amount_inr, 'toll'::text,
  coalesce(t.plaza_name, t.notes), t.expense_context, t.owner_user_id, t.employer_org_id, t.expense_status,
  t.rejection_reason, t.approval_state, t.posting_state, t.ledger_state, t.reimbursement_state, t.reimbursement_notes,
  t.payment_owner, t.payment_mode, t.receipt_storage_path,
  t.entered_by, t.entered_at, t.approved_by, t.approved_at, t.reimbursed_at
FROM public.trip_toll_entries t
WHERE t.status = 'active'
UNION ALL
SELECT
  'other'::text, o.id, o.trip_id, o.amount_inr, o.expense_category,
  coalesce(o.description, o.notes), o.expense_context, o.owner_user_id, o.employer_org_id, o.expense_status,
  o.rejection_reason, o.approval_state, o.posting_state, o.ledger_state, o.reimbursement_state, o.reimbursement_notes,
  o.payment_owner, o.payment_mode, o.receipt_storage_path,
  o.entered_by, o.entered_at, o.approved_by, o.approved_at, o.reimbursed_at
FROM public.trip_other_expenses o
WHERE o.status = 'active';

REVOKE ALL ON public.trip_expenses FROM PUBLIC, anon;
GRANT SELECT ON public.trip_expenses TO authenticated;

COMMENT ON VIEW public.trip_expenses IS
  'Active trip expenses across fuel, toll and other. security_invoker: callers see only rows the base-table RLS allows.';

CREATE OR REPLACE FUNCTION public._trip_expense_table(p_kind text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO ''
AS $function$
  SELECT CASE p_kind
    WHEN 'fuel' THEN 'trip_fuel_entries'
    WHEN 'toll' THEN 'trip_toll_entries'
    WHEN 'other' THEN 'trip_other_expenses'
  END;
$function$;

CREATE OR REPLACE FUNCTION public.review_trip_expense(
  p_kind text,
  p_id uuid,
  p_decision text,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $function$
DECLARE
  v_table text := public._trip_expense_table(p_kind);
  v_context text;
  v_employer uuid;
  v_status text;
  v_result jsonb;
BEGIN
  IF v_table IS NULL THEN
    RAISE EXCEPTION 'expense_kind_invalid: %', p_kind USING ERRCODE = '22023';
  END IF;
  IF p_decision IS NULL OR p_decision NOT IN ('approve', 'reject') THEN
    RAISE EXCEPTION 'expense_decision_invalid: %', p_decision USING ERRCODE = '22023';
  END IF;

  EXECUTE format(
    'SELECT expense_context, employer_org_id, expense_status FROM public.%I WHERE id = $1 FOR UPDATE',
    v_table) INTO v_context, v_employer, v_status USING p_id;
  IF v_context IS NULL THEN
    RAISE EXCEPTION 'expense_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_context <> 'employer' OR NOT public.is_org_staff(v_employer) THEN
    RAISE EXCEPTION 'expense_review_only: only the employer can approve or reject this expense'
      USING ERRCODE = '42501';
  END IF;
  IF v_status <> 'pending_approval' THEN
    RAISE EXCEPTION 'expense_not_pending: this expense is already %', v_status
      USING ERRCODE = 'P0001';
  END IF;

  IF p_decision = 'approve' THEN
    EXECUTE format($sql$
      UPDATE public.%I SET
        approval_state = 'approved',
        posting_state = 'approved',
        posting_error = NULL,
        approved_by = auth.uid(),
        approved_at = now(),
        rejection_reason = NULL,
        reimbursement_state = CASE WHEN payment_owner = 'driver' THEN 'reimbursement_pending' ELSE 'approved' END,
        reimbursement_updated_at = now()
      WHERE id = $1
      RETURNING jsonb_build_object('id', id, 'expense_status', expense_status)
    $sql$, v_table) INTO v_result USING p_id;
  ELSE
    IF nullif(btrim(coalesce(p_reason, '')), '') IS NULL THEN
      RAISE EXCEPTION 'expense_reason_required: give a reason for rejecting' USING ERRCODE = '22023';
    END IF;
    EXECUTE format($sql$
      UPDATE public.%I SET
        approval_state = 'rejected',
        posting_state = 'rejected',
        approved_by = NULL,
        approved_at = NULL,
        rejection_reason = $2,
        reimbursement_state = 'rejected',
        reimbursement_updated_at = now()
      WHERE id = $1
      RETURNING jsonb_build_object('id', id, 'expense_status', expense_status)
    $sql$, v_table) INTO v_result USING p_id, btrim(p_reason);
  END IF;
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.review_trip_expense(text, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_trip_expense(text, uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.cancel_my_trip_expense(p_kind text, p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $function$
DECLARE
  v_table text := public._trip_expense_table(p_kind);
  v_owner uuid;
  v_result jsonb;
BEGIN
  IF v_table IS NULL THEN
    RAISE EXCEPTION 'expense_kind_invalid: %', p_kind USING ERRCODE = '22023';
  END IF;
  EXECUTE format('SELECT owner_user_id FROM public.%I WHERE id = $1', v_table) INTO v_owner USING p_id;
  IF v_owner IS NULL OR v_owner IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'expense_not_found' USING ERRCODE = 'P0002';
  END IF;
  EXECUTE format(
    'UPDATE public.%I SET status = ''voided'' WHERE id = $1 RETURNING jsonb_build_object(''id'', id, ''expense_status'', expense_status)',
    v_table) INTO v_result USING p_id;
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.cancel_my_trip_expense(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_my_trip_expense(text, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 9. Finance boundary on vehicle ledgers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._trip_expense_for_ledger_source(p_source_type text, p_source_id uuid)
RETURNS TABLE(expense_context text, employer_org_id uuid, expense_status text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT e.expense_context, e.employer_org_id, e.expense_status
  FROM public.trip_fuel_entries e WHERE p_source_type = 'fuel' AND e.id = p_source_id
  UNION ALL
  SELECT e.expense_context, e.employer_org_id, e.expense_status
  FROM public.trip_toll_entries e WHERE p_source_type = 'toll' AND e.id = p_source_id
  UNION ALL
  SELECT e.expense_context, e.employer_org_id, e.expense_status
  FROM public.trip_other_expenses e WHERE p_source_type = 'manual_adjustment' AND e.id = p_source_id;
$function$;

REVOKE ALL ON FUNCTION public._trip_expense_for_ledger_source(text, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._trip_expense_ledger_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_exp record;
  v_needs_approval boolean := true;
BEGIN
  -- vehicle_ledger_entries has no approval_state; only read it on drafts.
  IF TG_TABLE_NAME = 'vehicle_operation_ledger_entries' THEN
    IF NEW.approval_state = 'ignored' THEN
      RETURN NEW;
    END IF;
    v_needs_approval := NEW.approval_state IN ('verified', 'approved');
  END IF;
  SELECT * INTO v_exp FROM public._trip_expense_for_ledger_source(NEW.source_type, NEW.source_id);
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  IF v_exp.expense_context <> 'employer' OR v_exp.employer_org_id IS DISTINCT FROM NEW.organization_id THEN
    RAISE EXCEPTION 'expense_not_employer: only an employer expense of this organization can enter its Finance'
      USING ERRCODE = '42501';
  END IF;
  IF v_needs_approval AND v_exp.expense_status <> 'approved' THEN
    RAISE EXCEPTION 'expense_not_approved: approve the expense before it is posted'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public._trip_expense_ledger_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_vehicle_operation_ledger_expense_guard ON public.vehicle_operation_ledger_entries;
CREATE TRIGGER trg_vehicle_operation_ledger_expense_guard
  BEFORE INSERT OR UPDATE OF source_type, source_id, organization_id, approval_state
  ON public.vehicle_operation_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION public._trip_expense_ledger_guard();

DROP TRIGGER IF EXISTS trg_vehicle_ledger_expense_guard ON public.vehicle_ledger_entries;
CREATE TRIGGER trg_vehicle_ledger_expense_guard
  BEFORE INSERT OR UPDATE OF source_type, source_id, organization_id
  ON public.vehicle_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION public._trip_expense_ledger_guard();

-- ---------------------------------------------------------------------------
-- 10. Receipts
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._can_read_trip_expense_receipt(p_storage_path text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO ''
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.trip_fuel_entries e WHERE e.bill_storage_path = p_storage_path)
      OR EXISTS (SELECT 1 FROM public.trip_toll_entries e WHERE e.receipt_storage_path = p_storage_path)
      OR EXISTS (SELECT 1 FROM public.trip_other_expenses e WHERE e.receipt_storage_path = p_storage_path);
$function$;

GRANT EXECUTE ON FUNCTION public._can_read_trip_expense_receipt(text) TO authenticated;

CREATE INDEX IF NOT EXISTS trip_fuel_entries_bill_storage_path_idx
  ON public.trip_fuel_entries (bill_storage_path) WHERE bill_storage_path IS NOT NULL;
CREATE INDEX IF NOT EXISTS trip_toll_entries_receipt_storage_path_idx
  ON public.trip_toll_entries (receipt_storage_path) WHERE receipt_storage_path IS NOT NULL;
CREATE INDEX IF NOT EXISTS trip_other_expenses_receipt_storage_path_idx
  ON public.trip_other_expenses (receipt_storage_path) WHERE receipt_storage_path IS NOT NULL;

DROP POLICY IF EXISTS trip_documents_expense_receipt_restrict ON public.trip_documents;
CREATE POLICY trip_documents_expense_receipt_restrict
  ON public.trip_documents
  AS RESTRICTIVE
  FOR SELECT
  TO authenticated
  USING (
    coalesce(document_type, '') NOT IN ('fuel_bill_photo', 'toll_receipt_photo', 'trip_expense_receipt_photo')
    OR uploaded_by = (SELECT auth.uid())
    OR public._can_read_trip_expense_receipt(storage_path)
  );

-- ---------------------------------------------------------------------------
-- 11. No-trip personal expenses
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.driver_personal_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  category text NOT NULL,
  amount_inr numeric(12,2) NOT NULL,
  note text,
  spent_on date NOT NULL DEFAULT current_date,
  created_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  CONSTRAINT driver_personal_expenses_amount_positive CHECK (amount_inr > 0),
  CONSTRAINT driver_personal_expenses_category_check CHECK (
    category IN ('fuel', 'toll', 'parking', 'food', 'maintenance', 'misc')
  ),
  CONSTRAINT driver_personal_expenses_note_length CHECK (note IS NULL OR length(note) <= 500)
);

CREATE INDEX IF NOT EXISTS driver_personal_expenses_owner_idx
  ON public.driver_personal_expenses (owner_user_id, created_at DESC);

ALTER TABLE public.driver_personal_expenses ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.driver_personal_expenses FROM PUBLIC, anon;
GRANT SELECT, INSERT ON public.driver_personal_expenses TO authenticated;
GRANT UPDATE (cancelled_at) ON public.driver_personal_expenses TO authenticated;

DROP POLICY IF EXISTS driver_personal_expenses_owner_select ON public.driver_personal_expenses;
CREATE POLICY driver_personal_expenses_owner_select ON public.driver_personal_expenses
  FOR SELECT TO authenticated USING (owner_user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS driver_personal_expenses_owner_insert ON public.driver_personal_expenses;
CREATE POLICY driver_personal_expenses_owner_insert ON public.driver_personal_expenses
  FOR INSERT TO authenticated WITH CHECK (owner_user_id = (SELECT auth.uid()) AND cancelled_at IS NULL);
DROP POLICY IF EXISTS driver_personal_expenses_owner_cancel ON public.driver_personal_expenses;
CREATE POLICY driver_personal_expenses_owner_cancel ON public.driver_personal_expenses
  FOR UPDATE TO authenticated
  USING (owner_user_id = (SELECT auth.uid()) AND cancelled_at IS NULL)
  WITH CHECK (owner_user_id = (SELECT auth.uid()));

COMMENT ON TABLE public.driver_personal_expenses IS
  'A driver''s own no-trip expense notes. Owner-only; never part of any organization''s Finance.';
