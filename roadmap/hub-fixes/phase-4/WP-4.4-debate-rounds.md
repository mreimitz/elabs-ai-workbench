# WP 4.4 — round-based debate (parallel openings + rebuttals)

**Phase:** 4 · **Size:** M · **Depends on:** 2.1, 4.1 · **Model:** Opus · **Agent profile:** API engine + graph

## Objective

Debate becomes round-based (D-HF3): round 1 runs ALL debaters in parallel on the bare brief
(independent opening statements); round 2 runs them in parallel again, each seeing every OTHER
debater's opening and instructed to rebut; the synthesis step stays the resolver. The graph shows
the two rounds truthfully.

## Why / evidence

`analysis.md` RC6.1: today's debate is a sequential single pass (`topologies.ts:191-206`), which
surprised the owner and weakens the adversarial value (debater 1 never sees any counter-argument).
Round-based keeps the challenge semantics and matches the parallel intuition. Rounds default to 2
(openings + one rebuttal), plan-configurable.

## Design

- **Shared (additive):** `debateRounds?: number` on the mission plan (zod: int 1..3, default 2;
  `1` reproduces independent openings only). Planner may set it; plan card shows it.
- **`runDebate` rewrite:** reuse the existing parallel worker pool (`runParallel`'s pool at
  `topologies.ts:137-160`) per round; between rounds, compose each debater's next brief from all
  OTHER debaters' latest reports (`composeHandoffBrief` gains a debate-round variant: "rebut or
  strengthen against these opposing arguments"); a debater that produced nothing drops out of later
  rounds (never halts the debate); budget trip checked at round boundaries; `synthesisReports` =
  final-round reports (+ openings of dropped debaters, flagged).
- **Reports/board:** each round's report is an `agent_report` (existing event; the report's
  `roleName` stays stable). The board's agent card shows the latest round + a round chip.
- **Graph (`topology-graph.ts`):** debate renders rounds as rows: openings row (parallel), rebuttal
  row, then `Synthesis (resolver)`; edges: each opening → each other's rebuttal ("rebuts"),
  rebuttals → synthesis. Builds on WP 4.1's parameterized layout.
- **Invariants to preserve:** deterministic ordering within a round for replay; the 2.R topology
  ordering probes updated deliberately, not deleted.

## Files (exclusive)

- `apps/api/src/hub/missions/topologies.ts` (+ tests), `missions/shared.ts` (brief variant), `missions/planner.ts` (rounds field passthrough)
- `packages/shared/src/types.ts`, `schemas.ts` (additive `debateRounds`)
- `apps/web/src/features/hub/topology-graph.ts` (+ test; rounds layout), `MissionPlanCard.tsx` (rounds display; later batch than 2.2)

## Acceptance

- [ ] Round-1 parallelism proven (stub timestamps overlap); round-2 briefs contain the OTHER debaters' openings only (not the debater's own as "prior").
- [ ] `debateRounds: 1` ⇒ independent openings + synthesis; `2` default; clamp tested.
- [ ] Dropped-debater and budget-trip-at-round-boundary paths tested; mission `partial` semantics correct.
- [ ] Graph rows/edges match execution; legend text updated (WP 4.1's wording seam).
- [ ] Replay of OLD sequential-debate event logs still renders (fixture).
- [ ] Gate green.
