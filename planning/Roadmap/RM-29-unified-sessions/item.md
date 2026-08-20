---
type: "Roadmap Item"
title: "Unified Sessions — one session experience across every run backend"
description: "Give the three run backends one session contract: a shared terminal table, an additive ended terminal state, a stall-based clock with no default wall cap, a persisted phase, a capability manifest, one status module and cursor-resumable streaming."
tags: ["roadmap", "RM-29"]
timestamp: "2026-08-20T13:58:44Z"
status: "planned"
---

# Unified Sessions — one session experience across every run backend

## Goal

Give the three run backends one session contract: a shared terminal table, an additive ended terminal state, a stall-based clock with no default wall cap, a persisted phase, a capability manifest, one status module and cursor-resumable streaming.

## Why it matters

The same event ended three different ways depending on the backend, interactive sessions could never succeed, and a hard-coded wall clock stopped long runs.

## Milestones

- [ ] Wave 1 — the contract and the clock.
- [ ] Wave 2 — stream robustness.
- [ ] Wave 3 — one console.
- [ ] Wave 4 — the OpenAI-compatible facade.
- [ ] Wave 5 — integration and docs.

## Linked research

- [RS-03](/Research/RS-03-unified-run-sessions/topic.md)
