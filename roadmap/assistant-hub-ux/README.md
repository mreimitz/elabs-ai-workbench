# Assistant Hub UX — workstream

Rebuild the Assistant Hub's UI onto the app's own shell grammar and purpose-build every surface,
per the owner-approved concept **[`assistant-hub-ui-concept.html`](./assistant-hub-ui-concept.html)**
(revision 4, 2026-07-18 — open it in a browser; it contains the audited evidence, wireframes,
component maps, and a live demo of the composer choreography). This README locks the decisions;
[`execution-plan.md`](./execution-plan.md) turns them into parallel work packages;
[`STATUS.md`](./STATUS.md) is the **authoritative ledger**; [`kickoff-prompt.md`](./kickoff-prompt.md)
starts the orchestrator.

**Branch:** `feat/assistant-hub-ux` · **Gate per WP:** `corepack pnpm@9.15.4` →
`pnpm typecheck && pnpm test` (+ `pnpm build` at wave integration only) · Biome clean.

**Scope guard:** apps/web hub surfaces + additive hub API/wire only. The Testing/run consoles,
grading, scans, and skills surfaces are OUT of scope. Coordination notes for other workstreams
are in the plan §0.

---

## Locked decisions (fixed input — a WP that disagrees STOPS and writes a STATUS blocker)

| # | Decision |
|---|---|
| **D-HUX1** | Every `/assistant/*` route joins the PageShell registry (`fullBleed` mount). All fixed-height inner frames (`min-h-[36rem]`, 3× `h-[46rem]`) are **deleted**, not adjusted. One scroll owner per region; PageShell owns gutter + scroll (§S16/S22). |
| **D-HUX2** | Two header grammars only: `PageHeader` for library/analytics surfaces; `PageShell headerVariant="toolbar"` + `ViewToolbar` for workspace, sessions, audit. All six hand-rolled icon+Heading headers are deleted; page identity comes from nav + breadcrumb. |
| **D-HUX3** | The workspace's side surfaces collapse into **one meta rail** (360 px, `shrink-0`, own scroll): stacked, individually collapsible sections **Progress · Outputs · Context**, one master show/hide toggle in the toolbar (the Cowork-panel pattern), counts visible when collapsed, `Sheet` fallback under ~1100 px content width. The Files modal, the sliding aside, and the three-way `activeAside` switch are retired; Outputs merges artifacts + workspace files. |
| **D-HUX4** | Session history is a **page**: `/assistant/sessions` (nav child under Assistant) as a sortable/filterable `DataTable` (status, mode, project, model, turns, tokens in/out, cost, updated, last error, open). The permanent `SessionRail` is removed; the workspace toolbar gets a `Combobox` session switcher (recent + "View all" + "New"). Top-level sessions only; agent child-sessions surface via missions/usage. |
| **D-HUX5** | Agents &amp; Crews becomes the **workforce section**: one `PageHeader`, tabs **Directory · Org chart · Usage**, a shared org rail (All agents / Crews (each with count) / Unassigned / Archived) scoping a card grid. Click = select; double-click, Enter, or the card ⋯ menu = open profile. Roles/Crews `TabPanel` is deleted. UI language says "Agents"; the wire keeps the role vocabulary (rename precedent: Scenario→Environment). |
| **D-HUX6** | Entity settings are **`WideDialog nav="rail"` profile modals** (S17 tier 3). Agent sections: Profile · Instructions · Model · Access · Skills · Memory · Budgets · Usage. Crew sections: Profile · Members · Topology · Budgets · Memory · Usage. Quick-create stays a ≤6-field `FormDialog` ("Create, then open profile"). Primary labels state consequence; dirty guard on. |
| **D-HUX7** | The Access section grants **per server AND per tool**: tri-state server checkbox, per-tool checkboxes, search, all/none per server, live counts — and every tool row shows its **scan-measured token cost**, with a running footprint total for the granted set. |
| **D-HUX8** | Agent identity: optional `displayName` (persona name) + avatar, role title as fallback; one-line description. **Crew colors** map to `--chart-1…5` (theme-aware). Color appears ONLY as small accents (avatar ring, 3 px card top border, dot next to names, org-chart group tint) — never fills, never text color, always paired with the crew name. Multi-crew agents: local crew's color inside a crew scope, stacked dots in All agents. |
| **D-HUX9** | The **Org chart** tab renders on `@brand/flow` (`CanvasShell`, `FlowGroupNode` per crew tinted by crew color, `FlowNode` members, `FlowMiniMap`, `useAutoLayout`, `InspectorPanel`): edges inside a crew draw its **real execution topology** (pipeline chain · parallel fan · debate pair · best-of-N fan-in). v1 is read-and-navigate; drag-to-reassign is explicitly v2. |
| **D-HUX10** | The Usage page dissolves into the workforce **Usage tab**: `DateRangePicker` + group-by (agent · crew · model · project · mode) + `MetricGrid` + charts + ranked `DataTable` with URL-held drill state, ending at sessions → replay. Unattributed spend renders as an explicit **"no agent" bucket** — never a silently short total. Per-entity panels: 30-day strip on cards, Usage sub-page in both profiles. `/assistant/usage` redirects. |
| **D-HUX11** | Memory dissolves into **scopes**: `profile` (global) · `project` · `agent` · `crew`. Profile memory is managed from the workspace Context section; entity memories live in their profiles/detail. Assistant save-proposals carry a scope picker (default: most specific sensible owner). The workspace Context shows the session's **effective stack** (profile + project + crew + agent, injection order, each entry tagged + linked). Conflict rule: most-specific-wins, transparently shown. `/assistant/memory` redirects. Wire: additive `scope` field. |
| **D-HUX12** | The transcript gets a **dot-grid canvas**: 1 px radial-gradient dots on ~14 px cells using the `--canvas-grid` token, mask-faded to transparent before the composer, non-scrolling layer, gated by `DecorationProvider` (off at minimal). No raw colors. |
| **D-HUX13** | **First-prompt choreography**: a fresh session opens with the composer centered (greeting + starter `Suggestions` chips); on first send it animates once to the docked position (~240–280 ms, `duration-base`/`ease-standard`, transform-based); sessions with history start docked; `motion-reduce` renders the docked state instantly. |
| **D-HUX14** | One status vocabulary: hub states map onto the app's `StatusBadge`/`lib/status` derivation (sessions: running/complete/failed · missions/agents: pending/awaiting-approval/running/complete/failed/skipped · tool calls: the kit contract · audit outcome: complete/failed). Categorical labels use `Badge` variants. Exactly **one `EmptyState` per region**, one primary action, next-step phrasing. |
| **D-HUX15** | Nav consolidates **6 → 4**: Assistant (+ Sessions child), Agents &amp; Crews, Projects, Audit. `/assistant/memory` and `/assistant/usage` become redirects (memory → its new homes via an interstitial-free sensible target: profile-memory dialog deep link; usage → `/assistant/agents?tab=usage`). |
| **D-HUX16** | Wire changes are **additive only** (shared types + zod first, then API, then web; versionless `/api`). New fields: memory `scope`, agent `displayName`/`avatar`, crew `color`, usage group-by/attribution params + rows, session-list stat fields as needed. No breaking change; a needed breaking change escalates to the owner. |

## Pre-flight decisions (locked 2026-07-18, owner Q&A — remove any orchestrator ambiguity)

| # | Decision |
|---|---|
| **P1** | **Base branch: `main`.** The owner confirms local `main` already contains the Assistant Hub, the PageShell/ux-overhaul shell, and the unified-sessions status module. The orchestrator still runs a 30-second preflight (files exist: `apps/web/src/features/hub/`, `apps/web/src/components/PageShell.tsx`, the `lib/status` derivation) and STOPS with a blocker if any are missing. |
| **P2** | **Avatar v1 = icon + color, no new wire field.** Reuse the existing role `icon` field + `RoleAvatar` (initials/icon + auto color) + the crew-color ring (D-HUX8). No emoji picker, no image upload in this workstream. WP0.1/WP1.7 therefore add only `displayName` and crew `color` to the wire. |
| **P3** | **`/assistant/memory` redirects to `/assistant?memory=profile`**, which opens the profile-memory manage dialog in the workspace (D-HUX11/15 made concrete). |
| **P4** | **Sessions rows: archive only.** Additive `archived` flag + a Show-archived toggle in the Sessions table, mirroring roles/crews. No hard delete in this workstream; retention stays a later maintenance feature. |

**Owner-gated follow-ups (not in this workstream):** org-chart drag-to-reassign semantics; crew
palette extension beyond 5; persona-name defaults; memory conflict-warning UX beyond
most-specific-wins; workspace rail resize.

**Known input bugs this workstream must fix en route:** the silent "Create role" no-op (enabled
button, no request, no validation, no toast — reproduced 2026-07-18); Autonomy helper-text
clipping; session-rail label truncation (rail itself is removed).
