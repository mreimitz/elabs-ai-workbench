---
type: "Roadmap Item"
title: "Design system upgrade to 6.1"
description: "Move every @elabs-ai/components-* package from the pinned 4.1.0 to 6.1.0 in lockstep, fix the one removed prop, clear the 6.x deprecations that will be removed in 7.0, and keep the quality gate green."
tags: ["roadmap", "RM-40"]
timestamp: "2026-11-06T08:15:03Z"
status: "planned"
---

# Design system upgrade to 6.1

## Goal

Move every @elabs-ai/components-* package from the pinned 4.1.0 to 6.1.0 in lockstep, fix the one removed prop, clear the 6.x deprecations that will be removed in 7.0, and keep the quality gate green.

## Why it matters

The app is two majors behind its design system. 5.x and 6.x ship TanStack Table v9 (~2.8x less heap, ~2x faster mount), per-module builds (smaller bundles), lazy Shiki, accessibility fixes (Monaco line-number contrast, ColumnPicker/FacetFilter checkbox semantics, flow group focus outline) and localized table strings. Staying on 4.1 widens the gap before 7.0 removes the 6.x aliases.

## Milestones

- [ ] Bump all nine pins to 6.1.0 exactly and reinstall
- [ ] Fix the build break (YAxis formatLargeNumbers removed in 5.0)
- [ ] Clear the flow tone deprecations (default to neutral, accent to emphasis featured)
- [ ] Reconcile app overrides made redundant upstream (SideDock header height)
- [ ] Quality gate green and docs re-pinned
- [ ] Both-theme browser walk of the affected surfaces

## Linked research

No linked research yet.
