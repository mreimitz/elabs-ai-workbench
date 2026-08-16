# WP 4.2 — mission agent grid + detail box

**Phase:** 4 · **Size:** S · **Depends on:** — · **Model:** Sonnet · **Agent profile:** web

## Objective

Reported agents render as a responsive 2-up grid instead of a vertical stack; selecting an agent
card opens a detail box below with Status and Report tabs (a Live tab arrives with WP 4.3).

## Why / evidence

`analysis.md` RC6.3: `<ul className="flex min-w-0 flex-col gap-3">` (`MissionBoard.tsx:294`).
Owner ask: "they should be shown in a grid, at least 2 next to each other, clicking each of them
shows the status, live session or result in a box below."

## Design

- Container → `grid gap-3 sm:grid-cols-2` (cards already carry `min-w-0`; verify long
  open-questions lists truncate with expand, not overflow).
- Cards become selectable (button semantics, `aria-pressed`, keyboard reachable); selection state
  lives in `MissionBoard`; selected card gets the token-driven selected treatment.
- Detail box below the grid: `@brand/ui` Tabs with **Status** (state, model, confidence, costs
  when WP 2.4 lands, timestamps) and **Report** (the full findings/open-questions render that
  currently lives inline). Grid cards themselves get more compact (summary line + badges) since
  depth moved to the detail box.
- Waiting/queue section unchanged.

## Files (exclusive)

- `apps/web/src/features/hub/MissionBoard.tsx` (+ `Mission.test.tsx` updates)

## Acceptance

- [ ] ≥2 reported agents render 2-up at `sm+`, single column below; no horizontal overflow with long content (test with the live session's verbose reports as fixture).
- [ ] Card select/keyboard/a11y (`aria-pressed`, focus ring tokens); detail box renders Status + Report for the selection.
- [ ] Zero-selection default: first reported agent selected (or none + hint; pick one, test it).
- [ ] Both themes; tokens only.
- [ ] Gate green.
