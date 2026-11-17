# sneha/V1.0.14

## What
- Remove duplicate DCO status row on driver profile; keep the single status-aware entry that opens DCO status.
- Hide Market (Find Work) from the driver dock for regular / non-approved drivers. Show Market only after admin DCO approval; route stays in the app and redirects home if opened early.
- History: Active / Fleet / Offline (and Marketplace) toggles no longer get stuck after opening History with `?type=` (e.g. Earnings → Offline trips). Deep-link applies once; tab list identity is stable.
- Driver Log expense UI redesign (visual only): green header, compact receipt|amount card, small icon pills, wallet float animation under Attach bill — no field labels or save-path changes.
- Tag party sheet ("Who do you bill?") restyled to match the driver app (visual only): green fleet-trip button under a "Fleet work" label, outlined green Tag pills, dashed "Add new party", outlined Cancel button; same radii and labels as the Tag-party confirm dialogs.
- Notifications empty state: yellow ringing bell animation when there are no pending trips; animation unmounts when notification rows appear; left-aligned empty card.

## Why
Profile showed two identical “DCO status” cards (same route). One leftover copy from an older layout.
Regular drivers were landing on a Market dead-end (“About DCO”) instead of a clean fleet experience; Market should appear once they are an approved DCO.

## Areas
- `features/drivers/screens/DriverProfileScreen.tsx`
- `components/driver/DriverTabBar.tsx`
- `features/driver/components/AvailableLoadsScreen.tsx`
- `features/drivers/domain/driverOperatingMode.ts`
- `features/drivers/screens/DriverLevelProgressionScreen.tsx`
- `features/drivers/screens/DriverTripHistoryScreen.tsx`
- `features/trips/operations/shared/DriverExpenseEntryLayout.tsx`
- `features/trips/operations/shared/DriverExpenseChipSelect.tsx`
- `features/trips/operations/shared/driverOpsEntry.styles.ts`
- `features/trips/operations/shared/OpsEntryBodyPhotoSlot.tsx`
- `features/trips/operations/other/OtherExpenseEntryScreen.tsx`
- `features/drivers/components/DriverCollectFromSheet.tsx`
- `features/drivers/components/EmptyNotificationBell.tsx`
- `features/drivers/screens/DriverNotificationsScreen.tsx`

## Migrations
- none

## Tested
- not clicked through — hard-reload driver profile and confirm one DCO row only
- as fleet driver: dock should be Dashboard / History / Earnings (no Market); after DCO approve (+ refresh): Market appears
- History deep-link: Earnings → Offline trips → switch Active / Fleet / Offline; chips should stick (not snap back)
- `npx jest features/drivers/domain/__tests__/driverOperatingMode.test.ts`
- Tag party sheet: not clicked through — lint and typecheck clean for the file
