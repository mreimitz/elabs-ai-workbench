# WP 1.2 — Deterministic rules + advisor API

**Phase:** 1 · **Size:** L · **Depends on:** 1.1

## Objective
Implement the four deterministic rules over persisted data and expose them through the API.

## Design
Rules (each a registered `AdvisorRule` from WP 1.1):
1. **Unused-tool trim** — per scenario, tools never called across its runs (`run_steps.type =
   'tool_call'`) vs their footprint share from the scenario's servers' latest scans → a suggested
   `allowedTools` trim with estimated tokens saved per turn.
2. **Description bloat** — top-N tools by footprint share in a scan; per-tool tokens vs call
   frequency.
3. **Loading-mode comparison** — eager vs deferred (`scenarios.tool_loading_mode`) side by side for
   the same scenario: peak context, tokens, cost, from data the run engine already records.
4. **Overlap detection** — near-duplicate tools across a scenario's servers, reusing
   `apps/api/src/compare/matching.ts`.

API: `GET /api/advisor/report?scope=server|scenario|fleet&id=…` returning the `AdvisorReport`.

## Files
- `apps/api/src/advisor/rules/*.ts` (new, one file per rule)
- `apps/api/src/advisor/registry.ts` (register the four rules)
- `apps/api/src/advisor/repository.ts` + `service.ts` + `routes.ts` (new)
- `apps/api/src/index.ts` (register routes)
- `packages/shared/src/{types,schemas}.ts` (request/response for the route)
- `apps/api/test/advisor-rules.test.ts`, `apps/api/test/advisor-routes.test.ts` (new)

## Acceptance
- [ ] Each rule has a **hand-computed** fixture test proving its arithmetic.
- [ ] A scenario with no runs yields `insufficientData` for the run-dependent rules, not zeros.
- [ ] Overlap detection reuses `compare/matching.ts` (no second matcher).
- [ ] The route validates its query with zod and 404s an unknown id.
- [ ] Gate green.
