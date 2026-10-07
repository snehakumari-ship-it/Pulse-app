-- Marketplace Visibility regression suite — indent_open_for_marketplace_bids()
-- and its consumers (get_network_feed Branch A/B, submit_pulse_bid_with_direct_quote).
--
-- This predicate is now the single business truth every Marketplace surface
-- converges on (Reach Stability Sprint, 20270128104000 /
-- 20270129000000 / 20270130000000). Treat it like deriveTripStage() in Trip
-- Operations: foundational, and a silent regression here reappears as three
-- once-fixed bugs at once (story disappears after first bid, price vanishes,
-- "Bid Now" fails) rather than one obvious break.
--
-- Fully self-contained: creates its own fixtures under a fixed, clearly-fake
-- UUID prefix, asserts with RAISE EXCEPTION on failure (fails loudly, safe
-- for CI), and rolls back at the end so it leaves no trace and can be run
-- repeatedly against any environment (including production, if ever needed
-- for a live sanity check — it never commits).
--
-- Run: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/marketplace_visibility_predicate.sql
-- Pass: every check prints "PASS: ...", script ends with ROLLBACK and no error.
-- Fail: script raises an exception naming the failed check and stops there.

BEGIN;

DO $$
DECLARE
  v_shipper     uuid := 'aaaa0000-0000-0000-0000-000000000001';
  v_bidder      uuid := 'aaaa0000-0000-0000-0000-000000000002';
  v_shipper_usr uuid := 'aaaa0000-0000-0000-0000-000000000011';
  v_bidder_usr  uuid := 'aaaa0000-0000-0000-0000-000000000012';
  v_status      text;
  v_result      boolean;
  v_indent_id   uuid;
  v_post_id     uuid;
  v_feed_count  integer;
  v_rate        numeric;
  v_bid_raised  boolean;
BEGIN
  -- ── Fixtures ────────────────────────────────────────────────────────────
  INSERT INTO auth.users (id, email) VALUES
    (v_shipper_usr, 'mvp-test-shipper@test.local'),
    (v_bidder_usr,  'mvp-test-bidder@test.local')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.organizations (id, name) VALUES
    (v_shipper, 'MVP Test Shipper'),
    (v_bidder,  'MVP Test Bidder')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.organization_members (organization_id, user_id, status, role) VALUES
    (v_shipper, v_shipper_usr, 'active', 'owner'),
    (v_bidder,  v_bidder_usr,  'active', 'owner')
  ON CONFLICT DO NOTHING;

  -- get_network_feed only surfaces a non-boosted post to same-org, connected
  -- orgs, or reach_campaign_targets -- an approved connection isolates the
  -- indent-open predicate itself from reach-campaign wave-targeting, which
  -- Branch B's own scenario below already exercises separately.
  INSERT INTO public.connection_requests (from_organization_id, to_organization_id, request_carrier_supplier, status)
  VALUES (v_bidder, v_shipper, true, 'approved')
  ON CONFLICT DO NOTHING;

  -- ── 1. indent_open_for_marketplace_bids(): one row per status ───────────
  -- 'withdrawn' has no distinct DB status (see indents_status_check) — a
  -- manually withdrawn load is represented as 'cancelled'; tested as such.
  FOR v_status, v_result IN
    SELECT * FROM (VALUES
      ('open',      true),
      ('broadcast', true),
      ('pending',   true),
      ('quoted',    true),  -- legacy value; still open (20270128103100)
      ('draft',     false),
      ('awarded',   false),
      ('completed', false),
      ('cancelled', false), -- covers "withdrawn"
      ('expired',   false),
      ('closed',    false)
    ) AS t(status, expected)
  LOOP
    v_indent_id := gen_random_uuid();
    INSERT INTO public.indents (id, organization_id, indent_number, pickup_area, drop_location, client_name, client_price, status)
    VALUES (v_indent_id, v_shipper, 'MVP-' || substr(v_indent_id::text, 1, 8), 'Origin', 'Destination', 'Test Client', 10000, v_status);

    IF public.indent_open_for_marketplace_bids(v_indent_id) IS DISTINCT FROM v_result THEN
      RAISE EXCEPTION 'FAIL: indent_open_for_marketplace_bids() for status=% expected % got %',
        v_status, v_result, public.indent_open_for_marketplace_bids(v_indent_id);
    END IF;
    RAISE NOTICE 'PASS: indent_open_for_marketplace_bids(status=%) = %', v_status, v_result;

    DELETE FROM public.indents WHERE id = v_indent_id;
  END LOOP;

  -- ── 2. Branch A — live post, open indent: visible with real price ───────
  v_indent_id := gen_random_uuid();
  v_post_id := gen_random_uuid();
  INSERT INTO public.indents (id, organization_id, indent_number, pickup_area, drop_location, client_name, client_price, status)
  VALUES (v_indent_id, v_shipper, 'MVP-BRANCHA', 'Delhi', 'Bengaluru', 'Test Client', 50000, 'open');
  INSERT INTO public.posts (id, organization_id, author_user_id, type, content, origin, destination, rate_offer, is_active, source_indent_id)
  VALUES (v_post_id, v_shipper, v_shipper_usr, 'LOAD', 'Delhi to Bengaluru', 'Delhi', 'Bengaluru', 45000, true, v_indent_id);

  PERFORM set_config('request.jwt.claim.sub', v_bidder_usr::text, true);
  SELECT count(*) INTO v_feed_count FROM public.get_network_feed(v_bidder, 50, 0) WHERE id = v_post_id;
  IF v_feed_count <> 1 THEN
    RAISE EXCEPTION 'FAIL: Branch A did not surface an open indent-linked post to an unrelated bidder org';
  END IF;
  SELECT rate_offer INTO v_rate FROM public.get_network_feed(v_bidder, 50, 0) WHERE id = v_post_id;
  IF v_rate IS DISTINCT FROM 45000 THEN
    RAISE EXCEPTION 'FAIL: Branch A rate_offer expected 45000 got %', v_rate;
  END IF;
  RAISE NOTICE 'PASS: Branch A — open indent-linked post visible with real price';

  -- ── 3. Bid allowed on an open indent ─────────────────────────────────────
  PERFORM public.submit_pulse_bid_with_direct_quote(v_post_id, v_bidder, 48000, 'regression test bid');
  RAISE NOTICE 'PASS: bid allowed on an open indent';

  -- ── 4. Manual inactive post, indent still open: still visible, still biddable ──
  UPDATE public.posts SET is_active = false WHERE id = v_post_id;

  SELECT count(*) INTO v_feed_count FROM public.get_network_feed(v_bidder, 50, 0) WHERE id = v_post_id;
  IF v_feed_count <> 1 THEN
    RAISE EXCEPTION 'FAIL: a manually-inactive post whose indent is still open must remain visible';
  END IF;
  RAISE NOTICE 'PASS: manual inactive post, indent still open — still visible';

  -- Re-bidding must self-heal is_active back to true (idempotent bid, same org).
  PERFORM public.submit_pulse_bid_with_direct_quote(v_post_id, v_bidder, 48500, 'regression test re-bid');
  IF NOT (SELECT is_active FROM public.posts WHERE id = v_post_id) THEN
    RAISE EXCEPTION 'FAIL: submit_pulse_bid_with_direct_quote should heal a wrongly-inactive post on an open indent';
  END IF;
  RAISE NOTICE 'PASS: bid on manually-inactive-but-open post self-heals is_active';

  -- ── 5. Award: post deactivates, feed empties, late bid rejected ─────────
  -- Only staff of the load-owning org may accept a quote (Gate 1A C2).
  PERFORM set_config('request.jwt.claim.sub', v_shipper_usr::text, true);
  UPDATE public.direct_quotes SET status = 'accepted' WHERE indent_id = v_indent_id AND bidder_organization_id = v_bidder;
  UPDATE public.indents SET status = 'awarded' WHERE id = v_indent_id;

  PERFORM set_config('request.jwt.claim.sub', v_bidder_usr::text, true);
  SELECT count(*) INTO v_feed_count FROM public.get_network_feed(v_bidder, 50, 0) WHERE id = v_post_id OR source_indent_id = v_indent_id;
  IF v_feed_count <> 0 THEN
    RAISE EXCEPTION 'FAIL: an awarded indent''s story must not appear in another org''s feed';
  END IF;
  RAISE NOTICE 'PASS: awarded indent — story no longer visible';

  v_bid_raised := false;
  BEGIN
    PERFORM public.submit_pulse_bid_with_direct_quote(v_post_id, v_bidder, 49000, 'late bid after award');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'INDENT_NOT_OPEN_FOR_BIDS' THEN
      v_bid_raised := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_bid_raised THEN
    RAISE EXCEPTION 'FAIL: a bid on an awarded indent must be rejected with INDENT_NOT_OPEN_FOR_BIDS';
  END IF;
  RAISE NOTICE 'PASS: bid rejected on an awarded indent';

  DELETE FROM public.posts WHERE id = v_post_id;
  DELETE FROM public.indents WHERE id = v_indent_id;

  -- ── 6. Branch B — post hard-deleted, indent still open: snapshot price, still visible ──
  v_indent_id := gen_random_uuid();
  v_post_id := gen_random_uuid();
  INSERT INTO public.indents (id, organization_id, indent_number, pickup_area, drop_location, client_name, client_price, status)
  VALUES (v_indent_id, v_shipper, 'MVP-BRANCHB', 'Jaipur', 'Surat', 'Test Client', 60000, 'open');
  INSERT INTO public.posts (id, organization_id, author_user_id, type, content, origin, destination, rate_offer, is_active, source_indent_id)
  VALUES (v_post_id, v_shipper, v_shipper_usr, 'LOAD', 'Jaipur to Surat', 'Jaipur', 'Surat', 39000, true, v_indent_id);

  PERFORM set_config('request.jwt.claim.sub', v_shipper_usr::text, true);
  PERFORM public.publish_reach_campaign(
    v_shipper, v_post_id, (SELECT id FROM public.reach_plans WHERE is_active ORDER BY credit_price LIMIT 1), 'money'
  );

  DELETE FROM public.posts WHERE id = v_post_id;

  PERFORM set_config('request.jwt.claim.sub', v_bidder_usr::text, true);
  SELECT count(*), max(rate_offer) INTO v_feed_count, v_rate
  FROM public.get_network_feed(v_bidder, 50, 0) WHERE source_indent_id = v_indent_id;
  IF v_feed_count <> 1 THEN
    RAISE EXCEPTION 'FAIL: Branch B did not surface a snapshot-served campaign for a still-open, hard-deleted-post indent';
  END IF;
  IF v_rate IS DISTINCT FROM 39000 THEN
    RAISE EXCEPTION 'FAIL: Branch B snapshot_rate_offer expected 39000 got %', v_rate;
  END IF;
  RAISE NOTICE 'PASS: Branch B — hard-deleted post, open indent — visible with snapshot price';

  -- ── 7. Branch B must NOT serve an awarded indent's snapshot ──────────────
  UPDATE public.indents SET status = 'awarded' WHERE id = v_indent_id;
  SELECT count(*) INTO v_feed_count
  FROM public.get_network_feed(v_bidder, 50, 0) WHERE source_indent_id = v_indent_id;
  IF v_feed_count <> 0 THEN
    RAISE EXCEPTION 'FAIL: Branch B must not serve a campaign whose indent is now awarded';
  END IF;
  RAISE NOTICE 'PASS: Branch B — awarded indent — snapshot no longer served';

  RAISE NOTICE '=== Marketplace Visibility regression suite: ALL CHECKS PASSED ===';
END $$;

ROLLBACK;
