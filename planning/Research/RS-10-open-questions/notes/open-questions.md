---
type: "Research Note"
title: "07 Open Questions"
description: "None for the MVP implementation. The supplied request defines the scope, non-goals, stack, API routes, data model, UI screens, Docker target, and acceptance criteria."
tags: ["research", "RS-10"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# 07 Open Questions

## Blocking Questions

None for the MVP implementation. The supplied request defines the scope, non-goals, stack, API routes, data model, UI screens, Docker target, and acceptance criteria.

## Assumptions

- The new app lives under `mcp-token-footprint/` in the current workspace.
- `stdio` is the primary MVP transport.
- `streamable_http` is supported in the data model and implemented best-effort after stdio.
- The app is local/dev mode only.
- Saved MCP env/header secrets are encrypted before SQLite persistence and redacted from API responses.
- Token profiles are deterministic local estimates unless provider APIs are added later behind adapters.

## Secret Encryption Decision

- The default local Docker Desktop path generates a 32-byte encryption key at `DATA_DIR/mcp-secret.key`.
- Advanced users may provide `MCP_SECRET_KEY` as a base64-encoded 32-byte key.
- Existing plaintext `env_json` and `headers_json` rows are migrated on API startup.
- Key rotation is intentionally out of scope.

## MCP HTTP Authentication Decision

- Streamable HTTP servers use a URL-first modal wizard.
- The API probes unauthenticated first and treats `401`/`403` as authentication required.
- Bearer tokens and API-key headers compile into encrypted runtime headers.
- OAuth uses the MCP SDK OAuth provider flow with the default callback `http://127.0.0.1:8080/api/oauth/callback`.
- OAuth tokens, client information, discovery state, and code verifiers are stored encrypted in SQLite.

## Brand UI Fallback Process

1. Attempt to download the exact GitHub release `mreimitz/elabs-components@v1.0.0`.
2. Include `Authorization: Bearer $GH_TOKEN` or `Authorization: Bearer $GITHUB_TOKEN` when present.
3. Extract release source or assets into `packages/brand-ui`.
4. If inaccessible, document the failed fetch and keep a temporary adapter in `packages/brand-ui/src`.
5. Replace the adapter by wiring the real upstream packages once release access is available.

The fallback must not silently become a shadcn replacement. It exists only as a compatibility layer for local development.

## Brand Import Result

On 2026-06-19, the exact release API URL and exact tag source archive URL both returned `404` without credentials in this environment.

The read-only reference admin UI already included matching `v1.0.0` brand tarballs. These were copied to `packages/brand-ui/upstream/v1.0.0` for traceability while the runtime uses the temporary adapter package.

## Testing feature (run engine + console)

The Testing workstream (executable plan under `roadmap/testing/`, ledger in
`roadmap/testing/STATUS.md`) settled the following during Phases 0–2.

### Resolved decisions

- **Run-stream transport = Server-Sent Events (SSE).** The run console streams over
  `GET /api/runs/:id/stream` (one-way server→client, `reply.hijack()` + `reply.raw`, bounded-buffer
  replay → live, 15s heartbeat, persisted-replay fallback for finished runs). Not WebSockets — runs
  are server-pushed; interactive turns go back over a separate `POST /api/runs/:id/turns`.
- **Pricing maintained in code.** Per-model list prices for the run cost KPI + spend-cap guardrail
  live in `apps/api/src/providers/pricing.ts` (`MODEL_PRICING`), maintained **manually** — there is
  no live pricing feed and no env var. Cost is therefore an **estimate**, surfaced as "estimated";
  an unknown model contributes `0` (never crash, never block a run).
- **Multimodal attachments = base64-in-JSON, stored on disk under `ATTACHMENTS_DIR`.** Test inputs
  carry attachments as base64 in the JSON body (no `@fastify/multipart`); blobs are written under
  `ATTACHMENTS_DIR`, which defaults to `DATA_DIR/attachments` and therefore lives on the persistent
  `/data` volume alongside the DB + secret key in Docker.

### Again-open / for the owner

- **Provider-key environment fallback — NOT implemented (open).** The WP-4.3 spec (and the original
  Testing brief) envisioned an optional `*_API_KEY` env fallback "as a convenience." **Runtime code
  has none** — `grep` finds no `process.env.*_API_KEY` reads in `apps/api/src`, and no provider key
  is read from env anywhere. Provider keys are entered in the UI and stored **AES-256-GCM-encrypted
  in the DB** (`apps/api/src/providers`); the only `ANTHROPIC_API_KEY` references are optional,
  self-skipping **live smoke tests**, never the running app. Adding an env fallback would be a
  secret-boundary code change (out of scope for the config/docs WP); left open for the owner to
  decide whether it's wanted. Until then, docs/`.env.example` state the truth: keys are UI/DB-only.

# Citations

None.
