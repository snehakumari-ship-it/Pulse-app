-- FTL extra stops between pickup and drop, on an indent or a trip.
-- Each stop carries what the client pays extra and what the supplier is paid
-- extra. The parent's client_price / supplier_target / supplier_rate already
-- include these amounts; the rows are the breakdown.

CREATE TABLE IF NOT EXISTS public.route_extra_stops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  indent_id uuid REFERENCES public.indents(id) ON DELETE CASCADE,
  trip_id uuid REFERENCES public.trips(id) ON DELETE CASCADE,
  sequence integer NOT NULL CHECK (sequence >= 1),
  stop_type text NOT NULL DEFAULT 'drop' CHECK (stop_type IN ('pickup', 'drop')),
  location text NOT NULL CHECK (length(btrim(location)) > 0),
  latitude double precision,
  longitude double precision,
  client_charge numeric(12, 2) NOT NULL DEFAULT 0 CHECK (client_charge >= 0),
  supplier_charge numeric(12, 2) NOT NULL DEFAULT 0 CHECK (supplier_charge >= 0),
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT route_extra_stops_one_parent CHECK (
    (indent_id IS NOT NULL AND trip_id IS NULL)
    OR (indent_id IS NULL AND trip_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS route_extra_stops_indent_seq_uidx
  ON public.route_extra_stops (indent_id, sequence) WHERE indent_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS route_extra_stops_trip_seq_uidx
  ON public.route_extra_stops (trip_id, sequence) WHERE trip_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS route_extra_stops_organization_idx
  ON public.route_extra_stops (organization_id);

ALTER TABLE public.route_extra_stops ENABLE ROW LEVEL SECURITY;

-- Anyone who can see the parent indent or trip can see its stops.
DROP POLICY IF EXISTS route_extra_stops_select ON public.route_extra_stops;
CREATE POLICY route_extra_stops_select ON public.route_extra_stops
  FOR SELECT TO authenticated
  USING (
    public.is_org_staff(organization_id)
    OR (indent_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.indents i WHERE i.id = route_extra_stops.indent_id
    ))
    OR (trip_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.trips t WHERE t.id = route_extra_stops.trip_id
    ))
  );

-- Only staff of the owning org write, and only onto that org's own parent.
DROP POLICY IF EXISTS route_extra_stops_insert ON public.route_extra_stops;
CREATE POLICY route_extra_stops_insert ON public.route_extra_stops
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_org_staff(organization_id)
    AND (
      (indent_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.indents i
        WHERE i.id = route_extra_stops.indent_id
          AND i.organization_id = route_extra_stops.organization_id
      ))
      OR (trip_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.trips t
        WHERE t.id = route_extra_stops.trip_id
          AND t.organization_id = route_extra_stops.organization_id
      ))
    )
  );

DROP POLICY IF EXISTS route_extra_stops_delete ON public.route_extra_stops;
CREATE POLICY route_extra_stops_delete ON public.route_extra_stops
  FOR DELETE TO authenticated
  USING (public.is_org_staff(organization_id));

GRANT SELECT, INSERT, DELETE ON public.route_extra_stops TO authenticated;

COMMENT ON TABLE public.route_extra_stops IS
  'FTL stops between pickup and drop on an indent or trip, with the extra client charge and supplier charge per stop. Parent freight totals include these charges.';
