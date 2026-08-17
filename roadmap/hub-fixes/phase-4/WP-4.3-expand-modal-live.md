# WP 4.3 — expand modal + per-agent live session panel

**Phase:** 4 · **Size:** L · **Depends on:** 2.1, 4.1, 4.2 · **Model:** Opus · **Agent profile:** web

## Objective

An expand button on the mission graph opens a full-size modal: the topology flow on the left,
and a right panel that streams the selected agent's LIVE child session (transcript incl. tool
calls), or its report when finished. The board's detail box gains the same Live tab.

## Why / evidence

`analysis.md` RC6.2/RC6.4: no expand affordance (`MissionBoard.tsx:285-289`), nodes
non-selectable (`TopologyGraph.tsx:31, :83`), and (pre-2.1) nothing to stream. Owner ask verbatim:
"i need an expand button in the right top corner which opens up the flow in a large modal, in
there i want to be able to click on a agent node and in a right panel i want to see the live
session running." Repo pattern for expand-to-full-modal: `features/testing/TraceLeafDetail.tsx:62-77`
(`Maximize2` → `DialogContent size="full"`).

## Design

- **Expand:** icon button (`Maximize2`) top-right of the graph card → `Dialog` `size="full"`;
  left ~55% = `TopologyGraph` with `selectable` nodes enabled (new prop; keep the inline board
  graph non-interactive except via the expand), right panel = agent panel for the selected node.
- **Live transcript:** child sessions are real hub sessions with SSE
  (`GET /api/hub/sessions/:id/stream`). Add a read-only transcript component: either a `readOnly`
  mode of `ConversationPane` or a slimmer `AgentTranscript` fed by `use-hub-stream` (prefer the
  slim component; ConversationPane is contended by WP 3.1/6.1 — decide with the orchestrator).
  Shows streaming text, reasoning collapsed, tool_call/tool_result cards, approval-waiting state.
- **States:** node running ⇒ live stream; reported ⇒ Report view (same renderer as WP 4.2 detail);
  terminal synthesis node ⇒ the synthesis message. Non-agent nodes (Judge) show their step info.
- **Board detail box:** Live tab wired to the same transcript component.
- Modal closes cleanly (unsubscribe streams); no polling loops left behind.

## Files (exclusive)

- `apps/web/src/features/hub/MissionBoard.tsx` (expand button + Live tab), `TopologyGraph.tsx` (selectable prop + node click), new `MissionExpandDialog.tsx`, new `AgentTranscript.tsx` (+ tests)
- `apps/web/src/features/hub/use-hub-stream.ts` ONLY if a read-only subscription variant is missing (keep additive)

## Acceptance

- [ ] Expand opens full dialog; graph interactive; node selection drives the right panel; Esc/close unsubscribes (leak test via unmount assertions).
- [ ] Live agent (stubbed stream) renders streaming transcript incl. a tool call card; finished agent shows its report; synthesis node shows the final message.
- [ ] Keyboard path: nodes focusable, Enter selects; panel labelled for SR.
- [ ] Both themes; tokens only; no layout overflow at 1280×800 and 1920×1080.
- [ ] Gate green.

## Notes / owner-acceptance

Full live-stream feel (real model latency, real the vendor calls) is an owner-acceptance walk item; the
gate proves it with the stub stream.
