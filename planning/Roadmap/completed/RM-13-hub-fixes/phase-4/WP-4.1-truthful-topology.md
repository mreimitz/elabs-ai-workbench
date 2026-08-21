---
type: "Work Package Spec"
title: "WP 4.1 \u2014 truthful topology graphs (board + org-chart unified)"
description: "Phase: 4 \u00b7 Size: M \u00b7 Depends on: \u2014 \u00b7 Model: Sonnet \u00b7 Agent profile: web"
tags: ["roadmap", "RM-13"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# WP 4.1 — truthful topology graphs (board + org-chart unified)

**Phase:** 4 · **Size:** M · **Depends on:** — · **Model:** Sonnet · **Agent profile:** web

## Objective

The mission graph tells the truth about execution semantics per topology, the "Resolver" node is
labeled as the synthesis step, the org-chart stops contradicting the board, and a one-line legend
states how the topology runs. (Execution semantics themselves change only in WP 4.4.)

## Why / evidence

`analysis.md` RC6.1: debate is folded into the pipeline chain (`topology-graph.ts:109-131`; only
`last → terminal`), which reads as an arbitrary sequence; the terminal is the synthesis step but
is labeled bare "Resolver"; the workforce org-chart draws debate as undirected facing pairs
("debaters argue face to face", `workforce/org-chart/topology-edges.ts:80-86`), contradicting the
sequential reality (live: reports 50 s apart).

## Design

- `deriveTopologyGraph` gets a dedicated `debate` branch: debaters laid out in one ROW
  (parallel-reading), directed order edges `d1 → d2 → …` labeled "sees + rebuts" (additive
  `label?` on `TopoGraphEdge`), and EVERY debater edged into the terminal, which is labeled
  `Synthesis (resolver)` for debate (and plain `Synthesis` elsewhere; best-of-N keeps `Judge`).
- Legend line INSIDE `TopologyGraph` (so WP 4.2's MissionBoard changes stay disjoint):
  per topology, e.g. debate: "Debaters run in order; each sees and challenges prior arguments;
  synthesis resolves." pipeline/parallel/best-of-N get equivalent one-liners.
- Org-chart `topology-edges.ts` debate: same directed chain + resolver shape and legend text as
  the board (kill the facing-pairs depiction).
- After WP 4.4 lands, the debate branch reads the plan's round structure (openings row + rebuttal
  row); build the layout so that extension is a parameter, not a rewrite.

## Files (exclusive)

- `apps/web/src/features/hub/topology-graph.ts` (+ `topology-graph.test.ts`), `TopologyGraph.tsx` (+ test; edge labels + legend)
- `apps/web/src/features/hub/workforce/org-chart/topology-edges.ts` (+ its test)
- Do NOT touch `MissionBoard.tsx` (WP 4.2 owns it)

## Acceptance

- [ ] Debate graph: debaters one row, order edges labeled, all → `Synthesis (resolver)`; snapshot/unit tests updated deliberately (no blind snapshot refresh).
- [ ] Org-chart debate matches the board shape + legend; "face to face" copy gone.
- [ ] Legends render for all four topologies; tokens only; both themes.
- [ ] Pipeline/parallel/best-of-N graphs unchanged except terminal labels.
- [ ] Gate green.
