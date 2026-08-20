---
type: "Roadmap Item"
title: "Auto-Rating — mandatory post-run validation and reports"
description: "Rate every terminal run automatically with no configuration: validate the answer against the prompt, judge the insight surplus, inventory and classify every error by root cause, and compose a per-run and per-suite report."
tags: ["roadmap", "RM-06"]
timestamp: "2026-08-20T13:58:40Z"
status: "planned"
---

# Auto-Rating — mandatory post-run validation and reports

## Goal

Rate every terminal run automatically with no configuration: validate the answer against the prompt, judge the insight surplus, inventory and classify every error by root cause, and compose a per-run and per-suite report.

## Why it matters

Runs were measured for cost and tokens but never for whether they actually answered the question, so quality regressions were invisible.

## Milestones

- [ ] Phase 1 — the rating contract and base graders.
- [ ] Phase 2 — the CLI-first judge chain.
- [ ] Phase 3 — error forensics and the issues registry.
- [ ] Phase 4 — run and suite reports.

## Linked research

- [RS-08](/Research/RS-08-insights-bench-assessment/topic.md)
