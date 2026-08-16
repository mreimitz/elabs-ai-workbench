# 01 Architecture

> **Historical planning document.** Current architecture and state: see [`../CLAUDE.md`](../CLAUDE.md)
> and [`../.claude/rules/architecture.md`](../.claude/rules/architecture.md); in-flight status lives
> in [`testing/STATUS.md`](./testing/STATUS.md) / [`skills/STATUS.md`](./skills/STATUS.md). Notably
> the web app now uses `react-router-dom` (real URL routing, not local view-switch state) and runs on
> the vendored upstream `@brand/*` design system (the local `packages/brand-ui` adapter was removed).

## System Shape

```txt
Browser UI
  |
  | HTTP /api
  v
Fastify API
  |
  | SQLite
  v
/data/app.sqlite
  |
  | child process / HTTP client
  v
MCP servers
```

## Package Boundaries

- `apps/web`: React/Vite UI only. It owns routing, screen composition, local UI state, and API calls.
- `apps/api`: Fastify API, database access, MCP connection, token counting, scan orchestration, static web serving.
- `packages/shared`: API types, transport constants, token-profile constants, and validation schemas.
- `packages/brand-ui`: upstream brand UI import plus local adapter surface.

## Runtime Boundary

The backend is the only process that may spawn MCP stdio commands or read saved secrets. The web UI receives redacted server configs.

## API Contract

The backend exposes versionless MVP routes under `/api`. Backward compatibility is managed by additive response fields during MVP. Any breaking change should be promoted to `/api/v2` after MVP.

## Operational Defaults

- structured Fastify logging
- explicit health endpoint
- deterministic scan events
- visible MCP errors
- one SQLite database file
- one exposed Docker port
