# Assistant Hub — execution plan (orchestrator + subagents)

Executed by an **orchestrator session driving parallel worktree subagents** (the
unified-sessions protocol). Every WP declares: goal, owned files (exclusive — the
conflict-avoidance contract), dependencies, model tier (D-AH19), and acceptance. Decisions
D-AH1…20 ([README](./README.md)) are fixed input — a WP that thinks a decision is wrong STOPS
and writes a STATUS blocker.

Context every agent gets: this folder's README + this plan, `CLAUDE.md`, `.claude/rules/*`,
`vendor/brand-ui-agent-kit/llms/ai.txt` + `playbooks/ai-assistant.md`, and (from their WPs
onward) the Unified-Sessions contract modules. Gate per WP: `corepack pnpm@9.15.4` →
`pnpm typecheck && pnpm test` (+ `pnpm build` at wave integration only — parallel builds OOM).

---

## 1. Contract reference (Wave 0 defines it; every later wave consumes it)

### 1.1 Naming & namespaces (D-AH2)

UI **"Assistant"** · nav below Dashboard (icon: `Bot`) · web routes `/assistant`,
`/assistant/s/:sessionId`, `/assistant/agents`, `/assistant/projects`, `/assistant/usage`,
`/assistant/audit` (real URL routing — repo rule). Internal domain **`hub`**: `apps/api/src/hub/`,
`apps/web/src/features/hub/`, `/api/hub/*`, `hub_*` tables, `HUB_*` env/constants, `Hub*` types.
Dock label → **"App assistant"** (copy only).

### 1.2 Session model

`hub_sessions.kind`: `chat` (user-facing thread) | `agent` (a mission member; carries
`parent_session_id` + `mission_id`). Session modes (D-AH5):
`HUB_SESSION_MODES = ["chat","research","mission"]`; mission adds
`topology: "parallel"|"pipeline"|"debate"|"best_of_n"`, `autonomy: "always_ask"|"threshold"|"auto"`,
optional `crewId`. Sessions adopt the Unified-Sessions contract verbatim: `status` + `phase`
(`queued`/`starting`/`waiting_input`/`stopping`), `stopReasonCode`, `capabilities_json`,
`SessionClock` (stall + wait budgets; wait pauses the clock), `ended` terminal via `terminalFor`,
durations. **Never re-derive from providerKind — gate on capabilities** (D-US4 discipline).

### 1.3 Data model (migration: claim the next free `user_version` at claim time)

| Table | Purpose (columns sketched — the WP finalizes) |
|---|---|
| `hub_projects` | id, name, description, instructions, timestamps, archived_at |
| `hub_sessions` | id, project_id?, kind, parent_session_id?, mission_id?, title (+auto-title state), mode, topology?, autonomy?, model, status, phase, stop_reason_code?, capabilities_json, budgets_json, prompt_version, cost_usd, tokens_in/out, created/updated/ended_at, seen |
| `hub_events` | session_id, seq, type, payload_json, created_at — **append-only**; the AG-UI rule holds: a session's full state is reconstructible from its event log alone |
| `hub_agents` | the role library (D-AH7): id, name, description, icon, system_prompt, default_model, tool_grants_json (MCP servers + per-tool allowlists + hub built-ins), skill_ids_json, target, expected_outcome, budgets_json, timestamps, archived_at |
| `hub_crews` | id, name, description, topology, members_json (agent ids + per-member overrides), timestamps |
| `hub_missions` | id, session_id (parent chat), status (`proposed→approved→running→synthesizing→completed|stopped|failed`), topology, autonomy snapshot, plan_json (frozen: per-agent role snapshot, brief, model, grants, budgets, rationale, cost estimate), budgets_json, cost_usd, started/ended_at |
| `hub_artifacts` / `hub_artifact_versions` | typed artifacts (markdown/code/html/table/json) + immutable versions (content, note, author kind/ref) |
| `hub_reviews` | artifact review (D-AH12): base_version, status, comments_json (anchored; per-comment decision), reviewer ref, timestamps |
| `hub_files` / `hub_file_links` | content-addressed uploads (sha256, mime, bytes, content) + links to project/session/message/artifact with a role (upload/pinned/produced) |
| `hub_memory` | kind (`profile`/`preference`/`instruction`), content, source (`user`/`assistant_proposed`), status, timestamps |
| `hub_session_summaries` | session_id, upto_seq, content, tokens, created_at |

Workspace (not a table): `/data/hub/ws/<sessionId>/` on the `/data` volume; pruned with the
session (and by the maintenance endpoint, Wave 4).

Event types (closed union in shared constants; additive later): `user_message`,
`assistant_message` (settled; carries model, usage, citations, artifacts touched),
`reasoning`, `tool_call`, `tool_result`, `phase`, `plan_proposed`, `plan_updated`,
`plan_approved`, `mission_started`, `agent_spawned`, `agent_report`, `mission_synthesis`,
`artifact_created`, `artifact_updated`, `review_opened`, `review_decided`, `memory_proposed`,
`memory_saved`, `file_uploaded`, `workspace_file_changed`, `branch_created`, `limit_error`,
`error`, `turn_done`, `ping`. Streaming text deltas are forwarded over SSE but **not persisted**
(settled events only — the dock's code-quest lesson).

### 1.4 Wire & routes (contract-first: `packages/shared` types/zod/constants FIRST, additive only)

```
Projects   GET/POST /api/hub/projects · PATCH/DELETE /api/hub/projects/:id
Sessions   GET/POST /api/hub/sessions (filter: project, kind) · GET /api/hub/sessions/:id (replay)
           PATCH /api/hub/sessions/:id (title/model/autonomy) · DELETE /api/hub/sessions/:id
Turns      POST /api/hub/sessions/:id/messages (text + attachments + per-message model override)
           GET  /api/hub/sessions/:id/stream (SSE: seq ids, replay-then-live, ping)
           POST /api/hub/sessions/:id/{stop,end,seen} · POST /api/hub/sessions/:id/branch
Missions   POST /api/hub/missions/:id/{approve,stop} · PATCH /api/hub/missions/:id (edit plan)
           POST /api/hub/missions/:id/agents/:agentSessionId/{steer,stop}
Library    CRUD /api/hub/agents · CRUD /api/hub/crews
Artifacts  GET/POST /api/hub/artifacts · GET /api/hub/artifacts/:id/versions
           POST /api/hub/artifacts/:id/reviews · PATCH /api/hub/reviews/:id (decisions)
           GET /api/hub/artifacts/:id/export?format=md|html|json
Files      POST /api/hub/files · GET /api/hub/files/:id · link/unlink
Memory     GET/POST/PATCH/DELETE /api/hub/memory
Workspace  GET /api/hub/sessions/:id/workspace (tree) · GET …/workspace/file?path=…
           POST …/workspace/promote (file → artifact)
Governance GET /api/hub/usage (aggregates) · GET /api/hub/audit (filterable event query)
```

Mission planning is **in-band**: in mission mode the planner turn emits `plan_proposed`; approval
is `POST /api/hub/missions/:id/approve` (or auto per the dial). SSE reuses the `streamRun`
template; once US Wave 2 lands, `id: <seq>` + `Last-Event-ID` cursor resume + `{type:"ping"}`
apply here identically.

### 1.5 Turn engine (D-AH3)

`apps/api/src/hub/turn-engine.ts` — per settled user message: assemble the prompt (§1.8) →
resolve the model (**AI-SDK kinds** via `providers/registry.modelFor` + `streamText`;
**`claude_subscription`** via an `AgentSessionDriver` adapter sharing the D-CS10 semaphore) →
expose tools (§1.6) → stream (deltas over SSE; settled events persisted) → meter (token counting;
`MODEL_PRICING`; subscription shadow-cost per D-CS8, marked per D-AH17) → terminal via
`terminalFor`, clocked by `SessionClock`. Capability manifests declared per kind, persisted,
emitted at start. The engine **never** touches `runs`/`run_steps`/`run_events`.

### 1.6 Tools (registry + grants)

`apps/api/src/hub/tools/` — one registry, three sources:
1. **Built-ins** (in-process, zod-typed): workspace `files.{list,read,write,edit}` (confined to
   the session workspace; never executed), `artifacts.{create,update}`, `memory.propose_save`,
   and (planner-only) `mission.propose_plan`.
2. **MCP tools** via the existing bridge translation (reuse `testing/tool-bridge.ts` exports;
   additive export extraction is allowed, behavior changes are not — testing tests stay green).
   Grants resolve per session/role: `{server → all | [toolNames]}` (D-AH7). Verify cross-server
   name collisions are namespaced.
3. **Skills**: attached at session or role level; materialized read-only (inline for AI-SDK
   context or workspace files for the SDK path — both mechanics exist); metered with the app's
   counters; **never executed**.

Tool results are UNTRUSTED input (prompt-injection rules in the system prompt; no exec, no
secrets in any tool schema; redacted reads only — the D-AS17 sandbox posture applies).

### 1.7 Citations (D-AH10)

Shared type `HubCitation { id, url?, title, snippet?, toolCallRef?, agentRef?, fileRef? }`.
`hub/citations.ts` extracts candidate sources from every tool result (structured content first,
url/title heuristics second; per-server extensibility), numbers them stably per session, and
injects a compact numbered source list into the model's tool-result envelope. Models are
instructed (§1.8) to cite `[n]`; a deterministic post-pass maps markers → `citations[]` on the
settled `assistant_message`. Agent reports carry their citations; synthesis re-numbers and
preserves them (**every rendered [n] resolves** — reviewed adversarially). UI: `InlineCitation*`
chips + a `Sources` panel per message and per session.

### 1.8 Prompt architecture (D-AH14)

`apps/api/src/hub/prompting/` — layered assembly with **per-section token budgets measured by
the app's own TokenCounter** (budget tests fail the gate when a section bloats):
`identity → capabilities & tool guidance → citation rules → memory (profile/preferences/instructions)
→ project instructions → mode addendum (chat|research|mission-planner|synthesizer|critic)
→ role template (agents) → untrusted-content & safety rules`.
`HUB_PROMPT_VERSION` stamped on every `assistant_message`; snapshot tests per mode; prompt text
lives in versioned TS modules (no scattered string literals).

### 1.9 `@brand/ai` component map (build vocabulary — the UI WPs compose these, they don't hand-roll)

| Feature | Components |
|---|---|
| Shell & transcript | `ChatShell`, `Conversation*`, `Message*`, `MessageResponse`, `UserMessage`, `Shimmer`, `Suggestions` |
| Composer | `PromptInput*` (+`PromptInputCommand` slash menu, `PromptInputActionAddAttachments`), `ModelSelector*`, `SpeechInput` |
| Reasoning & tools | `Reasoning*`, `ChainOfThought*`, `Tool*`, `ToolResultCard`, `SchemaDisplay*` |
| Citations | `InlineCitation*`, `Sources*`, `Source`, `EvidenceChip`, `ChainOfThoughtSearchResult(s)` |
| Missions | `Plan*` (plan card), `ApprovalCard*`/`Confirmation*`, `Agent*`, `AgentTimeline`, `Queue*`, `Node`/`Edge`/`Canvas`/`Panel`/`Controls` (topology graph), `Checkpoint*`, `Persona` |
| Artifacts & files | `Artifact*`, `CodeBlock*`, `MarkdownView`, `FileTree*`, `ProducedAssetTree`, `AssetPreview`, `Attachment*`, `Commit*` (review change summaries), `WebPreview*` (html artifacts) |
| Usage & context | `Context*` (input/output/cache/reasoning usage), `ContextPanel*` |
| Branching | `MessageBranch*` (regenerate variants; `branch_created` events; sibling-variant selection) |

Boundary rule from the playbook: `@brand/ai` is presentational — the app owns transport/runtime.
⚠ **The vendored agent kit (1.6.0) lags the live library** (owner recheck 2026-07-17): the live
Storybook additionally ships `Charts/AutoChart` (LLM-tool-call-native `ChartSpec`, never-throws
fallbacks — the R-GUI chart contract, wired to the chat stack via the `ai-chart` registry
block), `AI/ChangeReview` (the "AI-edit trust gate" — hunk-by-hunk accept/reject with model/run
provenance; WP3.5's review surface), `AI/Gallery`, `AI/InteractiveTerminal`, and
`Patterns/Templates/AI Assistant` · `Patterns/Scenarios/Agentic AI Workspace`. **Every UI WP
verifies components against the running Storybook / `pnpm exec brand-ui`, never the tarball
manifest alone.** Remaining upstream gaps (research doc 04 §5 — in-message forms with
validation, model-emittable tables, part-grouping engine, message edit-in-place): compose from
`@brand` primitives and raise upstream per `library-first.md`; WP2.6 owns the filing.

### 1.10 Env (`config/env.ts` + `.env.example`)

`HUB_MAX_ACTIVE_SESSIONS` (4) · `HUB_MISSION_MAX_AGENTS` (6) · `HUB_MISSION_MAX_PARALLEL` (3) ·
`HUB_DEFAULT_AUTONOMY` (`always_ask`) · `HUB_AUTONOMY_ASK_ABOVE_AGENTS` (3) /
`HUB_AUTONOMY_ASK_ABOVE_USD` (1.00) · `HUB_MISSION_DEFAULT_BUDGET_USD` (2.00) ·
`HUB_SESSION_IDLE_RELEASE_MS` (release-on-reply default, D-AS25 lesson) ·
`HUB_WS_RETENTION_DAYS` · `HUB_AUTO_TITLE` (deterministic-then-LLM-refine, D-AS26 pattern).
Stall/wait defaults inherit the Unified-Sessions settings. The requirements annex adds the
tool/skill budget knobs: `HUB_TOOL_LOADING_DEFAULT` (`deferred`) ·
`HUB_TOOL_SEARCH_AUTO_FRACTION` (0.10) · `HUB_MCP_OUTPUT_WARN_TOKENS` (10000) /
`HUB_MCP_OUTPUT_MAX_TOKENS` (25000) · `HUB_SKILL_LISTING_BUDGET_FRACTION` (0.01) ·
`HUB_SKILL_ENTRY_MAX_CHARS` (1536) · `HUB_SKILL_COMPACTION_TOKENS_PER_SKILL` (5000) /
`HUB_SKILL_COMPACTION_TOKENS_TOTAL` (25000) · `HUB_GENUI_MAX_REPAIR_ATTEMPTS` (2).

### 1.11 Requirements annex (normative)

[`requirements.md`](./requirements.md) — the R-catalog (R-SES/R-MCP/R-SK/R-UX/R-GUI,
MUST/SHOULD/[P2]) distilled from
[`research/agentic-session-sota/`](../../research/agentic-session-sota/) docs 00–04 (04 adds
declarative generative UI from Thesys OpenUI / CopilotKit / assistant-ui, incl. the §4
system-prompt playbook WP0.3 implements and the `@brand/ai` upstream gap list WP2.6 files).
**A WP's Acceptance includes its MUST-graded requirements per the annex's WP impact map**
(the map governs; the `Req:` tags on WPs below are reminders). Highlights that sharpen §1:
deferred-tool-loading + tool-search with live measured savings (R-MCP2), annotation-informed
approval defaults (R-MCP3), MCP elicitation through the existing schema→form generator
(R-MCP4), skill L1 listing budgets with demotion (R-SK1), the steering queue + Stop contract
(R-SES3), the session task widget (R-SES4), the context inspector (R-SES7), and the inline tool
state machine with approval states (R-UX1).

---

## 2. Work packages

Effort: S ≤ half day · M ≈ 1 day · L > 1 day (agent-time, incl. tests). Every WP: additive-only
on `packages/shared`/db; hub never writes testing tables; both themes for UI; honest reporting.

### Wave 0 — Contract & foundation

**WP0.1 — Shared hub contract** · **Opus-class** · M · deps: —
Owns: `packages/shared/src/{types,schemas,constants}.ts` (additive only).
Adds: `Hub*` types + zod for sessions/modes/events/citations/roles/crews/missions
(plan + **structured agent report**: findings, citations, artifacts, confidence, open
questions), artifacts/reviews/files/memory; event-type + mode unions; defaults. Branch-variant
linkage (`branch_created`, variant refs) is in the contract from day one. Part-contract
refinements from research doc 04: tool parts carry `args` + raw `argsText` and split
model-visible vs UI-visible result channels (`modelContent` / `artifact`); approval payloads
carry option kinds (`allow-once/always`, `grants`, `isAutomatic`, terminal `resolution`); a
`generative-ui` part type + per-message UI-state events (R-GUI3/5). Acceptance: exhaustive
zod round-trip tests; old shared consumers untouched (typecheck green repo-wide).

**WP0.2 — Migration + repositories** · Sonnet-class · M · deps: WP0.1
Owns: `apps/api/src/db/schema.ts` + `database.ts` (migration entry — **claim the next free
`user_version`**), NEW `apps/api/src/hub/repository.ts` (+ tests).
All §1.3 tables; forward-migration test (existing DB gains tables; fresh DB stamps latest);
append-only event writes with per-session `seq`; replay query.

**WP0.3 — Prompt architecture** · **Opus-class** · M · deps: WP0.1
Owns: NEW `apps/api/src/hub/prompting/**`.
§1.8 in full: layered assembly, mode addenda, role templating, `HUB_PROMPT_VERSION`, snapshot
tests, **TokenCounter budget tests**. Applies the research-doc-04 §4 prompt playbook throughout:
silent tool calls + per-part description formula, WRONG/RIGHT contrastive pairs, vocabulary
clamps with a legal fallback, streaming-order instruction, closing self-verification checklist,
the design-rules block (tokens only), and the catalog-compilation seam WP2.6 plugs into
(R-GUI1/2). This is a flagship deliverable (D-AH14) — prompt quality is reviewed, not just
presence. Req: R-SES7 (section budgets feed the context inspector), R-UX9, R-GUI1/2 (prompt
side).

**WP0.4 — Nav, shell & dock relabel** · Sonnet-class · S · deps: —
Owns: `apps/web/src/components/AppShell.tsx` (nav lines only), `apps/web/src/App.tsx` (route),
NEW `apps/web/src/features/hub/AssistantView.tsx` (empty `ChatShell` scaffold + empty states),
dock label call sites (`AssistantDock` header copy, TopNav toggle aria/title → "App assistant").
Acceptance: `/assistant` renders the scaffold in both themes; dock relabel verified; no dock
behavior change (its tests stay green). ⚠ Coordinate: `AppShell.tsx` is a hot file (Wave-3 US
work touches TopNav areas) — claim when free.

**WP0.5 — Tool registry core** · Sonnet-class · M · deps: WP0.1, WP0.2
Owns: NEW `apps/api/src/hub/tools/**` (registry, built-ins, grants resolution, MCP-bridge
adapter; workspace helpers under `apps/api/src/hub/workspace.ts`).
§1.6: built-ins against the repos; bridge adapter reusing `testing/tool-bridge` translation
(additive export extraction allowed — testing tests stay green); per-role/session grant
resolution; collision-namespacing test with two stub servers. Adds the `tasks.*` built-ins and
the deferred-mode registry: per-session `toolLoadingMode` (reuse `TOOL_LOADING_MODES`), a
tool-search built-in, alwaysLoad pins, the auto heuristic, annotation-informed approval policy
core, and the 10K/25K output-cap + workspace-spill path. Req: R-MCP1–3, R-MCP6–7, R-SK1–3
(plumbing), R-SES4.

### Wave 1 — Vertical showcase (D-AH15)

**WP1.1 — Turn engine (AI-SDK path)** · **Opus-class** · L · deps: WP0.2, WP0.3, WP0.5
Owns: NEW `apps/api/src/hub/turn-engine.ts`, `hub/session-service.ts`, `hub/capabilities.ts`.
§1.5 for `anthropic`/`openai`/`google`/`openai_compatible`/`ollama`: streaming, settled-event
persistence, metering + pricing, SessionClock + terminalFor + capabilities, release-on-reply,
per-message model override, auto-title (deterministic → refine). Includes the **steering
contract**: durable queued-message events injected at step boundaries, Stop preserving completed
work with an explicit note. Unit tests with a stubbed model (the AI-SDK mock pattern the testing
engine tests use). Req: R-SES3, R-SES10–11, R-UX3 (phase events), R-MCP5 (progress/cancel
plumbing).

**WP1.2 — Sessions API + SSE** · Sonnet-class · M · deps: WP1.1
Owns: NEW `apps/api/src/hub/routes.ts` (+ mount line in `apps/api/src/index.ts`).
§1.4 projects/sessions/turns/stop/end/seen; SSE on the `streamRun` template (replay-then-live,
heartbeat/ping); startup orphan reconciliation (index.ts pattern); 409 while no provider
credential exists (mirrors the dock's gate posture).

**WP1.3 — Conversation UI** · Sonnet-class · L · deps: WP1.2 (types from WP0.1)
Owns: NEW `apps/web/src/features/hub/**` (SessionRail, ConversationPane, composer,
NewSessionDialog with mode picker, `use-hub-stream.ts`), `apps/web/src/lib/api.ts` (additive fns).
§1.9 composition: `Conversation*`/`Message*`/`MessageResponse`/`Reasoning*`/`Tool*`,
`PromptInput*` + `ModelSelector` (per-message override + session default), `Shimmer`,
`Suggestions` empty state, seq-dedup replay client (`use-run-stream` pattern; loading-states
rule). Renders the R-UX1 tool state machine inline, the live task widget (`Task`/`Plan`), the
context gauge, composer queueing-while-running, elapsed tickers + phase chips. Both themes;
keyboard path (compose, send, queue, stop). Req: R-SES2–4, R-SES7 (gauge), R-SES10,
R-UX1–3, R-UX10, R-UX12.

**WP1.4 — MCP tools + citations v1** · **Opus-class** · L · deps: WP1.1 (server), WP1.3 (render)
Owns: NEW `apps/api/src/hub/citations.ts`, session tool-grant wiring in `session-service`
(server-level grants v1), web `SourcesPanel.tsx` + citation rendering in ConversationPane.
§1.7 end-to-end: extraction → numbered envelope → `[n]` post-pass → `InlineCitation*` + `Sources`.
Research mode addendum activates citations-first behavior. Acceptance includes the resolve-test:
no rendered marker without a source, no source list drift across turns. Also owns the MCP
interaction depth: annotation display on approval cards, **elicitation** (form mode via the
existing schema→form generator + URL mode with the spec's UX MUSTs; `waiting_input` phase),
progress bars + cancel on tool parts, structured-output typed rendering, output-cap spill cards,
per-server status chips. Req: R-MCP3–7, R-MCP11, R-UX5.

**WP1.5 — Subscription adapter** · Sonnet-class · M · deps: WP1.1
Owns: NEW `apps/api/src/hub/subscription-adapter.ts`.
`claude_subscription` sessions: `AgentSessionDriver` loop under the **shared D-CS10 semaphore**,
`queued` phase while gated, exact tokens from `turn_done.usage`, shadow cost (D-CS8) marked per
D-AH17, limit-error → explicit retry-on-other-source affordance event.

**WP1.6 — Artifacts v1 (markdown)** · Sonnet-class · M · deps: WP0.5 (tool), WP1.3 (canvas)
Owns: NEW artifact routes section (`hub/routes.ts` artifact block — sequence with WP1.2),
`apps/web/src/features/hub/ArtifactCanvas.tsx`.
`artifacts.create/update` built-ins live; canvas panel (`Artifact*` + `MarkdownView`), version
list (no diff yet), export md/html/json **plus the self-contained `share.html` export**
(styles inlined, no app/network dependency, version-pinned, citations preserved — R-UX13).

**WP1.7 — Mission v1 (parallel)** · **Opus-class** · L · deps: WP1.1, WP1.4; UI: WP1.3
Owns: NEW `apps/api/src/hub/missions/**` (planner, orchestrator, synthesis), web
`MissionPlanCard.tsx` + `MissionBoard.tsx`.
The flagship slice: mission mode → planner (structured output; roles ad-hoc in v1; models +
grants + budgets + rationale + estimate) → editable `Plan*` card + `ApprovalCard` →
approve → parallel child sessions (caps honored; isolated contexts; briefs in) → live board
(per-agent card: status, stream, cost ticker; stop per agent; stop mission) → structured
reports → synthesis message **citing agent reports** (their citations preserved). Budget trip →
clean stop + partial synthesis, honestly marked. Replay renders the whole mission inert.

**WP1.R — Wave-1 adversarial review** · **Opus-class** · M · deps: WP1.1–1.7
Read-only + test-authoring. Tries to REFUTE: (1) event-log reconstruction (any session/mission
fully rebuilt from `hub_events` alone); (2) citation integrity (§1.7 resolve-test, incl. through
synthesis); (3) domain isolation (no testing-table writes — grep + runtime test; dock untouched);
(4) budget enforcement under races (parallel agents tripping one budget); (5) both-theme visual
walk of chat + mission. Findings → STATUS blockers → owning WP fixes → re-verify.

### Wave 2 — Harness depth

**WP2.1 — Role library + Agents view** · Sonnet-class · L · deps: WP0.2; UI after WP1.3
Owns: agents/crews routes block, NEW `apps/web/src/features/hub/agents/**`.
D-AH7 CRUD: full role definition (system prompt editor, model default, **MCP server + per-tool
grant picker**, skills, target, expected outcome, budgets); planner draws from the library
(prefers library roles; ad-hoc stays allowed); `Persona` in cards/boards.

**WP2.2 — Crews + topologies** · **Opus-class** · L · deps: WP1.7, WP2.1
Owns: `hub/missions/topologies.ts` (+ orchestrator changes), web mission-graph
(`Node`/`Edge`/`Canvas`) + crew builder in the Agents view.
Saved crews (instantiable by user or planner); `pipeline` (ordered hand-offs: each stage's report
feeds the next brief), `debate` (alternating adversarial turns + a resolver), `best_of_n`
(N independent attempts + a **blind** judge). Topology graph rendered live on the board.

**WP2.3 — Autonomy dial + budgets + steering** · Sonnet-class · M · deps: WP1.7
Owns: the steer route + autonomy resolution (the approve/stop routes land with mission v1 in
WP1.7), web dial UI + steer composer on agent cards + `Queue*` for capped parallelism.
`always_ask`/`threshold` (env-config thresholds)/`auto`; hard caps enforced server-side
regardless of dial; steering injects a user message into the child session mid-flight.

**WP2.4 — Skills for hub** · Sonnet-class · M · deps: WP0.5, WP1.5
Owns: skill attachment (session + role), materialization per path (inline for AI-SDK, workspace
for SDK), footprint display (app's own counters) in session settings.
Skills never execute; metering marked estimated where local (D-CS9 convention). Implements the
SOTA loading discipline: L1 listing budget (1% window, 1,536-char truncation, least-invoked
demotion to name-only), enum-constrained `skills.load` for L2/L3 with dedupe +
compaction-protection budgets, per-attachment invocation controls, frontmatter-superset display,
per-session L1/L2/L3 cost in the context inspector, trigger-quality badge links. Req: R-SK1–6,
R-SK8.

**WP2.5 — Composer power features** · Sonnet-class · M · deps: WP1.3
Owns: composer additions (`PromptInputCommand` slash menu: modes/crews/roles/artifacts, skill
invocation `/skill-name args`, MCP prompts `/mcp__server__prompt` with argument forms),
regenerate + `MessageBranch*` variants (uses WP0.1 branch contract + `/branch` route),
plan-first toggle, `SpeechInput` voice input (feature-detected, presentational only).
Req: R-SES5, R-SES6 (branch UI), R-MCP8, R-SK3 (slash), R-UX10.

**WP2.6 — Declarative GenUI (catalog → prompt → validate → render → round-trip)** ·
**Opus-class** · L · deps: WP0.3, WP0.5, WP1.3
Owns: NEW `apps/api/src/hub/genui/**` (catalog registry [zod] → prompt-catalog compiler +
JSON-schema validator + bounded machine-hinted repair loop, `present`/`prompt_user` tool,
two-tier action handling with dual-audience payloads, per-message UI-state persistence), NEW
`apps/web/src/features/hub/genui/**` (allowlisted renderer over `@brand`-part-backed catalog
components: **charts = `@brand/charts` `AutoChart` with `ChartSpec` adopted as the contract**
(+ the `ai-chart` registry-block composition), forms w/ declarative validation, tables,
stat/KPI, media, layout; streaming-tolerant parent-first rendering; recovery card). Where a
catalog component has no live-library counterpart (in-message forms, model-emittable tables —
see research doc 04 §5, corrected against the live Storybook), **compose from `@brand`
primitives and file the upstream gap** per `library-first.md`; never hand-roll.
Req: **R-GUI1–8**.

**WP2.R — Wave-2 adversarial review** · **Opus-class** · M · deps: WP2.1–2.6
Refutes: pipeline ordering (a stage never starts before its input settles), debate turn
alternation + resolver neutrality, best-of-N judge blindness (judge sees attempts, not authors'
models), autonomy-threshold bypass attempts (server refuses un-approved launches), branch
variant integrity on replay; **GenUI security** (allowlist bypass, style/prop injection,
`javascript:`/unvetted `src` URLs, repair-loop exhaustion honesty — R-GUI2/4/8) and GenUI
replay fidelity (per-message UI state event-sourced — R-GUI5/R-SES1).

### Wave 3 — Knowledge, files & review

**WP3.1 — Projects + pinned context** · Sonnet-class · M · deps: WP1.2
Owns: project routes + web project grouping in SessionRail + project settings (instructions,
pinned files). Prompt injection via WP0.3's project section; pinned context visible per session
(`ContextPanel` section).

**WP3.2 — Memory + Memory view** · Sonnet-class · M · deps: WP0.3
Owns: memory routes, `memory.propose_save` flow (proposal chips in transcript → explicit save),
NEW web Memory panel (list/edit/archive; source shown).
Nothing hidden: everything injected is inspectable (D-AH11).

**WP3.3 — Summaries & compaction** · **Opus-class** · M · deps: WP1.1
Owns: `hub/compaction.ts` + summary persistence + transcript markers ("earlier turns compacted"
+ expand) + context-window management per model capability.
Order of operations per the reference harness: clear old tool outputs first (hot/cold split),
summarize only after; user-aimable summaries; thrash-stop error; invoked skill bodies re-attach
within the R-SK budgets. Fidelity reviewed: compaction never silently drops user constraints
(test with seeded constraint-recall probes). Req: R-SES8.

**WP3.4 — Uploads + workspace + file tools** · Sonnet-class · L · deps: WP0.5, WP1.3
Owns: files routes, composer `Attachments`, workspace FS lifecycle + `FileTree` panel +
`ProducedAssetTree` in transcript + promote-to-artifact.
Confinement tests (path traversal, size caps — reuse the skills zip-bomb-guard constants
pattern); multimodal pass-through to capable models. Also: MCP **resource** attachment
(@-mention picker over scanned + live `resources/list`, metered as context), the output-cap
spill target, and content-addressed workspace snapshots powering checkpoint restore.
Req: R-MCP7 (spill), R-MCP9, R-SES6.

**WP3.5 — Artifact diff + review workflow** · Sonnet-class · L · deps: WP1.6
Owns: review routes, version diff (@brand/editor diff view), review mode UI (anchored comments,
accept/reject per suggestion → new version — rendered on **`AI/ChangeReview`**, the live
library's hunk-by-hunk "AI-edit trust gate" with `ChangeProvenance` [author/model/run], not on
`Commit*` improvisation), critic role wiring (review request spawns a critic agent per D-AH7
library role).

**WP3.R — Wave-3 adversarial review** · **Opus-class** · M · deps: WP3.1–3.5
Refutes: workspace escape (traversal/symlink/size), memory-injection correctness (exactly the
visible store, nothing else), compaction fidelity probes, upload parsing safety, review
accept/reject → version lineage integrity.

### Wave 4 — Enterprise polish

**WP4.1 — Usage telemetry** · Sonnet-class · M · deps: WP1.1 (+ missions data)
Owns: `GET /api/hub/usage` aggregates, NEW web Usage view (spend by model/provider/mode/day,
mission breakdowns — @brand/charts + the dataviz discipline), in-session `Context*` meters, and
the **context inspector** (per-layer window breakdown with real token counts: prompt sections,
eager vs deferred tool definitions, skill L1/L2/L3, memory, project, history — the flagship
dogfood surface). Req: R-SES7, R-UX6 (plan-acceptance metric), R-UX8.

**WP4.2 — Audit timeline** · Sonnet-class · M · deps: WP1.2
Owns: `GET /api/hub/audit` (filterable: session, kind, tool, time), NEW web Audit view
(tool calls, approvals, spawns, model calls; deep-links into session replay).

**WP4.3 — Hardening** · Sonnet-class · M · deps: Waves 1–3
Owns: orphan reconciliation breadth (missions mid-flight at boot → honest interrupted terminals),
`POST /api/maintenance/prune-hub` (sessions/workspaces/files retention), limit-error UX polish
(retry-on-other-source), capability-gating verification for `google`/`openai_compatible`/`ollama`
(each with a stubbed catalog), Docker notes (`/data/hub/**` paths).

**WP4.4 — e2e + a11y + user guide** · Sonnet-class (e2e) + Haiku-class (docs) · M · deps: WP4.1–4.3
Owns: `e2e/smoke.spec.ts` extension (open Assistant, send a stubbed-model message, approve a
stubbed mission, artifact appears), keyboard + both-theme walk scripts, NEW
`user-guide/16-assistant-hub.md` (claim the next free number at build time) + retitle
`user-guide/12-assistant.md` to "App assistant" (the D-AH2 relabel), the **research-server
recipe** (R-MCP13: curated search/fetch MCP presets in the add-server flow + a user-guide
recipe section + research-mode empty-state link), `CHANGELOG.md` entry, CLAUDE.md north-star
row update.

**WP4.R — Final review + owner acceptance** · **Opus-class** · M · deps: WP4.4
Seeds realistic sessions (each mode, each topology, budget-trip, branch, review flow) through
the REAL engine; walks both themes; assembles the **owner-acceptance list** (live provider keys,
subscription contention behavior, voice input availability, real MCP search server for research
mode) in STATUS — never fakes what needs a live credential.

---

## 3. Dependency graph & parallel groups

```
WP0.1 ──┬── WP0.2 ──┬── WP0.5 ──┬───────────── WP1.1 ──┬── WP1.2 ── WP1.3 ──┬─ WP1.4* ─┐
        │           │           │ (0.3 feeds 1.1)      ├── WP1.5            ├─ WP1.6   ├─ WP1.7 ── WP1.R
        ├── WP0.3 ──┘           │                      │                    └─ (UI)    │
        └── WP0.4 (∥ anytime)   │                      └───────────────────────────────┘
Wave 2: [2.1 ∥ 2.3 ∥ 2.4 ∥ 2.5 ∥ 2.6] → 2.2 → 2.R    (* 1.4 spans api+web; orchestrator may split)
Wave 3: [3.1 ∥ 3.2 ∥ 3.3 ∥ 3.4] → 3.5 → 3.R
Wave 4: [4.1 ∥ 4.2 ∥ 4.3] → 4.4 → 4.R
```

Max useful parallelism ≈ 4 implementation agents. File-ownership above is the contract — two
WPs never own the same file; the deliberate seams (`hub/routes.ts` 1.2 → 1.6 → 2.1 blocks;
`AppShell.tsx` in 0.4; `index.ts` mount in 1.2) are sequenced by the orchestrator.
**Cross-workstream contention:** `packages/shared`, `config/env.ts`, `AppShell.tsx`,
`e2e/smoke.spec.ts` — claim only when no sibling (unified-sessions, observability) session holds
them; check their ledgers first.

## 4. Orchestrator protocol

1. **Gates first (D-AH16):** before Wave 0 implementation, confirm Unified Sessions Wave 1 is
   merged (the contract modules exist) and Observability's core phases are done or the owner has
   explicitly released capacity. WP0.3/WP0.4 and docs may run early if files are free.
   *At plan time (2026-07-17): US is fully ticked (gate satisfied); Observability's tail is
   WP 2.6/2.7/4.5 open + 5.5 in progress (migration v43 claimed — mind migration numbering).*
2. One orchestrator session per wave; subagents in **isolated worktrees** off
   `feat/assistant-hub`; per-WP kickoff = the WP text verbatim + the D-AH table + owned files +
   required reading (§1 refs, `llms/ai.txt`, playbook) + model tag + the gate + "additive-only on
   shared/db; hub never writes testing tables; if a locked decision seems wrong, STOP and write a
   STATUS blocker".
3. **Model assignment** per WP tag (D-AH19); step DOWN only for implementation WPs when the tier
   is unavailable — never for reviews (reviews wait).
4. **Reviews refute** (D-AH18): every wave merges only after its WP*.R passes; findings become
   STATUS blockers fixed by the owning WP's agent, then re-verified.
5. **STATUS.md upkeep** after every WP (Haiku-class bookkeeping agent): id, verdict, gate result,
   files touched, blockers, next. Never edit history.
6. **Escalate to the owner** only for: a locked decision proven wrong by evidence; unforeseen
   file-ownership conflict; anything needing live credentials (provider keys, a real MCP search
   server, subscription sign-in) — those are owner-acceptance items, never faked.
7. **Merge discipline:** WP branch → wave integration branch → `feat/assistant-hub` after the
   wave review; `pnpm build` once per wave integration; owner merges to `main`.
