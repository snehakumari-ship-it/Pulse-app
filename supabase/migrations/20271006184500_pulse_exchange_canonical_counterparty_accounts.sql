-- Pulse Exchange: canonical counterparty accounts (Marketplace is a channel).
--
-- Supersedes the per-org "Pulse Exchange" party from 20271006144616. A
-- Marketplace award now settles against the shipper's account for the bidder
-- (a suppliers row) and the bidder's account for the shipper (a clients row),
-- the same party Finance would use for any other channel:
--
--   * Already connected (a linked row exists): that row is reused.
--   * Not connected: an UNLINKED row is created and recorded in
--     marketplace_counterparty_accounts (server-only). It has no
--     linked_organization_id, so it grants nothing a Network connection grants
--     (is_approved_supplier, shared ledgers, trip chat / location / POD,
--     partner discovery). ADR-012 holds: an award is not a connection.
--   * A later connection request promotes that row in place
--     (on_connection_request_approved), so connecting never forks the account.
--
-- Until connected those accounts are Marketplace-only: hidden from manual
-- pickers (get_non_selectable_party_ids) and written only by Exchange.
--
-- Exchange trips are recorded explicitly in exchange_trips at award. The old
-- marker (supplier = the Pulse Exchange party) cannot work once the supplier is
-- an ordinary account. Trips awarded before this migration stay outside.
-- list_exchange_trips feeds Finance's Marketplace trips lane.
--
-- Marketplace DCO awards go back to the DCO lane: no supplier on the trip, and
-- the shipper's confirmed EXCHANGE_PAYMENT posts against the DCO payee.
--
-- Pulse keeps one system party per org, for the Marketplace platform fee only:
-- "Pulse Marketplace (fees)" (key pulse_marketplace_fee). It can never be a
-- trip supplier, a client, or a manual Finance party.
--
-- Unchanged: the two gates (claim, then the other side confirms; only
-- confirmation posts to Finance), the 72h overdue flag, no auto-confirm, and
-- no ledger for an individual DCO.
--
-- Requires 20271006144616. Production had no Pulse Exchange parties or Exchange
-- payments when this was written; section 1 fails closed if that changed.

SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. Fee-only system party
-- ---------------------------------------------------------------------------

DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM public.suppliers WHERE system_party_key = 'pulse_exchange')
     OR EXISTS (SELECT 1 FROM public.clients WHERE system_party_key = 'pulse_exchange')
     OR EXISTS (SELECT 1 FROM public.exchange_payments) THEN
    RAISE EXCEPTION 'pulse_exchange_data_present: Pulse Exchange parties or payments exist; migrate them before superseding the party model';
  END IF;
END;
$guard$;

ALTER TABLE public.suppliers DROP CONSTRAINT IF EXISTS suppliers_system_party_key_check;
ALTER TABLE public.suppliers ADD CONSTRAINT suppliers_system_party_key_check
  CHECK (system_party_key IS NULL OR system_party_key = 'pulse_marketplace_fee');
ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_system_party_key_check;
ALTER TABLE public.clients ADD CONSTRAINT clients_system_party_key_check
  CHECK (system_party_key IS NULL);

COMMENT ON COLUMN public.suppliers.system_party_key IS
  'Platform-owned party. pulse_marketplace_fee = "Pulse Marketplace (fees)", what the org owes Pulse in Marketplace platform fees. Created and protected by the database; never a trip supplier or a manual Finance party.';
COMMENT ON COLUMN public.clients.system_party_key IS
  'Reserved. No client-side system party exists.';

CREATE OR REPLACE FUNCTION public._ensure_marketplace_fee_party(p_org_id uuid)
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

  SELECT s.id INTO v_id
  FROM public.suppliers s
  WHERE s.organization_id = p_org_id AND s.system_party_key = 'pulse_marketplace_fee';
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  PERFORM set_config('pulse.exchange_writer', 'on', true);
  INSERT INTO public.suppliers (
    organization_id, name, supplier_type, is_active, vendor_status, system_party_key, updated_at
  ) VALUES (
    p_org_id, 'Pulse Marketplace (fees)', 'marketplace', true, 'active', 'pulse_marketplace_fee', now()
  )
  ON CONFLICT (organization_id, system_party_key) WHERE system_party_key IS NOT NULL DO NOTHING
  RETURNING id INTO v_id;
  PERFORM set_config('pulse.exchange_writer', v_prev, true);

  IF v_id IS NULL THEN
    SELECT s.id INTO v_id
    FROM public.suppliers s
    WHERE s.organization_id = p_org_id AND s.system_party_key = 'pulse_marketplace_fee';
  END IF;
  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public._ensure_marketplace_fee_party(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._is_marketplace_fee_party(p_contact_type text, p_contact_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT p_contact_id IS NOT NULL
    AND lower(coalesce(p_contact_type, '')) = 'supplier'
    AND EXISTS (
      SELECT 1 FROM public.suppliers s
      WHERE s.id = p_contact_id AND s.system_party_key = 'pulse_marketplace_fee'
    );
$function$;

REVOKE ALL ON FUNCTION public._is_marketplace_fee_party(text, uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Canonical counterparty accounts
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.marketplace_counterparty_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  party_kind text NOT NULL CHECK (party_kind IN ('supplier', 'client')),
  counterparty_organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Set when a Network connection linked this row in place.
  promoted_at timestamptz,
  CONSTRAINT marketplace_counterparty_accounts_distinct_orgs
    CHECK (organization_id <> counterparty_organization_id),
  CONSTRAINT marketplace_counterparty_accounts_party_matches_kind
    CHECK ((party_kind = 'supplier' AND supplier_id IS NOT NULL AND client_id IS NULL)
        OR (party_kind = 'client' AND client_id IS NOT NULL AND supplier_id IS NULL))
);

COMMENT ON TABLE public.marketplace_counterparty_accounts IS
  'Server-only. The Finance account an org created for a Marketplace counterparty it is not connected to. The account row has no linked_organization_id, so it carries no Network access. promoted_at is set when a connection links it in place.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_marketplace_counterparty_accounts_pair
  ON public.marketplace_counterparty_accounts (organization_id, party_kind, counterparty_organization_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_marketplace_counterparty_accounts_supplier
  ON public.marketplace_counterparty_accounts (supplier_id) WHERE supplier_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_marketplace_counterparty_accounts_client
  ON public.marketplace_counterparty_accounts (client_id) WHERE client_id IS NOT NULL;

ALTER TABLE public.marketplace_counterparty_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.marketplace_counterparty_accounts FROM PUBLIC, anon, authenticated;

-- A linked (connected) row wins; else the mapped Marketplace account; else NULL.
CREATE OR REPLACE FUNCTION public._marketplace_counterparty_account_lookup(
  p_org_id uuid,
  p_kind text,
  p_counterparty_org_id uuid
)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN p_org_id IS NULL OR p_counterparty_org_id IS NULL OR p_org_id = p_counterparty_org_id THEN NULL
    WHEN p_kind = 'supplier' THEN coalesce(
      (SELECT s.id FROM public.suppliers s
       WHERE s.organization_id = p_org_id
         AND s.linked_organization_id = p_counterparty_org_id
         AND s.deleted_at IS NULL
       LIMIT 1),
      (SELECT m.supplier_id FROM public.marketplace_counterparty_accounts m
       WHERE m.organization_id = p_org_id
         AND m.party_kind = 'supplier'
         AND m.counterparty_organization_id = p_counterparty_org_id))
    WHEN p_kind = 'client' THEN coalesce(
      (SELECT c.id FROM public.clients c
       WHERE c.organization_id = p_org_id
         AND c.linked_organization_id = p_counterparty_org_id
         AND c.deleted_at IS NULL
       LIMIT 1),
      (SELECT m.client_id FROM public.marketplace_counterparty_accounts m
       WHERE m.organization_id = p_org_id
         AND m.party_kind = 'client'
         AND m.counterparty_organization_id = p_counterparty_org_id))
  END;
$function$;

REVOKE ALL ON FUNCTION public._marketplace_counterparty_account_lookup(uuid, text, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._ensure_marketplace_counterparty_account(
  p_org_id uuid,
  p_kind text,
  p_counterparty_org_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_name text;
  v_phone text;
  v_prev text := coalesce(current_setting('pulse.exchange_writer', true), '');
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('supplier', 'client') THEN
    RAISE EXCEPTION 'invalid_input: party kind must be supplier or client (got %)', p_kind
      USING ERRCODE = '22023';
  END IF;
  IF p_org_id IS NULL OR p_counterparty_org_id IS NULL OR p_org_id = p_counterparty_org_id THEN
    RETURN NULL;
  END IF;

  v_id := public._marketplace_counterparty_account_lookup(p_org_id, p_kind, p_counterparty_org_id);
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'marketplace_counterparty_account:' || p_org_id::text || ':' || p_kind || ':' || p_counterparty_org_id::text, 0));

  v_id := public._marketplace_counterparty_account_lookup(p_org_id, p_kind, p_counterparty_org_id);
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  SELECT coalesce(nullif(trim(o.name), ''), 'Marketplace partner') INTO v_name
  FROM public.organizations o
  WHERE o.id = p_counterparty_org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: organization %', p_counterparty_org_id USING ERRCODE = 'P0002';
  END IF;

  PERFORM set_config('pulse.exchange_writer', 'on', true);

  IF p_kind = 'supplier' THEN
    INSERT INTO public.suppliers (
      organization_id, name, supplier_type, is_active, vendor_status, updated_at
    ) VALUES (
      p_org_id, v_name, 'marketplace', true, 'active', now()
    )
    RETURNING id INTO v_id;

    INSERT INTO public.marketplace_counterparty_accounts (
      organization_id, party_kind, counterparty_organization_id, supplier_id
    ) VALUES (p_org_id, 'supplier', p_counterparty_org_id, v_id);
  ELSE
    -- clients.phone is required and unique per org; the placeholder is
    -- deterministic so a retry finds the same row.
    v_phone := 'marketplace-' || p_counterparty_org_id::text;
    INSERT INTO public.clients (
      organization_id, name, phone, client_status, status, is_integrated, notes
    ) VALUES (
      p_org_id, v_name, v_phone, 'customer', 'active', false,
      'Marketplace customer. Payments are recorded in Pulse Exchange until you connect.'
    )
    ON CONFLICT (organization_id, phone) DO NOTHING
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
      SELECT c.id INTO v_id
      FROM public.clients c
      WHERE c.organization_id = p_org_id
        AND c.phone = v_phone
        AND c.linked_organization_id IS NULL;
      IF v_id IS NULL THEN
        PERFORM set_config('pulse.exchange_writer', v_prev, true);
        RAISE EXCEPTION 'marketplace_account_conflict: client phone % belongs to a linked client', v_phone
          USING ERRCODE = '23505';
      END IF;
    END IF;

    INSERT INTO public.marketplace_counterparty_accounts (
      organization_id, party_kind, counterparty_organization_id, client_id
    ) VALUES (p_org_id, 'client', p_counterparty_org_id, v_id);
  END IF;

  PERFORM set_config('pulse.exchange_writer', v_prev, true);
  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public._ensure_marketplace_counterparty_account(uuid, text, uuid) FROM PUBLIC, anon, authenticated;

-- An unpromoted Marketplace account: Exchange-only, never picked by hand.
CREATE OR REPLACE FUNCTION public._is_marketplace_only_party(p_contact_type text, p_contact_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT p_contact_id IS NOT NULL AND CASE lower(coalesce(p_contact_type, ''))
    WHEN 'supplier' THEN EXISTS (
      SELECT 1 FROM public.marketplace_counterparty_accounts m
      WHERE m.supplier_id = p_contact_id AND m.promoted_at IS NULL
    )
    WHEN 'client' THEN EXISTS (
      SELECT 1 FROM public.marketplace_counterparty_accounts m
      WHERE m.client_id = p_contact_id AND m.promoted_at IS NULL
    )
    ELSE false
  END;
$function$;

REVOKE ALL ON FUNCTION public._is_marketplace_only_party(text, uuid) FROM PUBLIC, anon, authenticated;

-- Links a mapped Marketplace account to its counterparty when the two orgs
-- connect in that direction. If a linked row already exists for the pair,
-- that row stays the connected account and this one is left as it is.
CREATE OR REPLACE FUNCTION public._promote_marketplace_counterparty_account(
  p_org_id uuid,
  p_kind text,
  p_counterparty_org_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_map public.marketplace_counterparty_accounts%ROWTYPE;
  v_prev text := coalesce(current_setting('pulse.exchange_writer', true), '');
BEGIN
  SELECT * INTO v_map
  FROM public.marketplace_counterparty_accounts m
  WHERE m.organization_id = p_org_id
    AND m.party_kind = p_kind
    AND m.counterparty_organization_id = p_counterparty_org_id
  FOR UPDATE;
  IF NOT FOUND OR v_map.promoted_at IS NOT NULL THEN
    RETURN;
  END IF;

  IF p_kind = 'supplier' THEN
    IF EXISTS (
      SELECT 1 FROM public.suppliers s
      WHERE s.organization_id = p_org_id AND s.linked_organization_id = p_counterparty_org_id
    ) THEN
      RETURN;
    END IF;
    PERFORM set_config('pulse.exchange_writer', 'on', true);
    UPDATE public.suppliers
    SET linked_organization_id = p_counterparty_org_id,
        supplier_type = 'integrated',
        updated_at = now()
    WHERE id = v_map.supplier_id;
  ELSE
    IF EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.organization_id = p_org_id AND c.linked_organization_id = p_counterparty_org_id
    ) THEN
      RETURN;
    END IF;
    PERFORM set_config('pulse.exchange_writer', 'on', true);
    UPDATE public.clients
    SET linked_organization_id = p_counterparty_org_id,
        is_integrated = true,
        updated_at = now()
    WHERE id = v_map.client_id;
  END IF;

  UPDATE public.marketplace_counterparty_accounts
  SET promoted_at = now()
  WHERE id = v_map.id;
  PERFORM set_config('pulse.exchange_writer', v_prev, true);
END;
$function$;

REVOKE ALL ON FUNCTION public._promote_marketplace_counterparty_account(uuid, text, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_non_selectable_party_ids(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_org_member(p_org_id) THEN
    RAISE EXCEPTION 'unauthorized: not a member of organization %', p_org_id
      USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'supplier_ids', coalesce((
      SELECT jsonb_agg(x.id) FROM (
        SELECT s.id FROM public.suppliers s
        WHERE s.organization_id = p_org_id AND s.system_party_key IS NOT NULL
        UNION
        SELECT m.supplier_id FROM public.marketplace_counterparty_accounts m
        WHERE m.organization_id = p_org_id AND m.party_kind = 'supplier' AND m.promoted_at IS NULL
      ) x), '[]'::jsonb),
    'client_ids', coalesce((
      SELECT jsonb_agg(m.client_id) FROM public.marketplace_counterparty_accounts m
      WHERE m.organization_id = p_org_id AND m.party_kind = 'client' AND m.promoted_at IS NULL
    ), '[]'::jsonb)
  );
END;
$function$;

COMMENT ON FUNCTION public.get_non_selectable_party_ids(uuid) IS
  'Parties the org cannot pick by hand: the Pulse Marketplace fee party, and Marketplace accounts for counterparties it is not connected to. Finance still lists them; Exchange writes their entries.';

REVOKE ALL ON FUNCTION public.get_non_selectable_party_ids(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_non_selectable_party_ids(uuid) TO authenticated;

-- System and unpromoted Marketplace parties keep their identity fields; only
-- the platform writers change them. Renaming a Marketplace account is allowed.
CREATE OR REPLACE FUNCTION public.tg_protect_pulse_exchange_party()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_key text;
  v_kind text := CASE WHEN TG_TABLE_NAME = 'suppliers' THEN 'supplier' ELSE 'client' END;
  v_system boolean;
  v_marketplace boolean;
BEGIN
  IF public._pulse_exchange_writer_active() THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.system_party_key IS NOT NULL THEN
      RAISE EXCEPTION 'system_party_reserved: Pulse system parties are created by the platform'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  v_system := OLD.system_party_key IS NOT NULL;
  v_marketplace := public._is_marketplace_only_party(v_kind, OLD.id);

  IF TG_OP = 'DELETE' THEN
    IF v_system OR v_marketplace THEN
      RAISE EXCEPTION 'system_party_protected: this party is managed by Pulse Exchange and cannot be deleted'
        USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;

  IF NOT v_system AND NEW.system_party_key IS NOT NULL THEN
    RAISE EXCEPTION 'system_party_reserved: Pulse system parties are created by the platform'
      USING ERRCODE = '42501';
  END IF;

  IF v_system THEN
    FOREACH v_key IN ARRAY ARRAY[
      'system_party_key', 'name', 'organization_id', 'linked_organization_id',
      'deleted_at', 'is_active', 'status', 'client_status', 'vendor_status', 'supplier_type'
    ] LOOP
      IF (to_jsonb(NEW) -> v_key) IS DISTINCT FROM (to_jsonb(OLD) -> v_key) THEN
        RAISE EXCEPTION 'system_party_protected: % of a Pulse system party cannot be changed', v_key
          USING ERRCODE = '42501';
      END IF;
    END LOOP;
  ELSIF v_marketplace THEN
    -- Linking by hand would grant Network access without a connection.
    FOREACH v_key IN ARRAY ARRAY[
      'organization_id', 'linked_organization_id', 'is_integrated', 'supplier_type', 'deleted_at'
    ] LOOP
      IF (to_jsonb(NEW) -> v_key) IS DISTINCT FROM (to_jsonb(OLD) -> v_key) THEN
        RAISE EXCEPTION 'marketplace_account_protected: % of a Marketplace account changes only when you connect', v_key
          USING ERRCODE = '42501';
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. Exchange trips are enrolled explicitly at award
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.exchange_trips (
  trip_id uuid PRIMARY KEY REFERENCES public.trips(id) ON DELETE CASCADE,
  market_bid_id uuid REFERENCES public.market_bids(id) ON DELETE RESTRICT,
  enrolled_via text NOT NULL CHECK (enrolled_via IN ('award', 'repair')),
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.exchange_trips IS
  'Server-only. Shipper trips (the settlement anchor) that settle through Pulse Exchange; a bidder mover_asset trip resolves to its anchor. Written at Marketplace award or by a reviewed repair. Exchange payments are accepted only for these trips.';

ALTER TABLE public.exchange_trips ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.exchange_trips FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._exchange_enroll_trip(p_trip_id uuid, p_market_bid_id uuid, p_via text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  INSERT INTO public.exchange_trips (trip_id, market_bid_id, enrolled_via)
  VALUES (p_trip_id, p_market_bid_id, p_via)
  ON CONFLICT (trip_id) DO NOTHING;
$function$;

REVOKE ALL ON FUNCTION public._exchange_enroll_trip(uuid, uuid, text) FROM PUBLIC, anon, authenticated;

-- The Finance party an Exchange trip settles against, from the trip owner's
-- side: the shipper's supplier account (or its DCO payee) on the anchor trip,
-- the bidder's client account on its mover_asset trip. No row otherwise.
CREATE OR REPLACE FUNCTION public._exchange_trip_ledger_contact(p_trip_id uuid)
RETURNS TABLE (contact_type text, contact_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_trip public.trips%ROWTYPE;
  v_anchor uuid;
BEGIN
  SELECT * INTO v_trip FROM public.trips t WHERE t.id = p_trip_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.exchange_trips et WHERE et.trip_id = v_trip.id) THEN
    IF v_trip.operating_mode = 'DCO' THEN
      RETURN QUERY SELECT 'dco'::text, v_trip.dco_payee_id;
    ELSE
      RETURN QUERY SELECT 'supplier'::text, v_trip.supplier_id;
    END IF;
    RETURN;
  END IF;

  IF v_trip.source = 'mover_asset' THEN
    v_anchor := public._exchange_settlement_trip_id(v_trip.id);
    IF v_anchor <> v_trip.id
       AND EXISTS (SELECT 1 FROM public.exchange_trips et WHERE et.trip_id = v_anchor) THEN
      RETURN QUERY SELECT 'client'::text, v_trip.client_id;
    END IF;
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public._exchange_trip_ledger_contact(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Ledger guard: Exchange entries are written only by Exchange
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.tg_transactions_pulse_exchange_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_lc record;
BEGIN
  IF public._pulse_exchange_writer_active() THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE')
     AND (OLD.ledger_category IN ('EXCHANGE_PAYMENT', 'EXCHANGE_RECEIPT')
          OR public._is_marketplace_fee_party(OLD.contact_type, OLD.contact_id)) THEN
    RAISE EXCEPTION 'exchange_ledger_locked: a confirmed Pulse Exchange entry cannot be edited or deleted from Finance'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  IF NEW.ledger_category IN ('EXCHANGE_PAYMENT', 'EXCHANGE_RECEIPT')
     OR public._is_marketplace_fee_party(NEW.contact_type, NEW.contact_id) THEN
    RAISE EXCEPTION 'exchange_ledger_locked: Pulse Exchange entries post to Finance only after the other side confirms them'
      USING ERRCODE = '42501';
  END IF;

  IF public._is_marketplace_only_party(NEW.contact_type, NEW.contact_id) THEN
    RAISE EXCEPTION 'exchange_ledger_locked: payments with a Marketplace partner you are not connected to are recorded in Pulse Exchange on the trip'
      USING ERRCODE = '42501';
  END IF;

  -- On an Exchange trip, a direct payment to the counterparty would be a
  -- second obligation next to the Exchange one.
  IF NEW.trip_id IS NOT NULL THEN
    SELECT * INTO v_lc FROM public._exchange_trip_ledger_contact(NEW.trip_id);
    IF v_lc.contact_type IS NOT NULL
       AND lower(coalesce(NEW.contact_type, '')) = v_lc.contact_type
       AND (v_lc.contact_type = 'dco' OR NEW.contact_id IS NOT DISTINCT FROM v_lc.contact_id) THEN
      RAISE EXCEPTION 'exchange_ledger_locked: this trip settles through Pulse Exchange; record the payment in Exchange'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Trips: who may be a trip supplier
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
  IF NEW.operating_mode = 'DCO' THEN
    RAISE EXCEPTION 'dco_trip_supplier: a DCO trip settles with its DCO payee and cannot carry a supplier'
      USING ERRCODE = '23514';
  END IF;
  IF public._is_marketplace_fee_party('supplier', NEW.supplier_id) THEN
    RAISE EXCEPTION 'marketplace_fee_party_reserved: Pulse Marketplace (fees) cannot be a trip supplier'
      USING ERRCODE = '23514';
  END IF;
  IF public._is_marketplace_only_party('supplier', NEW.supplier_id) THEN
    IF NOT public._pulse_exchange_writer_active()
       AND (lower(coalesce(NEW.source, '')) NOT IN ('market_bid', 'direct_quote') OR NEW.indent_id IS NULL) THEN
      RAISE EXCEPTION 'marketplace_account_reserved: a Marketplace partner you are not connected to can only be the supplier on its Marketplace trip'
        USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.suppliers s
      WHERE s.id = NEW.supplier_id AND s.organization_id = NEW.organization_id
    ) THEN
      RAISE EXCEPTION 'marketplace_account_reserved: the Marketplace account belongs to another organization'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- Restores the DCO foundation rule (20270310200000): a DCO trip has no
-- supplier. Every row satisfies it (the widened form only admitted the Pulse
-- Exchange party, and none exist), so it is added NOT VALID: no table scan
-- while the trips lock is held.
ALTER TABLE public.trips
  DROP CONSTRAINT IF EXISTS trips_dco_consistency_check,
  ADD CONSTRAINT trips_dco_consistency_check CHECK (
    (operating_mode = 'DCO' AND dco_payee_id IS NOT NULL AND supplier_id IS NULL)
    OR (operating_mode = 'FLEET' AND dco_payee_id IS NULL)
  ) NOT VALID;

-- ---------------------------------------------------------------------------
-- 6. Award paths: canonical accounts, explicit enrollment, DCO lane
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_trip_from_assigned_indent(p_indent_id uuid, p_driver_id uuid DEFAULT NULL::uuid, p_vehicle_id uuid DEFAULT NULL::uuid, p_vehicle_display_number text DEFAULT NULL::text)
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
    -- Canonical accounts on both sides: the connected row when one exists,
    -- else an unlinked Marketplace account (no Network access, ADR-012).
    v_supplier_id := public._ensure_marketplace_counterparty_account(v_org_id, 'supplier', v_supplier_org_id);
    PERFORM public._ensure_marketplace_counterparty_account(v_supplier_org_id, 'client', v_org_id);
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

      IF v_is_market_award THEN
        PERFORM public._exchange_enroll_trip(v_trip.id, v_source_market_bid_id, 'award');
      END IF;

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

CREATE OR REPLACE FUNCTION public.create_trip_from_direct_quote(p_quote_id uuid, p_vehicle_display_number text DEFAULT NULL::text)
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

  -- Marketplace: canonical accounts, linked only when the orgs are already
  -- connected (ADR-012). Network: bid visibility already required a supplier;
  -- ensure the row instead of blocking convert.
  IF v_is_marketplace THEN
    v_supplier_id := public._ensure_marketplace_counterparty_account(v_org_id, 'supplier', (v_quote).bidder_organization_id);
    PERFORM public._ensure_marketplace_counterparty_account((v_quote).bidder_organization_id, 'client', v_org_id);
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

      IF v_is_marketplace THEN
        PERFORM public._exchange_enroll_trip(v_trip.id, NULL, 'award');
      END IF;

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
    NULL,           -- DCO lane: settles with the DCO payee, never a supplier.
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

  PERFORM public._exchange_enroll_trip(v_trip.id, v_bid.id, 'award');

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

-- ---------------------------------------------------------------------------
-- 7. Exchange core: enrolled trips, posting to the canonical accounts
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._exchange_trip_award(p_trip_id uuid)
 RETURNS TABLE(trip_id uuid, trip_number text, payer_organization_id uuid, payee_organization_id uuid, market_bid_id uuid, agreed_amount numeric, payee_dco_payee_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
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

  -- Enrollment is the award-time decision; a later connection between the
  -- two orgs does not take the trip out of Exchange.
  IF NOT EXISTS (SELECT 1 FROM public.exchange_trips et WHERE et.trip_id = v_trip.id) THEN
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
       OR v_payee = v_trip.organization_id THEN
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
  v_trip public.trips%ROWTYPE;
  v_payer_type text;
  v_payer_name text;
  v_payee_name text;
  v_payee_trip_id uuid;
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

  SELECT * INTO v_trip FROM public.trips t WHERE t.id = v_row.trip_id;
  IF v_row.payee_dco_payee_id IS NOT NULL THEN
    v_payer_type := 'dco';
    v_payer_party := v_row.payee_dco_payee_id;
    SELECT u.name INTO v_payer_name
    FROM public.dco_payees dp JOIN public.users u ON u.id = dp.user_id
    WHERE dp.id = v_row.payee_dco_payee_id;
  ELSE
    v_payer_type := 'supplier';
    v_payer_party := coalesce(
      v_trip.supplier_id,
      public._ensure_marketplace_counterparty_account(v_row.payer_organization_id, 'supplier', v_row.payee_organization_id));
    SELECT s.name INTO v_payer_name FROM public.suppliers s WHERE s.id = v_payer_party;

    v_payee_trip_id := public._exchange_payee_trip_id(v_row.trip_id, v_row.payee_organization_id);
    IF v_payee_trip_id <> v_row.trip_id THEN
      SELECT t.client_id INTO v_payee_party FROM public.trips t WHERE t.id = v_payee_trip_id;
    END IF;
    v_payee_party := coalesce(
      v_payee_party,
      public._ensure_marketplace_counterparty_account(v_row.payee_organization_id, 'client', v_row.payer_organization_id));
    SELECT c.name INTO v_payee_name FROM public.clients c WHERE c.id = v_payee_party;
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
    v_row.payer_organization_id, v_row.trip_id,
    coalesce(nullif(trim(v_payer_name), ''), 'Marketplace partner'), 'EXCHANGE PAYMENT' || v_suffix,
    0, v_row.amount, v_row.paid_on,
    v_payer_party, v_payer_type, v_payer_type, 'payable', 'EXCHANGE_PAYMENT',
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
      v_row.payee_organization_id, v_payee_trip_id,
      coalesce(nullif(trim(v_payee_name), ''), 'Marketplace partner'), 'EXCHANGE RECEIPT' || v_suffix,
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
  'Gate 2: the side that did not record the payment confirms it. In one transaction posts the shipper''s EXCHANGE_PAYMENT (shipper trip; against its account for the bidder, or the DCO payee) and, for an organization bidder, the bidder''s EXCHANGE_RECEIPT (its mover_asset trip when it exists; against its account for the shipper). An individual DCO has no ledger; its receivable is this Exchange record.';

CREATE OR REPLACE FUNCTION public.get_exchange_trip_summary(p_trip_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_award record;
  v_viewer_side text;
  v_lc_type text;
  v_lc_id uuid;
  v_payee_trip_id uuid;
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

  -- The Finance party this viewer's entries post against (none for a DCO).
  IF v_viewer_side = 'payer' THEN
    SELECT lc.contact_type, lc.contact_id INTO v_lc_type, v_lc_id
    FROM public._exchange_trip_ledger_contact(v_award.trip_id) lc;
  ELSIF v_award.payee_organization_id IS NOT NULL THEN
    v_lc_type := 'client';
    v_payee_trip_id := public._exchange_payee_trip_id(v_award.trip_id, v_award.payee_organization_id);
    IF v_payee_trip_id <> v_award.trip_id THEN
      SELECT t.client_id INTO v_lc_id FROM public.trips t WHERE t.id = v_payee_trip_id;
    END IF;
    v_lc_id := coalesce(v_lc_id, public._marketplace_counterparty_account_lookup(
      v_award.payee_organization_id, 'client', v_award.payer_organization_id));
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
    'ledger_contact_type', v_lc_type,
    'ledger_contact_id', v_lc_id,
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
  'Pulse Exchange settlement for one trip as seen by the shipper or the winning bidder (organization staff or the DCO payee in the Driver App), with the Finance party the viewer''s entries post against (ledger_contact_type / ledger_contact_id). NULL when the trip is not an Exchange trip or the caller is not a party.';

-- Finance "Marketplace trips" lane: every Exchange trip this org is a side of,
-- with the trip the org itself owns (the shipper's trip, or the bidder's
-- mover_asset trip when it exists) and the name of the party its entries post to.
CREATE OR REPLACE FUNCTION public.list_exchange_trips(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_rows jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_org_staff(p_org_id) THEN
    RAISE EXCEPTION 'unauthorized: not staff of organization %', p_org_id
      USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(jsonb_agg(
           x.s || jsonb_build_object(
             'viewer_trip_id', x.viewer_trip_id,
             'viewer_trip_number', vt.trip_number,
             'ledger_contact_name', CASE x.s->>'ledger_contact_type'
               WHEN 'supplier' THEN (SELECT sp.name FROM public.suppliers sp WHERE sp.id = (x.s->>'ledger_contact_id')::uuid)
               WHEN 'client' THEN (SELECT c.name FROM public.clients c WHERE c.id = (x.s->>'ledger_contact_id')::uuid)
               ELSE x.s->>'payee_organization_name'
             END
           )
           ORDER BY x.created_at DESC), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT s.s, t.created_at,
           CASE WHEN s.s->>'viewer_side' = 'payer' THEN t.id
                ELSE public._exchange_payee_trip_id(t.id, p_org_id) END AS viewer_trip_id
    FROM public.exchange_trips et
    JOIN public.trips t ON t.id = et.trip_id AND t.deleted_at IS NULL
    LEFT JOIN public.market_bids mb ON mb.id = et.market_bid_id
    CROSS JOIN LATERAL (SELECT public.get_exchange_trip_summary(t.id) AS s) s
    WHERE (t.organization_id = p_org_id OR mb.bidder_organization_id = p_org_id)
      AND s.s IS NOT NULL
      AND ((s.s->>'viewer_side' = 'payer' AND (s.s->>'payer_organization_id')::uuid = p_org_id)
        OR (s.s->>'viewer_side' = 'payee' AND (s.s->>'payee_organization_id')::uuid = p_org_id))
  ) x
  LEFT JOIN public.trips vt ON vt.id = x.viewer_trip_id;

  RETURN v_rows;
END;
$function$;

COMMENT ON FUNCTION public.list_exchange_trips(uuid) IS
  'Finance Marketplace trips lane: get_exchange_trip_summary for each Exchange trip where the org is the shipper or the winning bidder, plus viewer_trip_id / viewer_trip_number (the org''s own trip) and ledger_contact_name.';

REVOKE ALL ON FUNCTION public.list_exchange_trips(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_exchange_trips(uuid) TO authenticated;


-- ---------------------------------------------------------------------------
-- 8. Platform fee: paid fees post against Pulse Marketplace (fees)
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

  v_party := public._ensure_marketplace_fee_party(NEW.bidder_organization_id);

  PERFORM set_config('pulse.exchange_writer', 'on', true);
  INSERT INTO public.transactions (
    organization_id, trip_id, party_name, description,
    amount_in, amount_out, transaction_date,
    contact_id, contact_type, ledger_entity_type, ledger_flow_type, ledger_category,
    payment_ref, payment_reference
  ) VALUES (
    NEW.bidder_organization_id, NULL, 'Pulse Marketplace (fees)',
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

-- ---------------------------------------------------------------------------
-- 9. Finance aggregation
-- ---------------------------------------------------------------------------
-- Supplier side: the fee party carries unpaid fees on accepted bids plus paid
-- fee rows. Marketplace accounts need nothing special: trips name them as
-- supplier and EXCHANGE_PAYMENT rows name them as contact.
-- Customer side: Exchange trips the org won and executes without its own
-- mover_asset trip bill its account for the shipper at supplier_rate.
-- DCO side: Marketplace DCO trips are back in the DCO payee lane.

CREATE OR REPLACE FUNCTION public.get_supplier_ledger_aggregation(p_org_id uuid, p_apply_adjustments boolean DEFAULT true)
 RETURNS TABLE(supplier_id uuid, trips_count integer, due numeric, paid numeric, unsettled numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
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
  fee_party AS (
    SELECT s.id AS supplier_id
    FROM public.suppliers s
    WHERE s.organization_id = p_org_id AND s.system_party_key = 'pulse_marketplace_fee'
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
    FROM fee_party ep
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

CREATE OR REPLACE FUNCTION public.get_customer_ledger_inputs(p_org_id uuid, p_apply_adjustments boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
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
      public._marketplace_counterparty_account_lookup(p_org_id, 'client', t.organization_id) AS client_id,
      coalesce(t.supplier_rate, 0) AS base_amount,
      0::numeric AS amount_paid,
      true AS is_exchange
    FROM public.exchange_trips et
    JOIN public.trips t
      ON t.id = et.trip_id
     AND lower(coalesce(t.status, '')) <> 'cancelled'
    JOIN public.indents i
      ON i.id = t.indent_id
     AND i.organization_id = t.organization_id
    WHERE i.assigned_supplier_id = p_org_id
      AND i.organization_id <> p_org_id
      -- With its own mover_asset trip the bidder bills its account there.
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

-- ---------------------------------------------------------------------------
-- 10. Bidder mover_asset trip bills the bidder's account for the shipper
-- ---------------------------------------------------------------------------

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

  IF EXISTS (
    SELECT 1 FROM public.exchange_trips et
    JOIN public.trips agg ON agg.id = et.trip_id
    WHERE agg.indent_id = p_indent_id AND agg.organization_id = v_indent.organization_id
  ) THEN
    v_client_id := public._ensure_marketplace_counterparty_account(v_mover_org_id, 'client', v_indent.organization_id);
    v_client_name := coalesce(
      (SELECT c.name FROM public.clients c WHERE c.id = v_client_id),
      (SELECT o.name FROM public.organizations o WHERE o.id = v_indent.organization_id),
      'Client');
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

  IF EXISTS (
    SELECT 1 FROM public.exchange_trips et
    JOIN public.trips agg ON agg.id = et.trip_id
    WHERE agg.indent_id = p_indent_id AND agg.organization_id = v_indent.organization_id
  ) THEN
    v_client_id := public._ensure_marketplace_counterparty_account(v_mover_org_id, 'client', v_indent.organization_id);
    v_client_name := coalesce(
      (SELECT c.name FROM public.clients c WHERE c.id = v_client_id),
      (SELECT o.name FROM public.organizations o WHERE o.id = v_indent.organization_id),
      'Client');
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

  IF EXISTS (
    SELECT 1 FROM public.exchange_trips et
    WHERE et.trip_id = public._exchange_settlement_trip_id(v_mover_trip.id)
      AND et.trip_id <> v_mover_trip.id
  ) THEN
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
-- 11. Connecting promotes the Marketplace account in place
-- ---------------------------------------------------------------------------
-- Live body plus one call before each "is there a linked row?" lookup. The
-- promoted row is then found and takes the existing already-linked branch, so
-- the connection reuses the Marketplace account instead of creating another.

CREATE OR REPLACE FUNCTION public.on_connection_request_approved()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_other_owner_id uuid;
  v_other_phone text;
  v_linked int := 0;
  v_already int;
  v_placeholder_phone text;
  v_org_id uuid;
  v_other_org_id uuid;
BEGIN
  IF new.status <> 'approved' OR old.status = 'approved' THEN
    RETURN new;
  END IF;

  IF new.request_carrier_supplier THEN
    INSERT INTO public.organization_relations (from_organization_id, to_organization_id, relation_type, status)
    VALUES (new.from_organization_id, new.to_organization_id, 'client_supplier', 'active')
    ON CONFLICT (from_organization_id, to_organization_id, relation_type)
    DO UPDATE SET status = 'active', updated_at = now();
  END IF;

  IF new.request_shipper_client THEN
    INSERT INTO public.organization_relations (from_organization_id, to_organization_id, relation_type, status)
    VALUES (new.from_organization_id, new.to_organization_id, 'supplier_client', 'active')
    ON CONFLICT (from_organization_id, to_organization_id, relation_type)
    DO UPDATE SET status = 'active', updated_at = now();
  END IF;

  -- request_shipper_client: from_org adds to_org as CLIENT; to_org adds from_org as SUPPLIER.
  IF new.request_shipper_client THEN
    v_linked := 0;
    PERFORM public._promote_marketplace_counterparty_account(new.from_organization_id, 'client', new.to_organization_id);
    SELECT 1 INTO v_already
    FROM public.clients
    WHERE organization_id = new.from_organization_id
      AND linked_organization_id = new.to_organization_id
    LIMIT 1;

    IF v_already IS NULL THEN
      v_org_id := new.from_organization_id;
      v_other_org_id := new.to_organization_id;
      v_placeholder_phone := 'linked-' || v_other_org_id::text;

      SELECT o.owner_id INTO v_other_owner_id
      FROM public.organizations o
      WHERE o.id = v_other_org_id;

      IF v_other_owner_id IS NOT NULL THEN
        SELECT trim(coalesce(p.phone, '')) INTO v_other_phone
        FROM public.profiles p
        WHERE p.id = v_other_owner_id;

        IF v_other_phone <> '' THEN
          UPDATE public.clients
          SET linked_organization_id = v_other_org_id,
              is_integrated = true,
              updated_at = now()
          WHERE organization_id = v_org_id
            AND linked_organization_id IS NULL
            AND phone IS NOT NULL
            AND (
              trim(regexp_replace(coalesce(phone, ''), '\s+', '', 'g')) =
                trim(regexp_replace(v_other_phone, '\s+', '', 'g'))
              OR (
                length(regexp_replace(coalesce(phone, ''), '\D', '', 'g')) >= 10
                AND length(regexp_replace(v_other_phone, '\D', '', 'g')) >= 10
                AND right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10) =
                  right(regexp_replace(v_other_phone, '\D', '', 'g'), 10)
              )
            );
          GET DIAGNOSTICS v_linked = row_count;
        END IF;
      END IF;

      IF v_linked = 0 THEN
        UPDATE public.clients c
        SET name = coalesce(nullif(trim(o.name), ''), c.name, 'Connected'),
            linked_organization_id = v_other_org_id,
            is_integrated = true,
            updated_at = now()
        FROM public.organizations o
        WHERE o.id = v_other_org_id
          AND c.organization_id = v_org_id
          AND c.phone = v_placeholder_phone;
        GET DIAGNOSTICS v_linked = row_count;
      END IF;

      IF v_linked = 0 THEN
        INSERT INTO public.clients (organization_id, name, phone, email, linked_organization_id, is_integrated, updated_at)
        SELECT v_org_id,
               coalesce(nullif(trim(o.name), ''), 'Connected'),
               v_placeholder_phone,
               NULL,
               v_other_org_id,
               true,
               now()
        FROM public.organizations o
        WHERE o.id = v_other_org_id
        ON CONFLICT (organization_id, linked_organization_id)
          WHERE linked_organization_id IS NOT NULL
        DO UPDATE SET is_integrated = true, updated_at = now();

        IF NOT FOUND THEN
          INSERT INTO public.clients (organization_id, name, phone, linked_organization_id, is_integrated, updated_at)
          VALUES (v_org_id, 'Connected', v_placeholder_phone, v_other_org_id, true, now())
          ON CONFLICT (organization_id, linked_organization_id)
            WHERE linked_organization_id IS NOT NULL
          DO UPDATE SET is_integrated = true, updated_at = now();
        END IF;
      END IF;
    ELSE
      UPDATE public.clients
      SET is_integrated = true,
          linked_organization_id = new.to_organization_id,
          updated_at = now()
      WHERE organization_id = new.from_organization_id
        AND linked_organization_id = new.to_organization_id;
    END IF;

    v_linked := 0;
    PERFORM public._promote_marketplace_counterparty_account(new.to_organization_id, 'supplier', new.from_organization_id);
    SELECT 1 INTO v_already
    FROM public.suppliers
    WHERE organization_id = new.to_organization_id
      AND linked_organization_id = new.from_organization_id
    LIMIT 1;

    IF v_already IS NULL THEN
      v_org_id := new.to_organization_id;
      v_other_org_id := new.from_organization_id;

      SELECT o.owner_id INTO v_other_owner_id
      FROM public.organizations o
      WHERE o.id = v_other_org_id;

      IF v_other_owner_id IS NOT NULL THEN
        SELECT trim(coalesce(p.phone, '')) INTO v_other_phone
        FROM public.profiles p
        WHERE p.id = v_other_owner_id;

        IF v_other_phone <> '' THEN
          UPDATE public.suppliers
          SET linked_organization_id = v_other_org_id,
              supplier_type = 'integrated',
              updated_at = now()
          WHERE organization_id = v_org_id
            AND (linked_organization_id IS NULL OR linked_organization_id <> v_other_org_id)
            AND phone IS NOT NULL
            AND (
              trim(regexp_replace(coalesce(phone, ''), '\s+', '', 'g')) =
                trim(regexp_replace(v_other_phone, '\s+', '', 'g'))
              OR (
                length(regexp_replace(coalesce(phone, ''), '\D', '', 'g')) >= 10
                AND length(regexp_replace(v_other_phone, '\D', '', 'g')) >= 10
                AND right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10) =
                  right(regexp_replace(v_other_phone, '\D', '', 'g'), 10)
              )
            );
          GET DIAGNOSTICS v_linked = row_count;
        END IF;
      END IF;

      IF v_linked = 0 THEN
        INSERT INTO public.suppliers (organization_id, name, phone, email, linked_organization_id, supplier_type, updated_at)
        SELECT v_org_id,
               coalesce(nullif(trim(o.name), ''), 'Connected'),
               NULL,
               NULL,
               v_other_org_id,
               'integrated',
               now()
        FROM public.organizations o
        WHERE o.id = v_other_org_id
        ON CONFLICT (organization_id, linked_organization_id)
          WHERE linked_organization_id IS NOT NULL
        DO UPDATE SET supplier_type = 'integrated', updated_at = now();

        IF NOT FOUND THEN
          INSERT INTO public.suppliers (organization_id, name, linked_organization_id, supplier_type, updated_at)
          VALUES (v_org_id, 'Connected', v_other_org_id, 'integrated', now())
          ON CONFLICT (organization_id, linked_organization_id)
            WHERE linked_organization_id IS NOT NULL
          DO UPDATE SET supplier_type = 'integrated', updated_at = now();
        END IF;
      END IF;
    ELSE
      UPDATE public.suppliers
      SET supplier_type = 'integrated',
          linked_organization_id = new.from_organization_id,
          updated_at = now()
      WHERE organization_id = new.to_organization_id
        AND linked_organization_id = new.from_organization_id;
    END IF;

  -- request_carrier_supplier: from_org adds to_org as SUPPLIER; to_org adds from_org as CLIENT.
  ELSIF new.request_carrier_supplier THEN
    v_linked := 0;
    PERFORM public._promote_marketplace_counterparty_account(new.from_organization_id, 'supplier', new.to_organization_id);
    SELECT 1 INTO v_already
    FROM public.suppliers
    WHERE organization_id = new.from_organization_id
      AND linked_organization_id = new.to_organization_id
    LIMIT 1;

    IF v_already IS NULL THEN
      v_org_id := new.from_organization_id;
      v_other_org_id := new.to_organization_id;

      SELECT o.owner_id INTO v_other_owner_id
      FROM public.organizations o
      WHERE o.id = v_other_org_id;

      IF v_other_owner_id IS NOT NULL THEN
        SELECT trim(coalesce(p.phone, '')) INTO v_other_phone
        FROM public.profiles p
        WHERE p.id = v_other_owner_id;

        IF v_other_phone <> '' THEN
          UPDATE public.suppliers
          SET linked_organization_id = v_other_org_id,
              supplier_type = 'integrated',
              updated_at = now()
          WHERE organization_id = v_org_id
            AND (linked_organization_id IS NULL OR linked_organization_id <> v_other_org_id)
            AND phone IS NOT NULL
            AND (
              trim(regexp_replace(coalesce(phone, ''), '\s+', '', 'g')) =
                trim(regexp_replace(v_other_phone, '\s+', '', 'g'))
              OR (
                length(regexp_replace(coalesce(phone, ''), '\D', '', 'g')) >= 10
                AND length(regexp_replace(v_other_phone, '\D', '', 'g')) >= 10
                AND right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10) =
                  right(regexp_replace(v_other_phone, '\D', '', 'g'), 10)
              )
            );
          GET DIAGNOSTICS v_linked = row_count;
        END IF;
      END IF;

      IF v_linked = 0 THEN
        INSERT INTO public.suppliers (organization_id, name, phone, email, linked_organization_id, supplier_type, updated_at)
        SELECT v_org_id,
               coalesce(nullif(trim(o.name), ''), 'Connected'),
               NULL,
               NULL,
               v_other_org_id,
               'integrated',
               now()
        FROM public.organizations o
        WHERE o.id = v_other_org_id
        ON CONFLICT (organization_id, linked_organization_id)
          WHERE linked_organization_id IS NOT NULL
        DO UPDATE SET supplier_type = 'integrated', updated_at = now();

        IF NOT FOUND THEN
          INSERT INTO public.suppliers (organization_id, name, linked_organization_id, supplier_type, updated_at)
          VALUES (v_org_id, 'Connected', v_other_org_id, 'integrated', now())
          ON CONFLICT (organization_id, linked_organization_id)
            WHERE linked_organization_id IS NOT NULL
          DO UPDATE SET supplier_type = 'integrated', updated_at = now();
        END IF;
      END IF;
    ELSE
      UPDATE public.suppliers
      SET supplier_type = 'integrated',
          linked_organization_id = new.to_organization_id,
          updated_at = now()
      WHERE organization_id = new.from_organization_id
        AND linked_organization_id = new.to_organization_id;
    END IF;

    v_linked := 0;
    PERFORM public._promote_marketplace_counterparty_account(new.to_organization_id, 'client', new.from_organization_id);
    SELECT 1 INTO v_already
    FROM public.clients
    WHERE organization_id = new.to_organization_id
      AND linked_organization_id = new.from_organization_id
    LIMIT 1;

    IF v_already IS NULL THEN
      v_org_id := new.to_organization_id;
      v_other_org_id := new.from_organization_id;
      v_placeholder_phone := 'linked-' || v_other_org_id::text;

      SELECT o.owner_id INTO v_other_owner_id
      FROM public.organizations o
      WHERE o.id = v_other_org_id;

      IF v_other_owner_id IS NOT NULL THEN
        SELECT trim(coalesce(p.phone, '')) INTO v_other_phone
        FROM public.profiles p
        WHERE p.id = v_other_owner_id;

        IF v_other_phone <> '' THEN
          UPDATE public.clients
          SET linked_organization_id = v_other_org_id,
              is_integrated = true,
              updated_at = now()
          WHERE organization_id = v_org_id
            AND linked_organization_id IS NULL
            AND phone IS NOT NULL
            AND (
              trim(regexp_replace(coalesce(phone, ''), '\s+', '', 'g')) =
                trim(regexp_replace(v_other_phone, '\s+', '', 'g'))
              OR (
                length(regexp_replace(coalesce(phone, ''), '\D', '', 'g')) >= 10
                AND length(regexp_replace(v_other_phone, '\D', '', 'g')) >= 10
                AND right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10) =
                  right(regexp_replace(v_other_phone, '\D', '', 'g'), 10)
              )
            );
          GET DIAGNOSTICS v_linked = row_count;
        END IF;
      END IF;

      IF v_linked = 0 THEN
        UPDATE public.clients c
        SET name = coalesce(nullif(trim(o.name), ''), c.name, 'Connected'),
            linked_organization_id = v_other_org_id,
            is_integrated = true,
            updated_at = now()
        FROM public.organizations o
        WHERE o.id = v_other_org_id
          AND c.organization_id = v_org_id
          AND c.phone = v_placeholder_phone;
        GET DIAGNOSTICS v_linked = row_count;
      END IF;

      IF v_linked = 0 THEN
        INSERT INTO public.clients (organization_id, name, phone, email, linked_organization_id, is_integrated, updated_at)
        SELECT v_org_id,
               coalesce(nullif(trim(o.name), ''), 'Connected'),
               v_placeholder_phone,
               NULL,
               v_other_org_id,
               true,
               now()
        FROM public.organizations o
        WHERE o.id = v_other_org_id
        ON CONFLICT (organization_id, linked_organization_id)
          WHERE linked_organization_id IS NOT NULL
        DO UPDATE SET is_integrated = true, updated_at = now();

        IF NOT FOUND THEN
          INSERT INTO public.clients (organization_id, name, phone, linked_organization_id, is_integrated, updated_at)
          VALUES (v_org_id, 'Connected', v_placeholder_phone, v_other_org_id, true, now())
          ON CONFLICT (organization_id, linked_organization_id)
            WHERE linked_organization_id IS NOT NULL
          DO UPDATE SET is_integrated = true, updated_at = now();
        END IF;
      END IF;
    ELSE
      UPDATE public.clients
      SET is_integrated = true,
          linked_organization_id = new.from_organization_id,
          updated_at = now()
      WHERE organization_id = new.to_organization_id
        AND linked_organization_id = new.from_organization_id;
    END IF;
  END IF;

  RETURN new;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 12. Retire the per-org Pulse Exchange party
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.ensure_pulse_exchange_parties(uuid);
DROP FUNCTION IF EXISTS public._ensure_pulse_exchange_party(uuid, text);
DROP FUNCTION IF EXISTS public._is_pulse_exchange_party(text, uuid);
