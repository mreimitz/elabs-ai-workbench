# Qlik Answers as a test target · **PRIORITY: HIGH**

Owner directive (2026-07-11): treat a **Qlik Answers assistant like a model** — send test prompts
against it through the existing Testing engine and measure/validate/monitor it like a normal LLM
session — while **guaranteeing such runs never attach MCP servers or skills**. When a user
registers an MCP server on a Qlik Cloud tenant, the app detects it, probes (for free) whether the
assistants API is reachable, and offers one-click setup of Qlik Answers as a runnable test target.

Living state: [`STATUS.md`](./STATUS.md) (driven by `/next-wp qlik-answers`). Research +
API ground truth: [`../research/qlik-answers-as-model.md`](../research/qlik-answers-as-model.md)
(endpoint shapes, the two × two execution modes, error family, metering — all decisions below
were made against it). Builds on the testing-ia one-engine model (D-T3) and the Benchmarks/
Auto-Rating grading stack.

## What we're building

1. **A new provider kind `qlik_answers`** whose "models" are the tenant's assistants
   (`GET /api/v1/assistants` → model roster). Environments bind provider+model as today, so the
   launcher, suites, Runs feed, replay, reports, grading, and Compare need no structural change.
2. **A second run executor** (`apps/api/src/testing/qlik-answers-executor.ts`) branching at the
   `RunService.execute()` seam — **never** through `modelFor()`/the AI-SDK loop (Qlik Answers is
   not chat-completions-shaped). Per run: create thread (`mcpfp run <id>`, kept) → prompt
   (one-shot; stream transport default) → emit the standard `RunEvent` vocabulary → one
   `llm_response` step carrying `assistantText` (graders read exactly this) + payload
   `{ sources, assistantVersion (Etag), threadId, promptMode, estimatedTokens: true,
   questionsConsumed: 1 }`.
3. **Honest measurement semantics:** the API reports **no token usage** → token KPIs are computed
   with the run's `TokenCounter` profile and marked estimated; the first-class cost unit is
   **questions consumed** (1/prompt, drawn from the tenant's shared monthly quota — same pool as
   Qlik MCP), with an optional owner-configured €/question; `Etag` per response = assistant
   version → drift marker across runs.
4. **The clean-session invariant, 3 layers:** environment write-time rejection (kind-aware, in
   `ScenarioService`), plan-time member skipping (D-QA6), and an executor that structurally never
   opens MCP sessions or skill contexts.
5. **Detection & onboarding:** server-side Qlik-origin detection (URL-based; `initialize`
   serverInfo is discarded today) + a **list-only availability probe** (never consumes a
   question) using the server's own credentials → wizard offer → one-click provider + one locked,
   empty environment per selected assistant; plus the always-available manual path
   (Settings → Providers → "Qlik Answers": tenant URL + API key).

## Locked decisions (owner kickoff, 2026-07-11)

| # | Decision |
| --- | --- |
| **D-QA1** | **Credential source: reuse the detected MCP server's OAuth/headers when the probe shows it works; API key fallback otherwise.** Provider credential supports both: nullable `mcp_server_id` link (migration, `ON DELETE SET NULL`; broken link → provider surfaced as "auth broken") or own `api_key` + `base_url`. The probe result decides which flavor the wizard offers. |
| **D-QA2** | **Transport: `actions/stream` default** (live deltas in the console); `actions/invoke` as a per-environment fallback toggle (`answersMode.transport`). **Amended (Phase 4, 2026-07-11):** the real prompt API is the internal `/api/v1/cloud-assistants/{threadId}/actions/stream` (stream-shaped, JSON-RPC card-patch SSE frames). Both `transport` values POST to that stream endpoint; `invoke` only suppresses live console deltas. |
| **D-QA3** | ~~Prompt type: one-shot, fixed…~~ **REVISED (Phase 4, 2026-07-11, live-verified).** The cloud-assistants prompt body has **no `promptType`** — it is `{context:{type:"app", id: <appId>, data:{mode:"live"}}, content:[{text}]}`. Thread continuity is the **kept thread itself**, so the opener/follow-up distinction survives only as the step payload's `promptMode` label (`oneshot`/`thread`), not on the wire. Repetition isolation is preserved because each scripted run gets its own fresh thread. See [`STATUS.md`](./STATUS.md) Phase 4 + [`../research/qlik-answers-as-model.md`](../research/qlik-answers-as-model.md) §2.6. |
| **D-QA4** | **Threads are kept**, named `mcpfp run <id>` — auditable in the Qlik Answers UI, cross-checkable via the interactions endpoint. Pruning = a later maintenance action, not v1. |
| **D-QA5** | **Cost: questions-consumed is the first-class metric** (KPI rail, suite totals, launch preview `answersQuestions`); optional €/question in `pricing.ts` (per-request pricing entry type); unpriced stays runnable with `costUsd` 0 — never a run-blocker. |
| **D-QA6** | **Incompatible test×environment members are skipped, not rejected**: tests with `attachments` or `systemPromptOverride` (and legacy scenarios still carrying servers/skills) become members marked `skipped: incompatible` in mixed suite plans; a plan whose members ALL skip → 400 with the reason. Skill-effect variant plans reject `qlik_answers` scenarios outright. |
| **D-QA7** | **Classic assistants only in v1.** Agentic assistants (cross-region inference; unverified invoke semantics) come after live verification on a real tenant. |

Naming rule: internal kind `qlik_answers`, executor `qlik-answers-executor`. Never the bare word
"assistant" in code — `apps/api/src/assistant/*` is the embedded **Claude** dock.

## The seams (verified in-code — details & line anchors in the research doc)

- `packages/shared/src/constants.ts` `PROVIDER_KINDS` + `providerKindSchema` — add the kind; all
  consuming switches are exhaustive (`never` defaults), TS enumerates the sites.
- `apps/api/src/providers/model-catalog.ts` `listAvailableModels()` — assistants roster case.
- `apps/api/src/providers/registry.ts` `modelFor()` — throw-case ("uses the answers executor").
- `apps/api/src/testing/run-service.ts` `execute()`/`resolve()` — the executor branch on
  `cred.kind`; sits below `start()` (rows/manager/grading/assertions untouched) and above the
  AI-SDK loop; the suite orchestrator funnels every member through `RunService.start`, so
  suite/collection/adhoc get the path for free.
- Grading applicability verified: answer graders + Auto-Rating base raters read
  `finalAssistantText` (`llm_response.assistantText`); `tool_hygiene` → `unevaluable` (never 0);
  `trajectory_judge`/`skillflow_conformance` correctly don't apply. Session compatibility
  (`POST /api/runs/:runId/compatibility`) already 422s on unknown models — hide the CTA.
- Probe precedents: `OAuthService.hasOAuthMetadata()` (same-origin discovery fetch) and the
  asset-proxy authed fetch (`apps/api/src/servers/routes.ts`); OAuth access token reachable via
  `OAuthRepository.getCredentials(serverId)`.
- Web wizard already Qlik-aware: `isLikelyQlikMcpUrl()`
  (`apps/web/src/features/servers/ServerWizard.tsx`).

## Guardrails & limits

`maxTurns`/`maxContextTokens`/`maxToolCalls` are hidden for this kind (meaningless); keep
`maxRunDurationMs`. The engine's unpriced-model cost-cap gate lives in `runAgentLoop` and is not
ported — questions metering replaces it (D-QA5). Qlik rate limits: invoke/stream are **Tier 2
(100 req/min/tenant)** → the orchestrator needs a per-provider concurrency cap + backoff on
429/`AE-6` for this kind. Error family `AE-1…AE-7`; **`AE-4` "Prompt is rejected"** maps to a
distinct stop reason (`prompt_rejected`), not a generic error.

## Work packages

### Phase 0 — Contract & provider foundation
- **WP 0.1 — shared contract:** `PROVIDER_KINDS` + `"qlik_answers"` (+ zod); additive types:
  `ServerProbeResponse.qlikTenant?`, run-step payload fields (`sources`, `assistantVersion`,
  `estimatedTokens`, `questionsConsumed`), estimate `answersQuestions?`, env
  `answersMode?: { transport: "stream" | "invoke" }`, provider input `mcpServerId?` alternative
  to `apiKey`. *Acceptance:* typecheck green across packages; no consumer switch left
  unhandled.
- **WP 0.2 — credential link + migration:** claim next free `user_version` (**v23 expected** —
  re-verify at claim time against `apps/api/src/db/database.ts` `MIGRATIONS` + sibling ledgers):
  `provider_credentials.mcp_server_id TEXT NULL REFERENCES mcp_servers(id) ON DELETE SET NULL`.
  Repository/service resolve auth from either source (linked server headers / OAuth access
  token, or own API key); broken link → provider listed with an "auth broken" state, runs
  refuse with a clear error. *Acceptance:* migration idempotent on a v22 DB; both auth paths
  unit-tested.
- **WP 0.3 — roster + Settings:** model-catalog case (`GET /api/v1/assistants`, classic only,
  cursor paging, 5-min cache as today); registry throw-case; accounting/`supportsToolSearch`
  cases; Settings Providers form (kind label, tenant-URL field, API-key-or-linked display).
  *Acceptance:* environment model picker lists assistants from a stubbed tenant.

### Phase 1 — Executor
- **WP 1.1 — invoke path:** thread create (named, kept) → one-shot `actions/invoke` → events per
  the mapping (status/user_message/llm_response/kpi/terminal); AE-x → outcome mapping (AE-4 →
  `prompt_rejected`); token estimates via the run's profile; questions metric + optional
  per-request pricing; `maxRunDurationMs`. All against a stubbed fetch. *Acceptance:* replayable
  run with grades from the mandatory raters; tool-hygiene `unevaluable`.
- **WP 1.2 — RunService branch + interactive turns:** the `cred.kind` branch in
  `execute()`/`resolve()` (no sessions, no tools, no skills); interactive `POST /api/runs/:id/turns`
  → `promptType: "thread"` on the kept thread. *Acceptance:* suite/collection/adhoc plans and
  single runs all route through the executor; grading chain fires post-terminal.
- **WP 1.3 — stream path (default):** chunked-JSON parser (`}{` boundaries, trailing `sources`
  chunk, tolerant of partial fragments) → `delta` events; per-env `transport` fallback toggle.
  *Acceptance:* parser fuzz tests; console shows live text on a stubbed stream.
- **WP 1.4 — clean-session enforcement:** `ScenarioService` kind-aware rejection of non-empty
  servers/skills; plan-time member skipping per D-QA6 (`skipped: incompatible` surfaced in the
  suite report; all-skip plan → 400); variant plans reject the kind; compatibility CTA hidden.
  *Acceptance:* tests lock all three layers.
- **WP 1.5 — orchestrator throttle:** per-provider concurrency cap for the kind + backoff on
  429/`AE-6`. *Acceptance:* mass-run test with a rate-limited stub stays under the cap and
  completes.

### Phase 2 — Detection & onboarding
- **WP 2.1 — detection + availability probe (API):** server-side `qlik-detect` helper (URL-based,
  mirrors the client heuristic) + list-only assistants probe with the server's credentials
  (401/403 → `available, needsOwnKey`); `POST /api/servers/:id/qlik/answers-probe`; additive
  `qlikTenant?` in probe/connectivity responses. **Never invokes** (a probe must not consume a
  question). *Acceptance:* probe paths tested for bearer/api-key/custom/oauth servers.
- **WP 2.2 — wizard offer + server badge (web):** post-save offer step (assistant multi-select →
  one click creates the provider [linked-auth preferred per probe, else API-key entry] + one
  locked empty environment per assistant, named "Qlik Answers — {name}"); "Answers available"
  badge + CTA on the server detail header; recheck at scan time. Consent-gated, never silent.
- **WP 2.3 — environment editor conditionals:** for the kind — hide Servers & skills + irrelevant
  guardrails, model picker = assistants, `answersMode.transport` toggle. Both themes.

### Phase 3 — Analytics polish & docs
- **WP 3.1 — console polish:** sources panel on the answer step (payload-driven; both themes);
  assistant-version drift marker vs the previous run of the same test×environment.
- **WP 3.2 — cost surfaces:** launcher cost preview `answersQuestions` (suite matrix multiplier
  explicit); KPI rail marks token figures "est."; suite totals include questions.
- **WP 3.3 — docs + acceptance handoff:** CLAUDE.md row → ✅ criteria; research-doc addendum for
  anything live-verified; owner-acceptance checklist finalized in STATUS.

### Parallel execution map
Batch 1: **0.1** solo (touches `packages/shared`) · batch 2: 0.2 ∥ 0.3 · batch 3: 1.1 ∥ 2.1 ·
batch 4: 1.2 ∥ 1.3 ∥ 2.2 · batch 5: 1.4 ∥ 1.5 ∥ 2.3 · batch 6: 3.1 ∥ 3.2 ∥ 3.3.
`packages/shared` and `run-service` writers serialize across workstreams (see the contention note
in STATUS).

### Phase 5 — Answer rendering rework (planned 2026-07-12)
Chat fidelity for `qlik_answers` runs: render the Adaptive-Card block sequence (text + hypercube
data insets + citation chips) instead of flattened paragraphs, structure/dedupe the reasoning
stream, make insights data-first, and make the KPI rail question-first. Six WPs (5.1–5.6) +
proposed decisions **D-QA8–D-QA13** in
[`phase-5-answer-rendering.md`](./phase-5-answer-rendering.md); ledger in
[`STATUS.md`](./STATUS.md) §Phase 5. Grader contract (`assistantText`) explicitly untouched.

## Out of scope (v1)

Agentic assistants (D-QA7); knowledgebases API surfaces; pushing grades back as native Qlik
feedback (`POST …/interactions/{iid}/feedback` — noted as a future nicety); thread pruning
maintenance; OAuth-M2M provider credentials created from scratch (linked-server reuse or API key
only).

## Live-tenant verification list (owner, needs a real tenant)

`promptType`-omitted semantics vs `defaultPromptType`; whether MCP-server OAuth tokens
(`user_default` + `mcp:execute`) can call the assistants API (drives how often D-QA1's preferred
path applies); stream chunk framing under load; AE-4 reproduction; agentic-assistant behavior
(for the post-v1 decision).
