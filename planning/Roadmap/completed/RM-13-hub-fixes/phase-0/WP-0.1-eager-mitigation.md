---
type: "Work Package Spec"
title: "WP 0.1 \u2014 eager-mode mitigation + scoped-session runbook"
description: "Phase: 0 \u00b7 Size: S \u00b7 Depends on: \u2014 \u00b7 Model: Sonnet \u00b7 Agent profile: config + docs"
tags: ["roadmap", "RM-13"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# WP 0.1 — eager-mode mitigation + scoped-session runbook

**Phase:** 0 · **Size:** S · **Depends on:** — · **Model:** Sonnet · **Agent profile:** config + docs

## Objective

Make MCP usable in main-session chat **today**, before any code lands: run the hub eager and
document the scoped-session workflow that keeps eager mode inside the context budget.

## Why / evidence

`analysis.md` RC1: deferred is the default and nothing is ever promoted, so no MCP tool is callable
(live: `resident: []`, 245k deferred tokens). Eager mode is the tested path
(`session-service.hub-mcp-grants.test.ts` forces `toolLoadingDefault: "eager"`). Eager with ALL
five servers (~245k tokens) cannot fit a context window; a session scoped to one server
(acme-demo ≈ 45-50k) can.

## Files (exclusive)

- `docker-compose.yml` (environment block)
- `.env.example` (comment update near `HUB_TOOL_LOADING_DEFAULT`)
- `user-guide/16-assistant-hub.md` (short "Scoped sessions + tool loading" runbook subsection)

## Implementation steps

1. Add `HUB_TOOL_LOADING_DEFAULT: "eager"` to the compose environment with a comment: temporary
   mitigation until WP 1.1 lands, then remove (WP 1.1 flips the code default to `auto`).
2. `.env.example`: note the mitigation and the ~token cost of eager per server (point at the
   context inspector as the measuring tool).
3. User guide: 6-10 lines: create session → MCP & tools tab → **Scoped** → pick ONE server;
   why (context budget); note that every MCP call shows an approval card; note that the Tools rail
   currently lists all servers regardless of scope (fixed by WP 1.2).

## Acceptance

- [ ] Compose sets the env var with the removal note; `.env.example` consistent.
- [ ] User-guide subsection present, accurate to current behavior (pre-WP-1.2 honesty caveat included).
- [ ] Gate green (docs/config only; no test changes expected).

## Notes / owner-acceptance

Owner-op: `docker compose up -d --build` (or recreate) to apply, then verify live: scoped session
to acme-demo → ask a question → a `vendor_*` tool call appears with an approval card and, once
approved, returns data. Record the outcome in `STATUS.md`'s owner-acceptance list.
