import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import type { AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import {
  brokenLinkError,
  McpServerLinkedAuth,
  type LinkedAuthResolver,
  type LinkedOAuthReader,
  type LinkedServerReader,
} from "../src/providers/linked-auth.js";
import { ProviderRepository } from "../src/providers/repository.js";
import type { InternalServerConfig } from "../src/servers/repository.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { httpError, toErrorMessage } from "../src/utils/errors.js";

// Qlik Answers dual-auth (WP 0.2, D-QA1). All paths are exercised with STUBBED server/oauth readers +
// a real in-memory DB — no Qlik tenant is ever contacted (that is the roster/executor's job, WP 0.3/1.1).

const databases: AppDatabase[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

const NOW = "2026-07-11T00:00:00.000Z";

function createDatabase(): AppDatabase {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  databases.push(db);
  return db;
}

/** A minimal registered streamable-HTTP server row, so a linked credential's FK resolves. */
function seedServer(db: AppDatabase, id = "srv-qlik"): void {
  db.prepare(
    `INSERT INTO mcp_servers (id, name, transport, command, args_json, url, headers_json, env_json, auth_type, auth_header_name, created_at, updated_at)
     VALUES (@id, 'Qlik', 'streamable_http', NULL, '[]', 'https://tenant.example.com/mcp', '{}', '{}', 'oauth', NULL, @now, @now)`,
  ).run({ id, now: NOW });
}

/** Build a full InternalServerConfig from a partial (fills the required fields). */
function serverConfig(over: Partial<InternalServerConfig> = {}): InternalServerConfig {
  return {
    id: "srv-qlik",
    name: "Qlik",
    transport: "streamable_http",
    url: "https://tenant.example.com/mcp",
    args: [],
    env: {},
    headers: {},
    authType: "oauth",
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

function serverReader(config: InternalServerConfig): LinkedServerReader {
  return { getInternal: () => config };
}
const missingServerReader: LinkedServerReader = {
  getInternal: () => {
    throw httpError(404, "Server not found");
  },
};
function oauthReader(accessToken?: string): LinkedOAuthReader {
  return { getCredentials: () => (accessToken ? { tokens: { access_token: accessToken } } : {}) };
}

// ── McpServerLinkedAuth.resolve — the pure resolution logic (stubbed readers) ──────────────────────

test("resolve — an OAuth-linked server yields its access token as the bearer + the tenant origin", () => {
  const auth = new McpServerLinkedAuth(
    serverReader(serverConfig({ authType: "oauth" })),
    oauthReader("oauth-access-xyz"),
  );
  const resolved = auth.resolve("srv-qlik");
  assert.equal(resolved.apiKey, "oauth-access-xyz", "OAuth access token becomes the bearer");
  assert.equal(
    resolved.baseUrl,
    "https://tenant.example.com",
    "baseUrl is the server URL origin (no path)",
  );
});

test("resolve — a bearer-header server yields the token with the 'Bearer ' prefix stripped", () => {
  const auth = new McpServerLinkedAuth(
    serverReader(
      serverConfig({ authType: "bearer", headers: { Authorization: "Bearer header-tok-123" } }),
    ),
    oauthReader(),
  );
  assert.equal(
    auth.resolve("srv-qlik").apiKey,
    "header-tok-123",
    "the raw token (no 'Bearer ') is returned",
  );
});

test("resolve — an api-key server with a custom header name yields that header's value", () => {
  const auth = new McpServerLinkedAuth(
    serverReader(
      serverConfig({
        authType: "api_key",
        authHeaderName: "qlik-api-key",
        headers: { "qlik-api-key": "raw-key-abc" },
      }),
    ),
    oauthReader(),
  );
  assert.equal(
    auth.resolve("srv-qlik").apiKey,
    "raw-key-abc",
    "the custom header value is the token",
  );
});

test("resolve — a broken link (server gone) throws a clear, non-leaking error", () => {
  const auth = new McpServerLinkedAuth(missingServerReader, oauthReader("unused"));
  const err = assertThrows(() => auth.resolve("srv-gone"));
  assert.equal((err as { statusCode?: number }).statusCode, 400);
  assert.match(toErrorMessage(err), /linked MCP server auth is unavailable/i);
});

test("resolve — an OAuth-linked server with NO token is broken (no partial credential)", () => {
  const auth = new McpServerLinkedAuth(
    serverReader(serverConfig({ authType: "oauth" })),
    oauthReader(undefined),
  );
  assert.throws(() => auth.resolve("srv-qlik"), /linked MCP server auth is unavailable/i);
});

test("resolve — an auth:none server (no usable credential) is broken", () => {
  const auth = new McpServerLinkedAuth(
    serverReader(serverConfig({ authType: "none", headers: {} })),
    oauthReader(),
  );
  assert.throws(() => auth.resolve("srv-qlik"), /linked MCP server auth is unavailable/i);
});

test("resolve — the broken-link error NEVER embeds a token, even when one is present but unusable", () => {
  // A stdio (non-HTTP) server has NO tenant origin → broken, though its headers carry a secret token.
  const auth = new McpServerLinkedAuth(
    serverReader(
      serverConfig({
        transport: "stdio",
        url: undefined,
        authType: "bearer",
        headers: { Authorization: "Bearer SUPER-SECRET-TOKEN" },
      }),
    ),
    oauthReader(),
  );
  const err = assertThrows(() => auth.resolve("srv-qlik"));
  assert.equal(
    toErrorMessage(err).includes("SUPER-SECRET-TOKEN"),
    false,
    "the token must not appear in the error",
  );
  assert.equal(
    JSON.stringify(err).includes("SUPER-SECRET-TOKEN"),
    false,
    "nor anywhere in the serialized error",
  );
});

test("brokenLinkError is a fixed, secret-free 400 message (no token / header / bearer)", () => {
  const err = brokenLinkError();
  assert.equal((err as { statusCode?: number }).statusCode, 400);
  assert.equal(
    /bearer|token|header/i.test(toErrorMessage(err)),
    false,
    "the message names no secret-shaped material",
  );
});

// ── ProviderRepository — getDecrypted + redact() wiring for both auth sources ──────────────────────

const OWN_KEY = "qa-own-key-secret-value";
const LINKED_TOKEN = "linked-bearer-secret-value";

function repoWith(db: AppDatabase, resolver?: LinkedAuthResolver): ProviderRepository {
  return new ProviderRepository(db, new SecretStore(Buffer.alloc(32, 7)), resolver);
}
const okResolver: LinkedAuthResolver = {
  resolve: () => ({ apiKey: LINKED_TOKEN, baseUrl: "https://tenant.example.com" }),
};
const brokenResolver: LinkedAuthResolver = {
  resolve: () => {
    throw brokenLinkError();
  },
};

test("own-key qlik_answers — getDecrypted returns the decrypted key + tenant origin; redact says api_key", () => {
  const db = createDatabase();
  const repo = repoWith(db, okResolver);
  const cred = repo.create({
    kind: "qlik_answers",
    label: "Tenant Assistant",
    baseUrl: "https://tenant.example.com",
    apiKey: OWN_KEY,
  });

  // Redacted view: own-key provenance, no secret.
  assert.equal(cred.authSource, "api_key");
  assert.equal(cred.linkedServerId, undefined);
  assert.equal(cred.authBroken, undefined);
  assert.equal(cred.hasKey, true);
  assert.equal((cred as { apiKey?: unknown }).apiKey, undefined);

  // Decrypted (internal) view: own key + tenant origin, no mcpServerId.
  const dec = repo.getDecrypted(cred.id);
  assert.equal(dec.kind, "qlik_answers");
  assert.equal(dec.apiKey, OWN_KEY);
  assert.equal(dec.baseUrl, "https://tenant.example.com");
  assert.equal(dec.mcpServerId, undefined);
});

test("linked qlik_answers — getDecrypted resolves the server bearer + origin; redact says linked_server, not broken", () => {
  const db = createDatabase();
  seedServer(db);
  const repo = repoWith(db, okResolver);
  const cred = repo.create({
    kind: "qlik_answers",
    label: "Linked Assistant",
    mcpServerId: "srv-qlik",
  });

  assert.equal(cred.authSource, "linked_server");
  assert.equal(cred.linkedServerId, "srv-qlik");
  assert.equal(cred.authBroken, false, "a resolvable link is not broken");
  assert.equal(cred.hasKey, false, "a linked credential stores no own key");

  const dec = repo.getDecrypted(cred.id);
  assert.equal(dec.apiKey, LINKED_TOKEN, "the resolved server bearer is the apiKey");
  assert.equal(dec.baseUrl, "https://tenant.example.com");
  assert.equal(dec.mcpServerId, "srv-qlik", "the link is recorded for downstream (WP 0.3/1.1)");

  // The resolved bearer must NEVER appear in the redacted list/get response.
  assert.equal(
    JSON.stringify(repo.list()).includes(LINKED_TOKEN),
    false,
    "resolved token absent from the list",
  );
  assert.equal(
    JSON.stringify(repo.get(cred.id)).includes(LINKED_TOKEN),
    false,
    "resolved token absent from get",
  );
  assert.equal(
    JSON.stringify(cred).includes(LINKED_TOKEN),
    false,
    "resolved token absent from create response",
  );
});

test("broken link — provider is still listed (authBroken:true) but getDecrypted refuses with a clear error", () => {
  const db = createDatabase();
  seedServer(db);
  const repo = repoWith(db, brokenResolver);
  const cred = repo.create({ kind: "qlik_answers", label: "Broken Link", mcpServerId: "srv-qlik" });

  // Listed with an "auth broken" state (never removed, never a fake credential).
  assert.equal(cred.authSource, "linked_server");
  assert.equal(cred.authBroken, true);
  assert.equal(
    repo.list().find((c) => c.id === cred.id)?.authBroken,
    true,
    "the broken provider stays in the list",
  );

  // Runs/roster refuse: getDecrypted throws, non-leaking.
  const err = assertThrows(() => repo.getDecrypted(cred.id));
  assert.equal((err as { statusCode?: number }).statusCode, 400);
  assert.match(toErrorMessage(err), /linked MCP server auth is unavailable/i);
});

test("linked credential with NO resolver configured — redact marks authBroken, getDecrypted throws (never silently unauth)", () => {
  const db = createDatabase();
  seedServer(db);
  const repo = repoWith(db); // no resolver wired
  const cred = repo.create({
    kind: "qlik_answers",
    label: "Unconfigured",
    mcpServerId: "srv-qlik",
  });

  assert.equal(cred.authBroken, true, "an unresolvable link (no resolver) is auth-broken");
  const err = assertThrows(() => repo.getDecrypted(cred.id));
  assert.equal((err as { statusCode?: number }).statusCode, 500);
});

test("an existing anthropic credential is unaffected — api_key source, no link fields leak a secret", () => {
  const db = createDatabase();
  const repo = repoWith(db, okResolver);
  const cred = repo.create({ kind: "anthropic", label: "Prod", apiKey: "sk-ant-secret" });
  assert.equal(cred.authSource, "api_key");
  assert.equal(cred.linkedServerId, undefined);
  assert.equal(cred.authBroken, undefined);
  assert.equal(repo.getDecrypted(cred.id).apiKey, "sk-ant-secret", "own-key path unchanged");
  assert.equal(JSON.stringify(repo.list()).includes("sk-ant-secret"), false);
});

function assertThrows(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail("expected the call to throw");
}
