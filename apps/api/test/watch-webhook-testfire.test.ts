// Observability WP4.3 — `POST /api/watch-rules/:id/test-fire`.
//
// Proves (acceptance):
//   1. Test-fire sends the DOCUMENTED sample payload (the same `{run,link}`/`{window,link}` shape a
//      real fire's webhook body takes, plus `sample: true`) to a LOCAL receiver.
//   2. The webhook secret (URL) NEVER appears in the route's response or in the rule's audit log.
//   3. A receiver failure (non-2xx / unreachable) is an AUDITED `ok:false` — never thrown into the
//      caller (a 200 with a structured `{ok:false,...}` body, not a 500).
//   4. A rule with no webhook action 400s; an unknown rule id 404s.

import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import type { WatchRuleEvent, WatchRuleEventResult } from "@mcp-token-footprint/shared";
import { applyMigrations, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { toErrorMessage } from "../src/utils/errors.js";
import { WatchRuleRepository } from "../src/watch/repository.js";
import { registerWatchRoutes } from "../src/watch/routes.js";
import { registerWatchTestFireRoute } from "../src/watch/webhook.js";

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

async function makeApp(): Promise<{ baseUrl: string; repo: WatchRuleRepository; db: AppDatabase }> {
  const db = openFresh();
  const secrets = new SecretStore(crypto.randomBytes(32));
  const repo = new WatchRuleRepository(db, secrets);

  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ error: "Validation failed" });
    const typed = error as Error & { statusCode?: number };
    return reply.code(typed.statusCode ?? 500).send({ error: toErrorMessage(error) });
  });
  await registerWatchRoutes(app, repo);
  await registerWatchTestFireRoute(app, repo, (ref) => repo.resolveWebhookUrl(ref));
  await app.listen({ port: 0, host: "127.0.0.1" });
  apps.push(app);
  const address = app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return { baseUrl: `http://127.0.0.1:${port}`, repo, db };
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
      resolve(`http://127.0.0.1:${port}/hook`);
    });
  });
  return { url, received };
}

test("test-fire posts the documented sample payload (on_terminal shape) to a local receiver; the URL never leaks", async () => {
  const { url, received } = makeReceiver(204);
  const { baseUrl, repo } = await makeApp();
  const hookUrl = await url;

  const rule = repo.create({
    name: "on-terminal alert",
    trigger: "on_terminal",
    filter: {},
    actions: [{ type: "webhook", url: hookUrl, template: "hello" }],
  });

  const res = await fetch(`${baseUrl}/api/watch-rules/${rule.id}/test-fire`, { method: "POST" });
  assert.equal(res.status, 200);
  const result = (await res.json()) as WatchRuleEventResult;
  assert.equal(result.ok, true, "the local receiver 204s → ok:true");
  assert.ok(!JSON.stringify(result).includes(hookUrl), "the URL never appears in the response");

  assert.equal(received.length, 1, "the receiver got exactly one POST");
  const body = JSON.parse(received[0]!.body) as {
    run: { id: string };
    link: string;
    template: string;
    sample: boolean;
  };
  assert.equal(body.sample, true, "the sample payload is marked so a receiver can tell it apart");
  assert.equal(body.run.id, "sample-run");
  assert.equal(body.link, "/testing/runs/sample-run");
  assert.equal(body.template, "hello", "the rule's own template string is carried through");

  // The audit log records the test-fire, without the URL anywhere.
  const eventsRes = await fetch(`${baseUrl}/api/watch-rules/${rule.id}/events`);
  const events = (await eventsRes.json()) as WatchRuleEvent[];
  assert.equal(events.length, 1);
  assert.equal(events[0]?.action, "test_fire");
  assert.equal(events[0]?.result.ok, true);
  assert.ok(!JSON.stringify(events).includes(hookUrl), "the URL never appears in the audit log");
});

test("test-fire posts the documented sample payload (windowed shape) for a windowed rule with a saved threshold", async () => {
  const { url, received } = makeReceiver(200);
  const { baseUrl, repo } = await makeApp();
  const hookUrl = await url;

  const rule = repo.create({
    name: "error rate spike",
    trigger: "windowed",
    filter: {},
    window: {
      measure: "errorRate",
      bucket: "hour",
      window: "1h",
      op: ">=",
      threshold: 0.3,
      cooldownMinutes: 0,
    },
    actions: [{ type: "webhook", url: hookUrl }],
  });

  const res = await fetch(`${baseUrl}/api/watch-rules/${rule.id}/test-fire`, { method: "POST" });
  assert.equal(res.status, 200);
  const result = (await res.json()) as WatchRuleEventResult;
  assert.equal(result.ok, true);

  assert.equal(received.length, 1);
  const body = JSON.parse(received[0]!.body) as {
    window: { ruleId: string; ruleName: string; measure: string; threshold: number };
    link: string;
    sample: boolean;
  };
  assert.equal(body.sample, true);
  assert.equal(body.window.ruleId, rule.id);
  assert.equal(body.window.ruleName, "error rate spike");
  assert.equal(body.window.measure, "errorRate");
  assert.equal(body.window.threshold, 0.3);
  assert.equal(body.link, "/testing/observability/rules");
});

test("test-fire against a receiver that 500s is an AUDITED ok:false — never thrown into the caller", async () => {
  const { url } = makeReceiver(500);
  const { baseUrl, repo } = await makeApp();
  const hookUrl = await url;

  const rule = repo.create({
    name: "flaky",
    trigger: "on_terminal",
    filter: {},
    actions: [{ type: "webhook", url: hookUrl }],
  });

  const res = await fetch(`${baseUrl}/api/watch-rules/${rule.id}/test-fire`, { method: "POST" });
  assert.equal(res.status, 200, "a receiver failure is a structured result, not an HTTP 500");
  const result = (await res.json()) as WatchRuleEventResult;
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /500/);

  const events = (await (
    await fetch(`${baseUrl}/api/watch-rules/${rule.id}/events`)
  ).json()) as WatchRuleEvent[];
  assert.equal(events[0]?.result.ok, false);
});

test("test-fire against an unreachable URL degrades to ok:false (network error), never throws", async () => {
  const { baseUrl, repo } = await makeApp();
  // Port 0's reservation is closed immediately below — nothing is listening on it.
  const dead = http.createServer();
  await new Promise<void>((r) => dead.listen(0, r));
  const deadPort = (dead.address() as { port: number }).port;
  await new Promise<void>((r) => dead.close(() => r()));

  const rule = repo.create({
    name: "unreachable",
    trigger: "on_terminal",
    filter: {},
    actions: [{ type: "webhook", url: `http://127.0.0.1:${deadPort}/hook` }],
  });

  const res = await fetch(`${baseUrl}/api/watch-rules/${rule.id}/test-fire`, { method: "POST" });
  assert.equal(res.status, 200);
  const result = (await res.json()) as WatchRuleEventResult;
  assert.equal(result.ok, false);
});

test("test-fire 400s when the rule has no webhook action", async () => {
  const { baseUrl, repo } = await makeApp();
  const rule = repo.create({
    name: "no webhook",
    trigger: "on_terminal",
    filter: {},
    actions: [{ type: "pin" }],
  });
  const res = await fetch(`${baseUrl}/api/watch-rules/${rule.id}/test-fire`, { method: "POST" });
  assert.equal(res.status, 400);
});

test("test-fire 404s for an unknown rule id", async () => {
  const { baseUrl } = await makeApp();
  const res = await fetch(`${baseUrl}/api/watch-rules/does-not-exist/test-fire`, { method: "POST" });
  assert.equal(res.status, 404);
});

test("test-fire is not confused by a rule id that resolves but whose webhook secret ref was rotated away", async () => {
  const { baseUrl, repo, db } = await makeApp();
  const rule = repo.create({
    name: "rotated",
    trigger: "on_terminal",
    filter: {},
    actions: [{ type: "webhook", url: "https://example.test/hook" }],
  });
  // Simulate a rotated/deleted secret without going through update() (which mints a new one).
  db.prepare("DELETE FROM watch_secrets WHERE rule_id = ?").run(rule.id);

  const res = await fetch(`${baseUrl}/api/watch-rules/${rule.id}/test-fire`, { method: "POST" });
  assert.equal(res.status, 200);
  const result = (await res.json()) as WatchRuleEventResult;
  assert.equal(result.ok, false);
  assert.equal(result.error, "webhook secret not found");
});
