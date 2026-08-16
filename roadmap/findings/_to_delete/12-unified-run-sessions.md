# 12 — Runs as one product: a unified session contract for the API, CLI and Qlik Answers executors

Investigation + proposal. The owner reported two problems with runs: (1) **every session feels and
looks different** depending on whether it executes over a provider API, the Claude subscription CLI,
or the Qlik Answers wrapper; (2) **longer runs get stopped**. Part A is the verified current-state
analysis (file:line evidence, spot-checked first-hand). Part B is the proposal: one *session
contract* — a shared lifecycle, a shared timeout policy, and a capability manifest that drives the
UI — so all three executors (and any future one) produce the same end-user experience. Part C is a
wave plan in the repo's conventions.

---

## Part A — How it works today

### A1. Three executors, one dispatch point

`RunService.execute` (run-service.ts:491-548) branches on the environment's provider kind:

| Path | Executor | Mechanism |
|---|---|---|
| `claude_subscription` | `claude-subscription-executor.ts` | Claude **Agent SDK** child process via the injected `AgentSessionDriver` seam; MCP servers spawned *inside* the child from a translated `mcpServers` config (subscription-tools.ts:76-108) |
| `qlik_answers` | `qlik-answers-executor.ts` | Internal `/api/v1/cloud-assistants/` REST + SSE card-patch stream; thread per run; settled answer re-fetched from `…/messages` (executor:763-921) |
| everything else (anthropic, openai, google, openai_compatible, ollama) | `engine.ts` `runAgentLoop` | AI-SDK `streamText` multi-step loop + server-side `McpSession` tool bridge |

`registry.ts:67-77` throws for the two special kinds, so they can never reach the engine.

### A2. What is already unified (keep this — it works)

The 08-runs-session-rework foundation did its job. All three executors emit the **same `RunEvent`
vocabulary** (`status`, `step`, `delta`, `kpi`, `error`, `question`, `question_resolved`, `rating` —
types.ts:1366-1422) through the **same choke point** `RunManager.emit` (run-manager.ts:132), which
stamps monotonic `seq`/`step.index`, keeps a bounded live replay buffer, and fans out to persistence
+ SSE. One console (`RunConsole`) renders all three kinds; persistence, replay, grading, suites and
Compare are kind-agnostic. The Answers executor was explicitly designed to "render identically"
(qlik-answers-executor.ts:29-30), as was the subscription path (D-CS3).

**The divergence is not in the wire format. It is in lifecycle semantics, timeout policy, and
presentation policy — three places where each executor made its own local decision.**

### A3. Why sessions feel different — the divergence matrix

#### A3.1 The same cause produces a different terminal per executor (verified first-hand)

| Cause | API engine | CLI subscription | Qlik Answers |
|---|---|---|---|
| 30-min wall clock fires | `stopped` / `stopped_guardrail` (engine.ts:814-827) | `stopped` / `stopped_guardrail` (executor:997-1002) | **`aborted` / `aborted`** (executor:273-289 — comment admits "duration cap and a user stop both map to `aborted`, distinguished only by the free-form stopReason") |
| Interactive session ends cleanly | idle timeout → `stopped` / `stopped_guardrail` (engine.ts:831-844) | `aborted` ("Run aborted by user") (executor:995-1002) | `aborted` (executor:505-519) |
| Interactive run ever `completed`? | never (idle timeout or stop) | never — by design "the session was ended, not completed" | never — accepted deviation (qlik STATUS.md:586-592) |
| Waiting on subscription concurrency permit | n/a | **invisible** — `status: running` only emitted *after* `gate.acquire()` (executor:855-856); until then the run sits `pending` with a dead console | n/a |
| Waiting for user input / ask_user answer | stays `running`, no distinct state (use-run-stream.ts:182-186) | stays `running` | stays `running` |

So the *identical* user action — walking away from an interactive session — reads as an amber
guardrail stop on an API run, and a neutral/gray "Aborted" on a CLI or Answers run. And no state in
the model ever says "waiting for you" or "queued".

#### A3.2 Status presentation is a split brain (verified first-hand)

Two parallel label systems disagree on the same wire value:

| Wire value | Console (`RunBar` PHASE_LABEL, RunBar.tsx:142-153) | Runs list (`deriveStatusView`, lib/status.ts:69-115) |
|---|---|---|
| `error` | "Error" | "Failed" |
| `aborted` | "Stopped" (neutral `denied`) | "Aborted" (gray) |
| `context_overflow` | "Context overflow", **red** `failed` badge (RunBar.tsx:164-168) | humanized **neutral gray** chip (status.ts default branch) |
| `assertions_failed` | red `failed` | neutral gray |

`StepLog` mixes both systems in one badge (tone from one, label from the other — StepLog.tsx:230-239),
and suite consoles map `stopped`→`skipped` tone while single runs map it to `denied`
(SuiteRunConsole.tsx:115-133 vs RunBar.tsx:169-171). `guardrailFromReason` string-sniffs the
free-form `stopReason` ("turn"/"token"/"cost") and silently returns nothing for
`maxRunDurationMs (1800000ms) reached` (RunBar.tsx:133-140) — the most common guardrail stop is the
one it can't classify. The app-local `components/StatusBadge.tsx` that status.ts declares as "the
only place this table is rendered" is imported by **nobody** — every surface uses `@brand/ui`'s
badge directly.

#### A3.3 Per-kind UI forks are scattered, keyed on `providerKind`, and fragile

Eleven+ branch sites fork the console by kind rather than by what the run *can do*:
- `KpiRail.tsx:125-345`: qlik → Context tile becomes an identity card, Context "N/A", both token
  tiles dropped, "Tool calls" renamed "Questions"; subscription → context % becomes cumulative
  tokens, "est. · subscription" marker.
- `RunConsole.tsx:779-812`: `ContextChart` and baseline suppressed for qlik; `RailInsightsPanel`
  only for qlik.
- `ConversationPane.tsx:400-544`: `AnswersReasoning` / `AnswersAnswerView` / `SourcesPanel` for
  qlik; verbatim reasoning + `ChatMarkdown` otherwise.
- `ToolCallCard.tsx:57-61`: strips the `mcp__server__` prefix that only the subscription path produces.
- Reasoning visibility: engine streams a `reasoning` delta channel; **the subscription executor
  never emits one** (executor:724-729); qlik streams reasoning but renders it structured.

The kind itself is re-derived client-side from the credential because the one flag that should
mark estimated tokens (`estimatedTokens`) is stripped by the persistence redaction heuristic
(qlik STATUS.md:599-603; use-run-stream.ts:296-314). Every new executor kind means another round of
scattered `if (providerKind === …)` forks — this is exactly why each new integration "looks
different" by default.

### A4. Why longer runs stop (verified first-hand)

There is exactly **one** wall-clock guard, and it is a hard-coded default:

1. **`DEFAULT_MAX_RUN_DURATION_MS = 30 * 60_000`** (engine.ts:114) applies to *all three* executors
   (engine.ts:440; subscription executor:850/931; qlik executor:202/398). Override exists **only**
   as `scenario.guardrails.maxRunDurationMs` per environment — no app setting, no env var, no
   launcher field, no UI hint that a cap exists. When it fires it aborts the in-flight stream
   mid-turn via `AbortController`, with **no warning and no grace period**, and the terminal it
   produces differs per executor (A3.1). A run that is *actively streaming useful work* at 29:59 is
   killed the same as a hung one.
2. **Idle timeout is engine-only and unconfigurable in practice.** `DEFAULT_IDLE_TIMEOUT_MS = 10 min`
   (engine.ts:112); `cfg.idleTimeoutMs` is never wired from the scenario in `resolve()`
   (run-service.ts:1265-1296), so 10 minutes always. Subscription and qlik interactive sessions have
   **no idle timeout at all** — a walked-away session burns the 30-min wall clock and then reports
   `aborted`/`stopped_guardrail`.
3. **The wall clock keeps burning while the run waits on a human.** Interactive turn waits and
   `ask_user` questions (ask-user-tool.ts — no timeout of any kind) count against the same 30
   minutes as model work. An interactive session that pauses for lunch dies "by guardrail" even
   though the system was idle by design.
4. **Queued subscription runs look hung.** The shared gate defaults to concurrency **1** and is the
   *same* semaphore as the auto-rating CLI judge (`AUTO_RATING_MAX_CONCURRENCY`, env.ts:198;
   subscription-concurrency.ts:93-107) — a big suite serializes, and each queued run shows `pending`
   with zero events until it gets a permit. (One thing done right: the deadline is created *after*
   `gate.acquire()`, so queue time doesn't eat the budget — executor:855-862.)
5. **Long-session streaming fragility.** No SSE `id:`/`Last-Event-ID` resume — every reconnect
   replays the whole buffer and the client dedupes by `seq` (api.ts:232-238; use-run-stream.ts:669-677).
   The live late-join buffer caps at 2000 events, oldest dropped (run-manager.ts:43,159-160) — an
   hour-long run's early history is only available via replay-after-finish. And there is no client
   staleness watchdog: the server sends `: ping` comment keepalives (routes.ts:139) that
   `EventSource` never surfaces to the app, so a silently dead socket shows a ticking elapsed clock
   and no data until `onerror` happens to fire.

---

## Part B — Proposal: one session contract

Keep the wire format and the persistence model — they already carry everything. Add a thin
normative layer with three pieces: a **shared lifecycle** every executor must map to, a **shared
clock policy** owned by one module instead of three copies, and a **capability manifest** so the UI
renders what a run *can do* instead of what kind it *is*. All changes are additive; old persisted
runs replay unchanged.

### B1. One lifecycle, one terminal table

Normative phases: `queued → starting → running ⇄ waiting_input → reviewing → terminal`.

- Additive event `{type: "phase", phase: "queued" | "waiting_input" | …, detail?}` emitted at
  transitions. `RunStatus` stays untouched (no migration); the phase event is presentation-level
  truth. Emitters: subscription gate wait (`queued`, with queue position in `detail`), engine/qlik
  `nextTurn` + `ask_user` waits (`waiting_input`), all executors on permit/start.
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
  event and the runs row. This retires `guardrailFromReason`'s string-sniffing and fixes the qlik
  `aborted`-on-deadline mismatch (A3.1) in one move.
- **"End session" button** on interactive runs (all kinds): finalizes as `completed`/`session_ended`.
  Interactive sessions stop being the only runs that can never succeed.

### B2. One clock policy (the "stops longer runs" fix)

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
   adding it to the subscription/qlik interactive loops' `nextTurnOrStop` race.
3. **Warn, then extend, then stop.** At T−5 min the clock emits `{type:"phase", phase:"deadline_warning"}`;
   RunBar shows a countdown chip with one-click **"+15 min"** (new `POST /api/runs/:id/extend`,
   which the SessionClock honors and audits into the run's step log as a `context_event`). A run
   that is mid-stream at the deadline finishes with an honest `max_duration` stop *after a visible
   warning*, not a silent kill.
4. **Optional stall detector** (activity-based): no events of any type for N min while `running` →
   stop with `stopReasonCode: "stalled"`. This is the guard the 30-min cap was actually standing in
   for — it catches hung children/streams without punishing productive long runs.
5. **Queue transparency + decoupling.** Subscription runs emit `phase: queued` immediately;
   run concurrency gets its own setting (`SUBSCRIPTION_RUNS_MAX_CONCURRENCY`) instead of riding
   `AUTO_RATING_MAX_CONCURRENCY`, so "the judge is busy" stops serializing user-facing runs.

### B3. Capability manifest instead of provider-kind forks

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
  identity?: { kind: "qlik_assistant"; assistantId; appId; threadMode; transport }; // rail card
};
```

Current values: engine → `{liveReasoning:"raw", tokens:"exact", contextWindow:true, costBasis:"api_exact", …}`;
subscription → `{liveReasoning:"none", tokens:"exact", contextWindow:false, costBasis:"subscription_reference"}`;
qlik → `{toolCalls:false, tokens:"estimated", contextWindow:false, costBasis:"questions", liveReasoning:"structured"}`.

The UI then renders **one console with per-capability degradation**:
- `KpiRail` assembles its tiles from a declarative list driven by capabilities (context tile iff
  `contextWindow`; token tiles labelled "est." iff `tokens==="estimated"`, hidden iff `"none"`;
  cost tile knows its unit — `$`, `$ est. · subscription`, or `N questions`). The qlik identity
  card renders iff `identity` is present.
- `ContextChart`/baseline gate on `contextWindow`, not `providerKind === "qlik_answers"`.
- `ConversationPane` picks the reasoning renderer from `liveReasoning`, and the answer renderer
  from the payload (as it already does via `promptMode` — formalized instead of inferred).
- The composer/QuestionPrompt gate on `followUps`/`askUser` (also fixes the current
  QuestionPrompt gating drift, QuestionPrompt.tsx:14-15 vs ConversationPane.tsx:227).

This is the piece that makes the *next* executor (another vendor assistant, a local runner) come up
looking right with zero new UI branches — and it deletes the fragile credential-based kind
re-derivation (A3.3).

### B4. One status/label module

One shared derivation `(status, outcome, stopReasonCode, ratingState, phase) → {label, tone, spinner}`
in `lib/status.ts`, consumed by RunBar, RunsView, StepLog, SuiteRunConsole, and suite rows. Proposed
single vocabulary (labels finalize with the owner):

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

### B5. Long-session stream robustness

- Server: set SSE `id: <seq>` and honor `Last-Event-ID` — replay from cursor (fall back to persisted
  events when the cursor predates the 2000-event buffer). Reconnects on hour-long runs stop
  re-shipping the world; late joiners get full history.
- Replace the `: ping` comment keepalive with a real `{type:"ping"}` event (additive) so the client
  can run a staleness watchdog: nothing received for ~45 s → show the existing "connection lost"
  banner proactively instead of waiting for `onerror`.

### B6. Quick wins (shippable independently, before the full contract)

1. Fix the qlik deadline terminal to `stopped`/`stopped_guardrail` (one-line-ish, kills the worst
   A3.1 inconsistency).
2. Wire `scenario.guardrails.idleTimeoutMs` through `resolve()` (the engine already accepts it).
3. Emit `status: running` (or a `queued` context_event) before `gate.acquire()` on the subscription
   path so queued runs stop looking dead.
4. Unify `error`→"Failed" and `aborted` labels between RunBar and status.ts.
5. Surface `maxRunDurationMs` in the RunLauncher configure step + RunBar budget display, even
   before the extend/pause mechanics land.

---

## Part C — Wave plan (worktree-isolated, repo conventions)

Gate per task: `pnpm typecheck && pnpm test && pnpm build`, `corepack pnpm@9.15.4`. All contract
changes additive; no migration of persisted runs (missing fields default: `phase` absent,
`capabilities` re-derived from credential exactly as today).

- **Wave 1 — contract + clock (api, shared).**
  W1.1 `stopReasonCode` + shared `terminalFor` table adopted by all three executors (incl. qlik
  deadline fix, "End session" terminal). W1.2 `SessionClock` extraction: pause-in-waiting_input,
  uniform idle timeout, deadline warning event, `POST /api/runs/:id/extend`, stall detector.
  W1.3 `phase` events (queued / waiting_input / deadline_warning) + subscription queue visibility +
  own concurrency setting. W1.4 `SessionCapabilities` emitted + persisted (additive columns).
  Regression tests: one lifecycle test *per executor* asserting the same cause → same terminal.
- **Wave 2 — one console (web).**
  W2.1 single status module + RunBar/RunsView/StepLog/Suite adoption (B4 table). W2.2 KpiRail
  declarative tiles + ContextChart/composer/QuestionPrompt gating on capabilities. W2.3 RunBar
  budget display + countdown + Extend + "End session"; queued/waiting states.
- **Wave 3 — settings + streams.**
  W3.1 Settings → Testing defaults (max duration, idle, subscription concurrency) + launcher
  override field. W3.2 SSE `id:`/`Last-Event-ID` cursor resume + `ping` event + client watchdog.
  W3.3 Suite console parity pass (same status module, same phase chips on cells).

**Explicitly unchanged:** the `RunEvent` union and step types (additions only), persistence/replay,
grading contracts (`assistantText` byte-identity), Compare, the Answers block renderer
(`AnswersAnswerView`/`AnswersReasoning` stay — they become capability-driven presentation, not a
fork), and the D-CS3/D-QA "same vocabulary" invariants, which this proposal completes rather than
replaces.
