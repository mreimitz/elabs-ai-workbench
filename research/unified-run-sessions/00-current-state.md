# 00 — Current state: how the three run harnesses actually behave

Verified analysis (2026-07-16). Evidence is file:line; the load-bearing claims (terminal mappings,
timeout constants, label divergence, buffer/SSE behavior) were traced first-hand in the code, not
inferred from docs.

---

## 1. Three executors, one dispatch point

`RunService.execute` (apps/api/src/testing/run-service.ts:491-548) branches on the environment's
provider kind:

| Path | Executor | Mechanism |
|---|---|---|
| `claude_subscription` | `claude-subscription-executor.ts` | Claude **Agent SDK** child process via the injected `AgentSessionDriver` seam; MCP servers spawned *inside* the child from a translated `mcpServers` config (subscription-tools.ts:76-108) |
| `qlik_answers` | `qlik-answers-executor.ts` | Internal `/api/v1/cloud-assistants/` REST + SSE card-patch stream; thread per run; settled answer re-fetched from `…/messages` (executor:763-921) |
| everything else (anthropic, openai, google, openai_compatible, ollama) | `engine.ts` `runAgentLoop` | AI-SDK `streamText` multi-step loop + server-side `McpSession` tool bridge |

`providers/registry.ts:67-77` throws for the two special kinds, so they can never reach the engine.

## 2. What is already unified (keep this — it works)

The 08-runs-session-rework foundation did its job. All three executors emit the **same `RunEvent`
vocabulary** (`status`, `step`, `delta`, `kpi`, `error`, `question`, `question_resolved`, `rating` —
packages/shared/src/types.ts:1366-1422) through the **same choke point** `RunManager.emit`
(run-manager.ts:132), which stamps monotonic `seq`/`step.index`, keeps a bounded live replay buffer,
and fans out to persistence + SSE. One console (`RunConsole`) renders all three kinds; persistence,
replay, grading, suites and Compare are kind-agnostic. The Answers executor was explicitly designed
to "render identically" (qlik-answers-executor.ts:29-30), as was the subscription path (D-CS3).

**The divergence is not in the wire format. It is in lifecycle semantics, timeout policy, and
presentation policy — three places where each executor made its own local decision.**

## 3. Why sessions feel different — the divergence matrix

### 3.1 The same cause produces a different terminal per executor (verified first-hand)

| Cause | API engine | CLI subscription | Qlik Answers |
|---|---|---|---|
| 30-min wall clock fires | `stopped` / `stopped_guardrail` (engine.ts:814-827) | `stopped` / `stopped_guardrail` (executor:997-1002) | **`aborted` / `aborted`** (executor:273-289 — comment admits "duration cap and a user stop both map to `aborted`, distinguished only by the free-form stopReason") |
| Interactive session ends cleanly | idle timeout → `stopped` / `stopped_guardrail` (engine.ts:831-844) | `aborted` ("Run aborted by user") (executor:995-1002) | `aborted` (executor:505-519) |
| Interactive run ever `completed`? | never (idle timeout or stop) | never — by design "the session was ended, not completed" | never — accepted deviation (roadmap/qlik-answers/STATUS.md:586-592) |
| Waiting on subscription concurrency permit | n/a | **invisible** — `status: running` only emitted *after* `gate.acquire()` (executor:855-856); until then the run sits `pending` with a dead console | n/a |
| Waiting for user input / ask_user answer | stays `running`, no distinct state (use-run-stream.ts:182-186) | stays `running` | stays `running` |

So the *identical* user action — walking away from an interactive session — reads as an amber
guardrail stop on an API run, and a neutral/gray "Aborted" on a CLI or Answers run. And no state in
the model ever says "waiting for you" or "queued".

### 3.2 Status presentation is a split brain (verified first-hand)

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

### 3.3 Per-kind UI forks are scattered, keyed on `providerKind`, and fragile

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
(roadmap/qlik-answers/STATUS.md:599-603; use-run-stream.ts:296-314). Every new executor kind means
another round of scattered `if (providerKind === …)` forks — this is exactly why each new
integration "looks different" by default.

## 4. Why longer runs stop (verified first-hand)

There is exactly **one** wall-clock guard, and it is a hard-coded default:

1. **`DEFAULT_MAX_RUN_DURATION_MS = 30 * 60_000`** (engine.ts:114) applies to *all three* executors
   (engine.ts:440; subscription executor:850/931; qlik executor:202/398). Override exists **only**
   as `scenario.guardrails.maxRunDurationMs` per environment — no app setting, no env var, no
   launcher field, no UI hint that a cap exists. When it fires it aborts the in-flight stream
   mid-turn via `AbortController`, with **no warning and no grace period**, and the terminal it
   produces differs per executor (§3.1). A run that is *actively streaming useful work* at 29:59 is
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
