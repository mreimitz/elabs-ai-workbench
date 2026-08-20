import {
  API_TOKEN_AUTH_REQUIRED_ERROR_CODE,
  API_TOKEN_INVALID_ERROR_CODE,
  API_TOKEN_SCOPE_FORBIDDEN_ERROR_CODE,
  type ApiTokenScope,
  readBearerToken,
  requiredScopesForRoute,
} from "@mcp-token-footprint/shared";
import type { FastifyInstance } from "fastify";
import { httpError } from "../utils/errors.js";
import {
  normalizeRequestPath,
  type RequestPath,
  requestPathEquals,
  requestPathEqualsStrict,
  requestPathIsUnder,
  requestPathIsUnderStrict,
} from "../utils/request-path.js";
import type { ApiTokenAuthResult, ApiTokenService, AuthenticatedApiToken } from "./service.js";

/**
 * The service-token guard (planning/Roadmap/RM-08-ci/ WP 1.1, D-C2) — one root `onRequest` hook that decides whether
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
 * ## The path is matched DECODED, the way the router matches it
 *
 * Every prefix test here goes through `utils/request-path.ts` rather than comparing `request.url`
 * directly. Fastify's router percent-decodes before matching but the hook sees the RAW target, so a
 * raw comparison lets `/%61pi/tokens` (`%61` = `a`) read as "not under /api" — the guard passes it and
 * the router then dispatches it to the real `GET /api/tokens` handler. A remote, unauthenticated
 * caller would get the whole API that way, token CRUD included.
 *
 * `requestPathIsUnder` therefore matches on the union of the raw AND decoded forms and treats an
 * undecodable path as governed, so the guard is always at least as inclusive as the router. See that
 * module for the measured router behaviour this is pinned to.
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

/** What the guard decided, and (when refused) exactly why. */
export type ApiTokenAccessDecision =
  | { kind: "pass" }
  | { kind: "authenticated"; token: AuthenticatedApiToken }
  | { kind: "refused"; status: 401 | 403; code: string; message: string };

export type ApiTokenAccessRequest = {
  method: string;
  /**
   * The RAW request target exactly as `request.url` carries it — query string and percent-escapes
   * included. Normalization (strip the query, decode, match on the union) happens INSIDE
   * {@link decideApiTokenAccess}, deliberately: a `path: string` field invited each caller to
   * pre-split it themselves, and a caller that split but did not DECODE is precisely the
   * `/%61pi/tokens` bypass. There is now nothing for a call site to get wrong.
   */
  url: string;
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
 *  0. The path is normalized first — query stripped, percent-decoded, matched on the union of the raw
 *     and decoded forms — so the guard and the router agree on what `/api` is (see the module docs).
 *  1. `GET /api/health` and every non-`/api/*` path pass untouched.
 *  2. A PRESENTED token is always verified, loopback or not. Malformed / unknown / revoked / expired
 *     ⇒ `401 invalid_token`, **including from 127.0.0.1**: a bad credential is an error, never a
 *     silent fall-through to the open local path (which would let a caller with a revoked token keep
 *     working from the same machine and never learn it was revoked).
 *  3. No token presented ⇒ loopback passes (unless `API_AUTH_REQUIRED`), remote gets
 *     `401 authentication_required`.
 *  4. A token-authenticated request is then scope-checked: `API_TOKEN_ROUTE_SCOPES` first (WP M.2 —
 *     the per-route overrides, which can only RELAX and are matched on the raw-AND-decoded
 *     intersection, D-MCP9), then the coarse method rule behind it — read methods need `read`, write
 *     methods need one of the execute scopes. `DELETE` is refused outright (D-MCP3 — deletes are
 *     excluded at every phase, and the route table cannot even express one), and `/api/tokens*` is
 *     refused, because a token that could mint or revoke tokens would make revocation meaningless.
 */
export function decideApiTokenAccess(request: ApiTokenAccessRequest): ApiTokenAccessDecision {
  const { method, url, remoteAddress, authorization, authRequired, authenticate } = request;
  const path = normalizeRequestPath(url);

  if (!requestPathIsUnder(path, API_PREFIX)) return { kind: "pass" };
  if (requestPathEquals(path, HEALTH_PATH) && method.toUpperCase() === "GET") {
    return { kind: "pass" };
  }

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

/** Authorization for an authenticated token: route overrides, then the coarse method rule. Rule 4. */
function scopeCheck(
  method: string,
  path: RequestPath,
  token: AuthenticatedApiToken,
): ApiTokenAccessDecision {
  // Token CRUD first: a token may never mint or revoke another token, whatever scopes it holds.
  // Without this a leaked read-only token could not be contained — its holder could not revoke it,
  // but neither could they be locked out by revoking it if they could just issue themselves a new one.
  if (requestPathIsUnder(path, TOKENS_PATH)) {
    return {
      kind: "refused",
      status: 403,
      code: API_TOKEN_SCOPE_FORBIDDEN_ERROR_CODE,
      message: "Service tokens cannot manage service tokens. Use Settings › API tokens on the host.",
    };
  }

  // Per-route mapping first (WP M.2), coarse method rule behind it. The two matchers are the STRICT
  // (raw-AND-decoded) ones on purpose — D-MCP9: a rule here can only ever RELAX what a route needs, so
  // it must not fire on an ambiguous path. `/%61pi/mcp` therefore falls through to the coarse rule and
  // still demands an execute scope, while `/api/mcp` gets the relaxed `read`. Swapping these for the
  // inclusive `requestPathEquals` / `requestPathIsUnder` above would be a privilege escalation.
  const allowed = requiredScopesForRoute(method, (rulePath, match) =>
    match === "exact"
      ? requestPathEqualsStrict(path, rulePath)
      : requestPathIsUnderStrict(path, rulePath),
  );
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
      // The RAW target — `decideApiTokenAccess` strips the query and decodes it itself, so this call
      // site cannot reintroduce the `/%61pi/tokens` bypass by pre-splitting without decoding.
      url: request.url,
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
