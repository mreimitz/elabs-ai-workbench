---
type: "Work Package Spec"
title: "Phase 0 \u2014 Defects \u00b7 Batch A"
description: "Four parallel WPs, disjoint domains, no dependencies. The three real defects (A-1/A-2/A-3) plus the"
tags: ["roadmap", "RM-28"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# Phase 0 — Defects · Batch A

Four parallel WPs, disjoint domains, no dependencies. The three real defects (A-1/A-2/A-3) plus the
mechanical pagination sweep and the record correction. Read [`conventions.md`](./conventions.md) and the
audit §A before starting.

---

## WP 0.1 — Run-console switcher merge

- **Findings covered:** A-1 (run console: two controls, one state, non-overlapping values — **S1 defect**).
- **Domain (exact):**
  - `apps/web/src/features/testing/RunConsole.tsx`
  - `apps/web/src/features/testing/RunConsole.test.tsx` *(create if absent; the invariant tests below live here)*
- **Depends:** — · **Size:** M · **parallel** · **Batch A** · **Model:** opus, effort **high**.

**This is the highest-value WP in the plan and the one most likely to be done badly. It is not a styling
change.** `RunConsole.tsx` has two view switchers writing one `leftView` state with non-overlapping value
sets, so the segmented control misreports state in **both** directions (reproduced live — audit screenshots
06/07):

- The **`TabPanel` strip** (`RunConsole.tsx:869-898`, `value={leftView}`) renders tabs
  `chat` "Chat" · **`raw` "Trace"** · `analytics` "Analytics" · `report` "Report" — **4 tabs**. (Note the
  historical mapping: the **"Trace"** tab's `value` is `"raw"`.)
- The **`ToggleGroup`** "Console view" inside `RunSearchBar` (`:1306-1320`) renders
  `chat` "Conversation" · `steps` "Steps" · `turns` "Turns" — **3 items** — and is fed through a coercing
  ternary at `:815`: `lens={leftView === "steps" || leftView === "turns" ? leftView : "chat"}`.
- The `steps` (`:936`) and `turns` (`:950`) `TabPanelContent` panels exist but are **not** in the `tabs`
  array — so selecting them shows content with **no active tab**; and selecting Trace/Analytics/Report
  snaps the toggle group back to "Conversation".

**The fix.** Pick one switcher. `Conversation/Steps/Turns` and `Chat/Trace/Analytics/Report` are the same
axis — *how do I want to read this run*. Merge into the single `TabPanel` strip and delete the toggle:

1. Extend the `tabs` array (`:875-898`) to the full ordered set
   **`chat "Chat" · steps "Steps" · turns "Turns" · raw "Trace" · analytics "Analytics" · report "Report"`**
   — i.e. add `{ value: "steps", label: "Steps" }` and `{ value: "turns", label: "Turns" }` in that order,
   before the existing `raw`/"Trace" entry. Keep the `report` entry's `reviewing`-spinner label exactly as
   is (AR11).
2. Delete the `ToggleGroup` / `ToggleGroupItem` block in `RunSearchBar` (`:1306-1320`), its `lens` /
   `onLensChange` props (declaration + the `:1240`/`:1251-1252` types), the `lens={…ternary}` argument at
   `:815`, and the now-unused `ToggleGroup, ToggleGroupItem` imports (`:43-44`). Remove any now-dead
   `onLensChange` handler.
3. **Leave the search field alone** — `RunSearchBar`'s query box + match count + prev/next stepper stay in
   their own row (removing the toggle from that row also shrinks it, which serves A-3; A-3's row work is
   0.2's, not this WP's — do not fold rows here beyond removing the toggle).
4. Keep `?lens=` URL persistence working. The write side (`:283-284`) already persists any non-`chat`
   `leftView`; extend the mount read (`:260-262`) so it restores the full tab-value set (at minimum keep
   `steps`/`turns` restoring; ideally accept `raw`/`analytics`/`report` too). Never let a persisted/nav
   value land `leftView` on a value the strip doesn't render.
5. Verify every `navigateTo(...)`/programmatic setter maps only to strip values (`"trace"` pane → value
   `"raw"`, both present).

**Acceptance (checklist):**
- [ ] The visible tab strip reads **Chat · Steps · Turns · Trace · Analytics · Report** in that order, in
      both themes, on the running app (seed a run — or, if no provider key, drive the console shell and
      confirm the strip + panel wiring structurally; note it as owner-acceptance for live data).
- [ ] **Every tab value has a panel, and every panel has a tab** — enumerate the 6 (`chat`, `steps`,
      `turns`, `raw`, `analytics`, `report`) and show each appears in both the `tabs` array and as a
      `TabPanelContent`. No orphan on either side.
- [ ] **No code path can set `leftView` to a value the strip doesn't render.** A test asserts the set of
      strip `tabs` values equals the set of `TabPanelContent` values, and that the `?lens=` mount coercion
      + any `navigateTo` mapping only ever yield a member of that set.
- [ ] The `ToggleGroup`, its ternary at `:815`, and the `ToggleGroup`/`ToggleGroupItem` imports are gone
      (grep-clean); the search query box + hit stepper are untouched and still function.
- [ ] `use-run-stream.ts` terminal-swallow behaviour and the streaming/loading contract are **unchanged**
      (no regression to `.claude/rules/loading-states.md` behaviour).
- [ ] Gate green (`typecheck · test · build · lint`) + the new invariant tests.

---

## WP 0.2 — New-run entry + re-run row

- **Findings covered:** A-2 (`/testing/runs/new` dead-ends, ⌘K links to it — **S1 defect**),
  A-3 (run console stacks four chrome rows, one holding a single button — **S1/S2**).
- **Domain (exact):**
  - `apps/web/src/features/testing/RunConsoleRoute.tsx`
  - `apps/web/src/features/testing/RunBar.tsx`
  - `apps/web/src/features/command-palette/CommandPalette.tsx`
  - `apps/web/src/features/testing/RunsView.tsx` *(the launcher-open URL param only — e.g. reading `?launch=1`; do NOT touch its toolbar/table)*
  - co-located `*.test.tsx` for the above
- **Depends:** — · **Size:** M · **parallel** · **Batch A** · **Model:** opus, effort **medium**.

**A-2.** `RunConsoleRoute.tsx:241-246` requires `testId` + `scenarioId` in the query string; without them
it returns `{missing: …}` and renders an `ErrorState` "Run unavailable — Select a test and environment to
start a run · [Back to runs]" (`:312-325`) — an error that tells the operator to do something the screen
gives no way to do. `CommandPalette.tsx:144` links straight there (`navigate("/testing/runs/new")`), so
⌘K → "New run" reliably lands on that error. The route itself is fine when the wizard navigates to it
*with* params (`RunLauncher.tsx:488`).

- **Fix:** make the **param-less** `isNew` case **open the launcher** instead of erroring — redirect to
  `/testing/runs` with the launcher open (`?launch=1`) and have `RunsView` open its existing
  `Dialog`+`Wizard` launcher when it sees that param (the real launcher is the `+ New run` button at
  `RunsView.tsx:521-526` — a good three-step wizard; do not rebuild it). Point `CommandPalette.tsx:144` at
  that same entry. Keep `ErrorState` **only** for the genuine case: params present but unresolvable.

**A-3.** Above the first line of run content there are four chrome rows (~170px / 21% of an 811px viewport):
(1) **only** `Re-run with changes`, right-aligned (`RunConsoleRoute.tsx:364-379`, ~36px); (2) the `RunBar`
action cluster (`RunBar.tsx:406`); (3) search + hit stepper (+ the toggle 0.1 removes); (4) the tab strip.
Row 1's only sibling is `LineageBanner`, which returns `null` for any ordinary run (`LineageBanner.tsx:27`)
— so for a normal run it is a full-width bordered row holding one button, exactly what D-TB2 forbids
("no floating controls on their own line").

- **Fix:** fold `Re-run with changes` into `RunBar`'s action cluster next to `Replay`/`Export` (same class
  of thing). Keep `LineageBanner` as its own conditional row (a banner is content and self-collapses). With
  0.1's merge, the console goes 4 rows → 2.

**Acceptance (checklist):**
- [ ] ⌘K → "New run" and a bare visit to `/testing/runs/new` (no params) **open the run launcher** (no
      "Run unavailable" error). Bookmarks/back to that URL do the same. Verified on the running app.
- [ ] The genuine error case (params present but unresolvable) still renders `ErrorState`.
- [ ] `Re-run with changes` renders inside the `RunBar` action cluster (with `Replay`/`Export`); the
      standalone Row 1 is gone. `LineageBanner` still renders as its own row only when the run is
      forked/has forks, and returns `null` otherwise.
- [ ] The `RunsView` change is **only** the launcher-open param path — its toolbar/table are byte-untouched
      (that surface is out of this WP's domain).
- [ ] Both themes checked on the running app; gate green + tests for the param-less redirect and the
      relocated re-run action.

---

## WP 0.3 — Pagination guard sweep

- **Findings covered:** C-8 (single-page pagination — **5 of the 6 unguarded sites**; Environments is
  excluded — WP 1.1 owns it).
- **Domain (exact):**
  - `apps/web/src/features/testing/collections/CollectionTests.tsx` (`:404`)
  - `apps/web/src/features/skills/SkillVersions.tsx` (`:254`)
  - `apps/web/src/features/skills/ScaffoldFromServerWizard.tsx` (`:565`)
  - `apps/web/src/features/servers/ServersView.tsx` (`:902` Resources + `:927` Prompts)
  - co-located `*.test.tsx` if an assertion needs updating
- **Depends:** — · **Size:** S · **parallel** · **Batch A** · **Model:** haiku, effort **low**.

`lib/table.tsx:257-262` ships `shouldPaginate(rowCount, pageSize)` precisely to stop `@elabs-ai/components-data`
rendering "Page 1 of 1" with two disabled buttons (confirmed unconditional in `brand-data-1.9.0`). **2 of 8
call sites use it** (`dashboard/ScansTab.tsx:518` ✅, `servers/ServersView.tsx:945` ✅). This WP fixes 5 of
the remaining 6; **`EnvironmentsView.tsx:356` is excluded — WP 1.1 adds its guard while rebuilding the row.**

- **Note:** `ServersView.tsx` already imports `shouldPaginate` at `:65` and uses it at `:945` — the
  omissions are the Resources table (`:902`) and Prompts table (`:927`) in the **same file**. Import is
  already present.
- **Fix (mechanical):** at each site, set `enablePagination={shouldPaginate(<rows>.length, <PAGE_SIZE>)}`
  using that table's existing row array + page size. Import `shouldPaginate` from `lib/table` where not
  already imported. **Do not** change page sizes, columns, or any other table behaviour.

**Acceptance (checklist):**
- [ ] All 5 sites (`CollectionTests:404`, `SkillVersions:254`, `ScaffoldFromServerWizard:565`,
      `ServersView:902`, `ServersView:927`) pass `shouldPaginate(...)` to `enablePagination` — grep shows
      no bare `enablePagination={true}`/`enablePagination` on these tables.
- [ ] `EnvironmentsView.tsx` is **not** touched (owned by 1.1).
- [ ] On the running app, a single-page table in each of these surfaces shows **no** "Page 1 of 1" chrome;
      a multi-page one still paginates. Verified (seed enough rows for at least one to page, or confirm the
      single-page suppression).
- [ ] Gate green.

---

## WP 0.4 — Correct the record

- **Findings covered:** — (record hygiene; supports D-TB6 and the audit's §F guardrail note).
- **Domain (exact):**
  - `roadmap/ux-overhaul/verification-report.md` (the `:176` D-TB2 sign-off line)
  - `apps/web/src/components/TableToolbar.tsx` (**docblock comment only** — mark superseded by D-TB6;
    **no code change** to the component's behaviour)
- **Depends:** — · **Size:** S · **parallel** · **Batch A** · **Model:** haiku, effort **low**.

An inaccurate sign-off is *why this drift survived a verification pass* — fix the record so the next reader
isn't misled.

- **`verification-report.md:176`** currently reads *"D-TB2 (exactly one toolbar row): ✅ one `ViewToolbar`
  row per view; second rows … collapsed into the single row."* Correct it: this was **not** true —
  **Environments** stacks a second `TableToolbar` and the **Dashboard Testing tab** breaks the one-row rule
  (audit B-2, C-1). Amend the line to record the inaccuracy and point to the toolbar-reach plan that fixes
  it (WP 1.1 Environments, WP 2.1 Dashboard). Keep the surrounding report intact; this is a correction
  note, not a rewrite.
- **`TableToolbar.tsx` docblock** — add a top-of-docblock note: *superseded by **D-TB6** (2026-07-25) — this
  component is being retired; its `results`/`activeFilters` slots move into `ViewToolbar` and the component
  is deleted by `roadmap/toolbar-reach` WP 1.1. Its contract points 3 & 4 (second-row chips; "the primary
  action belongs to the `PageHeader`") describe the pre-D-TB2 world and are the documented root cause of
  finding B-2 — do not follow them.* **No behavioural code change** — 1.1 does the deletion; this WP only
  annotates so a developer reading it today isn't misled.

**Acceptance (checklist):**
- [ ] `verification-report.md:176` no longer signs off a rule two views break; it records the inaccuracy
      and links the fixing WPs.
- [ ] `TableToolbar.tsx`'s docblock carries the D-TB6 supersession note; the component's runtime behaviour
      is unchanged (no export/prop/JSX change) — 1.1 owns the deletion.
- [ ] Gate green (docblock/markdown-only; typecheck/test/build/lint unaffected).
