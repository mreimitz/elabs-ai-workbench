---
type: "Work Package Spec"
title: "WP 4.2 \u2014 Run report export"
description: "Phase: 4 \u00b7 Size: S \u00b7 Depends on: 1.6"
tags: ["roadmap", "RM-26"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# WP 4.2 — Run report export

**Phase:** 4 · **Size:** S · **Depends on:** 1.6

## Objective
Export a finished run as JSON and Markdown, reusing the existing report machinery.

## Why / references
The app already exports scans (`apps/api/src/reports/reports.ts` + `routes.ts`;
`GET /api/reports/scan/:id/{json,markdown}`). Mirror that for runs. Decision #8 (replay) makes a
shareable run report natural.

## Files
- `apps/api/src/reports/reports.ts` *(modify — add run report builders)*
- `apps/api/src/reports/routes.ts` *(modify — add run report routes)*
- `apps/web/src/features/testing/RunConsole.tsx` *(modify — `Export ▾` in replay run-bar, WP 3.7)*

## Routes
```
GET /api/reports/run/:id/json
GET /api/reports/run/:id/markdown
```

## Design — report content
- **Summary:** test, scenario (provider/model/params), mode, outcome/stop_reason, duration.
- **Totals:** turns, tool calls, tokens in/out/cached, peak context %, est. cost.
- **Per-step table:** index, type, label, status, tokens (lens + actual), duration.
- **Markdown** mirrors the existing scan report style (tables, `tabular` alignment in numbers).
- Honor redaction — reports never contain secrets (already redacted in `run_steps`).

## Acceptance
- Both endpoints return a coherent report for a finished run; Markdown renders cleanly.
- `Export ▾` in the replay run-bar downloads them.
- Gate: typecheck + test + build green (add a small report test mirroring the scan report test).
