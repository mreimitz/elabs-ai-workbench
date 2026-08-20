---
type: "Research Topic"
title: "Unified Run Sessions"
description: "Work out why a run session looks and behaves differently depending on which backend executed it, and define one session contract that covers the API engine, the CLI subscription engine and the vendor assistant wrapper."
tags: ["research", "RS-03"]
timestamp: "2026-08-20T13:47:37Z"
status: "done"
---

# Unified Run Sessions

## Objective

Work out why a run session looks and behaves differently depending on which backend executed it, and define one session contract that covers the API engine, the CLI subscription engine and the vendor assistant wrapper.

## Why now / what it feeds

Every session surface in the app rendered a different status vocabulary, and long runs were being stopped by a wall-clock cap that did not match how agents work.

## Scope

**In:** The current state of the three backends, a proposed session contract, the open questions behind it, and what comparable products do.

**Out:** The implementation itself, which is planned and ledgered as a roadmap item.

## Deliverable

An evidence base and a concept for one session contract, feeding the locked D-US decisions.

## Success criteria

Every difference between the three backends is named, and the contract answers each one.

## Overview (from the original topic README)

**Status: IMPLEMENTED (2026-07-16).** All decisions **D-US1…D-US15** have shipped in Waves 1–5 +
the OpenAI-compat facade. The authoritative record of what was built lives in
[`roadmap/unified-sessions/STATUS.md`](../../Roadmap/RM-29-unified-sessions/STATUS.md) (the ledger);
decisions are in [`roadmap/unified-sessions/README.md`](../../Roadmap/RM-29-unified-sessions/item.md).
These research docs remain the evidence base; where doc 01's concept v0 differs from a locked
decision (e.g. extend-button vs stall-based clock, End-session→completed vs the `ended` terminal),
**the D-US table wins**.

## Origin

Owner report (2026-07-16): runs are the session harness for three very different backends —
API-based LLM connections (AI-SDK engine), the CLI-based Claude subscription connection (Agent SDK
child), and the the vendor assistant wrapper — and (1) every session *feels and looks different* depending
on which backend ran it, and (2) *longer runs get stopped*.

## Docs

| Doc | What it is |
|---|---|
| [`00-current-state.md`](./notes/00-current-state.md) | Verified current-state analysis: the three executors, what is already unified, the divergence matrix, and the exact timeout mechanics that stop long runs. Evidence is file:line, spot-checked first-hand. |
| [`01-concept-session-contract.md`](./outputs/01-concept-session-contract.md) | Concept v0: one *session contract* — shared lifecycle + terminal table, one clock policy, a capability manifest that drives the UI, one status vocabulary, stream robustness. Ends with a non-binding implementation sketch. |
| [`02-open-questions.md`](./notes/02-open-questions.md) | The questions to settle (owner decisions) before anything is built. |
| [`03-landscape-what-others-do.md`](./notes/03-landscape-what-others-do.md) | Comparative research: openwork + cdesktop (code read), Gumloop (docs), and documented state machines (OpenAI runs, LangGraph, Temporal, AI SDK/AG-UI). Ten convergent patterns, per-question leanings, and a steal-list. Key field consensus: session ≠ run (only executions terminate), nobody caps whole runs at 30 min (stall/liveness detection instead), waits on humans are indefinite-or-long with named expiry terminals. |
| `04-openai-compat-wrapper.md` | Feasibility evaluation: wrapping the the vendor assistant cloud-assistants APIs in an OpenAI-standard (Chat Completions) endpoint. Verdict: feasible — parser/extraction/retry all reusable; three design mismatches (stateless `messages[]` vs threads → affinity cache, streamed-vs-settled truth → hold-back mode, lossy rich payload → vendor fields). Recommended as an external interop facade (Option C); NOT recommended as an internal replacement for the executor. |

## Relationship to existing docs

- Builds on the foundation from [`roadmap/findings/08-runs-session-rework.md`](../../Roadmap/RM-12-findings/08-runs-session-rework.md)
  (unified `RunEvent` vocabulary, `RunManager` choke point, turn-indexed timeline) — that work is
  the reason the remaining divergence is *policy*, not wire format.
- Completes, rather than replaces, the D-CS3 (subscription "renders identically") and D-QA
  (vendor-assistant same-vocabulary) invariants.
- Out of scope for now, but noted in the open questions: the Assistant dock has its own session
  engine (`apps/api/src/assistant/session-manager.ts`) that this contract does not cover.

## Suggested reading order for the concept session

`00` (what we have) → `03` (what the field does) → `02` (decide) → revise `01` (the concept) to
match the decisions. Doc `03`'s §3 table pre-sorts the landscape evidence per open question.
