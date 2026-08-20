---
type: "Roadmap Item"
title: "Security posture — a deterministic analyzer over persisted scans and skills"
description: "Add a deterministic, versioned analyzer that turns persisted scans and skills into findings and a score: tool-poisoning heuristics, annotation sanity, schema hygiene, OAuth scope breadth and a skill security roll-up, diffable release to release and usable as a CI assertion."
tags: ["roadmap", "RM-20"]
timestamp: "2026-08-20T13:58:42Z"
status: "planned"
---

# Security posture — a deterministic analyzer over persisted scans and skills

## Goal

Add a deterministic, versioned analyzer that turns persisted scans and skills into findings and a score: tool-poisoning heuristics, annotation sanity, schema hygiene, OAuth scope breadth and a skill security roll-up, diffable release to release and usable as a CI assertion.

## Why it matters

The app already stored everything needed to assess an MCP server's security posture, but nothing read it that way.

## Milestones

- [ ] Phase 1 — the contract, the server analyzer, the skill analyzer and the posture diff.
- [ ] Phase 2 — security tabs, badges, diff UI and report-export integration.

## Linked research

- [RS-01](/Research/RS-01-token-context-comparison/topic.md)
