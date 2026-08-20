---
type: "Work Package Spec"
title: "00 Product Brief"
description: "Scope update (2026-06): the product target has been expanded beyond the original"
tags: ["roadmap", "RM-31"]
timestamp: "2026-08-20T13:47:37Z"
status: "superseded"
---
# 00 Product Brief

> **Scope update (2026-06):** the product target has been expanded beyond the original
> startup-footprint MVP. Tool execution (schema-generated forms + `tools/call`), runtime
> request/response token measurement, and cross-server / tool-level comparison are now **in
> scope** as the north star. The relevant items below have been moved out of Non-Goals. Full
> detail and implications live in [`08-expanded-target.md`](./08-expanded-target.md). The
> original MVP is "Phase 1" and is largely shipped.

## Goal

MCP Token Footprint helps operators understand and optimize how MCP servers consume model-context
budget — both the **startup footprint** of their tool definitions and the **runtime cost** of
calling those tools — and lets operators compare servers over time and against each other.

## Primary User

A local developer or technical operator managing one or more MCP servers and trying to reduce startup context bloat before those tools are presented to a model.

## Phase 1 Jobs (the startup-footprint MVP — largely shipped)

- Add MCP server configurations (stdio and streamable HTTP, with auth/OAuth).
- Test whether a server can be initialized.
- Run a discovery scan with `initialize` and `tools/list`.
- Normalize every discovered tool.
- Count token footprint by selected profile.
- Rank tools by contribution.
- Store scan history.
- Compare two scans from the same server.
- Export scan reports as JSON and Markdown.

## Target Jobs (north star — now in scope)

- **Test tools interactively:** read a tool's input schema, generate a form on the fly, let the
  user fill and submit it, execute the tool (`tools/call`), and present the result.
- **Measure runtime token cost:** count tokens/payload for the request and the response of a tool
  call, alongside the static definition footprint.
- **Compare across different servers:** server-to-server comparison, including **tool-level**
  comparison (matching/similar tools side by side).
- **Polished, operator-grade UI/UX** (the current UI is a known weakness — redesign is in scope).

See [`08-expanded-target.md`](./08-expanded-target.md) for details and data-model/token/UI
implications.

## Non-Goals (still out of scope)

- authentication / multi-user accounts
- cloud deployment / billing / Kubernetes / multiple containers

> Note: several items once listed here have since been **delivered** and are no longer non-goals —
> the Testing console records and **replays** runs, drives servers through a real LLM agent loop
> (measuring runtime cost, not a passthrough proxy), and token counting uses **real tokenizers +
> provider-actual usage** rather than being deferred to "provider-specific adapters."

## Later (planned, after the target lands)

- scheduled / background scans

(Resource-read / prompt-template footprint and provider token accounting, previously listed here,
are now built — see the capability table in `../CLAUDE.md` (`../CLAUDE.md`).)

## Success Criteria

- **Phase 1:** start the app with Docker Compose, open `http://localhost:8080`, add a stdio MCP
  server, test it, scan it, inspect ranked tool token footprint, compare two scans of the same
  server, and export reports.
- **Target:** select a tool, fill its generated form, execute it, and see the result plus the
  request/response token cost; and compare two different servers at both the server and tool level.
