---
type: "Research Output"
title: "04 \u2014 Roadmap handoff: what this research became"
description: "Date: 2026-08-18 \u00b7 Status: entries drafted and committed as PROPOSED \u2014 pending"
tags: ["research", "RS-05"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# 04 — Roadmap handoff: what this research became

**Date:** 2026-08-18 · **Status:** entries drafted and committed as **PROPOSED — pending
owner lock**; pointer-merges applied 2026-08-19. **Correction (2026-08-19):** the ledgers
show unified-sessions (2026-07-16), observability (all 27 WPs, 2026-07-17), and Advisor
Phases 1–2 (2026-08-18) **built** — the amendment was reframed as follow-ups against built
surfaces, and WP-3.5's dependencies are already done. This doc is the index from evidence
(docs 00–03) to plan; the entries themselves live in `roadmap/` (status, as always, only in
the `STATUS.md` ledgers once WPs are picked up).

## Entries created

| Where | What | IDs |
|---|---|---|
| [`roadmap/ci/mcp-server.md`](../../../Roadmap/RM-08-ci/mcp-server.md) | **Workbench MCP server** — new "Phase MCP" inside CI & headless automation: streamable-HTTP MCP mount on the API, localhost trust → service-token scopes, read-first then scoped writes, self-scan CI gate | D-MCP1–6 (proposed), WP M.1–M.4 |
| [`roadmap/observability/amendment-2026-08-langfuse.md`](../../../Roadmap/RM-17-observability/amendment-2026-08-langfuse.md) | **Follow-up amendment to the *built* observability workstream** (corrected 2026-08-19) — items routed to their built surfaces (URL-serialized filters, corrected-output feedback, chart→feed drill-down, Ratio metric, Pulse outlier strip, pricing-editor scope+, chart-composer spec, metric-scaled Gantt, rule state machine + GH-Actions channel, boolean share-true metrics, per-run webhook, issues-visual guidance) | AM-OB1–14 (proposed) |
| [`roadmap/observability/phase-3-console/WP-3.5-agent-graph.md`](../../../Roadmap/RM-17-observability/phase-3-console/WP-3.5-agent-graph.md) | **New WP: agent-graph lens over a run** (aggregated/expanded modes, @xyflow/react, after WP-3.1) | AM-OB9 → WP-3.5 |
| [`roadmap/auto-rating/wp-judge-preview-and-rerate.md`](../../../Roadmap/RM-06-auto-rating/wp-judge-preview-and-rerate.md) | Judge-settings **live preview** (ephemeral, capped) + **bounded re-rate window** (append-only revisions, AR6 intact) | owner-gated backlog |
| [`roadmap/testing/wp-compare-launcher-followons.md`](../../../Roadmap/RM-26-testing/wp-compare-launcher-followons.md) | **Comparison grade labels** (Improvement/Regression/Tradeoff/Tie), **pairwise preference capture** (blocked on obs WP-1.5), **launcher variant matrix** (A/B plans as one suite-run) | owner-gated backlog |
| `CLAUDE.md` | Capability-table rows updated: ci row (+MCP server, Phase MCP pointer), observability row (+research link, amendment pointer) | — |

Deliberately **not** filed as WPs: OTLP export + MCP `_meta` context propagation (one-page
options in `01 §G12`), scheduled blob exports, user-configurable evaluators, prompt-mgmt
clone, guardrails (see `01 §Priority-6` and "not worth building" rationale).

## Pointer-merges (applied 2026-08-19)

1. **`roadmap/ci/README.md`** — add under the plan/phases overview:
   > **Phase MCP — workbench MCP server** (proposed 2026-08-18, pending owner lock): the
   > bench itself MCP-operable by external agents — plan, decisions D-MCP1–6, and WP M.1–M.4
   > in `mcp-server.md`. WP M.1 is independent of Phase 1 (localhost
   > trust); M.2+ consume Phase 1 service tokens.
2. **`roadmap/ci/STATUS.md`** — append a "Phase MCP (proposed)" section with rows
   WP M.1 read-only server core · WP M.2 token scopes on the mount · WP M.3 scoped write
   tools · WP M.4 agent onboarding + self-scan gate — all `pending owner lock`.
3. **`roadmap/observability/STATUS.md`** — append an "Amendment 2026-08-18 (proposed)" note:
   AM-OB1–14 per [`amendment-2026-08-langfuse.md`](../../../Roadmap/RM-17-observability/amendment-2026-08-langfuse.md);
   items are follow-ups against built surfaces; WP-3.5 added to the Phase 3 list as
   `proposed` (deps 3.1/3.2 done).
4. **`roadmap/auto-rating/STATUS.md`** — one backlog line pointing at
   `wp-judge-preview-and-rerate.md` (owner-gated, alongside Phase 5).
5. **`roadmap/testing/STATUS.md`** — one backlog line pointing at
   `wp-compare-launcher-followons.md` (owner-gated; Part B blocked on observability WP-1.5).

## Owner-lock checklist (the decisions actually being asked)

- [ ] Lock Phase MCP scope + D-MCP1–6 (esp. D-MCP2 localhost trust, D-MCP3 scope-=-consent
      writes, D-MCP5 self-scan gate) — or re-scope to read-only-only.
- [ ] Lock AM-OB1–14 individually (each droppable); decide renumbering (follow-up WP list
      vs. D-OB29+).
- [ ] Accept WP-3.5 into Phase 3 (after WP-3.1) or park it.
- [ ] Confirm the two backlog wp-docs (auto-rating, testing) as owner-gated backlog.
- [ ] Priority call: first implementation batch — WP M.1 (ci Phase MCP) or WP-3.5
      (observability agent-graph follow-on)? Both are unblocked; the M.1 kickoff prompt is
      [`roadmap/ci/kickoff-prompt-mcp.md`](../../../Roadmap/RM-08-ci/kickoff-prompt-mcp.md).

## Sequencing picture (corrected 2026-08-19)

Unified Sessions and Observability are **built** (2026-07-16/17; owner-acceptance pending,
`main` not pushed to origin); Advisor Phases 1–2 are built (2026-08-18); testing WP 5.7 was
absorbed by Advisor. What remains implementable from this research: **ci Phase MCP** (WP M.1
independent; M.2+ after ci WP 1.1 tokens) ∥ **WP-3.5 agent graph** (deps done) → AM-OB
follow-ups on owner lock → backlog wp-docs on pull. Nothing here reopens built work; it is
follow-ups and one new lens, not a strategy change — see
[`01-gap-analysis.md`](../notes/01-gap-analysis.md) §Where-we-lead.

# Citations

None.
