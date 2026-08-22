import {
  SECURITY_RESPONSE_HEADERS,
  csrfCookieName,
  csrfSetCookieValue,
  readCookie,
} from "@mcp-token-footprint/shared";
import type { FastifyInstance } from "fastify";

/**
 * Security response headers + the browser CSRF cookie (RM-37 WP 0.4).
 *
 * One `onSend` hook rather than `@fastify/helmet`, deliberately: the whole policy is a flat table in
 * `packages/shared/src/api-hardening.ts` that a reader can check in four lines, and adding a
 * dependency to set four headers is not a trade this repo makes (`.claude/rules/dependencies.md`).
 *
 * ## Headers
 *
 * Applied to **every** response — the SPA shell, its assets, and `/api`. A `Content-Security-Policy`
 * a route already set for itself is left alone: `GET /api/oauth/callback` renders a small page with
 * one inline script and sets its own nonce-based policy, and a blanket overwrite here would silently
 * break the popup that closes itself after an MCP OAuth sign-in.
 *
 * ## The CSRF cookie
 *
 * Set on any **GET** whose request did not already carry the current install token. Two reasons it is
 * not limited to the SPA shell response, as the WP first sketched:
 *
 *   • In development the shell is served by **Vite** on :5173, not by this API at all — the SPA would
 *     never receive a cookie, and every write from the dev UI would 403. The app's first act on load
 *     is a `GET /api/health` + `GET /api/features` through Vite's proxy, which forwards `Set-Cookie`
 *     straight back to the browser.
 *   • A shell-only cookie goes stale exactly once — after the operator's `DATA_DIR` is replaced —
 *     and then stays stale until someone thinks to hard-reload. Refreshing it on any GET makes that
 *     self-healing.
 *
 * The cookie is `SameSite=Strict` (so a cross-site page's request never carries it) and NOT
 * `HttpOnly` (so the SPA can read it back — see `CSRF_COOKIE_NAME`'s doc for why that is the point of
 * the pattern rather than a slip). No `Secure`: the app is served over plain HTTP on loopback, and a
 * `Secure` cookie would never be stored, which would 403 every write in the browser it was meant to
 * protect.
 */
export function registerSecurityHeaders(
  app: FastifyInstance,
  options: { csrf: () => { installId: string; token: string } | undefined },
): void {
  app.addHook("onSend", async (request, reply, payload) => {
    for (const [name, value] of Object.entries(SECURITY_RESPONSE_HEADERS)) {
      // A route that set its own CSP (the OAuth callback page) keeps it. Everything else gets the
      // shared policy. `getHeader` is case-insensitive.
      if (reply.getHeader(name) === undefined) reply.header(name, value);
    }

    if (request.method === "GET") {
      const install = options.csrf();
      if (
        install !== undefined &&
        readCookie(request.headers.cookie, csrfCookieName(install.installId)) !== install.token
      ) {
        reply.header("set-cookie", csrfSetCookieValue(install.installId, install.token));
      }
    }

    return payload;
  });
}
