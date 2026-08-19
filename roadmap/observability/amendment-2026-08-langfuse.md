# Amendment — Langfuse & landscape imports (2026-08-18)

**Status: PROPOSED — pending owner lock.** Additive design imports into the locked
observability plan, derived from [`research/langfuse-landscape/`](../../research/langfuse-landscape/)
(Langfuse post-v4 + Phoenix/Opik/Braintrust/Weave, all facts fetched 2026-08-18). Amendment
items are numbered **AM-OB1…AM-OB14** to avoid colliding with the owner-locked D-OB1–28
sequence; on owner lock they may be renumbered into D-OB29+ or absorbed into their target
WP's acceptance criteria — whichever the owner prefers.

**Ground rules of this amendment:** nothing here removes or modifies a locked D-OB decision;
the phase order and the D-OB27/28 sequencing (after Unified Sessions Waves 1–3) are
untouched; every item is droppable individually at owner review; items that only sharpen an
existing WP are phrased as **acceptance criteria**, not new scope. One new WP is proposed
(WP-3.5, separate file). Research evidence per item is cited as `01 §G*n*` /
`03 §…` (the gap-analysis and charts docs in the research bundle).

## Summary table

| Item | Target | Kind | One-liner |
|---|---|---|---|
| AM-OB1 | WP-1.1 RunFilter + WP-1.4 saved views | acceptance | Full filter state serializes into the URL |
| AM-OB2 | WP-1.5 feedback primitive + WP-2.5 feedback UI | field | "Corrected output" as a feedback kind |
| AM-OB3 | WP-2.1/2.2 dashboards | acceptance | Every chart element click-throughs to the filtered runs feed; charts deep-linkable |
| AM-OB4 | WP-2.2/2.7 metrics | metric type | Ratio metric (numerator/denominator, each with own filter) |
| AM-OB5 | WP-2.3 runs-feed upgrade | feature | Pulse-style sqrt-scaled outlier strip over the feed |
| AM-OB6 | WP-2.6 pricing editor | scope+ | Usage-type taxonomy, tiered prices, price-drift check, ingested-cost precedence |
| AM-OB7 | WP-2.7 chart composer | spec | Widget grammar + starting chart-type set (incl. histogram, pivot, radar) |
| AM-OB8 | WP-3.2 console economics | feature | Metric-scaled Gantt + cache-segment stacked bars |
| AM-OB9 | Phase 3 (new WP-3.5) | new WP | Agent graph lens over a run (aggregated/expanded) |
| AM-OB10 | WP-4.1/4.2 watch rules | spec | Dual WARNING/ALERT thresholds + explicit rule state machine |
| AM-OB11 | WP-4.1 channels | channel | GitHub Actions `workflow_dispatch` as a rule action |
| AM-OB12 | WP-4.2 windowed rules | metric | Boolean share-true metrics over grades/ratings |
| AM-OB13 | WP-4.3 notification center | feature | Per-run manual "send to webhook" action |
| AM-OB14 | Phase 5 issues UI | viz guidance | Occurrence sparkline + distribution bars; no embedding scatter |

## Items

**AM-OB1 — URL-serialized filter state (WP-1.1, WP-1.4).** The entire RunFilter expression +
saved-view state must round-trip through the URL, so any filtered view is a shareable,
bookmarkable link (evidence: Langfuse filter search bar, `01 §G2`; consistent with
`.claude/rules/routes-vs-dialogs.md` D-TB10). Acceptance: paste a URL → identical
filter/table state; saved views are URLs plus a name.

**AM-OB2 — Corrected output as feedback (WP-1.5, WP-2.5).** Alongside verdict/note feedback,
allow storing an owner-corrected final answer on a run (Langfuse "Corrected Outputs",
`01 §G7`). It is feedback data, never a grade (AR6 intact), and it is the highest-value
input to promote-run-to-test: the corrected answer becomes the expectation of the derived
regression test.

**AM-OB3 — Chart→feed drill-down + deep-linkable charts (WP-2.1, WP-2.2).** Acceptance
criteria for every dashboard panel: clicking a datapoint/bar/legend entry navigates to the
runs feed with the equivalent RunFilter applied (time bucket + series constraints), and every
chart state is URL-addressable. All four serious competitors ship this grammar
(`03 §Cross-cutting-3`); a chart without click-through is below the 2026 bar.

**AM-OB4 — Ratio metric type (WP-2.2, WP-2.7).** A metric defined as numerator/denominator,
each with its own filter (LangSmith, `03 §2`): error rate, judge-disagreement share,
skill-attach share, cache-hit share. Cheap in the metrics endpoint; disproportionate value
for a test bench where rates matter more than counts.

**AM-OB5 — Outlier strip over the runs feed (WP-2.3).** A one-row bar strip above the feed:
adaptive time buckets, **square-root height scale**, metrics count / cost / p95 duration;
click a bucket → feed filtered to it; drag → range (Langfuse Pulse, exact spec in
`03 §1`). Needs only the WP-1.2 metrics endpoints — no dashboard composer. Empty buckets
render as gaps on a flat baseline.

**AM-OB6 — Pricing editor scope+ (WP-2.6).** Four additions from Langfuse's cost model
(`01 §G9`): (a) extend the run-step usage taxonomy with `reasoning`, `cache_write`,
`audio`, `image` token types (additive columns; estimate-vs-actual currently blind to
reasoning); (b) support **context-dependent price tiers** (condition on input size /
model params), not just flat price + effective date; (c) a gate-adjacent **price-drift
check** that diffs the pricing table against provider price pages and files a rating-issue
on drift; (d) provider-**ingested costs take precedence** over inferred costs when a
provider returns authoritative usage cost.

**AM-OB7 — Chart composer spec (WP-2.7).** Adopt the composer grammar
`data source → metric(+aggregation) → dimensions → filters → chart type` (Langfuse widget
model, `03 §1`). Starting type set: line/area/bar time-series, ranked horizontal bar,
number, **histogram** and **pivot table** (score analytics), **radar** (multi-grader
comparison — the Report tab already ships a radar primitive). "Any table is a chart":
optional toggle on the runs feed reusing the same grammar. All parts from
`@elabs-ai/components-*` per the brand-ui rule; missing chart primitives are upstream gaps
to raise, not hand-rolls (`03 §Mapping`).

**AM-OB8 — Metric-scaled Gantt + cache segments (WP-3.2).** The console Gantt gains a
**"scale bars by"** selector: duration (default), tokens in/out, estimated cost — and an
optional per-step stacked segment view splitting uncached input / cache read / cache write /
output with per-step cache-hit rate (Braintrust timeline, `03 §5`). Pairs with AM-OB6's
usage taxonomy; degrade gracefully where token types are absent.

**AM-OB9 — WP-3.5 agent graph lens (new WP).** See
[`phase-3-console/WP-3.5-agent-graph.md`](./phase-3-console/WP-3.5-agent-graph.md).
Sequenced strictly after WP-3.1 (needs `parentStepId`); reuses the `@xyflow/react` stack
already vendored for SkillFlow (`01 §G4`, `03 §Mapping`).

**AM-OB10 — Rule thresholds + state machine (WP-4.1, WP-4.2).** Windowed rules carry an
optional WARNING threshold below the required ALERT threshold, and rules have an explicit
state machine — `UNKNOWN → OK / WARNING / ALERT / NO_DATA / PAUSED` — with configurable
no-data handling and a renotification interval for sustained conditions (Langfuse monitors,
`01 §G5`). Cheap at design time, expensive to retrofit; NO_DATA is load-bearing for a bench
where "no runs happened" is itself signal.

**AM-OB11 — GitHub Actions channel (WP-4.1).** A rule action that fires
`workflow_dispatch` on a configured repo/workflow (token from the `roadmap/ci/` service-token
store). Closes the loop "regression detected → CI re-runs the suite" with zero new infra;
keep the generic-webhook action as the base primitive (D-OB's one-webhook stance holds —
this is a typed convenience on top of it, droppable if the owner reads it as a second
channel).

**AM-OB12 — Boolean share-true metrics (WP-4.2).** Windowed rule metrics over boolean
grades/ratings expressed as share-true rates ("hallucination-flag rate this week",
"answer-validation pass rate"), mirroring numeric aggregations (Langfuse boolean score
metrics, `01 §G5`).

**AM-OB13 — Per-run "send to webhook" (WP-4.3).** A manual action on any run/suite-run:
POST its identifiers + report link to one of the admin-configured webhook endpoints
(Langfuse Web Callouts, `01 §G6`). Reuses the watch-rules webhook config; ~day-scale;
outsized attach-to-ticket utility.

**AM-OB14 — Issues-layer visuals (Phase 5).** Per-issue **occurrence-over-time sparkline**
(Opik diagnostics) and per-bucket **distribution bars** (LangSmith Insights) as the issue-list
visual grammar; explicitly skip embedding-scatter topic visualizations (Braintrust) — our
clustering is deterministic over forensics buckets and needs no embedding step
(`03 §Cross-cutting-5`, `01 §G8`).

## Explicitly validated, no change

WP-1.2 metrics endpoints, WP-1.3 FTS, WP-3.3 fork-from-step (Langfuse "open in playground" /
Phoenix "span replay" confirm the shape), WP-3.4 in-run search, WP-4.5 review-queue lite
(annotation queues everywhere; queue-lite remains right-sized for single-owner), WP-5.1–5.5
issues layer (shipped Langfuse has no equivalent; Braintrust Topics / LangSmith Engine are
the reference points — see research `02 §Reading-3`).

## Out of scope of this amendment

The workbench MCP server (own plan: [`roadmap/ci/mcp-server.md`](../ci/mcp-server.md));
judge-preview + re-rate window ([`roadmap/auto-rating/wp-judge-preview-and-rerate.md`](../auto-rating/wp-judge-preview-and-rerate.md));
compare/launcher follow-ons ([`roadmap/testing/wp-compare-launcher-followons.md`](../testing/wp-compare-launcher-followons.md));
OTLP export + MCP `_meta` context propagation (one-page specs on file in research
`01 §G12`, no WP).
