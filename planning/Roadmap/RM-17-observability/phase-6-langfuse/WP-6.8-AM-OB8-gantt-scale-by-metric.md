---
type: "Work Package Spec"
title: "WP 6.8 (AM-OB8) — scale the run Gantt by tokens or cost, with cache segments"
description: "A \"scale bars by\" selector on the nested run timeline so a step's bar length shows what it consumed rather than only how long it took — blocked on a genuine upstream Gantt gap."
tags: ["roadmap", "RM-17"]
timestamp: "2026-08-21T16:05:00Z"
status: "draft"
---
# WP 6.8 (AM-OB8) — scale the run Gantt by tokens or cost, with cache segments

## Verification finding

**The Gantt is purely time-scaled and the upstream component has no value axis at all. This item
carries an upstream gap the amendment did not flag.**

The shipped nested Gantt (WP 3.2) is `apps/web/src/features/testing/RunGantt.tsx` (369 lines), mounted
from `AnalyticsPanel.tsx:178` as the Timeline sub-tab. It uses `Gantt` from
`@elabs-ai/components-charts` (imports `:5-13`, rendered `:341-366` as `<Gantt>` + `<Gantt.Toolbar />`
+ `<Gantt.Body …>`).

**Bar length today is purely wall-clock time.** `buildTasks()` (`:124`) sets `start: step.startedAt` /
`end: step.endedAt` per bar — `:138-139` (`llm_response`), `:149-150` (`tool_call`), `:167-168` (the
WP 3.2 nested `tool_io` child with `parentId`, `:160-172`). The domain is
`[min startedAt, max endedAt]` + 2% padding (`buildDomain`, `:178-197`); horizontal pixels come from
`canvasWidth`/`pxPerDay` (`:356-357`) via `resolveCanvasWidth` (`:243-252`). Nesting is
`GanttTask.parentId` only.

**The upstream `Gantt` has no value/quantity axis — this is a real gap.** From the installed
`@elabs-ai/components-charts@4.0.0` `.d.ts`:

- `GanttTask` (`:4094-4113`) is `id`, `name`, `start`, `end`, `progress?` (a 0–1 **fill ratio inside**
  the bar, not a length), `status?`, `parentId?`, `isMilestone?`, `dependencies?`, `baseline?` (a
  *second time range*, `:4218-4221`), `type?`.
- `GanttProps` (`:4280-4377`) — every scale-ish prop is time: `viewMode`, `defaultViewMode`,
  `viewModes`, `scales`, `pixelsPerDay` / `defaultPixelsPerDay` / `onPixelsPerDayChange`,
  `zoomBounds`, `highlightTime`, `markers`. The docs are explicit at `:4127`: "`pixelsPerDay` … means
  pixels per 86 400 000 ms at every granularity".
- The **only** escape hatch is `renderBar?: (task: ResolvedTask) => ReactNode` (`:4338-4344`) —
  "Custom **LEAF**-bar renderer (escape hatch). Your node fills the bar rect … the button shell
  (selection, keyboard editing, pointer drag, tooltip, baseline) is preserved." It is unused in this
  repo, and it explicitly does **not** apply to summary brackets or milestones.

So a metric-scaled bar means either synthesising fake `start`/`end` values on a pseudo-time domain
(a lie the tooltip, the axis and the toolbar would all contradict) or abandoning `Gantt` for that mode.
Neither is acceptable under `.claude/rules/library-first.md`. **`renderBar` can carry a *segmented*
bar** (part two of this item) but it cannot change bar *length*.

The per-step economics this needs **do** exist, from WP 3.2 —
`apps/web/src/features/testing/analytics-derive.ts`:

- `StepCumulativeKpi` (`:605`) = `{ tokensIn, tokensOut, costUsd, cacheReadTokens?, cacheWriteTokens? }`.
- `StepEconomics` (`:619`) = `{ tokensInDelta, tokensOutDelta, costUsdDelta, cacheReadDelta: number|null,
  cacheWriteDelta: number|null, durationMs: number|null }`.
- `derivePerStepEconomics(steps, cumulative)` (`:685`) diffs consecutive snapshots; `judge_call` spans
  are special-cased from the payload (`judgeCallEconomics`, `:651`); **`cacheDelta()` (`:671`) returns
  `null` = UNKNOWN unless both endpoints carry the field — never a fake 0** (D-CT6).
- `rollupSubtreeEconomics` (`:736`) rolls a parent plus descendants (duration deliberately not summed).
- Raw per-step usage is also on the wire: `RunStep.usageActual?: TokenUsageActual`
  (`packages/shared/src/types.ts:1558`), carrying `cacheReadTokens?` / `cacheWriteTokens?` / the merged
  `cachedInputTokens?` (`:1367-1378`), with `CostBreakdownSplit = "exact"|"merged"|"none"` (`:1391`)
  governing honesty.

⚠ **One asymmetry that shapes the design:** the **live console's own `kpiByStepId` map does not carry
the cache fields** — `analytics-derive.ts:610-615` states it outright ("The run report's `stepKpis`
does; the live console's own map does not, so its chips stay cache-silent"). Cache segments will be
available on a replayed/report run and `null` on a live one. That must render as "not measured", not as
an empty segment (D-CT6).

**Verdict: NOT BUILT.**

## Goal

Afterwards an operator looking at a run's timeline can ask "where did the money go?" as directly as
they can already ask "where did the time go?" — the long bar stops being the slow step and starts
being, on demand, the expensive one; and a step whose input was mostly served from cache looks
visibly different from one that paid full price to write the cache.

## Scope — two halves with very different risk

**Half 1 — "scale bars by" tokens/cost. Blocked on an upstream decision; do not start it blind.**

The upstream `Gantt` cannot express a non-time length. The three honest options, in preference order:

1. **Raise the gap with the owner** (`.claude/rules/library-first.md`): `@elabs-ai/components-charts`
   `Gantt` needs a value-scaled mode, or a horizontal ranked-bar variant that keeps the
   parent/child nesting. **This is the recommended first action of this WP**, and the WP should not
   proceed to code until the answer is known.
2. **Compose from a different existing primitive.** A metric-scaled, nested, ordered bar list is closer
   to a stacked/ranked `BarChart` than to a Gantt. Rendering the "scale by tokens/cost" mode as a
   *different component* — not a lying Gantt — is composable from what is exported today and is the
   fallback if (1) is declined. It also sidesteps `renderBar`'s leaf-only limitation.
3. **Do not** synthesise pseudo-timestamps to bend `Gantt`. The toolbar, axis, tooltip and
   keyboard editing all interpret those values as time; faking them produces a control that
   contradicts itself.

**Half 2 — per-span cache/usage segments. Unblocked, and independently useful.**

`renderBar` (`.d.ts:4338-4344`) preserves the button shell and lets a leaf bar draw its own content, so
a leaf bar can carry a stacked cache-read / cache-write / uncached segmentation sourced from
`StepEconomics.cacheReadDelta` / `cacheWriteDelta`. **D-CT2 binds:** a cache read and a cache write are
never one merged segment — they are two, with distinct treatment, because one is a discount and the
other a premium. **D-CT6 binds:** a `null` delta renders as "not measured", never as a zero-width or
absent-therefore-zero segment; on a live run that is the normal case (see the asymmetry above), so the
not-measured state is the common path, not an edge case.

Richer usage-type segments (reasoning, audio, image) depend on **AM-OB6** having created those types
at all; until then the segmentation is cache-only.

## Files

Modify:

- `apps/web/src/features/testing/RunGantt.tsx`
- `apps/web/src/features/testing/RunGantt.test.tsx` (**faithful-stub — extend, see Acceptance 5**)
- `apps/web/src/features/testing/AnalyticsPanel.tsx` (the mode selector, if it belongs in the sub-tab
  chrome rather than the Gantt toolbar)
- `apps/web/src/features/testing/analytics-derive.ts` (only if a new pure rollup is needed — prefer
  reusing `rollupSubtreeEconomics`)
- `apps/web/src/features/testing/analytics-derive.test.ts`

Add, only if option (2) is taken:

- a separate metric-scaled bar component under `apps/web/src/features/testing/`, with its own
  faithful-stub test.

Untouched on purpose: `packages/shared/**` (the economics types already carry everything needed),
`apps/api/**`, `apps/api/src/db/**`.

**This item is file-disjoint from every other Phase 6 item** — it is the safest one to run in parallel
with anything.

## Non-goals

- **No pseudo-time synthesis** to force a value scale into `Gantt`.
- No hand-rolled Gantt, no second charting library, no `@elabs-ai/components-*` version bump
  (owner-gated, lockstep).
- **No merging of cache read and cache write** into one segment (D-CT2), and no zero-width segment
  standing in for unknown (D-CT6).
- No editing on the timeline — it stays a read-only lens; the upstream drag/resize callbacks stay
  unwired.
- No change to the time-scaled default. Time stays the default mode; this adds an option.

## Dependencies

- Depends on shipped WP 3.1 (step hierarchy) and WP 3.2 (per-step economics + the nested Gantt) — both
  done — and on **RM-33** for the cache split semantics (D-CT2, D-CT6).
- **Half 2's richer usage-type segments depend on AM-OB6 (WP 6.6)**; the cache-only segmentation does
  not.
- **Half 1 depends on an owner decision** about the upstream gap, which is outside this repo. Treat
  that as the WP's first action, not as a blocker discovered mid-implementation.
- File-disjoint from every other Phase 6 item.

## Migration

**None.** Web-only. `apps/api/src/db/{database,schema}.ts` must be a zero-line diff.

## Acceptance

1. The upstream gap is **raised and answered before code is written**, and the answer is recorded in
   the RM-17 decision log — either an upstream `Gantt` value-scale mode is coming, or option (2) is
   chosen, or half 1 is dropped. A WP that ships a pseudo-time hack fails this criterion outright.
2. If half 1 ships: a "scale bars by" selector offers time (default) / tokens / cost; switching modes
   re-scales bar lengths consistently with the KPI rail totals for the same run, and the axis, tooltip
   and any zoom control describe the **selected** quantity, never time-labelled token values.
3. Leaf bars carry a cache segmentation with **cache read and cache write as separate segments**
   (D-CT2), asserted by test.
4. A step whose cache delta is `null` renders as **"not measured"** — not a zero segment, not an empty
   bar — and a *live* run (whose `kpiByStepId` carries no cache fields, `analytics-derive.ts:610-615`)
   renders that state cleanly across the whole timeline. Asserted by a test for both the live and the
   replayed shape.
5. **Faithful-stub chart test (mandatory).** `RunGantt.test.tsx:6-90` is already a faithful stub — it
   re-implements the three pure barrel helpers (`GANTT_UNIT_MS`, `pickGanttTimeUnit`,
   `computeGanttZoomBounds`) and renders each `GanttTask`'s `name` + `parentId` as assertable DOM while
   recording `viewMode`/`viewModes`. **Extend it**, do not replace it: capture whatever prop carries the
   new scale, and capture `renderBar` output so the segments are assertable. The blind spot this
   guards against is recorded in the ledger for 2026-07-17 — 32 web suites mock
   `@elabs-ai/components-charts` as inert no-ops, so a mis-wired chart passes the gate silently.
   **Verify the stub bites: break a prop deliberately and watch it go red before ticking.**
6. Degrades gracefully: a run with no computed economics renders the time-scaled timeline exactly as
   today, with the new mode disabled and its reason exposed via the tooltip + `aria-describedby`
   (`.claude/rules/icon-affordances.md` D-TB5), never a silently dead control.
7. Both themes and a keyboard pass over the mode selector and the segmented bars — or recorded as an
   owner-acceptance line rather than claimed.
8. Gate green (`pnpm typecheck && pnpm test && pnpm build && pnpm lint`).
