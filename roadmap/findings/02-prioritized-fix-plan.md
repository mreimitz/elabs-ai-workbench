# Prioritized Fix Plan

Phased remediation for the findings in [`01-ui-audit-findings.md`](./01-ui-audit-findings.md). Ordered by
**leverage ÷ effort**. Each item lists the finding IDs it closes, the files to touch, the exact
`@elabs-ai/components-*` components, and an acceptance check. Effort: **S** ≈ <½ day · **M** ≈ ½–1 day · **L** ≈ 1–2 days.

Guiding principle: **the strong surfaces are the template.** Almost every fix is "make this screen look
like the Server hub / Scan detail / Run console you already shipped," plus one global density pass.

---

## P0 — Register + IA (do first; highest payoff, lowest risk)

### P0.1 — Rebuild Settings & Theme IA  · closes **G4, SE1, SE2, SE3** · issue #6 · effort **M**
- **Delete** the Quick-settings modal and its trigger in the topbar.
- In `AppShell.tsx`, add a **bottom-pinned nav group** (`SidebarFooter` / bottom `SidebarGroup`) holding
  **Settings** (gear) — and a profile/About slot for later. Settings leaves the main nav list.
- On the **Settings page** (`SettingsView.tsx`): add the **full 6-theme** control (`Select` or segmented:
  System · Qlik Bright · Qlik Dark · Light · Dark · Blueprint · High-contrast) wired to `ThemeProvider`,
  plus the **density** toggle from P0.3. Render runtime info via `Descriptions`. Remove the duplicate
  "generic_o200k" pill.
- Topbar keeps at most a single light/dark quick-toggle **iff** it shares the same theme state; otherwise
  remove it so theme lives in one place.
- **Accept:** one theme control path; all 6 themes reachable; Settings pinned bottom-left; no
  modal-opens-a-page; no duplicated theme/profile affordances.

### P0.2 — Replace `window.confirm` with `AlertDialog`  · closes **G5** · issue #2 · effort **S**
- `App.tsx:324` `confirmDeleteServer` → controlled `@elabs-ai/components-ui` `AlertDialog` (title "Delete <server>?",
  destructive confirm, cancel). Reuse for any other native confirms.
- **Accept:** delete flows through a themed `AlertDialog`; closes on Esc/overlay; no `window.confirm`
  remains in `apps/web/src` (grep clean).

### P0.3 — Compact density + type token pass  · closes **G1, D5, C5** · issue #3 · effort **M**
- In the token layer (`@elabs-ai/components-tokens` overrides + Tailwind v4 `@theme`): UI/body ~13px, table ~12–13px,
  section headings ~14–15px, KPI numerals ~20–24px, **row height ~36–40px**, line-height ~1.4,
  `tabular-nums` on numeric columns/KPIs. Add a **density** state (comfortable/compact) if you want it
  user-switchable (P0.1 exposes it).
- Do it as tokens, **not** per-component overrides, so all six themes inherit. Coordinate with
  `brand-ui-theme`.
- **Accept:** Dashboard/Compare/Scans visibly denser; numerals no longer ~36px; rows ≤40px; still reads
  in all six themes; no raw px in components (token-driven).

### P0.4 — Strip consumer copy + fix breadcrumb  · closes **G2, G3, SC3** · issue #5 · effort **S**
- Remove page-title descriptive subtitles and section explanatory subtitles across all five views; keep
  one short helper only in empty states.
- Breadcrumb (`AppShell.tsx`): render only on real drill paths; never a single crumb equal to the H1.
- **Accept:** no page narrates itself; breadcrumb appears only with depth ≥2.

---

## P1 — Replace the two slop screens (Dashboard, Compare) + Scans list

### P1.1 — Dashboard de-slop  · closes **D1, D2, D3, D4** · issues #1, #4 · effort **M**
- **Say once:** keep the "Latest server footprint" `DataTable` (default-sort by Tokens); **delete** the
  "Portfolio footprint" bar list and the "Highest footprint" KPI duplicate.
- **KPI rail → `MetricGrid`** of ~4 decision metrics: Servers · Total startup tokens · Unscanned/failed ·
  Largest single tool. Drop "Latest scan".
- **Insight→action:** "Operational state" rows get inline **Scan** + **Open** actions.
- Remove the title-row count pills; the only header action (if any) is **Add server** / **Run scan**.
- **Accept:** one server ranking on the page; ≤4 KPIs; unscanned server is one click to scan; no
  decorative pills.

### P1.2 — Compare → one diff table  · closes **C1, C2, C3** · issues #1, #4 · effort **M**
- Selection becomes a `FilterBar` toolbar (`Server · Before · After`), no card/heading.
- KPIs → a single **Δ tokens (+%)** `MetricCard`.
- The four tables collapse into **one** `DataTable`: Tool · Before · After · Δ · **Change**, with a
  `FacetFilter` on Change (added/removed/increased/decreased) + `SearchInput`, sortable by Δ, one
  `StatePanel` empty state.
- **Accept:** no 2×2 table grid; one filterable diff table; ≤1 KPI; controls are a toolbar, not a card.

### P1.3 — Scans list upgrade  · closes **SC1, SC2** · issues #1, #2 · effort **M**
- Convert master-detail to `SplitPanel`; replace the empty detail card with a compact `StatePanel`.
- Add `SearchInput` + `FilterBar`/`FacetFilter` (server, status) + sortable columns to the history (or
  make the history a `DataTable`, per P2.2). Keep the count footer.
- **Accept:** history is searchable/filterable/sortable; empty detail no longer fills the viewport.

---

## P1.5 — Servers smart-layout redesign (doc 03)

> The component bones are right; the composition + interaction aren't. Files:
> `features/servers/ServersView.tsx`, `features/scans/ToolDetailPanel.tsx`,
> `features/scans/ToolPlayground.tsx`. Total ≈ **L** (1–2 days).

### P1.5a — Overview: two columns + charts · closes §1 (1.1–1.7) · effort **M**
- Group **Attention** findings by *type* (count + Σ recoverable per group; expand to tools) instead of the
  flat per-tool list (`ServersView.tsx:239-266`).
- Two-column grid: **Findings (~60%)** | **Token distribution (~40%)** — merge Footprint composition + Top
  contributors into one card: server stacked bar on top, per-tool **stacked** rows below
  (Name/Desc/Schema/Annot), one shared legend pinned to the bottom.
- **Server profile → ½ width** (`Descriptions columns={2}`) beside a **`@elabs-ai/components-charts` scan-trend** (last
  5–10 scans: total-tokens line + Δ-vs-prev + added/removed; row → Compare).
- **KPI sparklines** (`MetricCard` + micro-chart) across recent scans; hide "Recoverable" at 0.
- **Accept:** no full-width half-empty cards; ≥1 chart on Overview; findings grouped by type.

### P1.5b — Tools tab: resizable + dense list + collapsing KPIs · closes 2.1–2.3 · effort **M**
- Replace `SplitPanel` (`ServersView.tsx:336`) with `ResizablePanelGroup` + `ResizableHandle` (default
  ~32/68); ensure the handle drags (shared root cause with P1.5d).
- Tool list → dense **sans** `DataTable` (mono only as a small identifier) with Tokens · % · issues + a
  cost-weight `Progress` cell; `scrollbar-gutter: stable` so left/right padding match.
- Collapse the KPI band (`:189-210`) to a one-line strip when `tab !== "overview"` with a `<200ms` height
  transition (`motion-reduce` safe).
- **Accept:** split drags; list is sans + sortable; KPI band shrinks off Overview.

### P1.5c — Tool detail panel · closes §3 (3.1–3.7) · effort **M**
- **Sticky** header + `TabsList` (`position:sticky; top:0`, token bg) so identity/tabs persist while only
  content scrolls.
- Breakdown order → **Token budget → Optimization → Instructions** (move `ToolDetailPanel.tsx:97-117`
  above `:87-95`).
- Instructions: clamp ~4–6 lines + **Expand** `Dialog` rendering `@elabs-ai/components-editor` `CodeEditor` (read-only).
- **Raw** tab → `@elabs-ai/components-editor` `CodeEditor` (`json`, `readOnly`, `folding`) + **Expand** modal; retire
  `CodeBlock` here (the result panel already uses `CodeEditor`).
- One quiet metadata chip row under the title (behavior chips + share%); route text through `Text` + the
  density tokens (kill ad-hoc `text-sm`/mono).
- **Delete the `run` tab** (`:163-182`) — it duplicates the header **Run** button.
- **Accept:** header sticky; optimization above instructions; instructions + raw use the Monaco editor with
  Expand; no Run tab; no ad-hoc mono/`text-sm`.

### P1.5d — Run modal · closes §4 (4.1–4.4) · effort **S–M**
- Make the `ResizableHandle` actually resize — it renders with `cursor:auto`; ensure `col-resize` +
  enabled pointer handling (same fix unblocks P1.5b). Default **`defaultSize={33}` / `{67}`**.
- **Sort params required→optional** before render (`ToolPlayground.tsx:170`, `ToolDetailPanel.tsx:135`);
  optional divider/subhead between the groups.
- Footer is already full-width (measured 1366/1368px) — stop the vertical divider at the panel-group bottom
  and give the footer a balanced two-side layout so it doesn't read as half.
- Drop the redundant "Executes on the live server." label beside **Run tool**.
- **Accept:** splitter drags at ⅓∶⅔; required params first; footer reads as one bar; no restating label.

---

## P2 — Consistency + polish

### P2.1 — Server rail calm-down  · closes **S1, S2, S3, S4** · issue #1 · effort **M**
- Rail rows: denser one/two-line rows with a token/status column; primary **Scan** inline; Edit/Test/
  Delete into a hover/`⋯` menu. (The Overview body — findings, composition, profile — is redesigned in
  **P1.5a**, not here.) Hide "Recoverable" at 0. Auth badge `none` → `No auth`.
- **Accept:** ≤1 always-visible row action; empty Attention no longer headlines; Overview leads with data.

### P2.2 — Unify list treatments  · closes **G6, S5** · issue #2 · effort **M**
- One list pattern (dense `DataTable` or a shared compact row) for Server registry, Scan history, and the
  Tools list — same row height, status column, search, count.
- **Accept:** the three list surfaces are visually consistent; the Tools list matches the scan-detail table.

### P2.3 — Six-theme + a11y pass  · closes **H (open items)** · effort **M** · = roadmap **WP 4.1**
- Verify `high-contrast` is genuinely high-contrast (borders, AAA); verify `blueprint`; check focus rings
  on new dense rows and the Compare table; confirm `Dialog`/`AlertDialog` Esc + overlay dismissal.
- **Accept:** all six themes legible incl. high-contrast; visible focus; dialogs dismiss correctly.

### P2.4 — Forward-looking: testing run-console  · effort **n/a (guidance)**
- When building the planned agent run-console (docs 10/12, `testing/STATUS.md` phases 0–4), compose from
  the **Servers hub / Tools `SplitPanel` / Run-console `Dialog`** patterns — sticky header, `Tabs`,
  `DataTable`, `MetricGrid`, `Sheet` inspector — **not** the Dashboard/Compare card-grid patterns this
  audit is removing. Keep the new compact density tokens (P0.3) as the baseline.

---

## Sequencing & dependencies

```
P0.3 (density tokens) ─┬─> P1.1 Dashboard
                       ├─> P1.2 Compare
                       └─> P1.3 Scans
P0.1 (settings/IA)  ── independent, ship first (most visible win, issue #6)
P0.2 (AlertDialog)  ── independent, quick
P0.4 (copy/breadcrumb) ── independent, quick
P2.* ── after P1 (they reuse the same DataTable/row patterns)
```

**Recommended first slice (a day or two):** P0.1 + P0.2 + P0.4 (the IA/copy/confirm cleanup — directly
answers issues #2, #5, #6 and feels instantly more tool-like), then P0.3 density tokens, then P1.1/P1.2
to kill the two card-grid screens.

## Definition of done (per the repo's own gate)
`pnpm typecheck && pnpm test && pnpm build` green, **and** the changed screens verified **against the
running app** in light + dark (the repo rule: visual claims are checked live, not on a mock).
Route a scored pass through `brand-ui-audit` with register = *product/professional*.
