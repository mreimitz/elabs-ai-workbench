# WP 2.3 — grant inheritance rule + plan validation

**Phase:** 2 · **Size:** S · **Depends on:** 2.1 · **Model:** Sonnet · **Agent profile:** API

## Objective

One documented rule for what a mission agent may touch (D-HF5): effective child grants =
plan grants ∩ parent session scope; an auto (unscoped) parent passes plan grants through unchanged.
Enforced at spawn, tested, and shown on the plan card estimate.

## Why / evidence

`analysis.md` RC2/RC3: WP 2.1 passes plan grants straight through; without the intersection, a
scoped parent (say, acme-demo only) could spawn agents granted other servers by a crew role's
Access tab, silently escalating beyond the session the owner configured.

## Design

- Pure function `effectiveAgentGrants(planGrants, parentScope): HubToolGrants` in
  `hub/tools/grants.ts` (parent `null` ⇒ plan grants; otherwise per-server intersection where
  `"all" ∩ list = list`, `list ∩ list = set-intersection`, missing server ⇒ dropped; builtins
  intersect the same way with absent-parent-builtins ⇒ plan builtins).
- Orchestrator applies it at child `createSession` (WP 2.1's seam). When the intersection removed
  anything, append a plan-visible note event (additive reuse of existing event text channels; no
  new event type) so the board explains why an agent has fewer tools than the crew role promised.
- Plan card shows the EFFECTIVE grants when the parent is scoped (chip subtitle "2 of 5 tools after
  session scope").

## Files (exclusive)

- `apps/api/src/hub/tools/grants.ts` (+ test), `apps/api/src/hub/missions/orchestrator.ts` (apply at spawn)
- `apps/web/src/features/hub/MissionPlanCard.tsx` (effective-grant subtitle; coordinate with WP 2.2 — run in a later batch than 2.2 or rebase)

## Acceptance

- [ ] Table-driven tests for `effectiveAgentGrants` (all ∩ list, list ∩ list, dropped server, null parent, builtins).
- [ ] Spawn applies the rule; negative test: scoped parent + out-of-scope crew grant ⇒ child cannot resolve that server.
- [ ] Card subtitle correct for a scoped parent.
- [ ] Gate green.
