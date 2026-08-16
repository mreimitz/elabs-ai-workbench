# WP 2.2 — Alignment engine (deterministic signals → verdicts)

**Phase:** 2 · **Size:** L · **Depends on:** 1.1, 2.1

## Objective
The hard core of Trace Mode: `alignTrace(graph, events) → TraceAlignment` — a pure, deterministic
conformance check of an event stream against a `SkillGraph`, producing per-node/per-edge visit
counts, traversals, and verdicts (`ok | fracture | unvisited`), each backed by event evidence.

## Why / references
D7 — deterministic signals first: tool name → sub-routine, `skill_file_read` path → asset node,
`script_result` exit code → validation-gate verdict (non-zero = fracture), `subagent_spawn` →
sub-routine, visit counts over the loop threshold → loop fracture, `marker` events → exact
gatekeeper route matching (full breadcrumb hardening is WP 3.2). "Process mining for AI" —
[`../00-architecture.md`](../00-architecture.md).

## Files
- `apps/api/src/skillflow/aligner.ts` *(create)* — `alignTrace(graph: SkillGraph, events:
  TraceEvent[]): TraceAlignment`. Deterministic matching only; anything it cannot attribute goes to
  an `unmatchedEvents` list on the alignment (honest coverage — no silent drops, no fuzzy
  guessing). Stamped `alignerVersion`.
- `apps/api/src/skillflow/routes.ts` *(modify)* — `GET /api/skills/:id/versions/:vid/trace?runId=…`
  → project graph (WP 1.1) + normalize run (WP 2.1) + align; returns the full `SessionTrace`.
  409 when the run's `run_skills` version differs from `:vid` (aligning a trace against a version
  it didn't run is a user error, surfaced — not silently accepted).
- `apps/api/test/skillflow-aligner.test.ts` *(create)* — synthetic graph+trace fixtures per
  verdict class: clean pass (all green), failed gate (exit≠0 → fracture with evidence), asset
  never read (`unvisited`), loop over threshold (fracture), gatekeeper marker mismatch (fracture),
  events that match nothing (land in `unmatchedEvents`); determinism (same inputs → deep-equal);
  version-mismatch 409.

## Acceptance
- [ ] All deterministic signal classes from D7(a) implemented and fixture-tested; every verdict
      carries `evidence` event indices; unmatched events reported, never dropped.
- [ ] Pure function over the two WP 1.0 shapes — no model calls, no network, no fs; response
      stamped with both `projectorVersion` and `alignerVersion`.
- [ ] Version-mismatch guard (run vs. requested skill version) returns 409 with a clear message.
- [ ] Repo gate green.

## Notes
This is the risk-carrying WP of the plan — keep it fixture-heavy. LLM-as-judge drift detection is
explicitly **not** here (Phase 5, owner-gated); do not add model calls.
