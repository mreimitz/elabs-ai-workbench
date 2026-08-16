# WP 4.4 — Rules UI + promote-to-test console button

**Phase:** 4 — Watch rules · **Size:** L · **Depends on:** 4.2, 4.3, 2.3 · **Model:** Sonnet

## Objective

Rules become configurable without touching the API: a rules management surface (list, create/
edit with the shared filter builder, action config, the mandatory historical preview), plus the
direct console affordance — "Promote to test" on any terminal run (D-OB21).

## Design

- Placement: Settings → Watch rules card linking to a routed management view (or a Testing-area
  route — follow where Settings routes live post-IA; record the choice, keep nav at 4).
- List: enabled toggle, trigger chip (on-terminal / windowed), last fired, fire count (audit
  join), edit/duplicate/delete (confirm tier).
- Editor (WideDialog or routed form per existing tiers):
  - Trigger step: on-terminal (RunFilter builder — REUSE the 2.3 filter-bar component; +optional
    sample %) or windowed (measure/groupBy/window/op/threshold/cooldown pickers bound to the
    1.2 vocabulary).
  - **Preview step (required for windowed):** renders `POST /api/watch-rules/preview` as a bar
    strip of trailing windows with fired markers — the save button is gated behind having seen
    it (conventions §11).
  - Actions step: checklist of the closed action set with per-action config (collection picker,
    grader picker, webhook secret + template + test-fire button, severity).
- Console button: "Promote to test" on terminal runs (RunBar overflow menu) → collection picker
  dialog → calls the 4.1 action path directly → success toast links to the draft test.
- Audit tab: recent `watch_rule_events` per rule (what fired, on which run, action results).

## Files

- `apps/web/src/features/watch/` (new: list, editor, preview strip, audit) + Settings card
  link, `apps/web/src/features/testing/RunBar.tsx` (promote menu item),
  `apps/web/src/lib/api.ts`
- Component tests: editor round-trip per trigger type, preview gating, action config
  serialization, promote flow (stubbed API)

## Acceptance

- [ ] Create/edit/duplicate/delete round-trip for both trigger kinds; invalid config surfaces
      zod detail inline.
- [ ] Windowed save is impossible without the preview having rendered (test).
- [ ] Webhook config: secret write-only (never echoed), test-fire wired.
- [ ] Promote-to-test from the console produces the draft and links to it (stubbed).
- [ ] Audit list renders fixtures.
- [ ] Both-theme + keyboard = owner-acceptance. Gate green.

## Notes

Reuse, don't rebuild: the filter builder is 2.3's component; the preview math is the API's.
Owns `features/watch/` + touches RunBar — batch accordingly.
