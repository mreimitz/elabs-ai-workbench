---
type: "Work Package Spec"
title: "Phase 5 \u2014 MCP \u00d7 Model compatibility (limits & heatmap)"
description: "Folds the token-context-comparison research (research/token-context-comparison/) into the"
tags: ["roadmap", "RM-26"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# Phase 5 — MCP × Model compatibility (limits & heatmap)

Folds the **token-context-comparison research** (`research/token-context-comparison/`) into the
testing process as a third pillar alongside the static scan analysis and the run engine: a
**model-aware compatibility engine + heatmap** that scores how well a server (and each tool) fits
each LLM — server-, tool-, session-, and aggregate-level — backed by a provenanced model dataset.

It is **additive**: the run engine (Phase 1–4) explicitly defers hard tool caps, schema
micro-limits, result-size, timeouts, rate limits, and client caps to this suite. The full design +
verified ground truth is in the approved plan; the research spec is
[`03-compatibility-test-suite.md`](../../../Research/RS-01-token-context-comparison/outputs/03-compatibility-test-suite.md)
(31 tests) with the machine catalog `tests/test-catalog.json`.

## Source-of-truth & maintenance (the durable answer)

| Asset | SoT | Update | Validation gate |
|---|---|---|---|
| Providers / models / limits / pricing | `research/token-context-comparison/data/**` (provenanced) | edit a provider file → `pnpm build:model-data` | drift test re-derives + byte-compares the bundled asset |
| Cross-cutting (client/host/SDK) limits | `data/cross-cutting-limits.json` | hand-edit + re-bundle | loader parse + resolver tests |
| Test catalog | `tests/test-catalog.json` (versioned) | data-only for new limits; +evaluator for new test types | schema-validate + catalog-QA (31×33) |
| Per-model severity | `model_severity` blocks → `resolve.ts` | rules re-resolve from dataset values | fixture-parity vs the Python reference |

`pnpm build:model-data` regenerates `apps/api/src/compatibility/data/*` and the derived
`packages/shared/src/model-data.generated.ts` (the run engine's context-window + pricing maps).
Single source of truth — never hand-edit the generated files.

## Work packages

- **WP 5.1 — Model-data foundation** — ✅ done (builder + bundled assets + drift CI + derived maps + crosswalk + shared contract).
- **WP 5.2 — Static compatibility engine** — ✅ done (catalog + resolver port + evaluators + runner + shape adapters/gemini).
- **WP 5.3 — Heatmap service + API** — ✅ done (`/api/scans/:id/heatmap`, `/api/compatibility/models`).
- **WP 5.4 — Web heatmap view** — ✅ done (Server×Model / Tool×Model grid + cited drill-down). Owner 2-theme visual check pending @ localhost:8080.
- **WP 5.5 — Catalog completion** — ✅ done (11 severity rules authored + 8 design tests; catalog v1.1, 39 tests).
- **WP 5.6 — Session pack** — ✅ done (8 session tests + `run_steps.cumulative_tokens` + `POST /api/runs/:id/compatibility`; cost unified on dataset pricing).
- **WP 5.7 — Persistence & trends + recommendations panel** — ⬜ open (now unblocked).
