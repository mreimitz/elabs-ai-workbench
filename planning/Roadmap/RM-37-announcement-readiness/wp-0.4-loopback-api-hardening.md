---
type: "Work Package Spec"
title: "WP 0.4 — Loopback API: Origin/Host allow-list, CSRF and DNS-rebinding defence, security headers, git env minimisation"
description: "Phase 0 of item.md. Ledger: STATUS.md. Add an onRequest Host and Origin allow-list plus a browser CSRF token to the no-auth loopback API, send security headers on the SPA and /api, rate-limit auth failures and scan/run triggers, stop the git subprocess inheriting MCP_SECRET_KEY, drop filesystem paths from the unauthenticated health payload, and give service tokens a bounded default expiry."
tags: ["roadmap", "RM-37"]
timestamp: "2026-08-22T07:10:00Z"
status: "final"
---
# WP 0.4 — Loopback API: Origin/Host allow-list, CSRF and DNS-rebinding defence, security headers, git env minimisation

Phase 0 of [`item.md`](./item.md). Ledger: [`STATUS.md`](./STATUS.md).

## Scope

Files: `apps/api/src/index.ts` (the `onRequest` chain at `:350-360` carries only the feature and token
guards — no Host, Origin or CSRF check; static SPA serving at `:1786-1799`; `/api/health` at
`:1420-1431` returns `databasePath` and `dataDirectory`), `apps/api/src/api-tokens/guard.ts:179`
(tokenless loopback pass), `apps/api/src/servers/routes.ts:87` (`POST /api/servers` registers a stdio
`command`/`args`/`env`) and `:110` (`POST /api/servers/:id/test`), `apps/api/src/git/git-credential.ts:52-59`
(`env: { ...process.env, … }`), `apps/api/src/assistant/spawn-env.ts:46` (`buildAssistantSpawnEnv`, the
minimal-env precedent), `apps/api/src/api-tokens/service.ts:89-101` and
`apps/web/src/features/settings/TokensSection.tsx:130,269` (expiry "Never"), `apps/api/package.json`
(no `@fastify/cors`, `@fastify/helmet` or `@fastify/rate-limit` today), README §Data & security
(`README.md:559-574`), `.env.example`. Out of scope: the container peer-trust decision and launcher binds
(WP 0.3), transcript retention and export redaction, the `read`-scope content tier, mission/auto-accept
approval gaps and the egress statement (WP 1.5), team-server auth (RM-25).

## Actions

1. Host allow-list: register an `onRequest` hook in `apps/api/src/index.ts` ahead of the feature guard
   that answers 403 `host_not_allowed` when the `Host` header is not `127.0.0.1`, `localhost`, `[::1]`
   (any port) or an entry of the new `API_ALLOWED_HOSTS` (comma-separated, default empty; launchers set
   nothing). A DNS-rebound page carries its own hostname, so it is refused before routing. — P0
2. Cross-site origin check in the same hook: when `Origin` (or, absent, `Referer`) is present and its
   host is not in the allow-list, or `Sec-Fetch-Site: cross-site` is set, answer 403
   `origin_not_allowed` for every verb; requests that carry `Authorization: Bearer mcpfp_…` and no
   `Origin` (CLI, CI, MCP hosts) are unaffected. — P0
3. Browser CSRF token: the SPA shell response sets a per-install random token as a `SameSite=Strict`,
   `HttpOnly=false` cookie; the web client sends it back as `X-Workbench-Csrf` on every state-changing
   request (`apps/web/src/lib/api.ts` fetch wrapper); the hook requires the header to match the cookie on
   POST/PUT/PATCH/DELETE from tokenless callers. Alternative if the owner prefers tokens everywhere:
   default `API_AUTH_REQUIRED=true` with a first-run browser token minted on `/`. — P1
4. Security headers on `/` and `/api/*` (a 15-line `onSend` hook or `@fastify/helmet`):
   `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'self'; img-src 'self' data:;
   connect-src 'self'; frame-ancestors 'none'` (add `style-src 'unsafe-inline'` only if the design
   system needs it — verify on the built bundle), `X-Frame-Options: DENY`, `Referrer-Policy:
   no-referrer`. — P1
5. Rate limits (`@fastify/rate-limit` or a small in-memory window): token-auth failures 20/min per peer
   → 429; `POST /api/servers/:id/scan`, `/api/servers/:id/test`, suite/run launch routes and the
   assistant `mcp_tool_call` action 60/min per peer or token; limits apply to tokenless loopback too;
   `/api/health` exempt. — P2
6. Git subprocess env (`git-credential.ts:57`): replace `{ ...process.env, … }` with a minimal map
   (`PATH`, `HOME`, `LANG`, `GIT_*`, proxy variables) mirroring `buildAssistantSpawnEnv`
   (`spawn-env.ts:46`); test that `MCP_SECRET_KEY` and `DATABASE_PATH` are absent from the child env. — P1
7. Health payload (`index.ts:1420-1431`): keep `ok`, `service`, `version`, `dockerMode`,
   `defaultTokenProfile`; drop `databasePath` and `dataDirectory`; move the paths to an authenticated
   `GET /api/diagnostics` that Settings › About reads and that WP 1.4's export builds on. — P2
8. Service tokens: default expiry 90 days (`service.ts:89-101`, picker in `TokensSection.tsx:130,269`
   where "Never" becomes an explicit choice); "Last used" is the first column of each token row; a
   "Rotate" action mints a replacement and revokes the old one in one step. — P2
9. Tests in `apps/api/test/`: `Host: evil.example` → 403; `POST /api/servers` with
   `Origin: https://evil.example` → 403; same-origin POST with cookie + header → 2xx; POST with a valid
   Bearer and no Origin → 2xx; headers present on `/` and `/api/health`; 21st failed token in a minute →
   429; git child env minimal. `e2e/smoke.spec.ts` still passes (Host `localhost`). — P0
10. Docs: README §Data & security (`:559-574`) replaces "no authentication by design" with the actual
    model (loopback peer + Host/Origin allow-list + browser CSRF token; service tokens for everything
    else); `.env.example` documents `API_ALLOWED_HOSTS` and the rate-limit knobs. — P1

## Acceptance

- [ ] `curl -H 'Host: evil.example' http://127.0.0.1:8080/api/servers` → 403;
      `curl -X POST -H 'Origin: https://evil.example' -H 'Content-Type: application/json' -d '{}'
      http://127.0.0.1:8080/api/servers` → 403; the browser at `http://localhost:8081` adds a server and
      scans it without error.
- [ ] `curl -I http://127.0.0.1:8080/` and `/api/health` show `nosniff`, a CSP containing
      `frame-ancestors 'none'`, `X-Frame-Options: DENY` and `Referrer-Policy: no-referrer`; the SPA
      renders in both themes with the CSP active (no console CSP violations).
- [ ] 25 requests with a bad token inside one minute: the 21st answers 429.
- [ ] Unauthenticated `GET /api/health` body contains no path fields; Settings › About still shows them
      through `/api/diagnostics`.
- [ ] API test proves the git child env lacks `MCP_SECRET_KEY`; a GitHub skill import still works.
- [ ] A newly minted token shows an expiry date by default; the token table shows "Last used" first and
      offers "Rotate".
- [ ] `mcpfp scan` and both `examples/github-actions/` workflows run against a live instance with a
      Bearer token and no Origin header (no 403).
- [ ] Gate green: `pnpm typecheck && pnpm test && pnpm build && pnpm lint`.

## Effort

**M** — the hook, CSRF round-trip and tests are two days; headers, rate limit, git env and token expiry
are a day together; CSP tuning against the built bundle is the uncertain part.

## Sources

`SEC-01, SEC-07, SEC-09, SEC-10, SEC-12, SEC-13`
