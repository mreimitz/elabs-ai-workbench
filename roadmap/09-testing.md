# 09 Testing (live agentic test harness)

> **Status:** scoping draft. This document captures the agreed scope of the **Testing**
> feature from the planning Q&A (2026-06). It is a planning reference, not yet implemented.
> Items marked **(confirm)** are proposed defaults still awaiting owner sign-off.

## 0. What this is — and why it's a real scope expansion

Everything shipped so far treats MCP servers **statically**: connect, list tools, estimate the
token cost of their *definitions*, and execute single `tools/call` requests in the playground. The
app **never runs a model**.

**Testing turns the app into a live agent-execution and observability harness.** It drives a
real LLM through a tool-calling loop against a chosen set of MCP servers, streams the whole thing,
and instruments every token, tool call, and change to the context window.

That deliberately crosses three lines drawn in the earlier docs, by decision:

- `00-product-brief.md` lists **"full LLM request proxy mode"** and **"conversation replay"** under
  *Non-Goals*. Testing does both.
- `00-product-brief.md` lists **"provider-specific token adapters"** under *Later*. Testing
  pulls them forward (it reads provider-reported usage).

Treat this as **Phase 3**. It builds on Phase 1 (static scan) and the Phase 2 expanded target
(playground + runtime token accounting in `08-expanded-target.md`) and reuses their machinery: the
`TokenCounter` profiles, the API-side MCP client, and the secret-encryption store.

## 1. Decisions locked in the Q&A

| # | Question | Decision |
| - | -------- | -------- |
| 1 | Run interaction model | **Both modes**, chosen per run: automated (fire-and-watch) and interactive (live chat). "Locked" = scenario + test config frozen for the run's duration. |
| 2 | Token source of truth | **Token profiles are measurement lenses**, multiple per run. Configurable, attachable at **Scenario** and **Test** level. Provider-actual usage is one more lens. |
| 3 | Context window | **Surface native** context management only (e.g. Anthropic). The harness does **not** implement its own compaction in v1. |
| 4 | Test purpose | **Observation first, assertions phased.** Build the live instrument now; design the schema so pass/fail assertions can layer on later. |
| 5 | Structure | **Matrix (test × scenario).** A Test is a first-class, reusable workload; a Run is one (test × scenario) execution. Many-to-many. |
| 6 | Tool granularity | **Server-first, then optional per-tool.** A scenario selects allowed servers, then optionally toggles individual tools within them. |
| 7 | Profile inheritance | **Scenario default + Test adds/overrides.** |
| 8 | Persistence | **Full replayable artifact** — every message, tool I/O, per-step token count, and the context timeline, re-openable and scrubbable. |
| 9 | Providers (v1) | **Anthropic (Claude), OpenAI (GPT), Google Gemini, generic OpenAI-compatible local, and Ollama.** |
| 10 | Run engine | **Vercel AI SDK** as the spine, with native-SDK escape hatches where a provider feature isn't exposed. |
| 11 | Guardrails | **Max turns / tool calls**, **token / context budget**, **spend cap (est. cost)**. (No wall-clock.) |
| 12 | Context overflow | For non-self-managing models: **let it hit the wall and record it** as a first-class `context_overflow` outcome. |
| 13 | System prompt | **Scenario default + Test override.** |
| 14 | Test input | **Prompt + attachments** (files / images / context blobs). |
| 15 | Provider credentials | **Global app settings, encrypted** in SQLite like MCP secrets; never returned to the browser. A scenario references a provider, not a raw key. |

## 2. Domain model (the nouns)

**Scenario** — the harness. Holds: a provider + model + model params (temperature, max output
tokens, reasoning/thinking, …); the **allowed servers** and an optional **per-tool allow-list**
within them; a **default system prompt**; a **default token-profile set**; and **guardrails** (max
turns, token/context budget, spend cap).

**Test** — a reusable workload, independent of any scenario. Holds: a **user prompt**, optional
**attachments**, an optional **system-prompt override**, **added token profiles** (on top of the
scenario default), and a reserved slot for **assertions** (phased).

**Run** — one execution of `Test × Scenario`. The locked, instrumented session. Persisted in full
as a replayable artifact. Carries a **mode** (automated | interactive), a **status/outcome**
(completed | stopped-by-guardrail | context_overflow | error | aborted), and roll-up metrics.

**Token profile (lens)** — a way of counting. Two kinds: **static estimators** (existing
`generic_o200k`, `generic_cl100k`, `raw_json_rough`) that can price any step, and **provider-actual**
(input / output / cached tokens reported by the model API) available only during a live run.
Resolved set for a run = scenario default ∪ test additions.

Relationship: `Scenario *—(Run)—* Test`. Comparison is **the same Test across many Scenarios**
(Claude vs GPT vs local) — this is the benchmark headline.

## 3. The two run modes, and what "locked" means

- **Automated** — the test's prompt (+ attachments) is sent, the agent loop runs autonomously to
  completion under the guardrails, and the operator only watches.
- **Interactive** — a full streaming chat; the operator can send follow-up turns. The test prompt
  is the opener.

**Locked** = at run start the scenario + test configuration is frozen for the whole run: model,
params, allowed-tool set, system prompt, profiles, guardrails. The **allow-list is enforced by
construction** — only the selected tool definitions are ever offered to the model, so it physically
cannot call an excluded tool. Settings cannot be edited mid-run; to change them you start a new run.

## 4. The instrumented console (the experience)

A two-pane, operator-grade console:

**Left — conversation.** Streaming messages, model reasoning/thinking where the provider exposes it,
tool-call cards, and (interactive mode) the composer for follow-up turns.

**Right — debug log.** A chronological, per-step record:

- **LLM request:** model, the messages/tools actually sent, params, and the *offered* tool surface.
- **Tool call:** tool name, **arguments in**, **result out**, `isError`, duration — routed through
  the API-side MCP client (reuse the `tools/call` service behind
  `POST /api/servers/:id/tools/:toolName/call`).
- **Token usage per step:** every active profile **and** provider-actual, with the
  **estimate-vs-actual delta** surfaced.
- **Model decision:** what the model did with each result (next tool, final answer, stop).

**Context-window timeline (centerpiece).** A continuous view of the window across the whole run:

- per-step **composition** — system prompt / tool definitions / conversation history / tool results
  / current output — so you can see *what* is eating the budget;
- **cumulative tokens vs. the model's context limit** (a limit line);
- **events** marked on the line: tool-result injections, native context-management actions the
  provider performs (surfaced, not initiated by us), and the **overflow point** if the run hits the
  wall;
- buildup is the story — **no app-side compaction in v1**.

## 5. Run engine

**Spine: Vercel AI SDK** (`ai` + `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`, an
OpenAI-compatible provider for local, and Ollama). One abstraction for streaming + the multi-step
tool loop + per-step `usage`. **Escape hatch:** drop to a provider's native SDK where a feature
isn't exposed by the AI SDK (notably Anthropic's server-side **context-management beta**, which
decision #3 wants surfaced). All of this lives **in `apps/api`** — see §7.

**Loop:** model → emit tool call(s) → execute via the MCP client (`tools/call`) → feed results back
→ model → … until a natural stop, a guardrail trips, or overflow.

**Guardrails (scenario settings, surfaced when tripped):** max turns / tool calls; token or context
budget; estimated **spend cap** (from a provider pricing table — **(confirm)** how pricing is
maintained). The run's `stop_reason` records which fired.

**Overflow:** no pre-emption — let the window fill, let the provider error at its limit, and capture
`context_overflow` as a legitimate, visible outcome (it's a real benchmark result).

**Streaming transport (confirm):** **SSE** for the server→client run-event stream (it's one-way and
fits Fastify cleanly); interactive user turns posted over a normal `POST`. This is the app's first
streaming surface — additive to the existing REST API.

## 6. Token & context accounting

- Reuse the existing `TokenCounter` interface and profiles for the **estimator** lenses; add a
  **provider-actual** lens fed from the AI SDK's `usage` / `providerMetadata` (input, output, and
  cached tokens where reported).
- Count **per step** and **cumulatively**; **attachments are part of the context** and must be
  counted (text/files directly; images per the model's multimodal token rules).
- Persist the timeline as a series so a saved run reproduces the chart exactly.

## 7. Security & runtime boundary

- **Extend the runtime boundary to LLM inference.** `apps/api` remains the only process that spawns
  MCP servers, calls MCP tools, *and now* calls model providers and reads decrypted secrets. The web
  UI receives redacted configs and streamed events only. (`.claude/rules/mcp-and-security.md`,
  `.claude/rules/architecture.md`.)
- **Provider credentials** (API keys, local base-URLs) join the existing encrypted secret store,
  global at the app level, **never returned** to the browser. Scenarios reference a provider by id.
- **Full-replay retention (confirm):** because this is a single-owner local tool, store the full
  transcript and tool I/O locally — but **never** persist provider keys or MCP secrets inside a
  transcript, and keep the playground's known-secret-argument redaction. Default to "store
  everything except secrets"; revisit if that's too much.

## 8. Data model (new tables — contract-first: add to `packages/shared` first)

Sketch, to be finalized as types + zod in `packages/shared` before any API work, then migrated in
`apps/api/src/db/schema.ts` (keep the repository / service / thin-route layering):

- **`scenarios`** — id, name, provider_id, model, params_json, system_prompt, guardrails_json,
  default_profiles_json, created/updated.
- **`scenario_servers`** — scenario_id, server_id, and the optional per-tool allow-list
  (`allowed_tools_json`, null = all).
- **`tests`** — id, name, user_prompt, system_prompt_override, added_profiles_json, created/updated.
- **`test_attachments`** — id, test_id, kind (file|image|text), name, content ref, bytes.
- **`runs`** — id, test_id, scenario_id, mode, status, outcome/stop_reason, started_at, duration_ms,
  totals (turns, tool_calls, peak_context_tokens, actual_input/output/cached_tokens, est_cost).
- **`run_steps`** — id, run_id, idx, type (`llm_request` | `llm_response` | `tool_call` |
  `tool_result` | `context_event`), payload_json (redacted), per-profile token counts,
  provider_usage_json, context_snapshot_json.
- **`run_events`** — id, run_id, level, message, created_at (timeline + errors).
- **(reserved, phased)** `assertions` / `assertion_results` — expected tool calls, output
  contains/regex, token or cost budget, success — defined now, evaluated later.

## 9. API surface (sketch — finalize in `shared` first)

```
# Scenarios & tests (CRUD)
GET/POST            /api/scenarios
GET/PUT/DELETE      /api/scenarios/:id
GET/POST            /api/tests
GET/PUT/DELETE      /api/tests/:id
POST                /api/tests/:id/attachments

# Provider credentials (global, encrypted, redacted on read)
GET/PUT             /api/providers            # configured providers, no secret values returned

# Runs
POST                /api/runs                 # start: { testId, scenarioId, mode } -> { runId, streamUrl }
GET (SSE)           /api/runs/:id/stream      # live run events
POST                /api/runs/:id/turns       # interactive: send a user turn
POST                /api/runs/:id/stop        # manual abort
GET                 /api/runs                 # history (filter by test/scenario)
GET                 /api/runs/:id             # full replay detail
GET                 /api/runs/compare?ids=…   # same test across scenarios (the benchmark view)
```

## 10. UI surfaces (brand-ui only)

A new **Testing** area in the `AppShell` nav (new `ViewKey`s in `App.tsx` — no router):
**Scenarios**, **Tests**, **Runs** (history), the **Run console** (the locked two-pane view), and
**Compare** (the test × scenario matrix). All composed from `@brand/*` per `brand-ui-only.md`.

**Likely component gaps to raise upstream** (don't hand-roll — `library-first.md`):

- a **timeline / area chart** for the context window — `@brand/charts` exists upstream but is **not
  vendored**; either vendor it (owner-gated) or compose a constrained view from `@brand/ui`
  primitives as `TokenViz` does today;
- a **resizable split-pane** for the console;
- a **streaming log list** for the debug pane (virtualized; `@brand/data` `DataTable` may suffice);
- **attachment upload** affordance.

## 11. Proposed phasing

- **P1 — walking skeleton:** scenarios + tests + global encrypted provider keys; **one provider**
  (Anthropic); **automated** run; debug log with provider-actual usage; full-replay persistence.
- **P2 — the harness:** remaining providers (OpenAI, Gemini, local, Ollama); **interactive** mode;
  the **context-window timeline** + overflow handling; **multi-profile** lenses; **guardrails**;
  **attachments**.
- **P3 — benchmark & verdicts:** the **matrix compare** view; **assertions / eval**; surfacing
  **native context management**; report export; UI polish across all six themes.

## 12. Open questions / assumptions to confirm

1. **Streaming transport** — SSE (recommended) vs WebSocket. (§5)
2. **Replay retention** — "store everything except secrets" vs metrics-and-summary only. (§7)
3. **Model-param inheritance** — assume scenario default + test override, mirroring the system
   prompt. Confirm.
4. **Assertion shape** — which assertion kinds to reserve now (tool-called, output-contains, token
   budget, cost budget, success). (§8)
5. **Attachments in v1** — text/files first vs images-from-day-one (images need a multimodal model
   and model-specific token math). (§6)
6. **Spend-cap pricing** — where the per-model pricing table comes from and how it's kept current. (§5)
7. **Ollama** — native Ollama provider vs its OpenAI-compatible endpoint. (§5)
8. **New backend dependencies** — `ai` + `@ai-sdk/*` are owner-approved in principle (decision #10);
   confirm exact packages/versions. UI stays 100% `@brand/*` (this rule is unaffected).
