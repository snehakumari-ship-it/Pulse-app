-- Pulse Exchange: default Finance party + two-gate Marketplace payments.
--
-- Every org gets one protected system party called "Pulse Exchange", stored as
-- a suppliers row (what the org owes on Marketplace trips it gave out, plus the
-- Marketplace platform fee) and a clients row (what it is owed on Marketplace
-- trips it won). All Marketplace money moves through the normal Finance party
-- lanes, Cash/Bank and party ledgers against that party. ADR-012 still holds:
-- the winning bidder never becomes a Network supplier of the shipper.
--
-- Two gates, both enforced here:
--   1. Either side records the payment in Exchange (claim_exchange_payment).
--   2. The other side confirms it (confirm_exchange_payment). Only then does it
--      post to Finance, into BOTH ledgers in one transaction:
--        shipper (payer)  amount_out  supplier = its Pulse Exchange  EXCHANGE_PAYMENT
--        bidder  (payee)  amount_in   client   = its Pulse Exchange  EXCHANGE_RECEIPT
--   A claim is not a cash movement. Nothing auto-confirms.
--   Direct Finance writes against a Pulse Exchange party are rejected
--   (tg_transactions_pulse_exchange_guard); the app routes them to step 1.
--
-- Trips: an org-bidder Marketplace award now links supplier_id to the shipper's
-- Pulse Exchange party, runs in the 'market' lane, and keeps the shipper's
-- customer client_price (defects 7 and 8 for new trips).
--
-- Marketplace DCO awards (section 8): the shipper's trip, which the DCO drives,
-- also settles through the shipper's Pulse Exchange supplier. The DCO payee is
-- the Exchange payee and claims / confirms from the Driver App on the same
-- exchange_payments rows; confirmation posts one Finance row (the shipper's).
-- Reach direct-bid DCO awards keep the DCO payee lane.
--
-- Bidder side: when the bidder runs its own driver, its mover_asset trip for
-- the award bills its Pulse Exchange client (not the shipper by name). The
-- bidder's EXCHANGE_RECEIPT posts on that trip, and Exchange accepts either
-- trip id. The shipper and bidder are Exchange participants only; neither is
-- created or used as a Finance party for a Marketplace trip.
--
-- Platform fee: once a fee payment is 'paid' (Razorpay webhook or cash), it
-- posts to the bidder's ledger against its Pulse Exchange supplier party
-- (defect 10 for new payments). Unpaid fees on accepted bids show as payable.
--
-- Also fixed: sync_trip_payment_status summed client-type rows from every org
-- on a trip, so a partner's receipt marked the shipper's customer invoice paid.
--
-- Requires 20271006142659 (omni-channel award classification); the trip
-- functions below are its bodies plus the Pulse Exchange changes.
-- Historical Marketplace trips are not modified here.

-- Fail fast instead of queueing behind long trips locks; the trips trigger and
-- constraint DDL below hold their lock until this migration commits.
SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. System party marker and protection
-- ---------------------------------------------------------------------------

ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS system_party_key text;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS system_party_key text;

ALTER TABLE public.suppliers DROP CONSTRAINT IF EXISTS suppliers_system_party_key_check;
ALTER TABLE public.suppliers ADD CONSTRAINT suppliers_system_party_key_check
  CHECK (system_party_key IS NULL OR system_party_key = 'pulse_exchange');
ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_system_party_key_check;
ALTER TABLE public.clients ADD CONSTRAINT clients_system_party_key_check
  CHECK (system_party_key IS NULL OR system_party_key = 'pulse_exchange');

CREATE UNIQUE INDEX IF NOT EXISTS uq_suppliers_org_system_party
  ON public.suppliers (organization_id, system_party_key)
  WHERE system_party_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_clients_org_system_party
  ON public.clients (organization_id, system_party_key)
  WHERE system_party_key IS NOT NULL;

COMMENT ON COLUMN public.suppliers.system_party_key IS
  'Platform-owned party. pulse_exchange = the Pulse Exchange counterparty for Marketplace trips and fees. Created and protected by the database.';
COMMENT ON COLUMN public.clients.system_party_key IS
  'Platform-owned party. pulse_exchange = the Pulse Exchange counterparty for Marketplace receipts. Created and protected by the database.';

-- Transaction-local flag set only inside the SECURITY DEFINER writers below.
CREATE OR REPLACE FUNCTION public._pulse_exchange_writer_active()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT coalesce(current_setting('pulse.exchange_writer', true), '') = 'on';
$function$;

REVOKE ALL ON FUNCTION public._pulse_exchange_writer_active() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.tg_protect_pulse_exchange_party()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_key text;
BEGIN
  IF public._pulse_exchange_writer_active() THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.system_party_key IS NOT NULL THEN
      RAISE EXCEPTION 'pulse_exchange_party_reserved: the Pulse Exchange party is created by the platform'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.system_party_key IS NOT NULL THEN
      RAISE EXCEPTION 'pulse_exchange_party_protected: the Pulse Exchange party cannot be deleted'
        USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.system_party_key IS NULL THEN
    IF NEW.system_party_key IS NOT NULL THEN
      RAISE EXCEPTION 'pulse_exchange_party_reserved: the Pulse Exchange party is created by the platform'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  FOREACH v_key IN ARRAY ARRAY[
    'system_party_key', 'name', 'organization_id', 'linked_organization_id',
    'deleted_at', 'is_active', 'status', 'client_status', 'vendor_status'
  ] LOOP
    IF (to_jsonb(NEW) -> v_key) IS DISTINCT FROM (to_jsonb(OLD) -> v_key) THEN
      RAISE EXCEPTION 'pulse_exchange_party_protected: % of the Pulse Exchange party cannot be changed', v_key
        USING ERRCODE = '42501';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_suppliers_protect_pulse_exchange ON public.suppliers;
CREATE TRIGGER trg_suppliers_protect_pulse_exchange
  BEFORE INSERT OR UPDATE OR DELETE ON public.suppliers
  FOR EACH ROW EXECUTE FUNCTION public.tg_protect_pulse_exchange_party();

DROP TRIGGER IF EXISTS trg_clients_protect_pulse_exchange ON public.clients;
CREATE TRIGGER trg_clients_protect_pulse_exchange
  BEFORE INSERT OR UPDATE OR DELETE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.tg_protect_pulse_exchange_party();

CREATE OR REPLACE FUNCTION public._ensure_pulse_exchange_party(p_org_id uuid, p_kind text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_prev text := coalesce(current_setting('pulse.exchange_writer', true), '');
BEGIN
  IF p_org_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF p_kind = 'supplier' THEN
    SELECT s.id INTO v_id
    FROM public.suppliers s
    WHERE s.organization_id = p_org_id AND s.system_party_key = 'pulse_exchange';
    IF v_id IS NOT NULL THEN
      RETURN v_id;
    END IF;

    PERFORM set_config('pulse.exchange_writer', 'on', true);
    INSERT INTO public.suppliers (
      organization_id, name, supplier_type, is_active, vendor_status, system_party_key, updated_at
    ) VALUES (
      p_org_id, 'Pulse Exchange', 'marketplace', true, 'active', 'pulse_exchange', now()
    )
    ON CONFLICT (organization_id, system_party_key) WHERE system_party_key IS NOT NULL DO NOTHING
    RETURNING id INTO v_id;
    PERFORM set_config('pulse.exchange_writer', v_prev, true);

    IF v_id IS NULL THEN
      SELECT s.id INTO v_id
      FROM public.suppliers s
      WHERE s.organization_id = p_org_id AND s.system_party_key = 'pulse_exchange';
    END IF;
    RETURN v_id;
  END IF;

  IF p_kind = 'client' THEN
    SELECT c.id INTO v_id
    FROM public.clients c
    WHERE c.organization_id = p_org_id AND c.system_party_key = 'pulse_exchange';
    IF v_id IS NOT NULL THEN
      RETURN v_id;
    END IF;

    PERFORM set_config('pulse.exchange_writer', 'on', true);
    INSERT INTO public.clients (
      organization_id, name, phone, client_status, status, system_party_key, notes
    ) VALUES (
      p_org_id, 'Pulse Exchange', 'PULSE-EXCHANGE', 'customer', 'active', 'pulse_exchange',
      'Marketplace receipts settled through Pulse Exchange.'
    )
    ON CONFLICT (organization_id, system_party_key) WHERE system_party_key IS NOT NULL DO NOTHING
    RETURNING id INTO v_id;
    PERFORM set_config('pulse.exchange_writer', v_prev, true);

    IF v_id IS NULL THEN
      SELECT c.id INTO v_id
      FROM public.clients c
      WHERE c.organization_id = p_org_id AND c.system_party_key = 'pulse_exchange';
    END IF;
    RETURN v_id;
  END IF;

  RAISE EXCEPTION 'invalid_input: party kind must be supplier or client (got %)', p_kind
    USING ERRCODE = '22023';
END;
$function$;

REVOKE ALL ON FUNCTION public._ensure_pulse_exchange_party(uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ensure_pulse_exchange_parties(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_org_member(p_org_id) THEN
    RAISE EXCEPTION 'unauthorized: not a member of organization %', p_org_id
      USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'supplier_id', public._ensure_pulse_exchange_party(p_org_id, 'supplier'),
    'client_id', public._ensure_pulse_exchange_party(p_org_id, 'client')
  );
END;
$function$;

COMMENT ON FUNCTION public.ensure_pulse_exchange_parties(uuid) IS
  'Returns the org''s default Pulse Exchange parties {supplier_id, client_id}, creating them on first use.';

REVOKE ALL ON FUNCTION public.ensure_pulse_exchange_parties(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_pulse_exchange_parties(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public._is_pulse_exchange_party(p_contact_type text, p_contact_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT p_contact_id IS NOT NULL AND CASE lower(coalesce(p_contact_type, ''))
    WHEN 'supplier' THEN EXISTS (
      SELECT 1 FROM public.suppliers s
      WHERE s.id = p_contact_id AND s.system_party_key = 'pulse_exchange'
    )
    WHEN 'client' THEN EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id = p_contact_id AND c.system_party_key = 'pulse_exchange'
    )
    ELSE false
  END;
$function$;

REVOKE ALL ON FUNCTION public._is_pulse_exchange_party(text, uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Ledger guard: Pulse Exchange rows are written only by the Exchange writers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.tg_transactions_pulse_exchange_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF public._pulse_exchange_writer_active() THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE')
     AND public._is_pulse_exchange_party(OLD.contact_type, OLD.contact_id) THEN
    RAISE EXCEPTION 'exchange_ledger_locked: a confirmed Pulse Exchange entry cannot be edited or deleted from Finance'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE')
     AND public._is_pulse_exchange_party(NEW.contact_type, NEW.contact_id) THEN
    RAISE EXCEPTION 'exchange_ledger_locked: Pulse Exchange payments post to Finance only after the other side confirms them'
      USING ERRCODE = '42501';
  END IF;

  -- A DCO paid through Exchange has one obligation; a direct DCO payment on
  -- that trip would be a second one.
  IF TG_OP IN ('INSERT', 'UPDATE')
     AND lower(coalesce(NEW.contact_type, '')) = 'dco'
     AND NEW.trip_id IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.trips t
       WHERE t.id = NEW.trip_id AND public._is_pulse_exchange_party('supplier', t.supplier_id)
     ) THEN
    RAISE EXCEPTION 'exchange_ledger_locked: this DCO trip settles through Pulse Exchange; record the payment in Exchange'
      USING ERRCODE = '42501';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$function$;

DROP TRIGGER IF EXISTS trg_transactions_pulse_exchange_guard ON public.transactions;
CREATE TRIGGER trg_transactions_pulse_exchange_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.tg_transactions_pulse_exchange_guard();

-- A partner org's receipt on another org's trip is the partner's revenue, not
-- the trip owner's customer receipt.
CREATE OR REPLACE FUNCTION public.sync_trip_payment_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_trip_id uuid;
  v_trip_org_id uuid;
  v_client_price numeric(12,2);
  v_amount_paid numeric(12,2);
  v_status text;
BEGIN
  v_trip_id := COALESCE(NEW.trip_id, OLD.trip_id);
  IF v_trip_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT client_price, organization_id INTO v_client_price, v_trip_org_id
  FROM public.trips
  WHERE id = v_trip_id;

  IF v_client_price IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT COALESCE(SUM(amount_in) - SUM(amount_out), 0)
  INTO v_amount_paid
  FROM public.transactions
  WHERE trip_id = v_trip_id
    AND contact_type = 'client'
    AND organization_id = v_trip_org_id;

  v_amount_paid := GREATEST(v_amount_paid, 0);

  v_status := CASE
    WHEN v_amount_paid <= 0 THEN 'pending'
    WHEN v_amount_paid >= v_client_price THEN 'paid'
    ELSE 'partial'
  END;

  UPDATE public.trips
  SET amount_paid = v_amount_paid,
      payment_status = v_status
  WHERE id = v_trip_id
    AND (amount_paid IS DISTINCT FROM v_amount_paid
         OR payment_status IS DISTINCT FROM v_status);

  RETURN COALESCE(NEW, OLD);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. Trips: Pulse Exchange is the supplier only on Marketplace trips
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.tg_trips_pulse_exchange_supplier_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.supplier_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.supplier_id IS NOT DISTINCT FROM OLD.supplier_id
     AND NEW.source IS NOT DISTINCT FROM OLD.source THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.suppliers s
    WHERE s.id = NEW.supplier_id AND s.system_party_key = 'pulse_exchange'
  ) THEN
    -- trips_dco_consistency_check admits a supplier on a DCO trip only for
    -- Pulse Exchange settlement.
    IF NEW.operating_mode = 'DCO' THEN
      RAISE EXCEPTION 'dco_trip_supplier: a DCO trip can only carry the Pulse Exchange supplier'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF lower(coalesce(NEW.source, '')) NOT IN ('market_bid', 'direct_quote')
     OR NEW.indent_id IS NULL THEN
    RAISE EXCEPTION 'pulse_exchange_supplier_reserved: Pulse Exchange can only be the supplier on a Marketplace trip'
      USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.suppliers s
    WHERE s.id = NEW.supplier_id AND s.organization_id = NEW.organization_id
  ) THEN
    RAISE EXCEPTION 'pulse_exchange_supplier_reserved: the Pulse Exchange party belongs to another organization'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_trips_pulse_exchange_supplier_guard ON public.trips;
CREATE TRIGGER trg_trips_pulse_exchange_supplier_guard
  BEFORE INSERT OR UPDATE OF supplier_id, source ON public.trips
  FOR EACH ROW EXECUTE FUNCTION public.tg_trips_pulse_exchange_supplier_guard();

CREATE OR REPLACE FUNCTION public.create_trip_from_assigned_indent(
  p_indent_id uuid,
  p_driver_id uuid DEFAULT NULL::uuid,
  p_vehicle_id uuid DEFAULT NULL::uuid,
  p_vehicle_display_number text DEFAULT NULL::text
)
RETURNS SETOF trips
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_indent             public.indents%ROWTYPE;
  v_org_id             uuid;
  v_supplier_org_id    uuid;
  v_supplier_id        uuid;
  v_trip               public.trips%ROWTYPE;
  v_vehicle_display    text;
  v_supplier_rate      numeric;
  v_actor_user_id      uuid := auth.uid();
  v_created_by_user_id uuid := NULL;
  v_try                integer := 0;
  v_market_bid         public.market_bids%ROWTYPE;
  v_is_market_award    boolean := false;
  v_source             text := 'indent';
  v_source_market_bid_id uuid := NULL;
  v_client_price       numeric;
  v_trip_platform_fee  numeric := 0;
  v_trip_fee_snapshot  jsonb := NULL;
  v_trip_sale_basis    text := NULL;
BEGIN
  v_vehicle_display := NULLIF(TRIM(COALESCE(p_vehicle_display_number, '')), '');

  IF v_actor_user_id IS NOT NULL THEN
    INSERT INTO public.users (id, name)
    VALUES (v_actor_user_id, 'User')
    ON CONFLICT (id) DO NOTHING;
  END IF;

  SELECT id INTO v_created_by_user_id
  FROM public.users
  WHERE id = v_actor_user_id
  LIMIT 1;

  SELECT * INTO v_indent FROM public.indents WHERE id = p_indent_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Indent % not found', p_indent_id;
  END IF;

  IF lower(coalesce(v_indent.status, '')) IN ('cancelled', 'closed') THEN
    RAISE EXCEPTION 'Cannot create trip: indent % is not available', p_indent_id;
  END IF;

  v_supplier_org_id := v_indent.assigned_supplier_id;
  IF v_supplier_org_id IS NULL THEN
    RAISE EXCEPTION 'Indent has no assigned supplier';
  END IF;

  IF NOT public.is_org_member(v_supplier_org_id) THEN
    RAISE EXCEPTION 'Not authorized to deploy this load';
  END IF;

  v_org_id := v_indent.organization_id;

  SELECT * INTO v_market_bid
  FROM public.market_bids
  WHERE indent_id = p_indent_id
    AND bidder_type = 'organization'
    AND bidder_organization_id = v_supplier_org_id
    AND status = 'accepted'
  LIMIT 1;
  v_is_market_award := FOUND;

  -- Open-market award without a market bid (e.g. a Pulse bid quote from a
  -- non-supplier). Never bind to another bidder's accepted bid.
  IF NOT v_is_market_award THEN
    v_is_market_award := public.is_marketplace_indent_award(p_indent_id, v_supplier_org_id);
  END IF;

  IF v_is_market_award AND v_market_bid.id IS NOT NULL
     AND v_market_bid.fee_payment_status NOT IN ('paid', 'not_required') THEN
    IF to_regprocedure('public.settle_marketplace_fee_as_cash(uuid)') IS NOT NULL THEN
      PERFORM public.settle_marketplace_fee_as_cash(v_market_bid.id);
      SELECT * INTO v_market_bid FROM public.market_bids WHERE id = v_market_bid.id;
    END IF;
    IF v_market_bid.fee_payment_status NOT IN ('paid', 'not_required') THEN
      RAISE EXCEPTION 'fee_payment_pending: platform fee must be paid before this Marketplace award can be deployed (bid %, current: %)', v_market_bid.id, v_market_bid.fee_payment_status;
    END IF;
  END IF;

  IF coalesce(trim(v_indent.pickup_area), '') = '' THEN
    RAISE EXCEPTION 'Cannot create trip: indent % has no pickup_area', p_indent_id;
  END IF;
  IF coalesce(trim(v_indent.drop_location), '') = '' THEN
    RAISE EXCEPTION 'Cannot create trip: indent % has no drop_location', p_indent_id;
  END IF;
  IF NOT public.indent_has_convertible_sale(v_indent) THEN
    RAISE EXCEPTION 'Cannot create trip: indent % has no client_price', p_indent_id;
  END IF;

  IF p_driver_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.drivers d
      WHERE d.id = p_driver_id AND d.organization_id = v_supplier_org_id
    ) THEN
      RAISE EXCEPTION 'Driver must belong to your organization';
    END IF;
  END IF;

  IF p_vehicle_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.vehicles v
      WHERE v.id = p_vehicle_id AND v.organization_id = v_supplier_org_id
    ) THEN
      RAISE EXCEPTION 'Vehicle must belong to your organization';
    END IF;
  END IF;

  SELECT t.* INTO v_trip
  FROM public.trips t
  WHERE t.indent_id = p_indent_id
  LIMIT 1;

  IF FOUND THEN
    IF lower(coalesce(v_trip.status, '')) NOT IN ('completed', 'cancelled') THEN
      UPDATE public.trips
      SET
        driver_id = COALESCE(p_driver_id, driver_id),
        vehicle_id = COALESCE(p_vehicle_id, vehicle_id),
        vehicle_display_number = CASE
          WHEN v_vehicle_display IS NOT NULL THEN v_vehicle_display
          ELSE vehicle_display_number
        END,
        updated_at = now()
      WHERE id = v_trip.id;
      SELECT * INTO v_trip FROM public.trips WHERE id = v_trip.id;
    END IF;
    UPDATE public.indents SET status = 'completed', updated_at = now() WHERE id = p_indent_id;
    RETURN NEXT v_trip;
    RETURN;
  END IF;

  IF v_is_market_award THEN
    v_supplier_rate := COALESCE(v_market_bid.amount, v_indent.assigned_supplier_rate, v_indent.supplier_target, 0);
    -- The shipper settles with Pulse Exchange, never with the bidder directly
    -- (ADR-012); the bidder collects from its own Pulse Exchange party.
    v_supplier_id := public._ensure_pulse_exchange_party(v_org_id, 'supplier');
    PERFORM public._ensure_pulse_exchange_party(v_supplier_org_id, 'client');
    v_source := 'market_bid';
    v_source_market_bid_id := v_market_bid.id;
    v_client_price := coalesce(v_indent.client_price, 0);
    v_trip_platform_fee := coalesce(v_market_bid.platform_fee_amount, 0);
    v_trip_fee_snapshot := v_market_bid.platform_fee_calc_snapshot;
    v_trip_sale_basis := NULL;
  ELSE
    v_supplier_rate := COALESCE(
      (v_indent.assigned_supplier_rate)::numeric,
      v_indent.supplier_target,
      0
    );
    v_supplier_id := public.ensure_awarded_bidder_supplier(v_org_id, v_supplier_org_id);
    v_source := 'indent';
    v_source_market_bid_id := NULL;
    v_client_price := coalesce(v_indent.client_price, 0);
    v_trip_platform_fee := 0;
    v_trip_fee_snapshot := NULL;
    v_trip_sale_basis := NULL;
  END IF;

  LOOP
    v_try := v_try + 1;
    BEGIN
      INSERT INTO public.trips (
        organization_id, owner_user_id, created_by_user_id, trip_number, indent_id,
        source, source_market_bid_id, pickup_area, drop_location, client_name, client_price, supplier_rate,
        supplier_id, trip_payout_mode, driver_id, vehicle_id, status, pickup_date,
        load_type, vehicle_display_number, platform_fee, driver_commission,
        payment_status, amount_paid, platform_fee_calc_snapshot, sale_rate_basis
      ) VALUES (
        v_org_id, v_indent.owner_user_id, v_created_by_user_id, '', p_indent_id,
        v_source, v_source_market_bid_id, coalesce(v_indent.pickup_area, ''), coalesce(v_indent.drop_location, ''),
        coalesce(v_indent.client_name, ''),
        v_client_price,
        v_supplier_rate, v_supplier_id,
        CASE WHEN v_supplier_id IS NOT NULL THEN 'market' ELSE 'asset' END,
        p_driver_id, p_vehicle_id,
        CASE WHEN p_driver_id IS NOT NULL THEN 'assigned' ELSE 'draft' END,
        v_indent.pickup_date, coalesce(v_indent.load_type, ''), v_vehicle_display,
        v_trip_platform_fee, 0, 'pending', 0,
        v_trip_fee_snapshot,
        v_trip_sale_basis
      )
      RETURNING * INTO v_trip;

      UPDATE public.indents SET status = 'completed', updated_at = now() WHERE id = p_indent_id;
      RETURN NEXT v_trip;
      RETURN;
    EXCEPTION
      WHEN unique_violation THEN
        SELECT t.* INTO v_trip
        FROM public.trips t
        WHERE t.indent_id = p_indent_id
        LIMIT 1;
        IF FOUND THEN
          UPDATE public.indents SET status = 'completed', updated_at = now() WHERE id = p_indent_id;
          RETURN NEXT v_trip;
          RETURN;
        END IF;
        IF v_try >= 3 THEN
          RAISE;
        END IF;
    END;
  END LOOP;
END;
$function$;

COMMENT ON FUNCTION public.create_trip_from_assigned_indent(uuid, uuid, uuid, text) IS
  'Deploy an awarded indent. The award channel comes from the winning offer (is_marketplace_indent_award). Marketplace awards settle through the shipper''s Pulse Exchange supplier party in the market lane; Network awards link the shipper''s supplier row.';

REVOKE ALL ON FUNCTION public.create_trip_from_assigned_indent(uuid, uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_trip_from_assigned_indent(uuid, uuid, uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_trip_from_direct_quote(
  p_quote_id uuid,
  p_vehicle_display_number text DEFAULT NULL::text
)
RETURNS SETOF trips
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_quote              public.direct_quotes%ROWTYPE;
  v_indent             public.indents%ROWTYPE;
  v_supplier_id        uuid;
  v_org_id             uuid;
  v_trip               public.trips%ROWTYPE;
  v_vehicle_display    text;
  v_try                integer := 0;
  v_actor_user_id      uuid := auth.uid();
  v_created_by_user_id uuid := NULL;
  v_is_marketplace     boolean := false;
BEGIN
  v_vehicle_display := NULLIF(TRIM(COALESCE(p_vehicle_display_number, '')), '');

  IF v_actor_user_id IS NOT NULL THEN
    INSERT INTO public.users (id, name)
    VALUES (v_actor_user_id, 'User')
    ON CONFLICT (id) DO NOTHING;
  END IF;

  SELECT id INTO v_created_by_user_id
  FROM public.users
  WHERE id = v_actor_user_id
  LIMIT 1;

  SELECT * INTO v_quote FROM public.direct_quotes WHERE id = p_quote_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Direct quote not found';
  END IF;
  IF (v_quote.status IS NULL OR lower(v_quote.status) <> 'accepted') THEN
    RAISE EXCEPTION 'Quote must be accepted before creating a trip';
  END IF;

  SELECT * INTO v_indent FROM public.indents WHERE id = (v_quote).indent_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Indent not found';
  END IF;

  v_org_id := v_indent.organization_id;

  IF NOT (
    public.is_org_member(v_org_id) OR public.is_org_member((v_quote).bidder_organization_id)
  ) THEN
    RAISE EXCEPTION 'Not authorized to create trip from this quote';
  END IF;

  v_is_marketplace := public.is_marketplace_indent_award(
    (v_quote).indent_id,
    (v_quote).bidder_organization_id
  );

  -- Marketplace: open-market winner settles through Pulse Exchange, no Network
  -- suppliers row (ADR-012). Network: bid visibility already required a
  -- supplier; ensure the row instead of blocking convert.
  IF v_is_marketplace THEN
    v_supplier_id := public._ensure_pulse_exchange_party(v_org_id, 'supplier');
    PERFORM public._ensure_pulse_exchange_party((v_quote).bidder_organization_id, 'client');
  ELSE
    v_supplier_id := public.ensure_awarded_bidder_supplier(
      v_org_id,
      (v_quote).bidder_organization_id
    );
  END IF;

  SELECT t.* INTO v_trip
  FROM public.trips t
  WHERE t.indent_id = (v_quote).indent_id
  LIMIT 1;
  IF FOUND THEN
    UPDATE public.trips
    SET
      driver_id = COALESCE((v_quote).driver_id, driver_id),
      vehicle_id = COALESCE((v_quote).vehicle_id, vehicle_id),
      updated_at = now(),
      vehicle_display_number = CASE
        WHEN v_vehicle_display IS NOT NULL THEN v_vehicle_display
        ELSE vehicle_display_number
      END
    WHERE id = (v_trip).id;
    SELECT * INTO v_trip FROM public.trips WHERE id = (v_trip).id;
    UPDATE public.indents SET status = 'completed', updated_at = now() WHERE id = (v_quote).indent_id;

    PERFORM public._ensure_mover_asset_trip(
      (v_quote).indent_id,
      (v_trip).driver_id,
      (v_trip).vehicle_id,
      (v_trip).vehicle_display_number,
      v_created_by_user_id
    );

    RETURN NEXT v_trip;
    RETURN;
  END IF;

  LOOP
    v_try := v_try + 1;
    BEGIN
      INSERT INTO public.trips (
        organization_id, owner_user_id, created_by_user_id,
        trip_number, indent_id, source,
        pickup_area, drop_location, client_name,
        client_price, supplier_rate, supplier_id, trip_payout_mode,
        driver_id, vehicle_id, status,
        pickup_date, load_type, vehicle_display_number,
        platform_fee, driver_commission, payment_status, amount_paid
      ) VALUES (
        v_org_id, (v_indent).owner_user_id, v_created_by_user_id,
        '', (v_quote).indent_id, 'direct_quote',
        coalesce((v_indent).pickup_area, ''), coalesce((v_indent).drop_location, ''),
        coalesce((v_indent).client_name, ''),
        coalesce((v_indent).client_price, 0), coalesce((v_quote).amount, 0), v_supplier_id,
        CASE
          WHEN (v_quote).driver_id IS NOT NULL
           AND (v_quote).vehicle_id IS NOT NULL
           AND v_supplier_id IS NULL THEN 'asset'
          ELSE 'market'
        END,
        (v_quote).driver_id, (v_quote).vehicle_id, 'assigned',
        (v_indent).pickup_date, coalesce((v_indent).load_type, ''),
        v_vehicle_display, 0, 0, 'pending', 0
      )
      RETURNING * INTO v_trip;

      UPDATE public.indents SET status = 'completed', updated_at = now() WHERE id = (v_quote).indent_id;

      PERFORM public._ensure_mover_asset_trip(
        (v_quote).indent_id,
        (v_quote).driver_id,
        (v_quote).vehicle_id,
        v_vehicle_display,
        v_created_by_user_id
      );

      RETURN NEXT v_trip;
      RETURN;

    EXCEPTION
      WHEN unique_violation THEN
        SELECT t.* INTO v_trip
        FROM public.trips t
        WHERE t.indent_id = (v_quote).indent_id
        LIMIT 1;
        IF FOUND THEN
          UPDATE public.indents SET status = 'completed', updated_at = now() WHERE id = (v_quote).indent_id;
          PERFORM public._ensure_mover_asset_trip(
            (v_quote).indent_id,
            (v_trip).driver_id,
            (v_trip).vehicle_id,
            (v_trip).vehicle_display_number,
            v_created_by_user_id
          );
          RETURN NEXT v_trip;
          RETURN;
        END IF;

        INSERT INTO public.organization_counters (organization_id, trip_seq)
        VALUES (v_org_id, 0)
        ON CONFLICT (organization_id) DO NOTHING;

        UPDATE public.organization_counters oc
        SET trip_seq = greatest(
          oc.trip_seq,
          coalesce((
            SELECT max(
              CASE
                WHEN t.trip_number ~ '[0-9]+$'
                THEN (regexp_match(t.trip_number, '([0-9]+)$'))[1]::bigint
                ELSE 0
              END
            )
            FROM public.trips t
            WHERE t.organization_id = v_org_id
          ), 0)
        )
        WHERE oc.organization_id = v_org_id;

        IF v_try >= 3 THEN
          RAISE EXCEPTION 'Could not create trip: repeated unique conflict after counter sync';
        END IF;
    END;
  END LOOP;
END;
$function$;

COMMENT ON FUNCTION public.create_trip_from_direct_quote(uuid, text) IS
  'Create a trip from an accepted quote. Marketplace awards settle through the shipper''s Pulse Exchange supplier party (ADR-012). Network awards ensure the shipper supplier row instead of failing convert.';

REVOKE ALL ON FUNCTION public.create_trip_from_direct_quote(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_trip_from_direct_quote(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Exchange payments (gate 1 = claim, gate 2 = counterparty confirmation)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.exchange_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES public.trips(id) ON DELETE RESTRICT,
  market_bid_id uuid REFERENCES public.market_bids(id) ON DELETE RESTRICT,
  payer_organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  payee_organization_id uuid REFERENCES public.organizations(id) ON DELETE RESTRICT,
  payee_dco_payee_id uuid REFERENCES public.dco_payees(id) ON DELETE RESTRICT,
  amount numeric(14, 2) NOT NULL CHECK (amount > 0),
  payment_mode text NOT NULL CHECK (payment_mode IN ('CASH', 'UPI', 'BANK', 'CHEQUE')),
  payment_reference text,
  paid_on date NOT NULL,
  notes text,
  status text NOT NULL DEFAULT 'claimed'
    CHECK (status IN ('claimed', 'confirmed', 'rejected', 'cancelled')),
  claimed_by_side text NOT NULL CHECK (claimed_by_side IN ('payer', 'payee')),
  claimed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at timestamptz,
  decision_reason text,
  payer_transaction_id uuid REFERENCES public.transactions(id) ON DELETE RESTRICT,
  payee_transaction_id uuid REFERENCES public.transactions(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT exchange_payments_one_payee
    CHECK ((payee_organization_id IS NULL) <> (payee_dco_payee_id IS NULL)),
  CONSTRAINT exchange_payments_distinct_orgs
    CHECK (payer_organization_id <> payee_organization_id),
  -- An individual DCO has no organization ledger: only the payer row posts.
  CONSTRAINT exchange_payments_ledger_only_when_confirmed
    CHECK ((status = 'confirmed') = (payer_transaction_id IS NOT NULL
      AND (payee_transaction_id IS NOT NULL OR payee_dco_payee_id IS NOT NULL))),
  CONSTRAINT exchange_payments_no_dco_payee_ledger
    CHECK (payee_dco_payee_id IS NULL OR payee_transaction_id IS NULL),
  CONSTRAINT exchange_payments_decided_unless_claimed
    CHECK ((status = 'claimed') = (decided_at IS NULL)),
  CONSTRAINT exchange_payments_rejection_reason
    CHECK (status <> 'rejected' OR length(trim(coalesce(decision_reason, ''))) > 0)
);

COMMENT ON TABLE public.exchange_payments IS
  'Marketplace payment between a shipper (payer) and the winning bidder (payee: an organization, or an individual DCO via payee_dco_payee_id). A claim is not cash: Finance rows exist only once the other side confirms (payer/payee_transaction_id).';

CREATE UNIQUE INDEX IF NOT EXISTS uq_exchange_payments_idempotency
  ON public.exchange_payments (idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS uq_exchange_payments_trip_reference
  ON public.exchange_payments (trip_id, lower(payment_reference))
  WHERE payment_reference IS NOT NULL AND status IN ('claimed', 'confirmed');
CREATE INDEX IF NOT EXISTS idx_exchange_payments_trip
  ON public.exchange_payments (trip_id, claimed_at DESC);
CREATE INDEX IF NOT EXISTS idx_exchange_payments_payer_status
  ON public.exchange_payments (payer_organization_id, status);
CREATE INDEX IF NOT EXISTS idx_exchange_payments_payee_status
  ON public.exchange_payments (payee_organization_id, status);
CREATE INDEX IF NOT EXISTS idx_exchange_payments_payee_dco_status
  ON public.exchange_payments (payee_dco_payee_id, status)
  WHERE payee_dco_payee_id IS NOT NULL;

DROP TRIGGER IF EXISTS set_exchange_payments_updated_at ON public.exchange_payments;
CREATE TRIGGER set_exchange_payments_updated_at
  BEFORE UPDATE ON public.exchange_payments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.exchange_payments ENABLE ROW LEVEL SECURITY;

-- DCO access is transaction-scoped (dco_payees.user_id), never org membership.
-- Org sides are staff only: a DCO's tracking-only driver row in the shipper
-- org must not expose that shipper's other Exchange payments.
CREATE OR REPLACE FUNCTION public._is_dco_payee_user(p_dco_payee_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT p_dco_payee_id IS NOT NULL AND auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.dco_payees dp
    WHERE dp.id = p_dco_payee_id AND dp.user_id = auth.uid()
  );
$function$;

REVOKE ALL ON FUNCTION public._is_dco_payee_user(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._is_dco_payee_user(uuid) TO authenticated;

DROP POLICY IF EXISTS exchange_payments_select_parties ON public.exchange_payments;
CREATE POLICY exchange_payments_select_parties
  ON public.exchange_payments
  FOR SELECT
  TO authenticated
  USING (
    public.is_org_staff(payer_organization_id)
    OR public.is_org_staff(payee_organization_id)
    OR public._is_dco_payee_user(payee_dco_payee_id)
  );

REVOKE ALL ON public.exchange_payments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.exchange_payments TO authenticated;

-- Resolves the Exchange award behind a trip. A trip is an Exchange trip only
-- when its supplier is the shipper's own Pulse Exchange party. The payee is
-- the bidder organization, or for a Marketplace DCO award the DCO payee (the
-- DCO drives the shipper's trip itself; there is no second trip).
CREATE OR REPLACE FUNCTION public._exchange_trip_award(p_trip_id uuid)
RETURNS TABLE (
  trip_id uuid,
  trip_number text,
  payer_organization_id uuid,
  payee_organization_id uuid,
  market_bid_id uuid,
  agreed_amount numeric,
  payee_dco_payee_id uuid
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_trip public.trips%ROWTYPE;
  v_payee uuid;
  v_payee_dco uuid;
  v_bid public.market_bids%ROWTYPE;
  v_cost_delta numeric;
BEGIN
  SELECT * INTO v_trip FROM public.trips t WHERE t.id = p_trip_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: trip %', p_trip_id USING ERRCODE = 'P0002';
  END IF;

  IF v_trip.supplier_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.suppliers s
    WHERE s.id = v_trip.supplier_id
      AND s.organization_id = v_trip.organization_id
      AND s.system_party_key = 'pulse_exchange'
  ) THEN
    RAISE EXCEPTION 'not_exchange_trip: trip % is not settled through Pulse Exchange', p_trip_id
      USING ERRCODE = '22023';
  END IF;

  SELECT i.assigned_supplier_id INTO v_payee
  FROM public.indents i
  WHERE i.id = v_trip.indent_id;

  IF v_trip.source_market_bid_id IS NOT NULL THEN
    SELECT * INTO v_bid FROM public.market_bids mb WHERE mb.id = v_trip.source_market_bid_id;
    IF NOT FOUND OR v_bid.status <> 'accepted' THEN
      RAISE EXCEPTION 'not_exchange_trip: trip % has no accepted Marketplace award', p_trip_id
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF v_bid.bidder_type = 'dco' THEN
    -- The payee is whoever the award (and only the award) made payee; a
    -- cleared payee (driver rejected / reassigned) leaves nobody to settle with.
    SELECT dp.id INTO v_payee_dco
    FROM public.dco_payees dp
    WHERE dp.id = v_trip.dco_payee_id AND dp.user_id = v_bid.bidder_user_id;
    IF v_trip.operating_mode IS DISTINCT FROM 'DCO' OR v_payee_dco IS NULL THEN
      RAISE EXCEPTION 'not_exchange_trip: trip % has no DCO payee for its Marketplace award', p_trip_id
        USING ERRCODE = '22023';
    END IF;
    v_payee := NULL;
  ELSE
    IF v_bid.id IS NOT NULL
       AND (v_bid.bidder_type <> 'organization' OR v_bid.bidder_organization_id IS DISTINCT FROM v_payee) THEN
      RAISE EXCEPTION 'not_exchange_trip: trip % has no accepted organization award', p_trip_id
        USING ERRCODE = '22023';
    END IF;
    IF v_payee IS NULL
       OR v_payee = v_trip.organization_id
       OR NOT public.is_marketplace_indent_award(v_trip.indent_id, v_payee) THEN
      RAISE EXCEPTION 'not_exchange_trip: trip % has no Marketplace award', p_trip_id
        USING ERRCODE = '22023';
    END IF;
  END IF;

  SELECT sum(CASE WHEN tfa.impact = 'plus' THEN tfa.amount ELSE -tfa.amount END)
  INTO v_cost_delta
  FROM public.trip_finance_adjustments tfa
  WHERE tfa.trip_id = v_trip.id
    AND tfa.organization_id = v_trip.organization_id
    AND tfa.type = 'cost'
    AND tfa.voided_at IS NULL;

  RETURN QUERY SELECT
    v_trip.id,
    v_trip.trip_number,
    v_trip.organization_id,
    v_payee,
    v_trip.source_market_bid_id,
    greatest(0, coalesce(v_trip.supplier_rate, 0) + coalesce(v_cost_delta, 0)),
    v_payee_dco;
END;
$function$;

REVOKE ALL ON FUNCTION public._exchange_trip_award(uuid) FROM PUBLIC, anon, authenticated;

-- A bidder running its own driver works on a mover_asset trip, not on the
-- shipper's trip. Exchange always settles the shipper's trip behind it.
CREATE OR REPLACE FUNCTION public._exchange_settlement_trip_id(p_trip_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT coalesce((
    SELECT agg.id
    FROM public.trips m
    JOIN public.trips agg
      ON agg.indent_id = m.source_indent_id
     AND agg.organization_id <> m.organization_id
     AND agg.deleted_at IS NULL
    WHERE m.id = p_trip_id
      AND m.source = 'mover_asset'
    ORDER BY agg.created_at DESC
    LIMIT 1
  ), p_trip_id);
$function$;

REVOKE ALL ON FUNCTION public._exchange_settlement_trip_id(uuid) FROM PUBLIC, anon, authenticated;

-- The bidder's receipt belongs on the bidder's own trip for the award (its
-- mover_asset trip) so it settles that trip's Pulse Exchange receivable.
CREATE OR REPLACE FUNCTION public._exchange_payee_trip_id(p_trip_id uuid, p_payee_org uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT coalesce((
    SELECT m.id
    FROM public.trips agg
    JOIN public.trips m
      ON m.source_indent_id = agg.indent_id
     AND m.organization_id = p_payee_org
     AND m.source = 'mover_asset'
     AND m.deleted_at IS NULL
    WHERE agg.id = p_trip_id
    ORDER BY m.created_at DESC
    LIMIT 1
  ), p_trip_id);
$function$;

REVOKE ALL ON FUNCTION public._exchange_payee_trip_id(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Whether the caller acts for one side: payer = shipper staff; payee = bidder
-- staff, or the DCO payee's own user on a DCO award.
CREATE OR REPLACE FUNCTION public._exchange_is_side(
  p_side text,
  p_payer_org uuid,
  p_payee_org uuid,
  p_payee_dco uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE p_side
    WHEN 'payer' THEN public.is_org_staff(p_payer_org)
    WHEN 'payee' THEN CASE
      WHEN p_payee_dco IS NOT NULL THEN public._is_dco_payee_user(p_payee_dco)
      ELSE public.is_org_staff(p_payee_org)
    END
    ELSE false
  END;
$function$;

REVOKE ALL ON FUNCTION public._exchange_is_side(text, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.claim_exchange_payment(
  p_trip_id uuid,
  p_amount numeric,
  p_payment_mode text,
  p_idempotency_key text,
  p_payment_reference text DEFAULT NULL,
  p_paid_on date DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_key text := nullif(trim(coalesce(p_idempotency_key, '')), '');
  v_amount numeric := round(coalesce(p_amount, 0), 2);
  v_mode text := upper(trim(coalesce(p_payment_mode, '')));
  v_ref text := nullif(trim(coalesce(p_payment_reference, '')), '');
  v_paid_on date := coalesce(p_paid_on, (timezone('Asia/Kolkata', now()))::date);
  v_award record;
  v_is_payer boolean;
  v_is_payee boolean;
  v_side text;
  v_open numeric;
  v_row public.exchange_payments%ROWTYPE;
  v_constraint text;
  v_trip_id uuid := public._exchange_settlement_trip_id(p_trip_id);
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized: sign in required' USING ERRCODE = '42501';
  END IF;
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'invalid_input: idempotency key required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row FROM public.exchange_payments ep WHERE ep.idempotency_key = v_key;
  IF FOUND THEN
    IF v_row.trip_id <> v_trip_id OR v_row.amount <> v_amount THEN
      RAISE EXCEPTION 'idempotency_conflict: key % was used for a different payment', v_key
        USING ERRCODE = '22023';
    END IF;
    IF NOT (public._exchange_payment_caller_is(v_row, true) OR public._exchange_payment_caller_is(v_row, false)) THEN
      RAISE EXCEPTION 'unauthorized: not a party to this payment' USING ERRCODE = '42501';
    END IF;
    RETURN to_jsonb(v_row) || jsonb_build_object('note', 'duplicate_request');
  END IF;

  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'invalid_input: amount must be greater than zero' USING ERRCODE = '22023';
  END IF;
  IF v_mode NOT IN ('CASH', 'UPI', 'BANK', 'CHEQUE') THEN
    RAISE EXCEPTION 'invalid_input: payment mode must be CASH, UPI, BANK or CHEQUE' USING ERRCODE = '22023';
  END IF;
  IF v_paid_on > (timezone('Asia/Kolkata', now()))::date THEN
    RAISE EXCEPTION 'invalid_input: payment date cannot be in the future' USING ERRCODE = '22023';
  END IF;

  -- Serialize claims per trip so the over-settlement check cannot race.
  PERFORM 1 FROM public.trips t WHERE t.id = v_trip_id FOR UPDATE;

  SELECT * INTO v_award FROM public._exchange_trip_award(v_trip_id);

  v_is_payer := public._exchange_is_side('payer', v_award.payer_organization_id, v_award.payee_organization_id, v_award.payee_dco_payee_id);
  v_is_payee := public._exchange_is_side('payee', v_award.payer_organization_id, v_award.payee_organization_id, v_award.payee_dco_payee_id);
  IF v_is_payer AND v_is_payee THEN
    RAISE EXCEPTION 'ambiguous_side: you are staff of both the shipper and the bidder on this trip'
      USING ERRCODE = '42501';
  END IF;
  IF v_is_payer THEN
    v_side := 'payer';
  ELSIF v_is_payee THEN
    v_side := 'payee';
  ELSE
    RAISE EXCEPTION 'unauthorized: only the shipper or the winning bidder can record this payment'
      USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(sum(ep.amount), 0) INTO v_open
  FROM public.exchange_payments ep
  WHERE ep.trip_id = v_trip_id AND ep.status IN ('claimed', 'confirmed');

  IF v_open + v_amount > v_award.agreed_amount THEN
    RAISE EXCEPTION 'over_settlement: ₹% would take recorded payments to ₹% against an agreed ₹%',
      v_amount, v_open + v_amount, v_award.agreed_amount
      USING ERRCODE = '22023';
  END IF;

  BEGIN
    INSERT INTO public.exchange_payments (
      trip_id, market_bid_id, payer_organization_id, payee_organization_id, payee_dco_payee_id,
      amount, payment_mode, payment_reference, paid_on, notes,
      status, claimed_by_side, claimed_by, idempotency_key
    ) VALUES (
      v_trip_id, v_award.market_bid_id, v_award.payer_organization_id, v_award.payee_organization_id,
      v_award.payee_dco_payee_id,
      v_amount, v_mode, v_ref, v_paid_on, nullif(trim(coalesce(p_notes, '')), ''),
      'claimed', v_side, v_uid, v_key
    )
    RETURNING * INTO v_row;
  EXCEPTION
    WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
      IF v_constraint = 'uq_exchange_payments_idempotency' THEN
        SELECT * INTO v_row FROM public.exchange_payments ep WHERE ep.idempotency_key = v_key;
        RETURN to_jsonb(v_row) || jsonb_build_object('note', 'duplicate_request');
      END IF;
      RAISE EXCEPTION 'duplicate_reference: reference % is already recorded on this trip', v_ref
        USING ERRCODE = '23505';
  END;

  RETURN to_jsonb(v_row);
END;
$function$;

COMMENT ON FUNCTION public.claim_exchange_payment(uuid, numeric, text, text, text, date, text) IS
  'Gate 1: the shipper (payer) or winning bidder (payee) records a Marketplace payment. Accepts the shipper''s trip or the bidder''s mover_asset trip for the award. Not a cash movement until the other side confirms.';

REVOKE ALL ON FUNCTION public.claim_exchange_payment(uuid, numeric, text, text, text, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_exchange_payment(uuid, numeric, text, text, text, date, text) TO authenticated;

CREATE OR REPLACE FUNCTION public._exchange_payment_lock_for_decision(p_exchange_payment_id uuid)
RETURNS public.exchange_payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.exchange_payments%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthorized: sign in required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_row FROM public.exchange_payments ep WHERE ep.id = p_exchange_payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: exchange payment %', p_exchange_payment_id USING ERRCODE = 'P0002';
  END IF;
  RETURN v_row;
END;
$function$;

REVOKE ALL ON FUNCTION public._exchange_payment_lock_for_decision(uuid) FROM PUBLIC, anon, authenticated;

-- p_claimant = true: the caller acts for the side that recorded the payment;
-- false: for the other side.
CREATE OR REPLACE FUNCTION public._exchange_payment_caller_is(p_row public.exchange_payments, p_claimant boolean)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT public._exchange_is_side(
    CASE WHEN (p_row.claimed_by_side = 'payer') = p_claimant THEN 'payer' ELSE 'payee' END,
    p_row.payer_organization_id, p_row.payee_organization_id, p_row.payee_dco_payee_id
  );
$function$;

REVOKE ALL ON FUNCTION public._exchange_payment_caller_is(public.exchange_payments, boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.confirm_exchange_payment(p_exchange_payment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.exchange_payments%ROWTYPE;
  v_award record;
  v_payer_party uuid;
  v_payee_party uuid;
  v_payer_tx uuid;
  v_payee_tx uuid;
  v_mode_label text;
  v_suffix text;
  v_payer_author uuid;
  v_payee_author uuid;
  v_prev text := coalesce(current_setting('pulse.exchange_writer', true), '');
BEGIN
  v_row := public._exchange_payment_lock_for_decision(p_exchange_payment_id);

  IF v_row.status = 'confirmed' THEN
    IF NOT (public._exchange_payment_caller_is(v_row, true) OR public._exchange_payment_caller_is(v_row, false)) THEN
      RAISE EXCEPTION 'unauthorized: not a party to this payment' USING ERRCODE = '42501';
    END IF;
    RETURN to_jsonb(v_row) || jsonb_build_object('note', 'already_confirmed');
  END IF;
  IF v_row.status <> 'claimed' THEN
    RAISE EXCEPTION 'invalid_state: payment is % and can no longer be confirmed', v_row.status
      USING ERRCODE = '22023';
  END IF;
  IF NOT public._exchange_payment_caller_is(v_row, false)
     OR v_uid = v_row.claimed_by THEN
    RAISE EXCEPTION 'unauthorized: only the other side of this payment can confirm it'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_award FROM public._exchange_trip_award(v_row.trip_id);
  IF v_award.payer_organization_id IS DISTINCT FROM v_row.payer_organization_id
     OR v_award.payee_organization_id IS DISTINCT FROM v_row.payee_organization_id
     OR v_award.payee_dco_payee_id IS DISTINCT FROM v_row.payee_dco_payee_id THEN
    RAISE EXCEPTION 'award_changed: the Marketplace award on this trip changed after the payment was recorded'
      USING ERRCODE = '22023';
  END IF;

  v_payer_party := public._ensure_pulse_exchange_party(v_row.payer_organization_id, 'supplier');
  IF v_row.payee_organization_id IS NOT NULL THEN
    v_payee_party := public._ensure_pulse_exchange_party(v_row.payee_organization_id, 'client');
  END IF;

  v_mode_label := CASE v_row.payment_mode
    WHEN 'CASH' THEN 'Cash'
    WHEN 'UPI' THEN 'UPI'
    WHEN 'BANK' THEN 'Bank Transfer'
    WHEN 'CHEQUE' THEN 'Cheque'
  END;
  v_suffix := ' | Mode: ' || v_mode_label
    || CASE WHEN v_row.payment_reference IS NOT NULL THEN ' | UTR: ' || v_row.payment_reference ELSE '' END;
  v_payer_author := CASE WHEN v_row.claimed_by_side = 'payer' THEN v_row.claimed_by ELSE v_uid END;
  v_payee_author := CASE WHEN v_row.claimed_by_side = 'payee' THEN v_row.claimed_by ELSE v_uid END;

  PERFORM set_config('pulse.exchange_writer', 'on', true);

  INSERT INTO public.transactions (
    organization_id, trip_id, party_name, description,
    amount_in, amount_out, transaction_date,
    contact_id, contact_type, ledger_entity_type, ledger_flow_type, ledger_category,
    payment_ref, payment_reference, created_by
  ) VALUES (
    v_row.payer_organization_id, v_row.trip_id, 'Pulse Exchange', 'EXCHANGE PAYMENT' || v_suffix,
    0, v_row.amount, v_row.paid_on,
    v_payer_party, 'supplier', 'supplier', 'payable', 'EXCHANGE_PAYMENT',
    'EXP-' || v_row.id::text, v_row.payment_reference, v_payer_author
  )
  RETURNING id INTO v_payer_tx;

  IF v_row.payee_organization_id IS NOT NULL THEN
    INSERT INTO public.transactions (
      organization_id, trip_id, party_name, description,
      amount_in, amount_out, transaction_date,
      contact_id, contact_type, ledger_entity_type, ledger_flow_type, ledger_category,
      payment_ref, payment_reference, created_by
    ) VALUES (
      v_row.payee_organization_id, public._exchange_payee_trip_id(v_row.trip_id, v_row.payee_organization_id),
      'Pulse Exchange', 'EXCHANGE RECEIPT' || v_suffix,
      v_row.amount, 0, v_row.paid_on,
      v_payee_party, 'client', 'client', 'receivable', 'EXCHANGE_RECEIPT',
      'EXR-' || v_row.id::text, v_row.payment_reference, v_payee_author
    )
    RETURNING id INTO v_payee_tx;
  END IF;

  PERFORM set_config('pulse.exchange_writer', v_prev, true);

  UPDATE public.exchange_payments
  SET status = 'confirmed',
      decided_by = v_uid,
      decided_at = now(),
      payer_transaction_id = v_payer_tx,
      payee_transaction_id = v_payee_tx
  WHERE id = v_row.id
  RETURNING * INTO v_row;

  RETURN to_jsonb(v_row);
END;
$function$;

COMMENT ON FUNCTION public.confirm_exchange_payment(uuid) IS
  'Gate 2: the side that did not record the payment confirms it. Posts the payer''s EXCHANGE_PAYMENT (shipper trip) and, for an organization bidder, the payee''s EXCHANGE_RECEIPT (bidder mover_asset trip when it exists) against their Pulse Exchange parties in one transaction. An individual DCO has no ledger; its receivable is this Exchange record.';

REVOKE ALL ON FUNCTION public.confirm_exchange_payment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_exchange_payment(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.reject_exchange_payment(p_exchange_payment_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.exchange_payments%ROWTYPE;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
BEGIN
  v_row := public._exchange_payment_lock_for_decision(p_exchange_payment_id);
  IF v_row.status <> 'claimed' THEN
    RAISE EXCEPTION 'invalid_state: payment is % and can no longer be rejected', v_row.status
      USING ERRCODE = '22023';
  END IF;
  IF NOT public._exchange_payment_caller_is(v_row, false)
     OR auth.uid() = v_row.claimed_by THEN
    RAISE EXCEPTION 'unauthorized: only the other side of this payment can reject it'
      USING ERRCODE = '42501';
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'invalid_input: a reason is required to reject a payment' USING ERRCODE = '22023';
  END IF;

  UPDATE public.exchange_payments
  SET status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_reason = v_reason
  WHERE id = v_row.id
  RETURNING * INTO v_row;
  RETURN to_jsonb(v_row);
END;
$function$;

REVOKE ALL ON FUNCTION public.reject_exchange_payment(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_exchange_payment(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.cancel_exchange_payment(p_exchange_payment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.exchange_payments%ROWTYPE;
BEGIN
  v_row := public._exchange_payment_lock_for_decision(p_exchange_payment_id);
  IF v_row.status <> 'claimed' THEN
    RAISE EXCEPTION 'invalid_state: payment is % and can no longer be withdrawn', v_row.status
      USING ERRCODE = '22023';
  END IF;
  IF NOT public._exchange_payment_caller_is(v_row, true) THEN
    RAISE EXCEPTION 'unauthorized: only the side that recorded this payment can withdraw it'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.exchange_payments
  SET status = 'cancelled', decided_by = auth.uid(), decided_at = now()
  WHERE id = v_row.id
  RETURNING * INTO v_row;
  RETURN to_jsonb(v_row);
END;
$function$;

REVOKE ALL ON FUNCTION public.cancel_exchange_payment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_exchange_payment(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_exchange_trip_summary(p_trip_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_award record;
  v_viewer_side text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NULL;
  END IF;
  BEGIN
    SELECT * INTO v_award FROM public._exchange_trip_award(public._exchange_settlement_trip_id(p_trip_id));
  EXCEPTION
    WHEN SQLSTATE '22023' OR SQLSTATE 'P0002' THEN
      RETURN NULL;
  END;

  IF v_award.payee_dco_payee_id IS NOT NULL THEN
    -- The DCO's own stub driver row in the shipper org is not staff, so it
    -- never makes the DCO a payer.
    IF public.is_org_staff(v_award.payer_organization_id)
       AND NOT public._is_dco_payee_user(v_award.payee_dco_payee_id) THEN
      v_viewer_side := 'payer';
    ELSIF public._is_dco_payee_user(v_award.payee_dco_payee_id)
       AND NOT public.is_org_staff(v_award.payer_organization_id) THEN
      v_viewer_side := 'payee';
    ELSE
      RETURN NULL;
    END IF;
  ELSIF public.is_org_staff(v_award.payer_organization_id)
     AND NOT public.is_org_staff(v_award.payee_organization_id) THEN
    v_viewer_side := 'payer';
  ELSIF public.is_org_staff(v_award.payee_organization_id)
     AND NOT public.is_org_staff(v_award.payer_organization_id) THEN
    v_viewer_side := 'payee';
  ELSE
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'trip_id', v_award.trip_id,
    'trip_number', v_award.trip_number,
    'viewer_side', v_viewer_side,
    'payee_kind', CASE WHEN v_award.payee_dco_payee_id IS NOT NULL THEN 'dco' ELSE 'organization' END,
    'payer_organization_id', v_award.payer_organization_id,
    'payer_organization_name', (SELECT o.name FROM public.organizations o WHERE o.id = v_award.payer_organization_id),
    'payee_organization_id', v_award.payee_organization_id,
    'payee_organization_name', CASE
      WHEN v_award.payee_dco_payee_id IS NOT NULL THEN (
        SELECT u.name FROM public.dco_payees dp JOIN public.users u ON u.id = dp.user_id
        WHERE dp.id = v_award.payee_dco_payee_id)
      ELSE (SELECT o.name FROM public.organizations o WHERE o.id = v_award.payee_organization_id)
    END,
    'agreed_amount', v_award.agreed_amount,
    'confirmed_amount', coalesce((
      SELECT sum(ep.amount) FROM public.exchange_payments ep
      WHERE ep.trip_id = v_award.trip_id AND ep.status = 'confirmed'), 0),
    'claimed_amount', coalesce((
      SELECT sum(ep.amount) FROM public.exchange_payments ep
      WHERE ep.trip_id = v_award.trip_id AND ep.status = 'claimed'), 0),
    'payments', coalesce((
      SELECT jsonb_agg(to_jsonb(ep) ORDER BY ep.claimed_at DESC)
      FROM public.exchange_payments ep
      WHERE ep.trip_id = v_award.trip_id), '[]'::jsonb)
  );
END;
$function$;

COMMENT ON FUNCTION public.get_exchange_trip_summary(uuid) IS
  'Pulse Exchange settlement for one trip as seen by the shipper or the winning bidder (organization staff or the DCO payee in the Driver App); NULL when the trip is not an Exchange trip or the caller is not a party.';

REVOKE ALL ON FUNCTION public.get_exchange_trip_summary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_exchange_trip_summary(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Platform fee: paid fee payments post against the bidder's Pulse Exchange
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.tg_marketplace_fee_payment_post_ledger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_party uuid;
  v_cash boolean := lower(coalesce(NEW.provider, '')) = 'cash';
  v_prev text := coalesce(current_setting('pulse.exchange_writer', true), '');
BEGIN
  IF NEW.status <> 'paid' OR NEW.bidder_organization_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'paid' THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.transactions t
    WHERE t.organization_id = NEW.bidder_organization_id
      AND t.ledger_category = 'MARKETPLACE_PLATFORM_FEE'
      AND t.payment_ref = NEW.market_bid_id::text
  ) THEN
    RETURN NEW;
  END IF;

  v_party := public._ensure_pulse_exchange_party(NEW.bidder_organization_id, 'supplier');

  PERFORM set_config('pulse.exchange_writer', 'on', true);
  INSERT INTO public.transactions (
    organization_id, trip_id, party_name, description,
    amount_in, amount_out, transaction_date,
    contact_id, contact_type, ledger_entity_type, ledger_flow_type, ledger_category,
    payment_ref, payment_reference
  ) VALUES (
    NEW.bidder_organization_id, NULL, 'Pulse Exchange',
    'MARKETPLACE PLATFORM FEE | Mode: ' || CASE WHEN v_cash THEN 'Cash' ELSE 'Online' END
      || CASE WHEN NOT v_cash AND NEW.provider_payment_id IS NOT NULL
           THEN ' | UTR: ' || NEW.provider_payment_id ELSE '' END,
    0, NEW.amount, (timezone('Asia/Kolkata', coalesce(NEW.paid_at, now())))::date,
    v_party, 'supplier', 'supplier', 'payable', 'MARKETPLACE_PLATFORM_FEE',
    NEW.market_bid_id::text,
    CASE WHEN v_cash THEN NULL ELSE NEW.provider_payment_id END
  );
  PERFORM set_config('pulse.exchange_writer', v_prev, true);

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_marketplace_fee_payment_post_ledger ON public.marketplace_fee_payments;
CREATE TRIGGER trg_marketplace_fee_payment_post_ledger
  AFTER INSERT OR UPDATE OF status ON public.marketplace_fee_payments
  FOR EACH ROW EXECUTE FUNCTION public.tg_marketplace_fee_payment_post_ledger();

-- ---------------------------------------------------------------------------
-- 6. Finance aggregation: Pulse Exchange party balances
-- ---------------------------------------------------------------------------

-- Supplier side adds the bidder's platform fees: unpaid fees on accepted bids
-- are owed to Pulse Exchange; paid fees are the fee rows already in the ledger.
CREATE OR REPLACE FUNCTION public.get_supplier_ledger_aggregation(p_org_id uuid, p_apply_adjustments boolean DEFAULT true)
RETURNS TABLE (
  supplier_id uuid,
  trips_count integer,
  due numeric,
  paid numeric,
  unsettled numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH supplier_linked_org_index AS (
    SELECT DISTINCT ON (linked_organization_id)
      linked_organization_id, id AS supplier_id
    FROM public.suppliers
    WHERE organization_id = p_org_id AND linked_organization_id IS NOT NULL
    ORDER BY linked_organization_id, id ASC
  ),
  trip_supplier_resolution AS (
    SELECT
      t.id AS trip_id,
      t.trip_number,
      t.supplier_rate,
      s_id.id AS supplier_id
    FROM public.trips t
    LEFT JOIN public.suppliers s_id
      ON s_id.id = t.supplier_id AND s_id.organization_id = p_org_id
    WHERE t.organization_id = p_org_id
  ),
  trip_cost_adjustments AS (
    SELECT trip_id, sum(CASE WHEN impact = 'plus' THEN amount ELSE -amount END) AS delta
    FROM public.trip_finance_adjustments
    WHERE type = 'cost' AND voided_at IS NULL
    GROUP BY trip_id
  ),
  trip_revenue_adjustments AS (
    SELECT trip_id, sum(CASE WHEN impact = 'plus' THEN amount ELSE -amount END) AS delta
    FROM public.trip_finance_adjustments
    WHERE type = 'revenue' AND voided_at IS NULL
    GROUP BY trip_id
  ),
  own_trip_cost AS (
    SELECT
      tsr.supplier_id,
      count(*)::int AS trips_count,
      sum(
        CASE WHEN p_apply_adjustments
          THEN greatest(0, coalesce(tsr.supplier_rate, 0) + coalesce(tca.delta, 0))
          ELSE coalesce(tsr.supplier_rate, 0)
        END
      ) AS due
    FROM trip_supplier_resolution tsr
    LEFT JOIN trip_cost_adjustments tca ON tca.trip_id = tsr.trip_id
    WHERE tsr.supplier_id IS NOT NULL
    GROUP BY tsr.supplier_id
  ),
  subcontract_trip_cost AS (
    SELECT
      ts.supplier_id,
      count(*)::int AS trips_count,
      sum(
        CASE WHEN p_apply_adjustments
          THEN greatest(0, coalesce(ts.rate, 0) + coalesce(tca.delta, 0))
          ELSE coalesce(ts.rate, 0)
        END
      ) AS due
    FROM public.trip_subcontracts ts
    JOIN public.trips t ON t.id = ts.trip_id
    JOIN public.suppliers s
      ON s.id = ts.supplier_id AND s.organization_id = p_org_id
    LEFT JOIN trip_cost_adjustments tca ON tca.trip_id = ts.trip_id
    WHERE ts.viewer_org_id = p_org_id
      AND t.organization_id IS DISTINCT FROM p_org_id
    GROUP BY ts.supplier_id
  ),
  as_client_cost AS (
    SELECT
      sloi.supplier_id,
      count(*)::int AS trips_count,
      sum(
        CASE WHEN p_apply_adjustments
          THEN greatest(0, coalesce(t.client_price, t.supplier_rate, 0) + coalesce(tra.delta, 0))
          ELSE coalesce(t.client_price, t.supplier_rate, 0)
        END
      ) AS due
    FROM public.trips t
    JOIN public.clients c ON c.id = t.client_id
    JOIN supplier_linked_org_index sloi ON sloi.linked_organization_id = t.organization_id
    LEFT JOIN trip_revenue_adjustments tra ON tra.trip_id = t.id
    WHERE c.linked_organization_id = p_org_id
      AND t.indent_id IS NOT NULL
    GROUP BY sloi.supplier_id
  ),
  exchange_party AS (
    SELECT s.id AS supplier_id
    FROM public.suppliers s
    WHERE s.organization_id = p_org_id AND s.system_party_key = 'pulse_exchange'
  ),
  exchange_fee_due AS (
    SELECT
      ep.supplier_id,
      coalesce((
        SELECT sum(mb.platform_fee_amount)
        FROM public.market_bids mb
        WHERE mb.bidder_organization_id = p_org_id
          AND mb.status = 'accepted'
          AND coalesce(mb.platform_fee_amount, 0) > 0
          AND mb.fee_payment_status IN ('required', 'pending', 'failed')
      ), 0)
      + coalesce((
        SELECT sum(tx.amount_out)
        FROM public.transactions tx
        WHERE tx.organization_id = p_org_id
          AND tx.contact_type = 'supplier'
          AND tx.contact_id = ep.supplier_id
          AND tx.ledger_category = 'MARKETPLACE_PLATFORM_FEE'
      ), 0) AS due
    FROM exchange_party ep
  ),
  supplier_trip_ids_by_number AS (
    SELECT trip_number, supplier_id
    FROM trip_supplier_resolution
    WHERE trip_number IS NOT NULL AND supplier_id IS NOT NULL
  ),
  supplier_paid AS (
    SELECT
      coalesce(s_direct.id, sti.supplier_id, stn.supplier_id) AS supplier_id,
      sum(tx.amount_out) AS paid
    FROM public.transactions tx
    LEFT JOIN public.suppliers s_direct
      ON s_direct.id = tx.contact_id AND s_direct.organization_id = p_org_id AND tx.contact_type = 'supplier'
    LEFT JOIN trip_supplier_resolution sti
      ON sti.trip_id = tx.trip_id AND s_direct.id IS NULL
    LEFT JOIN supplier_trip_ids_by_number stn
      ON s_direct.id IS NULL AND sti.supplier_id IS NULL
     AND stn.trip_number = public.extract_ledger_meta_trip_number(tx.description)
    WHERE tx.organization_id = p_org_id
      AND coalesce(tx.amount_out, 0) > 0
      AND (s_direct.id IS NOT NULL OR sti.supplier_id IS NOT NULL OR stn.supplier_id IS NOT NULL)
    GROUP BY coalesce(s_direct.id, sti.supplier_id, stn.supplier_id)
  )
  SELECT
    s.id AS supplier_id,
    coalesce(otc.trips_count, 0) + coalesce(stc.trips_count, 0) + coalesce(acc.trips_count, 0) AS trips_count,
    coalesce(otc.due, 0) + coalesce(stc.due, 0) + coalesce(acc.due, 0) + coalesce(efd.due, 0) AS due,
    coalesce(sp.paid, 0) AS paid,
    greatest(
      0,
      (coalesce(otc.due, 0) + coalesce(stc.due, 0) + coalesce(acc.due, 0) + coalesce(efd.due, 0)) - coalesce(sp.paid, 0)
    ) AS unsettled
  FROM public.suppliers s
  LEFT JOIN own_trip_cost otc ON otc.supplier_id = s.id
  LEFT JOIN subcontract_trip_cost stc ON stc.supplier_id = s.id
  LEFT JOIN as_client_cost acc ON acc.supplier_id = s.id
  LEFT JOIN exchange_fee_due efd ON efd.supplier_id = s.id
  LEFT JOIN supplier_paid sp ON sp.supplier_id = s.id
  WHERE s.organization_id = p_org_id
    AND public.is_org_member(p_org_id);
$function$;

REVOKE ALL ON FUNCTION public.get_supplier_ledger_aggregation(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_supplier_ledger_aggregation(uuid, boolean) TO authenticated;

-- Customer side adds Marketplace trips this org won from other shippers and
-- executes without its own mover_asset trip: billed to its Pulse Exchange
-- client at the agreed supplier_rate. (A mover_asset trip already bills Pulse
-- Exchange through its own client_id; see section 7.) The shipper's
-- amount_paid (its own customer's receipts) never seeds these trips, and the
-- shipper's revenue adjustments do not apply to the bidder's receivable.
CREATE OR REPLACE FUNCTION public.get_customer_ledger_inputs(p_org_id uuid, p_apply_adjustments boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.is_org_member(p_org_id) THEN
    RETURN jsonb_build_object('trip_inputs', '[]'::jsonb, 'unlinked_payments', '[]'::jsonb, 'ledger_only_parties', '[]'::jsonb, 'client_ledger_totals', '[]'::jsonb);
  END IF;

  WITH client_name_index AS (
    SELECT DISTINCT ON (lower(trim(coalesce(name, ''))))
      lower(trim(coalesce(name, ''))) AS name_key, id AS client_id
    FROM public.clients
    WHERE organization_id = p_org_id AND trim(coalesce(name, '')) <> ''
    ORDER BY lower(trim(coalesce(name, ''))), id ASC
  ),
  client_linked_org_index AS (
    SELECT DISTINCT ON (linked_organization_id)
      linked_organization_id, id AS client_id
    FROM public.clients
    WHERE organization_id = p_org_id AND linked_organization_id IS NOT NULL
    ORDER BY linked_organization_id, id ASC
  ),
  exchange_client AS (
    SELECT c.id AS client_id
    FROM public.clients c
    WHERE c.organization_id = p_org_id AND c.system_party_key = 'pulse_exchange'
  ),
  trip_attribution AS (
    -- Priority 1: load-based (indent_id set) trip whose owning org maps to a
    -- local client via linked_organization_id -> use that client, bill at
    -- supplier_rate. Priority 2: trip's own client_id, else name match on
    -- client_name -> bill at client_price.
    SELECT
      t.id AS trip_id,
      coalesce(
        CASE WHEN t.indent_id IS NOT NULL THEN cloi.client_id ELSE NULL END,
        t.client_id,
        cni.client_id
      ) AS client_id,
      CASE WHEN t.indent_id IS NOT NULL AND cloi.client_id IS NOT NULL
        THEN coalesce(t.supplier_rate, 0)
        ELSE coalesce(t.client_price, 0)
      END AS base_amount,
      t.amount_paid,
      false AS is_exchange
    FROM public.trips t
    LEFT JOIN client_linked_org_index cloi ON cloi.linked_organization_id = t.organization_id
    LEFT JOIN client_name_index cni ON cni.name_key = lower(trim(coalesce(t.client_name, '')))
    WHERE t.organization_id = p_org_id
    UNION ALL
    SELECT
      t.id AS trip_id,
      ec.client_id,
      coalesce(t.supplier_rate, 0) AS base_amount,
      0::numeric AS amount_paid,
      true AS is_exchange
    FROM public.indents i
    JOIN public.trips t
      ON t.indent_id = i.id
     AND t.organization_id = i.organization_id
     AND lower(coalesce(t.status, '')) <> 'cancelled'
    JOIN public.suppliers px
      ON px.id = t.supplier_id
     AND px.organization_id = t.organization_id
     AND px.system_party_key = 'pulse_exchange'
    CROSS JOIN exchange_client ec
    WHERE i.assigned_supplier_id = p_org_id
      AND i.organization_id <> p_org_id
      -- With its own mover_asset trip the bidder bills Pulse Exchange there.
      AND NOT EXISTS (
        SELECT 1 FROM public.trips m
        WHERE m.organization_id = p_org_id
          AND m.source = 'mover_asset'
          AND m.source_indent_id = i.id
          AND m.deleted_at IS NULL
      )
  ),
  trip_with_client AS (
    SELECT * FROM trip_attribution WHERE client_id IS NOT NULL
  ),
  trip_adjustment_totals AS (
    SELECT
      tfa.trip_id,
      sum(CASE WHEN tfa.impact = 'plus' THEN tfa.amount ELSE -tfa.amount END) AS delta
    FROM public.trip_finance_adjustments tfa
    WHERE tfa.type = 'revenue' AND tfa.voided_at IS NULL
      AND tfa.trip_id IN (SELECT trip_id FROM trip_with_client WHERE NOT is_exchange)
    GROUP BY tfa.trip_id
  ),
  trip_sales AS (
    SELECT
      twc.trip_id,
      twc.client_id,
      CASE WHEN p_apply_adjustments AND NOT twc.is_exchange
        THEN greatest(0, twc.base_amount + coalesce(tat.delta, 0))
        ELSE twc.base_amount
      END AS sales,
      twc.amount_paid
    FROM trip_with_client twc
    LEFT JOIN trip_adjustment_totals tat ON tat.trip_id = twc.trip_id
  ),
  client_tx_resolved AS (
    -- Every client-type transaction in the org, resolved to a client_id via
    -- contact_id, else the trip's own resolved client, else name match --
    -- same three-step fallback aggregateCustomers.ts uses.
    SELECT
      tx.id AS tx_id,
      tx.trip_id,
      tx.amount_in,
      tx.amount_out,
      tx.transaction_date,
      tx.created_at,
      coalesce(
        tx.contact_id,
        (SELECT tw.client_id FROM trip_with_client tw WHERE tw.trip_id = tx.trip_id),
        cni.client_id
      ) AS client_id
    FROM public.transactions tx
    LEFT JOIN client_name_index cni ON cni.name_key = lower(trim(coalesce(tx.party_name, '')))
    WHERE tx.organization_id = p_org_id AND tx.contact_type = 'client'
  ),
  client_ledger_totals AS (
    -- Covers aggregateCustomers.ts's tripless "legacy formula" branch
    -- (pending = pendingLedger, received = ledgerReceived when a resolved
    -- client has no trips at all) -- every resolved client_id, not just
    -- ones with trip_inputs rows.
    SELECT client_id, sum(amount_in) AS received, sum(amount_out) AS pending
    FROM client_tx_resolved
    WHERE client_id IS NOT NULL
    GROUP BY client_id
  ),
  linked_tx AS (
    -- A resolved client transaction counts as "linked" only when its trip_id
    -- belongs to THAT SAME client's own trip set (trip_sales).
    SELECT ctr.*
    FROM client_tx_resolved ctr
    JOIN trip_sales ts ON ts.trip_id = ctr.trip_id AND ts.client_id = ctr.client_id
    WHERE ctr.trip_id IS NOT NULL AND ctr.client_id IS NOT NULL
  ),
  linked_tx_per_trip AS (
    SELECT trip_id, sum(amount_in) AS linked_amount_in
    FROM linked_tx
    GROUP BY trip_id
  ),
  trip_initial_paid AS (
    -- computeLedgerDerivedPaidSeed: amount_paid seeds the trip's paid total
    -- ONLY when no linked client transaction exists for it (amount_paid is
    -- itself ledger-synced by a DB trigger and would double-count
    -- otherwise); linked transaction amounts are always added.
    SELECT
      ts.trip_id,
      ts.client_id,
      ts.sales,
      (CASE WHEN ltp.trip_id IS NULL THEN coalesce(ts.amount_paid, 0) ELSE 0 END
        + coalesce(ltp.linked_amount_in, 0)) AS initial_paid
    FROM trip_sales ts
    LEFT JOIN linked_tx_per_trip ltp ON ltp.trip_id = ts.trip_id
  ),
  unlinked_tx AS (
    SELECT ctr.*
    FROM client_tx_resolved ctr
    WHERE ctr.client_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM linked_tx lt WHERE lt.tx_id = ctr.tx_id
      )
  ),
  ledger_only_tx AS (
    SELECT tx.party_name, tx.amount_in, tx.amount_out
    FROM public.transactions tx
    WHERE tx.organization_id = p_org_id
      AND tx.contact_type = 'client'
      AND tx.contact_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM client_name_index cni WHERE cni.name_key = lower(trim(coalesce(tx.party_name, '')))
      )
      AND trim(coalesce(tx.party_name, '')) <> ''
  )
  SELECT jsonb_build_object(
    'trip_inputs', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'client_id', trip_id_wrap.client_id,
        'trip_id', trip_id_wrap.trip_id,
        'sales', trip_id_wrap.sales,
        'initial_paid', trip_id_wrap.initial_paid
      ))
      FROM trip_initial_paid trip_id_wrap
    ), '[]'::jsonb),
    'unlinked_payments', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'client_id', u.client_id,
        'transaction_id', u.tx_id,
        'amount_in', u.amount_in
      ) ORDER BY u.transaction_date DESC, u.created_at DESC, u.tx_id DESC)
      FROM unlinked_tx u
    ), '[]'::jsonb),
    'ledger_only_parties', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'party_name', p.party_name,
        'received', p.received,
        'pending', p.pending
      ))
      FROM (
        SELECT party_name, sum(amount_in) AS received, sum(amount_out) AS pending
        FROM ledger_only_tx
        GROUP BY party_name
      ) p
    ), '[]'::jsonb),
    'client_ledger_totals', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'client_id', clt.client_id,
        'received', clt.received,
        'pending', clt.pending
      ))
      FROM client_ledger_totals clt
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_customer_ledger_inputs(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_customer_ledger_inputs(uuid, boolean) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. Bidder execution trip (mover_asset): bills Pulse Exchange, not the shipper
-- ---------------------------------------------------------------------------
-- A bidder running its own driver gets a mover_asset trip in its org. On a
-- Marketplace award that trip's customer is the bidder's Pulse Exchange
-- client; the shipper stays an Exchange participant, never a Finance party.
-- Network awards keep billing the shipper by name, as before.

CREATE OR REPLACE FUNCTION public._ensure_mover_asset_trip(p_indent_id uuid, p_driver_id uuid DEFAULT NULL::uuid, p_vehicle_id uuid DEFAULT NULL::uuid, p_vehicle_display_number text DEFAULT NULL::text, p_actor_user_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_indent          public.indents%ROWTYPE;
  v_mover_org_id    uuid;
  v_agg_trip        public.trips%ROWTYPE;
  v_existing        public.trips%ROWTYPE;
  v_revenue         numeric;
  v_vehicle_display text;
  v_client_id       uuid;
  v_client_name     text;
BEGIN
  v_vehicle_display := NULLIF(TRIM(COALESCE(p_vehicle_display_number, '')), '');

  SELECT * INTO v_indent FROM public.indents WHERE id = p_indent_id;
  IF NOT FOUND THEN RETURN; END IF;

  v_mover_org_id := v_indent.assigned_supplier_id;   -- mover = awarded bidder org
  IF v_mover_org_id IS NULL THEN RETURN; END IF;

  -- Only meaningful when the mover runs its own driver (asset execution).
  IF p_driver_id IS NULL THEN RETURN; END IF;

  -- Idempotent per (mover org, indent) — matches create_mover_asset_trip + the
  -- trips_one_per_indent-avoidance via source_indent_id.
  SELECT t.* INTO v_existing
  FROM public.trips t
  WHERE t.organization_id = v_mover_org_id
    AND t.source_indent_id = p_indent_id
    AND t.deleted_at IS NULL
  LIMIT 1;
  IF FOUND THEN RETURN; END IF;

  SELECT t.* INTO v_agg_trip
  FROM public.trips t
  WHERE t.indent_id = p_indent_id AND t.deleted_at IS NULL
  LIMIT 1;

  v_revenue := COALESCE(
    NULLIF(v_agg_trip.supplier_rate, 0),
    NULLIF((v_indent.assigned_supplier_rate)::numeric, 0),
    NULLIF(v_indent.supplier_target, 0),
    0
  );

  IF public.is_marketplace_indent_award(p_indent_id, v_mover_org_id) THEN
    v_client_id := public._ensure_pulse_exchange_party(v_mover_org_id, 'client');
    v_client_name := 'Pulse Exchange';
  ELSE
    v_client_name := coalesce((SELECT o.name FROM public.organizations o WHERE o.id = v_indent.organization_id), 'Client');
  END IF;

  INSERT INTO public.trips (
    organization_id, owner_user_id, created_by_user_id,
    trip_number, source_indent_id, source_indent_code, source,
    pickup_area, drop_location, client_name, client_id,
    client_price, supplier_rate, supplier_id, trip_payout_mode,
    driver_id, vehicle_id, vehicle_display_number,
    status, pickup_date, load_type,
    platform_fee, driver_commission, payment_status, amount_paid
  ) VALUES (
    v_mover_org_id, p_actor_user_id, p_actor_user_id,
    '', p_indent_id, v_indent.indent_code, 'mover_asset',
    coalesce(v_indent.pickup_area, ''), coalesce(v_indent.drop_location, ''),
    v_client_name, v_client_id,
    v_revenue, 0, NULL, 'asset',
    p_driver_id, p_vehicle_id, v_vehicle_display,
    -- 'draft', NOT 'assigned': the asset trip is a finance/expense shell for the
    -- mover, not a dispatch. Draft is exempt from enforce_single_active_trip_per_driver,
    -- so this never fails when the driver is already on the aggregator's active trip
    -- (verified via dry-run 2026-07-23). Expense Hub + trip list are status-independent
    -- (source='mover_asset' drives both), so draft renders identically.
    'draft', v_indent.pickup_date, coalesce(v_indent.load_type, ''),
    0, 0, 'pending', 0
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_mover_asset_trip(p_indent_id uuid, p_driver_id uuid DEFAULT NULL::uuid, p_vehicle_id uuid DEFAULT NULL::uuid, p_vehicle_display_number text DEFAULT NULL::text)
 RETURNS SETOF trips
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_indent          public.indents%ROWTYPE;
  v_mover_org_id    uuid;
  v_agg_trip        public.trips%ROWTYPE;
  v_trip            public.trips%ROWTYPE;
  v_revenue         numeric;
  v_vehicle_display text;
  v_actor_user_id   uuid := auth.uid();
  v_client_id       uuid;
  v_client_name     text;
BEGIN
  v_vehicle_display := NULLIF(TRIM(COALESCE(p_vehicle_display_number, '')), '');

  SELECT * INTO v_indent FROM public.indents WHERE id = p_indent_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Indent % not found', p_indent_id;
  END IF;

  v_mover_org_id := v_indent.assigned_supplier_id;
  IF v_mover_org_id IS NULL THEN
    RAISE EXCEPTION 'Indent % has no assigned mover', p_indent_id;
  END IF;

  IF NOT public.is_org_staff(v_mover_org_id) THEN
    RAISE EXCEPTION 'Not authorized: caller is not a member of the mover org';
  END IF;

  IF p_driver_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.drivers d WHERE d.id = p_driver_id AND d.organization_id = v_mover_org_id
  ) THEN
    RAISE EXCEPTION 'Driver must belong to the mover organization';
  END IF;
  IF p_vehicle_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.vehicles v WHERE v.id = p_vehicle_id AND v.organization_id = v_mover_org_id
  ) THEN
    RAISE EXCEPTION 'Vehicle must belong to the mover organization';
  END IF;

  SELECT t.* INTO v_trip
  FROM public.trips t
  WHERE t.organization_id = v_mover_org_id
    AND t.source_indent_id = p_indent_id
    AND t.deleted_at IS NULL
  LIMIT 1;
  IF FOUND THEN
    IF lower(coalesce(v_trip.status, '')) NOT IN ('completed', 'cancelled') THEN
      UPDATE public.trips
      SET driver_id = COALESCE(p_driver_id, driver_id),
          vehicle_id = COALESCE(p_vehicle_id, vehicle_id),
          vehicle_display_number = CASE
            WHEN v_vehicle_display IS NOT NULL THEN v_vehicle_display
            ELSE vehicle_display_number END,
          updated_at = now()
      WHERE id = v_trip.id;
      SELECT * INTO v_trip FROM public.trips WHERE id = v_trip.id;
    END IF;
    RETURN NEXT v_trip;
    RETURN;
  END IF;

  SELECT t.* INTO v_agg_trip
  FROM public.trips t
  WHERE t.indent_id = p_indent_id AND t.deleted_at IS NULL
  LIMIT 1;

  v_revenue := COALESCE(
    NULLIF(v_agg_trip.supplier_rate, 0),
    NULLIF((v_indent.assigned_supplier_rate)::numeric, 0),
    NULLIF(v_indent.supplier_target, 0),
    0
  );

  IF public.is_marketplace_indent_award(p_indent_id, v_mover_org_id) THEN
    v_client_id := public._ensure_pulse_exchange_party(v_mover_org_id, 'client');
    v_client_name := 'Pulse Exchange';
  ELSE
    v_client_name := coalesce((SELECT o.name FROM public.organizations o WHERE o.id = v_indent.organization_id), 'Client');
  END IF;

  IF v_actor_user_id IS NOT NULL THEN
    INSERT INTO public.users (id, name) VALUES (v_actor_user_id, 'User')
    ON CONFLICT (id) DO NOTHING;
  END IF;

  INSERT INTO public.trips (
    organization_id, owner_user_id, created_by_user_id,
    trip_number, source_indent_id, source_indent_code, source,
    pickup_area, drop_location, client_name, client_id,
    client_price, supplier_rate, supplier_id, trip_payout_mode,
    driver_id, vehicle_id, vehicle_display_number,
    status, pickup_date, load_type,
    platform_fee, driver_commission, payment_status, amount_paid
  ) VALUES (
    v_mover_org_id, v_actor_user_id, v_actor_user_id,
    '', p_indent_id, v_indent.indent_code, 'mover_asset',
    coalesce(v_indent.pickup_area, ''), coalesce(v_indent.drop_location, ''),
    v_client_name, v_client_id,
    v_revenue,
    0,
    NULL,
    'asset',
    p_driver_id, p_vehicle_id, v_vehicle_display,
    CASE WHEN p_driver_id IS NOT NULL THEN 'assigned' ELSE 'draft' END,
    v_indent.pickup_date, coalesce(v_indent.load_type, ''),
    0, 0, 'pending', 0
  )
  RETURNING * INTO v_trip;

  RETURN NEXT v_trip;
  RETURN;
END;
$function$;

-- On a Pulse Exchange mover_asset trip, "client paid" is what the bidder has
-- confirmed receiving in Exchange, not what the shipper says it paid.
CREATE OR REPLACE FUNCTION public.get_mover_asset_client_paid(p_trip_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_mover_trip   public.trips%ROWTYPE;
  v_indent_id    uuid;
  v_paid         numeric := 0;
BEGIN
  SELECT * INTO v_mover_trip FROM public.trips WHERE id = p_trip_id;
  IF NOT FOUND OR v_mover_trip.source <> 'mover_asset' THEN
    RETURN 0;
  END IF;

  IF NOT public.is_org_staff(v_mover_trip.organization_id) THEN
    RETURN 0;
  END IF;

  IF public._is_pulse_exchange_party('client', v_mover_trip.client_id) THEN
    SELECT COALESCE(SUM(tx.amount_in), 0) INTO v_paid
    FROM public.transactions tx
    WHERE tx.organization_id = v_mover_trip.organization_id
      AND tx.trip_id = v_mover_trip.id
      AND tx.ledger_category = 'EXCHANGE_RECEIPT';
    RETURN v_paid;
  END IF;

  v_indent_id := v_mover_trip.source_indent_id;
  IF v_indent_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT COALESCE(SUM(tx.amount_out), 0) INTO v_paid
  FROM public.transactions tx
  JOIN public.trips agg ON agg.id = tx.trip_id
  WHERE agg.indent_id = v_indent_id
    AND agg.organization_id <> v_mover_trip.organization_id
    AND lower(COALESCE(tx.contact_type, '')) = 'supplier'
    AND COALESCE(tx.amount_out, 0) > 0;

  RETURN v_paid;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 8. Marketplace DCO awards settle through Pulse Exchange
-- ---------------------------------------------------------------------------
-- The DCO drives the shipper's trip itself (operating_mode 'DCO',
-- dco_payee_id), so that one trip is the Exchange anchor for the Business App
-- and the Driver App alike. Its supplier is the shipper's Pulse Exchange
-- party: the shipper pays Pulse Exchange, not the DCO as a Finance party. The
-- DCO claims or confirms in the Driver App against the same exchange_payments
-- rows; confirmation posts the shipper's single EXCHANGE_PAYMENT row (an
-- individual DCO has no organization ledger). Reach direct-bid DCO awards keep
-- the DCO payee lane. Live body below, with supplier_id changed from NULL.

-- Was: a DCO trip has no supplier. Now a Marketplace DCO trip may carry one,
-- and tg_trips_pulse_exchange_supplier_guard requires it to be the shipper's
-- Pulse Exchange party. The new check is implied by the old one, which every
-- existing row satisfies, so it is added NOT VALID: no table scan while the
-- trips lock is held.
ALTER TABLE public.trips
  DROP CONSTRAINT IF EXISTS trips_dco_consistency_check,
  ADD CONSTRAINT trips_dco_consistency_check CHECK (
    (operating_mode = 'DCO' AND dco_payee_id IS NOT NULL
      AND (supplier_id IS NULL OR source = 'market_bid'))
    OR (operating_mode = 'FLEET' AND dco_payee_id IS NULL)
  ) NOT VALID;

CREATE OR REPLACE FUNCTION public.create_market_trip_after_fee_payment(p_bid_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_bid           public.market_bids;
  v_indent        public.indents;
  v_indent_org_id uuid;
  v_driver_id     uuid;
  v_dco_payee_id  uuid;
  v_trip          public.trips%ROWTYPE;
BEGIN
  SELECT * INTO v_bid FROM public.market_bids WHERE id = p_bid_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: bid %', p_bid_id;
  END IF;

  SELECT organization_id INTO v_indent_org_id FROM public.indents WHERE id = v_bid.indent_id;

  IF NOT (
    (select auth.uid()) = v_bid.bidder_user_id
    OR EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.organization_id = v_indent_org_id
        AND om.user_id = (select auth.uid())
        AND om.status = 'active'
        AND om.role <> 'driver'
    )
    OR current_user = 'service_role'
    OR current_setting('role', true) = 'service_role'
  ) THEN
    RAISE EXCEPTION 'unauthorized: caller must be the bidder who won this bid or an authorized member of the load-owning organization';
  END IF;

  IF v_bid.bidder_type <> 'dco' THEN
    RAISE EXCEPTION 'invalid_bidder_type: organization awards create a trip via create_trip_from_assigned_indent, not this function';
  END IF;

  SELECT t.* INTO v_trip
  FROM public.trips t
  WHERE t.source = 'market_bid' AND t.source_market_bid_id = v_bid.id
  LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'bid_id', p_bid_id, 'trip_id', v_trip.id, 'status', v_bid.status);
  END IF;

  IF v_bid.status <> 'accepted' THEN
    RAISE EXCEPTION 'invalid_state: bid % is not an accepted award (current: %)', p_bid_id, v_bid.status;
  END IF;

  IF v_bid.fee_payment_status NOT IN ('paid', 'not_required') THEN
    RAISE EXCEPTION 'fee_payment_pending: platform fee must be paid before a trip can be created for bid % (current: %)', p_bid_id, v_bid.fee_payment_status;
  END IF;

  SELECT * INTO v_indent FROM public.indents WHERE id = v_bid.indent_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: indent % for bid %', v_bid.indent_id, p_bid_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.trips t
    WHERE t.indent_id = v_indent.id AND t.status <> 'cancelled'
  ) THEN
    RAISE EXCEPTION 'already_awarded: indent % already has an active canonical trip', v_indent.id;
  END IF;

  IF NOT public.is_driver_available(v_bid.bidder_user_id) THEN
    RAISE EXCEPTION 'driver_unavailable: this driver is already on an active trip';
  END IF;

  IF v_bid.owner_vehicle_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.owner_vehicles ov
    WHERE ov.id = v_bid.owner_vehicle_id
      AND ov.owner_user_id = v_bid.bidder_user_id
      AND ov.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'vehicle_no_longer_eligible: owner_vehicle % is no longer valid for bidder %', v_bid.owner_vehicle_id, v_bid.bidder_user_id;
  END IF;

  v_driver_id := public._resolve_or_create_market_driver(v_indent.organization_id, v_bid.bidder_user_id);

  -- CHANGED (DCO-4): resolve the DCO payee by lookup only, no re-check of
  -- current eligibility -- see this migration's header. bidder_type='dco'
  -- already guarantees eligibility was verified at submission; a
  -- dco_payees row is created exactly once, at first approval, so its
  -- absence here would be a genuine data-integrity violation, not a normal
  -- "not eligible right now" outcome (that case is exactly what a
  -- suspension after award must NOT retroactively enforce).
  v_dco_payee_id := public.get_dco_payee_id(v_bid.bidder_user_id);
  IF v_dco_payee_id IS NULL THEN
    RAISE EXCEPTION 'dco_payee_missing: bidder % has bidder_type=dco but no dco_payees row', v_bid.bidder_user_id;
  END IF;

  INSERT INTO public.trips (
    organization_id,
    trip_number,
    source,
    source_market_bid_id,
    indent_id,
    owner_vehicle_id,
    pickup_area,
    drop_location,
    client_name,
    client_price,
    supplier_rate,
    supplier_id,
    trip_payout_mode,
    operating_mode,
    dco_payee_id,
    driver_id,
    status,
    pickup_date,
    load_type,
    platform_fee,
    driver_commission,
    payment_status,
    amount_paid,
    platform_fee_calc_snapshot,
    sale_rate_basis
  ) VALUES (
    v_indent.organization_id,
    '',
    'market_bid',
    v_bid.id,
    v_indent.id,
    v_bid.owner_vehicle_id,
    coalesce(v_indent.pickup_area, ''),
    coalesce(v_indent.drop_location, ''),
    coalesce(v_indent.client_name, ''),
    v_bid.amount,
    v_bid.amount,   -- CHANGED: was 0. This is the DCO's settlement amount.
    public._ensure_pulse_exchange_party(v_indent.organization_id, 'supplier'),
    'market',       -- CHANGED: was 'asset'.
    'DCO',          -- NEW
    v_dco_payee_id, -- NEW
    v_driver_id,
    'assigned',
    v_indent.pickup_date,
    coalesce(v_indent.load_type, ''),
    coalesce(v_bid.platform_fee_amount, 0),
    0,              -- CHANGED: was v_bid.amount. A DCO trip carries zero driver commission.
    'pending',
    0,
    v_bid.platform_fee_calc_snapshot,
    'per_trip'
  )
  RETURNING * INTO v_trip;

  UPDATE public.market_bids
  SET status = 'superseded', updated_at = now()
  WHERE bidder_user_id = v_bid.bidder_user_id
    AND status = 'pending'
    AND id <> v_bid.id;

  UPDATE public.driver_direct_bids
  SET status = 'superseded', updated_at = now()
  WHERE driver_user_id = v_bid.bidder_user_id
    AND status = 'pending';

  RETURN jsonb_build_object('ok', true, 'bid_id', p_bid_id, 'trip_id', v_trip.id, 'status', 'accepted');
END;
$function$;

-- Exchange-settled DCO trips are owed to Pulse Exchange, not the DCO payee.

CREATE OR REPLACE FUNCTION public.get_dco_ledger_aggregation(p_org_id uuid)
 RETURNS TABLE(dco_payee_id uuid, dco_user_id uuid, trips_count integer, due numeric, paid numeric, outstanding numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH dco_due AS (
    SELECT
      t.dco_payee_id,
      count(*)::int AS trips_count,
      sum(coalesce(t.supplier_rate, 0)) AS due
    FROM public.trips t
    WHERE t.organization_id = p_org_id
      AND t.operating_mode = 'DCO'
      AND t.dco_payee_id IS NOT NULL
      AND NOT public._is_pulse_exchange_party('supplier', t.supplier_id)
    GROUP BY t.dco_payee_id
  ),
  dco_paid AS (
    SELECT
      tx.contact_id AS dco_payee_id,
      sum(tx.amount_out) AS paid
    FROM public.transactions tx
    WHERE tx.organization_id = p_org_id
      AND tx.contact_type = 'dco'
      AND tx.contact_id IS NOT NULL
      AND coalesce(tx.amount_out, 0) > 0
    GROUP BY tx.contact_id
  )
  SELECT
    dp.id AS dco_payee_id,
    dp.user_id AS dco_user_id,
    dd.trips_count,
    dd.due,
    coalesce(dpaid.paid, 0) AS paid,
    greatest(0, dd.due - coalesce(dpaid.paid, 0)) AS outstanding
  FROM dco_due dd
  JOIN public.dco_payees dp ON dp.id = dd.dco_payee_id
  LEFT JOIN dco_paid dpaid ON dpaid.dco_payee_id = dp.id
  WHERE public.is_org_staff(p_org_id);
$function$;
