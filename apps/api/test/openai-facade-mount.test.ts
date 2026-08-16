import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import type { AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { buildFacadeDeps } from "../src/openai-facade/deps.js";
import { registerOpenAiFacade } from "../src/openai-facade/index.js";
import { ProviderRepository } from "../src/providers/repository.js";
import { ProviderService } from "../src/providers/service.js";
import { SecretStore } from "../src/secrets/secret-store.js";

/**
 * WP5.1 boot/integration test — the OpenAI-compat facade mounted with the REAL deps `index.ts` wires
 * (`buildFacadeDeps`): the real 0600 key-minter + the real `qlik_answers` credential resolution
 * (`ProviderService.listModels` → `listAvailableModels`, `ProviderRepository.getDecrypted`). No real
 * tenant is EVER contacted — the one case that needs a roster stubs `globalThis.fetch` (the repo
 * invariant); the empty-DB + auth cases touch no tenant at all.
 */

const databases: AppDatabase[] = [];
const tempDirs: string[] = [];
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const db of databases.splice(0)) db.close();
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

type ModelsBody = {
  object?: string;
  data?: Array<{ id?: string; object?: string; owned_by?: string; display_name?: string }>;
  error?: { message: string; type: string; code: string | null; param: string | null };
};

function createDatabase(): AppDatabase {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  databases.push(db);
  return db;
}

function tempDataDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "facade-mount-"));
  tempDirs.push(dir);
  return dir;
}

/** Build a real Fastify app + register the facade with the REAL deps factory over `db`. */
function buildApp(db: AppDatabase, dataDirectory: string): {
  app: FastifyInstance;
  facadeKey: string;
  repository: ProviderRepository;
} {
  const repository = new ProviderRepository(db, new SecretStore(Buffer.alloc(32, 7)));
  const providers = new ProviderService(repository);
  const deps = buildFacadeDeps({ providerRepository: repository, providers, dataDirectory });
  const app = Fastify();
  void registerOpenAiFacade(app, deps);
  return { app, facadeKey: deps.facadeKey, repository };
}

test("the facade mounts with a locally-minted key (loadOrMintFacadeKey) → GET /openai/v1/models 200 []", async () => {
  const dataDirectory = tempDataDir();
  const { app, facadeKey } = buildApp(createDatabase(), dataDirectory);

  // The real minter ran: a `mcpfp-` prefixed token persisted 0600 to DATA_DIR/openai-facade.key.
  assert.match(facadeKey, /^mcpfp-/);
  const keyPath = path.join(dataDirectory, "openai-facade.key");
  assert.equal(fs.existsSync(keyPath), true, "the facade key file must be minted beside the DB");
  assert.equal(fs.statSync(keyPath).mode & 0o777, 0o600, "the key file must be 0600");

  const response = await app.inject({
    method: "GET",
    url: "/openai/v1/models",
    headers: { authorization: `Bearer ${facadeKey}` },
  });
  assert.equal(response.statusCode, 200);
  const body = response.json() as ModelsBody;
  assert.equal(body.object, "list");
  assert.deepEqual(body.data, []); // no qlik_answers credential configured → an empty roster

  await app.close();
});

test("an unauthenticated GET /openai/v1/models is rejected 401 (plugin registered with the real key)", async () => {
  const { app, facadeKey } = buildApp(createDatabase(), tempDataDir());

  const missing = await app.inject({ method: "GET", url: "/openai/v1/models" });
  assert.equal(missing.statusCode, 401);
  const body = missing.json() as ModelsBody;
  assert.equal(body.error?.code, "invalid_api_key");
  // The minted key never leaks into an error body.
  assert.equal(missing.body.includes(facadeKey), false);

  const wrong = await app.inject({
    method: "GET",
    url: "/openai/v1/models",
    headers: { authorization: "Bearer not-the-key" },
  });
  assert.equal(wrong.statusCode, 401);

  await app.close();
});

test("a configured qlik_answers credential is listed as a model (real getDecrypted + roster; stub fetch)", async () => {
  const db = createDatabase();
  const { app, facadeKey, repository } = buildApp(db, tempDataDir());

  // Seed a real, own-key qlik_answers credential (encrypted at rest by the real repository).
  repository.create({
    kind: "qlik_answers",
    label: "Acme tenant",
    apiKey: "tenant-secret-key",
    baseUrl: "https://acme.us.qlikcloud.com",
  });

  // Stub the tenant assistants roster — NO real tenant is contacted (repo invariant).
  let assistantsHit = false;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/v1/assistants")) {
      assistantsHit = true;
      return new Response(JSON.stringify({ data: [{ id: "asst-777", name: "Sales Assistant" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`unexpected tenant fetch to ${url}`);
  }) as typeof fetch;

  const response = await app.inject({
    method: "GET",
    url: "/openai/v1/models",
    headers: { authorization: `Bearer ${facadeKey}` },
  });
  assert.equal(response.statusCode, 200);
  const body = response.json() as ModelsBody;
  assert.equal(assistantsHit, true, "the roster must resolve through the real ProviderService.listModels");
  assert.equal(body.data?.length, 1);
  assert.equal(body.data?.[0]?.id, "asst-777");
  assert.equal(body.data?.[0]?.owned_by, "qlik");
  assert.equal(body.data?.[0]?.display_name, "Sales Assistant");

  await app.close();
});
