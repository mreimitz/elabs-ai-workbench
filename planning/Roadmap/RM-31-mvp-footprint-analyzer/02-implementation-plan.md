---
type: "Work Package Spec"
title: "02 Implementation Plan"
description: "Historical planning document (the original MVP build order \u2014 largely shipped, and it"
tags: ["roadmap", "RM-31"]
timestamp: "2026-08-20T13:47:37Z"
status: "superseded"
---
# 02 Implementation Plan

> **Historical planning document** (the original MVP build order — largely shipped, and it
> describes a since-removed local `packages/brand-ui` adapter). **Current state: see
> `../CLAUDE.md` (`../CLAUDE.md`) and the authoritative in-flight ledgers
> [`testing/STATUS.md`](../RM-26-testing/STATUS.md) / [`skills/STATUS.md`](../RM-24-skills/STATUS.md)**; the active,
> executable plans are under `roadmap/testing/` and `roadmap/skills/`.

## Phase 0: Scaffold

Create the requested monorepo folders, package manifests, Docker files, and roadmap documents before writing feature logic.

## Phase 1: Brand UI Import

Attempt to download the `v1.0.0` release from `mreimitz/elabs-components`. Use `GH_TOKEN` or `GITHUB_TOKEN` if present. Extract the release into `packages/brand-ui` and record the result.

If inaccessible, keep a temporary adapter with TODO comments and document the replacement process.

## Phase 2: Backend Foundation

Set up Fastify, configuration loading, SQLite connection, schema initialization, CRUD routes, and health checks.

## Phase 3: MCP Connection

Implement stdio first. Create the MCP client, run `initialize`, run `tools/list`, normalize the tools, and close transports safely. Add streamable HTTP support at the data contract level and best-effort connection implementation.

## Phase 4: Token Counting

Implement the `TokenCounter` interface, token profiles, JSON counting, normalized tool breakdowns, aggregation, and deterministic calculations.

## Phase 5: Scan Workflow

Create scan rows, store events, persist per-tool rows, update scan summaries, and expose scan detail endpoints.

## Phase 6: Frontend

Build an enterprise app shell, dashboard, server management, scan list/detail, tool detail panel, compare screen, settings screen, toasts, and error boundary.

## Phase 7: Reports

Generate JSON and Markdown reports from stored scan rows and expose download actions in the UI.

## Phase 8: Docker Hardening

Build frontend assets, serve them from the API, expose port `8080`, persist `/data`, and verify a clean Docker build.
