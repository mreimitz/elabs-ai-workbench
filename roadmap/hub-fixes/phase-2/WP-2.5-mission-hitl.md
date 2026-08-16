# WP 2.5 — mission HITL approval policy

**Phase:** 2 · **Size:** M · **Depends on:** 2.1 · **Model:** Opus · **Agent profile:** API engine + board

## Objective

Decide and implement how tool-approval gating behaves INSIDE missions (D-HF6): mission autonomy
governs; `always_ask` queues every gated child call to the board; `threshold`/`auto` gate
destructive calls only. No mission ever stalls invisibly on a hidden approval.

## Why / evidence

With WP 2.1, child turns run through the turn engine whose HITL seam (assistant-hub WP 2.3) pauses
gated tool calls for a decision. Unattended child sessions + default `serverTrusted: false`
(`session-service.ts:682-687`) would deadlock missions or silently time out. `analysis.md` RC2
notes approval-gating as a contributing cause even for a fixed runner.

## Design

- Map mission autonomy → child approval policy at spawn: `always_ask` ⇒ every gated call emits the
  existing approval-request event, surfaced on the mission board as an approval queue (reuse
  `ApprovalCard`); `threshold`/`auto` ⇒ auto-approve tools whose annotations mark them read-only,
  gate destructive/unannotated ones (annotations only ever tighten, never loosen — keep the
  existing strict default).
- A pending approval pauses only that agent's slot (the topology's existing waiting semantics);
  the board shows "waiting on approval" state; deny ⇒ the tool call fails into the transcript and
  the agent continues (never fabricates a result).
- Timeout: a configurable `HUB_MISSION_APPROVAL_TIMEOUT_S` after which the call is auto-denied
  with a visible note (missions must terminate).

## Files (exclusive)

- `apps/api/src/hub/missions/orchestrator.ts` (policy mapping + queue surfacing), `apps/api/src/hub/turn-engine.ts` (only if the existing HITL seam needs a policy input — keep minimal), `apps/api/src/hub/tools/approval-policy.ts`
- `apps/web/src/features/hub/MissionBoard.tsx` (approval queue section; later batch than 4.2)
- `apps/api/src/config/env.ts`, `.env.example` (timeout)
- Tests: policy mapping matrix, deny-never-runs invariant preserved, timeout auto-deny, board queue rendering

## Acceptance

- [ ] Matrix test: autonomy × annotation ⇒ gate/auto decision as specified.
- [ ] `always_ask` mission surfaces a board approval card; approve resumes the agent; deny records a failed call and the agent proceeds honestly.
- [ ] Timeout auto-denies with a visible transcript note; mission completes.
- [ ] Existing HITL invariants (deny-never-runs) still hold (re-run those tests).
- [ ] Gate green.
