# Layout stability of the two sections (measured)

Method (same as `docs/ux/jitter-after.md`): dev server, browser pane at 1360×860, light theme, English, simulation running at **0.5 s per simulated hour**
(`Speed ▸ 0.5 s`), observed from the console for 40–45 s: `PerformanceObserver('layout-shift')` (CLS), a `MutationObserver` (DOM changes), and 50 ms sampling of the
position and height of every section and of the whole page (so movement below the fold is caught too). Space was measured with a published listing, three offers,
an accepted rental and a conflict card in the queue.

| measurement | Purchasing | Space |
|---|---|---|
| CLS (layout-shift API) | **0.0000** | **0.0000** |
| Simulated time covered | ~100 hours | ~84 hours (3.5 days) |
| Section position / height changes while running | **0** in every section | **0** in every section (after fixing the queue header, see below) |
| Page height while running | 2,269 px, constant | 4,030 px, constant |
| DOM changes per simulated hour | ~52 | ~11 |

Found and fixed while measuring Space: the first run showed **one** height change in the "Needs your decision" card of Space (a second geometry value), caused by its header:
the count pills and the "waiting longest" sentence wrapped to one or two lines depending on the numbers. The header now has a fixed minimum height and the sentence is clamped to two lines.

Why Space stays still (same rules as Purchasing): every list is a fixed-height scroll card with its own scrollbar (queue 480 px, listings 360 px, leases 300 px, forecast 300 px, unmatched 200 px), cards use stable keys,
numbers use tabular figures, dialogs and toasts are `position: fixed`, each panel subscribes to its own slice of the snapshot (the Space slice is replaced only when its numbers change, thanks to structural sharing), and requests go through one queue with sequence-numbered snapshots.
