# Assistant Hub UX — execution plan (orchestrator + parallel subagents)

Written to be executed by an **orchestrator session driving multiple subagents in parallel
worktrees** (the `/next-wp` pattern). Every WP declares: goal, worksteps, **owned files
(exclusive — the conflict-avoidance contract)**, dependencies, agent profile + **model tier**,
effort (S ≤ half day · M ≈ 1 day · L > 1 day, agent-time incl. tests), and acceptance.
Decisions **D-HUX1…16** ([README](./README.md)) are fixed input. The concept
(`assistant-hub-ui-concept.html`, r4) is the visual spec — §7 per surface, §8 cross-cutting.

Context every agent gets: this folder's README + the concept §7.x for its surface, `CLAUDE.md`,
`.claude/rules/*` (brand-ui-only, styling-and-tokens, library-first, quality-gates,
loading-states, interaction-guidelines). Gate per WP: `corepack pnpm@9.15.4` →
`pnpm typecheck && pnpm test`; `pnpm build` at wave integration only (parallel builds OOM).
Wire discipline: shared types + zod FIRST, additive only (D-HUX16).

---

## 0. Coordination with other workstreams & seam files

- **Unified Sessions** is merged through WP5.1 (facade mounted; docs WP running). This plan
  CONSUMES its status derivation (`lib/status.ts` / `deriveRunStatusView`) — D-HUX14 maps hub
  states onto it; we do not edit its files except the mapping call sites we own.
- **Observability** (starts after US Waves 1–3): overlaps live in `testing/*`, not `hub/*`.
  If its Phase-1 work begins mid-flight, the orchestrators exchange STATUS links; no shared files
  are expected.
- **Seam files** (exactly ONE owner per wave; orchestrator sequences merges):
  `apps/web/src/App.tsx` (W0: WP0.2 · W1: WP1.4 route add · W3: WP3.1 nav/redirects),
  `apps/web/src/components/AppShell.tsx` (only WP3.1 touches NAV_ITEMS),
  `apps/web/src/features/hub/AssistantView.tsx` (W1: WP1.1 owns; 1.2/1.3 integrate through its
  declared slots at wave merge), `packages/shared/*` (only WP0.1, then frozen additive),
  `apps/api/src/hub/**` route index (owned by each API WP for its own feature file; one-line
  mounts resolved at wave integration).

## 1. Shared vocabulary (defined once, consumed everywhere)

- **Routes:** `/assistant` · `/assistant/sessions` · `/assistant/agents` (tabs via
  `?tab=directory|org|usage`, nodes via `/assistant/agents/{agent|crew}/:id`, modal via
  `?settings=<section>`) · `/assistant/projects` · `/assistant/audit` · redirects per D-HUX15.
- **New shared types (WP0.1):** `HubMemoryScope = "profile"|"project"|"agent"|"crew"` (+
  `scopeId?`), `HubRole.displayName?` (avatar stays the EXISTING `icon` field per P2 — no new
  avatar field), `HubCrew.color?: "chart-1"…"chart-5"`, session `archived?` (P4),
  `HubUsageGroupBy = "agent"|"crew"|"model"|"project"|"mode"`, usage row + per-entity summary
  shapes, session-list stat fields. All optional/additive; old payloads must still parse.
- **Recipes:** PageShell modes per D-HUX1/2; meta-rail contract D-HUX3; profile modals D-HUX6;
  crew-color accents D-HUX8; canvas + choreography D-HUX12/13; status mapping D-HUX14.

---

## 2. Work packages

### Wave 0 — Contracts & unblockers (all four in parallel, day one)

**WP0.1 — Wire contract** · implementer · **Opus-class** · M · deps: —
Owns: `packages/shared/src/{types,schemas,constants}.ts` (additive only).
Worksteps: (1) add the §1 types + zod (memory scope, agent identity, crew color, usage group-by/
rows/summaries, session stats); (2) backward-compat parse tests for old payloads; (3) short
naming note in the PR body (names here are what every later WP imports — highest blast radius).
Acceptance: gate green; zero breaking diffs against existing fixtures.

**WP0.2 — Shell registry + workspace mount** · implementer · **Sonnet-class** · S · deps: —
Owns: `apps/web/src/App.tsx` (Wave-0 seam owner: PAGESHELL entries + `/assistant/*` prefix
handling only).
Worksteps: (1) add all `/assistant/*` targets to `PAGESHELL_EXACT_ROUTES`/prefixes (D-HUX1);
(2) verify each hub view still renders inside the edge-to-edge main (temporarily unstyled is
fine — Wave 1 restyles); (3) route-level smoke tests.
Acceptance: all six current routes render full-bleed, no dead registry entries, gate green.

**WP0.3 — "Create role" silent no-op fix** · implementer · **Sonnet-class** · M · deps: —
Owns: `apps/web/src/features/hub/agents/{RoleLibraryPanel,RoleEditor}.tsx` + the owning API
route/test file (locate; additive).
Worksteps: (1) reproduce + root-cause (button fires no request, no validation, no console error —
see README bugs); (2) fix; (3) inline validation + error toast per house error rules; (4)
regression test (submit with minimal fields → row appears).
Acceptance: role creation works and FAILS LOUDLY when invalid; gate green.

**WP0.4 — Design tokens & motion preflight** · implementer · **Haiku-class** · S · deps: —
Owns: NEW `apps/web/src/features/hub/lib/hub-ux.ts` (+ test).
Worksteps: export the shared constants later WPs import: meta-rail widths, crew-color token map
(`chart-1…5` → class/token refs), canvas grid CSS (D-HUX12 values), choreography durations
(D-HUX13), sheet breakpoint. One place, no magic numbers scattered.
Acceptance: gate green; file exports match the decisions verbatim.

### Wave 1 — Workspace + backend lanes (after Wave 0; up to 7 agents in parallel)

**WP1.1 — Workspace shell & toolbar** · implementer · **Sonnet-class** · L · deps: 0.2, 0.4
Owns: `features/hub/AssistantView.tsx` (wave seam owner), NEW `features/hub/SessionSwitcher.tsx`;
`features/hub/AutonomyDial.tsx` (tooltip form).
Worksteps: (1) rebuild AssistantView on `PageShell scroll="fill" headerVariant="toolbar"` +
`ViewToolbar` (session title/StatusBadge/autonomy/skills/rail toggle) per concept §7.1;
(2) delete the local PageHeader, the `min-h-[36rem]` frame, and the `SessionRail` column;
(3) `SessionSwitcher` (Combobox: recent, View all, New); (4) declare two integration slots
(`metaRail`, `emptyIntro`) consumed at wave merge; (5) tests (toolbar renders, switcher
navigates, no fixed frames left — assert on class absence).
Acceptance: workspace fills the viewport, transcript is the only scroller, autonomy never clips.

**WP1.2 — Meta rail** · implementer · **Sonnet-class** · L · deps: 0.4
Owns: NEW `features/hub/meta-rail/*` (MetaRail, ProgressSection, OutputsSection, ContextSection,
sheet fallback, tests); refactor-only extractions from `SessionContextPanel.tsx`,
`ArtifactCanvas.tsx`, `WorkspaceFilesPanel.tsx` (content → section bodies; files dialog retired
at integration).
Worksteps: (1) rail frame per D-HUX3 (360 px, collapsible sections with counts, master-toggle
API); (2) Progress = TaskWidget + mission agents w/ StatusBadge; (3) Outputs = artifacts + files
merged list; (4) Context = existing context content + an `effectiveMemory` slot (fed by WP2.7);
(5) `Sheet` fallback; (6) unit tests per section incl. collapsed counts.
Acceptance: rail renders standalone in tests; no mid-word clipping at any width (assert
`min-w-0`/truncation contract); both themes.

**WP1.3 — Chat canvas + first-prompt choreography** · implementer · **Sonnet-class** · M · deps: 0.4
Owns: NEW `features/hub/{ChatCanvas,EmptySessionIntro}.tsx`; `features/hub/Composer.tsx`
(position/animation only); `ConversationPane.tsx` (empty-state region only — coordinate: the pane
is otherwise frozen this wave).
Worksteps: (1) dot-grid layer on `--canvas-grid` + mask fade, decoration-gated (D-HUX12);
(2) centered empty state (greeting + `Suggestions` starters + centered composer); (3) one-time
dock animation, transform-based, `duration-base`/`ease-standard`, `motion-reduce` instant
(D-HUX13); (4) history sessions start docked; (5) tests for state selection + reduced-motion.
Acceptance: matches the concept's live demo behavior; no animation on reopen; decoration level
minimal removes the grid.

**WP1.4 — Sessions page** · implementer · **Sonnet-class** · M · deps: 0.1, 0.2
Owns: NEW `features/hub/sessions/*` (SessionsView, columns, tests); `App.tsx` (this wave's seam:
add the `/assistant/sessions` route line); `lib/api.ts` (list-stats fn, additive); API: extend the
hub session-list projection with stat fields if missing (locate in `apps/api/src/hub/**`; additive
+ tests).
Worksteps: (1) toolbar per §7.2 (search, status/mode/project facets, date range, count, New,
Show-archived toggle); (2) DataTable with `col`/`navCol`, StatusBadge/Badge cells, last-error
tooltip; (3) row → open in workspace; overflow menu rename/archive only — additive `archived`
flag, NO hard delete (P4); (4) EmptyState + reset; (5) tests.
Acceptance: table sorts/filters against real API data; deep links land in the workspace.

**WP1.5 — API: memory scopes** · implementer · **Opus-class** · L · deps: 0.1
Owns: `apps/api/src/hub/**` memory module + its routes/tests; `apps/api/src/db/{schema,database}.ts`
(one additive migration: `scope`, `scope_id`).
Worksteps: (1) migration (existing rows → `profile`); (2) scoped CRUD (list by scope, entity
guards); (3) injection resolver: effective stack = profile + project + crew + agent for a session,
most-specific-wins, exposed on the session context payload (`effectiveMemory`, ordered + tagged);
(4) proposal flow gains a scope; (5) exhaustive resolver tests (conflicts, missing entities,
archived).
Acceptance: old sessions unaffected; resolver order provable from tests; gate green.

**WP1.6 — API: usage attribution & rollups** · implementer · **Sonnet-class** · L · deps: 0.1
Owns: `apps/api/src/hub/**` usage module + routes/tests.
Worksteps: (1) make `from`/`to`/`projectId` actually filter (verify + tests — flagged unexercised);
(2) group-by rollups for agent/crew/model/project/mode with the explicit **no-agent bucket**
(D-HUX10); (3) per-entity summaries (agent/crew 30-day strip + profile Usage payloads);
(4) invariant test: sum(buckets) == total for every group-by.
Acceptance: attribution sums reconcile exactly; unattributed spend is visible, never dropped.

**WP1.7 — API: identity & crew color** · implementer · **Sonnet-class** · M · deps: 0.1
Owns: `apps/api/src/hub/**` roles/crews module + routes/tests; one additive migration
(`display_name`, `color`) — avatar reuses the existing `icon` field, no new column (P2).
Worksteps: (1) migration + CRUD passthrough (+ session `archived` if 1.4 needs it here);
(2) validation (color ∈ chart-1…5); (3) tests incl. old-row null handling.
Acceptance: gate green; API returns identity fields everywhere roles/crews are listed.

**WP1.R — Wave-1 review** · reviewer · **Opus-class** · M · deps: 1.1–1.7
Read-only + test-authoring. Tries to REFUTE: (1) the r1 audit regressions are dead — no fixed
frames, no horizontal overflow, no clipped meta-rail content at 1024/1280/1680 in BOTH themes
(rendered checks, screenshots into STATUS); (2) memory resolver order + usage reconciliation
invariants; (3) choreography respects reduced motion; (4) old deep links (`?session`, `?message`)
still resolve. Findings → STATUS blockers → owning WP fixes → re-verify. Wave merges after pass.

### Wave 2 — Workforce (after Wave 1 merge; up to 7 agents in parallel)

**WP2.1 — Workforce frame & org rail** · implementer · **Sonnet-class** · M · deps: 1.7
Owns: `features/hub/agents/AgentsView.tsx` (becomes a thin shell), NEW
`features/hub/workforce/{WorkforceView,OrgRail}.tsx` (+tests).
Worksteps: (1) PageHeader + New⏷ split button + Tabs (Directory · Org chart · Usage), tab in URL;
(2) org rail: search, All agents / Crews (color dots + counts) / Unassigned / Archived, scope in
URL; (3) node routes + `?settings=` param plumbing (D-HUX5 URL scheme); (4) tests.
Acceptance: tab + scope + node state all URL-addressable; old `/assistant/agents` renders the
directory.

**WP2.2 — Directory tab** · implementer · **Sonnet-class** · L · deps: 2.1 (frame API), 1.6 (strips)
Owns: NEW `features/hub/workforce/{DirectoryTab,AgentCard,CrewCard,CrewHeaderCard,QuickCreate}.tsx`.
Worksteps: (1) agent card per §7.3 (RoleAvatar + color ring, displayName/title fallback,
description, model chip, tool/skill counts, 30-day strip, ⋯ menu); (2) crew scope = crew header
card + member grid; (3) select/double-click/Enter/menu interactions (D-HUX5); (4) quick-create
FormDialog → "Open profile"; (5) grid virtualization if >50 cards; (6) tests incl. keyboard.
Acceptance: reads as a staff directory in both themes; interaction parity mouse/keyboard.

**WP2.3 — Agent profile modal** · implementer · **Opus-class** · L · deps: 2.1, 1.5, 1.6, 1.7
Owns: NEW `features/hub/workforce/agent-profile/*` (dialog + 8 sections); consumes (moves, does
not fork) `RoleEditor`, `ToolGrantPicker`, `SkillPicker`, `BudgetsFields` internals.
Worksteps: (1) `WideDialog nav="rail"` shell, consequence labels, dirty guard (D-HUX6);
(2) Profile/Instructions/Model sections from existing editor fields; (3) **Access**: server
tri-state + per-tool checkboxes + search + all/none + counts + per-tool token cost from the
latest scan + granted-set footprint total (D-HUX7 — reuse existing scan/tool endpoints; if a
per-server tool-cost lookup is missing, add one additive API read in this WP); (4) Skills;
(5) Memory (scoped list via 1.5); (6) Budgets; (7) Usage (via 1.6); (8) tests per section +
save-roundtrip.
Acceptance: every field of the old editor reachable; Access shows real scan numbers; no section
scrolls the whole modal.

**WP2.4 — Crew profile modal** · implementer · **Sonnet-class** · M · deps: 2.1, 1.5–1.7
Owns: NEW `features/hub/workforce/crew-profile/*`; consumes `CrewEditor` internals.
Worksteps: Profile (name, description, **color picker over the five tokens**), Members (add/
remove/order from the agent pool), Topology (shared renderer with 2.5's edge logic — import, not
duplicate), Budgets, Memory, Usage; Instantiate action; tests.
Acceptance: color picker writes `chart-N`; membership edits reflect in rail counts.

**WP2.5 — Org chart tab** · implementer · **Opus-class** · L · deps: 2.1, 1.7
Owns: NEW `features/hub/workforce/org-chart/*` (canvas, node/edge builders, topology layouts,
Legend, tests).
Worksteps: (1) `CanvasShell` + `FlowGroupNode` per crew (color tint) + `FlowNode` agents +
`FlowMiniMap`/ZoomControls/`useAutoLayout`; (2) **topology-true intra-crew edges** (pipeline
chain · parallel fan · debate pair · best-of-N fan-in) from crew config (D-HUX9); (3) Unassigned
lane; (4) select → InspectorPanel summary; double-click → profile modal; (5) Legend (crew colors +
edge meaning); (6) snapshot/interaction tests.
Acceptance: chart is generated purely from store data (no hand layout), readable at 12+ agents,
both themes; SkillFlow untouched.

**WP2.6 — Usage tab** · implementer · **Sonnet-class** · L · deps: 2.1, 1.6
Owns: NEW `features/hub/workforce/usage/*` (toolbar, KPIs, charts, drill table, URL state, tests).
Worksteps: (1) toolbar (DateRangePicker, group-by Select, FacetFilters) per §7.3; (2) MetricGrid
KPIs for the current filter; (3) ChartCards (stacked-over-time by group-by; top-N bar);
(4) ranked DataTable with drill (row → narrow filter + breadcrumb chip + regroup), state in URL;
(5) "no agent" bucket rendered; (6) links → sessions table filtered / profile Usage; (7) tests
incl. URL round-trip.
Acceptance: drill path from total → entity → sessions works; numbers match 1.6's reconciliation.

**WP2.7 — Memory surfaces** · implementer · **Sonnet-class** · M · deps: 1.2, 1.5, 2.3/2.4 shells
Owns: NEW `features/hub/memory/*` (ScopedMemoryList, ProfileMemoryDialog, EffectiveMemoryStack);
`features/hub/meta-rail/ContextSection` effectiveMemory slot fill; `features/hub/projects/ProjectEditor.tsx`
(Memory section mount).
Worksteps: (1) the one card-list treatment (grouped, provenance, inline edit, archive,
AlertDialog delete) parameterized by scope; (2) profile-memory dialog reachable from Context
("Memory · manage"); (3) effective-stack display (ordered, tagged, linked) in Context; (4) scope
picker on assistant save-proposals (workspace approval card); (5) project detail Memory section;
(6) tests.
Acceptance: same component everywhere memory renders; proposals land in the chosen scope.

**WP2.R — Wave-2 review** · reviewer · **Opus-class** · L · deps: 2.1–2.7
Seeds a realistic org (5+ agents, 2 crews with different topologies, one multi-crew agent, one
unassigned, one archived) through the real API; walks Directory/Org chart/Usage + both profile
modals in BOTH themes; refutes: color-accent rule (no fills/text color, name always paired),
interaction parity (double-click/Enter/menu), Access numbers vs scan truth, drill sums vs API,
org-chart topology vs crew configs. Screenshots into STATUS; extends `e2e/smoke.spec.ts` with a
workforce flow (stub model server, no provider key).

### Wave 3 — Consolidation (after Wave 2; 4 agents in parallel)

**WP3.1 — Nav 6→4 + redirects** · implementer · **Sonnet-class** · M · deps: Wave 2 merged
Owns: `App.tsx` (this wave's seam: routes/redirects), `components/AppShell.tsx` (NAV_ITEMS),
breadcrumb wiring.
Worksteps: (1) nav per D-HUX15 (Assistant + Sessions child, Agents &amp; Crews, Projects, Audit);
(2) redirects: `/assistant/usage` → `/assistant/agents?tab=usage`; `/assistant/memory` →
`/assistant?memory=profile` (opens the profile-memory dialog, P3); keep old links working (tests
for all legacy paths incl. `/assistant/agents` tab default); (3) breadcrumbs for hub detail routes.
Acceptance: no dead nav entry, every legacy URL lands somewhere sensible.

**WP3.2 — Audit upgrade** · implementer · **Sonnet-class** · M · deps: 1.7
Owns: `features/hub/AuditView.tsx` (+tests).
Worksteps: (1) `headerVariant="toolbar"` + ViewToolbar filter grammar (D-HUX2); (2) sticky
day-group SectionHeaders; (3) agent enrichment (name + crew dot on mission-agent rows, link →
profile Usage); (4) EmptyState + reset; (5) tests.
Acceptance: matches §7.6; replay deep links intact.

**WP3.3 — Projects detail polish** · implementer · **Sonnet-class** · S · deps: 2.7
Owns: `features/hub/projects/*` except the Memory section 2.7 mounted (coordinate: 3.3 rebases on
2.7).
Worksteps: Descriptions block, pinned-files table polish, sessions-of-project link into
`/assistant/sessions?project=`, EmptyState pass; tests.
Acceptance: matches §7.4.

**WP3.4 — Retirement sweep** · implementer · **Sonnet-class** · S · deps: 3.1
Owns: DELETE `features/hub/{MemoryView,UsageView}.tsx` (+tests), `features/hub/SessionRail.tsx`
if unreferenced, dead `activeAside`/Files-dialog code, hub `TabPanel` usages; grep-proof no
orphan imports; update test snapshots.
Acceptance: zero dead hub code paths; bundle has no references to removed views; gate green.

**WP3.R — Wave-3 review** · reviewer · **Opus-class** · M · deps: 3.1–3.4
Full-app walk: 4-entry nav, every hub route + legacy redirect matrix, status-vocabulary
conformance sweep across hub surfaces (D-HUX14 — no off-table strings), single-EmptyState rule
(no double dashed boxes anywhere), cross-links resolve (audit→profile, usage→sessions→replay,
project→sessions). Screenshots both themes into STATUS.

### Wave 4 — Hardening, e2e, docs (4.1 ∥ 4.2 ∥ 4.3, then 4.4)

**WP4.1 — e2e flows** · implementer · **Sonnet-class** · M · deps: Wave 3 merged
Owns: `e2e/smoke.spec.ts` (hub sections) + fixtures.
Worksteps: scripted flows against the stub model server: new-session choreography (reduced-motion
path asserted), send → meta-rail Progress/Outputs update, sessions table → open session,
workforce quick-create → profile → grant one tool → org chart renders the change, usage drill →
sessions. No provider key required.
Acceptance: e2e green in CI alongside the existing hub-stub flows.

**WP4.2 — Visual/a11y acceptance pass** · reviewer · **Opus-class** · M · deps: Wave 3 merged
Both-theme + keyboard + reduced-motion + decoration-minimal walk of every surface; contrast spot
checks on crew accents and the dot grid; findings as STATUS blockers (fixes back to owning WPs).
Produces the **owner-acceptance walk script** (what to click, what to expect) as
`owner-acceptance-walk.md` in this folder.

**WP4.3 — Docs & bookkeeping** · docs · **Haiku-class** · S · deps: Wave 3 merged
Owns: `user-guide/16-assistant-hub.md` (rewrite affected sections), `CLAUDE.md` (Assistant-Hub
table row update: link this workstream), `CHANGELOG.md` entry, README cross-links.

**WP4.4 — Integration & release train** · integrator · **Sonnet-class** · M · deps: 4.1–4.3
Merge train wave-by-wave onto `feat/assistant-hub-ux` (already continuous), full gate **including
`pnpm build`** + `pnpm lint`, re-run WP2.R's seeded-org acceptance, final STATUS entry; owner
merges `feat/assistant-hub-ux → main`.

---

## 3. Dependency graph & parallel groups

```
WAVE 0 (∥×4):  WP0.1  WP0.2  WP0.3  WP0.4
                 │       │             │
WAVE 1 (∥×7):  ┌─┴───────┴─────────────┴────────────────────────────┐
               │ web lane:  WP1.1  WP1.2  WP1.3  WP1.4              │
               │ api lane:  WP1.5  WP1.6  WP1.7   (0.1-gated)       │
               └───────────────► WP1.R ─────────────────────────────┘
WAVE 2 (∥):    WP2.1 ─┬─► WP2.2 ∥ WP2.3 ∥ WP2.4 ∥ WP2.5 ∥ WP2.6 ∥ WP2.7 ─► WP2.R
                      └ (2.3/2.4/2.5/2.6 also gate on 1.5/1.6/1.7 as declared)
WAVE 3 (∥×4):  WP3.1 ∥ WP3.2 ∥ WP3.3 ∥ WP3.4(after 3.1) ─► WP3.R
WAVE 4:        WP4.1 ∥ WP4.2 ∥ WP4.3 ─► WP4.4
```

Peak useful parallelism: **7 implementation agents + 1 orchestrator** (Waves 1–2). Total: 24 WPs
(18 implementation · 4 reviews · 1 docs · 1 integration). File ownership above is the contract —
two WPs never own the same file; the declared seams (App.tsx per wave, AssistantView slots,
ConversationPane empty-state region, hub route index mounts) are sequenced by the orchestrator at
wave merge.

## 4. Model map (summary)

| Tier | WPs | Why |
|---|---|---|
| **Opus-class** | 0.1 · 1.5 · 2.3 · 2.5 · all *.R reviews · 4.2 | contract naming, injection semantics, the two hardest UI builds (profile modal, org chart), adversarial/visual reviews |
| **Sonnet-class** | 0.2 · 0.3 · 1.1–1.4 · 1.6 · 1.7 · 2.1 · 2.2 · 2.4 · 2.6 · 2.7 · 3.1–3.4 · 4.1 · 4.4 | well-specified feature work with exact recipes in the concept |
| **Haiku-class** | 0.4 · 4.3 · STATUS bookkeeping | mechanical, low-blast-radius |

If a tagged tier is unavailable: step DOWN for implementation WPs, never for reviews (reviews wait).

**The orchestrator itself runs Opus-class**, one session per wave (preferred) or one long session.
It never implements; it dispatches, verifies gates, sequences seams, and adjudicates review
findings — the highest-blast-radius seat in the plan. Do not downgrade it; its own token use is
small next to the subagents'.

## 5. Orchestrator protocol

1. One orchestrator session per wave (or one long session wave-by-wave). Before each wave: read
   STATUS.md, confirm upstream merges, spawn the wave's WPs as parallel subagents in **isolated
   worktrees** off `feat/assistant-hub-ux`.
2. Per-WP kickoff prompt: *the WP text above verbatim · the D-HUX table · owned files (exclusive)
   · required reading (concept §7.x + §8, CLAUDE.md, .claude/rules) · model tag · the gate ·
   "additive-only on shared/db; brand-ui only, tokens only, both themes; if a locked decision
   seems wrong, STOP and write a STATUS blocker — do not improvise."*
3. Every wave ends with its review WP prompted to REFUTE, not summarize. Findings → STATUS
   blockers → fixed by the owning WP's agent → reviewer re-verifies. A wave merges only after its
   review passes.
4. STATUS.md upkeep after every WP (Haiku-class bookkeeping agent): id · verdict · gate · files ·
   blockers · next. Append-only.
5. Escalate to the owner only for: a locked decision proven wrong, an unforeseen file-ownership
   conflict, or anything requiring live provider keys/tenants (out of agent scope — stub-only).
6. Merge discipline: WP branch → wave integration → `feat/assistant-hub-ux` after review;
   `pnpm build` once per wave integration, not per WP.
