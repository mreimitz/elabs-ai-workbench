---
type: "Work Package Spec"
title: "Amendment \u2014 Langfuse & landscape follow-ups (2026-08-18, corrected 2026-08-19)"
description: "Status: PROPOSED \u2014 pending owner lock. Follow-up items for the completed observability"
tags: ["roadmap", "RM-17"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# Amendment — Langfuse & landscape follow-ups (2026-08-18, corrected 2026-08-19)

**Status: PROPOSED — pending owner lock.** Follow-up items for the **completed** observability
workstream, derived from [`research/langfuse-landscape/`](/Research/RS-05-langfuse-landscape/)
(Langfuse post-v4 + Phoenix/Opik/Braintrust/Weave, primary sources fetched 2026-08-18).
Numbered **AM-OB1…AM-OB14**; on owner lock, renumber into D-OB29+ or hold as a follow-up WP
list — owner's choice.

> **Correction (2026-08-19).** The first version of this amendment, and the research bundle's
> gap analysis, treated the observability plan as *not yet started* (per the then-stale
> CLAUDE.md capability row). The authoritative [`STATUS.md`](./STATUS.md) shows **all 27 WPs
> (Phases 1–5) built, gate-green, and merged to local `main` on 2026-07-17** — on top of the
> completed unified-sessions contract — with owner-acceptance pending and `main` not pushed to
> origin. Every item below is therefore an **enhancement against a built surface**, not a
> design-time import. Items marked *verify-at-pickup* may already be partially satisfied by
> the built WP — the pickup agent's first task is to check the shipped surface (and the
> ledger's own recorded follow-ups: the promote-to-test REST endpoint, `feedbackRate` measure,
> `grader` param for `meanScore`, report-export `humanFeedback` block) and shrink the item to
> the true residual rather than re-building.

**Ground rules:** nothing here reopens a locked D-OB decision; every item is droppable
individually; additive-only wire; migration discipline per the ledger (one migration-bearing
WP in flight, claim the next free `user_version`); doctrine holds (derived-never-authoritative,
D-OB15/AR6 feedback-never-in-grades). ⚠️ **Chart items inherit the recorded gate blind spot**
(ledger 2026-07-17, memory `[[chart-tests-mock-brand-charts-as-noop]]`): panel suites mock
`@elabs-ai/components-charts` as no-ops, so chart-prop bugs pass the gate — every chart-touching item
below MUST ship a faithful-stub test per the `time-axis-charts.test.tsx` pattern.

## Summary table

| Item | Built surface (WP) | vs built | One-liner |
|---|---|---|---|
| AM-OB1 | RunFilter + views (1.1/1.4, 2.3) | verify-at-pickup | Full filter/view state serializes into the URL |
| AM-OB2 | Feedback (1.5/2.5, review queue 4.5) | new key + UI | "Corrected output" as a feedback kind; feeds promote-to-test |
| AM-OB3 | Dashboard panels + drill-down (2.2) | largely shipped | Residual: every chart state URL-addressable |
| AM-OB4 | Metrics measures (1.2/2.2) | new measure | Ratio metric (numerator/denominator, each with own filter) |
| AM-OB5 | Runs feed (2.3) | new | Pulse-style sqrt-scaled outlier strip above the feed |
| AM-OB6 | Pricing editor (2.6) | new scope | Reasoning/cache-write/audio/image usage types; tiered context-dependent prices; price-drift check; ingested-cost precedence |
| AM-OB7 | Chart composer (2.7) | verify-at-pickup | Type-set completion: histogram, pivot, radar (+ AM-OB4 ratio) |
| AM-OB8 | Tree StepLog + Gantt (3.2) | new option | "Scale bars by" tokens/cost + cache-segment stacks (needs AM-OB6 types) |
| AM-OB9 | Step hierarchy (3.1 ✅ done) | new WP — **unblocked** | [`WP-3.5 agent-graph lens`](./phase-3-console/WP-3.5-agent-graph.md) |
| AM-OB10 | Rules engine (4.1/4.2) | verify-at-pickup | WARNING+ALERT dual thresholds; explicit states incl. NO_DATA/PAUSED; renotification |
| AM-OB11 | Webhook channel (4.3) | new action type | GitHub Actions `workflow_dispatch` rule action (token via `roadmap/ci/` Phase 1) |
| AM-OB12 | Windowed rules (4.2) | verify-at-pickup | Boolean share-true metrics over grades/ratings ("hallucination-flag rate") |
| AM-OB13 | Notification center (4.3) | new | Per-run manual "send to webhook" (Langfuse Web-Callouts analog) |
| AM-OB14 | Issues tab (5.3, redesigned) | largely shipped | Occurrence chart exists; residual: per-bucket distribution bars |

## Item notes (evidence: `01 §G*n*` / `03 §…` in the research bundle)

- **AM-OB1 (01 §G2).** Langfuse serializes the entire filter query into the URL — shareable
  exact views. The built runs feed has filters/search/views + the needs-attention chip; verify
  whether full filter state round-trips through the URL (routes rule D-TB10). If not: encode
  `RunFilter` + view selection in query params; saved views become named URLs.
- **AM-OB2 (01 §G7).** Add a `corrected_output` feedback key through the existing
  `putRunFeedback` API (upsert per run/key/source=human) + a console/review-queue affordance;
  the corrected answer pre-fills the expectation when promoting the run to a test (pairs with
  the ledger's open promote-to-test endpoint follow-up). Include it in the report-export
  `humanFeedback` block (also already a recorded follow-up).
- **AM-OB3 (03 §Cross-cutting-3).** Drill-down shipped with 2.2; verify chart states are
  URL-addressable (deep-linkable panel + time-bucket selection). Residual only.
- **AM-OB4 (03 §2).** A ratio measure (each side with its own filter) unlocks error rate,
  pass-rate, cache-hit share, skill-attach share. Slots beside the ledger's noted `grader`
  param + `feedbackRate` follow-ups in `metrics.ts`; beware the recorded
  `buildRunFilterWhere` duplication when touching filters.
- **AM-OB5 (03 §1).** Exact spec in the research bundle: adaptive buckets (1 min–1 week),
  **sqrt height scale**, count/cost/p95-duration metrics, click→filter, drag→range, empty
  buckets as gaps. Faithful-stub chart test mandatory.
- **AM-OB6 (01 §G9).** Four parts: (a) additive usage-type columns
  (`reasoning`/`cache_write`/`audio`/`image`) through accounting + estimate-vs-actual;
  (b) condition-evaluated price tiers (input-size threshold) on top of effective-dating;
  (c) a price-drift check against provider price pages filing a rating-issue on drift;
  (d) provider-ingested costs take precedence over inferred. One migration max, claimed per
  convention.
- **AM-OB7 (03 §1, §Mapping).** Verify the shipped composer's type set; complete toward
  histogram + pivot (score analytics) + radar (multi-grader; the Report tab already renders a
  radar) + AM-OB4's ratio. Raise missing `@elabs-ai/components-charts` primitives upstream per
  library-first — no hand-rolls.
- **AM-OB8 (03 §5).** Braintrust's timeline scales Gantt bars by a chosen metric (tokens/cost,
  not just time) with stacked cache segments per span. The built nested Gantt (3.2) gains a
  "scale by" selector; cache segments once AM-OB6's types exist. Degrade gracefully.
- **AM-OB9 (01 §G4).** New WP file beside the built Phase 3 — dependency WP-3.1 is done, so
  this is **implementable now**; see the spec for modes, chips, cross-links, acceptance.
- **AM-OB10 (01 §G5).** The built engine has on-terminal + windowed rules, boot catch-up, and
  historical preview. Verify threshold/state semantics; add WARNING below ALERT, explicit
  NO_DATA (a bench where "no runs happened" is signal) and PAUSED states, renotification
  interval for sustained conditions.
- **AM-OB11 (01 §G5).** Keep the one generic webhook as the base primitive (built); add a
  typed `workflow_dispatch` action so "regression detected → CI re-runs the suite" closes
  with zero new infra. Token storage belongs to `roadmap/ci/` WP 1.1 — sequence after it, or
  ship with a manually-pasted token behind the same encryption used for provider creds.
- **AM-OB12 (01 §G5).** Boolean grade/rating fields as share-true windowed metrics, mirroring
  numeric aggregations. Verify against the built measure set first.
- **AM-OB13 (01 §G6).** Manual per-run/suite-run POST (ids + report link) to an
  admin-configured endpoint; reuses 4.3's webhook config + signing. Day-scale;
  attach-to-ticket utility.
- **AM-OB14 (01 §G8, 03 §Cross-cutting-5).** The redesigned Issues tab already ships the
  occurrence-over-time chart (bucket-aware labels). Residual: per-bucket distribution bars on
  the issue list; explicitly skip embedding-scatter topic visuals — clustering stays
  deterministic over forensics buckets.

## Out of scope of this amendment

Workbench MCP server ([`roadmap/ci/mcp-server.md`](/Roadmap/RM-08-ci/mcp-server.md)); judge preview +
re-rate window ([`roadmap/auto-rating/wp-judge-preview-and-rerate.md`](/Roadmap/RM-06-auto-rating/wp-judge-preview-and-rerate.md));
compare/launcher follow-ons ([`roadmap/testing/wp-compare-launcher-followons.md`](/Roadmap/RM-26-testing/wp-compare-launcher-followons.md));
OTLP export + MCP `_meta` context propagation (one-page options in research `01 §G12`, no WP).
