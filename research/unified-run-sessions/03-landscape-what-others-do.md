# 03 — Landscape: how other solutions do session management & representation

Comparative research (2026-07-16), investigated via subagents: two open-source codebases were
cloned and read (**openwork** v0.17.30, **cdesktop** v0.2.3), **Gumloop** was researched from its
public docs/changelog, and a fourth pass surveyed the *documented* run/session state machines of
OpenAI (Assistants/Responses), LangGraph Platform, Temporal, and the AI SDK v5 / AG-UI stream
protocols. Code claims cite repo paths; product claims cite URLs (source list at the end).

Why these transfer well: openwork and cdesktop are OSS agent-workspace apps with an architecture
close to ours (local server + SQLite + web UI + SSE/WS streaming over multiple agent backends);
Gumloop is the operator/automation angle (closest analogue to our suites); the fourth group is
formal prior art for exactly the state-machine questions in `02-open-questions.md`.

---

## 1. Capsule per solution

### openwork (different-ai/openwork — Electron app over an OpenCode sidecar)

- Doesn't run an agent loop itself; it is a client of the **OpenCode server** (sessions, messages,
  parts). Persisted session status is deliberately tiny: **`idle | busy | retry{attempt,next}`**
  (`apps/server/src/session-read-model.ts:31-35`). *There are no terminal states at all* —
  sessions return to `idle` and stay resumable forever; `completed`/`archived` are **timestamps**,
  not statuses.
- Display states (`idle | thinking | responding | error | compacting | waiting`) are **derived
  client-side** with a strict precedence function from orthogonal signals: run flag,
  first-visible-output flag, pending permission/question ids, error flag
  (`session-activity-store.ts:79-85`). "Waiting for input" is never a server state — it is derived
  from **listable pending-request records** (`permission.list` / `question.list`), so a wait
  survives app restart.
- **No timeouts anywhere on agent waits or runs** (repo-wide). Long-run care instead:
  engine reloads are *deferred while any session is active*; Electron background throttling
  disabled; desktop notifications for permission/question/finish. Retry is a first-class in-run
  state with a **server-authored absolute `next` timestamp** the UI renders as a countdown.
- Reconnect = exponential backoff + a **30 s stale-stream watchdog**, then **snapshot refetch as
  truth** + transcript reconcile — no event cursors. Two coalescing layers keep per-token deltas
  from freezing the UI.
- Capability handling: a fetched **`/capabilities` manifest** drives UI degradation, *plus*
  per-call runtime feature detection with fallbacks (v2→legacy permission APIs).
- Naming: entity "session", user-facing verb "task". Queued follow-ups are client-side only
  (visible, removable, drain as one merged message on idle; **Stop clears the queue first**).
  Notably: per-message cost/token data exists in the model but is **never displayed** — measuring
  isn't their product (it is ours).

### cdesktop (cdesktop-ai/cdesktop — rebranded Vibe Kanban; Rust+SQLite server, React UI, ~12 agent CLIs)

- Five-level model: Task (kanban `Todo…Done`) → **Workspace** (attempt, git worktree) → **Session**
  (thread; **no status column at all**) → **ExecutionProcess** (`Running | Completed | Failed |
  Killed` + `exit_code`) → **CodingAgentTurn** (stores the CLI's own session/message ids for
  `--resume`, plus a **`seen` bool**). Only the *process* has a lifecycle
  (`crates/db/src/models/execution_process.rs:43-48`).
- **"Needs attention" is a read-time projection**, not a state: `pendingApproval || (unseenTurns
  && !running)`, composed in a summary endpoint and rendered as the **top sidebar section** (not a
  badge). Startup marks orphaned `Running` rows `Failed` (boot reconciliation — we do this too).
- **User stop ≠ failure, enforced by ordering**: `Killed` is written to the DB *before* the kill
  signal; the exit monitor checks `was_stopped()` so it can never reclassify a stop as `Failed`
  (`local-deployment/src/container.rs:1446-1500`).
- Approvals ride the CLI's own hook system; `ApprovalStatus { Pending, Approved, Denied{reason},
  **TimedOut** }` with a **10-hour wait timeout** (`APPROVAL_TIMEOUT_SECONDS = 36000`) — the
  timeout is a first-class outcome on the transcript entry, and docs say "send a new message to
  restart". **No wall-clock cap and no idle timeout on runs themselves.**
- Streaming: per-process **ring buffer (100 MB) + broadcast**; every subscriber gets
  **history-then-live**; app-wide state sync via SQLite update hooks → JSON-Patch over one SSE
  endpoint; per-session WS sends a `replace` snapshot then patches. **Reconnect = fresh snapshot,
  no cursors.** A root-level provider follows *all* running sessions even when not viewed
  (multi-window/phone relay).
- Raw agent stdout JSONL is persisted; the normalized transcript is **re-derived at read time** —
  a normalizer fix retroactively improves old transcripts (we already do this for Qlik legacy runs).
- Capabilities: **static per-executor enum** (`SessionFork | SetupHelper | ContextUsage` — the
  context gauge only renders when the backend declares ContextUsage) *separate from* runtime
  `AvailabilityInfo` (installed/logged-in probes).
- Queue: **single-slot** `QueueStatus { Empty, Queued{message} }` per session, shown as a chip on
  the composer, auto-fires on success, **discarded on Failed/Killed**. Finish notifications are
  suppressed when the user stopped the run. Anti-pattern they demonstrate: three nouns for one
  thing (Task/Workspace/Session in code, "Session" as the UI label for Workspace, "workspace" in docs).

### Gumloop (closed-source; docs/changelog evidence)

- Two primitives with **two different state enums**: flow runs `QUEUED / RUNNING / DONE /
  TERMINATING / TERMINATED / FAILED` and agent sessions `queued / processing / idle / completed /
  failed` — plus two parallel history UIs (Previous Runs vs Tasks page). Sending into a session is
  allowed **only in a terminal-for-input state** (`idle|completed|failed`) — an enforceable
  invariant.
- **`TERMINATING` is an explicit transitional cancel status** (kill via dedicated endpoint).
  Machine-readable causes stop at the coarse status level: the run `log` is **unstructured
  strings**, stop causes are prose ("terminated due to excess memory") — history is unfilterable
  by cause. No documented wall-clock limit; the hard kill is memory; **crashed agent sessions free
  their concurrency slot after ~2 h** (orphan reaper distinct from human-wait policy).
- Human-in-the-loop (agents): approval cards + "Ask Human" choice cards; **waits are indefinite
  with full saved state**; surfaced via a notification inbox, a Tasks-page "Approval Required"
  filter, and Slack buttons. **Credit thresholds pause the chat and require approval to
  continue** — a spend cap modeled as wait-for-input, not failure.
- Cost: workflows are **exactly pre-estimable** (static per-node prices, hover-"?" preview);
  agents documented as **impossible to pre-calculate**, with post-hoc split ("Chat & Reasoning" vs
  "Tool Calls"); failed runs charge only executed nodes. Their agent UI ships a **context-window
  meter broken down by segment** (system/instructions/abilities/tools/conversation) — convergent
  with our ContextChart segments.
- Queueing: documented concurrency tiers; at the cap Enterprise queues FIFO, lower tiers get an
  honest 429; sessions expose a **`queue_position` field**. Any URL carrying `run_id` deep-links
  into the run panel; failure emails carry the run link + error.

### Documented prior art (OpenAI · LangGraph · Temporal · AI SDK/AG-UI)

- **OpenAI Assistants runs**: 9 statuses — `queued, in_progress, requires_action, cancelling,
  cancelled, failed, completed, incomplete, expired`. `requires_action` and `queued` are **real,
  pollable statuses** with a typed unblock payload; resuming goes *back through `queued`*.
  **`expired`** is a named abandoned-wait terminal (~10 min TTL via `expires_at`, not extendable).
  `incomplete` (budget exhausted, `incomplete_details.reason` enum) is **disjoint from** `failed`
  (`last_error.code` enum). Per-transition timestamps (`started_at/…/expires_at`) are fields. The
  successor Responses API keeps the shape and adds **`sequence_number` on every stream event +
  `?starting_after=<cursor>` resume**.
- **LangGraph**: run statuses `pending / running? / error / success / timeout / interrupted` —
  `timeout` is its own terminal; `interrupt()` waits **indefinitely** because state lives in a
  checkpointer; resume replays the interrupted node from its start (pre-wait side effects must be
  idempotent). **Double-texting is a documented four-policy vocabulary** for follow-ups into a
  running thread: `reject / enqueue (default) / interrupt / rollback`. Caveat: `interrupted`
  double-duties as "paused for human" *and* "superseded by a follow-up" — a naming overload their
  users must query around.
- **Temporal**: workflow execution timeout **defaults to infinite** and the docs recommend not
  setting it ("Workflows are designed to be long-running"); deadlines belong on *steps*
  (activities, "always set Start-To-Close"). Stall detection is **liveness (heartbeats), not
  wall-clock**: each heartbeat rolls the heartbeat-timeout window. Waiting for a signal/human
  costs nothing and can last months (durable timers). Breach of a wall-clock cap yields a distinct
  **Timed Out** terminal, not Failed.
- **AI SDK v5 / AG-UI**: AI SDK's stream has rich part vocabulary (text/reasoning/tool parts,
  step boundaries, `finishReason` enums with usage at step *and* message level, even
  `tool-approval-request` parts) but **no run status in the stream** — and pays for it with a
  bolt-on Redis resume architecture. AG-UI mandates the opposite: every run's stream opens with
  `RUN_STARTED` and terminates with `RUN_FINISHED{outcome}` / `RUN_ERROR{code}`, so status is
  derivable from the event log alone.

---

## 2. Convergent patterns (what the field agrees on)

**P1 — Session ≠ run, universally.** Every system separates the durable conversation container
(session/thread/workspace) from the bounded execution (run/turn/process), and *only the execution
has a terminal state*. openwork has literally no session terminals; cdesktop's Session has no
status column; Gumloop sessions go `idle` between turns; LangGraph threads persist while runs
end; AG-UI fires `RUN_FINISHED` even when the outcome is an interrupt. **Nobody makes an
interactive session "complete".** Our finding that interactive runs can never end `completed`
(00 §3.1) is not a bug in the field's terms — the bug is that we model the *session* and the
*execution* as one object with one status.

**P2 — Persist a small status core; derive the presentation states; keep waits queryable.**
openwork (3 persisted states + derived overlays), cdesktop (4 process states + read-time
projections from pending-approval/unseen rows) and OpenAI (typed `required_action` payload on the
run object) all converge on: *the thing a reconnecting client must never lose (what is the run
waiting for?) lives in queryable state, not only in the event stream* — while cosmetic phases
(thinking/responding/compacting) are derived. AG-UI adds: still emit lifecycle transitions as
events so the log alone is coherent. Both-and, not either-or.

**P3 — Nobody caps the whole run at 30 minutes.** openwork: no timeouts. cdesktop: none on runs.
Gumloop: no documented time limit (memory is the hard kill). Temporal: infinite by default,
explicitly recommends against execution caps. The one 10-minute TTL in the field (OpenAI) exists
because they hold server resources per run — and the ecosystem treats it as a pain point. The
field's tools for runaway work are instead: **liveness/stall detection** (Temporal heartbeats),
**resource caps** (Gumloop memory, credit thresholds), **step-level deadlines** (Temporal
Start-To-Close), and **orphan reapers** (Gumloop ~2 h slot release; cdesktop boot reconciliation).

**P4 — Waits on humans are indefinite-or-long, and a timed-out wait is a *named* outcome.**
Gumloop: indefinite with saved state. LangGraph: indefinite via checkpointer. openwork:
indefinite + notifications. cdesktop: 10 h with first-class `TimedOut`. OpenAI: 10 min with the
dedicated `expired` terminal. The pattern: the wait bound is a property of *what holding the wait
costs* (live process → short; checkpointed → unbounded), and expiry gets its own machine-readable
terminal, never generic failure.

**P5 — Stop is two-phase and pre-declared.** Gumloop `TERMINATING`→`TERMINATED`; OpenAI
`cancelling`→`cancelled`; cdesktop writes `Killed` *before* signaling the process so the exit
monitor can't reclassify it; openwork treats an unconfirmed abort as not-stopped and clears the
follow-up queue on stop; cdesktop suppresses the finish notification for user stops.

**P6 — Follow-up policy is explicit and named.** LangGraph's reject/enqueue/interrupt/rollback;
cdesktop's visible single-slot queue that is discarded when the run fails; Gumloop's
`queue_position` + send-only-when-terminal-for-input invariant. openwork's client-only queue is
the anti-pattern (invisible cross-device).

**P7 — Resume: snapshot-then-tail is the field default; cursors where events are already rows.**
openwork (snapshot refetch + 30 s stale watchdog), cdesktop (`replace` snapshot + patches,
history-then-live ring buffer) chose snapshot; OpenAI chose per-event `sequence_number` +
`starting_after`; AI SDK shows the cost of neither (Redis pub/sub bolt-on). We already persist
every event with a `seq` — both options are cheap for us; the watchdog is the missing piece either way.

**P8 — Capabilities: statically declared per backend, runtime-verified, and they gate UI.**
cdesktop's `BaseAgentCapability` (context gauge renders only if declared) vs runtime
`AvailabilityInfo`; openwork's `/capabilities` manifest + per-call feature detection; Gumloop's
documented per-kind estimability (flows exact, agents impossible). Directly validates our C3
manifest and answers its static-vs-detected tension: **declare statically, verify at runtime**.

**P9 — Machine-readable terminal causes, per-terminal payloads.** OpenAI pairs each terminal with
its own detail object (`last_error.code`, `incomplete_details.reason`); AI SDK enumerates
`finishReason` at step and message level; LangGraph names `timeout`. Gumloop's prose-only stop
reasons are the counterexample (unfilterable history — the exact complaint our
`guardrailFromReason` string-sniffing embodies today).

**P10 — Attention & time are rendered from server-authored absolute timestamps.** openwork's
retry `next` countdown; OpenAI's `expires_at` and per-transition timestamps; cdesktop's
needs-attention sidebar section + unseen flags for "came to rest". Nobody renders a deadline from
a client-side timer. And notably: **no one splits active-vs-waiting duration** (Gumloop only has
created/finished) — the one place we can beat the field rather than follow it, since our
clock-pause policy makes the split free.

---

## 3. What this says about our open questions

Leanings only — decisions stay with the owner in `02-open-questions.md`.

| Q | Evidence-based leaning |
|---|---|
| **Q1** phase events vs real statuses | Hybrid, with a rule: anything a reconnecting/polling client must recover (**queued, waiting_input + its typed "what unblocks me" payload**) must be queryable state on the run (OpenAI `requires_action`; openwork/cdesktop pending-request rows), *and* every transition is also an event (AG-UI). Cosmetic phases (thinking/responding/reviewing) stay derived/event-only. Don't overload one value for two meanings (LangGraph's `interrupted`). |
| **Q2** what does "completed" mean for interactive | The field's unanimous answer: **split the object**. Turn/run outcomes terminate; the session is a container that goes `idle` and is *disposed* (archived/acknowledged), not completed. cdesktop's `seen` flag ("came to rest, human hasn't looked yet") is the honest session-level signal. This reframes C1's "End session → completed" — consider per-turn verdicts + session disposition instead. |
| **Q3** duration semantics if the clock pauses | Temporal's two-clock precedent (wall-clock caps vs liveness) + per-transition timestamps (OpenAI) give the schema: record `activeDurationMs` and `totalDurationMs`, exclude `waiting_input` spans from stall detection and from duration KPIs. No competitor splits these — differentiation opportunity for a measurement product. |
| **Q4** extend-the-deadline | Weak precedent for a user-facing "extend" RPC — the field ships **rolling proofs-of-life** (Temporal heartbeats restart the stall window) or fixed TTLs (OpenAI). Leaning: activity-rolled stall deadline + generous/no wall cap by default, rather than extend-buttons; if a cap is set, Gumloop's "threshold pauses and asks approval to continue" models extend-as-waiting_input. |
| **Q5** capability manifest static vs detected | Settled by convergence: **static declaration per backend adapter + runtime availability/verification**, manifest gates UI elements (cdesktop context gauge). Estimability itself is a documented capability (Gumloop: flows exact, agents not pre-calculable) — matches our `tokens/cost` axes. |
| **Q6** status vocabulary | Steal the two named states we lack: a transitional **`stopping`** (Gumloop TERMINATING, OpenAI cancelling) and a named abandoned-wait terminal (**`expired`**-like, OpenAI) distinct from user stop and from failure. Budget-exhausted distinct from error (OpenAI `incomplete` vs `failed`) — we have this (`stopped_guardrail`) — keep it. |
| **Q7** queue visibility | Real queued state + numeric position (Gumloop `queue_position`), plus a **named double-texting policy per surface** (LangGraph): enqueue for suites, and for interactive composer decide enqueue-single-slot (cdesktop, discard-on-failure) vs interrupt. |
| **Q8** idle-timeout policy | Bound the wait by what it costs to hold: our engine/CLI runs hold live processes and MCP sessions → a bounded ask-user/idle wait with its own terminal is right; qlik holds only a thread id → could wait much longer. Timeout values in the field: 10 min (OpenAI, resource-holding) to 10 h (cdesktop) to indefinite (Gumloop/LangGraph, checkpointed). A per-kind wait budget is defensible and the capability manifest is where it belongs. |
| **Q9** SSE resume | Both proven. Given our events are persisted rows with `seq`, OpenAI-style cursor resume is cheap; cdesktop/openwork show snapshot-then-tail also works and needs no protocol change. Either way, adopt the **30 s stale-stream watchdog** and delta coalescing (openwork) — those address the observed "ticking clock, no data" failure directly. |
| **Q10** quick wins first | The field's invariants that we violate *today* and could fix cheaply: stop-verdict-written-before-kill ordering (cdesktop), suppress finish-notification/toast on user stop (cdesktop), stop clears queued follow-ups (openwork). |
| **Q11** scope (assistant dock, compat runner) | openwork/cdesktop run *everything* through one session model and one normalized transcript taxonomy over 12 backends — evidence that one contract can absorb our other session-ish surfaces later; but both also show it works fine to keep the kanban/task layer (suites, for us) as a *separate* aggregate over runs. |
| **Q12** naming | Strong convergence on user-facing **"session"** for the container and **"run"/"task"** for the execution. cdesktop is the cautionary tale (three nouns for one thing across code/UI/docs); Gumloop's two parallel vocabularies produced two history UIs. Decide once, apply to code+wire+docs+labels. |

## 4. Ideas worth stealing outright (shortlist)

1. **Typed "what unblocks me" payload** on waiting runs (OpenAI `required_action`) — our `question`
   event persisted as a queryable pending-input row with structured options.
2. **Stop verdict written before the kill** + confirmed-abort semantics (cdesktop, openwork #2014).
3. **`stopping` transitional status** and **`expired` wait terminal** in the vocabulary (Gumloop/OpenAI).
4. **Needs-attention as a sidebar/list *section*** fed by `pendingInput || (unseen && !running)`,
   with unseen-tracking per turn (cdesktop) — maps directly onto our Runs feed.
5. **Server-authored absolute deadline/retry timestamps** rendered as countdowns (openwork
   `retry.next`) — applies to our deadline warning, retry backoff, and rating "Reviewing…".
6. **Single-slot visible follow-up queue, discarded on failure** (cdesktop) for the interactive
   composer; documented double-texting policy per surface (LangGraph).
7. **Stale-stream watchdog (30 s) + snapshot-refetch reconcile** on reconnect (openwork), whichever
   resume transport we pick.
8. **Per-kind estimability as documentation**, pre-run estimate vs post-run actual split, and
   "failed runs charge only executed steps" (Gumloop) — for our launcher cost preview and suite
   accounting.
9. **Context-window meter segmented by source** (Gumloop agents) — convergent validation of our
   ContextChart segments; keep it.
10. **Raw-payload persistence + read-time re-normalization** as the general rule (cdesktop; we
    already do it for Qlik legacy runs).

## Sources

Repos (cloned & read 2026-07-16): `different-ai/openwork` v0.17.30; `cdesktop-ai/cdesktop` v0.2.3
(fork of BloopAI Vibe Kanban). Gumloop: docs.gumloop.com (core-concepts: agents, run_log, credits,
rate_limits, human_in_the_loop, workflow_triggers, alerts; api-reference: runs & sessions),
gumloop.com/changelog. Prior art: OpenAI Assistants deep-dive + Run object + background-mode guide
(developers.openai.com); LangGraph docs (interrupts, background runs, double-texting, RunStatus);
Temporal docs (detecting-workflow-failures, detecting-activity-failures, timers,
workflow-message-passing); AI SDK v4/v5 stream-protocol + resume-streams docs (ai-sdk.dev); AG-UI
events (docs.ag-ui.com). Full per-claim citations live in the subagent reports this doc distills.
