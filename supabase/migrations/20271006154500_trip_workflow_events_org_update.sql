-- Allow an org member to revise a workflow event they can already insert.
-- POD validation uses this so a confirmed trip's charges can be edited in place
-- (same idempotency key) instead of inserting a second validation row.

DROP POLICY IF EXISTS "trip_workflow_org_update" ON public.trip_workflow_events;

CREATE POLICY "trip_workflow_org_update"
  ON public.trip_workflow_events FOR UPDATE
  USING (
    org_id IN (
      SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    org_id IN (
      SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid()
    )
  );
