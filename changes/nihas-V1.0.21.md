# nihas V1.0.21 — Fix Log incoming PODs crash (receivedAt)

## What
- `executeLogIncomingPods` now reads `receivedAt` from its payload (`str(payload.receivedAt) || new Date().toISOString()`, same fallback as `markSelectedTripsHardCopyPodReceived`).
- Two tests: `received_at` from the payload reaches the `POD_LOGGED` `log_activity` call; a missing `receivedAt` falls back to the current time.

## Why
- Since 7c327c48 the function used `receivedAt` without declaring it (TS2304). Every "Log incoming PODs" with trips selected marked the PODs received, then threw `ReferenceError: receivedAt is not defined` before the activity log — the user saw an error and no `POD_LOGGED` entry was written.

## Areas
- log-pods service only. No UI, flow, ordering or CI changes.

## Migrations
- None.

## Tested
- `logPods.service.concurrency`: before 3 failed / 6 passed (all ReferenceError); after 11/11 pass (incl. 2 new).
- tsc 140 → 139 locally (the logPods TS2304 is gone, nothing new). Lint, cycles, lib/ count gates pass.
- Full Jest: 4 failing suites (the remaining known ones), down from 5. Not clicked through in the UI.
