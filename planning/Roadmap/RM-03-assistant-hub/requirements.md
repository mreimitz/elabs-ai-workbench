---
type: "Work Package Spec"
title: "Assistant Hub \u2014 requirements annex (R-catalog v2, 2026-07-17)"
description: "v2 (same day): added R-GUI1\u20138 (declarative generative UI \u2014 evidence: research doc 04,"
tags: ["roadmap", "RM-03"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# Assistant Hub — requirements annex (R-catalog v2, 2026-07-17)

> v2 (same day): added **R-GUI1–8** (declarative generative UI — evidence: research doc 04,
> Thesys OpenUI / CopilotKit / assistant-ui), **R-UX13** (artifact sharing/export) and
> **R-MCP13** (bundled research-server recipe) per owner scope selection, plus WP 2.6.

Normative refinement of the locked decisions **D-AH1…20** ([README](./item.md)) with
state-of-the-art specifics. Evidence lives in
[`research/agentic-session-sota/`](/Research/RS-06-agentic-session-sota/) (docs 00–03); this annex
is what WPs implement. **MUST** = acceptance-blocking for the owning WP; **SHOULD** = implement
unless a STATUS blocker records why not; **[P2]** = flagged future scope, do not build in v1.
Nothing here reopens a locked decision; where a requirement sharpens one, the D-AH id is cited.

The recurring dogfood rule: wherever a SOTA harness manages token budgets blindly, the Hub
**shows the measured numbers** (the app's own TokenCounter) — context savings from deferred
tools, skill listing budgets, per-section prompt costs. That display is part of the requirement,
not decoration.

## R-SES — Session core (evidence: research docs 00 §B1–B12, 03 §1/§3)

- **R-SES1 (MUST)** Event-sourced sessions: every UI state — including mission boards, task
  widgets, artifacts state — reconstructible by replaying `hub_events` alone; branch lineage via
  parent refs. (Already the WP0.1/1.R invariant; AG-UI rule.)
- **R-SES2 (MUST)** Typed parts, no flat strings: settled `assistant_message` events persist an
  ordered parts array (text · reasoning-summary · tool ref · citation · artifact ref · data
  widget); tool parts carry the R-UX1 state machine. Renderers switch on part type/state.
- **R-SES3 (MUST)** Two steering verbs, durable: **Stop** cancels the running step but keeps
  completed work (terminal via `terminalFor`, partial output preserved with an explicit note);
  **typed messages while running** queue durably (persisted `queued_user_message` event) and
  inject at the next step boundary. Queue survives restart; loss of a queued message is a bug.
- **R-SES4 (MUST)** Live task widget: built-in `tasks.{create,update,list}` tools (status +
  dependencies) rendered as a reconciled-by-id live widget (`Task`/`Plan` components), ≤5 items
  visible with expand, survives compaction, and is replaced by the mission plan/board in mission
  mode (never two competing lists). Task state transitions are events (R-SES1).
- **R-SES5 (SHOULD)** Plan-first option: in chat/research modes a per-session "plan first"
  toggle makes the assistant propose an editable plan card before acting (Intent Preview);
  accepting can set the session's approval level for the remainder (mirrors D-AH6's dial).
  Accepting a plan/mission SHOULD auto-title the session (extends the D-AS26-style auto-title).
- **R-SES6 (SHOULD)** Checkpoints & rewind: every user turn is a checkpoint; a rewind menu
  offers conversation restore (a branch via R-SES1 lineage — same mechanics as WP2.5 variants)
  and, where a workspace exists, workspace restore from content-addressed snapshots (WP3.4).
  Untracked side effects (external MCP writes) are **explicitly labeled as not restorable**.
- **R-SES7 (MUST)** Context gauge + inspector: live used/remaining % (per model contextWindow
  capability) always visible; a per-session **context inspector** itemizing the window by layer
  — system-prompt sections (WP0.3 budgets), tool definitions (eager vs deferred), skill L1 +
  loaded L2/L3, memory, project context, history — each with real token counts from the app's
  own counters. This is the flagship dogfood surface.
- **R-SES8 (MUST)** Compaction is visible and steerable: clear-old-tool-outputs first (hot/cold
  split), summarize only after; an in-transcript "compacted" marker (expandable); user can aim
  the summary; repeated refill → an honest thrash error, never a loop; invoked skill bodies
  re-attach within budgets (5K/skill, 25K combined — R-SK2). (Sharpens WP3.3.)
- **R-SES9 (SHOULD)** Continuity: session recap line on return after idle; waiting_input,
  mission terminal, and budget-trip events emit to the app's existing notification center with
  deep links (R-UX11). Ghost-text/starter suggestions reuse the dock's starter-catalog pattern.
- **R-SES10 (MUST)** Model transparency: per-message model chip in the transcript detail view;
  per-message model switch in the composer; cost-basis markers (`$` / `$ est. · subscription`)
  per D-AH17; capability-gated affordances only (never providerKind forks — D-US4 discipline).
- **R-SES11 (MUST)** Errors preserve work: provider/transport failures keep partial output with
  an explicit cut-off note; limit errors surface the retry-on-other-source action (D-AH17);
  denied/failed actions land in a visible, retryable list — nothing silently disappears.
- **R-SES12 (SHOULD)** Sessions are portable objects: auto-named, renameable, branch-grouped
  under their root, deep-linkable (`/assistant/s/:id`), exportable (JSON/MD via the reports
  pattern).

## R-MCP — MCP server & tool handling (evidence: research doc 01)

- **R-MCP1 (MUST)** Grants per server **and per tool** at session and role level (D-AH7);
  denied/ungranted tools are absent from model context entirely, not blocked at call time.
- **R-MCP2 (MUST)** Deferred tool loading + tool search: per-session `toolLoadingMode`
  (`eager`/`deferred`, reusing `TOOL_LOADING_MODES`); deferred keeps names + server instructions
  resident and discovers definitions via a built-in search tool; per-server/per-tool
  **alwaysLoad** pins; an `auto` heuristic (eager iff all granted definitions fit ≤10% of the
  model's context window). The session header/context inspector shows **measured** resident-vs-
  total definition tokens (the ~85%-savings story, with the app's real numbers).
- **R-MCP3 (MUST)** Annotation-informed approvals: approval cards display `readOnlyHint` /
  `destructiveHint` / `idempotentHint` / `openWorldHint` (+ tool icons when provided) from the
  live definition (already scanned + metered). Defaults: auto-run eligibility requires
  `readOnlyHint: true` **and** an owner-trusted server; everything else asks; destructive always
  asks (D-AS4 posture). Annotations from untrusted servers can only make policy stricter, never
  looser (spec trust rule). Per-tool "don't ask again" is session-scoped.
- **R-MCP4 (MUST)** Elicitation: form mode rendered through the existing schema→form generator
  (flat primitives, enums, defaults; credential-shaped fields refused); URL mode shows the full
  URL + domain emphasis, never auto-opens/prefetches; the session enters `waiting_input` with
  the wait budget running; decline/cancel are first-class; every elicitation is an event.
- **R-MCP5 (MUST)** Progress & cancellation: tool calls send `progressToken`; progress
  notifications render as a bar/message on the running tool part; running tools are cancellable
  from the UI (`notifications/cancelled`); every running row has an elapsed ticker regardless.
- **R-MCP6 (MUST)** Structured output: `structuredContent` validated against `outputSchema` and
  rendered typed (tables/values/schema-aware); `isError: true` becomes a model-visible failed
  step (self-correction), never a session error.
- **R-MCP7 (MUST)** Output caps & spill: warn at 10K tokens, cap at 25K (env-tunable); oversized
  results spill to the session workspace as a file + reference card; per-call request/response
  tokens metered (playground mechanics reused).
- **R-MCP8 (SHOULD)** MCP prompts as slash commands: composer command menu lists
  `/mcp__server__prompt` from scanned + live `prompts/list`, argument form from the prompt
  definition (completion API when live), result injected as user content.
- **R-MCP9 (SHOULD)** MCP resources attachable: @-mention/picker over scanned + live
  `resources/list` (+ templates); attached resources become metered context items visible in the
  context inspector; `audience`/`priority`/`lastModified` shown; auto-inclusion **off** by
  default.
- **R-MCP10 (MUST)** Spec posture: pin protocol 2025-11-25 via the existing MCP client layer;
  no new features on roots/sampling (deprecated in the 2026-07-28 RC); handshake/session
  assumptions stay isolated in that layer pending the RC's `initialize` removal.
- **R-MCP11 (SHOULD)** Connection transparency: per-server status chip in the session (connected
  / auth needed / error; reconnect with backoff; `list_changed` honored live); server icons
  where provided.
- **R-MCP12 (MUST)** Security MUSTs: server registration remains a Settings/owner act (sessions
  never register servers); server-provided URLs validated (https-only, scheme rejection,
  private-IP rules per existing SSRF hardening); no token passthrough; secrets never in tool
  schemas or model context (existing boundary).
- **R-MCP13 (SHOULD)** Bundled research-server recipe (owner-selected 2026-07-17): a curated
  preset list of research MCP servers (search/fetch — e.g. Tavily, Brave, Exa) as ready-to-fill
  config templates in the add-server flow (keys through the existing encrypted env fields) + a
  user-guide recipe page; the research mode's empty state links to it when no research-capable
  server is granted. No bundled vendor key, no built-in search engine (D-AH10 stands).

## R-SK — Skill handling (evidence: research doc 02)

- **R-SK1 (MUST)** L1 listing discipline: attached skills contribute name+description within a
  listing budget (default 1% of the model context window; per-entry truncation at 1,536 chars;
  overflow demotes least-recently-invoked skills to name-only; zero skills → no catalog at
  all). The listing's **actual token cost renders live** in the context inspector.
- **R-SK2 (MUST)** On-demand L2/L3: bodies load only via an **enum-constrained** `skills.load`
  built-in (model-driven, no harness keyword matching); referenced files load individually;
  re-invocations dedupe; loaded content persists and is compaction-protected within budgets
  (first 5K/skill, 25K combined — with R-SES8).
- **R-SK3 (MUST)** Invocation controls per attachment: `model-invocable` (default) ·
  `user-only` (slash-only; removed from the model listing) · `name-only`; slash invocation
  `/skill-name args` with `$ARGUMENTS`-style substitution; role-level skills preload full
  content into the agent brief (subagent-skills pattern).
- **R-SK4 (SHOULD)** Frontmatter superset surfaced, never silently dropped: `when_to_use`,
  `allowed-tools` (displayed as advisory — hub grant policy governs), `context`/`agent`,
  `model`/`effort` hints, `paths`, `metadata.version`/`author` — rendered in the attachment UI
  with a portability note for client-specific fields.
- **R-SK5 (MUST)** Session-true metering: a skill's session cost = L1 (always) + L2 per
  invocation (persisted) + L3 on demand — itemized per skill in the context inspector, using the
  registry's existing L1/L2/L3 counters.
- **R-SK6 (SHOULD)** Trigger-quality loop: skill attachments surface the registry/Skill-IDE
  quality signals (description lint, trigger-rate badge when a trigger-eval suite exists —
  20-query should/shouldn't methodology via the existing suite engine). No new grader in v1;
  link, don't duplicate.
- **R-SK7 (SHOULD)** `context: fork` semantics map to a mission role (the skill's body becomes
  the role brief, `agent` hints the role template) rather than inline loading — never executed
  either way (invariant).
- **R-SK8 (MUST)** Version pinning: auto-latest or pinned per attachment (scenario-attachment
  parity), provenance shown, one click to the registry inspector's version diff.

## R-UX — Interaction & visual feedback (evidence: research doc 03; components: `@elabs-ai/components-ai`)

- **R-UX1 (MUST)** Canonical tool state machine rendered inline: `input-streaming →
  input-available → (approval-requested → approval-responded) → output-available | output-error
  | output-denied`, with dial-approved calls marked automatic. Approvals are transcript states
  (`ApprovalCard`/`Confirmation`), never a modal system.
- **R-UX2 (MUST)** Three zoom levels over one log: collapsed one-line tool summaries (with
  counts/diffstats) → expandable detail → full transcript (timestamps + per-message model chip);
  mission focus view (board only). All three are projections of `hub_events` (R-SES1).
- **R-UX3 (MUST)** Liveness — dead air is a defect: elapsed tickers on every running tool/agent
  row; phase chips (Queued+position · Starting · Waiting for you · Stopping — US label table);
  `Shimmer` before first token; spawn/launch checklists on mission start.
- **R-UX4 (MUST)** Mission board affordances (sharpens D-AH8): per-agent card = status/phase,
  live stream, tool activity, tokens/cost ticker, model chip, steer + stop; board-level budget
  meter + waiting-on-input count; completed agents linger marked-done; stop-all; the topology
  graph (WP2.2) renders live state on nodes.
- **R-UX5 (MUST)** Citations UX: inline `[n]` chips (`InlineCitation` hover card with quote) +
  per-message `Sources` + a session source rail; agent-report citations carry `agentRef`; the
  resolve-test (every marker resolves) is acceptance (WP1.4/1.R).
- **R-UX6 (SHOULD)** Intent preview & rationale: the mission plan card carries per-agent
  rationale ("because your prompt asks X…"); plan edits tracked; watch the >85%-unedited-
  acceptance signal in usage telemetry (metric only, no gate).
- **R-UX7 (SHOULD)** Audit & undo pairing: the audit timeline (D-AH13) pairs every reversible
  action with its undo (artifact version revert, memory delete, checkpoint restore); irreversible
  external writes are labeled at approval time (openWorldHint/destructive display — R-MCP3).
- **R-UX8 (MUST)** Ambient cost/time: per-session running cost estimate (labeled est.; basis
  markers) + active-vs-total duration; per-agent cost on the board; rollups in Usage (D-AH13).
- **R-UX9 (MUST)** Confidence & honesty: agent-report `confidence` and open questions render
  visibly in mission results; partial/budget-tripped synthesis is marked; unverified claims
  labeled (honest-reporting culture, in-product).
- **R-UX10 (SHOULD)** Follow-ups & suggestions: starter chips on empty sessions (dock-catalog
  pattern), follow-up suggestion chips after research answers, composer command menu (slash) for
  modes/crews/roles/skills/prompts.
- **R-UX11 (SHOULD)** Notifications: `waiting_input`, mission terminal, budget trip →
  notification-center entries with deep links (existing bell/watch infra); OS-level push **[P2]**.
- **R-UX12 (MUST)** Access & themes: both themes, keyboard-first operation of composer/board/
  approvals, reduced-motion respected, screen-reader announcements on state changes (mode,
  phase, approval outcomes).
- **R-UX13 (SHOULD)** Artifact sharing/export (owner-selected 2026-07-17): every artifact
  exports md / html / json AND a **self-contained `share.html`** (styles inlined, no app or
  network dependency, version-pinned, citation footnotes preserved) suitable for sending to
  someone without the app; one-click copy/download from the canvas. Hosted share links stay
  [P2] (no server exposure for a local single-owner tool).

## R-GUI — Declarative generative UI (evidence: research doc 04 — Thesys OpenUI · CopilotKit · assistant-ui)

Bounded to CopilotKit's "Declarative" tier: the model composes **our** curated `@elabs-ai/components-*`-part
catalog inside a message; it never writes HTML/JS (Open-Ended stays [P2]) and never chooses
styles (brand-ui-only).

- **R-GUI1 (MUST)** One registry compiles everything: the GenUI catalog (forms, tables,
  **charts via `@elabs-ai/components-charts` `AutoChart` — its `ChartSpec` is already "the serializable chart
  specification produced by an LLM tool-call" and is adopted as-is**, stat/KPI, media, layout —
  each backed by `@elabs-ai/components-*` parts, verified against the LIVE Storybook, not the vendored kit) is
  defined once (zod) and compiles
  BOTH the prompt catalog (compact one-line typed signatures grouped with usage notes /
  anti-patterns) AND the runtime validator + JSON schema — regenerated together so prompt and
  validator can never disagree; `HUB_GENUI_SPEC_VERSION` stamped on events.
- **R-GUI2 (MUST)** Emission is a silent, flat tool: the model emits UI via a `present` /
  `prompt_user`-style tool ("call it without saying anything else"); schema is **flat**
  ($type enum whose description lists each component + one-liner; `$key` for stable list
  identity; `children` recursion) because providers reject top-level `oneOf`; render-time
  **allowlist validation is the security boundary** — unknown components/props are typed
  errors, never rendered; prop URLs validated (no `javascript:`, no unvetted `src`).
- **R-GUI3 (MUST)** Streaming-safe by contract: parent-first emission with ids; the renderer
  tolerates out-of-order/partial trees (unresolved children dropped, never null holes); GenUI
  tool parts carry `args` (partial parse) + raw `argsText`, rendering through the R-UX1
  three-state contract.
- **R-GUI4 (MUST)** Bounded, machine-hinted repair loop: validation failures produce typed
  errors with hints ("Available components: …", signature hints) fed back to the model
  ("Fix these errors:") for at most `HUB_GENUI_MAX_REPAIR_ATTEMPTS` (2); exhaustion emits a
  typed recovery-exhausted envelope rendered as an honest recovery card; valid portions still
  render.
- **R-GUI5 (MUST)** Two-tier interactivity: client-side state ops (set/reset, re-run a bound
  granted tool) execute in the runtime and **never re-enter the model**; deliberate
  to-assistant actions carry **dual-audience payloads** (`humanFriendlyMessage` rendered as the
  user's turn + `llmFriendlyMessage`/`formState` to the model); per-message UI state is
  event-sourced and rehydrated on replay (R-SES1).
- **R-GUI6 (SHOULD)** Editable-surface snapshot contract: agent-editable surfaces (artifacts,
  plan cards, the task list) expose auto-generated `update_{name}` tools with the wording
  "Only include the fields you want to change; omitted fields keep their current values", and
  send-time snapshots are stamped into user turns as `[Current state of "{name}" (id: {id}):
  {json}]` — ids stay model-visible.
- **R-GUI7 (SHOULD)** Traces are derived, never prompted: chain-of-thought/tool-trace grouping
  is a client-side view transform over adjacent parts (status roll-up, stable keys); tools are
  classified prompt / inform / trace (`display: inline|standalone`; approval + elicitation
  always standalone) so HITL cards never fold into the thinking accordion.
- **R-GUI8 (MUST)** Tokens only: GenUI output carries no colors/styles — components render
  exclusively through `@elabs-ai/components-tokens` (the model picks structure and data, never look) —
  enforced by schema (no style-bearing props) + the `check-tokens` discipline.

## Deferred [P2] register (do not build in v1; revisit post-ship)

Programmatic tool calling (`allowed_callers` + code-execution container) · MCP Apps extension
(sandboxed server UIs) · MCP tasks extension · provider-side context editing/server compaction
betas as accelerators behind the Hub's own compaction · sampling/roots (deprecated upstream) ·
`/btw`-style ephemeral side questions · previous-session @-mention as context · post-mission
"session insights" retro card · OS push · scheduled sessions · **open-ended sandboxed generated
UI** (LLM-written HTML/JS à la CopilotKit `generateSandboxedUi`) · **hosted artifact share
links** · selection/quote toolbar · external GenUI wire formats (A2UI/OpenUI Lang adoption —
we compile our own `@elabs-ai/components-*` catalog with the same techniques).

## WP impact map (authoritative binding; WP text tags are reminders, this table governs)

| WP | Requirements |
|---|---|
| WP0.1 contract | R-SES1, R-SES2, R-SES3 (queued event), R-SES4 (task events), R-UX1 (states in the event shapes), R-GUI3 (`generative-ui` part + `argsText` + dual result channels), R-GUI5 (UI-state events) |
| WP0.3 prompting | R-SES7 (section budgets feed the inspector), R-MCP3/R-SK2 guidance text, R-UX9 honesty rules, R-GUI1/2 prompt compilation + the doc-04 §4 playbook (silent tool calls, WRONG/RIGHT pairs, vocabulary clamps + legal fallback, streaming order, self-verification checklist, design-rules block) |
| WP0.5 tool registry | R-MCP1, R-MCP2, R-MCP3 (policy core), R-MCP6, R-MCP7, R-SK1–R-SK3 plumbing, R-SES4 (tasks built-ins) |
| WP1.1 turn engine | R-SES3, R-SES8 (hooks), R-SES10, R-SES11, R-MCP5 (timeout/ticker events), R-UX3 (phase events) |
| WP1.2 sessions API | R-SES1, R-SES9 (notification emit), R-SES12 |
| WP1.3 conversation UI | R-SES2, R-SES3 (composer queue), R-SES4 (widget), R-SES7 (gauge), R-SES10, R-UX1–R-UX3, R-UX10, R-UX12 |
| WP1.4 MCP + citations | R-MCP3 (cards), R-MCP4, R-MCP5, R-MCP6, R-MCP7, R-MCP11, R-UX5 |
| WP1.5 subscription | R-SES10, R-SES11 |
| WP1.7 mission v1 | R-SES5 (auto-title), R-UX4, R-UX6, R-UX9 |
| WP2.1/2.2 roles/crews | R-SK7, R-UX4 (graph state) |
| WP2.3 autonomy/budgets | R-MCP3 (dial interplay), R-UX6, R-UX7 (labels) |
| WP2.4 skills | R-SK1–R-SK6, R-SK8 |
| WP2.5 composer power | R-SES5, R-MCP8, R-SK3 (slash), R-SES6 (branch UI), R-UX10 |
| **WP2.6 declarative GenUI** | **R-GUI1–8** (owning WP: catalog registry + compiler, validator + bounded repair loop, renderer, two-tier interactivity + per-message UI state, `update_{name}` snapshot contract, derived traces) |
| WP1.6 artifacts v1 (+3.5) | R-UX13 (export md/html/json + self-contained `share.html`) |
| WP3.3 compaction | R-SES8 |
| WP3.4 uploads/workspace | R-SES6 (snapshots), R-MCP7 (spill target), R-MCP9 |
| WP3.5 artifact review | R-UX7 |
| WP4.1 usage | R-SES7 (inspector home), R-UX6 (metric), R-UX8 |
| WP4.2 audit | R-UX7 |
| WP4.3 hardening | R-MCP10, R-MCP12, R-SES9/R-UX11 (notification wiring), R-SES11 |
| WP4.4 e2e/docs | R-MCP13 (research-server recipe: presets + user-guide page + research empty-state link) |
| WP1.R/2.R/3.R reviews | refute R-SES1 (replay), R-UX5 (resolve-test), R-MCP3 (escalation attempts), R-SES3 (queue durability), R-SK1 (budget math), R-GUI2/4 (allowlist bypass + prop-injection attempts, repair-loop exhaustion honesty) |

## New env defaults (extends execution-plan §1.10)

`HUB_TOOL_LOADING_DEFAULT` (`deferred`) · `HUB_TOOL_SEARCH_AUTO_FRACTION` (0.10) ·
`HUB_MCP_OUTPUT_WARN_TOKENS` (10000) · `HUB_MCP_OUTPUT_MAX_TOKENS` (25000) ·
`HUB_SKILL_LISTING_BUDGET_FRACTION` (0.01) · `HUB_SKILL_ENTRY_MAX_CHARS` (1536) ·
`HUB_SKILL_COMPACTION_TOKENS_PER_SKILL` (5000) / `HUB_SKILL_COMPACTION_TOKENS_TOTAL` (25000) ·
`HUB_GENUI_MAX_REPAIR_ATTEMPTS` (2).
