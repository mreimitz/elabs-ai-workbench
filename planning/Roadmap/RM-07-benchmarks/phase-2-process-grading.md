---
type: "Work Package Spec"
title: "Phase 2 \u2014 Process grading (WP specs)"
description: "Size: L \u00b7 Depends on: 1.2 \u00b7 API"
tags: ["roadmap", "RM-07"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# Phase 2 — Process grading (WP specs)

## WP 2.1 — `tool_hygiene` grader (deterministic)
**Size:** L · **Depends on:** 1.2 · API

**Objective:** grade *how* tools were used, no LLM required (B6.1) — powered by the app's own
scan data, the same read-only reuse as Skill IDE I5.

**Files:** `apps/api/src/grading/tool-hygiene.ts` (+ `schema-check.ts`); reads the run's
`run_steps` (tool_call args from redacted payloads) + each server's **latest completed scan**
(`mcp_tool_scans.input_schema`); tests `grading-tool-hygiene.test.ts` with fixture schemas.

**Checks (each a finding `{ checkId, severity, stepIdx, message }`):** `missing-required`,
`wrong-type` (top-level property type vs schema), `unknown-property`, `enum-violation` — via an
**in-house documented JSON-Schema subset checker** (required/type/enum/additionalProperties at
the top level; no ajv in v1, deeper validation owner-gated); `tool-not-in-scan` (called tool
absent from the latest scan), `tool-error-rate` (share of tool_result steps with error status),
`identical-repeat` (same tool + byte-identical args ≥2×), `error-then-retry` (error followed by
immediate identical retry). Score 0–1 = 1 − weighted findings (weights exported as constants,
documented). No scan available for a server → the affected checks return `unevaluable`, never 0.

**Acceptance:** fixture matrix (clean run scores 1.0; each check fires on a crafted trace);
determinism; runs with no tool calls → `unevaluable`; never reads live MCP (no `openSession`
import — asserted by test); gate green.

## WP 2.2 — `trajectory_judge` (LLM, vs referenceLogic)
**Size:** M · **Depends on:** 1.3 · API

**Objective:** the insights-bench trajectory-vs-code judge (B6.2) on honest data — our persisted
`run_steps` instead of agent-self-reported interactions.

**Files:** `apps/api/src/grading/trajectory-judge.ts` (operations digest builder: ordered
tool_call/tool_result pairs → the prompt's Operation blocks with args, truncated result summary,
step idx; prompt = the ported comparison rubric — step-by-step logic comparison, 0–10 table,
justification referencing specific operations; JSON response with fence/truncation-tolerant
parsing); registry entry (runs only when `expectations.referenceLogic` present); tests with
stubbed provider (`grading-trajectory.test.ts`).

**Rules:** grade row stores `raw_score` (0–10), normalized `score` (0–1), the comparison text in
`reasoning`, and cited step idxs in `evidence_json` (deep-linkable from the UI like assertion
evidence). Digest is size-bounded (per-op + total char caps) so a 200-step run can't blow the
judge context — truncation is disclosed inside the prompt.

**Acceptance:** stubbed tests: digest correctness on a fixture run, parse fallback paths, absent
referenceLogic → grader skipped (no row), evidence idxs resolve to real steps; judge cost on the
grading ledger; gate green.

## WP 2.3 — `skillflow_conformance` scored grader
**Size:** S · **Depends on:** 1.2 · API

**Objective:** one number from machinery that already exists (B6.3): how faithfully the run
followed its attached skills' designed flows.

**Files:** `apps/api/src/grading/skillflow-conformance.ts` — pure function over the run's
existing alignment verdicts + assertion results (WP 5.1 evaluator outputs; read-only):
score = weighted(gates passed / gates reached, routes matched, 0 fractures bonus); weights
exported + documented. Runs only when the run had attached skills with flow graphs; otherwise
`unevaluable`. Tests `grading-skillflow-conformance.test.ts` over fixture verdicts.

**Acceptance:** fixture verdict sets map to hand-computed scores; no-skill runs →
`unevaluable`; consumes persisted verdicts only (no re-alignment, no LLM); gate green.
