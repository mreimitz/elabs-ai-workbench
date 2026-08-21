---
type: "Work Package Spec"
title: "WP 1.2 — the pure estimator consumes a measured profile"
description: "Phase 2 of item.md. Ledger: STATUS.md. Feeds the measured turn profile into the pure run-plan estimator, keeps maxTurns clamping last, and reports the basis on the wire."
tags: ["roadmap", "RM-34"]
timestamp: "2026-08-21T13:25:00Z"
status: "final"
---
# WP 1.2 — the pure estimator consumes a measured profile

Phase 2 of [`item.md`](./item.md). Ledger: [`STATUS.md`](./STATUS.md).

**Depends on:** WP 1.1 (the contract + the query).
**Consumed by:** `GET /api/estimate/run-plan`, and through it the launcher preview, the suite-detail
preview, `ForkDialog`, and the workbench MCP launch tools' advisory estimate
(`apps/api/src/mcp-server/tools.ts`) — none of which need a change to keep working.

## The defect

`apps/api/src/estimate/estimate.ts`, `turnBand` and `runTokens`:

```ts
function turnBand(maxTurns?: number): EstimateRange {
  const cap = maxTurns && maxTurns > 0 ? maxTurns : RUN_PLAN_ESTIMATE_TURNS_HIGH;
  return { low: Math.min(1, cap), mid: Math.min(3, cap), high: Math.min(8, cap) };
}
const output = turns * RUN_PLAN_ESTIMATE_OUTPUT_TOKENS_PER_TURN;   // 350, flat
```

Both numbers are frozen guesses. Measured against the owner's own 122 completed runs the band should
be **4 / 6 / 16** globally, with the output constant at **~1,148**, and both vary strongly by
environment (see *The measurement* in [`item.md`](./item.md)).

## Scope

### `apps/api/src/estimate/estimate.ts` — stays pure (D-ET8)

- `EstimateEnvInput` gains `turnProfile?: RunPlanTurnProfile` — resolved by the service and passed
  in, exactly as `footprintTokens` and `pricing` already are. **No DB import lands in this file.**
- `turnBand(...)` takes the profile: when present it uses the profile's `turns`, otherwise the three
  constants. **The `maxTurns` clamp is applied last, to whichever band was chosen** (D-ET6), and
  `low <= mid <= high` must still hold after clamping.
- `runTokens(...)` and `runUsage(...)` take the per-turn output figure from the profile when present,
  the constant otherwise. **These two functions must stay byte-identical in their input term** —
  RM-33's `runUsage` doc comment states that it re-prices the same tokens `runTokens` counts, and a
  test pins it. If you change the input arithmetic in one, change it in the other or the WP is wrong.
- `estimateRunPlan(...)` puts `turnProfile` on each `RunPlanEstimateEnvironment` it returns.

### What must NOT change

- **The dollar band still spreads on caching, not on turns** (RM-33 WP 2.1, D-CT2). Both ends of
  `costUsd` are still evaluated at the same `turns.high`. Re-introducing a turn spread into `costUsd`
  would silently revert that WP; its acceptance test (`no cachedInPer1M ⇒ low === high`) is the guard
  and must stay green.
- `computeCostBreakdownForPrice` remains the only cost formula in the file (D-CT5, source-grep
  enforced). This WP changes **how many tokens** are priced, never **how** they are priced.

### `apps/api/src/estimate/service.ts` — resolves the profile

- Call WP 1.1's repository method **once** for the whole request with every (environment, test) pair
  in the plan, then apply the D-ET2 narrowest-first fallback: `pair` → `environment` → `global` →
  `default`, each level skipped whole when it is below `RUN_PLAN_TURN_PROFILE_MIN_SAMPLES`.
- A plan has many tests per environment but `EstimateEnvInput` is per-environment. **Resolve the
  profile per (environment, test) pair and combine per environment** — do not silently use the first
  test's profile for all of them. If combining, combine the *samples*, never the percentiles.
- `EstimateDeps` grows the run repository. Wire it in `apps/api/src/index.ts`.

## Out of scope

- Any web file (WP 1.3).
- Any change to the pricing model, the caching model, or `TokenUsageActual`.
- Persisting or caching the measured profile. It is computed per request from live data; if that
  turns out to be slow, report the measurement rather than adding a cache in this WP.

## Acceptance

- [ ] With no history at all, the estimate is **byte-identical** to today's — a test asserts the
      exact numbers the current implementation produces for a fixed input (D-ET1's real guarantee).
- [ ] With a measured profile, `tokens.{low,mid,high}` follow the profile's percentiles and the
      output term follows its `outputTokensPerTurn`.
- [ ] `maxTurns` clamps a **measured** band: a profile of 4/6/16 with `maxTurns: 5` yields 4/5/5, and
      `low <= mid <= high` holds.
- [ ] The narrowest-first fallback is proved at each level, including "pair exists but is below the
      floor ⇒ the environment level is used, not a blend" (D-ET2).
- [ ] Each returned environment carries `turnProfile` with the basis it actually used and a
      `sampleSize` matching the rows behind it; `basis: "default"` reports `sampleSize: 0`.
- [ ] `estimate.ts` imports nothing from `db/`, `run-repository` or any I/O module (D-ET8) — assert
      it with a source-grep test, the same technique D-CT5 uses.
- [ ] RM-33's caching acceptance still holds: no `cachedInPer1M` ⇒ `costUsd.low === costUsd.high`,
      at any turn count including a measured one.
- [ ] Gate green: `pnpm typecheck && pnpm test && pnpm build && pnpm lint`.

## Verification the orchestrator will do

Broken by hand, confirmed red, restored:

1. Apply the `maxTurns` clamp **before** choosing the measured band → the clamp test must go red.
2. Let the pair level fall through by blending into the environment sample → the D-ET2 test must go
   red.
3. Re-introduce a turn spread into `costUsd` → RM-33's `low === high` test must go red.
4. Add a `db` import to `estimate.ts` → the purity grep test must go red.
