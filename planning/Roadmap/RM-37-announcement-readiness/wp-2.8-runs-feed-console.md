---
type: "Work Package Spec"
title: "WP 2.8 — Runs feed chrome diet and run console outcome-first"
description: "Phase 2 of item.md. Ledger: STATUS.md. The runs feed drops to one toolbar row with linked totals, a working '+ Filter' menu and one outcome encoding; the run console gains an outcome band under the RunBar, an outcome-first rail with one cache and one context number, Analytics as sections, a full-height Steps table, a failure banner, an honest 'Not rated yet' state, judge reasoning without the <rating> tag, a neutral ROUGE tone, the subscription cost grammar, and tool_call steps that settle."
tags: ["roadmap", "RM-37"]
timestamp: "2026-08-22T07:10:00Z"
status: "final"
---
# WP 2.8 — Runs feed chrome diet and run console outcome-first

Phase 2 of [`item.md`](./item.md). Ledger: [`STATUS.md`](./STATUS.md). Follows the rules in
[`wp-2.1-shell-ia.md`](./wp-2.1-shell-ia.md) (rules 1, 2, 4, 6 and 7 apply here).

## Scope

`/testing/runs` (`apps/web/src/features/testing/RunsView.tsx`, `runs/*`, `GradeChip.tsx`, `grade-format.ts`)
and `/testing/runs/:runId` (`RunBar.tsx`, `KpiRail.tsx`, `RunConsole.tsx`, `RunConsoleRoute.tsx`,
`ConversationPane.tsx`, `StepLog.tsx`, `dedupe-tool-steps.ts`, `AnalyticsPanel.tsx`, `analytics-derive.ts`,
`ReportTab.tsx`, `ApplicationPanel.tsx`, `ToolCallCard.tsx`). API: `apps/api/src/testing/engine.ts`,
`apps/api/src/grading/judge.ts` and `error-forensics.ts`, `apps/api/src/hub/subscription-adapter.ts` + one
additive migration, `packages/shared/src/token-usage.ts` and `run-filter.ts`. **Out of scope:** the 768 px
action reach and the one-encoding-per-column fix already scoped by RM-36
[`wp-2.1-responsive-actions.md`](/Roadmap/RM-36-ui-ux-audit-remediation/wp-2.1-responsive-actions.md) and
[`wp-2.2-consistency-density.md`](/Roadmap/RM-36-ui-ux-audit-remediation/wp-2.2-consistency-density.md) (P2-1
— this WP fixes the column set the fix lands in), the Context-tile popover nesting recorded as an RM-36
follow-up, the launcher (WP 2.7), the Testing dashboard KPI tiles (WP 2.2), column-preference persistence and
URL state (WP 3.4), the glossary words Cost / Forecast / Subscription / "Rating…" (WP 3.2 — applied here on
these two surfaces), and the app-wide empty-state rewrite (WP 3.3). **Continues**
[`/Roadmap/RM-26-testing/item.md`](/Roadmap/RM-26-testing/item.md),
[`/Roadmap/RM-27-testing-ia/item.md`](/Roadmap/RM-27-testing-ia/item.md) and RM-06 auto-rating.

## Target layout

| Zone | Component | Contents | Removed / merged / demoted |
|---|---|---|---|
| **/testing/runs** 1. Toolbar (one row) | `ViewToolbar` | Runs / Suites as a `SegmentedField` · search · Views · **+ Filter** · results "76 runs · 70.6M tokens · $90.64 · **5 failed** (6.6 %)" — every number a link applying its preset · right: Compare runs · **+ New run** (primary) · ⋯ (Type · Show forks · Columns · Group by · Review these… — disabled with a reason when no rubric exists) | the sub-tab bar, the totals strip, the 11-control row that wraps; the count badge reserves its width |
| 2. Table (header ≤ 140 px from the top at 1440×900) | `EntityTable` / `DataTable`, 36 px rows | Name (suite rows expandable; second line muted "2 tests × 1 env × 3 reps") · Status (`StatusBadge`, text variant for Completed) · Outcome (one `BaseVerdictChip` + score on one line: "Answered · 70 %"; "—" for sessions with no tests) · Cost (right; "Subscription" marker instead of "$0.00"; forecast glyph with tooltip) · Started · Duration (fixed width) · ⋯ (Open · Pin) | the Grade column's second encoding; red "0.0 % pass"; "$0.00 est."; the pin glyph on every row; the `max-w-[10rem]` on model and `12rem` on environment |
| **/testing/runs/:runId** 1. RunBar | `RunBar` | `StatusBadge` · meta "environment · provider · model · automated" (truncates last) · run search as an `IconButton` expanding in place · thumbs · note · Replay (disabled reason in tooltip) · Export · **Re-run with changes** (primary) · ⋯ | the "Locked" chip (→ tooltip "Read-only: a finished run can't change"); the separate search row |
| 2. Outcome band (new, 40 px, `bg-card`) | `BaseVerdictChip` ×n + `Text` | terminal: "Answered 1.00 · Valuable 0.80 · No error findings · rated by Claude CLI judge · Report →"; failed: "Failed · MCP tools/call timed out after 30 s · <tool> on <server> · step #36 →"; unrated: "Not rated yet — Re-rate"; live: "Rating…" | — |
| 3. Lenses | `TabPanel` | Chat · Steps · Turns · Graph · Trace · **Report · Analytics** | Analytics before Report |
| 4. Rail (terminal runs) | `KpiRail` → `MetricCard` | **Outcome** (score pair) · Cost $0.71 · Tokens in 693,910 "80.6 % from cache" · Tokens out 6,235 · Turns 14 · Tool calls 13 · Context last ("peak 3.2 % · now 3 %"); live runs keep Context first | the 4-line relationship footnote (→ ⓘ ≤ 20 words on the Tokens tile); "Est." prefix; "(provider-actual)" |
| 5. Steps | `StepLog` table filling the pane, sticky header | call + result merged or the call row derives status/duration from its result; toggle "Errors only (6)"; Columns button and Duration column inside the pane | the 352 px nested scroll box; "Running" rows in a terminal run; the one-option "Errors 1" facet |
| 6. Analytics | sections on one scroll with a sticky in-page nav | Overview · Tokens · Tools · Skills · Timeline · Errors; the Cached tile reads `cacheHitRate` with "read 80.6 % · written 8.1 %" beneath | the third tab level; the Context-growth chart (the rail owns it); `cachedPercent` |
| 7. Report | `ReportTab` | outcome header (same data as zone 2) · Answer validation · Insight surplus · Expectation grades (ROUGE in info tone) · Outcome judge (reasoning without the tag) · Error forensics seeded from failed steps · Re-rate | "No errors detected" on a failed run; `<rating>7</rating>`; red "ROUGE-1 7 %" |
| 8. Application panel | `StatePanel kind="empty"` | "No artifacts — Files this run creates or downloads aren't captured yet." | the engine/WP prose |
| 9. Loading | header skeleton + body skeleton | never a blank pane; the breadcrumb leaf shows a skeleton, not "Run" | the white pane and the flickering title |

Primary actions: **+ New run** (feed) and **Re-run with changes** (console), always in the visible row.

## Actions

1. **"+ Filter" menu is dead — P0.** Root cause (QA-01, EU-03): `RunFilterBar.tsx:439` (`onSelect` →
   `setOpenField(field)`) mounts the chip whose controlled `Popover` (`:419`) opens at once; the
   DropdownMenu's own close / `onInteractOutside` sequence then dismisses it, `setOpenField(null)` runs, and
   no chip renders — by mouse and by keyboard, for Status, Outcome, Model and Has error. WHERE:
   `/testing/runs` · `runs/RunFilterBar.tsx:388-447`. TARGET STATE: open the field editor after the menu has
   closed (`onCloseAutoFocus={e => e.preventDefault()}` plus a next-frame `setOpenField`, or render the editor
   inline in the menu); a Playwright test adds Status from the menu and sees a chip with an open editor;
   filter option labels equal the chip labels via `deriveRunStatusView` (`RunFilterBar.tsx:140-154`).
2. **One toolbar row; totals as linked results — P1.** WHAT: feed zone 1. WHERE:
   `RunsView.tsx:184-219,678-703` (toolbar composition), `runs/RunFilterBar.tsx`, `runs/RunSavedViews.tsx`.
   TARGET STATE: at 1440×900 the toolbar is one row at every filter state; "5 failed" applies `status=failed`
   (not "Has error: Yes"); the denominator is always the unfiltered count; "Review these…" is disabled with
   "No review rubrics yet" when none exist.
3. **Table columns, one outcome encoding, cost grammar — P1.** WHAT: feed zone 2; one `GradeChip` encoding
   (percent + "pass rate" / "mean score" spelled out) used by the feed, the Suites page and the suite-run
   console; `whitespace-nowrap` on outcome chips so the dock cannot wrap them; no 0-test interactive session
   is wrapped as a suite run (guard at creation) and such rows show "—" rather than "0.0 % pass". WHERE:
   `runs/runs-table-model.ts`, `runs/SuiteTableRows.tsx:310`, `runs/SessionColumnCells.tsx:28`,
   `runs/RunTableRow.tsx:215`, `GradeChip.tsx`, `grade-format.ts`, `components/SubscriptionCostMarker.tsx`;
   `apps/api/src/testing/` where interactive sessions get their suite-run wrapper; additive nullable
   `cost_basis` + `cost_priced` on `hub_sessions` written by both Hub executors
   (`hub/subscription-adapter.ts:630-656`) so WP 2.10's sessions table shares the grammar. TARGET STATE: one
   encoding per column across parent and child rows and across pages; a subscription run reads "Subscription",
   an unpriced one "— not priced", never "$0.00".
4. **"Show forks" means what it says — P2.** Root cause (QA-06): the pressed toggle sets `derived` to `true`,
   which the shared filter and the repository treat as *only* forks. WHERE: `/testing/runs` ·
   `RunsView.tsx:855-857`, `packages/shared/src/run-filter.ts:339-343`,
   `apps/api/src/testing/run-repository.ts:1647`. TARGET STATE: tri-state hide / include / only, or the label
   "Only forks".
5. **Outcome band, failure banner, "Not rated yet" — P1.** WHAT: console zone 2 and the Report header; the
   Chat lens error footer links to the Steps tab ("See the Steps tab →", not "the step log on the right");
   when no rating exists (`judgeProviderId` null / `ratingState` ≠ rated) the Report shows one "Not rated yet
   — Re-rate" state instead of "Unanswered" + "Not rated by a judge"; Error forensics is seeded from
   `run.status === "failed"` and failed `run_steps` independently of the judge so a failed run never reads "No
   errors detected". Follow-up (EU-32): distinguish "answered, then errored" from "failed before answering"
   and rate both. WHERE: `RunBar.tsx:356-361` (Locked chip), `ReportTab.tsx:213,714-719,1104-1107`,
   `ConversationPane.tsx:698-699`, `apps/api/src/grading/error-forensics.ts`. TARGET STATE: the outcome (or
   the failure reason with a step link, or "Not rated yet") is visible on every lens without scrolling.
6. **Rail outcome-first; one cache number; one tool-call count — P1.** WHAT: console zone 4; the Analytics
   "Cached" tile uses `cacheHitRate` (reads ÷ sent) from `packages/shared/src/token-usage.ts:43` and shows the
   write share beneath — root cause (ENG-14, QA-11): `analytics-derive.ts:173-174` computes `cachedPercent`
   from `cachedTokens / tokensIn`, merging cache reads and writes; one tool-call rule stating whether
   provider-side tool search counts (rail 13 vs Analytics 17); the Tools table measures result tokens or hides
   the column; `/api/runs/:id/feedback` fetched once per mount (17× today, `use-turn-feedback.ts`). WHERE:
   `KpiRail.tsx:199-301`, `AnalyticsPanel.tsx`, `analytics-derive.ts:173-174`. TARGET STATE: one cache
   percentage and one tool-call count on screen, sourced from one accounting object; a fixture test pins rail
   == Analytics.
7. **`tool_call` steps settle — P1.** Root cause (ENG-12): `apps/api/src/testing/engine.ts:693-703` persists
   every `tool_call` with `status: "running"` and never updates it; the web hides that by merging the MCP-sink
   step's terminal status in `dedupe-tool-steps.ts:100-113` (`mergeMcpOntoEngine`), but provider-executed
   tools (`tool_search_tool_regex` in deferred mode) never pass the MCP bridge, so steps #7/#9 leak "Running"
   into a Completed run and the call drawer reads "Running · —" while the error sits on the paired result row.
   WHERE: `engine.ts:693-703` (`tool-result` / `tool-error` cases), `dedupe-tool-steps.ts`,
   `StepLog.tsx:122,367-373,796`. TARGET STATE: on `tool-result`/`tool-error` the engine emits a terminal
   status for the step with the same `toolCallId` (provider-executed calls settle `ok` immediately); the
   drawer shows the result's error and duration; step numbering has no gap; an engine test asserts no
   `tool_call` remains `running` after a terminal run status.
8. **Steps table fills the pane; honest Errors toggle — P2.** WHERE: `StepLog.tsx:697` (the `max-h-[22rem]`
   scroll box), `:495-502` (one-option `FacetFilter` whose badge counts selected options, not errors).
   TARGET STATE: `TabPanelContent` owns the scroll; the toggle reads "Errors only (6)"; the Columns button and
   Duration column render inside the pane.
9. **Analytics as sections — P2.** WHERE: `AnalyticsPanel.tsx:143-151` (second-level `Tabs`). TARGET STATE:
   six sections on one scroll with a sticky in-page nav; no Context-growth chart.
10. **`<rating>` tag out of judge reasoning — P1.** Root cause (PS-03): the judge stores the raw completion as
   the rationale although `parseRating` already isolates the tag. WHERE: `/testing/runs/:runId?lens=report` ·
   `apps/api/src/grading/judge.ts:317` (`reasoning: gen.text.trim()`), `:168-174` (`parseRating`).
   TARGET STATE: persist `reasoning` with `/<rating>.*?<\/rating>/s` removed; `latestReasoning()` in
   `ReportTab.tsx:312` strips defensively for rows already stored; a test covers both.
11. **ROUGE tone — P2.** Root cause (PS-04): `scoreTone` applies its `< 0.6 → danger` bucket to `rouge1`, a
   lexical-overlap metric. WHERE: Report › Expectation grades · `grade-format.ts:110`. TARGET STATE: `rouge1`
   renders in info tone ("7 % overlap") unless the test declares a ROUGE threshold; hidden from the strip when
   an LLM judge graded the run, kept in the hover.
12. **Console empty and loading states — P2.** WHERE: `ApplicationPanel.tsx:128-129` (engine/WP prose),
   `suites/SuiteReportTab.tsx:208` ("(AR7)"), `RunConsoleRoute.tsx:296` (spinner only), the breadcrumb leaf.
   TARGET STATE: "No artifacts" and "Nothing to compare yet — a cross-run report needs at least two runs; this
   suite run has {n}"; a header + body skeleton replaces the blank pane and the breadcrumb's "Run".
13. **Console chrome: search keys, readable tool rows, header nits — P3.** WHAT: run search — Enter = next,
   Shift+Enter = previous, Escape blurs, a match keeps `lens=steps`, a match hidden by the Type filter says so
   with a clear link; Chat tool rows render "<skill> · SKILL.md" with the `skill://` URI in a tooltip and
   middle-truncated GUID arguments; the Analytics Tools "Server" column shows names (ids resolved at the API
   edge); Replay carries a disabled-reason tooltip; the single-item ⋯ menu folds into the header; thumbs get
   tooltips; the stuck tooltip after Escape is suppressed; the Columns popover stays open across toggles; the
   once-seen "Open keeps the list on screen" (EU-28) is reproduced and fixed if real. WHERE:
   `RunConsole.tsx:624-627`, `use-run-search.ts`, `ToolCallCard.tsx:127`, `tool-call-view.ts`,
   `AnalyticsPanel.tsx` Tools table, `RunBar.tsx`, `runs/RunColumnChooser.tsx`. TARGET STATE: no raw
   `skill://` or bare server id in the transcript; every disabled control explains itself.

## Acceptance

- [ ] `/testing/runs`: choosing Status, Outcome, Model and Has error from "+ Filter" (mouse and ↓ + Enter)
      yields a chip with an open editor and a URL change; a Playwright test covers it.
- [ ] At 1440×900 the table header is ≤ 140 px from the top with the Failures preset on; "5 failed" in the
      results line applies `status=failed`; every grade renders through one `GradeChip`; no row reads "0.0 %
      pass" or "$0.00"; no identity cell is truncated at 1440 with the dock closed.
- [ ] On a Completed run, the outcome band shows chips + scores + rater under the RunBar on every lens; on the
      failed run from the review the band states the timeout, the tool, the server and a working step link; on
      an unrated run it reads "Not rated yet — Re-rate" and Error forensics lists the failed steps.
- [ ] The rail on a terminal run reads Outcome · Cost · Tokens in · Tokens out · Turns · Tool calls · Context;
      exactly one cache percentage and one tool-call count appear across rail + Analytics; a fixture test pins
      the equality.
- [ ] Steps: no "Running" row in a terminal run; the table fills the pane; "Errors only (6)" matches the
      listed error rows; the call drawer shows the failure and duration.
- [ ] Report: no `<rating>` text in any judge card (including previously stored rows); ROUGE renders in info
      tone; Analytics renders as sections.
- [ ] Both routes read correctly in both themes.
- [ ] Gate green: `pnpm typecheck && pnpm test && pnpm build && pnpm lint`.

## Effort

**L** overall — 2, 3, 5, 6 and 7 are M (3 carries a migration; 7 touches the engine); 1, 4 and 8–13 are S.

## Sources

UX-26, UX-27, UX-28, UX-29 (console loading; the app-wide recipe is WP 3.3's) · EU-02, EU-03, EU-04, EU-05,
EU-06, EU-09, EU-27, EU-28 (unverified; action 13), EU-32 · QA-01, QA-06, QA-11, QA-12 (Analytics Tools
column), QA-13, QA-14, QA-15, QA-16 (popover), QA-17, QA-18 ("Review these…" part), QA-36 (feedback fetch) ·
ENG-12, ENG-14, ENG-17 · PS-03, PS-04, PS-05, PS-06, PS-14, PS-15 · UXC-02, UXC-03, UXC-13, UXC-21, UXC-32
(rail footnote), UXC-36 (feed identity columns) · walkthrough `/testing/runs` and `/testing/runs/:id` notes.
