// Observability — the hand-driven send (RM-17 Phase 6, AM-OB13).
//
// Proves (acceptance):
//   1. `POST /api/runs/:id/send-to-webhook` posts a payload describing THAT run — never
//      `sampleTestFireBody`'s `"sample-run"` — and the suite-run endpoint does the same for a suite
//      run. Verified against a LOCAL receiver (acceptance #8: no test makes a real outbound request).
//   2. The payload's links are ABSOLUTE when a base URL is configured, and fall back to today's
//      relative path when it is not. Both states asserted here, end to end through the route.
//   4. The webhook URL never appears in a response, an error, or an audit row — asserted by seeding
//      a RECOGNISABLE URL and grepping every returned and persisted surface (including the whole
//      `watch_rules` / `watch_rule_events` table text, not just the shapes we happen to read).
//   5. A destination whose backing rule has been deleted reads as "that destination no longer
//      exists", not as a generic post failure — in BOTH of its forms (rule gone, secret gone).
//   6. Every send is recorded as an audit event with its outcome, on the same `GET
//      /api/watch-rules/:id/events` log a `test_fire` shows up on.

import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import {
  WATCH_MARKER_MANUAL_SEND,
  type ManualSendPayload,
  type WatchRuleEvent,
  type WatchRuleEventResult,
} from "@mcp-token-footprint/shared";
import { applyMigrations, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { SuiteRunRepository } from "../src/suites/suite-run-repository.js";
import { RunRepository } from "../src/testing/run-repository.js";
import { toErrorMessage } from "../src/utils/errors.js";
import { registerManualSendRoutes } from "../src/watch/manual-send.js";
import { WatchRuleRepository } from "../src/watch/repository.js";
import { registerWatchRoutes } from "../src/watch/routes.js";

const NOW = "2026-08-22T00:00:00.000Z";
/** Deliberately distinctive: every leak assertion below greps for THIS exact string. */
const SECRET_PATH = "/hook/s3cr3t-manual-send-token-do-not-leak";

const databases: AppDatabase[] = [];
const apps: FastifyInstance[] = [];
const servers: http.Server[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const s of servers.splice(0)) await new Promise<void>((r) => s.close(() => r()));
  for (const db of databases.splice(0)) db.close();
});

function openFresh(): AppDatabase {
  const db = new Database(":memory:") as unknown as AppDatabase;
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  databases.push(db);
  return db;
}

/** A local HTTP receiver that records every request body and replies with `status`. */
function makeReceiver(status = 204): { url: Promise<string>; received: Array<{ body: string }> } {
  const received: Array<{ body: string }> = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received.push({ body });
      res.writeHead(status);
      res.end();
    });
  });
  servers.push(server);
  const url = new Promise<string>((resolve) => {
    server.listen(0, () => {
      const port = (server.address() as { port: number }).port;
      resolve(`http://127.0.0.1:${port}${SECRET_PATH}`);
    });
  });
  return { url, received };
}

type Harness = {
  baseUrl: string;
  rules: WatchRuleRepository;
  runs: RunRepository;
  suiteRuns: SuiteRunRepository;
  db: AppDatabase;
};

async function makeApp(): Promise<Harness> {
  const db = openFresh();
  const secrets = new SecretStore(crypto.randomBytes(32));
  const rules = new WatchRuleRepository(db, secrets);
  const runs = new RunRepository(db);
  const suiteRuns = new SuiteRunRepository(db);

  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ error: "Validation failed" });
    const typed = error as Error & { statusCode?: number };
    return reply.code(typed.statusCode ?? 500).send({ error: toErrorMessage(error) });
  });
  await registerWatchRoutes(app, rules);
  await registerManualSendRoutes(app, { rules, runs, suiteRuns });
  await app.listen({ port: 0, host: "127.0.0.1" });
  apps.push(app);
  const address = app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return { baseUrl: `http://127.0.0.1:${port}`, rules, runs, suiteRuns, db };
}

/** Seed one REAL run with recognisable, non-default figures the payload must carry back. */
function seedRun(db: AppDatabase, runId: string, suiteRunId?: string): void {
  db.prepare(
    "INSERT OR IGNORE INTO provider_credentials (id, kind, label, created_at, updated_at) VALUES ('prov-1','anthropic','Claude',@now,@now)",
  ).run({ now: NOW });
  db.prepare(
    "INSERT OR IGNORE INTO scenarios (id, name, provider_id, model, created_at, updated_at) VALUES ('scn-7','Nightly','prov-1','claude-sonnet-4',@now,@now)",
  ).run({ now: NOW });
  db.prepare(
    "INSERT OR IGNORE INTO tests (id, name, user_prompt, created_at, updated_at) VALUES ('tst-7','Ledger check','Go.',@now,@now)",
  ).run({ now: NOW });
  db.prepare(
    `INSERT INTO runs (id, test_id, scenario_id, mode, status, outcome, started_at, cost_usd, tokens_in, tokens_out, suite_run_id)
       VALUES (@id,'tst-7','scn-7','automated','error','error',@now,1.25,4242,777,@suiteRunId)`,
  ).run({ id: runId, now: NOW, suiteRunId: suiteRunId ?? null });
}

function auditRows(rules: WatchRuleRepository, ruleId: string): WatchRuleEvent[] {
  return rules.listEvents(ruleId);
}

/** Every byte the two watch tables hold, as one string — the widest leak surface we can grep. */
function watchTableText(db: AppDatabase): string {
  const rules = db.prepare("SELECT * FROM watch_rules").all();
  const events = db.prepare("SELECT * FROM watch_rule_events").all();
  return JSON.stringify({ rules, events });
}

async function createRule(h: Harness, hookUrl: string, name = "ops channel"): Promise<string> {
  const rule = h.rules.create({
    name,
    trigger: "on_terminal",
    filter: {},
    actions: [{ type: "webhook", url: hookUrl }],
  });
  return rule.id;
}

// ── Acceptance #1 + #4 + #6 — a REAL run goes out, the URL does not ──────────────────────────────

test("a manual run send posts THAT run — not the test-fire sample — and audits the outcome", async () => {
  const { url, received } = makeReceiver(204);
  const h = await makeApp();
  const hookUrl = await url;
  seedRun(h.db, "run-real-1");
  const ruleId = await createRule(h, hookUrl);

  const res = await fetch(`${h.baseUrl}/api/runs/run-real-1/send-to-webhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ruleId }),
  });
  assert.equal(res.status, 200);
  const result = (await res.json()) as WatchRuleEventResult;
  assert.equal(result.ok, true);

  assert.equal(received.length, 1, "the local receiver got exactly one POST");
  const body = JSON.parse(received[0]!.body) as ManualSendPayload;

  // THE point of the WP: this is the real run, with its real figures.
  assert.equal(body.run?.id, "run-real-1");
  assert.notEqual(body.run?.id, "sample-run", "must never be the test-fire's fake row");
  assert.equal(body.run?.status, "error");
  assert.equal(body.run?.outcome, "error");
  assert.equal(body.run?.testId, "tst-7");
  assert.equal(body.run?.scenarioId, "scn-7");
  assert.equal(body.run?.costUsd, 1.25);
  assert.equal(body.run?.tokensIn, 4242);
  assert.equal(body.run?.tokensOut, 777);
  assert.equal(body.suiteRun, undefined, "a run payload carries no suiteRun");
  // A receiver must be able to tell a hand-driven send from a rule fire without shape-sniffing.
  assert.equal(body.manual, true);
  assert.ok(!("sample" in body), "a manual send is not a sample");
  // Both links, and the report link is the Markdown artifact a ticket wants.
  assert.equal(body.link, "/testing/runs/run-real-1");
  assert.equal(body.reportLink, "/api/reports/run/run-real-1/markdown");

  // Acceptance #6 — audited on the same log `test_fire` uses, with its outcome.
  const rows = auditRows(h.rules, ruleId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.action, WATCH_MARKER_MANUAL_SEND);
  assert.equal(rows[0]?.runId, "run-real-1");
  assert.equal(rows[0]?.result.ok, true);
  assert.match(String(rows[0]?.result.detail), /run run-real-1/);

  // Acceptance #4 — the URL is nowhere: not the response, not the audit, not the rule row.
  assert.ok(!JSON.stringify(result).includes(SECRET_PATH), "no URL in the response");
  assert.ok(!JSON.stringify(rows).includes(SECRET_PATH), "no URL in the audit rows");
  assert.ok(!watchTableText(h.db).includes(SECRET_PATH), "no URL anywhere in the watch tables");
});

test("a manual SUITE-run send posts that suite run, with its aggregates and both links", async () => {
  const { url, received } = makeReceiver(204);
  const h = await makeApp();
  const hookUrl = await url;
  const suiteRun = h.suiteRuns.create(
    null,
    { repetitions: 2, maxConcurrency: 1, testIds: [], scenarioIds: [] },
    "adhoc",
  );
  h.suiteRuns.finalize(suiteRun.id, "completed", {
    cellsTotal: 6,
    cellsCompleted: 6,
    meanGrade: 0.82,
    gradeStdDev: 0.1,
    passRateAt05: 1,
    totalTokens: 91_000,
    execCostUsd: 2,
    judgeCostUsd: 0.5,
  });
  const ruleId = await createRule(h, hookUrl);

  const res = await fetch(`${h.baseUrl}/api/suite-runs/${suiteRun.id}/send-to-webhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ruleId }),
  });
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as WatchRuleEventResult).ok, true);

  const body = JSON.parse(received[0]!.body) as ManualSendPayload;
  assert.equal(body.suiteRun?.id, suiteRun.id);
  assert.equal(body.run, undefined, "a suite-run payload carries no run");
  assert.equal(body.suiteRun?.status, "completed");
  assert.equal(body.suiteRun?.source, "adhoc");
  assert.equal(body.suiteRun?.cellsTotal, 6);
  assert.equal(body.suiteRun?.totalTokens, 91_000);
  assert.equal(body.suiteRun?.costUsd, 2.5, "exec + judge spend, summed");
  assert.equal(body.suiteRun?.meanGrade, 0.82);
  assert.equal(body.manual, true);
  assert.equal(body.link, `/testing/suite-runs/${suiteRun.id}`);
  assert.equal(body.reportLink, `/api/reports/suite-run/${suiteRun.id}/markdown`);

  const rows = auditRows(h.rules, ruleId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.action, WATCH_MARKER_MANUAL_SEND);
  assert.equal(rows[0]?.runId, undefined, "a suite run is not a run — the subject rides in `detail`");
  assert.match(String(rows[0]?.result.detail), new RegExp(`suite run ${suiteRun.id}`));
});

test("a suite run with NO aggregates omits its figures rather than reporting zeros", async () => {
  const { url, received } = makeReceiver(204);
  const h = await makeApp();
  const hookUrl = await url;
  // Created but never finalized: nothing has been measured yet.
  const suiteRun = h.suiteRuns.create(
    null,
    { repetitions: 1, maxConcurrency: 1, testIds: [], scenarioIds: [] },
    "adhoc",
  );
  const ruleId = await createRule(h, hookUrl);

  await fetch(`${h.baseUrl}/api/suite-runs/${suiteRun.id}/send-to-webhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ruleId }),
  });

  const body = JSON.parse(received[0]!.body) as ManualSendPayload;
  // Absent means UNKNOWN. A `costUsd: 0` here would read as "this suite run cost nothing", which is
  // a claim, not a measurement (the same rule RM-33's D-CT6 applies to the cache split).
  assert.equal(body.suiteRun?.costUsd, undefined);
  assert.equal(body.suiteRun?.totalTokens, undefined);
  assert.equal(body.suiteRun?.cellsTotal, undefined);
  assert.equal(body.suiteRun?.status, "pending");
});

// ── Acceptance #2 — absolute vs relative, end to end through the route ───────────────────────────

test("with APP_BASE_URL configured the links are absolute; without it they stay relative", async () => {
  const { url, received } = makeReceiver(204);
  const hookUrl = await url;

  // The route reads the base URL through `outboundUrl`'s default argument, i.e. `config.appBaseUrl`,
  // which is fixed at module load. Rather than reload the whole app, assert the exact function the
  // route calls, in both states — and assert the RELATIVE state through the live route below, since
  // that is the state the gate actually runs in.
  const { appPath, outboundUrl } = await import("../src/watch/outbound-link.js");
  assert.equal(
    outboundUrl(appPath.run("run-real-2"), "https://bench.example.test"),
    "https://bench.example.test/testing/runs/run-real-2",
  );
  assert.equal(
    outboundUrl(appPath.runReport("run-real-2"), "https://bench.example.test"),
    "https://bench.example.test/api/reports/run/run-real-2/markdown",
  );

  const h = await makeApp();
  seedRun(h.db, "run-real-2");
  const ruleId = await createRule(h, hookUrl);
  await fetch(`${h.baseUrl}/api/runs/run-real-2/send-to-webhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ruleId }),
  });
  const body = JSON.parse(received[0]!.body) as ManualSendPayload;
  assert.equal(body.link, "/testing/runs/run-real-2", "unset base URL => the honest relative path");
  assert.ok(!body.link.startsWith("http"), "never a fabricated origin");
  assert.ok(!body.reportLink.startsWith("http"));
});

// ── The preview endpoint — same payload, no side effect ──────────────────────────────────────────

test("the preview endpoint returns exactly what a send would post, and sends nothing", async () => {
  const { url, received } = makeReceiver(204);
  const h = await makeApp();
  const hookUrl = await url;
  seedRun(h.db, "run-real-3");
  const ruleId = await createRule(h, hookUrl);

  const preview = (await (
    await fetch(`${h.baseUrl}/api/runs/run-real-3/webhook-payload`)
  ).json()) as ManualSendPayload;
  assert.equal(received.length, 0, "a preview posts nothing");
  assert.equal(auditRows(h.rules, ruleId).length, 0, "a preview audits nothing");

  await fetch(`${h.baseUrl}/api/runs/run-real-3/send-to-webhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ruleId }),
  });
  // Byte-identical: the operator saw exactly what left.
  assert.equal(JSON.parse(received[0]!.body as string).run.id, "run-real-3");
  assert.deepEqual(JSON.parse(received[0]!.body), JSON.parse(JSON.stringify(preview)));
  // And the preview never carries a destination — there is nothing in it to leak.
  assert.ok(!JSON.stringify(preview).includes(SECRET_PATH));
});

// ── Acceptance #5 — "that destination no longer exists", in both its forms ───────────────────────

test("sending via a DELETED rule reads as a missing destination, not a post failure", async () => {
  const { url, received } = makeReceiver(204);
  const h = await makeApp();
  const hookUrl = await url;
  seedRun(h.db, "run-real-4");
  const ruleId = await createRule(h, hookUrl);
  h.rules.delete(ruleId); // cascades `watch_secrets` — the destination goes with it

  const res = await fetch(`${h.baseUrl}/api/runs/run-real-4/send-to-webhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ruleId }),
  });
  assert.equal(res.status, 404);
  const payload = (await res.json()) as { error: string };
  assert.match(payload.error, /destination no longer exists/i);
  assert.match(payload.error, /watch rule has been deleted/i, "it names the CAUSE");
  assert.ok(!/webhook request failed/i.test(payload.error), "never the generic post failure");
  assert.equal(received.length, 0, "nothing was sent anywhere");
});

test("sending via a rule whose SECRET no longer resolves says the same thing, and IS audited", async () => {
  const { url, received } = makeReceiver(204);
  const h = await makeApp();
  const hookUrl = await url;
  seedRun(h.db, "run-real-5");
  const ruleId = await createRule(h, hookUrl);
  // The rule survives; its destination is rotated out from under the send.
  h.db.prepare("DELETE FROM watch_secrets WHERE rule_id = ?").run(ruleId);

  const res = await fetch(`${h.baseUrl}/api/runs/run-real-5/send-to-webhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ruleId }),
  });
  assert.equal(res.status, 200, "a destination problem is an outcome, not a thrown error");
  const result = (await res.json()) as WatchRuleEventResult;
  assert.equal(result.ok, false);
  assert.match(String(result.error), /destination no longer exists/i);
  assert.equal(received.length, 0);

  // There IS a rule to hang the audit row off here, unlike the deleted-rule case.
  const rows = auditRows(h.rules, ruleId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.action, WATCH_MARKER_MANUAL_SEND);
  assert.equal(rows[0]?.result.ok, false);
});

test("a rule with no webhook action 400s; an unknown run 404s before any destination is touched", async () => {
  const h = await makeApp();
  seedRun(h.db, "run-real-6");
  const pinOnly = h.rules.create({
    name: "pin only",
    trigger: "on_terminal",
    filter: {},
    actions: [{ type: "pin" }],
  });

  const noWebhook = await fetch(`${h.baseUrl}/api/runs/run-real-6/send-to-webhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ruleId: pinOnly.id }),
  });
  assert.equal(noWebhook.status, 400);
  assert.match(((await noWebhook.json()) as { error: string }).error, /no webhook destination/i);

  const unknownRun = await fetch(`${h.baseUrl}/api/runs/nope/send-to-webhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ruleId: pinOnly.id }),
  });
  assert.equal(unknownRun.status, 404);
  assert.match(((await unknownRun.json()) as { error: string }).error, /run not found/i);
  assert.equal(auditRows(h.rules, pinOnly.id).length, 0, "neither refusal wrote an audit row");
});

// ── Acceptance #4 again — a FAILING receiver must not leak the URL through the error path ────────

test("a receiver that 500s is an audited ok:false whose error carries no URL", async () => {
  const { url } = makeReceiver(500);
  const h = await makeApp();
  const hookUrl = await url;
  seedRun(h.db, "run-real-7");
  const ruleId = await createRule(h, hookUrl);

  const res = await fetch(`${h.baseUrl}/api/runs/run-real-7/send-to-webhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ruleId }),
  });
  assert.equal(res.status, 200);
  const result = (await res.json()) as WatchRuleEventResult;
  assert.equal(result.ok, false);
  assert.match(String(result.error), /500/, "the STATUS is reported");
  assert.ok(!JSON.stringify(result).includes(SECRET_PATH), "the URL is not");
  assert.ok(!watchTableText(h.db).includes(SECRET_PATH), "and it is not persisted either");
  assert.equal(auditRows(h.rules, ruleId)[0]?.result.ok, false, "the failure IS audited");
});

test("a body with no ruleId is a 400, not a send", async () => {
  const h = await makeApp();
  seedRun(h.db, "run-real-8");
  const res = await fetch(`${h.baseUrl}/api/runs/run-real-8/send-to-webhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 400);
});
