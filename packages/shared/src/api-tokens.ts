import { z } from "zod";

// ==================================================================================================
// Service tokens — the API-token contract for headless/automation callers (roadmap/ci/, WP 1.1)
// ==================================================================================================
// The workbench's measurements have to be usable WITHOUT a browser: a CI job, the `mcpfp` CLI (WP 1.2),
// or an external agent on the MCP mount (WP M.2) needs a credential that is not a browser session and
// never touches a provider secret. This module is the single declaration of that credential's wire
// shape, and it lives in `packages/shared` so the guard, the routes, the Settings pane and the CLI all
// resolve to ONE definition rather than four drifting copies.
//
// Locked owner decisions this encodes (2026-08-19, `roadmap/ci/wp-1.1-service-tokens.md`):
//
//   • **D-C2 — loopback stays open, remote requires a token.** A request from 127.0.0.0/8 / ::1 passes
//     exactly as today (the browser UI is unaffected); a request from anywhere else must present a
//     valid `Authorization: Bearer mcpfp_…`. `API_AUTH_REQUIRED=true` forces token auth on loopback
//     too. This is D-MCP2 ("on localhost the mount follows the app's no-auth-by-design posture… non-
//     local exposure requires a service token") applied to the whole API rather than only /api/mcp.
//   • **D-C4 — the scope vocabulary is FROZEN at the four values below**, exactly the write scopes
//     D-MCP3 names, so WP M.2/M.3 consume this vocabulary unchanged.
//   • **Deletes are excluded at every phase (D-MCP3).** There is no delete scope, and a token-
//     authenticated `DELETE` is refused — see `API_TOKEN_SCOPE_FORBIDDEN_ERROR_CODE`.
//   • **No feature flag.** A service token is an auth PRIMITIVE, not a capability: a Settings switch
//     that can turn off an auth check is a foot-gun (contrast `mcp_server`, D-MCP6, which gates a
//     capability). There is deliberately no `api_tokens` entry in `feature-flags.ts`.

/**
 * Every scope a service token may carry, in display order. **Frozen (D-C4)** — exactly the write
 * scopes D-MCP3 names, plus `read`. Adding one is a cross-workstream decision, not a local edit:
 * WP M.2/M.3 map these onto the MCP mount's per-tool surface.
 *
 * There is intentionally **no delete scope**. Deletes are excluded at every phase (D-MCP3), so a
 * token-authenticated `DELETE` is refused outright rather than gated behind a scope nobody can grant.
 */
export const API_TOKEN_SCOPES = ["read", "scan:run", "runs:launch", "suites:run"] as const;

export type ApiTokenScope = (typeof API_TOKEN_SCOPES)[number];

export function isApiTokenScope(value: string | null | undefined): value is ApiTokenScope {
  return value != null && (API_TOKEN_SCOPES as readonly string[]).includes(value);
}

/**
 * The scopes that authorize a state-CHANGING request (everything but `read`). The WP 1.1 guard's
 * coarse rule is "a write method needs at least one of these"; WP M.2/M.3 replace that with a
 * per-route/per-tool mapping over the SAME vocabulary.
 */
export const API_TOKEN_EXECUTE_SCOPES = ["scan:run", "runs:launch", "suites:run"] as const;

export type ApiTokenExecuteScope = (typeof API_TOKEN_EXECUTE_SCOPES)[number];

/** What one scope means, for the Settings create form and the `mcpfp` docs. One sentence each. */
export const API_TOKEN_SCOPE_META: Record<ApiTokenScope, { label: string; description: string }> = {
  read: {
    label: "Read",
    description:
      "Read everything the workbench has already measured — servers, scans, runs, grades, skills, suites and reports. Required for any GET.",
  },
  "scan:run": {
    label: "Run scans",
    description: "Start a discovery scan of a registered MCP server.",
  },
  "runs:launch": {
    label: "Launch runs",
    description: "Start a test run (an agent session against a server).",
  },
  "suites:run": {
    label: "Run suites",
    description: "Start a suite mass-run (the test × environment × repetition matrix).",
  },
};

/** The marker every plaintext service token starts with, so a leaked string is recognizable on sight. */
export const API_TOKEN_PREFIX = "mcpfp_";

/**
 * Random bytes behind a token's secret half. 32 bytes = 256 bits, base64url-encoded to 43 characters.
 * A secret of this entropy does **not** need a slow KDF at rest — see `API_TOKEN_HASH_ALGORITHM`.
 */
export const API_TOKEN_SECRET_BYTES = 32;

/**
 * How many characters after the `mcpfp_` marker are stored in the clear for DISPLAY (`mcpfp_ab12cd34…`).
 * Display only — it is never sufficient to authenticate, and the full token is unrecoverable from it.
 */
export const API_TOKEN_PREFIX_LENGTH = 8;

/**
 * The digest stored in `api_tokens.token_hash`.
 *
 * A plain SHA-256 is CORRECT here and is not an oversight: the thing being hashed is a 256-bit
 * uniformly random secret this app generated, not a low-entropy human password, so there is no
 * dictionary to run and a slow KDF buys nothing but per-request latency on the hot auth path.
 * (`roadmap/team-server/` uses scrypt precisely because ITS input is a human-chosen password.)
 */
export const API_TOKEN_HASH_ALGORITHM = "sha256";

/**
 * How stale `last_used_at` may get before the guard writes it again (ms). A polling CI job must not
 * turn every authenticated request into a SQLite write; "used within the last minute" is as precise
 * as this field needs to be.
 */
export const API_TOKEN_LAST_USED_THROTTLE_MS = 60_000;

// ── Error codes (machine-readable, carried additively by the central error handler) ────────────────

/** 401 — no credential was presented and this request needs one (remote, or `API_AUTH_REQUIRED`). */
export const API_TOKEN_AUTH_REQUIRED_ERROR_CODE = "authentication_required";

/**
 * 401 — a credential WAS presented and it is malformed / unknown / revoked / expired. Returned even
 * from loopback: a bad credential is an error, never a silent fall-through to the open local path.
 */
export const API_TOKEN_INVALID_ERROR_CODE = "invalid_token";

/** 403 — the token authenticated, but its scopes do not cover this request (or it is a `DELETE`). */
export const API_TOKEN_SCOPE_FORBIDDEN_ERROR_CODE = "scope_forbidden";

// ── Wire shapes ───────────────────────────────────────────────────────────────────────────────────

/**
 * A service token as the API returns it — **redacted by construction**. There is no field that could
 * carry the secret: the plaintext exists only in the create response (`ApiTokenCreateResponse.secret`),
 * and only once.
 */
export type ApiToken = {
  id: string;
  /** Operator-facing name, e.g. "CI — footprint gate". */
  label: string;
  /** The first {@link API_TOKEN_PREFIX_LENGTH} characters after `mcpfp_`, for display only. */
  tokenPrefix: string;
  scopes: ApiTokenScope[];
  createdAt: string;
  /** ISO 8601, or `null` when the token has never authenticated a request. Throttled — see above. */
  lastUsedAt: string | null;
  /** ISO 8601, or `null` for a token that never expires. An expired token authenticates as invalid. */
  expiresAt: string | null;
};

export type ApiTokenListResponse = { tokens: ApiToken[] };

/** `POST /api/tokens` body. */
export type ApiTokenCreateInput = {
  label: string;
  scopes: ApiTokenScope[];
  /** ISO 8601 instant, or omitted/`null` for a token that never expires. */
  expiresAt?: string | null;
};

/**
 * `POST /api/tokens` response — **the only place `secret` ever appears.** It is not persisted, not
 * returned by the list endpoint, not logged at any level, and not present in any report or artifact.
 */
export type ApiTokenCreateResponse = { token: ApiToken; secret: string };

/** The maximum length of an operator-supplied label (a name, not a description). */
export const API_TOKEN_LABEL_MAX_LENGTH = 120;

export const apiTokenScopeSchema = z.enum(API_TOKEN_SCOPES);

/**
 * `POST /api/tokens`. `.strict()` rejects an unknown key loudly rather than silently dropping it (a
 * caller that thinks it granted a scope must not get a token that lacks it). At least one scope is
 * required — a scope-less token could authenticate but authorize nothing, which is a confusing
 * credential to hand someone rather than a useful one.
 */
export const apiTokenCreateSchema = z
  .object({
    label: z.string().trim().min(1).max(API_TOKEN_LABEL_MAX_LENGTH),
    scopes: z.array(apiTokenScopeSchema).min(1),
    expiresAt: z.string().datetime().nullish(),
  })
  .strict();

/**
 * Does a plaintext string even LOOK like one of our tokens? A cheap shape check used before hashing,
 * so an obviously-wrong `Authorization` header fails without a DB round-trip. Passing this proves
 * nothing about validity — the hash lookup is the actual check.
 */
export function looksLikeApiToken(value: string): boolean {
  return (
    value.startsWith(API_TOKEN_PREFIX) && value.length > API_TOKEN_PREFIX.length + API_TOKEN_PREFIX_LENGTH
  );
}

/**
 * Extract the bearer credential from an `Authorization` header value, or `undefined` when the header
 * is absent or is not a bearer scheme. The scheme match is case-insensitive (RFC 7235); the credential
 * itself is returned verbatim.
 */
export function readBearerToken(header: string | undefined | null): string | undefined {
  if (!header) return undefined;
  const match = /^Bearer[ \t]+(\S+)$/i.exec(header.trim());
  return match?.[1];
}

/**
 * The coarse method → required-scope rule the WP 1.1 guard enforces, declared here so the API, the
 * CLI and the docs agree on one statement of it:
 *
 *   • `GET`/`HEAD`/`OPTIONS` → `read`
 *   • `POST`/`PUT`/`PATCH`   → at least one of {@link API_TOKEN_EXECUTE_SCOPES}
 *   • `DELETE`               → **never** (D-MCP3 — deletes are excluded at every phase)
 *
 * Returns the scopes ANY ONE of which satisfies the request, or `null` when no scope can (a delete).
 * Fine-grained per-route mapping lands in WP M.2/M.3 over this same vocabulary.
 */
export function requiredScopesForMethod(method: string): readonly ApiTokenScope[] | null {
  const verb = method.toUpperCase();
  if (verb === "DELETE") return null;
  if (verb === "GET" || verb === "HEAD" || verb === "OPTIONS") return ["read"];
  return API_TOKEN_EXECUTE_SCOPES;
}
