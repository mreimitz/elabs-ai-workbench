# WP 3.8 — Compare (test × scenario)

**Phase:** 3 · **Size:** M · **Depends on:** 3.6, 2.2

## Objective
The benchmark payoff: compare runs of the **same test across different scenarios** (Claude vs GPT vs
local) side by side.

## Why / references
UI concept [`../10-…ui-concept.md`](../../10-testing-ui-concept.md) **§8** (compare matrix wireframe).
Decision #5 (matrix). Data from `GET /api/runs/compare?ids=…` → `CompareRow[]` (WP 2.2). This is the
repo's `qlabs-ai-benchmark` reason-for-being; relates to existing `apps/web/src/lib/compare.ts`.

## Files (new)
- `apps/web/src/features/testing/CompareRunsView.tsx`

## Design
- A `@brand/data` `DataTable` of `CompareRow` for one test across scenarios: columns = scenario, model,
  tokens ↑/↓, tool calls, **peak context %**, est. cost, outcome (`StatusBadge`; overflow flagged),
  duration. `tabular-nums`; sortable.
- An **overlay** of each run's context curve (small multiples, or one overlaid `@brand/charts` chart
  using `--chart-1..5` per scenario) so shape differences are visible, not just end totals.
- Each row/cell links to that run in the console (replay, WP 3.7).
- Selection UX: pick a test → pick ≥2 of its runs (across scenarios) → compare.

## Acceptance
- Runs of one test across ≥2 scenarios compare on all columns; outcomes (incl. overflow) are clear.
- The curve overlay reads in both themes (qlik-bright, qlik-dark); each row opens its run.
- Empty/partial states handled (a test with one run shows a helpful empty-compare state).
- Gate: typecheck + build green; manual check at `http://localhost:8080`.

## Notes
- Prefer generalizing the existing same-server compare logic (`apps/web/src/lib/compare.ts`) over a
  parallel path, consistent with `../../08-expanded-target.md` §3.
