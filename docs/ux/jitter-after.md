# Jitter — measurements AFTER the fix

Same method as `jitter-before.md` (dev server, English, desktop pane, Start pressed, page observed from the console: `PerformanceObserver('layout-shift')`,
`MutationObserver`, and 50 ms sampling of the position **and height** of every section, so that below-the-fold movement is caught too).

| measurement | before | after |
|---|---|---|
| CLS (layout-shift API), 0.5 s per simulated hour, 78 simulated hours (3.2 days) | 0.0000 (blind below the fold) | **0.0000** |
| Section geometry changes (position or height) while running at 0.5 s/h, 40 s | page grew/shrank, sections jumped by 14 px and 181 px | **0 changes** in every section |
| Page height while running | 15,466 → 15,942 px | **2,190 px, constant** (min = max) |
| 5 s per simulated hour, 6 simulated hours (30 s) | not measured | CLS 0.0000, 0 geometry changes, height constant |
| DOM mutations per simulated hour (0.5 s/h) | ~137 (whole dashboard re-rendered) | ~79 (only changed slices) |
| DOM mutations per simulated hour (5 s/h) | – | ~48 |

## Root causes, in plain words
1. **The whole screen was redrawn every hour.** One big data object was replaced on every tick and every panel read it, so every panel re-rendered, even when nothing in it changed.
   *Fix:* the data now lives in a small store with structural sharing (unchanged parts keep their identity); each panel subscribes only to its own slice and is memoised; table rows and feed rows have stable keys and are memoised, so only rows whose numbers changed update. Number-formatting helpers no longer change when the data changes.
2. **Panels changed height with their content.** Lists used `max-height` and `items-start`, so when alerts, decisions or table rows came and went the whole page below moved (up to 181 px).
   *Fix:* every list lives in a card with a **fixed height and its own scrollbar** (`scrollbar-gutter: stable`, `overflow-anchor: none`); empty, loading (skeleton) and error states fill the same space. The pause banner, error bar, undo toast and dialogs are `position: fixed` overlays, so they never push the page.
3. **A hidden element escaped its scroll box (found while measuring the new layout).** Screen-reader-only text (`.sr-only`, positioned absolutely) inside a scrolling list was positioned against the page, not against the list, so it was not clipped and stretched the **page** to follow the list's content height (3,643 → 4,058 px while running). *Fix:* scroll boxes are `position: relative`, and the unneeded hidden spans were removed.
4. **New feed rows pushed the rows below them down by one row at once.** *Fix:* the feed has fixed-height rows placed with `transform` (they glide one slot down) and fade in with `opacity` only; the flash highlight on a stock row changes the background colour only; only the newest 60 rows are in the page (more on request).
5. **Answers could arrive out of order.** A tick and a user action could both be in flight, and an older answer could briefly replace a newer one (numbers flickering back). *Fix:* every request goes through one queue (a user action can never overlap a tick), and every snapshot carries a sequence number; a snapshot older than the one on screen is ignored.
6. **Numbers changed width.** *Fix:* `font-variant-numeric: tabular-nums lining-nums` for all numbers (also Arabic-Indic digits), fixed column widths (`table-fixed`) and reserved heights for KPI values and the clock block.
7. **Late fonts.** The web font is loaded with `display=swap` and the fallback stack (Segoe UI, Tahoma) has similar metrics; the first paint shows skeletons with reserved space, so a font swap cannot move a panel.
