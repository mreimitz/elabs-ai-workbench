# Compare Workspace — layout & design audit + redesign concept

> 2026-07-11 · Audited live at `http://localhost:8080/testing/runs/compare?ids=…&mode=flow|summary|metrics`
> (2 runs of `barc-taxi`, qlik-dark) with DOM measurements, all flow lenses, the step drawer, and the
> source under `apps/web/src/features/testing/compare/`. Follow-up to audit §H / `roadmap/ux-overhaul/`.

## 0. The two headline problems, measured

**P1 — Vertical budget.** On the audited viewport, the stack above the first run-related content:

| Zone | Height | Pinned? |
| --- | ---: | --- |
| TopNav (breadcrumb `Runs › Compare`) | 46px | yes |
| PageHeader: `Compare runs` + description + `Explain diff` row | ~104px | yes (PageShell fixed header) |
| CompareBar card (picker / chips / add-run / baseline+mode+export) | 189px | yes (`sticky top-0 z-20`) |
| Caveat band (`Not directly comparable · 1`) | 65px | yes (same sticky spine) |
| Flow lens strip + legend | 30px | **no** (scrolls away) |
| **First flow row** | **y ≈ 554px** | |

≈ 420px of that is *permanently pinned* chrome. On a 900px laptop viewport that is ~47% of the screen
forever, and the first insight lands at ~61%. Summary mode is worse: verdict at ~432px, the first data
row of the Environment matrix at ~695px (~77% down on a 900px viewport). The owner demonstrably works
around this by browsing at ~78% zoom.

**P2 — Flow grid overflow.** The lane grid renders `36px + 805px + 805px = 1659px` inside a 798px
pane. Run B is entirely off-screen; scrolling right slides A out — **the two runs are never visible
side by side**, at any window size on the audited monitor. The only horizontal scrollbar lives at the
bottom of a 2122px-tall pane (below the fold), and the sticky lane-identity header never engages, so
mid-trace you cannot tell which column is which run.

## 1. Root causes (3 small ones, not 30)

**R1 — `min-w-max` defeats the fluid grid** (`flow/FlowLanes.tsx:67`).
Rows already use `grid-template-columns: 2.25rem repeat(N, minmax(15rem, 1fr))` (fluid), and
`LaneCell` already truncates everything (`min-w-0 truncate`). But the wrapper `<div className="min-w-max">`
sets `min-width: max-content`, so every `1fr` resolves to the widest unwrapped text line (~805px, the
longest assistant sentence). One class turns a responsive grid into a fixed 1659px slab.

**R2 — Wrong scroll contract for Flow** (`CompareWorkspace.tsx:160` + `flow/FlowLanes.tsx:66`).
The page uses PageShell's default `scroll="content"`, so the *outer* region is the vertical scroller.
FlowLanes' own `overflow-auto` pane therefore grows to content height (2122px) and never scrolls
vertically → (a) its `sticky top-0` lane header can't stick, (b) its horizontal scrollbar is only
reachable at the very bottom of the page, (c) the lens strip scrolls away while less useful chrome
stays pinned. PageShell already ships the right mode for this: `scroll="fill"` (§S22).

**R3 — Chrome stacking + duplication.**
Run identity is rendered three times (bar chips → flow lane headers → Summary matrix rows); the page
title duplicates the breadcrumb; a one-item informational caveat ("no runs graded") occupies a
permanent 65px warning band *and* an `enable grading` link per matrix row *and* the caveat counts it
again; baseline gets a dedicated 32px row with explainer prose; export exists twice (bar `Export` +
Summary "Save this comparison as a baseline" card). Each is defensible alone; stacked they cost half
a laptop screen before any data.

## 2. Issue inventory

Severity: ● critical · ◐ major · ○ minor. "Where" = file under `apps/web/src/features/testing/compare/`.

| # | Sev | Issue | Where |
| --- | --- | --- | --- |
| F1 | ● | `min-w-max` → B column invisible; side-by-side never side-by-side (P2/R1) | `flow/FlowLanes.tsx:67` |
| F2 | ● | Flow not the vertical scroller → broken sticky lane header, h-scrollbar below the fold, lens strip scrolls away (R2) | `CompareWorkspace.tsx:160`, `flow/FlowLanes.tsx:66` |
| F3 | ◐ | No "changes only" / collapse-unchanged affordance — the audited trace is ~85% unchanged rows (9 identical `acme_create_data_object` cards in one turn ≈ 460px of no signal) | `flow/FlowLanes.tsx`, `flow/align.ts` |
| F4 | ◐ | Node cards: only the title text is the click target (~16px strip in a 44–68px card); no cursor/hover affordance on the card | `flow/LaneCell.tsx:111–127` |
| F5 | ◐ | Turn headers + "Runs diverge here" banner live in the scrolling width — clipped mid-word when h-scrolled (seen: "ge here"); gutter rail not sticky-left | `flow/FlowLanes.tsx:151–233` |
| F6 | ○ | 3-line card layout (title / repeated opaque id subtitle / badges) where 1 line would do; identical subtitle repeated 20× | `flow/LaneCell.tsx` |
| F7 | ○ | Divergence flag rendered twice (banner + row gutter) | `flow/FlowLanes.tsx:190, 223` |
| F8 | ◐ | The final answer — the run's actual output — is buried as the last `answer` cell of whatever turn it landed in. Turn-indexed align keys (`answer@t{n}`, `build-flow.ts:60`) mean A's answer (turn 5) and B's (turn 6) never sit side by side, and each shows only a one-line clamp | `flow/build-flow.ts:53–66`, `flow/FlowLanes.tsx` |
| S1 | ◐ | Verdict (the answer: "B vs A: +26% tokens…") renders *below* the caveat band; first data row ~695px down (P1) | `SummaryMode.tsx:143`, `CompareWorkspace.tsx:183` |
| S2 | ◐ | "Next steps" (incl. the export card duplicating bar `Export`) sits *above* the Environment matrix — actions before evidence | `SummaryMode.tsx:146`, `next-steps/NextSteps.tsx` |
| S3 | ○ | Ungraded stated 3×: caveat band + per-row `enable grading` links + "vs ungraded" | `VerdictBand.tsx:98`, `matrix/DeltaMatrix.tsx:246–273` |
| S4 | ○ | ContextCurves: no y/x axis labels or ticks — magnitudes unreadable; legend disambiguates identical run names only by chip colour | `matrix/ContextCurves.tsx` |
| S5 | ○ | Single stacked column wastes wide screens (matrix, bars, curves could share rows ≥1400px); page ignores its own §C "centered composer" width rule | `SummaryMode.tsx:139` |
| C1 | ◐ | CompareBar renders as 4 wrapped rows (189px): chips carry name+model+time+status+×, baseline row is prose | `CompareBar.tsx:148–227` |
| C2 | ◐ | Permanent 65px caveat *band* for informational, non-blocking caveats; ambiguous bare count badge ("1") | `VerdictBand.tsx:91–128` |
| C3 | ○ | PageHeader (title + marketing description + `Explain diff` as its own row) duplicates the breadcrumb; ~104px pinned | `CompareWorkspace.tsx:110–126` |
| M1 | ◐ | Metrics tab ships a placeholder with internal jargon ("built in WP 4.2/4.3") as user-facing UI | `MetricsMode.tsx` |
| D1 | ○ | Step drawer Overview: grid of "—" placeholder fields + a mostly empty sheet; payload preview should lead | `StepDrawer.tsx:120–156` |

Verified fine: URL state (mode/focus deep links, `returnTo` round-trip), LCS alignment + "not run"
gaps, drawer reuse of `PacketTabs`, letter-chip identity concept, caveat-before-verdict honesty (T9h),
lenses (Tools/Skills/Cost heat) all render. The bones are good — the frame is what's wrong.

## 3. Redesign concept — "one bar, one scroller, changes first"

Design intent: **the workspace chrome is one compact command bar; each mode owns exactly one scroll
region; unchanged content collapses so difference is the default view.** Target: first run insight
< 200px from the viewport top in every mode, and all lanes always visible.

### 3.1 The frame (all modes)

```
┌ TopNav (breadcrumb: Runs › Compare)                                46px ┐
├ Workspace bar (ONE row, wraps to 2 <1200px)                       ~48px ┤
│  [test ▾]  Ⓐ chip · Ⓑ chip · [+]   ⚠1   | Summary Flow Metrics | ⤓ ✦ │
├ Mode surface = the ONLY scroll container (PageShell scroll="fill")      ┤
```

- **Kill the PageHeader block** on this route: the breadcrumb already names the page. Keep an
  `sr-only` h1 for a11y. `Explain diff` (✦) and `Export` (⤓) move into the bar's right cluster.
  If S16 "identical title x/y" must hold app-wide, add a sanctioned PageShell `header="toolbar"`
  variant (the run console wants the same). −104px.
- **Compact chips**: letter badge + truncated env name + status *dot* (~150px each). Model, wall
  clock, remove ×, and **Set as baseline** move into a chip popover (click). The baseline chip keeps
  the ring; "Δ vs Ⓐ" renders as a muted suffix beside the mode toggle. Kills chip wrapping, the
  baseline row, and its explainer prose. 189px → ~48px.
- **Caveats become a chip**: `⚠ 1` in the bar; popover lists the sentences. No permanent band. In
  Summary the verdict line carries the same chip inline. −80px. (Blocking caveats — mixed tests —
  may still render a band; informational ones never.)
- **Change markers** (genuinely valuable) move out of the pinned bar into the top of Summary
  ("What changed between these runs") and a Flow row above the divergence flag — content, not chrome.

Pinned chrome: ~425px → **~94px** (topnav + bar); the flow lens strip (+36px) joins the pinned
frame in §3.2 and *earns* it.

### 3.2 Flow mode

1. **Drop `min-w-max`** (R1). The existing `minmax(15rem,1fr)` + `LaneCell` truncation take over:
   2–3 lanes always fit ≥ ~820px content width. Keep `overflow-auto` purely as a floor guard.
2. **`scroll="fill"`** for the page (R2): FlowLanes becomes the one vertical scroller → the lane
   identity header *actually sticks* (this replaces the chips' duplicated identity), the lens strip
   stays pinned above the pane, any residual h-scrollbar sits at the viewport bottom.
3. **Sticky-left gutter**: the 2.25rem rail + turn labels + divergence banner get `sticky left-0`
   so they never clip on h-scroll (fixes "ge here").
4. **Collapse unchanged runs** (the big vertical win): ≥3 consecutive all-unchanged columns render as
   one 28px row — `── 7 identical steps ──` (expandable), with a `Changes only` toggle beside the
   lenses. The audited trace drops from ~2100px to ~600px.
5. **Whole card clickable** (it already looks like a button): move `onFocus` to the card as the
   button element, `cursor-pointer`, hover ring; keep icon/status inside.
6. **One-line cell** default (icon · name · tok/ms badges right-aligned); show the subtitle id only
   when it differs across lanes, else on hover/tooltip.
7. **A common `Result` section** (owner request 2026-07-11): the final answer is what the runs were
   *for* — it must not be buried in whichever turn it happened to land in.
   - After the last aligned row (and the terminal block), render a distinct full-width **Result**
     section: same lane grid, one Result cell per run, always aligned regardless of turn count.
     Never collapsed by "Changes only".
   - Cell = the lane's final `answer` node (last `kind: "answer"`; full text already on
     `FlowNode.resultText`, `build-flow.ts:63`): ~6-line clamped preview, token badge, and an
     **Expand** affordance. A run with no final answer renders its terminal error state instead.
   - **Expand opens a large modal** (largest dialog tier) titled `Result — full outputs`: one pane
     per compared run (2–3), side by side; pane header = `RunLetterBadge` + `runChipLabel` + token
     badge; pane body = the **`@brand/editor` Monaco `CodeEditor`**, read-only, `markdown`, word-wrap,
     ~70vh. Verify the exact `CodeEditor` props against the vendored `.d.ts` / `brand-ui docs editor`
     (never guess); the Monaco worker wiring already exists (`@brand/editor/monaco-environment` in
     `main.tsx`). If `@brand/editor` exposes a Monaco *diff* editor, the 2-run case may offer an
     optional unified-diff toggle — side-by-side stays the default.

### 3.3 Summary mode (the "overview")

Order by question, not by component:
1. **Verdict line** (answer) with the caveat chip inline — first thing under the bar.
2. **What changed** — the change-marker chips (from the bar) as one row.
3. **Environment matrix** (evidence). Ungraded → *one* muted `Quality — enable grading` column
   header tooltip/link, not a link per row.
4. **Δ vs baseline + Context curves side by side** ≥1400px (2-col grid), stacked below. Curves get
   minimal axes (muted y token ticks, x turn ticks); legend chips add model + relative time when
   names collide.
5. **Next steps last**, minus the export card (the bar's `Export` becomes a split button:
   Markdown / JSON). Action cards read as a footer: "now do X".

First matrix row lands ≈190px from the top (was ~695px).

### 3.4 Metrics + drawer

- **Metrics**: hide the tab until WP 4.2/4.3 lands (`RUN_COMPARE_MODES` gains a `available` flag) —
  or keep it with a `soon` Badge and copy without WP numbers. A dead tab in a 3-tab control is a 33%
  chance of disappointment.
- **Drawer**: render only known Descriptions fields (no "—" grid), lead with the response/args
  payload, keep `Open in console` in the footer. Consider `sm:max-w-2xl` only if payloads wrap badly.

### 3.5 Responsive rules (explicit, testable)

| Width (content) | Behaviour |
| --- | --- |
| ≥ 1240px | 2–3 lanes fluid, Summary 2-col analytics row |
| 820–1240px | Lanes fluid (narrower), Summary single column |
| < 820px (3 runs) / < 580px (2 runs) | Lanes hit the 15rem floor → pane h-scrolls, scrollbar visible at viewport bottom, gutter + lane headers sticky |
| < 1200px | Bar wraps to 2 rows (picker+chips / modes+actions) — the only sanctioned second row |

## 4. Implementation plan (each step ships alone, gate green)

| Step | Change | Files | Effort | Status |
| --- | --- | --- | --- | --- |
| 1 | Delete `min-w-max`; add `w-full`; verify truncation in both themes | `FlowLanes.tsx` | XS — the P2 fix is one line | ✅ WP-1 `2e7e789` |
| 2 | `scroll="fill"` + make FlowLanes own vertical scroll; lens strip pinned; sticky-left gutter | `CompareWorkspace.tsx`, `FlowMode.tsx`, `FlowLanes.tsx` | S | ✅ WP-2 `6f3fcb6` |
| 3 | Bar compaction: chip popover (model/time/×/set-baseline), kill baseline row, move Export/Explain into bar, caveat chip + popover (band only for blocking caveats) | `CompareBar.tsx`, `VerdictBand.tsx`, `CompareWorkspace.tsx` | M | ✅ WP-3 `06ca837` |
| 4 | **PageShell `headerVariant="toolbar"` variant** (D1, additive — byte-identical default) + adopt on this route (sr-only h1) | `CompareWorkspace.tsx`, `PageShell.tsx` | S | ✅ WP-3 `06ca837` |
| 5 | Collapse-unchanged rows + `Changes only` toggle (pure `flow/collapse.ts` + tests; focus auto-expands) | `flow/collapse.ts`, `FlowLanes.tsx`, `FlowMode.tsx` | M | ✅ WP-4 `03e87c2` |
| 6 | Summary reorder + dedupe (verdict+caveat chip→markers→matrix→[Δbars\|curves 2-col]→next-steps; single grading hint; export card removed — bar Export dropdown is canonical) | `SummaryMode.tsx`, `NextSteps.tsx`, `next-steps-derive.ts`, `DeltaMatrix.tsx`, `CompareWorkspace.tsx` | M | ✅ WP-5 `c9d1140` |
| 7 | Cell interaction (whole-card stretched-overlay button, popover kept clickable) + 1-line density | `LaneCell.tsx` | S | ✅ WP-6 `4bebeb0` |
| 8 | **Metrics tab kept with a `Soon` Badge + honest empty state** (D2); curve axes (fixed a `@brand/charts` XAxis duplicate-tick bug) + legend model/time; drawer content-first | `compare-runs.ts`, `MetricsMode.tsx`, `CompareBar.tsx`, `ContextCurves.tsx`, `StepDrawer.tsx`, `summary-derive.ts` | S | ✅ WP-6 `4bebeb0` |
| 9 | **Result section + side-by-side output modal** (§3.2·7): aligned Result row per lane (`#compare-result`, excluded from collapse) + WorkbenchDialog with one read-only `@brand/editor` `CodeEditor` pane per run + **2-run `Side-by-side\|Diff` toggle** (D3, `DiffEditor`) | new `flow/ResultSection.tsx` + `flow/ResultCompareDialog.tsx` + `flow/result.ts`, `FlowLanes.tsx` wiring | M | ✅ WP-7 `55b7e89` |

**Delivered 2026-07-11** on branch `ux/compare-redesign` (off `ux/integration@7e4bb05`, isolated from concurrent work). All 9 steps done in 4 waves. Central gate green on the merged tree: `pnpm typecheck` + `pnpm test` (**1376 API + 673 web** vitest) + `pnpm build` + `pnpm lint`. Visually verified in **qlik-bright AND qlik-dark** against the running app (worktree build served against the real run DB) at the reference URL. Verified outcomes: run B side-by-side (`hOverflow=0`), sticky lane header engaged, pinned chrome **416px → 183px** (run identity at 183, first aligned row at 247), unchanged rows collapse (2122px → 1355/1071px), Summary reordered (first matrix row 508px → 315px), the Result modal renders both runs' full outputs in side-by-side Monaco panes + a 2-run diff view with **no console/worker errors**. A fresh read-only review (opus) rated it **shippable, no blocker** (brand/token/a11y/loading-states clean; collapse/focus/result logic unit-tested and correct; D1–D3 + §3.3 met). Two review follow-ups were applied (`99463eb`): PageShell now honors `headerVariant` in the default `scroll="content"` path too (byte-identical for existing routes — it was a silent trap for the run console), and the `DiffEditor` comment was corrected (it renders side-by-side, not inline-unified).

Residual polish (non-blocking, for owner acceptance): (1) **the bar Export dropdown omits the computed verdict section** the old per-run-card export included (the verdict is derived in `SummaryMode`, not the shell; the metric table exports fully) — a real but minor content regression, fixable by lifting `deriveVerdict` (a run-steps fetch) to the workspace; (2) first *aligned* flow row 247px vs the <200 aspiration (run identity is <200); (3) Summary matrix 315px vs <250 (the verdict card legitimately precedes it); (4) the caveat `⚠` chip shows both in the bar and inline beside the Summary verdict; (5) curve x-ticks read as "Jan N" turn-proxies (a `@brand/charts` XAxis limitation). Not auto-merged to `ux/integration` — left as a gated branch for the owner to merge (a live concurrent session is committing to `ux/integration`; the compare work touches only `apps/web/.../compare/*` + `PageShell.tsx`, zero file overlap → conflict-free `git merge ux/compare-redesign`).

Steps 1–2 alone resolve both reported problems; steps 3–4 then cut ~330px of pinned chrome. Suggested acceptance: at 1280×800 / 100% zoom, both lanes fully visible, first flow row
< 200px from top, lane headers stick at any depth, `pnpm typecheck && pnpm test && pnpm build && pnpm lint` green,
verified in `qlik-bright` **and** `qlik-dark` against the running app.

### 4a. Owner decisions (2026-07-11) — locked before dispatch

- **D1 (step 4) → Add a PageShell `header="toolbar"` variant.** Keep the app-wide S16 "title at
  identical x/y" contract intact by making a compact command-bar header a first-class, additive
  PageShell variant (reusable by the run console) rather than a route-local exception. The compare
  route adopts it and keeps an `sr-only` `<h1>`.
- **D2 (step 8) → Keep the Metrics tab, don't hide it.** Replace the WP-jargon placeholder with an
  honest "coming soon" `EmptyState` (no WP numbers) and a `soon` `Badge` on the tab. No URL fallback
  needed; `?mode=metrics` stays valid.
- **D3 (step 9) → Add the optional 2-run diff toggle.** Side-by-side read-only `CodeEditor` panes are
  the committed default for 2–3 runs; when **exactly 2** runs are compared, offer a `Side-by-side | Diff`
  toggle backed by `@brand/editor`'s `DiffEditor` (both `CodeEditor` and `DiffEditor` are exported).

**Execution:** run on a dedicated worktree/branch `ux/compare-redesign` off `ux/integration`
(isolated from the concurrent auto-rating churn), one WP per sub-agent, gate-green ship-alone commits,
merged to `ux/integration` at the end. WPs touching `flow/FlowLanes.tsx` (1, 2, 4/collapse, 9) never
run concurrently.

## 5. Not audited / out of scope

Suite compare (`?suiteRunIds=` → `SuiteCompareMode`) — no suite-run pair available in the session;
its verdict-strip + grid should inherit the same frame rules (steps 3–4) once run-compare lands.
`Explain diff` (assistant round-trip) was not executed, only its placement reviewed.
