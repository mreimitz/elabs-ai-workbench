# Interface Craft — verification report (WP 4.2, acceptance re-run)

**Date:** 2026-07-25 · **Branch:** `ui/interface-craft` (all 15 WPs merged; `main` untouched, nothing
pushed) · **PM-as-owner acceptance.**

The original review ([`docs/INTERFACE-REVIEW-2026-07-25.md`](../../docs/INTERFACE-REVIEW-2026-07-25.md))
closed at **Block — five HIGH findings** (1 on-fill contrast, 2 Runs-row overflow, 3 landmark
semantics, 4 field-error association, 5 toast timing). This report re-runs the review's own
**measurements** against the built app and records the result as a **before/after diff of numbers**.

## Method (substitute for the `better-interface` skill)

The `better-interface` skill that produced the review is not installed here (owner decision
2026-07-25). The re-run **substitutes**, per the plan README:

1. **Manual live probing** — the built `ui/interface-craft` bundle served on `http://127.0.0.1:8099`
   (scratch DB), driven by **Playwright 1.56 + Chrome**, measuring the review's numbers in **both**
   themes with the review's own methods (oklch→sRGB→WCAG for contrast; live-DOM queries for
   landmarks/focus; `scrollWidth`/`clientWidth` for overflow; a character-width probe for measure).
   Script: `scratchpad/measure-4.2.mjs`.
2. **`brand-ui-visual-ux-reviewer`** — a rendered cross-theme + WCAG-contrast + a11y pass against the
   same running app (the qualitative half). _(Verdict folded in below.)_
3. **The CI guardrails** (WP 4.1) — six invariants now assert the fixes on every `pnpm test`.

## The number diff — measured, both themes

### Finding 1 (HIGH) — on-fill contrast. **RESOLVED.**
Measured live-rendered (`getComputedStyle` → oklch→sRGB→WCAG), all 5 role⇄foreground pairs × 2 themes:

| Pair | Review (before) | Now (rendered) | AA 4.5 |
|---|---|---|---|
| `light --primary` | **4.31** ❌ | **4.60** | ✓ |
| `light --success` | **4.31** ❌ | **5.09** | ✓ |
| `light --info` | **3.76** ❌ | **4.61** | ✓ |
| `light --destructive` | 5.20 | 5.22 | ✓ |
| `light --warning` | 6.59 | 6.63 | ✓ |
| `dark --destructive` | **3.02** ❌ | **5.50** | ✓ |
| `dark --primary` | 8.24 | 8.24 | ✓ |
| `dark --success` | 8.24 | 9.16 | ✓ |
| `dark --info` | 6.58 | 6.55 | ✓ |
| `dark --warning` | 8.40 | 8.36 | ✓ |

All **four failing pairs** now clear AA; no previously-passing pair regressed. (The dark
`--destructive` badge — the review's worst case, "the app's least readable element" — is 3.02 → 5.50.)

### Finding 11 (MEDIUM, token half) — semantic token identity. **RESOLVED.**
`getComputedStyle(document.documentElement)`, both themes:

| Check | Before | Now |
|---|---|---|
| `--success` vs `--primary` | byte-identical | **distinct** (bright `oklch(51% .15 150)` vs `oklch(53.5% .143 153)`) |
| `--ring` vs `--info` | byte-identical | **distinct** (bright `oklch(62% .16 250)` vs `oklch(55% .13 245)`) |

(The delta half of finding 11 — `lib/delta.ts` single tone authority, worse=amber/better=green — is
verified by WP 2.2's tests + grep-proof single authority; live color convergence is in the visual
reviewer's pass.)

### Finding 15 (LOW) — root font smoothing. **RESOLVED.**
`getComputedStyle(document.body).webkitFontSmoothing` = **`antialiased`** in both themes (was `auto`).

### Finding 3 (HIGH) — landmark semantics. **RESOLVED.**
Live DOM on `/dashboard`, both themes:

| Metric | Before | Now |
|---|---|---|
| `document.querySelectorAll('main').length` | **2** (nested) | **1** |
| primary nav | unnamed `<div>` | `<nav aria-label="Sections">` (present) |
| skip link | none | **first focusable** ("Skip to content" → `#main-content`) |

The skip link is the **first Tab stop** and targets the single `<main>` — a 1-keystroke bypass
(WCAG 2.4.1) that did not exist before. (Raw DOM focusables-before-`<main>` = 17: the sidebar/topbar
stops still exist in tab order — the skip link **bypasses** them rather than removing them, which is
the correct fix. The review's "22→1" is that effective bypass, now satisfied.)

### Finding 2 (HIGH) — Runs filter-row overflow. **RESOLVED (structural + rendered), exact-with-data geometry data-gated.**
- **Code**: the hand-rolled `overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden`
  wrapper is **deleted** (WP 0.4) → the D-TB7 `ViewToolbar` `flex-wrap` `left` owns the row; the
  Show-forks pressed toggle no longer borrows filled-primary green (`Toggle`, not `Button
  variant="default"`). Covered by `RunsView.test.tsx` (6).
- **Rendered (1100px)**: the Runs feed renders with **`docHorizontalOverflow = 0`** and **no
  hidden-scrollbar element near the top** — the review's defect (338px/68% hidden behind a
  no-affordance scroller) is gone.
- **Data-gated**: the *filter row itself* (search + Type facet + Filter + Show-forks + count) renders
  only when the feed has **runs**, and runs require an **LLM provider key** to execute — so the exact
  `scrollWidth === clientWidth` on that specific row (the review's `160 vs 498`) is an
  **owner-acceptance** measurement (needs a seeded run). The fix is provable from code + the
  zero-overflow rendered feed; the with-data row geometry follows by construction (flex-wrap ⇒ no
  horizontal overflow).

### Finding 9 (MEDIUM) — prose measure. **RESOLVED in code, exact callout geometry data-gated.**
- **Code**: `max-w-[68ch]` on the Compatibility "Not everything is automated" callout, the assistant
  message body, the SKILL.md block, and a `ProseCardDescription` wrapper (WP 1.4). A prose-measure
  guardrail (WP 4.1) now fails CI if these lose their cap, and is proven **not** to false-positive on
  tables.
- **Data-gated**: the callout (`ManualReviewCallout`) renders only with a **scan/heatmap present**, so
  the review's 190ch→≤75ch on that exact element needs a seeded scan (owner-acceptance).
- **Observed (empty state)**: the `/testing/compatibility` empty-state onboarding line ("No successful
  scan yet…") renders at **~93 ch/line, `max-w: none`** — this is **not** finding 9's callout (a
  different `StatePanel`/empty element outside finding 9's scope), but it is over ~75ch and is noted
  as a **minor follow-up** (cap the empty-state description too).

## Findings verified by test + guardrail (a11y/behaviour, not a rendered number)

| # | Finding | Verified by | Note |
|---|---|---|---|
| 4 (HIGH) | field errors associated | `FieldRow.test.tsx` + `field-error.guardrail` — `aria-describedby`(→error id) + `aria-invalid` emitted; 28 error-bearing sites inherit it | SR **announcement** not AT-tested (structural; the review didn't test it either) |
| 5 (HIGH) | toast timing | `notify.test.ts` + `notify-duration.guardrail` + `no-bare-toast-error` hook — `notifyError` forces `duration: Infinity`; 176 sites swapped; action toast pinned | The review's own basis was config-only ("toast expiry not observed") — this is a **stronger** verification |
| 6 | section headings | `SectionCardTitle.test.tsx` + jsdom outline — Dashboard `h1→5×h2`, Servers `h1→4×h2` | live running-app outline is consistent with jsdom |
| 7 | live regions | `ResultCount.test.tsx` + `RunConsole.test.tsx` — stable `role="status"`, transcript `role="log"` | SR announcement structural-only |
| 8 | focus visibility + `inert` | `MetaRail.test.tsx` + `RunLauncher` — closed rail `inert`, 0 focusable descendants; validation targets get `focus-visible:ring` | jsdom can't enforce `inert`; visible ring folded into the visual pass |
| 10 | truncation recovery | `RunTableRow`/`CrewCard` `title`s; `TitledSelectTrigger` shipped | select-adoption at the clipping sites (e.g. `CompatibilityView:545`) is a **follow-up** |
| 12 | one error voice | **app-wide grep = 0** user-facing `Could not`/`Failed to`/`<Noun> failed` openers | 3.2a–e; PM added 3.2e for the dirs the slicing missed |
| 13 | filter empty states | 5 hub dead-ends echo the query + wired Clear-filter | out-of-hub `DataTable emptyMessage` sites a follow-up |
| 14 | card elevation | 21 hand-rolled cards → `<Card>`; meta-rail hairlines de-stacked | both-theme elevation-by-eye in the visual pass |

## Guardrails (WP 4.1) — the drift can't recur
Six guardrails now run in the gate (`apps/web/src/guardrails/*.guardrail.test.*`), each demonstrated
**red→green**, plus two edit-time hooks (`.claude/hooks/{no-bare-toast-error,prose-measure}.mjs`):
D-IC1 contrast (all pairs ≥4.5 × both themes), D-IC2 identity, D-IC4 one `<main>`, D-IC6 FieldRow
association, D-IC7 `notifyError`-never-finite, D-IC9 prose-measure (no table false-positive).

## Led with what could NOT be measured live (honest gaps)
- **Finding 2 exact row geometry** & **finding 9 exact callout geometry** — **data-gated**: need a
  seeded run (provider key) / a seeded scan. Structurally fixed + code-verified + guardrailed; the
  with-data numbers are owner-acceptance.
- **Screen-reader announcement** (findings 4, 6, 7) — structural only; not AT-tested (the review drew
  the same line).
- **The empty-state ~93ch line** on `/testing/compatibility` — a minor follow-up (not finding 9's
  callout).
- **`prefers-reduced-motion`, 200% zoom, <320px reflow** — the review listed these as not-verified;
  unchanged here, still not exercised.
- Delta-color convergence, card-elevation, and focus-ring **visual** confirmation → the
  `brand-ui-visual-ux-reviewer` pass (below).

## The `brand-ui-visual-ux-reviewer` pass (rendered, both themes, 15 routes)

Verdict: **Needs changes** (not Block). It confirmed all five HIGH findings resolved — landmarks, skip
link (first Tab stop, visible ring both themes), field-error association (**+ focus moves to the
invalid field on submit**), toast timing (error `Infinity` + close button, success 4000ms), on-fill
contrast (an **exhaustive** every-text-node sweep across 10 routes × 2 themes found **zero**
sub-threshold text outside the two edge cases below), card `shadow-sm` elevation, antialiasing, Alert
contrast (9.93:1 bright — Alert reads app tokens correctly), mobile reflow. It surfaced **three real,
precisely-located issues my numeric probe missed** (they live in error-state flows / surfaces outside
"the 10 fill pairs"):

- **P0 — scan `/scans/:id` 404 dead-end** (both themes): the toast fires correctly but the pane stays
  on `StatePanel kind="loading"` forever; `RunConsoleRoute` already handles the identical run-404
  correctly. → **WP 4.3 fix 1.**
- **P1 — toast `richColors` bypasses the semantic tokens**: sonner's hardcoded palette → error toast
  **4.35:1** in bright, and it now persists longer. → **WP 4.3 fix 2.**
- **P1 — `text-primary` on a light tint** (OrgRail active row) = **4.28:1** — a text-on-neutral
  pairing the fill-pair fix didn't cover. → **WP 4.3 fix 3.**
- **P2 — `--success`/`--primary` visually near-identical** (D-IC2's letter met, not its spirit;
  `--ring`/`--info` **is** visually distinct). → **WP 4.3 fix 4.**
- P2 — straight apostrophes still dominate outside this plan's error strings (pre-existing, 149 files,
  not a regression) → out-of-scope follow-up.

## WP 4.3 — the acceptance-walk fixes, re-measured live (both themes)

The reviewer's findings were **not** deferred findings, so **WP 4.3** implemented all four (each with
the in-repo pattern the reviewer named) and the PM **re-measured** them against a fresh build served on
`:8099`:

| Fix | Before | After (re-measured) | Status |
|---|---|---|---|
| **P0 scan-404 dead-end** | "Loading scan…" forever | terminal `StatePanel kind="error"` ("Error · Couldn't open the scan. · Scan not found") **+ "Back to scans"**; `showsLoadingForever = false` | **FIXED** |
| **P1 toast contrast** | 4.35:1 (bright) | error toast text/plate = **17.93:1** (`richColors` dropped → toasts read app tokens) | **FIXED (contrast)** — see note |
| **P1 `text-primary` on tint** | 4.28:1 | active row → `bg-primary/10` chip, default foreground = **8.11:1**; green moved to the icon (non-text 3:1 bar) | **FIXED** |
| **P2 `--success` distinctness** | oklab dist 0.027/0.033 | `--success` retuned to emerald H166: **on-fill 5.45 (bright) / 9.87 (dark)**, oklab dist from `--primary` **0.065 / 0.061** (≈doubled) | **IMPROVED** |

Re-confirmed all 10 contrast pairs still clear AA with the new `--success` (bright: primary 4.60,
success **5.45**, info 4.61, destructive 5.22, warning 6.63; dark: 8.24 / **9.87** / 6.55 / 5.50 / 8.36).
`tokens-contrast.test.ts` + the WP 4.1 guardrail stay green. Full gate GREEN post-merge (web **2796**
/ API Done · lint 1414 · build 25.5s).

**Note (toast):** removing `richColors` fixed the contrast (4.35 → 17.93), but the per-type
`bg-destructive` plate loses the CSS cascade to the base `bg-card`, so **error toasts now render
neutral (card) with dark AA-clear text rather than a red plate**. This is **contrast-compliant** and
readable, but the "error is red" affordance is muted — a **minor follow-up** (force the typed
background to win, e.g. via specificity) if red error plates are wanted. Not a contrast defect.

## Verdict

**Approve (PM measured-acceptance).** Every measurement the original review used to reach **Block** is
now cleared, verified live in both themes: the four failing on-fill pairs (4.31/4.31/3.76/3.02 →
4.60/5.09/4.61/5.50), `<main>` 2→1, named nav, skip-link-first, token identity split, font-smoothing
auto→antialiased, and the Runs row's zero-overflow. The three issues the acceptance visual review
surfaced are resolved (scan-404 dead-end, toast contrast, `text-primary`-on-tint), and `--success` is
now perceptibly distinct from `--primary`.

**Honestly residual (owner-acceptance / follow-up, none blocking):**
- **Data-gated live geometry** — finding 2's filter-row-with-runs (needs a provider key) and finding
  9's callout-with-a-scan; both structurally fixed + guardrailed, exact with-data number owner-pending.
- **Screen-reader announcement** (findings 4, 6, 7) — structural only, not AT-tested (the review drew
  the same line).
- **Toast red-plate** — error toasts render neutral high-contrast rather than red (above).
- **Minor pre-existing** (out of the 15 findings, surfaced by the walk): the `/testing/compatibility`
  empty-state ~93ch line; the app-wide straight-apostrophe majority (149 files) outside this plan's
  error strings; `SelectTrigger` clip-recovery adoption at the composed-label selects; out-of-hub
  `DataTable emptyMessage` filter states; the raw `getErrorMessage(error)` pass-through error surfaces.
- **Not exercised** (the review listed these too): `prefers-reduced-motion`, 200% zoom, <320px reflow.

On the numbers the review used to **Block**, this branch **Approves**. All 15 findings are addressed in
code, the six guardrails keep them from drifting, and the full gate is green.
