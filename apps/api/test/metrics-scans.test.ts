// Observability WP1.2 — GET /api/metrics/scans (per-server scan-footprint over time).
//
// Proves: per (server, profile) time series; token splits (tool/resource/prompt) from the representative
// (latest SUCCESS) scan; failureRate = failed / terminal (running excluded); Δ vs previous with the
// counting_version guard (never silently compares scans under different counting methods); a failed-only
// bucket yields null footprint; the serverId filter; empty buckets omitted; determinism.

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import type { ScanMetricsResponse, ScanMetricsSeries } from "@mcp-token-footprint/shared";
import type { AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { computeScanMetrics } from "../src/observability/metrics.js";

const databases: AppDatabase[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

const NOW = "2026-06-01T00:00:00.000Z";

function createDatabase(): AppDatabase {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  databases.push(db);
  return db;
}

type ScanSeed = {
  id: string;
  serverId: string;
  profile: string;
  scannedAt: string;
  status: "running" | "success" | "failed";
  totalTools?: number;
  totalTokens?: number;
  totalResources?: number;
  totalResourceTemplates?: number;
  totalPrompts?: number;
  totalResourceTokens?: number;
  totalPromptTokens?: number;
  countingVersion?: number;
};

function seed(db: AppDatabase, scans: ScanSeed[]): void {
  const server = db.prepare(
    "INSERT OR IGNORE INTO mcp_servers (id, name, transport, command, created_at, updated_at) VALUES (@id, @name, 'stdio', 'x', @now, @now)",
  );
  for (const id of [...new Set(scans.map((s) => s.serverId))]) {
    server.run({ id, name: `name-${id}`, now: NOW });
  }
  const stmt = db.prepare(
    `INSERT INTO mcp_scans (
       id, server_id, token_profile, scanned_at, status, total_tools, total_tokens,
       total_resources, total_resource_templates, total_prompts, total_resource_tokens,
       total_prompt_tokens, counting_version
     ) VALUES (
       @id, @serverId, @profile, @scannedAt, @status, @totalTools, @totalTokens,
       @totalResources, @totalResourceTemplates, @totalPrompts, @totalResourceTokens,
       @totalPromptTokens, @countingVersion
     )`,
  );
  for (const s of scans) {
    stmt.run({
      id: s.id,
      serverId: s.serverId,
      profile: s.profile,
      scannedAt: s.scannedAt,
      status: s.status,
      totalTools: s.totalTools ?? 0,
      totalTokens: s.totalTokens ?? 0,
      totalResources: s.totalResources ?? 0,
      totalResourceTemplates: s.totalResourceTemplates ?? 0,
      totalPrompts: s.totalPrompts ?? 0,
      totalResourceTokens: s.totalResourceTokens ?? 0,
      totalPromptTokens: s.totalPromptTokens ?? 0,
      countingVersion: s.countingVersion ?? 2,
    });
  }
}

function seriesFor(res: ScanMetricsResponse, serverId: string, profile: string): ScanMetricsSeries {
  const match = res.servers.filter((s) => s.serverId === serverId && s.tokenProfile === profile);
  assert.equal(match.length, 1, `expected one series for ${serverId}/${profile}`);
  return match[0] as ScanMetricsSeries;
}

const FIXTURE: ScanSeed[] = [
  // srv-1 / generic_o200k — three days, a mid-window failed scan, a counting_version change on day 3.
  { id: "s1", serverId: "srv-1", profile: "generic_o200k", scannedAt: "2026-07-01T10:00:00.000Z", status: "success", totalTools: 10, totalTokens: 1000, totalResources: 3, totalResourceTemplates: 1, totalPrompts: 2, totalResourceTokens: 100, totalPromptTokens: 50, countingVersion: 2 },
  { id: "s2a", serverId: "srv-1", profile: "generic_o200k", scannedAt: "2026-07-02T09:00:00.000Z", status: "failed", countingVersion: 2 },
  { id: "s2", serverId: "srv-1", profile: "generic_o200k", scannedAt: "2026-07-02T11:00:00.000Z", status: "success", totalTools: 12, totalTokens: 1300, totalResources: 3, totalResourceTemplates: 1, totalPrompts: 2, totalResourceTokens: 100, totalPromptTokens: 50, countingVersion: 2 },
  { id: "s3", serverId: "srv-1", profile: "generic_o200k", scannedAt: "2026-07-03T10:00:00.000Z", status: "success", totalTools: 20, totalTokens: 2000, totalResources: 0, totalResourceTemplates: 0, totalPrompts: 0, totalResourceTokens: 0, totalPromptTokens: 0, countingVersion: 1 },
  // srv-2 / generic_cl100k — a single scan (different profile → its own series).
  { id: "s4", serverId: "srv-2", profile: "generic_cl100k", scannedAt: "2026-07-01T10:00:00.000Z", status: "success", totalTools: 5, totalTokens: 500, countingVersion: 2 },
];

test("per (server, profile) footprint series: token splits + failureRate + Δ vs previous", () => {
  const db = createDatabase();
  seed(db, FIXTURE);
  const res = computeScanMetrics(db, { bucket: "day" });
  assert.equal(res.timezone, "UTC");

  const s = seriesFor(res, "srv-1", "generic_o200k");
  assert.equal(s.serverName, "name-srv-1");
  assert.equal(s.points.length, 3);

  const [d1, d2, d3] = s.points;
  // Day 07-01 — the first point: footprint from s1, no comparable previous.
  assert.equal(d1?.bucketStart, "2026-07-01T00:00:00.000Z");
  assert.equal(d1?.scanCount, 1);
  assert.equal(d1?.failureRate, 0);
  assert.equal(d1?.countingVersion, 2);
  assert.equal(d1?.toolTokens, 1000);
  assert.equal(d1?.resourceTokens, 100);
  assert.equal(d1?.promptTokens, 50);
  assert.equal(d1?.totalTokens, 1150); // 1000 + 100 + 50
  assert.equal(d1?.totalTools, 10);
  assert.equal(d1?.deltaTotalTokens, null);
  assert.equal(d1?.deltaComparable, false);

  // Day 07-02 — 2 scans (1 failed, 1 success); representative = the LATEST success (s2).
  assert.equal(d2?.scanCount, 2);
  assert.equal(d2?.failureRate, 0.5); // 1 failed of 2 terminal
  assert.equal(d2?.totalTokens, 1450); // 1300 + 100 + 50
  assert.equal(d2?.deltaTotalTokens, 300); // 1450 − 1150
  assert.equal(d2?.deltaComparable, true); // both counting_version 2

  // Day 07-03 — counting_version changed (2 → 1): Δ is NOT comparable (never silently compared).
  assert.equal(d3?.countingVersion, 1);
  assert.equal(d3?.totalTokens, 2000);
  assert.equal(d3?.deltaTotalTokens, null);
  assert.equal(d3?.deltaComparable, false);

  // srv-2 is its own series (different profile).
  const s2 = seriesFor(res, "srv-2", "generic_cl100k");
  assert.equal(s2.points.length, 1);
  assert.equal(s2.points[0]?.totalTokens, 500);
});

test("a bucket with only a failed scan yields null footprint + failureRate 1; running scans excluded", () => {
  const db = createDatabase();
  seed(db, [
    { id: "f1", serverId: "srv-x", profile: "generic_o200k", scannedAt: "2026-07-01T10:00:00.000Z", status: "failed" },
    { id: "f2", serverId: "srv-x", profile: "generic_o200k", scannedAt: "2026-07-01T11:00:00.000Z", status: "running" },
  ]);
  const res = computeScanMetrics(db, { bucket: "day" });
  const s = seriesFor(res, "srv-x", "generic_o200k");
  const p = s.points[0];
  assert.equal(p?.scanCount, 2); // both scans counted
  assert.equal(p?.failureRate, 1); // 1 failed of 1 TERMINAL (the running scan is not terminal)
  assert.equal(p?.totalTokens, null); // no success scan → no representative footprint
  assert.equal(p?.countingVersion, null);
  assert.equal(p?.deltaComparable, false);
});

test("serverId filter restricts to one server's series", () => {
  const db = createDatabase();
  seed(db, FIXTURE);
  const res = computeScanMetrics(db, { bucket: "day", serverId: "srv-2" });
  assert.equal(res.servers.length, 1);
  assert.equal(res.servers[0]?.serverId, "srv-2");
});

test("from/to window bounds the series (empty buckets omitted) and are echoed", () => {
  const db = createDatabase();
  seed(db, FIXTURE);
  const res = computeScanMetrics(db, {
    bucket: "day",
    from: "2026-07-02T00:00:00.000Z",
    to: "2026-07-02T23:59:59.999Z",
  });
  const s = seriesFor(res, "srv-1", "generic_o200k");
  assert.equal(s.points.length, 1);
  assert.equal(s.points[0]?.bucketStart, "2026-07-02T00:00:00.000Z");
  // First point in the window → no comparable previous inside the window.
  assert.equal(s.points[0]?.deltaComparable, false);
  assert.equal(res.from, "2026-07-02T00:00:00.000Z");
  assert.equal(res.to, "2026-07-02T23:59:59.999Z");
});

test("repeated calls are byte-identical (no cache)", () => {
  const db = createDatabase();
  seed(db, FIXTURE);
  const a = computeScanMetrics(db, { bucket: "day" });
  const b = computeScanMetrics(db, { bucket: "day" });
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});
