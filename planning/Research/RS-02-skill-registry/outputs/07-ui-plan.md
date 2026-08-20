---
type: "Research Output"
title: "07 \u2014 Web UI plan (the enterprise-grade inspector)"
description: "100% @elabs-ai/components- (enforced by the enforce-brand-ui hook), two themes, semantic tokens, useState +"
tags: ["research", "RS-02"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# 07 — Web UI plan (the enterprise-grade inspector)

100% `@elabs-ai/components-*` (enforced by the `enforce-brand-ui` hook), two themes, semantic tokens, `useState` +
`localStorage`, `apiGet/Post/Put/Delete`. All primitives named below were verified present in the
vendored kit ([`02`](../notes/02-current-architecture-map.md)).

## 1. Side-menu item (R1)

**Skills is its own top-level nav section** — a peer of "MCP analyzer" and "Testing," not an item
inside the MCP group. Final section order in the sidebar: **MCP analyzer → Skills → Testing**
(confirmed by the owner; see [`10-open-questions.md`](../notes/10-open-questions.md) Q9).

In `components/AppShell.tsx`:
- Extend `ViewKey` with `"skills"`.
- The sidebar today renders two groups: `NAV_ITEMS` ("MCP analyzer") then `TESTING_NAV_ITEMS`
  ("Testing"). Add a **third group array** `SKILL_NAV_ITEMS = [{ key: "skills", label: "Skills",
  icon: Sparkles }]` (lucide `Sparkles`/`BookOpen`/`Package` — pick one) and render it as its own
  labeled `SidebarGroup` **between** the MCP and Testing groups. Skills stays out of `NAV_ITEMS`.
  - Keep `NAV_ITEMS` = Dashboard, MCP Servers, Scans, Compare (Skills removed from it).
  - New `SKILL_NAV_ITEMS` = Skills (room to grow later, e.g. a future "Skill compare").
In `App.tsx`: `{activeView === "skills" ? <SkillsView … /> : null}` and a `selectedSkillId` state
persisted at `mcp-token-footprint.selected-skill`.

## 2. Feature folder `apps/web/src/features/skills/`

```
SkillsView.tsx        orchestrator: owns selectedSkillId + selectedVersion; renders SkillRail (secondary
                      rail) + SkillInspector (main). Mirrors ServersView/ServerRail split.
SkillRail.tsx         searchable skill list (SearchInput + list). Each row: display name, source badge
                      (GitHub/Upload), version count, L1/total token chip. "Add skill" button → wizard.
                      Per-row menu: Pull latest (GitHub only), Rename, Delete.
SkillWizard.tsx       multi-step Dialog to add a skill (below).
SkillInspector.tsx    the tabbed inspector for the selected skill+version (below).
SkillFileExplorer.tsx FileTree + file viewer (ResizablePanelGroup).
SkillDiffView.tsx     version A/B picker + tree diff + DiffEditor.
skills-api.ts         thin client wrappers (or fold into lib/api.ts).
```

## 3. Add-skill wizard (R2, R3) — `Dialog` + steps (pattern from `ServerWizard`)

- **Step 1 — Source.** `ToggleGroup`: **Upload** vs **GitHub**.
- **Step 2a — Upload.** A dropzone (compose from `@elabs-ai/components-ui` primitives + a native file input;
  accept `.zip`, `SKILL.md`). Show picked filename + size. On next → `POST /api/skills` multipart.
- **Step 2b — GitHub.** `Input` repo URL + `Input` ref (default `main`) + optional PAT field +
  "Discover skills" button → `POST /api/skills/probe`. Render `candidates[]` (each SKILL.md dir with
  its `name`/`description`) as a selectable list; user picks the subpath (monorepo aware, R3). One
  skill per registration; "add another" re-opens for a second subpath.
- **Step 3 — Review.** `Descriptions` of what will be imported (name, source, ref/subpath or
  filename), frontmatter validity preview, and any validation warnings. Confirm → create → toast →
  select the new skill.

## 4. The inspector — `SkillInspector.tsx`

Header: skill display name + **version picker** (`Select`): **"Latest (v{seq} · label)"** default,
or any specific version. GitHub skills also show a **"Pull latest"** button (→ `POST /pull`; on a
new version, deep-link into the Diff tab prev→new). `Tabs`:

### Tab "Overview" (R7 — SKILL.md auto-surfaced)
- **Rendered `SKILL.md`** as the primary content (via `@elabs-ai/components-editor` `MarkdownEditor` read-only /
  markdown render). This is the "automatically show the skill.md as a subscription/summary."
- A `Descriptions` block of parsed frontmatter (name, description, license, compatibility,
  metadata.*, allowed-tools) with a validity `StatusBadge`.
- **Token-footprint `MetricCard`s**: L1 metadata / L2 body / L3 resources / total — plus the
  existing `TokenViz` `SegmentedBar` to show the three-level split visually.
- **Security strip**: scripts count, "network references" badge, file/byte totals (from
  [`06`](./06-ingestion-and-github.md)).

### Tab "Files" (R8) — `SkillFileExplorer`
- `ResizablePanelGroup`: left = **`FileTree`** (`@elabs-ai/components-ai`) built from `GET …/files` (flat list →
  nested tree in a `useMemo`), folders collapsible, icons by `kind`; right = file viewer.
- Text file → read-only **`CodeEditor`**/`CodeBlock` with language by extension + a token-count
  chip. Binary → a "binary — N bytes" panel with download/preview (`GET …/raw`). Markdown → rendered
  + raw toggle. `Breadcrumb` shows the current path.

### Tab "Versions"
- `DataTable` (`@elabs-ai/components-data`) of versions: `seq`, label, source ref (short sha/filename),
  imported_from, date, total tokens, Δtokens vs previous. Row actions: "View", "Set as compare
  base/target". Selecting two rows enables **Compare** → Diff tab.

### Tab "Diff" (R6, R9) — `SkillDiffView`
- A/B version selectors (default: previous → current). Calls `GET …/diff?from&to`.
- **Delta strip** on top: files added/removed/modified/renamed, bytes Δ, and **L1/L2/L3/total token
  deltas** (colored via semantic tokens) + the **manifest field diff** table.
- **Full-tree change list**: a `FileTree`/list annotated with per-file status badges
  (added/removed/modified/renamed) and `tokenDelta`, walkable across **all** subfolders (R9).
- Selecting a modified text file loads `GET …/diff/file` and renders **`DiffEditor`** (Monaco
  side-by-side). Binary → "binary changed (hash a→b)". Added/removed → single-pane view of the
  new/old content. This satisfies R6 identically for uploaded and GitHub skills (the UI only ever
  sees two `skill_files` maps).

## 5. State, feedback, themes

- `useState` for tab/selection/wizard; `localStorage` for `selected-skill` and last compare pair.
- Async actions wrapped in `try/catch` → `pushToast('success'|'danger', …)`, matching `App.tsx`.
- Verify every surface in **both** `light` and `dark`; colors via semantic tokens only
  (`bg-card`, `text-muted-foreground`, `chart-*`, `success`, `destructive`) — the `check-tokens`
  hook warns on raw colors.
- Empty/error/loading via `StatePanel`/`EmptyState`/`Skeleton`.

## 6. What we do **not** hand-roll

File tree, code view, diff view, tables, panes, tabs, breadcrumbs, metrics — all `@elabs-ai/components-*`. If a
gap appears (e.g. a dropzone), compose from primitives per `library-first.md`; don't add a UI dep.

# Citations

None.
