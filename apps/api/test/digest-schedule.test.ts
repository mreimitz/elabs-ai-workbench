// Observability WP5.5 — the digest SCHEDULE: off | daily | weekly (+hour) persistence, the scheduler
// tick (fake clock — boot catch-up + late flagging), manual on-demand generation, the WatchScheduler
// `onDigest` wiring (independently guarded alongside `onSweep`), and the digest report-family HTTP
// routes (GET/PUT schedule, POST generate, GET list/json/markdown) over a real Fastify app.
//
// Proves (acceptance):
//   2. Scheduled + manual generation both work (FAKE timers/clock); a missed digest generates LATE,
//      flagged; a manual generate is NEVER late.
//   3. The digest-ready notification carries a `linkPath` to the routed digest view.
//   4. `GET`/`POST /api/reports/digest*` follow the report family's `{json,markdown}` + list shape.

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import type { DigestGenerateResult, DigestReport, DigestSchedule } from "@mcp-token-footprint/shared";
import { type AppDatabase, applyMigrations } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { AppSettingsRepository } from "../src/grading/app-settings-repository.js";
import { GradeRepository } from "../src/grading/grade-repository.js";
import { RatingIssueRepository } from "../src/grading/issue-repository.js";
import { RunReportService } from "../src/grading/run-report.js";
import { DigestReportRepository, DigestScheduleService } from "../src/reports/digest.js";
import { registerReportRoutes } from "../src/reports/routes.js";
import { ScanRepository } from "../src/scans/repository.js";
// RM-20 WP 2.2 — `registerReportRoutes` now takes the security analyzer as its last argument, so the
// scan/server exports can carry a posture section. The digest routes under test here use neither;
// the real analyzer is wired anyway so the harness matches what the app registers.
import { analyzeScan } from "../src/security/service.js";
import { ServerRepository } from "../src/servers/repository.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { SuiteRepository } from "../src/suites/repository.js";
import { SuiteReportRepository } from "../src/suites/suite-report-repository.js";
import { SuiteRunRepository } from "../src/suites/suite-run-repository.js";
import { SuiteService } from "../src/suites/service.js";
import { ScenarioRepository } from "../src/testing/scenario-repository.js";
import { ScenarioService } from "../src/testing/scenario-service.js";
import { TestRepository } from "../src/testing/test-repository.js";
import { TestService } from "../src/testing/test-service.js";
import { RunRepository } from "../src/testing/run-repository.js";
import { toErrorMessage } from "../src/utils/errors.js";
import { WatchScheduler } from "../src/watch/scheduler.js";

const databases: AppDatabase[] = [];
const apps: FastifyInstance[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const db of databases.splice(0)) db.close();
});

function openFresh(): AppDatabase {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  databases.push(db);
  return db;
}

// ═══ (1) DigestScheduleService — fake clock, off/daily/weekly, catch-up + late, manual generate ═══

function scheduleHarness(db: AppDatabase, clock: { ms: number }) {
  const runs = new RunRepository(db);
  const issues = new RatingIssueRepository(db);
  const repository = new DigestReportRepository(db);
  const appSettings = new AppSettingsRepository(db);
  const notified: DigestReport[] = [];
  const service = new DigestScheduleService(
    { db, runs, issues },
    appSettings,
    repository,
    (report) => {
      notified.push(report);
    },
    () => clock.ms,
  );
  return { service, repository, notified };
}

test("DigestScheduleService: default schedule is off; off mode never generates on a tick", () => {
  const db = openFresh();
  const clock = { ms: Date.parse("2026-07-05T09:00:00.000Z") };
  const { service, repository, notified } = scheduleHarness(db, clock);

  assert.deepEqual(service.getSchedule(), { mode: "off", hourUtc: 8 });

  service.maybeGenerateDue(clock.ms, { boot: true });
  assert.deepEqual(repository.list(), []);
  assert.deepEqual(notified, []);
});

test("DigestScheduleService: setSchedule persists + round-trips via getSchedule", () => {
  const db = openFresh();
  const clock = { ms: Date.parse("2026-07-05T09:00:00.000Z") };
  const { service } = scheduleHarness(db, clock);

  const saved = service.setSchedule({ mode: "daily", hourUtc: 6 });
  assert.deepEqual(saved, { mode: "daily", hourUtc: 6 });
  assert.deepEqual(service.getSchedule(), { mode: "daily", hourUtc: 6 });
});

test("DigestScheduleService: a live (non-boot) tick generates the single due window, not late; notifies with a linkPath", () => {
  const db = openFresh();
  const clock = { ms: Date.parse("2026-07-05T09:00:00.000Z") }; // past the 8h trigger for 07-05
  const { service, repository, notified } = scheduleHarness(db, clock);
  service.setSchedule({ mode: "daily", hourUtc: 8 });

  service.maybeGenerateDue(clock.ms, { boot: false });

  const all = repository.list();
  assert.equal(all.length, 1);
  assert.equal(all[0]?.windowKind, "daily");
  assert.equal(all[0]?.windowFrom, "2026-07-04T00:00:00.000Z");
  assert.equal(all[0]?.windowTo, "2026-07-05T00:00:00.000Z");
  assert.equal(all[0]?.late, false, "a live tick's first-sight generation is not late");
  assert.equal(notified.length, 1);
  assert.equal(notified[0]?.id, all[0]?.id);

  // A second tick with no time elapsed is a no-op (nothing new due).
  service.maybeGenerateDue(clock.ms, { boot: false });
  assert.equal(repository.list().length, 1, "no duplicate generation");
});

test("DigestScheduleService: a BOOT tick after downtime generates the missed window(s), each flagged late", () => {
  const db = openFresh();
  const clock = { ms: Date.parse("2026-07-01T09:00:00.000Z") };
  const { service, repository, notified } = scheduleHarness(db, clock);
  service.setSchedule({ mode: "daily", hourUtc: 8 });

  // First generation — establishes the baseline (not late).
  service.maybeGenerateDue(clock.ms, { boot: true });
  assert.equal(repository.list()[0]?.late, false);

  // The app was "away" for 3 days; boot catch-up now finds 3 missed daily windows.
  clock.ms = Date.parse("2026-07-04T09:00:00.000Z");
  notified.length = 0;
  service.maybeGenerateDue(clock.ms, { boot: true });

  const all = repository.list({ kind: "daily" });
  assert.equal(all.length, 4, "1 baseline + 3 caught-up windows");
  const baseline = all.find((d) => d.windowTo === "2026-07-01T00:00:00.000Z");
  assert.ok(baseline);
  assert.equal(baseline?.late, false, "the original first-sight generation stays not-late");
  const caughtUp = all.filter((d) => d.windowTo !== "2026-07-01T00:00:00.000Z");
  assert.equal(caughtUp.length, 3);
  for (const d of caughtUp) assert.equal(d.late, true, `${d.windowTo} is a boot catch-up — flagged late`);
  assert.equal(notified.length, 3, "one notification per caught-up window");
});

test("DigestScheduleService: generateOnDemand is NEVER late and ignores the configured hour", () => {
  const db = openFresh();
  const clock = { ms: Date.parse("2026-07-05T03:00:00.000Z") }; // BEFORE the configured 8h trigger
  const { service, repository } = scheduleHarness(db, clock);
  service.setSchedule({ mode: "daily", hourUtc: 8 }); // scheduled generation would NOT be due yet

  const report = service.generateOnDemand("daily");
  assert.equal(report.late, false);
  // On-demand always takes the most recently COMPLETED calendar window regardless of the hour gate.
  assert.equal(report.windowTo, "2026-07-05T00:00:00.000Z");
  assert.equal(repository.list().length, 1);
});

test("DigestScheduleService: weekly mode generates a Monday-aligned window", () => {
  const db = openFresh();
  const clock = { ms: Date.parse("2026-07-06T09:00:00.000Z") }; // a Monday, past the 8h trigger
  const { service, repository } = scheduleHarness(db, clock);
  service.setSchedule({ mode: "weekly", hourUtc: 8 });

  service.maybeGenerateDue(clock.ms, { boot: false });

  const all = repository.list({ kind: "weekly" });
  assert.equal(all.length, 1);
  assert.equal(all[0]?.windowFrom, "2026-06-29T00:00:00.000Z"); // the prior Monday
  assert.equal(all[0]?.windowTo, "2026-07-06T00:00:00.000Z");
});

// ═══ (2) WatchScheduler wiring — onDigest rides the SAME ticker as onSweep, independently guarded ═

function fakeTicker(deps: {
  onDigest?: (nowMs: number, opts: { boot: boolean }) => void;
  onSweep?: (nowMs: number, opts: { boot: boolean }) => void;
}) {
  return new WatchScheduler({
    // A minimal stub evaluator — this test only cares about onDigest/onSweep sequencing, not the
    // windowed-rule evaluation itself (covered by watch-windowed.test.ts).
    evaluator: { evaluateAll: async () => undefined } as never,
    now: () => Date.parse("2026-07-05T09:00:00.000Z"),
    onSweep: deps.onSweep,
    onDigest: deps.onDigest,
  });
}

test("WatchScheduler: onDigest fires on tick() alongside onSweep, independently guarded (one throwing never blocks the other)", async () => {
  const digestCalls: Array<{ nowMs: number; boot: boolean }> = [];
  const sweepCalls: Array<{ nowMs: number; boot: boolean }> = [];
  const scheduler = fakeTicker({
    onDigest: (nowMs, opts) => digestCalls.push({ nowMs, boot: opts.boot }),
    onSweep: (nowMs, opts) => sweepCalls.push({ nowMs, boot: opts.boot }),
  });

  await scheduler.tick();
  assert.equal(digestCalls.length, 1);
  assert.equal(sweepCalls.length, 1);
  assert.equal(digestCalls[0]?.boot, false);
});

test("WatchScheduler: a throwing onDigest never blocks onSweep, and vice versa", async () => {
  const sweepCalls: number[] = [];
  const schedulerA = fakeTicker({
    onDigest: () => {
      throw new Error("digest boom");
    },
    onSweep: () => sweepCalls.push(1),
  });
  await schedulerA.tick();
  assert.equal(sweepCalls.length, 1, "onSweep still ran despite onDigest throwing");

  const digestCalls: number[] = [];
  const schedulerB = fakeTicker({
    onSweep: () => {
      throw new Error("sweep boom");
    },
    onDigest: () => digestCalls.push(1),
  });
  await schedulerB.tick();
  assert.equal(digestCalls.length, 1, "onDigest still ran despite onSweep throwing");
});

// ═══ (3) HTTP routes — the report family's {json,markdown} + list + schedule shape ═════════════════

async function makeReportApp(db: AppDatabase, clock: { ms: number }): Promise<{
  baseUrl: string;
  digestRepository: DigestReportRepository;
  digestSchedule: DigestScheduleService;
  notified: DigestReport[];
}> {
  const scans = new ScanRepository(db);
  const secrets = new SecretStore(Buffer.alloc(32, 9));
  const servers = new ServerRepository(db, secrets);
  const runRepository = new RunRepository(db);
  const testService = new TestService(new TestRepository(db));
  const scenarioRepository = new ScenarioRepository(db);
  const scenarioService = new ScenarioService(scenarioRepository, scans);
  const suiteRunRepository = new SuiteRunRepository(db);
  const gradeRepository = new GradeRepository(db);
  const suiteService = new SuiteService(new SuiteRepository(db));
  const runReportService = new RunReportService(gradeRepository, runRepository);
  const suiteReportRepository = new SuiteReportRepository(db);
  const issues = new RatingIssueRepository(db);
  const digestRepository = new DigestReportRepository(db);
  const notified: DigestReport[] = [];
  const digestSchedule = new DigestScheduleService(
    { db, runs: runRepository, issues },
    new AppSettingsRepository(db),
    digestRepository,
    (report) => notified.push(report),
    () => clock.ms,
  );

  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: "Validation failed", issues: error.issues });
    }
    const typed = error as Error & { statusCode?: number };
    return reply.code(typed.statusCode ?? 500).send({ error: toErrorMessage(error) });
  });
  await registerReportRoutes(
    app,
    scans,
    servers,
    runRepository,
    testService,
    scenarioService,
    suiteRunRepository,
    gradeRepository,
    suiteService,
    runReportService,
    suiteReportRepository,
    digestRepository,
    digestSchedule,
    // Advisor WP 2.2 — the fleet report's advisor read ports (unused by the digest routes under test
    // here, but `registerReportRoutes` now wires `GET /api/reports/fleet/*` from them).
    { servers, scans, scenarios: scenarioRepository, runs: runRepository },
    {
      analyze: (scanId) =>
        analyzeScan({ scans, servers, oauth: { listGrantedScopes: () => null } }, scanId),
    },
  );
  await app.listen({ port: 0, host: "127.0.0.1" });
  apps.push(app);
  const address = app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return { baseUrl: `http://127.0.0.1:${port}`, digestRepository, digestSchedule, notified };
}

test("digest report routes: schedule GET/PUT, POST generate, GET list/json/markdown — the report family shape", async () => {
  const db = openFresh();
  const clock = { ms: Date.parse("2026-07-05T09:00:00.000Z") };
  const h = await makeReportApp(db, clock);

  // Schedule defaults, then PUT persists.
  const getDefault = await fetch(`${h.baseUrl}/api/reports/digest/schedule`);
  assert.equal(getDefault.status, 200);
  assert.deepEqual((await getDefault.json()) as DigestSchedule, { mode: "off", hourUtc: 8 });

  const put = await fetch(`${h.baseUrl}/api/reports/digest/schedule`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "daily", hourUtc: 6 }),
  });
  assert.equal(put.status, 200);
  assert.deepEqual((await put.json()) as DigestSchedule, { mode: "daily", hourUtc: 6 });

  // An unknown key 400s (zod .strict()).
  const badPut = await fetch(`${h.baseUrl}/api/reports/digest/schedule`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "daily", hourUtc: 6, bogus: true }),
  });
  assert.equal(badPut.status, 400);

  // Manual generation.
  const gen = await fetch(`${h.baseUrl}/api/reports/digest/generate?window=daily`, { method: "POST" });
  assert.equal(gen.status, 200);
  const generated = (await gen.json()) as DigestGenerateResult;
  assert.equal(generated.windowKind, "daily");
  assert.equal(generated.late, false);
  assert.equal(h.notified.length, 1, "the notify sink fired");
  assert.equal(h.notified[0]?.id, generated.id);

  // GET list.
  const list = await fetch(`${h.baseUrl}/api/reports/digest?kind=daily`);
  assert.equal(list.status, 200);
  const listBody = (await list.json()) as DigestReport[];
  assert.equal(listBody.length, 1);
  assert.equal(listBody[0]?.id, generated.id);

  // GET json.
  const json = await fetch(`${h.baseUrl}/api/reports/digest/${generated.id}/json`);
  assert.equal(json.status, 200);
  const jsonBody = (await json.json()) as DigestReport;
  assert.equal(jsonBody.id, generated.id);
  assert.equal(jsonBody.headline.runs.current, 0, "honest empty — no runs seeded");

  // GET markdown — content-type + disposition mirror the run/suite-run/server report routes.
  const md = await fetch(`${h.baseUrl}/api/reports/digest/${generated.id}/markdown`);
  assert.equal(md.status, 200);
  assert.match(md.headers.get("content-type") ?? "", /text\/markdown/);
  assert.match(md.headers.get("content-disposition") ?? "", /attachment/);
  const mdText = await md.text();
  assert.match(mdText, /# Daily digest/);
  assert.match(mdText, /no runs in either window/);

  // A missing id 404s (the repository's own typed throw, formatted by the central handler).
  const missing = await fetch(`${h.baseUrl}/api/reports/digest/does-not-exist/json`);
  assert.equal(missing.status, 404);
});
