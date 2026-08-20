---
type: "Work Package Spec"
title: "Phase 6 \u2014 Judge calibration & trust (WP specs) \u00b7 BACKLOG"
description: "Owner-added 2026-07-04. NOT part of the current W1\u2013W6 mission \u2014 do not pick up without"
tags: ["roadmap", "RM-07"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# Phase 6 — Judge calibration & trust (WP specs) · **BACKLOG**

> **Owner-added 2026-07-04. NOT part of the current W1–W6 mission** — do not pick up without
> explicit owner instruction. Rationale: LLM-judge scores are only actionable if their agreement
> with human judgment is measured; the insights-bench prototype's own analysis showed bimodal
> scores and a "penalized-for-better-answers" failure mode. This phase makes judge quality
> itself a measured quantity.

## WP 6.1 — Grade feedback + calibration set
**Size:** M · **Depends on:** 1.4 · shared + API migration + Web

**Objective:** capture human verdicts on grades and curate a calibration set.

**Deliverable:** additive `grade_feedback` table (grade_id FK, verdict `agree|disagree`,
note, created_at — migration number via the cross-workstream decision-log convention);
thumbs-up/down + optional note on every grade card (Grade panel + suite console cells);
"calibration set" = a flagged subset of graded runs with feedback, exportable; feedback is
append-only and never mutates the grade.

**Acceptance:** feedback round-trips; grade rows untouched by feedback (asserted); export
contains no secrets; both themes; gate green.

## WP 6.2 — Agreement analytics + judge-change guard
**Size:** M · **Depends on:** 6.1 · API + Web

**Objective:** the trust metric — per judge model/method/grading_version: agreement rate
(human-agree ÷ human-rated), disagreement drill-down list, trend over time. Judge settings show
the current judge's agreement rate; **changing the judge model prompts a re-grade of the
calibration set** and shows old-vs-new agreement before the switch is saved (guard, not block).

**Acceptance:** agreement math hand-verified on fixtures; judge-change flow re-grades only the
calibration set (cost disclosed first); mixed-version aggregation guarded (never averages across
grading_versions silently); both themes; gate green.
