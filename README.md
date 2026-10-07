# SmartStock — Live MVP

Inventory and warehouse-space assistant for **Qeshour** (chitosan from shrimp, crab and lobster shells).
Next.js (App Router) + TypeScript + Tailwind, SQLite (`better-sqlite3`). Arabic RTL by default, English toggle, light/dark.
Runs fully locally: no cloud, no login, no API key needed.

The dashboard is a **live simulation** driven by the CSVs in `smartstock_data/`: stock movements (IN/OUT) appear one after
another, stock levels change, and five coordinating agents re-run after every simulated day so alerts, purchase-order drafts
and space decisions update by themselves.

## Install and run

```bash
npm install
npm run seed     # builds smartstock.db from smartstock_data/*.csv and runs the agents once
npm run dev      # http://localhost:3000
```

Requires Node 20+ (tested on Node 24). If `smartstock.db` does not exist the app seeds itself on the first request.
`SmartStock_demo_answer_key.md` is not part of this project (use it only for manual comparison).

Optional: set `ANTHROPIC_API_KEY` to let a model polish the wording of supplier messages when you press **Run analysis**.
All numbers and decisions stay in deterministic code; without a key the built-in Arabic/English templates are used.

```bash
npm run test:agents        # prints the acceptance checks from the brief against the fresh database
npm run test:agents 10     # same, after simulating 10 days
```

## 2-minute demo script

1. Open the page (date **2026-10-05**). Point at the KPIs: 4 items at risk, **3,989 OMR** budget left, **1,400 m²** rentable.
2. Press **Play** (try 2x). Movements slide into the live feed, stock rows flash, and the date advances.
   Within two simulated days **SKU-002 frozen shrimp shells** hits zero: red toast "Stockout – production stopped".
3. Press **Pause**, then **Run analysis**: the five agents (Forecast → Replenishment → Space → Alerts → Space matching)
   light up one after another in the *Agent activity* panel.
4. In *Alerts & recommendations* open the SKU-002 card: delayed PO-002, a drafted Arabic/English supplier message that suggests
   dried shrimp shells (SKU-001) as a temporary alternative, and a draft PO. Press **Approve** on the PO — the PO appears in the
   stock table with its arrival date and the budget bar moves.
5. Scroll to **Warehouse space**: Z1 500 m² + Z5 900 m² rentable. REQ-01 approve (Z5), REQ-02 reject (cold), REQ-03 reject
   (hazardous), REQ-04 partial/split, REQ-05 approve (Z1). Approve REQ-01 and watch rentable space and the other proposals update.
6. Press **Play** again: SKU-003 (718 kg, expires 2026-10-10) is written off on 10-11 if nobody acts; the approved PO arrives
   as an IN movement. **Reset** restores the starting state.

## How it is built

| Piece | Where |
|---|---|
| SQLite schema, seed from CSV, reset | `lib/db.ts`, `lib/seed.ts` (`npm run seed`) |
| Simulation engine (daily OUT, PO receipts, expiry write-offs, stock-outs) | `lib/sim.ts`, `lib/seasonality.ts`, `lib/rng.ts` |
| Agents | `lib/agents/forecast.ts`, `replenishment.ts`, `space.ts`, `alerts.ts`, `matching.ts`, run in order by `coordinator.ts` |
| Human in the loop (Approve / Reject) | `lib/decisions.ts` → `recommendations.status` |
| API (all reads/writes go through SQLite) | `app/api/{state,sim,agents,recommendations,items}` |
| UI | `components/*`, `lib/i18n.ts` |

SQLite is the single source of truth. Extra tables: `agent_runs`, `events`, `recommendations`, `sim_state`, plus agent outputs
(`forecasts`, `replenishment_plan`, `zone_space`, `alerts`) and `sim_baseline`.
The browser drives the clock (one `POST /api/sim {tick}` per simulated day), so nothing runs in the background when the page is closed.

### Simulation rules
* Daily usage = baseline (last 4 weeks of history; SKU-019: the 12 weeks before its spike) ÷ 7 × seasonality × seeded noise (±20 %).
  Seasonality: SKU-001/006/017 ramp from 1.0 to 1.8 between 5 and 19 Oct and stay there until March. SKU-019 stays at ~3x for five days, then eases off over ten.
* Randomness is derived from `seed|date|item`, so every run is identical (checked: two 10-day runs give the same movements).
* Lots are issued first-expired-first-out. A PO is received on its `expected_arrival` (delayed PO-002 only on 2026-10-21). Lots past `expiry_date` are written off (`reference = EXPIRED`). Stock never goes below 0.
* The data ends on 2026-10-03 while "today" is 2026-10-05, so the first tick also fills in 10-04 and 10-05.

### Agent rules (all deterministic)
* **Forecast** — weekly usage from the last 4 weeks, 4-week forecast with the seasonal index, weeks of cover, anomaly = last 3 weeks above 2x the prior 12-week average (min. 5 units/week), usable stock before lot expiry, projected stock-out date.
* **Replenishment** — reorder point = forecast demand over (lead time + 14-day review cycle) + safety stock, counting open POs that arrive in that window. Cover above 12 weeks is never reordered. Order quantity covers lead time + 8 weeks (half the shelf life for perishables), capped at 12 weeks of cover. Priority: criticality A → B → C; inside A, stock-out risk first, then safety gear and chemicals. Budget 18,000 OMR with open POs (≈14,012 OMR) already committed; a line that does not fit is reduced to the minimum quantity that restores the reorder point (A items only) or deferred with the reason stated.
* **Space** — used = fixed + Σ(on-hand × m² per unit) of the zone's items; rentable = capacity − used − reserved buffer where `rent_allowed = yes`; approved tenants are subtracted.
* **Alerts** — Critical/High/Monitor/Info for stock-out risk, delayed PO, demand anomaly, overstock (> 20 weeks), expiry within 14 days, safety gear below safety stock (plus a safeguard alert if a zone were ever over capacity). Critical/High supplier issues get a bilingual message draft.
* **Space matching** — cold/hazardous are rejected. Every general request is first judged **independently** against the rentable area (nothing else pending is deducted): it is approved in the smallest zone that fits, or, if no single zone fits, offered the largest single block plus a split. REQ-04 therefore reads "cannot fit as one block, largest single block 900 m² (Z5): propose 900 m² in Z5, or split 900 Z5 + 100 Z1". The sequential effect is shown only as a separate note (earliest start date first): "if REQ-01 + REQ-05 are approved first, only 350 m² would remain (Z5 300 + Z1 50)", plus a panel line with what stays rentable if all single-block approvals are accepted. After each approval the agents re-run, so the remaining pending proposals are recalculated against what is left, and approving a proposal whose area was taken meanwhile is refused.

### Zone capacity (no zone is ever above 100 %)
The open POs are large for the space the data gives Z1 (they would add > 3,000 m² on 7 Oct), so receiving now respects physical room instead of changing `space_m2_per_unit` (which would change the starting numbers):
* Room in a zone = capacity − fixed area − stock held there − area promised to approved tenants (the reserved buffer may be used by stock; it only protects rentable space).
* A PO is received into the item's home zone first. Z1 general goods that do not fit **overflow into Z5**; the event feed says so ("N sent to overflow zone Z5 because Z1 is full").
* If Z1 and Z5 are both full (or the item belongs to Z2/Z3/Z4, which never overflow), the PO is received **partially**: the received part is booked (IN movement, budget value kept), the remainder becomes a new `PO-…-R1` row scheduled for the next day, with a "held at the supplier, no space" event, and is retried daily as stock is consumed.
* Space used is now computed from the zone where each lot is actually held (identical to the item's zone at the start). Starting numbers are unchanged: Z1 500 m², Z5 900 m², total 1,400 m²; as overflow arrives Z1 and Z5 rentable space falls towards 0, which is the realistic consequence.
* Checked over a 40-day simulation: used area never exceeds capacity in any zone.

### Notes on the data
* All starting results come from the data and the rules, nothing is hard-coded.
