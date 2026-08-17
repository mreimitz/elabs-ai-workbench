# Assistant Hub — the full-page, multi-model, multi-agent Assistant

**Status:** planned (decisions locked with the owner 2026-07-17). This folder is the
implementation workstream; the authoritative in-flight state is [`STATUS.md`](./STATUS.md),
executed via the orchestrator protocol in [`execution-plan.md`](./execution-plan.md) (start with
[`kickoff-prompt.md`](./kickoff-prompt.md)). Owner-locked decisions below are **D-AH1…D-AH20** —
agents must not reopen them; a WP that believes a decision is wrong STOPS and writes a STATUS
blocker instead of improvising.

## 1. What this is

A **full-page, enterprise-grade AI assistant** — the app's "art of the possible" showcase — as a
new top-level surface (**"Assistant"**, directly below Dashboard). It is a **general-purpose,
multi-model** assistant in the Perplexity class: search-grounded answers with first-class inline
citations, session modes from quick chat to fully orchestrated multi-agent **missions**
(propose → approve → run → synthesize, with live mission control), a versioned **artifact canvas**
with a review workflow, a real per-session **file workspace**, uploads, **memory** (profile,
preferences, projects with pinned context), and enterprise **cost telemetry + audit** — all built
on the **full `@brand/ai` component set** and the app's existing multi-provider inference,
MCP-bridge, skills, token-metering and pricing infrastructure.

It is deliberately **not** part of the test & benchmark areas where runs live, and it is **not**
the existing right-side dock (which stays what it is: the in-app helper, relabeled
**"App assistant"**). Its capabilities come from what the owner has registered in the app —
provider credentials (all kinds), MCP servers (and individual tools), and skills — which is
exactly what makes an MCP workbench the right home for it.

Two sentences the whole workstream must honor:

> The **harness** reads and understands the user's prompt, analyzes it, and proposes multiple
> subagents with different roles, tasks and models, which run in separate sessions and report
> back to the main session — fully configurable by the user.

> Every pillar is showcased **fully interactively**, leveraging the full set of AI components in
> the brand-ui library, including state-of-the-art system prompts.

## 2. Why the app is ready for this

- **Multi-model is already real:** 7 provider kinds (`anthropic`, `openai`, `google`,
  `openai_compatible`, `ollama`, `vendor_assistant`, `claude_subscription`) with encrypted
  credentials, per-provider model catalogs, `MODEL_PRICING`, and — via the shipped
  `claude-subscription` workstream — a zero-marginal-cost Claude path with exact token counts.
- **A real agent loop exists:** the AI-SDK engine (`streamText` + MCP tool bridge + skills +
  guardrails + token/context accounting) and the Agent-SDK `AgentSessionDriver` (subscription).
- **Unified Sessions (D-US1…26) shipped the session contract** this product needs: `phase`
  (`queued`/`waiting_input`/`stopping`), `stopReasonCode`, capability manifest, `SessionClock`
  (stall/wait budgets), cursor-resumable SSE. Its ledger shows all WPs ticked — the shared modules
  exist **today**; the Hub adopts them instead of inventing a contract.
- **`@brand/ai` ships purpose-built components** for nearly every planned feature (see the
  component map in [`execution-plan.md`](./execution-plan.md) §1.9): `InlineCitation*`/`Sources`,
  `Plan*`, `ApprovalCard*`, `Agent*`/`AgentTimeline`, `Queue*`, `Node`/`Edge`/`Canvas`,
  `Artifact*`, `FileTree`/`ProducedAssetTree`, `MessageBranch`, `ModelSelector`, `Context*`,
  `PromptInputCommand`, `SpeechInput`, `Shimmer`, `ChainOfThought*`, …

## 3. Locked decisions (D-AH log)

| # | Decision |
|---|---|
| **D-AH1** | **Identity: general-purpose.** The Assistant answers ANY question/task; its powers come from the registered MCP servers, skills and configured models. App data (scans, runs, skills) is one more knowledge source (read tools arrive in a later wave), not the center of gravity. |
| **D-AH2** | **Naming.** UI label **"Assistant"**, nav item **directly below Dashboard**, route family **`/assistant`**. Internal domain namespace is **`hub`** (dirs `apps/api/src/hub/`, `apps/web/src/features/hub/`, routes `/api/hub/*`, tables `hub_*`, env `HUB_*`, shared types `Hub*`) — never bare `assistant` (taken by the dock) and never "Claude Code" (policy, D-AS9 applies here too). The dock's visible label becomes **"App assistant"** (copy-only change; its engine, routes and decisions D-AS1…33 are untouched). Workstream folder: `roadmap/assistant-hub/`. |
| **D-AH3** | **Own domain, shared primitives.** New `hub_*` tables + a hub **turn engine** composed from the existing inference primitives — `providers/registry.modelFor` (AI-SDK kinds), the `AgentSessionDriver` path for `claude_subscription` (shared child semaphore), the MCP tool-bridge translation, token counting, `MODEL_PRICING`, and the Unified-Sessions shared modules (`SessionClock`, `terminalFor`, capability manifest). The Hub **never writes testing tables**; runs/suites/grading and the dock engine are untouched. |
| **D-AH4** | **Model surface at launch:** all five AI-SDK kinds + `claude_subscription`, selectable per session (default) and **switchable per message**; capability manifest gates the UI per kind (planner-derived; owner may veto). `vendor_assistant` is **not** a hub model in v1 (clean-session/no-tools mismatch) — revisit later. |
| **D-AH5** | **Session modes, chosen at session start:** `chat` (plain multi-model chat) · `research` (search-grounded, citations-first) · `mission` (the harness). Mission config adds **topology** (`parallel` · `pipeline` · `debate` · `best_of_n`) and **autonomy**, and may start **from a saved crew**. Modes shape the system prompt, default tools and UI emphasis. |
| **D-AH6** | **Harness flow: propose → approve → run → synthesize.** A planner model analyzes the prompt and proposes a team — roles, per-agent task briefs, models, tool grants, budgets, topology, rationale, cost estimate — rendered as an **editable plan card**. On approval the agents run as parallel child sessions; a synthesizer composes the final answer from their structured reports, **citing each agent's contribution** (and their citations). **Autonomy dial** per session: `always_ask` · `threshold` (agent count / est. cost) · `auto`. |
| **D-AH7** | **Roles are fully customizable.** A role defines: name, **system prompt**, default **model**, **MCP servers AND individual tools** within them, **skills**, a **main target** (objective) and an **expected outcome** (structured output contract), plus budgets. A curated, user-editable **role library** lives in a dedicated Agents view; the planner draws from the library **and may compose ad-hoc roles** within mission policy. **Saved crews** = named teams (roles + overrides + topology) instantiable by the user or the planner. |
| **D-AH8** | **Full mission control.** A live orchestration board in the thread: one card per agent (status/phase, streaming output, tool calls, token/cost ticker), overall progress + budget meter, and controls — stop an agent, **steer** it (inject a message), stop the mission. Missions and agents are fully **replayable**. Mission agents are **child hub sessions** (`kind:'agent'`, parent/mission linkage) so replay/streaming reuse the session machinery. |
| **D-AH9** | **Subagent boundaries.** Isolated contexts: each agent gets its brief + curated inputs, never the whole parent transcript. Reports are **structured** (findings, citations, artifacts, confidence, open questions — zod contract), not transcript dumps. Per-role tool allowlists; **mission budgets are hard caps** (max parallel agents, per-agent turns/tokens, total cost) with a live meter — a tripped budget stops cleanly and synthesizes partially, honestly marked. Decomposition depth is **1** (planner only) in v1; recursion is a flagged future option. |
| **D-AH10** | **Research is MCP-native + a first-class citation contract.** Web/search power comes from MCP servers the owner registers (search, fetch, …) — no built-in search vendor. ANY tool result carrying sources becomes numbered **inline citations** (`InlineCitation*`) with a per-message + per-session **Sources** panel; citations flow through agent reports and **survive synthesis**. Every rendered `[n]` must resolve to a real source (reviewed adversarially). |
| **D-AH11** | **Memory = profile & preferences + session summaries + projects.** (a) A visible, editable memory store (profile, preferences, standing instructions); the assistant may **propose** saves ("Save to memory?"), never writes silently. (b) Rolling session summaries/compaction for long threads (marked in-transcript, expandable). (c) **Projects** group sessions and pin context (instructions + files) every member session inherits. **No cross-session auto knowledge base** in v1 (owner-rejected). |
| **D-AH12** | **Artifacts: canvas + uploads + review + workspace.** Versioned artifacts (markdown/code/html/table/json) in a side canvas (diff between versions, export md/html/json). File uploads become session/project context. A **review workflow**: a critic role produces anchored comments + suggested edits; the user accepts/rejects per suggestion → a new version. Each session gets a real server-side **workspace** (`/data/hub/ws/<sessionId>/`) with confined file tools and a browsable tree; files can be **promoted to artifacts**. Workspace/skill content is read/written, **never executed** (app invariant). |
| **D-AH13** | **Governance v1 = cost & usage telemetry + audit timeline.** Live per-session/mission cost meters; an Assistant **Usage** view (spend by model/provider/mode over time, mission breakdowns); a global, filterable **Audit** timeline (tool calls, approvals, agent spawns, model calls) derived from `hub_events`. **No policy-controls UI and no data-lifecycle suite** in v1 (delete + prune ride the existing maintenance patterns). |
| **D-AH14** | **Prompt architecture is a first-class deliverable.** Layered assembly (identity → capabilities/tool guidance → citation rules → memory → project → mode addendum → role template → untrusted-content rules), versioned (`HUB_PROMPT_VERSION` stamped on events), snapshot-tested, and **token-budgeted using the app's own TokenCounter** (the app measures its own assistant — dogfooding). |
| **D-AH15** | **Phase 1 is a vertical showcase.** The first shippable slice is thin but complete: full-page Assistant with multi-model chat, MCP tools + citations, one artifact type, AND a minimal parallel mission — every pillar visible early, deepened in later waves. |
| **D-AH16** | **Sequencing.** Plan now; implementation starts **after Unified Sessions Wave 1** (hard contract dependency) **and after Observability's core phases** (owner priority: Observability first). Contract-independent prep WPs (prompt architecture, docs) may fill idle capacity earlier if files don't contend. *At plan time (2026-07-17) the US gate is already satisfied (its ledger shows every WP ticked, Phases 0–5 in the CHANGELOG); Observability has 3 open WPs (2.6, 2.7, 4.5) + 1 in progress (5.5, migration v43 claimed) — verify both ledgers at kickoff.* |
| **D-AH17** | **Auth & spend surfaces.** Provider credentials and the subscription sign-in are reused as-is (Settings stays the home for credentials). Per-message model switching shows provider + cost basis honestly (`$ est. · subscription` reuses the D-CS4/D-CS8 marker conventions). Limit errors surface with an explicit retry-on-another-source affordance (mirrors D-AS14 — never a silent source switch). |
| **D-AH18** | **Verification.** Every wave ends with an **adversarial review WP** (refute, don't summarize); final acceptance seeds realistic sessions/missions through the REAL engine and walks them in **both themes**; e2e smoke is extended; honest-reporting rules apply (unverified = said out loud). |
| **D-AH19** | **Model tiers for build agents** (mirrors D-US13): Opus-class for the contract, turn engine, citations, mission orchestration and all reviews; Sonnet-class for standard implementation; Haiku-class for docs/status upkeep. Every WP carries a model tag. |
| **D-AH20** | **Conventions apply, no exceptions:** branch family `feat/assistant-hub`; gate `corepack pnpm@9.15.4` → `pnpm typecheck && pnpm test && pnpm build && pnpm lint`; contract-first (`packages/shared` first, additive only); brand-ui only + both themes; API runtime/secret boundary (secrets never reach a model context; redacted reads only); migrations claim the **next free `user_version` at claim time** (sibling ledgers may be mid-flight). |

### Requirements annex (added 2026-07-17, owner-requested SOTA research)

The decisions above are refined by a **normative requirement catalog** —
[`requirements.md`](./requirements.md) (R-SES / R-MCP / R-SK / R-UX ids, each MUST/SHOULD-graded
and mapped to its owning WP) — distilled from the researched state of the art in MCP tool
handling, skill handling, and Fable-5-session interaction/visual feedback. Evidence:
[`research/agentic-session-sota/`](../../research/agentic-session-sota/) (docs 00–03,
web-verified 2026-07-17). WP Acceptance includes the WP's MUST-graded requirements; the annex's
WP impact map is authoritative for which requirement binds where.

## 4. Shape of the work

Five waves — full WP detail, file ownership, dependency graph and the orchestrator protocol in
[`execution-plan.md`](./execution-plan.md):

- **Wave 0 — Contract & foundation:** shared hub contract (types/zod/constants), migration +
  repositories, the prompt-architecture module, nav entry + `/assistant` shell + dock relabel,
  the hub tool registry (built-ins + MCP-bridge adapter + grants).
- **Wave 1 — Vertical showcase (D-AH15):** turn engine (AI-SDK kinds), sessions API + SSE,
  conversation UI, MCP tools + citations v1, `claude_subscription` adapter, markdown artifacts v1,
  **mission v1** (planner → plan card → parallel agents → board → synthesis) → adversarial review.
- **Wave 2 — Harness depth:** role library + Agents view, saved crews + advanced topologies
  (pipeline/debate/best-of-N with a mission graph), autonomy dial + hard budgets + steering,
  skills-for-hub, composer power features (slash commands, regenerate/branch, voice input),
  **declarative generative UI** (model-composed forms/tables/charts from a curated `@brand`-part
  catalog — R-GUI1–8, WP2.6) → review.
- **Wave 3 — Knowledge, files & review:** projects + pinned context, memory + Memory view,
  summaries/compaction, uploads + workspace + file tools, artifact diff + review workflow → review.
- **Wave 4 — Enterprise polish:** Usage telemetry, Audit timeline, hardening (orphan
  reconciliation, prune, limits), e2e + a11y + user guide → final review + owner acceptance.

## 5. Non-goals (v1)

- **Background/offline missions** (missions run while the surface is open; a global missions
  inbox + notifications is a flagged future extension).
- **Cross-session auto-learned knowledge base** (owner-rejected; memory is explicit — D-AH11).
- **Policy-controls UI / data-lifecycle suite** (D-AH13; delete + prune only).
- **`vendor_assistant` as a hub model** (D-AH4; revisit with the OpenAI facade experience).
- **Dock changes beyond the label** (D-AH2; D-AS decisions stand; D-US10's dock exclusion stands).
- **Multi-user / team semantics** (single-owner rules; `team-server` implications decided there).
- **Recursive agent spawning** (depth 1 in v1 — D-AH9).
- **Agent-designed screens (A2UI)** — upstream brand-ui WP-11 is unshipped; compose real
  components only (playbook D2).
- **The [P2] register in [`requirements.md`](./requirements.md)** — programmatic tool calling,
  the MCP Apps/tasks extensions, provider-side compaction betas, `/btw`-style side questions,
  session insights, OS push, scheduled sessions — researched, deliberately deferred.
- Replacing the deterministic [`advisor`](../advisor/) or auto-rating pipelines — the Hub may
  *consume* their outputs later; it does not duplicate them.

## 6. Risks & open questions

- **Hot-file contention:** `packages/shared/src/*`, `AppShell.tsx`, `config/env.ts`, Docker files
  are touched by Unified Sessions/Observability too — the orchestrator claims them only when no
  sibling session is writing (same discipline as the vendor-assistant/claude-subscription ledgers).
- **Unified-Sessions module homes:** `SessionClock`/`terminalFor`/capabilities land under
  `apps/api/src/testing/` in US Wave 1. The Hub imports them cross-domain; if that import feels
  wrong in practice, the fix is a **move to a neutral module** (e.g. `apps/api/src/sessions/`)
  coordinated with the US ledger — never a copy-paste fork. Record the outcome in STATUS.
- **Subscription memory wall:** each `claude_subscription` child ≈ 1 GiB; missions must respect
  the shared semaphore (D-CS10) — the planner should prefer API-keyed models for wide fan-outs and
  the board must show queueing honestly (`Queue*`).
- **Citation extraction heterogeneity:** MCP tool results vary wildly; the extractor is
  heuristic-first (urls/titles in structured content) with per-server extensibility — adversarial
  review owns "every [n] resolves".
- **Planner overreach:** structured output with zod + bounded retries; estimates via the existing
  estimate infra; hard budgets regardless (D-AH9).
- **Tool-name collisions** across servers in one session: verify the bridge's namespacing under
  multi-server grants (WP1.4 acceptance).
- **`SpeechInput` availability** depends on browser speech APIs — presentational, feature-detect,
  never a hard dependency (WP2.5).

## 7. Pointers

- Execution: [`execution-plan.md`](./execution-plan.md) · [`requirements.md`](./requirements.md)
  (normative R-catalog) · [`kickoff-prompt.md`](./kickoff-prompt.md) · [`STATUS.md`](./STATUS.md)
- Research evidence: [`research/agentic-session-sota/`](../../research/agentic-session-sota/)
  (00 Fable-session anatomy · 01 MCP tool handling · 02 skills · 03 interaction & feedback ·
  04 generative UI / Agent2UI — Thesys OpenUI · CopilotKit · assistant-ui, with the
  system-prompt playbook and the `@brand/ai` gap list)
- Context this builds on: [`roadmap/unified-sessions/`](../unified-sessions/) (session contract),
  [`roadmap/claude-subscription/`](../claude-subscription/) (subscription executor patterns),
  [`roadmap/assistant/`](../assistant/) (the dock — what this is NOT),
  [`roadmap/observability/`](../observability/) (sequencing sibling),
  `vendor/brand-ui-agent-kit/llms/ai.txt` + `playbooks/ai-assistant.md` (the component vocabulary).
