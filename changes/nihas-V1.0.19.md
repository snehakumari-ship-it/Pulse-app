# nihas V1.0.19 — Global vehicle type catalog

## What
- One global vehicle type list (Open / Container / LCV Open / LCV Container, sizes, passing tons) in `features/vehicles/utils/vehicleTypeCatalog.model.ts`, with a shared picker sheet and field.
- Every vehicle type input uses it: Create Trip, Create Indent, client lanes (mobile + desktop), client agreement rate rows, Garage "New Vehicle" (desktop + mobile), driver My Fleet add vehicle, trip reassign add vehicle, eLR, Create Post (load + vehicle), supplier fleet panel.
- `vehicle_type` saves category + size only (e.g. "Open 20 Feet"); the picked passing ton fills the tons / capacity field instead of the name.
- Tons outside the vehicle's range show a red hint and hide Continue (Create Trip commodity step, Create Indent vehicle step).
- Garage vehicle: picker fills body type, size and capacity; body length and axle fields removed.
- Removed the unused `AddVehicleModal` (nothing opened it); its payload types moved to `addVehiclePayload.model.ts`.
- Truck images map the new names; capacity dial gains 43 t.
- Fixed a Create Post preview warning (empty-string text node inside a View).

## Why
- Vehicle types were free text and different lists on every screen, so values didn't match across trips, lanes, vehicles and filters.

## Areas
- trips (add-trip wizard, reassign, eLR), indents (create-indent), clients (lanes, agreement), finance (party registration / Garage), vehicles, driver, network (create post), suppliers.
- Shared footers: `FullPageWizardFooter`, `CreateTripDesktopShell`, `AddTripModalLayout` gain an optional `hidePrimary`.

## Migrations
- None.

## Tested
- Jest: only the 5 known failing suites; new `vehicleTypeCatalog.model.test.ts` passes. CI gates locally: lint 104/104, cycles 111/111, lib files 178/178, V2 isolation and navigation policy pass; tsc 140 locally = HEAD (no new errors).
- Clicked through on local (preprod DB) and checked rows: Create Trip (trip notes "Container 20 Feet", load_tons 10), Create Indent ("Container 22 Feet", 10000 kg), client lane ("Container 22 Feet", 10 t), Garage vehicle TN05CB9811 ("Open 12 Wheeler", body Open, size 12 Wheeler, capacity 20, no axle), eLR picker on screen.
- Not clicked through: agreement rate rows, driver My Fleet, reassign add vehicle, Create Post submit, eLR generate. Marketplace search filters left data-driven (unchanged).
