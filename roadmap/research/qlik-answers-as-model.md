# Qlik Answers as a test target — research & integration design

> **Status:** research complete; **all decisions locked by owner 2026-07-11** (see §9);
> **BUILT 2026-07-11 — all 14 WPs (Phases 0–3), gate green throughout, on `main`.** The executable
> plan + authoritative ledger live at [`roadmap/qlik-answers/`](../qlik-answers/)
> ([`STATUS.md`](../qlik-answers/STATUS.md) — per-WP done state + the decision log). Everything is
> **stub-tested behind an injectable fetch; no real tenant was ever contacted** — the live-tenant
> items in §7 + "Live-tenant verification list" remain **owner-acceptance** (see the ledger's
> Owner-acceptance section). **Live-verification notes** (to fill in once a tenant is available):
> the exact `PromptOutputInvoke` / stream chunk framing, the `Etag` response-header shape, an `AE-4`
> rejection body, `promptType`-omitted semantics vs `defaultPromptType`, and whether an MCP-server
> OAuth token (`user_default` + `mcp:execute`) authorizes `GET /api/v1/assistants` (drives how often
> D-QA1's linked-auth path applies) + the classic-vs-agentic distinguisher (D-QA7, unresolved from
> the public spec) — were all implemented against the shapes verified below (OpenAPI spec + generated
> TS client + Qlik sample code), NOT a live tenant.
>
> **Goal:** treat a Qlik Answers assistant like a "model": send test prompts against it through
> the existing Testing engine, measure/validate/monitor it like a normal LLM session — while
> guaranteeing such runs never attach MCP servers or skills.

---

## 1. Recommendation in three sentences

Model Qlik Answers as a **new provider kind `qlik_answers`** whose "models" are the tenant's
assistants, executed by a **second run executor** that branches at the existing
`RunService.execute()` seam (never through the AI-SDK `LanguageModel` path — Qlik Answers is a
RAG product API, not a chat-completions API). Everything downstream — run persistence, SSE
console, replay, reports, grading, suites, the unified Runs feed, and Compare — works unchanged
because the executor emits the same `RunEvent` vocabulary. The MCP-server wizard becomes an
**onboarding accelerator**: when a streamable-HTTP server on a `*.qlikcloud.com` origin is saved,
the API probes `GET /api/v1/assistants` (free, consumes no questions) and offers one-click setup
of the provider + a locked, empty environment per assistant.

---

## 2. The Qlik Answers API — verified facts

> ### ⚠️ Live-verified correction (2026-07-11) — read §2.6 FIRST
> The public **`/api/v1/assistants/{aid}/threads/{tid}/actions/{invoke,stream}`** API described in §2.1
> below (with `PromptInput = {input:{prompt,promptType}}`) is the **wrong path for an app-backed
> assistant**: on a real tenant it binds **no data source**, so the assistant answers *"I'm sorry, I
> don't have any information…"* with **zero sources** — regardless of API key vs OAuth, scopes, or
> one-shot-vs-thread. Qlik Answers actually executes through the **internal
> `/api/v1/cloud-assistants/`** API with a Qlik Sense **app** data context. The rest of §2.1–§2.5 is
> retained as the public-API reference (roster, error family, auth, metering — still accurate), but
> **execution follows §2.6.** Implementation: `apps/api/src/testing/qlik-answers-executor.ts` +
> `qlik-answers-sse.ts` + `qlik-answers-message.ts` + `providers/model-catalog.ts`
> (`resolveQlikAnswersAppContext`).

All endpoints live on the **tenant origin** (`https://<tenant>[.<region>].qlikcloud.com`).
Ground truth: the [Assistants REST reference](https://qlik.dev/apis/rest/assistants/), its
[OpenAPI spec](https://qlik.dev/specs/rest/assistants.json), and the generated types in
[`qlik-oss/qlik-api-ts/assistants.d.ts`](https://github.com/qlik-oss/qlik-api-ts/blob/main/assistants.d.ts).

| Call | Purpose | Rate tier |
| --- | --- | --- |
| `GET /api/v1/assistants` (`?spaceId=&limit≤100`, cursor paging) | List assistants → our "model roster". **Free** (no question consumed). | 1 (1000/min) |
| `POST /api/v1/assistants/{aid}/threads` (`{name}`) → `{id,…}` | Create a conversation thread (required before any prompt). | — |
| `POST …/threads/{tid}/actions/invoke` | **"Execute synchronous prompt"** — blocking, full JSON answer. | 2 (100/min) |
| `POST …/threads/{tid}/actions/stream` | **"Execute asynchronous prompt"** — chunked streaming answer. | 2 (100/min) |
| `GET …/threads/{tid}/interactions` | Server-side transcript: `{request, response, sources, feedback, rejected}` per Q/A. | — |
| `POST …/interactions/{iid}/feedback` | Thumbs up/down + comment on an answer. | — |
| `DELETE …/threads/{tid}` | Thread cleanup. | — |

### 2.1 The two × two execution modes

There are **two independent mode axes**, both selected per prompt:

**Axis 1 — transport (which endpoint):**
- `actions/invoke` — synchronous; response is one JSON object
  `PromptOutputInvoke { output, question, sources[] }`.
- `actions/stream` — streaming; the body is a sequence of **concatenated JSON objects** (not SSE):
  `{"output":"<text fragment>"}{"output":"…"}…{"sources":[…]}`. Qlik's own sample splits chunks
  on `}{` boundaries. Maps 1:1 onto our run console's `delta` events.

**Axis 2 — prompt type (request body):** `PromptInput = { input: { prompt, promptType?: "thread", includeText?: boolean } }`
- **one-shot** (omit `promptType`) — the question is answered without conversation context.
  The assistant's own `defaultPromptType` is `"thread" | "oneshot"`.
- **`promptType: "thread"`** — the thread's prior interactions are context (multi-turn chat).

`includeText: true` additionally returns the retrieved chunk text inside `sources` — useful if we
ever want to grade retrieval, and it lets us measure the *evidence payload* size, not just the answer.

### 2.2 Response metadata worth persisting

- `sources[]`: `{ chunks[], datasourceId, documentId, knowledgebaseId, source (doc path) }` — the
  citation trail. First-class evidence for validation.
- Response headers **`Etag` = assistant version** and `Last-Modified` — a free **drift signal**:
  persist per run, flag when the assistant changed between baseline and current runs.
- `Interaction.rejected` / error code **`AE-4 "Prompt is rejected"`** — the assistant-side
  guardrail (prompt-injection/scope rejection). Distinct outcome, not a generic error.
- Error family: `AE-1` internal, `AE-2` bad request, `AE-3` auth, `AE-4` prompt rejected,
  `AE-5` not found, `AE-6` rate limit, `AE-7` method not allowed.

### 2.3 What the API does NOT give us

- **No token usage anywhere** (verified across the full generated types: the only "usage" mention
  is the rate-limit error). Token numbers must be **our own estimates** and flagged as such.
- No model identity, no temperature/config, no latency breakdown, no retrieval scores (scores may
  appear inside `chunks`; verify on a live tenant).
- No cost: Qlik Answers is **capacity-licensed by monthly question quota**. Every
  `invoke`/`stream` call consumes **1 question**; Qlik MCP and Qlik Answers draw from the **same**
  quota ([help.qlik.com](https://help.qlik.com/en-US/cloud-services/Subsystems/Hub/Content/Sense_Hub/QlikAnswers/administering-qlik-answers.htm)).
  So our first-class cost unit for these runs is **questions consumed**, with an optional
  owner-configured €/question.

### 2.4 Auth

Bearer token on the tenant origin: a **Qlik API key** or an **OAuth2 (M2M / M2M-impersonation)**
access token with `user_default`-class scopes; the identity needs space access to the assistant
(+ "Can consume data" on the KB space). The Qlik **MCP server** (`<tenant>/api/ai/mcp`) uses OAuth
scopes `user_default` + `mcp:execute` — so a token from an OAuth-connected Qlik MCP server in this
app is *plausibly* sufficient for the assistants API, but this must be verified live; the
availability probe (§4) answers it per tenant automatically (a 401/403 simply means "own
credential needed").

### 2.5 Adjacent facts

- **Agentic assistants** exist now (qlik-embed `ai/agentic-assistant`; require cross-region
  inference opt-in). Out of scope for v1 — classic assistants only — but the provider design
  leaves room (they surface via the same assistants API; semantics need live verification).
- Knowledgebases API is a sibling; not needed for run execution.

### 2.6 The REAL execution path — cloud-assistants + app data context (live-verified 2026-07-11)

Verified end-to-end against the `barcbenchmark.de.qlikcloud.com` tenant (env `nytaxi-assistant`): a run
now returns a real answer — *"There are 118,425,410 taxi trips in the dataset."* with the data
expression `=[Trips]` — instead of "no information". The flow mirrors the customer's proven
`answers_extract_script/src/python/call_answers.py`:

1. **Resolve the app id from the assistant UUID** (the env "model" stays the UUID). `GET
   /api/v1/assistants/{assistantId}` returns, for an app-backed assistant:
   ```json
   { "id": "b9244fb4-…", "name": "nytaxi-assistant", "appIds": ["8ac375d0-…"],
     "knowledgeBases": [], "legacy": false, … }
   ```
   The bound Qlik Sense app is **`appIds[0]`** (NOT in `knowledgeBases`, which is empty for an
   app-backed/"live data" assistant; the public `Datasource` type — `type:"file"|"web"|"database"` —
   has no Qlik-app entry, so the KB API is not the source). Resolution is cached per
   `(baseUrl, assistantId)`; unresolvable → a terminal `error` (never a silent wrong answer).
2. **Create a thread:** `POST /api/v1/cloud-assistants/threads` with
   `{ "name": "mcpfp run <runId>", "context": {"type":"app", "id": <appId>, "data":{"mode":"live"}} }`
   → `{ "id": <threadId> }`. (Note: **no assistant id in the path** — the app IS the binding.)
3. **Prompt (stream):** `POST /api/v1/cloud-assistants/{threadId}/actions/stream` with
   `{ "context": {"type":"app","id":<appId>,"data":{"mode":"live"}}, "content": [{"text": <prompt>}] }`
   → a **line-based SSE/NDJSON** stream of JSON-RPC card-patch frames:
   `data: {"method":"delta","params":{"op":"add","path":"…","value":…,"messageId":"<id>"},"context":{}}`.
   Collect the **last `messageId`** (nested under `params`). The frames incrementally build an
   Adaptive Card (a "Show reasoning" `Qlik.Stepper` + the answer); we do **not** reconstruct live
   console deltas from these patch ops (cosmetic — the settled answer is authoritative). There is **no
   `promptType`** on this API.
4. **Fetch the answer:** `GET /api/v1/cloud-assistants/threads/{threadId}/messages` → the message with
   `id == messageId` (fallback: the last message). Extract from `content[0].card.body[]`: the answer is
   the first non-empty `TextBlock` **after a `"Conclusion"` TextBlock** (strip `<citation…>…</citation>`
   tags); the **evidence** is the `qMeasures[].qDef.qDef` data expressions anywhere in the tree (the
   app-assistant analogue of document citations — `sources[]` is `[]` for app assistants). A
   `_find_last_ai_message`/`_last_text` fallback covers non-card answers.
5. **Auth:** `Authorization: Bearer <key>` (API key or the reused OAuth token from a linked Qlik MCP
   server — both confirmed working via the availability probe).

Persisted per answer (`AnswersStepPayload`, additive): `appId`, `messageId`, `expressions[]`,
`reasoning?`, `rawResponse` (the full official message), plus the existing `threadId`/`promptMode`/
`estimatedTokens`/`questionsConsumed`; `sources?` kept optional. Retry (429/`AE-6`), the wall-clock
deadline, `AE-4 → prompt_rejected`, and questions-consumed metering are all preserved from Phase 1.

---

## 3. Where it fits: a provider kind, not a server feature

### 3.1 Why "provider + models", not "MCP server capability"

Everything in Testing keys on **environment = provider credential + model** (the launcher picks
environments, not models; suites/collections expand test × environment × repetition; compare,
grading and pricing all hang off runs). Making each assistant a "model" under a `qlik_answers`
provider means **zero launcher/orchestrator/feed changes**. The Qlik *MCP server* connection is
only the detection/onboarding trigger — MCP comparison and Answers testing stay orthogonal
features that happen to share a tenant.

Naming: internal kind `qlik_answers`, executor `qlik-answers-executor`. Avoid the bare word
"assistant" in code — `apps/api/src/assistant/*` is the embedded **Claude** dock (a real
collision, flagged during exploration).

### 3.2 The seams (all verified in-code)

| Seam | Where | Change |
| --- | --- | --- |
| Provider kind enum | `packages/shared/src/constants.ts:35` `PROVIDER_KINDS` + `providerKindSchema` (`schemas.ts:155`) | add `"qlik_answers"`. Every consuming `switch` is exhaustive with a `never` default — TS enumerates the sites. |
| Credential | `provider_credentials` (`apps/api/src/db/schema.ts:136`) | fits today: `base_url` = tenant origin, `api_key_encrypted` = API key. Optional (D-QA1): nullable `mcp_server_id` to reuse a linked server's auth. |
| Model roster | `apps/api/src/providers/model-catalog.ts:23` `listAvailableModels()` | new case: `GET /api/v1/assistants` → `AvailableModel { id: assistantId, displayName: name }`. Feeds the existing environment model picker unchanged. |
| Model factory | `apps/api/src/providers/registry.ts:37` `modelFor()` | `qlik_answers` case **throws** ("uses the answers executor") — it must never be reached. Do **not** masquerade as an AI-SDK `LanguageModel`; the loop, accounting and usage extraction are all `streamText`-shaped. |
| **Execution branch** | `apps/api/src/testing/run-service.ts` `execute()`/`resolve()` (the `runAgentLoop` call site, line ~356) | branch on `cred.kind`: `qlik_answers` → `runQlikAnswers(runId, cfg, emit)` in a new `apps/api/src/testing/qlik-answers-executor.ts`. Sits **below** `start()` (rows, manager, grading, assertions all still fire) and **above** the AI-SDK loop. The suite orchestrator funnels every member through `RunService.start` (`apps/api/src/suites/orchestrator.ts` `runCell()`), so suite/collection/adhoc plans get the path for free. |

### 3.3 What the executor emits (so everything downstream "just works")

Per run: create thread (name `mcpfp run <runId>`) → prompt → emit → (optionally) delete thread.

| Moment | RunEvent |
| --- | --- |
| start | `{type:"status", status:"running"}` + a `user_message` step (prompt) |
| stream chunks | `{type:"delta", channel:"text", text}` per `{"output":…}` fragment |
| answer settled | one **`llm_response` step** with `assistantText` = full answer (graders read exactly this via `finalAssistantText`), `payload` = `{ sources, assistantVersion (Etag), threadId, interactionId?, promptMode, rejected? }` |
| KPIs | `{type:"kpi", turns:1, toolCalls:0, tokensIn:est, tokensOut:est, contextTokens:0, costUsd}` — token numbers computed with the run's `TokenCounter` profile and **marked estimated** in the payload |
| terminal | `{type:"status", status:"completed", outcome:"completed"}`; `AE-4` → distinct outcome (`stop_reason: "prompt_rejected"`), other AE-x → `error` with the code in `errorMessage` |

Grading applicability (verified): `rouge1`, `value_match`, `outcome_judge` and the always-on base
raters (`answer_validation`, `insight_surplus`, `error_forensics`) read `finalAssistantText` and
work as-is; `tool_hygiene` returns `unevaluable` gracefully on zero tool calls;
`trajectory_judge`/`skillflow_conformance` won't apply (no reference logic / no skills — correct).
Session compatibility (`POST /api/runs/:runId/compatibility`) already 422s on unknown models —
cleanly unavailable, hide the button for these runs.

Multi-turn: interactive console turns (`POST /api/runs/:id/turns`) map to `promptType:"thread"`
reusing the run's thread. Scripted tests stay single-prompt (they are today anyway) and default to
**one-shot** for repetition isolation.

### 3.4 Guardrails & cost semantics

`maxTurns` / `maxContextTokens` / `maxToolCalls` are meaningless here — hide them in the
environment editor for this kind. Keep `maxRunDurationMs`. The engine's "reject unpriced model
when `maxCostUsd` set" gate lives inside `runAgentLoop` (`engine.ts`), so the executor defines its
own policy: **questions consumed** is the first-class cost metric (1/prompt); `costUsd` = questions
× optional per-question price (new per-request pricing entry type in
`apps/api/src/providers/pricing.ts`, default unpriced → costUsd 0, never a run-blocker).
Extend the launcher cost preview (`GET /api/estimate/run-plan`, additive) with
`answersQuestions: N` — a suite matrix multiplies questions fast, and quota is monthly and shared
with Qlik MCP, so the pre-launch number matters.

Rate limits: Tier 2 = 100 invocations/min/tenant. The orchestrator's parallel mass-runs need a
**per-provider concurrency cap + backoff on 429/AE-6** for this kind.

---

## 4. User workflow

### Path A — auto-detect from the MCP server wizard (the accelerator)

1. User adds a streamable-HTTP server; wizard already recognizes Qlik tenants
   (`isLikelyQlikMcpUrl()`, `apps/web/src/features/servers/ServerWizard.tsx:666` — host ends
   `.qlikcloud.com` + path contains `/api/ai/mcp`) and already gates the OAuth client-id field.
2. Server-side detection is added at the probe/create/scan lifecycle: a new helper (mirroring the
   client heuristic, URL-based — `initialize` serverInfo is currently discarded, so URL is the
   only reliable key) plus an **availability probe**: `GET <origin>/api/v1/assistants` using the
   server's configured auth (headers path exists in the asset-proxy precedent,
   `apps/api/src/servers/routes.ts`; OAuth token via `OAuthRepository.getCredentials(id)`).
   **List-only, never invoke — the probe must not consume a question.** Exposed as
   `POST /api/servers/:id/qlik/answers-probe`, result also folded (additive) into the probe
   response (`qlikTenant?: { origin, answersAvailable, assistantCount }`).
3. On success the wizard's review step / completion path shows the offer: *"This server is on a
   Qlik Cloud tenant with N Qlik Answers assistants. Set them up as test targets?"* One click →
   creates the `qlik_answers` provider (auth: reuse-server-credential or own API key, D-QA1) and,
   per selected assistant, a **locked empty environment** "Qlik Answers — {assistant name}"
   (provider + model preset; servers/skills forced empty). **Consent-gated, never silent** —
   test runs cost quota.
4. Post-hoc affordance: an "Answers available" badge + CTA in the server detail header
   (`ServersView.tsx` PageHeader badge row) for servers created before the feature, re-checked at
   scan time.

If the assistants probe 401/403s with the server's credentials (scope shortfall), the offer still
appears but asks for an API key — the probe result tells us which flavor to show.

### Path B — manual (no MCP server at all)

Settings → Providers → Add → kind "Qlik Answers": tenant URL + API key. Models list = assistants.
This must exist independently (an Answers-only user shouldn't need to register an MCP server
first), and it is the fallback whenever detection fails.

### Running & monitoring

The launcher needs zero changes: pick tests × the "Qlik Answers — X" environment, run — one
engine, unified Runs feed, drill-in console with streamed answer, per-run Report, suite compare.
The natural monitoring loop this unlocks: a benchmark collection + suite pinned to the assistant
environment, re-run on KB/assistant changes (Etag drift marker) or on a schedule; repetitions +
the planned auto-rating consistency variance quantify answer stability; Compare puts *assistant
vs. raw LLM+MCP on the same tests* side by side — the killer comparison this app is uniquely
positioned to make. Future nicety: push our verdicts back as native Qlik feedback
(`POST …/interactions/{iid}/feedback`).

---

## 5. The clean-session invariant (no MCP servers, no skills) — 3 layers

An environment with zero servers/skills is already valid (`allowedServers`/`allowedSkills` default
`[]`, `packages/shared/src/schemas.ts:234`). Enforcement must forbid the opposite for this kind:

1. **Write-time:** `ScenarioService.create/update` rejects non-empty `allowedServers`/`allowedSkills`
   when the referenced provider is `qlik_answers` (kind-aware check belongs in the service — the
   zod schema only sees `providerId`). UI: environment editor hides the Servers & skills sections
   for this kind.
2. **Plan-time:** run-plan resolution rejects `qlik_answers` scenarios that still carry
   servers/skills (legacy rows) and rejects skill-effect variant plans targeting them.
3. **Executor:** structurally cannot attach — it never calls the session opener, tool bridge, or
   skill-context builders.

Related edge validations: tests with **attachments** → reject at plan time (API takes a text
prompt only); `systemPromptOverride` → not sendable (the assistant owns its system config) —
reject or record "ignored" in the run payload (D-QA6).

---

## 6. Wire/schema changes (contract-first)

1. `packages/shared`: `PROVIDER_KINDS` + `"qlik_answers"`; additive types —
   `ServerProbeResponse.qlikTenant?`, run-step payload fields (`sources`, `assistantVersion`,
   `estimatedTokens: true`, `questionsConsumed`), estimate response `answersQuestions?`,
   env-config `answersMode?: { transport: "stream"|"invoke", promptType: "oneshot"|"thread" }`.
2. DB migration (claim next free `user_version` at claim time; **v23 expected** — `MIGRATIONS`
   is at v22 as of 2026-07-11): `provider_credentials.mcp_server_id TEXT NULL`
   (ON DELETE SET NULL + "auth broken" surfacing) — required by D-QA1 as locked.
   Everything else rides existing columns/JSON payloads.
3. API: model-catalog case, registry throw-case, executor module, scenario/plan validation,
   answers-probe route, pricing per-request entry, orchestrator throttle for the kind.
4. Web: Settings provider form (kind label, base-URL field on), environment editor conditionals,
   wizard offer step + server badge, run-console sources rendering (payload-driven, phase 2),
   hide compatibility CTA for these runs.

---

## 7. Honest limitations to carry into the docs/UI

- Token counts are **estimates** (our BPE profiles over prompt/answer text); never present them as
  provider-reported. Context-window metrics don't exist for these runs.
- One question of **shared monthly tenant quota** per prompt — surfaced pre-launch, and mass-runs
  should make the multiplier explicit.
- Answer variability is the product's nature (RAG + LLM); single-run verdicts are weak — steer
  users to repetitions (the suite engine already supports them).
- `promptType` omission semantics (assistant `defaultPromptType` vs. implicit one-shot) and
  agentic-assistant behavior need **live-tenant verification** — the doc pages for the invoke
  request body were unreachable in full; shapes were verified via the OpenAPI spec, the generated
  TS client, and Qlik's own sample code instead.
- The two docs sources conflict on nothing observed, but the assistants API is `stable` per spec
  (`x-qlik-stability: stable`), Tier-2 limits per tenant may still throttle big suites.

---

## 8. Proposed work packages

| Phase | Content | Size |
| --- | --- | --- |
| **0 — Contract & provider** | shared enum/types, credential (+optional server link, migration v17), model-catalog assistants roster, registry throw-case, Settings UI, curated-fallback labels | S |
| **1 — Executor** | `qlik-answers-executor.ts` (invoke first, then stream deltas), event/persistence mapping, AE-x → outcome mapping, token estimates + questions metric, duration guardrail, thread lifecycle, clean-session enforcement (3 layers), tests with a stubbed tenant | M |
| **2 — Detection & onboarding** | server-side Qlik-origin detect + answers probe (list-only), wizard offer + one-click provider/env creation, server-detail badge, probe-response additive fields | M |
| **3 — Console & analytics polish** | sources panel on the answer step, assistant-version drift marker, launcher cost preview `answersQuestions`, orchestrator throttle/backoff, docs + CLAUDE.md capability row | S–M |

Gate: `pnpm typecheck && pnpm test && pnpm build && pnpm lint` per WP, per repo rules. Owner
acceptance needs a real tenant (API key or OAuth-connected Qlik MCP server) — everything else is
stub-testable.

---

## 9. Decisions — LOCKED by owner, 2026-07-11

Authoritative copy in [`roadmap/qlik-answers/README.md`](../qlik-answers/README.md); recorded here
for provenance:

- **D-QA1 — credential source: reuse the MCP server's OAuth/headers when the probe proves it
  works; API key fallback otherwise.** Both supported: nullable `mcp_server_id` link (migration,
  broken-link → "auth broken" state) or own key. The availability probe decides which flavor the
  wizard offers.
- **D-QA2 — transport: `stream` default**, `invoke` as per-environment fallback toggle.
- **D-QA3 — prompt type: one-shot, fixed, for scripted tests**; `thread` only for interactive
  follow-up turns. Not configurable per test.
- **D-QA4 — threads kept**, named `mcpfp run <id>`; pruning is a later maintenance action.
- **D-QA5 — questions-consumed is the first-class cost metric + optional €/question**; unpriced
  stays runnable (`costUsd` 0).
- **D-QA6 — incompatible members are skipped, not rejected**: tests with
  attachments/`systemPromptOverride` (or legacy server/skill-carrying scenarios) become
  `skipped: incompatible` members in mixed plans; an all-skip plan → 400; skill-effect variant
  plans reject the kind outright.
- **D-QA7 — classic assistants only in v1**; agentic after live-tenant verification.

---

## Sources

- [Assistants REST reference](https://qlik.dev/apis/rest/assistants/) · [OpenAPI spec](https://qlik.dev/specs/rest/assistants.json) (invoke/stream = "Execute synchronous/asynchronous prompt", Tier 2 limit 100, `PromptInput`/`PromptOutputInvoke`, `Interaction.rejected`, Etag = assistant version)
- [qlik-oss/qlik-api-ts `assistants.d.ts`](https://github.com/qlik-oss/qlik-api-ts/blob/main/assistants.d.ts) (exact `PromptInput`/`PromptOutput`/`PromptOutputInvoke`/`Source` types; AE-1…AE-7; no usage reporting; `defaultPromptType: thread|oneshot`)
- [DIY your Qlik Answers Experience (Qlik Design Blog)](https://community.qlik.com/t5/Design/DIY-your-Qlik-Answers-Experience-with-the-new-KB-and-Assistants/ba-p/2506001) (working thread-create + stream example; chunked `{"output":…}…{"sources":…}` wire format)
- [qlik-embed OAuth impersonation tutorial](https://qlik.dev/embed/qlik-embed/quickstart/qlik-embed-impersonation-tutorial/) (OAuth M2M scopes; `ai/assistant` vs `ai/agentic-assistant`; cross-region inference note)
- [Deploying Qlik MCP server](https://help.qlik.com/en-US/cloud-services/Subsystems/Hub/Content/Sense_Hub/QlikMCP/Administering-Qlik-MCP.htm) + [Connecting to the Qlik MCP server](https://help.qlik.com/en-US/cloud-services/Subsystems/Hub/Content/Sense_Hub/QlikMCP/Connecting-Qlik-MCP-server.htm) (`<tenant>/api/ai/mcp`, scopes `user_default` + `mcp:execute`, shared questions capacity)
- [Deploying and administering Qlik Answers](https://help.qlik.com/en-US/cloud-services/Subsystems/Hub/Content/Sense_Hub/QlikAnswers/administering-qlik-answers.htm) + [Monitoring resource consumption](https://help.qlik.com/en-US/cloud-services/Subsystems/Hub/Content/Sense_Hub/Admin/mc-monitor-consumption.htm) (monthly question quota, consumption reporting)
- Codebase seams verified in-repo: `packages/shared/src/constants.ts:35`, `schemas.ts:234`, `apps/api/src/providers/{registry.ts:37, model-catalog.ts:23, pricing.ts}`, `apps/api/src/testing/run-service.ts` (~356), `apps/api/src/suites/orchestrator.ts`, `apps/api/src/oauth/service.ts:109`, `apps/web/src/features/servers/ServerWizard.tsx:112/666`
