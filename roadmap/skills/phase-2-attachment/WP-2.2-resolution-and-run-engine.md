# WP 2.2 — Resolution + run-engine wiring (L1 block + `read_skill_file` + eager)

**Phase:** 2 · **Size:** L · **Depends on:** 2.1

## Objective
Feed attached skills to the agent-under-test faithfully: inject the L1 `<available_skills>` block
always, expose a read-only `read_skill_file` disclosure tool for L2/L3 (metered like MCP tool calls),
and support the optional per-attachment **eager** toggle — with all of it counted in the run's context
accounting.

## Why / references
[`../../research/skill-registry/08-scenario-attachment.md`](../../research/skill-registry/08-scenario-attachment.md)
(run-engine wiring) + `11` (why this matches real products). Reuse `apps/api/src/testing/{run-service,
tool-bridge,accounting}.ts` and the existing per-call token measurement.

## Files
- `apps/api/src/testing/scenario-service.ts` *(modify)* — `resolveAllowedSkills(scenarioId)`: resolve
  each attachment to a concrete `SkillVersion` (`latest`→`currentVersionId`, else `pinnedVersionId`) +
  its files + manifest + level tokens.
- `apps/api/src/testing/skill-context.ts` *(create)* — build the `<available_skills>` XML block;
  build the read-only `read_skill_file`/`list_skill_files` tool (backed by the resolved version's
  files; **never executes** scripts); optional eager SKILL.md inlining.
- `apps/api/src/testing/run-service.ts` *(modify)* — inject the L1 block into the system prompt;
  register the disclosure tool alongside MCP tools; thread eager flag; count skills tokens into the
  `ContextSnapshot`.
- `apps/api/src/testing/skill-context.test.ts` *(create)*.

## Acceptance
- [ ] A scenario with an attached skill injects a correct `<available_skills>` block (name +
      description + `skill://name@version/SKILL.md` location) into the run's system prompt; token
      accounting shows the L1 contribution.
- [ ] `read_skill_file`/`list_skill_files` are registered read-only tools; calls return file contents
      and are metered (request/response tokens) like MCP `tools/call`; **no** script execution path
      exists.
- [ ] Eager toggle additionally inlines the SKILL.md body and accounts its L2 tokens; off by default.
- [ ] `latest` resolves at run time; `pinned` resolves to the fixed version. Tests use a mock model
      (no key) and assert the L1 block, the disclosure-tool read accounting, and eager behavior; repo
      gate green.

## Notes
Modifies core testing run files — run **solo**. Preserves the "app never executes skills" invariant.
