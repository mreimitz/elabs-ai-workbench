# Unified Sessions — STATUS

**Workstream:** one session experience across the three run backends + OpenAI-compat facade.
**Decisions:** D-US1…D-US15 locked 2026-07-16 (see README.md). **Branch:** `feat/unified-sessions`.

## Checklist

### Wave 1 — Contract & clock (api + shared)
- [x] WP1.1 Contract module (shared types, terminalFor, capabilities) — Opus ✅ 9cf6a7f, gate green, merged to feat/unified-sessions
- [x] WP1.2 SessionClock — Sonnet ✅ 15cff93, gate green, merged to feat/unified-sessions
- [x] WP1.3 Engine adoption — Sonnet ✅ 3932996, gate green, merged (cedf0d8)
- [x] WP1.4 Subscription adoption (queued phase, own concurrency setting) — Sonnet ✅ 61a6ab0, gate green (merge HELD for coordinated seam-close)
- [x] WP1.5 the vendor adoption (deadline fix, prompt_rejected, wait budget) — Sonnet ✅ f95bb01, gate green (merge HELD for coordinated seam-close; see flags)
- [x] WP1.6 Persistence & API (columns, /end, /seen, openQuestions) — Sonnet ✅ 913a9f6, gate green, merged to feat/unified-sessions (4f4ca16)
- [x] WP1.R Adversarial review: same cause → same terminal, everywhere — Opus ✅ 971e9fe, invariant HOLDS; 3 phase-coherence defects → WP1.fix (running)

### Wave 2 — Stream robustness
- [x] WP2.1 SSE cursor resume + ping (server) — Sonnet ✅ 0aeede1, gate green, merged to feat/unified-sessions
- [x] WP2.2 Client watchdog + resume — Sonnet ✅ 78ca64f, gate green, merged to feat/unified-sessions
- [x] WP2.R Stream review (kill-the-socket) — Opus ✅ 8b91189, run-stream ALL HOLD; suite-ping = recommended small fix (WP2.3, queued after WP1.7)
- [x] WP2.3 Suite-stream ping parity (review-driven) — Sonnet ✅ d39a9a6, gate+build green, merged → feat @ d39a9a6. **Wave 2 COMPLETE.**

**WP3.fix (WP3.R follow-up)** ✅ `2353258` — `ended` replay-mode fix (single `isTerminalRunStatus` incl.
`ended`) + D-US5 conformance sweep (bridge consolidated onto `deriveRunStatusView`; 7 surfaces swapped;
main Runs feed now shows locked labels). Gate+build+lint green (api 1973; web 1068+5). **Wave 3 CLOSED.**
**Facade lane merged** into feat → `8831ba7` (16 NEW files, clean); combined base typecheck green.
Dispatched **WP5.1** (`feat/unified-sessions-wp5.1`) — facade mount+deps in index.ts, NUL cleanup, full
gate+build, seeded acceptance (WP3.R harness), CHANGELOG.

### Wave 3 — One console (web)
- [x] WP3.1 Status module (locked label table, all surfaces) — Sonnet ✅ e7dbc07, gate green, merged (e11d4a8); 2 flags → WP3.3 (live phase) + WP3.R (8-surface conformance)
- [x] WP3.2 Capability-driven console (KPI tiles, gating) — Sonnet ✅ 05e8e5b, gate green, merged (acb55d1); vendor est.-token-tiles change → owner acceptance
- [x] WP3.3 Session affordances (End session, Waiting, needs-attention, seen) — Sonnet ✅ bbf7b8e, gate+build green, merged @ bbf7b8e
- [x] WP3.4 Settings & launcher (timers, concurrency, effective limits) — Sonnet ✅ df7b4f8, gate green, merged (41091ef); D-US7 full editability → owner follow-up (WP3.5)
- [x] WP3.R Visual + adversarial review (seeded runs, both themes, e2e) — Opus ✅ 89cb589 (42/42 grid PASS, both-theme rendered clean, 4 e2e pass); 2 defects → WP3.fix

### Wave 4 — OpenAI facade (parallel lane)
- [x] WP4.1 Facade core (/openai/v1, hold-back, affinity, golden tests) — Opus ✅ d12bc73, gate green (facade lane, unmerged until WP5.1)
- [x] WP4.2 Hardening + user-guide page — Sonnet ✅ eec43da, gate green (facade lane, unmerged until WP5.1)
- [x] WP4.R Protocol-conformance + adversarial review — Opus ✅ 8bdbb7c (22 probes, gate green); 2 LOW findings → WP4.fix in progress

### Wave 5 — Integration & docs
- [x] WP5.1 Merge train, full gate, seeded acceptance — Sonnet ✅ dc43ff8, facade mounted, full gate+build green, 42-row acceptance, CHANGELOG. Merged → feat; main folded in (feat is a superset).
- [x] WP5.2 User-guide updates + research cross-links — Haiku ✅ (running)

## Log

*(Bookkeeping agent appends one entry per WP completion/blocker: date · WP · verdict · gate ·
files · blockers · next. Never rewrite history.)*

- 2026-07-16 — Workstream created from `research/unified-run-sessions/` (docs 00–04); decisions
  D-US1…15 locked in owner Q&A; no implementation started.
- 2026-07-16 — Orchestration started. Branch `feat/unified-sessions` cut at `bef1849` (v1.1.0).
  Wave 1 + Wave-4 facade lane opened in parallel per §3. Dispatched the two unblocked WPs as
  Opus-class agents in isolated worktrees: **WP1.1** (contract module → `feat/unified-sessions-wp1.1`)
  and **WP4.1** (facade core → `feat/unified-sessions-wp4.1`). All other Wave-1 WPs gate on WP1.1's
  contract names (1.2/1.6/2.1) or on WP1.2 (1.3/1.4/1.5); WP4.2 gates on WP4.1 — held until these land.

- 2026-07-16 — **WP1.1 DONE** · verdict PASS · gate green (`corepack pnpm@9.15.4` typecheck all
  packages; test shared 21/21, api 1826/1826, web 947 pass + 5 skip; Biome clean) · commit `9cf6a7f`
  on `feat/unified-sessions-wp1.1`, fast-forwarded into `feat/unified-sessions`. Contract shipped:
  `STOP_REASON_CODES`(14) · `RUN_PHASES`(queued·starting·waiting_input·stopping) ·
  `WAITING_INPUT_REASONS` · `ended` appended to `RUN_STATUSES`+`RUN_OUTCOMES` · `SessionCapabilities`
  (+schema) · `RunEvent` gains `{type:"phase",phase,detail?{position?,reason?,deadlineAt?}}` +
  `{type:"ping"}` + optional `stopReasonCode?` on `status` · `terminalFor()`/`TerminalCause` in
  `session-terminal.ts` · `capabilitiesForProviderKind()`/per-kind caps + `VENDOR_ASSISTANT_WAIT_BUDGET_MS`
  in `session-capabilities.ts`. **Carry-forward (WP1.1 made design-neutral edits outside its nominal
  files to keep the gate green; downstream owners must reconcile):** `web/.../use-run-stream.ts`
  (`ended`→terminal group; owner **WP2.2**), `web/.../RunBar.tsx` (`ended` arms stubbed to clean-terminal
  tone; owner **WP3.1** must apply the locked label-table treatment), `apps/api/test/run-state-machine.test.ts`
  (vocab-lock updated for `ended`). Shared `RunSummary`/`RunDetail` extended additively — **WP1.6
  populates, does not re-add.** Next: WP1.2 + WP1.6 dispatched (Sonnet, off the updated wave base).
- 2026-07-16 — Dispatched **WP1.2** (SessionClock → `feat/unified-sessions-wp1.2`) and **WP1.6**
  (persistence & API → `feat/unified-sessions-wp1.6`), Sonnet-class, both off `feat/unified-sessions`
  @ 9cf6a7f. WP1.3/1.4/1.5 held on WP1.2; WP2.1 held on WP1.6 (routes.ts seam). WP4.1 still running.

- 2026-07-16 — **WP4.1 DONE** · verdict PASS · gate green (typecheck exit 0; api 1841 pass incl. 28
  new facade tests, web 947+5 skip; Biome clean) · commit `d12bc73` on `feat/unified-sessions-wp4.1`
  (based on `bef1849`; **facade lane stays UNMERGED until WP5.1's mount seam**). NEW `apps/api/src/
  openai-facade/**` (routes/translator/affinity-cache/auth/mapping/vendor-call) + 2 test files; **zero
  shared/db edits** (no seam with WP1.1). Golden byte-identity proven vs the real executor's
  `assistantText` over 3 stub fixtures. Stub-fetch-only honored (spy asserts tenant sees only
  `Bearer <vendorKey>`, facade key never forwarded). **WP5.1 mount (one line in `apps/api/src/index.ts`):**
  `await registerOpenAiFacade(server, { facadeKey, resolveModel, listModels })` + the import. **Flag
  for WP4.R/WP5.1:** the facade key mirrors the mcp-secret *file* convention (random token in a 0600
  file) — the WP text's "encrypted-at-rest" is a slight mischaracterization; confirm acceptable.
- 2026-07-16 — Dispatched **WP4.2** (facade hardening + `user-guide/15-openai-endpoint.md` →
  `feat/unified-sessions-wp4.2`), Sonnet, off `feat/unified-sessions-wp4.1`. Told to keep facade
  config out of `config/env.ts`/`index.ts`/shared, and to use a fetch-client fallback (flagging an
  owner dep decision) if `@ai-sdk/openai-compatible` isn't already a dep. WP1.2 + WP1.6 still running.

- 2026-07-16 — **WP1.2 DONE** · verdict PASS · gate green (typecheck all; api **1864/1864** incl. 38
  new clock tests; web 947+5 skip; Biome clean) · commit `15cff93` on `feat/unified-sessions-wp1.2`,
  fast-forwarded into `feat/unified-sessions` (NEW files only: `session-clock.ts` + test). **SessionClock
  API for WP1.3/1.4/1.5:** `new SessionClock({stallMs?, waitBudgetMs?, maxDurationMs?, onFire?, time?})`
  — lifecycle `start()` → `noteEvent()` per emitted event → `enterWaiting(override?)`/`resumeFromWaiting()`
  bracketing BOTH `next_turn` and `ask_user` waits → `stop()` on any terminal. Fired cause via `onFire`
  callback (once, first-wins) or `clock.fired`; cause strings `"stalled"|"wait_expired"|"max_duration"`
  typed as `Extract<TerminalCause,…>` so `terminalFor(clock.fired.cause)` needs no cast. Getters:
  `activeDurationMs` (excludes waiting), `totalDurationMs` (wall), `deadlineAt` (ISO for the phase
  event's `detail.deadlineAt`). Time-injection seam `time?: {now, schedule}` (default `REAL_SESSION_CLOCK_TIME`,
  unref'd timers). **Wall cap is NOT paused by waiting** (hard ceiling — verified). Pass a capability's
  `waitBudgetMs` (e.g. the vendor's `VENDOR_ASSISTANT_WAIT_BUDGET_MS`=30 min) as `waitBudgetMs`. Clock never
  emits/persists — executor calls `terminalFor` + emits. Next: WP1.3/1.4/1.5 held until WP1.6 also lands.

- 2026-07-16 — **WP4.2 DONE** · verdict PASS · gate green (typecheck all; api **1855/1855**; web 947+5
  skip; Biome clean; full `pnpm -r build` also passed) · commit `eec43da` on `feat/unified-sessions-wp4.2`
  (off WP4.1; facade lane still UNMERGED until WP5.1). Added `concurrency.ts` (non-blocking
  reject-fast limiter → 429+Retry-After), `config.ts` (`maxConcurrency` dep→`OPENAI_FACADE_MAX_CONCURRENCY`→4;
  `liveStream` dep→`OPENAI_FACADE_LIVE_STREAM`→false), `vendor-call.ts` `onAnswerDelta` live-stream seam,
  `user-guide/15-openai-endpoint.md`, and a REAL `createOpenAICompatible` AI-SDK smoke test
  (`@ai-sdk/openai-compatible` was already a dep — no owner dep decision needed). `index.ts`/`config/env.ts`/
  `shared` confirmed byte-untouched. Endpoint is not reachable in a running build until WP5.1 mounts it.
- 2026-07-16 — Dispatched **WP4.R** (facade adversarial review → `feat/unified-sessions-wp4.R`), Opus,
  off `feat/unified-sessions-wp4.2`. Read-only on impl; authors probe tests; prompted to REFUTE
  protocol conformance + golden byte-identity + affinity amnesia + key hygiene. WP1.6 still running;
  facade lane (4.1→4.2→4.R) then waits at WP5.1 mount.

- 2026-07-16 — **WP1.6 DONE** · verdict PASS · gate green (typecheck all; api **1842**; web 947+5 skip;
  Biome + sequential build clean) · commit `913a9f6`, merged `--no-ff` into `feat/unified-sessions` →
  **`4f4ca16`** (clean `ort` merge with WP1.2; both clock + migration present, verified). **Migration
  v31**: `runs.status` CHECK widened for `ended` + 7 nullable cols (`phase`, `stop_reason_code`,
  `ended_at`, `seen`, `capabilities_json`, `active_duration_ms`, `total_duration_ms`) via the
  "create-new→copy→drop→rename" shape (the rename-first shape corrupted FK text in `run_steps`/`run_events`
  — avoided). **Repo methods for executors:** `setCapabilities`/`setPhase`/`recordDurations`/`markEnded`/
  `markSeen`; `RunManager.emit(runId, event, meta?:{activeDurationMs?,totalDurationMs?})` threads durations
  to persistence off-wire. **Routes:** `POST /:id/end` 202/409(not-interactive|terminal|not-live)/404;
  `POST /:id/seen` 202; `GET /:id` now returns phase/stopReasonCode/endedAt/seen/capabilities/durations +
  `openQuestions` (unresolved `question` events, order-preserving). `ended` added to all terminal-status
  sets (RunManager, TERMINAL_SSE_STATUSES, orphan reconcile, suites orchestrator). `markUserInitiatedStop`/
  `wasUserInitiatedStop` for WP3.3 finish-toast suppression. **Carry-forwards:** (1) minimal `index.ts`
  `registerTestingRoutes(...,runManager)` signature change — WP5.1 reconciles with the facade mount;
  (2) `/end` calls run-service's existing `detachActiveRun`/`isActive` (no edit to that file); (3) **known
  gap for WP1.R:** `apps/api/src/grading/error-forensics.ts` has a LOCAL `TERMINAL_STATUSES` missing
  `ended` → an `ended` run under-detects in forensics (not a regression; ended sessions aren't errors, but
  flag for WP1.R to adjudicate/patch). No shared edits.
- 2026-07-16 — Peak fan-out: dispatched **WP1.3** (engine → `-wp1.3`), **WP1.4** (subscription → `-wp1.4`),
  **WP1.5** (vendor → `-wp1.5`), **WP2.1** (SSE cursor resume → `-wp2.1`), all Sonnet, off
  `feat/unified-sessions` @ 4f4ca16. Each carries the WP1.1+1.2+1.6 integration contract (terminalFor,
  SessionClock API, repo methods). Fences enforced: only WP1.3 may edit `run-service.ts`; WP1.4 owns
  `config/env.ts`; WP1.5 the vendor executor; WP2.1 the routes.ts **stream section only**. WP4.R (facade
  review) still running. Integration worktree at `.claude/worktrees/us-integration`.

- 2026-07-16 — **WP4.fix DONE** (WP4.R findings) · verdict PASS · gate green (api **1877/1877**; web
  947+5; build + Biome clean) · commit `76e3d80` on `feat/unified-sessions-wp4.fix` (facade lane tip:
  4.1→4.2→4.R→4.fix). GAP-2 fixed in `openai-facade/routes.ts` (affinity key = concatenated live text
  when `liveStream` actually streamed, else settled `answer.answer`; rewritten streaming probe proves
  append-reuse `threadCreateCount==1` + edited-prefix still forks); GAP-1 + facade-key wording corrected
  in `user-guide/15-openai-endpoint.md` (no shared code touched — 3 files only). Hold-back byte-identity
  golden tests still green; hold-back stays default. **✅ Facade lane COMPLETE — parks at WP5.1 mount**
  (`await registerOpenAiFacade(server, { facadeKey, resolveModel, listModels })` + import).
- 2026-07-16 — **WP4.R DONE** · verdict PASS-with-findings · gate green (api **1877** incl. 22 new
  probes; web 947+5) · commit `8bdbb7c` on `feat/unified-sessions-wp4.R` (read-only review, no facade
  source touched). **HOLDS:** protocol conformance (chunk shape/order, single `[DONE]`, usage-as-final-chunk,
  error envelope, `/models` shape), hold-back **golden byte-identity** (facade-stream == facade-nonstream
  == executor `assistantText` over 3 fixtures), key hygiene (never logged/forwarded; 0600 file), stub-only.
  **2 LOW confirmed defects → dispatched WP4.fix** (`feat/unified-sessions-wp4.fix`, Sonnet, off WP4.R):
  (GAP-2, code) live-stream×drift forks a new thread on honest append — fix stores concatenated live
  deltas as the affinity key when live text streamed; (GAP-1, doc) resolution-phase tenant 5xx surfaces
  404 not 502 (root: pre-existing shared `providers/model-catalog.ts`, out of scope) — fix corrects the
  user-guide error table rather than editing shared code; plus a facade-key wording correction (0600
  file, not "encrypted"). Sub-note (HOLDS-by-design): `include_usage:false` ignored (usage always emitted)
  — pre-blessed by research 04 §3. Wave-1 executors (1.3/1.4/1.5) + WP2.1 still running.

- 2026-07-16 — **WP2.1 DONE** · verdict PASS · gate green (typecheck all; api **1885/1885** incl. 5 new
  stream tests; web 947+5; Biome clean) · commit `0aeede1`, FF-merged into `feat/unified-sessions`
  (**@ 0aeede1** = WP1.1+1.2+1.6+2.1). SSE `id:<seq>` on every event; `Last-Event-ID` resume with a
  buffer-vs-DB cursor decision (in-memory bounded buffer when it covers the cursor, else reuse existing
  `RunRepository.getRun().events` for the gap), all funneled through one watermark'd `forward()` choke
  point → zero-loss/zero-dupe; `{type:"ping"}` every 15 s (no `id:`, can't advance cursor) replacing the
  comment keepalive; terminal+settled-rating close unchanged. **Diff = 2 files only** (`routes.ts` stream
  section + test); WP1.6's `/end`/`/seen`/`GET :id` handlers byte-verified untouched. No schema/repo/shared
  change. `setSseHeartbeatMsForTesting` test seam added.
- 2026-07-16 — Dispatched **WP2.2** (client watchdog + resume → `feat/unified-sessions-wp2.2`), Sonnet,
  off `feat/unified-sessions` @ 0aeede1. Ping-aware 45 s staleness watchdog (run + suite streams) +
  seq-dedupe belt-and-braces; keeps WP1.1's `ended` terminal classification in `use-run-stream.ts`.
  WP1.3/1.4/1.5 executors still running.

- 2026-07-16 — **WP1.5 DONE** · verdict PASS · gate green (typecheck all; api **1892**; web 947+5; build+lint
  clean) · commit `f95bb01` (only `vendor-assistant-executor.ts` + 3 tests). Deadline→`aborted` bug FIXED
  (opt-in wall cap → `terminalFor("max_duration")` → `stopped/stopped_guardrail`; `aborted` reserved for
  real user stop; `resolveEndCause()` checks abort BEFORE clock.fired). AE-4→`prompt_rejected`; 429/AE-6→
  `rate_limit` (added `httpStatus` to `VendorAssistantApiError`); other AE-x/thread/network→`provider_error`.
  `waiting_input` bracketing with 30-min `VENDOR_ASSISTANT_WAIT_BUDGET_MS`; capabilities via `withAssistantIdentity`
  (assistantId/transport→appId→version-from-Etag) through a new `onCapabilities` seam. Used a local **ref'd**
  time source (unref'd default can starve a bare-promise test). **Merge HELD.**
- 2026-07-16 — **WP1.4 DONE** · verdict PASS · gate green (typecheck all; api **1893**; web 947+5; build+lint
  clean) · commit `61a6ab0` (only `claude-subscription-executor.ts` + `subscription-concurrency.ts` +
  `config/env.ts` + tests). `SUBSCRIPTION_RUNS_MAX_CONCURRENCY`=2 via a decoupled `.runs` `AsyncSemaphore`
  (independent of the judge `.shared` gate — test-proven); `{phase:"queued",detail:{position}}` only when
  contended (uncontended = byte-identical to before) then `starting`; a `Termination` helper enforces
  verdict→recordDurations→`abort()` ordering (test-proven the terminal status is on the wire before the
  abort signal fires); `SUBSCRIPTION_SESSION_CAPABILITIES` via a `recordCapabilities` seam. Used a
  deterministic fake clock in the deadline test (unref'd timer starvation). **Merge HELD.**

### ⚠️ Wave-1 integration seam (both WP1.4 + WP1.5 flag it; WP1.5 also flags a contract gap)
The three executors expose DI seams but **`run-service.ts` (WP1.3-owned) + `index.ts` must be wired** to
actually persist for non-engine kinds, plus one contract refinement — to be closed in ONE coordinated
seam-close pass AFTER WP1.3 lands + the three executors merge, BEFORE WP1.R:
1. **Capabilities/duration persistence** — thread `runId` into `run-service.ts`'s subscription + vendor
   dispatch and wire `recordCapabilities`/`onCapabilities`→`RunRepository.setCapabilities` and emit-meta/
   `recordDurations`→`RunRepository.recordDurations`. Until then these seams are no-ops (D-US4 unmet for
   sub/vendor). (Engine path: confirm against WP1.3's report.)
2. **Subscription concurrency wiring** — `run-service.ts` `resolveClaudeSubscription()` `.shared`→`.runs`;
   `index.ts` `new SubscriptionConcurrencyPool(..., config.subscriptionRunsMaxConcurrency)` (3rd arg).
3. **Phase-clear contract gap** — the `{type:"phase"}` `RunEvent` can't carry a null phase, so `runs.phase`
   stays `waiting_input` after a wait resolves → the label table would show a stale "Waiting for you".
   Fix: widen shared phase event to `RunPhase | null` (additive; `RunRepository.setPhase` ALREADY accepts
   null), executors emit `{phase:null}` on `resumeFromWaiting`, RunManager persists it. WP1.R to confirm
   scope; likely folded into the seam-close.
4. **Timer ref/unref consistency** — `REAL_SESSION_CLOCK_TIME` unrefs timers; WP1.5 used a ref'd source in
   the executor, WP1.4 used a fake clock only in tests. WP1.R to check production consistency across the 3.

- 2026-07-16 — **WP1.3 DONE** · verdict PASS · gate green (api **1889**; web 947+5; build+lint clean) ·
  commit `3932996`, merged (cedf0d8). One `SessionClock` per run in `engine.ts` (stall 10 min; wall cap
  only if `maxRunDurationMs>0`); `emitNoted` rolls the stall timer on every event; `enterWaiting`/
  `resumeFromWaiting` bracket the interactive `nextTurn` AND the `ask_user` wait (same clock via new
  `EngineConfig.onSessionClockReady(clock, clockAbortSignal)`). Stop-verdict-before-signal confirmed.
  ENGINE `setCapabilities` wired in `run-service.ts` resolve(). **Real bug found+fixed:** an `ask_user`
  wait didn't race the clock-fire → threaded `clockAbort.signal` into `waitForAnswer` (run-service.ts,
  owned). **Contract gap flagged:** `maxToolCalls` meter has no `StopReasonCode` (resolves to
  `stopped_guardrail` w/o a machine code) → folded into WP1.7 Task D. Kept `DEFAULT_MAX_RUN_DURATION_MS`
  exported + widened `EngineEmit` backward-compatibly so WP1.4/1.5 compile untouched.
- 2026-07-16 — **WP2.2 DONE** · verdict PASS · gate green (api 1885; web **962**+5; lint clean) · commit
  `78ca64f`, FF-merged. Ping-aware 45 s watchdog (single re-armed `setTimeout`, reset by any message incl.
  the WP2.1 ping) → forced fresh `EventSource` + existing banner; never fires post-terminal (`terminalRef`
  + `clearWatchdog` on terminal); native EventSource auto-`Last-Event-ID` + unchanged `seq` dedupe belt-
  and-braces; same treatment on `use-suite-stream.ts`. Reused `RunConsole`/`SuiteRunConsole` existing
  drop banners (zero UI change). Kept WP1.1's `ended` terminal classification. **Flag → WP2.R:** the suite
  SSE route (`suites/routes.ts`) never got WP2.1's real-ping/`id:`; suite watchdog is message-aware only →
  a quiet-but-alive suite run false-reconnects (lossless churn). WP2.R to adjudicate blocker vs doc.
- 2026-07-16 — **Wave-1 executors + WP2.2 merged** → `feat/unified-sessions` **@ 697f66d**
  (WP1.1/1.2/1.3/1.4/1.5/1.6 + WP2.1/2.2). Three-way `ort` merge, zero conflicts; integration worktree
  installed + **base typecheck GREEN** (3-way merge integrates). Dispatched **WP1.7 seam-close**
  (`feat/unified-sessions-wp1.7`, Sonnet) — Task A capabilities/durations persistence for sub+vendor in
  run-service.ts; Task B subscription `.shared`→`.runs` + index.ts pool arg; Task C phase-clear
  (`phase: RunPhase|null` additive + executors emit `phase:null` on resume + RunManager persist);
  Task D `max_tool_calls` StopReasonCode. Must land BEFORE WP1.R. Also dispatched **WP2.R** (stream
  review, Opus, off known-green 78ca64f) — kill-the-socket + adjudicate the suite asymmetry.

- 2026-07-16 — **WP2.R DONE** · verdict PASS (run stream) · gate green (api **1888** incl. 3 server probes;
  web **969**+5 incl. 7 client probes; Biome clean) · commit `8b91189` (read-only review, off known-green
  78ca64f). **Run stream ALL HOLD:** real mid-drop cursor-resume exactly-once + gapless union; beyond-buffer
  DB replay gapless (`MAX_BUFFERED_EVENTS=2000`, persisted `seq` shares the `forward()` watermark);
  silent-dead socket → banner **≤45 s**; `ping` never advances cursor (server emits no `id:`, client
  dedupe no-op); no mid-stream/post-terminal false alarm. **Suite asymmetry VERDICT: acceptable-with-doc
  (reconnect proven lossless) but RECOMMENDED ~5-line fix** → **WP2.3**: add `{type:"ping"}` to `SuiteRunEvent`
  (shared) + `writeEvent(reply,{type:"ping"})` on the suite heartbeat (suites/routes.ts); cursor-resume for
  suites is nice-to-have only. Sequenced AFTER WP1.7 (both edit `packages/shared` — no parallel shared edits).
  Pre-existing out-of-scope note: the async persistence sink's `catch(()=>undefined)` could drop an evicted
  event from both buffer+DB (persistence-reliability, not a resume defect) — logged for the owner.

- 2026-07-16 — **WP1.7 DONE** · verdict PASS · gate green (shared 22; api **1924**; web 962+5) · commit
  `097845c`, FF-merged → `feat/unified-sessions` **@ 097845c** (fully-wired Wave 1 + Wave 2 stream).
  **Task A:** run-service.ts binds `recordCapabilities`/`recordDurations` (sub) + `onCapabilities` + emit-meta
  forwarding (vendor) → GET /:id returns capabilities+durations for all 3 kinds. **Found+fixed a real bug:**
  `finalize()` clobbered subscription `recordDurations` to NULL (terminal emit carries no meta) → `COALESCE`
  in the UPDATE. **Task B:** subscription concurrency `.shared`→`.runs` + `index.ts` pool 3rd arg. **Task C:**
  phase widened to `RunPhase|null` (additive; setPhase already accepted null); executors emit `{phase:null}`
  on resume — **caught a real bug:** subscription must clear UNCONDITIONALLY in `finally` (else stuck at
  `waiting_input` on wait_expired/user_stop); vendor clears only when not aborted (always emits `stopping`).
  **Task D:** `max_tool_calls` added (STOP_REASON_CODES 14→15, terminalFor table + test). 
- 2026-07-16 — Dispatched **WP1.R** (Wave-1 adversarial review → `feat/unified-sessions-wp1.R`, Opus, off
  097845c) — REFUTE same-cause→same-triple (cause×executor matrix), event-log/phase coherence, old-run
  replay, grading/`ended` semantics, capabilities+durations persistence; + adjudicate the error-forensics
  `ended` gap, timer ref/unref consistency, user_stop suppression. And **WP2.3** (suite ping →
  `feat/unified-sessions-wp2.3`, Sonnet, off 097845c) — additive `{type:"ping"}` SuiteRunEvent + suite
  heartbeat writeEvent. Both parallel off the same base (WP2.3 shared edit additive vs WP1.R read-only).

- 2026-07-16 — **WP2.3 DONE** · verdict PASS · gate+build green (shared 25; api 1926; web 964+5;
  `pnpm -r --workspace-concurrency=1 build` green; Biome clean) · commit `d39a9a6`, FF-merged → feat @
  `d39a9a6`. **Wave 2 COMPLETE.** Additive `{type:"ping"}` on `SuiteRunEvent` + new `suiteRunEventSchema`;
  suite heartbeat → real `writeEvent(reply,{type:"ping"})` (no `id:`); client `case "ping": return state`
  no-op + stale "asymmetry" doc comments rewritten. **Two carry-forwards for WP5.1:** (1) `main` has moved
  to `01d27dd` (concurrent owner session) while feat is based on `bef1849` → reconcile the divergence at
  integration; (2) pre-existing literal NUL byte in `use-suite-stream.ts:281` JSDoc (from base, not WP2.3)
  makes git treat the file as binary — benign (gate green) but should be cleaned at WP5.1.

- 2026-07-16 — **WP1.R DONE** · verdict PASS-with-findings · commit `971e9fe` (read-only + a 43-test
  review file: 40 pass + 3 CONFIRMED-defect probes). **Invariant 1 (same cause → same triple) HOLDS** —
  full cause×executor matrix verified, no divergent hand-rolled terminal. Inv 3 (backward compat), Inv 4
  (grading/`ended`/new causes gradeable, byte-identity), Inv 5 (capabilities+durations per kind, COALESCE
  re-verified) all HOLD. All 3 flagged items NON-ISSUE/HOLDS (error-forensics `ended`=correct-by-design;
  timer ref/unref=consistent+correct [vendor ref'd by design, engine/sub unref'd, all cancel on stop];
  user_stop suppression holds). **Inv 2 (phase coherence): 3 CONFIRMED defects → dispatched WP1.fix**
  (`feat/unified-sessions-wp1.fix`, Sonnet): **B2 HIGH** — stopping a *queued* subscription run emits
  `aborted` before `running` → trailing `running` overwrites → persisted `status='running'` orphan (fix:
  emit `running` before the abort check); **B1/B3 MEDIUM** — terminal runs leave `runs.phase` stuck
  (engine/vendor `stopping`; `/end` `waiting_input`) — `finalize()` never clears phase (fix: `phase=NULL` in
  the terminal UPDATE, resolves both). WP1.fix imports WP1.R's tests + flips B1/B2/B3 to passing regression
  guards. Minor non-defects noted: unpriced-cost-cap rejection emits `error/error` w/o stopReasonCode
  (consistent across executors); vendor `resolveEndCause` natural-null path defended-by-contract.
- 2026-07-16 — **Wave 3 (console) fan-out** (contract verified stable by WP1.R → safe to build in parallel
  with WP1.fix; disjoint web files): **WP3.1** status module (locked label table → `-wp3.1`), **WP3.2**
  capability-driven console (declarative KPI tiles + gating, remove providerKind forks → `-wp3.2`),
  **WP3.4** settings & launcher (effective-limits summary + guardrail fields, web-only, backend gaps
  FLAGGED not built → `-wp3.4`), all Sonnet off `feat/unified-sessions` @ d39a9a6. WP3.3 (affordances)
  waits on 3.1/3.2/3.4 (owns RunBar actions + ConversationPane composer + RunsView sections — seams);
  WP3.R (visual+adversarial, both themes, seeded runs) last.

- 2026-07-16 — **WP1.fix DONE** · verdict PASS · gate+build+lint green (api **1969**; web 964+5) · commit
  `fcaf9c7`, FF-merged → `feat/unified-sessions` **@ fcaf9c7**. B2: subscription emits `running`(+caps+phase:null)
  BEFORE the abort check (queued-then-stopped → `running`→`aborted`, no orphan). B1/B3: `finalize()` sets
  `phase=NULL` on every terminal UPDATE (central clear across all executors + `/end`); executors' mid-run
  resume `{phase:null}` kept. All 43 WP1.R tests pass as **permanent regression guards** (cause×executor
  matrix now locked on the branch). **✅ WAVE 1 COMPLETE + adversarially verified.**

- 2026-07-16 — **WP3.4 DONE** · verdict PASS · gate green (api 1926; web **973**+5; Biome clean) · commit
  `df7b4f8`, merged `--no-ff` → feat **@ 41091ef**. Launcher **effective-limits summary** (stall 10m / wait
  10m|30m-by-kind / wall cap per-env `maxRunDurationMs` / subscription concurrency); EnvironmentEditor wall-cap
  field (fixed a stale "30 min default" placeholder → "No cap" per D-US3); Settings → Testing informational
  card. Stayed in 3 web files; touched no backend. **D-US7 EDITABILITY GAP (owner escalation → WP3.5):** full
  per-environment stall/wait override + editable global defaults need (1) additive `GuardrailConfig.stallMs`/
  `waitBudgetMs` + `run-service.ts` populating `sessionClockOptions` from them; (2) a settings read/write API
  (+ persistence store/migration) for global defaults + `SUBSCRIPTION_RUNS_MAX_CONCURRENCY`. A new persistent
  settings table is a design decision for the owner — NOT autonomously built. Core D-US7 (defaults applied,
  wall cap editable, effective limits shown) works today.

- 2026-07-16 — **WP3.1 DONE** (`e7dbc07`, merged `e11d4a8`) + **WP3.2 DONE** (`05e8e5b`, merged `acb55d1`).
  WP3.1: single `deriveRunStatusView` (all 15 codes/phases/ratingState, cross-checked vs `terminalFor`),
  `guardrailFromReason` removed, console surfaces adopt one `StatusBadge`. WP3.2: declarative KPI tiles from
  `capabilities`, all `providerKind` forks removed (only pre-run/pre-contract `fallbackCapabilities` left),
  panes gate on capabilities. Merged Wave-3 trio (3.1/3.2/3.4) **base typechecks green** @ `acb55d1`.
  **Owner-acceptance flag (WP3.2):** vendor now shows *estimated* token tiles (marked) instead of hiding them
  (Phase-5 UX) — self-consistent with the locked manifest (vendor `tokens:"estimated"`, `contextWindow:false`
  keeps context hidden); one-line revert (`tokens:"none"`) if the owner prefers hidden. **WP3.R adjudicates:**
  WP3.1 left 8 out-of-fence, test-locked surfaces (RunTableRow/CompareBar/FlowLanes/TestGroupRow/SkillUsageTab/
  SkillTraceView/ReportTab/compare-runs) + StepLog on the legacy `@brand/ui` closed-enum bridge — decide if
  app-wide D-US5 conformance is in-scope (→ WP3.6 sweep) or acceptable.
- 2026-07-16 — Dispatched **WP3.3** (session affordances → `feat/unified-sessions-wp3.3`, Sonnet, off
  `acb55d1`) — End-session (`/end`+confirm), live phase chips (Queued/Waiting/Stopping via extending
  `use-run-stream.ts` to surface phase+stopReasonCode + a minimal RunConsole forwarding seam), needs-attention
  feed section + seen-on-open (`/seen`), user-stop toast suppression, active-vs-total duration, wall-cap
  countdown from `deadlineAt`, D-US11 naming. Last Wave-3 impl WP → then WP3.R.

- 2026-07-16 — **WP3.3 DONE** · verdict PASS · gate+build+lint green (api **1969**; web **1060**+5; 68 new
  tests) · commit `bbf7b8e`, FF-merged → feat **@ bbf7b8e**. `use-run-stream.ts` surfaces `phase`/
  `queuePosition`/`phaseDeadlineAt`/`stopReasonCode` (null phase clears; ping no-op) + a `suppressFinishToast`
  predicate; minimal RunConsole forwarding to RunBar/ConversationPane. End-session (`EndSessionControl` →
  `endRun` + AlertDialog confirm, 409 surfaces server reason); needs-attention (`pendingInput || (unseen &&
  !running)` in `runs/needs-attention.ts` + `NeedsAttentionSection`) with seen-on-open at the single RunConsole
  mount choke point; finish-toast suppressed on user-initiated stop; server-authored `deadlineAt` countdown
  (display-only); D-US11 naming forks on `identity.mode`. Interpretation flag: active/total duration sourced
  from RunSummary/RunDetail (replay getRun), shown in RunBar (replay) + needs-attention rows. **✅ ALL WAVE-3
  IMPLEMENTATION DONE.**
- 2026-07-16 — Dispatched **WP3.R** (Wave-3 visual+adversarial review → `feat/unified-sessions-wp3.R`, Opus,
  off `bbf7b8e`) — reusable seed harness (kind×state, 08-rework pattern, no provider key), label-table
  conformance sweep + adjudicate the 8-surface D-US5 gap + the vendor est-token-tiles question, e2e smoke
  extension (needs-attention / End-session / watchdog banner), best-effort both-theme rendered pass (else
  code-level + owner-acceptance). Gates Wave 3 → then Wave 5 (WP5.1 integration).

- 2026-07-16 — **WP3.R DONE** · verdict PASS-with-findings · gate+build+e2e green (api **1973**; web 1060+5;
  4/4 e2e headless) · commit `89cb589`, FF-merged → feat **@ 89cb589**. **Reusable seed harness**
  (`apps/api/test/support/session-seed-grid.ts` + script `pnpm --filter @mcp-token-footprint/api seed:sessions`)
  → **42/42 grid (3 kinds × 14 states) PASS** identical label+tone via real `GET /:id`→`deriveRunStatusView`;
  **both-theme rendered sweep clean** (real headless screenshots, no contrast/token issues); e2e extended
  (needs-attention / ended chip / End-session confirm / reconnect banner). **vendor est-token-tiles: KEEP**
  (capability-correct, honestly marked; show/hide is owner UX preference but recommend keep). **2 defects →
  dispatched WP1.fix… → WP3.fix** (`feat/unified-sessions-wp3.fix`, Sonnet): (1) **MEDIUM** `ended` missing
  from 3 console terminal checks (RunConsole:1207, RunConsoleRoute:323, AnalyticsPanel:114) → ended session
  opens in LIVE shell not replay — add `ended` + dedupe into a shared `isTerminalRunStatus`; (2) **D-US5
  sweep (WP3.6, IN-SCOPE)** — consolidate the legacy `runStatusBadgeView` bridge onto `deriveRunStatusView`
  + swap 7 in-scope run-status surfaces (RunTableRow HIGH, CompareBar, compare-runs, FlowLanes, SkillUsageTab,
  SkillTraceView, SuiteTableRows member rows), EXCLUDE ReportTab(grade)/StepLog(step)/suite-rollup(aggregate);
  keep STATUS_FACETS filter values.

- 2026-07-16 — **Main-divergence assessment (for WP5.1):** `main` @ `01d27dd`→`a57aabe` (concurrent owner
  session) diverged from the feat base `bef1849` by **DOCS ONLY** — `git diff bef1849..main` touches zero
  `apps/`/`packages/` code; it added the unified-sessions plan docs (README/execution-plan/kickoff/**STATUS.md
  now tracked**), the `roadmap/observability/**` WP docs, and `user-guide/*` assets. **feat→main is therefore
  CODE-CLEAN** (no code overlap). Reconciliation is docs-only: WP5.1 merges `main` into feat (brings the docs
  in cleanly — feat tracks none of them) and consolidates STATUS.md (this living ledger is authoritative;
  main's committed a57aabe STATUS is an earlier/parallel snapshot). The facade lane's `index.ts` is untouched
  by WP4.1/4.2, so the facade mount is an additive edit atop feat's WP1.6/WP1.7 index.ts changes — no conflict.

- 2026-07-16 — WP3.fix hit a transient **API 529 (overload)** and terminated mid-task with all 16 files of
  work uncommitted-but-intact in its worktree (both Part A + Part B + the 7 surface swaps done; was finalizing
  tests). **Resumed from transcript** — no work lost, no restart needed. Awaiting its gate+commit+report.

- 2026-07-16 — **WP5.1 DONE** · verdict PASS · FULL gate green (typecheck; API **2040** incl. 3 new mount
  tests + WP3.R conformance; web 1068+5; `-r --workspace-concurrency=1 build` green 22.3s; Biome clean 857
  files) · commit `dc43ff8`. (Resumed once after a transient API 529 — no work lost.) **Facade mounted:**
  `apps/api/src/index.ts` → `await registerOpenAiFacade(server, buildFacadeDeps({providerRepository, providers,
  dataDirectory, explicitKey: OPENAI_FACADE_KEY}))`; new `openai-facade/deps.ts` wires `facadeKey`
  (loadOrMintFacadeKey 0600), `listModels` (aggregates `ProviderService.listModels` over vendor_assistant creds,
  broken creds skipped), `resolveModel` (finds the cred whose roster lists the model → `getDecrypted`
  `{apiKey,baseUrl}`, same path as `RunService.resolveAnswers`, never re-exposed). Boot test (`openai-facade-mount.test.ts`,
  3 cases): `/openai/v1/models`→200 empty w/ no cred, 401 on bad key (key not leaked), 200 lists a seeded
  cred's assistant via STUBBED fetch (no real tenant). **NUL cleanup:** found **4** NULs (1 JSDoc + **3 in
  the runtime `cellKey` template**) → all converted to `\x00` escapes, byte-identical at runtime; blob now
  0 NULs. CHANGELOG entry added. **Seeded acceptance:** 42-row grid (3 kinds × 14 states) re-derived, conformance green.
- 2026-07-16 — **INTEGRATION MERGE TRAIN COMPLETE** → `feat/unified-sessions` **@ 61f8b9b**. WP5.1 FF-merged;
  **facade lane** (WP4.1–4.fix, 16 NEW files) merged clean; **docs-only `main` (01d27dd/a57aabe) folded in** —
  feat is now a **superset of main** (feat→main is a fast-forward for the owner). Combined base builds + all
  gates green. This STATUS ledger (authoritative, 385 lines) supersedes main's earlier committed snapshot
  (333 lines). **✅ ALL CODE COMPLETE.** Remaining: WP5.2 docs (user-guide 09/10/11 + research cross-links).

- 2026-07-16 — **WORKSTREAM COMPLETE** — **WP5.2 DONE** · user-guide updates (09-testing + 10-comparing-runs
  + 11-vendor-assistant) detailing the new session model, capability manifest, timers, and OpenAI-endpoint link;
  research cross-link added to `research/unified-run-sessions/README.md` pointing to the authoritative
  STATUS.md ledger; STATUS finalized with WP5.1+WP5.2 ticked. All WPs (Waves 1–5 + facade lane 4.1–4.fix +
  review-driven fixes WP1.fix/WP3.fix/WP4.fix/WP2.3/WP1.7) are done; gates green throughout (`feat/unified-sessions`
  @ `61f8b9b`, full gate+build+seeded-acceptance passed, feat is a superset of main). Owner-acceptance items remain:
  D-US7 full stall/wait editability (WP3.5 follow-up); WP3.2 vendor estimated-token tiles (WP3.R recommends keep);
  D-US14 live-provider-key acceptance walk incl. facade against a real the vendor cloud tenant.

## Blockers

*(Waves 1+2+3 COMPLETE+reviewed; facade lane COMPLETE+mounted; WP5.1 integration DONE (feat @ 61f8b9b,
full gate+build green, feat is a superset of main). WP5.2 (docs) is the only remaining WP.
 Main divergence = DOCS-ONLY, feat→main code-clean (assessed). OWNER escalations:
D-US7 editability (WP3.5); WP3.2 vendor est-tokens (WP3.R: KEEP). WP5.1: facade mount + docs reconcile + NUL
cleanup + full build + seed acceptance. No hard blockers.)*
