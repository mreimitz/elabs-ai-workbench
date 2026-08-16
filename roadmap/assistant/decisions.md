# Assistant — locked decisions (owner Q&A, 2026-07-10)

Answers given by the owner in the planning session. Change only with owner sign-off; WPs cite
these ids. Plan: [`00-plan.md`](./00-plan.md) · ledger: [`STATUS.md`](./STATUS.md).

| id | Decision | Detail |
| --- | --- | --- |
| **D-AS1** | **Auth: subscription primary + API-key fallback** | Claude Pro/Max OAuth token is the primary source; an Anthropic API key (existing encrypted `provider_credentials` row, referenced not duplicated) is the fallback. Feature hidden until at least one source is configured. |
| **D-AS2** | **Sign-in: in-app OAuth (PTY) + paste fallback** | Settings drives `claude setup-token` in-container via `node-pty` (auth URL shown → owner authorizes in browser → pastes code back). Manual token-paste field as permanent fallback. Token encrypted via `SecretStore`, never returned, injected only into the SDK child env. |
| **D-AS3** | **Write scope: everything** | Skills (new immutable versions), tests & expectations, environments (scenarios) & attachments, server configs (non-secret fields only) / collections / suites. Reads cover all entities regardless. |
| **D-AS4** | **Approvals: ask-every-write default + per-session auto-accept toggle** | `canUseTool` choke point; approval cards in the dock. Auto-accept covers create/update + workspace file edits; **deletes always ask** (planner default — owner may relax). Decisions persisted as events. |
| **D-AS5** | **Placement: global right dock + page hooks** | Persistent right dock on every route (TopNav toggle + ⌘J), context-aware; contextual "Analyze…" entry points on run console, skill page, later more. |
| **D-AS6** | **Persistence: persist + resume** | Threads + settled events in SQLite (full replay); SDK session resume across idle-park and container restarts; startup orphan reconciliation. |
| **D-AS7** | **Context: in-process MCP tools + context envelope** | Typed tools over app data fetch on demand; every message carries current route/entity. Nothing preloaded by default. |
| **D-AS8** | **UI coupling: sees page + drives UI** | Agent gets `ui.*` tools (navigate / open run turn / open skill / open diff) executed client-side against an allowlisted view registry. |
| **D-AS9** | **Name: "Assistant"** | Never branded "Claude Code" (policy). "Powered by your Claude subscription" as subtitle. No collision with the deterministic Advisor workstream. |
| **D-AS10** | **Model & caps: per-session picker + caps** | Model dropdown per thread (roster read from the SDK/plan; default latest Sonnet); per-message `maxTurns` cap (default 50); idle timeout parks the child (default 10 min); active-session cap (default 2). |
| **D-AS11** | **Metering: none** | No usage/token UI for assistant sessions. (Raw usage may be stored in events for the future; explicitly out of scope.) |
| **D-AS12** | **Deliverable: roadmap plan docs** | This folder; implementation via `/next-wp assistant`. No code in the planning session. |
| **D-AS13** | **Skill edits: materialized workspace** | Skill version checked out to `/data/assistant/ws/<thread>/<skill>/`; agent edits with native file tools (Bash disabled, dir-confined); commit imports the tree via `SkillRepository.createVersion` → one new immutable version + diff card. |
| **D-AS14** | **Dual auth: per-session picker, no silent fallback** | Session shows its source (default subscription); switchable per new session. Limit errors surface with explicit one-click "retry on API key" — never silent spend. Session env carries exactly one auth var. |
| **D-AS15** | **History: thread list inside the dock** | Dock-header switcher: recent threads + threads pinned to the current entity. No new route, no nav change. |
| **D-AS16** | **UI actions: instant navigation** | Agent-initiated navigation executes immediately (single-owner tool, always user-prompted); browser back works; replayed `ui_action` events render as inert chips. |
| **D-AS17** | **Sandbox (planner-derived hard rule)** | `settingSources: []`; scratch `cwd` under `/data/assistant/`; `Bash`/`WebSearch`/`WebFetch` and all exec/network built-ins disallowed; secrets never in agent context (redacted reads; no secret-bearing tool schemas; minimal child env). |
| **D-AS18** | **Team-server boundary (planner-derived)** | Offering claude.ai login to other users of a shared instance is prohibited by Anthropic policy. Under `team-server`, the Assistant stays owner-credential-only (admin-gated) or moves to per-user API keys — decided in that workstream. |

## Refinement R1 (owner Q&A, 2026-07-10 — after the first working build)

Plan: [`refinement-01-scope-structure-live-edits.md`](./refinement-01-scope-structure-live-edits.md).

| id | Decision | Detail |
| --- | --- | --- |
| **D-AS19** | **Writes hard-locked to the current page entity** | The assistant may only WRITE to the entity of the current page (skill page → that skill only; the environment/tests/servers/other skills are off-limits). Enforced authoritatively in `canUseTool` per message from the current envelope's scope (deny out-of-scope tools + id-mismatched targets, with a model-visible reason); **unscoped/global = read-only**. **Reads stay broad** (it still reads runs/environments to inform the work). The page envelope is upgraded from "a hint" to an **instruction**. Fixes the observed bug where enhancing a skill edited the environment's system prompt. |
| **D-AS20** | **Full skill-structure awareness** | In skill scope, the assistant is given the skill's full file tree + rendered `SKILL.md` and instructed to read every file (incl. `references/`) before editing. (Materialization already writes all files.) |
| **D-AS21** | **skill-creator bundled read-only** | Anthropic's `skill-creator` (SKILL.md + references) ships in the image as a read-only reference, added to `additionalDirectories` in skill scope; the app's `docs/skill-authoring.md` (Quality rule↔anchor contract) is surfaced too. Never executed. Fallback: distilled checklist + `skill-authoring.md` if skill-creator can't be vendored, flagged for the owner. |
| **D-AS22** | **Live working-copy + auto-navigate; one save at the end** | The assistant's server-side workspace is reflected **live** in the Files view (changed files badged, diff vs base) via new transient `workspace_opened/_file_changed/_committed` stream events + a live-workspace read endpoint; the UI **auto-navigates** to each file as it's edited (debounced). "Save once at end" = the existing gated `skills_commit_workspace` approval (the live view is the review surface). No auto-commit per edit. |
| **D-AS23** | **Scope is visible** | The dock shows a "Scope: `<kind> <name>`" chip from the current envelope (unscoped → "Read-only — open an entity to enable edits"); it re-derives on navigation. |

## Refinement R2 (owner Q&A, 2026-07-11 — session management)

Plan: [`refinement-02-session-management.md`](./refinement-02-session-management.md). No migration.

| id | Decision | Detail |
| --- | --- | --- |
| **D-AS24** | **Threads are entity-scoped** | Threads created on an entity page are **pinned** to that entity; the dock switcher shows **only the current entity's** threads (server-filtered), with a small **"All threads"** escape hatch; non-entity/global pages show all. Fixes "I see every thread regardless of page." (Server-side entity filter already exists — the switcher just wasn't using it, and new threads were created unpinned.) |
| **D-AS25** | **Release the session on reply; resume on next message** | A thread's live SDK session is **released the moment a turn completes** (`park()` at `onTurnComplete`: kills the child, frees the cap slot, keeps `sdkSessionId`) instead of staying warm for the 10-min idle window; the next message **resumes** it. Configurable grace `ASSISTANT_RELEASE_GRACE_MS` (default 0). Error/limit paths also converge to release so nothing stays `running` holding a slot. Fixes the "too many sessions are running" cap 409s (normally ≤1 active session). Trade: a small per-message spin-up. |
| **D-AS26** | **Thread names + dates** | Auto-title from the **first message immediately** (deterministic, free), then **LLM-refine after the first reply** — best-effort, feature-flagged (`ASSISTANT_AUTO_TITLE`/`ASSISTANT_TITLE_MODEL`), a bounded one-shot that is **NOT cap-counted** and silently falls back to the deterministic title on any failure. Switcher renders **title + a relative date**; inline **rename** supported (PATCH-title already wired). Replaces the universal "New thread". |

## Refinement R3 (owner Q&A, 2026-07-11 — session starters)

Plan: [`refinement-03-session-starters.md`](./refinement-03-session-starters.md) (incl. the full authored catalog). No migration.

| id | Decision | Detail |
| --- | --- | --- |
| **D-AS27** | **Session starters in the empty state** | A new thread's empty state (`PendingPanel`) shows contextual **starter chips** for the current sheet/entity; clicking one **prefills the composer** via the existing `openAssistant` (which fills, **never auto-sends**). Replaces the actionless "Say something to get started". |
| **D-AS28** | **Curated + data-aware, deterministic (no LLM)** | A shared **base catalog** per surface (`assistant-starters.ts`) + **rule-based conditional** starters computed **server-side** from cheap reads (`GET /api/assistant/starters`, modeled on the `deriveNextSteps` engine) — instant, free, versioned, repeatable. Conditionals fire only when the entity's state supports them (failed scan, low pass-rate, over-budget skill, …). |
| **D-AS29** | **Starters respect the R1 scope-lock** | Action starters are offered **only where their write is in scope** (`SCOPE_WRITE_TOOLS`): skill edits on the skill page, config on the server page, membership on a collection, test/environment writes on the Environment page. Read-only surfaces (run/scan/compare) get **analysis** starters only. Never suggest something the scope-lock would deny. |

## Refinement R4 (owner Q&A, 2026-07-14 — MCP invocation · cross-entity issue filing · fresh session on open)

No migration (`rating_issues.bucket`/`fix_target` are plain TEXT; the occurrence `category` column is TEXT — only the shared **type** widens to add `manual`). Code: `apps/api/src/assistant/tools/action-tools.ts`, `packages/shared/src/assistant-scope.ts` (`SCOPE_EXEMPT_ACTION_TOOLS`), `apps/api/src/scans/service.ts` (`listTools`), `apps/api/src/grading/issue-service.ts` (`fileManualRatingIssue`), `apps/web/src/features/assistant/{assistant-context,AssistantDock}.tsx`.

| id | Decision | Detail |
| --- | --- | --- |
| **D-AS30** | **Assistant can invoke registered MCP servers** | New `mcp_tools_list` (read, live `tools/list`) + `mcp_tool_call` (gated) tools delegate to the app's **existing in-process bridge** (`ScanService.listTools`/`callTool`) — secrets stay in `apps/api`, the runtime boundary holds, and the call's request/response **token & byte cost is measured**. `mcp_tool_call` is `write`-classified (asks per call; the per-thread auto-accept toggle can waive) and returns UNTRUSTED output (the system prompt's untrusted-content rule already covers it). |
| **D-AS31** | **File rating issues against a skill / MCP server** | New `rating_issues_list` (read) + `rating_issue_file` (gated) tools reuse the **Rating Issues registry** (the same home the auto-rating `error_forensics` pipeline files into). `rating_issue_file` requires the analyzed `runId` (the occurrence's `NOT NULL` contributing-run link), resolves the target name from the skill/server repo, pins the run's resolved skill version, and **light-dedups** by (target, normalized title): a re-file adds a sighting (`times_seen++`, re-opens a resolved issue) instead of duplicating. Manual occurrences carry `category: "manual"`. |
| **D-AS32** | **Scope-exempt cross-entity ACTION tools** | `mcp_tool_call` + `rating_issue_file` are **exempt from the R1 page-scope write lock** (D-AS19) via `SCOPE_EXEMPT_ACTION_TOOLS` (owner "narrow exemption"): they are external / append-only ACTIONS, not edits to the open entity's config, and are useful precisely while looking at a **different** entity ("analyze a run → call the server it used / file an issue against the skill it loaded"). They are still **approval-gated** — only the scope hard-deny is skipped; entity-**config** writes stay fully scope-locked. Enforced in `handlePermission`; guarded by a set-equality test. |
| **D-AS33** | **Expanding the dock starts a fresh session** | A plain expand (TopNav toggle / ⌘J, no page-hook payload) opens the dock on the **blank "Start a conversation"** state instead of resuming the last thread; past threads stay one click away in the switcher, and the first message lazily creates a thread pinned to the current entity. Implemented as a one-shot `consumeFreshSessionOpen` flag the dock reads at mount (a page reload or a page-hook `openAssistant({entity})` open still auto-selects / pins as before). |
