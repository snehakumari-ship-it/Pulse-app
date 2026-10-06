-- Shape checks for 20271006183000 (skipped by WITH_PERF=0 baseline runs).
DO $$
BEGIN
  PERFORM t_ok('Parity: pool-key helpers are inlinable (no SET clause, not SECURITY DEFINER, IMMUTABLE)',
    (SELECT bool_and(p.proconfig IS NULL AND NOT p.prosecdef AND p.provolatile = 'i')
     FROM pg_proc p WHERE p.oid IN ('public._pool_key_part(text)'::regprocedure,
                                   'public._pool_key(text, text, text)'::regprocedure)));
  PERFORM t_ok('Parity: _marketplace_pool_rows no longer calls the per-row predicate functions',
    (SELECT prosrc !~ '(indent_open_for_marketplace_bids|_indent_is_sponsored_reach)\('
     FROM pg_proc WHERE oid = 'public._marketplace_pool_rows(text)'::regprocedure));
  PERFORM t_ok('Parity: pool helper grants unchanged (no anon/authenticated/PUBLIC EXECUTE)',
    NOT EXISTS (
      SELECT 1 FROM unnest(ARRAY['public._pool_key_part(text)', 'public._pool_key(text, text, text)',
                                 'public._marketplace_pool_rows(text)']) f, unnest(ARRAY['anon', 'authenticated']) r
      WHERE has_function_privilege(r, f::regprocedure, 'EXECUTE')));
END $$;
