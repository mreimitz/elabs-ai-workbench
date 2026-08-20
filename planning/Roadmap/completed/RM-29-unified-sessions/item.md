---
type: "Roadmap Item"
title: "Unified Sessions — one session experience across every run backend"
description: "Give the three run backends one session contract: a shared terminal table, an additive ended terminal state, a stall-based clock with no default wall cap, a persisted phase, a capability manifest, one status module and cursor-resumable streaming."
tags: ["roadmap", "RM-29"]
timestamp: "2026-08-20T14:03:37Z"
status: "done"
---

# Unified Sessions — one session experience across every run backend

## Goal

Give the three run backends one session contract: a shared terminal table, an additive ended terminal state, a stall-based clock with no default wall cap, a persisted phase, a capability manifest, one status module and cursor-resumable streaming.

## Why it matters

The same event ended three different ways depending on the backend, interactive sessions could never succeed, and a hard-coded wall clock stopped long runs.

## Milestones

- [x] Wave 1 — the contract and the clock.
- [x] Wave 2 — stream robustness.
- [x] Wave 3 — one console.
- [x] Wave 4 — the OpenAI-compatible facade.
- [x] Wave 5 — integration and docs.

## Linked research

- [RS-03](/Research/RS-03-unified-run-sessions/topic.md)

## Plan overview (from the original plan README)

**Status:** ready to start (decisions locked 2026-07-16). Concept + evidence live in
[`research/unified-run-sessions/`](/Research/RS-03-unified-run-sessions/) (docs 00–04); this folder
is the implementation workstream. Owner-locked decisions below are **D-US1…D-US15** — agents must
not reopen them.

## Goal

Runs over the three backends (AI-SDK engine, Claude-subscription Agent-SDK child, the vendor assistant
wrapper) currently diverge in lifecycle semantics, timeout policy and presentation — the same
event ends three different ways, interactive sessions can never succeed, a hard-coded 30-minute
wall clock silently kills long runs, and the console forks on `providerKind` in 11+ places. This
workstream ships **one session contract**: shared terminal table, stall-based clock, capability
manifest, one status vocabulary, cursor-resumable streams — plus an **OpenAI-compatible facade**
around the vendor assistant as an independent parallel track.

## Locked decisions (D-US log)

| # | Decision |
|---|---|
| D-US1 | **Hybrid lifecycle.** `RUN_STATUSES` stays (plus one additive member, see D-US2). `queued` / `waiting_input` / `stopping` are **queryable state on the run** (persisted `phase` + open questions recoverable via GET) **and** additive `{type:"phase"}` stream events. Cosmetic states stay derived. |
| D-US2 | **Session ≠ run, lightweight.** No new entity: the interactive run row *is* the session container. Per-turn outcomes derive from existing turn-indexed steps. New disposition: `ended_at` + `seen` columns, additive terminal `ended` (status + outcome) with `stopReasonCode: "session_ended"`, an explicit **End session** action. Interactive sessions end as **Ended**, never fake-`completed`, never `aborted`. |
| D-US3 | **Stall-based clock.** Default **no wall cap** (opt-in per environment, visible when set). **Stall detector**: no events for 10 min while running → `stopped` / `stopReasonCode:"stalled"`. Clock **pauses in `waiting_input`**; waits bounded by a **10-min wait budget** → `stopped` / `"wait_expired"` ("Expired"). Record `activeDurationMs` + `totalDurationMs` + per-transition timestamps. |
| D-US4 | **Capability manifest**: statically declared per backend adapter, runtime-verified, persisted on the run (`capabilities_json`), emitted at start. UI gates on capabilities, not `providerKind`. |
| D-US5 | **One status/label table** (locked, see execution-plan WP3.1) rendered by a single shared module on every surface. |
| D-US6 | **Queue visibility**: `queued` phase with position; subscription run concurrency decoupled from the judge gate via its own setting. |
| D-US7 | **Timer defaults**: 10 min stall / 10 min wait / no cap — configurable in Settings → Testing, per-environment override; the vendor may default to a longer wait (thread survives regardless). |
| D-US8 | **Cursor stream resume**: SSE `id: <seq>` + `Last-Event-ID` replay (DB-backed beyond the in-memory buffer), `{type:"ping"}` keepalive event, 45 s client staleness watchdog. |
| D-US9 | **No Wave 0** — quick wins land inside the contract waves, not as a pre-release. |
| D-US10 | **Out of scope**: the Assistant dock session engine and the compatibility probe runner. Revisit post-ship. |
| D-US11 | **Naming (labels only, wire stays `runs`)**: interactive container = **“session”**, automated/suite execution = **“run”**. |
| D-US12 | **OpenAI facade = Option A only** (external interop endpoint; the vendor-assistant executor is untouched): Chat Completions protocol, **hold-back streaming default** (reasoning live, settled answer as final content), thread-affinity cache, Perplexity-style vendor fields, locally-minted facade key. Runs as a **parallel track from day one**. |
| D-US13 | **Tiered model policy** for subagents: Opus-class for contract design / adversarial review / facade core; Sonnet-class for standard implementation; Haiku-class for docs & status upkeep. Every WP carries a model tag. |
| D-US14 | **Verification**: adversarial reviewer agent per wave; final acceptance via seeded runs (each backend kind × each new terminal state, through the REAL engine + persistence, both themes) + e2e smoke extension. |
| D-US15 | Conventions apply, no extra constraints: branch family `feat/unified-sessions`, gates `corepack pnpm@9.15.4` → `pnpm typecheck && pnpm test && pnpm build`, `.claude/rules/*` (brand-ui only, etc.), **grading byte-identity (`assistantText`) untouched**. |

## Shape of the work

Five waves + one parallel track — full detail, dependencies, file ownership, and per-WP agent/model
assignments in [`execution-plan.md`](./execution-plan.md); start everything via
[`kickoff-prompt.md`](./kickoff-prompt.md); progress in [`STATUS.md`](./STATUS.md).

- **Wave 1 — Contract & clock (api + shared):** shared `stopReasonCode`/`phase`/capabilities
  types, `terminalFor()` table, `SessionClock`, adoption in all three executors, persistence + End
  session API.
- **Wave 2 — Stream robustness:** SSE cursor resume + ping + client watchdog.
- **Wave 3 — One console (web):** single status module (locked table), capability-driven KPI
  rail/panes, session affordances (End session, Waiting for you, needs-attention + seen), settings
  & launcher surfacing.
- **Wave 4 — OpenAI facade (parallel lane):** `/openai/v1` translator with golden byte-identity
  tests; hardening + docs.
- **Wave 5 — Integration:** merge train, full gate, seeded-run visual acceptance, user-guide +
  research cross-links.

## Non-goals

Full session/run entity split (revisit only if the lightweight model hits a wall — record in
STATUS), engine-through-facade for internal runs (rejected in research 04 §5 Option B), Assistant
dock unification (D-US10), thread pruning / native the vendor feedback (per vendor-assistant roadmap), any
change to `RunEvent` members other than the additive `phase`/`ping`.
