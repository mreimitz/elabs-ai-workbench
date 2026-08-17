# Execution Plan — UI remediation (orchestrator runbook)

**Audience:** a coding agent (the *orchestrator*) that will spin up *subagents* to implement **every**
finding in this folder. This file tells you what to build, in what **sequence**, and exactly **which work
is serial vs parallel** — with a strict **file-ownership matrix** so parallel subagents never touch the
same file.

**Read first (every subagent reads these):**
[`README.md`](./README.md) · [`01-ui-audit-findings.md`](./01-ui-audit-findings.md) ·
[`02-prioritized-fix-plan.md`](./02-prioritized-fix-plan.md) · [`03-servers-deep-dive.md`](./03-servers-deep-dive.md)
· this file.

**Repo ground truth:** pnpm workspaces; web = `apps/web` (React 19 + Vite, view switching via
`activeView` in `App.tsx`, **no router**); **brand-ui-only is a hard rule** (every visible element is a
`@elabs-ai/components-*` component; semantic oklch tokens only; no raw hex/rgb); quality gate =
`pnpm typecheck && pnpm test && pnpm build`. Component APIs: confirm with the vendored CLI
`pnpm exec brand-ui search|docs|info <name>` before using a prop. App runs at `http://127.0.0.1:8080`
(reference) / Vite `:5173` (dev, HMR).

---

## 0 · Global rules for every subagent (non-negotiable)

1. **Stay in your lane.** Edit only the files in your **Owns** list. Files in **Reads (no edit)** may be
   imported but **not modified**. If you think you must edit a shared file, stop and report to the
   orchestrator — do not edit it.
2. **Keep public surfaces stable.** Do not rename/Remove a component's exported name or its props if
   another agent imports it (noted per agent). Internal refactors only.
3. **brand-ui-only + tokens.** No raw hex/rgb, no `window.confirm/alert`, no off-token font sizes. Route
   text through `@elabs-ai/components-*` `Text` variants + the density tokens from Wave 0. Confirm props via
   `pnpm exec brand-ui docs <Component>`.
4. **One worktree per subagent.** Branch from the current wave's integration branch into your own git
   worktree (`git worktree add ../wt-<agent> <branch>`); never share a working tree. (If your Task/Agent
   tool supports `isolation: "worktree"`, use it.)
5. **Definition of done (per subagent):** `pnpm typecheck && pnpm test && pnpm build` green **and** you
   visually verified your screen **in `light` and `dark`** against the running app with
   agent-browser (screenshot + DOM check). **Report honestly what you did NOT verify.**
6. **No new runtime deps.** Compose from `@elabs-ai/components-*` (incl. the already-vendored `@elabs-ai/components-charts` and
   `@elabs-ai/components-editor`). If a component seems missing, raise it — don't hand-roll or add a library.
7. **Contract-first.** If a change touches the wire (`packages/shared` types/zod), change shared first.
   (Most of this work is web-only.)

---

## 1 · Wave sequence (serial between waves, parallel within)

```
        WAVE 0 — FOUNDATION                WAVE 1 — SCREENS (parallel)            WAVE 2
        (token + shell; parallel)          start only after Wave 0 merges          (serial)
   ┌──────────────┐ ┌──────────────┐    ┌────┐┌────┐┌────┐┌────┐┌────┐┌────┐┌────┐  ┌──────────┐
   │ A0 tokens/   │ │ A1 shell/IA/ │ →  │ B1 ││ B2 ││ B3 ││ B4 ││ C1 ││ C2 ││ C3 │→ │ Z1       │
   │ density      │ │ settings/    │    │Dash││Comp││Scan││Rail││Srv ││Tool││Run │  │integrate │
   │              │ │ confirm      │    │    ││are ││s   ││    ││View││Det ││Modl│  │+audit+a11y│
   └──────────────┘ └──────────────┘    └────┘└────┘└────┘└────┘└────┘└────┘└────┘  └──────────┘
   gate+merge → "foundation"            gate+merge each → "screens"               gate+merge → done
```

- **Wave 0 = 2 agents, run in parallel** (disjoint files; the token-name contract in §4 is fixed here so
  A1 can consume it). Both must merge + gate green before Wave 1 starts.
- **Wave 1 = up to 7 agents, all parallel** (disjoint file ownership — see §3). C1 is the long pole.
- **Wave 2 = 1 agent, serial** (integration, cross-theme/a11y, regression + final density tuning).
- **Hard gate between waves.** Do not start Wave 1 until Wave 0 is merged and the build is green; same for
  Wave 1 → Wave 2. Within a wave, agents are independent and need no coordination beyond §4 contracts.

**Why this split:** Wave 0 changes the two things *everything else rebuilds on* — the **token scale**
(every screen's density/visual-accept depends on it) and the **app shell / IA** (`AppShell.tsx`,
`App.tsx`, `SettingsView.tsx`). Doing those first removes the only cross-cutting merge hazards; after
that, every screen lives in its own file and can be rebuilt in parallel with zero contention.

---

## 2 · The agents (scope → findings → files)

> Each agent's full spec (what to build) is the referenced finding IDs in `01/02/03`. Summaries below.

### Wave 0 — Foundation

**A0 — Density & type tokens**  · closes **G1**, density half of **#3**, doc03 §5 type scale · fix-plan **P0.3**
- Add a compact density/type scale at the **token layer** (`@elabs-ai/components-tokens` overrides + Tailwind v4
  `@theme`): UI/body ~13px, table ~12–13px, section headings ~14–15px, KPI numerals ~20–24px (not 36),
  row height ~36–40px, line-height ~1.4, `tabular-nums` on numeric utilities. Must read in all six themes.
- Implement a **`data-density="comfortable|compact"`** switch on `<html>` that the token CSS responds to
  (A1 wires the UI toggle + persistence). Publish the token/attribute names per §4.
- **Owns:** the theme/token CSS + Tailwind theme config (e.g. `apps/web/src/index.css` / wherever the
  `@theme`/token overrides live), and a short `roadmap/findings/_contracts.md` recording the token names.
- **Reads:** none.
- **Done when:** themes still render in all six; numerals/rows visibly denser; `_contracts.md` published.

**A1 — Shell, IA, Settings, destructive-confirm**  · closes **G3, G4, G5, SE1–SE3**, breadcrumb · fix-plan **P0.1, P0.2, P0.4(breadcrumb)**
- `AppShell.tsx`: **delete the inline Quick-settings modal + its topbar trigger**; **pin Settings to a
  bottom nav group** (`SidebarFooter`/bottom `SidebarGroup`, gear + an About/runtime slot); breadcrumb
  renders **only on real depth ≥2** (never a single crumb equal to the page H1); move the **full 6-theme**
  switcher out of the chrome.
- `SettingsView.tsx`: add the **6-theme** control + the **density toggle** (wired to A0's `data-density`),
  render runtime info via `Descriptions`, drop the duplicate `generic_o200k` pill, strip the page subtitle.
- `App.tsx`: replace `window.confirm` (`:324`) with a **controlled `AlertDialog`** (destructive) used by
  the rail/dashboard delete paths (ServerRail just calls the existing `onDeleteServer` prop); wire the
  bottom-nav Settings; remove the quick-settings trigger/state.
- **Owns:** `components/AppShell.tsx`, `App.tsx`, `features/settings/SettingsView.tsx`.
- **Reads:** A0's `_contracts.md`.
- **Stable surface:** keep `onDeleteServer`/`onEditServer`/`onViewChange` prop names so Wave-1 rail/views
  don't break.

### Wave 1 — Screens (parallel)

**B1 — Dashboard**  · closes **D1–D5**, **G2**(dashboard) · fix-plan **P1.1**
- One server ranking only (keep the `DataTable`, delete the Portfolio bar list + the duplicate KPI);
  KPI rail → `MetricGrid` of ~4 decision metrics; inline **Scan**/**Open** actions on operational rows;
  remove the title-row pills/pseudo-primary; strip subtitles.
- **Owns:** `features/dashboard/DashboardView.tsx`. **Reads (no edit):** `components/TokenViz.tsx`,
  `lib/*`. If you drop `RankedTokenList`, just remove the import — do **not** edit TokenViz.

**B2 — Compare**  · closes **C1–C5**, **G2**(compare) · fix-plan **P1.2**
- Selection → `FilterBar` toolbar (no card/heading); KPIs → one **Δ tokens (+%)**; the four tables → **one**
  diff `DataTable` (Tool · Before · After · Δ · **Change**) + `FacetFilter` + `SearchInput` + one
  `StatePanel`; strip subtitles. (Cross-server compare gap **C4**: scope copy or note as follow-up.)
- **Owns:** `features/compare/CompareView.tsx`.

**B3 — Scans (global)**  · closes **SC1–SC3**, **G2**(scans), **G6**(history) · fix-plan **P1.3**
- Master-detail → resizable split (`ResizablePanelGroup`); add `SearchInput` + `FilterBar`/`FacetFilter`
  + sortable columns to the history (or make it a `DataTable`); shrink the empty detail to a compact
  `StatePanel`; drop the inner "Scan history/Newest first." heading; strip subtitle.
- **Owns:** `features/scans/ScansView.tsx`. **Reads (no edit):** `features/scans/ToolDetailPanel.tsx`
  (if rendered here, treat as read-only — C2 owns it).

**B4 — Server rail**  · closes doc01 **S2**, **P2.1**, **G6**(rail)
- Denser one/two-line rows (token/status column); primary **Scan** inline; Edit/Test/Delete into a
  hover/`⋯` menu; call the existing `onDeleteServer` prop (A1 owns the confirm dialog).
- **Owns:** `features/servers/ServerRail.tsx`.

**C1 — ServersView (Overview + Tools tab)**  · closes doc03 **§1, §2**; doc01 **S1, S3, S4, S5**; **G2**(servers); **G6**(tools list) · fix-plan **P1.5a, P1.5b**  · *long pole*
- **Overview → two columns + charts:** group `Attention` findings by **type** (count + Σ recoverable;
  expand to tools) via a new `groupFindings()` in `lib/optimize.ts`; **Findings (~60%)** beside a merged
  **Token-distribution** card (server stacked bar + per-tool **stacked** rows + one bottom legend, ~40%);
  **Server profile → ½ width** beside a **`@elabs-ai/components-charts`** scan-trend; **KPI sparklines**; hide
  Recoverable at 0; auth badge `none`→`No auth`.
- **Tools tab:** replace `SplitPanel` with `ResizablePanelGroup`/`ResizableHandle` (default ~32/68,
  draggable); tool list → dense **sans** `DataTable` + cost-weight `Progress` cell; `scrollbar-gutter:
  stable`; collapse the KPI band to a strip when `tab !== "overview"` (animated, `motion-reduce` safe).
- **Owns:** `features/servers/ServersView.tsx`, `components/TokenViz.tsx` (make additions **additive** — new
  stacked-contributor component; don't break B1's existing usage), `lib/optimize.ts` (additive
  `groupFindings`). **Reads (no edit):** `features/scans/ToolDetailPanel.tsx` (keep rendering it; C2 owns
  its internals — rely on its current props).

**C2 — Tool detail panel**  · closes doc03 **§3 (3.1–3.7)**, **§5** fonts
- Sticky header + `TabsList`; Breakdown order **Token budget → Optimization → Instructions**; instructions
  clamp + **Expand** `Dialog` via `@elabs-ai/components-editor` `CodeEditor` (read-only); **Raw** tab → `@elabs-ai/components-editor`
  `CodeEditor` (`json`, `readOnly`, `folding`) + Expand modal (retire `CodeBlock` here); one quiet chip row
  under the title; route text through `Text` + density tokens; **delete the `run` tab**.
- **Owns:** `features/scans/ToolDetailPanel.tsx`, and `components/CodeBlock.tsx` *only if it becomes unused*
  (grep first; if still used elsewhere, leave it). **Stable surface:** keep `ToolDetailPanel`'s exported
  props (C1 + maybe B3 render it). **Reads (no edit):** `features/scans/ToolPlayground.tsx` (import
  `ToolRunDialog` as-is).

**C3 — Run tool modal**  · closes doc03 **§4 (4.1–4.4)**
- Make the `ResizableHandle` actually resize (fix the `cursor:auto` / enable pointer handling) and set
  default **`defaultSize={33}` / `{67}`**; **sort params required→optional** (also export a small helper if
  ToolDetailPanel's Parameters tab should match — but don't edit C2's file; put the sorter in
  `lib/schema-params.ts`? **no** — keep it local or add to `lib/` only if no one else edits it this wave →
  put it **inside ToolPlayground** and have C2 sort locally too); balance the footer (stop the divider at
  the panel-group bottom; two-side layout); drop the redundant "Executes on the live server." label.
- **Owns:** `features/scans/ToolPlayground.tsx`. **Stable surface:** keep the `ToolRunDialog` export name +
  props (C2 imports it).
- **Param-sort note:** required→optional ordering is needed in **two** places (this modal + C2's Parameters
  tab). To avoid both agents editing one shared file, **each sorts locally in its own file** (duplicate the
  3-line sort), or the orchestrator lifts a `sortParams()` into `lib/schema-params.ts` during Wave 0 (A0)
  and both import it. Prefer the Wave-0 helper if convenient.

### Wave 2 — Integration & polish (serial, 1 agent)

**Z1 — Integrate, audit, theme/a11y, regress**  · closes **P2.2, P2.3, P2.4, H**; final **#3** tuning
- Merge all Wave-1 branches; run the gate; resolve any cross-screen inconsistencies (list treatments
  **P2.2**, spacing/tokens after seeing every screen together — final **density tuning**).
- **Six-theme + a11y pass (P2.3 / roadmap WP 4.1):** verify all six themes incl. **high-contrast is
  genuinely high-contrast**; visible focus rings on new dense rows + the Compare/diff table + tool list;
  confirm `Dialog`/`AlertDialog` dismiss on **Esc + overlay** (open item **H**).
- Run **`brand-ui-audit`** with register = *product/professional*; fix what it flags.
- **P2.4 (doc only):** append a note that the future testing run-console reuses the corrected Servers /
  Scan-detail / Wizard patterns.
- **Owns:** integration branch + any shared `lib/*`/token retuning. **Reads:** everything.

---

## 3 · File-ownership matrix (the contention guard)

No two agents in the same wave write the same file. Cross-wave is serial, so reuse is fine.

| File | Wave 0 | Wave 1 owner | Notes |
|---|---|---|---|
| token CSS / Tailwind `@theme` | **A0** | — (frozen) | density/type scale + `data-density` |
| `components/AppShell.tsx` | **A1** | — | remove quick-settings, pin Settings, breadcrumb depth |
| `App.tsx` | **A1** | — | confirm→`AlertDialog`, settings nav |
| `features/settings/SettingsView.tsx` | **A1** | — | 6-theme + density toggle + Descriptions |
| `features/dashboard/DashboardView.tsx` | — | **B1** | |
| `features/compare/CompareView.tsx` | — | **B2** | |
| `features/scans/ScansView.tsx` | — | **B3** | renders ToolDetailPanel read-only |
| `features/servers/ServerRail.tsx` | — | **B4** | uses `onDeleteServer` prop |
| `features/servers/ServersView.tsx` | — | **C1** | Overview + Tools tab |
| `components/TokenViz.tsx` | — | **C1** | additive only (B1 reads) |
| `lib/optimize.ts` | — | **C1** | additive `groupFindings` |
| `features/scans/ToolDetailPanel.tsx` | — | **C2** | keep props stable (C1/B3 read) |
| `components/CodeBlock.tsx` | — | **C2** | retire only if unused |
| `features/scans/ToolPlayground.tsx` | — | **C3** | keep `ToolRunDialog` export stable |
| `lib/schema-params.ts` | optional **A0** (`sortParams`) | read-only in W1 | param sort helper (see C3 note) |
| `lib/format.ts`, `lib/table.tsx` | — | **read-only** | add nothing in W1; needs → Wave 0 or Z1 |

**Shared-import contracts (read-only across Wave 1):** `ToolDetailPanel` props (C2) and `ToolRunDialog`
export (C3) must not change shape; `TokenViz` additions (C1) must be additive so B1 keeps compiling;
`onDeleteServer/onEditServer/onViewChange` props (A1) stay named.

---

## 4 · Wave-0 contracts (publish before Wave 1)

A0 writes these into `roadmap/findings/_contracts.md` so every later agent consumes the same names:
- **Density:** the `data-density` attribute values + the token names for body/table/heading/KPI sizes,
  row-height util, and the `tabular-nums` utility.
- **sortParams** (if A0 adds it): `sortParams(params): ToolParam[]` — required-first, stable — in
  `lib/schema-params.ts`.
A1 confirms: bottom-nav Settings entry + the `data-density` toggle wiring is live.

---

## 5 · Per-subagent prompt template (orchestrator fills `<…>`)

```
You are Agent <ID> in the MCP-Token-Footprint UI remediation.
Read: roadmap/findings/README.md, 01-ui-audit-findings.md, 02-prioritized-fix-plan.md,
      03-servers-deep-dive.md, 04-execution-plan.md (§0 global rules + your row in §2/§3), and
      roadmap/findings/_contracts.md.
Scope: implement findings <IDs> per the fix plan.
OWN (edit only these): <files>.   READ ONLY (import, never edit): <files>.
Contracts you must honor: <stable exports/props/contract names>.
Rules: brand-ui-only + semantic tokens; confirm props via `pnpm exec brand-ui docs <C>`; no new deps;
       no window.confirm; keep listed exports/props stable.
Work in your own git worktree off branch <wave-branch>.
Done = `pnpm typecheck && pnpm test && pnpm build` green AND you visually verified your screen at
       http://127.0.0.1:8080 in light AND dark with agent-browser (screenshot + DOM check).
Report: what you changed, screenshots, and explicitly what you did NOT verify.
```

---

## 6 · Coverage check — every finding is assigned

| Findings | Agent |
|---|---|
| G1 density tokens · #3 scale | A0 |
| G2 consumer copy (per view) | each of B1,B2,B3,C1 (own file) + A1 (Settings) |
| G3 breadcrumb · G4 settings/theme IA · G5 window.confirm · SE1–SE3 | A1 |
| G6 unify lists → DataTable | B3 (history) · B4 (rail) · C1 (tools list) |
| Dashboard D1–D5 | B1 |
| Compare C1–C5 | B2 |
| Scans SC1–SC3 | B3 |
| Settings SE* | A1 |
| Servers (doc01) S1,S3,S4,S5 · S2(rail) | C1 · B4 |
| Servers deep-dive §1 Overview (1.1–1.7) | C1 |
| Servers deep-dive §2 Tools (2.1–2.3) | C1 |
| Servers deep-dive §3 Detail (3.1–3.7) · §5 fonts | C2 |
| Servers deep-dive §4 Run modal (4.1–4.4) | C3 |
| P2.1 rail · P2.2 list consistency · P2.3 six-theme/a11y · P2.4 doc · H open items | B4 · Z1 · Z1 · Z1 · Z1 |

If a finding isn't in this table, it isn't done — add it before closing the wave.

---

## 7 · Orchestrator checklist

1. Create base branch `ui-remediation`. Ensure the app builds and runs (`pnpm install`, `pnpm dev`).
2. **Wave 0:** launch A0 + A1 in parallel (own worktrees). When both report done → merge to
   `ui-remediation` → run gate → confirm `_contracts.md` exists. **Do not proceed otherwise.**
3. **Wave 1:** branch `ui-remediation` → launch B1,B2,B3,B4,C1,C2,C3 in parallel (own worktrees). As each
   finishes (gate + visual), merge to `ui-remediation`; re-run gate after each merge.
4. **Wave 2:** launch Z1 on the merged branch; integration, six-theme/a11y, `brand-ui-audit`, final
   density tuning; gate green.
5. Final: full visual sweep of all five views + tool detail + run modal in light & dark; tick
   the §6 coverage table; report what was and wasn't visually verified.
```
Parallelism summary: Wave 0 = 2 agents ∥ · Wave 1 = up to 7 agents ∥ · Wave 2 = 1 agent (serial).
Must be a single agent: A0 (tokens), A1 (shell/App.tsx/Settings), Z1 (integration).
```
