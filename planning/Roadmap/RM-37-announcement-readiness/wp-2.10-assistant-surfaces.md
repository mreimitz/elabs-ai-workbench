---
type: "Work Package Spec"
title: "WP 2.10 — Assistant surfaces when the flag is on: start surface, compact rail, sessions table, agents tree and usage reconciled, audit timestamps, dock starter contrast and single error surface; audit and notification recording restored"
description: "Phase 2 of item.md. Ledger: STATUS.md. With the Assistant flag on, the Hub opens on a start surface instead of the last transcript, its rail collapses empty sections to actionable rows, the sessions table derives its state from the session and mission the workspace shows and uses one cost grammar, agents and usage share one window and untruncated names, the audit log gets absolute timestamps and real actions, and the dock's pre-filled starter becomes readable with one error surface per failure; the audit/notification writes that stopped on Jul 28 are found and restored."
tags: ["roadmap", "RM-37"]
timestamp: "2026-08-22T07:10:00Z"
status: "final"
---
# WP 2.10 — Assistant surfaces when the flag is on: start surface, compact rail, sessions table, agents tree and usage reconciled, audit timestamps, dock starter contrast and single error surface; audit and notification recording restored

Phase 2 of [`item.md`](./item.md). Ledger: [`STATUS.md`](./STATUS.md). Follows the rules in
[`wp-2.1-shell-ia.md`](./wp-2.1-shell-ia.md) (rules 2, 3, 4 and 7 apply here).

## Scope

Every surface the `assistant` / `app_assistant` flags reveal: the App-assistant dock (⌘J;
`apps/web/src/features/assistant/AssistantDock.tsx`, `AssistantComposer.tsx`, `AssistantLimitErrorBanner.tsx`,
`assistant-scope-chip.ts`), `/assistant` (`features/hub/AssistantView.tsx`, `EmptySessionIntro.tsx`,
`NewSessionDialog.tsx`, `meta-rail/*`), `/assistant/sessions` (`hub/sessions/*`), `/assistant/agents`
(`hub/workforce/*`), `/assistant/projects` (`hub/projects/*`), `/assistant/audit` (`hub/AuditView.tsx`) and
the bell; API `apps/api/src/hub/audit.ts`, `hub/routes.ts`, `hub/missions/routes.ts`, `hub/repository.ts`,
`hub/subscription-adapter.ts`, `hub/turn-engine.ts`. **Out of scope:** the flag default and the single
"Assistant (preview)" nav entry (WP 0.1), the nav grouping, empty header bands and the ⌘J badge (WP 2.1), the
planning-id leak in the project editor (WP 3.1), `?session=` / `?project=` URL state (WP 3.4), the approval
policy itself (WP 1.5 — this WP only makes the UI state it), model-identity "not pinned" rows
([`/Roadmap/RM-16-model-identity/item.md`](/Roadmap/RM-16-model-identity/item.md)), the pre-flight panel (WP
1.4) and neutral demo data (WP 1.1). **Continues**
[`/Roadmap/RM-02-assistant/item.md`](/Roadmap/RM-02-assistant/item.md) and
[`/Roadmap/RM-03-assistant-hub/item.md`](/Roadmap/RM-03-assistant-hub/item.md); the RM-36 ledger records these
routes as un-audited — this WP is that sweep's remediation.

## Target layout

| Zone | Component | Contents | Removed / merged / demoted |
|---|---|---|---|
| **Dock** 1. Header | `ChatShell` header row | "App assistant" (names itself) · conversation switcher · ⋯ (rename · all conversations) | "thread" as a noun; "New conversation" as the header of an empty dock |
| 2. Empty state | `StatePanel` + `Suggestion` chips | one sentence: "Reads this page and your servers, scans, runs and skills; can navigate for you and, with your approval, edit. For research or missions use Assistant ▸" · starter chips (a click fills the composer with **readable** text) | "Send a message to start a new conversation"; invisible pre-fill |
| 3. Composer | `PromptInput` + status strip | composer · model picker · scope pill "Can't make changes here — open a server, skill, run or test" / "Editing: <name>" · credential badge | "Awaiting your input" before any input; "Read-only — open an entity to enable edits" |
| 4. Failure | **one** `Alert` per failure | the limit banner with its retry / switch-credential actions, **or** the connection alert — never both; no empty assistant bubble for a failed turn | the second alert; the empty bubble with a copy icon |
| **/assistant** 5. Start surface | `EmptySessionIntro` | first visit or no session in 24 h: composer with an inline mode/model bar, "Runs on: subscription (signed in) · forecast" line, "Configure…" opens the modal; returning users land on the last session | the modal as a gate; the last transcript as the landing page |
| 6. Meta rail | `MetaRail` sections | SESSION › Progress (display names, ids in tooltip) · Outputs; CONTEXT and TOOLS as one-line rows with an action ("Add project", "Connect tools") until they have content; Scoped picker with per-server and per-tool token cost and a search box | two ~130 px empty cards; 146 bare checkboxes |
| **/assistant/sessions** 7. Table | `EntityTable`, 36 px rows | Title · Status (derived from the state the workspace shows) · Mode · Model (display name, id on hover) · Tokens in / out (`TokenAmount`, one line) · Cost ("Subscription" marker / "— not priced") · Updated · ⋯ | Project and Last error (column chooser, off by default); "New session · Pending · 0 turns" rows (auto-archived after a day); "$0.00"; two-line Tokens |
| **/assistant/agents** 8. Rail + Directory | `OrgRail` + `AgentCard` 3-up | crew names untruncated (counts in a tooltip) · card: name · description · crews · model chip · "All tools · 2 servers" or "7 tools" · "n runs · $x · 30d" (sparkline only with data) | "Ex…", "Intel…"; "0+ tools"; the dotted empty sparkline |
| 9. Org chart / Usage | `CrewTopologyGraph`; `UsageKpis` + `UsageCharts` | chart fits the selected crew, legend collapsible; Usage keeps the rail and one window for KPIs and charts; "99 sessions incl. agent sub-sessions" | auto-fit of the whole org; "$6.84 all time" beside "Nothing in this window yet"; the rail vanishing on Usage |
| 10. Mission / crew launch | `MissionPlanCard`, crew profile | a line stating "This crew runs its granted tools without a per-call approval" wherever a grant means unattended execution | implied per-call gating |
| **/assistant/audit** 11. Header + table | `ViewToolbar` + `DataTable` | results "Last event Aug 21, 18:04 · 50 events"; Time (absolute, relative on hover) · Action ("Model call · <model>", "Tool call · <tool>") · Kind · Session · Outcome (tokens · cost · Failed) | date-only "Jul 28"; model ids and finish reasons as the Action |

Primary actions: Send (dock and Hub) · **+ New session** · **+ New** (agents); Save on Projects waits for
edits.

## Actions

1. **Audit and notification recording stopped on Jul 28 — P1.** WHAT: completed missions from Aug 18–21 appear
   in `/assistant/sessions` but neither in `/assistant/audit` (newest group "July 28", Session filter without
   them) nor in the bell. The cause was not identified in the review; the candidates are (a) `hub_events` rows
   from the subscription executor (`apps/api/src/hub/subscription-adapter.ts:230,632` `appendEvent`) missing
   the kinds the projection correlates (`tool_call` / `tool_result`, `assistant_message`, `agent_spawned`)
   that `turn-engine.ts:255,289` writes, (b) the `HubNotifySink` not threaded on the path those missions took
   (`hub/routes.ts:1459,1520` → `hub/missions/routes.ts:81,104,258-260`), (c) the `MAX_SCAN = 4000` window in
   `hub/audit.ts:48,95`. WHERE: `/assistant/audit`, bell · the files above. TARGET STATE: every session since
   Jul 28 has its events in the audit projection and its terminal notification; a backfill from stored events
   where possible; a watch rule "no audit event in 24 h while sessions ran"; the audit header prints the
   last-event timestamp so a silent stop is visible.
2. **Session list state and one mission status — P1.** WHAT: a row reading "Pending · Mission · 1 turn · 0 / 0
   tokens · $0.00" opens as a completed Debate mission; a notification "The mission finished and synthesized
   its results" lands on a session whose breadcrumb says Failed, card "Complete", rail "Completed · partial ·
   2 of 5 agents reported". WHERE: `hub/sessions/columns.tsx:81-148`, `hub/repository.ts:592`
   (`listSessions`), `hub/missions/board.ts`, `hub/MissionBoard.tsx:429` ("Complete"),
   `meta-rail/mission-status.ts`, the notification text at `hub/missions/routes.ts:258-260`. TARGET STATE: the
   list derives Status, Turns, Tokens and Cost from the same session + mission state the workspace renders;
   one mission status source feeds breadcrumb, card, rail and notification ("Mission ended partially — 3
   agents skipped"); rows with zero turns after a day are auto-archived (`hub/retention.ts`).
3. **Dock: readable pre-filled starter and one error surface — P1.** WHAT: a starter chip pre-fills the
   composer (`AssistantComposer.tsx:48-52`, remounted `PromptInputTextarea` `:183`) but the text is
   near-invisible — probable cause, to confirm on the running app: the composer uses the content area's text
   tokens while the dock sits on the `--sidebar` surface, dark in the light theme
   (`components/AppShell.tsx:825`, `styles/app.css:358`). One failure renders twice: the `limit_error` turn as
   `AssistantLimitErrorBanner` (`:52` "Subscription limit reached", amber title on amber) **and**
   `stream.error` as the destructive "Connection issue" alert (`AssistantDock.tsx:681-686`), plus an empty
   assistant bubble. WHERE: the dock · the files above. TARGET STATE: pre-filled text meets AA on the dock
   surface in both themes; a failed turn shows exactly one alert with a readable title and the one recovery
   (retry / switch credential / open Settings), and no empty bubble; a new dock conversation opens on the
   page's starters, never on the last errored thread.
4. **Dock follows the app theme — P2.** WHAT: the dock renders on the app's content tokens (or the sidebar
   token family is made theme-consistent) so one screen shows one visual system. WHERE:
   `AssistantDock.tsx:623-636` (`ChatShell variant="bare"` on `bg-sidebar`), `AppShell.tsx:801,825`,
   `styles/app.css:264-300`. Coordinate with WP 2.1, which carries the same line — whichever lands first
   closes both. TARGET STATE: with the light theme active the dock is light; the transcript fades still
   dissolve.
5. **Dock names itself and its scope — P2.** WHAT: zones 1–3 copy; "conversation" everywhere in the dock (the
   Hub keeps "session"); the `scenario` survivors become "environment". WHERE: `AssistantDock.tsx:135`
   (`ENTITY_KIND_LABELS.scenario`), `:156,180,726,1054`; `assistant-scope-chip.ts:48,60-63` (carry the
   entity's display name in the envelope); `AssistantComposer.tsx:173` (idle line); API
   `apps/api/src/testing/scenario-repository.ts:100,114,198`, `apps/api/src/skills/repository.ts:541,568`
   ("Environment not found", "pinned by one or more environments"). TARGET STATE: neither "thread" nor
   "scenario" reaches the screen; the scope pill reads "Editing: <name>" or the zone-3 sentence.
6. **Hub start surface, inline start, "Runs on" line, Scoped picker with costs — P1.** WHERE:
   `hub/AssistantView.tsx` (opens on the last session), `EmptySessionIntro.tsx`,
   `NewSessionDialog.tsx:101-105,291-292` (Auto / Scoped, Auto / Pick → "Auto / Choose" for all three
   toggles), `SessionBreadcrumbSwitcher.tsx`, `hub/meta-rail/ManageToolScopeDialog.tsx`. TARGET STATE: a user
   with no session in 24 h sees the start surface and can send the first message without the modal; the model
   row states which credential bills the session and a forecast; "Research" says it needs a search server; the
   Scoped picker shows tokens per server and per tool and has a search box.
7. **Meta rail: collapsed empty sections with actions; display names — P2.** WHERE:
   `meta-rail/ContextSection.tsx:303,471-472,599-600`, `meta-rail/ProgressSection.tsx:256` (agent ids).
   TARGET STATE: "No project — Add project" and "No MCP servers — Connect tools" as one-line rows; agents show
   display names with the id in a tooltip.
8. **Sessions table columns and cost grammar — P1.** WHERE: `hub/sessions/columns.tsx:59-189` (`max-w-[12rem]`
   on Model, two-line Tokens, `formatCostUsd` at `:147`), `hub/sessions/SessionsView.tsx`; `cost_basis` /
   `cost_priced` from WP 2.8's migration; `lastViewedAt` separated from `updatedAt` so opening a session no
   longer re-sorts the list. TARGET STATE: zone 7; a 583k-token subscription session reads "Subscription",
   never "$0.00"; the header says "Tokens in / out".
9. **Agents & crews: names first, honest cards, fitted org chart, one usage window, one noun — P2.** WHERE:
   `hub/workforce/OrgRail.tsx:765,845,916-918`, `AgentCard.tsx:34-36,257-258` ("N+ tools"),
   `org-chart/OrgChartTab.tsx:275` (`OrgLegend`), `usage/UsageCharts.tsx:90-138`, `usage/UsageKpis.tsx`,
   `usage/UsageTab.tsx`, `WorkforceView.tsx`; the "role" strings at `crew-profile/MembersSection.tsx:154,225`,
   `agent-profile/FormSections.tsx:74` and the API error "Hub agent role not found". TARGET STATE: zones 8–9;
   "All tools · 2 servers" when any grant is `all`; the legend collapses; the org chart fits the selected crew
   at ≥ 11 px labels; the KPI window equals the chart window; the session count is labelled; the saved
   identity is an **agent** everywhere ("Add an agent", "No agents yet — a crew is a team of agents", field
   "Title", error "Agent not found").
10. **The launch UI states unattended execution — P1 (SEC-05 cross-reference).** WHAT: where a mission agent or
   auto-accept thread will run an external MCP tool without a per-call card, say so before launch; the policy
   itself (restore gating or document it) is WP 1.5's. WHERE: `hub/MissionPlanCard.tsx`,
   `NewSessionDialog.tsx` Agents & Crews tab, `workforce/crew-profile/BudgetsSection.tsx:36`,
   `workforce/agent-profile/FormSections.tsx:288` ("autonomy dial" → "autonomy setting"). TARGET STATE: no
   launch surface implies per-call approval that does not exist.
11. **Audit: absolute time, real actions — P2.** Root cause (UXC-23): the Time column uses
   `formatRelativeTime`, which after seven days is a bare date, and model calls are titled with the model id
   and subtitled with the raw `finishReason`. WHERE: `/assistant/audit` · `hub/AuditView.tsx:617`, `:199-201`.
   TARGET STATE: zone 11; finish reasons through a label map ("Finished" / "Called tools" / "Hit length
   limit").
12. **Small defects — P3.** WHAT: composer icon tooltips clipped at the left edge; Save enabled with nothing to
   save on Projects and in Settings › Grading / Storage; provider model-list 502s on `/assistant` surfaced as
   a chip instead of silence. WHERE: `hub/Composer.tsx` (`collisionPadding` / `side="top"`),
   `hub/projects/ProjectEditor.tsx`, `settings/SettingsView.tsx`, `hub/use-hub-models.ts:242`. TARGET STATE:
   every tooltip fully visible; Save disabled until dirty; a failed model list names the credential.

## Acceptance

- [ ] With the flag on and after a mission completed today: `/assistant/audit` lists its events with absolute
      times and "Model call · …" / "Tool call · …" actions, the bell shows its terminal notification, and the
      audit header states the last-event time.
- [ ] `/assistant/sessions`: no row reads Pending for a session whose workspace shows a completed mission;
      Tokens renders on one line; no "$0.00"; Project and Last error are hidden by default; opening a session
      does not change its Updated value.
- [ ] Dock, light theme: clicking a starter chip yields visibly readable composer text (contrast ≥ 4.5:1
      measured); a forced limit error renders exactly one alert with a readable title and one recovery action,
      and no empty assistant bubble; the dock surface matches the app theme.
- [ ] `/assistant` for a profile with no session in 24 h opens on the start surface; the first message sends
      without the modal; the model row names the billing credential.
- [ ] `/assistant/agents` at 1440×900: no truncated crew name in the rail; no "0+ tools"; the Usage tab keeps
      the rail and its KPI window equals the chart window; the org chart's labels are legible on open.
- [ ] No user-facing string under `features/assistant` contains "thread" or "scenario" (grep, non-test files).
- [ ] Both themes read correctly on every route.
- [ ] Gate green: `pnpm typecheck && pnpm test && pnpm build && pnpm lint`.

## Effort

**L** overall — 1, 2, 6 and 9 are M; 3 and 8 S–M; 4 S (shared with WP 2.1); 5, 7 and 10–12 S.

## Sources

UX-32, UX-33, UX-34 · QA-03, QA-04, QA-05, QA-28 (Save buttons; URL parts in WP 3.4), QA-29, QA-30, QA-36
(provider 502) · EU-25, EU-26 · UXC-09, UXC-11, UXC-12, UXC-23, UXC-24, UXC-33, UXC-34, UXC-40 (Hub toggles),
UXC-30 (rail rows #9) · ENG-17 (mechanism in WP 2.8) · PO-20, PO-30 (start surface; nav part in WP 0.1) ·
PS-02 (display names; demo data in WP 1.1), PS-18 (dock error surfaces; pre-flight in WP 1.4) · SEC-05
(cross-reference) · walkthrough dock, `/assistant`, `/assistant/sessions`, `/assistant/agents`,
`/assistant/projects` and `/assistant/audit` notes.
