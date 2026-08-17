# MCP connections & security

This is a local/dev tool that connects to arbitrary MCP servers and stores their credentials.
Two things must always hold: secrets never leak to the browser, and secret-bearing files never
get committed.

## Runtime boundary

Only **`apps/api`** spawns MCP stdio child processes, makes MCP HTTP calls, or decrypts secrets.
The web UI talks to the API over HTTP and receives **redacted** configs. Never move MCP/secret
logic into `apps/web`.

## Transports

- **`stdio`** — the primary transport. Server is a `command` + `args` + `env`; the API spawns it
  via the MCP SDK.
- **`streamable_http`** — URL-based. The wizard is **URL-first**: the API probes the URL
  **unauthenticated** first (`POST /api/servers/probe`); a `401`/`403` means auth is required.
  Auth is then one of: bearer token, API-key header, custom headers, or OAuth.

## OAuth

Uses the MCP SDK OAuth provider flow. Default callback `http://127.0.0.1:8080/api/oauth/callback`
(override with `OAUTH_REDIRECT_URL`). Providers without Dynamic Client Registration need a pre-registered client id. OAuth tokens, client info, discovery state, and code
verifiers are stored **encrypted**.

## Secret handling (non-negotiable)

- MCP `env`/`headers` secrets and all OAuth material are **encrypted before** SQLite persistence
  (`apps/api/src/secrets/`, `apps/api/src/oauth/`).
- The API **never returns secret values**. Configs expose only booleans
  (`hasEnvSecrets`, `hasHeaderSecrets`) and non-secret auth metadata (`authType`, header name).
- Encryption key: `MCP_SECRET_KEY` (base64, 32 bytes) **or** an auto-generated
  `DATA_DIR/mcp-secret.key`. Losing **both** makes stored secrets unrecoverable. Keep the key in
  the same persistent `/data` volume as the DB in Docker.
- Plaintext secret rows are migrated to encrypted form on API startup. Key rotation is out of scope.

## Files & git

- Real secrets live in `.env.local` (git-ignored). Only `.env.example` is committed.
- Never commit `.env*` (except the example), `*.pem`, `*.key`, or `data/mcp-secret.key`.
- Two guardrails enforce this: the `guard-secrets.mjs` PreToolUse hook (blocks `git add/commit`
  of secret-like paths) and the `permissions.deny` reads in `settings.json`. Don't weaken them.

## Building the tool playground (target)

When adding `tools/call` execution: run it **in the API**, accept user-supplied arguments
validated against the tool's input schema, and treat tool output as untrusted — never echo
secrets back, never log full argument payloads that may contain user secrets, and measure token
cost without persisting sensitive request bodies in cleartext. See
`../../roadmap/08-expanded-target.md`.
