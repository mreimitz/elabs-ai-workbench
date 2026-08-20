---
type: "Roadmap Item"
title: "Testing — the agent run engine and console"
description: "Drive MCP servers through a real LLM agent loop and measure it: token and context accounting, guardrails and pricing, full run persistence and replay, streaming and run control, the web console, and MCP-by-model compatibility."
tags: ["roadmap", "RM-26"]
timestamp: "2026-08-20T13:58:43Z"
status: "planned"
---

# Testing — the agent run engine and console

## Goal

Drive MCP servers through a real LLM agent loop and measure it: token and context accounting, guardrails and pricing, full run persistence and replay, streaming and run control, the web console, and MCP-by-model compatibility.

## Why it matters

Static definition footprint says nothing about what a server costs or breaks once a model actually calls it.

## Milestones

- [ ] Phases 0-2 — the run engine, accounting, persistence and the API.
- [ ] Phase 3 — the web run console.
- [ ] Phase 4 — hardening, export and packaging.
- [ ] Phase 5 — MCP-by-model compatibility.

## Linked research

- [RS-11](/Research/RS-11-testing-ui-concept/topic.md)
- [RS-01](/Research/RS-01-token-context-comparison/topic.md)
