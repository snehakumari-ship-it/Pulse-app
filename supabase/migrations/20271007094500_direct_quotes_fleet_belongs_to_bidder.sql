-- Release 2 Phase D: trust boundary for the driver/vehicle that
-- create_trip_from_direct_quote copies from an accepted quote onto the
-- shipper's trip. That function (production body from 20271006184500) does not
-- check fleet ownership, and the bidder/owner UPDATE policies plus the bidder
-- INSERT policy still let a client write direct_quotes.driver_id / vehicle_id
-- directly. This trigger makes every write path, RPC or direct, keep both
-- columns inside the bidder organization's own fleet, so trip creation only
-- ever consumes values set_direct_quote_assignment would also have accepted.
--
-- create_trip_from_direct_quote, the RLS policies and every Release 1 / Gate 1A
-- object are left untouched. Values already stored are not re-validated unless
-- the write changes them (or moves the quote to another bidder organization).

CREATE OR REPLACE FUNCTION public.direct_quotes_fleet_belongs_to_bidder()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_org_changed boolean := TG_OP = 'INSERT'
    OR NEW.bidder_organization_id IS DISTINCT FROM OLD.bidder_organization_id;
BEGIN
  IF NEW.driver_id IS NOT NULL
     AND (v_org_changed OR NEW.driver_id IS DISTINCT FROM OLD.driver_id)
     AND NOT EXISTS (
       SELECT 1 FROM public.drivers d
       WHERE d.id = NEW.driver_id AND d.organization_id = NEW.bidder_organization_id
     ) THEN
    RAISE EXCEPTION 'invalid_driver: driver must belong to your organization'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.vehicle_id IS NOT NULL
     AND (v_org_changed OR NEW.vehicle_id IS DISTINCT FROM OLD.vehicle_id)
     AND NOT EXISTS (
       SELECT 1 FROM public.vehicles v
       WHERE v.id = NEW.vehicle_id AND v.organization_id = NEW.bidder_organization_id
     ) THEN
    RAISE EXCEPTION 'invalid_vehicle: vehicle must belong to your organization'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.direct_quotes_fleet_belongs_to_bidder() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_direct_quotes_fleet_belongs_to_bidder ON public.direct_quotes;
CREATE TRIGGER trg_direct_quotes_fleet_belongs_to_bidder
  BEFORE INSERT OR UPDATE OF driver_id, vehicle_id, bidder_organization_id
  ON public.direct_quotes
  FOR EACH ROW
  EXECUTE FUNCTION public.direct_quotes_fleet_belongs_to_bidder();

COMMENT ON FUNCTION public.direct_quotes_fleet_belongs_to_bidder() IS
  'direct_quotes.driver_id / vehicle_id must belong to the bidder organization on every write; create_trip_from_direct_quote copies them onto the shipper trip.';
