---
type: "Work Package Spec"
title: "WP \u2014 Compare & launcher follow-ons (landscape imports)"
description: "Status: PROPOSED 2026-08-18 \u2014 owner-gated backlog. Three small testing-domain"
tags: ["roadmap", "RM-26"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# WP — Compare & launcher follow-ons (landscape imports)

> **Status: PROPOSED 2026-08-18 — owner-gated backlog.** Three small testing-domain
> features imported from the landscape research
> ([`research/langfuse-landscape/`](/Research/RS-05-langfuse-landscape/) — `01 §G11`,
> `02 §3`, `03 §5`). Single-WP-doc per the `wp-*.md` precedent; independent parts, each
> individually droppable. No wire breaks — additive fields/routes only, shared-contract
> first per `.claude/rules/architecture.md`.

## Part A — Comparison grade labels (Improvement / Regression / Tradeoff / Tie)

The compare workspace's verdict sentences today summarize deltas; Braintrust's comparison
grade adds the one word an operator actually wants. Compute a per-comparison label over four
categories — quality (grades/rating), cost, latency/duration, errors — where **Tradeoff**
means at least one category improved and one regressed. Surface: a chip next to the verdict
sentence in run-vs-run compare and a grade row in suite compare (best/worst highlighted).
Pure derivation from data already in the Δ-matrix — no persistence. Acceptance: label
matches the Δ-matrix on fixtures for all four outcomes; both themes.

## Part B — Pairwise preference capture in compare

When two runs are open in the compare workspace, allow recording a head-to-head human
preference (A better / B better / tie, optional note). Persistence rides the observability
**feedback primitive** (`run_feedback`, WP-1.5 — **built 2026-07-17**, `putRunFeedback`
upsert per run/key/source): store preferences as feedback, never as grades (AR6).
Value: skill-effect A/B and model comparisons gain a human axis the auto-graders can be
checked against (per-test-group LLM-agreement already exists in suite reports — this gives
it a human counterpart). Acceptance: preference recorded/edited/removed; visible on both
runs' Report tabs as feedback; excluded from all grade aggregations.

## Part C — Launcher variant matrix ("run A/B in one gesture")

The two-path run launcher gains an optional **variant axis**: duplicate the configured plan
across 2–4 variants differing in exactly one dimension — model, skill version
(latest/pinned/none), or tool-loading mode — and submit as **one suite-run** via the
existing `POST /api/run-plans` engine (variants = members tagged with their variant value).
The estimate preview (`POST /api/estimate/run-plan`) renders per-variant cost before launch.
Results land in the unified Runs feed as a suite-run whose members carry the variant tag;
compare opens pre-filtered to the variant pair. Langfuse's playground-variant execution and
prompt A/B are the evidence that one-gesture variant runs are the missing launcher
affordance (`01 §G11`); ours runs the *whole agent session*, not just a prompt. Acceptance:
variant suite-run of 2 models produces members with variant tags; per-variant estimate shown
pre-launch; "Save as suite" preserves the matrix; no schema migration beyond an additive
member-metadata field (contract-first).

## Sequencing

A is free-standing (any time). B's dependency (observability WP-1.5 feedback primitive) is
built, so B is unblocked. C touches the launcher + suite orchestrator — check the ledgers for
in-flight work on those surfaces before batching.
