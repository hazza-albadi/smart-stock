# Usability walkthrough — before and after

Persona: a warehouse manager who has never seen the app and has not read the README. Task: complete the demo story — see what is at risk, decide on the urgent order,
see what happens, deal with a customer's storage request. (Screenshots: `before-*.jpg`, `after-*.jpg` in this folder.)

## BEFORE — the 10 biggest problems I hit

| # | Problem | Evidence |
|---|---|---|
| 1 | **No idea where to look.** The first screen is a header with ~15 controls (speed bar, custom field, audit, analysis, language…) and KPI cards. Nothing says "do this first". | `before-desktop-en-light.jpg` |
| 2 | **The decisions are buried.** "Pending decisions" sits ~1,300 px down, under the stock table and the feed; the first thing a manager must do is the last thing they see. | page is ~15,000 px long |
| 3 | **Everything at once.** Twelve panels on one page; agent log, settings and impact log have the same weight as the urgent order. | `before-desktop-ar-dark.jpg` |
| 4 | **Jargon.** "Weeks of cover 0.3", "Crit.", "Open PO", "reorder point", "position", "lease", "anomaly", "REQ-01", status codes. A manager has to guess. | stock table headers, alert cards |
| 5 | **Two places to act on the same thing.** The alert card and the pending list both have Approve/Reject; which one counts? Buttons just say "Approve" – approve *what*, for how much, arriving when? | alert card + pending panel |
| 6 | **No safety net.** One click places a purchase order; no confirmation, no undo; "Reset" wipes everything without asking. | – |
| 7 | **Why is it paused?** A red banner pushed the page down; the clock itself only said "Paused". The speed was hidden in a row of tiny buttons ("0.5s 1s 2s…"). | – |
| 8 | **No orientation.** No tour, no help, no demo guide; a first-time user must read the README to know what Play, Step, Next critical event do. | – |
| 9 | **Small and colour-only.** 12 px text, 28 px buttons, status shown mostly by colour; the page shook while running (see `jitter-before.md`). | – |
| 10 | **Phone.** The header filled the whole first screen (~600 px) before any content; controls wrapped into 4 rows. | `before-phone-ar-dark.jpg` |

## AFTER — what changed (each problem fixed)

| # | Fix |
|---|---|
| 1, 2, 3 | New page order that answers three questions: **1. "Needs your decision"** (big card list, count and "waiting longest" in the title) next to **2. "What is at risk"** (4 key numbers + risk list), then **3. "What happened recently"** (live feed + stock). Everything else (storage space, purchase plan, what happened after your decisions, automatic checks, manual actions, settings & data check) is in one **tabbed "More" card**, one panel at a time. Details open on click (risk rows, "Details" on a decision, ⓘ formulas). |
| 4 | **All texts rewritten in plain language** (see below). "Lasts about 2 days" instead of "0.3 weeks of cover"; "Waiting for you", "Free to rent", "On the way"; no codes or enum names; a **glossary** (`?` next to technical words and in Help). |
| 5 | **One card, one main action.** Every suggestion is a card: *what* (title), *why*, *if you approve*, *if you do nothing*, and **one big green button that says exactly what it does** ("Approve order: 520 kg for 130.000 OMR"), plus *Reject* and *Postpone 24 h*. Alerts are information only (no duplicate buttons). |
| 6 | **Undo toast** (12 s) after every approve / reject; **Postpone**; confirmation dialogs for what cannot be undone (manual stock movement, approve-all, start over). |
| 7 | The clock block says it in words: **"Paused: critical event – decide now"** and **"1 hour = 5 seconds"**; the pause message is a fixed overlay with "Go to decisions" (it never pushes the page). Speed is one `Speed ▾` menu with presets, custom value and the auto-pause switch; the top bar is **sticky** (compact on phone: clock, Start, +1 h, menu). |
| 8 | **First-run tour** (5 steps, skippable, remembered) and a **Help** button: 2-minute demo script, glossary, tour again. |
| 9 | Body text 15 px (small text 13 px), controls ≥ 40 px, one status system (**colour + icon + label** everywhere), visible focus ring, labels on icon buttons, no jitter (see `jitter-after.md`). |
| 10 | Phone: compact sticky bar, cards stacked, wide tables scroll inside their own box, no horizontal page scroll (checked at 390 px). |

Also added: loading skeletons, empty states that say *why* they are empty, error messages in plain words, explanations for disabled buttons ("Pause the clock first"), a Postponed list.

## Re-run after the fix (same task, fresh browser, no README)
1. Opened the page → the first thing I read is **"Needs your decision (12)"**, next to **"What is at risk"**. ✔
2. Pressed **Start**; the clock paused by itself with "critical event – decide now" and a link to the decisions. ✔
3. Read the card for frozen shrimp shells; the green button said what it does. Pressed it → toast "Order placed… Undo"; pressed **Undo** → the card came back, budget restored. ✔
4. Opened **Storage space** → saw free space, requests and rentals in words; approved a customer request in the decision list. ✔
5. Opened **After your decisions** → read what each decision led to in plain sentences. ✔
6. Switched language and theme; phone width; no horizontal scroll. ✔

## Wording — 5 before/after examples (English / Arabic)

| Before | After |
|---|---|
| Weeks of cover **0.3** | Lasts **about 2 days** — يكفي **حوالي يومين** |
| `Delayed PO PO-002-260914: Frozen shrimp shells now arrives Wed, Oct 21, 2026` | **Order PO-002-260914 of Frozen shrimp shells is late: now expected on Wed, Oct 21 at 12:00** — الطلب متأخر: موعده الجديد … |
| Position 1,270 kg is below the reorder point 1,820 (lead time 5 days). | Stock plus deliveries on the way (1,270 kg) is below the level where we should order (1,820 kg). A delivery takes 5 days. — المخزون مع الشحنات القادمة … أقل من المستوى الذي نطلب عنده … |
| Approve / Reject | **Approve order: 520 kg for 130.000 OMR** / Reject / Postpone 24 h — وافق على الطلب: ٥٢٠ كجم بـ ١٣٠٫٠٠٠ ر.ع / ارفض / أجّل ٢٤ ساعة |
| Lease REQ-01 reserved 600 m² Z5 … rentable space drops | **Rent out 600 m² in Overflow area** … "The free space there drops from that date." — أجّر ٦٠٠ م² … |
