import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import {
  API_TOKEN_AUTH_REQUIRED_ERROR_CODE,
  API_TOKEN_EXECUTE_SCOPES,
  API_TOKEN_INVALID_ERROR_CODE,
  API_TOKEN_LAST_USED_THROTTLE_MS,
  API_TOKEN_SCOPE_FORBIDDEN_ERROR_CODE,
  type ApiTokenScope,
  requiredScopesForMethod,
} from "@mcp-token-footprint/shared";
import { registerApiTokenGuard, isLoopbackAddress } from "../src/api-tokens/guard.js";
import { ApiTokenRepository } from "../src/api-tokens/repository.js";
import { registerApiTokenRoutes } from "../src/api-tokens/routes.js";
import { ApiTokenService } from "../src/api-tokens/service.js";
import { applyMigrations, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import {
  normalizeRequestPath,
  requestPathEquals,
  requestPathEqualsStrict,
  requestPathIsUnder,
  requestPathIsUnderStrict,
} from "../src/utils/request-path.js";

// Service tokens (roadmap/ci/ WP 1.1, D-C2) — the GUARD, over a real Fastify app and a real SQLite
// `api_tokens` table. The posture under test is the whole point of the WP: loopback stays open so the
// browser UI is unregressed, any NON-loopback caller must present a valid bearer token, a BAD token
// always fails (loopback included), and an authenticated token is coarsely scope-checked with deletes
// refused outright. Fully offline — no MCP, no provider key, no network.
//
// Non-loopback requests are driven through `app.inject({ remoteAddress })`, which sets the real
// `request.socket.remoteAddress` the guard reads. That is the only way to exercise the remote path in
// a test that must not bind a routable interface.

const databases: AppDatabase[] = [];
const apps: FastifyInstance[] = [];

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const db of databases.splice(0)) db.close();
});

const REMOTE = "203.0.113.5"; // TEST-NET-3, never routable — unambiguously "not this machine".

type Harness = {
  app: FastifyInstance;
  baseUrl: string;
  service: ApiTokenService;
  repository: ApiTokenRepository;
  db: AppDatabase;
  /** Routes whose handler actually ran, recorded by a `preHandler` hook (empty ⇒ the guard bit
   *  first, or the router 404'd). Cleared per assertion by the path-shape table below. */
  reached: string[];
  /** Mint a token and return its plaintext (the only place it exists). */
  mint: (scopes: ApiTokenScope[], expiresAt?: string | null) => { id: string; secret: string };
};

async function makeApp(
  options: { authRequired?: boolean; now?: () => Date } = {},
): Promise<Harness> {
  const db = new Database(":memory:") as unknown as AppDatabase;
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  databases.push(db);

  const repository = new ApiTokenRepository(db);
  const service = new ApiTokenService(repository, options.now);

  const app = Fastify({ logger: false });
  // Every handler that actually RUNS records itself here. `preHandler` fires only once a request has
  // survived every `onRequest` hook AND matched a route, so an empty list is proof the request never
  // reached application code — which is the assertion the path-shape table below really needs (a
  // status code alone cannot tell a refusal apart from a handler that happened to return 401).
  const reached: string[] = [];
  app.addHook("preHandler", async (request) => {
    const route = request.routeOptions?.url;
    if (route) reached.push(`${request.method} ${route}`);
  });
  // The same error mapping `apps/api/src/index.ts` installs, including the additive machine-readable
  // `code` a headless caller keys off.
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

  // Health is registered BEFORE the guard in index.ts too; the guard exempts it by path regardless.
  app.get("/api/health", async () => ({ ok: true }));
  registerApiTokenGuard(app, service, { authRequired: options.authRequired ?? false });
  registerApiTokenRoutes(app, service);

  // Stand-ins for ordinary feature routes, registered AFTER the guard exactly the way index.ts
  // registers the real ones — this also proves the root hook covers later registrations.
  app.get("/api/scans", async (request) => ({ ok: true, tokenId: request.apiToken?.id ?? null }));
  app.post("/api/servers/s1/scan", async () => ({ ok: true }));
  app.delete("/api/scans/sc1", async () => ({ ok: true }));
  // The two routes WP M.2 maps to `read` in `API_TOKEN_ROUTE_SCOPES` — stand-ins with the real paths,
  // because what is under test is the guard's mapping, not either handler's body. Their real
  // registrations live in `mcp-server/routes.ts` and `assertions/routes.ts`.
  app.post("/api/mcp", async (request) => ({ ok: true, tokenId: request.apiToken?.id ?? null }));
  app.delete("/api/mcp", async () => ({ ok: true }));
  app.post("/api/mcp/llms.txt", async () => ({ ok: true }));
  app.post("/api/assertions/evaluate", async () => ({ ok: true }));
  // An unmapped POST that is NOT the scan stand-in — a second, independent fail-closed check.
  app.post("/api/run-plans", async () => ({ ok: true }));
  // A near-miss for the `/api/tokens*` rule — proves that match is a path-SEGMENT boundary.
  app.get("/api/tokensmith", async () => ({ ok: true }));
  // A non-/api path: the SPA and static assets must stay untouched by the guard.
  app.get("/index.html", async () => "<!doctype html>");

  await app.listen({ port: 0, host: "127.0.0.1" });
  apps.push(app);
  const address = app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  return {
    app,
    baseUrl: `http://127.0.0.1:${port}`,
    service,
    repository,
    db,
    reached,
    mint: (scopes, expiresAt) => {
      const created = service.create({ label: "test", scopes, expiresAt: expiresAt ?? null });
      return { id: created.token.id, secret: created.secret };
    },
  };
}

/** A request from a NON-loopback socket. `headers` may include a forged `X-Forwarded-For`. */
function remote(
  h: Harness,
  url: string,
  init: { method?: string; headers?: Record<string, string> } = {},
) {
  return h.app.inject({
    method: init.method ?? "GET",
    url,
    remoteAddress: REMOTE,
    headers: init.headers ?? {},
  });
}

// ── A4 — loopback stays open (the browser UI is unregressed) ───────────────────────────────────────

test("A4 — with no token and no API_AUTH_REQUIRED, a loopback request passes exactly as before", async () => {
  const h = await makeApp();
  const response = await fetch(`${h.baseUrl}/api/scans`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, tokenId: null });

  // A write and a delete from the host browser are equally unaffected — the coarse scope rules apply
  // ONLY to token-authenticated requests, never to the open local path.
  assert.equal(
    (await fetch(`${h.baseUrl}/api/servers/s1/scan`, { method: "POST" })).status,
    200,
    "loopback POST",
  );
  assert.equal(
    (await fetch(`${h.baseUrl}/api/scans/sc1`, { method: "DELETE" })).status,
    200,
    "loopback DELETE",
  );
});

test("the guard leaves every non-/api path alone (the SPA and static assets)", async () => {
  const h = await makeApp({ authRequired: true });
  // Even with auth forced on loopback, a non-/api path is untouched — from a REMOTE socket too.
  const response = await remote(h, "/index.html");
  assert.equal(response.statusCode, 200);
});

// ── A5 — remote requires a token ───────────────────────────────────────────────────────────────────

test("A5 — a non-loopback request with no bearer token is 401 authentication_required", async () => {
  const h = await makeApp();
  const response = await remote(h, "/api/scans");
  assert.equal(response.statusCode, 401);
  assert.equal(response.json<{ code?: string }>().code, API_TOKEN_AUTH_REQUIRED_ERROR_CODE);
});

test("A5 — a non-loopback request WITH a valid token passes and carries the token on the request", async () => {
  const h = await makeApp();
  const { id, secret } = h.mint(["read"]);
  const response = await remote(h, "/api/scans", {
    headers: { authorization: `Bearer ${secret}` },
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { ok: true, tokenId: id });
});

test("the bearer scheme is matched case-insensitively (RFC 7235)", async () => {
  const h = await makeApp();
  const { secret } = h.mint(["read"]);
  for (const scheme of ["Bearer", "bearer", "BEARER"]) {
    const response = await remote(h, "/api/scans", {
      headers: { authorization: `${scheme} ${secret}` },
    });
    assert.equal(response.statusCode, 200, scheme);
  }
});

// ── A6 — a bad token always fails, INCLUDING from loopback ─────────────────────────────────────────

test("A6 — malformed / unknown / revoked / expired tokens are 401 invalid_token from LOOPBACK", async () => {
  const h = await makeApp();

  const revoked = h.mint(["read"]);
  h.service.revoke(revoked.id);
  const expired = h.mint(["read"], new Date(Date.now() - 60_000).toISOString());

  const cases: [string, string][] = [
    ["malformed", "not-a-token"],
    ["wrong prefix", "sk_abcdefghijklmnop"],
    ["unknown", "mcpfp_ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ"],
    ["revoked", revoked.secret],
    ["expired", expired.secret],
  ];

  for (const [name, secret] of cases) {
    const response = await fetch(`${h.baseUrl}/api/scans`, {
      headers: { authorization: `Bearer ${secret}` },
    });
    assert.equal(response.status, 401, `${name} from loopback`);
    const body = (await response.json()) as { error: string; code?: string };
    assert.equal(body.code, API_TOKEN_INVALID_ERROR_CODE, name);
    // A bad credential is an ERROR, never a silent fall-through to the open local path — otherwise a
    // holder of a revoked token would keep working from the same machine and never learn it was gone.
  }
});

test("A6 — the same bad tokens are 401 invalid_token from a REMOTE socket", async () => {
  const h = await makeApp();
  const response = await remote(h, "/api/scans", { headers: { authorization: "Bearer garbage" } });
  assert.equal(response.statusCode, 401);
  assert.equal(response.json<{ code?: string }>().code, API_TOKEN_INVALID_ERROR_CODE);
});

test("a token that expires in the FUTURE still authenticates", async () => {
  const h = await makeApp();
  const { secret } = h.mint(["read"], new Date(Date.now() + 3_600_000).toISOString());
  const response = await remote(h, "/api/scans", {
    headers: { authorization: `Bearer ${secret}` },
  });
  assert.equal(response.statusCode, 200);
});

// ── A7 — API_AUTH_REQUIRED=true forces token auth on loopback; health still answers ────────────────

test("A7 — API_AUTH_REQUIRED=true makes loopback require a token too", async () => {
  const h = await makeApp({ authRequired: true });
  const denied = await fetch(`${h.baseUrl}/api/scans`);
  assert.equal(denied.status, 401);
  assert.equal(
    ((await denied.json()) as { code?: string }).code,
    API_TOKEN_AUTH_REQUIRED_ERROR_CODE,
  );

  const { secret } = h.mint(["read"]);
  const allowed = await fetch(`${h.baseUrl}/api/scans`, {
    headers: { authorization: `Bearer ${secret}` },
  });
  assert.equal(allowed.status, 200, "a valid token works on loopback under API_AUTH_REQUIRED");
});

test("A7 — GET /api/health answers with no token, even under API_AUTH_REQUIRED, loopback AND remote", async () => {
  const h = await makeApp({ authRequired: true });
  // The Docker healthcheck and liveness probes must never need a credential.
  assert.equal((await fetch(`${h.baseUrl}/api/health`)).status, 200, "loopback");
  assert.equal((await remote(h, "/api/health")).statusCode, 200, "remote");
});

// ── A8 — coarse scope enforcement ─────────────────────────────────────────────────────────────────

test("A8 — a read-only token passes GET and is 403 scope_forbidden on POST", async () => {
  const h = await makeApp();
  const { secret } = h.mint(["read"]);
  const headers = { authorization: `Bearer ${secret}` };

  assert.equal((await remote(h, "/api/scans", { headers })).statusCode, 200, "GET");

  const write = await remote(h, "/api/servers/s1/scan", { method: "POST", headers });
  assert.equal(write.statusCode, 403);
  assert.equal(write.json<{ code?: string }>().code, API_TOKEN_SCOPE_FORBIDDEN_ERROR_CODE);
});

test("A8 — an execute-scoped token passes POST", async () => {
  const h = await makeApp();
  const { secret } = h.mint(["scan:run"]);
  const response = await remote(h, "/api/servers/s1/scan", {
    method: "POST",
    headers: { authorization: `Bearer ${secret}` },
  });
  assert.equal(response.statusCode, 200);
});

test("A8 — an execute-only token (no `read`) is 403 on a GET", async () => {
  const h = await makeApp();
  const { secret } = h.mint(["scan:run"]);
  const response = await remote(h, "/api/scans", {
    headers: { authorization: `Bearer ${secret}` },
  });
  assert.equal(response.statusCode, 403);
  assert.equal(response.json<{ code?: string }>().code, API_TOKEN_SCOPE_FORBIDDEN_ERROR_CODE);
});

test("A8 — DELETE is refused for ANY token, however scoped (D-MCP3: deletes are excluded)", async () => {
  const h = await makeApp();
  // Every scope at once — the most privileged token this vocabulary can express.
  const { secret } = h.mint(["read", "scan:run", "runs:launch", "suites:run"]);
  const response = await remote(h, "/api/scans/sc1", {
    method: "DELETE",
    headers: { authorization: `Bearer ${secret}` },
  });
  assert.equal(response.statusCode, 403);
  assert.equal(response.json<{ code?: string }>().code, API_TOKEN_SCOPE_FORBIDDEN_ERROR_CODE);
});

test("A8 — a token may never mint or revoke another token (/api/tokens* is 403 for any token)", async () => {
  const h = await makeApp();
  const { id, secret } = h.mint(["read", "scan:run", "runs:launch", "suites:run"]);
  const headers = { authorization: `Bearer ${secret}` };

  for (const [method, url] of [
    ["GET", "/api/tokens"],
    ["POST", "/api/tokens"],
    ["DELETE", `/api/tokens/${id}`],
  ] as const) {
    const response = await remote(h, url, { method, headers });
    assert.equal(response.statusCode, 403, `${method} ${url}`);
    assert.equal(
      response.json<{ code?: string }>().code,
      API_TOKEN_SCOPE_FORBIDDEN_ERROR_CODE,
      `${method} ${url}`,
    );
  }

  // …and the token is still there: the refused DELETE changed nothing.
  assert.equal(h.repository.list().length, 1);
});

test("the /api/tokens* match is a real path-segment boundary, not a bare prefix", async () => {
  const h = await makeApp();
  const { secret } = h.mint(["read"]);
  const response = await remote(h, "/api/tokensmith", {
    headers: { authorization: `Bearer ${secret}` },
  });
  assert.equal(response.statusCode, 200, "/api/tokensmith is not under /api/tokens");
});

test("the guard matches on the PATH only — a query string does not smuggle a request past it", async () => {
  const h = await makeApp();
  const { secret } = h.mint(["read"]);
  const response = await remote(h, "/api/tokens?x=1", {
    headers: { authorization: `Bearer ${secret}` },
  });
  assert.equal(response.statusCode, 403, "the query string did not hide /api/tokens from the guard");
});

// ══ WP M.2 — per-route scope mapping (A2 · A3 · A4 · A5 · A6) ═════════════════════════════════════
//
// `API_TOKEN_ROUTE_SCOPES` can only ever RELAX a named route, and the two routes it names are reads
// that happen to travel in a POST body. These tests assert BOTH directions on purpose: that the two
// mapped routes now work for a `read`-only token, and that the coarse rule they were relaxed from is
// still what everything else gets — otherwise the suite would merely restate the new behaviour
// instead of proving the change.

test("M.2/A2 (D-MCP8) — a read-only token may POST the MCP mount; the coarse rule would have refused it", () => {
  // The "before" direction, asserted against the unchanged fallback rather than against a memory of
  // it: under `requiredScopesForMethod` alone, POST demands an execute scope, so `read` was refused.
  assert.deepEqual(requiredScopesForMethod("POST"), API_TOKEN_EXECUTE_SCOPES);
  assert.ok(
    !(requiredScopesForMethod("POST") as readonly string[]).includes("read"),
    "the coarse rule this WP relaxes really does exclude `read` on a POST",
  );
});

test("M.2/A2 — the read-only token reaches POST /api/mcp, and the mount rule is EXACT", async () => {
  const h = await makeApp();
  const { id, secret } = h.mint(["read"]);
  const headers = { authorization: `Bearer ${secret}` };

  h.reached.length = 0;
  const mount = await remote(h, "/api/mcp", { method: "POST", headers });
  assert.equal(mount.statusCode, 200);
  assert.deepEqual(mount.json(), { ok: true, tokenId: id }, "the handler ran, as this token");
  assert.deepEqual(h.reached, ["POST /api/mcp"]);

  // `match: "exact"` — a child path must NOT inherit the relaxation, or any future POST under the
  // mount would be silently relaxed by a rule nobody re-reviewed.
  const child = await remote(h, "/api/mcp/llms.txt", { method: "POST", headers });
  assert.equal(child.statusCode, 403, "an exact rule does not relax the subtree");
  assert.equal(child.json<{ code?: string }>().code, API_TOKEN_SCOPE_FORBIDDEN_ERROR_CODE);
});

test("M.2/A3 (D-C10) — a read-only token may POST /api/assertions/evaluate", async () => {
  const h = await makeApp();
  const { secret } = h.mint(["read"]);
  h.reached.length = 0;
  const response = await remote(h, "/api/assertions/evaluate", {
    method: "POST",
    headers: { authorization: `Bearer ${secret}` },
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(h.reached, ["POST /api/assertions/evaluate"]);
});

test("M.2/A4 — an UNMAPPED POST still needs an execute scope (the table only relaxes what it names)", async () => {
  const h = await makeApp();
  const { secret } = h.mint(["read"]);
  const headers = { authorization: `Bearer ${secret}` };

  for (const path of ["/api/servers/s1/scan", "/api/run-plans"]) {
    h.reached.length = 0;
    const response = await remote(h, path, { method: "POST", headers });
    assert.equal(response.statusCode, 403, path);
    assert.equal(
      response.json<{ code?: string }>().code,
      API_TOKEN_SCOPE_FORBIDDEN_ERROR_CODE,
      path,
    );
    assert.deepEqual(h.reached, [], `${path} reached a handler on a read-only token`);
  }

  // …and an execute-scoped token still passes there, so the fail-closed check is not vacuous.
  const executor = h.mint(["scan:run"]);
  assert.equal(
    (
      await remote(h, "/api/servers/s1/scan", {
        method: "POST",
        headers: { authorization: `Bearer ${executor.secret}` },
      })
    ).statusCode,
    200,
  );
});

test("M.2/A6 (D-MCP3) — a token-authenticated DELETE to the mount is still refused", async () => {
  const h = await makeApp();
  // Every scope at once: the table cannot express a DELETE rule, and the guard short-circuits one
  // before the table is consulted, so no combination of grants reaches this handler.
  const { secret } = h.mint(["read", "scan:run", "runs:launch", "suites:run"]);
  h.reached.length = 0;
  const response = await remote(h, "/api/mcp", {
    method: "DELETE",
    headers: { authorization: `Bearer ${secret}` },
  });
  assert.equal(response.statusCode, 403);
  assert.equal(response.json<{ code?: string }>().code, API_TOKEN_SCOPE_FORBIDDEN_ERROR_CODE);
  assert.deepEqual(h.reached, []);
});

// ── A5 (D-MCP9) — a relaxing rule matches on the raw∩decoded INTERSECTION ──────────────────────────
//
// The guard decides what is GOVERNED on the raw∪decoded union (inclusive — over-governing is
// harmless). A route→scope rule does the opposite job: it LOWERS what a request needs, so it applies
// only when the raw form and the decoded form BOTH match it. `/%61pi/mcp` therefore falls back to the
// coarse rule and is refused for a `read`-only token, even though the router would dispatch it to the
// mount. Swap `requestPathEqualsStrict` for `requestPathEquals` in the guard and this table goes red.

type RelaxShape = {
  path: string;
  /** 200 = the relaxed rule applied · 403 = it did not, and the coarse rule refused a read token. */
  status: number;
  why: string;
};

const RELAX_SHAPES: RelaxShape[] = [
  { path: "/api/mcp", status: 200, why: "the plain form — the rule is supposed to apply here" },
  {
    path: "/%61pi/mcp",
    status: 403,
    why: "THE ambiguous form — the router reaches the mount, but a RELAXING rule must not fire",
  },
  {
    path: "/api/%6dcp",
    status: 403,
    why: "an encoded byte in the last segment is equally ambiguous",
  },
  { path: "/%61pi/%6dcp", status: 403, why: "encoded bytes in both segments" },
  {
    path: "/api/assertions/%65valuate",
    status: 403,
    why: "the same rule for the assertions endpoint — one mechanism, not two",
  },
];

test("M.2/A5 (D-MCP9) — an ambiguous path does NOT inherit a relaxed rule", async () => {
  const h = await makeApp();
  const { secret } = h.mint(["read"]);
  const headers = { authorization: `Bearer ${secret}` };

  for (const shape of RELAX_SHAPES) {
    h.reached.length = 0;
    const response = await remote(h, shape.path, { method: "POST", headers });
    assert.equal(response.statusCode, shape.status, `${shape.path} — ${shape.why}`);
    if (shape.status === 403) {
      assert.equal(
        response.json<{ code?: string }>().code,
        API_TOKEN_SCOPE_FORBIDDEN_ERROR_CODE,
        shape.path,
      );
      assert.deepEqual(h.reached, [], `${shape.path} REACHED the handler on a read-only token`);
    }
  }
});

test("M.2/A5 — the two matchers are opposite by construction, and neither may be swapped", () => {
  const ambiguous = normalizeRequestPath("/%61pi/mcp");
  const plain = normalizeRequestPath("/api/mcp");
  const undecodable = normalizeRequestPath("/%zz/api/mcp");

  // Governed-path direction (union, inclusive): the ambiguous form IS governed, and an undecodable
  // path is governed too — that is what stops `/%61pi/tokens` from walking past the guard.
  assert.equal(requestPathIsUnder(ambiguous, "/api"), true);
  assert.equal(requestPathIsUnder(undecodable, "/api"), true);
  assert.equal(requestPathEquals(ambiguous, "/api/mcp"), true);

  // Relaxing direction (intersection, conservative): the ambiguous form does NOT match, so it keeps
  // the stricter coarse rule; the plain form does.
  assert.equal(requestPathEqualsStrict(plain, "/api/mcp"), true);
  assert.equal(requestPathEqualsStrict(ambiguous, "/api/mcp"), false);
  assert.equal(requestPathEqualsStrict(undecodable, "/api/mcp"), false);
  assert.equal(requestPathIsUnderStrict(plain, "/api"), true);
  assert.equal(requestPathIsUnderStrict(ambiguous, "/api"), false);
  assert.equal(requestPathIsUnderStrict(undecodable, "/api"), false);

  // Stated as the invariant rather than as five examples: on an ambiguous path the two directions
  // must DISAGREE. If a refactor ever makes them agree, one of them has been swapped for the other.
  assert.notEqual(
    requestPathEquals(ambiguous, "/api/mcp"),
    requestPathEqualsStrict(ambiguous, "/api/mcp"),
  );
  assert.notEqual(
    requestPathIsUnder(ambiguous, "/api"),
    requestPathIsUnderStrict(ambiguous, "/api"),
  );
});

// ── A9 — no header-forged bypass ──────────────────────────────────────────────────────────────────

test("A9 — X-Forwarded-For: 127.0.0.1 from a remote socket does NOT get the loopback bypass", async () => {
  const h = await makeApp();
  for (const header of ["x-forwarded-for", "x-real-ip", "forwarded"]) {
    const response = await remote(h, "/api/scans", { headers: { [header]: "127.0.0.1" } });
    assert.equal(response.statusCode, 401, header);
    assert.equal(
      response.json<{ code?: string }>().code,
      API_TOKEN_AUTH_REQUIRED_ERROR_CODE,
      header,
    );
  }
});

test("A9 — trustProxy is OFF in the real server and must stay off", () => {
  // The guard sources `request.socket.remoteAddress` directly, so a forged header cannot reach it
  // whatever Fastify is configured to do (proven above). This pins the second line of defence: with
  // `trustProxy` enabled, `request.ip` — which a future refactor might reach for — WOULD honour an
  // `X-Forwarded-For` from anywhere on the network and hand out the loopback bypass for free.
  const indexPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "src",
    "index.ts",
  );
  const source = fs.readFileSync(indexPath, "utf8");
  assert.match(source, /const server = Fastify\(\{ logger: true \}\);/);
  assert.ok(
    !source.includes("trustProxy"),
    "apps/api/src/index.ts must not enable trustProxy — see api-tokens/guard.ts",
  );
});

test("A9 — isLoopbackAddress covers the real address forms and fails CLOSED on an absent socket", () => {
  for (const address of ["127.0.0.1", "127.5.6.7", "::1", "::ffff:127.0.0.1", "::1%lo0", "::FFFF:127.0.0.1"]) {
    assert.equal(isLoopbackAddress(address), true, address);
  }
  for (const address of [
    "203.0.113.5",
    "10.0.0.4",
    "192.168.1.10",
    "::ffff:203.0.113.5",
    "1270.0.0.1",
    "fe80::1",
    // An unidentifiable peer (destroyed socket / unix socket) must be treated as REMOTE.
    undefined,
    null,
    "",
  ]) {
    assert.equal(isLoopbackAddress(address), false, String(address));
  }
});

// ── A10 — the plaintext is never logged, and never appears outside the create response ────────────

test("A10 — the plaintext token appears in no log line on the create or the auth path", async () => {
  const db = new Database(":memory:") as unknown as AppDatabase;
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  databases.push(db);

  // A real pino logger writing into a buffer, so this asserts on what would ACTUALLY be logged rather
  // than on a stub. Every level is captured (`trace` and up), and request logging is left ON.
  const lines: string[] = [];
  const app = Fastify({
    logger: {
      level: "trace",
      stream: {
        write: (line: string) => {
          lines.push(line);
        },
      },
    },
  });
  const service = new ApiTokenService(new ApiTokenRepository(db));
  registerApiTokenGuard(app, service, { authRequired: false });
  registerApiTokenRoutes(app, service);
  app.get("/api/scans", async () => ({ ok: true }));
  await app.listen({ port: 0, host: "127.0.0.1" });
  apps.push(app);
  const address = app.server.address();
  const baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

  const created = await fetch(`${baseUrl}/api/tokens`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ label: "CI — footprint gate", scopes: ["read"] }),
  });
  assert.equal(created.status, 201);
  const secret = ((await created.json()) as { secret: string }).secret;
  assert.ok(secret.startsWith("mcpfp_"));

  // Authenticate with it (the other path that touches the plaintext), and fail once with a bad one —
  // an error message must not echo the credential back either.
  await fetch(`${baseUrl}/api/scans`, { headers: { authorization: `Bearer ${secret}` } });
  const bad = await fetch(`${baseUrl}/api/scans`, {
    headers: { authorization: "Bearer mcpfp_notarealtokenatall" },
  });
  assert.equal(bad.status, 401);
  assert.ok(
    !JSON.stringify(await bad.json()).includes("notarealtoken"),
    "the 401 body does not echo the presented credential",
  );

  const log = lines.join("\n");
  assert.ok(lines.length > 0, "sanity: the logger actually captured request logs");
  assert.ok(!log.includes(secret), "the plaintext token never reaches a log line");
  assert.ok(!log.includes("mcpfp_"), "no token-shaped string reaches a log line at all");
});

// ── A11 — last_used_at is bumped on success, and throttled ────────────────────────────────────────

test("A11 — last_used_at is stamped on a successful auth and throttled inside the window", async () => {
  let clock = new Date("2026-08-19T10:00:00.000Z");
  const h = await makeApp({ now: () => clock });
  const { id, secret } = h.mint(["read"]);
  const headers = { authorization: `Bearer ${secret}` };

  assert.equal(h.repository.list()[0]?.lastUsedAt, null, "a fresh token has never been used");

  await remote(h, "/api/scans", { headers });
  const first = h.repository.list()[0]?.lastUsedAt;
  assert.equal(first, clock.toISOString(), "the first successful auth stamps last_used_at");

  // A second request inside the throttle window must NOT write — a polling CI job would otherwise
  // turn every authenticated request into a SQLite write.
  clock = new Date(clock.getTime() + API_TOKEN_LAST_USED_THROTTLE_MS - 1);
  await remote(h, "/api/scans", { headers });
  assert.equal(h.repository.list()[0]?.lastUsedAt, first, "inside the window: no write");

  // Past the window it refreshes.
  clock = new Date(clock.getTime() + 2);
  await remote(h, "/api/scans", { headers });
  assert.equal(h.repository.list()[0]?.lastUsedAt, clock.toISOString(), "past the window: refreshed");

  // A REFUSED request never stamps: the scope failure below happens after authentication, but the
  // meaningful case is a bad credential, which never reaches a row at all.
  assert.equal(h.repository.list()[0]?.id, id);
});

test("A11 — a failed authentication never stamps anything", async () => {
  const h = await makeApp();
  h.mint(["read"]);
  await remote(h, "/api/scans", { headers: { authorization: "Bearer mcpfp_wrongwrongwrong" } });
  assert.equal(h.repository.list()[0]?.lastUsedAt, null);
});

// ── Path shapes — the guard must agree with the ROUTER about what `/api` is ───────────────────────
//
// Fastify's router percent-decodes before matching, but `request.url` inside an `onRequest` hook is
// the RAW request target. A guard that prefix-matches the raw string therefore reads `/%61pi/tokens`
// (`%61` = `a`) as "not under /api", passes it, and the router then dispatches it to the real
// `GET /api/tokens` handler — handing a remote, unauthenticated caller the whole API, token CRUD
// included. That is a REGRESSION TEST: this table failed on the first cut of the guard.
//
// Each row asserts BOTH the status code AND that no application handler ran. A status alone is not
// enough — it cannot distinguish "the guard refused this" from "a handler ran and chose to 401".

type PathShape = {
  path: string;
  /** 401/403 = refused by the guard · 404 = the router has no such route · 400 = Fastify rejected it. */
  status: number;
  why: string;
};

const REFUSED_SHAPES: PathShape[] = [
  { path: "/api/tokens", status: 401, why: "the plain form — the baseline" },
  { path: "/api//tokens", status: 401, why: "a doubled separator is still under /api" },
  { path: "/api/tokens/", status: 401, why: "a trailing slash is still under /api" },
  // ── percent-encoding: the bypass class ──
  { path: "/%61pi/tokens", status: 401, why: "THE bypass — %61 decodes to 'a', router reaches /api/tokens" },
  { path: "/api/%74okens", status: 401, why: "an encoded byte in a LATER segment" },
  { path: "/%61pi/%74okens", status: 401, why: "encoded bytes in several segments at once" },
  { path: "/%61pi/scans", status: 401, why: "the bypass is not specific to the tokens route" },
  { path: "/%61pi/tokensmith", status: 401, why: "an encoded prefix on a non-token /api route" },
  // ── encoded separators / dots must not ESCAPE the refusal either (the other direction) ──
  { path: "/api%2ftokens", status: 401, why: "%2f decodes to '/' — governed even though the router 404s it" },
  { path: "/api%2Ftokens", status: 401, why: "…and the uppercase form of the same escape" },
  { path: "/%2e%2e/api/tokens", status: 401, why: "encoded dot segments never buy a way out" },
  { path: "/foo/../api/tokens", status: 401, why: "literal dot segments never buy a way out" },
  { path: "/api/scans%00", status: 401, why: "a NUL byte does not truncate the guard's view of the path" },
  { path: "/api/scans?x=1", status: 401, why: "a query string does not hide the path" },
  { path: "/api/tokensmith", status: 401, why: "an ordinary /api route still needs a token from remote" },
  // ── shapes the ROUTER itself rejects — refused either way, never a handler ──
  { path: "//api/tokens", status: 404, why: "a leading doubled slash is a different route to the router" },
  { path: "/API/tokens", status: 404, why: "the router is case-sensitive" },
  { path: "/%41PI/tokens", status: 404, why: "…and an encoded uppercase 'A' decodes to the same 404" },
  { path: "/%zz/api/tokens", status: 400, why: "a malformed escape is rejected by Fastify before any hook" },
];

test("path shapes — no encoding trick reaches a handler unauthenticated (regression: /%61pi/tokens)", async () => {
  const h = await makeApp();

  for (const shape of REFUSED_SHAPES) {
    h.reached.length = 0;
    const response = await remote(h, shape.path);
    assert.equal(response.statusCode, shape.status, `${shape.path} — ${shape.why}`);
    assert.deepEqual(
      h.reached,
      [],
      `${shape.path} REACHED A HANDLER unauthenticated — ${shape.why}`,
    );
  }
});

test("path shapes — the legitimately open paths still reach their handler", async () => {
  const h = await makeApp();

  // A non-/api path (the SPA / static assets) is untouched by the guard…
  h.reached.length = 0;
  assert.equal((await remote(h, "/index.html")).statusCode, 200);
  assert.deepEqual(h.reached, ["GET /index.html"]);

  // …and the health exemption survives normalization, in BOTH its raw and its encoded form, so a
  // container healthcheck is never broken by the hardening.
  for (const path of ["/api/health", "/%61pi/health"]) {
    h.reached.length = 0;
    assert.equal((await remote(h, path)).statusCode, 200, path);
    assert.deepEqual(h.reached, ["GET /api/health"], path);
  }
});

test("path shapes — an encoded path cannot smuggle a TOKEN past the /api/tokens* refusal", async () => {
  const h = await makeApp();
  const { secret } = h.mint(["read", "scan:run", "runs:launch", "suites:run"]);
  const headers = { authorization: `Bearer ${secret}` };

  // A token authenticates fine, then hits the "a token may never manage tokens" rule — and it must
  // hit it however the path is spelled, or a token could mint itself a fresh one and make revocation
  // meaningless.
  for (const path of ["/api/tokens", "/%61pi/tokens", "/api/%74okens", "/api%2ftokens"]) {
    h.reached.length = 0;
    const response = await remote(h, path, { headers });
    assert.equal(response.statusCode, 403, path);
    assert.equal(response.json<{ code?: string }>().code, API_TOKEN_SCOPE_FORBIDDEN_ERROR_CODE, path);
    assert.deepEqual(h.reached, [], `${path} reached the token handler`);
  }
});

test("path shapes — normalization does not widen the guard onto non-/api routes", async () => {
  const h = await makeApp();
  // `/api/tokensmith` is NOT under `/api/tokens` (segment boundary), so a read token passes the
  // token-CRUD refusal and gets the ordinary scope check. Proven here so the hardening cannot be
  // "fixed" into a bare `startsWith` that swallows neighbouring routes.
  const { secret } = h.mint(["read"]);
  h.reached.length = 0;
  const response = await remote(h, "/api/tokensmith", {
    headers: { authorization: `Bearer ${secret}` },
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(h.reached, ["GET /api/tokensmith"]);
});
