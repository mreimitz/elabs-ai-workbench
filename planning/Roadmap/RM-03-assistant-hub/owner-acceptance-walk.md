---
type: "Work Package Spec"
title: "Assistant Hub \u2014 keyboard + both-theme owner-acceptance walk (WP4.4)"
description: "A concrete, surface-by-surface script for the \"Both-theme + keyboard walk of every new surface\""
tags: ["roadmap", "RM-03"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# Assistant Hub — keyboard + both-theme owner-acceptance walk (WP4.4)

A concrete, surface-by-surface script for the "Both-theme + keyboard walk of every new surface"
line item in [`STATUS.md`](./STATUS.md)'s Owner-acceptance section. **WP4.R** runs this walk (or
delegates it to the owner) as part of final acceptance — it is not part of the automated gate
(`pnpm typecheck && pnpm test && pnpm build && pnpm lint`), which cannot drive a real browser or
judge visual correctness.

## How to run this walk

1. Start the app (`pnpm dev` or the built Docker image) with at least one hub-eligible provider
   credential configured (Settings → Providers) so `/assistant` doesn't show the "not configured"
   empty state.
2. For **every** surface below, repeat the same two passes:
   - **Both themes** — switch to `light`, then `dark` (Settings → theme, or the
     `ThemeSwitcher`), and confirm the surface reads correctly in both: text contrast, badge/status
     colors, focus rings, chart/graph colors (`TopologyGraph`, `UsageView` charts), and no raw-color
     bleed-through.
   - **Keyboard-first** — unplug the mouse mentally: `Tab`/`Shift+Tab` to reach every interactive
     element in a sane order, `Enter`/`Space` to activate, `Escape` to close overlays, and confirm a
     **visible focus ring** at every stop. No control should be reachable only by click.
3. Record any finding as a `STATUS.md` blocker (owner or WP4.R does the actual ticking — this
   walk-script only defines what "done" means).

---

## 1. Chat (`/assistant`, mode `chat`/`research`)

- [ ] Both themes: the transcript (`ConversationPane`), composer (`Composer`), model chip, context
      gauge, and `Shimmer`/streaming states all read correctly; tool-call cards
      (`input-streaming → input-available → approval → output-*`) are legible in both themes,
      including the approval card's destructive/read-only badges.
- [ ] Keyboard: `Tab` reaches the session rail → composer textarea → attach/model/plan-first/
      commands/voice buttons → Submit/Stop, in a sane order. Typing `/` opens the slash-command
      menu; `↑`/`↓` moves the highlight, `Enter` selects, `Escape` dismisses without losing typed
      text. An approval card's Approve/Deny buttons are reachable and activate with `Enter`/`Space`.
- [ ] Both themes + keyboard: the citations `Sources` panel and inline `[n]` chips (hover card) are
      reachable and legible.

## 2. Mission board + plan card (`/assistant`, mode `mission`)

- [ ] Both themes: the `MissionPlanCard` (badges for topology/autonomy/agent count/estimate,
      per-agent brief/rationale/tools/budget) and the `MissionBoard` (phase badge, per-agent
      `Agent`/`AgentTimeline` cards, budget meter, `TopologyGraph`) all read correctly, including
      the confidence badges (`high`/`medium`/`low`) and a PARTIAL-synthesis marker.
- [ ] Keyboard: reach and activate Approve/Cancel on the plan card, and Stop-agent/Stop-mission/
      steer on the board, without a mouse. The topology graph's nodes don't trap focus.
- [ ] Both themes: run each topology at least once visually — `parallel`, `pipeline`, `debate`,
      `best_of_n` — and confirm the live graph state (waiting/active/reported/winner/missing) is
      distinguishable by more than color alone (shape/label too).

## 3. Agents + crews (`/assistant/agents`)

- [ ] Both themes: the role library list/detail, the system-prompt editor, the MCP server + per-tool
      grant picker, the skills picker, and the crew builder (topology picker, member list) all read
      correctly.
- [ ] Keyboard: create/edit/archive a role and a crew end-to-end using only the keyboard, including
      the tool-grant picker's per-server/per-tool checkboxes.

## 4. Projects (`/assistant/projects`)

- [ ] Both themes: the project list, the instructions/pinned-files editor, and the session-rail
      grouping by project read correctly.
- [ ] Keyboard: create a project, set instructions, pin a file, and assign a session to it without a
      mouse.

## 5. Memory (`Memory` view)

- [ ] Both themes: memory list/edit/archive, the source badge (`user` vs `assistant_proposed`), and
      the in-transcript "Save to memory?" proposal chip all read correctly.
- [ ] Keyboard: accept/dismiss a memory proposal chip, and edit/archive an existing memory entry,
      without a mouse.

## 6. Usage + context inspector (`/assistant/usage`, `SessionContextPanel`)

- [ ] Both themes: the Usage view's charts (spend by model/provider/mode/day, mission breakdowns)
      read correctly — check the `@elabs-ai/components-charts` series colors against both theme backgrounds.
- [ ] Both themes: the per-session **context inspector** (`SessionContextPanel`) — the per-layer
      window breakdown (prompt sections, eager vs deferred tool defs, skill L1/L2/L3, memory,
      project, history) — is legible, including its own token/percentage numbers.
- [ ] Keyboard: open the context inspector from the header button, tab through its sections, and
      close it, without a mouse.

## 7. Audit (`/assistant/audit`)

- [ ] Both themes: the filterable audit timeline (tool calls, approvals, spawns, model calls) and
      its deep-links into session replay read correctly.
- [ ] Keyboard: apply a filter, follow a deep link into a session, and return, without a mouse.

## 8. Artifacts (`ArtifactCanvas`, the review workflow)

- [ ] Both themes: the artifact list, the Content/Diff/Review tabs, the version list + Revert
      action, and the export menu (md/html/json/`share.html`) all read correctly. Open the
      `share.html` export and confirm it's legible standalone (no app CSS) in a plain browser tab —
      check it isn't hardcoded to one theme.
- [ ] Both themes: the review workflow (`AI/ChangeReview` hunk-by-hunk accept/reject with
      `ChangeProvenance`) reads correctly, including the accept/reject buttons' states.
- [ ] Keyboard: select an artifact, switch tabs, revert a version, and accept/reject a review
      comment, without a mouse.

## 9. Cross-cutting

- [ ] Both themes: the composer's `SpeechInput` degrades to a disabled-but-visible button where the
      browser lacks Web Speech API support (never a crash or a missing control).
- [ ] Keyboard: screen-reader announcements fire on state changes that matter — mode switch, mission
      phase change, approval outcome (spot-check with VoiceOver/NVDA if available; otherwise confirm
      the `aria-live`/`role="status"` regions exist in the DOM).
- [ ] Reduced motion: with the OS "reduce motion" preference on, streaming/shimmer/transition
      animations are toned down rather than ignored.

---

Findings from this walk that need a code fix become a `STATUS.md` blocker for the owning WP's
agent to pick up (per the plan's review discipline, [`execution-plan.md`](./execution-plan.md) §4);
this script itself stays a checklist, not a place to record results.
