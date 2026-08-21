---
type: "Work Package Spec"
title: "WP 3.1 — one token display grammar: TokenAmount across console, runs feed, suites and dashboard"
description: "Phase 3 of item.md. Ledger: STATUS.md. Introduces the app's first token formatter and converts every hand-written token display to it, so the cache split is one hover away everywhere."
tags: ["roadmap", "RM-33"]
timestamp: "2026-08-21T08:09:00Z"
status: "final"
---
# WP 3.1 — one token display grammar

Phase 3 of [`item.md`](./item.md). Ledger: [`STATUS.md`](./STATUS.md). Rules that bind this WP:
`.claude/rules/brand-ui-only.md`,
`.claude/rules/styling-and-tokens.md` (two themes),
`.claude/rules/icon-affordances.md`,
`.claude/rules/library-first.md`.

**Depends on:** WP 1.2 (the wire fields), WP 2.2 (the dashboard measures).

## Why a primitive first

There is **no token formatter in the app**. `apps/web/src/lib/format.ts:4-9` re-exports
`formatNumber`/`formatPercent`/`formatBytes` and nothing token-shaped, so ~15 sites hand-write
`formatNumber(x)` plus a literal `↑`/`↓`/`tok`. That is *why* the split cannot be shown consistently —
there is no single place to put it. Build the primitive, then convert.

## Scope

### 1. `apps/web/src/components/TokenAmount.tsx` (new)

Composes `@elabs-ai/components-ui` `Tooltip` + `Text` — no hand-rolled markup, `className` layout-only,
`tabular-nums` on the figure (the micro-typography rule for number columns).

```tsx
type TokenAmountProps = {
  value: number;                    // the gross figure, unchanged (D-CT1)
  direction?: "in" | "out";         // renders the ↑ / ↓ affix the call sites write by hand today
  usage?: Pick<TokenUsageActual, "inputTokens" | "cachedInputTokens" | "cacheReadTokens" | "cacheWriteTokens">;
  className?: string;
};
```

Behaviour:
- **No `usage`, or `usageSplitKind(usage) === "none"`** → renders exactly what the site renders today.
  No tooltip, no fabricated zeros, no visual change. This is the majority case for old runs and must
  be pixel-stable.
- **`"exact"`** → tooltip with **Uncached / Cache read / Cache write** and the hit rate from
  `cacheHitRate()`. Cache write is labelled as a **premium (1.25×)**, cache read as a **discount
  (0.1×)** — D-CT2: the tooltip must not let a reader mistake a write for a saving.
- **`"merged"`** → tooltip shows the merged cached figure and states that the read/write split is
  unavailable for this run. It does **not** guess.
- Accessible: the tooltip content is also present as an `sr-only` description wired via
  `aria-describedby`, so the split reaches a screen reader without hover (the `IconButton`
  disabled-reason pattern, applied to a non-interactive figure).

Add a matching `TokenAmount.test.tsx` covering all three fidelities.

### 2. Convert the call sites

| Site | Today |
| --- | --- |
| `KpiRail.tsx:242,249` (Tokens ↑ / ↓ tiles) + `ContextBreakdown` popover `:434,442` | `formatNumber(tokensIn)` |
| `TraceNode.tsx:228-270` (`KpiChips`) | `kpi.tokensIn` / `kpi.tokensOut` |
| `TurnsLens.tsx:146-156` | `formatNumber(row.tokensIn)}↑` |
| `TurnIndex.tsx:54-63` | ditto |
| `StepLog.tsx:363-374` (Tokens ↑/↓ columns) + tree-row economics chips `:766-775` | `tokensUp`/`tokensDown` |
| `ConsolePanel.tsx:131-146` (`stepMeta`) | `${up}↑ · ${down}↓` |
| `PacketInspector.tsx:196-201` | overview Tokens ↑/↓ |
| `runs/RunTableRow.tsx:248-250`, `runs/RunPreviewRow.tsx:82`, `RunsView.tsx:1174-1183` | `run.tokensIn + run.tokensOut` |
| `suites/SuiteKpiRail.tsx:83-88`, `runs/SuiteTableRows.tsx`, `suites/TestGroupRow.tsx:45` | `aggregates.totalTokens` |

Per-turn/per-step sites pass `step.usageActual`; run/suite-level sites pass a usage-shaped object
built from the new `RunSummary` / `SuiteAggregates` fields.

### 3. The KPI rail earns two real additions

- **Tokens ↑ tile** — a cache sub-line (`n% served from cache`) under the figure, hidden when the
  split is unknown.
- **Est. cost tile** — its popover renders the `CostBreakdown`: uncached $ / cache-read $ /
  cache-write $ / output $, and **saved vs uncached** (which may be negative — render it as a
  premium, with the correct sign and tone, when it is).
- **`figureRelationshipNote` (`KpiRail.tsx:291-306`)** already narrates why Context ≠ Tokens ↑/↓;
  extend it to say the ↑ figure is gross and cache-inclusive. This note is the single most direct
  answer to the question that opened this plan.
- **The guardrail token meter** (`RunConsole.tsx:1480-1484`) keeps counting cache reads at par —
  say so in its tooltip (the ledger's "deliberately not changed" #1). Do **not** change the
  arithmetic.

### 4. Analytics — three series, not two (D-CT2)

- `analytics-derive.ts:246-263` (`deriveCachedTokenRows`) becomes **uncached / cache read / cache
  write**. For a `"merged"` step it emits the legacy two-series shape and the chart says the split is
  unavailable for those turns — it must not silently attribute a merged figure to `read`.
- The Overview "Cached" tile (`AnalyticsPanel.tsx:270-275`) splits the same way.
- Add a cost-composition panel driven by `CostBreakdown`.
- Chart colours come from the 12-token `--chart-*` ramp. No raw colours.

### 5. Runs feed + dashboard

- `runs/run-columns.ts:21-22` — the existing `tokens` column gains the tooltip via `TokenAmount`; add
  an **opt-in** `cacheHitRate` column, hidden by default exactly as `tokens` is today (`:135`).
- `dashboard/testing/TokensPanel.tsx` + `use-testing-dashboard-data.ts:139` — request the WP 2.2
  measures; add a cache-hit-rate chart. When the API reports them `unavailable`, render the existing
  unavailable-measure state — **never a 0% line** (D-CT6).

## Acceptance

1. `TokenAmount` renders byte-identically to the previous markup when no split is available — a test
   per converted site's existing snapshot/assertion still passing is the proof. Existing
   `KpiRail.test.tsx`, `StepLog.test.tsx`, `TurnsLens.test.tsx`, `RunsView.test.tsx` are **updated,
   not deleted**.
2. Every site in the table above imports `TokenAmount`; a test greps `apps/web/src/features/testing`
   for a bare `formatNumber(` adjacent to a `↑`/`↓` literal and fails on a new one — the tooth that
   keeps the grammar from re-fragmenting.
3. The Analytics stack has three series for an exact-split run and refuses to attribute a merged
   figure to cache-read for a merged run.
4. "Saved vs uncached" renders with the correct sign and tone for a cache-write-heavy run.
5. The dashboard renders the unavailable state, not `0%`, for a pre-migration window.
6. **Both themes**, verified by looking at the running app — light and dark. Keyboard reachable,
   visible focus, tooltip content available via `aria-describedby`.
7. No raw colour literal; every visible element is a `@elabs-ai/components-*` component. `pnpm exec
   brand-ui audit` clean on the changed files.
8. Gate green: `pnpm typecheck && pnpm test && pnpm build && pnpm lint`.
