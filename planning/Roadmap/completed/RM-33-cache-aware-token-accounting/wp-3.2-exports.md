---
type: "Work Package Spec"
title: "WP 3.2 — reports, compare export and the workbench MCP run summary"
description: "Phase 3 of item.md. Ledger: STATUS.md. Carries the cache split and cost breakdown into every machine-readable surface."
tags: ["roadmap", "RM-33"]
timestamp: "2026-08-21T08:10:00Z"
status: "final"
---
# WP 3.2 — exports, compare and the MCP run summary

Phase 3 of [`item.md`](./item.md). Ledger: [`STATUS.md`](./STATUS.md).

**Depends on:** WP 1.2.

The run report is already the most cache-honest surface in the app — it is the only place that prints
"Cached tokens" at all (`apps/api/src/reports/reports.ts:217,381` and the per-step line at
`:641-651`). This WP finishes the job and takes the split to the other machine-readable exits.

## Scope

- **`apps/api/src/reports/reports.ts`**
  - JSON `statistics` (`:213-229`) and Markdown §3 (`:368-390`) gain `cacheReadTokens` /
    `cacheWriteTokens` and the `CostBreakdown`, beside the existing `cachedTokens`.
  - **Give `statistics` a real shared type + zod schema.** Today it is an API-local object literal
    with neither, mirrored by hand in `apps/web/.../analytics-derive.ts:33-44` — a wire shape with no
    contract, which `architecture.md` forbids. Declare it in `packages/shared`, and have both ends
    import it.
  - The per-step line already prints `cached N` when non-zero (`:646-647`); print the split when it is
    exact.
- **`apps/api/src/reports/run-kpi-by-step.ts:17-20`** — carry the new kpi fields through the per-step
  cumulative snapshots. Without this, `StepLog`'s economics chips (which difference these snapshots,
  `analytics-derive.ts:582-612`) stay cache-blind no matter what WP 3.1 does to the component.
- **`apps/api/src/reports/suite-run-report.ts`** — per-cell (`:71-79`, filled `:208-210`) and the
  aggregates line (`:339`) gain the split, honouring the WP 1.2 unknown-member rule.
- **`apps/web/src/features/testing/compare/summary-derive.ts:257-273`** — add cache-read / cache-write
  / hit-rate metric accessors beside "Tokens in"/"Tokens out"; `compare/next-steps/compare-export.ts:117-120`
  emits them. Compare currently has no cached row anywhere.
- **`apps/api/src/mcp-server/tools.ts:131-158`** (`compactRun`) — add `cacheReadTokens` /
  `cacheWriteTokens`. Per-step `usageActual` already crosses whole
  (`apps/api/src/assistant/tools/util.ts:120`), so only the run summary is missing them.
  **Re-run `pnpm mcp:self-scan`**: the definition-token budget is 3,000 and the mount currently
  measures 2,749 — confirm the delta still fits, and record the new number in the ledger.
- **`apps/api/src/reports/fleet-report.ts`** — leave the cost-basis split alone; add token cache
  figures only if they fall out for free.

## Out of scope

`RunGrade`'s judge ledger (`judgeTokensIn`/`judgeTokensOut`/`judgeCostUsd`) — it stays separate from
run cost (B5) and is not part of this plan. Note in the ledger the observed asymmetry (judge *cost*
has an aggregate, judge *tokens* do not) as a follow-up, do not fix it here.

## Acceptance

1. `GET /api/reports/run/:id/json` `statistics` validates against the **new shared zod schema**, and
   the web mirror type is deleted in favour of the shared import.
2. Markdown §3 shows the split for an exact run and the merged figure with its caveat for a legacy run.
3. `stepKpis` entries carry the cache fields; a `StepLog` economics-chip test proves the per-step
   delta is now derivable.
4. Compare export contains the new rows; the compare workspace renders them.
5. `pnpm mcp:self-scan` exits 0 and the recorded token total is under 3,000; the new number is written
   into the ledger.
6. Every added field is additive — no export consumer breaks. A test asserts a pre-migration run's
   report still renders (fields simply absent).
7. Gate green: `pnpm typecheck && pnpm test && pnpm build && pnpm lint`.
