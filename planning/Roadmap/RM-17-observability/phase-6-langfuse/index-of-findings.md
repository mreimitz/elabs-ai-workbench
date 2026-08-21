---
type: "Work Package Spec"
title: "Phase 6 — index of verification findings, batch order and drop recommendations"
description: "Per-item verdict against the shipped surface, residual size, migration need, dependencies, a file-overlap-reasoned batch order for /next-wp, and the items recommended for dropping."
tags: ["roadmap", "RM-17"]
timestamp: "2026-08-21T16:05:00Z"
status: "draft"
---
# Phase 6 — index of verification findings

Thirteen amendment items (AM-OB1–8, 10–14; **AM-OB9 was promoted to WP 3.5** on lock and is not here),
each now carrying a spec in this folder. Every spec opens with a verification finding cited to real
files and symbols on `main`. This page is the summary, the batch plan, and the drop recommendations.

**Read this first, then the item's own spec.** The specs contain the evidence; this page contains the
decisions the evidence points to.

## The headline

**None of the thirteen is wholly satisfied — there is no item I can honestly recommend dropping as
"already built".** Four are partially built and shrink to a real residual; nine are not built.

But three things are true that the amendment did not know, and they change what is worth doing:

1. **AM-OB2 needs no migration.** The Phase 6 ledger header lists it as one of two items expected to
   need one. `run_feedback.key` is a free-form `TEXT` column with an open key space and
   `run_feedback.comment` is an unbounded nullable `TEXT` column — a corrected answer already persists
   and reads back today with **zero code change**. Only AM-OB6 definitely needs a migration; AM-OB10
   needs one only for its pause state, and that part is separable.
2. **AM-OB12's premise does not match the shipped data model.** It asks for "boolean grade/rating
   fields as share-true metrics". There are none: the auto-rating verdicts are three-valued enums, the
   only boolean on the entire rating surface is `truncated?` (a transcript caveat), and **no
   hallucination flag exists anywhere in the app** — the item's own worked example cannot be built.
   The spec reframes it as verdict-share via AM-OB4's ratio.
3. **AM-OB10 is not just missing a feature — it documents a live defect.** `engine.ts:420` collapses an
   empty window to `breached: false`, so the state machine's not-breached branch fires
   `window_recover` and re-arms. **An empty window is currently treated as recovery**: a rule firing on
   "error rate ≥ 30%" is marked recovered the moment traffic stops, which is exactly when an operator
   most needs to hear from it. That is the most valuable single fix in the phase.

Two more findings worth surfacing before any batch is planned:

- **AM-OB8 carries an upstream gap the amendment did not flag.** The upstream `Gantt` has **no
  value/quantity axis** — every scale prop is time, and the only escape hatch (`renderBar`) applies to
  leaf bars and cannot change bar *length*. "Scale bars by tokens/cost" cannot be built honestly
  without either an upstream change or a different component. The amendment flagged only AM-OB7 for
  upstream gaps.
- **AM-OB11's ledger note points at the wrong store.** It says to reuse RM-08's `api_tokens`.
  `api_tokens` stores a **SHA-256 digest** — correct for authenticating an inbound caller, useless for
  presenting an outbound credential, because a PAT cannot be read back out of a hash. The right
  existing pattern is the shipped `github-account` device-flow service, which already holds an
  encrypted GitHub token in `app_settings` and needed no migration. The note's *intent* — do not invent
  a second token store — is right; its *target* is not.

## The table

| Item | Verdict | Residual | Migration | Depends on | Batch |
| --- | --- | --- | --- | --- | --- |
| **AM-OB1** — URL filter/view state | PARTIALLY BUILT | M | No | shipped 1.4/2.3/2.4 | 2 |
| **AM-OB2** — `corrected_output` feedback | PARTIALLY BUILT | M | **No** (corrects the ledger) | absorbs 2 recorded follow-ups | 5 |
| **AM-OB3** — chart state addressable | PARTIALLY BUILT | S | No | shipped 2.1/2.2 | 2 |
| **AM-OB4** — ratio measure | NOT BUILT | L | No | shipped 1.1/1.2/1.5/2.7 | **1** |
| **AM-OB5** — pulse strip | NOT BUILT | M | No | shipped 1.1/1.2/2.3 | 3 |
| **AM-OB6** — pricing usage types + tiers | NOT BUILT | **L** | **YES — the one** | RM-33 (D-CT2/5/6) | **2** |
| **AM-OB7** — composer type set | NOT BUILT | M | No | **AM-OB4** + an owner decision | 4 |
| **AM-OB8** — Gantt scale-by-metric | NOT BUILT | M | No | **an upstream gap**; segments need AM-OB6 | 1 |
| **AM-OB10** — thresholds + NO_DATA + pause | NOT BUILT | L | Only for pause (separable) | shipped 4.1/4.2/4.3 | 6 |
| **AM-OB11** — `workflow_dispatch` action | NOT BUILT | M | No | shipped `github-account` (**not** `api_tokens`) | 7 |
| **AM-OB12** — share-true rating metrics | NOT BUILT (premise fails) | M | No (unless an index is needed) | **AM-OB4** | 3 |
| **AM-OB13** — manual send to webhook | NOT BUILT | S | No | shipped 4.3 | 3 |
| **AM-OB14** — issue distribution bars | PARTIALLY BUILT | S | No | shipped 5.1/5.3 | 1 |

Chart-touching items, each of which **must** ship a faithful-stub test per the
`apps/web/src/features/dashboard/testing/time-axis-charts.test.tsx` pattern: **AM-OB5, AM-OB7, AM-OB8,
AM-OB14**. The reason is recorded in the ledger for 2026-07-17: **32 web test files mock
`@elabs-ai/components-charts` as inert no-ops**, so a chart wired with wrong props passes
typecheck, test, build and lint and only breaks in a real browser. Each of those four specs names the
pattern, the sibling precedents, and the instruction to **break a prop deliberately and watch the test
go red before ticking**.

## What I recommend dropping

Nothing is already built, so nothing drops on those grounds. These four drop on **value**, and each is
the owner's call, not mine:

1. **AM-OB3 (whole item) — the cheapest drop in the phase.** The operator-visible promise, "send
   someone a link to what I am looking at", is **already met**: `?tab=` (`DashboardView.tsx:104-123`),
   the page-level `?range=` with both preset and pinned semantics plus legacy-key compatibility
   (`dashboard-range.ts:57,177,193,242`), six `t*` facet params (`dashboard-url-state.ts:83-90`),
   `?issue=` (`IssuesFleetTab.tsx:34-36`), and a drill-down that serializes the **exact clicked
   bucket** into a self-describing runs-feed URL (`drillDownFilter`/`drillDownHref`/`bucketRangeIso`,
   `dashboard-url-state.ts:235,250,258`). What is left is a jump-to-panel anchor and a bucket override
   — and the bucket override needs a **control that does not exist**, so it is a new affordance rather
   than serialization of existing state.
2. **AM-OB14 (whole item) — the second cheapest.** The issue list **already renders per-row bars**:
   `IssueTriageTable.tsx:99-109` adds a Trend column rendering `IssueSparkline`
   (`IssueSparkline.tsx:14-30`, `variant="bar"`), and the detail sheet already has an honest,
   bucket-aware, drill-through occurrence chart (`IssueOccurrencesPanel.tsx:138-166`). The genuine
   defect is that `sparklineValues()` (`issue-lib.ts:141-143`) discards the `day` keys, so gaps vanish
   and rows are not comparable. Real, but it matters only when scanning many issues at once.
3. **AM-OB6 part (d) — provider-ingested costs take precedence. Drop this sub-part outright.** There is
   **nothing ingested to give precedence to**. Every dollar in the app is inferred from tokens × price,
   including the subscription path, which shadow-prices deliberately
   (`claude-subscription-executor.ts:835`, documented `:35-38`, `:795-798`). `providerCost` has **zero
   hits** repo-wide. The only provider-reported charge that exists anywhere is `total_cost_usd` in
   `apps/api/scripts/assistant-smoke.ts:93`, `console.log`ged by a dev script and never persisted.
   `CostBasis` is `"api_exact" | "subscription_reference"`, and `"api_exact"` means "metered by a paid
   API", **not** "the provider told us the dollars" (`types.ts:1431-1443`). Building the precedence rule
   now means building the losing half of a comparison with no winning half, and would need a third
   `CostBasis` member in service of no data.
4. **AM-OB12 — drop *as written*, or take the reframe.** "Boolean grade/rating fields" do not exist:
   `run_grades` has no boolean column (`schema.ts:492-510`); `AnswerValidationEvidence.verdict` is
   `answered|partial|unanswered` (`types.ts:2578-2583`); `InsightSurplusEvidence.verdict` is
   `none|valuable|noise` (`:2590-2597`); the single boolean on the surface is `ErrorFinding.truncated?`
   (`:2570`), a transcript caveat; `AssertionResult` is an enum `status`, not a `passed` boolean
   (`:893-899`); and `grep -r hallucin` finds only mission-planner id defences. Flattening a
   three-valued verdict into a boolean would destroy the distinction the grader exists to make —
   `partial` is not `false`. The spec's reframe (make the verdicts filterable, let AM-OB4's ratio
   compute the share) delivers the intended value without inventing a boolean; if the owner does not
   want the reframe, drop the item.

## Batch order for `/next-wp`

The binding constraint is the ledger's own rule: **never batch two work packages whose Files sections
overlap**, with `packages/shared`, `apps/api/src/db/{database,schema}.ts`, `testing/run-service.ts` and
the run-console cluster named as the known contested surfaces — plus **exactly one migration-bearing
WP in flight at a time**.

That constraint dominates this phase. **Seven of the thirteen touch `packages/shared`**
(AM-OB2, 4, 6, 7, 9→6.9/OB10, 6.10/OB11, 6.11/OB12), and only six do not (AM-OB1, 3, 5, 8, 13, 14).
So the packing is one shared-toucher per batch plus whatever non-shared items are file-disjoint from
it.

### Batch 1 — no migration, no shared conflict

| WP | Owns | Why it is safe here |
| --- | --- | --- |
| **6.4 (AM-OB4)** | `packages/shared/{constants,types,schemas}`, `observability/metrics.ts`, `observability/routes.ts`, `watch/engine.ts`, `ChartComposerDialog.tsx`, `watch/rule-form.ts` | The only shared-toucher in the batch. **Must go first** — 6.7 and 6.11 both depend on it. |
| **6.8 (AM-OB8)** | `RunGantt.tsx`, `AnalyticsPanel.tsx`, `analytics-derive.ts` | **File-disjoint from every other item in the phase.** |
| **6.13 (AM-OB14)** | `features/issues-fleet/*` | **File-disjoint from every other item in the phase.** |

Overlap reasoning: 6.4 is api + shared + two dialog files; 6.8 is three files under
`features/testing/` that no other item names; 6.13 is confined to `features/issues-fleet/`. No pair
shares a file. 6.8's first action is an **upstream question**, so it may return early with a decision
rather than a diff — that is a correct outcome, not a failure.

### Batch 2 — the migration batch

| WP | Owns | Why it is safe here |
| --- | --- | --- |
| **6.6 (AM-OB6)** ⚠ **MIGRATION** | `db/{database,schema}.ts`, `providers/*`, `testing/accounting.ts`, `watch/scheduler.ts`, `watch/notifications.ts`, `packages/shared/*`, `SettingsView.tsx` | The **one** migration-bearing WP. Claim the next free `user_version` (head read as **v59**, so **v60** — re-verify against sibling ledgers at claim time) and record it in the decision log **before** writing the migration. |
| **6.1 (AM-OB1)** | `features/testing/RunsView.tsx`, `features/testing/runs/{run-filter-url,RunSavedViews,run-columns}` | Web-only, touches no shared and no API. Disjoint from 6.6 and 6.3. |
| **6.3 (AM-OB3)** | `features/dashboard/{DashboardView,TestingTab}`, `features/dashboard/testing/{dashboard-url-state,panel-shell,use-testing-dashboard-data,CustomChartPanel}` | Web-only, no shared. Disjoint from 6.1 (different feature folder) and from 6.6. |

Overlap reasoning: 6.6 touches `SettingsView.tsx` — no other item in this batch touches
`features/settings/`. 6.1 and 6.3 are in different feature folders with no shared file. The one thing
to watch is that **6.6 will move every `LATEST_SCHEMA_VERSION` literal in existing tests** (the ledger
records six such bumps for a single migration), so its worktree merges last in this batch.

### Batch 3 — after AM-OB4 lands

| WP | Owns | Why it is safe here |
| --- | --- | --- |
| **6.11 (AM-OB12)** | `packages/shared/{types,schemas,run-filter}`, `observability/metrics.ts`, `testing/run-repository.ts`, `runs/RunFilterBar.tsx` | The batch's only shared-toucher. **Depends on 6.4** (batch 1). Shares `metrics.ts` with 6.4, which is why it cannot be batched with it. |
| **6.5 (AM-OB5)** | `features/testing/runs/RunsPulseStrip*`, `pulse-scale*`, `RunsView.tsx` | Contends with **6.1** on `RunsView.tsx` — 6.1 shipped in batch 2, so the conflict is resolved by sequence. Contends with 6.11 only if the `minute`-bucket option (a) is taken; **take option (b)** and it stays web-only. |
| **6.12 (AM-OB13)** | `watch/manual-send.ts`, `watch/{actions,notifications}.ts`, `config/env.ts`, `RunBar.tsx`, `lib/api.ts` | Contends with **6.2** on `RunBar.tsx` — 6.2 is batch 5, so sequence resolves it. Touches `watch/actions.ts`, which **6.10 (AM-OB11)** also touches — 6.10 is batch 7. |

Overlap reasoning: 6.11 is shared + api-metrics + one filter-bar file; 6.5 is `RunsView` + two new
files under `runs/`; 6.12 is the watch API + `RunBar` + `env.ts`. `RunFilterBar.tsx` (6.11) and
`RunsView.tsx` (6.5) are different files in the same folder — acceptable, but the batch reviewer should
confirm 6.5 does not need to edit the filter bar.

### Batches 4–7 — serial, because `packages/shared` cannot be shared

Every remaining item touches `packages/shared`, and two of them additionally collide on the watch
rule-editor files. Run them one at a time:

- **Batch 4 — 6.7 (AM-OB7).** Depends on 6.4. Shares `ChartComposerDialog.tsx` with 6.4 and
  `packages/shared` with everything. Its first action is the **owner question about the histogram and
  pivot upstream gaps**; the radar half can ship regardless.
- **Batch 5 — 6.2 (AM-OB2).** Shares `packages/shared` with everything, `RunBar.tsx` with 6.12
  (batch 3) and `testing/routes.ts` with nothing else in the phase. Absorbs two of the ledger's own
  recorded follow-ups (the promote-to-test endpoint, the report `humanFeedback` block), so it is worth
  more than its item line suggests.
- **Batch 6 — 6.9 (AM-OB10).** Shares `rule-form.ts` + `RuleEditorDialog.tsx` with **both** 6.4
  (batch 1) and 6.10 (batch 7), and `packages/shared` with everything. ⚠ **If the PAUSED part is kept
  it is a second migration** — it must not overlap batch 2, and this position guarantees that. Consider
  splitting: parts 1/2/4 (dual thresholds, the NO_DATA fix, on-terminal renotification) need **no**
  migration, and the NO_DATA fix is the most valuable single change in Phase 6 — it should not wait
  behind a pause button.
- **Batch 7 — 6.10 (AM-OB11).** Shares `rule-form.ts` + `RuleEditorDialog.tsx` with 6.9 and
  `watch/actions.ts` with 6.12. Last, so both are already settled.

### If the owner wants the value earliest

Batch 1 and batch 2 as written deliver the ratio measure, the pricing scope-up, both URL-state items
and the disjoint chart work. **If instead the goal is "fix what is wrong first", pull 6.9's parts 1/2/4
forward into batch 1 in place of 6.4** — the empty-window-as-recovery defect is a correctness bug in
alerting, and 6.4 is an enhancement. 6.9 and 6.4 both touch `rule-form.ts`/`RuleEditorDialog.tsx` and
`packages/shared`, so they cannot both be in batch 1; that is a straight choice between fixing
something broken and adding something new.

## What I could not determine from reading the code

Stated plainly rather than guessed:

- **Whether `watch_rule_events.action` is CHECK-constrained** (`apps/api/src/db/schema.ts:847-856`).
  AM-OB10's NO_DATA marker is a migration if it is, and free if it is not. Verify at pickup.
- **Whether the `github-account` service's requested `repo` scope suffices for a
  `workflow_dispatch` call** (`apps/api/src/github-account/service.ts:15`). If it does not, AM-OB11
  needs either a scope widening (which re-prompts the owner to re-authorise) or a per-rule PAT.
- **The query cost of filtering on a rating verdict**, which lives inside `run_grades.evidence_json`
  and would need a JSON extraction in a join. AM-OB12 becomes migration-bearing if it needs an index.
  Measure against the 500 ms budget the ledger records for WP 1.2 rather than assuming either way.
- **Whether the owner will accept the histogram and pivot upstream requests** (AM-OB7) or the `Gantt`
  value-scale request (AM-OB8). Both are outside this repository and neither can be a blocking
  dependency of a tick.
- **Whether a `minute` metrics bucket is wanted** (AM-OB5). `METRICS_BUCKETS` is
  `["hour","day","week"]`; adding `minute` widens a vocabulary shared by the chart composer and the
  watch-rule editor to serve one new surface. The spec recommends against it but it is a judgement
  call about the bench's own run volumes, which I have not measured.
- **Nothing in these specs has been run.** No code was written or executed for this scoping work; every
  claim is a reading of source at the cited line, not an observation of behaviour.
