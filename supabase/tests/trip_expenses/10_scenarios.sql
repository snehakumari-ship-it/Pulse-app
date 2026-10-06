\set ON_ERROR_STOP on
-- Runs after 20271007190418. Setup as superuser; actors as `authenticated`.

CREATE FUNCTION public.t_assert(p_ok boolean, p_msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'ASSERT FAILED: %', p_msg; END IF;
  RAISE NOTICE 'PASS %', p_msg;
END $$;
CREATE FUNCTION public.t_expect_error(p_sql text, p_pattern text, p_msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM ~* p_pattern THEN RAISE NOTICE 'PASS % (%)', p_msg, SQLERRM; RETURN; END IF;
    RAISE EXCEPTION 'ASSERT FAILED: % expected /%/ got: %', p_msg, p_pattern, SQLERRM;
  END;
  RAISE EXCEPTION 'ASSERT FAILED: % expected error /%/ but statement succeeded', p_msg, p_pattern;
END $$;
CREATE FUNCTION public.t_as(p_uid uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), false)
$$;
GRANT EXECUTE ON FUNCTION public.t_assert(boolean, text), public.t_expect_error(text, text, text), public.t_as(uuid) TO authenticated, anon;

CREATE FUNCTION public.t_ctx(p_table text, p_id uuid) RETURNS text LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v text;
BEGIN
  EXECUTE format('SELECT concat_ws(''|'', expense_context, expense_status, employer_org_id, owner_user_id, approval_state, reimbursement_state) FROM public.%I WHERE id = $1', p_table)
    INTO v USING p_id;
  RETURN v;
END $$;
GRANT EXECUTE ON FUNCTION public.t_ctx(text, uuid) TO authenticated;

-- ── Backfill ────────────────────────────────────────────────────────────────
SELECT public.t_assert(public.t_ctx('trip_fuel_entries', '1f000000-0000-0000-0000-000000000001')
  = 'personal|personal|b3000000-0000-0000-0000-000000000000|reported|reported',
  'B1 no-employer driver row backfills to personal');
SELECT public.t_assert(public.t_ctx('trip_fuel_entries', '1f000000-0000-0000-0000-000000000002')
  LIKE 'employer|approved|f0000000-0000-0000-0000-00000000000f|%',
  'B2 already-posted row stays an employer row of the trip org');
SELECT public.t_assert(public.t_ctx('trip_toll_entries', '1f000000-0000-0000-0000-000000000003')
  LIKE 'employer|pending_approval|f0000000-0000-0000-0000-00000000000f|a1000000-0000-0000-0000-000000000000|%',
  'B3 staff-entered row is an employer row owned by the staff member');
SELECT public.t_assert(public.t_ctx('trip_other_expenses', '1f000000-0000-0000-0000-000000000004')
  LIKE 'dco|personal|b5000000-0000-0000-0000-000000000000|%',
  'B4 DCO trip row backfills to dco with no employer');
SELECT public.t_assert(public.t_ctx('trip_fuel_entries', '1f000000-0000-0000-0000-000000000005')
  LIKE 'employer|pending_approval|f0000000-0000-0000-0000-00000000000f|b1000000-0000-0000-0000-000000000000|%',
  'B5 invited driver row backfills to employer F');
SELECT public.t_assert(public.t_ctx('trip_other_expenses', '1f000000-0000-0000-0000-000000000007')
  LIKE 'employer|pending_approval|f0000000-0000-0000-0000-00000000005a|%',
  'B6 consumed invite: supplier org S is the employer');
SELECT public.t_assert(public.t_ctx('trip_other_expenses', '1f000000-0000-0000-0000-000000000008')
  LIKE 'employer|pending_approval|f0000000-0000-0000-0000-00000000005a|%',
  'B7 supplier owner who drives: employer S');
SELECT public.t_assert(public.t_ctx('trip_other_expenses', '1f000000-0000-0000-0000-000000000009')
  LIKE 'personal|cancelled|%',
  'B8 driver who left: personal; voided row is cancelled');
SELECT public.t_assert(
  (SELECT array_agg(approval_state ORDER BY amount) FROM public.vehicle_operation_ledger_entries)
  = ARRAY['ignored', 'ignored', 'draft'],
  'B9 drafts of non-employer rows set to ignored; employer draft kept');
SELECT public.t_assert(
  NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename IN ('trip_fuel_entries','trip_toll_entries','trip_other_expenses')
              AND policyname LIKE '%visible_trip_members%')
  AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename IN ('trip_fuel_entries','trip_toll_entries','trip_other_expenses')
              AND cmd IN ('ALL', 'DELETE')),
  'B10 old FOR ALL policies gone; no ALL or DELETE policy remains');

-- Receipts (uploaded before the rows reference them).
INSERT INTO public.trip_documents (trip_id, storage_path, document_type, uploaded_by) VALUES
  ('71000000-0000-0000-0000-000000000000', 'r/emp.jpg', 'fuel_bill_photo', 'b1000000-0000-0000-0000-000000000000'),
  ('73000000-0000-0000-0000-000000000000', 'r/free.jpg', 'fuel_bill_photo', 'b3000000-0000-0000-0000-000000000000'),
  ('71000000-0000-0000-0000-000000000000', 'r/pod.jpg', 'pod', 'a1000000-0000-0000-0000-000000000000'),
  ('71000000-0000-0000-0000-000000000000', 'r/untyped.jpg', NULL, 'a1000000-0000-0000-0000-000000000000');

SET ROLE authenticated;

-- ── Employer driver ─────────────────────────────────────────────────────────
SELECT public.t_as('b1000000-0000-0000-0000-000000000000');
INSERT INTO public.trip_fuel_entries (id, trip_id, amount_inr, payment_owner, approval_state, reimbursement_state, bill_storage_path, entered_by)
VALUES ('2f000000-0000-0000-0000-000000000011', '71000000-0000-0000-0000-000000000000', 1500, 'driver', 'approved', 'approved', 'r/emp.jpg', 'a1000000-0000-0000-0000-000000000000');
SELECT public.t_assert(public.t_ctx('trip_fuel_entries', '2f000000-0000-0000-0000-000000000011')
  = 'employer|pending_approval|f0000000-0000-0000-0000-00000000000f|b1000000-0000-0000-0000-000000000000|reported|reported',
  'R1 employed driver: employer F, pending; client approval and entered_by ignored');
SELECT public.t_expect_error($$UPDATE public.trip_fuel_entries SET approval_state = 'approved' WHERE id = '2f000000-0000-0000-0000-000000000011'$$,
  'expense_review_only', 'R2 driver cannot approve own expense');
SELECT public.t_expect_error($$SELECT public.review_trip_expense('fuel', '2f000000-0000-0000-0000-000000000011', 'approve')$$,
  'expense_review_only', 'R2b driver cannot call review RPC on own expense');
SELECT public.t_assert(NOT EXISTS (SELECT 1 FROM public.trip_toll_entries WHERE id = '1f000000-0000-0000-0000-000000000003'),
  'R4 driver does not see a staff-entered expense on own trip');

SELECT public.t_as('a3000000-0000-0000-0000-000000000000');
SELECT public.t_assert((SELECT count(*) FROM public.trip_fuel_entries) = 0, 'R3 stranger staff sees no expenses');
SELECT public.t_as('b3000000-0000-0000-0000-000000000000');
SELECT public.t_assert(NOT EXISTS (SELECT 1 FROM public.trip_fuel_entries WHERE id = '2f000000-0000-0000-0000-000000000011'),
  'R3b another driver does not see it');

SELECT public.t_as('a1000000-0000-0000-0000-000000000000');
SELECT public.t_assert(EXISTS (SELECT 1 FROM public.trip_fuel_entries WHERE id = '2f000000-0000-0000-0000-000000000011'),
  'R3c employer staff sees it');
SELECT public.t_assert((public.review_trip_expense('fuel', '2f000000-0000-0000-0000-000000000011', 'approve') ->> 'expense_status') = 'approved',
  'R5 employer approves');
SELECT public.t_assert(public.t_ctx('trip_fuel_entries', '2f000000-0000-0000-0000-000000000011') LIKE '%|approved|reimbursement_pending',
  'R5b driver-paid approval moves to reimbursement_pending');
SELECT public.t_expect_error($$SELECT public.review_trip_expense('fuel', '2f000000-0000-0000-0000-000000000011', 'reject', 'x')$$,
  'expense_not_pending', 'R5c approved expense cannot be reviewed again');

SELECT public.t_as('b1000000-0000-0000-0000-000000000000');
SELECT public.t_expect_error($$UPDATE public.trip_fuel_entries SET amount_inr = 1 WHERE id = '2f000000-0000-0000-0000-000000000011'$$,
  'expense_approved', 'R6 driver cannot edit an approved expense');

INSERT INTO public.trip_other_expenses (id, trip_id, expense_category, amount_inr, payment_owner)
VALUES ('2f000000-0000-0000-0000-000000000012', '71000000-0000-0000-0000-000000000000', 'parking', 90, 'driver');
SELECT public.t_as('a1000000-0000-0000-0000-000000000000');
SELECT public.t_expect_error($$SELECT public.review_trip_expense('other', '2f000000-0000-0000-0000-000000000012', 'reject', '  ')$$,
  'expense_reason_required', 'R7 reject needs a reason');
SELECT public.t_assert((public.review_trip_expense('other', '2f000000-0000-0000-0000-000000000012', 'reject', 'No receipt') ->> 'expense_status') = 'rejected',
  'R7b employer rejects with reason');
SELECT public.t_as('b1000000-0000-0000-0000-000000000000');
SELECT public.t_assert((SELECT rejection_reason FROM public.trip_other_expenses WHERE id = '2f000000-0000-0000-0000-000000000012') = 'No receipt',
  'R7c driver sees the rejection reason');
UPDATE public.trip_other_expenses SET amount_inr = 95 WHERE id = '2f000000-0000-0000-0000-000000000012';
SELECT public.t_assert(public.t_ctx('trip_other_expenses', '2f000000-0000-0000-0000-000000000012') LIKE 'employer|pending_approval|%|reported|reported'
  AND (SELECT rejection_reason FROM public.trip_other_expenses WHERE id = '2f000000-0000-0000-0000-000000000012') IS NULL,
  'R7d driver edit of a rejected expense resubmits it');

-- ── Supplier-employed driver ────────────────────────────────────────────────
SELECT public.t_as('b2000000-0000-0000-0000-000000000000');
INSERT INTO public.trip_fuel_entries (id, trip_id, amount_inr, payment_owner)
VALUES ('2f000000-0000-0000-0000-000000000013', '72000000-0000-0000-0000-000000000000', 400, 'driver');
SELECT public.t_assert(public.t_ctx('trip_fuel_entries', '2f000000-0000-0000-0000-000000000013') LIKE 'employer|pending_approval|f0000000-0000-0000-0000-00000000005a|%',
  'R8 supplier driver: employer is supplier org S');
SELECT public.t_as('a1000000-0000-0000-0000-000000000000');
SELECT public.t_assert(NOT EXISTS (SELECT 1 FROM public.trip_fuel_entries WHERE id = '2f000000-0000-0000-0000-000000000013'),
  'R8b trip org (not the employer) does not see it');
SELECT public.t_expect_error($$SELECT public.review_trip_expense('fuel', '2f000000-0000-0000-0000-000000000013', 'approve')$$,
  'expense_not_found', 'R8c trip org cannot review it');
SELECT public.t_as('a2000000-0000-0000-0000-000000000000');
SELECT public.t_assert((public.review_trip_expense('fuel', '2f000000-0000-0000-0000-000000000013', 'approve') ->> 'expense_status') = 'approved',
  'R8d employer S approves');
UPDATE public.trip_fuel_entries SET amount_inr = 410 WHERE id = '2f000000-0000-0000-0000-000000000013';
SELECT public.t_assert(public.t_ctx('trip_fuel_entries', '2f000000-0000-0000-0000-000000000013') LIKE 'employer|pending_approval|%',
  'R22 staff edit of an approved, unposted expense returns it to review');
INSERT INTO public.trip_toll_entries (id, trip_id, amount_inr)
VALUES ('2f000000-0000-0000-0000-000000000019', '72000000-0000-0000-0000-000000000000', 55);
SELECT public.t_assert(public.t_ctx('trip_toll_entries', '2f000000-0000-0000-0000-000000000019') LIKE 'employer|%|f0000000-0000-0000-0000-00000000005a|a2000000-0000-0000-0000-000000000000|%',
  'R17b supplier staff records on the supplier''s trip: employer S');

SELECT public.t_as('b6000000-0000-0000-0000-000000000000');
INSERT INTO public.trip_other_expenses (id, trip_id, expense_category, amount_inr)
VALUES ('2f000000-0000-0000-0000-000000000018', '76000000-0000-0000-0000-000000000000', 'misc', 20);
SELECT public.t_assert(public.t_ctx('trip_other_expenses', '2f000000-0000-0000-0000-000000000018') LIKE 'employer|%|f0000000-0000-0000-0000-00000000005a|%',
  'R17 supplier owner driving: employer S');

-- ── Driver without employer ─────────────────────────────────────────────────
SELECT public.t_as('b3000000-0000-0000-0000-000000000000');
INSERT INTO public.trip_fuel_entries (id, trip_id, amount_inr, payment_owner, reimbursement_state, bill_storage_path)
VALUES ('2f000000-0000-0000-0000-000000000014', '73000000-0000-0000-0000-000000000000', 650, 'driver', 'approved', 'r/free.jpg');
SELECT public.t_assert(public.t_ctx('trip_fuel_entries', '2f000000-0000-0000-0000-000000000014')
  = 'personal|personal|b3000000-0000-0000-0000-000000000000|reported|reported',
  'R9 no employer: personal reference, no approval');
SELECT public.t_expect_error($$UPDATE public.trip_fuel_entries SET approval_state = 'approved' WHERE id = '2f000000-0000-0000-0000-000000000014'$$,
  'expense_no_review', 'R9b personal expense cannot be approved');
UPDATE public.trip_fuel_entries SET amount_inr = 660 WHERE id = '2f000000-0000-0000-0000-000000000014';
SELECT public.t_assert((SELECT amount_inr FROM public.trip_fuel_entries WHERE id = '2f000000-0000-0000-0000-000000000014') = 660,
  'R9c owner can edit a personal expense');
SELECT public.t_as('a1000000-0000-0000-0000-000000000000');
SELECT public.t_assert(NOT EXISTS (SELECT 1 FROM public.trip_fuel_entries WHERE expense_context = 'personal'),
  'R9d trip org staff sees no personal expenses');
SELECT public.t_expect_error($$SELECT public.review_trip_expense('fuel', '2f000000-0000-0000-0000-000000000014', 'approve')$$,
  'expense_not_found', 'R9e trip org cannot review a personal expense');

SELECT public.t_as('b4000000-0000-0000-0000-000000000000');
INSERT INTO public.trip_fuel_entries (id, trip_id, amount_inr)
VALUES ('2f000000-0000-0000-0000-000000000015', '75000000-0000-0000-0000-000000000000', 100);
SELECT public.t_assert(public.t_ctx('trip_fuel_entries', '2f000000-0000-0000-0000-000000000015') LIKE 'personal|personal|%',
  'R10 driver who left the employer: personal');

-- ── DCO ─────────────────────────────────────────────────────────────────────
SELECT public.t_as('b5000000-0000-0000-0000-000000000000');
INSERT INTO public.trip_other_expenses (id, trip_id, expense_category, amount_inr, payment_owner, reimbursement_state, approval_state)
VALUES ('2f000000-0000-0000-0000-000000000016', '74000000-0000-0000-0000-000000000000', 'food', 250, 'driver', 'approved', 'approved');
SELECT public.t_assert(public.t_ctx('trip_other_expenses', '2f000000-0000-0000-0000-000000000016')
  = 'dco|personal|b5000000-0000-0000-0000-000000000000|reported|reported',
  'R11 DCO expense: dco context, never approved');
SELECT public.t_expect_error($$UPDATE public.trip_other_expenses SET reimbursement_state = 'approved' WHERE id = '2f000000-0000-0000-0000-000000000016'$$,
  'expense_no_review', 'R24 DCO expense cannot be approved or reimbursed');
SELECT public.t_as('a1000000-0000-0000-0000-000000000000');
SELECT public.t_expect_error($$INSERT INTO public.trip_fuel_entries (trip_id, amount_inr) VALUES ('74000000-0000-0000-0000-000000000000', 10)$$,
  'expense_dco_only', 'R11b shipper staff cannot record on a DCO trip');
SELECT public.t_assert(NOT EXISTS (SELECT 1 FROM public.trip_other_expenses WHERE expense_context = 'dco'),
  'R11c shipper staff sees no DCO expenses');
SELECT public.t_expect_error($$SELECT public.review_trip_expense('other', '2f000000-0000-0000-0000-000000000016', 'approve')$$,
  'expense_not_found', 'R24b shipper cannot review a DCO expense');

-- ── Staff-entered and refused writers ───────────────────────────────────────
INSERT INTO public.trip_toll_entries (id, trip_id, amount_inr, approval_state)
VALUES ('2f000000-0000-0000-0000-000000000017', '71000000-0000-0000-0000-000000000000', 75, 'review_pending');
SELECT public.t_assert(public.t_ctx('trip_toll_entries', '2f000000-0000-0000-0000-000000000017')
  LIKE 'employer|pending_approval|f0000000-0000-0000-0000-00000000000f|a1000000-0000-0000-0000-000000000000|review_pending|%',
  'R12 staff entry: employer F, owned by staff');
SELECT public.t_expect_error($$UPDATE public.trip_toll_entries SET owner_user_id = 'b1000000-0000-0000-0000-000000000000' WHERE id = '2f000000-0000-0000-0000-000000000017'$$,
  'expense_ownership_frozen', 'R14 owner is frozen');
SELECT public.t_expect_error($$UPDATE public.trip_toll_entries SET trip_id = '73000000-0000-0000-0000-000000000000' WHERE id = '2f000000-0000-0000-0000-000000000017'$$,
  'expense_ownership_frozen', 'R14b trip is frozen');
SELECT public.t_expect_error($$DELETE FROM public.trip_toll_entries WHERE id = '2f000000-0000-0000-0000-000000000017'$$,
  'permission denied', 'R15 no deletes');
SELECT public.t_as('b1000000-0000-0000-0000-000000000000');
SELECT public.t_assert(NOT EXISTS (SELECT 1 FROM public.trip_toll_entries WHERE id = '2f000000-0000-0000-0000-000000000017'),
  'R12b driver does not see the staff entry');
SELECT public.t_as('a3000000-0000-0000-0000-000000000000');
SELECT public.t_expect_error($$INSERT INTO public.trip_fuel_entries (trip_id, amount_inr) VALUES ('71000000-0000-0000-0000-000000000000', 10)$$,
  'expense_not_allowed', 'R13 stranger cannot record on a trip');

-- ── Finance boundary ────────────────────────────────────────────────────────
SELECT public.t_as('a1000000-0000-0000-0000-000000000000');
SELECT public.t_expect_error($$INSERT INTO public.vehicle_operation_ledger_entries (organization_id, source_type, source_id, trip_id, amount)
  VALUES ('f0000000-0000-0000-0000-00000000000f', 'fuel', '2f000000-0000-0000-0000-000000000014', '73000000-0000-0000-0000-000000000000', 660)$$,
  'expense_not_employer', 'R16 personal expense cannot draft into employer Finance');
SELECT public.t_expect_error($$INSERT INTO public.vehicle_operation_ledger_entries (organization_id, source_type, source_id, trip_id, amount)
  VALUES ('f0000000-0000-0000-0000-00000000000f', 'fuel', '2f000000-0000-0000-0000-000000000013', '72000000-0000-0000-0000-000000000000', 410)$$,
  'expense_not_employer', 'R16b another org''s employer expense cannot draft here');
SELECT public.t_expect_error($$INSERT INTO public.vehicle_operation_ledger_entries (organization_id, source_type, source_id, trip_id, amount)
  VALUES ('f0000000-0000-0000-0000-00000000000f', 'manual_adjustment', '2f000000-0000-0000-0000-000000000016', '74000000-0000-0000-0000-000000000000', 250)$$,
  'expense_not_employer', 'R16c DCO expense cannot draft into shipper Finance');
INSERT INTO public.vehicle_operation_ledger_entries (organization_id, source_type, source_id, trip_id, amount)
  VALUES ('f0000000-0000-0000-0000-00000000000f', 'manual_adjustment', '2f000000-0000-0000-0000-000000000012', '71000000-0000-0000-0000-000000000000', 95);
SELECT public.t_assert(true, 'R16d pending employer expense may hold a draft');
SELECT public.t_expect_error($$UPDATE public.vehicle_operation_ledger_entries SET approval_state = 'approved' WHERE source_id = '2f000000-0000-0000-0000-000000000012'$$,
  'expense_not_approved', 'R16e draft cannot be approved before the expense');
SELECT public.t_expect_error($$INSERT INTO public.vehicle_ledger_entries (organization_id, source_type, source_id, trip_id, amount)
  VALUES ('f0000000-0000-0000-0000-00000000000f', 'manual_adjustment', '2f000000-0000-0000-0000-000000000012', '71000000-0000-0000-0000-000000000000', 95)$$,
  'expense_not_approved', 'R16f pending expense cannot post');
INSERT INTO public.vehicle_ledger_entries (organization_id, source_type, source_id, trip_id, amount)
  VALUES ('f0000000-0000-0000-0000-00000000000f', 'fuel', '2f000000-0000-0000-0000-000000000011', '71000000-0000-0000-0000-000000000000', 1500);
SELECT public.t_assert(true, 'R16g approved employer expense posts');
UPDATE public.trip_fuel_entries SET ledger_state = 'posted', posting_state = 'posted' WHERE id = '2f000000-0000-0000-0000-000000000011';
SELECT public.t_expect_error($$UPDATE public.trip_fuel_entries SET amount_inr = 1 WHERE id = '2f000000-0000-0000-0000-000000000011'$$,
  'expense_posted', 'R23 posted expense cannot be edited by staff');

-- ── Receipts ────────────────────────────────────────────────────────────────
SELECT public.t_assert(
  (SELECT array_agg(storage_path ORDER BY storage_path) FROM public.trip_documents) = ARRAY['r/emp.jpg', 'r/pod.jpg', 'r/untyped.jpg'],
  'R18 employer sees its expense receipt and non-receipt docs, not a personal receipt');
SELECT public.t_as('b3000000-0000-0000-0000-000000000000');
SELECT public.t_assert(
  (SELECT array_agg(storage_path ORDER BY storage_path) FROM public.trip_documents) = ARRAY['r/free.jpg', 'r/pod.jpg', 'r/untyped.jpg'],
  'R18b driver sees own receipt, not another driver''s');
SELECT public.t_as('a3000000-0000-0000-0000-000000000000');
SELECT public.t_assert(
  (SELECT array_agg(storage_path ORDER BY storage_path) FROM public.trip_documents) = ARRAY['r/pod.jpg', 'r/untyped.jpg'],
  'R18c stranger sees no expense receipts');

-- ── View ────────────────────────────────────────────────────────────────────
SELECT public.t_as('a1000000-0000-0000-0000-000000000000');
SELECT public.t_assert(
  (SELECT bool_and(expense_context = 'employer' AND employer_org_id = 'f0000000-0000-0000-0000-00000000000f') FROM public.trip_expenses)
  AND (SELECT count(DISTINCT expense_kind) FROM public.trip_expenses) = 3,
  'R20 trip_expenses for employer F: only its employer rows, all three kinds');
SELECT public.t_as('b3000000-0000-0000-0000-000000000000');
SELECT public.t_assert(
  (SELECT bool_and(owner_user_id = 'b3000000-0000-0000-0000-000000000000') FROM public.trip_expenses),
  'R20b driver view shows only own rows');

-- ── Cancel ──────────────────────────────────────────────────────────────────
SELECT public.t_as('b1000000-0000-0000-0000-000000000000');
SELECT public.t_assert((public.cancel_my_trip_expense('other', '2f000000-0000-0000-0000-000000000012') ->> 'expense_status') = 'cancelled',
  'R21 driver cancels a pending expense');
SELECT public.t_expect_error($$SELECT public.cancel_my_trip_expense('fuel', '2f000000-0000-0000-0000-000000000011')$$,
  'expense_posted|expense_approved', 'R21b approved/posted expense cannot be cancelled by the driver');
SELECT public.t_as('b3000000-0000-0000-0000-000000000000');
SELECT public.t_expect_error($$SELECT public.cancel_my_trip_expense('toll', '2f000000-0000-0000-0000-000000000017')$$,
  'expense_not_found', 'R21c cannot cancel someone else''s expense');

-- ── No-trip personal expenses ───────────────────────────────────────────────
INSERT INTO public.driver_personal_expenses (id, category, amount_inr, note)
VALUES ('3f000000-0000-0000-0000-000000000001', 'food', 120, 'Dhaba');
SELECT public.t_expect_error($$INSERT INTO public.driver_personal_expenses (owner_user_id, category, amount_inr) VALUES ('b1000000-0000-0000-0000-000000000000', 'food', 5)$$,
  'row-level security', 'R19 cannot write a personal expense for someone else');
SELECT public.t_expect_error($$UPDATE public.driver_personal_expenses SET amount_inr = 1$$,
  'permission denied', 'R19b only cancelled_at is updatable');
UPDATE public.driver_personal_expenses SET cancelled_at = now() WHERE id = '3f000000-0000-0000-0000-000000000001';
UPDATE public.driver_personal_expenses SET cancelled_at = NULL WHERE id = '3f000000-0000-0000-0000-000000000001';
SELECT public.t_assert((SELECT cancelled_at IS NOT NULL FROM public.driver_personal_expenses WHERE id = '3f000000-0000-0000-0000-000000000001'),
  'R19c a cancelled note cannot be restored');
SELECT public.t_as('a1000000-0000-0000-0000-000000000000');
SELECT public.t_assert((SELECT count(*) FROM public.driver_personal_expenses) = 0, 'R19d staff cannot read driver personal notes');

RESET ROLE;
SET ROLE anon;
SELECT public.t_expect_error($$SELECT 1 FROM public.trip_fuel_entries$$, 'permission denied', 'R25 anon has no access');
SELECT public.t_expect_error($$SELECT 1 FROM public.trip_expenses$$, 'permission denied', 'R25b anon cannot read the view');
RESET ROLE;

-- ── Trusted backend writer (no JWT) ─────────────────────────────────────────
SELECT public.t_as(NULL);
INSERT INTO public.trip_fuel_entries (id, trip_id, amount_inr, entered_by)
VALUES ('2f000000-0000-0000-0000-000000000020', '73000000-0000-0000-0000-000000000000', 10, 'b3000000-0000-0000-0000-000000000000');
SELECT public.t_assert(public.t_ctx('trip_fuel_entries', '2f000000-0000-0000-0000-000000000020') LIKE 'personal|%',
  'R26 backend insert for a driver derives the same context');

SELECT public.t_assert(
  NOT EXISTS (SELECT 1 FROM public.trip_expenses WHERE expense_context <> 'employer' AND expense_status NOT IN ('personal', 'cancelled'))
  AND NOT EXISTS (
    SELECT 1 FROM public.vehicle_ledger_entries v
    JOIN public.trip_expenses e ON e.id = v.source_id
    WHERE e.expense_context <> 'employer' OR e.expense_status <> 'approved' OR e.employer_org_id <> v.organization_id),
  'INV no DCO/personal row is ever approved; only approved employer rows are posted');
