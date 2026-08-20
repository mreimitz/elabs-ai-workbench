---
type: "Work Package Spec"
title: "Handover prompt \u2014 Compare Workspace redesign (paste verbatim to the orchestrating agent)"
description: "You are the orchestrator for the Compare Workspace redesign in mcp-token-footprint. You run"
tags: ["roadmap", "RM-30"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# Handover prompt — Compare Workspace redesign (paste verbatim to the orchestrating agent)

---

You are the orchestrator for the **Compare Workspace redesign** in `mcp-token-footprint`. You run
Opus 4.8 and delegate work packages to subagents in isolated worktrees, choosing each subagent's
model per the model policy below. Work from the repo root `mcp-token-footprint/`.

## Mission

Rebuild the layout/interaction frame of `/testing/runs/compare` per the approved concept in
`roadmap/ux-overhaul/compare-redesign-2026-07-11.md` (read it FIRST — it is the spec; this prompt
only sequences it). Outcomes, in priority order:

1. Flow lanes always fit the container — both runs visible side by side at any window ≥ ~1024px
   (today a `min-w-max` forces a 1659px grid into a 798px pane and run B is off-screen).
2. Pinned chrome shrinks ~425px → ~94px; first run insight < 200px from the viewport top in every
   mode (today: Flow ~554px, Summary ~695px).
3. One scroll container per mode with *working* sticky lane headers (today `scroll="content"` +
   a grown inner pane breaks the sticky and hides the h-scrollbar below the fold).
4. A common **Result** section at the end of Flow: the final answer of every run aligned side by
   side (never buried in its turn), with an Expand → large modal showing all runs' full outputs in
   side-by-side read-only `@elabs-ai/components-editor` Monaco `CodeEditor` panes.
5. Summary reordered: verdict → what changed → matrix → charts → next-steps; dedup of caveat/export.

## Required reading (in this order, before any code)

1. `roadmap/ux-overhaul/compare-redesign-2026-07-11.md` — the audit + concept + step table (§4).
2. `CLAUDE.md` §8–§9, `.claude/rules/brand-ui-only.md`, `styling-and-tokens.md`,
   `quality-gates.md`, `interaction-guidelines.md`, `loading-states.md`.
3. The feature source: `apps/web/src/features/testing/compare/` (all files),
   `apps/web/src/components/PageShell.tsx`, `PageHeader.tsx`.
4. For step 9: `vendor/brand-ui-agent-kit/` + `pnpm exec brand-ui docs editor` (or the `@elabs-ai/components-editor`
   `.d.ts`) for the real `CodeEditor` API — **never guess a prop**. Monaco workers are already wired
   via `@elabs-ai/components-editor/monaco-environment` in `apps/web/src/main.tsx`.

## Hard rules (non-negotiable, enforce on every subagent)

- Every visible element is a `@elabs-ai/components-*` component; semantic token utilities only (no raw colors,
  no `dark:`); `className` is layout-only. The `enforce-brand-ui` / `check-tokens` hooks will flag.
- No new dependencies. No API/wire changes are needed for steps 1–9 — if a subagent thinks it needs
  one, stop and escalate to me/the owner.
- Definition of done per WP: `pnpm typecheck && pnpm test && pnpm build && pnpm lint` green, PLUS a
  visual walk of the running app (`pnpm dev`, `http://localhost:8080`) in **both themes**
  (`light`, `dark`) on the reference URL:
  `/testing/runs/compare?ids=U1qOGPw1jrNm-fRXMCsKS,aflATerzm2e89u5-qfxVj&mode=flow`.
- Honest reporting: subagents must lead with what they did NOT verify; "green" means the command was
  actually run. Web tests live next to sources (`*.test.ts`); extend them where logic changes
  (`flow/align.ts` grouping, `compare-runs.ts` mode gating).
- Keep the URL contract (`?ids&baseline&mode&focus`) intact — deep links and `returnTo` round-trips
  must keep working. `focus` tokens must keep resolving after any row regrouping.
- Accessibility: keyboard reachable, visible focus, real buttons (no div-as-button), labels — the
  whole-card click target in step 7 must remain a semantic button.

## Model policy for subagents

| Model | Use for | Steps |
| --- | --- | --- |
| **opus** | Design-sensitive composition, new UX surfaces, anything with layout judgement or component-API discovery | 3, 4, 9 |
| **sonnet** | Well-specified mechanical/refactor work with clear acceptance, pure-logic + tests | 1, 2, 5, 6, 7, 8, all test-writing |
| **haiku** | Trivial sweeps only (grep audits, lint fix-ups, doc ticks) | verification chores |
| **opus (fresh, read-only)** | Final review pass: token/brand audit + both-theme visual review + a11y spot-check of the whole feature | final gate |

One WP per subagent, isolated worktree, rebase-and-gate before merge. Never let two subagents touch
`FlowLanes.tsx` concurrently.

## Execution waves (step numbers = §4 of the concept doc)

**Wave 0 — owner decisions (ask BEFORE dispatching, do not assume):**
- D1: Step 4 removes the PageHeader block on this route (breadcrumb + sr-only h1). This bends the
  S16 "identical title x/y" contract — options: route-local exception vs a new PageShell
  `header="toolbar"` variant. Ask the owner which.
- D2: Step 8 hides the Metrics tab until it exists vs keeps it with a "soon" badge. Ask.
- D3: Step 9, 2-run case — offer an optional Monaco diff toggle if `@elabs-ai/components-editor` exposes one? Ask
  (side-by-side is the committed default either way).

**Wave 1 (parallel, sonnet):**
- **WP-1 (step 1)** — delete `min-w-max` in `flow/FlowLanes.tsx:67` (replace with `w-full`); verify
  lanes go fluid (`minmax(15rem,1fr)`), cells truncate, no layout regressions in either theme.
  Acceptance: at 1280×800 both lanes fully visible, zero horizontal scroll.
- **WP-2 (step 2)** — scroll contract: `scroll="fill"` on the compare `PageShell`; FlowLanes becomes
  the only vertical scroller; lens strip pinned; gutter/turn labels/divergence banner `sticky left-0`.
  Acceptance: lane identity header visibly stuck at any scroll depth; h-scrollbar (if forced by a
  narrow window) visible at the viewport bottom; Summary/Metrics modes still scroll correctly.

**Wave 2 (after wave 1 merges):**
- **WP-3 (steps 3+4, opus)** — bar compaction + header removal per §3.1: one-row workspace bar,
  chip popovers (model/time/remove/set-baseline), caveat `⚠ n` chip + popover (band only for
  blocking caveats), Export split-button (Markdown/JSON), `Explain diff` into the bar, PageHeader
  per D1. Acceptance: pinned chrome ≤ ~110px at 1280×800; every control keyboard-reachable; nothing
  lost (all previous actions still exist somewhere discoverable).
- **WP-4 (step 5, sonnet)** — collapse ≥3 consecutive all-unchanged columns into an expandable
  "— N identical steps —" row + `Changes only` toggle beside the lenses. Pure grouping in
  `flow/align.ts` (or a derive layer) with unit tests; `?focus=` into a collapsed group must
  auto-expand it. Acceptance: audited trace shrinks ~2100px → well under 1000px with lenses intact.

**Wave 3 (parallel after wave 2):**
- **WP-5 (step 6, sonnet)** — Summary reorder + dedupe per §3.3 (verdict first, change markers as
  content, one grading hint, next-steps last minus the export card).
- **WP-6 (steps 7+8, sonnet)** — whole-card click target + one-line cell density; Metrics tab per
  D2 (no WP jargon in user-facing copy); ContextCurves minimal axes; StepDrawer renders only known
  fields, payload first.
- **WP-7 (step 9, opus)** — **Result section + output modal** per §3.2·7:
  - `flow/ResultSection.tsx`: after the terminal block, a full-width "Result" divider + one aligned
    row (same `gridTemplateColumns`), one cell per lane = last `kind:"answer"` node (full text is on
    `FlowNode.resultText`, `build-flow.ts:63`; fall back to the terminal error state when a run has
    no answer). Cell: ~6-line clamp, token badge, Expand button. Excluded from `Changes only`
    collapsing. Also give the Result section an anchor so the verdict band can link to it later.
  - `flow/ResultCompareDialog.tsx`: largest dialog tier, title "Result — full outputs", one pane per
    run (2–3) side by side; pane header `RunLetterBadge` + `runChipLabel` + tokens; body a read-only
    `@elabs-ai/components-editor` `CodeEditor`, language `markdown`, word-wrap, ~70vh, `brand-ui-allow` never
    needed (it's a library component). Confirm props via the agent kit / `.d.ts` first. Per D3,
    optionally a diff toggle for exactly 2 runs.
  - Acceptance: with the reference URL, A's and B's full reports render side by side in the modal;
    Esc closes back to an unchanged flow; works in both themes; no Monaco worker console errors;
    build memory note: if the web build OOMs, use `NODE_OPTIONS=--max-old-space-size=3400`.

**Wave 4 — final gate (opus, read-only):** full-feature review — token audit, both-theme walk of
Summary/Flow (all four lenses)/Metrics/drawer/Result modal, keyboard pass, `pnpm` gate, then a
summary report: what changed, what was verified how, what remains (with file:line). Update the step
table in `roadmap/ux-overhaul/compare-redesign-2026-07-11.md` with per-step status ticks.

## Global acceptance (the owner's two original complaints, restated as tests)

1. At 1280×800 @100% zoom: both run columns fully visible in Flow with zero horizontal scrolling.
2. At 1280×800: first flow row < 200px from the viewport top; Summary's first matrix row < 250px.
3. Lane identity headers remain visible at any scroll depth in Flow.
4. Final answers of all compared runs are directly comparable: aligned Result row + side-by-side
   full-text modal.
5. Gate green, both themes verified by looking at the running app — per
   `.claude/rules/quality-gates.md`, claims cite what was actually run and seen.
