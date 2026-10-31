# sneha/V1.0.13

## What
- Shared driver UI tokens (`constants/DriverUi.ts`) and `DriverIconWell` for consistent radius, row height, icon wells, and soft elevation.
- Softer idle icon motion (`DriverMotionIcon`) so rows stay professional.
- Driver profile main: aligned hero / action sheet / KYC+language tiles / stats / sign-out; staggered `FadeInDown`; professional icon wells.
- Fleet vehicle: identity + live telemetry empty state (no dash grid) + specs/status + map-pin motion with caption.
- DCO status: status-first when already requested/approved; CTA next; benefits; truck drive motion.
- Edit Profile (driver layout): same card radius/row tokens; contact rows use `DriverIconWell`.

## Why
Driver profile surfaces felt uneven (mixed radii, loud icon bounce, empty `—` telemetry, DCO pitch above status). Align to one professional system.

## Areas
- `constants/DriverUi.ts`
- `components/driver/DriverIconWell.tsx`
- `components/driver/DriverMotionIcon.tsx`
- `features/drivers/screens/DriverProfileScreen.tsx`
- `features/driver/components/DcoStatusScreen.tsx`
- `features/auth/components/EditProfileModal.tsx`
- Related motion: `MapPinSearchMotion`, `TruckDriveMotion`

## Migrations
- none

## Tested
- Typecheck: no errors in touched driver UI files (local Node heap-limited run OK with 8GB).
- `DriverMultiOrderJobCard.acceptance` 21/21 after restoring route stats tiles (`Exceptions: N` a11y).
- Navigation policy 64 pass; lint/cycles/lib-files within baseline; `git diff --check` clean.
- UI not clicked through on device/simulator — hard-reload driver profile, fleet vehicle, DCO status, and Edit Profile to verify alignment and motion.
