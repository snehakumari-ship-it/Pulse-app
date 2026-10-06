# praveen/V1.0.5

## What
- Vendor Document Cost on POD validation shows only the document charge recorded when that trip's advance is processed. A typed amount, including a saved ₹500, stays at ₹0 and is not deducted from Total Vendor Value.
- Processing an advance records that document charge on the trip so a later slab change does not rewrite it.
- POD validation dates and the aging box are shorter. The IBond checkbox sits on the right of the Hard Copy POD heading. Checking it still only selects; Save records it.

## Why
- Document cost is deducted in Advance Processed. The same amount should appear on the trip without anyone typing it, and a manually entered figure must not reduce the vendor total.

## Areas
- Compliance POD validation panel, advance payment posting, hard-copy POD header.

## Migrations
- None.

## Tested
- Jest on the POD charge totals and compliance payment write suites.
- Handoff runs lint, TypeScript, and Jest.
