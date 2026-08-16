# Coding-agent brief — rework the MCP Token Footprint UI

_Hand this whole file to your coding agent. It is self-contained; companion detail lives in
`UI-AUDIT-2026-06-20.md` (same repo)._

## Role & context

You are working in **this repo** (`mcp-token-footprint`, a pnpm workspace; `apps/web` is the
React 19 + Vite SPA built entirely on the **`@brand/*`** design system). **Read `CLAUDE.md` and
`.claude/rules/` first.** Hard constraints:

- **brand-ui only.** Every visible element is a `@brand/*` component. **Semantic tokens only**
  (no raw hex/rgb). Must read correctly in **qlik-bright and qlik-dark**.
- **Never guess props.** Confirm each component's real API with `npx brand-ui docs <Component>`
  (or `npx brand-ui search <need>`) before using it. Available structural components include:
  `PageShell`, `SectionHeader`, `ButtonGroup` (+`ButtonGroupSeparator`), `Tabs`/`TabsList`/
  `TabsTrigger`/`TabsContent`, `SplitPanel` (`start`/`end`/`startSize`/`direction`),
  `ResizablePanelGroup`, `ScrollArea`, `Descriptions`/`DescriptionsItem`, `Dialog`,
  `AlertDialog`, `Tooltip`, `Badge`/`StatusBadge`, `StatePanel`, `ThemeSwitcher`,
  `DataTable`/`SearchInput`/`FilterBar` (`@brand/data`), `MetricGrid`/`MetricCard` (`@brand/charts`).
- **Use the installed skills:** `brand-ui` for composition + real props; **`brand-ui-audit`**
  for the final scored review. If the `qlabs-enterprise-ui` skill is available, load it — the
  references named below come from it; otherwise this brief is sufficient.
- **Gate (definition of done):** `pnpm typecheck && pnpm test && pnpm build` must be green.
- **Runtime boundary unchanged:** UI only; no DB/MCP/secret logic in `apps/web`.

## Scope — and what NOT to touch

Fix the **server detail page** and a few global items. **Do not restructure `Scans`, `Compare`,
or the `Dashboard`** — they're already good (clean master-detail + empty states + routing).
Protect them. Make the smallest change that achieves each acceptance criterion; reuse existing
patterns from those good views.

---

## Tasks (do in this order)

### 1 — [P0] Server detail: sticky chrome + independent-scroll layout
The server name, the action buttons, the KPI row, **and the Tab bar** currently scroll away;
to switch tabs or run a scan you must scroll back to the top.
- Give the detail a **fixed-height** layout (`flex min-h-0` inside the routed content) so the
  page itself does not scroll.
- Put in a **sticky** region that never scrolls: `PageShell`/`SectionHeader` with the title +
  status `Badge`s + the action toolbar, **and the `TabsList`** (Overview/Tools/Scans). Only the
  active `TabsContent` scrolls.
- Group the header actions in a **`ButtonGroup`**: `[Edit] [Test] [Run scan]` (Run scan =
  primary) · `ButtonGroupSeparator` · `[Delete]` (destructive variant, `aria-label`, `Tooltip`,
  routed through an `AlertDialog` confirm naming the consequence).
- **Acceptance:** scroll the Tools content — the title, the action toolbar, and the tab bar stay
  fixed; only the list/detail scroll.

### 2 — [P0] Tools tab: rebalanced master-detail + decision-signal list
The list takes ⅔ and the **detail** (the actual point) only ⅓; the list shows an overflowing
instruction that duplicates the detail and gives no signal to pick a tool.
- Render the Tools tab as **`SplitPanel`** with the **detail getting the larger share**: list
  pane `startSize` ≈ `"380px"`, detail fills the rest. **Wrap each pane in its own `ScrollArea`**
  so they scroll independently.
- **List = decision signal** (use `@brand/data` `DataTable` or a tight list): columns = tool
  **name** (one line, `truncate` + `min-w-0`, full name in a `Tooltip`), **tokens**, a
  **detected-issues** `Badge`, and **share %**. **Remove** the full per-row instruction. Keep
  the filter box; add a count.
- **Acceptance:** scrolling the list does not move the detail; selecting a tool updates the
  detail in place; the list shows tokens + an issues badge so you can pick the right tool.

### 3 — [P1] Tools tab: structure the tool detail + promote "Run tool" to its own surface
The detail is one flat panel that buries Parameters, the optimization recommendation, and the
high-value Run feature; the token split is drawn as four stacked bars.
- Make the tool detail **structured** — sub-`Tabs` (or clearly ranked sections):
  **Breakdown** (replace the four bars with **one segmented/stacked bar**: Name · Description ·
  Schema · Annotations, plus the numbers) → **Parameters** (`Descriptions` or a small table) →
  **Run** (entry point) → **Raw** (schema/tool JSON in the existing `CodeBlock`, last).
- **Run tool → a large `Dialog`**: **parameters form on the LEFT, result on the RIGHT.** Show
  the call's **request/response token + byte cost** alongside the result; wire **loading and
  error** states; add a purposeful reveal animation (`transform`/`opacity`, `motion-reduce`
  safe). Launch it from a prominent **Run** button in the detail.
- **Acceptance:** Run opens a modal with params-left/results-right; the call's token cost is
  shown with the result; it works for a tool that has required parameters; errors surface in the
  modal (not a silent failure).

### 4 — [P1/P2] Overview tab: prioritize by value, kill redundancy
- **Tab order = Overview · Tools · Scans**, with **Overview the default**.
- **Remove the duplicated KPI band** on Overview — those KPIs already live in the sticky header.
- **Lead with the findings (hero):** "Attention & Optimization" becomes a **list of
  recommendations**, each = **what + why + a CTA** (e.g. "Schema is 88% of `qlik_create_data_object`'s
  tokens → Review schema" that selects that tool). No card-in-card.
- **Server Profile** → `Descriptions` (calm, below the findings). **Footprint composition** →
  one **segmented bar**. **Top token contributors** → a **compact ranked list** (tool · tokens ·
  inline bar · %), **not** a full-width chart.
- **Acceptance:** Overview opens by default, leads with actionable findings, repeats nothing from
  the header, and uses compact encodings.

### 5 — [P2] Server rail (the list): search + count + selected state
- Add a `SearchInput`/filter above the server cards; show a count; mark the **selected** card.
- **Acceptance:** you can filter the server list; the active server is visibly selected.

### 6 — [P1 theme / P2 settings] baseline chrome
- Replace the light/dark toggle with the **library `<ThemeSwitcher />`** (its `themes` defaults
  to the Qlik light/dark pair and `showSystem` defaults to `true`, so it renders **System /
  Qlik Bright / Qlik Dark** out of the box). Confirm with `brand-ui docs ThemeSwitcher`.
- Optional: add a quick settings `Dialog` (gear in the top bar) with an **Appearance** section
  hosting the theme switcher; keep the Settings route for deep config.

---

## Cross-cutting rules (apply throughout)

- Every interactive surface designs its **empty / loading / error** states (`StatePanel` /
  `EmptyState` / `Skeleton`); never a blank region or a silent failure.
- **a11y:** real elements, visible focus rings, labels on inputs, `aria-label` on icon-only
  buttons, `Dialog`/`Sheet` need a Title.
- **Truncation:** flex children get `min-w-0` so long tool names / URLs truncate, not overflow.
- **Toasts** for async outcomes (`toast.success`/`.error`); inline `role="alert"` for form errors.
- Don't introduce a second UI kit, raw colors, or any marketing/landing patterns.

## Verify before you call it done

1. `pnpm typecheck && pnpm test && pnpm build` — green.
2. Visually verify (use the `agent-browser` skill or a browser at http://localhost:8080/):
   - **Scroll test:** on the server detail, scroll the Tools content — title, actions, and tab
     bar stay fixed.
   - **Master-detail:** list and detail scroll independently; selecting a tool updates the detail
     in place.
   - **Run modal:** opens with params-left/results-right; shows token cost; handles error.
   - **Overview:** default tab, findings-first, no KPI duplication, segmented bar + ranked list.
3. Run the **`brand-ui-audit`** skill on the changed surfaces (register = *product/professional*)
   and fix any P0/P1.
4. **Report honestly** what you did and did **not** visually verify.

## Suggested commit slices
(1) sticky chrome + ButtonGroup toolbar → (2) Tools `SplitPanel` rebalance + decision-signal list
→ (3) structured tool detail + Run modal → (4) Overview prioritization → (5) server-rail search →
(6) ThemeSwitcher. Smallest reviewable diffs; re-run the gate after each.
