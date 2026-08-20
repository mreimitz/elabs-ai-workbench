---
type: "Research Topic"
title: "LangSmith Observability vs. This App"
description: "Determine exactly what LangSmith's observability suite does better for monitoring sessions, debugging sessions and fleet-level reporting, and what it would take to close the gaps that matter."
tags: ["research", "RS-04"]
timestamp: "2026-08-20T14:03:37Z"
status: "done"
---

# LangSmith Observability vs. This App

## Objective

Determine exactly what LangSmith's observability suite does better for monitoring sessions, debugging sessions and fleet-level reporting, and what it would take to close the gaps that matter.

## Why now / what it feeds

The workbench records runs but had no fleet view, no search, no alerting and no human-feedback loop.

## Scope

**In:** A feature inventory of LangSmith observability, a gap analysis against this app, an enhancement concept and the open questions it raises.

**Out:** LangSmith's evaluation and prompt-management products, and any commercial comparison.

## Deliverable

An evidence base that became the locked D-OB decisions and the observability roadmap item.

## Success criteria

Each gap is evidenced against live product documentation and carries a concrete enhancement proposal.

## Overview (from the original topic README)

**Date:** 2026-07-16 · **Status:** decided — the implementation plan + locked decisions
(D-OB1–D-OB28) live at [`roadmap/observability/`](../../Roadmap/RM-17-observability/) (27 WPs,
Phases 1–5, per-WP model map, `/next-wp`-ready), which starts **after**
[`roadmap/unified-sessions/`](../../Roadmap/completed/RM-29-unified-sessions) (D-US1–15) ships the session
contract this layer aggregates by. This folder remains the evidence base; the concept's open
questions (Q-OB1–13) were answered by the owner on 2026-07-16 and are recorded in that plan's
README (Q-OB items overlapping the session contract are superseded by D-US — see D-OB27).

## Why this exists

LangSmith's observability suite (https://www.langchain.com/langsmith/observability) is
meaningfully ahead of this app in several areas: fleet-level monitoring, alerting, search,
human feedback loops, and automated failure intelligence. The owner asked for a structured
investigation: what exactly does LangSmith do better for **monitoring sessions**, **debugging
sessions**, and **reporting/monitoring at large**, and what would it take to close the gaps
that matter, in the backend and the frontend.

This folder is the companion to [`../unified-run-sessions/`](../RS-03-unified-run-sessions/)
(2026-07-16). That research fixes the *contract* of a session (lifecycle, clocks, capabilities,
status vocabulary). This research covers what sits *on top* of that contract: how sessions are
found, watched, aggregated, reviewed, and acted on. Several concepts below depend on the
unified-run-sessions concept landing first (noted inline where they do).

## Method

- LangSmith facts come from primary sources fetched 2026-07-16 (marketing page, docs at
  docs.langchain.com/langsmith, changelog, Interrupt 2026 announcements). Sources are listed at
  the bottom of [`00-langsmith-feature-inventory.md`](./notes/00-langsmith-feature-inventory.md).
- "What we have" claims come from first-hand review of this repo (CLAUDE.md capability table,
  `apps/api/src/{testing,grading,suites,reports}/*`, `apps/web/src/features/{testing,dashboard}/*`,
  and the unified-run-sessions current-state analysis).

## Documents

| Doc | Contents |
|---|---|
| [`00-langsmith-feature-inventory.md`](./notes/00-langsmith-feature-inventory.md) | What LangSmith observability actually is, feature by feature, with sources |
| [`01-gap-analysis.md`](./notes/01-gap-analysis.md) | Side-by-side against this app across 9 dimensions, with verdicts and a "where we lead" section |
| [`02-enhancement-concept.md`](./outputs/02-enhancement-concept.md) | Concept v0: a phased observability workstream (waves O1–O5), backend + frontend, mapped to the existing architecture |
| [`03-open-questions.md`](./notes/03-open-questions.md) | Owner decisions to settle before anything is built (Q-OB1 … Q-OB12) |

## Headline findings (details in 01)

1. **The biggest structural gap is time.** Every surface we have answers questions about *one*
   artifact (one run, one suite run, one scan). Nothing answers "how are runs trending this
   week", "which server got more expensive", "is the error rate up since the skill changed".
   LangSmith's dashboards, alerts, threads table, and Insights are all built on a
   metrics-over-time backbone we simply do not have.
2. **Debugging one session: we are closer than expected, ahead in places.** Our per-run
   analytics (context composition, estimate-vs-actual, cached-token split, Gantt) go deeper than
   LangSmith's per-trace view. We lack step hierarchy, per-step cost attribution, in-run search,
   and "edit and re-run from here".
3. **We auto-judge harder than LangSmith, but capture zero human signal.** Mandatory
   auto-rating + error forensics is stronger than LangSmith's opt-in online evaluators. But
   LangSmith has feedback scores, annotation queues, and pairwise review; we have no way to
   record a human verdict at all.
4. **LangSmith's newest tier (Insights, Engine) is an aggregation-and-action layer we already
   have the raw material for.** Error forensics already produces failure buckets and drafted
   fixes per run; the rating-issues registry already persists recurring problems; the embedded
   Assistant already has read tools + a write-approval protocol. Clustering those across runs
   and closing the loop (issue → fix → regression test → watch) is the highest-leverage
   direction in this research.
