import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import Fastify from "fastify";
import { ZodError } from "zod";
import type { AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { ProviderRepository } from "../src/providers/repository.js";
import { registerProviderRoutes } from "../src/providers/routes.js";
import { ProviderService } from "../src/providers/service.js";
import { modelFor } from "../src/providers/registry.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { toErrorMessage } from "../src/utils/errors.js";

const databases: AppDatabase[] = [];

afterEach(() => {
  for (const db of databases.splice(0)) {
    db.close();
  }
});

const SECRET = "sk-ant-super-secret-key-value";

test("create + GET expose hasKey:true and never leak the API key in any response body", async () => {
  const db = createDatabase();
  const app = createApp(db, new SecretStore(Buffer.alloc(32, 1)));

  const createResponse = await app.inject({
    method: "POST",
    url: "/api/providers",
    payload: { kind: "anthropic", label: "Anthropic prod", apiKey: SECRET },
  });

  assert.equal(createResponse.statusCode, 201);
  const created = createResponse.json() as { id: string; hasKey: boolean };
  assert.equal(created.hasKey, true);
  assert.equal((created as { apiKey?: unknown }).apiKey, undefined);
  assert.equal(
    createResponse.body.includes(SECRET),
    false,
    "key must not appear in create response",
  );

  const listResponse = await app.inject({ method: "GET", url: "/api/providers" });
  assert.equal(listResponse.statusCode, 200);
  const list = listResponse.json() as Array<{ id: string; hasKey: boolean }>;
  assert.equal(list.length, 1);
  assert.equal(list[0]?.hasKey, true);
  // The raw secret must never appear anywhere in any serialized response body.
  assert.equal(JSON.stringify(listResponse.json()).includes(SECRET), false);
  assert.equal(listResponse.body.includes(SECRET), false, "key must not appear in list response");
  assert.equal(JSON.stringify(createResponse.json()).includes(SECRET), false);

  await app.close();
});

test("the stored row is encrypted with the enc:v1: prefix and is not the plaintext", () => {
  const db = createDatabase();
  const repository = new ProviderRepository(db, new SecretStore(Buffer.alloc(32, 2)));

  const created = repository.create({ kind: "anthropic", label: "Anthropic", apiKey: SECRET });

  const row = db
    .prepare("SELECT api_key_encrypted FROM provider_credentials WHERE id = ?")
    .get(created.id) as { api_key_encrypted: string };

  assert.match(row.api_key_encrypted, /^enc:v1:/);
  assert.equal(row.api_key_encrypted.includes(SECRET), false);
  assert.notEqual(row.api_key_encrypted, SECRET);
  // The redacted return shape carries no key.
  assert.equal((created as { apiKey?: unknown }).apiKey, undefined);
  assert.equal(created.hasKey, true);
  // getDecrypted (API-internal) round-trips the original key.
  assert.equal(repository.getDecrypted(created.id).apiKey, SECRET);
});

test("migratePlaintextSecrets encrypts a pre-seeded plaintext key row", () => {
  const db = createDatabase();
  const repository = new ProviderRepository(db, new SecretStore(Buffer.alloc(32, 3)));
  const now = "2026-06-19T12:00:00.000Z";

  db.prepare(
    `INSERT INTO provider_credentials (id, kind, label, base_url, api_key_encrypted, created_at, updated_at)
     VALUES ('prov-1', 'anthropic', 'Legacy', NULL, @plaintext, @now, @now)`,
  ).run({ plaintext: SECRET, now });

  assert.equal(repository.migratePlaintextSecrets(), 1);

  const row = db
    .prepare("SELECT api_key_encrypted FROM provider_credentials WHERE id = 'prov-1'")
    .get() as { api_key_encrypted: string };
  assert.match(row.api_key_encrypted, /^enc:v1:/);
  assert.equal(row.api_key_encrypted.includes(SECRET), false);
  assert.equal(repository.getDecrypted("prov-1").apiKey, SECRET);

  // A second run is a no-op (already encrypted).
  assert.equal(repository.migratePlaintextSecrets(), 0);
});

test("modelFor builds a model offline for anthropic; self-hosted kinds require a baseUrl (WP 2.3)", () => {
  // No network call — building the model is offline. WP 2.3 wired the remaining providers, so what
  // WP 1.1 stubbed as "throws 400" now builds a model. Self-hosted kinds still need a base URL.
  const model = modelFor({ kind: "anthropic", apiKey: "sk-test" }, "claude-opus-4-8");
  assert.ok(model, "expected an Anthropic language model instance");

  // Hosted providers build offline with just an API key.
  for (const kind of ["openai", "google"] as const) {
    assert.ok(modelFor({ kind, apiKey: "x" }, "some-model"), `${kind} model built offline`);
  }

  // openai_compatible builds with a baseUrl, and throws a 400 without one.
  assert.ok(
    modelFor({ kind: "openai_compatible", baseUrl: "http://localhost:1234/v1", apiKey: "x" }, "m"),
    "openai_compatible model built offline with a baseUrl",
  );
  const missing = assertThrows(() => modelFor({ kind: "openai_compatible", apiKey: "x" }, "m"));
  assert.equal((missing as { statusCode?: number }).statusCode, 400);
  assert.match(toErrorMessage(missing), /base url/i);

  // ollama defaults to the local daemon when no baseUrl is given (so it does NOT throw).
  assert.ok(
    modelFor({ kind: "ollama" }, "llama3.1"),
    "ollama model built offline with the default base URL",
  );
});

test("POST /api/providers rejects an invalid kind via the shared zod schema", async () => {
  const db = createDatabase();
  const app = createApp(db, new SecretStore(Buffer.alloc(32, 4)));

  const response = await app.inject({
    method: "POST",
    url: "/api/providers",
    payload: { kind: "not-a-real-provider", label: "Bad" },
  });

  assert.equal(response.statusCode, 400);
  await app.close();
});

function createDatabase(): AppDatabase {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  databases.push(db);
  return db;
}

function createApp(db: AppDatabase, secrets: SecretStore) {
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: "Validation failed", issues: error.issues });
    }
    const typedError = error as Error & { statusCode?: number };
    const statusCode = typeof typedError.statusCode === "number" ? typedError.statusCode : 500;
    return reply.code(statusCode).send({ error: toErrorMessage(error) });
  });
  const service = new ProviderService(new ProviderRepository(db, secrets));
  void registerProviderRoutes(app, service);
  return app;
}

function assertThrows(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail("expected the call to throw");
}
