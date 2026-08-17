# Assistant — embedded Claude agent chat (plan)

> **Status ledger:** [`STATUS.md`](./STATUS.md) (authoritative, driven by `/next-wp assistant`).
> **Locked decisions:** [`decisions.md`](./decisions.md) (D-AS1…D-AS18, owner-locked 2026-07-10).

## 1. What this is

An **interactive chat panel embedded in the app** that drives a real Claude agent (via the
**Claude Agent SDK**) with full, typed access to the app's own data — runs, skills, scans, suites,
compare — and gated write powers (edit a skill into a new version, draft tests, adjust
environments). It runs **in the existing container**, authenticates with the **owner's Claude
Pro/Max subscription** (API-key fallback), and is exposed as a **global right dock** available on
every route, aware of what the user is currently looking at, and able to navigate the UI itself.

Canonical first use cases (owner-stated):

1. **Run triage** — on a run console: "analyze this run and find why it failed."
2. **Skill improvement loop** — on a skill page: "analyze the recent runs using this skill, find
   issues we could avoid, and change the skill accordingly" → agent edits the skill's files →
   **new immutable skill version** through the existing `createVersion` path.

**Naming (hard rule):** the feature is called **"Assistant"** everywhere (dock title, settings
card, routes `/api/assistant/*`, dirs `apps/{api,web}/src/**/assistant/`). Per Anthropic's Agent
SDK policy it must **never brand itself "Claude Code"**; UI copy says "powered by your Claude
subscription". No collision with the planned deterministic [`roadmap/advisor/`](../advisor/)
workstream (that one computes evidenced recommendations; this one is a conversational agent —
they complement, and Advisor output becomes Assistant context later).

## 2. Auth & policy reality (researched 2026-07-10 — re-verify before building)

- **Mechanism:** the Agent SDK (`@anthropic-ai/claude-agent-sdk`, bundles the CLI binary, Node
  18+) honors `CLAUDE_CODE_OAUTH_TOKEN` — a **1-year, inference-only** token minted by
  `claude setup-token` (`sk-ant-oat01-…`). Auth precedence: `ANTHROPIC_API_KEY` beats the OAuth
  token, so the session env must contain **exactly one** source (D-AS14).
- **Policy:** a **single-owner personal tool driving the real SDK on the owner's own
  subscription** is currently on the sanctioned/tolerated side (Anthropic ships `setup-token` for
  scripts, its usage-limit docs contemplate individual Agent SDK use, and the *paused* June-15
  "Agent SDK credit" plan explicitly named subscription-authenticated third-party apps). Status
  quo: SDK usage **draws from the subscription's 5-hour/weekly limits**; billing treatment is
  explicitly in flux. **Hard-prohibited:** offering claude.ai login to a product's *users*
  (⚠ constrains [`roadmap/team-server/`](../team-server/) — see §9), spoofing the Claude Code
  client, branding as "Claude Code".
- **Fallback:** an Anthropic **API key** (reusing the existing encrypted
  `provider_credentials` rows) is a per-session alternative source — never a silent fallback
  (D-AS14): on a subscription limit error the session surfaces it with an explicit
  "retry on API key" action.
- **Sign-in (D-AS2):** Settings drives `claude setup-token` **inside the container via a PTY**
  (`node-pty`): UI shows the auth URL → owner authorizes in their browser → pastes the code back
  → token captured, **encrypted via the existing `SecretStore`** into the DB, never returned by
  any API. A **manual paste field** (token generated on the owner's machine) is the always-works
  fallback if a CLI update breaks the PTY parse. Sign-out deletes the row and kills live
  subscription sessions. Store `created_at`; warn in Settings as the 1-year expiry approaches.

## 3. Architecture

```
Browser SPA                                   Fastify API (apps/api)
┌──────────────────────────┐                  ┌────────────────────────────────────────────┐
│ AssistantDock (global,   │  POST message    │ assistant/                                 │
│ right dock, ChatShell)   │ ───────────────► │  routes.ts  ── SSE stream (streamRun tmpl) │
│  · thread switcher       │  SSE events      │  session-manager.ts ──┐ 1 child / active   │
│  · streaming transcript  │ ◄─────────────── │  claude-auth.ts (PTY) │ thread             │
│  · permission cards      │  POST permission │  tools/ (in-process   ▼                    │
│  · ui_action executor    │ ───────────────► │   MCP server) ◄── Agent SDK child process  │
│  (react-router navigate) │                  │  workspace.ts     (bundled Claude CLI)     │
└──────────────────────────┘                  │        │                                   │
     ▲ context envelope                       │        ▼                                   │
     │ (route + entity ids                    │  existing repositories/services            │
     │  on every message)                     │  (runs, skills.createVersion, scans, …)    │
                                              └────────────────────────────────────────────┘
                                                data: /data/app.sqlite · /data/assistant/*
```

**Runtime boundary holds:** only `apps/api` spawns the SDK child, reads the decrypted token, or
touches the DB. The child process gets a **minimal explicit env** (no `MCP_SECRET_KEY`, no DB
path) — just the one auth var + `CLAUDE_CONFIG_DIR=/data/assistant/claude` + `HOME` under
`/data/assistant/`.

### 3.1 Session engine (`apps/api/src/assistant/session-manager.ts`)

- **One SDK child per *active* thread** (`query()` in **streaming input mode** — an
  `AsyncIterable<SDKUserMessage>` the manager feeds as messages arrive). `includePartialMessages:
  true`; text deltas are forwarded over SSE but **not persisted** (settled events only — deltas
  are ~80 % of volume; code-quest lesson).
- **Event fan-out** mirrors `testing/run-manager.ts`: per-thread emitter, monotonic `seq`,
  bounded replay buffer, persistence sink to `assistant_events`, idempotent cleanup. SSE endpoint
  reuses the `streamRun` template (`reply.hijack()`, heartbeat, replay-then-live).
- **Lifecycle:** idle timeout (default 10 min) **parks** the thread — child killed, thread stays
  `idle`; next message **resumes** via the SDK's session resume (persisted `sdk_session_id`,
  session JSONL lives under `CLAUDE_CONFIG_DIR` in the `/data` volume, so resume survives
  container restarts). Startup **orphan reconciliation** (index.ts pattern): any thread left
  `running` → `idle` with a synthesized `interrupted` event. `POST …/stop` aborts the in-flight
  turn (AbortController), keeps the thread.
- **Guardrails:** per-message `maxTurns` cap (default 50, env-overridable); model chosen
  per-thread from the roster the SDK/plan reports (default: latest Sonnet); concurrent active
  threads capped (default 2 — each child ≈ up to 1 GiB).

### 3.2 App context: in-process MCP tools (`apps/api/src/assistant/tools/`)

One `createSdkMcpServer` instance exposes typed tools that call the **existing repositories
directly** (same process — no HTTP hop, no secrets). Nothing is preloaded; the agent fetches on
demand. Every user message carries a **context envelope** (current route, entity kind + id,
active tab) appended as structured context, so "this run" resolves without the user pasting ids.

- **Read tools (never gated):** `runs.get / runs.list / runs.search` (full transcript via
  `run-repository.getRun`, or the markdown report via `reports.createRunMarkdownReport` for a
  cheap single-call context), `suite_runs.get/list` + grades, `skills.get / skills.versions /
  skills.files / skills.diff`, `scans.get / scans.tools / scans.list`, `servers.list`
  (**redacted configs only**), `compare.run`, `compatibility.heatmap`, `tests.list/get`,
  `environments.list/get`, `collections.list/get`.
- **Write tools (approval-gated, D-AS3/D-AS4):** `skills.open_workspace / skills.commit_workspace`
  (§3.3), `tests.create/update`, `expectations.set`, `environments.create/update`,
  `attachments.manage`, `servers.update_config` (**non-secret fields only** — the tool schema has
  no secret-bearing fields at all), `collections.modify`, `suites.create/update`, plus `*.delete`
  variants.
- **UI tools (D-AS8/D-AS16):** `ui.navigate {route}`, `ui.open_run_turn {runId, turnIndex}`,
  `ui.open_skill {skillId, versionId?, tab?}`, `ui.open_diff {…}` — emitted as `ui_action` SSE
  events; the dock executes them **instantly** through react-router against an
  **addressable-view registry** (an allowlist of app routes/anchors — the agent can never send
  the browser anywhere but app views).

### 3.3 Skill editing: materialized workspace (D-AS13)

The agent's strongest mode is native file editing, so skill edits go through a real (scratch)
filesystem, not tool-arg blobs:

1. `skills.open_workspace {skillId, versionId?}` → API materializes the version's files into
   `/data/assistant/ws/<threadId>/<skillId>/` and adds that dir to the session's
   `additionalDirectories`.
2. Agent uses its native `Read/Edit/Write/Glob/Grep` **confined to that dir** (edits fall under
   the `acceptEdits`-style per-session auto-accept toggle; `Bash` stays disabled).
3. `skills.commit_workspace {skillId, note}` → API reads the tree back
   (`SkillFileInput[]`) → **`SkillRepository.createVersion(skillId, files, meta)`**
   (`apps/api/src/skills/repository.ts:376`) with a dedicated `sourceRef`
   (`assistant-edit`, mirroring `SKILLFLOW_EDIT_SOURCE_REF`) → dedup/unchanged handling for free
   → the dock renders a **diff preview card** (existing full-tree diff) linking the new version.
4. Workspace is deleted on commit/thread close/idle park; dirty un-committed trees survive a park
   and are re-attached on resume.

Skill content in the workspace is **read/written but never executed** — the app-wide invariant
holds (no Bash, no interpreter, and the workspace dir is outside any executable path).

### 3.4 Approvals (D-AS4)

`canUseTool` is the single choke point: read tools + UI tools auto-allow; write tools emit a
`permission_request` SSE event (tool name + pretty-printed input + diff preview where possible)
and block on `POST /api/assistant/threads/:id/permission {requestId, behavior}`. A per-thread
**auto-accept toggle** (default **off**) auto-allows *create/update* writes and workspace file
edits; **deletes always ask**, even with auto-accept on. Every decision is persisted as an event
(audit trail in the replayable thread).

### 3.5 Web (`apps/web/src/features/assistant/`)

- **`AssistantDock`** — built from `@elabs-ai/components-ai` (`ChatShell`, `Conversation*`, `Composer`,
  `Reasoning*`, `MessageResponse`, `Shimmer`) + `@elabs-ai/components-ui`, exactly like the run console
  (`ConversationPane.tsx` is the styling/behavior reference). Header: thread switcher (recent +
  threads pinned to the current entity), model picker, auth-source indicator, auto-accept toggle,
  stop. Body: streaming transcript, tool-call cards (`AgentStep`/`ToolDetails` pattern),
  permission cards, diff cards. Footer: `Composer`.
- **Mounting:** `AppShell` gains a **`dockContent` slot** — a flex sibling *after* `<main>`
  (mirror of the existing left `secondaryContent` aside), resizable, collapsed by default;
  narrow viewports fall back to the existing `Sheet` pattern. Toggle in `TopNav` `end` + keyboard
  shortcut (⌘J / Ctrl+J). Dock state persists in `localStorage`.
- **SSE client:** `use-assistant-stream.ts` mirrors `use-run-stream.ts` (seq dedup, replay,
  `terminalRef` so an expected post-turn close is not an error; per-turn `streaming` flag —
  see `.claude/rules/loading-states.md`).
- **Page hooks:** run console gets **"Analyze this run"** (error states get "Why did this
  fail?"), skill inspector gets **"Analyze recent runs"**, later suites/compare/scans (§7) — each
  opens the dock with a prefilled prompt + pinned entity.
- **Settings:** an **Assistant card** in `SettingsContent` (modeled on `ProviderCredentials`,
  `SettingsView.tsx:525`): sign-in flow (auth URL + code paste), manual token paste, status
  (signed in · token age · plan), API-key fallback picker (choose an existing Anthropic
  `provider_credentials` row), defaults (model, max turns, idle timeout), sign out. Until an auth
  source exists the dock toggle is hidden and `/api/assistant/*` (except auth) returns 409.

### 3.6 Sandbox (hard rules)

- `settingSources: []` (no CLAUDE.md/settings pickup), `cwd` = per-thread scratch dir under
  `/data/assistant/`.
- **Disallowed:** `Bash`, `WebSearch`, `WebFetch`, and every other network/exec-capable built-in.
  Allowed built-ins: file tools (workspace-confined), plus the app MCP tools.
- **Secrets never reach the agent:** reads return redacted configs (`hasEnvSecrets` booleans);
  write-tool schemas cannot carry secret values; the child env contains only its own auth var.
- Analyzed content (run transcripts, skill files, tool outputs from arbitrary MCP servers) is
  **untrusted input** — prompt injection is mitigated by the approval gate on writes, the
  route-allowlisted UI tools, and no exec/network. State this in the system prompt too.

## 4. Data model (migration v19) & wire contract

Tables (additive, `CREATE TABLE IF NOT EXISTS`, v13/v15/v17 pattern):

- **`assistant_credentials`** — `id`, `kind` (`claude_oauth`), `token_encrypted`, `label`,
  `created_at`, `last_used_at`. (API-key fallback is a **reference** to `provider_credentials`,
  stored in `assistant_settings`-style columns or a 1-row config table — no key duplication.)
- **`assistant_threads`** — `id`, `title`, `entity_kind` / `entity_id` (nullable pin),
  `model`, `auth_source` (`subscription` | `api_key`), `sdk_session_id`, `status`
  (`idle` | `running` | `error`), `auto_accept`, `created_at`, `updated_at`.
- **`assistant_events`** — `thread_id`, `seq`, `type`, `payload_json`, `created_at` —
  append-only settled events: `user_message`, `assistant_message`, `tool_call`, `tool_result`,
  `permission_request`, `permission_decision`, `ui_action`, `limit_error`, `error`, `turn_done`.

Wire (contract-first — `packages/shared` `types.ts` + `schemas.ts` first, additive only):
`AssistantAuthStatus`, `AssistantThread`, `AssistantEvent` (discriminated union),
`AssistantContextEnvelope`, `assistantMessageSchema`, `assistantPermissionDecisionSchema`,
`assistantThreadUpdateSchema`, constants (event types, entity kinds, defaults).

Routes (`registerAssistantRoutes`, thin, central error handler):

```
GET    /api/assistant/auth/status            POST   /api/assistant/threads
POST   /api/assistant/auth/oauth/start       GET    /api/assistant/threads?entity=…
POST   /api/assistant/auth/oauth/complete    GET    /api/assistant/threads/:id      (replay)
POST   /api/assistant/auth/oauth/cancel      PATCH  /api/assistant/threads/:id      (title/model/auto-accept)
POST   /api/assistant/auth/token   (paste)   DELETE /api/assistant/threads/:id
PUT    /api/assistant/auth/fallback          POST   /api/assistant/threads/:id/messages
DELETE /api/assistant/auth        (sign out)  GET    /api/assistant/threads/:id/stream   (SSE)
                                             POST   /api/assistant/threads/:id/permission
                                             POST   /api/assistant/threads/:id/stop
```

## 5. Dependencies & Docker

- **`apps/api` deps:** `@anthropic-ai/claude-agent-sdk` (bundles the CLI binary; pin exact,
  updates owner-gated like `@elabs-ai/components-*`), `node-pty` (native — builds in the existing
  `deps`/`prod-deps` stages which carry `python3 make g++`; the runtime stage only copies
  `node_modules`, so **never install at runtime**).
- **Dockerfile/compose:** `USER node` can already spawn children (stdio MCP servers do);
  the only writable path is `/data` → `CLAUDE_CONFIG_DIR=/data/assistant/claude`, workspaces +
  scratch cwds under `/data/assistant/`. Add `init: true` to `docker-compose.yml` (reap
  orphaned children). Document required egress (claude.ai / anthropic API endpoints).
- **Env (`config/env.ts` + `.env.example`):** `ASSISTANT_MAX_TURNS` (50),
  `ASSISTANT_IDLE_TIMEOUT_MS` (600 000), `ASSISTANT_MAX_ACTIVE_SESSIONS` (2),
  `ASSISTANT_SESSION_RETENTION_DAYS` (session-JSONL + workspace pruning; wired into
  `/api/maintenance/*`).

## 6. Use-case inventory (surface → what the Assistant does → needs)

| Surface | Use cases | Needs beyond core |
| --- | --- | --- |
| **Run console** | why-did-it-fail triage; explain a turn/tool error; summarize guardrail hits; "generate a regression test from this failure" | run read tools; `tests.create` (P2); `ui.open_run_turn` (P3) |
| **Skill page** | analyze recent runs using the skill; find avoidable issues; **edit the skill → new version**; explain L1/L2/L3 footprint; draft trigger fixes | `runs.search(skillId)`; workspace loop (P2); skills read tools |
| **Suites / Runs feed** | cross-member failure patterns ("why did 3 of 12 fail"); grade regressions vs a baseline suite-run; suggest suite composition | suite/grade read tools |
| **Compare workspace** | narrate a diff; explain token deltas; recommend a verdict with evidence | `compare.run` |
| **Scans / servers** | token-bloat advice (verbose descriptions, overlap across servers); debug connection/scan failures from `scan_events`; explain OAuth flows | scan/server read tools |
| **Compatibility** | explain heatmap failures; recommend models per server | `compatibility.heatmap` |
| **Tests / environments** | author tests + expectations/graders from a prose goal or a failing run; set up an environment reproducing a failure | tests/env write tools (P2) |
| **Collections / GitHub** | draft PR descriptions, collection READMEs/changelogs | collection read/write (P2) |
| **Global (any page)** | ad-hoc questions over all data ("which server got more expensive since May?"); draft bespoke markdown reports; app-usage help | read tools + reports |
| **Later workstreams** | explain security-posture findings + draft remediations ([`security-posture`](../security-posture/)); interactive companion to [`advisor`](../advisor/) output | their read APIs once built |

## 7. Phases & work packages

Sized like other workstreams' WPs; each lands behind the gate
(`pnpm typecheck && pnpm test && pnpm build && pnpm lint`). Ledger: [`STATUS.md`](./STATUS.md).
Agent execution schedule (orchestrator, per-WP models, parallel waves):
[`execution-plan.md`](./execution-plan.md) · owner handover: [`kickoff-prompt.md`](./kickoff-prompt.md).

**Phase 0 — Auth & plumbing**
- **WP 0.1 — contract + persistence:** shared types/zod/constants; migration **v19** (3 tables);
  `assistant/repository.ts`; forward-safe migration test (v18 DB gains tables; fresh stamps 19).
- **WP 0.2 — Claude auth:** `claude-auth.ts` (SecretStore-backed store; PTY `setup-token` flow
  start/complete/cancel with a hard timeout; paste path with a cheap validation ping; fallback
  ref; sign-out kills sessions); auth routes; **Settings Assistant card** (sign-in UX, status,
  fallback picker, sign-out). Token never in any response or log (proven by test, like PAT).
- **WP 0.3 — deps & container:** SDK + `node-pty` wired through the Docker stages;
  `CLAUDE_CONFIG_DIR`/HOME under `/data`; compose `init: true`; `.env.example` + env parsing;
  docs. Acceptance: in-container smoke — spawn a 1-turn SDK session with a pasted token.

**Phase 1 — Session engine + read-only dock (MVP)**
- **WP 1.1 — session manager:** streaming-input `query()` wrapper; event fan-out + persistence;
  SSE route (streamRun template); messages/stop/PATCH routes; idle park + resume;
  startup orphan reconciliation; active-session cap.
- **WP 1.2 — read toolset + context:** in-process MCP server; read tools (§3.2); context
  envelope; system prompt (app description, tool guidance, untrusted-content warning); model
  roster endpoint.
- **WP 1.3 — dock UI:** AppShell `dockContent` slot + TopNav toggle + ⌘J; `AssistantDock`
  (threads, streaming transcript, tool cards, model/source pickers); `use-assistant-stream`;
  both themes.
- **WP 1.4 — page hooks v1:** "Analyze this run" (run console, incl. failure states) +
  "Analyze recent runs" (skill page); prefilled prompts; entity-pinned threads surfaced in the
  switcher.

**Phase 2 — Writes & approvals**
- **WP 2.1 — permission protocol:** `canUseTool` → `permission_request`/decision round-trip;
  per-thread auto-accept (deletes always ask); permission cards; decisions persisted.
- **WP 2.2 — skill workspace loop:** materialize → native edits → commit →
  `createVersion(sourceRef: assistant-edit)`; diff preview card; park/resume-safe workspaces;
  the canonical "improve this skill from its runs" flow demoed end-to-end.
- **WP 2.3 — remaining write tools:** tests/expectations, environments/attachments, server
  config (non-secret), collections, suites (+ delete variants, always-ask).

**Phase 3 — Drive-the-UI & breadth**
- **WP 3.1 — UI actions:** addressable-view registry; `ui.*` tools; dock executor (instant
  navigation); persisted `ui_action` events replay as inert chips.
- **WP 3.2 — page hooks v2:** suites feed, compare workspace, scan/server, compatibility;
  "insert as context" affordances (e.g. send a selected diff row to the thread).
- **WP 3.3 — hardening:** limit-error UX ("retry on API key", D-AS14); session-JSONL +
  workspace pruning via maintenance; concurrency/memory docs; token-expiry warning; API test
  sweep; owner-acceptance walk list (sign-in, both themes, keyboard, canonical flows).

## 8. Non-goals

- **No metering/usage UI** (owner decision D-AS11) — raw SDK usage fields may be stored in
  events for the future, but nothing is surfaced.
- **No multi-user sign-in** — see §9.
- **No autonomous/background sessions** (interactive only; scheduled analysis could later reuse
  the engine).
- **No agent access to app source code, DB file, secrets, or exec/network.**
- Not a replacement for [`advisor`](../advisor/) (deterministic, evidenced) or SkillFlow's
  fracture→suggestion loop — the Assistant complements both.

## 9. Risks & open questions

- **Billing/policy flux:** the June-15 Agent SDK credit change is paused; subscription-drawn SDK
  usage is the status quo but may change. Mitigation: API-key fallback is first-class; re-verify
  policy at each phase start.
- **Team-server collision:** offering claude.ai login to *other users* of a shared instance is
  prohibited. When [`team-server`](../team-server/) lands, the Assistant stays **owner-credential
  only** (admin-gated) or per-user **API keys** — decide there, not here.
- **PTY fragility:** `setup-token` output parsing can break on CLI updates → paste fallback is
  permanent; SDK version pinned; PTY flow covered by a parse-fixture test.
- **Memory:** ≈1 GiB per active child → cap 2 active, park on idle. Watch `/data` growth
  (session JSONL + workspaces) via the maintenance endpoints.
- **Model roster:** which models a subscription exposes varies by plan — always read the roster
  from the SDK/CLI rather than hardcoding.
- **Open:** thread retention policy (prune with scans?); whether run-console "Analyze" should
  auto-attach the run *markdown report* as first context vs. pure tool-fetch (start tool-fetch,
  measure); dock default width/keyboard spec (owner acceptance in WP 3.3).
