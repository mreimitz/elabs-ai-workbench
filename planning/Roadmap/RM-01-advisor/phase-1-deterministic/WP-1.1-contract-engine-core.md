---
type: "Work Package Spec"
title: "WP 1.1 \u2014 Contract + rule engine core"
description: "Phase: 1 \u00b7 Size: M \u00b7 Depends on"
tags: ["roadmap", "RM-01"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# WP 1.1 — Contract + rule engine core

**Phase:** 1 · **Size:** M · **Depends on:** —

## Objective
Stand up the advisor's wire contract and the deterministic rule-engine core that every later rule
plugs into. **No product rules ship in this WP** — the four deterministic rules are WP 1.2. This WP
is the seam they land on.

## Why / references
- Plan: [`../README.md`](../item.md) ("What we're building" 1., Invariants), shared rules in
  [`../conventions.md`](../conventions.md).
- Version-stamp discipline to mirror: `TOKEN_COUNTING_VERSION` / `GRADING_VERSION` /
  `AUTO_RATING_VERSION` in `packages/shared/src/constants.ts`.
- Prior-art for a versioned deterministic engine over persisted rows:
  `apps/api/src/compatibility/` (`catalog.ts` → `evaluators.ts` → `runner.ts` → `service.ts`).
- Prior-art for recommendation *shape* on the web side: `apps/web/src/lib/optimize.ts`
  (`Suggestion`, `serverRecommendations`, `groupFindings`) — the advisor generalizes this
  server-side and makes it evidence-carrying.

## Design

**Shared contract** (`packages/shared`):
- `ADVISOR_VERSION = 1` in `constants.ts`, with the same never-silently-compare comment style the
  other version stamps carry.
- Types in `types.ts`:
  - `AdvisorEvidenceRef` — a typed pointer to a real entity the finding was derived from
    (`{ kind: "scan" | "tool_scan" | "run" | "scenario" | "server" | "skill", id, label }`),
    enough for the UI to render a drill-through link.
  - `AdvisorSavings` — an estimate envelope: the number, its unit
    (`tokens_per_turn` | `tokens` | `usd_per_run`), and an explicit `estimate: true` marker plus a
    short `basis` string stating how it was computed.
  - `AdvisorRecommendation` — `{ id (stable dedup key), ruleId, title, detail, severity
    ("high"|"medium"|"info"), savings?: AdvisorSavings, evidence: AdvisorEvidenceRef[],
    assumptions: string[] }`.
  - `AdvisorInsufficientData` — `{ ruleId, reason }` naming exactly what was missing.
  - `AdvisorReport` — `{ advisorVersion, generatedAt, scope, recommendations,
    insufficientData: AdvisorInsufficientData[] }`.
  - `AdvisorScope` — what the report was computed over (`{ kind: "server"|"scenario"|"fleet", id? }`).
- zod mirrors for each in `schemas.ts`, exported from `index.ts`.

**Engine core** (`apps/api/src/advisor/`):
- `types.ts` — the internal `AdvisorRule` interface: `{ id, appliesTo(scope), run(ctx) =>
  { recommendations, insufficientData } }` plus the `AdvisorContext` a rule reads (repositories /
  loaded rows — do **not** let a rule open its own DB handle).
- `registry.ts` — an explicit array/map of registered rules (empty in this WP) with a
  `registerRule`-style seam and a lookup by id.
- `engine.ts` — `runAdvisor(ctx, scope)`: selects applicable rules, runs them, **dedupes** by
  recommendation `id` (first-wins, documented), sorts deterministically (severity desc → savings
  desc → id asc), and assembles an `AdvisorReport` stamped with `ADVISOR_VERSION`.
- `evidence.ts` (or helpers in `engine.ts`) — small builders that make an `AdvisorEvidenceRef` for
  each supported entity kind, so rules cannot hand-roll a malformed ref.

**No route in this WP.** `GET /api/advisor/*` lands with the real rules in WP 1.2.

## Files
- `packages/shared/src/constants.ts` (append `ADVISOR_VERSION`)
- `packages/shared/src/types.ts` (append advisor types)
- `packages/shared/src/schemas.ts` (append advisor zod schemas)
- `packages/shared/src/index.ts` (exports, if not already `export *`)
- `apps/api/src/advisor/types.ts` (new)
- `apps/api/src/advisor/registry.ts` (new)
- `apps/api/src/advisor/engine.ts` (new)
- `apps/api/test/advisor-engine.test.ts` (new)

## Acceptance
- [ ] `ADVISOR_VERSION` is exported from `packages/shared` and stamped on every `AdvisorReport`.
- [ ] The contract exists as **both** TS types and zod schemas, and a report parsed by the zod
      schema round-trips.
- [ ] Every `AdvisorRecommendation` carries at least one `AdvisorEvidenceRef`; the engine rejects
      (or a test proves it cannot produce) a recommendation with empty evidence.
- [ ] **Determinism:** a test runs the engine twice over the same fixture rules and asserts
      byte-identical JSON, including ordering; the documented sort is severity → savings → id.
- [ ] **Dedup:** two fixture rules emitting the same recommendation `id` collapse to one, and the
      test names the first-wins behavior.
- [ ] **Insufficient data:** a fixture rule that lacks inputs contributes an
      `AdvisorInsufficientData` entry naming what is missing and contributes **no** recommendation
      with fabricated numbers.
- [ ] Savings are labeled estimates (`estimate: true` + a `basis` string) — a test asserts a
      savings value cannot be emitted without its basis.
- [ ] No DB migration, no new runtime dependency.
- [ ] Gate green from the repo root: `pnpm typecheck && pnpm test && pnpm build && pnpm lint`.

## Notes
Registering zero real rules is correct here — WP 1.2 adds unused-tool trim, description bloat,
loading-mode comparison and overlap detection on top of this seam, and ships the API route.
