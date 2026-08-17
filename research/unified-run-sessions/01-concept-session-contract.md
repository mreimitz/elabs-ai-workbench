# 01 — Concept v0: one session contract

> **Draft for discussion — not a plan.** This is the current best shape of the idea, written to be
> argued with. The decisions it presupposes are collected in
> [`02-open-questions.md`](./02-open-questions.md); several of them could reshape sections below.

Premise: keep the wire format and the persistence model — they already carry everything
(see [`00-current-state.md`](./00-current-state.md) §2). Add a thin normative layer with three
pieces: a **shared lifecycle** every executor must map to, a **shared clock policy** owned by one
module instead of three copies, and a **capability manifest** so the UI renders what a run *can do*
instead of what kind it *is*. All changes additive; old persisted runs replay unchanged.

---

## C1. One lifecycle, one terminal table

Normative phases: `queued → starting → running ⇄ waiting_input → reviewing → terminal`.

- Additive event `{type: "phase", phase: "queued" | "waiting_input" | …, detail?}` emitted at
  transitions. `RunStatus` stays untouched (no migration); the phase event is presentation-level
  truth. Emitters: subscription gate wait (`queued`, with queue position in `detail`), engine/vendor
  `nextTurn` + `ask_user` waits (`waiting_input`), all executors on permit/start.
  *(Open question Q1: phase event vs real status values.)*
- **One terminal mapping shared by all executors.** Extract a `terminalFor(cause)` helper into a
  shared module (`testing/session-terminal.ts`) with a closed cause union, and make all three
  executors use it:

| Cause | status / outcome | stopReasonCode |
|---|---|---|
| user stop | `aborted` / `aborted` | `user_stop` |
| user *ends* an interactive session (new affordance) | **`completed` / `completed`** | `session_ended` |
| wall clock | `stopped` / `stopped_guardrail` | `max_duration` |
| idle while waiting_input | `stopped` / `stopped_guardrail` | `idle` |
| budget meter (turns/tokens/context/cost/questions) | `stopped` / `stopped_guardrail` | `max_turns` / `max_tokens` / … |
| context overflow | `stopped` / `context_overflow` | `context_overflow` |
| provider/transport failure | `error` / `error` | `provider_error` / `auth` / `rate_limit` |

- Add `stopReasonCode` (machine-readable) alongside the existing human `stopReason` on the `status`
  event and the runs row. This retires `guardrailFromReason`'s string-sniffing and fixes the vendor
  `aborted`-on-deadline mismatch (00 §3.1) in one move.
- **"End session" button** on interactive runs (all kinds): finalizes as `completed`/`session_ended`.
  Interactive sessions stop being the only runs that can never succeed.
  *(Open question Q2: is `completed` the right terminal for an ended session?)*

## C2. One clock policy (the "stops longer runs" fix)

Extract the three per-executor deadline copies into one `SessionClock` (`testing/session-clock.ts`)
owned by run-service and injected into every executor. Policy:

1. **Configurable, visible cap.** `maxRunDurationMs` default moves to app settings (Settings →
   Testing, alongside the auto-rating knobs), overridable per environment (exists today) and per
   launch (new field in RunLauncher's configure step, pre-filled, with "no limit" allowed as today's
   `0`). The RunBar shows the budget next to elapsed (`12:04 / 45:00`) so the cap is never a
   surprise.
2. **The clock pauses in `waiting_input`.** Wall-clock measures *work*, not human absence. What
   bounds a waiting session is the **idle timeout, uniformly**: one configurable value (default
   10 min) applied to `nextTurn` *and* `ask_user` waits on *all three* executors — wiring
   `idleTimeoutMs` from the scenario at last (it exists in the engine signature and is dead today),
   adding it to the subscription/vendor interactive loops' `nextTurnOrStop` race.
   *(Open question Q3: pausing clocks changes what "duration" means for benchmarking.)*
3. **Warn, then extend, then stop.** At T−5 min the clock emits `{type:"phase", phase:"deadline_warning"}`;
   RunBar shows a countdown chip with one-click **"+15 min"** (new `POST /api/runs/:id/extend`,
   which the SessionClock honors and audits into the run's step log as a `context_event`). A run
   that is mid-stream at the deadline finishes with an honest `max_duration` stop *after a visible
   warning*, not a silent kill. *(Open question Q4: extend semantics for suites/comparability.)*
4. **Optional stall detector** (activity-based): no events of any type for N min while `running` →
   stop with `stopReasonCode: "stalled"`. This is the guard the 30-min cap was actually standing in
   for — it catches hung children/streams without punishing productive long runs.
5. **Queue transparency + decoupling.** Subscription runs emit `phase: queued` immediately;
   run concurrency gets its own setting (`SUBSCRIPTION_RUNS_MAX_CONCURRENCY`) instead of riding
   `AUTO_RATING_MAX_CONCURRENCY`, so "the judge is busy" stops serializing user-facing runs.

## C3. Capability manifest instead of provider-kind forks

One additive event at run start (and persisted onto the run row, so replay doesn't need the
credential):

```ts
type SessionCapabilities = {
  liveText: boolean;                      // streams text deltas
  liveReasoning: "none" | "raw" | "structured";
  toolCalls: boolean;                     // emits tool_call/tool_result steps
  contextWindow: boolean;                 // context snapshots + % of limit are meaningful
  tokens: "exact" | "estimated" | "none";
  costBasis: "api_exact" | "subscription_reference" | "questions" | "none";
  followUps: boolean;                     // POST /turns supported while live
  askUser: boolean;
  identity?: { kind: "vendor_assistant"; assistantId; appId; threadMode; transport }; // rail card
};
```

Current values: engine → `{liveReasoning:"raw", tokens:"exact", contextWindow:true, costBasis:"api_exact", …}`;
subscription → `{liveReasoning:"none", tokens:"exact", contextWindow:false, costBasis:"subscription_reference"}`;
vendor → `{toolCalls:false, tokens:"estimated", contextWindow:false, costBasis:"questions", liveReasoning:"structured"}`.

The UI then renders **one console with per-capability degradation**:

- `KpiRail` assembles its tiles from a declarative list driven by capabilities (context tile iff
  `contextWindow`; token tiles labelled "est." iff `tokens==="estimated"`, hidden iff `"none"`;
  cost tile knows its unit — `$`, `$ est. · subscription`, or `N questions`). The vendor identity
  card renders iff `identity` is present.
- `ContextChart`/baseline gate on `contextWindow`, not `providerKind === "vendor_assistant"`.
- `ConversationPane` picks the reasoning renderer from `liveReasoning`, and the answer renderer
  from the payload (as it already does via `promptMode` — formalized instead of inferred).
- The composer/QuestionPrompt gate on `followUps`/`askUser` (also fixes the current
  QuestionPrompt gating drift, QuestionPrompt.tsx:14-15 vs ConversationPane.tsx:227).

This is the piece that makes the *next* executor (another vendor assistant, a local runner) come up
looking right with zero new UI branches — and it deletes the fragile credential-based kind
re-derivation (00 §3.3). *(Open question Q5: static per kind vs detected per run; persistence shape.)*

## C4. One status/label module

One shared derivation `(status, outcome, stopReasonCode, ratingState, phase) → {label, tone, spinner}`
in `lib/status.ts`, consumed by RunBar, RunsView, StepLog, SuiteRunConsole, and suite rows. Proposed
single vocabulary (labels are an owner decision — Q6):

| State | Label | Tone |
|---|---|---|
| queued | "Queued" (+ position) | gray dashed |
| running | "Running" | blue + spinner |
| waiting_input | "Waiting for you" | blue outline, no spinner |
| reviewing | "Reviewing…" | blue + spinner |
| completed (incl. `session_ended`) | "Completed" | green |
| stopped_guardrail | "Stopped — <reason>" ("time limit", "turn limit", …) from `stopReasonCode` | amber |
| context_overflow | "Context overflow" | amber (pick one — today it's red in the console, gray in the list) |
| aborted | "Stopped by you" | gray |
| error | "Failed" | red |
| assertions_failed | "Assertions failed" | amber/red (one choice, both surfaces) |

## C5. Long-session stream robustness

- Server: set SSE `id: <seq>` and honor `Last-Event-ID` — replay from cursor (fall back to persisted
  events when the cursor predates the 2000-event buffer). Reconnects on hour-long runs stop
  re-shipping the world; late joiners get full history.
- Replace the `: ping` comment keepalive with a real `{type:"ping"}` event (additive) so the client
  can run a staleness watchdog: nothing received for ~45 s → show the existing "connection lost"
  banner proactively instead of waiting for `onerror`. *(Open question Q9: is this warranted yet?)*

---

## Appendix — implementation sketch (NON-BINDING)

> Recorded so the shape isn't lost; **do not execute**. Revisit after the open questions are
> settled — several answers (Q1, Q2, Q3, Q5) change the cut lines.

- **Wave 1 — contract + clock (api, shared):** `stopReasonCode` + shared `terminalFor` adopted by
  all three executors (incl. vendor deadline fix, "End session" terminal); `SessionClock` extraction
  (pause-in-waiting_input, uniform idle timeout, deadline warning, `POST /api/runs/:id/extend`,
  stall detector); `phase` events + subscription queue visibility + own concurrency setting;
  `SessionCapabilities` emitted + persisted. Regression tests: one lifecycle test *per executor*
  asserting the same cause → same terminal.
- **Wave 2 — one console (web):** single status module adopted everywhere; KpiRail declarative
  tiles + capability gating; RunBar budget display + countdown + Extend + "End session";
  queued/waiting states.
- **Wave 3 — settings + streams:** Settings → Testing defaults + launcher override; SSE
  `id:`/`Last-Event-ID` cursor resume + `ping` event + client watchdog; suite console parity pass.

**Candidate quick wins** (small, independent of the concept; whether to ship any of them *before*
the concept settles is itself Q10): fix the vendor deadline terminal to `stopped`/`stopped_guardrail`;
wire `scenario.guardrails.idleTimeoutMs` through `resolve()`; make queued subscription runs visible
before `gate.acquire()`; unify `error`/`aborted` labels between RunBar and status.ts; surface
`maxRunDurationMs` in the launcher + RunBar.

**Explicitly unchanged in every variant of this concept:** the `RunEvent` union and step types
(additions only), persistence/replay, grading contracts (`assistantText` byte-identity), Compare,
the Answers block renderer (`AnswersAnswerView`/`AnswersReasoning` stay — they become
capability-driven presentation, not a fork), and the D-CS3/D-QA "same vocabulary" invariants, which
this concept completes rather than replaces.
