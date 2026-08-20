import assert from "node:assert/strict";
import crypto from "node:crypto";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import {
  API_TOKEN_EXECUTE_SCOPES,
  API_TOKEN_PREFIX,
  API_TOKEN_ROUTE_SCOPES,
  API_TOKEN_PREFIX_LENGTH,
  API_TOKEN_SCOPE_META,
  API_TOKEN_SCOPES,
  type ApiTokenCreateResponse,
  type ApiTokenListResponse,
  apiTokenCreateSchema,
  isApiTokenScope,
  looksLikeApiToken,
  readBearerToken,
  requiredScopesForMethod,
  requiredScopesForRoute,
} from "@mcp-token-footprint/shared";
import { ApiTokenRepository } from "../src/api-tokens/repository.js";
import { registerApiTokenRoutes } from "../src/api-tokens/routes.js";
import { ApiTokenService, generateToken, hashToken } from "../src/api-tokens/service.js";
import { applyMigrations, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";

// Service tokens (planning/Roadmap/RM-08-ci/ WP 1.1) — the CONTRACT (the frozen scope vocabulary + zod), the token
// service (generation, hashing at rest, revocation) and the three CRUD routes. The guard's posture is
// covered separately in `api-tokens-guard.test.ts`. Fully offline.

const databases: AppDatabase[] = [];
const apps: FastifyInstance[] = [];

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const db of databases.splice(0)) db.close();
});

function openDb(): AppDatabase {
  const db = new Database(":memory:") as unknown as AppDatabase;
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  databases.push(db);
  return db;
}

function makeService(now?: () => Date): { service: ApiTokenService; db: AppDatabase } {
  const db = openDb();
  return { service: new ApiTokenService(new ApiTokenRepository(db), now), db };
}

async function makeRoutes(): Promise<{ baseUrl: string; db: AppDatabase }> {
  const db = openDb();
  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: "Validation failed", issues: error.issues });
    }
    const typed = error as Error & { statusCode?: number };
    return reply.code(typed.statusCode ?? 500).send({ error: error.message });
  });
  // The routes only — no guard, so this exercises them the way the host browser reaches them.
  registerApiTokenRoutes(app, new ApiTokenService(new ApiTokenRepository(db)));
  await app.listen({ port: 0, host: "127.0.0.1" });
  apps.push(app);
  const address = app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return { baseUrl: `http://127.0.0.1:${port}`, db };
}

// ── A1 — contract-first: the frozen scope vocabulary + the zod schema live in packages/shared ──────

test("A1 — API_TOKEN_SCOPES is exactly the frozen D-C4 vocabulary", () => {
  assert.deepEqual(API_TOKEN_SCOPES, ["read", "scan:run", "runs:launch", "suites:run"]);
  // The execute scopes are exactly the write scopes D-MCP3 names — the vocabulary WP M.2/M.3 consume.
  assert.deepEqual(API_TOKEN_EXECUTE_SCOPES, ["scan:run", "runs:launch", "suites:run"]);
  // There is deliberately NO delete scope: deletes are excluded at every phase (D-MCP3).
  assert.ok(!(API_TOKEN_SCOPES as readonly string[]).some((s) => s.includes("delete")));
  // Every scope carries operator-facing copy, so the Settings create form never renders a bare id.
  for (const scope of API_TOKEN_SCOPES) {
    assert.ok(API_TOKEN_SCOPE_META[scope].label.length > 0, scope);
    assert.ok(API_TOKEN_SCOPE_META[scope].description.length > 0, scope);
  }
  assert.equal(isApiTokenScope("read"), true);
  assert.equal(isApiTokenScope("delete"), false);
  assert.equal(isApiTokenScope(undefined), false);
});

test("A1 — the create schema requires a label and at least one scope, and is strict", () => {
  assert.deepEqual(apiTokenCreateSchema.parse({ label: "CI", scopes: ["read"] }), {
    label: "CI",
    scopes: ["read"],
  });
  // A scope-less token could authenticate but authorize nothing — a confusing credential to hand out.
  assert.throws(() => apiTokenCreateSchema.parse({ label: "CI", scopes: [] }), ZodError);
  assert.throws(() => apiTokenCreateSchema.parse({ label: "", scopes: ["read"] }), ZodError);
  assert.throws(() => apiTokenCreateSchema.parse({ label: "CI", scopes: ["delete"] }), ZodError);
  // Unknown keys are rejected loudly — a caller that thinks it granted something must not get a token
  // that silently lacks it.
  assert.throws(
    () => apiTokenCreateSchema.parse({ label: "CI", scopes: ["read"], admin: true }),
    ZodError,
  );
  assert.throws(
    () => apiTokenCreateSchema.parse({ label: "CI", scopes: ["read"], expiresAt: "next tuesday" }),
    ZodError,
  );
  assert.equal(
    apiTokenCreateSchema.parse({ label: "  CI  ", scopes: ["read"] }).label,
    "CI",
    "the label is trimmed",
  );
});

test("A1 — the coarse method → scope rule is declared once, in shared", () => {
  assert.deepEqual(requiredScopesForMethod("GET"), ["read"]);
  assert.deepEqual(requiredScopesForMethod("head"), ["read"]);
  assert.deepEqual(requiredScopesForMethod("OPTIONS"), ["read"]);
  assert.deepEqual(requiredScopesForMethod("POST"), API_TOKEN_EXECUTE_SCOPES);
  assert.deepEqual(requiredScopesForMethod("PUT"), API_TOKEN_EXECUTE_SCOPES);
  assert.deepEqual(requiredScopesForMethod("PATCH"), API_TOKEN_EXECUTE_SCOPES);
  assert.equal(requiredScopesForMethod("DELETE"), null, "no scope can ever authorize a delete");
});

// ── WP M.2 (A1/A6) — the per-route scope table + resolver, still in packages/shared ───────────────
//
// These are contract tests over the DECLARATION. The guard's use of it (and the D-MCP9 strict path
// matching that makes it safe) is pinned in `api-tokens-guard.test.ts`; the two halves are separate on
// purpose, because a table that reads correctly and a matcher that applies it correctly are different
// ways to get this wrong.

test("A1 — the route table maps the two read-only POSTs, and nothing else", () => {
  assert.deepEqual(
    API_TOKEN_ROUTE_SCOPES.map((rule) => `${rule.method} ${rule.path} (${rule.match})`).sort(),
    ["POST /api/assertions/evaluate (exact)", "POST /api/mcp (exact)"],
  );
  for (const rule of API_TOKEN_ROUTE_SCOPES) {
    assert.deepEqual(rule.scopes, ["read"], `${rule.path} may only ever RELAX to \`read\``);
  }
});

test("A6 — no rule can express a DELETE, target /api/tokens*, or carry an empty scope set", () => {
  for (const rule of API_TOKEN_ROUTE_SCOPES) {
    // The TYPE forbids "DELETE" (a compile error, not a review catch) — this is the runtime twin, so
    // a cast or a hand-edited entry cannot smuggle one in either.
    assert.notEqual(rule.method, "DELETE", `${rule.path} must not be a delete rule (D-MCP3)`);
    // The guard refuses token CRUD before any scope check, so a rule here would do nothing — but it
    // would READ as though it granted something, which is a trap for the next reader.
    assert.ok(
      rule.path !== "/api/tokens" && !rule.path.startsWith("/api/tokens/"),
      `${rule.path} must not pretend to govern token CRUD`,
    );
    // An empty array would read as "no scope needed" and hand the route to any authenticated token.
    assert.ok(rule.scopes.length > 0, `${rule.path} must require at least one scope`);
    for (const scope of rule.scopes) {
      assert.ok(
        (API_TOKEN_SCOPES as readonly string[]).includes(scope),
        `${rule.path} names ${scope}, which is not in the frozen vocabulary`,
      );
    }
  }
});

test("A1 — requiredScopesForRoute consults the table, then falls back to the coarse rule", () => {
  // A matcher a plain-string caller can pass. The API passes the RAW-and-DECODED strict one instead
  // (D-MCP9) — that difference is the whole reason the parameter has no default.
  const matcherFor = (path: string) => (rulePath: string, match: "exact" | "prefix") =>
    match === "exact" ? path === rulePath : path === rulePath || path.startsWith(`${rulePath}/`);

  assert.deepEqual(requiredScopesForRoute("POST", matcherFor("/api/mcp")), ["read"]);
  assert.deepEqual(requiredScopesForRoute("post", matcherFor("/api/mcp")), ["read"], "verb case");
  assert.deepEqual(requiredScopesForRoute("POST", matcherFor("/api/assertions/evaluate")), [
    "read",
  ]);

  // Unmapped POSTs keep the coarse rule…
  assert.deepEqual(
    requiredScopesForRoute("POST", matcherFor("/api/servers/s1/scan")),
    API_TOKEN_EXECUTE_SCOPES,
  );
  assert.deepEqual(
    requiredScopesForRoute("POST", matcherFor("/api/run-plans")),
    API_TOKEN_EXECUTE_SCOPES,
  );
  // …and the mount rule is EXACT, so a child path does not inherit it.
  assert.deepEqual(
    requiredScopesForRoute("POST", matcherFor("/api/mcp/llms.txt")),
    API_TOKEN_EXECUTE_SCOPES,
    "an exact rule must not relax a subtree",
  );
  // A GET keeps needing `read` whether or not a rule matched.
  assert.deepEqual(requiredScopesForRoute("GET", matcherFor("/api/mcp/llms.txt")), ["read"]);
});

test("A6 — requiredScopesForRoute short-circuits DELETE before the table is even consulted", () => {
  // A matcher that says YES to everything: if the table were consulted first, a delete would inherit
  // `read`. It must not, however the table is spelled or ordered.
  const matchesEverything = () => true;
  assert.equal(requiredScopesForRoute("DELETE", matchesEverything), null);
  assert.equal(requiredScopesForRoute("delete", matchesEverything), null);
  // The fallback is unchanged and still exported — the route table extends around it, never edits it.
  assert.equal(requiredScopesForMethod("DELETE"), null);
});

test("readBearerToken parses only a real bearer credential", () => {
  assert.equal(readBearerToken("Bearer mcpfp_abc"), "mcpfp_abc");
  assert.equal(readBearerToken("  bearer   mcpfp_abc  "), "mcpfp_abc");
  assert.equal(readBearerToken("Basic dXNlcjpwYXNz"), undefined);
  assert.equal(readBearerToken("mcpfp_abc"), undefined, "a bare value is not a bearer credential");
  assert.equal(readBearerToken("Bearer"), undefined);
  assert.equal(readBearerToken(""), undefined);
  assert.equal(readBearerToken(undefined), undefined);
});

// ── A3 — hashed at rest; the plaintext is returned exactly once ───────────────────────────────────

test("A3 — a minted token is 256 bits of CSPRNG behind the mcpfp_ marker, and unique", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 200; i += 1) {
    const token = generateToken();
    assert.ok(token.startsWith(API_TOKEN_PREFIX), token);
    // 32 random bytes base64url-encode to 43 characters (no padding).
    assert.equal(token.length, API_TOKEN_PREFIX.length + 43);
    assert.match(token.slice(API_TOKEN_PREFIX.length), /^[A-Za-z0-9_-]{43}$/);
    assert.ok(looksLikeApiToken(token));
    seen.add(token);
  }
  assert.equal(seen.size, 200, "no collisions across 200 mints");
});

test("A3 — the stored row holds a SHA-256 digest and never the plaintext", () => {
  const { service, db } = makeService();
  const { token, secret } = service.create({ label: "CI — footprint gate", scopes: ["read"] });

  // Read the RAW row, not the projected wire shape — this is the assertion that matters.
  const row = db.prepare("SELECT * FROM api_tokens WHERE id = ?").get(token.id) as Record<
    string,
    unknown
  >;
  const serialized = JSON.stringify(row);
  assert.ok(!serialized.includes(secret), "no column holds the plaintext token");
  assert.ok(
    !serialized.includes(secret.slice(API_TOKEN_PREFIX.length)),
    "no column holds the secret half either",
  );
  assert.equal(
    row.token_hash,
    crypto.createHash("sha256").update(secret, "utf8").digest("hex"),
    "token_hash is the SHA-256 hex of the FULL plaintext (marker included)",
  );
  assert.equal(hashToken(secret), row.token_hash);
  assert.equal(
    row.token_prefix,
    secret.slice(API_TOKEN_PREFIX.length, API_TOKEN_PREFIX.length + API_TOKEN_PREFIX_LENGTH),
    "token_prefix is the display half only",
  );
  assert.equal(String(row.token_prefix).length, API_TOKEN_PREFIX_LENGTH);

  // …and the projected wire shape has no field that could carry it.
  assert.deepEqual(Object.keys(token).sort(), [
    "createdAt",
    "expiresAt",
    "id",
    "label",
    "lastUsedAt",
    "scopes",
    "tokenPrefix",
  ]);
  assert.ok(!JSON.stringify(service.list()).includes(secret), "list() never returns the plaintext");
});

test("A3 — token_hash is UNIQUE, so authentication is one indexed lookup, not a scan", () => {
  const { db } = makeService();
  const indexes = db.prepare("PRAGMA index_list(api_tokens)").all() as Array<{
    unique: number;
    name: string;
  }>;
  const uniqueColumns = indexes
    .filter((index) => index.unique === 1)
    .flatMap((index) =>
      (db.prepare(`PRAGMA index_info(${index.name})`).all() as Array<{ name: string }>).map(
        (c) => c.name,
      ),
    );
  assert.ok(uniqueColumns.includes("token_hash"), "token_hash carries a UNIQUE index");
});

test("A3 — duplicate scopes collapse, so a token's granted set reads as intended", () => {
  const { service } = makeService();
  const { token } = service.create({ label: "CI", scopes: ["read", "read", "scan:run"] });
  assert.deepEqual(token.scopes, ["read", "scan:run"]);
});

// ── The service's authenticate contract ───────────────────────────────────────────────────────────

test("authenticate distinguishes malformed / unknown / expired, and fails closed", () => {
  let clock = new Date("2026-08-19T10:00:00.000Z");
  const { service } = makeService(() => clock);

  const live = service.create({ label: "live", scopes: ["read"] });
  const expiring = service.create({
    label: "expiring",
    scopes: ["read"],
    expiresAt: "2026-08-19T11:00:00.000Z",
  });

  assert.deepEqual(service.authenticate(live.secret), {
    ok: true,
    // `tokenPrefix` (WP M.2) is the stored DISPLAY prefix, so the MCP mount's audit line can name
    // WHICH token acted without the plaintext ever being in scope. It is read from the row — the same
    // value the list endpoint shows — never re-derived from the presented credential.
    token: {
      id: live.token.id,
      label: "live",
      tokenPrefix: live.token.tokenPrefix,
      scopes: ["read"],
    },
  });
  assert.ok(
    live.secret.startsWith(`${API_TOKEN_PREFIX}${live.token.tokenPrefix}`),
    "the display prefix really is the head of the plaintext — and nothing more of it",
  );
  assert.equal(live.token.tokenPrefix.length, API_TOKEN_PREFIX_LENGTH);
  assert.deepEqual(service.authenticate("nope"), { ok: false, reason: "malformed" });
  assert.deepEqual(service.authenticate(`${API_TOKEN_PREFIX}${"a".repeat(43)}`), {
    ok: false,
    reason: "unknown",
  });

  assert.equal(service.authenticate(expiring.secret).ok, true, "before its expiry");
  clock = new Date("2026-08-19T11:00:00.000Z");
  assert.deepEqual(
    service.authenticate(expiring.secret),
    { ok: false, reason: "expired" },
    "expiry is inclusive — at the instant it expires, it is expired",
  );

  // Revocation takes effect immediately, with no tombstone left behind.
  assert.equal(service.revoke(live.token.id), true);
  assert.deepEqual(service.authenticate(live.secret), { ok: false, reason: "unknown" });
  assert.equal(service.revoke(live.token.id), false, "revoking twice is not an error, just false");
});

test("a corrupt scopes_json row fails CLOSED (fewer scopes, never more)", () => {
  const { service, db } = makeService();
  const created = service.create({ label: "CI", scopes: ["read", "scan:run"] });
  db.prepare("UPDATE api_tokens SET scopes_json = ? WHERE id = ?").run(
    '["read","ghost:scope",{"admin":true}]',
    created.token.id,
  );
  const result = service.authenticate(created.secret);
  assert.equal(result.ok, true);
  assert.deepEqual(result.ok && result.token.scopes, ["read"], "unknown entries are dropped");

  db.prepare("UPDATE api_tokens SET scopes_json = ? WHERE id = ?").run("not json", created.token.id);
  const broken = service.authenticate(created.secret);
  assert.equal(broken.ok, true, "an unparseable blob must not throw on the hot auth path");
  assert.deepEqual(broken.ok && broken.token.scopes, [], "…it authorizes nothing");
});

// ── The routes ────────────────────────────────────────────────────────────────────────────────────

test("GET /api/tokens starts empty and lists newest first", async () => {
  const { baseUrl } = await makeRoutes();
  const empty = await fetch(`${baseUrl}/api/tokens`);
  assert.equal(empty.status, 200);
  assert.deepEqual(await empty.json(), { tokens: [] });

  for (const label of ["first", "second"]) {
    const response = await fetch(`${baseUrl}/api/tokens`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label, scopes: ["read"] }),
    });
    assert.equal(response.status, 201);
  }
  const listed = (await (await fetch(`${baseUrl}/api/tokens`)).json()) as ApiTokenListResponse;
  assert.equal(listed.tokens.length, 2);
  assert.equal(listed.tokens[0]?.label, "second", "newest first");
});

test("POST /api/tokens returns the secret ONCE and never again", async () => {
  const { baseUrl } = await makeRoutes();
  const response = await fetch(`${baseUrl}/api/tokens`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      label: "CI — footprint gate",
      scopes: ["read", "scan:run"],
      expiresAt: "2027-01-01T00:00:00.000Z",
    }),
  });
  assert.equal(response.status, 201);
  const created = (await response.json()) as ApiTokenCreateResponse;
  assert.ok(created.secret.startsWith(API_TOKEN_PREFIX));
  assert.equal(created.token.label, "CI — footprint gate");
  assert.deepEqual(created.token.scopes, ["read", "scan:run"]);
  assert.equal(created.token.expiresAt, "2027-01-01T00:00:00.000Z");
  assert.equal(created.token.lastUsedAt, null);

  const listed = await (await fetch(`${baseUrl}/api/tokens`)).text();
  assert.ok(!listed.includes(created.secret), "the list endpoint never returns the plaintext");
  assert.ok(
    listed.includes(created.token.tokenPrefix),
    "…it returns the display prefix so the row is identifiable",
  );
});

test("POST /api/tokens rejects an invalid body with 400 and creates nothing", async () => {
  const { baseUrl, db } = await makeRoutes();
  for (const body of [
    {},
    { label: "CI" },
    { label: "CI", scopes: [] },
    { label: "CI", scopes: ["delete"] },
    { label: "CI", scopes: ["read"], admin: true },
  ]) {
    const response = await fetch(`${baseUrl}/api/tokens`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 400, JSON.stringify(body));
  }
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM api_tokens").get() as { n: number }).n, 0);
});

test("DELETE /api/tokens/:id revokes with 204, and 404s for an unknown id", async () => {
  const { baseUrl } = await makeRoutes();
  const created = (await (
    await fetch(`${baseUrl}/api/tokens`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: "CI", scopes: ["read"] }),
    })
  ).json()) as ApiTokenCreateResponse;

  const revoked = await fetch(`${baseUrl}/api/tokens/${created.token.id}`, { method: "DELETE" });
  assert.equal(revoked.status, 204);

  const listed = (await (await fetch(`${baseUrl}/api/tokens`)).json()) as ApiTokenListResponse;
  assert.deepEqual(listed.tokens, [], "revocation is removal of the row — no tombstone");

  const missing = await fetch(`${baseUrl}/api/tokens/does-not-exist`, { method: "DELETE" });
  assert.equal(missing.status, 404);
});
