---
type: "Roadmap Item"
title: "Assistant — embedded Claude agent chat"
description: "Embed a real Claude agent in the app as a right-hand dock with page hooks, running on the owner's subscription with an API-key fallback, reading app data through in-process MCP tools and writing only behind an approval protocol."
tags: ["roadmap", "RM-02"]
timestamp: "2026-08-20T13:47:37Z"
status: "active"
---

# Assistant — embedded Claude agent chat

## Goal

Embed a real Claude agent in the app as a right-hand dock with page hooks, running on the owner's subscription with an API-key fallback, reading app data through in-process MCP tools and writing only behind an approval protocol.

## Why it matters

An operator reading a failed run or a bloated server had no way to ask the app itself what happened or to act on the answer without leaving the page.

## Milestones

- [ ] Phase 0 — session engine and provider auth.
- [ ] Phase 1 — read tools, system prompt and context envelope.
- [ ] Phase 2 — the dock UI and page hooks.
- [ ] Phase 3 — the write-permission protocol, the skill edit loop, UI navigation and hardening.

## Linked research

- [RS-06](/Research/RS-06-agentic-session-sota/topic.md)
