# UX Overhaul — Program-wide verification report (WP 5.1)

**Date:** 2026-07-06
**Branch:** `wp/ux/5.1` (forked from `ux/integration`; Phases 0–4 all merged)
**Verifier:** WP 5.1 agent (honest QA sweep — verify & report, no defect fixes)
**App under test:** worktree build served at `http://127.0.0.1:8181` on a **fresh, comprehensively-seeded** `data-wt` DB (2 servers, 9 scans incl. 1 failed + a 55-tool scan, 1 skill, 2 providers, 2 environments, 2 collections + Local, 3 tests, 12 runs across completed/error/aborted, 2 suite runs). Seed scripts: `.wp-evidence/5.1/seed-api.sh` + `seed-db.mjs`.
**Evidence dir:** `.wp-evidence/5.1/` (git-ignored) — screenshots in `shots/`, measurement JSON, `gate.log`, seed scripts.

## Quality gate — GREEN (`.wp-evidence/5.1/gate.log`)

Run from the worktree root with `corepack pnpm@9.15.4`:

| Gate | Result (final line) |
|---|---|
| `typecheck` | `apps/web typecheck: Done` / `apps/api typecheck: Done` — all packages green |
| `test` | `# tests 867 / # pass 867 / # fail 0` — `apps/api test: Done` |
| `build` | `apps/web build: ✓ built in 24.28s` — `Done` (shared + api + web) |
| `lint` | `Checked 542 files … No fixes applied.` (Biome clean) |

All four green on this branch.

---

## The 9-item sweep

Verdict key: **PASS** (met, cited evidence) · **PARTIAL** (met in part / could not fully drive) · **FAIL** (not met).

### 1. Shell walk (S16) — **PARTIAL**
Measured `<h1>` `getBoundingClientRect()` + top-bar breadcrumb across every route (CDP; `measure.mjs`, `measure-shell.json`).

**Title position — PASS (pixel-identical).** Full-width routes all render the title at **x=282, y=66, 15px/600**: `/dashboard`, `/testing/runs`, `/settings`, `/scans`, `/compare/scans`, `/testing/collections`. Master-detail detail panes render at **y=66** too (`/servers/:id` x=518 — further right only because of the list rail, which is expected for master-detail). This is the S16 "title does not move a pixel" bar, met.
Evidence: `shots/01-shell-{dashboard,runs,servers,settings}-{bright,dark}.png`, `measure-shell.json`.

**Breadcrumb-on-every-route — FAIL (inconsistent).** The audit fix is "top bar **always** carries the breadcrumb." Reality (from `App.tsx` `breadcrumbs` memo, lines 659–710, and live measurement):
- **Has** a top-bar breadcrumb: `/settings` (Home›Settings), `/testing/environments`, `/testing/compatibility`, and all detail routes (`/servers/:id`, `/skills/:id`, `/scans/:id`, collection detail, console, compare).
- **No** breadcrumb: `/dashboard`, `/testing/runs`, `/scans` (list), `/compare/scans`, `/testing/collections` (list), `/skills` (list).

The code comments frame depth-1 roots as intentionally crumb-less — but that is internally inconsistent (Settings/Environments/Compatibility are *also* depth-1 roots yet were given a `Home ›` crumb) and contradicts the audit's stated acceptance. **Follow-up A.**

**Skills detail has no page `<h1>` — FAIL (known).** On `/skills/:id` the only `<h1>` is the markdown-rendered content heading at y=984 (16px/400); the page title "vendor-investigatory-analysis" is a `SectionHeader` (`<h2>`). This is the STATUS carry-forward "→ WP 5.1: SkillInspector uses SectionHeader". **Confirmed, not new. Follow-up B.**

**Compatibility has no `<h1>` — FAIL (minor, appears new).** `/testing/compatibility` returns `h1count=0`; the visible title "MCP × Model compatibility" is not a semantic h1. Same class of gap as Skills. **Follow-up C.**

Both themes captured for every shell stop. Renders correctly in both.

### 2. Tab walk (S21) — **PASS**
Clicked every tab and measured tablist `top`/`left` + active-panel `top` (`tabwalk.mjs`):

| Surface | Tabs | tablist top | tablist left | panel top | Result |
|---|---|---|---|---|---|
| Server detail | Overview·Tests·Tools·Resources·Prompts·Scans (6) | 193 (all) | 518 (all) | 235 (all) | strip never moves ✓ |
| Skill detail | Overview·Design·Trace·Quality·Files·Versions·Diff (7) | 171 (all) | 518 (all) | 207 (all) | strip never moves ✓ |
| Collection | Tests·Suites·Git (3) | 141 (all) | 282 (all) | 190 (all) | strip never moves ✓ |
| Console | Chat·Trace·Analytics·Network·Console·Application (6) | 207 (all) | 269 (all) | 244 (all) | strip never moves ✓ |

Strip position and content offset are **constant to the pixel** across every tab on all four surfaces; tabs are left-flush at the content column (D-UX4). Content does not repeat the tab label as a heading (server Overview shows "Findings"/"Token distribution" cards, not an "Overview" heading — `shots/01-shell-servers-bright.png`).
*Note (not a failure):* the console exposes **6** tabs (Chat/Trace/Analytics + a Network/Console/Application inspector trio), not the "3" the acceptance text anticipated — but stability holds across all 6.

### 3. Scroll walk (S22) — **PASS (compat, proven) / PARTIAL (others, could not force overflow)**
- **Compatibility Tool × Model (55 rows, real overflow): PASS.** After scrolling to a mid-list position (rows scrolled to `acme_get_sheet25`…), the **model-name column header row stays pinned** and the page controls stay visible — `shots/03-scroll-compat-toolmodel.png`. (My generic `thead` selector reported a false negative — the heatmap uses a sticky header row; the screenshot is authoritative.)
- **Runs feed / server Scans tab / skill Design: PARTIAL.** At the seed size these did not produce a content-region overflow even at a 560px viewport (`scrolltest.mjs`: `scrollables:0`), so the sticky behaviour could not be *exercised*; but the shell stayed fixed in every attempt (h1 top=66, tablist top=193 constant) and these use the **same** PageShell scroll container + DataTable sticky mechanism that Compatibility proved. Not independently confirmed under real overflow due to seed volume.

### 4. Status sweep (S3) — **PASS (minor label polish outstanding)**
- `grep -rn "stopped_guardrail\|assertions_failed\|context_overflow" apps/web/src` → **only** matches in `lib/status.ts` / `components/StatusBadge.tsx` as *mapping/handling* (comments + switch cases), **never** raw-rendered in JSX. No snake_case leaks. The malformed-value path returns a safe humanized neutral chip (closes the React #130 crash class).
- Live: Runs feed renders Completed (green outline) / Aborted (gray) / Failed (red filled) / **"Completed · 1 error"** rollup — all through the shared `StatusBadge` (`shots/01-shell-runs-dark.png`); scan Failed badge on server/dashboard likewise; `ScanStatusBadge.tsx` is no longer imported anywhere.
- **Minor residual:** three step-level chips pass the **raw lowercase wire value** as `StatusBadge` *children*, overriding the sentence-cased vocabulary label: `StepLog.tsx:217`, `PacketInspector.tsx:90/165`, `StepDrawer.tsx:109` render "ok"/"error"/"complete" instead of "Completed"/"Failed" (tone is correct; label is not sentence-cased, and two use `@brand/ui`'s StatusBadge rather than the app's). **Follow-up D** (polish, not a leak).

### 5. Form sweep (S14/S19/S11/S12) — **PASS**
- **Environment editor** (`shots/05-env-editor-{bright,dark}.png`): WideDialog, left-rail sections (Model/Guardrails/Servers & skills). **Model field disabled with reason "Pick a credential first…"** until a credential is chosen (S19 dependency) + "Custom model id" escape hatch. Temperature/Top P as **slider + input with a "Provider default" state** (S12). Reasoning effort as **segmented** Default/Low/Medium/High (S12). Max output tokens placeholder "Model default" (not 1). Token-profile chips + live footprint rail. Consequence-named "Create environment".
- **Launcher** (`shots/05-launcher-bright.png`): two-path "Run a suite | Interactive session" segmented toggle (gap fixed, T5); test/environment lists with counts + "N of M" (no half-cropped rows); Repetitions bounded 1–5 (S19); Cost cap numeric with "No cap" placeholder + "$" (S12); matrix preview; footer **"Pick at least one test and environment."** with disabled Run/Save-as-suite (S14 disabled-with-reason, no silent no-op).
- **Add-server** (`shots/05-addserver-{bright,stdio-bright}.png`): URL-first wizard, Transport **segmented** URL|Local command (S12); example URL/args as **placeholders/help text, not prefilled values** (SV2 fix); stdio path uses an **Arguments list editor** ("Add argument", one-per-row) and **Environment-variables key/value row editor** ("Add variable") — **not** raw JSON textareas (S11).
- **Test editor** (`shots/05-testeditor-bright.png`): WideDialog 4-section (Basics/Grading/Metadata/Attachments), mandatory-first, dependent "System prompt override" explained, "Create test" consequence button (S17).
- *Not driven live:* the focus-first-invalid-field-on-submit behaviour (structure present; covered by WP 1.6's 47 unit tests, not re-exercised interactively here).

### 6. Responsive spot (1500 / 1200 / 1000) — **PASS**
`responsive.mjs` measured `documentElement.scrollWidth` vs `innerWidth` at all three widths for Dashboard, Runs, server detail, Console, Compare workspace, Scans, Compatibility → **`ok` (no horizontal clip) at every width**. The known ~1100px master-detail sidebar sliver (STATUS S1/S2 carry-forward) is a within-panel limitation, not a page-level body clip — **confirmed, not re-litigated.**

### 7. Both themes — **PASS**
Every screenshot captured in both `qlik-bright` and `qlik-dark`; all dark shots render correctly (`01-shell-*-dark`, `02-console-chat-dark`, `07-compat-dark`, `09-compare-summary-dark`, `05-env-editor-dark`). **Heatmap contrast re-checked in dark** (`shots/07-compat-dark.png`): amber and red cells render score + "N issues" in readable on-tint `-text` foregrounds (S5/CP1 holds in dark). Compare diff colors (green add / red remove) read correctly in dark (`09-compare-flow-dark.png`).

### 8. Cross-link walk (S20) — **PASS (with the documented sub-element limitation)**
High-value links are implemented and several verified live:
- **Findings chip → tool Breakdown** (the house pattern) — preserved (server Overview; showed "No findings" here because the latest scan is the seeded *failed* one).
- **Scan-row Δ + "Diff vs previous"** (WP 3.1) — Δ column with amber-growth marker on Dashboard + server Scan-trend ("+7,264 vs prev", `shots/01-shell-servers-bright.png`).
- **Compare launched with context** — the compare workspace next-step cards deep-link into env editor / SkillFlow trace / export (`shots/09-compare-summary-bright.png`).
- **Grade "—" → judge setup** — "enable grading" link in the compare Quality column.
- **Skill → usage / "Test this skill"** (WP 3.3) — **verified live**: the skill Overview Usage panel shows "Used by 1 environment · last run…", an env chip, recent-run row, and a "Test this skill…" button (`shots/01-shell-skills-bright.png`).
- **Error card → trace anchor** (WP 3.2) — logged as agent-live-verified in STATUS.
**Known limitation (confirmed, not new):** deep-link-to-**sub-element** — cross-links land on the right *surface* (server/environment/skill-sub-tab) but cannot pre-open the exact tool/scenario/sub-tab because those views key selection off local `useState`, not the URL (STATUS carry-forward). Surface-landing is the bar and is met.

### 9. Compare workspace walk (§H) — **PASS (first-viewport) / PARTIAL (full H5 loop)**
`shots/09-compare-summary-{bright,dark}.png` + `09-compare-flow-{bright,dark}.png`, seeded with two runs of one test (eager vs deferred env) + the attached skill.
- **§H acceptance ("which wins · how much · can I trust it") readable in the first viewport, no scrolling — PASS:**
  - *Which wins / how much:* verdict sentence **"B completed with the same outcome as A at −39% tokens and −38% cost — recommended."** + baseline-Δ matrix (Ⓐ baseline / Ⓑ −39% tokens, −38% cost, −37% peak context).
  - *Can I trust it:* honest **"Not directly comparable — No runs are graded, so output quality can't be compared — enable grading"** caveat (T9h/H8), instead of fake quality precision.
- **Change markers (H6):** "Loading eager → deferred" chip on the compare bar.
- **Next-step cards (H7):** all three rules fired from seed — "Deferred loading saved 8,020 tokens → Open environment editor", "vendor-investigatory-analysis loaded but never used → Open SkillFlow trace", "Save this comparison as a baseline → Markdown/JSON".
- **Flow mode (H4):** Tools/Skills/Cost-heat lenses + add/remove/changed/unchanged legend; two synchronized lanes; turn boundaries; LCS step alignment; and a real **skills diff** (Ⓐ "1 skill loaded · 159 tok always-on" vs Ⓑ "No skills attached").
- **H5 lossless drill loop — PARTIAL:** the verdict→Flow and step→drawer legs are present (WP 4.4/4.5); the drawer→**console**→back leg could not be fully driven because the run console needs the SSE **`run_events`** log to reconstruct, which the structural seed does not contain (see below). The "← Back to comparison" pill and drawer wiring exist in code but the round-trip was not exercised end-to-end.

---

## Failures / follow-ups for the PM (ranked)

Each becomes a small follow-up WP the PM schedules before 5.2. None are P0.

1. **A — Breadcrumb inconsistency (S16, item 1).** Depth-1 list roots (`/dashboard`, `/testing/runs`, `/scans`, `/compare/scans`, `/testing/collections`, `/skills` list) render **no** top-bar breadcrumb, while `/settings`, `/testing/environments`, `/testing/compatibility` render a `Home ›` crumb. The audit's bar is "top bar **always** carries the breadcrumb." Fix: apply one consistent rule — give every top-level root a `Home ›` (or brand-root) crumb like the three that already have it. File: `apps/web/src/App.tsx` `breadcrumbs` memo (lines ~659–710) + the `no-breadcrumb` list at line 74.
2. **C — Compatibility has no page `<h1>` (S16 semantic).** `/testing/compatibility` renders its title as a non-h1 heading (`h1count=0`). Promote to `PageHeader`/`<h1>` so the heading outline + title semantics match every other route. (Appears new; small.)
3. **B — Skills detail has no page `<h1>` (S16 semantic, KNOWN).** `SkillInspector.tsx` header uses `SectionHeader` (`<h2>`); the only `<h1>` is the markdown content. Already logged as the WP 5.1 carry-forward — swap the header to `PageHeader`. (Confirmed still open.)
4. **D — Step-level status labels not sentence-cased (S3 polish).** `StepLog.tsx:217`, `PacketInspector.tsx:90/165`, `StepDrawer.tsx:109` pass the raw lowercase wire value ("ok"/"error"/"complete") as `StatusBadge` children, overriding the vocabulary label (and two use `@brand/ui`'s StatusBadge rather than the app's). Tone is correct; drop the `children` override so the sentence-cased label ("Completed"/"Failed"/"Running") shows.

---

## Known limitations confirmed (not new — STATUS carry-forwards re-confirmed)

- **Deep-link-to-sub-element** (STATUS): cross-links resolve the correct surface but can't pre-open the exact tool/scenario/sub-tab (local `useState` selection, not URL). Re-confirmed in item 8. Owner-scope routing follow-up, not a UX WP.
- **~1100px master-detail sidebar sliver** (STATUS S1/S2): a within-panel clip at narrow widths; page-level body does not clip (item 6). Not re-litigated.
- **SkillInspector `SectionHeader` (no page h1)** (STATUS WP 5.1 carry-forward): re-confirmed (Follow-up B above).
- **Failed-scan Overview reads oddly** (STATUS owner note): with the latest scan failed, the server Overview shows Findings/Token-distribution/tab-counts of 0 while Scan-trend still shows the successful-scan growth — re-confirmed on `/servers/:id` (`shots/01-shell-servers-bright.png`). Pre-existing owner note.
- **@brand gaps** (STATUS): `@brand/data` DataTable lacks native column-pinning + row-click; `@brand/ui` Combobox has no `disabled` prop (env editor uses a disabled-Input workaround, visible in the editor); ThemeSwitcher uncontrolled. Not re-tested; carried forward.

## Owner-acceptance items (need a provider key / live owner walk — mirrors STATUS)

These genuinely could not be verified here (no provider key; structural seed can't produce a live run's SSE `run_events` log):
- **Run console live replay (WP 2.5).** On a seeded *completed* run the console shows "Pending / Waiting for the first token / Run stream connection lost" because the replay is driven by the SSE `run_events` stream (`GET /api/runs/:id` returned `events: 0`), which a structural DB seed does not contain — the console derives its bar from the **stream**, not the run row. So the S8 metric de-triplication, Analytics turn-axis, open-at-top, and "expanding every tool call never shifts the KPI rail" acceptance are **unverified** (this is exactly the STATUS WP 2.5 owner-acceptance item; the "connection lost" banner on a finished run here is the expected no-event-stream behaviour, **not** a new defect). Console *shell* + tab stability *are* verified (item 2).
- **Credential-filtered model roster with a real key (WP 2.7 / 2.10, F2/S19).**
- **Launcher cost preview with live pricing (WP 3.5, G7).**
- **Skill Trace value-aware chips / conformance overlay with a live run (WP 2.8 K4).**
- **Full H5 console round-trip** (drawer → console → browser-Back restores mode+scroll+focus) — blocked by the same run_events replay gap.
- The owner's own two-theme visual walk, keyboard-only pass, and a real compare decision on real runs (the phase-5 owner checklist).

---

## What I could NOT verify (and why) — honest summary
- Console **data** rendering / replay and the H5 console leg — structural seed lacks `run_events` (owner-acceptance; needs a real/live run).
- Runs-feed / server-Scans / skill-Design **scroll stickiness under real overflow** — seed volume didn't overflow the content region even at a short viewport; shell-fixed confirmed, sticky mechanism proven on Compatibility.
- Live **submit-time inline validation** (focus-first-error) — form structure verified; the submit interaction not driven (unit-test-covered).
- Anything requiring a **provider key** (live grades, ± skill deltas, live model rosters, live runs).

---

# Toolbar standard (Phase 6 · D-TB1–D-TB4) — verification 2026-07-11

Program: `toolbar-standard-2026-07-11.md` (WPs TB.0–TB.7), on branch **`toolbar/integration`** (cut from `main`;
`ux/integration` was already merged/stale). Reference implementation: `features/testing/RunBar.tsx` (the one-row
grammar), generalized into the shared `components/ViewToolbar.tsx` primitive (TB.0).

## Quality gate — GREEN (final, after all 8 WPs merged)
`pnpm typecheck` ✓ (3/3) · `pnpm test` ✓ (**API 1480 pass / 0 fail · web 722 pass / 5 skipped**) ·
`pnpm build` ✓ (`✓ built in ~22s`) · `pnpm lint` ✓ (`Checked 706 files, no fixes`). Gate re-run green on
`toolbar/integration` after **every** WP merge (Batch 1 · Batch 2 · TB.7).

## Two live visual sweeps (built app on :8180, seeded, Playwright/Chromium, both themes)
The committed `data/app.sqlite` is empty, so each sweep **seeded real content** (uploaded a `SKILL.md`; created a
stdio echo-fixture server + real scan; the default "Local" collection auto-exists) rather than fabricate results.
Evidence: `.wp-evidence/tb-batch1/` (17 PNGs) + `.wp-evidence/tb-final/` (35 PNGs), in the (now-removed) verify worktrees.

**Verdict: PASS across all 10 migrated toolbar surfaces in BOTH themes (`qlik-bright` + `qlik-dark`).**

| # | View | Verdict | # | View | Verdict |
|---|------|---------|---|------|---------|
| 1 | Dashboard | ✅ PASS | 6 | Runs feed | ✅ PASS¹ |
| 2 | Servers detail | ✅ PASS | 7 | Compatibility | ✅ PASS |
| 3 | Scans detail | ✅ PASS | 8 | Collections list | ✅ PASS |
| 4 | Compare scans | ✅ PASS | 9 | Collections detail | ✅ PASS |
| 5 | Skills detail | ✅ PASS | 10 | Environments | ✅ PASS |

Every surface: **breadcrumb → exactly ONE toolbar row → content.** No visible in-page H1 title, no header
description paragraph, no second header / stats-strip row. `bg-card` lift + `border-b` divider read correctly in both
themes. `sr-only <h1>` retained for assistive tech (Dashboard, the home root, has no breadcrumb by design — the
sidebar names it). Keyboard: toolbar controls reachable with a visible focus ring.

## The four decisions, checked
- **D-TB1 (breadcrumb owns identity):** ✅ every in-page H1 title + description block removed; detail identity is the
  breadcrumb leaf (servers/scans/skills/collections resolved from App state; run console via `route-crumb`).
- **D-TB2 (exactly one toolbar row):** ⚠️ **INACCURATE SIGN-OFF** — this rule was NOT enforced. **Environments** stacks a
  second `TableToolbar` and the **Dashboard Testing tab** breaks the one-row rule (audit findings B-2, C-1). Fixed by
  `roadmap/toolbar-reach` WP 1.1 (Environments) and WP 2.1 (Dashboard). The original sign-off was *"second rows (Runs
  'Group by' float + active-filter chips; Collections helper sentences; Compatibility labeled filter form) collapsed
  into the single row"*.
- **D-TB3 (assistant entry points only in the dock):** ✅ removed app-wide — Skills "Analyze recent runs", the
  **server-debug** hook, Runs per-row "Analyze", the runs Compare-Workspace "Explain", Compatibility "Explain
  failures", Scans "Reduce footprint". 6 orphaned prompt-builder files (+ their tests) deleted. Grep-confirmed the
  only remaining `openAssistant` caller is the dock toggle itself.
- **D-TB4 (one metric, one home):** ✅ Servers stats strip removed — Tools/Resources/Prompts counts stay in the tab
  badges; Startup tokens / Top-3 share / Recoverable moved into the Overview body (Recoverable de-duplicated).

## Spot-confirmations (final sweep)
Scans detail export ▾ opens (Markdown/JSON merged from two buttons); Compare-scans A/B bar reads as one toolbar (card
double-frame stripped) with `Δ tokens` intact; Collections detail `[🔒 Local] ····· [Run collection]` + Tests tab
`[search] ····· [New test]`; Skills detail `[version ▾][Upload] ····· [Publish][Download .zip]` (GitHub chip / Pull
latest correctly absent for an upload-sourced skill).

## ¹ Findings
1. **MINOR (Runs feed, ≤1100px) — the one visual defect → FIXED + re-verified (WP TB.3a).** At ≤1100px the search
   input had collapsed to icon-width and overlapped the adjacent "Type" facet (label clipped to "e") — row still one
   line, actions intact, clean by ~1280px, but a clip at a spec'd acceptance width. **Fixed** by wrapping the left
   filter cluster in a hidden-scrollbar `overflow-x-auto` container + flooring the search at `min-w-[7rem] shrink`, so
   below the fit width the row scrolls as ONE line instead of overlapping (D-TB2 preserved). **Re-verified 1100/1280/
   1500 both themes:** 1100px = one row, no overlap, Type/Status/Environment legible, date+count reachable by scroll,
   actions intact; 1280/1500 fit with no scroll. Residual (accepted, non-blocking): the hidden scrollbar means the
   date-picker/count that scroll off at ≤1100px are reached by focus-autoscroll/trackpad (keyboard-reachable).
2. **LATENT / out of toolbar scope (flag for owner, NOT fixed) — invalid `RunOutcome` → hard crash.** In
   `RunBar.tsx` `deriveRunBarView`, the TS-exhaustive `default` returns the raw string at runtime, so a *corrupt*
   outcome value crashes the Runs feed (React #130). Unreachable with valid data (it surfaced only via a seeding
   mistake); a defensive fallback would harden it. Pre-existing in the reference implementation.

## Owner-acceptance (needs a provider key / the owner's own walk — mirrors the program pattern)
- **Run console / live streaming toolbar (`RunBar`)** — a live run needs a provider key; the reference `RunBar` is
  structurally the standard but was not exercised on a live SSE stream in these sweeps.
- **Dense-content pixels on the owner's real data** — the rich reference data (barc-benchmark, 60-tool heatmaps, long
  Top-3 bars, the Overview "Recoverable" metric) lives only in the owner's running container, not the committed DB;
  toolbar structure is verified, but dense-body rendering under those views is for the owner's live instance.
- The owner's own two-theme + keyboard-only walk and sign-off before merging `toolbar/integration → main`.

## Adjacent (non-toolbar) findings surfaced during verification — for the owner
- **Committed `data/app.sqlite` is essentially empty** (0 servers/scans/runs; pre-`skills` schema). Not a bug, but PM
  visual passes had to seed their own data.
- **Migration FK-integrity abort on a fresh boot:** the DB carries orphaned `run_events`/`run_steps` rows (parent runs
  deleted); the current migration's integrity check aborts until they're pruned. Both sweeps had to delete them to
  boot. Owner should confirm whether the live DB is affected.
