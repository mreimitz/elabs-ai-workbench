# WP 2.3 — Web: Trace tab — overlay, run picker, conversation pane

**Phase:** 2 · **Size:** L · **Depends on:** 1.3, 2.2

## Objective
The "aha" surface: a sixth `SkillInspector` tab — **Trace** — that overlays a selected run's
alignment onto the same canvas the Design tab renders: green where execution matched design, red on
fractures, dimmed on never-visited, with counts/chips/route markers, and a conversation pane synced
to node selection.

## Why / references
D1 (same canvas, same inspector), `@elabs-ai/components-flow` `FlowNode.tone` (`success`/`destructive`) is the
native mechanism for the overlay; conversation rendering reuses the testing console's `@elabs-ai/components-ai`
patterns (`ConversationPane` precedents in `apps/web/src/features/testing/`).

## Files
- `apps/web/src/features/skills/trace/SkillTraceView.tsx` *(create)* — run picker (`Select` fed by
  `GET …/versions/:vid/runs`; `EmptyState` when no runs — with guidance "attach this skill to a
  scenario and run a test"), canvas reusing `SkillDesignView`'s layout + node mapping with
  verdict → `tone` overlay (`ok`→`success`, `fracture`→`destructive`, `unvisited`→dimmed via
  semantic tokens), execution-count `Badge`s, exit-code chips on gates, expected-vs-actual route
  markers on gatekeepers, traversal counts on trace edges; `Legend` extended with the three verdict
  states.
- `apps/web/src/features/skills/trace/TraceEvidencePane.tsx` *(create)* — side pane
  (`ResizablePanelGroup`): the run's turns/tool calls (reuse the testing feature's conversation
  components; link out to the full run console route `/testing/runs/:runId`); selecting a node
  filters/scrolls to its `evidence` events; `unmatchedEvents` surfaced in a collapsible section
  (honest coverage).
- `apps/web/src/features/skills/design/SkillDesignView.tsx` *(modify)* — extract the shared
  canvas/layout core so Design and Trace render one implementation with an optional overlay
  (no forked canvas).
- `apps/web/src/features/skills/skills-inspector-api.ts` *(modify)* — `getSkillVersionRuns`,
  `getSkillTrace(id, vid, runId)`.
- `apps/web/src/features/skills/SkillInspector.tsx` *(modify)* — add the `trace` tab (order:
  Overview · Design · **Trace** · Files · Versions · Diff); deep-linkable preselected run via
  query param if trivially supported by existing routing.

## Acceptance
- [ ] Selecting a run renders the overlay: at least one fixture-real walk shows a green path, a
      red fracture (failed gate or misroute), and a dimmed never-visited node; version-mismatch
      409 from the API surfaces as a clear inline error, not a toastless failure.
- [ ] Node click → evidence pane shows exactly the verdict's evidence events; unmatched events
      visible; link to the full run console works.
- [ ] One shared canvas implementation for Design + Trace (no divergence); all verdict styling via
      `tone`/semantic tokens — zero raw colors; both themes.
- [ ] Repo gate green.

## Notes
⚠ OWNER-VERIFY: the Phase-2 owner acceptance item — a real run with an attached skill walked in
both themes @ localhost:8080.
