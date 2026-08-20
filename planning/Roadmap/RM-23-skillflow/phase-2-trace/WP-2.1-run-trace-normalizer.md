---
type: "Work Package Spec"
title: "WP 2.1 \u2014 Run\u2192trace normalizer + runskills persistence"
description: "Phase: 2 \u00b7 Size: M \u00b7 Depends on: 1.0"
tags: ["roadmap", "RM-23"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# WP 2.1 — Run→trace normalizer + `run_skills` persistence

**Phase:** 2 · **Size:** M · **Depends on:** 1.0

## Objective
Turn a persisted test run into a `SessionTrace` event stream (shared vocabulary), and close the
join gap: persist **which skill version** `resolveAllowedSkills` resolved for each run, so Trace
Mode can list "runs that exercised this skill version".

## Why / references
D6 — internal runs are trace source #1 and are already persisted (`run_steps`: typed steps with
`tool_name`, `turn_index`, timing, payloads; skill file reads appear as metered `read_skill_file`
tool calls). Validated gap: `run-service.ts` resolves skills at run time but nothing records the
resolution (`run-repository.ts` has no skill reference).

## Files
- `apps/api/src/db/schema.ts` + `apps/api/src/db/database.ts` *(modify)* — additive `run_skills`
  table: `(run_id FK→runs CASCADE, skill_id, skill_version_id, eager, PRIMARY KEY(run_id,
  skill_id))` + index on `skill_version_id`. Follow the run-transcript immutability stance:
  `skill_id`/`skill_version_id` are **denormalized references, not FK-cascaded to skills** (a
  skill deletion must not rewrite run history — same rationale as `run_steps.server_id`).
- `apps/api/src/db/rows.ts` *(modify)* — row type.
- `apps/api/src/testing/run-service.ts` *(modify)* — after `resolveAllowedSkills`, persist one
  `run_skills` row per resolved attachment (inside the existing run-creation transaction).
- `apps/api/src/skillflow/run-trace.ts` *(create)* — `traceFromRun(runId): TraceEvent[]`:
  `run_steps` → normalized events (`llm_response`→`turn`, `tool_call`/`tool_result` pairs,
  `read_skill_file` calls → `skill_file_read` with skill+path from the redacted payload, breadcrumb
  markers detected in assistant text → `marker`, script/tool exit evidence → `script_result`).
  Preserves `run_steps.idx` as the event `idx` source; never mutates run data.
- `apps/api/src/skillflow/routes.ts` *(modify)* — `GET /api/skills/:id/versions/:vid/runs`
  (runs joined via `run_skills`, newest first) and `GET /api/runs/:runId/trace` (normalized
  events, no alignment yet).
- `apps/api/test/skillflow-run-trace.test.ts` *(create)* — seed a synthetic run (repository level,
  no model key) with tool calls + skill file reads; assert normalization, `run_skills` rows, and
  the two routes.

## Acceptance
- [ ] Every new run with attached skills writes `run_skills` rows (latest-resolved and pinned both
      record the concrete `skill_version_id`); runs without skills write none; old runs unaffected
      (additive migration).
- [ ] `traceFromRun` maps all six `run_steps` types into the shared vocabulary; `read_skill_file`
      steps become `skill_file_read` events carrying skill name + path; ordering stable.
- [ ] Read-only over run data; never-execute invariant untouched (no new tool registration).
- [ ] Repo gate green.

## Notes
Touches `apps/api/src/testing/run-service.ts` (core run path) — run **solo**, and re-run the
existing testing suite to confirm no accounting regressions.
