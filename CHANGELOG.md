# Changelog

All notable changes to MCP Token Footprint. This project is single-owner and versioned loosely; the
authoritative in-flight state lives in [`CLAUDE.md`](./CLAUDE.md) and the `roadmap/*/STATUS.md`
ledgers. Per-phase git tags are an **owner action** (not created by this remediation).

## Unreleased — design system migrated to `@elabs-ai/components-*` v4.0.0

The UI design system moved off the private, vendored `@brand/*` tarballs (v1.9.0) onto the **public
npm `@elabs-ai/components-*` packages at `^4.0.0`**. Install is now anonymous — no `.npmrc` scope
line, no `_authToken`, no CI token, no `vendor/brand/` tarballs, no `file:` dependencies.

**Renames.** 1,233 import specifiers / `@source` paths across 458 source files; every theme slug
(`qlik-bright` → `light`, `qlik-dark` → `dark`) in code, tests, e2e and screenshot scripts; and the
same sweep across 191 markdown files. `THEME_META` → `BUILT_IN_THEME_META` (the only import in the
app with no 1:1 new name — all 358 other named imports resolved unchanged). Theme labels are now
"Light"/"Dark", so the command-palette entry reads "Switch to Light theme".

**Theme CSS is opt-in.** `@elabs-ai/components-tokens/styles.css` is the engine only and carries no
`[data-theme]` blocks; `app.css` now imports `themes/light.css` and `themes/dark.css` explicitly.
Both token-contrast gates were repointed at the per-theme stylesheets and taught to follow `var()`
aliases.

**Accessibility — deliberate app-side override.** v4 sets `--ring: var(--primary)` (the brand lime),
which on the light theme measures 1.30–1.42:1 and fails WCAG 2.4.7 / 1.4.11 — keyboard focus is
effectively invisible. The app overrides `--ring` (`oklch(0.52 0.16 250)`, worst case 3.81:1) and
`--sidebar-ring` (`oklch(0.72 0.16 250)`, worst case 4.02:1) in a `[data-theme="light"]` block, with
a new 3:1 non-text regression gate over every surface a ring can be drawn on. `dark` keeps the
upstream ring (12.46:1). Conversely, v4 fixed the four AA failures and two role collapses the app
used to patch locally, so those overrides were deleted.

**Peers the app now owns:** `monaco-editor` `^0.55.1` and `ai` `^6.0.0` became peers in v4 and are
direct deps of `apps/web`; `@xyflow/react` and `tailwindcss` already were.

**Other v4 behaviour changes**, each decided and recorded at its call site: BentoGrid's cursor glow
is opt-in (not re-enabled — the skill overview is a dense operator surface); the decoration dial
narrowed to backgrounds and chart fills (a no-op for the app's one consumer); `CardDescription`
ships a `measure` prop, so the local `ProseCardDescription` wrapper now composes it instead of
hand-rolling a `max-w-[68ch]` class; `TabsList` gained `overflow-x-auto`, so a RunsView assertion was
scoped to the app's own chrome. The `blueprint` package and theme are gone (never a dependency here).

**Docs.** `vendor/brand-ui-agent-kit/` (pinned to v1.9.0, and therefore actively misleading) was
deleted in favour of the CLI + MCP server as ground truth, plus a generated snapshot at
`docs/brand-ui-context.md`. `docs/BRAND-UI-PORTABLE-SETUP-PROMPT.md` was rewritten for the public-npm
model; `docs/BRAND-UI-UPSTREAM-ISSUES.md` carries a superseded banner listing which gaps v4 closed.

Gate green: typecheck · 3,105 API + 3,094 web tests · build · Biome lint.

## Unreleased (0.3.0) — RC & feature convergence wave

Significant feature completion across multiple workstreams: the UX overhaul consolidated into main
(all 34 WPs, Phases 0–5; Compare Workspace rebuild per audit), Skill IDE all 20 WPs Phases 1–9
live-validated + 851 API tests, Testing-IA consolidation migration v16 + 697 API tests, the vendor-assistant backend
Phases 0–5 (migrations v23/v24) + Phase 5 answer rendering rework, Assistant Phases 0–3 + hardening
(gate 1143 API + 566 web tests), Auto-Rating Phases 1–4 complete (13 WPs, migrations v22/v26, 1624 API
tests + live bug-fix + rating-issues registry post-work), Assistant Hub all 5 waves (missions, roles/
crews, declarative GenUI, artifacts, memory/projects, usage/audit; migrations v47/v48; on
`feat/assistant-hub`, not yet merged). RC-hardening pass: path-traversal/git-sync/
shutdown/leak fixes, SSRF hardening, bundle splitting, dead-code removal, docs truth-up (Skill IDE +
Auto-Rating rows flipped Built; web tests statement corrected; router/persistence/CodeBlock references
updated; 6 missing API endpoint families added). Per-WP in-flight state authoritative in STATUS ledgers
— see [`CLAUDE.md` capability table](./CLAUDE.md).

### Assistant Hub — full-page, multi-model, multi-agent Assistant (Waves 0–4)

A new full-page **Assistant** (nav item below Dashboard, route `/assistant`) — a general-purpose,
multi-model, multi-agent workspace distinct from the existing right-side dock (relabeled **"App
assistant"**, copy-only). Built on the existing multi-provider inference, MCP-bridge, skills, and
token-metering infrastructure, adopting the Unified-Sessions contract verbatim (`phase`,
`stopReasonCode`, capability manifests, `SessionClock`, cursor-resumable SSE). Plan + locked
decisions D-AH1–D-AH20 at [`roadmap/assistant-hub/`](./roadmap/assistant-hub/).

- **Three session modes** — `chat` (multi-model conversation over registered MCP tools + skills),
  `research` (citations-first, search-grounded), and `mission` (the harness below); model
  switchable per session and per message across all five AI-SDK kinds plus `claude_subscription`.
- **Missions — propose → approve → run → synthesize** — a planner produces a structured team plan
  (roles, models, tool grants, budgets, rationale, cost estimate) rendered as an editable plan
  card; approval spawns isolated child sessions (never the parent transcript) that run under one of
  four topologies (`parallel`/`pipeline`/`debate`/`best_of_n`, the last resolved by a **blind**
  judge), with a live per-agent board (status, stream, cost ticker, stop/steer) and a synthesized
  final answer that cites every agent's contribution; a tripped budget stops cleanly and
  synthesizes honestly marked PARTIAL. An autonomy dial (`always_ask`/`threshold`/`auto`) gates
  approval; hard agent-count/cost caps are enforced server-side regardless of the dial.
- **First-class citations** — any MCP tool result carrying sources becomes numbered inline
  citations with a per-message + per-session Sources panel; citations survive synthesis with every
  `[n]` resolving to a real source.
- **Role library + saved crews** (`/assistant/agents`) — reusable agent definitions (system prompt,
  model, per-server/per-tool MCP grants, skills, target, budgets) the planner draws from; crews
  instantiate a saved team deterministically, skipping the planning call.
- **Declarative generative UI** — the model composes forms/tables/charts/stat-tiles from a curated,
  zod-defined `@brand`-part catalog (never raw HTML/JS) via a silent `present` tool, with a bounded
  machine-hinted repair loop on validation failure and two-tier interactivity (client-side state
  ops never re-enter the model; deliberate actions carry dual-audience payloads).
- **Artifacts** — versioned markdown/code/html/table/json deliverables in a side canvas, a
  hunk-by-hunk critic review workflow (`AI/ChangeReview`), version diff + revert, and export as
  md/html/json plus a self-contained `share.html` (styles inlined, no app/network dependency).
- **Memory + projects** — an explicit, editable profile/preferences/instructions store (the
  assistant proposes, never writes silently); projects group sessions and pin shared instructions
  + files.
- **Governance** — a Usage view (spend by model/provider/mode/day, mission breakdowns) with a
  per-session context inspector (a real token-counted breakdown by prompt layer, eager-vs-deferred
  tool defs, skill L1/L2/L3, memory, project, history — the app measuring its own assistant), and a
  filterable Audit timeline deep-linking into session replay.
- **MCP/skill handling depth** — deferred tool loading + a tool-search built-in (measured token
  savings shown), annotation-informed approval defaults, MCP elicitation through the existing
  schema→form generator, progress/cancellation on tool calls, output caps with workspace spill, a
  bundled **research-server recipe** (curated Tavily/Brave/Exa presets in the "Add MCP server"
  wizard — no bundled key, no built-in search engine), and skill L1/L2/L3 budget-aware loading.
- New `hub_*` tables (migrations v47–v48) + `apps/api/src/hub/**` (turn engine, missions, tools,
  prompting, genui) + `apps/web/src/features/hub/**`; documented in
  [`user-guide/16-assistant-hub.md`](./user-guide/16-assistant-hub.md). Built on
  `feat/assistant-hub` (all 5 waves); an e2e smoke test drives the full propose→approve→run→
  synthesize flow against a deterministic stubbed model (`e2e/fixtures/hub-stub-llm-server.ts`) —
  no real provider key needed. **Not yet merged to `main`** (owner merges); live-provider/
  subscription/real-research-server walks are owner-acceptance (see the ledger's Owner-acceptance
  section and [`roadmap/assistant-hub/owner-acceptance-walk.md`](./roadmap/assistant-hub/owner-acceptance-walk.md)).

#### Assistant Hub UX rebuild (Waves 0–4, 24 WPs)

A complete visual and interaction redesign onto the app's shell grammar (PageShell, ViewToolbar,
one status vocabulary). The workspace layout was restructured: the session rail is retired and
replaced with a collapsible 360-px right meta rail (Progress/Outputs/Context sections), a session
switcher in the toolbar, and the first-prompt choreography (composer animates from centered to
docked). The **Sessions** page (`/assistant/sessions`) is now a sortable/filterable DataTable
showing status, mode, project, model, tokens, cost, and errors. The **Agents & Crews** area
(formerly "Roles, crews") was redesigned as a workforce section with three tabs: **Directory** (a
card grid of agents and crews with quick-create), **Org chart** (a graph on `@brand/flow` showing
execution topologies), and **Usage** (spend drill-down by agent/crew/model/mode/project). Agent
and crew **profile modals** are now `WideDialog` tier-3 modals with full sections including an
**Access** section showing per-server + per-tool grants with scan-measured token costs. Memory was
refactored into four scopes (profile/project/agent/crew) with clear effective-stack ordering shown
in the workspace Context section. Navigation was consolidated 6→4 (Assistant + Sessions child,
Agents & Crews, Projects, Audit) with transparent legacy redirects (`/assistant/memory` →
`?memory=profile`, `/assistant/usage` → `?tab=usage`). Plan + 24 WPs across Waves 0–4 at
[`roadmap/assistant-hub-ux/`](./roadmap/assistant-hub-ux/) (ledger:
[`STATUS.md`](./roadmap/assistant-hub-ux/STATUS.md), [`execution-plan.md`](./roadmap/assistant-hub-ux/execution-plan.md));
all decisions D-HUX1–16 + pre-flight P1–P4 locked; Wave 0 was contracts + unblockers (WP0.1 wire,
WP0.2 shell registry, WP0.3 silent-create-role fix, WP0.4 hub-ux constants); Waves 1–3 delivered
workspace + meta rail + sessions + workforce + memory + usage + nav consolidation + retirement
sweep (MemoryView/UsageView/SessionRail/WorkspaceFilesPanel deleted, zero live imports); WP4.1
e2e, WP4.2 visual/a11y + owner-acceptance walk, WP4.3 docs + stale-comment cleanup, WP4.4
integration train. Owner-acceptance pending: live provider keys, real mission, real search server,
both-theme + keyboard walk (see ledger's Owner-acceptance section and
[`owner-acceptance-walk.md`](./roadmap/assistant-hub-ux/owner-acceptance-walk.md)).

### Unified Sessions — one run/session lifecycle across every backend (Phases 0–5)

Consolidated the run backends (the AI-SDK engine, Claude subscription, and the since-removed vendor assistant) onto **one
session lifecycle**, so a run reads, streams, and renders the same way regardless of provider. Plan +
locked decisions D-US1–D-US26 at [`roadmap/unified-sessions/`](./roadmap/unified-sessions/).

- **One terminal vocabulary** — a shared `terminalFor()` table maps each end cause to the canonical
  `(status, outcome, stopReasonCode)` triple, plus a `phase` axis (`queued`/`waiting_input`/…) and an
  explicit `ended` state; `deriveRunStatusView` renders the SAME locked chip label + tone for a given
  state across all three kinds (D-US5 — the backend kind never changes the label). A reusable seed
  harness + a conformance test prove the full 3 kinds × 14 states = 42-row table end-to-end
  (persistence → `GET /api/runs/:id` → derivation) with no provider key (`pnpm --filter …/api
  seed:sessions`).
- **Stall-based `SessionClock`** — pause-while-waiting, an active/total duration split, a stall
  detector, and warn → extend → stop; **no wall-clock cap by default** (per-environment override
  only), so a long but healthy run is never killed on the clock.
- **Static-per-kind capability manifest + a capability-driven console** — a run persists a
  `capabilities_json` manifest at start and the console's KPI tiles + affordances are gated
  declaratively off it (e.g. context-window surfaces hidden for question-metered `vendor_assistant`).
- **Cursor-resumable SSE** — the run stream carries a cursor + periodic ping; a client watchdog
  reconnects and resumes from the last cursor after a drop, and an expected post-terminal socket close
  is never surfaced as an error.
- **End session** — an explicit affordance to end a live run/session, alongside live phase chips, a
  "needs attention" section, seen-markers, and durations in the Runs feed.
- **OpenAI-compatible facade (`/openai/v1`)** — an external interop endpoint (`GET /openai/v1/models`
  + `POST /openai/v1/chat/completions`) that makes a configured `vendor_assistant` assistant selectable
  from any OpenAI-compatible client (Open WebUI, LiteLLM, another harness). Hold-back streaming by
  default (reasoning live, the answer held until settled) with an opt-in `OPENAI_FACADE_LIVE_STREAM`
  flag, a locally-minted `0600` bearer key (`DATA_DIR/openai-facade.key`; `OPENAI_FACADE_KEY`
  overrides), a per-facade concurrency cap → `429` + `Retry-After` (`OPENAI_FACADE_MAX_CONCURRENCY`),
  and vendor `vendor_assistant`/`citations` fields; the internal the vendor executor is untouched, so the answer
  is byte-identical. Mounted in `apps/api/src/index.ts` with real provider-layer deps; documented in
  [`user-guide/15-openai-endpoint.md`](./user-guide/15-openai-endpoint.md). Every tenant call is
  stubbed in tests — no real the vendor tenant is ever contacted.

## 0.2.0 — 2026-07-02 — Docs & process remediation wave

Documentation-and-process pass reconciling the docs to what the code actually is now (issues #21,
#22). No product behavior changed in this wave; it corrects stale claims and tidies the agent setup.

### Docs reconciled to shipped state (#21)

- **CLAUDE.md capability table (§1):** flipped stale rows — Testing Web UI (Phase 3, built),
  Skills → attach-to-scenario (Phase 2, built), Resource/prompt footprint (built:
  `mcp_resource_scans` / `mcp_prompt_scans`, `resources/list` + `prompts/list`). Added rows for URL
  routing (react-router), real tokenizer + serialized-payload counting (`counting_version`),
  versioned migrations + scan/run delete + retention, CI + Biome lint, the System theme option, and
  MCP × model compatibility. Corrected the profile count (3 → 4) and the "no lint" claims.
- **CLAUDE.md tech stack (§3), commands (§4), architecture (§5):** `react-router-dom` replaces the
  "no router / local `activeView` state" claim; Biome (`pnpm lint` / `pnpm format`) + root CI replace
  the "no ESLint / no lint script" claim.
- **CLAUDE.md API surface (§6) & data model (§7):** reduced to a source-of-truth pointer
  (`**/routes.ts`, `db/schema.ts`) plus the current endpoint families and full table list; the
  token-counting section now describes real `js-tiktoken` BPE, the `generic_estimate` heuristic,
  serialized-payload counting, and `counting_version`; noted `PRAGMA user_version` migrations and
  `SCAN_RETENTION_PER_SERVER`.
- **README.md:** rewritten to the current product (cross-server compare, playground, Testing console,
  Skills, compatibility) as a short overview that defers to CLAUDE.md and the STATUS ledgers;
  refreshed Acceptance Criteria.
- **roadmap:** `00-product-brief.md` non-goals trimmed to auth/cloud (removed conversation replay,
  LLM proxy mode, provider token adapters — now delivered/in-scope); `ROADMAP.md`,
  `roadmap/01-architecture.md`, `roadmap/02-implementation-plan.md` marked historical with a
  "current state" pointer to CLAUDE.md + the STATUS ledgers.
- **Single source of truth:** stated in CLAUDE.md that `roadmap/*/STATUS.md` ledgers are
  authoritative for in-flight status; other docs link rather than restate.

### Process hygiene (#22)

- **Themes:** replaced the stale "six themes" with "two themes (`qlik-bright`, `qlik-dark`)" across
  the Testing WP specs (`roadmap/testing/phase-*/WP-*.md`) and both `/next-wp` definitions. Did not
  re-add blueprint/light/dark/high-contrast.
- **`/next-wp` dedup:** the `next-wp` skill (`.claude/skills/next-wp/SKILL.md`) is now the single
  canonical definition; the command (`.claude/commands/next-wp.md`) is reduced to a thin pointer so
  the two can't drift.
- **Tombstones deleted:** `.claude/rules/issue-workflow.md`, `.claude/rules/component-api.md`,
  `.claude/commands/file-issue.md`, `.claude/rules/quality-gates.md.probe`, and
  `.claude/commands/brand-ui-update.md` (each self-described as safe to delete). Updated the
  CLAUDE.md §10 `.claude/` map to be accurate (adds `next-wp`, drops deleted files).
- **Owner-acceptance tracking:** added an "Owner acceptance" section to `roadmap/testing/STATUS.md`
  and `roadmap/skills/STATUS.md` (one tickable line per deferred owner visual/a11y/e2e item) plus
  the rule that a new phase shouldn't open with prior owner-acceptance items unresolved.
- **Versioning:** bumped root `package.json` to `0.2.0` and added this changelog. Per-phase git tags
  remain an owner action.
- **Lint statements:** corrected "no lint script" to reflect Biome + CI in the quality-gates rule,
  both plan `conventions.md` files, and the `next-wp` skill.

## 0.1.0

Initial startup-footprint MVP and the expanded target build-out (scans, token counting, cross-server
compare, tool playground, Testing console, Skills registry, MCP × model compatibility). See the
`roadmap/` history and the `roadmap/*/STATUS.md` ledgers.
