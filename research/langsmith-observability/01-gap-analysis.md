# 01 — Gap analysis: LangSmith vs. this app

Comparison across nine dimensions, then the honest inverse (where this app is ahead). "Us"
claims are grounded in the current codebase (file references inline); LangSmith claims are
sourced in [`00-langsmith-feature-inventory.md`](./00-langsmith-feature-inventory.md).

**Context that shapes every verdict:** LangSmith observes *production traffic* for many teams;
we are a *local, single-owner test bench*. Some LangSmith machinery (multi-region ingest,
RBAC, PagerDuty, SmithDB scale) does not transfer and is explicitly out of scope
([`02-enhancement-concept.md`](./02-enhancement-concept.md) §non-goals). What *does* transfer
is the shape of the questions their tooling answers: "is it getting worse?", "where does it
hurt?", "show me the ones that matter", "what should I fix first?". Today we cannot answer any
of those across runs.

Verdicts: ✅ we lead · ≈ rough parity · ⚠️ partial (foundation exists, layer missing) · ❌ missing.

---

## D1. Fleet monitoring over time — ❌ missing (the structural gap)

| | LangSmith | Us |
|---|---|---|
| Time-series metrics | Prebuilt per-project dashboard (traces, LLM calls, cost/tokens, tools, run types, feedback) + fully custom dashboards with group-by and drill-down | None. No endpoint aggregates runs over time; no chart anywhere has a time axis across runs |
| Home surface | Dashboards + project stats panel | `DashboardView.tsx` is **scan/footprint-centric** (inventory KPIs, since-last-visit scan deltas, needs-attention for scans). Runs/testing do not appear on it at all |
| Cross-entity breakdowns | Group by tag/metadata/name/type; top-5 slices | Suite analytics exist but are **per suite run** (`suites/analytics.ts`: quality×cost scatter + category/difficulty/tag breakdowns, derived on demand). Nothing spans suites, servers, models, or weeks |
| Drill-down | Chart datapoint → filtered runs table | n/a |

Everything we compute is *within* one artifact. The moment the question has a time axis
("error rate this week vs last", "cost per model since the skill v3 rollout", "which server
regressed after its scan changed"), we have no answer surface. This gap also blocks alerting
(D5) and issue detection (D8), which are both defined *over* metrics windows.

## D2. Finding sessions: search, filtering, saved views — ❌ missing

| | LangSmith | Us |
|---|---|---|
| Filter grammar | Composable operators over name/type/tags/metadata/content/feedback/latency/tokens/error; negations; key-path filters into JSON; tree filters (match on children); trace-level filters | Runs feed filters are list-level UI state; no shared filter grammar, nothing URL-persisted beyond the route |
| Full-text search | Yes (first 250 chars/field indexed, partial keywords) | **No full-text search anywhere** over run content (prompts, assistant text, tool results, error strings) |
| Saved views | Per-project named views; UI filter ⇄ query DSL round-trip for API use | None |
| Storage | SmithDB, tree-aware, "sub-second over millions" | SQLite. Fine at our scale, but no FTS index exists, so content search would be a table scan today |

For a *debugging* tool this is the most acutely felt gap after D1: "which run was it where the
agent called `vendor_assistant` with an empty filter?" is answerable in LangSmith in seconds and in
our app only by opening runs one by one. SQLite FTS5 gives us 90% of this locally for near-zero
infra cost.

## D3. Interactive sessions / threads — ⚠️ partial (contract in flight, no monitoring view)

| | LangSmith | Us |
|---|---|---|
| Grouping | Threads via `session_id` metadata; strict child-run propagation | Interactive runs exist (`promptMode`), and `unified-run-sessions` is fixing lifecycle (waiting_input, queued, End-session terminal) |
| Session list | Threads table: first input, last output, turn count, **P50/P99 latency**, tokens, cost, feedback per thread + aggregate stats | Runs feed rows only. No turn count, no waiting-time, no per-session latency stats, no "waiting for you" filter (unified-run-sessions Q1 notes the need) |
| Reading a conversation | Three lenses (Messages / Turns / Details) with keyboard switching | One console layout (`RunConsole` + `ConversationPane`); good, but single-lens; no compact "turns" summary for long sessions |
| Thread-level judging | Thread-level online evaluators | Auto-rating grades runs; nothing judges a *conversation* as a unit beyond that run's own transcript |

The unified-run-sessions concept (C1 phases, C3 capabilities) creates exactly the states a
sessions table needs (`waiting_input`, `queued`, honest terminals). What it does not create is
the *monitoring lens over sessions*: the table, the stats, the filters. That belongs here.

## D4. Debugging one session — ≈ parity overall, behind on four specifics

Where we already match or beat LangSmith (details in §Where-we-lead): live streaming console,
deterministic full replay, per-turn context/cost analytics, run report with judge verdicts and
error forensics.

Where LangSmith is concretely better inside one session:

1. **Hierarchy.** Their trace is a *tree* with per-span latency/tokens/cost rollups. Our
   `run_steps` are a flat sequence (turns, tool calls); judge/rating calls, MCP roundtrip
   internals, and sub-operations are invisible or flattened. `StepLog` and `RunGantt` render
   sequences, not nesting.
2. **Per-step cost attribution.** They price every span. We have per-turn cumulative KPIs
   (`reports/run-kpi-by-step.ts`) and charts, but no "this tool call cost $0.0021 / 1.2k
   tokens / 840 ms" chip on the step itself, and no "most expensive step" affordance.
3. **Edit-and-re-run.** "Open in Playground" reopens any LLM call with exact messages/params
   for tweaking. We have a tool playground for *MCP tools* (schema→form→call) but no way to
   fork a run at a step with an edited prompt/model and get a linked derived run. Our replay is
   read-only.
4. **In-run search + list ergonomics.** Filter/search inside a big trace; customizable table
   previews. Long runs here mean scrolling; the console has cross-links (turn/error/trace) but
   no text search within a session.

## D5. Alerting — ❌ missing (needs local reinterpretation)

LangSmith: threshold alerts on run count / cost / errors / feedback / latency over 5–15 min
windows, with filters, historical preview, PagerDuty/Dynatrace/webhook channels.

Us: nothing evaluates a condition and notifies. The closest analogs are the dashboard's
"Needs attention" card (scans only, computed at render) and guardrails (which act *inside* one
run, not across runs).

A local single-owner bench does not need PagerDuty. It does need: "budget burn today crossed X",
"3 runs in a row failed on server Y", "suite mean score dropped vs baseline", surfaced in-app
(notification center / attention feed) with an optional generic webhook for people who want
Slack. LangSmith's *historical preview* pattern (show which past windows would have fired) is
worth copying outright; it makes thresholds tunable without alert fatigue.

## D6. Automation rules — ❌ missing

LangSmith: filter + sampling + action (annotation queue, dataset, webhook, retention, online
evaluator), with backfill. This is their workflow glue: production failures become datasets and
review queues *automatically*.

Us: the auto-rating pipeline is a single hard-wired "rule" (every terminal run → rate). There is
no user-defined "when a run matches F, do A": no auto-pin, no auto-collect into a collection,
no auto-notify, no promote-to-test. Given that we *are* a test bench, the killer translation is
**"failed run → regression test candidate in a collection"**, which LangSmith cannot do as
directly (their datasets are one hop away from being runnable tests; our collections/suites ARE
the runnable tests).

## D7. Automated quality signal — ✅ we lead on depth, ⚠️ behind on flexibility

| | LangSmith | Us |
|---|---|---|
| Default behavior | Opt-in online evaluators, sampled | **Mandatory** auto-rating on every terminal run (`ratingState` axis, migration v27): answer-vs-prompt verdict, insight surplus, error forensics |
| Judge infrastructure | Bring-your-own prompt/model, spend caps | CLI-first judge chain (Claude CLI → provider judge → deterministic-only) with graceful fallback (`grading/judge-chain.ts`) |
| Grader variety | LLM-as-judge + custom code evaluators | Six graders incl. deterministic (`rouge1`/planned `ai_pattern`, `value_match`, `tool_hygiene`, `trajectory_judge`, `skillflow_conformance`, `outcome_judge`) |
| Failure analysis | Feedback score says *that* it failed | Error forensics says *why*: 5 root-cause buckets + **skill/MCP-server fix targets with drafted fixes** (`grading/error-forensics.ts`, `failure-buckets.ts`) |
| Flexibility | Arbitrary evaluators, filters, sampling, per-evaluator spend limits, thread-level evals | Pipeline is fixed; judge settings exist but users cannot define new evaluators, target them by filter, sample, or cap spend per evaluator |

Our per-run verdict machinery is deeper than theirs. Their *configurability* (any evaluator, on
any slice, at any rate, under a budget) is ahead, and only matters here once rules (D6) exist.

## D8. Aggregate intelligence: Insights + Engine — ⚠️ foundation present, fleet layer missing

LangSmith Insights clusters up to 1,000 traces into categories with per-category error/latency/
cost/feedback metrics and an executive summary, on a schedule. LangSmith Engine goes further:
scans every 6 h, clusters failures into prioritized **Issues** with root cause, proposes fixes
(up to opening GitHub PRs), generates a regression evaluator + dataset per issue, and reopens
issues that recur.

We already produce, per run, richer raw material than their clustering input: forensics buckets,
fix targets, drafted fixes, judge verdicts, guardrail causes. We even persist a **Rating Issues
registry** (migration v26) and cluster errors *within* one suite run
(`suites/suite-report-service.ts`). What we lack is exactly the two things that make Engine
compelling:

1. **Cross-run aggregation over time** ("this same bucket fired on 14 runs across 3 suites since
   Tuesday, all pointing at server X's `search` tool").
2. **The closed loop**: issue → proposed fix → regression test → watch for recurrence. Note the
   pieces already in the house: the embedded Assistant has 23 read tools + an approval-gated
   write protocol including **skill edits as new immutable versions**; error forensics already
   drafts fixes; collections/suites are runnable regression tests. LangSmith's Engine ships fixes
   as GitHub PRs; ours could ship them as in-app skill versions and MCP-server config
   suggestions, and *prove* them by re-running the derived regression test. That is a stronger
   loop than a PR, and it is within reach of existing machinery.

## D9. Cost & token observability — ✅ ahead pre-run and in-run, ❌ behind across runs

| | LangSmith | Us |
|---|---|---|
| Before a run | Nothing | **Cost/context preview** at launch (`POST /api/estimate/run-plan`) |
| Inside a run | Per-span cost | Per-turn cost curve, context growth/composition, cached-vs-uncached, estimate-vs-actual (`AnalyticsPanel`) — deeper than their per-trace view |
| Token types | input/output + cache-read, cache-write, text, image, audio, **reasoning** | tokensIn/out + cachedTokens; no reasoning/cache-write split |
| Pricing | UI-editable map, regex model match, **activation dates**, cost never rewritten retroactively | Pricing hard-coded (`providers/pricing.ts`); changes require a code edit; no effective-dating |
| Across runs | Cost dashboards, per-thread rollups, org-wide unified cost view, Gateway spend limits | Suite cost totals only; no cost-over-time, no per-model/server/skill aggregation, no budget tracking |

## D10. Reporting & export — ✅ documents, ❌ recurrence and programmatic access

We generate real *documents*: run report (JSON/MD, judge donuts/radar in the console Report
tab), auto suite report with consistency variance + LLM agreement + error clustering, server/
scan reports. LangSmith has nothing equivalent as a narrative artifact; their "reporting" is
dashboards + scheduled Insights summaries + bulk export.

What they have that we lack: **scheduled/recurring** outputs (daily/weekly digests), **bulk
export** (S3/JSONL) and a **query API/CLI** with the same grammar as the UI (their Fetch CLI ≈
our planned `mcpfp` CLI, `roadmap/ci/`, not started), and **shareable links** (n/a single-user,
but exportable session bundles matter for "attach to a ticket/PR").

---

## Where we lead (keep these, build on them)

1. **Pre-flight economics.** Launch-time cost/context preview; guardrails with soft-stop cost
   caps; unpriced-model rejection. LangSmith only tells you what you already spent.
2. **Context-window science.** Per-turn context composition, growth-toward-limit, estimate-vs-
   actual by profile, cached-token split, MCP × model compatibility heatmap. Nothing comparable
   exists in LangSmith; for MCP development this is our identity.
3. **Judgment depth per run.** Mandatory auto-rating; six graders; CLI-first judge chain; error
   forensics with drafted, targeted fixes. Their online evals attach a score; ours attaches a
   diagnosis.
4. **Deterministic replay.** Full event persistence and replay of any run, including live
   late-join; runs are comparable artifacts, not log streams.
5. **Purpose-built comparison.** Compare workspace with Δ-matrix, LCS trace diff, verdict
   sentences, suite compare; skill-effect A/B. LangSmith's pairwise queues and baseline pinning
   are UI conveniences by comparison.
6. **The bench itself.** Failures can become *runnable* regression tests in the same product.
   LangSmith needs dataset→experiment→CI wiring for that loop; we own both ends.

## Priority reading of the gaps

Ordered by leverage for this product (argued in [`02-enhancement-concept.md`](./02-enhancement-concept.md)):

1. **D1 Metrics-over-time backbone** — unlocks dashboards, alerts, baselines, issues.
2. **D2 Search/filter/saved-views + FTS** — the daily-driver debugging gap.
3. **D8 Issues layer (Insights/Engine analog)** — highest differentiation; raw material exists.
4. **D4 Console depth** (hierarchy, per-step cost, re-run-from-step, in-run search).
5. **D5/D6 Watch rules** (in-app alerts + filter/sample/action automations, promote-to-test).
6. **D3 Sessions table** (after unified-run-sessions Wave 1 lands).
7. **D9/D10 remainder** (pricing UI, token-type detail, scheduled digests, export/CLI).
