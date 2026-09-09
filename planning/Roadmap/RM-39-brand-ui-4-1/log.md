# brand-ui 4.1.0 adoption — shell repairs come home Update Log

## 2026-09-09

* **Initialization**: Created roadmap item [item.md](item.md).
* **Release read, from the published artefacts.** All twelve `@elabs-ai/components-*` packages are at
  **4.1.0** (2026-09-08); this repo is on 4.0.0. Facts were taken from the 4.1.0 npm tarballs (they
  ship `src/`, including stories), diffed export-by-export against 4.0.0; from the 4.1.0 CLI's
  generated component manifest; and from the upstream repository's own `CHANGELOG.md` §`v4.1.0`
  (2,328 lines) and `registry/blocks/app-shell/`. **The plugin checkout at
  `~/.claude/plugins/marketplaces/brand-ui` is 2.1.1 and was NOT used — it is three majors stale.**
* **Three breaking changes under a minor version number**, a stated maintainer decision. Measured
  against this repo: `Form` off the main barrel — **zero** call sites here; `Context*` → `TokenUsage*`
  — **one** real consumer (`KpiRail.tsx`) plus a test mock; the `ModelSelector*` family deleted —
  **three** non-test files, of which `HubModelPicker.tsx` (RM-16's single picker) is a real
  re-composition onto `CommandDialog` + `Command*`. The terminal family moved to a new package:
  **zero** impact, we never imported it.
* **The finding that reframes the item.** Upstream's
  `docs/superpowers/specs/2026-09-05-app-shell-blocks-design.md` §2.1 records that the library's new
  flagship app shell was designed by **reading this repository** — it cites `AppShell.tsx` (1,102
  lines) and `PageShell.tsx` (254 lines) by path and line count, and the flagship block's header
  calls itself *"a direct port of the shell the elabs AI Workbench ships"*. `SideDock` ships our exact
  constants (480px minimum content, 1100px overlay breakpoint); `SidebarMenuButton` now carries our
  active-nav accent bar, filed upstream as defect R1 **with our contrast measurement as the reason**;
  `SidebarGroupLabel` now collapses with `hidden`; `PageShell` gained our own three-mode `scroll`
  vocabulary. So Phase 2 is a deletion of duplicated fixes, not an adoption of a foreign design.
* **One real accessibility defect found in this app while reading the flagship.** `AppShell.tsx`
  renders the assistant dock's `<aside aria-label="App assistant">` **inside**
  `<SidebarInset id="main-content">`, putting a complementary landmark inside the main landmark. The
  flagship block names this exact mistake at its own dock call site. Filed as **WP 2.4**; not fixed
  yet.
* **Protective change applied ahead of the plan (D-BU1).** Every `@elabs-ai/components-*` dependency
  moved from `^4.0.0` to an exact `4.0.0` in `apps/web/package.json` and the root `package.json`, so
  the breaking minor cannot land on the next re-resolve. Reinstall was clean and still resolves 4.0.0;
  the only lockfile churn was three stale duplicate Radix entries dropped (the installed versions are
  untouched).
* **A pre-existing test failure was found and fixed.** `DashboardRangeControl.test.tsx` had **expired
  with the wall clock**: its `clickDay()` helper names dates in August 2026, but the calendar renders
  the month derived from the real system clock, so those cells stopped existing once the machine's
  date left that window — 2 of 7 tests failed on clean `HEAD`, before any change here. Fixed by
  freezing the clock to the same instant the file's own `renderControl` default already used.
  **Verified by mutation probe:** moving the frozen date to November reproduces the original
  "No calendar cell for 2026-08-14" failure exactly, so the freeze is what carries the fix.
* **Gate green after both changes:** `pnpm typecheck` · `pnpm test` (shared 288 · illustrations 1032 ·
  cli 87 · api 3985 · web 402 files / 4,534 tests, 0 failures) · `pnpm build` · `pnpm lint`.
* **Plan written**: [STATUS.md](STATUS.md) — 19 work packages across 4 phases, decisions **D-BU1–D-BU9**.
* **Chart review done (WP 4.2), and it adopts nothing.** The charts package grew 238 → 345 source
  files with ten new containers; this app uses only the basic families and **none** of the ten. Each
  was judged against our own data shape and the component's declared anti-patterns rather than by
  name, and three of the four candidates named in the plan were **rejected on evidence**:
  `NetworkChart` encodes adjacency only and says so ("positions are artefacts of the solver's seed"),
  while the agent-graph lens's Expanded mode puts execution order *in* the position and draws
  cost/token/duration chips per node; `TreeChart` fails the org chart the same way; and
  `HeatmapChart` would trade the compatibility grid's colour-independent per-cell glyph + hatch for
  a colour ramp, when the cell's primary content is a categorical band, not a magnitude.
* **`DistributionChart` is the right picture for RM-34's turn profile and cannot be built here.** Its
  `data` is documented as record-level observations, never pre-aggregated buckets, and
  `RunPlanTurnProfile` carries only p10/p50/p90 plus a sample size — so it needs the sample on the
  wire, which D-BU8 forbids in this item. Recorded as a follow-up in RM-34's own ledger rather than
  only claimed here.
* **The strongest candidate was not on the plan's list.** The compare workspace renders per-tool
  token deltas as table rows with badges and **no chart at all**; `DumbbellChart` exists for exactly
  that ("the CHANGE is the mark, not a second bar") and its data is already client-side, needing no
  wire change. Split out as **WP 4.2b**.
* **A caution now measured, not asserted:** **40** test files stub `@elabs-ai/components-charts` with
  no-op components, so a chart-prop bug passes the gate in silence. No chart may be adopted on a
  green test.
* **Not done in this WP:** nothing was rendered and no browser was opened — sufficient for a
  "do not adopt" verdict, deliberately not sufficient for an adoption.
* **Phase 2 (the shell) — five of six done; WP 2.3 deliberately left open.** `SkipLink` and
  `CommandTrigger` imported and the hand-rolled versions deleted; the dock's `<aside>` lifted OUT of
  `<main>` (a complementary landmark had been nested in the main landmark) with a new guardrail that
  was **mutation-proved** — putting it back turns the test red; `ACTIVE_NAV_INDICATOR_CLASS` and the
  collapsed group-label override deleted after **measuring** that `--sidebar-primary` and `--primary`
  are the same value in both themes; and the page frame's scroll ports made keyboard-operable.
* **WP 2.3 (`SideDock`) is NOT a refactor and was not done.** It is grounded on `--card` while this
  app's dock deliberately paints the sidebar surface — and that choice is load-bearing, because
  `AssistantDock` carries an `app.css` block replacing `ChatShell`'s colour scrims *because* it sits
  on `--sidebar`. Plus `SideDock` renders its own header above a `ChatShell` that already has one.
  A visible redesign of the assistant dock, and the owner's call.
* **A second accessibility defect found by WP 2.6 and fixed.** This app's scroll ports carried no
  `tabIndex`, so a keyboard-only user could not scroll a page whose content held nothing focusable
  (WCAG 2.1.1 / axe `scrollable-region-focusable`). Fixed on both ports; verified live on `/advisor`,
  `/servers` and `/skills`. Biome's `noNoninteractiveTabindex` genuinely conflicts with the axe rule
  here, so it is suppressed at those two lines with the reason stated.
* **WP 4.2b — the compare workspace's movers chart — built and VERIFIED IN A BROWSER, which is what
  made it correct.** The first cut had two faults no test could see: the chart sized itself from its
  own aspect ratio to **625px** inside a ~355px slot and **four of eight tracks were cut off**, and
  the first category label sat at **x = −25**, clipping the START of long MCP tool names. Both
  measured, fixed, and re-measured (417px, six rows, every label at x = +25).
* **WP 3.1 — the tool playground now builds a real typed form from the tool's schema.** All **24 of
  24** tools on the workbench's own MCP mount render one; arrays became add/remove lists where they
  had been "paste JSON here" textareas. The correctness half is a separate tested module with four
  refusal paths — including a **nested object**, because upstream's `jsonSchemaRequestBody` (which
  rebuilds the shape the adapter flattens) is **not exported from the barrel**, so submitting would
  send the wrong argument shape. Refused rather than attempted. Looking at it also caught a
  regression the swap would have introduced: the single required argument rendered sixth of seven,
  so required-first ordering was restored.
* **A flaky test was investigated rather than waved away.** Two different skills-studio tests failed
  on separate full-suite runs while passing 3/3 in isolation. The decisive control was to stash every
  change and run the full suite on the untouched tree — which **also failed**, on different tests
  again. Pre-existing intermittent flakiness under full-suite load, measured, not asserted; not
  introduced here and not fixed here.
* **Gate green** after every work package: `pnpm typecheck` · `pnpm test` (web 404 files / 4,568
  tests) · `pnpm build` · `pnpm lint`.
* **WP 2.3 done after an owner decision to switch.** The hand-rolled assistant dock is replaced by
  the library's `SideDock`: **net 168 lines removed** from the shell, including a 73-line bespoke
  resize handle, a matchMedia breakpoint hook, a viewport re-clamp effect, a close-transition timer
  and an entire separate narrow-screen `Sheet` branch. Width persistence — the only part that is
  this app's own business — now fires once per interaction rather than on every pointer move.
* **The swap exposed a hazard in the guardrail written one WP earlier.** It matched the hand-rolled
  dock's `aria-label`; `SideDock` uses `aria-labelledby`, so the selector stopped matching and the
  test went **green for the wrong reason** — asserting about an element that no longer existed. It
  now asserts that no `<aside>` sits inside `<main>` at all, and its harness forces a wide viewport
  because the narrow branch is a portal that would prove nothing. Re-proved by mutation against the
  new component.
* **The dock has never been seen in its new form.** It needs provider credentials this environment
  does not have. The concrete risk, read from `SideDock`'s source: its body is `p-4 overflow-y-auto`,
  so it owns padding and scrolling, while `AssistantDock`'s `ChatShell` owns its own scroll and pins
  a composer — a double scrollbar and a composer that scrolls away are both plausible. Plus the
  ground moves from `--sidebar` to `--card`, which is what the `assistant-dock-shell` scrim fix in
  `app.css` was tuned against, and `SideDock` adds its own header above `ChatShell`'s. All four are
  first-look items for the owner; a green gate cannot see any of them.
