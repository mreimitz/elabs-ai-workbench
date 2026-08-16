import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { afterEach, test } from "node:test";
import type { AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { OAUTH_FLOW_TTL_MS, OAuthRepository } from "../src/oauth/repository.js";
import { SecretStore } from "../src/secrets/secret-store.js";

const databases: AppDatabase[] = [];

afterEach(() => {
  for (const db of databases.splice(0)) {
    db.close();
  }
});

test("stores OAuth tokens encrypted and reports token status", () => {
  const db = createDatabase();
  seedServer(db);
  const repository = new OAuthRepository(db, new SecretStore(Buffer.alloc(32, 6)));

  repository.saveTokens("server-1", {
    access_token: "oauth-access-token",
    token_type: "Bearer",
    refresh_token: "oauth-refresh-token",
  });

  assert.equal(repository.hasTokens("server-1"), true);
  assert.equal(repository.getCredentials("server-1").tokens?.access_token, "oauth-access-token");

  const row = db
    .prepare("SELECT tokens_json FROM mcp_oauth_credentials WHERE server_id = 'server-1'")
    .get() as { tokens_json: string };
  assert.match(row.tokens_json, /^enc:v1:/);
  assert.equal(row.tokens_json.includes("oauth-access-token"), false);
  assert.equal(row.tokens_json.includes("oauth-refresh-token"), false);
});

test("stores configured OAuth client information encrypted and clears stale tokens", () => {
  const db = createDatabase();
  seedServer(db);
  const repository = new OAuthRepository(db, new SecretStore(Buffer.alloc(32, 8)));

  repository.saveTokens("server-1", {
    access_token: "stale-access-token",
    token_type: "Bearer",
  });

  repository.saveConfiguredClientInformation("server-1", {
    clientId: "static-client-id",
    clientSecret: "static-client-secret",
  });

  const credentials = repository.getCredentials("server-1");
  assert.equal(credentials.clientInformation?.client_id, "static-client-id");
  assert.equal(credentials.clientInformation?.client_secret, "static-client-secret");
  assert.equal(credentials.tokens, undefined);

  const row = db
    .prepare(
      "SELECT client_information_json, tokens_json FROM mcp_oauth_credentials WHERE server_id = 'server-1'",
    )
    .get() as { client_information_json: string; tokens_json: string | null };
  assert.match(row.client_information_json, /^enc:v1:/);
  assert.equal(row.client_information_json.includes("static-client-secret"), false);
  assert.equal(row.tokens_json, null);
});

test("preserves the stored client secret when re-configuring with a blank secret", () => {
  // Regression: the client secret is never returned to the browser, so re-running OAuth from the
  // edit wizard sends the client id with an empty secret. That must NOT wipe the stored secret —
  // otherwise the confidential client is downgraded to public and the provider rejects the next
  // token exchange (the owner then has to keep minting fresh secrets).
  const db = createDatabase();
  seedServer(db);
  const repository = new OAuthRepository(db, new SecretStore(Buffer.alloc(32, 11)));

  repository.saveConfiguredClientInformation("server-1", {
    clientId: "static-client-id",
    clientSecret: "static-client-secret",
  });
  repository.saveTokens("server-1", { access_token: "live-access-token", token_type: "Bearer" });

  // Re-auth with the SAME client id and no secret (the wizard leaves it blank).
  repository.saveConfiguredClientInformation("server-1", { clientId: "static-client-id" });

  const credentials = repository.getCredentials("server-1");
  assert.equal(credentials.clientInformation?.client_id, "static-client-id");
  assert.equal(
    credentials.clientInformation?.client_secret,
    "static-client-secret",
    "the stored secret survives a blank re-configure",
  );
  assert.equal(
    credentials.tokens?.access_token,
    "live-access-token",
    "an unchanged client id keeps the working authorization",
  );
});

test("resets tokens and stores the new secret when the client id changes", () => {
  const db = createDatabase();
  seedServer(db);
  const repository = new OAuthRepository(db, new SecretStore(Buffer.alloc(32, 12)));

  repository.saveConfiguredClientInformation("server-1", {
    clientId: "old-client-id",
    clientSecret: "old-secret",
  });
  repository.saveTokens("server-1", { access_token: "old-token", token_type: "Bearer" });

  repository.saveConfiguredClientInformation("server-1", {
    clientId: "new-client-id",
    clientSecret: "new-secret",
  });

  const credentials = repository.getCredentials("server-1");
  assert.equal(credentials.clientInformation?.client_id, "new-client-id");
  assert.equal(credentials.clientInformation?.client_secret, "new-secret");
  assert.equal(credentials.tokens, undefined, "changing the client id drops the stale tokens");
});

test("tracks and clears pending OAuth flows by state", () => {
  const db = createDatabase();
  seedServer(db);
  const repository = new OAuthRepository(db, new SecretStore(Buffer.alloc(32, 7)));

  repository.createFlow("state-1", "server-1");
  const pendingFlow = repository.getFlow("state-1");
  assert.equal(pendingFlow?.server_id, "server-1");
  assert.equal(pendingFlow?.completed_at, null);

  repository.completeFlow("state-1");
  const completedFlow = repository.getFlow("state-1");
  assert.equal(completedFlow?.server_id, "server-1");
  assert.equal(typeof completedFlow?.completed_at, "string");
  assert.equal(completedFlow?.error_message, null);

  repository.deleteFlow("state-1");
  assert.equal(repository.getFlow("state-1"), null);
});

test("getFlow rejects a flow older than the TTL and keeps a fresh one (issue #10)", () => {
  const db = createDatabase();
  seedServer(db);
  const repository = new OAuthRepository(db, new SecretStore(Buffer.alloc(32, 9)));

  // A fresh flow is returned as usual.
  repository.createFlow("fresh-state", "server-1");
  assert.equal(repository.getFlow("fresh-state")?.server_id, "server-1");

  // A flow created past the TTL is treated as expired → getFlow returns null (can't be replayed).
  seedFlowAt(db, "stale-state", "server-1", Date.now() - (OAUTH_FLOW_TTL_MS + 60_000));
  assert.equal(repository.getFlow("stale-state"), null, "an expired flow is rejected");
  // The stale row still physically exists until swept (getFlow does not delete it).
  const rawStale = db
    .prepare("SELECT state FROM mcp_oauth_flows WHERE state = 'stale-state'")
    .get();
  assert.ok(rawStale, "getFlow does not delete the expired row");
});

test("sweepExpiredFlows deletes only stale flow rows (issue #10)", () => {
  const db = createDatabase();
  seedServer(db);
  const repository = new OAuthRepository(db, new SecretStore(Buffer.alloc(32, 10)));

  repository.createFlow("keep-state", "server-1");
  seedFlowAt(db, "drop-state", "server-1", Date.now() - (OAUTH_FLOW_TTL_MS + 60_000));

  assert.equal(repository.sweepExpiredFlows(), 1, "only the stale flow is swept");
  const remaining = db.prepare("SELECT COUNT(*) AS n FROM mcp_oauth_flows").get() as { n: number };
  assert.equal(remaining.n, 1, "one flow row remains after the sweep");
  assert.ok(repository.getFlow("keep-state"), "the fresh flow survives the sweep");
  assert.equal(repository.getFlow("drop-state"), null, "the stale flow is gone");
});

function seedFlowAt(db: AppDatabase, state: string, serverId: string, createdAtMs: number): void {
  db.prepare(
    `INSERT INTO mcp_oauth_flows (state, server_id, created_at, completed_at, error_message)
     VALUES (?, ?, ?, NULL, NULL)`,
  ).run(state, serverId, new Date(createdAtMs).toISOString());
}

function createDatabase(): AppDatabase {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  databases.push(db);
  return db;
}

function seedServer(db: AppDatabase): void {
  db.prepare(
    `INSERT INTO mcp_servers (
      id, name, transport, command, args_json, url, headers_json, env_json,
      auth_type, auth_header_name, created_at, updated_at
    ) VALUES (
      'server-1', 'OAuth MCP', 'streamable_http', NULL, '[]', 'https://example.test/mcp',
      '{}', '{}', 'oauth', NULL, '2026-06-19T12:00:00.000Z', '2026-06-19T12:00:00.000Z'
    )`,
  ).run();
}
