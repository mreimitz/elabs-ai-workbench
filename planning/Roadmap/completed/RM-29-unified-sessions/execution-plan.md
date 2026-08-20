---
type: "Work Package Spec"
title: "Unified Sessions \u2014 execution plan (orchestrator + subagents)"
description: "This plan is written to be executed by an orchestrator session driving multiple subagents in"
tags: ["roadmap", "RM-29"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# Unified Sessions — execution plan (orchestrator + subagents)

This plan is written to be executed by an **orchestrator session driving multiple subagents in
parallel worktrees**. Every work package (WP) declares: goal, owned files (exclusive — the
conflict-avoidance contract), dependencies, agent profile + **model tier** (D-US13), gate, and
acceptance. The orchestrator's own protocol is §4. Decisions D-US1…15 (README) are fixed input —
a WP that thinks a decision is wrong STOPS and writes a blocker to STATUS.md instead of improvising.

Context every agent gets: `research/unified-run-sessions/00…04`, this folder's README, `CLAUDE.md`
+ `.claude/rules/*`. Gate per WP: `corepack pnpm@9.15.4` → `pnpm typecheck && pnpm test`
(+ `pnpm build` at integration only — parallel builds OOM).

---

## 1. Contract reference (what Wave 1 defines, later waves consume)

**stopReasonCode** (closed union, additive to events + `runs.stop_reason_code`):
`user_stop · session_ended · max_duration · stalled · wait_expired · max_turns · max_tokens ·
max_context_tokens · max_cost · context_overflow · prompt_rejected · provider_error · auth ·
rate_limit`. Human `stopReason` text stays alongside.

**terminalFor(cause) → {status, outcome, stopReasonCode}** (single table, all executors):

| cause | status/outcome | code |
|---|---|---|
| user stop | `aborted`/`aborted` | `user_stop` |
| End session (interactive) | **`ended`/`ended`** (new additive members) | `session_ended` |
| wall cap (opt-in) | `stopped`/`stopped_guardrail` | `max_duration` |
| stall detector | `stopped`/`stopped_guardrail` | `stalled` |
| wait budget exhausted | `stopped`/`stopped_guardrail` | `wait_expired` |
| budget meters | `stopped`/`stopped_guardrail` | `max_turns` etc. |
| context overflow | `stopped`/`context_overflow` | `context_overflow` |
| the vendor AE-4 | `stopped`/`stopped_guardrail` | `prompt_rejected` |
| provider/transport/auth/429 | `error`/`error` | `provider_error`/`auth`/`rate_limit` |

**phase** (queryable `runs.phase` + `{type:"phase"}` event): `queued (detail: position) · starting ·
waiting_input (detail: next_turn | question) · stopping`. Running/terminal remain statuses.
**Stop ordering (steal from cdesktop):** write the terminal verdict/`stopping` phase BEFORE
signaling the child/stream, so an exit can never be reclassified.

**SessionCapabilities** (zod, persisted `capabilities_json`, emitted at start): `liveText`,
`liveReasoning: none|raw|structured`, `toolCalls`, `contextWindow`, `tokens: exact|estimated|none`,
`costBasis: api_exact|subscription_reference|questions|none`, `followUps`, `askUser`,
`waitBudgetMs?`, `identity?` (vendor assistant card). Declared statically per adapter; runtime
verification may downgrade (record in STATUS if it ever does).

**Clock (D-US3/D-US7):** `SessionClock` owns: stall timer (rolled by every emitted event; default
10 min), wait budget (armed in `waiting_input`; default 10 min; per-kind override — the vendor default
30 min), optional wall cap (off by default; from env guardrail), pause accounting
(`activeDurationMs` excludes waiting), per-transition timestamps.

**Status/label table (D-US5, locked):**

| state (derivation input) | label | tone |
|---|---|---|
| `pending` + phase `queued` | Queued *(+ position)* | gray dashed |
| `pending` (no phase) | Pending | gray dashed |
| `running` | Running | blue + spinner |
| `running` + `waiting_input` | Waiting for you | blue outline, no spinner |
| `running` + `stopping` | Stopping… | gray + spinner |
| terminal + rating pending | Reviewing… | blue + spinner |
| `completed` | Completed | green outline |
| `ended` | Ended | green outline |
| `stopped` + `max_*`/`stalled` | Stopped — time limit / turn limit / … / stalled | amber outline |
| `stopped` + `wait_expired` | Expired | gray outline |
| `stopped` + `prompt_rejected` | Rejected by assistant | amber outline |
| `context_overflow` | Context overflow | amber outline |
| `aborted` | Stopped by you | gray outline |
| `error` | Failed | red filled |
| `assertions_failed` | Assertions failed | amber outline |

---

## 2. Work packages

Effort: S ≤ half day · M ≈ 1 day · L > 1 day (agent-time, incl. tests).

### Wave 1 — Contract & clock (apps/api + packages/shared)

**WP1.1 — Contract module** · agent: implementer · model: **Opus-class** · effort M · deps: —
Owns: `packages/shared/src/{constants,types,schemas}.ts` (additive only), NEW
`apps/api/src/testing/session-terminal.ts`, NEW `apps/api/src/testing/session-capabilities.ts`.
Adds the §1 contract: `stopReasonCode` + phase unions, `ended` status/outcome members, `phase`/
`ping` RunEvent members, capabilities schema, `terminalFor()` + exhaustive table test. Old
persisted events must still parse (backward-compat zod test). *This WP defines names everyone
else imports — highest-blast-radius, hence Opus + extra care on naming.*

**WP1.2 — SessionClock** · implementer · **Sonnet-class** · M · deps: WP1.1
Owns: NEW `apps/api/src/testing/session-clock.ts` (+ tests). Stall/wait/cap timers, pause
accounting, absolute deadline timestamps in emitted phase detail (server-authored countdowns),
fake-timer unit tests for every transition incl. stall-roll-on-event and pause-in-waiting.

**WP1.3 — Engine adoption** · implementer · **Sonnet-class** · L · deps: WP1.2
Owns: `apps/api/src/testing/engine.ts`, `run-service.ts` (engine-path sections), `guardrails.ts`,
`ask-user-tool.ts`. Replace deadline/idle logic with SessionClock; emit `waiting_input` around
`nextTurn` AND ask-user waits (wait budget applies to both); all terminals via `terminalFor`;
capabilities emitted+persisted for api kinds; durations recorded. Regression: existing engine
tests stay green; new lifecycle tests.

**WP1.4 — Subscription adoption** · implementer · **Sonnet-class** · M · deps: WP1.2
Owns: `claude-subscription-executor.ts`, `subscription-concurrency.ts`, `config/env.ts` (one
setting). `queued` phase (with position) BEFORE `gate.acquire()`; new
`SUBSCRIPTION_RUNS_MAX_CONCURRENCY` (decoupled from the judge gate, D-US6); SessionClock;
`terminalFor`; stop-verdict-before-kill ordering; capabilities (`liveReasoning:"none"`,
`tokens:"exact"`, `costBasis:"subscription_reference"`, `contextWindow:false`).

**WP1.5 — the vendor adoption** · implementer · **Sonnet-class** · M · deps: WP1.2
Owns: `vendor-assistant-executor.ts`. Fixes the deadline→`aborted` bug via `terminalFor`
(`max_duration` → guardrail stop), AE-4 → `prompt_rejected`; SessionClock with 30-min wait
default; `waiting_input` on interactive turns; capabilities (`toolCalls:false`,
`tokens:"estimated"`, `costBasis:"questions"`, `liveReasoning:"structured"`, `identity`).

**WP1.6 — Persistence & API surface** · implementer · **Sonnet-class** · M · deps: WP1.1 (parallel to 1.2–1.5)
Owns: `apps/api/src/db/*`, `testing/run-repository.ts`, `testing/routes.ts`, `testing/run-manager.ts`,
`suites/orchestrator.ts` (passthrough only). Additive columns: `phase`, `stop_reason_code`,
`ended_at`, `seen`, `capabilities_json`, `active_duration_ms`, `total_duration_ms` (ensureColumn
migration, NULL-safe for old rows). `GET /api/runs/:id` returns `phase`, `openQuestions`,
`capabilities`, durations. NEW `POST /api/runs/:id/end` (End session → terminalFor(session_ended);
409 on non-interactive/terminal) and `POST /api/runs/:id/seen`. RunManager: `ended` joins the
terminal set; suppress-notification flag for user-initiated stops.

**WP1.R — Wave-1 adversarial review** · reviewer · **Opus-class** · M · deps: WP1.3–1.6
Read-only + test-authoring. Tries to REFUTE: (1) the invariant *same cause → identical terminal
triple on all three executors* (writes the cause×executor matrix test if missing); (2) event-log
coherence — a run's full state must be reconstructible from its event log alone (AG-UI rule);
(3) old-run replay unchanged; (4) suite/grading semantics unaffected (guardrail stops still
gradeable, byte-identity untouched). Files bugs as STATUS blockers; fixes go back to the owning WP.

### Wave 2 — Stream robustness (small; starts after WP1.1)

**WP2.1 — Server cursor resume + ping** · implementer · **Sonnet-class** · M · deps: WP1.1
Owns: `testing/routes.ts` (stream section — coordinate: WP1.6 owns the rest of routes; orchestrator
sequences 1.6 → 2.1). SSE `id: <seq>`; parse `Last-Event-ID` → replay from cursor (in-memory
buffer when covered, DB `run_events` otherwise); `{type:"ping"}` every 15 s replacing the comment
keepalive; close semantics unchanged (terminal + settled rating).

**WP2.2 — Client watchdog + resume** · implementer · **Sonnet-class** · M · deps: WP2.1
Owns: `apps/web/src/features/testing/use-run-stream.ts`, `suites/use-suite-stream.ts`,
`lib/api.ts` (stream fns). 45 s staleness watchdog (ping-aware) → proactive reconnect + existing
banner; native EventSource auto-sends Last-Event-ID once `id:` exists — keep the `seq` guard as
belt-and-braces; suite stream gets the same treatment.

**WP2.R — Stream review** · reviewer · **Opus-class** · S · deps: WP2.2
Kill-the-socket tests: mid-run drop → resume from cursor with zero loss/dupes; late join beyond
2000-event buffer gets full history; silent-dead socket surfaces the banner ≤ 60 s.

### Wave 3 — One console (apps/web; after Wave 1 merges; 3.1–3.4 parallel worktrees)

**WP3.1 — Status module** · implementer · **Sonnet-class** · M
Owns: `lib/status.ts`, `components/StatusBadge.tsx`, `features/testing/RunBar.tsx`,
`StepLog.tsx` (badge call sites), `suites/SuiteRunConsole.tsx` (badge mapping), `RunsView.tsx`
(status cells). Implement the locked §1 label table as ONE derivation
`(status, outcome, stopReasonCode, phase, ratingState) → {label, tone, spinner}`; every surface
adopts it; the dead app-local StatusBadge path is deleted or becomes the single renderer;
`guardrailFromReason` string-sniffing removed (reads `stopReasonCode`).

**WP3.2 — Capability-driven console** · implementer · **Sonnet-class** · L
Owns: `KpiRail.tsx`, `RunConsole.tsx` (gating sections), `ConversationPane.tsx` (gating only),
`QuestionPrompt.tsx`, `RunConsoleRoute.tsx`. Declarative KPI tile list from `capabilities`
(context tile iff `contextWindow`; token tiles est.-marked/hidden; cost tile unit-aware: `$` /
`$ est. · subscription` / `N questions`; identity card iff `identity`); ContextChart/composer/
QuestionPrompt gate on capabilities; `providerKind` forks removed (credential-derived kind stays
ONLY as fallback for pre-contract runs without `capabilities_json`).

**WP3.3 — Session affordances** · implementer · **Sonnet-class** · L
Owns: `ConversationPane.tsx` (composer area), `RunBar.tsx` (actions — after 3.1 merges; orchestrator
sequences 3.1 → 3.3 on this file), `RunsView.tsx` (sections), new small components. End-session
button (→ `/end`, confirm dialog); Waiting-for-you + Queued (position) chips; needs-attention
section in the runs feed (`pendingInput || (unseen && !running)`) + seen marking on open;
finish-toast suppressed for `user_stop`; active vs total duration display; wall-cap countdown from
server-authored deadline when set; D-US11 naming pass (sessions vs runs copy).

**WP3.4 — Settings & launcher** · implementer · **Sonnet-class** · M
Owns: `features/settings/SettingsView.tsx` (new Testing card), `features/testing/EnvironmentEditor.tsx`
(guardrail fields incl. wait budget + stall), `run-launcher/RunLauncher.tsx` (effective-limits
summary line). Settings → Testing: stall/wait defaults, subscription concurrency; env overrides;
launcher shows the run's effective limits before start.

**WP3.R — Wave-3 review (visual + adversarial)** · reviewer · **Opus-class** · L · deps: 3.1–3.4
Seeds one realistic run per backend kind in each new state (`queued`, `waiting_input`, `ended`,
`stalled`, `wait_expired`, `prompt_rejected`, plus legacy terminals) through the REAL engine +
persistence (08-rework verification pattern); opens each in the app in **both themes**; label-table
conformance sweep (no surface renders off-table strings); extends `e2e/smoke.spec.ts` (runs feed
sections, End session, watchdog banner). Screenshots into STATUS.

### Wave 4 — OpenAI facade (parallel lane from day one; NEW files only)

**WP4.1 — Facade core** · implementer · **Opus-class** · L · deps: — (coordinates route mounting
with WP1.6 via one `index.ts` line at merge)
Owns: NEW `apps/api/src/openai-facade/**` (routes, translator, affinity-cache, auth, mapping),
NEW test files. `/openai/v1/chat/completions` + `/openai/v1/models` per research 04 §3: hold-back
streaming default (reasoning_content + reasoning mirrored live; settled extracted answer as final
content), thread-affinity cache (hash of prior messages → threadId; LRU+TTL), vendor fields
(`vendor_assistant{…}`, `citations`), minted local facade key (mcp-secret pattern), error mapping
(AE-4→`content_filter` finish, AE-6/429→429+Retry-After, unresolvable app→404 model_not_found),
usage chunk always emitted (BPE estimates + `estimated` marker in vendor field). Golden tests:
byte-identical answer text vs the executor's extraction over the same stub fixtures; stub fetch
only (never a real tenant — repo invariant).

**WP4.2 — Facade hardening + docs** · implementer · **Sonnet-class** · M · deps: WP4.1
Owns: facade folder + NEW `user-guide/15-openai-endpoint.md`. Facade-side concurrency cap,
live-stream config flag, in-process AI-SDK smoke test (`createOpenAICompatible` → local facade:
reasoning parts arrive, usage arrives, metadataExtractor sees vendor fields), user-guide page.

**WP4.R — Facade review** · reviewer · **Opus-class** · M · deps: WP4.2
Protocol-conformance checklist from research 04 sources (chunk shape, [DONE], include_usage
final-chunk semantics, error envelope, models shape); adversarial: affinity fork (edited history →
new thread, documented amnesia), hold-back vs settled drift, key never logged/forwarded.

### Wave 5 — Integration & docs

**WP5.1 — Integration** · integrator · **Sonnet-class** · M · deps: all waves
Merge train onto `feat/unified-sessions` (1 → 2 → 3 → 4), resolve seams (routes/index mounting),
full gate incl. `pnpm build`, CHANGELOG entry, re-run WP3.R seed script as final acceptance.

**WP5.2 — Docs & bookkeeping** · docs · **Haiku-class** · S · deps: WP5.1
`user-guide/09-testing.md`, `10-comparing-runs.md`, `11-vendor-assistant.md` updates (new states,
timers, sessions-vs-runs naming); research package cross-links (02 decisions table already
present, add "implemented in" pointers); STATUS.md final.

---

## 3. Dependency graph & parallel groups

```
WP1.1 ──┬── WP1.2 ──┬── WP1.3 ──┐
        │           ├── WP1.4 ──┤
        │           └── WP1.5 ──┼── WP1.R ── [Wave 3: 3.1 ∥ 3.2 ∥ 3.4] ── 3.3 ── WP3.R ─┐
        ├── WP1.6 (∥ 1.2–1.5) ──┘                                                       ├─ WP5.1 ── WP5.2
        └── WP2.1 ── WP2.2 ── WP2.R ────────────────────────────────────────────────────┤
WP4.1 ── WP4.2 ── WP4.R  (independent lane, day one) ───────────────────────────────────┘
```

Max useful parallelism: 4 implementation agents + the facade lane. File-ownership above is the
contract — two WPs never own the same file; the three deliberate seams (routes.ts 1.6→2.1,
RunBar.tsx 3.1→3.3, facade mount at 5.1) are sequenced by the orchestrator.

## 4. Orchestrator protocol

1. **One orchestrator session per wave** (or one long session, wave-by-wave). Before each wave:
   read STATUS.md, confirm upstream WPs merged, spawn the wave's WPs as parallel subagents in
   **isolated worktrees** off `feat/unified-sessions`.
2. **Per-WP kickoff prompt** (template): *goal + the WP text above verbatim; the D-US table; owned
   files (exclusive); required reading (research docs relevant to the WP, CLAUDE.md, .claude/rules);
   model tag; the gate; "additive-only on shared/db; grading byte-identity untouched; if a locked
   decision seems wrong, STOP and write a STATUS blocker — do not improvise".*
3. **Model assignment** (D-US13): as tagged per WP. If the tagged tier is unavailable, step DOWN
   for implementation WPs, never for review WPs (reviews wait).
4. **Reviews** (D-US14): every wave ends with its WP*.R reviewer agent, prompted to REFUTE the
   wave's invariant, not to summarize. Findings → STATUS blockers → fixed by the owning WP's agent
   (respawn with the finding) → reviewer re-verifies. A wave merges only after its review passes.
5. **STATUS.md upkeep**: after every WP completes (or blocks), a **Haiku-class** bookkeeping agent
   appends: WP id, verdict, gate result, files touched, blockers, next. Never edit history.
6. **Escalation to the owner**: only for (a) a locked decision proven wrong by evidence, (b) a
   file-ownership conflict the plan didn't foresee, (c) live-tenant verification wishes (the vendor/
   facade against a real tenant is OUT of agent scope — stub-only, per repo invariant).
7. **Merge discipline**: WP branch → wave integration branch → `feat/unified-sessions` after the
   wave review; `pnpm build` once per wave integration, not per WP.
