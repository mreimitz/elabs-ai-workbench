---
type: "Documentation"
title: "Advisor — evidenced recommendations"
description: "The Advisor: how the bench turns its own measurements into ranked, evidenced recommendations — unused-tool trims with the tokens they would save, description bloat, eager-vs-deferred tool loading, cross-server overlap, grade-aware trims and skill ROI — and the fleet report that collects them."
tags: ["documentation", "DC-25"]
timestamp: "2026-08-21T22:08:05Z"
status: "draft"
---

# Advisor — evidenced recommendations

## Subject

The Advisor: how the bench turns its own measurements into ranked, evidenced recommendations — unused-tool trims with the tokens they would save, description bloat, eager-vs-deferred tool loading, cross-server overlap, grade-aware trims and skill ROI — and the fleet report that collects them.

## Scope

**In:** The /advisor view and its rules; GET /api/advisor/report; the fleet report exports (GET /api/reports/fleet/{json,markdown}); what evidence each recommendation cites and how a saving is estimated.

**Out:** The scan and token-counting pipeline the recommendations read from (DC-03), the testing/grading measurements they draw on (DC-08, DC-09), the observability surfaces (DC-11), and the security analyzer (DC-24) — each documented in its own subject.

## Where the code lives

- `apps/api/src/advisor/, apps/web/src/features/advisor/, apps/api/src/reports/`

## Delivered increments

No delivered increments have been recorded yet.
