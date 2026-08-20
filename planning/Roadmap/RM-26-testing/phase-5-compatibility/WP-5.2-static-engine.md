---
type: "Work Package Spec"
title: "WP 5.2 \u2014 Static compatibility engine"
description: "Status: \u2705 done 2026-06-21 (code-complete; gate green)."
tags: ["roadmap", "RM-26"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# WP 5.2 — Static compatibility engine

**Status:** ✅ done 2026-06-21 (code-complete; gate green).
**Depends:** WP 5.1.

## Goal
Evaluate the 23 no-run-needed catalog tests (server + environment + tool levels) for any (scan,
model) and roll them into a heatmap cell, with per-model severity resolved from the dataset.

## Deliverables
- `apps/api/src/compatibility/catalog.ts` — loads + types the bundled `test-catalog.json`.
- `apps/api/src/compatibility/resolve.ts` — **faithful TS port** of `resolve_model_severity.py`:
  single-clause predicate DSL (no `&&`/`||`), the `is_scorable` substring na-gate, evidence-field
  resolution, `rationale_template` fill.
- `apps/api/src/compatibility/evaluators.ts` — pure measures (countAllProperties, maxNestingDepth,
  maxEnumLength, isObjectSchema, unsupportedKeywords, countDuplicates, name pattern, namespace prefix).
- `apps/api/src/compatibility/runner.ts` — per-test verdict + threshold resolution + warn/fail bands
  + `scoreCell` (weighted score, na excluded, blocker-fail gate, green/amber/red bands).
- `apps/api/src/token-counting/provider-shapes.ts` — wired the previously-dead adapters + added the
  missing `gemini_declaration` adapter + `adapterForShape(shape)` selector.

## Acceptance (met)
- **Fixture parity:** `compatibility-resolve.test.ts` reproduces the Python demo (severity +
  rationale + evidence) exactly for the 3 demo tests × 5 demo models.
- **Catalog QA:** all 31 tests × all 33 models resolve with no crash; window tests → `na` for
  models with no documented window.
- **Runner verdicts:** a 200-tool server fails the OpenAI hard cap but is `na` on Anthropic; the
  aggregate cap binds Anthropic via the 10k ceiling; the same server is red on Phi-4 / green on a
  1M-window model; duplicate names + over-long names + strict-mode property cap behave; blocker-fail
  gates the cell to red.

## Notes / deferred
- Footprint currently uses the scan's generic token total; per-shape recount via `adapterForShape`
  is wired and available — fold the recount into the footprint evaluator when the scan exposes raw
  tool defs to the engine (accuracy refinement, not a verdict-logic change).
- `SERVER_PRIMITIVE_FOOTPRINT` → `na` until scans expose `resource_count`/`prompt_count`.
