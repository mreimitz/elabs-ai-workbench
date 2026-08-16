# Research — Unified run sessions (API · CLI · Qlik Answers)

**Status: IMPLEMENTED (2026-07-16).** All decisions **D-US1…D-US15** have shipped in Waves 1–5 +
the OpenAI-compat facade. The authoritative record of what was built lives in
[`roadmap/unified-sessions/STATUS.md`](../../roadmap/unified-sessions/STATUS.md) (the ledger);
decisions are in [`roadmap/unified-sessions/README.md`](../../roadmap/unified-sessions/README.md).
These research docs remain the evidence base; where doc 01's concept v0 differs from a locked
decision (e.g. extend-button vs stall-based clock, End-session→completed vs the `ended` terminal),
**the D-US table wins**.

## Origin

Owner report (2026-07-16): runs are the session harness for three very different backends —
API-based LLM connections (AI-SDK engine), the CLI-based Claude subscription connection (Agent SDK
child), and the Qlik Answers wrapper — and (1) every session *feels and looks different* depending
on which backend ran it, and (2) *longer runs get stopped*.

## Docs

| Doc | What it is |
|---|---|
| [`00-current-state.md`](./00-current-state.md) | Verified current-state analysis: the three executors, what is already unified, the divergence matrix, and the exact timeout mechanics that stop long runs. Evidence is file:line, spot-checked first-hand. |
| [`01-concept-session-contract.md`](./01-concept-session-contract.md) | Concept v0: one *session contract* — shared lifecycle + terminal table, one clock policy, a capability manifest that drives the UI, one status vocabulary, stream robustness. Ends with a non-binding implementation sketch. |
| [`02-open-questions.md`](./02-open-questions.md) | The questions to settle (owner decisions) before anything is built. |
| [`03-landscape-what-others-do.md`](./03-landscape-what-others-do.md) | Comparative research: openwork + cdesktop (code read), Gumloop (docs), and documented state machines (OpenAI runs, LangGraph, Temporal, AI SDK/AG-UI). Ten convergent patterns, per-question leanings, and a steal-list. Key field consensus: session ≠ run (only executions terminate), nobody caps whole runs at 30 min (stall/liveness detection instead), waits on humans are indefinite-or-long with named expiry terminals. |
| [`04-openai-compat-wrapper.md`](./04-openai-compat-wrapper.md) | Feasibility evaluation: wrapping the Qlik Answers cloud-assistants APIs in an OpenAI-standard (Chat Completions) endpoint. Verdict: feasible — parser/extraction/retry all reusable; three design mismatches (stateless `messages[]` vs threads → affinity cache, streamed-vs-settled truth → hold-back mode, lossy rich payload → vendor fields). Recommended as an external interop facade (Option C); NOT recommended as an internal replacement for the executor. |

## Relationship to existing docs

- Builds on the foundation from [`roadmap/findings/08-runs-session-rework.md`](../../roadmap/findings/08-runs-session-rework.md)
  (unified `RunEvent` vocabulary, `RunManager` choke point, turn-indexed timeline) — that work is
  the reason the remaining divergence is *policy*, not wire format.
- Completes, rather than replaces, the D-CS3 (subscription "renders identically") and D-QA
  (qlik-answers same-vocabulary) invariants.
- Out of scope for now, but noted in the open questions: the Assistant dock has its own session
  engine (`apps/api/src/assistant/session-manager.ts`) that this contract does not cover.

## Suggested reading order for the concept session

`00` (what we have) → `03` (what the field does) → `02` (decide) → revise `01` (the concept) to
match the decisions. Doc `03`'s §3 table pre-sorts the landscape evidence per open question.
