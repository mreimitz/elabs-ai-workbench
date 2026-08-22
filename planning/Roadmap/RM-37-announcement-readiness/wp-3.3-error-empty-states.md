---
type: "Work Package Spec"
title: "WP 3.3 — Error panels, empty states and one loading recipe"
description: "Phase 3 of item.md. Ledger: STATUS.md. Every error panel gets a short title and a Try-again action, the 33 panels that say 'refresh the page' stop prescribing what the UI does not offer, the ten worst empty states are rewritten and the rest lose their internal nouns, range-hidden results get a recovery action, zero-state views carry the page's ⓘ sentence inline, and every route loads with the same skeleton recipe."
tags: ["roadmap", "RM-37"]
timestamp: "2026-08-22T07:10:00Z"
status: "final"
---
# WP 3.3 — Error panels, empty states and one loading recipe

Phase 3 of [`item.md`](./item.md). Ledger: [`STATUS.md`](./STATUS.md).

**Depends on:** nothing; [`wp-3.1-copy-scrub-label-maps.md`](./wp-3.1-copy-scrub-label-maps.md) already rewrites the two empty states that carried planning ids (Artifacts, cross-run report). Paths are relative to the repo root (`…/` = `apps/web/src/features/`). `StatePanel`, `EmptyState` and `ErrorState` come from `@elabs-ai/components-ui` and cannot be changed here — the fixes are app-side wrappers and tests.

## Scope

The three recipes a first-week user meets most: an error, an empty view, a loading view. Measured on the review copy: 60 error panels, 43 without an action, 33 whose copy says "refresh the page" or "try again" with no button; 37 empty/error panels using an internal noun; three loading grammars, with the run console showing a blank pane. Out of scope: the default scope of the dashboard Issues tab and its range presets (wp-2.2), the "No errors detected" logic on failed runs (wp-2.8), the six-meanings-of-"test" wording (wp-3.2).

## Actions

### 1. [P1] Error panels: short title, plain cause, one Try-again action

**WHAT:** an app-level `ErrorPanel` in `apps/web/src/components/ErrorPanel.tsx` wrapping `StatePanel kind="error"` with a required `retry` (or `actions`) prop, `title` ≤ 6 words starting "Couldn't …", `description` = the cause in plain words, and the raw error behind a "Details" disclosure. **WHERE:** all 60 `kind="error"` / `ErrorState` panels; the sentence-title and text-only-"Try again" sites to fix first:

| File:line | Current | Target |
|---|---|---|
| `…/skills/SkillInspector.tsx:745–749` (also `:813, 831, 850, 870`) | title "Couldn't load version — switch versions or refresh the page to try again.", description = raw error | title "Couldn't load this version", description = cause, buttons **Try again** · Switch version |
| `…/skills/SkillOverview.tsx:331, 508` | same pattern | same target |
| `…/compare/CompareView.tsx:619–623` | description `${error} Try again.` | description = error, button **Try again** (re-runs the comparison) |
| `…/compatibility/CompatibilityView.tsx:342–346` | description `${error} Try again.` | button **Try again** (reloads the heatmap) |
| `…/reports/ServerReportView.tsx:198–202` | description `${error} Try again.` | button **Try again** (rebuilds the report) |
| `…/testing/compare/FlowMode.tsx:99–103` | description `${error} Try again.` | button **Try again** (reloads the traces) |
| `…/testing/suites/SuiteDetail.tsx:305–309` | description "Try refreshing the page." | button **Try again** (calls the suite loader) |
| `…/reports/DigestReportView.tsx:22`, `…/reports/ServerReportView.tsx:118`, `…/skills/studio/SkillStudioView.tsx:75` | "Digest unavailable / Missing digest id.", "Report unavailable / Missing scan id.", "No skill named / This address doesn't name a skill to author." | title "This link is incomplete", description "It doesn't point to a {digest / scan / skill}. Open one from {Notifications / Scans / Skills}.", the link as the action (no retry) |

**TARGET STATE:** no error panel without an action; no description that tells the user to refresh or try again in words only.

### 2. [P1] The shell-level API failure has a real retry

**WHERE:** `apps/web/src/App.tsx:558–591` — when the API is unreachable at boot, `refreshAll` fails as a whole, shows one toast ("Couldn't refresh the app data. Failed to fetch Try again." — "Try again" is text) and renders every view on empty arrays, so `/servers` shows the first-run "add your first MCP server" state. **TARGET STATE:** a shell banner keyed on the health probe — "Can't reach the workbench API — **Retry**" — with views held in their loading state until the first successful load; the toast's "Try again" becomes the banner's button.

### 3. [P1] Rewrite the worst empty states

**WHAT:** the rule — an empty state names the thing, says when it will exist, and offers the action that makes it exist. **WHERE / TARGET STATE** (the Artifacts and cross-run-report panels land with wp-3.1):

| File:line | Current | Rewrite |
|---|---|---|
| `…/testing/AnalyticsPanel.tsx:383–386, 448–451, 492–495` | "The context staircase fills as turns settle." / "Per-turn composition fills as turns settle." / "…needs provider-actual usage on a settled turn." | one string: **No turns yet** — "Context and token breakdowns appear after the first completed turn." |
| `…/testing/AnalyticsPanel.tsx:534–537` | "No comparison yet — Estimate-vs-actual needs both an estimator lens and provider-actual usage." | **No forecast to compare** — "Forecast vs. actual appears once the environment has a token profile and the provider has reported usage for a turn." |
| `…/testing/AnalyticsPanel.tsx:127–131` | title "Session analytics" (a heading used as a state) | **Nothing to analyze yet** — "Token, cost, tool and timeline analytics appear once the run produces steps." |
| `…/testing/AnalyticsPanel.tsx:570–573, 676–679` | "Appears once a tool returns a measured result." / "Appears once a tool call is attributed to a server." | "Shows the tokens each tool returned, once a tool has answered." / "Shows which server each tool call went to, once the run makes one." |
| `…/testing/suites/SuiteReportTab.tsx:569, 645` | "Nothing to roll up" / "No error clusters" with "…deterministic error-forensics finding" / "(operationally clean)" bodies | **No errors found** — "None of the {n} runs in this suite run hit an error." |
| `…/testing/ReportTab.tsx:715–719` | "No errors detected — The deterministic inventory found nothing that went wrong in this run." | "No errors found — Nothing in this run's steps failed." (whether it may show on a failed run at all is wp-2.8) |
| `…/hub/SessionSkillsPanel.tsx:194–200` | "Attach a skill to give this session name + description context, loadable on demand via skills.load." | **No skills attached** — "Attach a skill so the assistant can load it when a prompt needs it." (keep the Attach button) |
| `…/skills/LiveSkillWorkspaceView.tsx:169–173` | "The live workspace hasn't materialized any files." | **No files yet** — "Files appear here as the assistant edits this skill." |
| `…/hub/workforce/crew-profile/UsageSection.tsx:43–45` | "This crew hasn't been instantiated into any sessions yet." | **No usage yet** — "Start a session with this crew to see its spend and tokens here." + **Start session** |
| `…/hub/meta-rail/ContextSection.tsx:469, 597` | "No MCP servers are connected to this session." / "No skills are available in this session." — two empty cards, no next step | **No MCP servers** — "Add servers in Session settings, or switch tools to Auto to let the assistant find them." + **Add servers**; same pattern for skills |
| `…/testing/ContextChart.tsx:273–275` | "…The turn-0 baseline (system + tool definitions) appears here first." | "The timeline fills as the run produces turns; the first point is the system prompt plus tool definitions." |

### 4. [P2] No internal noun in any empty state

**WHAT:** a guardrail, `apps/web/src/guardrails/empty-state-jargon.guardrail.test.ts`, that scans the `title=` / `description=` props of `EmptyState`, `StatePanel`, `TabEmptyState` and `ErrorPanel` in non-test web source. **TARGET STATE:** it fails on settle, staircase, lens, provider-actual, materialize, instantiate, deterministic, cluster, taxonomy, matrix, cells, member run, turn-0, terminal run, envelope, scope, analyzer v, engine v, and on any `*.load`-style tool name; the 27 panels beyond action 3 that still match are rewritten to the same rule (`…/testing/suites/FailureBuckets.tsx:157` "failure taxonomy" among them); exemptions carry a reason.

### 5. [P1] Range-hidden results get a recovery action

**WHERE:** `/dashboard?tab=issues` — `…/issues-fleet/IssueTriageTable.tsx:189` renders "No issues match the current filters." although the filter hiding everything is the page range, which is not in the tab's filter row; `…/issues-fleet/IssuesFleetTab.tsx:173–177` covers only the no-issues-at-all case. **TARGET STATE:** when open issues exist but none were seen in the window, a `TabEmptyState` reads **No issues seen in this window** — "None of the {n} open issues were seen between {from} and {to}." with one action **Show all {n} open issues** (resets the range for this tab). The default scope itself is wp-2.2.

### 6. [P1] Zero is not a measurement; six empty panels become one notice

**WHERE:** `/dashboard?tab=testing` — `…/dashboard/testing/KpiHeader.tsx:35–36` renders "Error rate 0.0%" from `formatPercent(kpis.errorRatePercent)` with 0 runs; the six chart panels render six empty cards under the same window. **TARGET STATE:** a zero denominator renders "—" (the rule is wp-3.2 action 5); with 0 runs in the window the tab shows one notice above the tiles — **No runs in the last {window}** — "Last run {age} ago." + **Widen the range** (selects the smallest preset that contains the last run) — and the panels render skeleton-free, collapsed. New presets ("All time", "Since last run") are wp-2.2.

### 7. [P2] The ⓘ sentence inline on zero-state views

**WHERE:** `apps/web/src/components/ViewToolbar.tsx:82–83` surfaces each view's onboarding sentence only as an ⓘ tooltip; `…/testing/collections/CollectionsView.tsx:239–248` already moves the sentence onto the zero-state card and omits the tooltip until a collection exists. Consumers to generalise: `…/servers/ServersOverview.tsx:226`, `…/skills/SkillsOverview.tsx:110`, `…/watch/WatchRulesView.tsx:196`, `…/review/ReviewView.tsx:361`, `…/review/RubricsView.tsx:109`, `…/compatibility/CompatibilityView.tsx:227`, `…/advisor/AdvisorView.tsx:116`, `…/hub/projects/ProjectsView.tsx:26`, `…/hub/AuditView.tsx:629`, `…/hub/workforce/WorkforceView.tsx:158`. **TARGET STATE:** the Collections pattern on every view — the sentence (≤ 20 words) under the empty-state title while the view has no data, the ⓘ tooltip once it does; `ViewToolbar` gains an `emptyInline` variant so the sentence is written once per view.

### 8. [P1] One loading recipe

**WHERE:** `/dashboard` renders a skeleton bento (`…/dashboard/overview/OverviewTab.tsx:247` `OverviewBentoSkeleton`); `/servers` (`…/servers/ServersOverview.tsx:319` `initialLoading`) and `/testing/environments` (`…/testing/EnvironmentsView.tsx:439` `kind="loading"`) render a centred spinner with "Loading…"; `/testing/runs/:id` (`…/testing/RunConsole.tsx`) renders a blank pane until the run arrives and the tab title flickers "AI Workbench" → "Run" → run name; `apps/web/src/App.tsx:1745–1758` `derivePageTitle` returns "Page not found" while breadcrumbs are empty, so a loading route records a 404 title in history. **TARGET STATE:** list and grid routes render skeleton rows/cards; detail routes render a header skeleton plus a body skeleton; no route ever paints a blank pane; the breadcrumb leaf shows a skeleton, not a placeholder word; the document title keeps the previous title (or the route's static name) until breadcrumbs resolve. Add `apps/web/src/guardrails/loading-recipe.guardrail.test.tsx`: every lazy route in `App.tsx` renders a skeleton (not `null`, not a bare spinner) on first paint, and `derivePageTitle` never returns "Page not found" for a known route with unresolved breadcrumbs.

## Acceptance

- [ ] `grep -rn 'kind="error"' apps/web/src --include=*.tsx | grep -v "\.test\." | grep -v components/ErrorPanel.tsx` returns nothing — a guardrail (`error-panel-retry.guardrail.test.ts`, retired-component style) forbids direct `StatePanel kind="error"` / `ErrorState` in features.
- [ ] `grep -rn "refresh the page\|Try again\.\|Try refreshing" apps/web/src --include=*.tsx | grep -v "\.test\."` returns only toast bodies that sit beside a toast action.
- [ ] The ten rewrites of action 3 are present verbatim; `empty-state-jargon.guardrail.test.ts` passes and fails on a fixture containing "settle".
- [ ] With the API stopped, the shell shows the banner with a working Retry and `/servers` does not show the first-run empty state.
- [ ] `/dashboard?tab=issues` with open issues outside the window shows the "Show all {n} open issues" action and it works; `/dashboard?tab=testing` with 0 runs shows "—" for Error rate and one notice, not six empty panels.
- [ ] Each of the ten views in action 7 shows its sentence inline when empty and only the ⓘ once populated.
- [ ] Reloading `/testing/runs/:id` and `/servers/:id` shows a skeleton in the first frame, never a blank pane, and the document title never reads "Page not found" for a valid route.
- [ ] Every touched surface reads correctly in both themes; gate green: `pnpm typecheck && pnpm test && pnpm build && pnpm lint`.

## Effort

M (2–5 days). The `ErrorPanel` wrapper and its migration across 60 sites is two days; the rewrites and the jargon guardrail one day; the Issues/Testing empty states, the ⓘ pattern and the loading recipe one to two days.

## Sources

UXC-17, UXC-30, PO-33, UX-29, UX-04, UX-07, ENG-19, QA-35, WT (walkthrough: six empty panels on `/dashboard?tab=testing`, "0 of 12 issues" under the default range, blank run-console pane, tab-title flicker). Not re-filed: the range presets and the default Issues scope (wp-2.2), "No errors detected" on a failed run (wp-2.8), UXC-02 and UXC-03 rewrites (wp-3.1).
