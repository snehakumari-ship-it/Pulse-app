\set ON_ERROR_STOP on
-- After the migration is applied a second time: data unchanged, rules intact.
SELECT public.t_assert(
  (SELECT md5(string_agg(row_to_json(x)::text, ',' ORDER BY x.id)) FROM (
     SELECT id, expense_context, expense_status, owner_user_id, employer_org_id, approval_state, reimbursement_state, amount_inr
     FROM public.trip_expenses) x)
  = (SELECT digest FROM public.t_snapshot),
  'RR1 re-applying the migration leaves every expense row unchanged');
SELECT public.t_assert(
  (SELECT count(*) FROM pg_policies WHERE tablename IN ('trip_fuel_entries','trip_toll_entries','trip_other_expenses')) = 9,
  'RR2 exactly three policies per expense table after re-apply');
SELECT public.t_assert(
  (SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'trg_trip_%' AND NOT tgisinternal) = 6
  AND (SELECT count(*) FROM pg_trigger WHERE tgname IN ('trg_vehicle_operation_ledger_expense_guard', 'trg_vehicle_ledger_expense_guard')) = 2,
  'RR3 triggers present once');
SET ROLE authenticated;
SELECT public.t_as('a1000000-0000-0000-0000-000000000000');
SELECT public.t_expect_error($$INSERT INTO public.trip_fuel_entries (trip_id, amount_inr) VALUES ('74000000-0000-0000-0000-000000000000', 10)$$,
  'expense_dco_only', 'RR4 DCO rule still enforced after re-apply');
SELECT public.t_as('b3000000-0000-0000-0000-000000000000');
SELECT public.t_expect_error($$UPDATE public.trip_fuel_entries SET approval_state = 'approved' WHERE id = '2f000000-0000-0000-0000-000000000014'$$,
  'expense_no_review', 'RR5 personal rule still enforced after re-apply');
RESET ROLE;
