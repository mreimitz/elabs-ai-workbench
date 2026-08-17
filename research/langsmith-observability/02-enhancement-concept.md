# 02 — Concept v0: an observability layer for this app

> **Draft for discussion — not a plan.** Shape of the idea, written to be argued with. Owner
> decisions it presupposes are collected in [`03-open-questions.md`](./03-open-questions.md)
> (Q-OB*n*). Wave cuts, names, and defaults are all provisional.

Premise: the gaps in [`01-gap-analysis.md`](./01-gap-analysis.md) are one missing *layer*, not
ten missing features. Everything LangSmith does better sits on the same backbone: **queryable
metrics + searchable content over all sessions**, with progressively smarter consumers
(dashboard → alerts → rules → issues). Build the backbone once, then each consumer is small.

Design rules, inherited from the codebase:

- **Derived, never authoritative.** Like `suites/analytics.ts`, every aggregate is recomputable
  from persisted `runs` / `run_steps` / `run_grades` / `rating_issues`. No metric is a second
  source of truth.
- **Additive wire.** New endpoints and new optional fields only; `packages/shared` first, then
  API, then web. No changes to `RunEvent`, persistence, replay, or grading contracts.
- **Local-first.** SQLite (+FTS5) only; no new infra, no SaaS dependency. In-app notification
  before any external channel; webhook optional. Single-owner scale is a feature: we can afford
  mandatory rating, full persistence, and exact recomputation where LangSmith must sample.
- **Sequenced after unified-run-sessions Wave 1.** `stopReasonCode`, phase events
  (`queued`/`waiting_input`), and the capability manifest (C1–C3 there) are the dimension
  columns this layer wants to aggregate by. Building fleet metrics on top of today's ambiguous
  terminals (aborted-vs-stopped divergence) would bake the mess in. Quick wins that don't need
  those columns are marked ◇ below.

---

## Wave O1 — Backbone: metrics, search, saved views (API + shared)

**O1.1 Run metrics endpoint.** `GET /api/metrics/runs?from&to&bucket=hour|day|week&groupBy=
model|provider|providerKind|server|environment|suite|skill|test&measures=count,errorRate,
guardrailRate,p50DurationMs,p95DurationMs,tokensIn,tokensOut,costUsd,meanScore,questions`.
Plain SQL over `runs` + `run_grades` (+ suite membership), time-bucketed, computed on demand
(Q-OB2: rollup table only if profiling demands it). Score selection reuses
`PRIMARY_GRADER_PRIORITY` / `selectRunScore` so "meanScore" means the same thing everywhere.
Capability-aware: runs with `tokens: "estimated"` are marked or excluded per-measure (C3
manifest; Q-OB3). Same endpoint family later serves scans (`/api/metrics/scans` — footprint
over time) and assistant sessions (Q-OB5 scope).

**O1.2 Full-text search index.** SQLite **FTS5** virtual table `run_search(runId, stepId, kind,
text)` populated at persistence time (and one backfill migration) from: run title/env/model,
user prompts, assistant text, tool names + truncated tool args/results, error strings,
stopReason, rating verdict text. Truncate per-field at ~2 kB (LangSmith indexes 250 chars;
Q-OB11 sets our number). Additive migration v*N*; the write path hooks the existing persistence
choke point (`RunManager` → repository), never the emitters.

**O1.3 One filter grammar.** Extend `GET /api/runs` with structured params (status, outcome,
`stopReasonCode`, providerKind, model, serverId, skillId, suiteId, environmentId, scoreLt/Gte,
costGte, tokenGte, dateFrom/To, `q` = FTS match) + zod schema in `packages/shared` so UI and
API share one filter object, LangSmith-style (their copy-as-query-DSL). The same object is
reused verbatim by saved views, watch rules (O4), and chart drill-downs (O2) — this is the
keystone contract of the whole layer.

**O1.4 Saved views.** Table `run_views(id, name, filter_json, columns_json, sort, createdAt)` +
CRUD routes. A view is just a named O1.3 filter object.

**O1.5 Feedback primitive.** Table `run_feedback(id, runId, stepId?, key, score, comment?,
source: human|auto, createdAt)` + `POST/GET /api/runs/:id/feedback`. One primitive for: console
thumbs/notes (O2.4), review verdicts (O4.4), and future automated writers — mirroring
LangSmith's single feedback concept. Auto-rating keeps writing `run_grades` (unchanged);
whether human scores join analytics is Q-OB4.

**O1.6 Retention classes ◇.** `pinned` flag on runs (never pruned) + prune policies by class
(e.g. keep errored runs longer), extending the existing maintenance endpoints. LangSmith's
auto-upgrade-retention-on-interesting is the model; a rule action in O4 sets the flag.

## Wave O2 — Monitoring surfaces (web)

**O2.1 Testing dashboard (time axis at last).** New route (Q-OB1: `/observability` vs a tab on
the existing Dashboard): date-range + global filter bar + group-by, then panels driven by O1.1,
all `@elabs-ai/components-charts`: runs & error rate over time; guardrail stops by `stopReasonCode`; duration
p50/p95; tokens & cost by model/server/skill; score trend per grader; top failing tests/servers;
"most expensive" leaderboard. Every datapoint click-throughs to the runs feed with the O1.3
filter pre-applied (LangSmith drill-down parity). Prebuilt-first (their six-section prebuilt
dashboard is the template); custom chart composer is explicitly *not* v1 (Q-OB6).

**O2.2 Runs feed upgrade.** Filter bar bound to the O1.3 object; FTS search box; saved-views
dropdown (O1.4); URL-encoded filter state (deep-linkable, shareable); column chooser +
per-view preview cell (LangSmith "customize trace previews": pick which fields render, e.g.
last assistant text vs stopReason vs cost).

**O2.3 Sessions lens.** Table view for interactive runs: turn count, waiting-vs-active time
(needs C2 clock split), last activity, phase chip ("Waiting for you" filter — the
unified-run-sessions Q1 need, delivered here), P50/P95 duration per environment. Lands only
after unified-run-sessions Wave 1/2.

**O2.4 Feedback in the console ◇.** Thumbs + note on the run (and optionally per assistant
turn) writing O1.5 feedback; chips visible in the runs feed and joinable in filters
("score=down"). Cheap, and it starts accumulating the human signal every later feature wants.

## Wave O3 — Debugging depth (console)

**O3.1 Step hierarchy.** Additive `parentStepId` on `run_steps` (+ optional `spanKind`).
Emitters attach children where real nesting exists: rating/judge calls under a `rating` span,
MCP request/response detail under its tool-call step, compatibility probes under their step.
`StepLog` becomes a collapsible tree; `RunGantt` gains swimlane nesting. Old runs render
unchanged (no parent = flat). (Q-OB7 decides wire-level vs presentation-only grouping.)

**O3.2 Per-step economics.** Surface per-step tokens/cost/latency (extending
`run-kpi-by-step.ts` deltas) as chips on steps + a "hotspots" strip in the KPI rail: slowest
step, costliest step, biggest context jump — each a jump-link. This is LangSmith's per-span
attribution, plus our context angle they don't have.

**O3.3 Re-run from step.** `POST /api/runs/:id/rerun {fromStepId?, overrides{prompt?, model?,
temperature?, skillVersionId?}}` → new run linked by `derivedFromRunId`; console banner chip
("derived from run …"); Compare pre-seeds parent-vs-derived; launch preview reuses
`estimate/run-plan`. This is "Open in Playground" translated to a bench: not a scratch
playground call but a real, persisted, comparable, gradeable run. Suite members likely excluded
(comparability — Q-OB8).

**O3.4 In-run search + lenses ◇.** Text search within the loaded session (client-side over
steps; FTS-backed for replay); optional compact "Turns" lens for long interactive sessions
(LangSmith M/T/D pattern) if O2.3 demand confirms it.

## Wave O4 — Watch rules: alerts + automations

**O4.1 Rules engine.** Table `watch_rules(id, name, filter_json, sample?, trigger, actions_json,
enabled)`. Two trigger kinds:
- **on-terminal** (event-driven): evaluated at the existing terminal/rating choke point against
  the run's O1.3 filter match. Actions: notify (O4.3), webhook POST, pin/extend retention
  (O1.6), add-to-collection, **promote to regression-test candidate** (O4.5), run extra grader,
  open/attach-to issue (O5).
- **windowed** (scheduled sweep over O1.1): threshold on a measure over a trailing window
  (errorRate, costUsd/day, p95DurationMs, meanScore vs baseline). LangSmith's five alert
  metrics map 1:1; their **historical preview** ("this threshold would have fired on these past
  windows") is required UI before save. Scheduler is an in-process interval + catch-up on boot
  (Q-OB9: the app is not always running; semantics must be honest about that).

**O4.2 No PagerDuty.** Channels: in-app first, one generic webhook (covers Slack) with templated
JSON + secret-store-held URL. Test-fire button. Out of scope: email, PagerDuty, Dynatrace.

**O4.3 Notification center.** Persistent `notifications` table + bell/attention feed in the app
shell (extends the Dashboard "Needs attention" idea app-wide); each notification deep-links to
its runs/issue/chart slice. SSE-pushed while the app is open.

**O4.4 Review queue (annotation-lite).** A saved view + reservation-free checklist UI over
`run_feedback`: rubric (named keys + descriptions), keyboard-driven next/prev, verdict + note
per run, progress state. Single-owner, so LangSmith's reservations/multi-reviewer machinery is
skipped deliberately; pairwise review is already covered by the Compare workspace (add a
"reviewed" mark there). (Q-OB10: is even this much wanted, or is feedback-in-console enough?)

**O4.5 Promote to test ◇.** One click (console button + rule action): failed/interesting run →
draft test in a chosen collection, pre-filled from the run (prompt, environment, attachments,
expectations seeded from forensics/expected-answer). The LangSmith "add to dataset" translated
into our stronger position: the dataset is already runnable here. This is the single most
bench-native feature in the whole concept.

## Wave O5 — Issues: the Insights/Engine analog

**O5.1 Fleet issue aggregation.** Nightly (and on-demand) job folds terminal runs into
**issues**: deterministic key first (forensics bucket + fix-target + server/skill + optional
normalized error signature), LLM assist second (CLI-first judge chain, existing gate) for
merge/labels/summary. Issue row: occurrences, first/last seen, affected servers/skills/tests,
trend sparkline, status `open|resolved|regressed` (auto-reopen on recurrence, LangSmith Engine
behavior). Upgrades/absorbs the existing Rating Issues registry (v26) rather than adding a
second registry (Q-OB12 naming/merge).

**O5.2 Issues UI.** List + detail (linked runs via O1.3 filter, metrics slice via O1.1, the
drafted fixes error-forensics already produces, affected-entity chips). "Since your last visit"
on the Dashboard learns about issues ("2 new issues, 1 regressed").

**O5.3 Close the loop with the Assistant.** On an issue: "Analyze with Assistant" seeds the
existing dock (23 read tools) with the issue envelope → it drafts the fix (skill edit via the
approval-gated workspace → **new immutable skill version**; or MCP-server config suggestion) →
proposes the regression test (O4.5) → re-runs it (O3.3 lineage) → the issue watches the
regression test thereafter. LangSmith Engine ships a GitHub PR and hopes; we can ship an
in-app fix *and prove it* on the bench in one flow. This is the differentiating end-state of
the whole research.

**O5.4 Scheduled digest ◇.** Daily/weekly digest (notification + persisted MD/JSON in the
reports family): new/regressed issues, movers (cost/error/score by entity), biggest runs —
the runs-world version of the Dashboard's since-last-visit card. LangSmith equivalent:
scheduled Insights reports.

---

## What we deliberately do NOT copy

- **SmithDB / scale claims** — SQLite + FTS5 + indexes is correct at single-owner scale.
- **Multi-region ingest, RBAC, org workspaces** — team-server roadmap owns any of that later.
- **PagerDuty/Dynatrace/email** — in-app + one webhook.
- **OTel ingest** — we are the harness, not a general trace sink. (OTel *export* of our runs is
  a cheap future option worth keeping in mind, not in these waves.)
- **Public share links** — exportable bundles already exist (reports); revisit with team-server.
- **Reservations/multi-annotator queues** — single owner; O4.4 stays lite.

## Sequencing & effort sketch (non-binding)

| Wave | Depends on | Size | Migration |
|---|---|---|---|
| O1 backbone | unified-run-sessions Wave 1 (for `stopReasonCode`, capabilities; ◇ items sooner) | M | FTS table, `run_views`, `run_feedback`, `pinned` |
| O2 monitoring UI | O1 | M | — |
| O3 console depth | O1.2 (search); O3.1 wants Q-OB7 settled | M | `parentStepId`, `derivedFromRunId` |
| O4 watch rules | O1 (filter grammar + metrics); O4.5 ◇ anytime | M | `watch_rules`, `notifications` |
| O5 issues | O1 + O4; O5.3 needs assistant enabled | L | issue tables (absorb v26) |

Quick wins shippable before the concept settles (each independently safe, all ◇): FTS index +
runs-feed search box; feedback thumbs in console; `pinned` runs; promote-to-test button;
"costliest/slowest step" chips from existing per-step KPIs.

**Explicitly unchanged:** `RunEvent` union (additions only), persistence/replay, grading
contracts, Compare, suite orchestration, the D-CS3/D-QA "same vocabulary" invariants, and the
unified-run-sessions concept — this layer consumes it, never competes with it.
