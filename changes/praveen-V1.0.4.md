# praveen/V1.0.4

## What
- POD charge validation on Compliance: aging from the delivery date to the dispatch date (or today), a 15-day display offset, penalty slabs, vendor document cost, and Vendor POD Delay Submission.
- Once the POD is received, aging caps at ₹1,000 from the 11th delay day. An open POD stays at ₹1,500.
- IBond on Awaiting POD only selects until Save. Save stores IBond and moves the trip to POD Received. IBond trips deduct a flat ₹1,500 in Vendor POD Delay Submission, show ₹1,500 on the aging pill, and list on the IBond tab. No second charge line.
- Awaiting POD uses a compact hard-copy panel with the uploaded POD image beside it.
- Charges stay read-only until Edit. Save on POD Received moves the trip to Balance Pending. Save on Balance Pending updates the charges and leaves the trip there.

## Why
- Debit control needs aging, document cost, and a one-time IBond deduction, then a locked charge form that advances the trip when the charges are saved.

## Areas
- Compliance queue, POD validation panel, hard-copy POD log, debit-control charge totals.

## Migrations
- `supabase/migrations/20271001093000_hard_copy_pod_optional_dispatch_date.sql` — dispatch date optional on the courier hard-copy log.
- `supabase/migrations/20271006154500_trip_workflow_events_org_update.sql` — org members can update a workflow event so a saved validation can be edited in place.
- Nihas applies both. This branch does not run `db push`.
- Merge note (Nihas): the UPDATE policy is limited to `event_type = 'pod.debit_control_validated'` so other workflow events stay append-only.

## Tested
- Jest on the POD aging, charge total, hard-copy POD, and compliance pipeline suites while building.
- Handoff runs lint, TypeScript, and Jest.
