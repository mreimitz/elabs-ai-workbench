import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { afterEach, test } from "node:test";
import type { AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { ScanRepository } from "../src/scans/repository.js";

// Issue #10 — a crash mid-scan leaves an `mcp_scans` row `running` forever. `abortOrphanedScans` runs
// at startup (index.ts) and reconciles those orphans to `failed`, mirroring `abortOrphanedRuns`.

const databases: AppDatabase[] = [];

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

test("abortOrphanedScans flips a running scan to failed with an interrupted note", () => {
  const db = createDatabase();
  seedServer(db);
  const repo = new ScanRepository(db);

  // A live scan (orphaned by a crash) + a completed one that must NOT be touched.
  const orphan = repo.createRunningScan("server-1", "generic_o200k");
  assert.equal(orphan.status, "running");
  seedSuccessScan(db, "done-scan");

  const reconciled = repo.abortOrphanedScans();
  assert.equal(reconciled, 1, "exactly the one running scan was reconciled");

  const after = repo.getSummary(orphan.id);
  assert.equal(after.status, "failed", "the orphaned running scan is now failed");
  assert.equal(after.errorMessage, "Scan interrupted by restart");

  // The already-successful scan is untouched.
  assert.equal(repo.getSummary("done-scan").status, "success");

  // Idempotent: a second sweep finds nothing running.
  assert.equal(repo.abortOrphanedScans(), 0, "nothing left to reconcile");
});

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
      'server-1', 'MCP', 'stdio', 'run', '[]', NULL, '{}', '{}',
      'none', NULL, '2026-06-19T12:00:00.000Z', '2026-06-19T12:00:00.000Z'
    )`,
  ).run();
}

function seedSuccessScan(db: AppDatabase, id: string): void {
  db.prepare(
    `INSERT INTO mcp_scans (id, server_id, token_profile, scanned_at, status)
     VALUES (?, 'server-1', 'generic_o200k', '2026-06-19T12:00:00.000Z', 'success')`,
  ).run(id);
}
