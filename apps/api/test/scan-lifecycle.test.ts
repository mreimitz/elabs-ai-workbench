import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import type { AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { ScanRepository, type ToolScanInsert } from "../src/scans/repository.js";

// Scan lifecycle at the repository layer (deterministic — no MCP/network): the success path
// (createRunningScan → completeScan → getDetail), the failure path (failScan), and the delete cascade
// to child tables. `ScanService.runScan` orchestrates these around a live `discoverTools`; the
// per-step persistence contract exercised here is what it commits.

const databases: AppDatabase[] = [];

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

test("success path: a running scan completes with tools, tokens, and events", () => {
  const db = createDatabase();
  seedServer(db);
  const repo = new ScanRepository(db);

  const running = repo.createRunningScan("server-1", "generic_o200k");
  assert.equal(running.status, "running");
  assert.equal(running.countingVersion > 0, true);
  repo.addEvent(running.id, "info", "Started scan");

  const tools: ToolScanInsert[] = [toolInsert("alpha", 120, 60), toolInsert("beta", 80, 40)];
  repo.completeScan(
    running.id,
    {
      totalTools: 2,
      totalTokens: 200,
      totalRawBytes: 999,
      averageTokensPerTool: 100,
      largestToolName: "alpha",
      largestToolTokens: 120,
      totalResources: 0,
      totalResourceTemplates: 0,
      totalPrompts: 0,
      totalResourceTokens: 0,
      totalPromptTokens: 0,
      largestResourceName: null,
      largestResourceTokens: 0,
      largestPromptName: null,
      largestPromptTokens: 0,
    },
    tools,
  );
  repo.addEvent(running.id, "info", "Scan completed");

  const detail = repo.getDetail(running.id);
  assert.equal(detail.status, "success");
  assert.equal(detail.totalTools, 2);
  assert.equal(detail.totalTokens, 200);
  assert.equal(detail.largestToolName, "alpha");
  assert.equal(detail.errorMessage, undefined);
  assert.equal(detail.tools.length, 2);
  // getDetail orders tools by total_tokens DESC.
  assert.deepEqual(
    detail.tools.map((t) => t.toolName),
    ["alpha", "beta"],
  );
  assert.equal(detail.events.length, 2);
});

test("failure path: failScan marks failed and records the error message", () => {
  const db = createDatabase();
  seedServer(db);
  const repo = new ScanRepository(db);

  const running = repo.createRunningScan("server-1", "generic_o200k");
  repo.failScan(running.id, "Connection refused");

  const summary = repo.getSummary(running.id);
  assert.equal(summary.status, "failed");
  assert.equal(summary.errorMessage, "Connection refused");
});

// NOTE: the full delete-cascade to child tool/resource/prompt/event rows is already locked by
// migrations.test.ts ("ScanRepository.delete removes a scan and cascades to its child … rows") and
// pruneServerScans there — not duplicated here. This is only the 404 sanity for an unknown id.
test("deleting a non-existent scan 404s", () => {
  const db = createDatabase();
  seedServer(db);
  const repo = new ScanRepository(db);
  assert.throws(() => repo.delete("nope"), /Scan not found/);
});

function toolInsert(name: string, totalTokens: number, schemaTokens: number): ToolScanInsert {
  return {
    toolName: name,
    description: `desc for ${name}`,
    inputSchema: { type: "object" },
    annotations: undefined,
    rawTool: { name },
    totalTokens,
    nameTokens: 3,
    descriptionTokens: 8,
    schemaTokens,
    annotationsTokens: 0,
    rawBytes: 42,
    contributionPercent: 0,
  };
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
      'server-1', 'MCP', 'stdio', 'run', '[]', NULL, '{}', '{}',
      'none', NULL, '2026-06-19T12:00:00.000Z', '2026-06-19T12:00:00.000Z'
    )`,
  ).run();
}
