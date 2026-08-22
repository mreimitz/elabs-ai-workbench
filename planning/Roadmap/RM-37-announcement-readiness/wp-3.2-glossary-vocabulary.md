---
type: "Work Package Spec"
title: "WP 3.2 — One glossary and the vocabulary rules"
description: "Phase 3 of item.md. Ledger: STATUS.md. One glossary (test / check / verify, session vs conversation, agent, runs not cells, startup tokens, cost words), one severity ramp with fixed tones, one status spelling, one absent-value rule, one percent rule, one issue-title template — published as data in packages/shared and enforced by string tests so a second word for the same concept fails the build."
tags: ["roadmap", "RM-37"]
timestamp: "2026-08-22T07:10:00Z"
status: "final"
---
# WP 3.2 — One glossary and the vocabulary rules

Phase 3 of [`item.md`](./item.md). Ledger: [`STATUS.md`](./STATUS.md).

**Depends on:** [`wp-3.1-copy-scrub-label-maps.md`](./wp-3.1-copy-scrub-label-maps.md) for the label maps the rules are enforced through. Paths are relative to the repo root (`…/` = `apps/web/src/features/`).

## Scope

Decide one word per concept and one concept per word, publish the decision as data (`packages/shared/src/glossary.ts` + `docs/ui-glossary.md`), rename the strings that disagree, and add the tests that fail the build when a retired word returns. Phase 2 relayouts that move these words on screen (suite hero, launcher, advisor, dock) consume the glossary; they do not re-decide it. The compatibility "Blocker → limit language" rewording itself is wp-0.5; this WP fixes the ramp and tones it maps into.

## Actions

### 1. [P1] Adopt the glossary

**WHAT:** the table below is the glossary; it ships as `GLOSSARY` in `packages/shared/src/glossary.ts` (term, one-line definition, the retired words) and as `docs/ui-glossary.md`. **WHERE:** every surface in the last column is renamed to the term. **TARGET STATE:** a word in this table is never used for another concept and a concept never has a second word.

| Term | Definition | Replaces (retire) | Where it appears |
|---|---|---|---|
| Test | A saved prompt (plus optional attachments and expectations) you can run in any environment. Only this meaning. | "test scenario" | Collections (`…/testing/collections/CollectionTests.tsx:397`), launcher, suites |
| Check | One compatibility rule evaluated against a scan for one model. The server tab that lists them is "Model limits" (wp-2.3). | "Tests" tab (`…/servers/ServersView.tsx:588`, `…/scans/ToolDetailPanel.tsx:93`), "View all tests" (`ServersView.tsx:656`), "Server-level test ledger" (`…/reports/ServerReportView.tsx:590`), band "Not tested" → "Not checked" (`…/compatibility/meta.ts:69`) | Server detail, tool detail, server report, compatibility |
| Check connection | The connectivity probe for a server. | "Test connection" (`ServersView.tsx:554`) | Server header, card menu |
| Verified / Not verified / Failed | Credential state; "Verified" means the key answered a live call or a completed run (mechanism: wp-2.9). | "Never tested" (`…/testing/credential-health.ts:115, 131`), "Not tested" | Environments table, launcher warning |
| Run with this skill… | Launches a run that loads the skill. | "Test this skill…" (`…/skills/SkillUsageTab.tsx:136`) | Skill Usage tab |
| Send a sample | Sends a sample webhook payload. | "Send test webhook", "hasn't fired or been tested" (`…/watch/RuleAuditDialog.tsx:97, 114`) | Watch-rule audit dialog |
| Environment | Provider + model + allowed servers/skills + guardrails a test runs in. | "scenario" (wire only; UI survivors are wp-2.10), "harness" | Environments, launcher, advisor, suites |
| Suite / suite run | A saved plan of tests × environments × repetitions; its execution is a suite run made of runs. | "mass-run", "matrix" (allowed only in the suite editor's explanation) | Collections, suites |
| Run | One execution of a test in an environment; an interactive run is a session you drive. | "cell(s)" (`…/testing/suites/SuiteDetail.tsx:341, 395, 456, 528`, `SuitesView.tsx:309, 525`, `…/testing/collections/CollectionSuites.tsx:305`, `SuiteKpiRail.tsx:56`, `SuiteDeltas.tsx:208`, `SuiteScatter.tsx:142`, `…/testing/run-launcher/RunLauncher.tsx:988`), "member run", "single run" | Suites, suite runs, launcher, runs feed |
| Session (Hub) | One Assistant workspace conversation; it may contain a mission. | "thread", "conversation" inside the Hub | `/assistant`, `/assistant/sessions` |
| Conversation (dock) | A chat about the current page in the App assistant. | "thread" (`…/assistant/AssistantDock.tsx:799, 824, 853`, `AssistantComposer.tsx:139`), "session" inside the dock | App-assistant dock |
| Mission | A planned team of agents you approve before it runs. | — | Hub |
| Agent | A saved agent identity (name, model, tools, skills). | "role", "library role" (`…/hub/workforce/crew-profile/MembersSection.tsx:122, 154, 225`, `agent-profile/FormSections.tsx:74` "Role title" → "Title"), "autonomy dial" → "autonomy setting" (`BudgetsSection.tsx:36`) | Crew editor, agent profile, API "Hub agent role not found" → "Agent not found" |
| Crew | A saved team of agents; a crew may contain crews. | "sub-crew", "organization" | `/assistant/agents` |
| Issue | A recurring problem across runs with a lifecycle Open / Resolved / Regressed. | "cluster", "failure bucket" | Dashboard, server and skill Issues tabs |
| Finding | One rule hit from an analyzer (security, quality, compatibility). | "quality issue"; "problem" stays only inside the Studio strip | Scan Security tab, skill Quality, server Overview |
| Recommendation | One Advisor output with a projected saving. | "suggestion" | `/advisor`, dashboard card |
| Rating / grade / judge | Rating = the automatic post-run evaluation; a grade = one grader's output inside it; the judge = the model doing LLM grading. Status chip while it runs: "Rating…". | "Reviewing…" (`apps/web/src/lib/status.ts:112, 198`), "Reviewing & rating run…" (`…/testing/ConversationPane.tsx:279`), "Rating pending" / "Rating in progress…" (`…/testing/ReportTab.tsx:213, 1181`) → "Rating…" | Run console, runs feed, Report tab |
| Review | Human evaluation only. | "review" for anything automatic | `/testing/review`, rubrics, "Review these…" |
| Score | A 0–1 quality number, always shown as a percent. | "Grade 0.10", "Score (0–1)" (`…/testing/runs/RunFilterBar.tsx:553`) | Suites, runs feed, filters |
| Posture | The security score plus its band: Clean / Low risk / Medium risk / High risk. | "health" for security | Server cards, scan Security tab |
| Status (server) | The last scan's state: Scanned / Not scanned / Scan failed / Sign-in needed. Never "Healthy" beside a risk chip. | "Healthy" + risk chip on one line, "Auth expired" | `/servers`, `/servers/:id` |
| Startup tokens | Definition cost loaded at session start (tools + resources + prompts); "Tool tokens" only for the tools-only figure; "footprint" only as a section noun. | "Total footprint" (`…/scans/ScansView.tsx:611`), "Total context footprint" / "Selected server footprint" (`…/testing/EnvironmentEditor.tsx:992, 964`), "Total" (`…/skills/SkillOverview.tsx:308`), "definition tokens" | Dashboard, servers, scans, skills, environment editor, advisor |
| Context / Peak context | Tokens in the model's window now / at the run's peak. | "context window" used as a number | Run console rail, Analytics |
| Tokens in / out | Cumulative traffic, as billed by the provider. | "Tokens ↑ / ↓" + "(provider-actual)" (`…/testing/KpiRail.tsx:183, 276–293`), "Tokens sent / received" (`apps/web/src/components/ToolRunner.tsx:429–434`), "Tokens" with no direction (`…/hub/sessions/columns.tsx:137–140` → header "Tokens in / out") | Rail, tool playground, audit, sessions table |
| Cost · Subscription · Forecast · Projected saving · Spend | See action 6. | "Est. cost", "Exec cost", "Judge cost", "est.", "Estimate" | Rail, runs feed, suite rail, usage, advisor, launcher |
| Needs you · Waiting for you · Approval needed | The queue · a run/session state · a mission or write awaiting approval. Composer idle text: "Ready" (or nothing). | "Needs attention" (`…/testing/runs/RunFilterBar.tsx:107, 635`), "Awaiting your input" (`…/testing/Composer.tsx:76`, `…/hub/Composer.tsx:481`, `…/assistant/AssistantComposer.tsx:173`), "Waiting for your input" (`…/hub/ConversationPane.tsx:2347`), "Awaiting your review" → "Review proposed memory" (`…/hub/memory/ScopedMemoryList.tsx:153`) | Dashboard, runs filter, composers, memory chip |
| Eager / Deferred | Tool loading: every tool definition is sent each turn / definitions load on demand through tool search. | "loads tools eagerly" | Environments, advisor, launcher |
| Tokens per turn · allowedTools · Variants · Data gap | Tokens a loaded definition adds to every model call · the per-server list of tools an environment may expose · alternative configurations of one suite compared against a base · an input the advisor could not measure. | "tokens/turn" | Advisor, environment editor, suite editor, launcher |
| Idle timeout · Wait budget · Time cap | The three run limits. | "Stall timeout", "Wait budget" (kept), "Wall cap", "session clock", "subscription concurrency" | Launcher step 3 (wp-2.7), environment editor, Settings › Testing |
| Eligible · Match strictness | Cross-server compare: tools that could be matched · the Very loose … Strict matching setting. | "Fuzzy: Balanced" | `/compare/scans` (wp-2.4) |

### 2. [P1] Glossary tooltips from one source

**WHAT:** a `<Term id>` component in `apps/web/src/components/` that renders the glossary definition as the shared Tooltip (≤ 20 words). **WHERE:** first consumers — launcher steps 1–3 (suite, repetitions, cost cap, judge, variants, the three limits), `/advisor` and the dashboard recommendation card (environment, eager, tokens per turn, allowedTools, data gap), `/compare/scans` (eligible, match strictness), the Environments page ⓘ ("An environment is …"). **TARGET STATE:** every term in action 1 that a first-week user meets has the same one-line definition wherever it first appears; wp-2.4, 2.5 and 2.7 place the component, this WP ships it.

### 3. [P1] One severity ramp, one tone per word

**WHAT:** `FINDING_SEVERITY_META` in `packages/shared/src/labels.ts` — Critical = `destructive` (red, filled) · High = `warning` (amber) · Medium = `secondary` (neutral, filled) · Low = `outline`. "Blocker" is retired. Error / Warning / Info stay only for the two deterministic analyzers (security, quality — `…/skills/quality/quality-meta.ts:14–16`), with Error red, Warning amber, Info neutral; the watch notify severities use the same three tones through `WATCH_SEVERITY_LABELS`; the posture band keeps Clean / Low risk / Medium risk / High risk (`…/security/PostureScore.tsx:22–36`). **WHERE:** `…/compatibility/meta.ts:117–124` (Blocker red, High amber, Medium neutral, Low outline → wp-0.5 decides which checks are Critical), `…/advisor/advisor-format.ts:26–28` (High is red, Info blue → High amber, Info → Low outline), `…/issues/IssuesPanel.tsx:346–348` and `…/issues-fleet/issue-lib.ts:172–174` (High red, Medium amber, Low neutral → High amber, Medium neutral filled, Low outline); compatibility's cell result word "Warn" → "Warning". **TARGET STATE:** the four feature maps become re-exports of the shared record; "High" is amber on every surface.

### 4. [P1] Status spelling rule

**WHAT:** the terminal state is "Completed", the live state "Running", the rating state "Rating…"; "Complete", "Succeeded", "Success", "Done", "In progress", "Reviewing…", "Rating pending", "Rating in progress…" are not status labels. **WHERE:** the six off-table sites wp-3.1 action 8 routes through `deriveStatusView`, plus `lib/status.ts:112, 198`, `…/testing/ReportTab.tsx:213, 1181`, `…/testing/ConversationPane.tsx:279`. **TARGET STATE:** one status table, one spelling; `StatusBadge` is the only way a lifecycle word reaches the screen.

### 5. [P1] Absent-value and percent rules

**WHAT:** "—" = no value · "Not measured" = could not be computed (reason on hover) · "N/A" = the check does not apply · never "n/a" · a zero denominator renders "—", never "0.0%" (the dashboard Testing KPI is wp-3.3). Percent: one `formatPercent(value, { dp })` in `packages/shared/src/format.ts:11–13` with documented defaults — rates 1 dp (cache share, error rate, pass rate), utilization 0 dp (context), scores and grades 0 dp; scores always as a percent, never 0–1. **WHERE:** `…/testing/KpiRail.tsx:160–161` (`Math.round` → "3%"), `…/testing/AnalyticsPanel.tsx:290` ("3.2%"), `…/testing/grade-format.ts:95`, `…/testing/runs/SuiteTableRows.tsx:310` ("0.0% pass"), `…/testing/compare/matrix/summary-format.ts:11` (own rule), `…/testing/suites/SuiteKpiRail.tsx:73–80`, `/testing/suites` "GRADE 0.10" (fraction) vs suite run "Mean grade 78%". **TARGET STATE:** the same quantity never shows two precisions on one screen; "pass rate" and "mean score" are spelled out next to their percent.

### 6. [P1] Cost and token vocabulary

**WHAT:** **Cost** = tokens × list price, never prefixed "Est." · **Subscription** = the marker on shadow-priced runs (replaces "est.") · **Forecast** = any pre-run number · **Projected saving** = the Advisor's number · **Spend** = a period total in Usage only; tokens per action 1 (Startup tokens / Context / Tokens in / out). **WHERE:** `…/testing/KpiRail.tsx:249` "Est. cost" → "Cost"; `apps/web/src/components/SubscriptionCostMarker.tsx` "est." → "Subscription" with tooltip "Priced at list rates; billed to your subscription, not metered"; `…/testing/suites/SuiteKpiRail.tsx:98, 111` "Exec cost" / "Judge cost" → "Run cost" / "Rating cost"; `…/advisor/RecommendationCard.tsx:80, 84` "Estimated saving" panel + "Estimate" chip → "Projected saving"; `…/testing/AnalyticsPanel.tsx:521` "Estimate" → "Forecast"; launcher step 3 estimate → "Forecast"; `…/hub/workforce/usage/UsageKpis.tsx:32` "Spend" stays; `…/testing/RunsView.tsx:1216` "Cost" stays; the sessions "$0.00" cell takes the Subscription marker (data: wp-2.10). **TARGET STATE:** "Estimate" and "est." do not appear as labels anywhere.

### 7. [P2] Issue-title template

**WHERE:** `apps/api/src/grading/issue-clustering.ts:423–426` builds "Recurring {bucket} on {target} — {tool}", so every title starts with the same ten characters and the one-line tile truncation makes rows identical. **TARGET STATE:** `clusterTitle` returns "{tool} keeps failing on {target}" when a tool is known, otherwise "{target}: {bucket phrase} keeps recurring"; the root-cause bucket becomes the chip (Skill / MCP server / Model behavior); titles are derived at read time from (bucket, target, tool) so stored rows need no migration, and AI-refined titles keep their text. The two-line tile is wp-2.2.

### 8. [P1] The string tests

**WHERE:** `apps/web/src/guardrails/` (source-scanning style of `series-ramp.guardrail.test.ts`) plus the unit tests named. **TARGET STATE:**
- `glossary-retired-words.guardrail.test.ts` — fails on any retired word of action 1 or 6 in JSX text or string literals of non-test web source: `\bcells?\b`, `member run`, `\bthreads?\b` (under `features/assistant`, `features/hub`), `\brole\b` (under `features/hub/workforce`), `Test connection`, `Never tested`, `Not tested`, `Test this skill`, `Send test webhook`, `Est\. cost`, `Exec cost`, `Judge cost`, `\best\.`, `Total footprint`, `Total context footprint`, `Selected server footprint`, `definition tokens`, `provider-actual`, `Tokens ↑`, `Tokens sent`, `Needs attention`, `Awaiting your input`, `Waiting for your input`, `Awaiting your review`, `Blocker`, `Stall timeout`, `Wall cap`; exemptions carry a reason.
- `status-spelling.guardrail.test.ts` — fails on `Succeeded`, `"Complete"`, `"Success"`, `"In progress"`, `Reviewing…`, `Rating pending`, `Rating in progress` outside `lib/status.ts`; `lib/status.test.ts` gains `deriveStatusView("success").label === "Completed"` and the rating chip `"Rating…"`.
- `severity-ramp.guardrail.test.ts` — no feature file defines a `{ label: "High" | "Medium" | "Low" | "Critical" | "Blocker", variant: … }` literal; a unit test asserts Critical → `destructive`, High → `warning`, Medium → `secondary`, Low → `outline`.
- `absent-value.guardrail.test.ts` — no `"n/a"` / `'n/a'` literal outside `lib/status.ts`; `packages/shared/src/format.test.ts` (new) asserts `formatDateTime(undefined) === "—"`, `formatPercent(null) === "—"`, and the dp defaults.
- `apps/api/test/issues-clustering.test.ts` — a title never starts with "Recurring" when a tool is known and always starts with the tool name.

## Acceptance

- [ ] `packages/shared/src/glossary.ts` and `docs/ui-glossary.md` exist and contain every row of action 1; `<Term>` renders the same definition on the launcher, `/advisor`, `/compare/scans` and `/testing/environments`.
- [ ] `grep -rn "cells\b" apps/web/src --include=*.tsx | grep -v "\.test\."` returns nothing; the suite hero reads "Runs 10 / 10"; the tooltip at `SuiteDetail.tsx:528` ends "= 2 runs".
- [ ] "Test" appears only for the saved-prompt meaning: the server tab reads "Model limits", the action "Check connection", the credential state "Not verified", the skill action "Run with this skill…".
- [ ] "High" renders amber on `/advisor`, `/servers/:id` Issues, the dashboard Issues tab and `/testing/compatibility`; no surface renders "Blocker".
- [ ] No non-test file renders "Complete", "Succeeded", "Success", "In progress" or "Reviewing…" as a status; the in-flight chip reads "Rating…".
- [ ] No "n/a" on any screen; Settings › About, the run rail and the Analytics tab show "—" or "Not measured" only.
- [ ] One screen never shows two precisions of the same quantity; `/testing/suites` shows scores as percents.
- [ ] No label reads "Est. cost", "Exec cost", "Judge cost", "est." or "Estimate"; a subscription-priced run carries the Subscription marker.
- [ ] A new fleet issue is titled "{tool} keeps failing on {target}" with the root cause as a chip.
- [ ] The five guardrail tests and the two unit-test additions pass; each fails on a deliberately reintroduced retired word (fixture cases inside the tests).
- [ ] Gate green: `pnpm typecheck && pnpm test && pnpm build && pnpm lint`.

## Effort

M (2–5 days). The glossary and tests are one day; the renames are many small edits across suites, servers, hub workforce and the run console; the severity re-mapping is a half day once wp-0.5 has decided the compatibility words.

## Sources

UXC-10, UXC-11, UXC-12, UXC-14, UXC-15, UXC-16, UXC-18, UXC-20, UXC-24, UXC-25, UXC-26, UXC-27, UXC-28, UXC-38, QA-39 (score encodings), EU-10 (one token term), EU-16, EU-24 and EU-31 (the undefined-term list: environment, suite, cell, judge, variants, eager, tokens/turn, stall/wait/wall, allowedTools, data gaps, eligible, fuzzy), WT (walkthrough: three meanings of "test", "cells", "Awaiting your input" before any input, cross-cutting patterns 5 and 9). Decided elsewhere and only consumed here: compatibility "Blocker → limit language" (wp-0.5), the credential-state mechanism (wp-2.9), the dock and Hub surfaces (wp-2.10), the suite hero and launcher placement (wp-2.7).
