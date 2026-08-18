# WP 1.2 — Deterministic rules + advisor API

**Phase:** 1 · **Size:** L · **Depends on:** 1.1 (done — the contract + engine seam are merged)

## Objective
Implement the four deterministic rules over data the app already persists, register them, and expose
the report through one additive endpoint.

## Ground truth you must build on (verified against the code, not assumed)

- The engine seam is `apps/api/src/advisor/` — `types.ts` (`AdvisorRule`, `AdvisorContext` + the four
  read ports, `AdvisorRuleContractError`), `registry.ts` (`ADVISOR_RULES` — currently empty),
  `engine.ts` (`runAdvisor`), `evidence.ts` (the ref builders). **Rules read only the context's
  ports; never open a DB handle in a rule.** If a rule needs a query no port exposes, widen the port
  (and its structural match with the real repository) rather than reaching around it.
- Wire shapes already exist in `packages/shared`: `AdvisorReport`, `AdvisorRecommendation`,
  `AdvisorSavings` (`value`/`unit`/`estimate: true`/`basis`), `AdvisorEvidenceRef`,
  `AdvisorInsufficientData`, `AdvisorScope`, `ADVISOR_VERSION`. Only the **request/response envelope
  of the new route** is new contract work.
- A recommendation with no evidence, or a savings figure with no `basis` / no `estimate` marker,
  **throws**. Build each rule so it cannot emit one.
- `ToolScan` carries `toolName`, `description`, `contributionPercent` and the `TokenBreakdown`
  fields (incl. `totalTokens`, `descriptionTokens`). `ScanDetail` is what
  `AdvisorScanPort.getLatestForServer` / `getDetail` return.
- Tool-call history: `AdvisorRunPort.getToolCallSequence(runId): string[]` (real method on
  `RunRepository`), plus `listRuns({ scenarioId, status, limit })` and `getRun(runId)`.
- `Scenario.allowedServers` (`AllowedServer`) and `AdvisorScenarioPort.listServers(scenarioId)` give
  the server + per-tool allow-list; `Scenario.toolLoadingMode` is `"eager" | "deferred"`.

### The loading-mode trap — read this before writing rule 3

`tool_loading_mode` is a column on **`scenarios` only** (`apps/api/src/db/schema.ts:178`). The `runs`
table does **not** persist the mode a run executed under, and a scenario's mode is mutable. So:

- You may **not** attribute a mode to a historical run from the scenario's *current* value and
  present that as measurement — that is exactly the fabricated number invariant 3 forbids.
- Implement the rule as a **cross-scenario** comparison: two scenarios that cover the same server set
  but differ in `toolLoadingMode`, compared on peak context / tokens / cost from their runs
  (`RunSummary.peakContextTokens`, `tokensIn`, `tokensOut`, `costUsd`).
- The pairing assumption ("both scenarios' modes are unchanged since these runs were recorded") goes
  in the recommendation's `assumptions`, verbatim and unhedged.
- No comparable pair → `insufficientData` naming what is missing. Do **not** synthesize a
  single-scenario before/after.

## The four rules

1. **`unused-tool-trim`** (scope: `scenario`) — tools exposed by the scenario's servers that were
   never called across its runs. Savings = the never-called tools' `totalTokens`, unit
   `tokens_per_turn`, with a `basis` naming the tool count, the scan, and the run window used.
   Evidence: the scenario, each server's scan, the offending `tool_scan` refs, and the runs read.
   Honour the per-tool allow-list — a tool already disallowed is not a new trim.
2. **`description-bloat`** (scope: `server`) — top-N tools by `contributionPercent`, reporting
   `descriptionTokens` against call frequency where run data exists (footprint alone is enough to
   fire; call frequency enriches it). `basis` states the N and the threshold used.
3. **`loading-mode-comparison`** (scope: `scenario`) — per the trap above.
4. **`tool-overlap`** (scope: `scenario`) — near-duplicate tools across the scenario's servers via
   `matchTools`/`similarity` from `apps/api/src/compare/matching.ts`. **Reuse that matcher; do not
   write a second one.**

Every rule declares `appliesTo` honestly: a rule that has nothing to say about a scope contributes
nothing at all (not even a gap). Fleet scope may fan a rule over every server/scenario.

## API

`GET /api/advisor/report?scope=server|scenario|fleet&id=…` → `AdvisorReport`. Thin route (mirror
`apps/api/src/estimate/routes.ts`): parse the shared zod query schema, delegate to
`apps/api/src/advisor/service.ts`, which builds the `AdvisorContext` from the real repositories and
calls `runAdvisor`. Register it in `apps/api/src/index.ts` next to the other feature routes. `id` is
required for `server`/`scenario` and rejected/ignored for `fleet` — decide, document it in the
schema, and test it. Unknown id → 404.

## Files
- `apps/api/src/advisor/rules/{unused-tool-trim,description-bloat,loading-mode-comparison,tool-overlap}.ts` (new)
- `apps/api/src/advisor/registry.ts` (populate `ADVISOR_RULES`)
- `apps/api/src/advisor/types.ts` (only if a read port must widen)
- `apps/api/src/advisor/service.ts`, `apps/api/src/advisor/routes.ts` (new)
- `apps/api/src/index.ts` (register the routes)
- `packages/shared/src/{types,schemas}.ts` (the route's query envelope)
- `apps/api/test/advisor-rules.test.ts`, `apps/api/test/advisor-routes.test.ts` (new)

## Acceptance
- [ ] Each of the four rules has a **hand-computed** fixture test: the expected savings number is
      written in the test as an arithmetic expression a reviewer can check by eye, not copied from
      the implementation's output.
- [ ] A scenario with **no runs** yields `insufficientData` from the run-dependent rules naming what
      is missing — and **zero** recommendations carrying a 0-valued saving.
- [ ] `loading-mode-comparison` never attributes a loading mode to a historical run; with no
      comparable scenario pair it reports `insufficientData`. A test pins this.
- [ ] `tool-overlap` calls `matchTools`/`similarity` from `compare/matching.ts` (no second matcher —
      a grep for a duplicated similarity implementation comes up empty).
- [ ] Every emitted recommendation carries resolvable evidence and, where it claims savings, an
      `estimate: true` + a `basis` that names its inputs.
- [ ] The route validates its query with a shared zod schema, 404s an unknown id, and its response
      parses against `advisorReportSchema`.
- [ ] Determinism holds end to end: the same fixture DB produces a byte-identical report twice.
- [ ] No DB migration, no new runtime dependency, no change to `ASSISTANT_ENTITY_KINDS` /
      `SCOPE_WRITE_TOOLS` / `deriveAssistantScope`.
- [ ] Gate green from the repo root: `pnpm typecheck && pnpm test && pnpm build && pnpm lint`.

## Notes
No UI in this WP — the Advisor view and the server/scenario panels are WP 1.3.
