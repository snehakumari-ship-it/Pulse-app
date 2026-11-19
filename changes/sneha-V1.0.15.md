# sneha/V1.0.15

## What
- Driver Log expense UI redesign (visual only): green header, compact receipt|amount card, small icon pills, wallet float animation under Attach bill — no field labels or save-path changes.
- Odometer capture UI: viewfinder, step keypad, and notes entry aligned with the driver expense screens.
- Trips list card footer (Assigned by / Yield): deep forest green background (`Theme.driverForest`) with white text, mint yield amount and soft white dividers. Untagged trips keep the yellow warning strip.
- Expense entry (fuel / toll / other): split into separate cards — Category + Most frequent (plus Fuel type / Entry type) in one card, Payment method in its own card, Status (optional) in its own card. Visual only; same fields and save path.
- Payment method and Status chips: small leading icons (cash, FASTag, card, credit, other; paid, pending, part-paid, waived), each icon in its own colour (`Theme.chipIcon*`), dark green when selected. Slightly tighter chip spacing and 12pt labels so "FASTag" fits.
- Driver app font aligned with the core Pulse app: `DriverTypography` now uses the system font (SF Pro / Roboto / system UI) with weight only, instead of Plus Jakarta Sans. Earnings panel's direct font names switched to the same weight tokens. Driver layout no longer downloads Plus Jakarta or waits on it at startup. Sizes and layouts unchanged.
- Expense entry header: solid dark green banner replaced with a soft mint-to-white gradient (`expo-linear-gradient`), dark green Back / kicker / title, slate hint, white bordered route pill with a green navigation badge, dark status bar icons. Wallet art, Back handler, route text and safe-area padding unchanged.
- Expense entry header: "Back" text and the "Other / Fuel / Toll expense" kicker removed. Back is now a 38pt round white button (mint border) inline with a larger title; tap target kept with hitSlop, and the screen-reader label still names the expense type.
- Expense header art: wallet PNG replaced with an in-house SVG illustration (`ExpenseReceiptIcon`: receipt, rising blue arrow, ₹ coin). Layered motion — receipt floats, arrow lifts, coin pulses, soft mint ground shadow; static when reduce-motion is on. No stock asset or watermark used.
- Expense header layout: illustration moved out of the absolute top-right float into its own 72pt column, vertically centred beside the back/title row and route pill; nothing clipped at the top. Hint stays full width below.
- Trips list card route: "MUMBAI → CHENNAI / MAHARASHTRA · TAMIL NADU" line replaced inline (no inner card/border) with the split route layout (`TripRouteSplit`): origin city + state code left, green truck over a dotted arrow centre, destination right-aligned; no progress track and no state-name pills. Card tightened (smaller route text, less top/footer spacing). Distance text removed from the card to match the reference. State codes come from the existing location text (`resolveIndianState`, initials fallback) — no data or API change.
- Driver Collect payment: restyled to the mint/forest look of Log expense. Mint gradient header (round back button, centred title + kicker, receipt illustration), three white bordered cards, slate % tiles with sage selection (new opt-in `mint` variant on `LedgerSettlementPctDock`; other screens unchanged), forest-selected payment-mode tiles with the same brand logos, 44pt inputs with a forest focus border, and a sticky footer with Cancel (existing back handler) + Collect pill. Labels, amounts, % maths, modes and submit flow unchanged.
- Collect payment header art: receipt illustration swapped (this screen only) for an in-house SVG (`CollectCoinsIcon`): open palm with a blue cuff and three ₹ coins. Side coins bob out of phase, centre coin settles towards the palm as the hand lifts; static when reduce-motion is on. Drawn from scratch — no stock asset or watermark.

## Why
Expense and odometer entry should look like the rest of the driver trip flow. Amounts, categories, and save paths stay the same.

## Areas
- `features/trips/operations/shared/DriverExpenseEntryLayout.tsx`
- `features/trips/operations/shared/DriverExpenseChipSelect.tsx`
- `features/trips/operations/shared/DriverExpensePaymentFields.tsx`
- `features/trips/operations/shared/WalletExpenseIcon.tsx`
- `features/trips/operations/shared/ExpenseReceiptIcon.tsx`
- `features/trips/operations/fuel/FuelEntryScreen.tsx`
- `features/trips/operations/toll/TollEntryScreen.tsx`
- `features/trips/operations/other/OtherExpenseEntryScreen.tsx`
- `features/driver/components/DriverTripExpenseLogSection.tsx`
- `features/trips/verification/OdometerEntryScreen.tsx`
- `features/trips/verification/OdometerStartEndScreen.tsx`
- `features/trips/verification/components/OdometerEntryShell.tsx`
- `features/trips/verification/components/OdometerKeypadFlow.tsx`
- `constants/Theme.ts`
- `constants/DriverTypography.ts`
- `app/(driver)/_layout.tsx`
- `features/drivers/components/DriverWalletEarningsPanel.tsx`
- `components/driver/TripListAssignerRow.tsx`
- `features/drivers/screens/DriverTripHistoryScreen.tsx`
- `features/drivers/components/TripRouteSplit.tsx`
- `features/drivers/utils/indianStateCode.util.ts` (+ test)
- `components/mobile-input/`
- `features/drivers/screens/DriverCapturePaymentScreen.tsx`
- `features/drivers/components/CollectCoinsIcon.tsx`
- `components/ledger/LedgerSettlementPctDock.tsx` (opt-in `mint` variant only)

## Migrations
- none

## Tested
- not clicked through
- `npx jest features/drivers/utils/__tests__/indianStateCode.util.test.ts`
- `npx jest features/drivers components/driver` (28 suites, 190 tests pass)
- `npx jest features/drivers components/ledger` (28 suites, 190 tests pass); eslint + tsc clean on the Collect payment files
