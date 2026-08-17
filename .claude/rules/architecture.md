# Architecture

The shape of the app, the package boundaries, and the rules that keep them clean. Start at
[`../../CLAUDE.md`](../../CLAUDE.md) for the product target; this file is the structural contract.

## System shape

```
Browser SPA (apps/web)
   |  fetch /api/*   (apps/web/src/lib/api.ts)
   v
Fastify API (apps/api)
   |  better-sqlite3
   v
data/app.sqlite
   |  @modelcontextprotocol/sdk: child process (stdio) | HTTP client (streamable_http)
   v
MCP servers
```

## Package boundaries (pnpm workspace)

- **`apps/web`** — React 19 + Vite SPA. Owns screen composition, local UI state, and API calls.
  **No** database access, **no** MCP connections, **no** secret handling. Navigation is URL routing
  via `react-router-dom` v7 (`<Routes>` in `App.tsx`; deep-linkable routes + breadcrumbs).
- **`apps/api`** — Fastify 5. Owns the DB, MCP connections, token counting, scan orchestration,
  OAuth, report export, and serving the built web app in production.
- **`packages/shared`** — the API contract: `types.ts`, `schemas.ts` (zod), `constants.ts`.
  Both `web` and `api` import from here. **This is the single source of truth for wire shapes.**

UI comes from the vendored **`@elabs-ai/components-*`** design system (see `dependencies.md`,
`styling-and-tokens.md`, `library-first.md`); the old `packages/brand-ui` adapter is removed.

Dependency direction: `web -> shared`, `web -> @elabs-ai/components-*`, `api -> shared`. Never `shared -> api/web`,
never `web -> api` source imports (talk over HTTP only).

## Runtime boundary (do not cross)

The **API is the only process** that may spawn MCP stdio commands, make MCP HTTP calls, or read
decrypted secrets. The browser receives **redacted** server configs only. Anything that needs a
secret or an MCP connection belongs in `apps/api`. See `mcp-and-security.md`.

## Contract-first workflow

A change that touches the wire (new field, new endpoint, new request body) is made **in
`packages/shared` first** — add/adjust the type and the zod schema — then implement the API
handler, then consume it in `web`. This keeps both ends type-checked against one definition.

## API conventions

- Routes live in `apps/api/src/**/routes.ts`, registered from `apps/api/src/index.ts`.
- Versionless `/api/*` during the MVP. **Additive response fields only**; a breaking change
  graduates to `/api/v2`.
- Validate request bodies/params with zod schemas from `shared`. The central error handler maps
  `ZodError -> 400` and otherwise honors `error.statusCode` (default 500). Don't hand-roll error
  shapes in handlers — throw typed errors.
- Structured Fastify (`pino`) logging. Surface MCP/connection failures; never swallow them.

## Persistence

One SQLite file via `better-sqlite3` (`apps/api/src/db/`). Baseline DDL lives in `schema.ts`;
versioned migrations (`PRAGMA user_version`-gated, idempotent) live in `database.ts` and run on
startup. Repositories (`*/repository.ts`) own SQL; services (`*/service.ts`) own orchestration;
routes stay thin. Keep that layering.

## When extending toward the target

Tool execution, runtime token measurement, and cross-server / tool-level comparison (see
`../../roadmap/08-expanded-target.md`) follow the same rules: new types in `shared`, logic in the
API behind the runtime boundary, thin routes, and the UI consuming redacted/typed responses.
