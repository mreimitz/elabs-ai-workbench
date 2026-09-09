---
type: "Roadmap Item"
title: "brand-ui 4.1.0 adoption — shell repairs come home"
description: "Upgrade every @elabs-ai/components-* package from 4.0.0 to 4.1.0, absorb the three breaking changes, and replace the app-shell workarounds this repo invented with the library primitives 4.1.0 upstreamed from them (SkipLink, CommandTrigger, SideDock, the active-nav indicator, the collapsed group-label repair, PageShell scroll modes), then adopt the new capabilities the release makes available — SchemaForm/fromJsonSchema for the tool playground, the state illustrations, the new chart and flow families."
tags: ["roadmap", "RM-39"]
timestamp: "2026-09-09T15:05:00Z"
status: "planned"
---

# brand-ui 4.1.0 adoption — shell repairs come home

## Goal

Upgrade every @elabs-ai/components-* package from 4.0.0 to 4.1.0, absorb the three breaking changes, and replace the app-shell workarounds this repo invented with the library primitives 4.1.0 upstreamed from them (SkipLink, CommandTrigger, SideDock, the active-nav indicator, the collapsed group-label repair, PageShell scroll modes), then adopt the new capabilities the release makes available — SchemaForm/fromJsonSchema for the tool playground, the state illustrations, the new chart and flow families.

## Why it matters

brand-ui 4.1.0 is numbered a minor but carries three breaking changes, so a ^4.0.0 range takes it automatically and the build breaks on import resolution alone. Separately, the library's new flagship app shell was designed by reading this repo's own AppShell and PageShell: the repairs we carry locally are now shipped upstream, so keeping ours means maintaining two copies of the same fix. The release also ships, as supported components, several things we hand-rolled — a JSON-Schema-to-form adapter for the tool playground, a resizable summoned dock, a command trigger — and one real accessibility defect it names is present in our shell today.

## Milestones

- [ ] Pin 4.0.0 and land the three breaking-change migrations so the gate is green on 4.1.0
- [ ] Delete the local shell workarounds the library now ships, and fix the complementary-landmark nesting the flagship block names
- [ ] Adopt SchemaForm + fromJsonSchema in the tool playground and the skill tool runner
- [ ] Decide and act on the state illustrations against the in-flight illustrations package
- [ ] Evaluate the new chart, flow and process families against the surfaces that hand-rolled them

## Ledger

Per-work-package state is in [`STATUS.md`](./STATUS.md) — **authoritative**. 19 work packages across
four phases, with locked decisions **D-BU1–D-BU9**.

## The one thing to read before starting

The library's new flagship app shell was designed by reading **this repository**. Upstream's own
design record cites `apps/web/src/components/AppShell.tsx` and `PageShell.tsx` by path and line
count, and the flagship block calls itself a direct port of the shell this app ships. The repairs
this repo invented — the skip link, the active-nav accent indicator, the collapsed group-label fix,
the resizable summoned dock with its 480px minimum content and 1100px overlay breakpoint, the
three-mode page scroll contract — are now supported upstream primitives with the same constants.

So Phase 2 is **deleting our copies**, not adopting someone else's design. And the handful of things
the library did *not* take from us are exactly what WP 2.4 and WP 2.5 call out — including one real
accessibility defect this app has today, where a complementary landmark sits inside the main landmark.

## Linked research

No linked research yet.
