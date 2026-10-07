# SmartStock — Live MVP (hourly simulation)

Inventory and warehouse-space assistant for **Qeshour** (chitosan from shrimp, crab and lobster shells).
Next.js (App Router) + TypeScript + Tailwind, SQLite (`better-sqlite3`). Arabic RTL by default, English toggle, light/dark. Runs fully
locally: no cloud, no login, no API key needed.

The clock advances **one simulated hour per tick**. Stock movements, deliveries, expiries and decisions happen at a precise date and hour,
five coordinating agents re-run on a schedule, and every decision you take (approve / reject / edit / manual action) changes what happens next.

## Install and run

```bash
npm install
npm run seed     # builds smartstock.db from smartstock_data/*.csv + config/defaults.json and runs the agents once
npm run dev      # http://localhost:3000
```

| command | what it does |
|---|---|
| `npm test` | unit + integration tests (calc layer, i18n keys, day-0 baseline, ticks, decisions, leases, manual actions) |
| `npm run audit [days] [seeds…]` | number audit: 30 days × 3 seeds on a throw-away DB, ~9 min, fails loudly (writes `docs/audit-report.json`, `docs/hourly-vs-daily.md`) |
| `npm run check [hours]` | prints the acceptance picture (day 0, or after N hours) rendered in English |
| `npm run literals` | repo-wide search for hard-coded item/zone/request/PO ids, budget and rate literals in `app/`, `components/`, `lib/` |
| `npm run baseline` | regenerates `docs/baseline.json` (day-0 state + tsc/build/check results) from a fresh DB — only run on purpose |

Optional: `ANTHROPIC_API_KEY` lets a model polish supplier-message wording when you press **Run analysis** (numbers stay deterministic).

## 2-minute demo script (hourly)

1. Open the page: **Mon 5 Oct 2026 – 00:00**, 4 items at risk, **3,988.500 OMR** free, **1,400 m²** rentable. Speed is *1 hour = 5 s*; auto-pause is on.
2. Press **Play**. Each tick is one hour: movements appear in the feed, stock rows flash. Change the speed (0.5 s … 30 s or custom) while it runs — nothing is lost.
3. Frozen shrimp shells (≈49 h of stock) hit zero on 7 Oct: the simulation **auto-pauses** with a red banner "Stockout – production stopped".
4. Open **Pending decisions** (note the ages, "overdue" after 24 h) and the SKU-002 alert: *what happened · since when · why · what the system proposes · what happens if you ignore it*.
   Edit the quantity of the PO draft, press **Approve**: budget is committed *now*, the PO appears with its **arrival date and hour**.
5. **Reject** another draft (e.g. respirator masks) — it is remembered and not re-proposed every hour; it comes back only after the cooldown or when much worse, with the reason.
6. Press **Next day** / **Run 6 hours** / **Next critical event**. Watch the approved PO arrive at its hour (event feed, stock, space).
7. In **Warehouse space** approve REQ-01 (lease reserved from its start date) and reject REQ-03. Rentable space drops only when the lease starts; the other proposals are recalculated.
8. Open **Decision impact log**: every decision with its effects ("You approved PO … → arrived 10 Oct 14:00 … but SKU-002 had already stocked out … production stopped for 55 h").
9. Click any **ⓘ** next to a number to see its formula, inputs and sources. Press **Data health** to run the invariant checks on the live database.
10. **Reset** restores the start state (your settings are kept).

## Agent schedule (configurable in Settings)

| agent | runs |
|---|---|
| alerts (cheap rules: stock-out, expiry, delayed PO, safety, anomaly, overdue decisions, lease risk) | every hour |
| forecast | daily 06:00 |
| replenishment, space optimisation | daily 08:00 and on demand (**Run analysis**) |
| space matching | after the space agent, after every decision, and when a space request is added |

Movement booking, stock-out and expiry checks run in the engine every hour. Each tick is one database transaction. Stock-dependent figures (cover, usable stock,
stock-out projection, rentable space) are always computed live from the tables; the forecast agent only refreshes demand parameters.

## Time and demand

* The clock is an integer `tick` (hours since the start) in `sim_state`; date, hour and day are derived (no JS `Date`, no timezone bugs; Oman UTC+4 has no DST).
* Daily demand per item = baseline × seasonality/event factor × seeded noise (unchanged rule); it is then spread over 24 hours by `demand.hourly_profile`
  (whole parts exact, leftover units placed by seeded weighted draws) so the 24 amounts **sum exactly to the daily quantity**. Plans are stored in `demand_log`.
* POs arrive at the hour given by the delivery window (`delivery.window_*`, deterministic per PO). A delayed PO arrives only at its new date and hour.
  Receiving respects zone capacity (overflow into the overflow zone, otherwise partial receipt and retry).
* Lots are usable until the end of `expiry.last_usable_hour` on their expiry date, then written off.

### Clock control (server owns it)

`POST /api/sim {action:"tick", expected, auto}`: the browser sends the tick it expects. A stale or duplicate request is **ignored**; auto ticks are also refused while paused or
faster than the interval, so two tabs or a reload can never double-tick. The browser awaits each response before scheduling the next tick (no overlap). A reload resumes **paused**.
*Run N hours / Next day / Next critical event* are server-side loops (capped by `sim.max_advance_hours`). **Auto-pause on critical** stops at the first critical event.

## Decisions change the course of the process

* **Approve PO**: committed to the budget immediately, placed with the item's real lead time, arrives at its date/hour (stock, movements, space change then). Quantity can be edited first.
* **Reject / ignore**: nothing is ordered, the shortage can really worsen (stock-outs follow from the data). Undecided drafts show their age and escalate to an *overdue* alert (Critical when the stock-out is near).
  A rejected draft is remembered with its time; it returns only after `repl.reject_cooldown_hours` or when cover fell below `repl.reopen_cover_drop` × the cover at rejection, and it says why.
* **Space**: approving creates leases from `needed_from` for the requested months; rentable space drops from the start date, ends return the area, matching of other requests considers overlapping leases,
  and an alert fires when stock growth endangers a commitment. You can approve, accept a split, modify the area, or reject.
* **Manual**: emergency / manual PO (shorter lead time, price premium), manual stock movement (receipt / issue / adjustment with a mandatory reason), new space request. All audited in `decisions`.
* **Decision impact log**: effects are computed from the event chain, movements and `demand_log`; nothing is written by hand.

## Number audit

* All formulas live in the pure module `lib/calc` (unit-tested). Components only format what they receive; "how is this calculated" popovers show formula, inputs (units, sources) and result.
* Numerals follow the language (Arabic-Indic digits in Arabic), OMR with 3 decimals, units everywhere, never NaN / Infinity / `-0`.
* `npm run audit` checks, at **every hour** of a 30-day run for 3 seeds (with scripted decisions): stock balance per lot and per item, no negative stock, budget committed/free and PO values vs the CSV and decisions,
  zones (used = fixed + stock, rentable, no zone above capacity, sums), leases vs rentable (or an explicit alert), no duplicate pending recommendations, every decision timestamped with a consequence or an explicit "no effect",
  clock consistency, UI numbers = independent SQL recomputation; **daily**: 24 hourly amounts = daily quantity for every item/day and issued = movements; plus day-0 = `docs/baseline.json`, same seed → same result, different seed → different result.
* The **Data health** pill in the top bar shows the last audit; the button runs the same checks on the live database.
* Hourly vs daily: `docs/hourly-vs-daily.md` (generated) and `docs/daily-engine-crosscheck.md` (verified against the previous engine, 22/24 items identical, the other two explained by stock-out/expiry).

## Settings

Every threshold, rate, schedule and profile lives in the `settings` table (seeded from `config/defaults.json`, shown and editable in the **Settings** screen). Business data
(items, zones, suppliers, requests, budget) comes only from the CSV tables; UI text and message templates come from `locales/en.json` and `locales/ar.json`.

| key | default | unit | description |
|---|---|---|---|
| `sim.start_date` | `"2026-10-05"` | date | Simulated 'today' at tick 0 (day 0, 00:00). The data dictionary states today = 2026-10-05. |
| `sim.seed` | `42` | int | Seed of the deterministic random numbers (noise, hourly spreading, delivery hours). |
| `sim.interval_ms` | `5000` | ms | Real milliseconds per simulated hour while running (default 5 s). |
| `sim.min_interval_ms` | `200` | ms | Smallest allowed interval between ticks. |
| `sim.interval_presets_ms` | `[500, 1000, 2000, 5000, 10000, 30000]` | ms | Speed presets shown in the top bar. |
| `sim.auto_pause_critical` | `true` | bool | Pause the simulation when a critical event appears. |
| `sim.max_advance_hours` | `720` | h | Upper limit for 'run N hours' / 'jump' actions. |
| `sim.utc_offset_hours` | `4` | h | Display offset of the warehouse (Oman, UTC+4, no DST). The clock itself is an integer tick. |
| `demand.noise` | `0.2` | ratio | Daily demand noise around the baseline (+/-). |
| `demand.baseline_days` | `28` | days | History window (days before the last data day) used as the baseline usage. |
| `demand.hourly_profile` | `[0.2, 0.2, 0.2, 0.2, 0.2, 0.4, 1, 3, 6, 8, 9, 9, 6, 7, 9,…` | weight | Relative demand per hour of day 0-23 (heavier in working hours, light at night). Normalised automatically. |
| `demand.season` | `{"items": ["SKU-001", "SKU-006", "SKU-017"], "peak": 1.8,…` | json | Seasonal items and their peak multiplier: ramps up from ramp_start over ramp_days, holds until season_end, then eases off over decay_days. |
| `demand.events` | `[{"item": "SKU-019", "factor": 3, "start": "2026-10-05", …` | json | One-off demand events (spike factor, days held at full factor, days to ease off). |
| `demand.event_baseline` | `{"exclude_recent_days": 21, "window_days": 84}` | json | Baseline window for items with a demand event (the weeks before the spike). |
| `forecast.recent_weeks` | `3` | weeks | Weeks compared in the anomaly test. |
| `forecast.prior_weeks` | `12` | weeks | Reference weeks before the recent weeks. |
| `forecast.anomaly_ratio` | `2` | x | Anomaly when recent weekly usage exceeds this multiple of the prior average. |
| `forecast.anomaly_min_units` | `5` | units/wk | Ignore anomalies on very small volumes. |
| `forecast.horizon_weeks` | `4` | weeks | Forecast horizon. |
| `forecast.projection_days` | `90` | days | How far the stock-out projection looks. |
| `status.critical_cover_weeks` | `1` | weeks | Critical when cover is below this and no PO arrives soon. |
| `status.po_soon_days` | `3` | days | A PO arriving within this many days softens 'Critical' to 'Low'. |
| `status.low_cover_weeks` | `2` | weeks | Low when cover is below this (or stock below safety stock). |
| `thresholds.overstock_weeks` | `20` | weeks | Overstock status / alert above this cover. |
| `thresholds.expiry_days` | `14` | days | Expiry alert / status window. |
| `thresholds.expiry_high_days` | `7` | days | Expiry alert becomes High inside this window. |
| `thresholds.expiry_critical_hours` | `24` | h | Expiry alert becomes Critical inside this many hours (when stock would be written off). |
| `alerts.stockout_window_extra_days` | `7` | days | Stock-out alert when projected within lead time + this many days. |
| `alerts.stockout_imminent_days` | `7` | days | Stock-out within this many days counts as imminent. |
| `alerts.safety_category` | `"Safety gear"` | text | Item category treated as safety items. |
| `alerts.alternatives` | `{"SKU-002": "SKU-001", "SKU-003": "SKU-004"}` | json | Temporary substitute item per item, used in supplier messages. |
| `repl.review_days` | `14` | days | Review cycle added to the lead time in the reorder point. |
| `repl.max_cover_weeks` | `12` | weeks | Never reorder above this cover. |
| `repl.target_cover_days` | `56` | days | Order quantity covers lead time + this many days. |
| `repl.shelf_life_cover_ratio` | `0.5` | ratio | For perishables the cover is limited to this share of the shelf life. |
| `repl.round_to` | `{"kg": 10}` | json | Round order quantities up to a multiple per unit. |
| `repl.priority_categories` | `["Safety gear", "Chemicals"]` | json | Categories ranked first inside a criticality class (after stock-out risk). |
| `repl.reject_cooldown_hours` | `168` | h | A rejected PO draft is not proposed again before this many hours... |
| `repl.reopen_cover_drop` | `0.5` | ratio | ...unless cover has fallen below this share of the cover at rejection (materially worse). |
| `po.emergency_lead_factor` | `0.5` | ratio | Emergency POs use this share of the normal lead time (minimum 1 day). |
| `po.emergency_premium` | `0.1` | ratio | Price premium on emergency purchase orders. |
| `rec.escalate_hours` | `24` | h | A recommendation left pending this long raises an 'overdue' alert. |
| `rec.escalate_critical_hours` | `12` | h | Overdue becomes Critical when the stock-out is closer than this. |
| `space.overflow_zone` | `"Z5"` | zone | Zone that receives goods which do not fit in their home zone. |
| `space.rentable_request_type` | `"general"` | text | Storage type of requests that can be served from rentable zones. |
| `space.min_partial_share` | `0.25` | ratio | Below this share of the request no partial offer is made. |
| `delivery.window_start_hour` | `8` | h | Deliveries arrive from this hour... |
| `delivery.window_end_hour` | `16` | h | ...until this hour (exclusive). Each PO gets a deterministic hour inside the window. |
| `delivery.retry_hours` | `24` | h | Remainder of a partially received PO is retried after this many hours. |
| `expiry.last_usable_hour` | `23` | h | Lots are usable until the end of this hour on their expiry date; the rest is written off right after. |
| `schedule.alerts_hours` | `[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16…` | hours | Hours at which the alert agent runs (cheap rules). |
| `schedule.forecast_hours` | `[6]` | hours | Hours at which the forecast agent runs. |
| `schedule.replenishment_hours` | `[8]` | hours | Hours at which the replenishment agent runs. |
| `schedule.space_hours` | `[8]` | hours | Hours at which the space optimisation agent runs (also after stock-heavy events). |
| `log.keep_agent_runs` | `400` | rows | Older agent_runs rows are pruned. |
| `ui.feed_page_size` | `60` | rows | Rows per page in the live feed and logs ('load more'). |

## Assumptions

1. The repo already had a git history; the working tree was clean, so no "wip" snapshot commit was needed. The branch `feature/hourly-sim` was created from `main`; nothing is merged or pushed.
2. The simulation starts at **5 Oct 2026 00:00** (setting `sim.start_date`, from the data dictionary). The 4 Oct gap day of the data is not back-filled; forecast windows use the last complete day (`data_end`).
3. Day-0 numbers are unchanged: the forecast, reorder-point, usable-stock and stock-out maths keep day resolution at hour 0 and are made hour-aware afterwards (the rest of today counts only its remaining hours).
4. The agent schedule hours are settings; "stock-out within N days" texts are given in hours.
5. A supplier-message decision has **no simulated effect** (replies are not simulated) — this is stated explicitly in the impact log.
6. Seasonality, demand events, alternatives, priority categories etc. are configuration (`config/defaults.json`), not code; item ids appear there because they are business configuration of the demo company.
7. A lease starts at `max(needed_from, decision day)` and lasts the requested months (calendar months); area is held from the start date, not at approval.
8. Emergency POs use `po.emergency_lead_factor` × lead time (min. 1 day) and a `po.emergency_premium`; exceeding the budget is allowed but flagged ("over budget").
9. Receiving is limited by physical room (capacity − fixed − stock − active leases); the reserved buffer protects *rentable* space only. The data's `space_m2_per_unit` makes some zones fill quickly, so large POs arrive partially.
10. Unit quantities are integers; manual adjustments are signed integers.
11. Technical constants (not business numbers) remain in code: epsilon tolerances, the 0.8 factor of the "too soon" tick gate, the 400-day cap in the usable-stock horizon.
