---
type: "Work Package Spec"
title: "WP 2.5 \u2014 Feedback UI: console thumbs/notes + feed chips + filter"
description: "Phase: 2 \u2014 Monitoring surfaces \u00b7 Size: M \u00b7 Depends on: 1.5, 2.3 \u00b7 Model: Sonnet"
tags: ["roadmap", "RM-17"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# WP 2.5 — Feedback UI: console thumbs/notes + feed chips + filter

**Phase:** 2 — Monitoring surfaces · **Size:** M · **Depends on:** 1.5, 2.3 · **Model:** Sonnet

## Objective

Start accumulating human signal (D-OB15): thumbs + note on a run, thumbs on individual
assistant turns, visible as chips in the console and the runs feed, filterable — and visually
distinct from grader verdicts everywhere.

## Design

- Console: RunBar (or report header) run-level thumbs up/down + optional note popover (writes
  `key:"verdict"`, score +1/−1, upsert semantics from 1.5); per-assistant-turn hover thumbs in
  `ConversationPane` (step-level rows). Distinct iconography/tone from judge verdict chips —
  human feedback must never read as a grade (label it "Your verdict").
- Feed: feedback chip in the row + the preview-cell option (2.3 defined the slot); filter chips
  already supported via RunFilter `feedback` (1.5) — verify end-to-end.
- Report tab: a small "Your feedback" line in the run report surface (render-only; the exported
  report JSON/MD may include it under a clearly separate `humanFeedback` block — additive,
  coordinate with `reports/`).
- Replay: feedback is editable on finished runs (that's the point); live runs too.

## Files

- `apps/web/src/features/testing/{RunBar,ConversationPane}.tsx` + a small `FeedbackControl`
  component, feed row chip integration
- `apps/web/src/lib/api.ts` (feedback calls)
- Optional additive: `apps/api/src/reports/reports.ts` (`humanFeedback` block)
- Component tests: thumb round-trip, re-thumb replaces, turn-level targeting, chip rendering

## Acceptance

- [ ] Run + turn thumbs round-trip (stubbed API), re-thumb replaces, note saves.
- [ ] Chips render in console + feed; filter by feedback works end-to-end against fixtures.
- [ ] Visual + copy separation from grades ("Your verdict" vs judge chips) — structure tested;
      look = owner-acceptance.
- [ ] Suite aggregates untouched (1.5's separation test still green).
- [ ] Gate green.

## Notes

Owns console cluster for its batch (not with 0.6/2.4/3.2/3.4). Keep the control tiny — this is
signal capture, not a review workflow (that's 4.5).
