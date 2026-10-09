# Space flow — screenshots, measurements and day-0 differences

Branch `feature/space-flow` (from `fix/ux-polish`). The app now has two flows (Purchasing and Space); this folder shows the Space flow in the **light theme (the default)**, in English and Arabic, on desktop and phone, plus one dark screenshot.

## Screenshots (all light theme unless noted)

| file | what it shows |
|---|---|
| `space-desktop-en-light-day0.jpg` | Space on day 0: flow bar (next step highlighted), two free windows found by the forecast, the Space KPIs (can be listed 1,560 m², empty today 1,400 m², nothing on the market yet, no offers, no rentals), yellow warning from a pending purchase suggestion |
| `space-desktop-ar-light-day0.jpg` | the same in Arabic (RTL) |
| `space-phone-en-light-day0.jpg`, `space-phone-ar-light-day0.jpg` | phone width (375 px): compact section switch, flow bar, decision card |
| `space-offers-en-light.jpg` | after publishing: an offer card with the six automatic checks in words (red = cannot accept), Accept disabled with the reason, Counter-offer, Reject; toasts with Undo |
| `space-conflict-en-light.jpg` | a purchase approved after the listing: conflict card (order named, dates, options) first in the queue; the same alert is in Purchasing |
| `space-listings-leases-en-light.jpg` | listings (online, partly rented), answered offers, and the rental that starts later with rent per day |
| `space-forecast-unmatched-en-light.jpg` | the forecast behind the windows, why some periods cannot be listed (orders named), and the demand we cannot serve (cold / hazardous are never rented) |
| `purchasing-desktop-en-light.jpg` | the Purchasing section (unchanged logic) with its own KPIs, queue and risks |
| `space-desktop-en-dark.jpg` | dark theme still works (explicit choice only) |

Layout stability (CLS and geometry at 0.5 s per simulated hour): `jitter.md`.

## Day-0 baseline: what is the same and what changed

Same (checked by the test "day 0 hour 0 equals docs/reports/baseline.json" and by the audit): stock per item, forecasts, the replenishment plan, budget (18,000 OMR total, committed and free), alerts, the pending purchase recommendations, and the
**physical empty space: 1,400 m² (Z1 500 m², Z5 900 m²)** in the zone table and in the Space KPI "Empty today".

Changed (and why):

| before (daily/hourly engine, matching agent) | now |
|---|---|
| five space requests were visible and *matched* on day 0 (`space_proposals`, five `SPACE:REQ-nn` recommendations) | **nothing from the tenant pool is visible**; no listing, no offer, no lease exist (`space_flow` in the baseline proves it: 0 / 0 / 0, pool of 5) |
| "rentable space" = what is empty **today** | the Space Forecast looks 90 days ahead and offers **windows**: space that will *not be needed by the company* in a period, after a 10 % safety margin. Open purchase orders arrive soon and fill Z1 and Z5, so the windows start later and have another size than today's empty space (e.g. Z1 770 m² from 4 Nov, Z5 790 m² from 27 Oct) |
| decisions: Approve / Reject a customer request | decisions: keep empty or list; then accept / reject / counter-offer real offers that arrive over time |

The physical 1,400 m² is therefore *potentially listable*, but only the part the forecast says the company will not need can actually be listed.
