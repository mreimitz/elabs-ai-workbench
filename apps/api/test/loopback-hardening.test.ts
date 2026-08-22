import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import {
  API_TOKEN_DEFAULT_EXPIRY_DAYS,
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  CSRF_TOKEN_INVALID_ERROR_CODE,
  CSRF_TOKEN_SETTING_KEY,
  HOST_NOT_ALLOWED_ERROR_CODE,
  ORIGIN_NOT_ALLOWED_ERROR_CODE,
  RATE_LIMITED_ERROR_CODE,
  RATE_LIMIT_AUTH_FAILURES_PER_MINUTE,
  RATE_LIMIT_EXPENSIVE_PER_MINUTE,
  csrfSetCookieValue,
  defaultApiTokenExpiry,
  hostnameFromHostHeader,
  hostnameFromUrl,
  isAllowedHostname,
  looksLikeCsrfToken,
  parseAllowedHosts,
  readCookie,
} from "@mcp-token-footprint/shared";
import { registerApiTokenGuard } from "../src/api-tokens/guard.js";
import { ApiTokenRepository } from "../src/api-tokens/repository.js";
import { ApiTokenService } from "../src/api-tokens/service.js";
import { applyMigrations, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { resolveCsrfToken } from "../src/security/csrf-token.js";
import { decideOriginAccess, registerOriginGuard } from "../src/security/origin-guard.js";
import {
  FixedWindowRateLimiter,
  matchRateLimitedRoute,
  rateLimitPeerKey,
  registerRateLimitGuard,
} from "../src/security/rate-limit.js";
import { registerSecurityHeaders } from "../src/security/security-headers.js";

// ==================================================================================================
// RM-37 WP 0.4 — the browser-facing guards, over a real Fastify app
// ==================================================================================================
//
// What is under test is the gap the service-token guard structurally cannot close. That guard decides
// on the socket peer, and BOTH attacks here arrive over a genuine loopback socket from the operator's
// own machine:
//
//   • a DNS-rebound page, whose only tell is the `Host` header it asked for;
//   • a cross-site request, whose only tell is `Origin` / `Sec-Fetch-Site` / a cookie it cannot read.
//
// So every "attack" assertion below is driven from 127.0.0.1 on purpose. A test that drove them from
// a remote address would be testing the OTHER guard and would pass no matter what this one did.
//
// Fully offline: no MCP, no provider key, no network beyond the loopback listener each harness binds.

const databases: AppDatabase[] = [];
const apps: FastifyInstance[] = [];

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const db of databases.splice(0)) db.close();
});

const dirname = path.dirname(fileURLToPath(import.meta.url));

const CSRF = "Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZmdoaWpr";
const OTHER_CSRF = "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVoxMjM0NTY";

type Harness = {
  app: FastifyInstance;
  baseUrl: string;
  service: ApiTokenService;
  limiter: FixedWindowRateLimiter;
  now: { ms: number };
  mint: (scopes?: Parameters<ApiTokenService["create"]>[0]["scopes"]) => string;
};

/**
 * The hook chain exactly as `index.ts` registers it: feature guard (elided — it owns no behaviour
 * here) → origin guard → rate-limit guard → token guard. Order is part of what is under test: a
 * cross-site POST must be refused as cross-site, not absorbed into someone's rate budget.
 */
async function makeApp(
  options: {
    allowedHosts?: readonly string[];
    csrfToken?: string | undefined;
    expensiveLimit?: number;
    authFailureLimit?: number;
  } = {},
): Promise<Harness> {
  const db = new Database(":memory:") as unknown as AppDatabase;
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  databases.push(db);

  const service = new ApiTokenService(new ApiTokenRepository(db));
  const app = Fastify({ logger: false });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: "Validation failed", issues: error.issues });
    }
    const typed = error as Error & { statusCode?: number; code?: string };
    const statusCode = typeof typed.statusCode === "number" ? typed.statusCode : 500;
    const code =
      typeof typed.statusCode === "number" && typeof typed.code === "string"
        ? typed.code
        : undefined;
    return reply.code(statusCode).send({ error: error.message, ...(code ? { code } : {}) });
  });

  const csrfToken = "csrfToken" in options ? options.csrfToken : CSRF;
  registerOriginGuard(app, {
    allowedHosts: options.allowedHosts ?? [],
    csrfToken: () => csrfToken,
  });
  registerSecurityHeaders(app, { csrfToken: () => csrfToken });

  const now = { ms: 1_000_000 };
  const limiter = new FixedWindowRateLimiter(60_000, () => now.ms);
  registerRateLimitGuard(app, limiter, options.expensiveLimit ?? RATE_LIMIT_EXPENSIVE_PER_MINUTE);

  registerApiTokenGuard(app, service, {
    authRequired: false,
    authFailureLimiter: {
      record: (remoteAddress) =>
        limiter.hit(
          `auth-failure:${rateLimitPeerKey(remoteAddress)}`,
          options.authFailureLimit ?? RATE_LIMIT_AUTH_FAILURES_PER_MINUTE,
        ),
    },
  });

  app.get("/api/health", async () => ({ ok: true }));
  app.get("/api/servers", async () => ({ ok: true }));
  app.post("/api/servers", async () => ({ ok: true }));
  app.post("/api/servers/s1/scan", async () => ({ ok: true }));
  app.post("/api/servers/s1/test", async () => ({ ok: true }));
  app.post("/api/run-plans", async () => ({ ok: true }));
  app.delete("/api/scans/sc1", async () => ({ ok: true }));
  // The OAuth provider redirects the operator's browser here from ITS origin — a cross-site,
  // top-level GET navigation that must keep working.
  app.get("/api/oauth/callback", async () => ({ ok: true }));
  // A stand-in for `GET /api/oauth/callback`'s real behaviour of setting its own nonce-based policy.
  app.get("/api/own-csp", async (_request, reply) => {
    reply.header("content-security-policy", "default-src 'self'; script-src 'nonce-abc'");
    return { ok: true };
  });
  app.get("/index.html", async (_request, reply) => {
    reply.header("content-type", "text/html; charset=utf-8");
    return "<!doctype html>";
  });

  await app.listen({ port: 0, host: "127.0.0.1" });
  apps.push(app);
  const address = app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  return {
    app,
    baseUrl: `http://127.0.0.1:${port}`,
    service,
    limiter,
    now,
    mint: (scopes) =>
      service.create({ label: "t", scopes: scopes ?? ["read", "scan:run"], expiresAt: null }).secret,
  };
}

/** A same-origin browser request: the Host the SPA was loaded from, plus the CSRF pair. */
function browser(
  h: Harness,
  url: string,
  init: { method?: string; headers?: Record<string, string>; csrf?: string | false } = {},
) {
  const csrf = init.csrf === false ? undefined : (init.csrf ?? CSRF);
  return h.app.inject({
    method: init.method ?? "GET",
    url,
    headers: {
      host: "localhost:8081",
      origin: "http://localhost:8081",
      "sec-fetch-site": "same-origin",
      ...(csrf
        ? { cookie: `${CSRF_COOKIE_NAME}=${csrf}`, [CSRF_HEADER_NAME]: csrf }
        : {}),
      ...(init.headers ?? {}),
    },
  });
}

// ── 1. Host allow-list — the DNS-rebinding refusal ───────────────────────────────────────────────

test("Host allow-list: a rebound hostname is refused 403 host_not_allowed, from loopback", async () => {
  const h = await makeApp();
  const response = await h.app.inject({
    method: "GET",
    url: "/api/servers",
    headers: { host: "evil.example" },
  });
  assert.equal(response.statusCode, 403);
  assert.equal(response.json().code, HOST_NOT_ALLOWED_ERROR_CODE);
});

test("Host allow-list: the loopback names all pass, on any port, and so does the SPA shell", async () => {
  const h = await makeApp();
  for (const host of [
    "localhost:8081",
    "localhost",
    "127.0.0.1:8080",
    "127.0.0.1",
    "127.1.2.3:9",
    "[::1]:8080",
    "LOCALHOST:8081",
  ]) {
    const response = await h.app.inject({ method: "GET", url: "/api/servers", headers: { host } });
    assert.equal(response.statusCode, 200, `host ${host}`);
  }
  // The check is not scoped to /api: a rebound page must not even be able to load the app shell.
  assert.equal(
    (await h.app.inject({ method: "GET", url: "/index.html", headers: { host: "evil.example" } }))
      .statusCode,
    403,
    "SPA shell under a rebound host",
  );
});

test("Host allow-list: an absent or unparseable Host fails CLOSED", () => {
  for (const host of [undefined, "", "   ", "[::1", ":8080"]) {
    assert.equal(isAllowedHostname(hostnameFromHostHeader(host)), false, JSON.stringify(host));
  }
});

test("Host allow-list: API_ALLOWED_HOSTS adds names and can never remove the loopback defaults", async () => {
  const extra = parseAllowedHosts("https://workbench.example.com:8443/, WORKBENCH-2.local ,,");
  assert.deepEqual(extra, ["workbench.example.com", "workbench-2.local"]);

  const h = await makeApp({ allowedHosts: extra });
  assert.equal(
    (
      await h.app.inject({
        method: "GET",
        url: "/api/servers",
        headers: { host: "workbench.example.com:8443" },
      })
    ).statusCode,
    200,
  );
  // Still allowed even though the operator's list does not mention it.
  assert.equal(
    (await h.app.inject({ method: "GET", url: "/api/servers", headers: { host: "localhost" } }))
      .statusCode,
    200,
  );
  // A subdomain of an allowed name is NOT allowed — matching is exact.
  assert.equal(
    (
      await h.app.inject({
        method: "GET",
        url: "/api/servers",
        headers: { host: "evil.workbench.example.com" },
      })
    ).statusCode,
    403,
  );
  // …and neither is a subdomain of `localhost`, which resolves to 127.0.0.1 on most stacks and is
  // therefore exactly the shape a rebinding attack reaches for.
  assert.equal(
    (
      await h.app.inject({
        method: "GET",
        url: "/api/servers",
        headers: { host: "evil.localhost:8081" },
      })
    ).statusCode,
    403,
  );
});

// ── 2. Cross-site refusal ────────────────────────────────────────────────────────────────────────

test("cross-site: a POST carrying a foreign Origin is refused 403 origin_not_allowed", async () => {
  const h = await makeApp();
  const response = await h.app.inject({
    method: "POST",
    url: "/api/servers",
    headers: {
      host: "localhost:8081",
      origin: "https://evil.example",
      "content-type": "application/json",
    },
    payload: {},
  });
  assert.equal(response.statusCode, 403);
  assert.equal(response.json().code, ORIGIN_NOT_ALLOWED_ERROR_CODE);
});

test("cross-site: Sec-Fetch-Site alone refuses it, even with no Origin at all", async () => {
  const h = await makeApp();
  const response = await h.app.inject({
    method: "POST",
    url: "/api/servers",
    headers: { host: "localhost:8081", "sec-fetch-site": "cross-site" },
  });
  assert.equal(response.statusCode, 403);
  assert.equal(response.json().code, ORIGIN_NOT_ALLOWED_ERROR_CODE);
});

test("cross-site: Referer is consulted only when Origin is absent, and an opaque origin is refused", () => {
  const base = {
    method: "POST",
    url: "/api/servers",
    host: "localhost:8081",
    allowedHosts: [] as string[],
    csrfToken: undefined,
    authorization: undefined,
    cookie: undefined,
    csrfHeader: undefined,
    secFetchSite: undefined,
    secFetchMode: undefined,
    origin: undefined,
    referer: undefined,
  };
  // Referer used as the fallback.
  assert.equal(
    decideOriginAccess({ ...base, referer: "https://evil.example/x" }).kind,
    "refused",
  );
  assert.equal(decideOriginAccess({ ...base, referer: "http://localhost:8081/scans" }).kind, "pass");
  // Origin WINS when both are present — a same-origin request whose Referer was stripped by a
  // referrer policy must not be judged on the missing half.
  assert.equal(
    decideOriginAccess({
      ...base,
      origin: "http://localhost:8081",
      referer: "https://elsewhere.example/",
    }).kind,
    "pass",
  );
  // `Origin: null` — a sandboxed iframe, a `data:` document, some redirect chains. No hostname, so
  // no allow-list entry can match it, so it is refused.
  assert.equal(decideOriginAccess({ ...base, origin: "null" }).kind, "refused");
});

test("cross-site: a safe-method TOP-LEVEL NAVIGATION is allowed — this is what keeps MCP OAuth working", async () => {
  const h = await makeApp();
  // Exactly what an OAuth provider's redirect looks like: cross-site, no Origin, a navigate mode.
  const ok = await h.app.inject({
    method: "GET",
    url: "/api/oauth/callback?code=abc&state=xyz",
    headers: {
      host: "127.0.0.1:8080",
      "sec-fetch-site": "cross-site",
      "sec-fetch-mode": "navigate",
      "sec-fetch-dest": "document",
      referer: "https://provider.example/authorize",
    },
  });
  assert.equal(ok.statusCode, 200, "the OAuth callback must survive the cross-site check");

  // The carve-out is for SAFE methods only. A cross-site form POST also claims `navigate`, and must
  // still be refused — this is the assertion that keeps the carve-out from being a hole.
  const post = await h.app.inject({
    method: "POST",
    url: "/api/servers",
    headers: {
      host: "127.0.0.1:8080",
      "sec-fetch-site": "cross-site",
      "sec-fetch-mode": "navigate",
      "sec-fetch-dest": "document",
    },
  });
  assert.equal(post.statusCode, 403);
  assert.equal(post.json().code, ORIGIN_NOT_ALLOWED_ERROR_CODE);
});

test("cross-site: the check is scoped to /api — a cross-site link to the SPA still loads", async () => {
  const h = await makeApp();
  const response = await h.app.inject({
    method: "GET",
    url: "/index.html",
    headers: {
      host: "localhost:8081",
      "sec-fetch-site": "cross-site",
      referer: "https://chat.example/thread",
    },
  });
  assert.equal(response.statusCode, 200, "a bookmark or a chat link must still open the app");
});

// ── 3. Browser CSRF token ────────────────────────────────────────────────────────────────────────

test("CSRF: a same-origin POST with matching cookie + header passes; without them it is refused", async () => {
  const h = await makeApp();
  assert.equal((await browser(h, "/api/servers", { method: "POST" })).statusCode, 200);

  const missing = await browser(h, "/api/servers", { method: "POST", csrf: false });
  assert.equal(missing.statusCode, 403);
  assert.equal(missing.json().code, CSRF_TOKEN_INVALID_ERROR_CODE);
});

test("CSRF: a cookie the attacker planted does not help — the header must equal the INSTALL token", async () => {
  const h = await makeApp();
  // Both halves present and equal to each other, but not the install's token: the double-submit pair
  // alone is not enough, because a same-site cookie-setting attacker could produce it.
  const forged = await browser(h, "/api/servers", { method: "POST", csrf: OTHER_CSRF });
  assert.equal(forged.statusCode, 403);
  assert.equal(forged.json().code, CSRF_TOKEN_INVALID_ERROR_CODE);

  // Cookie right, header wrong (a page that guessed the header name but cannot read the cookie).
  const mismatched = await browser(h, "/api/servers", {
    method: "POST",
    headers: { [CSRF_HEADER_NAME]: OTHER_CSRF },
  });
  assert.equal(mismatched.statusCode, 403);
});

test("CSRF: only state-changing verbs need it; GET never does", async () => {
  const h = await makeApp();
  assert.equal((await browser(h, "/api/servers", { csrf: false })).statusCode, 200, "GET");
  for (const method of ["POST", "DELETE"]) {
    const url = method === "DELETE" ? "/api/scans/sc1" : "/api/servers";
    assert.equal(
      (await browser(h, url, { method, csrf: false })).statusCode,
      403,
      `${method} without the token`,
    );
  }
});

test("CSRF: a Bearer service token is exempt — the CLI, CI and the MCP mount have no cookie jar", async () => {
  const h = await makeApp();
  const secret = h.mint(["scan:run"]);
  const response = await h.app.inject({
    method: "POST",
    url: "/api/servers/s1/scan",
    headers: { host: "127.0.0.1:8080", authorization: `Bearer ${secret}` },
  });
  assert.equal(response.statusCode, 200, "no Origin, no cookie, no CSRF header — and no 403");
});

test("CSRF: with no install token available the check is skipped, not failed closed", async () => {
  // A read-only settings store would otherwise brick every write in the operator's own browser. The
  // Host and cross-site checks still stand, which is what the second half asserts.
  const h = await makeApp({ csrfToken: undefined });
  assert.equal(
    (await browser(h, "/api/servers", { method: "POST", csrf: false })).statusCode,
    200,
  );
  assert.equal(
    (
      await h.app.inject({
        method: "POST",
        url: "/api/servers",
        headers: { host: "localhost:8081", origin: "https://evil.example" },
      })
    ).statusCode,
    403,
    "the cross-site check does not depend on the CSRF token",
  );
});

test("CSRF: the token's shape gate rejects a blank or short cookie before any comparison", () => {
  assert.equal(looksLikeCsrfToken(CSRF), true);
  for (const bad of [undefined, null, "", "short", "a".repeat(31), "has spaces in it", "a".repeat(129)]) {
    assert.equal(looksLikeCsrfToken(bad), false, JSON.stringify(bad));
  }
});

test("CSRF: readCookie picks the right cookie out of a crowded header and tolerates junk", () => {
  assert.equal(readCookie(`a=1; ${CSRF_COOKIE_NAME}=${CSRF}; b=2`, CSRF_COOKIE_NAME), CSRF);
  assert.equal(readCookie(`${CSRF_COOKIE_NAME}_other=x`, CSRF_COOKIE_NAME), undefined);
  assert.equal(readCookie("garbage;;;=", CSRF_COOKIE_NAME), undefined);
  assert.equal(readCookie(undefined, CSRF_COOKIE_NAME), undefined);
});

// ── 4. The per-install CSRF token ────────────────────────────────────────────────────────────────

test("the install CSRF token is minted once and REUSED across restarts", () => {
  const store = new Map<string, unknown>();
  const port = { get: (k: string) => store.get(k), put: (k: string, v: unknown) => store.set(k, v) };

  const first = resolveCsrfToken(port);
  assert.ok(first && looksLikeCsrfToken(first));
  assert.equal(store.get(CSRF_TOKEN_SETTING_KEY), first);
  // A second boot against the same store must not mint a new one — that would 403 every open tab.
  assert.equal(resolveCsrfToken(port), first);

  // A corrupt/hand-edited value is replaced rather than trusted.
  store.set(CSRF_TOKEN_SETTING_KEY, { not: "a token" });
  const replaced = resolveCsrfToken(port);
  assert.ok(replaced && looksLikeCsrfToken(replaced) && replaced !== first);
});

test("an unusable settings store yields undefined rather than throwing on the hot path", () => {
  const broken = {
    get: () => {
      throw new Error("database is locked");
    },
    put: () => {
      throw new Error("database is locked");
    },
  };
  assert.equal(resolveCsrfToken(broken), undefined);
});

// ── 5. Security headers + the cookie ─────────────────────────────────────────────────────────────

test("every response carries nosniff, DENY, no-referrer and a CSP with frame-ancestors 'none'", async () => {
  const h = await makeApp();
  for (const url of ["/api/health", "/index.html"]) {
    const response = await h.app.inject({ method: "GET", url, headers: { host: "localhost:8081" } });
    assert.equal(response.headers["x-content-type-options"], "nosniff", url);
    assert.equal(response.headers["x-frame-options"], "DENY", url);
    assert.equal(response.headers["referrer-policy"], "no-referrer", url);
    const csp = String(response.headers["content-security-policy"] ?? "");
    assert.match(csp, /frame-ancestors 'none'/, url);
    assert.match(csp, /default-src 'self'/, url);
    assert.match(csp, /connect-src 'self'/, url);
    assert.match(csp, /object-src 'none'/, url);
  }
});

test("a route that sets its OWN CSP keeps it — the OAuth callback's inline script survives", async () => {
  const h = await makeApp();
  const response = await h.app.inject({
    method: "GET",
    url: "/api/own-csp",
    headers: { host: "localhost:8081" },
  });
  assert.equal(response.headers["content-security-policy"], "default-src 'self'; script-src 'nonce-abc'");
  // The non-CSP headers are still applied — only the policy is deferred to the route.
  assert.equal(response.headers["x-content-type-options"], "nosniff");
});

test("a GET sets the CSRF cookie when the request did not already carry it, and stops once it does", async () => {
  const h = await makeApp();
  const cold = await h.app.inject({
    method: "GET",
    url: "/api/health",
    headers: { host: "localhost:8081" },
  });
  const setCookie = String(cold.headers["set-cookie"] ?? "");
  assert.equal(setCookie, csrfSetCookieValue(CSRF));
  assert.match(setCookie, /SameSite=Strict/);
  assert.match(setCookie, /Path=\//);
  assert.doesNotMatch(setCookie, /HttpOnly/, "the SPA has to read this back — see CSRF_COOKIE_NAME");
  assert.doesNotMatch(setCookie, /Secure/, "the app is served over plain HTTP on loopback");

  const warm = await h.app.inject({
    method: "GET",
    url: "/api/health",
    headers: { host: "localhost:8081", cookie: `${CSRF_COOKIE_NAME}=${CSRF}` },
  });
  assert.equal(warm.headers["set-cookie"], undefined);

  // A STALE cookie is refreshed — that is what makes a replaced DATA_DIR self-healing.
  const stale = await h.app.inject({
    method: "GET",
    url: "/api/health",
    headers: { host: "localhost:8081", cookie: `${CSRF_COOKIE_NAME}=${OTHER_CSRF}` },
  });
  assert.equal(String(stale.headers["set-cookie"] ?? ""), csrfSetCookieValue(CSRF));
});

// ── 6. Rate limits ───────────────────────────────────────────────────────────────────────────────

test("the 21st failed token in a minute answers 429, not 401", async () => {
  const h = await makeApp({ authFailureLimit: RATE_LIMIT_AUTH_FAILURES_PER_MINUTE });
  const bad = "mcpfp_notarealtokenatallnotarealtokenatallxyz";

  const statuses: number[] = [];
  for (let i = 0; i < 25; i += 1) {
    const response = await h.app.inject({
      method: "GET",
      url: "/api/servers",
      headers: { host: "127.0.0.1:8080", authorization: `Bearer ${bad}` },
    });
    statuses.push(response.statusCode);
  }

  assert.deepEqual(
    statuses.slice(0, RATE_LIMIT_AUTH_FAILURES_PER_MINUTE),
    Array(RATE_LIMIT_AUTH_FAILURES_PER_MINUTE).fill(401),
    "the first 20 are ordinary invalid-credential refusals",
  );
  assert.deepEqual(
    statuses.slice(RATE_LIMIT_AUTH_FAILURES_PER_MINUTE),
    Array(25 - RATE_LIMIT_AUTH_FAILURES_PER_MINUTE).fill(429),
    "from the 21st on, the peer is throttled",
  );

  const throttled = await h.app.inject({
    method: "GET",
    url: "/api/servers",
    headers: { host: "127.0.0.1:8080", authorization: `Bearer ${bad}` },
  });
  assert.equal(throttled.json().code, RATE_LIMITED_ERROR_CODE);
  assert.ok(Number(throttled.headers["retry-after"]) > 0, "a Retry-After the caller can honour");

  // The window is fixed: once it rolls over, the peer is served again.
  h.now.ms += 60_001;
  assert.equal(
    (
      await h.app.inject({
        method: "GET",
        url: "/api/servers",
        headers: { host: "127.0.0.1:8080", authorization: `Bearer ${bad}` },
      })
    ).statusCode,
    401,
  );
});

test("a SCOPE refusal is not an auth failure — it never turns into a 429", async () => {
  // The counter exists because a 401 is what an attacker probes with. A 403 means a REAL credential
  // was presented and the operator granted it too little — a misconfiguration to fix, not an attack
  // to throttle, and throttling it would make the fix harder to diagnose. Pinning the boundary in
  // this direction is what stops "count every refusal" from looking like a harmless simplification.
  const h = await makeApp({ authFailureLimit: 2 });
  const secret = h.mint(["read"]); // no execute scope
  for (let i = 0; i < 8; i += 1) {
    const response = await h.app.inject({
      method: "POST",
      url: "/api/servers",
      headers: { host: "127.0.0.1:8080", authorization: `Bearer ${secret}` },
    });
    assert.equal(response.statusCode, 403, `request ${i} stays a scope refusal`);
  }
});

test("a VALID token is never counted against the auth-failure budget", async () => {
  const h = await makeApp({ authFailureLimit: 2 });
  const secret = h.mint(["read"]);
  for (let i = 0; i < 10; i += 1) {
    const response = await h.app.inject({
      method: "GET",
      url: "/api/servers",
      headers: { host: "127.0.0.1:8080", authorization: `Bearer ${secret}` },
    });
    assert.equal(response.statusCode, 200, `request ${i}`);
  }
});

test("the expensive-action budget covers scan / server test / run launch, and the tokenless browser too", async () => {
  const h = await makeApp({ expensiveLimit: 3 });
  for (const url of ["/api/servers/s1/scan", "/api/servers/s1/test", "/api/run-plans"]) {
    h.limiter.reset();
    const statuses: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      statuses.push((await browser(h, url, { method: "POST" })).statusCode);
    }
    assert.deepEqual(statuses, [200, 200, 200, 429, 429], url);
  }
});

test("an ordinary read is not budgeted, and the route table matches on segment boundaries", async () => {
  const h = await makeApp({ expensiveLimit: 1 });
  for (let i = 0; i < 5; i += 1) {
    assert.equal((await browser(h, "/api/servers")).statusCode, 200, `GET ${i}`);
  }

  assert.equal(matchRateLimitedRoute("POST", "/api/servers/s1/scan")?.reason, "scan");
  assert.equal(matchRateLimitedRoute("POST", "/api/suites/x/run")?.reason, "suite run");
  assert.equal(matchRateLimitedRoute("POST", "/api/runs")?.reason, "run launch");
  assert.equal(matchRateLimitedRoute("GET", "/api/servers/s1/scan"), undefined, "GET is not budgeted");
  assert.equal(matchRateLimitedRoute("POST", "/api/tests"), undefined, "'/api/tests' is not '/test'");
  assert.equal(matchRateLimitedRoute("POST", "/api/servers/s1/rescan"), undefined, "'/rescan' ≠ '/scan'");
  // A percent-escaped form the router would still dispatch is caught — the guard is at least as
  // inclusive as the router, exactly as `utils/request-path.ts` requires.
  assert.equal(matchRateLimitedRoute("POST", "/api/servers/s1/%73can")?.reason, "scan");
});

test("the limiter's own arithmetic: the (limit+1)-th hit is the refused one, and windows are per key", () => {
  let now = 0;
  const limiter = new FixedWindowRateLimiter(1_000, () => now);
  assert.equal(limiter.hit("a", 2).limited, false);
  assert.equal(limiter.hit("a", 2).limited, false);
  assert.equal(limiter.hit("a", 2).limited, true);
  assert.equal(limiter.hit("b", 2).limited, false, "a different key has its own window");
  now += 1_001;
  assert.equal(limiter.hit("a", 2).limited, false, "the window rolled over");
  // A budget of 0 refuses immediately — an operator who sets the knob to 0 means it.
  assert.equal(limiter.hit("c", 0).limited, true);
});

test("the rate-limit key comes from the socket peer or the token, never from a header", () => {
  assert.equal(rateLimitPeerKey("127.0.0.1"), "peer:127.0.0.1");
  assert.equal(rateLimitPeerKey("127.0.0.1", "tok_1"), "token:tok_1");
  assert.equal(rateLimitPeerKey(undefined), "peer:unknown");
});

// ── 7. Host / URL parsing helpers ────────────────────────────────────────────────────────────────

test("hostnameFromHostHeader and hostnameFromUrl agree on the bracketless IPv6 spelling", () => {
  assert.equal(hostnameFromHostHeader("[::1]:8080"), "::1");
  assert.equal(hostnameFromUrl("http://[::1]:8080"), "::1");
  assert.equal(hostnameFromHostHeader("::1"), "::1", "a bare IPv6 literal is not split at its colon");
  assert.equal(hostnameFromHostHeader("Example.COM:443"), "example.com");
  assert.equal(hostnameFromUrl("not a url"), null);
  assert.equal(hostnameFromUrl(undefined), null);
});

// ── 8. Service-token default expiry ──────────────────────────────────────────────────────────────

test("an omitted expiry means 90 days; an explicit null still means never", async () => {
  const h = await makeApp();
  const now = Date.now();

  const defaulted = h.service.create({ label: "ci", scopes: ["read"] });
  assert.ok(defaulted.token.expiresAt !== null, "an omitted expiry must NOT mean forever any more");
  const days = (Date.parse(defaulted.token.expiresAt as string) - now) / 86_400_000;
  assert.ok(
    Math.abs(days - API_TOKEN_DEFAULT_EXPIRY_DAYS) < 1,
    `expected ~${API_TOKEN_DEFAULT_EXPIRY_DAYS} days, got ${days}`,
  );

  const never = h.service.create({ label: "forever", scopes: ["read"], expiresAt: null });
  assert.equal(never.token.expiresAt, null, "`null` is the operator choosing never");

  const explicit = new Date(now + 3_600_000).toISOString();
  assert.equal(
    h.service.create({ label: "hour", scopes: ["read"], expiresAt: explicit }).token.expiresAt,
    explicit,
  );
});

test("defaultApiTokenExpiry keeps undefined and null apart — that distinction IS the feature", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");
  assert.equal(defaultApiTokenExpiry(null, now), null);
  assert.equal(defaultApiTokenExpiry("2026-02-02T00:00:00.000Z", now), "2026-02-02T00:00:00.000Z");
  assert.equal(defaultApiTokenExpiry(undefined, now), "2026-04-01T00:00:00.000Z");
});

// ── 9. The unauthenticated health payload, and where the paths went ──────────────────────────────

test("GET /api/health carries no filesystem path, and /api/diagnostics/paths is where they live", () => {
  // `index.ts` boots the whole app on import (top-level await + a real listener), so this is a source
  // walk rather than a live request — the same technique `reports/security-section.ts` is pinned by.
  //
  // The compiler is the primary guard here: the handler declares `Promise<HealthPayload>` and returns
  // an object literal, so excess-property checking rejects a re-added `databasePath` outright. This
  // test guards the OTHER direction — someone widening `HealthPayload` itself to make room for it.
  const source = fs.readFileSync(
    path.join(dirname, "..", "src", "index.ts"),
    "utf8",
  );
  const start = source.indexOf('server.get(\n  "/api/health"');
  assert.ok(start > 0, "could not find the /api/health registration");
  const handler = source.slice(start, source.indexOf("}),", start));
  assert.ok(!handler.includes("databasePath"), "/api/health must not answer with databasePath");
  assert.ok(!handler.includes("dataDirectory"), "/api/health must not answer with dataDirectory");

  // …and the paths are still reachable, on a route the service-token guard governs (it is not in the
  // guard's exemption list — only `GET /api/health` is).
  assert.ok(source.includes('"/api/diagnostics/paths"'), "the paths route must exist");
  const guard = fs.readFileSync(
    path.join(dirname, "..", "src", "api-tokens", "guard.ts"),
    "utf8",
  );
  assert.ok(
    !guard.includes("/api/diagnostics"),
    "the paths route must NOT be added to the token guard's exemptions",
  );
});
