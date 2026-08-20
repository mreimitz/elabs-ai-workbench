---
type: "Work Package Spec"
title: "WP 1.1 \u2014 Contract + service tokens (apitokens, auth middleware, Settings UI)"
description: "Phase 1 of README.md. Ledger: STATUS.md. Shared rules: the"
tags: ["roadmap", "RM-08"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# WP 1.1 — Contract + service tokens (`api_tokens`, auth middleware, Settings UI)

Phase 1 of [`README.md`](./item.md). Ledger: [`STATUS.md`](./STATUS.md). Shared rules: the
[testing conventions](/Roadmap/RM-26-testing/conventions.md) + the repo rules in `.claude/rules/`.

**Depends on:** nothing. **Consumed by:** WP 1.2 (`mcpfp` CLI), WP M.2 (scopes on the MCP mount),
`roadmap/team-server/`.

---

## Locked decisions (owner, 2026-08-19 — kickoff of Phase 1)

- **D-C1 — CLI packaging:** the `mcpfp` CLI is a new workspace package **`apps/cli`**, published
  nowhere, invoked via `pnpm --filter cli`. *(Binds WP 1.2, not this WP — recorded here so the
  token contract is shaped for a real package consumer.)*
- **D-C2 — token storage + auth posture:**
  - A new **`api_tokens`** table at **`user_version` v58** (57 is the current latest; claim 58, never
    a duplicate).
  - **Loopback stays open, remote requires a token.** A request from `127.0.0.0/8` / `::1` /
    `::ffff:127.*` passes exactly as today (the browser UI is unaffected). A request from any other
    address to `/api/*` must present a valid `Authorization: Bearer mcpfp_…`. This is D-MCP2
    ("on localhost the mount follows the app's no-auth-by-design posture… non-local exposure requires
    a service token") applied to the whole API rather than only the MCP mount.
  - An env switch **`API_AUTH_REQUIRED=true`** forces token auth on loopback too.
- **D-C4 — scope vocabulary (new, locked with the above):** a frozen tuple in `packages/shared` —
  **`read` · `scan:run` · `runs:launch` · `suites:run`**. Exactly the write scopes D-MCP3 names, so
  WP M.2/M.3 consume this vocabulary unchanged. **Deletes are excluded at every phase** (D-MCP3):
  there is no delete scope and token-authenticated `DELETE` is refused.
- **No feature flag.** Service tokens are an auth primitive, not a capability — a Settings switch
  that can turn *off* an auth check is a foot-gun. (Contrast `mcp_server`, D-MCP6, which gates a
  *capability*.)

---

## What we're building

1. **The wire contract** (`packages/shared`) — the scope vocabulary, the token shapes, the zod
   schemas. Contract-first: this lands before any API or web code.
2. **Persistence + service** — `api_tokens` (hashed at rest, scoped, labelled, `last_used_at`),
   create / list / revoke.
3. **The guard** — one root `onRequest` hook that authenticates a presented bearer token, attaches
   its scopes to the request, and enforces the loopback/remote posture above.
4. **Settings › API tokens** — create a token (label + scopes + optional expiry), see it **once**,
   copy it, list the rest by prefix, revoke with a confirm.

---

## Design (implement this, don't redesign it)

### Token format & hashing

- Plaintext token: **`mcpfp_` + 43 chars of base64url** from `crypto.randomBytes(32)` (256 bits of
  entropy). Generated with `node:crypto` — **no new dependency**.
- Stored: `token_hash` = **SHA-256 hex of the full plaintext token** (`mcpfp_…` included), plus a
  `token_prefix` = the first **8** characters *after* the `mcpfp_` marker, for display
  (`mcpfp_ab12cd34…`). A 256-bit random secret does not need a slow KDF — that is for
  low-entropy human passwords (which is why `roadmap/team-server/` uses scrypt and this does not).
  Say so in a comment so the next reader doesn't "fix" it.
- **The plaintext is returned exactly once**, from the create response. It is never persisted, never
  returned by the list endpoint, never logged (not at any level, not in an error message, not in a
  request log), and never appears in a report or artifact.
- Lookup is by hash: `SELECT … WHERE token_hash = ?` with a **UNIQUE** index — never a scan-and-compare.

### `api_tokens` (migration **v58**, plus the same DDL in the `schema.ts` baseline)

| column | type | notes |
| --- | --- | --- |
| `id` | TEXT PK | nanoid, like every other table |
| `label` | TEXT NOT NULL | operator-facing name, e.g. "CI — footprint gate" |
| `token_hash` | TEXT NOT NULL UNIQUE | SHA-256 hex |
| `token_prefix` | TEXT NOT NULL | display only |
| `scopes_json` | TEXT NOT NULL | JSON array of `ApiTokenScope` |
| `created_at` | TEXT NOT NULL | ISO 8601, repo convention |
| `last_used_at` | TEXT NULL | bumped on successful auth, **throttled** (skip the write when the stored value is < 60 s old) so a polling CI job doesn't write on every request |
| `expires_at` | TEXT NULL | optional; an expired token authenticates as invalid |

Follow the existing migration style in `apps/api/src/db/database.ts` (idempotent, `hasTable`
guards, a comment block that says what it does and that it bumps `LATEST_SCHEMA_VERSION` to 58).
A fresh DB must come up correctly from `schema.ts` alone; an existing DB must upgrade in place.

### The guard (`apps/api/src/api-tokens/guard.ts`, registered on the root instance from `index.ts`)

Registration order: **after** `registerFeatureRoutes` (so a disabled feature still 403s first) and
before the feature routes. Rules, in order:

1. **`GET /api/health` is always exempt** — the Docker healthcheck and liveness probes must work
   even with `API_AUTH_REQUIRED=true`.
2. **Non-`/api/*` paths are untouched** — the SPA, static assets and the OAuth callback page keep
   working as today.
3. **A presented token is always verified, loopback or not.** A malformed / unknown / revoked /
   expired bearer token is **`401 { code: "invalid_token" }`** even from 127.0.0.1. A bad credential
   is an error, never a silent fall-through to the open path.
4. **A valid token attaches `request.apiToken = { id, label, scopes }`** (declare the Fastify request
   augmentation in the module) and bumps `last_used_at` (throttled).
5. **No token presented:** loopback → pass (unless `API_AUTH_REQUIRED=true` → `401 { code:
   "authentication_required" }`); non-loopback → `401 { code: "authentication_required" }`.
6. **Coarse scope enforcement for token-authenticated requests** (fine-grained per-route mapping is
   WP M.2/M.3 — do not build it here):
   - `GET`/`HEAD`/`OPTIONS` require **`read`**;
   - `POST`/`PUT`/`PATCH` require **at least one** of `scan:run` · `runs:launch` · `suites:run`;
   - **`DELETE` is always refused** for a token-authenticated request — `403 { code:
     "scope_forbidden" }` (D-MCP3: deletes are excluded at every phase).
   - A failure is `403 { code: "scope_forbidden" }`, never 401.
   - Token CRUD itself (`/api/tokens*`) is **loopback-or-`API_AUTH_REQUIRED`-only**: a token may
     never mint or revoke another token. Reject a token-authenticated request to `/api/tokens*` with
     `403 { code: "scope_forbidden" }`.
7. **Loopback is decided from the socket, never from a header.** Use `request.socket.remoteAddress`
   (or `request.ip` while `trustProxy` stays off — it is off today: `Fastify({ logger: true })`).
   **Do not enable `trustProxy`**, and add a test that pins it off: with it on, an
   `X-Forwarded-For: 127.0.0.1` header from anywhere on the network would forge the bypass.

Errors go through the existing `httpError` helper so the central error handler formats them
(mirror `apps/api/src/features/routes.ts`).

### Routes (`apps/api/src/api-tokens/routes.ts`)

- `GET /api/tokens` → `{ tokens: ApiToken[] }` — redacted rows (prefix, never the secret).
- `POST /api/tokens` → `{ token: ApiToken; secret: string }` — the **only** place `secret` appears.
- `DELETE /api/tokens/:id` → `204`. Revocation is removal of the row: immediate, and there is no
  consumer for a tombstone yet. The UI confirms first (destructive-action rule).

Thin routes, zod-validated bodies from `shared`, logic in `service.ts`, SQL in `repository.ts` —
the existing layering.

### Web — Settings › API tokens

- A new `SETTINGS_SECTION_IDS` member **`tokens`** (label "API tokens"), placed in the existing
  rail groups next to the other machine-facing settings. This adds **no `<Route>`** — it rides the
  existing deep-linkable `/settings/:section`, so `ASSISTANT_ROUTE_MANIFEST` and the
  `assistant-route-operability` gate are untouched. Confirm they stay green; do not edit the manifest.
- `@elabs-ai/components-*` only. Table via `DataTable`; create flow in a `Dialog`; icon-only actions via the
  repo's `IconButton` (tooltip == `aria-label`, per D-TB5); destructive delete behind a confirm.
- **The one-time reveal is the UX centre of gravity:** after create, show the secret in a
  copy-to-clipboard field with an unmissable "you will not see this again" line, and make closing
  the dialog the explicit acknowledgement. Never re-render it afterwards.
- Empty state via `EmptyState`; `tabular-nums` on the date columns; both themes must read correctly.

### Docs

- `.env.example` — add `API_AUTH_REQUIRED` with a one-line comment.
- `CLAUDE.md` §7 (Environment) — add `API_AUTH_REQUIRED` to the env list; §6 — add a `Tokens
  (api-tokens/)` bullet to the endpoint-family list.
- `user-guide/21-service-tokens.md` — a short owner-facing page: what a token is for, creating one,
  the loopback/remote posture, `API_AUTH_REQUIRED`, the scopes and what they will unlock (naming WP
  1.2 / M.2 / M.3 as not-yet-built), and the "shown once" rule. Link it from
  `user-guide/README.md`.

---

## Files (for parallel-safety bookkeeping — this WP runs **solo**)

- `packages/shared/src/api-tokens.ts` (new), `packages/shared/src/index.ts` (one export line)
- `apps/api/src/db/schema.ts`, `apps/api/src/db/database.ts` (v58)
- `apps/api/src/api-tokens/{repository,service,routes,guard}.ts` (new)
- `apps/api/src/index.ts` (wire the repository/service + register the guard and routes)
- `apps/api/test/api-tokens*.test.ts` (new)
- `apps/web/src/features/settings/SettingsView.tsx`, `apps/web/src/features/settings/TokensSection.tsx` (new),
  `apps/web/src/lib/api.ts`
- `apps/web/src/features/settings/tokens-section.test.tsx` (new)
- `.env.example`, `CLAUDE.md`, `user-guide/21-service-tokens.md`, `user-guide/README.md`

---

## Acceptance

Tick only what is actually observed — the gate output and the tests, not intent.

- [ ] **A1 — contract-first.** Scope vocabulary + token types + zod schemas live in
      `packages/shared` and are exported from its `index.ts`; API and web both import from there.
      `API_TOKEN_SCOPES` is exactly `["read","scan:run","runs:launch","suites:run"]`.
- [ ] **A2 — migration.** `LATEST_SCHEMA_VERSION` is **58**; a fresh DB boots from `schema.ts` with
      `api_tokens` present, and a DB stamped at 57 upgrades in place. Both paths covered by a test.
- [ ] **A3 — hashed at rest.** No column holds the plaintext. A created token's `secret` is
      returned once and never again; `GET /api/tokens` returns prefixes only. A test asserts the
      stored row does not contain the plaintext.
- [ ] **A4 — loopback open.** With no token and no `API_AUTH_REQUIRED`, a loopback request to a
      normal endpoint succeeds exactly as before (the browser UI is unregressed).
- [ ] **A5 — remote requires a token.** A non-loopback request with no bearer token gets
      `401 authentication_required`; with a valid token it passes.
- [ ] **A6 — a bad token always fails.** Malformed / unknown / revoked / expired → `401
      invalid_token`, **including from loopback**.
- [ ] **A7 — `API_AUTH_REQUIRED=true`** makes loopback require a token too, and `GET /api/health`
      still answers.
- [ ] **A8 — coarse scopes enforced.** `read`-only token: `GET` passes, `POST` → `403
      scope_forbidden`. Execute-scoped token: `POST` passes. **Any** token: `DELETE` → `403
      scope_forbidden`. Any token → `/api/tokens*` → `403 scope_forbidden`.
- [ ] **A9 — no header-forged bypass.** A test pins `trustProxy` off and shows that
      `X-Forwarded-For: 127.0.0.1` from a non-loopback socket does **not** get the bypass.
- [ ] **A10 — never logged.** The plaintext token appears in no log line, no error message, and no
      response other than the create response. Verified by reading the code paths **and** an
      assertion on the create/auth paths.
- [ ] **A11 — `last_used_at`** is bumped on a successful token auth and throttled (a second request
      inside the window does not write).
- [ ] **A12 — Settings › API tokens** lists, creates (label + scopes + optional expiry), reveals the
      secret **once** with copy + an explicit "shown once" warning, and revokes behind a confirm.
      `@elabs-ai/components-*` only, `IconButton` for icon-only actions, real `EmptyState`.
- [ ] **A13 — both themes + keyboard.** The new section reads correctly in `light` and `dark`, is
      keyboard-reachable with visible focus. *(Claim this only from the running app — otherwise
      report it as unverified and leave it for owner acceptance.)*
- [ ] **A14 — route gate untouched.** No new `<Route>`; `assistant-route-operability` (api + web
      halves) stays green with **no** edit to `ASSISTANT_ROUTE_MANIFEST`.
- [ ] **A15 — no new runtime dependency**; `pnpm-lock.yaml` unchanged.
- [ ] **A16 — docs.** `.env.example`, `CLAUDE.md` §§6–7, and `user-guide/21-service-tokens.md`
      (linked from the user-guide README) describe the posture, the scopes, and the shown-once rule.
- [ ] **A17 — gate green** from the repo root: `pnpm typecheck && pnpm test && pnpm build && pnpm
      lint`, with the new API and web tests included.
