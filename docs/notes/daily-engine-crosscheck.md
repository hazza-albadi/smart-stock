# Cross-check against the previous (daily) engine

Method (one-off, reproducible): check out commit `e058100` (last daily-model commit) in a worktree, seed it, advance 8 daily ticks
(closing 4–11 Oct, seed 42) and sum the `SALES/ISSUE` movements of 5–11 Oct per item. Compare with the new
`dailyQuantity()` summed over the same 7 days (same seed and settings).

Result: **22 of 24 items identical**. The two that differ are exactly the ones where the old engine could not issue the full demand:

| item | old daily engine (issued) | hourly engine (planned) | reason |
|---|---:|---:|---|
| frozen shrimp shells | 78 | 564 | stock-out in the old run (only 170 kg on hand; no PO approved) |
| chilled crab shells | 104 | 121 | stock written off at expiry in the old run |

The hourly engine keeps the daily quantity rule unchanged and only spreads each day's quantity over 24 hours, so demand totals are
identical by construction; `npm run audit` re-checks this for every item and day (`hourly_amounts_sum_to_daily_quantity`).
Deliberate differences: stock-outs now start inside the day (hour of the shortage) and the 4 Oct gap day of the data is no longer back-filled.
