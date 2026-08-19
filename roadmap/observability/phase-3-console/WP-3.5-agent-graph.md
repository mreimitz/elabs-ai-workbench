# WP-3.5 — Agent graph lens over a run

> **Status: PROPOSED (amendment AM-OB9, 2026-08-18) — pending owner lock.** Not part of the
> original 27-WP plan. Its dependencies **WP-3.1 (step hierarchy) and WP-3.2 (per-step
> economics) are built** (ledger 2026-07-17), so this WP is **implementable immediately** on
> owner lock. Evidence: `research/langfuse-landscape/01-gap-analysis.md` §G4,
> `03-charts-viz-inventory.md` §1/§Mapping.

## Goal

A third lens on the run console: the run as a **node-link graph** — the agent's shape at a
glance (which tools, how often, where it looped, where it erred) — complementing the
conversation lens and the step log. Langfuse ships this as its "agent graph" with two modes;
SkillFlow's Design/Trace tabs already prove the two-lens graph idea for skills. This WP is
the analog for runs.

## Scope

- **Graph projection (pure function, api or web-lib):** `run_steps` (+ `parentStepId` from
  WP-3.1) → graph model. Node kinds: turn, tool call (grouped per tool name), sub-step
  (judge/rating calls once hierarchy exposes them). Edge = execution order / parentage.
- **Two modes** (top-left toggle, mirroring SkillFlow's tab grammar):
  - **Aggregated** (default): steps sharing a name merge into one node with a **×N
    counter**; repeated sequences render as cycles — the run's shape.
  - **Expanded:** every call its own node, loops unrolled, execution order left→right.
- **Node chips:** call count, tokens in/out, est. cost (WP-3.2 rollups), error badge
  (level/status), duration. Degrade gracefully when economics aren't computed.
- **Cross-links (D-UX workflow-link grammar):** click node → StepLog/conversation filtered
  to those steps; click error badge → first failing step; selection syncs with the in-run
  search lenses (WP-3.4) where present.
- **Live + replay:** graph derives from the same event stream as the console; grows during
  streaming, identical on replay.

## Non-goals

No editing (read-only lens). No cross-run/fleet graphs (a later Phase-5 candidate at most).
No new persistence — the graph is a pure projection; **no schema change, no wire change**
beyond what WP-3.1 already adds.

## Implementation notes

- Rendering: `@xyflow/react` (already a vendored peer via SkillFlow) + brand-ui node
  compositions — **not** ELK/Mermaid (Langfuse uses elkjs, Opik uses Mermaid; we already own
  a stronger interactive graph stack). Layout via the same dagre/auto-layout approach
  SkillFlow uses; direction: top-down aggregated, left-right expanded (matches Langfuse's
  choice and reads well for both shapes).
- Route state: lens selection is a URL param on `/testing/runs/:runId` per
  `.claude/rules/routes-vs-dialogs.md` (deep-linkable, zero-param default still renders).
- Both themes; keyboard: nodes focusable, Enter follows the cross-link (D-TB5 tooltip==label
  on any icon affordances).

## Acceptance

1. A run with repeated tool calls renders an aggregated graph with merged ×N nodes and at
   least one cycle; expanded mode unrolls it in execution order.
2. Node chips show count/tokens/cost/error consistent with the KPI rail totals.
3. Click-through node → filtered step view works live and in replay.
4. Deep link with the graph lens selected restores the exact view; both-theme walk clean.
5. Graph projection unit-tested (fixtures: linear run, looping run, erroring run, run
   without hierarchy — pre-WP-3.1 data renders flat without crashing).
6. Gate green (`pnpm typecheck && pnpm test && pnpm build && pnpm lint`).
