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
