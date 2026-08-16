# Observability — plan (session contract → metrics/search backbone → monitoring → console depth → watch rules → fleet issues)

**Status:** planned, HIGH priority — starts **after [`roadmap/unified-sessions/`](../unified-sessions/)
Waves 1–3 merge** (D-OB27/28; the un-gated WPs below may start sooner). Authoritative in-flight
state: [`STATUS.md`](./STATUS.md) (driven by `/next-wp observability`). Shared rules:
[`conventions.md`](./conventions.md). Orchestrator start:
[`kickoff-prompt.md`](./kickoff-prompt.md).

> **Reconciliation note (2026-07-16):** this plan originally carried a Phase 0 that folded the
> unified-run-sessions concept in. A parallel owner session locked that scope separately as
> [`roadmap/unified-sessions/`](../unified-sessions/) (**D-US1–D-US15**). The owner ruled:
> **D-US wins wholesale**; Phase 0 + the SSE WP were dropped from this plan (specs preserved
> under [`_superseded/`](./_superseded/)). This plan **consumes** the session contract —
> `stopReasonCode` (incl. `stalled` / `wait_expired` / `session_ended`), persisted `phase`,
> `capabilities_json`, `activeDurationMs`/`totalDurationMs`, the `ended` terminal + `seen`
> disposition, the one status module — and never redefines it.

**Research basis (read before re-litigating anything):**
[`research/langsmith-observability/`](../../research/langsmith-observability/) (feature
inventory, gap analysis, concept waves O1–O5, Q-OB1–13) and
[`research/unified-run-sessions/`](../../research/unified-run-sessions/) (session-contract
concept C1–C5, Q1–Q12 — implemented by [`roadmap/unified-sessions/`](../unified-sessions/), which
this plan consumes).

## Mission

Close the gaps LangSmith exposed, in this app's local single-owner idiom — on top of the session
contract that `roadmap/unified-sessions/` ships: a metrics + full-text-search backbone over runs and scans; a time-axis monitoring
dashboard with drill-down; deeper single-session debugging (hierarchy, per-step economics,
fork-from-step); watch rules with in-app notifications; and a fleet issues layer that turns the
existing error-forensics/rating machinery into a detect → diagnose → fix → regression-test loop.
Where LangSmith ends at "open a PR", this app closes the loop by proving the fix on the bench.

## Locked decisions (owner, 2026-07-16)

| # | Decision |
|---|---|
| D-OB1 | Scope: full concept in one workstream (Phases 1–5 after reconciliation). Later phases gate on earlier; stopping after any phase leaves a coherent product. |
| D-OB2–D-OB10 | **Superseded (2026-07-16) by D-US1–D-US15** in [`roadmap/unified-sessions/`](../unified-sessions/README.md). The session contract (lifecycle/phases, `ended` terminal + `seen`, stall-based clock with NO default wall cap + 10-min wait budget → `wait_expired`, capability manifest, status vocabulary, queue visibility, SSE cursor resume, timer defaults) is owned there. Where this plan's earlier text conflicts (End-session→completed, Extend button, wall-cap default), **the D-US table wins**. |
| D-OB11 | IA: the **Dashboard grows tabs — Scans \| Testing \| Issues**. Nav stays 4 items. |
| D-OB12 | Entity scope v1: **runs + scans**. Assistant-dock sessions out of scope (revisit with unified Q11). |
| D-OB13 | Metrics computed **on demand** (SQL + indexes), perf acceptance <500 ms @ 50k synthetic runs; a rollup-cache WP exists only as owner-gated backlog if profiling fails. |
| D-OB14 | Chart honesty: token/cost measures **split into marked series by capability/cost-basis**; never blended sums. `meanScore` = primary-grader priority, as suite analytics. |
| D-OB15 | Human feedback: full primitive (`run_feedback` on runs + assistant turns), filterable, console thumbs/notes — a **separate lens**, never blended into grades/aggregates (AR6 intact). |
| D-OB16 | FTS5 index over: prompts + assistant text, tool names + args, tool results (hard-truncated, skip binary), errors + stopReason + judge verdicts + forensics text. Rebuildable. |
| D-OB17 | Step hierarchy: **wire-level `parentStepId` (+`spanKind`), forward-only**; old runs render flat. |
| D-OB18 | Re-run: **fork from step + overrides** (prompt/model/temperature/skillVersion) → derived run with `derivedFromRunId` lineage; suite members can't fork; derived runs excluded from suite aggregates and marked in the feed; launch goes through the estimate preview. |
| D-OB19 | Alerts: on-terminal rules AND windowed threshold rules with **catch-up-on-boot** ticker + historical preview before save. Channels: **in-app notification center + one generic webhook** (secret-store URL). No PagerDuty/Dynatrace/email/OS notifications. |
| D-OB20 | Issues: **extend the existing rating-issues registry** (one concept) with clustering key, occurrences, first/last seen, affected entities, lifecycle `open/resolved/regressed` + auto-reopen. **Deterministic clustering first; LLM assist opt-in** (CLI-first judge chain, own concurrency + cost ledger). Assistant fix loop **owner-initiated only**; every write stays behind D-AS4 approval. |
| D-OB21 | Promote-to-test ships **with the rules phase** (console button + rule action), not earlier. |
| D-OB22 | Extras all in scope: **pricing editor** (DB + Settings UI, regex match, effective dates, never rewrites past costs), **review queue lite** (no reservations), **custom chart composer**, **scheduled digest report**. |
| D-OB23 | Model map mirrors auto-rating: Opus 4.8 orchestrator + judgment/high-blast-radius WPs; Sonnet for well-specified WPs; Haiku read-only fan-outs only. Per-WP assignment below. |
| D-OB24 | Kickoff includes a **contention override** (contested surfaces serialized; ask owner before claiming them). One migration-bearing WP in flight at a time. |
| D-OB25 | Priority: next major workstream, ahead of illustrations/CI in sequencing. CI/`mcpfp` later reuses the WP 1.1 filter grammar. |
| D-OB26 | Names *(adopted defaults, labels only)*: plan folder `roadmap/observability/`; Dashboard tabs "Scans" / "Testing" / "Issues"; the interactive lens is a filter view labelled **"Sessions"** (D-US11: session = interactive container, run = automated execution; labels only, the wire stays `runs`). |
| D-OB27 | **Reconciliation:** D-US1–D-US15 win wholesale over this plan's earlier Phase-0 decisions; Phase 0 + the SSE WP dropped (specs in `_superseded/`); this plan consumes the unified-sessions contract, never redefines it. |
| D-OB28 | **Sequencing:** `roadmap/unified-sessions/` Waves 1–3 run first; observability starts after they merge (un-gated WPs — 2.6 — may run in the window). |

**Also adopted as defaults** (veto before the relevant WP starts): the interactive lens label is
"Sessions" per D-US11 (wire stays `runs`); dashboard tab labels Scans | Testing | Issues.

**Non-goals (recorded):** SmithDB-scale storage, OTel ingest (OTel *export* is a future note),
multi-tenant/RBAC/public share links (team-server owns later), PagerDuty/Dynatrace/email,
reservations/multi-annotator review, blending human feedback into grades, LangSmith-style
unattended fix generation (Engine autonomy beyond D-OB20).

## Phases & work packages

Ledger: [`STATUS.md`](./STATUS.md). Specs: `phase-*/WP-<id>-*.md`. Sizes S/M/L. Model per D-OB23.

### Phase 1 — Backbone (filter grammar, metrics, search, views, feedback, retention)

*Gate: WPs marked ⛩ are owner-gated until `roadmap/unified-sessions/` **Wave 1** is merged (they consume `stopReasonCode`, `phase`, `capabilities_json`, the duration split).*

| WP | Title | Size | Depends | Model |
|---|---|---|---|---|
| 1.1 ⛩ | `RunFilter` grammar (shared zod) + structured filters on `GET /api/runs` | M | — | Opus |
| 1.2 ⛩ | Metrics endpoints `/api/metrics/{runs,scans}` (buckets, groupBy, capability-split measures) + indexes | L | 1.1 | Opus |
| 1.3 | FTS5 search index + backfill + `q=` param + reindex maintenance | L | 1.1 | Opus |
| 1.4 | Saved views (`run_views` CRUD) | S | 1.1 | Sonnet |
| 1.5 | Feedback primitive (`run_feedback` + API, runs + assistant turns) | M | 1.1 | Sonnet |
| 1.6 | Retention classes: `pinned` flag + class-aware prune | S | 1.1 | Sonnet |

### Phase 2 — Monitoring surfaces (web)

| WP | Title | Size | Depends | Model |
|---|---|---|---|---|
| 2.1 | Dashboard → tabs restructure (Scans tab = current content; Testing tab shell; routes) | M | 1.2 | Sonnet |
| 2.2 | Testing dashboard prebuilt panels + chart→feed drill-down | L | 2.1 | Sonnet |
| 2.3 | Runs feed upgrade: filter bar, FTS box, saved views, URL state, column/preview chooser | L | 1.3, 1.4 | Sonnet |
| 2.4 ⛩ | Sessions lens (turn count, waiting vs active, phase chip, `seen`, p50/p95) | M | 2.3 | Sonnet | 
| 2.5 | Feedback UI: console thumbs/notes + feed chips + filter | M | 1.5, 2.3 | Sonnet |
| 2.6 | Pricing editor: pricing map → DB + Settings UI (regex, effective dates) | M | — | Opus |
| 2.7 | Custom chart composer (persisted user charts on the Testing tab) | M | 2.2 | Sonnet |

### Phase 3 — Console depth

| WP | Title | Size | Depends | Model |
|---|---|---|---|---|
| 3.1 ⛩ | `parentStepId` + `spanKind` wire + emitters (rating spans, MCP roundtrips, compat probes) | L | — | Opus |
| 3.2 | Tree StepLog + nested Gantt + per-step economics chips + hotspots | L | 3.1 | Sonnet |
| 3.3 ⛩ | Fork-from-step: rerun endpoint + overrides + lineage + Compare pre-seed + estimate preview | L | 1.1 | Opus |
| 3.4 | In-run search + view lenses | M | 1.3 | Sonnet |

### Phase 4 — Watch rules

| WP | Title | Size | Depends | Model |
|---|---|---|---|---|
| 4.1 | Rules engine core: `watch_rules` + on-terminal evaluation + actions (notify, pin, add-to-collection, promote-to-test, run-grader, webhook) | L | 1.1, 1.6 | Opus |
| 4.2 | Windowed rules + catch-up-on-boot ticker + historical preview endpoint | M | 4.1, 1.2 | Opus |
| 4.3 | Notification center (persisted, SSE-pushed, bell UI) + webhook channel + test-fire | M | 4.1 | Sonnet |
| 4.4 | Rules UI (CRUD + filter builder + action config + preview) + promote-to-test console button | L | 4.2, 4.3, 2.3 | Sonnet |
| 4.5 | Review queue lite (rubric + keyboard review over `run_feedback`) | M | 1.5, 2.5 | Sonnet |

### Phase 5 — Fleet issues

| WP | Title | Size | Depends | Model |
|---|---|---|---|---|
| 5.1 | Issue aggregation: registry extension + deterministic clustering job + lifecycle + auto-reopen | L | 1.2, 4.2 | Opus |
| 5.2 | LLM assist (opt-in): judge-chain merge/label/summarize, own concurrency + cost ledger | M | 5.1 | Opus |
| 5.3 | Issues tab UI: list/detail/lifecycle, linked runs, metrics slice, drafted fixes | L | 5.1, 2.2 | Sonnet |
| 5.4 | Assistant issue loop: analyze → fix draft (D-AS4) → regression test → re-run watch | M | 5.3, 3.3, 4.1 | Opus |
| 5.5 | Scheduled digest report (notification + persisted MD/JSON) | M | 5.1, 4.3 | Sonnet |

## Recommended build order & parallel map (indicative — orchestrator recomputes per ledger + Files overlap)

Precondition: `roadmap/unified-sessions/` Waves 1–3 run **first** (D-OB28); while they run, only
the un-gated WPs here are eligible (2.6 pricing editor is the natural early solo). Then:
`1.1 solo → (1.2 ∥ 2.6*) → (1.3 ∥ 2.1) → (1.4 ∥ 2.2) → (1.5 ∥ 2.3) → (1.6 ∥ 2.4) → (3.1 ∥ 2.5) →
(3.3 ∥ 2.7) → (4.1 ∥ 3.2) → (4.2 ∥ 3.4) → 4.3 → (4.4 ∥ 4.5) → 5.1 → (5.2 ∥ 5.3) → (5.4 ∥ 5.5)`
(*if 2.6 didn't already run during the unified-sessions window; one migration WP in flight rules
still bind every batch).

Hard batching rules: **one migration-bearing WP in flight at a time** (1.2, 1.3, 1.4, 1.5, 1.6,
2.6, 2.7, 3.1, 3.3, 4.1, 4.3, 5.1 — they serialize on `db/database.ts` +
`schema.ts`); WPs sharing `packages/shared`, `testing/run-service.ts`/executors, `lib/status.ts`,
or the run-console component cluster never run in the same batch (each WP's Files section is
authoritative).

## Success criteria (workstream-level)

1. The session contract holds (owned + proven by `roadmap/unified-sessions/` acceptance); this plan's charts group by its `stopReasonCode`/`phase`/capability columns without re-deriving anything.
2. "Error rate / cost / duration / score this week, grouped by model or server, click through to the runs" is answerable in ≤2 clicks from the Dashboard Testing tab.
3. Any remembered phrase from a session is findable via search in <1 s at 50k runs.
4. A failing run can be forked at the failing step with an edited prompt and compared against its parent.
5. A rule can notify on a fail-streak and turn the offender into a regression test in a collection.
6. Recurring failures surface as issues with occurrences/trend and can be walked to a proven fix via the Assistant, with auto-reopen on regression.
7. Zero dishonest aggregates: estimated/exact/question bases never blend (D-OB14); human feedback never enters grades (D-OB15).

## Owner-acceptance (running list — see STATUS)

Both-theme + keyboard walks of every new surface; live subscription/provider walks (judge-chain
LLM assist, assistant issue loop); a real long interactive session exercising waiting/end-session/`seen` (contract walks live in unified-sessions); webhook test-fire against a real receiver; FTS relevance spot-check; fork-from-step
on a real failed run; dashboard drill-down correctness spot-check against the runs feed.
