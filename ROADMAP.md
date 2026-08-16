# MCP Token Footprint Roadmap

> **Historical document.** This roadmap captures the original planning narrative and presents much
> of what has since shipped as "future" work. **Current state: see [`CLAUDE.md`](./CLAUDE.md)
> (capability table) and the authoritative in-flight ledgers
> [`roadmap/testing/STATUS.md`](./roadmap/testing/STATUS.md) /
> [`roadmap/skills/STATUS.md`](./roadmap/skills/STATUS.md).** Note e.g. that the app now runs
> directly on the vendored upstream `@brand/*` design system — the "local `packages/brand-ui`
> adapter" mentioned below was removed — and that the tool playground, runtime accounting,
> cross-server compare, resource/prompt footprint, Testing console, and Skills registry are built.

## Vision

A local web app for **analyzing MCP servers**: connect to one or many, extract their full tool
surface, measure both the **startup definition footprint** and the **runtime call cost** in
model-context tokens, track changes over time, compare servers against each other, and exercise
individual tools through schema-generated forms.

## Phase 1 — Startup-footprint MVP (largely shipped)

1. Project scaffold and planning documents.
2. Brand UI adapter wiring (local `packages/brand-ui`; upstream `@brand/*` is a later migration).
3. Backend API, SQLite, schema init, and server CRUD.
4. MCP stdio + streamable-HTTP connection, `initialize`, `tools/list`, and connection testing.
5. Token counting profiles and normalized tool breakdowns.
6. Scan persistence and scan detail endpoints.
7. React UI screens for dashboard, servers, scans, compare, and settings.
8. JSON and Markdown report export.
9. Docker hardening and clean build verification.

## Phase 2 — Expanded target (north star)

See [`roadmap/08-expanded-target.md`](./roadmap/08-expanded-target.md) for detail. In priority order:

10. **Tool playground:** generate an input form from a tool's JSON schema, execute it via
    `tools/call`, and present the result.
11. **Runtime token accounting:** measure request + response token cost of a tool call and store
    execution history.
12. **Cross-server comparison:** compare two different servers at the server level and at the
    **tool level** (matching/similar tools side by side).
13. **UI/UX redesign:** operator-grade, dense, table-first experience across all screens.

## Future Hardening (after the target)

- resource-read and prompt-template footprint analysis
- background scheduled scans
- provider-specific token adapters
- authenticated multi-user mode

## Completed Hardening

- secret encryption at rest for saved MCP env/header secrets
- URL-first MCP server wizard with bearer/API-key/OAuth setup
- server-centric UI information architecture with selected-server rail, latest scan findings, and inline tool detail inspection
