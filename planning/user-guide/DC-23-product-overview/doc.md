---
type: "Documentation"
title: "Product overview"
description: "The outward-facing description of the workbench: what it is, who it is for and what it does."
tags: ["documentation", "DC-23"]
timestamp: "2026-08-21T18:13:21Z"
status: "current"
---

# Product overview

## Subject

The outward-facing description of the workbench: what it is, who it is for and what it does.

## Scope

**In:** The product page, the landing page, the overview deck and the guide's own map.

**Out:** Any implementation detail.

## Where the code lives

- `apps/web/src/`

## Delivered increments

### RM-31 — Startup-footprint MVP and the expanded target

Completed 2026-08-21. Roadmap item: [RM-31](/Roadmap/completed/RM-31-mvp-footprint-analyzer/item.md).

**Shipped:** The original startup-footprint MVP (server configuration, discovery scan, per-tool token footprint with a ranked breakdown, scan history and JSON/Markdown report export) and, on top of it, the expanded-target scope note that superseded the MVP's own non-goals and became the project's north star: tool execution, runtime request/response accounting, cross-server and tool-level comparison, and a genuinely good UI.

**Planned vs delivered:** This item is a historical record, not a live plan. The MVP shipped before this planning bundle existed, so it never had a STATUS.md ledger and was retired with --no-ledger (the sanctioned path for a ledger-less item, not a waiver past an open box). Its three milestones describe work that did happen: the MVP shipped, the target was expanded (08-expanded-target.md), and the programme was handed over to the per-feature RM items that now carry it.

**Known gaps:** Nothing was re-verified for this retirement. Every capability the MVP introduced is now owned, and independently verified or not, by a later per-feature roadmap item; this item's own documents were read for provenance only. The path planning/Roadmap/completed/RM-31-mvp-footprint-analyzer/08-expanded-target.md is cited from CLAUDE.md and two .claude/rules files and now resolves only under Roadmap/completed/.

**Where the code lives:**

- `apps/api/src/{scans,token-counting,reports}, apps/web/src/features/{scans,servers,compare}`
