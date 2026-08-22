import {
  CSRF_HEADER_NAME,
  CSRF_TOKEN_INVALID_ERROR_CODE,
  HOST_NOT_ALLOWED_ERROR_CODE,
  ORIGIN_NOT_ALLOWED_ERROR_CODE,
  hostnameFromHostHeader,
  hostnameFromUrl,
  isAllowedHostname,
  looksLikeCsrfToken,
  readBearerToken,
  readCookie,
  CSRF_COOKIE_NAME,
} from "@mcp-token-footprint/shared";
import type { FastifyInstance } from "fastify";
import { httpError } from "../utils/errors.js";
import { normalizeRequestPath, requestPathIsUnder } from "../utils/request-path.js";

/**
 * The browser-facing guard (RM-37 WP 0.4) — one root `onRequest` hook that answers three questions
 * the service-token guard structurally cannot.
 *
 * `api-tokens/guard.ts` decides on the **socket peer**, which is the right answer for a caller on
 * the network and the wrong answer for a page in the operator's own browser. A DNS-rebound page and
 * a cross-site form POST both arrive over a genuine loopback socket, from the operator's own
 * machine, and `isLoopbackAddress` says yes to both — correctly, and uselessly. What separates them
 * from the real UI is not where the packets came from but what the browser said about the document
 * that sent them. That is what this hook reads.
 *
 * ## Registration order
 *
 * Root `onRequest`, registered AFTER the feature guard and BEFORE the token guard:
 *
 *   feature flags → **this** → rate limit → service tokens
 *
 * A switched-off feature must still read as switched off rather than as a security refusal; and a
 * request the browser itself says is cross-site should be refused before the API spends a SHA-256
 * and a SQLite lookup verifying whatever credential it brought along.
 *
 * ## The three checks
 *
 * **1. Host allow-list — every path, every verb.** The `Host` header is what a DNS-rebound page
 * cannot fake: it asked for `attacker.example:8080`, and the header says so. Refusing here (403
 * `host_not_allowed`) also covers the SPA itself, so a rebound page cannot even load the app shell
 * to phish against. An absent or unparseable `Host` is a refusal — fails closed.
 *
 * **2. Cross-site refusal — `/api/*` only.** `Origin`, else `Referer`, else `Sec-Fetch-Site`. Not
 * applied outside `/api` because a cross-site *link* to `http://localhost:8081/scans` is a normal
 * thing for a person to click, and refusing it would break bookmarks and chat links for no gain —
 * loading the SPA is not a state change, and every state change is under `/api`.
 *
 * **3. Browser CSRF token — `/api/*`, state-changing verbs, tokenless callers only.** A caller that
 * presents `Authorization: Bearer mcpfp_…` is not a browser and is exempt (that is the CLI, CI and
 * the MCP mount, none of which have a cookie jar an attacker can borrow). For everything else the
 * `x-workbench-csrf` header must equal the `workbench_csrf` cookie AND the per-install token, which
 * a cross-site page cannot read out of a `SameSite=Strict` cookie.
 *
 * ## The one carve-out, and why it is not a hole
 *
 * A **safe-method top-level navigation** (`Sec-Fetch-Mode: navigate` with GET/HEAD) is allowed even
 * when `Sec-Fetch-Site` says cross-site. Without it, `GET /api/oauth/callback` — which an MCP
 * provider redirects the operator's browser to, from the provider's own origin — would 403, and
 * OAuth for streamable-HTTP servers would simply stop working. It is safe because a cross-origin
 * page cannot READ the response of a navigation it triggered, and because nothing that changes state
 * in this app is reachable by GET.
 */

/** Path prefix the origin/CSRF halves govern. The Host check is not scoped — it covers everything. */
const API_PREFIX = "/api";

/** Verbs that may change state, and therefore need the CSRF proof from a tokenless caller. */
const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Verbs a browser may use for a top-level navigation. */
const SAFE_METHODS = new Set(["GET", "HEAD"]);

export type OriginGuardRequest = {
  method: string;
  /** The RAW request target (`request.url`) — normalized inside, never pre-split by a call site. */
  url: string;
  host: string | undefined;
  origin: string | undefined;
  referer: string | undefined;
  secFetchSite: string | undefined;
  secFetchMode: string | undefined;
  secFetchDest: string | undefined;
  authorization: string | undefined;
  cookie: string | undefined;
  csrfHeader: string | undefined;
  /** Parsed `API_ALLOWED_HOSTS`. Can only ever ADD names to the loopback defaults. */
  allowedHosts: readonly string[];
  /** The per-install CSRF token, or `undefined` when the store could not produce one (then the CSRF
   *  check is skipped rather than locking the operator out of their own app — see the hook). */
  csrfToken: string | undefined;
};

export type OriginGuardDecision =
  | { kind: "pass" }
  | { kind: "refused"; status: 403; code: string; message: string };

/**
 * The whole browser-facing decision as one pure function — no Fastify, no clock, no I/O. Every
 * branch is reachable from `apps/api/test/origin-guard.test.ts`.
 */
export function decideOriginAccess(request: OriginGuardRequest): OriginGuardDecision {
  const method = request.method.toUpperCase();

  // ── 1. Host ────────────────────────────────────────────────────────────────────────────────────
  const hostname = hostnameFromHostHeader(request.host);
  if (!isAllowedHostname(hostname, request.allowedHosts)) {
    return {
      kind: "refused",
      status: 403,
      code: HOST_NOT_ALLOWED_ERROR_CODE,
      message:
        "This workbench only answers to localhost. If you are reaching it under another hostname, add that hostname to API_ALLOWED_HOSTS.",
    };
  }

  const path = normalizeRequestPath(request.url);
  if (!requestPathIsUnder(path, API_PREFIX)) return { kind: "pass" };

  // A safe-method top-level navigation is a person following a link — including the OAuth provider's
  // redirect back to `/api/oauth/callback`. Checked BEFORE the cross-site tests, because those would
  // otherwise refuse exactly that redirect.
  const isSafeNavigation =
    SAFE_METHODS.has(method) && request.secFetchMode?.toLowerCase() === "navigate";

  // ── 2. Cross-site ──────────────────────────────────────────────────────────────────────────────
  if (!isSafeNavigation) {
    const site = request.secFetchSite?.toLowerCase();
    if (site === "cross-site") {
      return crossSiteRefusal();
    }

    // `Origin` first; `Referer` only when `Origin` is absent. An `Origin: null` (a sandboxed iframe,
    // a `data:` document, some redirect chains) parses to no hostname and is refused — a request
    // from an opaque origin has no business changing this app's state.
    const declared = request.origin ?? request.referer;
    if (declared !== undefined && declared.trim().length > 0) {
      const declaredHost = hostnameFromUrl(declared);
      if (!isAllowedHostname(declaredHost, request.allowedHosts)) {
        return crossSiteRefusal();
      }
    }
  }

  // ── 3. Browser CSRF token ──────────────────────────────────────────────────────────────────────
  if (!STATE_CHANGING_METHODS.has(method)) return { kind: "pass" };
  // A presented bearer token means a headless caller: the CLI, CI, or an agent on the MCP mount.
  // None of them has a cookie jar, and the token guard authenticates them a moment later.
  if (readBearerToken(request.authorization) !== undefined) return { kind: "pass" };
  // No install token available (a read-only or unavailable settings store). Refusing here would
  // brick the UI over a degraded side-table; the Host and cross-site checks above still stand.
  if (request.csrfToken === undefined) return { kind: "pass" };
  // A caller that is not a browser at all. See {@link carriesBrowserFingerprint}: this is what keeps
  // `mcpfp scan` on a tokenless loopback instance (D-C2, documented in the CLI's own help) and a
  // tokenless local MCP client on `POST /api/mcp` (D-MCP7) working exactly as they did.
  if (!carriesBrowserFingerprint(request)) return { kind: "pass" };

  const cookie = readCookie(request.cookie, CSRF_COOKIE_NAME);
  const header = request.csrfHeader?.trim();
  if (
    !looksLikeCsrfToken(cookie) ||
    !looksLikeCsrfToken(header) ||
    cookie !== header ||
    cookie !== request.csrfToken
  ) {
    return {
      kind: "refused",
      status: 403,
      code: CSRF_TOKEN_INVALID_ERROR_CODE,
      message:
        "This request is missing the browser security token. Reload the page and try again; if you are calling the API from a script, send an `Authorization: Bearer mcpfp_…` service token instead.",
    };
  }

  return { kind: "pass" };
}

/**
 * Did a BROWSER send this request?
 *
 * The CSRF check exists to stop a browser being made to act on another site's behalf. A request no
 * browser produced is outside its remit — and refusing those would break, with certainty, three
 * shipped tokenless-loopback paths this app documents in print: `mcpfp scan` (the CLI's help says a
 * loopback instance needs no token), `POST /api/mcp` from a local MCP client (D-MCP7), and any
 * `curl -X POST http://127.0.0.1:8080/api/…` an operator runs.
 *
 * **The exemption cannot be forged from a page**, which is the only property that matters:
 *
 *   • `Sec-Fetch-Site` / `-Mode` / `-Dest` are *forbidden header names*. Script cannot set them and
 *     script cannot remove them; every current engine attaches them to every request it makes.
 *   • `Origin` is mandatory on a request whose method is not CORS-safelisted — which is exactly the
 *     verbs this branch governs — same-origin included.
 *   • `Cookie` is listed too, so even a hypothetical engine that sent none of the above but did
 *     attach ambient cookie authority is still held to the check.
 *
 * So this is a narrower exemption than the common "no `Origin` ⇒ not a browser" rule, not a wider
 * one. And it is defence in DEPTH either way: for this branch to be reached at all, the cross-site
 * check above must already have passed, which a real cross-site request from any shipping browser
 * does not do.
 */
function carriesBrowserFingerprint(request: OriginGuardRequest): boolean {
  return [
    request.origin,
    request.referer,
    request.secFetchSite,
    request.secFetchMode,
    request.secFetchDest,
    request.cookie,
  ].some((value) => typeof value === "string" && value.trim().length > 0);
}

function crossSiteRefusal(): OriginGuardDecision {
  return {
    kind: "refused",
    status: 403,
    code: ORIGIN_NOT_ALLOWED_ERROR_CODE,
    message:
      "This request came from another site. The workbench API only accepts requests from its own pages, or from a script sending an `Authorization: Bearer mcpfp_…` service token.",
  };
}

/**
 * Install the guard on the root Fastify instance.
 *
 * `csrfToken` is a getter rather than a value so the caller can resolve it lazily from the settings
 * store (and so a test can flip it between assertions without re-registering the hook).
 */
export function registerOriginGuard(
  app: FastifyInstance,
  options: { allowedHosts: readonly string[]; csrfToken: () => string | undefined },
): void {
  app.addHook("onRequest", async (request) => {
    const decision = decideOriginAccess({
      method: request.method,
      url: request.url,
      host: request.headers.host,
      origin: headerValue(request.headers.origin),
      referer: headerValue(request.headers.referer),
      secFetchSite: headerValue(request.headers["sec-fetch-site"]),
      secFetchMode: headerValue(request.headers["sec-fetch-mode"]),
      secFetchDest: headerValue(request.headers["sec-fetch-dest"]),
      authorization: request.headers.authorization,
      cookie: headerValue(request.headers.cookie),
      csrfHeader: headerValue(request.headers[CSRF_HEADER_NAME]),
      allowedHosts: options.allowedHosts,
      csrfToken: options.csrfToken(),
    });

    if (decision.kind === "refused") {
      throw httpError(decision.status, decision.message, decision.code);
    }
  });
}

/** A repeated header arrives as an array; take the first value rather than stringifying the list. */
function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}
