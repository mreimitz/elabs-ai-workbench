// Observability WP4.2 — windowed watch rules: trailing-window thresholds + boot catch-up + preview.
//
// Proves (acceptance):
//   1. A windowed rule FIRES on a seeded breach and NOT on a non-breach; cooldown SUPPRESSES re-fires
//      while continuously breached; a recovery (non-breach) window RE-ARMS (the next breach fires).
//   2. BOOT CATCH-UP: a simulated downtime (a stale `last_evaluated_at`) evaluates the missed windows,
//      flags those notifications `late: true`, and records a `window_catchup` audit row (the gap is
//      visible — never fabricated continuity).
//   3. PREVIEW returns correct per-window values + `wouldHaveFired` flags, and each value MATCHES the
//      WP1.2 metrics service EXACTLY (same `computeRunMetrics` call — the derived-once invariant).
//   4. The ticker STARTS/STOPS cleanly with an INJECTED timer seam — one interval set on start, one
//      cleared on stop, double-start a no-op; ZERO real timers (fake seam only → nothing leaks).
//   5. Migration v39 adds `watch_rules.last_evaluated_at` on BOTH the fresh + the pre-v39 upgrade path.
//
// ALL timing is driven by a MUTABLE clock + a FAKE interval seam + direct `tick()`/`runBootCatchUp()`
// calls — there is ZERO real waiting and ZERO real timer anywhere in this file.

import assert from "node:assert/strict";
import crypto from "node:crypto";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import type {
  RunMetricsMeasure,
  WatchRule,
  WatchRuleEvent,
  WatchWindowConfig,
} from "@mcp-token-footprint/shared";
import { applyMigrations, LATEST_SCHEMA_VERSION, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { computeRunMetrics } from "../src/observability/metrics.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import type { WatchActionServices, WatchNotifyRequest } from "../src/watch/actions.js";
import {
  enumerateWindowEnds,
  floorToWindowGrid,
  metricsBucketForWindow,
  WatchWindowEvaluator,
} from "../src/watch/engine.js";
import { WatchRuleRepository } from "../src/watch/repository.js";
import { WatchScheduler } from "../src/watch/scheduler.js";

const NOW = "2026-06-01T00:00:00.000Z";
const T = (iso: string): number => Date.parse(iso);

const databases: AppDatabase[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function openFresh(): AppDatabase {
  const db: AppDatabase = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  databases.push(db);
  return db;
}

function columns(db: AppDatabase, table: string): string[] {
  return (db.pragma(`table_info(${table})`) as Array<{ name: string }>).map((c) => c.name);
}

// ── Fixture graph (a single provider/scenario/test so the metrics service resolves scenarioMeta) ──
function baseGraph(db: AppDatabase): void {
  db.prepare(
    "INSERT INTO provider_credentials (id, kind, label, created_at, updated_at) VALUES ('prov','anthropic','Claude',@now,@now)",
  ).run({ now: NOW });
  db.prepare(
    "INSERT INTO scenarios (id, name, provider_id, model, created_at, updated_at) VALUES ('scn','S','prov','claude-sonnet-4',@now,@now)",
  ).run({ now: NOW });
  db.prepare(
    "INSERT INTO tests (id, name, user_prompt, created_at, updated_at) VALUES ('t','T','go',@now,@now)",
  ).run({ now: NOW });
}

type RunSeed = { id: string; startedAt: string; error?: boolean; costUsd?: number };

function insertRuns(db: AppDatabase, runs: RunSeed[]): void {
  const stmt = db.prepare(
    `INSERT INTO runs (id, test_id, scenario_id, mode, status, outcome, started_at,
       tokens_in, tokens_out, cost_usd, turns, active_duration_ms, total_duration_ms, capabilities_json)
     VALUES (@id, 't', 'scn', 'automated', @status, @outcome, @startedAt, 0, 0, @cost, 0, 1000, 1000, NULL)`,
  );
  for (const r of runs) {
    stmt.run({
      id: r.id,
      status: r.error ? "error" : "completed",
      outcome: r.error ? "error" : "completed",
      startedAt: r.startedAt,
      cost: r.costUsd ?? 0,
    });
  }
}

// ── The action-services stub: captures notifications + webhook POSTs; no run-scoped side effects. ──
type Harness = {
  db: AppDatabase;
  repo: WatchRuleRepository;
  evaluator: WatchWindowEvaluator;
  notifications: WatchNotifyRequest[];
  webhookBodies: unknown[];
  webhookUrls: Map<string, string>;
};

function harness(): Harness {
  const db = openFresh();
  baseGraph(db);
  const secrets = new SecretStore(crypto.randomBytes(32));
  const repo = new WatchRuleRepository(db, secrets);
  const notifications: WatchNotifyRequest[] = [];
  const webhookBodies: unknown[] = [];
  const webhookUrls = new Map<string, string>();
  const services: WatchActionServices = {
    pinRun: () => {
      throw new Error("pinRun must not be called for a windowed rule");
    },
    addRunToCollection: () => {
      throw new Error("addRunToCollection must not be called for a windowed rule");
    },
    promoteRunToTest: () => "unused",
    runGrader: async () => undefined,
    resolveWebhookUrl: (ref) => webhookUrls.get(ref),
    notify: (req) => {
      notifications.push(req);
    },
    fetchImpl: (async (_url: string | URL, init?: RequestInit) => {
      webhookBodies.push(JSON.parse(String(init?.body ?? "null")));
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch,
  };
  const evaluator = new WatchWindowEvaluator(db, repo, services);
  return { db, repo, evaluator, notifications, webhookBodies, webhookUrls };
}

/** A scheduler over a MUTABLE clock + FAKE interval seam (records set/clear; never a real timer). */
function fakeScheduler(evaluator: WatchWindowEvaluator, clock: { ms: number }) {
  const setCalls: number[] = [];
  const clearCalls: unknown[] = [];
  let captured: (() => void) | null = null;
  const scheduler = new WatchScheduler({
    evaluator,
    now: () => clock.ms,
    intervalMs: 300_000,
    setIntervalImpl: (cb, ms) => {
      setCalls.push(ms);
      captured = cb;
      return { token: setCalls.length };
    },
    clearIntervalImpl: (handle) => {
      clearCalls.push(handle);
    },
  });
  return { scheduler, setCalls, clearCalls, fireInterval: () => captured?.() };
}

const errorRateWindow = (over: WatchWindowConfig["window"], cooldownMinutes: number): WatchWindowConfig => ({
  measure: "errorRate",
  bucket: metricsBucketForWindow(over),
  window: over,
  op: ">=",
  threshold: 0.6,
  cooldownMinutes,
});

function makeWindowedRule(repo: WatchRuleRepository, window: WatchWindowConfig, actions = [{ type: "notify" as const, severity: "warning" as const }]): WatchRule {
  return repo.create({ name: "Windowed", trigger: "windowed", filter: {}, window, actions });
}

function events(repo: WatchRuleRepository, ruleId: string): WatchRuleEvent[] {
  return repo.listEvents(ruleId);
}

// ═══ (1) fire / non-fire / cooldown-suppress / recovery-re-arm ════════════════════════════════════

test("windowed rule: fires on breach, suppresses within cooldown, re-arms on recovery", async () => {
  const h = harness();
  // Hour 10 & 11 breach (errorRate 2/3 ≥ 0.6); hour 12 recovers (0/2); hour 13 breaches again.
  insertRuns(h.db, [
    { id: "e10a", startedAt: "2026-07-01T10:10:00.000Z", error: true },
    { id: "e10b", startedAt: "2026-07-01T10:20:00.000Z", error: true },
    { id: "c10", startedAt: "2026-07-01T10:30:00.000Z" },
    { id: "e11a", startedAt: "2026-07-01T11:10:00.000Z", error: true },
    { id: "e11b", startedAt: "2026-07-01T11:20:00.000Z", error: true },
    { id: "c11", startedAt: "2026-07-01T11:30:00.000Z" },
    { id: "c12a", startedAt: "2026-07-01T12:10:00.000Z" },
    { id: "c12b", startedAt: "2026-07-01T12:20:00.000Z" },
    { id: "e13a", startedAt: "2026-07-01T13:10:00.000Z", error: true },
    { id: "e13b", startedAt: "2026-07-01T13:20:00.000Z", error: true },
    { id: "c13", startedAt: "2026-07-01T13:30:00.000Z" },
  ]);
  const rule = makeWindowedRule(h.repo, errorRateWindow("1h", 120)); // 2h cooldown
  const clock = { ms: T("2026-07-01T11:30:00.000Z") };
  const { scheduler } = fakeScheduler(h.evaluator, clock);

  // Tick 1 — window [10:00,11:00) breaches → FIRE (armed on first sight), not late.
  await scheduler.tick();
  assert.equal(h.notifications.length, 1, "first breach fires");
  const first = h.notifications[0]?.window;
  assert.equal(first?.windowStart, "2026-07-01T10:00:00.000Z");
  assert.equal(first?.windowEnd, "2026-07-01T11:00:00.000Z");
  assert.equal(first?.late, false, "a live tick is not late");
  assert.ok((first?.value ?? 0) >= 0.6, "the fired value is at/above threshold");

  // Tick 2 — window [11:00,12:00) still breaches, but within the 2h cooldown → SUPPRESSED.
  clock.ms = T("2026-07-01T12:30:00.000Z");
  await scheduler.tick();
  assert.equal(h.notifications.length, 1, "a continuous breach within cooldown does not re-fire");

  // Tick 3 — window [12:00,13:00) does NOT breach → recovery re-arms; still no fire.
  clock.ms = T("2026-07-01T13:30:00.000Z");
  await scheduler.tick();
  assert.equal(h.notifications.length, 1, "a non-breach window never fires");
  assert.ok(
    events(h.repo, rule.id).some((e) => e.action === "window_recover"),
    "the recovery is audited (re-arm)",
  );

  // Tick 4 — window [13:00,14:00) breaches; recovery re-armed → FIRE immediately (ignores cooldown).
  clock.ms = T("2026-07-01T14:30:00.000Z");
  await scheduler.tick();
  assert.equal(h.notifications.length, 2, "recovery re-armed the rule → the next breach fires");
  assert.equal(h.notifications[1]?.window?.windowStart, "2026-07-01T13:00:00.000Z");
});

test("windowed rule: an op '<=' meanScore-style floor + a non-breach both behave", async () => {
  // Cost floor the other direction: 'costUsd' <= 0.10 over 1h. A cheap hour breaches; an expensive one
  // does not. (Uses the same single-bucket delegation; op '<=' takes the MIN across classes.)
  const h = harness();
  insertRuns(h.db, [
    { id: "cheap", startedAt: "2026-07-02T09:10:00.000Z", costUsd: 0.05 },
    { id: "pricey", startedAt: "2026-07-02T10:10:00.000Z", costUsd: 5 },
  ]);
  const cfg: WatchWindowConfig = {
    measure: "costUsd",
    bucket: "day",
    window: "1h",
    op: "<=",
    threshold: 0.1,
    cooldownMinutes: 0,
  };
  const rule = makeWindowedRule(h.repo, cfg);
  const clock = { ms: T("2026-07-02T10:30:00.000Z") }; // [09:00,10:00) is now complete
  const { scheduler } = fakeScheduler(h.evaluator, clock);

  await scheduler.tick(); // [09:00,10:00) cost 0.05 ≤ 0.10 → breach
  assert.equal(h.notifications.length, 1, "the cheap hour breaches the '<=' floor");

  clock.ms = T("2026-07-02T11:30:00.000Z"); // [10:00,11:00) is now complete
  await scheduler.tick(); // [10:00,11:00) cost 5 not ≤ 0.10 → no breach; but recovery re-arms
  assert.equal(h.notifications.length, 1, "the expensive hour does not breach the '<=' floor");
  assert.ok(events(h.repo, rule.id).some((e) => e.action === "window_recover"));
});

// ═══ (2) boot catch-up + late flag + gap ══════════════════════════════════════════════════════════

test("boot catch-up: evaluates missed windows, flags them late, records the gap in the audit", async () => {
  const h = harness();
  // Four consecutive breaching hours (10..13).
  for (const hour of [10, 11, 12, 13]) {
    insertRuns(h.db, [
      { id: `e${hour}a`, startedAt: `2026-07-03T${hour}:10:00.000Z`, error: true },
      { id: `e${hour}b`, startedAt: `2026-07-03T${hour}:20:00.000Z`, error: true },
      { id: `c${hour}`, startedAt: `2026-07-03T${hour}:30:00.000Z` },
    ]);
  }
  const rule = makeWindowedRule(h.repo, errorRateWindow("1h", 0)); // cooldown 0 → every breach fires
  // Simulate downtime: the rule was last evaluated at the 09:00→10:00 window boundary (10:00), then the
  // app was away. On boot at 14:30, windows 11:00/12:00/13:00/14:00 completed while away.
  h.repo.setLastEvaluatedAt(rule.id, "2026-07-03T10:00:00.000Z");
  const clock = { ms: T("2026-07-03T14:30:00.000Z") };
  const { scheduler } = fakeScheduler(h.evaluator, clock);

  await scheduler.runBootCatchUp();

  assert.equal(h.notifications.length, 4, "all four missed breaching windows fired");
  assert.ok(
    h.notifications.every((n) => n.window?.late === true),
    "every boot-catch-up notification is flagged late (while you were away)",
  );
  assert.deepEqual(
    h.notifications.map((n) => n.window?.windowEnd),
    [
      "2026-07-03T11:00:00.000Z",
      "2026-07-03T12:00:00.000Z",
      "2026-07-03T13:00:00.000Z",
      "2026-07-03T14:00:00.000Z",
    ],
    "the missed windows are evaluated in chronological order",
  );
  const catchup = events(h.repo, rule.id).find((e) => e.action === "window_catchup");
  assert.ok(catchup, "a window_catchup summary makes the away period visible in the audit");
  assert.match(catchup?.result.detail ?? "", /boot catch-up: evaluated 4 window\(s\)/);
  assert.match(catchup?.result.detail ?? "", /all late/);
  // The baseline advanced to the latest completed window end (no re-scan next boot).
  assert.equal(h.repo.get(rule.id).lastEvaluatedAt, "2026-07-03T14:00:00.000Z");
});

test("first-ever evaluation (no baseline) scores only the most recent window and is NOT late", async () => {
  const h = harness();
  insertRuns(h.db, [
    { id: "eA", startedAt: "2026-07-04T08:10:00.000Z", error: true },
    { id: "eB", startedAt: "2026-07-04T08:20:00.000Z", error: true },
    { id: "cC", startedAt: "2026-07-04T08:30:00.000Z" },
  ]);
  const rule = makeWindowedRule(h.repo, errorRateWindow("1h", 0));
  const clock = { ms: T("2026-07-04T09:30:00.000Z") };
  const { scheduler } = fakeScheduler(h.evaluator, clock);

  await scheduler.runBootCatchUp(); // boot, but no prior baseline → no away period
  assert.equal(h.notifications.length, 1, "only the single most recent completed window is scored");
  assert.equal(h.notifications[0]?.window?.late, false, "first sight is not late (never away before)");
  assert.equal(
    events(h.repo, rule.id).some((e) => e.action === "window_catchup"),
    false,
    "no catch-up summary on a first-ever evaluation",
  );
});

// ═══ (3) preview matches the WP1.2 metrics service EXACTLY (derived-once delegation) ═══════════════

test("preview: per-window values + fired flags, MATCHING computeRunMetrics exactly", async () => {
  const h = harness();
  // Vary the error rate across three hours: 12:00 → 2/3, 13:00 → 0, 14:00 → 1/1.
  insertRuns(h.db, [
    { id: "p12a", startedAt: "2026-07-05T12:05:00.000Z", error: true },
    { id: "p12b", startedAt: "2026-07-05T12:15:00.000Z", error: true },
    { id: "p12c", startedAt: "2026-07-05T12:25:00.000Z" },
    { id: "p13a", startedAt: "2026-07-05T13:05:00.000Z" },
    { id: "p14a", startedAt: "2026-07-05T14:05:00.000Z", error: true },
  ]);
  const cfg = errorRateWindow("1h", 0); // threshold 0.6, op '>='
  const nowMs = T("2026-07-05T15:30:00.000Z"); // completed windows through 15:00
  const preview = h.evaluator.preview({}, cfg, 4, nowMs);

  assert.equal(preview.bucket, "hour");
  assert.equal(preview.windows.length, 4);
  const byEnd = new Map(preview.windows.map((w) => [w.windowEnd, w]));

  // 12:00→13:00 window: errorRate 2/3, would fire (≥ 0.6).
  const w12 = byEnd.get("2026-07-05T13:00:00.000Z");
  assert.ok(w12 && w12.value !== null && Math.abs(w12.value - 2 / 3) < 1e-12);
  assert.equal(w12?.wouldHaveFired, true);
  // 13:00→14:00 window: errorRate 0, would NOT fire.
  const w13 = byEnd.get("2026-07-05T14:00:00.000Z");
  assert.equal(w13?.value, 0);
  assert.equal(w13?.wouldHaveFired, false);
  // 14:00→15:00 window: errorRate 1, would fire.
  const w14 = byEnd.get("2026-07-05T15:00:00.000Z");
  assert.equal(w14?.value, 1);
  assert.equal(w14?.wouldHaveFired, true);
  // 15:00→... in-progress? No — the most recent COMPLETED window ends at 15:00, so the newest previewed
  // window is [14:00,15:00). The empty 11:00 window (no runs) has a null value + no fire.
  const wEmpty = byEnd.get("2026-07-05T12:00:00.000Z");
  assert.equal(wEmpty?.value, null, "an empty window has a null value (never fabricated)");
  assert.equal(wEmpty?.wouldHaveFired, false);

  // DERIVED-ONCE: the preview value for the 12:00 window is BYTE-IDENTICAL to a direct 1.2 call over
  // the same bounds/bucket (proving the same-service delegation — no second aggregation path).
  const direct = computeRunMetrics(h.db, {
    filter: {},
    from: "2026-07-05T12:00:00.000Z",
    to: "2026-07-05T12:59:59.999Z",
    bucket: "hour",
    measures: ["errorRate" as RunMetricsMeasure],
  });
  const directPoint = direct.series.find((s) => s.measure === "errorRate")?.points[0];
  assert.equal(directPoint?.value, w12?.value, "preview value === computeRunMetrics value (exactly)");
  assert.equal(directPoint?.n, w12?.n, "preview n === computeRunMetrics n (exactly)");
});

test("preview: a 'count' measure over a 24h/day window equals the 1.2 point for that day", async () => {
  const h = harness();
  insertRuns(h.db, [
    { id: "d1", startedAt: "2026-07-06T03:00:00.000Z" },
    { id: "d2", startedAt: "2026-07-06T12:00:00.000Z", error: true },
    { id: "d3", startedAt: "2026-07-06T21:00:00.000Z" },
  ]);
  const cfg: WatchWindowConfig = {
    measure: "count",
    bucket: "day",
    window: "24h",
    op: ">=",
    threshold: 3,
    cooldownMinutes: 0,
  };
  const preview = h.evaluator.preview({}, cfg, 2, T("2026-07-07T06:00:00.000Z"));
  const day = preview.windows.find((w) => w.windowStart === "2026-07-06T00:00:00.000Z");
  assert.equal(day?.value, 3, "3 runs fell in the 2026-07-06 day window");
  assert.equal(day?.wouldHaveFired, true, "count 3 ≥ threshold 3");

  const direct = computeRunMetrics(h.db, {
    filter: {},
    from: "2026-07-06T00:00:00.000Z",
    to: "2026-07-06T23:59:59.999Z",
    bucket: "day",
    measures: ["count" as RunMetricsMeasure],
  });
  assert.equal(direct.series.find((s) => s.measure === "count")?.points[0]?.value, day?.value);
});

// ═══ (4) ticker start/stop clean + zero timer leak ════════════════════════════════════════════════

test("scheduler: start schedules one interval + runs boot catch-up; stop clears it; no leak", async () => {
  const h = harness();
  insertRuns(h.db, [
    { id: "s1", startedAt: "2026-07-08T10:10:00.000Z", error: true },
    { id: "s2", startedAt: "2026-07-08T10:20:00.000Z", error: true },
    { id: "s3", startedAt: "2026-07-08T10:30:00.000Z" },
  ]);
  makeWindowedRule(h.repo, errorRateWindow("1h", 0));
  const clock = { ms: T("2026-07-08T11:30:00.000Z") };
  const { scheduler, setCalls, clearCalls, fireInterval } = fakeScheduler(h.evaluator, clock);

  await scheduler.start();
  assert.equal(setCalls.length, 1, "exactly one interval is scheduled on start");
  assert.equal(setCalls[0], 300_000, "at the injected cadence");
  assert.equal(h.notifications.length, 1, "boot catch-up ran once during start");

  // A double start is a no-op (singleton) — still one interval, no second boot pass.
  await scheduler.start();
  assert.equal(setCalls.length, 1, "double start does not schedule a second interval");
  assert.equal(h.notifications.length, 1, "double start does not re-run boot catch-up");

  // Firing the captured interval callback runs a periodic tick (no new window completed → no new fire).
  await fireInterval();
  assert.equal(h.notifications.length, 1, "a tick with no newly-completed window fires nothing");

  scheduler.stop();
  assert.equal(clearCalls.length, 1, "stop clears exactly the one scheduled interval");
  // Zero real timers were ever created (the seam is entirely fake) → nothing can leak. set === clear.
  assert.equal(setCalls.length, clearCalls.length, "every set interval is cleared (no leak)");
});

test("scheduler: run-scoped actions on a windowed rule are audited 'not applicable' (never crash)", async () => {
  const h = harness();
  insertRuns(h.db, [
    { id: "x1", startedAt: "2026-07-09T10:10:00.000Z", error: true },
    { id: "x2", startedAt: "2026-07-09T10:20:00.000Z", error: true },
    { id: "x3", startedAt: "2026-07-09T10:30:00.000Z" },
  ]);
  // pin is run-scoped — with no run it must be audited ok:false, NOT invoke services.pinRun (which throws).
  const rule = makeWindowedRule(h.repo, errorRateWindow("1h", 0), [{ type: "pin" }]);
  const clock = { ms: T("2026-07-09T11:30:00.000Z") };
  const { scheduler } = fakeScheduler(h.evaluator, clock);

  await scheduler.tick(); // must not throw despite the pinRun stub throwing
  const pinEvent = events(h.repo, rule.id).find((e) => e.action === "pin");
  assert.ok(pinEvent, "the pin action is audited");
  assert.equal(pinEvent?.result.ok, false, "a run-scoped action on a windowed rule fails cleanly");
  assert.match(pinEvent?.result.error ?? "", /not applicable to a windowed rule/);
});

test("windowed webhook fires with the window body; the secret URL never appears in the audit", async () => {
  const h = harness();
  insertRuns(h.db, [
    { id: "w1", startedAt: "2026-07-10T10:10:00.000Z", error: true },
    { id: "w2", startedAt: "2026-07-10T10:20:00.000Z", error: true },
    { id: "w3", startedAt: "2026-07-10T10:30:00.000Z" },
  ]);
  const SECRET = "https://hooks.example.test/windowed-secret-xyz";
  const rule = makeWindowedRule(h.repo, errorRateWindow("1h", 0), [
    { type: "webhook", url: SECRET },
  ]);
  // The repo minted a secretRef → register it so the stub resolver returns the URL.
  const secretRef = (h.repo.get(rule.id).actions[0] as { secretRef: string }).secretRef;
  h.webhookUrls.set(secretRef, SECRET);
  const clock = { ms: T("2026-07-10T11:30:00.000Z") };
  const { scheduler } = fakeScheduler(h.evaluator, clock);

  await scheduler.tick();
  assert.equal(h.webhookBodies.length, 1, "the webhook fired once");
  const body = h.webhookBodies[0] as { window?: { windowEnd?: string } };
  assert.equal(body.window?.windowEnd, "2026-07-10T11:00:00.000Z", "the POST carries the window view");
  const audit = events(h.repo, rule.id).find((e) => e.action === "webhook");
  assert.equal(audit?.result.ok, true);
  assert.ok(
    !JSON.stringify(events(h.repo, rule.id)).includes(SECRET),
    "the webhook URL never appears in the audit log",
  );
});

// ═══ Pure grid helpers (the single-bucket alignment the delegation relies on) ═════════════════════

test("grid helpers align each window to a single metrics bucket", () => {
  assert.equal(metricsBucketForWindow("1h"), "hour");
  assert.equal(metricsBucketForWindow("6h"), "day");
  assert.equal(metricsBucketForWindow("24h"), "day");
  assert.equal(metricsBucketForWindow("7d"), "week");

  // Hour grid.
  assert.equal(
    new Date(floorToWindowGrid(T("2026-07-01T10:37:00.000Z"), "1h")).toISOString(),
    "2026-07-01T10:00:00.000Z",
  );
  // 6h grid: 0/6/12/18 UTC — 15:xx floors to 12:00 (within one UTC day → one 'day' bucket).
  assert.equal(
    new Date(floorToWindowGrid(T("2026-07-01T15:10:00.000Z"), "6h")).toISOString(),
    "2026-07-01T12:00:00.000Z",
  );
  // Day grid.
  assert.equal(
    new Date(floorToWindowGrid(T("2026-07-01T22:00:00.000Z"), "24h")).toISOString(),
    "2026-07-01T00:00:00.000Z",
  );
  // Week grid: 2026-07-01 is a Wednesday → Monday 2026-06-29 (matches the metrics 'week' bucket start).
  assert.equal(
    new Date(floorToWindowGrid(T("2026-07-01T22:00:00.000Z"), "7d")).toISOString(),
    "2026-06-29T00:00:00.000Z",
  );

  // Enumeration: null baseline → only the most recent completed window.
  assert.deepEqual(enumerateWindowEnds(null, T("2026-07-01T11:30:00.000Z"), "1h", 168), {
    ends: [T("2026-07-01T11:00:00.000Z")],
    truncated: false,
  });
  // A stale baseline → all completed windows since, capped (truncated) with the older gap dropped.
  const enumerated = enumerateWindowEnds(
    T("2026-07-01T00:00:00.000Z"),
    T("2026-07-01T05:30:00.000Z"),
    "1h",
    3,
  );
  assert.equal(enumerated.truncated, true, "more than the cap → truncated (the gap is recorded upstream)");
  assert.deepEqual(enumerated.ends, [
    T("2026-07-01T03:00:00.000Z"),
    T("2026-07-01T04:00:00.000Z"),
    T("2026-07-01T05:00:00.000Z"),
  ]);
});

// ═══ (5) migration v39 — fresh + upgrade path ═════════════════════════════════════════════════════

test("migration v39 — a fresh DB carries watch_rules.last_evaluated_at; LATEST is 55", () => {
  const db = openFresh();
  assert.equal(
    LATEST_SCHEMA_VERSION,
    58,
    "LATEST auto-derived to 55 (v39 = watch_rules.last_evaluated_at; v40 = notifications; v41 = fleet issue aggregation; v42 = runs fork lineage; v43 = digest reports; v44 = model pricing; v45 = dashboard charts; v46 = review_rubrics; v47 = hub_* tables, Assistant Hub WP0.2; v48 = hub_session_skills, Assistant Hub WP2.4; v49 = hub_memory.scope/scope_id + hub_agents.display_name + hub_crews.color + hub_sessions.archived_at, Assistant Hub UX WP1.0s; v50 = hub_sessions.tool_scope_json, end-user UX pass; v54 = hub_missions.parent_mission_id/depth/root_mission_id, crew-nesting mission-tree lineage; v55 = hub_sessions/hub_agents.provider_credential_id, model identity D-MI1; v56 = the acme_answers provider kind removed (purge + narrowed kind CHECK, mcp_server_id + scenarios.answers_mode dropped))",
  );
  assert.equal(db.pragma("user_version", { simple: true }), 58, "fresh DB stamped at 58");
  assert.ok(
    columns(db, "watch_rules").includes("last_evaluated_at"),
    "fresh DB (schema.ts baseline) has the column",
  );
});

test("migration v39 — a pre-v39 (v38) DB gains the column; a pre-existing rule reads it NULL; idempotent", () => {
  const db: AppDatabase = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql); // everything at latest…
  db.exec("ALTER TABLE watch_rules DROP COLUMN last_evaluated_at;"); // …rewind to the v38 shape
  db.pragma("user_version = 38");
  databases.push(db);
  assert.ok(
    !columns(db, "watch_rules").includes("last_evaluated_at"),
    "sanity: the v38 fixture lacks the column",
  );

  // A rule written before the column existed.
  db.prepare(
    "INSERT INTO watch_rules (id, name, enabled, trigger, filter_json, actions_json, created_at, updated_at) VALUES ('r-pre39','R',1,'windowed','{}','[]',@now,@now)",
  ).run({ now: NOW });

  applyMigrations(db);

  assert.equal(
    db.pragma("user_version", { simple: true }),
    LATEST_SCHEMA_VERSION,
    "stamped to LATEST (58) after v39+v40+v41+v42+v43+v44+v45+v46",
  );
  assert.ok(columns(db, "watch_rules").includes("last_evaluated_at"), "v39 added the column");
  const pre = db
    .prepare("SELECT last_evaluated_at FROM watch_rules WHERE id = 'r-pre39'")
    .get() as { last_evaluated_at: string | null };
  assert.equal(pre.last_evaluated_at, null, "a pre-v39 rule reads the column back NULL (never backfilled)");

  assert.doesNotThrow(() => applyMigrations(db), "re-applying v39+v40+v41+v42+v43+v44+v45+v46 is a no-op");
  assert.equal(db.pragma("user_version", { simple: true }), 58, "version unchanged after the re-run");
});
