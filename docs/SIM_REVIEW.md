# Simulation review (branch `feature/sim-review`)

Scope: the workspace at `/simulation`, its hourly engine (`lib/sim.ts`), the five agents and the coordinator (`lib/agents/*`), the data layer (`lib/db.ts`, `lib/seed.ts`, `lib/ensure.ts`), the API (`app/api/*`), the UI (`components/*`), the settings (`config/defaults.json`), scripts and tests. The public website (`/`, `/spaces`, `/login`) and the demo gate were only checked for real bugs, not redesigned.

How the review was done:

1. Read every file above and the docs (`README.md`, `req.txt`, `docs/ARCHITECTURE.md`, `scripts/audit.ts`, `scripts/check.ts`, `tests/*`).
2. Baseline on `main` (commit `5e649ea`): `npm test` 114/114 passed (13.5 min, three test files run in parallel at about 500 MB each).
3. A throw-away probe script reproduced each suspected bug on a temporary database (never the live one), including a 400-day run with a manager who approves every order.
4. The app was driven in the browser (desktop and phone width), with one dev server at a time.

Severity: **critical** = the simulation stops working or shows wrong business numbers; **major** = a flow behaves wrongly or a user is misled, with a workaround; **minor** = cosmetic, docs or edge cases.

## Findings

| id | severity | title | where | status |
|---|---|---|---|---|
| C1 | critical | a setting of the wrong type stops every tick | `lib/settings.ts` | fixed (`c17230e`) |
| M1 | major | an offer can be created already expired | `lib/space/market.ts` (`generateOffers`) | fixed (`a162211`); changes the audit fingerprints, see below |
| M2 | major | refusals in raw English; server faults answered as 400 | `lib/api.ts`, `lib/decisions.ts`, `app/api/*` | fixed (`95b7f7e`) |
| M3 | major | postpone / quantity edit / company request do not re-run the agents | `lib/decisions.ts` | fixed (`25ad73c`) |
| M4 | major | English refusal of an offer shows "[object Object]" | `scripts/locales_space.py` (`sp.err.cannot_accept`) | fixed (`8df010f`) |
| M5 | major | conflict card of a partly leased listing offers "Shrink to 0 m²" | `components/space/SpaceQueue.tsx`, `lib/space/snapshot.ts` | fixed (`bccf74f`) |
| M6 | major | a failed tick freezes the clock while the screen says "running" | `components/Dashboard.tsx` (clock loop) | fixed (`270f93e`) |
| P1 | major | the hourly Alerts run and every snapshot grow with lots × days (usable stock) | `lib/calc/inventory.ts` (`usableQty`) | fixed (`220de8e`); results bit-identical |
| P2 | major | recent movements and movement numbers scan every movement (grows each hour) | `lib/snapshot.ts`, `lib/stock.ts`, `app/api/movements` | fixed (`309b45b`) |
| m1 | minor | the "zone over capacity" alert always fails its own check | `lib/agents/alerts.ts` | fixed (`2e4ab1d`) |
| m2 | minor | README settings table out of date | `README.md` | fixed (`0a7ac3d`); now generated |
| m3 | minor | "no typed text" test skips component sub-folders | `tests/ui.test.ts` | fixed (`62e5628`) |
| m4 | minor | "cannot order: no room" is Critical right after the order was approved | `lib/agents/alerts.ts` (NO_ROOM) | fixed (`1e3f0a2`) |
| m5 | minor | Arabic "لمدة ٦ شهر" (wrong number–noun agreement) | `scripts/locales_space.py`, `lib/render.ts` | fixed (`b38ba98`) |
| m6 | minor | a corrupt `smartstock.db` makes every request fail; `npm run seed` cannot recover | `lib/db.ts` | fixed (`81348f7`) |

### C1 — a settings value of the wrong type stops every tick (critical)

* **Where:** `lib/settings.ts:26` (`setSetting`), used by `POST /api/settings` and the Settings table (`components/SettingsPanel.tsx:22`).
* **Reproduce:** open *More → Settings*, set `schedule.forecast_hours` to `6` (instead of `[6]`) and press Enter. Press *+1 hour*. (Probe: `setSetting("schedule.forecast_hours", 6); tick()`.)
* **Expected:** the value is refused with a plain message; the simulation keeps working.
* **Actual:** the value is stored; from then on every tick throws `cfg.j(...).includes is not a function` and the clock is stuck until the database is edited by hand. Only a few units are type-checked: `bool` settings accept any JSON (the API turns the string `"false"` into `true`), `sim.utc_offset_hours`, `ui.undo_seconds` and every `hours` / `json` / `text` setting accept any type, and `space.forecast_days = 0` (or a negative number) is accepted (it would break `projectZones`, which reads `dates[0]`).
* **Fix (`c17230e`):** `setSetting` checks the new value against the stored one: same kind (number, true/false, text, list, object), finite numbers, no negative counts (and at least 1 where a zero breaks a loop or a division), hours 0–23, dates `YYYY-MM-DD`, chances and shares 0–1, a 24-value hourly profile. A wrong value is refused in the user's language and nothing is stored; the Settings table shows the refusal and a "saved" note. Test: `tests/review.test.ts` C1 (fails before, passes after); every default value passes its own check.

### M1 — an offer can be created already expired (major)

* **Where:** `lib/space/market.ts:551-557` (`generateOffers`).
* **Reproduce:** publish a listing; run 200 hours; add a company under *Do it yourself → New company request* (or resume a listing that was paused when an offer was due). Probe: listing published at tick 0, request added at tick 201 → offer row `arrived_tick 64, valid_until_tick 184, status EXPIRED`.
* **Expected:** the offer arrives now and is valid for `space.offer_validity_h` from now.
* **Actual:** `arrived_tick` and `valid_until_tick` are computed from the listing's publication time, which can lie in the past. The offer is inserted as PENDING with an expiry already passed, an "offer arrived" event is logged, and one tick later it is EXPIRED. The manager never sees it. (Planned offers already use `max(arrived, now)`, see `market.ts:462`; this path did not.)
* **Fix (`a162211`):** Arrival is `max(planned hour, now)` and the offer's terms use that hour. Test: M1.

### M2 — server errors are reported as 400 and raw English text reaches the Arabic UI (major)

* **Where:** `lib/api.ts:11-12`; plain `Error`s in `lib/decisions.ts` (`"recommendation not found"`, `"already decided"`, `"only a pending recommendation can be postponed"`, `"quantity must be at least 1"`, `"unknown item"`, `"a reason is required"`, `"invalid quantity"`, `"not enough stock"`, `"no room in the warehouse for this receipt"`, `"invalid request"`, `"this decision cannot be undone"`, `"the order has already arrived or changed"`), and in the routes (`"bad decision"`, `"unknown action"`...).
* **Reproduce:** approve the same purchase order twice (two tabs, or a double click that slips past the disabled button). Probe: the second `decide()` throws `Error("already decided")`.
* **Expected:** a refusal in the user's language ("This suggestion was already decided"), and a real crash reported as a server error (500, logged).
* **Actual:** the English sentence is shown in the red banner of the Arabic UI; a programming error (e.g. a `TypeError`) is also answered with status 400 and is not logged anywhere.
* **Fix (`95b7f7e`):** Expected refusals are `UserError`s with locale keys (`err.*`); unknown actions and movement kinds are refused; any other error is logged (`console.error`) and answered with 500 and `err.server`. The browser shows network failures in plain words and refreshes the screen after a refused action, so a card decided in another tab disappears. Test: M2.

### M3 — some human decisions do not re-run the agents (major)

* **Where:** `lib/decisions.ts` — `postpone` (115-127), `editQty` (161-175), `createSpaceRequest` (234-247).
* **Reproduce:** postpone a purchase suggestion. Probe: `agent_runs` holds 10 rows before and 10 after.
* **Expected (README, ARCHITECTURE, brief):** "after every decision of the manager the coordinator runs all five again".
* **Actual:** approve / reject / undo / manual order / manual movement / every space decision re-run the agents, but postponing, editing a quantity and adding a company request do not. Until the next hourly run the screen is stale: a postponed order keeps its "overdue" alert, an edited quantity is not re-checked for budget or room, and the plan shows the old figures.
* **Fix (`25ad73c`):** The three actions now call the coordinator like every other decision. Test: M3 (5 new agent runs each).

### m1 — the "zone over capacity" alert always fails its own check (minor)

* **Where:** `lib/agents/alerts.ts` (SPACE_OVER alert, `ignore: null`), checked by `lib/checks.ts:107`.
* **Actual:** every alert must carry a "what happens if ignored" message; SPACE_OVER is the only kind created without one, so the day it fires the Alerts agent fails VERIFY, re-runs, and raises a red "agent warning". Receiving never overfills a zone, so it has not fired in normal runs. Found by reading the code.
* **Fix (`2e4ab1d`):** The alert carries `alert.space_over.ignore`. Test: m1 (the Alerts agent passes VERIFY with the alert active).

### m2 — the README settings table is out of date (minor)

* `space.offer_base_prob` is documented as `0.85`; the default is `0.35`. 18 settings are missing (`rec.postpone_hours`, `ui.undo_seconds`, `space.forecast_days`, `space.safety_margin_pct`, `space.conflict_tolerance_pct`, `space.start_buffer_days`, `space.offer_validity_h`, both priority rules, all `budget.*` cycle settings, `space.pool_extra_count`, `space.pool_names_a`, `space.offer_min_count`, `space.offer_window_days`).
* **Fix (`0a7ac3d`):** `npm run docs:agents` writes the table between `settings:start` / `settings:end` markers from `config/defaults.json`; test m2 fails when it drifts.

### m3 — the "no typed text in components" test skips sub-folders (minor)

* `tests/ui.test.ts:10` reads `components/*.tsx` only, so `components/space/*` and `components/site/*` are not checked. (A manual scan found no typed text there today.)
* **Fix (`62e5628`):** The test walks every sub-folder. One price arrow (`o.price > o.listing_price ? … : …`) was rewritten without `<`/`>` so the scanner does not read the operators as text.

### M4 — the English refusal of an offer prints "[object Object]" (major)

* **Where:** `sp.err.cannot_accept` in `scripts/locales_space.py` used `{why}` in English but `{why:msg}` in Arabic; `lib/space/market.ts` passes a message object.
* **Reproduce:** in English, accept (or counter) an offer whose checks fail, e.g. right after a purchase took the space.
* **Expected:** "The offer cannot be accepted as it is. The forecast shows we need this space … A counter-offer for 300 m² may work." **Actual:** "… as it is. [object Object] A counter-offer …".
* **Fix (`8df010f`):** `{why:msg}` in English too. A new test compares the placeholders and formats of every key in both languages (only this key differed).

### M5 — the conflict card of a partly leased listing offers "Shrink to 0 m²" (major)

* **Where:** `components/space/SpaceQueue.tsx` (ConflictCard) and `lib/space/snapshot.ts`.
* **Reproduce (browser):** list 740 m², accept a 600 m² offer, then let a purchase order need the space: the card says "Shrink listing to 0 m²" (disabled).
* **Expected:** shrink to 600 m² (keep the leased part, close the rest), which the server accepts. **Actual:** `ok_area` is the room for the unleased rest, but "shrink" sets the whole listing area, so the button offered a value the server always refuses.
* **Fix (`bccf74f`):** the snapshot computes `shrink_to = leased + ok_area` and `can_shrink` (at least the minimum block and the leased area, below the current area); the button only shows when the server will accept it. Verified in the browser (the conflict closed). Test: M5.

### M6 — a failed tick freezes the clock while the screen says "running" (major)

* **Where:** `components/Dashboard.tsx` (clock loop).
* **Reproduce (browser):** press Start, then make one tick request fail (dev-server reload, network blip; reproduced by overriding `fetch` once).
* **Expected:** the clock is paused and the screen says why. **Actual:** the loop stopped but the server still had `running=1`; the top bar said Running and showed Pause, and nothing moved until Pause then Start.
* **Fix (`270f93e`):** the loop pauses the clock on the server (or, if the server is unreachable, at least on screen) and shows "The clock stopped because the last hour could not be run …". Verified in the browser with the same `fetch` override. **No automated test**: the project has no browser test runner and this is client-only code.

### P1 — usable stock is recomputed day by day for every lot (major, performance)

* **Where:** `lib/calc/inventory.ts` (`usableQty`), called by `loadLive` (Alerts agent every hour, every snapshot, every decision).
* **Measured:** in a 400-day run the time per tick rose from 116 ms (day 25) to 358 ms (day 200), and a snapshot took up to 716 ms, so at the fastest preset (0.5 s per hour) the UI fell behind. CPU profile at day 200: 60 % of the time in `usableQty → demandOver → addDays / seasonFactor`: for every lot with an expiry date the demand was summed day by day up to 400 days ahead.
* **Fix (`220de8e`):** `demandCurve` sums the full days once per item, in the same order, and adds only the last partial day per lot. Results are bit-identical (test P1 compares with `demandOver` for every 13th hour up to 400 days, seasonal and non-seasonal), so no simulation number changes. Day-200 database: tick 184 → 109 ms.

### P2 — recent movements and movement numbers scan every movement (major, performance)

* **Where:** `lib/snapshot.ts` (recent movements), `app/api/movements/route.ts`, `lib/stock.ts` (`addMovement`).
* **Measured:** the recent-movements query used the `(sim, tick)` index and then sorted every simulated movement to return 60: 80 ms at day 200, growing every hour. `addMovement` ran `COUNT(*)` over all simulated movements for each new movement (2.6 ms × about 20 per hour).
* **Fix (`309b45b`):** `+m.sim=1` lets SQLite walk the table backwards by `seq` and stop after the page (0.5 ms, same rows); the next movement number is read from the last movement (same id: rows are never deleted). Each recommendation is parsed once in the snapshot. Day-200 database: snapshot 228 → 108 ms; tick 109 → 99 ms.

### m4 — "cannot order: no room" is Critical right after the order was approved (minor)

* **Reproduce (browser, demo step 4):** frozen shrimp shells run out on 7 Oct; approve its order. A new **Critical** risk "Cannot order frozen shrimp shells: no room in Z3 when it arrives" appears for the same item, which reads as if the approval failed.
* **Fix (`1e3f0a2`):** with an order already on its way the alert stays (the rest of the need cannot be ordered) but as High. Test: m4.

### m5 — months with the wrong Arabic agreement (minor)

* "اعرض ٧٤٠ م² للإيجار لمدة ٦ شهر" (should be ٦ أشهر); also in the list of demand we cannot serve.
* **Fix (`b38ba98`):** a `months` format using the plural rules the durations already use: شهرين، ٣ أشهر، ١٢ شهراً. Test: m5.

### m6 — a corrupt database file blocks the app (minor)

* **Reproduce:** replace `smartstock.db` with any non-database file. Every request failed with "file is not a database", and `npm run seed` failed too (it opens the same file).
* **Fix (`81348f7`):** `lib/db.ts` moves the file (and `-wal` / `-shm`) to `smartstock.db.corrupt-<time>` and opens a fresh one, which the first request seeds. A missing or empty file already worked. Test: m6.

## Checked and found correct

* **Determinism.** No `Math.random`; every draw comes from `lib/rng.ts`, keyed by the seed and names. Wall-clock time is only used for row timestamps (`ts`) and the real-time pacing of auto ticks, never in a business number. Queries without `ORDER BY` scan in insertion order, which is identical for the same seed and actions; the audit's same-seed check confirms it.
* **Clock and concurrency.** A tick is one transaction; `expected` makes a tick idempotent (stale or duplicate requests are ignored); auto ticks are refused while paused or too soon; the browser sends one request at a time through a queue; a reload resumes paused (checked in the browser). Node runs the handlers one at a time, so two tabs cannot interleave inside a transaction. A double approve is refused in plain words (M2).
* **Stock and money over a long run.** No negative stock, lot and item balances, budget periods without gaps, committed spend within budget + emergency spend: checked at every hour by the audit (30 days × 3 seeds), and every 10 days in a 400-day probe run with a manager who approves every order.
* **Website and demo gate.** Not redesigned; trial sign-in, the redirect to `/login` without the cookie and `401` for the API were exercised by the existing tests and in the browser.
* **Docs vs code.** "No LLM is called" is accurate for every decision: `lib/llm.ts` only polishes the wording of pending supplier messages, and only when `ANTHROPIC_API_KEY` is set and the manager presses *Run analysis*.
