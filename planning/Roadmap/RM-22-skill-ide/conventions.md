---
type: "Work Package Spec"
title: "Skill IDE plan \u2014 conventions"
description: "The SkillFlow conventions apply verbatim to every Skill IDE"
tags: ["roadmap", "RM-22"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# Skill IDE plan — conventions

The [SkillFlow conventions](/Roadmap/RM-23-skillflow/conventions.md) apply **verbatim** to every Skill IDE
work package: quality gate (`pnpm typecheck && pnpm test && pnpm build && pnpm lint`),
contract-first in `packages/shared` (WP 1.1 owns the contract; later WPs additive-only),
never-execute invariant, deterministic/versioned engines, storage immutability, round-trip
byte-exactness, ingestion caps, `@elabs-ai/components-*`-only UI with two themes, kebab/Pascal naming,
fixture-driven tests in `apps/api/test/`, honest reporting.

Additions specific to this plan:

- **Engine version stamps:** `SKILLFLOW_PROJECTOR_VERSION` bumps in WP 1.2 (flow semantics);
  new `QUALITY_ENGINE_VERSION` (WP 4.1) and `TOOL_VALIDATION_VERSION` (WP 5.1) follow the same
  never-silently-compare rule.
- **Flow compatibility:** a zero-command skill must project byte-identically to its pre-plan
  graph except for the additive `flowId: 'main'` fields — locked by a regression fixture test.
- **Canvas staging rule (I2):** no canvas interaction mutates anything; interactions stage edit
  ops into the WP 4.2 (SkillFlow) op buffer and go through the existing Save dialog.
- **PAT handling (I6):** identical discipline to `SkillGitService` — argv-only credential
  helper, encrypted at rest, never returned, `redactUrl` on every error path, temp dirs cleaned.
- **Scan-data reads (I5):** validation reads `mcp_tool_scans` via existing repositories; it
  never triggers a scan, never opens an MCP connection.
- **New env caps** follow the `SKILL_MAX_*` pattern with shared-constant defaults:
  `SKILL_QUALITY_L1_TOKEN_CEILING`, `SKILL_QUALITY_L2_TOKEN_CEILING` (WP 4.1).
- **Rule ↔ guide contract (owner-added 2026-07-04):** the canonical skill best-practices doc is
  `docs/skill-authoring.md` — quality/validation ruleIds share
  names with its anchors; a new rule ships WITH its guide section (WP 4.1 acceptance tests
  this). Practices are tagged enforced / measured / convention / planned.
