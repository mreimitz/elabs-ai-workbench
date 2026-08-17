import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { afterEach, test } from "node:test";
import { applyMigrations, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { ServerRepository } from "../src/servers/repository.js";
import { ServerTypeRepository } from "../src/server-types/repository.js";

const databases: AppDatabase[] = [];

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function createDatabase(): AppDatabase {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  databases.push(db);
  return db;
}

function statusCodeOf(fn: () => unknown): number | undefined {
  try {
    fn();
    return undefined;
  } catch (error) {
    return (error as { statusCode?: number }).statusCode;
  }
}

test("server type CRUD: create defaults, list ordering, member counts", () => {
  const db = createDatabase();
  const types = new ServerTypeRepository(db);
  const servers = new ServerRepository(db, new SecretStore(Buffer.alloc(32, 1)));

  const saas = types.create({ name: "Acme-SaaS" });
  assert.equal(saas.status, "production"); // default
  assert.equal(saas.memberCount, 0);

  const stage = types.create({ name: "acme-stage", status: "beta", description: "RC fleet" });
  assert.equal(stage.status, "beta");
  assert.equal(stage.description, "RC fleet");

  servers.create({ name: "Acme A", transport: "stdio", command: "npx", typeId: saas.id });
  servers.create({ name: "Acme B", transport: "stdio", command: "npx", typeId: saas.id });

  const listed = types.list();
  assert.deepEqual(
    listed.map((t) => t.name),
    ["Acme-SaaS", "acme-stage"], // name-sorted, case-insensitive
  );
  assert.equal(listed[0]?.memberCount, 2);
  assert.equal(listed[1]?.memberCount, 0);
});

test("server type update: rename, restatus, description null clears; duplicate name is 409", () => {
  const db = createDatabase();
  const types = new ServerTypeRepository(db);
  const created = types.create({ name: "Acme-SaaS", description: "prod" });

  const renamed = types.update(created.id, { name: "Acme-SaaS-EU", status: "deprecated" });
  assert.equal(renamed.name, "Acme-SaaS-EU");
  assert.equal(renamed.status, "deprecated");
  assert.equal(renamed.description, "prod"); // omitted → kept

  const cleared = types.update(created.id, { description: null });
  assert.equal(cleared.description, undefined);

  types.create({ name: "Other" });
  assert.equal(statusCodeOf(() => types.create({ name: "other" })), 409); // case-insensitive
  assert.equal(statusCodeOf(() => types.update(created.id, { name: "OTHER" })), 409);
  // Re-saving a type under its own name (case change only) is not a conflict.
  const recased = types.update(created.id, { name: "ACME-SAAS-EU" });
  assert.equal(recased.name, "ACME-SAAS-EU");
});

test("unknown ids: get/update/delete 404; assigning an unknown typeId to a server is 400", () => {
  const db = createDatabase();
  const types = new ServerTypeRepository(db);
  const servers = new ServerRepository(db, new SecretStore(Buffer.alloc(32, 2)));

  assert.equal(statusCodeOf(() => types.get("missing")), 404);
  assert.equal(statusCodeOf(() => types.update("missing", { name: "x" })), 404);
  assert.equal(statusCodeOf(() => types.delete("missing")), 404);

  assert.equal(
    statusCodeOf(() =>
      servers.create({ name: "S", transport: "stdio", command: "npx", typeId: "missing" }),
    ),
    400,
  );

  const created = servers.create({ name: "S", transport: "stdio", command: "npx" });
  assert.equal(statusCodeOf(() => servers.update(created.id, { typeId: "missing" })), 400);
});

test("server typeId round-trips additively and stays redaction-safe", () => {
  const db = createDatabase();
  const types = new ServerTypeRepository(db);
  const servers = new ServerRepository(db, new SecretStore(Buffer.alloc(32, 3)));
  const saas = types.create({ name: "Acme-SaaS" });

  // Untyped server: typeId absent from the public shape (additive wire, D-ST5).
  const untyped = servers.create({ name: "Plain", transport: "stdio", command: "npx" });
  assert.equal(untyped.typeId, undefined);

  const typed = servers.create({
    name: "Acme prod",
    transport: "stdio",
    command: "npx",
    env: { API_TOKEN: "super-secret" },
    typeId: saas.id,
  });
  assert.equal(typed.typeId, saas.id);
  assert.equal(typed.hasEnvSecrets, true);
  assert.equal((typed as { env?: unknown }).env, undefined); // redaction untouched

  // Omitting typeId on update keeps it; explicit null clears it.
  const renamed = servers.update(typed.id, { name: "Acme prod EU" });
  assert.equal(renamed.typeId, saas.id);
  const cleared = servers.update(typed.id, { typeId: null });
  assert.equal(cleared.typeId, undefined);
});

test("deleting a type detaches members (SET NULL) and never deletes servers (D-ST4)", () => {
  const db = createDatabase();
  const types = new ServerTypeRepository(db);
  const servers = new ServerRepository(db, new SecretStore(Buffer.alloc(32, 4)));
  const saas = types.create({ name: "Acme-SaaS" });
  const member = servers.create({
    name: "Acme prod",
    transport: "stdio",
    command: "npx",
    typeId: saas.id,
  });

  types.delete(saas.id);

  const survivor = servers.getPublic(member.id);
  assert.equal(survivor.typeId, undefined);
  assert.equal(survivor.name, "Acme prod");
});

test("migration v25 adds server_types + mcp_servers.type_id to a pre-v25 DB and no-ops on fresh", () => {
  // Pre-v25 DB: the old mcp_servers shape (no type_id), no server_types table, stamped v24.
  const old = new Database(":memory:") as AppDatabase;
  databases.push(old);
  old.exec(`CREATE TABLE mcp_servers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    transport TEXT NOT NULL CHECK (transport IN ('stdio', 'streamable_http')),
    command TEXT,
    args_json TEXT NOT NULL DEFAULT '[]',
    url TEXT,
    headers_json TEXT NOT NULL DEFAULT '{}',
    env_json TEXT NOT NULL DEFAULT '{}',
    auth_type TEXT NOT NULL DEFAULT 'none',
    auth_header_name TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
  old.pragma("user_version = 24");

  applyMigrations(old);

  const tables = old
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='server_types'")
    .all();
  assert.equal(tables.length, 1, "server_types created");
  const columns = (
    old.prepare("PRAGMA table_info(mcp_servers)").all() as Array<{ name: string }>
  ).map((c) => c.name);
  assert.ok(columns.includes("type_id"), "mcp_servers.type_id added");

  // Fresh DB (schemaSql already at the target shape) stamped v24 → v25 must be a clean no-op.
  const fresh = createDatabase();
  fresh.pragma("user_version = 24");
  applyMigrations(fresh);
  const typeIdColumns = (
    fresh.prepare("PRAGMA table_info(mcp_servers)").all() as Array<{ name: string }>
  ).filter((c) => c.name === "type_id");
  assert.equal(typeIdColumns.length, 1, "no duplicate type_id column");
});
