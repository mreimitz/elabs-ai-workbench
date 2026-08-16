# 04 — Evaluation: an OpenAI-compatible wrapper around the Qlik Answers APIs

Question (owner, 2026-07-16): *is it possible to write a wrapper around the Qlik Answers APIs we
currently use so the interface behaves like any other OpenAI-standard endpoint?*

**Verdict: yes — feasible, and most of the parts already exist in our codebase. Three impedance
mismatches need explicit design decisions (statelessness vs threads, streamed-vs-settled truth,
lossy rich payload), none fatal. The strategic question is not "can we" but "what for": as an
external interop facade it is high-value/low-risk; as an internal replacement for the
qlik-answers executor it quietly re-creates today's special-casing one layer down and is NOT the
unification shortcut it appears to be.** Details and evidence below; protocol facts were verified
against current OpenAI/AI-SDK/Qlik docs (sources at the end), code facts against our staged source.

---

## 1. What "OpenAI standard format" concretely means

Target: the **Chat Completions protocol** — `POST {baseURL}/chat/completions` + `GET /v1/models`.
It is the de-facto standard every compat client speaks, and the one our own engine already
consumes: `registry.ts:55-60` builds `openai_compatible` credentials with
`createOpenAICompatible({name, baseURL, apiKey})` — the wrapper would need nothing else to be
selectable as a provider.

Verified contract facts that matter for the wrapper:

- Streaming = SSE `chat.completion.chunk` frames with `choices[].delta.{role,content}`,
  terminated by `data: [DONE]`; with `stream_options:{include_usage:true}` a final pre-`[DONE]`
  chunk carries `usage` with an empty `choices` array (OpenAI OpenAPI spec).
- `finish_reason ∈ stop | length | tool_calls | content_filter` — `content_filter` is a legal
  terminal for a refused prompt (spec).
- Error envelope `{error:{message,type,param,code}}`; official clients auto-retry 408/409/429/5xx
  with backoff and honor `Retry-After` (openai-python source).
- **Reasoning**: the de-facto extension is a `reasoning_content` field on streamed deltas
  (DeepSeek; vLLM now also emits `reasoning`). Crucially, **`@ai-sdk/openai-compatible` parses
  `reasoning_content ?? reasoning` into first-class reasoning parts on both streaming and
  non-streaming paths** (verified in the package source) — so a wrapper that emits it gets live
  reasoning in our engine for free.
- **Citations**: no standard slot. The de-facto RAG convention is Perplexity's extra top-level
  `citations` / `search_results` fields next to standard `choices`; OpenAI's own
  `annotations[].url_citation` exists but is web-search-specific. `@ai-sdk/openai-compatible`
  offers a sanctioned pass-through for nonstandard fields (`metadataExtractor` →
  `providerMetadata`).
- Alternative target: the **Responses API**, whose `previous_response_id` is server-side
  conversation state and would map 1:1 onto Qlik threads — but third-party client support is
  weak/emerging (the AI-SDK compat package is chat-completions-only; OpenResponses is new).
  Chat Completions first; Responses is a cheap later addition if wanted.

## 2. What we would wrap (and what already exists)

The executor's proven call path (qlik-answers-executor.ts:24-66) is the wrap target:

1. assistant id → bound **app id** (`resolveQlikAnswersAppContext`, cached 5 min);
2. `POST /api/v1/cloud-assistants/threads` with `context:{type:"app", id:appId, data:{mode:"live"}}`;
3. `POST /api/v1/cloud-assistants/{threadId}/actions/stream` — card-patch frames, parsed by
   `QlikAnswersSseParser` which already routes text into **reasoning vs answer** channels;
4. `GET /api/v1/cloud-assistants/threads/{threadId}/messages` — the settled message = the truth
   (Conclusion extraction, blocks, snapshots, expressions, citations).

Two important boundary facts:

- **The public `assistants/{aid}/threads/{tid}/actions/{invoke,stream}` API is not a substitute**
  for app-backed assistants: live testing proved it binds no data source ("I don't have any
  information", zero sources — executor header, Phase 4 note). The wrapper wraps the same internal
  cloud-assistants API we already depend on; the public API remains an option only for
  document/KB assistants. (Public API details for completeness: invoke+stream exist, Tier 2
  ~100 req/min, AE-1…AE-7 error family — qlik.dev.)
- **No public OpenAI-compat adapter for Qlik Answers exists** (searched GitHub + web) — this
  would be first-of-kind, which is also an argument for building it as a clean, shareable module.

Reusable as-is from our code: the SSE parser + reasoning cleaner, message/blocks extraction,
429/AE-6 retry with `Retry-After`, bearer auth, app-context cache, BPE token estimation, the
assistant roster (→ `/v1/models`), per-question pricing. The wrapper is mostly **re-plumbing
existing pieces behind a different HTTP contract**.

## 3. The mapping

| OpenAI concept | Qlik Answers realization |
|---|---|
| `model` | assistant id; `/v1/models` served from our assistant catalog (`owned_by:"qlik"`) |
| `messages[]` | the **last user message** becomes the prompt; prior history handled by thread affinity (M1) — it cannot be replayed into a thread |
| `stream:true` | live frames: parser's reasoning channel → `delta.reasoning_content` (mirror `reasoning`), answer channel → `delta.content` (but see M2 hold-back) |
| `stream:false` | await settle; one `chat.completion` with extracted answer text |
| final `usage` | our BPE estimates (prompt/answer), emitted in the include_usage final chunk; flagged estimated via vendor field (M4) |
| `finish_reason` | `stop` normal; **AE-4 "prompt rejected" → `content_filter`** (clean fit); cap/timeout → error envelope or truncated `stop` (decide) |
| citations/sources | Perplexity-style `citations`/`search_results` extra fields + full fidelity under one vendor field `qlik_answers:{threadId, messageId, blocks, snapshots, expressions, reasoningSections, questionsConsumed, estimatedTokens:true}` |
| snapshots in text | flattened to markdown tables (we already cap at 50 rows) for standard clients; raw hypercube stays in the vendor field |
| errors | 401/403→401; 429/AE-6→429+`Retry-After` (clients auto-retry); unresolvable app→404 `model_not_found`; tenant 5xx→502 |
| sampling params | `temperature`/`top_p`/`max_tokens` ignored (no Qlik equivalent) — standard compat-server behavior, documented |
| tools | never emitted; `tool_calls` finish never occurs |

Engine-side note: `registry.ts` doesn't currently pass `includeUsage:true` to
`createOpenAICompatible` — either add it (one line) or have the wrapper emit the usage chunk
unconditionally (common compat-server behavior, harmless to strict clients).

## 4. The three real impedance mismatches

**M1 — Stateless `messages[]` vs stateful threads.** A Qlik thread accepts only *new prompts*;
history cannot be injected. Strategies, composable:
- *(a) Thread-per-request:* every call = fresh thread, last user message only. Correct for
  single-turn traffic — which is exactly our automated runs — but multi-turn clients get an
  assistant with amnesia.
- *(b) Thread affinity (recommended default):* cache `hash(model + messages[0..n-1]) → threadId`.
  Append-only conversations (every normal chat client, including our own engine's interactive
  loop, which resends the full history each turn) hit the cache and send only the newest message
  into the kept thread — **semantically identical to today's executor**. Edited/forked history
  misses the cache → new thread → silent context loss: documented deviation. Bounded LRU+TTL; we
  are a single-instance local app, so an in-process cache suffices.
- *(c) Explicit continuation* for clients we control: accept `metadata.thread_id`, return it in
  the vendor field. (And the Responses-API variant makes this native via `previous_response_id`.)

**M2 — Streamed text ≠ settled truth.** Today the stream is "the process" and the settled
`…/messages` fetch is the authority (the grading byte-identity contract depends on it); our
console live-streams then *replaces* with settled blocks. Chat Completions cannot retract deltas —
concatenated deltas ARE the final answer. Recommended default: **hold-back mode** — stream
`reasoning_content` live (the bulk of Qlik's stream is reasoning anyway), then emit the settled,
extracted answer as one final `content` block. Liveness preserved, truth exact, grading-safe. A
config flag can enable raw live `content` for clients that prefer it, accepting drift.

**M3 — Lossy rich payload.** Blocks, snapshots, citations, structured reasoning,
questions-consumed have no standard slot. The vendor field carries them losslessly
(`metadataExtractor` exposes them to AI-SDK callers), but *standard* clients render only the
flattened markdown. Anyone consuming Qlik Answers through the wrapper gets a text-mode Qlik
Answers — acceptable for interop, a regression if it replaced our console rendering.

**M4 (minor) — Metering honesty.** `usage` numbers are our estimates; standard clients will
present them as exact. Mark `estimatedTokens:true` in the vendor field and document it. If our own
engine consumed the wrapper, accounting would stamp these estimates as `usageActual` and cost
basis would silently read `api_exact` — this is the capability-manifest problem (01 §C3, Q5) in
miniature and the main internal-honesty risk.

## 5. What it buys — three options

**Option A — external facade only.** A route module in `apps/api` (e.g. `/openai/v1/*`, guarded
by a locally-minted wrapper key — never re-exposing the stored Qlik credential). Qlik Answers
becomes usable from *any* OpenAI-compatible client: Open WebUI/LibreChat, LiteLLM fleets, other
benchmark harnesses, customer demos ("point your client at this URL"). Zero impact on runs.
Effort: small — the translator + affinity cache + golden tests; every hard part (parser,
extraction, retry, auth) is already written and stub-tested.

**Option B — the engine consumes the wrapper** (an `openai_compatible` credential pointing at
ourselves; delete the third executor). Superficially the unification dream — Qlik runs would ride
`runAgentLoop` with the standard engine lifecycle. In practice it **degrades the product**:
questions-as-cost becomes invisible ($0 unpriced), `AnswersAnswerView`/snapshots/citations/
identity card lose their data unless we plumb `providerMetadata` → step payload → UI (recreating
the fork one layer down), estimates get recorded as exact usage (M4), AE-4 stops being a
distinguishable guardrail terminal, and grading byte-identity now depends on hold-back mode.
Verdict: **not the unification shortcut it looks like** — the capability-manifest concept
(01 §C3) solves the console divergence more honestly than flattening Qlik into a fake LLM.

**Option C — recommended: A now, B never by default.** Ship the facade for interop value and
first-of-kind optics; keep the executor as the internal path (it exists, is tested, and carries
the rich payload); revisit engine-through-wrapper only if the session-contract work later makes
payload pass-through natural. Optionally add the Responses-API variant (threads ↔
`previous_response_id` is a 1:1 map) when client support matures.

## 6. Risks

The wrapper inherits the **undocumented internal cloud-assistants API** (same blast radius as the
executor today — no new risk, but now with external consumers who can't see our changelog).
Tenant rate limits (~100 req/min tier) are shared by every wrapper client — the facade should
enforce its own concurrency cap and pass through 429s. Thread-affinity memory is per-process
(fine locally; a deploy story needs a persistent map). And the wrapper must never log or forward
the stored Qlik API key; callers authenticate with a minted local key (same pattern as
`mcp-secret.key`).

## 7. Spike checklist (if/when picked up)

Golden-transcript test: stub tenant fetch (existing pattern) → wrapper → assert byte-identical
answer text vs the executor's extraction. Smoke: `createOpenAICompatible` against the local
wrapper (reasoning parts arrive, usage arrives, metadataExtractor sees the vendor field); Open
WebUI pointed at it end-to-end. Affinity test: 3-turn append conversation reuses one thread;
edited-history fork creates a new one. Hold-back vs live-drift test. AE-4 → `content_filter`,
AE-6 → 429 mapping tests.

## Sources

Code: `apps/api/src/providers/registry.ts:55-60`; `apps/api/src/testing/qlik-answers-executor.ts`
(header + Phase 4 notes); `qlik-answers-sse.ts`; `qlik-answers-message.ts`. Protocol: OpenAI
OpenAPI spec (github.com/openai/openai-openapi — stream chunks, stream_options, finish_reason,
error envelope); openai-python (retry/Retry-After); developers.openai.com (models list,
background/Responses `previous_response_id`); DeepSeek api-docs + vLLM docs (`reasoning_content`
convention); ai-sdk.dev + vercel/ai source (`@ai-sdk/openai-compatible`: reasoning_content
parsing, includeUsage, metadataExtractor, createOpenAICompatible options); Perplexity docs
(citations/search_results extra fields); LiteLLM docs (custom provider → OpenAI-format proxy
precedent); Open WebUI docs (pipes/OpenAI-compatible consumption); qlik.dev assistants REST
reference + qlik-oss/qlik-api-ts (public invoke/stream, rate tier, AE codes); Qlik Community
"DIY your Qlik Answers" (stream wire format example). Adapter-absence: targeted GitHub/web
searches, 2026-07-16.
