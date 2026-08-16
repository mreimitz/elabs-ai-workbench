# WP 2.1 — turn-engine agent runner (children = real sessions)

**Phase:** 2 · **Size:** L · **Depends on:** 1.1, 1.2 · **Model:** Opus · **Agent profile:** API engine · **RUNS SOLO**

## Objective

Mission agents stop being tool-less one-shot `generateObject` calls. Each planned agent runs its
child hub session through the normal session-service/turn-engine pipeline: granted MCP tools
callable, events streamed into the child session, real usage/cost, then a schema-guaranteed
`HubAgentReport` extracted at the end. This kills RC2 and unblocks the live per-agent panel (WP 4.3)
and cost integrity (WP 2.4).

## Why / evidence

`analysis.md` RC2. Children are created scope-less (`orchestrator.ts:381-391`); grants become prose
only (`orchestrator.ts:563`, `role-template.ts:37`); `createStructuredAgentRunner` has no `tools`
and hardcodes `costUsd: 0` (`orchestrator.ts:723-741`); `HubAgentRunInput` has no tool channel
(`orchestrator.ts:72-85`). Live proof: the crew plan granted `p_m2aMW4hyPJb3q8Evd6s:"all"` to both
agents and both still reported "No MCP tools are granted".

## Design (D-HF5 minimal form, D-HF7)

- **Child creation:** `createSession({..., kind:"agent", toolScope: planned.toolGrants})` (the
  intersection refinement is WP 2.3; here the plan grants pass through as the child's scope).
- **New runner `createSessionAgentRunner`:** for a planned agent, execute the brief as a user turn
  of the child session via `HubSessionService` (the same `executeTurn` path main sessions use, with
  the role prompt as the session system prompt input and the agent's budgets mapped to the existing
  turn budget seams). Tool grants resolve through the normal `mcpGrantsProvider` because the child
  now HAS a scope (WP 1.2's honor + 1.1's loading make them callable).
- **Report extraction:** after the turn completes, produce `HubAgentReport` with a bounded
  `generateObject` over the child transcript (system: "extract the report"; schema:
  `hubAgentReportSchema`), reusing the existing structured-output plumbing where practical. The
  orchestrator still re-stamps identity fields.
- **Usage/cost:** runner returns the child session's accumulated `costUsd`/`tokensIn`/`tokensOut`
  (turn engine already persists them per session) + the extraction call's usage.
- **Rollback:** `HUB_AGENT_RUNNER=session|structured` env, default `session`; `structured` keeps
  the old runner wired (one release).
- **Approvals:** child turns run with autonomy mapped from the mission (full policy is WP 2.5;
  here: mission `auto` ⇒ child auto-approves read-only-annotated tools, gates the rest closed with
  a report note — conservative and test-pinned).

## Files (exclusive — nothing else runs in this batch)

- `apps/api/src/hub/missions/orchestrator.ts`, `missions/shared.ts`
- `apps/api/src/hub/session-service.ts` (agent-kind turn entry seam)
- `packages/shared/src/types.ts`, `schemas.ts` (additive: runner input extensions, nothing breaking)
- `apps/api/src/config/env.ts`, `.env.example` (`HUB_AGENT_RUNNER`)
- `e2e/fixtures/hub-stub-llm-server.ts`, `e2e/smoke.spec.ts` (children now hit the stub with tool calls)
- Tests: orchestrator runner tests, mission integration test (stubbed MCP session: agent calls a granted tool; events land in the CHILD session log)

## Acceptance

- [ ] Mission e2e (stub): plan with per-agent grants → each child session log contains `tool_call` + `tool_result` events for a granted MCP tool → reports still validate against `hubAgentReportSchema` → synthesis runs.
- [ ] Child `toolScope` persisted and honored; an agent can NEVER call a server outside its grants (negative test).
- [ ] Real usage: child sessions accumulate tokens/cost; runner result mirrors them (no hardcoded zeros).
- [ ] `HUB_AGENT_RUNNER=structured` restores the old path byte-compatibly (existing tests pass under it).
- [ ] Topology semantics unchanged in this WP (debate stays sequential single-pass; ordering tests untouched).
- [ ] Gate green + e2e green.

## Notes

Do NOT change planner, topologies, budgets math, or the board here. Keep the diff focused: child
creation, the runner, report extraction, env seam, stub/e2e.
