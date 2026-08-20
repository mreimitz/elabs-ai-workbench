---
type: "Research Note"
title: "01 \u2014 Gap analysis: Langfuse vs. this app"
description: "Comparison across twelve dimensions, then the honest inverse (where this app is ahead), then a"
tags: ["research", "RS-05"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# 01 — Gap analysis: Langfuse vs. this app

Comparison across twelve dimensions, then the honest inverse (where this app is ahead), then a
priority reading. Langfuse claims are sourced in
[`00-langfuse-feature-inventory.md`](./00-langfuse-feature-inventory.md); "us" claims come from
the `CLAUDE.md` capability table, the `roadmap/*/STATUS.md` ledgers, and the
[`../langsmith-observability/`](../../RS-04-langsmith-observability/) research (2026-07-16), whose file
references were verified then. Workbench state as read on 2026-08-18.

**Context that shapes every verdict:** Langfuse observes *production traffic* for many teams;
we are a *local, single-owner test bench* for MCP servers and skills. Multi-region ingest,
per-user cost attribution, RBAC/SCIM, and 50M-install SDK distribution do not transfer. What
does transfer is the same thing that transferred from LangSmith: the shape of the questions
("is it getting worse?", "show me the ones that matter") — plus, uniquely with Langfuse, an
**architecture comparison** (they are the leading self-hostable OSS platform, so their
build/buy calculus is real, not hypothetical).

**How this relates to the LangSmith analysis:** the observability roadmap
([`roadmap/observability/`](../../../Roadmap/RM-17-observability/), D-OB1–28) and unified sessions
([`roadmap/unified-sessions/`](../../../Roadmap/RM-29-unified-sessions/), D-US1–15) were derived from the
LangSmith gaps. So the interesting question here is not "does Langfuse expose gaps" (mostly the
same ones) but **"does Langfuse change the plan"**: each dimension below carries a *plan status*
— `planned` (a locked WP covers it), `plan+` (planned, but Langfuse adds a pattern worth
folding in), or `net-new` (no plan covers it).

> **Correction (2026-08-19), after reading the authoritative ledgers:** the CLAUDE.md
> capability table this doc relied on was a month stale — `roadmap/observability/STATUS.md`
> records **all 27 WPs (Phases 1–5) built and merged to local `main` on 2026-07-17** (on the
> completed unified-sessions contract; owner-acceptance pending; not pushed to origin), and
> `roadmap/advisor/STATUS.md` records **Advisor Phases 1–2 built 2026-08-18**. Read every
> `planned (D-OB…)`/`planned (D-US…)` annotation below as **built — verify the shipped
> surface**; the amendment routing these imports was reframed accordingly
> ([`amendment-2026-08-langfuse.md`](../../../Roadmap/RM-17-observability/amendment-2026-08-langfuse.md)).

Verdicts: ✅ we lead · ≈ rough parity · ⚠️ partial · ❌ missing. LangSmith-dimension
cross-references as (LS D*n*).

---

## G1. Fleet metrics over time — ❌ missing · planned+ (LS D1)

Langfuse: 3 curated + fully custom dashboards (histogram/pivot widgets, group-bys,
drill-down), Metrics API v2, dashboards-as-code via API/CLI/MCP, Home-as-dashboard, "any table
is a chart", and **Pulse** — an outlier strip above the observations table (sqrt-scaled
buckets, click-to-filter). Us: unchanged since the LangSmith analysis — nothing has a time
axis across runs.

Plan status: the D-OB metrics-over-time backbone covers dashboards/drill-down. **Fold in from
Langfuse:** Pulse is the cheapest useful surface of the whole family — a one-row outlier
strip over the runs feed (count/cost/p95 latency, click-to-filter) needs only the metrics
backbone, no dashboard composer; and "any table is a chart" is a cheap grammar for the D-OB
custom-chart WP. Home-as-dashboard matches the planned Dashboard tab growth.

## G2. Search, filtering, saved views — ❌ missing · planned+ (LS D2)

Langfuse: ClickHouse-native FTS over trace I/O; a `field:value` filter grammar with
comparison/wildcard/negation/dot-path operators; **the whole query serializes into the URL**;
saved shared views; "Ask AI" NL→filter drafting. Us: unchanged — no FTS, no filter grammar.

Plan status: D-OB covers SQLite-FTS5 + the `RunFilter` grammar + saved views. **Fold in:**
(1) URL-serialization of the filter grammar — this is exactly our routes-vs-dialogs rule
(D-TB10) applied to filters, and Langfuse proves it works at production scale; make it a
stated acceptance criterion of the RunFilter WP. (2) NL→filter is nearly free for us: the
embedded Assistant already has read tools and the route manifest; a `runfilter_draft` tool is
a small addition once the grammar exists — a rare case where our Assistant infrastructure
makes a Langfuse Cloud-only beta trivially self-hostable.

## G3. Sessions, environments, users — ⚠️ partial · planned (LS D3)

Langfuse: sessions group traces with session-level scores and cost; users get per-user cost;
**environments** (prod/staging/dev) filter everywhere. Us: interactive runs exist; the
unified-sessions contract (D-US) is the prerequisite fix; the D-OB sessions table adds the
monitoring lens. Users don't transfer (single owner). Environments largely map to what we
already renamed Scenario→**Environment** in Testing IA — our environments are richer
(server+skill compositions), theirs are just a filter dimension.

Plan status: covered; no change from Langfuse.

## G4. Inside one run — ≈ parity · plan+ with one net-new item (LS D4)

Where we still match or beat Langfuse per run: live streaming console with full replay,
per-turn context composition/growth charts, estimate-vs-actual, hotspots, mandatory run
report. Where Langfuse is better inside one trace:

1. **Hierarchy** — their tree with per-subtree cost/latency rollups vs our flat `run_steps`.
   Planned (D-OB console depth: `parentStepId`, per-step economics).
2. **Open in Playground / edit-and-re-run** — planned (fork-from-step with
   `derivedFromRunId`).
3. **In-run search** — planned (D-OB in-run search).
4. **Agent graph view — net-new.** Langfuse auto-infers a graph from agentic observation
   types, with an *Aggregated* mode (repeated steps collapsed, loops as cycles — the run's
   shape) and an *Expanded* mode (unrolled execution). Nothing in our plan renders a run as a
   graph. We already have graph machinery (`@xyflow/react` via SkillFlow) and SkillFlow's
   Design/Trace tabs prove the two-lens idea *for skills*; the analog for *runs* (turn/tool
   nodes from `run_steps`, loops collapsed) would slot naturally beside the console's
   conversation lens — but it wants the D-OB step hierarchy first. File as a console-depth
   follow-on WP, not a new workstream.

## G5. Alerting — ❌ missing · planned+ (LS D5)

Langfuse Monitors & Alerts (Jun 2026): observation/score aggregations with a required ALERT +
optional WARNING threshold, 1h/1d/1w lookbacks, a real state machine (UNKNOWN/OK/WARNING/
ALERT/NO_DATA/PAUSED), no-data modes, renotification intervals; channels Slack, HMAC webhook,
**GitHub Actions `workflow_dispatch`** — notably no email. Plus org-level spend alerts.

Plan status: D-OB watch rules (on-terminal + windowed, in-app notification center + one
generic webhook) cover the core. **Fold in:** (1) the dual WARNING/ALERT threshold + explicit
state machine (incl. NO_DATA and PAUSED) — cheap to adopt at design time, expensive to
retrofit; (2) GitHub Actions as a *channel* — for us that pairs beautifully with
`roadmap/ci/`: a watch rule that dispatches a workflow closes the loop "regression detected →
CI re-runs the suite" with zero new infra; (3) boolean-score share-true metrics ("hallucination
rate") map directly onto our grade/rating booleans.

## G6. Automation rules — Langfuse is weak here · our plan already exceeds it (LS D6)

Langfuse has **no** filter→action automation: Web Callouts are *manual* per-trace HTTP POSTs,
and their own comparison page concedes automated failure clustering/fixes to LangSmith Engine.
Our planned promote-run-to-test, watch rules, and the rating-issues→Assistant fix loop would
exceed shipped Langfuse the day they land. One idea worth keeping: Web Callouts' "send this
trace somewhere" is a two-hour feature (per-run webhook button reusing the watch-rule webhook
config) with outsized attach-to-ticket utility.

## G7. Evaluation & human signal — ✅ depth, ⚠️ configurability · plan+ (LS D7)

| | Langfuse | Us |
|---|---|---|
| Default behavior | Opt-in evaluators, sampled | **Mandatory** auto-rating on every terminal run |
| Failure analysis | Score says *that* it failed | Error forensics says *why* + drafted, targeted fixes |
| Judge infra | Any tool-calling model via LLM Connections | CLI-first judge chain with provider + deterministic fallbacks |
| Configurability | User-defined evaluators, **observation-level targeting** by filter, deterministic + consistent sampling, live preview on last-24h data | Fixed pipeline; judge settings only |
| Deterministic checks | **Code evaluators** on live observations (server-side sandbox, May 2026) | Six graders incl. deterministic — but bound to expectations/rating, not user-composable |
| Human signal | Annotation queues w/ assignments, session items; browser-side public-key feedback; Corrected Outputs; TEXT scores | None today; D-OB human-feedback backbone + review-queue lite planned (feedback never blends into grades, AR6) |

Same verdict as against LangSmith: our per-run judgment is deeper; their *configurability*
(define an evaluator, target it by filter at observation granularity, sample it, preview it)
has no planned equivalent — D-OB adds human feedback and issue-level LLM assist, not
user-defined evaluators. That stays a **known, accepted gap** (single-owner bench; our graders
are curated, not crowd-configured) — but two imports are cheap: **live preview** ("this
evaluator would have matched these 12 recent runs") when editing judge settings, and
**Corrected Outputs** as a field on the planned human-feedback backbone (an expert-fixed
answer is the highest-value feedback datum and feeds future regression tests).

## G8. Aggregate intelligence — ✅ we lead on plan, ≈ on shipped (LS D8 — inverted!)

The LangSmith analysis found Insights/Engine "meaningfully ahead". **Langfuse has no
equivalent shipped**: no clustering, no issue registry, no automated fix proposals — it's on
their roadmap ("proactive issue detection", in progress). What they ship instead: the
**Langfuse Assistant** (NL Q&A over traces via their own MCP tools, Cloud-only beta) and Pulse.

Us: the v26 rating-issues registry + error forensics already persist richer per-run raw
material than Langfuse captures at all, and the D-OB fleet-issues layer (deterministic
clustering + auto-reopen + owner-initiated Assistant fix loop) would leapfrog shipped
Langfuse. Meanwhile our embedded Assistant + assistant-operability gate already deliver the
"talk to your observability data" story — locally, with write tools and approval gates,
which their Cloud-only beta doesn't have. This dimension flipped from "they lead" (LangSmith)
to "we lead on substance, they lead on ship date of the chat surface".

## G9. Cost & token observability — ✅ pre-run/in-run, ❌ across runs · plan+ (LS D9)

Unchanged leads: launch-time cost/context preview, per-turn cost curve, cached split,
unpriced-model rejection, compatibility heatmap. Unchanged gap: nothing across runs (planned).

Where Langfuse raises the bar **above the planned pricing-editor WP**:

1. **Usage-type taxonomy**: input/output/cached + `cache_read`, `audio`, `image`,
   `reasoning`. We track tokensIn/out/cached only — reasoning tokens are now a first-class
   cost driver and our estimate-vs-actual science is blind to them. Extend the run-step usage
   schema when the pricing editor lands.
2. **Context-dependent pricing tiers** (different rate above an input-size threshold,
   condition-evaluated): the planned editor is flat price-per-model with effective dates.
   Tiered pricing is exactly the kind of thing a *token-footprint* product should model
   correctly — arguably more on-brand for us than for them.
3. **Daily automated price audit** against provider docs — our analog: a CI job diffing
   `pricing.ts` (later the pricing DB) against provider price pages, filing a rating-issue on
   drift.
4. Ingested-costs-take-precedence is a good rule for us too once providers return
   authoritative cost in responses.

## G10. Reporting, export & the programmatic surface — ✅ documents, ❌ surface · one headline net-new (LS D10)

We still generate the better *narrative artifacts* (run/suite reports with judge donuts,
consistency variance, error clustering; scan/server reports). Langfuse's strengths are the
surfaces around the data:

| | Langfuse | Us | Plan status |
|---|---|---|---|
| Public API | Full CRUD, OpenAPI, v2 pagination | Internal `/api`, no service tokens | planned (`roadmap/ci/` Phase 1) |
| CLI | Langfuse CLI "built for AI agents" (Feb 2026) | `mcpfp` CLI planned | planned |
| Scheduled data export | Parquet/CSV/JSONL to S3/GCS/Azure on a schedule | JSON/MD documents on demand | partially planned (D-OB digest is a *report*, not a data export) — low local value, skip for now |
| **MCP server over the product** | **Hosted + self-hostable MCP server: prompts, observations, metrics, scores, evaluators, experiments, dashboards — read+write; Claude Code/Codex/Cursor as first-class clients** | **None** | **net-new — see priority reading** |

The MCP-server row is the sharpest finding in this research. Every serious platform in this
space now exposes itself over MCP (Langfuse, Phoenix, Opik, Braintrust, W&B — see
[`02-alternatives-landscape.md`](./02-alternatives-landscape.md)) — and *we are the MCP
workbench*. An external coding agent (Claude Code working in a skill repo, our own `/next-wp`
flows) cannot ask the bench "what did the last scan of server X cost, and which runs failed
since?". We already have the two hard parts: a complete typed API contract
(`packages/shared`) and 23+ Assistant read tools with an approval-gated write protocol —
an MCP server is largely a re-projection of those tools onto a second, standards-based
surface, with service tokens from the CI workstream as the auth story.

## G11. Prompt management — n/a by scope, with two honest notes

Langfuse's flagship. For us, the unit of iteration is not a prompt string serving production
traffic — it's a **skill** and a **server config**, and there we already have the analogous
machinery, arguably deeper: immutable skill versions with full-tree diff, GitHub two-way sync,
latest-vs-pinned attachment (their label pinning), skill-effect A/B in Benchmarks (their A/B
testing), SkillFlow/Skill IDE (no Langfuse analog at all). Honest notes: (1) scenario/test
prompts are plain rows — no versioning/diff; if prompt iteration inside tests becomes a real
workflow, steal the label/version model; (2) their playground's **side-by-side multi-variant
execution** has no analog in our launcher — the compare workspace covers post-hoc comparison,
but "run variants A/B of a test config in one gesture" is a small, real launcher upgrade
(and it composes with the existing estimate preview).

## G12. Ingestion & interop — different species, one strategic option

Langfuse is OTel-native (SDKs are OTel under the hood; OTLP endpoint; ~100 integrations;
W3C context through MCP `_meta`). We deliberately generate our own runs — we're the harness,
not the listener; the owner already decided against external-session ingest once (SkillFlow
external JSONL upload removed, D6 amendment 2026-07-03). Two bounded options short of
reversing that: **(a) OTLP/JSONL export of runs** in a standard GenAI-semconv shape, so a
bench run can be *handed to* any Langfuse-class tool (cheap goodwill + escape hatch, fits the
reports family); **(b) adopt the `_meta` W3C-context propagation trick** inside our own MCP
client so future step hierarchy can attribute server-side sub-spans if a server emits them.
Neither is urgent; both are one-page specs worth having on file.

---

## Where we lead (vs Langfuse specifically)

1. **The entire pre-flight identity.** Nothing in Langfuse measures tool-definition footprint,
   scans/diffs MCP server surfaces, checks schema-vs-model limits (compatibility heatmap),
   inspects skill token cost (L1/L2/L3) or security surface, or previews cost before a run.
   Langfuse starts recording when traffic exists; we exist so problems die before traffic.
2. **Judgment depth per run** — mandatory rating + error forensics with drafted fixes vs
   opt-in scores (G7).
3. **The closed loop** — failing run → tracked issue → drafted fix → Assistant applies (gated)
   → suite re-run proves it. Langfuse has no rules engine, no fix loop (G6, G8).
4. **Deterministic replay + purpose-built comparison** — full-event replay; Δ-matrix, LCS
   trace diff, verdict sentences, suite compare. Langfuse has no trace-vs-trace comparison.
5. **Deployment weight for a single owner** — one container + SQLite vs web+worker+Postgres+
   ClickHouse+Redis+S3. Their minimum footprint is a cluster; ours is a laptop.
6. **Benchmarks as tests** — collections/suites are runnable regression tests with grades;
   their datasets/experiments need external runners for agent code (their remote-trigger
   feature outsources exactly what our run engine *is*).

**Threat vector to watch:** "Langfuse for Agents" is creeping toward our territory from the
production side — agentic observation types, tool-call filters/widgets/evaluator access,
agent graphs, trajectory evals + Gateway on their roadmap, MCP tracing. None of it does
pre-flight analysis, but the *vocabulary* overlap (tools, agents, MCP) will grow, and
post-acquisition they have ClickHouse-scale resources. Our moat is the bench semantics
(measure → test → grade → fix → prove), not the trace viewer.

## Priority reading of the gaps

1. **Confirm the D-OB/D-US plan unchanged** — Langfuse independently re-validates the
   LangSmith-derived priorities (metrics backbone, FTS+filter grammar, watch rules, console
   depth, sessions table). No re-planning needed; proceed.
2. **Net-new headline: an MCP server over the workbench** (G10) — re-project the Assistant
   tool surface + shared contract over MCP with service-token auth; feeds `roadmap/ci/`
   Phase 1 (tokens) and pairs with `mcpfp`. "The MCP bench is MCP-operable" is both a real
   workflow (Claude Code ↔ bench) and the single best positioning line this research found.
3. **Design-time imports into locked WPs (cheap now, costly later):** WARNING/ALERT dual
   thresholds + NO_DATA/PAUSED states + GitHub-Actions channel into the watch-rules WP (G5);
   URL-serialized filters as an acceptance criterion of the RunFilter WP (G2); Pulse-style
   outlier strip + table→chart into the dashboard WPs (G1); reasoning/cache-write usage types
   + tiered pricing into the pricing-editor WP (G9).
4. **Agent graph view over runs** — console-depth follow-on after `parentStepId` (G4).
5. **Small, high-leverage singles:** per-run "send to webhook" (Web Callouts analog, G6);
   Corrected-Outputs field on the feedback backbone (G7); NL→filter Assistant tool once the
   grammar exists (G2); launcher A/B variant execution (G11).
6. **On file, no action:** OTLP export spec + `_meta` context propagation note (G12);
   scheduled blob exports (G10) — revisit only if the team-server future materializes.

# Citations

None.
