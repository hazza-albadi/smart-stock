# Budget and offers fix (branch `fix/budget-and-offers`)

## 1. Diagnosis: why purchasing went silent and stock ran to zero

Reproduced first (a manager who approves every suggestion every morning, seed 42, `scratch` script, before any change):

| day | free budget | items at zero | open purchase suggestions |
|---|---:|---|---:|
| 10 | 47 OMR | none | 0 |
| 30 | 32 OMR | 3 | 0 |
| 50 | 2 OMR | 13 | 0 |
| 70 | 2 OMR | 16 | 0 |

Root causes (four, all in the code, none in the data):

1. **The budget period simply ends and nothing follows.** `purchasing_budget` holds ONE row (6 Oct to 2 Nov 2026, 18,000 OMR). Nothing ever created the next period, so after 2 Nov the same, already exhausted budget applied for ever.
2. **Committed spend was never released or reset.** `budgetInfo()` summed *every* purchase order ever placed (open and received) and subtracted it from that one total. A received order kept counting for ever.
3. **Deferred lines produced nothing.** In `replenishmentAgent`, when the free budget did not cover a line, the status became `DEFERRED` and the loop did `continue` *before* `upsertRec`: the line was written to the plan table only. No suggestion, no card, no alert. With zero free budget every line fell into this branch, so the screen went silent. (Deferred lines were not "re-proposed": they were never proposed.)
4. **A second, independent cause: the demand forecast forgot items that ran out.** The forecast used *issued* stock movements. Once an item reached zero nothing was issued, its usage fell to 0, it was classed as "too much stock" (cover 999) and was never ordered again, even with money. (Found by the new invariant "short stock is always explained"; fixed by adding the unmet demand of `demand_log` to the usage.)

Also found while testing the fix: an order approved days after it was suggested could exceed the zone room (several drafts approved together, drafts for unfunded lines did not reserve room). Fixed: unfunded suggestions reserve room, and an approval is capped to the room the zones have for it.

## 2. What changed

**Budget cycles** (`lib/budget.ts`, table `purchasing_budget` now one row per period, new table `budget_topups`)
* A new period is created automatically when one ends (`budget.period_days` = 28, amount `budget.renewal_amount`, 0 = same as the first period).
* `budget.rollover_pct` (default 0 = none) moves unspent money on; `budget.carry_commitments` (default on) keeps counting orders that were placed earlier and are not received yet.
* Committed spend is per period: orders placed in the period (data orders belong to the first one) plus carried orders. The simulation starts one day before the first period of the data; that day belongs to the first period.
* The KPI and the Purchase plan show the current period, days left, the renewal date and amount.

**Never go silent** (`replenishmentAgent`)
* Every needed order is a suggestion with a funding state: *Funded*, *Partly funded* (staged), *Emergency budget request* (class A item at risk, runs out within its delivery time + `budget.emergency_horizon_days`) or *Deferred to next budget* (with the renewal date).
* Emergency request card: amount needed, why, what happens if refused (stock-out date and hours from the forecast), buttons *Approve emergency spend*, *Reject*, *Reduce to N units* (fits the emergency limit), *Order only N now* (fits the free money), alternative item hint (`alerts.alternatives`). A deferred card offers *Wait for the next budget* (postpones until the renewal), a smaller order now, or reject.
* Approved emergency spend is the part of the order above the free budget. It is limited per period by `budget.emergency_limit_pct` (default 15 %); beyond that the approval is refused with the largest quantity that fits and the renewal date. It is stored in `budget_topups`, shown separately in the KPI, the Purchase plan and the impact log, undone with the order's Undo.
* Priorities are unchanged (A first, never reorder overstock, room and lease rules).

**Alerts**: `BUDGET_LOW` (free budget below `budget.low_pct`), `UNFUNDED_CRITICAL` (critical item that cannot be funded, with date and hours to stock-out), `NO_ROOM` (an item that needs an order but whose zones are full).

**Stock at zero is never unexplained.** New audit invariant `short_stock_always_explained`: an item whose stock lasts less than its delivery time has an open suggestion (any funding state), an incoming order, a recent decision (rejection cooldown) or a visible no-room reason.

## 3. Results

See `README.md` (test and audit results) and `docs/budget-offers/` for screenshots. Browser run: 65 simulated days at 0.5 s per hour with a scripted manager that approves everything every few seconds: the budget renewed on 3 Nov and 1 Dec, emergency spend stayed at or under the 15 % limit in every period, committed spend never exceeded budget + emergency spend, and every item that sat at zero had an open suggestion, an incoming order or a no-room alert. Layout: CLS 0.0000 in both sections, no section moved or changed height in steady state.

Note on realism: with the default 18,000 OMR per 4 weeks, the data's consumption needs more than the budget. A manager who approves everything spends the new budget within a day and items still run short for a while. That is now visible (emergency requests, deferred cards, alerts) instead of silent.
