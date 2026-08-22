---
type: "Work Package Spec"
title: "WP 2.9 — Compatibility, Environments and Setup: thresholds that can go green, a dated dataset, identity-first environment columns, credential health from runs, a readable watch-rule editor"
description: "Phase 2 of item.md. Ledger: STATUS.md. The compatibility grid gets reachable green cells, single-line 32 px rows and its dataset date; the environments table leads with the untruncated model and the servers it loads, derives credential health from real runs, and drops constant columns; the environment editor and the watch-rule editor render labels instead of wire values."
tags: ["roadmap", "RM-37"]
timestamp: "2026-08-22T07:10:00Z"
status: "final"
---
# WP 2.9 — Compatibility, Environments and Setup: thresholds that can go green, a dated dataset, identity-first environment columns, credential health from runs, a readable watch-rule editor

Phase 2 of [`item.md`](./item.md). Ledger: [`STATUS.md`](./STATUS.md). Follows the rules in
[`wp-2.1-shell-ia.md`](./wp-2.1-shell-ia.md) (rules 3, 4, 7 and 8 apply here).

## Scope

`/testing/compatibility` (`apps/web/src/features/compatibility/CompatibilityView.tsx`,
`CompatibilityCellSheet.tsx`, `ModelPicker.tsx`, `meta.ts`; `apps/api/src/compatibility/runner.ts`,
`service.ts`, `data/*.json`; `packages/shared/src/types.ts` `bandForScore`), `/testing/environments`
(`apps/web/src/features/testing/EnvironmentsView.tsx`, `EnvironmentEditor.tsx`, `credential-health.ts`;
`apps/api/src/providers/*` for the verified-at columns), `/testing/observability/rules`
(`apps/web/src/features/watch/RuleEditorDialog.tsx`, `WatchRulesView.tsx`) and the dataset-date line in
Settings › Pricing (`apps/web/src/features/settings/SettingsView.tsx:2175` `PricingSection`). **Out of
scope:** where these pages sit in the nav (WP 2.1 demotes Compatibility, Watch rules and Review rubrics), the
"Model limits" tab on server detail and the "Tests" rename (WP 2.3 / WP 0.5), the severity ramp and limit
vocabulary (WP 0.5 / WP 3.2), the dangling-server 404 row already scoped by RM-36
[`wp-2.2-consistency-density.md`](/Roadmap/RM-36-ui-ux-audit-remediation/wp-2.2-consistency-density.md)
(P2-4), the shared label maps as a system (WP 3.1 — if it has not landed, create `TOOL_LOADING_LABELS`,
`RUN_METRICS_MEASURE_LABELS`, `GROUP_BY_LABELS` and `WINDOW_LABELS` in `packages/shared` here and WP 3.1
adopts them), and the launcher's consumption of credential health (WP 2.7). **Continues**
[`/Roadmap/RM-26-testing/item.md`](/Roadmap/RM-26-testing/item.md) and
[`/Roadmap/RM-27-testing-ia/item.md`](/Roadmap/RM-27-testing-ia/item.md).

## Target layout

| Zone | Component | Contents | Removed / merged / demoted |
|---|---|---|---|
| **/testing/compatibility** 1. Toolbar (one row) | `ViewToolbar` with `TitledSelectTrigger`s (content-sized) | Scan · Models · Host client · Tool × Model / Server × Model segmented · Worst / Average (Server × Model only) · results "146 tools · 5 models · **75 successful scans** · dataset as of 2026-06-21" | truncated "…Aug 21,…", "5 models · Default…", "Host client:…" triggers; the unqualified "75 scans" |
| 2. Legend | chip row | Within limits (green, reachable) · Near limits · Below floor · Not checked | — |
| 3. Grid | `DataTable`, 32 px rows, sticky first column | tools sorted worst-first; one line per cell: the score with colour intensity; issue count + worst finding in the tooltip; row count in the header; the grid scrolls with the content region | 57 px two-line cells; the 570 px internal scroll box; all-amber contrast |
| 4. Cell drill | `Sheet` with `?tool=&model=` | the cell's findings worst-first, evidence chips | unaddressable sheet state |
| 5. Note | collapsed disclosure at the bottom | "Not everything is automated" with the six out-of-scope concerns | the always-open alert above the grid |
| **/testing/environments** 6. Toolbar | `ViewToolbar` | search (placeholder ≤ 18 ch) · results "9 environments" · **+ New environment** (primary); on the empty page the definition sentence inline ("An environment is the harness — a provider, model, allowed tools and guardrails a test runs against") | the ⓘ-only definition |
| 7. Table | `EntityTable`, 36 px rows | Name · **Model** (mono, untruncated) · Provider · Tool loading (Eager / Deferred) · Servers (name chips, "+n" beyond three) · Skills (chips) · Runs 30d · Last outcome (`BaseVerdictChip`) · Credential (`StatusBadge`: "Verified · 51 runs, last 3w" / "Not verified here" / "Failed") · ⋯ (Edit · Check connection · Advice · Delete) | "Loading" header with `eager`; Profiles count; Guardrails "none"; "Never tested"; nine inline trash icons; the `max-w` on Model |
| 8. Editor | `Dialog` tabs Model · Guardrails · Servers & skills | Model (Identity, Model & sampling, Token profiles with titles) · Guardrails (duration in s / min, temperature placeholder intact) · Servers & skills ("Metadata (L1) — always on"); footer "Total context 0 tokens"; Create disabled until valid with an inline reason | `unit="ms"`; "always-on (L1)"; Create enabled on an empty form |
| **/testing/observability/rules** 9. Editor | `Dialog` sentence builder | "When **{Error rate}** is **{at least}** **{5 %}** over the last **{24 hours}**, notify at **{Warning}**"; Group by and Grader as labelled selects; description "Fires when a measure crosses a threshold over a trailing window." | `p95DurationMs`, `providerKind`, `stopReasonCode`, `>=`, `critical`, `24h`, "Grader id … e.g. answer_validation", "measure op threshold" |

Primary actions: none on Compatibility (a read surface); **+ New environment**; **New rule**.

## Actions

1. **Compatibility bands that can go green — P1.** Root cause (UX-30, PS-17):
   `packages/shared/src/types.ts:3026` `bandForScore` returns `green` only for `score >= 90 && !opts.anyWarn`,
   so a single `warn` result on any check forces amber — a 97 with two advisory issues is amber, and on the
   reviewed data no cell is green. WHERE: `packages/shared/src/types.ts:3026-3036`,
   `apps/api/src/compatibility/runner.ts:506-529` (`scoreCell`, the comment at `:522-527`), the web guardrail
   test that locks the invariant. TARGET STATE: green = score ≥ 90 and no error/blocker-class failure; warns
   lower the score but do not gate the band; the dataset's `scoring.bands` comment and the guardrail test
   follow; on the owner's instance at least one cell of the best model reads "Within limits".
2. **Dataset date and refresh path on screen — P1.** WHAT: the `as_of` of
   `apps/api/src/compatibility/data/cross-cutting-limits.json:2` / `test-catalog.json:3` exposed by the
   compatibility API and printed in the results slot; the same for the pricing table in Settings › Pricing,
   with "Add a price" linked from the unpriced-model refusal
   (`apps/api/src/suites/suite-report-service.ts:949`, `isModelPriced`). WHERE:
   `CompatibilityView.tsx:325-327`, `SettingsView.tsx:2175`, the cost-cap error path. TARGET STATE: both
   datasets show their date; the unpriced error names where to add a price; the refresh procedure is one
   paragraph in the guide (WP 1.4 ships it).
3. **Single-line cells, worst-first, no internal scroll, drill state in the URL — P2.** WHERE:
   `CompatibilityView.tsx:304-316` (Worst / Average toggle, Host client trigger), `:411`
   (`[&>div]:max-h-[70vh]` scroll box), `:509` (cell), `:599` (note), `CompatibilityCellSheet.tsx`.
   TARGET STATE: 32 px single-line cells; rows sorted worst-first with a count in the header; the grid is not
   a nested scroll region; Worst / Average disabled outside Server × Model; `?tool=&model=` reopens the sheet
   on reload; the note is a collapsed disclosure below the grid.
4. **"75 successful scans" and content-sized triggers — P3.** WHERE: `CompatibilityView.tsx:79-80,325-327`,
   the three `TitledSelectTrigger`s (width rule from WP 2.1). TARGET STATE: the count says what it counts; no
   trigger label truncates at 1440 px.
5. **Environments columns identity-first — P1.** WHAT: zone 7; the definition sentence inline on the empty
   page. WHERE: `EnvironmentsView.tsx:315-332` (Loading / Profiles columns), `:363` (Advice), `:399-400`
   (search placeholder); the list payload gains `serverNames`, `skillNames`, `runs30d`, `lastRun` (additive).
   TARGET STATE: Model is never truncated at 1440 px; Servers and Skills render as name chips; Runs 30d and
   Last outcome are present; the header reads "Tool loading" with "Eager" / "Deferred"; every row action lives
   in ⋯ with tooltip == `aria-label` (the Advice lightbulb included).
6. **Credential health from real runs — P1.** Root cause (UXC-19, ENG-15): `credential-health.ts:11-14` keeps
   the state in a per-browser `localStorage` record written only by an explicit check, so a credential with 51
   completed runs reads "Never tested" on every new browser and the launcher warns on the most-used
   environment. WHERE: `credential-health.ts`, `EnvironmentsView.tsx:280`, `apps/api/src/providers/*`
   (additive `last_verified_at`, `last_error` on the credential, written by `GET /api/providers/:id/models`
   and by every successful run start; `lastSuccessfulRunAt` per credential derived from runs and returned with
   the environments list). TARGET STATE: the Credential cell reads "Verified · 51 runs, last 3w", "Not
   verified here — Run a check" or "Failed · <reason>"; the `localStorage` map is deleted; WP 2.7's launcher
   warning consumes the same field.
7. **`?environment=<id>` selection and the Advice panel in the URL — P2.** WHERE: `EnvironmentsView.tsx` (row
   selection, Advice panel); advisor evidence links "Environment: <name>" target
   `/testing/environments?environment=<id>`. TARGET STATE: following an advisor evidence link lands on the
   highlighted row with the panel open; reload keeps it.
8. **Environment editor form nits — P2.** WHERE: `EnvironmentEditor.tsx:748-756` (`unit="ms"`,
   `step={60000}`), `:879,899` ("always-on (L1)"), the temperature stepper placeholder ("Provider (" clipped),
   the Create button validation. TARGET STATE: duration in seconds / minutes; "Metadata (L1) — always on";
   placeholders fit their fields; Create is disabled until the required fields are valid with the reason
   inline.
9. **Watch-rule editor speaks labels — P1.** Root cause (UXC-05, QA-31): five selects render wire values as
   option labels (`RuleEditorDialog.tsx:438,459,480,495,623`), the section description is a formula (`:428`),
   and "Grader id" expects a raw id (`:687-691`); the chart composer's `humanizeMeasure` is not shared. WHERE:
   `RuleEditorDialog.tsx`, `packages/shared` label maps. TARGET STATE: the sentence builder in zone 9; options
   read "Error rate", "p95 duration", "Cost (USD)", "Cache hit rate"; ops "is at least" / "is at most";
   severities "Info / Warning / Critical"; windows "Last hour / 6 hours / 24 hours / 7 days"; a Grader select;
   the same maps feed the chart composer.

## Acceptance

- [ ] `/testing/compatibility` on the reviewed scan: at least one cell reads "Within limits"; a cell with
      score ≥ 90 and only warn-class issues is green; cells are one line at 32 px; the toolbar is one row with
      no truncated trigger; the results line shows "successful scans" and the dataset date; `?tool=&model=`
      restores the drill sheet.
- [ ] `/testing/environments` at 1440×900: the Model column shows full ids; Servers and Skills are chips; no
      column named Loading, Profiles or Guardrails; no inline trash icon; the Credential cell of an
      environment with completed runs reads "Verified · n runs, last …" in a fresh browser profile.
- [ ] The run launcher shows no credential warning for that environment (WP 2.7 acceptance, same field).
- [ ] The environment editor: Max run duration is not in ms; the temperature placeholder is not clipped;
      Create is disabled with a visible reason on an empty form.
- [ ] The watch-rule editor renders none of `p95DurationMs`, `providerKind`, `stopReasonCode`, `>=`, `<=`,
      `critical` or `24h` as a label; a string test pins it.
- [ ] Settings › Pricing shows the pricing table's date; the unpriced-model error offers "Add a price".
- [ ] Both themes read correctly on the three routes.
- [ ] Gate green: `pnpm typecheck && pnpm test && pnpm build && pnpm lint`.

## Effort

**M** overall — 1 is S (shared function + test), 2–4 S, 5 M (additive list fields), 6 M (credential columns +
derivation), 7–8 S, 9 S–M.

## Sources

UX-30, UX-31, UX-36 (width rule owned by WP 2.1) · EU-14, EU-33 (derivation; the launcher condition is WP
2.7's) · PO-19 (dataset date; nav part in WP 2.1), PO-31 · PS-17 · UXC-05, UXC-07, UXC-19, UXC-40 (editor L1
label) · QA-23 (environments lightbulb), QA-25 (compatibility count), QA-31, QA-32 (environment editor),
QA-40, QA-42 · ENG-15 · walkthrough `/testing/compatibility`, Environments and Setup notes.
