---
type: "Work Package Spec"
title: "WP 3.1 — Copy scrub and shared label maps"
description: "Phase 3 of item.md. Ledger: STATUS.md. Removes the seven planning identifiers, the roadmap phrases and the engine versions from user-facing copy, guards them with a source-scanning test, and gives every wire enum that reaches the screen one label map in packages/shared (token profiles, tool loading, transport, scan status, metric measures and dimensions, watch windows/ops/severities, run statuses for filters, step types, finish reasons)."
tags: ["roadmap", "RM-37"]
timestamp: "2026-08-22T07:10:00Z"
status: "final"
---
# WP 3.1 — Copy scrub and shared label maps

Phase 3 of [`item.md`](./item.md). Ledger: [`STATUS.md`](./STATUS.md).

**Depends on:** nothing. **Decides no vocabulary** — which word wins is [`wp-3.2-glossary-vocabulary.md`](./wp-3.2-glossary-vocabulary.md); this WP only makes sure a raw wire value or a planning id can never be the word. Paths are relative to the repo root (`…/` = `apps/web/src/features/`); line numbers are from the 2026-08-21 review copy.

## Scope

Strings, label maps and the tests that keep them clean. Wire field names and enum members stay frozen; only what is rendered changes. Every label map lives in `packages/shared/src/labels.ts` (new, one exported `*_LABELS` record per enum) and is consumed by selects, chips, filters, tooltips and reports alike. Out of scope: relayouts (Phase 2), error/empty-state recipes (wp-3.3), number definitions (wp-3.4), the "scenario" survivors in the dock and API (wp-2.10), the Compare-runs "Soon" badge (wp-2.7) and the "Local / dev mode" footer (wp-0.2).

## Actions

### 1. [P0] Replace the seven planning-id strings

**WHAT:** rewrite each string so it explains the behaviour without the id. **WHERE / TARGET STATE:**

| File:line | Current (abridged) | Replacement |
|---|---|---|
| `…/hub/projects/ProjectEditor.tsx:445` | "This project's own memory — precedence over global profile memory, shadowed only by a crew/agent scope (D-HUX11)." | "Notes saved for this project. They apply to every session in it and take precedence over your profile memory; an agent or crew memory can override them." |
| `…/testing/suites/SuiteReportTab.tsx:208` | "A cross-run rating report is generated only for suite runs with at least 2 member runs (AR7). This run has too few to report on." | "A cross-run report needs at least two runs. This suite run has {memberCount}, so there is nothing to compare yet." |
| `…/testing/ApplicationPanel.tsx:128–129` | "Artifacts — pending engine capture" / "…needs run-engine + persistence + shared-contract support that doesn't exist yet. This lands when artifact capture is wired (coordinate with WP 1.6 / 0.4); until then no artifacts are fabricated." | Title "No artifacts", description "Files this run creates or downloads aren't captured yet." — or unmount the Artifacts section until capture exists. |
| `…/issues-fleet/IssueTriageTable.tsx:76` | "AI-refined title/summary (WP5.2)" | "Title and summary refined by AI" |
| `…/testing/runs/SessionDurationStats.tsx:107–108` | "…its wall-clock total was used instead (D-US3 fallback)." | "At least one run in this environment has no recorded active duration; its total wall-clock time is used instead." |
| `…/dashboard/testing/DurationPanel.tsx:46–47` | same sentence with "(D-US3 fallback)" | "At least one run in this window has no recorded active duration; its total wall-clock time is used instead." |
| `…/testing/AnalyticsPanel.tsx:700–703` | "…Only the used set is shown here — follow-up (findings/09 §3 E2)." | "Unused-tool detection needs a snapshot of the tools allowed at run time, which isn't captured yet. Only the tools that were used are shown." |

### 2. [P0] Guardrail test: no planning id, roadmap phrase or engine version in copy

**WHAT:** a source-scanning test in the existing guardrail style. **WHERE:** `apps/web/src/guardrails/copy-internal-ids.guardrail.test.ts`, same technique as `apps/web/src/guardrails/series-ramp.guardrail.test.ts` (walk every non-test `.ts`/`.tsx` under `apps/web/src` and `packages/shared/src`, strip `//`, `/* */` and `{/* */}` comments, scan the remaining string literals and JSX text). **TARGET STATE:** the test fails on `/\bD-[A-Z]{1,4}\d+\b|\bWP ?\d|\bAR\d{1,2}\b|\bRM-\d\d|\bRS-\d\d|§|findings\/\d\d/`, on the roadmap phrases `coming soon`, `will land here`, `isn't wired up`, `pending engine capture` and a bare `Soon` chip label, and on `/\b(analyzer|engine|Advisor) v\d/`. It carries an exemption list with a stated reason per entry — empty at landing — and a fixture case that proves each of the seven original strings would fail.

### 3. [P2] Roadmap phrases and engine versions out of copy

**WHERE:** `…/hub/workforce/WorkforceView.tsx:212, 221, 230` — "…isn't wired up yet" fallback descriptions; `…/advisor/AdvisorPanel.tsx:96` "Advisor v1 · generated …"; `…/security/SecurityPanel.tsx:276, 328` "Security analyzer v3 · …" and "All 11 security rules ran under analyzer v3 and reported 0 findings."; `…/security/SecurityDiffPanel.tsx:211`; `…/skills/quality/QualityScoreCard.tsx:33` "out of 100 · engine v1". **TARGET STATE:** the three WorkforceView fallbacks are deleted (each tab always receives its content); the visible meta line reads "Generated {time} · {n} rules" / "out of 100"; the analyzer or engine version moves into an "About this report" tooltip. The Compare-runs "Soon" badge (`…/testing/compare/CompareBar.tsx:461–464`, `…/testing/compare/MetricsMode.tsx:19–23`) is removed by wp-2.7; action 2 keeps it from returning.

### 4. [P1] Token-profile labels: one map, seven surfaces

**WHAT:** promote `TOKEN_PROFILE_META` (`…/testing/environment-model-caps.ts:56`) to `packages/shared/src/labels.ts` as `TOKEN_PROFILE_LABELS: Record<TokenProfileId, { title: string; help: string }>`, keyed by the four members of `TOKEN_PROFILES` (`packages/shared/src/constants.ts:16–22`); the environment editor re-exports it. **WHERE:** `…/settings/SettingsView.tsx:896–898` (Default token profile options render `{profile}`), `…/scans/ScansView.tsx:546` (scan meta), `…/compare/CompareView.tsx:606` ("Scan A used generic_o200k…"), `…/skills/SkillOverview.tsx:310` (Total card description), `…/reports/ServerReportView.tsx:296`, `…/testing/PacketInspector.tsx:356`, `…/testing/collections/CollectionTests.tsx:302–304` (Added profiles badges). **TARGET STATE:** titles "GPT-4o tokenizer (o200k)", "GPT-4 tokenizer (cl100k)", "Estimate (tokenizer-agnostic)", "Rough (bytes ÷ 4)" on all seven surfaces; the raw id only as a tooltip or monospace secondary text, never alone.

### 5. [P1] Tool-loading, transport and scan-status labels

- **WHERE:** `…/testing/EnvironmentsView.tsx:316` header "Loading"; `:320` badge renders `{row.toolLoadingMode}` (`eager` / `deferred`); `:330` header "Profiles". **TARGET STATE:** header "Tool loading"; values from `TOOL_LOADING_LABELS` ("Eager" / "Deferred" — the labels `…/testing/EnvironmentEditor.tsx:662–665` already hard-codes, moved to shared and imported there too); header "Token profiles" with the profile titles on hover.
- **WHERE:** `…/servers/ServersView.tsx:508` (header chip shows `streamable_http`), `:708` (details card), `…/servers/ServersOverview.tsx:396` (card says `http`), `…/reports/ServerReportView.tsx:283`. **TARGET STATE:** `TRANSPORT_LABELS = { stdio: "Local (stdio)", streamable_http: "HTTP" }` keyed by `TRANSPORT_TYPES` (`packages/shared/src/constants.ts:3`) on all four.
- **WHERE:** `…/servers/ServersView.tsx:503` tooltip interpolates the raw scan status ("Last scan · success — reflects…") beside a chip that says "Completed". **TARGET STATE:** the tooltip uses `deriveStatusView(latestScan.status).label`.

### 6. [P1] Metric measures, dimensions, windows, comparisons, severities, buckets

**WHAT:** one map per enum in `packages/shared/src/labels.ts`: `RUN_METRICS_MEASURE_LABELS` (count "Run count", errorRate "Error rate", guardrailRate "Guardrail-stop rate", p50DurationMs "p50 duration", p95DurationMs "p95 duration", tokensIn "Tokens in", tokensOut "Tokens out", costUsd "Cost (USD)", meanScore "Mean score", feedbackRate "Feedback rate", cacheReadTokens "Cache-read tokens", cacheWriteTokens "Cache-write tokens", cacheHitRate "Cache hit rate" — the members of `constants.ts:423–442`), `RUN_METRICS_GROUP_BY_LABELS` (providerKind "Provider type", stopReasonCode "Stop reason", the rest capitalised; `constants.ts:407–417`), `WATCH_WINDOW_LABELS` (1h "Last hour", 6h "Last 6 hours", 24h "Last 24 hours", 7d "Last 7 days"), `WATCH_OP_LABELS` (">=" "is at least", "<=" "is at most"), `WATCH_SEVERITY_LABELS` (Info / Warning / Critical), `METRICS_BUCKET_LABELS` (Hourly / Daily / Weekly). The chart composer's private `humanizeMeasure` is deleted in favour of the shared map. **WHERE:** `…/watch/RuleEditorDialog.tsx:438, 459, 480, 495, 623` (each `<SelectItem>` renders the raw member), `:428` section description "measure op threshold, over a trailing window.", `:687–691` free-text "Grader id" with placeholder `answer_validation…`; `…/dashboard/testing/ChartComposerDialog.tsx:332, 353`; `…/dashboard/testing/GuardrailStopsPanel.tsx:64` subtitle "Stacked stop count per stopReasonCode". **TARGET STATE:** every option shows its label; the description reads "Fires when a measure crosses a threshold over a trailing window."; the grader field is a select over `GRADER_LABELS`; the panel subtitle reads "Stops by stop reason".

### 7. [P1] Run-status filter options from the status table; step-type labels

**WHERE:** `…/testing/runs/RunFilterBar.tsx:140–154` builds the Status / Outcome / Stop reason / Phase options with `humanizeToken` ("Error", "Aborted", "Stopped Guardrail", "Context Overflow", "Assertions Failed") while the chips in the same table come from `apps/web/src/lib/status.ts:251–269` ("Failed", "Stopped by you", "Stopped — turn limit", "Context overflow"); `…/testing/StepLog.tsx:82–90` `STEP_TYPE_META` labels the Type filter `llm.req`, `llm.resp`, `tool.call`, `tool.result`, `context.event`, `user.msg`. **TARGET STATE:** option labels are produced by `deriveRunStatusView` / `deriveStatusView` (or a `RUN_STATUS_LABELS` map in shared that `lib/status.ts` also reads), so filter text equals chip text and a user filtering by "Failed" finds "Failed"; step types read "Model request", "Model response", "Tool call", "Tool result", "Context event", "Your message", with the wire token in the tooltip.

### 8. [P1] Off-table status spellings routed through the status table

**WHERE:** `…/hub/MissionBoard.tsx:429` and `…/hub/MissionExpandDialog.tsx:67` ("Complete"), `…/testing/suites/SuiteMatrix.tsx:75` ("Complete"), `…/testing/compare/flow/LaneCell.tsx:227` ("Succeeded"), `…/scans/ScansView.tsx:62` (status filter option "Success"), `…/testing/TurnsLens.tsx:97` ("In progress"). **TARGET STATE:** all six render through `deriveStatusView` / `StatusBadge` ("Completed", "Running"); the scan status filter lists the chip labels Completed / Failed / Running. The spelling rule and its test are wp-3.2.

### 9. [P1] Absent-value literals

**WHAT:** replace the 38 `"n/a"` literals in non-test web source with the rule wp-3.2 fixes ("—" no value · "Not measured" could not compute · "N/A" does not apply). **WHERE:** `packages/shared/src/format.ts:16` (`formatDateTime` returns "n/a" for an empty value), `…/testing/GradePanel.tsx:268` (`"unevaluable" ? "n/a" : "—"`), `…/testing/KpiRail.tsx:160`, `…/testing/AnalyticsPanel.tsx:305`, `…/scans/ScansView.tsx:628`, `…/settings/SettingsView.tsx:1177` (App version), `…/servers/ServersView.tsx:710` (endpoint), plus `…/testing/suites/SuiteReportTab.tsx` (4), `…/dashboard/testing/CachePanel.tsx` (3), `…/testing/runs/SessionDurationStats.tsx` (2), `…/testing/ReportTab.tsx` (2), `…/testing/GradeChip.tsx` (2), `…/dashboard/testing/DurationPanel.tsx` (2), `…/dashboard/overview/tiles/InventoryTile.tsx` (2). **TARGET STATE:** `formatDateTime(undefined)` returns "—"; an unevaluable grade reads "Not measured" with the grader's reason on hover; everything else "—". `…/compatibility/meta.ts:109, 124, 138` keep "N/A" (a check that does not apply); `:161` "Unverified" for the `n/a` confidence becomes "—". The input alias `"n/a"` in `lib/status.ts:84` stays (it parses, it does not render).

### 10. [P2] Finish reasons and model calls in the audit table

**WHERE:** `…/hub/AuditView.tsx:199–201` — `model_call` rows use the raw model id as the title and the provider's `finishReason` (`stop`, `tool_calls`) as the subtitle. **TARGET STATE:** `FINISH_REASON_LABELS` in shared (stop "Finished", tool_calls "Called tools", length "Hit length limit", content_filter "Stopped by content filter", anything else "—"); the title reads "Model call · {model}". The Time column's absolute timestamp is wp-2.10.

### 11. [P2] Walkthrough leaks: "0+ tools" and the dock scope pill

- **WHERE:** `…/hub/workforce/AgentCard.tsx:256–258` renders `{count}+ tools` when a server grant is "all". **TARGET STATE:** "All tools · {n} servers" when any grant is `all`, "{n} tools" otherwise.
- **WHERE:** `…/assistant/assistant-scope-chip.ts:48` "Read-only — open an entity to enable edits"; `:63` "Scope: Run {id}" (the envelope carries no display name). **TARGET STATE:** unpinned "Can't make changes on this page — open a server, skill, run or test to let it edit."; pinned "Editing: {display name}" with the id in the tooltip — the page hook adds the name to the envelope.

### 12. [P2] Raw ids never stand alone

**WHERE:** run console Analytics › Tools "Server" column (`…/testing/analytics-derive.ts:388–427` carries `serverId` only); `/servers/:id` and `/skills/:id` Issues tabs and the dashboard Issues entity filter ("Tool call failed: … on {serverId}", `skill://{id}`, issue sheet "Cluster key v1 | skill | …"). **TARGET STATE:** the API payloads (`apps/api/src/grading/`, `apps/api/src/issues/`) carry `serverName` / `skillName` next to every id; the web renders the name and keeps the id in a tooltip; the cluster key is not rendered.

### 13. [P1] "Tool tokens" versus "Startup tokens", and one hyphen

**WHERE:** `…/servers/ServersView.tsx:632` labels `latestScan.totalTokens` — tools only, per `packages/shared/src/types.ts:277` — "Startup tokens"; `…/dashboard/overview/tiles/StartupCostTile.tsx:138` "Startup tokens" means tools + resources + prompts; `…/dashboard/overview/tiles/FootprintTableTile.tsx:91` "Tool tokens" is correct; the advisor copy says "definition tokens"; `…/servers/ServersView.tsx:634` "Top 3 share" vs `…/reports/ServerReportView.tsx:400` "Top-3 share". **TARGET STATE:** a tools-only figure is always labelled "Tool tokens"; "Startup tokens" is reserved for the full composition wp-3.4 defines in shared; "definition tokens" is retired; "Top-3 share" everywhere.

## Acceptance

- [ ] `grep -rn "D-HUX11\|AR7\|WP 1.6\|WP5.2\|D-US3\|findings/09" apps/web/src --include=*.tsx --include=*.ts | grep -v "\.test\."` returns comments only; the seven strings read as in action 1.
- [ ] `copy-internal-ids.guardrail.test.ts` exists, passes on the tree, and its fixture case fails for each of the seven original strings, for "coming soon" and for "analyzer v3".
- [ ] A second guardrail, `copy-wire-enums.guardrail.test.ts`, fails when a member of `TOKEN_PROFILES`, `TRANSPORT_TYPES`, `RUN_METRICS_MEASURES`, `RUN_METRICS_GROUP_BY`, `WATCH_WINDOW_DURATIONS`, `WATCH_WINDOW_OPS`, `WATCH_NOTIFY_SEVERITIES` or `METRICS_BUCKETS` is rendered as JSX text (`{profile}`, `{measure}`, `{dimension}`, `{duration}`, `{op}`, `{severity}`, `{bucket}` inside `<SelectItem>` / `<Badge>`), and `toolLoadingMode` is never rendered raw.
- [ ] A unit test asserts, for every member of `RUN_STATUSES` and `RUN_OUTCOMES`, that the "+ Filter" option label equals the label `deriveRunStatusView` produces for the same value.
- [ ] On the running app: `/settings/general` lists the four profile titles; `/testing/environments` reads "Tool loading" with "Eager" / "Deferred"; `/servers/:id` header chip reads "HTTP" or "Local (stdio)"; the watch-rule editor's five selects and the chart composer's two show words; the audit table shows "Called tools", not `tool_calls`.
- [ ] `grep -rn '"n/a"' apps/web/src packages/shared/src --include=*.ts --include=*.tsx | grep -v "\.test\."` returns only the `lib/status.ts:84` input alias; Settings › About never shows "n/a".
- [ ] `/assistant/agents` cards never read "0+ tools"; the dock pill never shows a bare id; no Issues surface shows a bare server or skill id.
- [ ] Every touched surface reads correctly in both themes; gate green: `pnpm typecheck && pnpm test && pnpm build && pnpm lint`.

## Effort

M (2–5 days). Actions 1–3 together are one day; 4–9 are small each but touch about forty call sites; 10–13 are S. One person; the only API change is the additive `serverName` / `skillName` fields in action 12.

## Sources

UXC-01, UXC-02, UXC-03, UXC-04, UXC-05, UXC-06, UXC-07, UXC-08, UXC-13, UXC-15, UXC-16, UXC-23 (finish-reason part; timestamps are wp-2.10), UXC-29, UXC-31, UXC-33, UXC-34, QA-10 (label part; definition is wp-3.4), QA-12, QA-25 (label part; `?status=` is wp-3.4), QA-31, WT (walkthrough: "D-HUX11" on `/assistant/projects`, "0+ tools", "Read-only — open an entity to enable edits", cross-cutting pattern 9). Continues RM-36 WP 2.2's single-encoding rule for the runs table. Not re-filed here: UXC-09 (wp-2.10), the "Soon" badge (wp-2.7), "Local / dev mode" (wp-0.2).
