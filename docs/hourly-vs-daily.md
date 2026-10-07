# Hourly vs daily model (first 7 days, seed 2026)

The hourly model keeps the original daily quantity rule (baseline × seasonality/event factor × seeded noise, stochastic rounding) and only *spreads* each day's quantity over 24 hours, so planned totals are identical by construction (verified: all items equal).
Deliberate differences: (1) issued quantity can be lower than planned when stock runs out inside the day (the daily model could only run out at day end); (2) the day-0 → day-1 gap days of the data are no longer back-filled: the simulation starts at the start date 00:00.

| item | daily model, 7 days | hourly planned, 7 days | hourly issued, 7 days | note |
|---|---:|---:|---:|---|
| SKU-001 | 588 | 588 | 588 |  |
| SKU-002 | 597 | 597 | 203 | stock-out: 394 unmet |
| SKU-003 | 125 | 125 | 104 | stock-out: 21 unmet |
| SKU-004 | 243 | 243 | 243 |  |
| SKU-005 | 23 | 23 | 23 |  |
| SKU-006 | 12 | 12 | 12 |  |
| SKU-007 | 15 | 15 | 15 |  |
| SKU-008 | 11 | 11 | 11 |  |
| SKU-009 | 6 | 6 | 6 |  |
| SKU-010 | 6 | 6 | 6 |  |
| SKU-011 | 230 | 230 | 230 |  |
| SKU-012 | 8 | 8 | 8 |  |
| SKU-013 | 7 | 7 | 7 |  |
| SKU-014 | 41 | 41 | 41 |  |
| SKU-015 | 6 | 6 | 6 |  |
| SKU-016 | 7 | 7 | 7 |  |
| SKU-017 | 45 | 45 | 45 |  |
| SKU-018 | 16 | 16 | 16 |  |
| SKU-019 | 88 | 88 | 88 |  |
| SKU-020 | 82 | 82 | 82 |  |
| SKU-021 | 0 | 0 | 0 |  |
| SKU-022 | 1 | 1 | 1 |  |
| SKU-023 | 12 | 12 | 12 |  |
| SKU-024 | 17 | 17 | 17 |  |
