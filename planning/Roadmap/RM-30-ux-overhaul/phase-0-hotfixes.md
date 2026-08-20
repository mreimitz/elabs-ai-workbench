---
type: "Work Package Spec"
title: "Phase 0 \u2014 P0 hotfixes (5 WPs, all parallel, all small)"
description: "Independent, surgical fixes for the audit's P0 breakages. No foundations required. Each WP is one"
tags: ["roadmap", "RM-30"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# Phase 0 — P0 hotfixes (5 WPs, all parallel, all small)

Independent, surgical fixes for the audit's P0 breakages. No foundations required. Each WP is one
agent, one worktree, disjoint files. Audit refs in parentheses.

---

## WP 0.1 — Run-compare radar overflow hotfix (T9a)
**Goal:** the "Efficiency profile" radar no longer paints over the next card at any width/theme.
**Domain:** `apps/web/src/features/testing/` — the run-compare view + its chart component only.
Locate: `Grep "Efficiency profile" apps/web/src` → the compare view file (verify; per testing-ia
ledger the view is `CompareRunsView` or under `features/testing/runs/`).
**Steps:** (1) Find the radar chart container (measured state: 576×576 SVG in an `h-80` box,
`overflow: visible`). (2) Constrain: size the chart to its container (chart lib sizing prop or
wrapper `overflow-hidden` + correct aspect box). (3) Do NOT redesign the chart (Phase 4 deletes
it); this is containment only.
**Acceptance:** at 1600×1000 and ~1100px width, both themes: no chart pixel escapes its card; the
"Context-window curves" card below is fully legible. Gate green.
**Size:** S. **Verify:** screenshots of the compare page (`/testing/runs/compare?ids=…` — pick any
two runs of one test) both themes.

## WP 0.2 — Kill the false "Run completed" toast (S13/T6a)
**Goal:** opening an already-finished run console never fires a completion toast; toasts fire only
on a live phase TRANSITION observed during the session.
**Domain:** `apps/web/src/features/testing/use-run-stream.ts` (verified path) + the console
component that raises the toast (locate: `Grep "Run completed" apps/web/src`).
**Steps:** track whether a terminal status was ever seen as non-terminal in THIS session
(`wasLiveRef`); toast only on live→terminal transition. Also move the toast viewport below the
header bar if the fix exposes the overlap (S13 second half) ONLY if it's a one-liner on the
Toaster position; otherwise report it.
**Acceptance:** open 3 different completed runs → zero toasts; a genuinely live run (simulate by
reasoning through the stream states in tests if no provider key) still toasts once on completion.
Add/extend a unit test on the stream hook if the file has tests. Gate green.
**Size:** S.

## WP 0.3 — Route-parent redirects (C1)
**Goal:** every parent path a user can guess lands somewhere real: `/compare` →
`/compare/scans`; audit `/testing`, `/skills`, `/servers`, `/scans` parents the same way.
**Domain:** `apps/web/src/App.tsx` (hot file — route lines only).
**Steps:** add `<Navigate replace>` index/parent redirects; enumerate existing routes first
(`Grep "path=" apps/web/src/App.tsx`) and cover every parent that currently falls through to the
dashboard catch-all.
**Acceptance:** direct navigation to each parent URL lands on the section's default view, not the
dashboard; deep links unchanged. Gate green.
**Size:** S. **Parallel note:** touches a hot file — PM merges this batch's App.tsx edits last.

## WP 0.4 — Streamed-text join fix (T6e)
**Goal:** adjacent assistant text segments render with proper separation — no more
"Let me begin!Now let me search".
**Domain:** `apps/web/src/features/testing/ChatMarkdown.tsx` + `ConversationPane.tsx` (verified
paths) — whichever concatenates text parts.
**Steps:** find where message text parts are joined/accumulated; join with `\n\n` (or preserve
part boundaries as separate paragraphs). Guard against double-joining mid-stream deltas (deltas
within one part still concatenate raw — only PART boundaries get separators; check how parts vs
deltas are distinguished in the stream payload before coding).
**Acceptance:** the run `9JThXmPbkW2zh8JeINxGy` (Banking-Benchmark-Simple) chat shows
"Let me begin!" and "Now let me search…" as separate paragraphs; no double blank lines inside a
single streamed sentence. Gate green.
**Size:** S.

## WP 0.5 — Heatmap state-cell contrast tokens (S5/CP1)
**Goal:** compatibility heatmap cell text is readable in BOTH themes for green/amber/red cells.
**Domain:** `apps/web/src/features/compatibility/` (verified folder).
**Steps:** find the cell background/text styling (likely raw opacity tints). Define paired
fg/bg per state using existing semantic tokens (e.g. text stays `text-foreground` on soft tinted
backgrounds, or use the tokens' state colors at proper strength) — NO raw hex (check-tokens hook).
If `@elabs-ai/components-tokens` lacks a usable on-state pair, choose token-based tints that pass ~4.5:1 in both
themes and file the upstream gap in your report (library-first rule).
**Acceptance:** score + "N issues" legible on every cell color in light AND dark
(screenshots of both, Server×Model and Tool×Model views). Gate green.
**Size:** S–M.
