---
type: "Documentation"
title: "Testing console & run sessions"
description: "How the workbench drives MCP servers through a real LLM agent loop and what a run session looks like across every backend."
tags: ["documentation", "DC-08"]
timestamp: "2026-08-20T14:03:37Z"
status: "current"
---

# Testing console & run sessions

## Subject

How the workbench drives MCP servers through a real LLM agent loop and what a run session looks like across every backend.

## Scope

**In:** Environments and tests, launching a run, the console, streaming and run control, replay, comparing runs, and the shared session contract.

**Out:** Grading and suite mass-runs, which are the benchmarks subject.

## Where the code lives

- `apps/api/src/testing/`
- `apps/web/src/features/testing/`

## Delivered increments

### RM-29 — Unified Sessions — one session experience across every run backend

Completed 2026-08-20. Roadmap item: [RM-29](/Roadmap/completed/RM-29-unified-sessions/item.md).

**Shipped:** A run session now behaves the same way whichever backend executed it: one terminal-state table so the same cause always ends a run the same way, an additive ended terminal plus a seen marker, a stall-based clock with no default wall-clock cap (a ten-minute stall plus a wait budget ends a run as wait-expired instead of killing a long healthy run), a persisted phase with queue visibility, a per-session capability manifest that drives which console tiles appear, one status module behind every label in the app, and a cursor-resumable event stream. An OpenAI-compatible endpoint was added alongside.

**Planned vs delivered:** The plan's concept document proposed an operator-pressed extend button and treated End session as completed; the locked decisions replaced both — the clock became stall-based and ended is its own terminal state. An OpenAI-compatibility facade was built as a parallel lane and merged with the rest, which the original waves did not name. Four review-driven fix packages were inserted mid-flight after adversarial reviews found phase-coherence, replay and protocol defects.

**Known gaps:** Full editability of the stall and wait timers was deferred to a follow-up, the estimated-token tiles for the vendor backend were left as they are pending an owner call, and the live acceptance walk against a real cloud tenant — including the compatibility facade — was never run.

**Where the code lives:**

- `packages/shared/src/session-contract.ts`
- `apps/api/src/testing/`
- `apps/web/src/features/testing/`
