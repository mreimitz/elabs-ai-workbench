---
description: Add an MCP server and run a discovery scan end-to-end against the running API (manual verification of the core loop)
argument-hint: <stdio command | http URL> [server name]
---
Target server: $ARGUMENTS

Exercise the core scan loop against the **running API** (`pnpm dev` or `docker compose up`,
default `http://127.0.0.1:8080`). This is for manual verification — confirm the API is up first
(`GET /api/health`).

1. **Create the server** (`POST /api/servers`). Use the type/shape in
   `packages/shared/src/schemas.ts`:
   - stdio: `{ "name", "transport": "stdio", "command", "args": [], "env": {} }`
   - streamable HTTP: probe first (`POST /api/servers/probe { "url" }`) to detect whether auth is
     required, then create with `{ "name", "transport": "streamable_http", "url", "auth": {...} }`.
2. **Scan it** (`POST /api/servers/:id/scan`), optionally with a `tokenProfile`.
3. **Read results** (`GET /api/scans/:id`): total tokens, total tools, ranked tool breakdown,
   largest tool, and scan events.
4. **Report** the totals and the top few tools by token contribution. Optionally export
   (`GET /api/reports/scan/:id/markdown`).

Notes:
- Use `curl` for these calls (the API has no auth in local mode).
- Never paste real secrets into the chat; for authed HTTP servers prefer a token already saved
  on the server config. Secret values are never returned by the API.
- If a scan fails, surface the `scan_events` error rather than guessing.
