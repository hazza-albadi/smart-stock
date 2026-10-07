# Jitter — measurements BEFORE the fix

Method: dev server, English, light, desktop pane; interval 0.5 s per simulated hour (auto-pause off), Play pressed, page observed from the browser console
(`PerformanceObserver('layout-shift')`, `MutationObserver`, and 50–100 ms sampling of the page position/height of every section, because layout-shift only reports
shifts of content that is *inside the viewport* and the shaking part is below the fold).

| measurement | result |
|---|---|
| Layout-shift API (CLS) with the page scrolled to the top, 42 ticks | 0.0000 (nothing visible in the first screen moves) |
| Page height while running | 15,466 → 15,942 px (grows/shrinks while running; the whole page is ~15,000 px tall) |
| Position of the sections below the alert area (impact log, agents, manual actions, settings) | jumped by **181 px** and **14 px** within 12 ticks |
| Position of the Space and Plan sections | jumped by 14 px within 12 ticks |
| Height of the Space panel across two runs | 6,584 px → 5,188 px (−1,396 px) |
| Height of the Plan panel across two runs | 2,414 px → 3,325 px |
| DOM mutations per simulated hour | ~137 (the whole dashboard is re-rendered every tick) |
| Wall-clock per tick at 0.5 s setting | ≈ 1.25 s (the browser awaits each response; ticks are not overlapping) |

## What moves (observed)
* Everything under the alert/pending area (space, plan, impact, agents, manual, settings) shifts up and down by 14–181 px as alerts and pending recommendations appear, disappear or wrap onto another line.
* The Space panel's request cards and lease list, and the Plan table rows, change the height of the panel when a decision or a draft changes.
* The live feed inserts each new row at the top of a fixed-height list, so all rows below it jump down by one row at once.
* Numbers in the stock table and KPI cards change width when digits change (e.g. 99 → 100), so cells re-wrap.

## Suspected causes found in the code (all confirmed by reading the code)
1. `Dashboard` replaces the whole snapshot object every tick and passes it through one React context, so **every panel re-renders every hour**.
2. Panels use `max-height` (not a fixed height) and `items-start` grids: their height follows the content, so the page below them moves.
3. A banner and error bar are inserted at the top of the page (pushes everything down).
4. Responses of ticks and of user actions can arrive out of order (no sequence guard): an older snapshot can briefly replace a newer one (flicker between old and new numbers).
5. Feed rows are inserted at the top without a fixed row height or transform animation.
6. Scrollbars appear/disappear inside the panels (no `scrollbar-gutter`), numbers use `.num` without a reserved width.
