# WP 3.2 — Run report: hierarchical trace + per-level attribution

**Phase:** 3 — Board, replay & reporting · **Size:** M · **Depends on:** 3.1 · **Model:** Sonnet

## Objective

The hub run report (`GET /api/hub/sessions/:id/report/{json,markdown}`, backed by
`apps/api/src/hub/session-report.ts`) currently dumps every mission-related event
(`plan_proposed`/`agent_spawned`/`agent_report`/`mission_synthesis`/…) generically, one flat block
per event, with no notion of a crew tree. This WP adds a genuine hierarchical execution trace —
parent crew → child crew → agents, with per-level token/cost/timing attribution — to **both** the
JSON and Markdown exports (D-CN7), built on top of the tree-aware board reconstruction WP 3.1
lands in `board.ts`. A **legacy flat mission** (today's only shape — no nesting) must render
exactly as it does today: the new trace is additive, and for a flat mission it collapses to one
node with no children, so nothing regresses.

## Why / references

- **D-CN7** — "Hierarchy is event-sourced (R-SES1 preserved)… cost/timing roll up per level" —
  this WP is the reporting consumer of that rollup.
- **D-CN2** — a nested crew's synthesised answer is projected into one stamped `HubAgentReport`
  returned through `HubAgentRunResult`; the report's hierarchy must still show the real nested
  structure underneath that collapse, not just the collapsed leaf.
- **D-CN6** — every mission in a tree keeps `session_id` = the root chat session; the whole tree
  therefore lives in **one** session's `hub_events` log, reachable via `repository.listEvents(id)`
  exactly as today's report builder already fetches it — no new repository call needed.
- Exact anchors (`references.md` → "Execution engine" / current code):
  `apps/api/src/hub/session-report.ts` (`buildHubSessionJsonReport`/`buildHubSessionMarkdownReport`,
  the whole file — no hierarchy today, mission events fall into `renderEvent`'s generic `default`
  branch), `apps/api/src/hub/missions/board.ts` (`reconstructMission:52`, `MissionBoardAgent:21`,
  `MissionBoardState:34` — the **pre-3.1**, single-mission-only reducer this WP's tree builder sits
  on top of), `apps/api/src/hub/routes.ts:1885-1901` (the two report routes — signatures do **not**
  change), `packages/shared/src/types.ts` `HubAgentReportEvent:6320` (`costUsd?`/`tokensIn?`/
  `tokensOut?` — already present from hub-fixes WP2.4, the real per-agent spend this WP sums),
  `HubPlanProposedEvent:6286`/`HubAgentSpawnedEvent:6310` (gain `parentMissionId?` from 3.1's
  event-sourced parent-linkage — the field this WP groups on).
- Precedent for the "legacy renders unchanged via read-time projection" mechanic: `deriveLegacyAnswerStep`
  (`apps/api/src/testing/vendor-assistant-message.ts:409`) — a pure function that derives new rendering
  fields for old-shaped data and returns the input **unchanged** when nothing applies, so one
  renderer serves both eras with no migration and no regression on the old shape.

## Design

**1. New pure module `apps/api/src/hub/mission-trace.ts`** — the tree assembler. It does **not**
reimplement phase/agent/synthesis extraction (that's `board.ts`'s job, extended in 3.1); it groups
missions and rolls up numbers over whatever tree-aware reconstruction 3.1 exposes.

- `HubMissionTraceNode` (report-local type, same "self-describing export format" precedent as
  `HubSessionReport` itself — not a live `/api` wire schema, so no `packages/shared` change is
  needed for this type):
  ```ts
  type HubMissionTraceNode = {
    missionId: string;
    depth: number;               // computed by this builder (root = 0), never read from a DB column
    topology: HubTopology;
    phase: MissionBoardPhase;     // from board.ts
    autonomy?: HubAutonomyLevel;
    roleName?: string;            // how this node was labeled as a slot in its PARENT's plan (absent on the root)
    agents: MissionBoardAgent[];  // THIS level's own leaf agents only (board.ts's tree-aware split, reused verbatim)
    synthesis?: { messageId?: string; partial: boolean };
    rollup: { costUsd: number; tokensIn: number; tokensOut: number; durationMs?: number };
    children: HubMissionTraceNode[];
  };
  ```
- `buildMissionTraceForest(events: readonly HubEvent[]): HubMissionTraceNode[]`:
  1. Walk every `plan_proposed` event once to build a `missionId → parentMissionId` index (the
     field 3.1 adds). A mission with no `parentMissionId` is a **tree root**.
  2. For each missionId, get that level's board state via 3.1's tree-aware reducer in `board.ts`
     (confirm the actual landed export before wiring — most likely an extended `reconstructMission`
     that accepts a target `missionId` instead of always picking "the latest", or a sibling
     `reconstructMissionAt(missionId, events)`; adapt the call site to whatever 3.1 actually ships,
     the shape assumed here is the *contract*, not a name to invent independently).
  3. Recurse into `children` = every mission whose `parentMissionId` equals this node's `missionId`,
     in first-seen order (stable, deterministic walk — not object-key order).
  4. `rollup` = this level's own `agents[].costUsd/tokensIn/tokensOut` (absent on a pre-fix event ⇒
     `0`, never fabricated — mirrors the existing `HubAgentReportEvent.costUsd?` comment) **plus**
     the recursive sum of every child's already-computed `rollup`. This makes a node's rollup always
     ≥ its own agents' total, mirroring D-CN3's monotone-cascade spirit at the *reporting* layer —
     this WP reports actuals, it does not enforce the budget cap (that's 2.2).
  5. `durationMs` = this mission's own `mission_started.at` → its own last event `at` for this
     `missionId` (favoring `mission_synthesis.at` when present); absent (never fabricated) when the
     mission never started or never reached a terminal marker.
  6. **The legacy guarantee is structural, not a special case:** a mission that is nobody's
     `parentMissionId` and has no `parentMissionId` of its own — true of every mission that exists
     today — becomes a single root node with `children: []`. Lock this with a regression test (see
     Acceptance) so a later change to the grouping logic can't silently start nesting flat missions.

**2. `apps/api/src/hub/session-report.ts` (modify, additive only):**
- `HubSessionReport` gains `missionTraces?: HubMissionTraceNode[]`. **`version` stays `1`** — this
  is a new optional field, not a breaking shape change (the existing `assert.equal(report.version,
  1)` in `hub-session-report.test.ts` must keep passing).
- `buildHubSessionJsonReport` computes `buildMissionTraceForest(events)` and spreads it in only when
  non-empty — mirrors the existing `...(mission ? { mission } : {})` optional-field idiom already
  used in `routes.ts`.
- `buildHubSessionMarkdownReport` gains a new `## Mission trace` section, inserted **between** the
  header block and the existing `## Transcript` heading, rendered **only** when `missionTraces.length
  > 0`. A new `renderMissionTraceNode(node, depth)` helper renders each node as a heading line
  (`missionId` / topology / phase / depth), a rollup line reusing the same `$X.XXXXXX` / `N in / M
  out` formatting already in this file (factor the shared bits so the two don't drift), a bullet
  list of this level's leaf agents, the synthesis/partial line, then **recurses into `children`
  with indentation increased 2 spaces per depth level** (bullet-list nesting, not heading levels —
  `HUB_MISSION_MAX_DEPTH` can exceed Markdown's H1–H6 ceiling). This satisfies "indentation/tree,
  per-level subtotals" from the pinned scope.
- **The existing `## Transcript` section is untouched** — every event (including mission events)
  still renders exactly as today via `renderEvent`'s existing branches/default dump. This is what
  makes the change strictly additive and is *why* a flat legacy mission "renders exactly as
  before": its only pre-existing content (the transcript) doesn't change at all; the new `## Mission
  trace` section is purely additive on top, and for a flat mission it's a single, unnested block.

**3. No route change.** `buildHubSessionJsonReport`/`buildHubSessionMarkdownReport` keep their
existing `(session, events, now)` signature — `apps/api/src/hub/routes.ts:1885-1901` needs zero
edits; both already pass in the full session event log the new builder needs.

## Files

- `apps/api/src/hub/mission-trace.ts` *(create)* — `HubMissionTraceNode` + `buildMissionTraceForest`;
  pure, no I/O, reuses 3.1's tree-aware `board.ts` reconstruction.
- `apps/api/test/hub-mission-trace.test.ts` *(create)* — unit tests: nested-tree grouping, rollup
  sums, duration derivation, the flat-collapses-to-one-node regression lock.
- `apps/api/src/hub/session-report.ts` *(modify)* — wire `missionTraces` into the JSON shape; add
  the `## Mission trace` Markdown section + `renderMissionTraceNode` helper.
- `apps/api/test/hub-session-report.test.ts` *(modify)* — add assertions that a mission-bearing
  session's JSON carries `missionTraces` and its Markdown carries `## Mission trace` with nested
  indentation; keep every existing assertion green unmodified (proves the transcript is untouched).

## Acceptance

- [ ] `buildMissionTraceForest` on a synthetic 2-level fixture (`mission-1` depth 0, one leaf agent
      + one crew-ref slot whose child is `mission-2` depth 1 via `parentMissionId`) returns exactly
      one root node whose `children` contains one node with `missionId === "mission-2"` and
      `depth === 1`.
- [ ] The root node's `rollup.costUsd`/`tokensIn`/`tokensOut` equal its own leaf-agent totals plus
      `mission-2`'s node rollup (a monotone-sum test, not just a smoke check).
- [ ] `buildHubSessionJsonReport` on the same fixture includes
      `missionTraces[0].children[0].missionId === "mission-2"`; `report.version` is still `1`.
- [ ] `buildHubSessionMarkdownReport` on the same fixture contains a `## Mission trace` heading, and
      `mission-2`'s rendered block is indented deeper than `mission-1`'s (assert the two distinct
      indentation depths / nesting order in the output string).
- [ ] A flat (single-level, no `parentMissionId` anywhere) mission fixture — the shape every mission
      produces today — yields `missionTraces` with exactly one node and `children: []`.
- [ ] Every pre-existing assertion in `hub-session-report.test.ts` (event order, spine rendering,
      `version === 1`, the structural-event dump) stays green **unmodified**, proving the transcript
      section is byte-for-byte unchanged.
- [ ] A session with no mission at all: `missionTraces` is absent from the JSON and no `## Mission
      trace` heading appears in the Markdown (regression guard on the "only when non-empty" gate).
- [ ] Gate green (`pnpm typecheck && pnpm test && pnpm build && pnpm lint`).

## Notes

- **Solo-safe / parallel-friendly:** this WP touches only `apps/api/src/hub/session-report.ts` + a
  new file + tests — it does **not** touch `board.ts`, `orchestrator.ts`, `topologies.ts`, or any
  contested hot file. Per the README's dependency graph it runs in the same parallel batch as `3.2,
  4.1, 4.2, 4.3` (disjoint files: web workpackages vs. this API-only report WP).
- **Hard dependency on 3.1's actual landed shape:** the exact export name/signature this WP calls
  into `board.ts` (a `missionId`-targeted reconstruction, plus the `parentMissionId` field on
  `plan_proposed`/`agent_spawned`) is 3.1's to land. Confirm the real shape against 3.1's merged
  code before wiring `mission-trace.ts` — the contract described here (per-mission reconstruction
  keyed by id, with parent linkage discoverable from `hub_events` alone) is what 3.1 promises, not
  a name to invent independently. If 3.1's board doesn't yet separate "this level's leaf agents"
  from "a crew-ref slot that expanded into a child," that split must exist before this WP can
  correctly render per-level agent lists — treat it as a blocker back to 3.1, not something to
  reimplement here.
- Do **not** reach for `HubAgentReport.subMissionId`/`childReports` (D-CN5, added in 0.1) as the
  primary correlation mechanism — those live on the collapsed, already-synthesized report and carry
  no per-agent cost/token data (that only exists on the raw `agent_report` event). The
  `parentMissionId` event-sourced link is the one this WP's rollup needs.
- No `packages/shared` change and no migration in this WP — `HubMissionTraceNode` is a report-local
  export type (same precedent as `HubSessionReport` itself), and the report builder only ever reads
  `session` + `events` it's already given.
