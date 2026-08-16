import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { afterEach, test } from "node:test";
import type { AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { ServerRepository } from "../src/servers/repository.js";

const databases: AppDatabase[] = [];

afterEach(() => {
  for (const db of databases.splice(0)) {
    db.close();
  }
});

test("stores server secrets encrypted while public responses stay redacted", () => {
  const db = createDatabase();
  const repository = new ServerRepository(db, new SecretStore(Buffer.alloc(32, 1)));

  const created = repository.create({
    name: "Filesystem",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem"],
    env: { API_TOKEN: "super-secret" },
  });

  assert.equal(created.hasEnvSecrets, true);
  assert.equal(created.hasHeaderSecrets, false);
  assert.equal((created as { env?: unknown }).env, undefined);

  const row = db
    .prepare("SELECT env_json, headers_json FROM mcp_servers WHERE id = ?")
    .get(created.id) as { env_json: string; headers_json: string };
  assert.match(row.env_json, /^enc:v1:/);
  assert.match(row.headers_json, /^enc:v1:/);
  assert.equal(row.env_json.includes("super-secret"), false);

  assert.deepEqual(repository.getInternal(created.id).env, { API_TOKEN: "super-secret" });
});

test("migrates plaintext env and header secrets without changing updated_at", () => {
  const db = createDatabase();
  const repository = new ServerRepository(db, new SecretStore(Buffer.alloc(32, 3)));
  const timestamp = "2026-06-19T12:00:00.000Z";

  db.prepare(
    `INSERT INTO mcp_servers (
      id, name, transport, command, args_json, url, headers_json, env_json, created_at, updated_at
    ) VALUES (
      'server-1', 'HTTP MCP', 'streamable_http', NULL, '[]', 'http://127.0.0.1:3000/mcp',
      '{"Authorization":"Bearer token"}', '{"IGNORED":"still migrated"}', @timestamp, @timestamp
    )`,
  ).run({ timestamp });

  assert.equal(repository.migratePlaintextSecrets(), 1);

  const row = db
    .prepare("SELECT env_json, headers_json, updated_at FROM mcp_servers WHERE id = 'server-1'")
    .get() as { env_json: string; headers_json: string; updated_at: string };

  assert.match(row.env_json, /^enc:v1:/);
  assert.match(row.headers_json, /^enc:v1:/);
  assert.equal(row.headers_json.includes("Bearer token"), false);
  assert.equal(row.updated_at, timestamp);
  assert.deepEqual(repository.getInternal("server-1").headers, { Authorization: "Bearer token" });
});

test("preserves saved secrets when a server update omits secret fields", () => {
  const db = createDatabase();
  const repository = new ServerRepository(db, new SecretStore(Buffer.alloc(32, 4)));
  const created = repository.create({
    name: "GitHub",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    env: { GITHUB_PERSONAL_ACCESS_TOKEN: "secret-token" },
  });

  repository.update(created.id, { name: "GitHub MCP" });

  const internal = repository.getInternal(created.id);
  assert.equal(internal.name, "GitHub MCP");
  assert.deepEqual(internal.env, { GITHUB_PERSONAL_ACCESS_TOKEN: "secret-token" });
});

test("compiles structured bearer and api key auth into encrypted runtime headers", () => {
  const db = createDatabase();
  const repository = new ServerRepository(db, new SecretStore(Buffer.alloc(32, 5)));

  const bearer = repository.create({
    name: "Bearer MCP",
    transport: "streamable_http",
    url: "https://example.test/mcp",
    auth: { type: "bearer", token: "bearer-secret" },
  });
  const apiKey = repository.create({
    name: "API Key MCP",
    transport: "streamable_http",
    url: "https://api.example.test/mcp",
    auth: { type: "api_key", headerName: "x-api-key", key: "api-secret" },
  });

  assert.equal(bearer.authType, "bearer");
  assert.equal(bearer.authHeaderName, "Authorization");
  assert.equal(apiKey.authType, "api_key");
  assert.equal(apiKey.authHeaderName, "x-api-key");
  assert.deepEqual(repository.getInternal(bearer.id).headers, {
    Authorization: "Bearer bearer-secret",
  });
  assert.deepEqual(repository.getInternal(apiKey.id).headers, { "x-api-key": "api-secret" });

  const rows = db.prepare("SELECT headers_json FROM mcp_servers").all() as Array<{
    headers_json: string;
  }>;
  assert.equal(
    rows.some((row) => row.headers_json.includes("bearer-secret")),
    false,
  );
  assert.equal(
    rows.some((row) => row.headers_json.includes("api-secret")),
    false,
  );
});

test("remembers the OAuth client id across save + reload (and keeps the secret server-side)", () => {
  const db = createDatabase();
  const repository = new ServerRepository(db, new SecretStore(Buffer.alloc(32, 7)));

  const created = repository.create({
    name: "Qlik",
    transport: "streamable_http",
    url: "https://example.qlikcloud.com/api/ai/mcp",
    auth: { type: "oauth", clientId: "my-registered-client", clientSecret: "shh" },
  });

  // The public/redacted config round-trips the client id (so the edit form can prefill it)…
  assert.equal(created.authType, "oauth");
  assert.equal(created.oauthClientId, "my-registered-client");
  assert.equal(repository.getPublic(created.id).oauthClientId, "my-registered-client");
  assert.equal(
    repository.list().find((s) => s.id === created.id)?.oauthClientId,
    "my-registered-client",
  );

  // …but the secret is never returned and is stored encrypted.
  assert.equal((created as { oauthClientSecret?: unknown }).oauthClientSecret, undefined);
  const row = db
    .prepare("SELECT client_information_json FROM mcp_oauth_credentials WHERE server_id = ?")
    .get(created.id) as { client_information_json: string };
  assert.match(row.client_information_json, /^enc:v1:/);
  assert.equal(row.client_information_json.includes("shh"), false);

  // An unrelated edit that keeps the same client id must not drop a working authorization.
  db.prepare("UPDATE mcp_oauth_credentials SET tokens_json = ? WHERE server_id = ?").run(
    "enc:v1:token",
    created.id,
  );
  repository.update(created.id, {
    name: "Qlik (renamed)",
    auth: { type: "oauth", clientId: "my-registered-client" },
  });
  const afterRename = db
    .prepare("SELECT tokens_json FROM mcp_oauth_credentials WHERE server_id = ?")
    .get(created.id) as { tokens_json: string | null };
  assert.equal(
    afterRename.tokens_json,
    "enc:v1:token",
    "tokens survive an edit that keeps the client id",
  );

  // Changing the client id invalidates the prior authorization (tokens reset).
  repository.update(created.id, { auth: { type: "oauth", clientId: "different-client" } });
  const afterChange = db
    .prepare("SELECT tokens_json FROM mcp_oauth_credentials WHERE server_id = ?")
    .get(created.id) as { tokens_json: string | null };
  assert.equal(afterChange.tokens_json, null, "tokens reset when the client id changes");
  assert.equal(repository.getPublic(created.id).oauthClientId, "different-client");
});

function createDatabase(): AppDatabase {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  databases.push(db);
  return db;
}
