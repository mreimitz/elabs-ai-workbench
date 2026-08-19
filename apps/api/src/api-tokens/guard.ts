import {
  API_TOKEN_AUTH_REQUIRED_ERROR_CODE,
  API_TOKEN_INVALID_ERROR_CODE,
  API_TOKEN_SCOPE_FORBIDDEN_ERROR_CODE,
  type ApiTokenScope,
  readBearerToken,
  requiredScopesForMethod,
} from "@mcp-token-footprint/shared";
import type { FastifyInstance } from "fastify";
import { httpError } from "../utils/errors.js";
import type { ApiTokenAuthResult, ApiTokenService, AuthenticatedApiToken } from "./service.js";

/**
 * The service-token guard (roadmap/ci/ WP 1.1, D-C2) — one root `onRequest` hook that decides whether
 * a request may proceed, and on whose authority.
 *
 * ## The posture: loopback stays open, remote requires a token
 *
 * This app is a single-owner local tool with no login, and that stays true: a request arriving from
 * `127.0.0.0/8` / `::1` passes exactly as it did before this WP, so the browser UI is unaffected. What
 * changes is what happens when the instance is exposed beyond the machine it runs on — a container
 * published on a LAN, a tunnel, a shared box: from any non-loopback address, `/api/*` now requires a
 * valid `Authorization: Bearer mcpfp_…`. `API_AUTH_REQUIRED=true` opts into token auth on loopback too.
 *
 * This is D-MCP2 ("on localhost the mount follows the app's no-auth-by-design posture… non-local
 * exposure requires a service token") applied to the whole API rather than only the MCP mount.
 *
 * ## Loopback is decided from the SOCKET, never from a header
 *
 * {@link decideApiTokenAccess} takes a `remoteAddress` and no headers at all, and the hook feeds it
 * `request.socket.remoteAddress` — the peer address of the actual TCP connection. It deliberately does
 * NOT read `request.ip`, `X-Forwarded-For`, `X-Real-IP` or any other client-settable value. With
 * Fastify's `trustProxy` off (it is off — `Fastify({ logger: true })` in `index.ts`, pinned by
 * `test/api-tokens-guard.test.ts`) `request.ip` would be the socket address anyway; sourcing the socket
 * directly means the bypass stays unforgeable even if someone later turns `trustProxy` on, because an
 * `X-Forwarded-For: 127.0.0.1` header from anywhere on the network would otherwise mint a free pass.
 *
 * **Do not enable `trustProxy`**, and do not "simplify" this to `request.ip`.
 *
 * ## Registration
 *
 * Registered on the ROOT instance from `index.ts`, AFTER `registerFeatureRoutes` (so a switched-off
 * feature still 403s first — a disabled capability should read as disabled, not as an auth problem)
 * and before the feature routes. Being a root hook it covers every route regardless of registration
 * order, including routes registered later.
 */

declare module "fastify" {
  interface FastifyRequest {
    /**
     * The service token that authenticated this request, when one did. `undefined` for an
     * unauthenticated loopback request (the normal browser case) — which is exactly why a route that
     * later wants to know "was this a machine caller?" must check for presence rather than assume.
     */
    apiToken?: AuthenticatedApiToken;
  }
}

/** Path prefix every route this guard governs sits under. Anything else (the SPA, static assets, the
 *  OAuth callback page) is untouched. */
const API_PREFIX = "/api";

/** Always reachable, with or without a token: the Docker healthcheck and liveness probes must work
 *  even under `API_AUTH_REQUIRED=true`. It exposes no measurement data and mutates nothing. */
const HEALTH_PATH = "/api/health";

/** Token CRUD. A token may never mint or revoke another token — see {@link decideApiTokenAccess}. */
const TOKENS_PATH = "/api/tokens";

/**
 * Is this socket peer on the loopback interface? Fails CLOSED: an absent address (a destroyed socket,
 * a unix-socket peer) is treated as remote, so an unidentifiable caller never inherits the open path.
 *
 * Covers IPv4 loopback (the whole `127.0.0.0/8` block, not just `127.0.0.1`), IPv6 `::1`, and the
 * IPv4-mapped-IPv6 form Node reports on a dual-stack listener (`::ffff:127.0.0.1`).
 */
export function isLoopbackAddress(remoteAddress: string | undefined | null): boolean {
  if (!remoteAddress) return false;
  // A scoped IPv6 literal can carry a zone id (`::1%lo0`); the zone is not part of the address.
  const address = remoteAddress.split("%")[0]?.toLowerCase() ?? "";
  if (address === "::1") return true;
  const ipv4 = address.startsWith("::ffff:") ? address.slice("::ffff:".length) : address;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ipv4);
}

/** Does `path` sit at or under `prefix` (`/api/tokens` and `/api/tokens/x`, but not `/api/tokensish`)? */
function isUnder(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/** What the guard decided, and (when refused) exactly why. */
export type ApiTokenAccessDecision =
  | { kind: "pass" }
  | { kind: "authenticated"; token: AuthenticatedApiToken }
  | { kind: "refused"; status: 401 | 403; code: string; message: string };

export type ApiTokenAccessRequest = {
  method: string;
  /** The request path WITHOUT its query string. */
  path: string;
  /** `request.socket.remoteAddress` — the socket peer. Never a header-derived value. */
  remoteAddress: string | undefined;
  /** The raw `Authorization` header value, if any. */
  authorization: string | undefined;
  /** `API_AUTH_REQUIRED` — force token auth on loopback too. */
  authRequired: boolean;
  /** Verifies a presented plaintext token. Injected so this function stays pure and testable. */
  authenticate: (plaintext: string) => ApiTokenAuthResult;
};

/**
 * The whole access decision as one pure function — no Fastify, no headers beyond `Authorization`, no
 * clock. The rules, in the order they are applied:
 *
 *  1. `GET /api/health` and every non-`/api/*` path pass untouched.
 *  2. A PRESENTED token is always verified, loopback or not. Malformed / unknown / revoked / expired
 *     ⇒ `401 invalid_token`, **including from 127.0.0.1**: a bad credential is an error, never a
 *     silent fall-through to the open local path (which would let a caller with a revoked token keep
 *     working from the same machine and never learn it was revoked).
 *  3. No token presented ⇒ loopback passes (unless `API_AUTH_REQUIRED`), remote gets
 *     `401 authentication_required`.
 *  4. A token-authenticated request is then scope-checked, COARSELY (per-route mapping is WP M.2/M.3):
 *     read methods need `read`; write methods need one of the execute scopes; `DELETE` is refused
 *     outright (D-MCP3 — deletes are excluded at every phase); and `/api/tokens*` is refused, because
 *     a token that could mint or revoke tokens would make revocation meaningless.
 */
export function decideApiTokenAccess(request: ApiTokenAccessRequest): ApiTokenAccessDecision {
  const { method, path, remoteAddress, authorization, authRequired, authenticate } = request;

  if (!isUnder(path, API_PREFIX)) return { kind: "pass" };
  if (path === HEALTH_PATH && method.toUpperCase() === "GET") return { kind: "pass" };

  const presented = readBearerToken(authorization);

  if (presented !== undefined) {
    const result = authenticate(presented);
    if (!result.ok) {
      return {
        kind: "refused",
        status: 401,
        code: API_TOKEN_INVALID_ERROR_CODE,
        message:
          result.reason === "expired"
            ? "That service token has expired. Create a new one in Settings › API tokens."
            : "That service token is not valid. Create one in Settings › API tokens.",
      };
    }
    return scopeCheck(method, path, result.token);
  }

  if (isLoopbackAddress(remoteAddress) && !authRequired) return { kind: "pass" };

  return {
    kind: "refused",
    status: 401,
    code: API_TOKEN_AUTH_REQUIRED_ERROR_CODE,
    message:
      "This request needs a service token. Send it as `Authorization: Bearer mcpfp_…` — create one in Settings › API tokens.",
  };
}

/** Coarse authorization for an authenticated token. See {@link decideApiTokenAccess} rule 4. */
function scopeCheck(
  method: string,
  path: string,
  token: AuthenticatedApiToken,
): ApiTokenAccessDecision {
  // Token CRUD first: a token may never mint or revoke another token, whatever scopes it holds.
  // Without this a leaked read-only token could not be contained — its holder could not revoke it,
  // but neither could they be locked out by revoking it if they could just issue themselves a new one.
  if (isUnder(path, TOKENS_PATH)) {
    return {
      kind: "refused",
      status: 403,
      code: API_TOKEN_SCOPE_FORBIDDEN_ERROR_CODE,
      message: "Service tokens cannot manage service tokens. Use Settings › API tokens on the host.",
    };
  }

  const allowed = requiredScopesForMethod(method);
  if (allowed === null) {
    return {
      kind: "refused",
      status: 403,
      code: API_TOKEN_SCOPE_FORBIDDEN_ERROR_CODE,
      message: "Service tokens cannot delete anything.",
    };
  }

  const granted = new Set<ApiTokenScope>(token.scopes);
  if (!allowed.some((scope) => granted.has(scope))) {
    return {
      kind: "refused",
      status: 403,
      code: API_TOKEN_SCOPE_FORBIDDEN_ERROR_CODE,
      message: `This token does not have the scope this request needs (one of: ${allowed.join(", ")}).`,
    };
  }

  return { kind: "authenticated", token };
}

/**
 * Install the guard on the root Fastify instance.
 *
 * Errors go through the shared `httpError` helper so the central error handler formats them with the
 * machine-readable `code` a headless caller keys off (mirroring `features/routes.ts`). The presented
 * token is never included in a message — a 401 says the credential is invalid, never which one.
 */
export function registerApiTokenGuard(
  app: FastifyInstance,
  service: ApiTokenService,
  options: { authRequired: boolean },
): void {
  app.addHook("onRequest", async (request) => {
    const decision = decideApiTokenAccess({
      method: request.method,
      path: request.url.split("?")[0] ?? request.url,
      remoteAddress: request.socket.remoteAddress,
      authorization: request.headers.authorization,
      authRequired: options.authRequired,
      authenticate: (plaintext) => service.authenticate(plaintext),
    });

    if (decision.kind === "refused") {
      throw httpError(decision.status, decision.message, decision.code);
    }
    if (decision.kind === "authenticated") {
      request.apiToken = decision.token;
    }
  });
}
