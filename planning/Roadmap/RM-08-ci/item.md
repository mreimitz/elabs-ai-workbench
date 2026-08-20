---
type: "Roadmap Item"
title: "CI & headless automation — tokens, CLI, assertions and the workbench MCP server"
description: "Make every measurement usable without a browser: scoped service tokens, a thin mcpfp CLI, server-side assertions with a defined exit-code contract, a baseline-delta PR comment, copyable GitHub Actions gates, and the workbench's own MCP server."
tags: ["roadmap", "RM-08"]
timestamp: "2026-08-20T13:58:40Z"
status: "planned"
---

# CI & headless automation — tokens, CLI, assertions and the workbench MCP server

## Goal

Make every measurement usable without a browser: scoped service tokens, a thin mcpfp CLI, server-side assertions with a defined exit-code contract, a baseline-delta PR comment, copyable GitHub Actions gates, and the workbench's own MCP server.

## Why it matters

A repository owning an MCP server or a skill could not gate a change on footprint, quality or posture deltas without a human driving the UI.

## Milestones

- [ ] Phase 1 — service tokens, the CLI and the assertions engine.
- [ ] Phase 2 — suite runs, suite assertions and the Actions examples.
- [ ] Phase 3 — the security-posture assertion.
- [ ] Phase MCP — the workbench MCP server, its scopes, write tools and dogfood gate.

## Linked research

- [RS-01](/Research/RS-01-token-context-comparison/topic.md)
