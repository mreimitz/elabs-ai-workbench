---
type: "Roadmap Item"
title: "Model identity — a model choice means the model and the credential"
description: "Make a model choice in the Assistant Hub mean exactly what the operator picked, model and credential, end to end through the wire, the database, the resolver, the executor, missions, cost attribution and every picker."
tags: ["roadmap", "RM-16"]
timestamp: "2026-08-20T13:58:41Z"
status: "planned"
---

# Model identity — a model choice means the model and the credential

## Goal

Make a model choice in the Assistant Hub mean exactly what the operator picked, model and credential, end to end through the wire, the database, the resolver, the executor, missions, cost attribution and every picker.

## Why it matters

The Hub carried a bare model-id string and re-guessed the provider from the model name, routing a signed-in subscription session onto a metered API key.

## Milestones

- [ ] Phase 1 — the credential-bearing model reference.
- [ ] Phase 2 — resolver and executor.
- [ ] Phase 3 — missions and cost attribution.
- [ ] Phase 4 — the pickers.

## Linked research

- [RS-06](/Research/RS-06-agentic-session-sota/topic.md)
