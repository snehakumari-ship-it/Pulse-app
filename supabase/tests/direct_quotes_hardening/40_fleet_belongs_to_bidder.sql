-- direct_quotes fleet trust boundary (20271007094500): every write path keeps
-- driver_id / vehicle_id inside the bidder organization, so the fleet that
-- create_trip_from_direct_quote copies onto the shipper trip is always the
-- bidder's own. Runs after 30_direct_quotes_hardening.sql (fixtures D_B1/D_B2,
-- VH_B1/VH_B2, u_drv_b1 and helpers t_dq*, t_quote_row, t_q, t_dml_as).

DO $$
BEGIN
  PERFORM t_ok('DQ fleet shape: trigger fires before insert and before updates of driver, vehicle or bidder org',
    (SELECT pg_get_triggerdef(t.oid) FROM pg_trigger t
      WHERE t.tgrelid = 'public.direct_quotes'::regclass AND t.tgname = 'trg_direct_quotes_fleet_belongs_to_bidder')
      LIKE '%BEFORE INSERT OR UPDATE OF driver_id, vehicle_id, bidder_organization_id ON public.direct_quotes FOR EACH ROW%', '');
  PERFORM t_ok('DQ fleet shape: trigger function is SECURITY DEFINER with search_path="" and not callable by clients',
    (SELECT p.prosecdef AND p.proconfig = ARRAY['search_path=""'] FROM pg_proc p
      WHERE p.oid = 'public.direct_quotes_fleet_belongs_to_bidder()'::regprocedure)
      AND NOT has_function_privilege('authenticated', 'public.direct_quotes_fleet_belongs_to_bidder()', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'public.direct_quotes_fleet_belongs_to_bidder()', 'EXECUTE'), '');
  PERFORM t_ok('DQ fleet shape: create_trip_from_direct_quote body is unchanged by this migration',
    (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.create_trip_from_direct_quote(uuid,text)'::regprocedure)
      = (SELECT v FROM t_dq_md5 WHERE k = 'create_trip'), '');
END $$;

-- Second B1 fleet: D_B1 / VH_B1 already run a trip from the 30 suite.
INSERT INTO t_ids VALUES
  ('D_B1b',  'e4000000-0000-0000-0000-000000000003'),
  ('VH_B1b', 'e5000000-0000-0000-0000-000000000003');
INSERT INTO public.drivers (id, organization_id, name, phone)
VALUES (t_id('D_B1b'), t_id('B1'), 'DQ Harness Driver B1b', '9990000003');
INSERT INTO public.vehicles (id, organization_id, vehicle_number, type)
VALUES (t_id('VH_B1b'), t_id('B1'), 'DQH01AA0003', 'owned');

SELECT t_dq_put('i_fg', t_indent(t_id('SHIP1'), 'DQ Fleet', 'DQ Guard', '20FT', 'integrated_supplier'));
SELECT t_dq_put('q_fg', t_quote_row(t_dq('i_fg'), t_id('B1'), 30000));
SELECT t_dq_put('i_fg_ins', t_indent(t_id('SHIP1'), 'DQ Fleet', 'DQ Guard', '20FT', 'integrated_supplier'));

-- Bidder direct writes (the RLS INSERT/UPDATE policies that stay until Phase F).
SELECT t_err_as('DQ fleet: bidder direct update cannot attach another org''s driver', t_id('u_bid1'),
  format('UPDATE public.direct_quotes SET driver_id = %L WHERE id = %L', t_id('D_B2'), t_dq('q_fg')), 'invalid_driver:');
SELECT t_err_as('DQ fleet: bidder direct update cannot attach another org''s vehicle', t_id('u_bid1'),
  format('UPDATE public.direct_quotes SET vehicle_id = %L WHERE id = %L', t_id('VH_B2'), t_dq('q_fg')), 'invalid_vehicle:');
SELECT t_err_as('DQ fleet: colleague direct update cannot attach another org''s driver', t_id('u_bid2'),
  format('UPDATE public.direct_quotes SET driver_id = %L, vehicle_id = %L WHERE id = %L', t_id('D_B2'), t_id('VH_B1'), t_dq('q_fg')),
  'invalid_driver:');
SELECT t_err_as('DQ fleet: bidder direct insert cannot carry another org''s driver', t_id('u_bid1'),
  format('INSERT INTO public.direct_quotes (indent_id, bidder_organization_id, amount, status, driver_id) VALUES (%L, %L, 1000, ''pending'', %L)',
    t_dq('i_fg_ins'), t_id('B1'), t_id('D_B2')), 'invalid_driver:');
SELECT t_err_as('DQ fleet: bidder direct upsert cannot carry another org''s vehicle', t_id('u_bid1'),
  format('INSERT INTO public.direct_quotes (indent_id, bidder_organization_id, amount, status, vehicle_id) VALUES (%L, %L, 1000, ''pending'', %L)
          ON CONFLICT (indent_id, bidder_organization_id) DO UPDATE SET vehicle_id = EXCLUDED.vehicle_id',
    t_dq('i_fg'), t_id('B1'), t_id('VH_B2')), 'invalid_vehicle:');

-- Owner direct writes (owner UPDATE policy).
SELECT t_err_as('DQ fleet: load owner direct update cannot attach its own or a third org''s driver', t_id('u_ship'),
  format('UPDATE public.direct_quotes SET driver_id = %L WHERE id = %L', t_id('D_B2'), t_dq('q_fg')), 'invalid_driver:');

-- Privileged writes (no RLS) are bound too, e.g. a moved bidder organization.
DO $$
DECLARE
  n int;
  q public.direct_quotes;
BEGIN
  PERFORM t_ok('DQ fleet: refused writes left the quote unassigned and still pending',
    (t_q(t_dq('q_fg'))).driver_id IS NULL AND (t_q(t_dq('q_fg'))).vehicle_id IS NULL AND (t_q(t_dq('q_fg'))).status = 'pending', '');
  PERFORM t_ok('DQ fleet: refused insert created no row',
    NOT EXISTS (SELECT 1 FROM public.direct_quotes WHERE indent_id = t_dq('i_fg_ins')), '');

  n := t_dml_as(t_id('u_bid1'), format(
    'UPDATE public.direct_quotes SET driver_id = %L, vehicle_id = %L WHERE id = %L', t_id('D_B1'), t_id('VH_B1'), t_dq('q_fg')));
  q := t_q(t_dq('q_fg'));
  PERFORM t_ok('DQ fleet: bidder can still attach its own driver and vehicle directly',
    n = 1 AND q.driver_id = t_id('D_B1') AND q.vehicle_id = t_id('VH_B1'), n::text);

  BEGIN
    UPDATE public.direct_quotes SET bidder_organization_id = t_id('B2') WHERE id = t_dq('q_fg');
    PERFORM t_ok('DQ fleet: moving a quote to another bidder org keeps the old fleet', false, 'update succeeded');
  EXCEPTION WHEN check_violation THEN
    PERFORM t_ok('DQ fleet: moving a quote to another bidder org with the old fleet is refused',
      SQLERRM LIKE 'invalid_driver:%', SQLERRM);
  END;

  n := t_dml_as(t_id('u_bid1'), format(
    'UPDATE public.direct_quotes SET driver_id = NULL, vehicle_id = NULL WHERE id = %L', t_dq('q_fg')));
  PERFORM t_ok('DQ fleet: clearing driver and vehicle is always allowed',
    n = 1 AND (t_q(t_dq('q_fg'))).driver_id IS NULL AND (t_q(t_dq('q_fg'))).vehicle_id IS NULL, n::text);
END $$;

-- A stored value that later goes stale (driver moved fleets) does not block
-- unrelated writes, and the next fleet write re-checks it.
DO $$
DECLARE
  n int;
BEGIN
  PERFORM t_dml_as(t_id('u_bid1'), format(
    'UPDATE public.direct_quotes SET driver_id = %L, vehicle_id = %L WHERE id = %L', t_id('D_B1'), t_id('VH_B1'), t_dq('q_fg')));
  UPDATE public.drivers SET organization_id = t_id('B2') WHERE id = t_id('D_B1');

  n := t_dml_as(t_id('u_bid1'), format('UPDATE public.direct_quotes SET amount = 30500 WHERE id = %L', t_dq('q_fg')));
  PERFORM t_ok('DQ fleet: unrelated bidder edit is not blocked by a stale stored driver', n = 1, n::text);
  n := t_dml_as(t_id('u_bid1'), format('UPDATE public.direct_quotes SET vehicle_id = %L WHERE id = %L', t_id('VH_B1'), t_dq('q_fg')));
  PERFORM t_ok('DQ fleet: rewriting only the (still own) vehicle is not blocked by the stale driver', n = 1, n::text);

  UPDATE public.drivers SET organization_id = t_id('B1') WHERE id = t_id('D_B1');
END $$;
SELECT t_err_as('DQ fleet: re-attaching a driver after it moved to another org is refused', t_id('u_bid1'),
  format('UPDATE public.direct_quotes SET driver_id = %L WHERE id = %L', t_id('D_B2'), t_dq('q_fg')), 'invalid_driver:');

-- End to end: award, the bidder's foreign-fleet attempt fails, trip takes the assignment.
DO $$
DECLARE
  r jsonb;
BEGIN
  r := t_exec_as(t_id('u_ship'), t_award_sql(t_dq('i_fg'), t_dq('q_fg')));
  PERFORM t_ok('DQ fleet: owner award of the guarded quote succeeds', (r ->> 'ok')::boolean, r::text);
  r := t_exec_as(t_id('u_bid1'), t_assign_sql(t_dq('q_fg'), t_id('D_B1b'), t_id('VH_B1b')));
  PERFORM t_ok('DQ fleet: set_direct_quote_assignment still assigns the own fleet under the trigger',
    (t_q(t_dq('q_fg'))).driver_id = t_id('D_B1b'), r::text);
END $$;
SELECT t_err_as('DQ fleet: after award the bidder still cannot swap in a foreign vehicle directly', t_id('u_bid1'),
  format('UPDATE public.direct_quotes SET vehicle_id = %L WHERE id = %L', t_id('VH_B2'), t_dq('q_fg')), 'invalid_vehicle:');
DO $$
DECLARE
  tr jsonb;
BEGIN
  tr := t_exec_as(t_id('u_bid1'), format(
    'SELECT to_jsonb(t) FROM public.create_trip_from_direct_quote(%L, %L) t LIMIT 1', t_dq('q_fg'), 'DQH01AA0003'));
  PERFORM t_ok('DQ fleet: create_trip_from_direct_quote copies only the bidder''s own driver and vehicle',
    (tr ->> 'driver_id')::uuid = t_id('D_B1b') AND (tr ->> 'vehicle_id')::uuid = t_id('VH_B1b'), coalesce(tr::text, 'no trip'));
END $$;
