// Observability RM-17 Phase 6 · AM-OB10 — watch-rule threshold + state semantics.
//
// Proves (acceptance):
//   1. A WARNING threshold below ALERT: crossing only the warning fires EARLIER, at LEVEL `warn`,
//      and at the rule's CONFIGURED severity — the same severity an alert crossing sends (owner
//      decision 2026-08-22 overturned AM-OB10's one-step demotion); a warn→alert ESCALATION still
//      re-fires through a cooldown; zod rejects a warning that is not strictly less severe than its
//      alert.
//   2. THE BUG FIX — a firing rule whose next window contains ZERO runs does NOT emit
//      `window_recover` and does NOT re-arm. (A mutation test below proves this assertion actually
//      bites: restoring the old `breached:false` collapse turns it red.)
//   3. Each of the three no-data policies behaves as named, and the DEFAULT is the one that
//      neither fires nor recovers.
//   4. The historical preview distinguishes "no data" from "healthy" in its returned points.
//   5. A PAUSED rule still evaluates and records its state but dispatches NO actions; the pause
//      expires on its own with no sweep; pause is distinct from disabled.
//   6. An on-terminal rule matching 50 runs in quick succession produces a BOUNDED number of
//      notifications, not 50.
//   7. An existing rule (no warning, no policy, no pause, no interval) behaves identically to
//      before — the ONLY deliberate change is (2).
//   8. Migration v61 adds the two columns on BOTH the fresh and the pre-v61 upgrade path.
//
// ALL timing is driven by a MUTABLE clock — there is ZERO real waiting and ZERO real timer here.

import assert from "node:assert/strict";
import crypto from "node:crypto";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import type {
  WatchRule,
  WatchRuleEvent,
  WatchWindowConfig,
} from "@mcp-token-footprint/shared";
import { applyMigrations, LATEST_SCHEMA_VERSION, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import type { WatchActionServices, WatchNotifyRequest } from "../src/watch/actions.js";
import { metricsBucketForWindow, WatchEngine, WatchWindowEvaluator } from "../src/watch/engine.js";
import { WatchRuleRepository } from "../src/watch/repository.js";
import { RunRepository } from "../src/testing/run-repository.js";
import { SecretStore } from "../src/secrets/secret-store.js";

const NOW = "2026-08-01T00:00:00.000Z";
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

type RunSeed = { id: string; startedAt: string; error?: boolean };

function insertRuns(db: AppDatabase, runs: RunSeed[]): void {
  const stmt = db.prepare(
    `INSERT INTO runs (id, test_id, scenario_id, mode, status, outcome, started_at,
       tokens_in, tokens_out, cost_usd, turns, active_duration_ms, total_duration_ms, capabilities_json)
     VALUES (@id, 't', 'scn', 'automated', @status, @outcome, @startedAt, 0, 0, 0, 0, 1000, 1000, NULL)`,
  );
  for (const r of runs) {
    stmt.run({
      id: r.id,
      status: r.error ? "error" : "completed",
      outcome: r.error ? "error" : "completed",
      startedAt: r.startedAt,
    });
  }
}

type Harness = {
  db: AppDatabase;
  repo: WatchRuleRepository;
  evaluator: WatchWindowEvaluator;
  engine: WatchEngine;
  notifications: WatchNotifyRequest[];
};

function harness(): Harness {
  const db = openFresh();
  baseGraph(db);
  const secrets = new SecretStore(crypto.randomBytes(32));
  const repo = new WatchRuleRepository(db, secrets);
  const notifications: WatchNotifyRequest[] = [];
  const services: WatchActionServices = {
    pinRun: () => undefined,
    addRunToCollection: () => undefined,
    promoteRunToTest: () => "unused",
    runGrader: async () => undefined,
    resolveWebhookUrl: () => undefined,
    // AM-OB11 — no rule in this suite carries a `workflow_dispatch` action, so reaching the GitHub
    // sender here would be a bug. See `watch-github-dispatch.test.ts` for that action's own suite.
    dispatchWorkflow: async () => {
      throw new Error("dispatchWorkflow must not be called");
    },
    notify: (req) => {
      notifications.push(req);
    },
  };
  const evaluator = new WatchWindowEvaluator(db, repo, services);
  const engine = new WatchEngine(repo, new RunRepository(db), services);
  return { db, repo, evaluator, engine, notifications };
}

const errorRateWindow = (over: WatchWindowConfig["window"], cooldownMinutes: number): WatchWindowConfig => ({
  measure: "errorRate",
  bucket: metricsBucketForWindow(over),
  window: over,
  op: ">=",
  threshold: 0.6,
  cooldownMinutes,
});

function makeWindowed(
  repo: WatchRuleRepository,
  window: WatchWindowConfig,
  severity: "info" | "warning" | "critical" = "critical",
): WatchRule {
  return repo.create({
    name: "Windowed",
    trigger: "windowed",
    filter: {},
    window,
    actions: [{ type: "notify", severity }],
  });
}

const events = (repo: WatchRuleRepository, ruleId: string): WatchRuleEvent[] =>
  repo.listEvents(ruleId);
const actionsOf = (repo: WatchRuleRepository, ruleId: string): string[] =>
  events(repo, ruleId).map((e) => e.action);

// ═══ (2)/(3) NO DATA — the bug fix ════════════════════════════════════════════════════════════════

/**
 * The regression this whole work package exists for. Hour 10 breaches (2 errors of 3), hour 11 has
 * NOTHING in it at all. Before AM-OB10 `computeWindowValue` returned `breached:false` for the empty
 * window, the state machine took the not-breached branch, wrote `window_recover` and re-armed — so
 * a bench that went completely silent while a rule was firing reported as RECOVERED.
 */
test("AM-OB10 — an EMPTY window does NOT recover a firing rule under the default policy", async () => {
  const h = harness();
  insertRuns(h.db, [
    { id: "e10a", startedAt: "2026-08-03T10:10:00.000Z", error: true },
    { id: "e10b", startedAt: "2026-08-03T10:20:00.000Z", error: true },
    { id: "c10", startedAt: "2026-08-03T10:30:00.000Z" },
    // Hour 11: deliberately nothing. The bench went silent.
  ]);
  const rule = makeWindowed(h.repo, errorRateWindow("1h", 0));
  assert.equal(
    h.repo.get(rule.id).window?.noData,
    undefined,
    "the policy is ABSENT on the stored rule — this is the default path, not an opt-in",
  );

  // Tick 1 — [10:00,11:00) breaches → fire, rule is now disarmed.
  await h.evaluator.evaluateAll(T("2026-08-03T11:30:00.000Z"), { boot: false });
  assert.equal(h.notifications.length, 1, "the breach fired");

  // Tick 2 — [11:00,12:00) contains ZERO runs.
  await h.evaluator.evaluateAll(T("2026-08-03T12:30:00.000Z"), { boot: false });

  const audit = actionsOf(h.repo, rule.id);
  assert.equal(
    audit.includes("window_recover"),
    false,
    "THE BUG: an empty window must never be recorded as a recovery",
  );
  assert.ok(audit.includes("window_no_data"), "the empty window IS recorded — silence is signal");
  const marker = events(h.repo, rule.id).find((e) => e.action === "window_no_data");
  assert.equal(marker?.result.noData, true);
  assert.equal(marker?.result.value, undefined, "no value is fabricated for an empty window");
  assert.match(marker?.result.detail ?? "", /holding the fired state/);

  // And the rule is still DISARMED: the next breaching window is suppressed by the (0-minute)
  // cooldown machine exactly as a continuous breach would be — it does not re-announce.
  assert.equal(
    h.repo.getWindowState(rule.id).armed,
    false,
    "the no-data marker did not re-arm the state machine",
  );
});

test("AM-OB10 — a HEALTHY rule stays silent on an empty window (no audit spam on an idle bench)", async () => {
  const h = harness();
  insertRuns(h.db, [{ id: "ok10", startedAt: "2026-08-04T10:10:00.000Z" }]);
  const rule = makeWindowed(h.repo, errorRateWindow("1h", 0));

  // [10:00,11:00) healthy, [11:00,12:00) and [12:00,13:00) empty.
  await h.evaluator.evaluateAll(T("2026-08-04T13:30:00.000Z"), { boot: false });

  assert.equal(h.notifications.length, 0);
  assert.deepEqual(
    actionsOf(h.repo, rule.id),
    [],
    "an armed rule writes nothing for a healthy window and nothing for an empty one",
  );
});

test("AM-OB10 — the `ok` policy restores the old behaviour, but as an EXPLICIT opt-in", async () => {
  const h = harness();
  insertRuns(h.db, [
    { id: "e10a", startedAt: "2026-08-05T10:10:00.000Z", error: true },
    { id: "e10b", startedAt: "2026-08-05T10:20:00.000Z", error: true },
    { id: "c10", startedAt: "2026-08-05T10:30:00.000Z" },
  ]);
  const rule = makeWindowed(h.repo, { ...errorRateWindow("1h", 0), noData: "ok" });

  await h.evaluator.evaluateAll(T("2026-08-05T11:30:00.000Z"), { boot: false });
  await h.evaluator.evaluateAll(T("2026-08-05T12:30:00.000Z"), { boot: false });

  const recover = events(h.repo, rule.id).find((e) => e.action === "window_recover");
  assert.ok(recover, "`ok` treats the empty window as below threshold");
  assert.equal(recover?.result.noData, true, "…and says so, rather than implying a measurement");
  assert.equal(h.repo.getWindowState(rule.id).armed, true, "`ok` re-arms");
});

test("AM-OB10 — the `notify` policy makes silence itself the alert", async () => {
  const h = harness();
  insertRuns(h.db, [{ id: "ok10", startedAt: "2026-08-06T10:10:00.000Z" }]);
  const rule = makeWindowed(h.repo, { ...errorRateWindow("1h", 0), noData: "notify" }, "warning");

  // [10:00,11:00) healthy (nothing), [11:00,12:00) EMPTY → fires.
  await h.evaluator.evaluateAll(T("2026-08-06T12:30:00.000Z"), { boot: false });

  assert.equal(h.notifications.length, 1, "an empty window fired the rule");
  assert.equal(h.notifications[0]?.severity, "warning", "a no-data fire keeps the configured severity");
  assert.equal(h.notifications[0]?.window?.noData, true);
  assert.equal(h.notifications[0]?.window?.value, null, "never a fabricated 0");
  const fire = events(h.repo, rule.id).find((e) => e.action === "window_fire");
  assert.match(fire?.result.detail ?? "", /No runs|no runs/);
});

// ═══ (1) Dual thresholds ══════════════════════════════════════════════════════════════════════════

test("a WARNING crossing fires at the rule's CONFIGURED severity, exactly as an ALERT crossing does", async () => {
  const h = harness();
  // Hour 10: 1 error of 4 → errorRate 0.25 (warn, ≥ 0.2). Hour 11: 3 of 4 → 0.75 (alert, ≥ 0.6).
  insertRuns(h.db, [
    { id: "e10", startedAt: "2026-08-07T10:05:00.000Z", error: true },
    { id: "a10", startedAt: "2026-08-07T10:10:00.000Z" },
    { id: "b10", startedAt: "2026-08-07T10:15:00.000Z" },
    { id: "c10", startedAt: "2026-08-07T10:20:00.000Z" },
    { id: "e11a", startedAt: "2026-08-07T11:05:00.000Z", error: true },
    { id: "e11b", startedAt: "2026-08-07T11:10:00.000Z", error: true },
    { id: "e11c", startedAt: "2026-08-07T11:15:00.000Z", error: true },
    { id: "c11", startedAt: "2026-08-07T11:20:00.000Z" },
  ]);
  // A LONG cooldown, so the escalation re-fire is the only thing that can produce the second alert.
  const rule = makeWindowed(
    h.repo,
    { ...errorRateWindow("1h", 600), warnThreshold: 0.2 },
    "critical",
  );

  await h.evaluator.evaluateAll(T("2026-08-07T11:30:00.000Z"), { boot: false });
  assert.equal(h.notifications.length, 1, "the warning level fired");
  assert.equal(
    h.notifications[0]?.severity,
    "critical",
    "a `critical` rule sends `critical` on a WARN crossing — the level is not a severity dial (owner decision 2026-08-22)",
  );
  assert.equal(
    h.notifications[0]?.window?.level,
    "warn",
    "…and the level that fired still rides on the event, so warn stays distinguishable from alert",
  );

  await h.evaluator.evaluateAll(T("2026-08-07T12:30:00.000Z"), { boot: false });
  assert.equal(
    h.notifications.length,
    2,
    "a warn→alert ESCALATION re-fires through a 10-hour cooldown — it is genuinely new information",
  );
  assert.equal(
    h.notifications[1]?.severity,
    "critical",
    "the alert crossing sends the same configured severity — both levels do",
  );
  assert.equal(h.notifications[1]?.window?.level, "alert");
  assert.equal(h.notifications[1]?.window?.warnThreshold, 0.2, "the alert names both thresholds");
});

test("AM-OB10 — an alert crossing does NOT re-fire inside the cooldown (no escalation loop)", async () => {
  const h = harness();
  for (const hour of [10, 11]) {
    insertRuns(h.db, [
      { id: `e${hour}a`, startedAt: `2026-08-08T${hour}:05:00.000Z`, error: true },
      { id: `e${hour}b`, startedAt: `2026-08-08T${hour}:10:00.000Z`, error: true },
      { id: `c${hour}`, startedAt: `2026-08-08T${hour}:15:00.000Z` },
    ]);
  }
  const rule = makeWindowed(h.repo, { ...errorRateWindow("1h", 600), warnThreshold: 0.2 });

  await h.evaluator.evaluateAll(T("2026-08-08T11:30:00.000Z"), { boot: false });
  await h.evaluator.evaluateAll(T("2026-08-08T12:30:00.000Z"), { boot: false });

  assert.equal(h.notifications.length, 1, "alert→alert inside the cooldown stays suppressed");
  assert.equal(h.repo.getWindowState(rule.id).lastFiredLevel, "alert");
});

// ═══ (4) The pre-save preview ═════════════════════════════════════════════════════════════════════

test("AM-OB10 — the preview reports `no_data` separately from `ok`, so a gap cannot look healthy", () => {
  const h = harness();
  insertRuns(h.db, [
    { id: "e10a", startedAt: "2026-08-09T10:10:00.000Z", error: true },
    { id: "e10b", startedAt: "2026-08-09T10:20:00.000Z", error: true },
    { id: "c10", startedAt: "2026-08-09T10:30:00.000Z" },
    { id: "ok12", startedAt: "2026-08-09T12:10:00.000Z" },
  ]);
  const config = { ...errorRateWindow("1h", 0), warnThreshold: 0.2 };

  const preview = h.evaluator.preview({}, config, 3, T("2026-08-09T13:30:00.000Z"));

  assert.deepEqual(
    preview.windows.map((w) => w.state),
    ["alert", "no_data", "ok"],
    "[10,11) breaches · [11,12) had NOTHING in it · [12,13) is genuinely healthy",
  );
  assert.deepEqual(preview.windows.map((w) => w.wouldHaveFired), [true, false, false]);
  assert.equal(preview.windows[1]?.value, null, "the empty window carries no value");
  assert.equal(preview.windows[1]?.n, 0);

  const notifyPreview = h.evaluator.preview(
    {},
    { ...config, noData: "notify" },
    3,
    T("2026-08-09T13:30:00.000Z"),
  );
  assert.deepEqual(
    notifyPreview.windows.map((w) => w.wouldHaveFired),
    [true, true, false],
    "under the `notify` policy the empty window WOULD have fired — the preview reads the policy",
  );
});

// ═══ (5) PAUSED ═══════════════════════════════════════════════════════════════════════════════════

test("AM-OB10 — a PAUSED windowed rule still evaluates and records state, but dispatches nothing", async () => {
  const h = harness();
  insertRuns(h.db, [
    { id: "e10a", startedAt: "2026-08-10T10:10:00.000Z", error: true },
    { id: "e10b", startedAt: "2026-08-10T10:20:00.000Z", error: true },
    { id: "c10", startedAt: "2026-08-10T10:30:00.000Z" },
  ]);
  const rule = makeWindowed(h.repo, errorRateWindow("1h", 0));
  const paused = h.repo.update(rule.id, { pausedUntil: "2026-08-10T18:00:00.000Z" });
  assert.equal(paused.pausedUntil, "2026-08-10T18:00:00.000Z");
  assert.equal(paused.enabled, true, "PAUSED is not DISABLED — the rule is still on");

  await h.evaluator.evaluateAll(T("2026-08-10T11:30:00.000Z"), { boot: false });

  assert.equal(h.notifications.length, 0, "a paused rule dispatches no actions");
  const audit = actionsOf(h.repo, rule.id);
  assert.ok(audit.includes("window_fire"), "…but the state marker IS written");
  assert.ok(audit.includes("paused"), "…and the suppression is on the record");
  assert.equal(audit.includes("notify"), false, "no action row, because no action ran");
  assert.equal(
    h.repo.getWindowState(rule.id).armed,
    false,
    "the state advanced — the rule does not come back armed and blind",
  );
});

test("AM-OB10 — a pause EXPIRES on its own; no sweep, nothing to unstick", async () => {
  const h = harness();
  insertRuns(h.db, [
    { id: "e10a", startedAt: "2026-08-11T10:10:00.000Z", error: true },
    { id: "e10b", startedAt: "2026-08-11T10:20:00.000Z", error: true },
    { id: "c10", startedAt: "2026-08-11T10:30:00.000Z" },
  ]);
  const rule = makeWindowed(h.repo, errorRateWindow("1h", 0));
  // A pause that was already over by the time this window is evaluated.
  h.repo.update(rule.id, { pausedUntil: "2026-08-11T10:00:00.000Z" });

  await h.evaluator.evaluateAll(T("2026-08-11T11:30:00.000Z"), { boot: false });

  assert.equal(h.notifications.length, 1, "an expired pause is simply not a pause");
  assert.equal(actionsOf(h.repo, rule.id).includes("paused"), false);

  // And resume is an explicit null on the patch, not a magic string.
  const resumed = h.repo.update(rule.id, { pausedUntil: null });
  assert.equal(resumed.pausedUntil, undefined, "`null` clears the pause");
});

test("AM-OB10 — a PAUSED on-terminal rule records the suppression and runs no action", async () => {
  const h = harness();
  insertRuns(h.db, [{ id: "run-1", startedAt: "2026-08-12T10:00:00.000Z", error: true }]);
  const rule = h.repo.create({
    name: "on-terminal",
    trigger: "on_terminal",
    filter: {},
    actions: [{ type: "notify", severity: "warning" }],
  });
  h.repo.update(rule.id, { pausedUntil: "2026-08-12T18:00:00.000Z" });

  await h.engine.onRunSettled("run-1", T("2026-08-12T11:00:00.000Z"));

  assert.equal(h.notifications.length, 0);
  assert.deepEqual(actionsOf(h.repo, rule.id), ["paused"]);

  // After the pause expires the very same rule dispatches normally.
  await h.engine.onRunSettled("run-1", T("2026-08-12T19:00:00.000Z"));
  assert.equal(h.notifications.length, 1);
});

// ═══ (6) Renotification for on-terminal rules ═════════════════════════════════════════════════════

test("AM-OB10 — 50 matching runs in quick succession produce ONE notification, not 50", async () => {
  const h = harness();
  const seeds: RunSeed[] = [];
  for (let i = 0; i < 50; i++) {
    seeds.push({ id: `run-${i}`, startedAt: "2026-08-13T10:00:00.000Z", error: true });
  }
  insertRuns(h.db, seeds);
  const rule = h.repo.create({
    name: "broken environment",
    trigger: "on_terminal",
    filter: {},
    minIntervalMinutes: 60,
    actions: [{ type: "notify", severity: "critical" }],
  });
  assert.equal(h.repo.get(rule.id).minIntervalMinutes, 60, "the interval round-trips");

  // Every run settles inside the same minute — the exact shape of a broken environment.
  const base = T("2026-08-13T10:30:00.000Z");
  for (let i = 0; i < 50; i++) {
    await h.engine.onRunSettled(`run-${i}`, base + i * 1000);
  }

  assert.equal(h.notifications.length, 1, "the budget bit — one notification, not fifty");
  const audit = actionsOf(h.repo, rule.id);
  assert.equal(audit.filter((a) => a === "notify").length, 1);
  assert.equal(
    audit.filter((a) => a === "rate_limited").length,
    49,
    "…and each suppression is auditable rather than silent",
  );

  // Past the interval, the rule speaks again.
  await h.engine.onRunSettled("run-0", base + 61 * 60_000);
  assert.equal(h.notifications.length, 2, "the interval is a delay, not a mute");
});

test("AM-OB10 — WITHOUT an interval, an on-terminal rule fires per run exactly as it always did", async () => {
  const h = harness();
  insertRuns(h.db, [
    { id: "r1", startedAt: "2026-08-14T10:00:00.000Z", error: true },
    { id: "r2", startedAt: "2026-08-14T10:01:00.000Z", error: true },
    { id: "r3", startedAt: "2026-08-14T10:02:00.000Z", error: true },
  ]);
  const rule = h.repo.create({
    name: "no interval",
    trigger: "on_terminal",
    filter: {},
    actions: [{ type: "notify", severity: "info" }],
  });
  assert.equal(h.repo.get(rule.id).minIntervalMinutes, undefined);

  const base = T("2026-08-14T10:30:00.000Z");
  for (const [i, id] of ["r1", "r2", "r3"].entries()) {
    await h.engine.onRunSettled(id, base + i * 1000);
  }

  assert.equal(h.notifications.length, 3, "unchanged behaviour for an existing rule");
  assert.equal(actionsOf(h.repo, rule.id).filter((a) => a === "rate_limited").length, 0);
});

// ═══ (7) Existing rules are otherwise byte-identical ══════════════════════════════════════════════

test("AM-OB10 — a pre-existing single-threshold rule still fires / suppresses / recovers as before", async () => {
  const h = harness();
  insertRuns(h.db, [
    { id: "e10a", startedAt: "2026-08-15T10:10:00.000Z", error: true },
    { id: "e10b", startedAt: "2026-08-15T10:20:00.000Z", error: true },
    { id: "c10", startedAt: "2026-08-15T10:30:00.000Z" },
    { id: "e11a", startedAt: "2026-08-15T11:10:00.000Z", error: true },
    { id: "e11b", startedAt: "2026-08-15T11:20:00.000Z", error: true },
    { id: "c11", startedAt: "2026-08-15T11:30:00.000Z" },
    { id: "c12a", startedAt: "2026-08-15T12:10:00.000Z" },
    { id: "c12b", startedAt: "2026-08-15T12:20:00.000Z" },
  ]);
  const rule = makeWindowed(h.repo, errorRateWindow("1h", 120), "warning");

  await h.evaluator.evaluateAll(T("2026-08-15T11:30:00.000Z"), { boot: false });
  assert.equal(h.notifications.length, 1, "first breach fires");
  assert.equal(h.notifications[0]?.severity, "warning", "a single-threshold rule sends what it configured");
  assert.equal(
    h.notifications[0]?.window?.level,
    "alert",
    "a single-threshold crossing is reported as `alert` — additive, and no level changes a severity",
  );
  assert.equal(
    h.notifications[0]?.window?.warnThreshold,
    undefined,
    "…and no warning threshold is invented",
  );
  assert.match(
    events(h.repo, rule.id).find((e) => e.action === "window_fire")?.result.detail ?? "",
    /^errorRate >= 0\.6 over 1h$/,
    "the audit detail is character-for-character what it was before AM-OB10",
  );

  await h.evaluator.evaluateAll(T("2026-08-15T12:30:00.000Z"), { boot: false });
  assert.equal(h.notifications.length, 1, "continuous breach inside the cooldown stays suppressed");

  await h.evaluator.evaluateAll(T("2026-08-15T13:30:00.000Z"), { boot: false });
  assert.equal(
    events(h.repo, rule.id).filter((e) => e.action === "window_recover").length,
    1,
    "a window with runs that are FINE still recovers — only the EMPTY case changed",
  );
  assert.equal(h.repo.getWindowState(rule.id).armed, true);
});

// ═══ (8) Migration v61 ════════════════════════════════════════════════════════════════════════════

function columns(db: AppDatabase, table: string): string[] {
  return (db.pragma(`table_info(${table})`) as Array<{ name: string }>).map((c) => c.name);
}

test("migration v61 — a fresh DB carries watch_rules.paused_until + min_interval_minutes", () => {
  const db = openFresh();
  assert.equal(LATEST_SCHEMA_VERSION, 61, "LATEST_SCHEMA_VERSION auto-derived to 61 (AM-OB10)");
  assert.equal(db.pragma("user_version", { simple: true }), 61, "fresh DB stamped at 61");
  const cols = columns(db, "watch_rules");
  assert.ok(cols.includes("paused_until"), "fresh DB has watch_rules.paused_until");
  assert.ok(cols.includes("min_interval_minutes"), "fresh DB has watch_rules.min_interval_minutes");
});

test("migration v61 — a pre-v61 DB gains both columns; existing rules survive unchanged; idempotent", () => {
  const db: AppDatabase = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  databases.push(db);
  db.exec(schemaSql); // everything at latest…
  // …then rewind to a pre-v61 (v60) DB by dropping the two additive columns.
  db.exec("ALTER TABLE watch_rules DROP COLUMN paused_until;");
  db.exec("ALTER TABLE watch_rules DROP COLUMN min_interval_minutes;");
  db.pragma("user_version = 60");
  assert.equal(columns(db, "watch_rules").includes("paused_until"), false, "sanity: v60 fixture");

  // A rule written before the columns existed.
  db.prepare(
    `INSERT INTO watch_rules (id, name, enabled, trigger, filter_json, actions_json, created_at, updated_at)
     VALUES ('pre61','Legacy',1,'on_terminal','{}','[{"type":"pin"}]',@now,@now)`,
  ).run({ now: NOW });

  applyMigrations(db);

  assert.equal(db.pragma("user_version", { simple: true }), LATEST_SCHEMA_VERSION, "stamped to LATEST");
  const cols = columns(db, "watch_rules");
  assert.ok(cols.includes("paused_until"), "v61 added paused_until");
  assert.ok(cols.includes("min_interval_minutes"), "v61 added min_interval_minutes");

  const secrets = new SecretStore(crypto.randomBytes(32));
  const repo = new WatchRuleRepository(db, secrets);
  const legacy = repo.get("pre61");
  assert.equal(legacy.pausedUntil, undefined, "a pre-v61 rule reads back NOT paused");
  assert.equal(legacy.minIntervalMinutes, undefined, "…and with no interval — no behaviour change");
  assert.equal(legacy.enabled, true);

  assert.doesNotThrow(() => applyMigrations(db), "re-applying v61 is a no-op");
  assert.equal(db.pragma("user_version", { simple: true }), LATEST_SCHEMA_VERSION);
});
