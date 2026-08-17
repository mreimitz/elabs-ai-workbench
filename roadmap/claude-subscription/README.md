# Claude subscription as a run model — plan · **PRIORITY: (owner to set)**

Run **Claude models on the owner's signed-in Claude Code subscription** as a first-class,
selectable model for regular test runs — single **and** suite runs — with **zero marginal API
cost**. The subscription model looks and behaves like any other model in the UI; the only visible
difference is an **estimate/accuracy marker** on the metrics that are not provider-exact.

> Authoritative in-flight state is [`STATUS.md`](./STATUS.md), driven by
> `/next-wp claude-subscription`. This README is the plan + locked decisions.

---

## 1. Why this is a *separate executor*, not a dropdown model

The app has two disjoint inference stacks. A "regular run" today goes
`POST /api/runs` → [`RunService.execute()`](../../apps/api/src/testing/run-service.ts) →
`runAgentLoop()` → Vercel AI SDK `streamText()`
([engine.ts:510](../../apps/api/src/testing/engine.ts)); the model object is built by
`modelFor(cred, model)` ([registry.ts:47](../../apps/api/src/providers/registry.ts)); MCP tools are
bridged as AI-SDK `tool()`s ([tool-bridge.ts](../../apps/api/src/testing/tool-bridge.ts)); cost
comes from `MODEL_PRICING`.

The subscription runs on the **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk@0.3.206`) via
`query()` behind the `AgentSessionDriver` seam
([session-driver.ts:304](../../apps/api/src/assistant/session-driver.ts)). The Agent SDK never
exposes a Vercel-AI-SDK `LanguageModel`, so it **cannot** ride `streamText`. This is exactly why
`modelFor` throws for `vendor_assistant` ([registry.ts:67](../../apps/api/src/providers/registry.ts))
and the vendor runs are diverted before the agent loop. The subscription model takes the **same detour**:
a new provider-kind branch at the fork in
[`RunService.execute()`](../../apps/api/src/testing/run-service.ts) (`run-service.ts:398-406`).

### The parts that already exist (this is mostly assembly, not invention)

- **[`claude-cli-judge.ts`](../../apps/api/src/grading/claude-cli-judge.ts)** already "runs the
  subscription as an LLM without an API key": drives the raw `AgentSessionDriver`, injects the
  decrypted OAuth token via [`buildAssistantSpawnEnv`](../../apps/api/src/assistant/spawn-env.ts),
  maps `turn_done.usage` → real token counts, treats cost as 0, degrades honestly on
  auth/rate-limit/timeout, and serializes concurrent ~1 GiB children behind a semaphore. It is a
  `maxTurns:1`, tools-less one-shot — ~80% of the executor we need, minus the multi-turn loop and
  the MCP/skill wiring.
- **The `vendor_assistant` executor** is the template for "a target that appears as a selectable model
  but runs on its own branch, prices differently, and marks its estimated metrics."
- **Sign-in + storage exist**: PTY `claude setup-token`
  ([claude-auth.ts](../../apps/api/src/assistant/claude-auth.ts)) → encrypted `assistant_credentials`
  (`claude_oauth`, single row) → resolved by
  [`AssistantAuthService`](../../apps/api/src/assistant/auth-service.ts).

---

## 2. Locked decisions (owner, 2026-07-13)

| # | Decision |
| --- | --- |
| **D-CS1** | **Ship it** — using the Claude subscription to power automated single + suite runs is accepted (ToS considered and OK for this single-owner local tool). |
| **D-CS2** | **Scope = single runs AND suite mass-runs.** Both must work through the one run engine / suite orchestrator. No feature that works for one but not the other. |
| **D-CS3** | **No visible UX divergence.** The subscription model is a normal entry in the model roster; the launcher (both paths), run console, Runs feed, Compare, and suite report render **identically** to an API-keyed Claude run. No separate screen, no kind-gated hiding (contrast `vendor_assistant`, which hides context surfaces — we do **not**). |
| **D-CS4** | **…except a clear accuracy marker** on the metrics that are not provider-exact — reusing the existing `estimatedTokens` / "est." marker convention the vendor assistant established, in **both** the UI and the JSON/Markdown reports. See the accuracy map (§3). |
| **D-CS5** | **Claude models only, for now.** The roster for this kind is Claude tiers the subscription grants (reuse `ASSISTANT_MODEL_ROSTER`). Other providers keep using API-keyed kinds. |
| **D-CS6** | **Internal kind = `claude_subscription`**; executor module = `claude-subscription-executor`. Never bare "assistant" (collides with the embedded dock, `apps/api/src/assistant/*`) and **not** `claude_cli` (already the judge-ledger provider id `CLAUDE_CLI_PROVIDER_ID`). |
| **D-CS7** | **Auth = the signed-in subscription only.** A `claude_subscription` provider credential carries no key; it resolves the OAuth token from the `assistant_credentials` store at run time (mirroring `vendor_assistant` linked-auth). Not signed in → "auth broken" state + honest run error, never a fake result. API-keyed Claude stays the existing `anthropic` kind. |
| **D-CS8** | **Cost = reference-priced estimate, clearly marked.** Marginal subscription cost is \$0, but we surface a **shadow cost** = real token counts × current Anthropic list price (from `MODEL_PRICING`), labelled "est. · subscription". This (a) keeps `maxCostUsd` cost caps working for single + suite runs, (b) keeps cost analytics/compare meaningful, (c) is honestly flagged per D-CS4. (Rejected: vendor-style hard \$0, which makes the cost cap un-trippable.) |
| **D-CS9** | **MCP tools + skills DO work** (unlike `vendor_assistant`, which is clean-session). Tools flow through the Agent SDK `mcpServers` option; skills are materialized read-only into the SDK workspace. Their **runtime token metering is estimated** (counted locally from SDK `tool_result`/file payloads), and marked per D-CS4. |
| **D-CS10** | **Shared concurrency budget with the judge.** Run children and the auto-rating judge both spawn ~1 GiB subscription CLI children; they must share one semaphore/budget (extend the `AUTO_RATING_MAX_CONCURRENCY` mechanism) so a suite of subscription runs + their ratings can't exhaust memory or the subscription. |

---

## 3. Accuracy map — what's exact vs. estimated (drives every "est." marker)

| Metric | Source on the subscription path | Accuracy | Marked? |
| --- | --- | --- | --- |
| `tokens_in` / `tokens_out` / `cached_tokens` | SDK `turn_done.usage` (provider-reported) | **Exact** | "provider-reported" (no est. badge) |
| `peak_context_tokens` | max per-turn input tokens | Coarser than the AI-SDK `context_event` path (turn-granular, not step-granular) | est. (granularity) |
| Per-tool runtime token/byte footprint | counted locally from SDK `tool_result` payloads (like `vendor_assistant` answer-token estimate) | **Estimated** | est. |
| Skill-disclosure token cost | counted locally from materialized files | **Estimated** | est. |
| `cost_usd` | shadow price = exact tokens × `MODEL_PRICING` list rate (D-CS8) | Reference/hypothetical (marginal = \$0) | est. · subscription |
| logprobs | none (SDK exposes none) | Unavailable → outcome judge uses `single_sample` only | n/a |

> **One line to remember:** token *counts* are real; *cost* and *per-tool/context granularity* are
> estimates. The marker communicates exactly that.

---

## 4. Work packages

### Phase 0 — Contract, credential & roster
- **WP 0.1 — shared contract.** Add `"claude_subscription"` to `PROVIDER_KINDS`
  ([constants.ts](../../packages/shared/src/constants.ts)) + zod + types. Additive step/KPI fields
  for the accuracy markers (reuse `estimatedTokens`; add e.g. `costBasis: "subscription_reference"`
  and a per-step `meteringEstimated` flag). Nothing that isn't additive to the wire.
- **WP 0.2 — credential + auth resolution + migration.** Widen the
  `provider_credentials.kind` CHECK ([schema.ts:150](../../apps/api/src/db/schema.ts)) — **claim the
  next free `user_version`** at claim time (re-verify `apps/api/src/db/database.ts` `MIGRATIONS`;
  sibling ledgers may be mid-flight). Auth resolver: for `claude_subscription`, resolve the OAuth
  token from `assistant_credentials` (extend `linked-auth`/registry `getDecrypted`); surface
  "auth broken" when not signed in (mirror `vendor_assistant`).
- **WP 0.3 — roster + Settings.** `model-catalog` case returns the Claude roster
  (`ASSISTANT_MODEL_ROSTER`); `registry.modelFor` throws for the kind (guardrail, like
  `vendor_assistant`); Settings → Providers can create the single `claude_subscription` provider
  (no key field; shows sign-in state, links to the existing Assistant sign-in).

### Phase 1 — Executor (single runs)
- **WP 1.1 — `claude-subscription-executor`.** Multi-turn loop over `AgentSessionDriver`
  (generalize `claude-cli-judge`'s one-shot to `maxTurns = guardrails.maxTurns`, interactive turns
  via `send()`), throwaway workspace + spawn env, timeout, honest degradation. Map `DriverEvent`s
  (`assistant_message`/`assistant_delta`/`tool_call`/`tool_result`/`turn_done`/`limit_error`/`error`)
  → the run's `RunEvent`/`run_steps`/KPI model so the console renders identically (D-CS3).
- **WP 1.2 — `RunService.execute()` branch.** New `cred.kind === "claude_subscription"` fork at
  `run-service.ts:398-406` (alongside `resolveAnswers`) → `runClaudeSubscription(...)`. **Not**
  clean-session — MCP + skills are wired (WP 1.3/1.4).
- **WP 1.3 — MCP tools via SDK `mcpServers`.** Translate the scenario's allow-listed servers into
  Agent SDK `mcpServers` configs; map the allow-list onto SDK `disallowedTools`/allow patterns.
  Meter `tool_result` payloads locally (estimated, marked). Transport errors fail the run; tool
  `isError` is a failed step, run continues (match `tool-bridge` semantics).
- **WP 1.4 — skills.** Materialize attached skill files read-only into the SDK workspace
  (`additionalDirectories`); estimated metering; never executed (unchanged skills invariant).
- **WP 1.5 — cost (D-CS8).** Shadow-price exact tokens via `MODEL_PRICING`; wire that estimate into
  the `guardrailStop` cost cap and `cost_usd`; tag `costBasis: "subscription_reference"`.

### Phase 2 — Suite runs & concurrency
- **WP 2.1 — orchestrator + shared semaphore (D-CS2, D-CS10).** Verify the suite orchestrator runs
  the kind unchanged (it calls the same `runService.start`); extend the subscription-child semaphore
  so runs **and** the judge share one budget; per-provider concurrency cap for the kind.
- **WP 2.2 — suite report degradation.** Suite cost analytics/consistency/agreement render with the
  shadow-cost estimate and the accuracy marker; no separate code path, no crash on missing logprobs
  (outcome judge already falls back to `single_sample`).

### Phase 3 — Accuracy markers & polish (D-CS4)
- **WP 3.1 — UI markers.** "est." / "subscription-reference" markers on cost + estimated-metering
  KPIs in the run console KPI rail, Runs feed, Compare, and suite report — reusing the
  `estimatedTokens` marker component so it's visually consistent (no new visual language). Verified
  in **both** themes.
- **WP 3.2 — report markers.** JSON + Markdown run/suite reports carry the same `costBasis` /
  `meteringEstimated` flags and render a footnote (mirror how the vendor assistant marks estimated tokens).
- **WP 3.3 — auto-rating interaction.** Confirm a subscription run is still rated normally; document
  + handle the run-vs-judge subscription contention (D-CS10); note logprob absence in the report.

---

## 5. Parallel execution map

`0.1` (shared) is the barrier — everything imports it; start it alone if another session holds
`packages/shared`. Then `0.2` + `0.3` can run in parallel. Phase 1 WPs are mostly one module
(`claude-subscription-executor` + the `run-service` branch) so 1.1→1.2 are sequential; 1.3/1.4/1.5
layer onto 1.1. Phase 2/3 follow Phase 1. **Contention:** `apps/api/src/testing/run-service.ts` and
`packages/shared` are hot files other workstreams touch — claim them only when no sibling session is
writing them (see the vendor-assistant ledger note).

## 6. Risks / things to watch

- **Concurrency wall (D-CS10).** ~1 GiB per child + shared subscription means big suite matrices
  serialize hard. This is the main scaling limit; the semaphore makes it safe, not fast. `log()`/
  surface the queue so a slow suite doesn't look hung.
- **SDK version coupling.** The integration is verified against `@anthropic-ai/claude-agent-sdk@0.3.206`
  (see the `canUseTool` `updatedInput` quirk, `session-driver.ts:80-99`). Pin + re-verify on bump.
- **Resume across auth sources is unverified** (flagged in `session-manager.ts`); not on this path if
  each run is a fresh session, but keep runs single-session.
- **Allow-listing granularity.** The SDK gates by server + tool-name patterns, not the per-tool
  construction the AI-SDK bridge uses; confirm the scenario allow-list maps faithfully.
- **ToS at scale.** D-CS1 accepts this for the single-owner local tool; revisit if the tool ever
  becomes shared/multi-tenant (see `roadmap/team-server/`).
