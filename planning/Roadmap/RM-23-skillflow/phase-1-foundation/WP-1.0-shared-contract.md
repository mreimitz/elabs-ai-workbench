---
type: "Work Package Spec"
title: "WP 1.0 \u2014 Shared contract (graph IR + trace vocabulary + session-trace shape)"
description: "Phase: 1 \u00b7 Size: M \u00b7 Depends on"
tags: ["roadmap", "RM-23"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# WP 1.0 — Shared contract (graph IR + trace vocabulary + session-trace shape)

**Phase:** 1 · **Size:** M · **Depends on:** —

## Objective
Land the three schemas the whole feature hangs off — the **skill graph IR**, the **trace-event
vocabulary**, and the **session-trace shape** — as types + zod in `packages/shared`, so every later
WP consumes one locked contract and never reshapes it.

## Why / references
[`../00-architecture.md`](../00-architecture.md) §"The three schemas" and D2/D6/D7/D8. Mirrors the
skills plan's WP 1.0 (contract lands whole, later WPs are additive-only).

## Files
- `packages/shared/src/types.ts` *(modify)* — `SkillGraph`, `SkillGraphNode` (kinds
  `gatekeeper|subroutine|asset|validation_gate|loop_guard`; `anchor: {headingPath, startLine,
  endLine}`; `source: 'inferred'|'annotated'`; kind-specific fields), `SkillGraphEdge`
  (`condition?`, `anchor?`), `TraceEvent` (types
  `turn|tool_call|tool_result|skill_file_read|script_result|subagent_spawn|marker|user_message`),
  `SessionTrace` (`source: 'run'|'session_upload'`, `skillVersionId`, `events`, `alignment`),
  `TraceAlignment` (`nodeVisits`, `edgeTraversals`, `verdicts`), `TraceVerdict`
  (`status: 'ok'|'fracture'|'unvisited'`, `reason`, `evidence: number[]`).
- `packages/shared/src/schemas.ts` *(modify)* — zod for every shape above (request/response bodies
  for the graph + trace routes, the blank-skill create body, the session-upload body).
- `packages/shared/src/constants.ts` *(modify)* — `SKILLFLOW_PROJECTOR_VERSION = 1`,
  `SKILLFLOW_ALIGNER_VERSION = 1`, `SKILLFLOW_ANNOTATION_PREFIX = "skillflow:"`, session ingest cap
  defaults (`SESSION_MAX_BYTES`, `SESSION_MAX_EVENTS`), loop-detection default threshold.
- `packages/shared/src/index.ts` *(modify)* — re-exports.
- `packages/shared/src/skillflow.test.ts` or colocated schema tests *(create)* — zod round-trip of
  representative fixtures (a graph with all five node kinds; a trace with all event types; an
  alignment with all three verdict statuses).

## Acceptance
- [ ] All three schemas exist as types + zod, exported from `packages/shared`, with the version
      stamps and cap constants; no API/web code changed yet.
- [ ] Node kinds, event types, and verdict statuses exactly match `00-architecture.md`; asset nodes
      reference `skill_files.kind` values (D8) rather than a new file taxonomy.
- [ ] Fixture round-trip tests pass; repo gate green.

## Notes
Touches `packages/shared` — run **solo** (serialization rule). Everything after this WP treats the
contract as append-only.
