# 02 — Open questions (settle these before anything is built)

> **ALL SETTLED — owner Q&A, 2026-07-16.** Full decision log = D-US1…D-US15 in
> [`roadmap/unified-sessions/README.md`](../../../roadmap/unified-sessions/README.md). Summary:
>
> | Q | Decision |
> |---|---|
> | Q1 | Hybrid: statuses stay; queued/waiting_input/stopping = persisted `phase` + queryable pending input + additive phase events (D-US1) |
> | Q2 | Session ≠ run, lightweight: run row stays the container; `ended_at`/`seen` disposition; additive `ended` terminal via End-session; per-turn outcomes derived from steps (D-US2) |
> | Q3 | Clock pauses in `waiting_input`; record `activeDurationMs` + `totalDurationMs` + per-transition timestamps (D-US3) |
> | Q4 | Stall-based, not extend-button: no wall cap by default (opt-in per env, visible), 10-min stall detector rolled by activity (D-US3/D-US7) |
> | Q5 | Capabilities statically declared per adapter, runtime-verified, persisted `capabilities_json` (D-US4) |
> | Q6 | Label table locked (execution-plan §1); one derivation module, all surfaces (D-US5) |
> | Q7 | `queued` phase with position; `SUBSCRIPTION_RUNS_MAX_CONCURRENCY` decoupled from the judge gate (D-US6) |
> | Q8 | Wait budget 10 min default (Qlik 30 min), `wait_expired` → "Expired" terminal; configurable Settings → Testing + env override (D-US3/D-US7) |
> | Q9 | Cursor SSE resume (`id:`/Last-Event-ID, DB-backed) + `ping` event + 45 s client watchdog (D-US8) |
> | Q10 | No Wave 0 — straight to the contract waves (D-US9) |
> | Q11 | Assistant dock + compatibility runner out of scope (D-US10) |
> | Q12 | Labels only: interactive = "session", automated/suite = "run"; wire stays `runs` (D-US11) |
>
> Plus: OpenAI facade = external Option A, hold-back streaming, parallel track (D-US12); tiered
> model policy (D-US13); reviewer-per-wave + seeded-run acceptance (D-US14); repo conventions,
> no extra constraints (D-US15). The questions below are kept verbatim as the historical record.

Each is an owner decision in the repo's usual sense — once decided, it should get a D-US*n* number
and be recorded here as locked. The concept in `01-concept-session-contract.md` references these by
Q-number; several answers reshape it materially.

---

**Q1 — Is `waiting_input` / `queued` a phase *event* or a real `RunStatus`?**
Concept v0 says additive `phase` events, statuses untouched (no migration, replay-safe). But phases
that matter to users arguably belong in the runs *list* too (filter "waiting for me"), which pulls
toward real status values — a wire change (`RUN_STATUSES` is a closed union used by suites, reports,
grading). Middle path: phase events + a derived `lastPhase` column. Decide the authority.

**Q2 — What does "success" mean for an interactive session?**
Today no interactive run can ever end `completed` (all three executors; see 00 §3.1). Concept v0
adds "End session" → `completed` / `session_ended`. But: should *idle timeout* also count as a
clean end rather than a guardrail stop? Does a `session_ended` run get auto-rated like a completed
run (AR pipeline currently reviews every terminal)? Do suite members ever run interactive (today
no)? The answer defines the terminal table.

**Q3 — If the clock pauses while waiting for a human, what is a run's "duration"?**
Pausing fixes "my session died over lunch", but duration KPIs then stop being wall-clock and
cross-run comparability shifts. Likely needs a split: `activeDurationMs` (work) vs `totalDurationMs`
(wall clock), with analytics/suite reports picking one explicitly. Which one feeds the Runs feed,
the Gantt, suite analytics, and Compare?

**Q4 — Extend semantics.**
Who can extend (interactive only, or automated runs being watched?), by how much, how often? Does an
extended run get flagged so suite/Compare consumers know its budget differed from siblings? Is
extension allowed at all for suite members (probably not — comparability)?

**Q5 — Capability manifest: declared per provider kind, or detected per run?**
Static per-kind is trivial and covers today's needs; but reasoning presence actually varies by
*model* (an OpenAI model without reasoning vs one with), and `followUps` varies by *mode*. Detected
means the manifest settles mid-run (first reasoning delta arrives late). Also: persistence shape —
typed columns vs one JSON column; and does Compare become capability-aware (e.g. refuse or caveat
token-delta comparisons between `exact` and `estimated` runs)?

**Q6 — The single status vocabulary (labels + tones).**
The concept's C4 table is a proposal. Owner picks the words: "Stopped by you" vs "Aborted";
`context_overflow` amber or red; `assertions_failed` severity; whether guardrail stops read as
failure-ish or as neutral "did what you configured". One table, both themes, all surfaces
(console, runs list, suite cells, step log).

**Q7 — Queue visibility scope.**
Expose a live queue *position* (racy, cheap to get wrong) or just the `queued` state? Should the
suite orchestrator's own scheduling and single-run launches share one visible queue model? And
should subscription run concurrency really be decoupled from the auto-rating judge gate (concept
says yes — confirm, incl. what the new default is; today everything serializes behind
`AUTO_RATING_MAX_CONCURRENCY = 1`).

**Q8 — Idle timeout policy details.**
One uniform default (10 min?) for both `nextTurn` waits and `ask_user` waits, or a longer/none
bound while a question is pending (the run is waiting *because it asked* — killing it mid-question
is harsher than killing an idle composer)? Per-environment override only, or also per-launch?

**Q9 — Is SSE cursor-resume worth it now?**
`Last-Event-ID` + DB-backed replay-from-cursor is real work; today's full-replay + client `seq`
dedupe *works* below ~2000 events. If runs are about to get much longer (the whole point), the
buffer cap and reconnect cost start to matter. Decide: build with the contract, or defer until a
concrete long-run pain report.

**Q10 — Do any quick wins ship before the concept settles?**
The candidates (01 appendix) are all small and independently safe: qlik deadline terminal fix,
`idleTimeoutMs` wiring, queued-run visibility, label unification, cap surfaced in launcher/RunBar.
Shipping them early relieves the acute pain (silent 30-min kills, hung-looking queues) but bakes in
answers to Q2/Q6 implicitly. Explicit go/no-go per item.

**Q11 — Scope boundary: what counts as a "session"?**
This research covers the three *run* executors. The app has two more session-like surfaces: the
Assistant dock (`assistant/session-manager.ts` — its own engine, own streaming, own retention) and
the compatibility probe runner (`compatibility/session.ts`). Does the session contract eventually
absorb them (one mental model everywhere), or are they explicitly out of scope forever? Affects
naming and where the shared modules live.

**Q12 — Terminology: "run" vs "session" in the UI.**
Testing IA already renamed Scenario→Environment (labels only, wire frozen). If interactive sessions
become first-class (waiting states, end-session, pause-aware clocks), is a user-facing label split
wanted — "runs" (automated, benchmark) vs "sessions" (interactive, exploratory)? Or one word
everywhere? Labels only; the wire stays `runs`.
