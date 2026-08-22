// Observability — AM-OB13 acceptance #2, the CONFIGURED half, end to end through the route.
//
// `config/env.ts` reads `APP_BASE_URL` once, at module load, so a test cannot flip it after the fact
// — and `watch-manual-send.test.ts` (which runs with it UNSET, like the whole gate) can only prove
// the absolute case at the pure function the route calls. That is one inference short of the
// acceptance criterion, which asks for both states asserted.
//
// This file is that missing half, and it is a separate FILE for exactly one reason: the node test
// runner gives each file its own process, so setting the variable here before any dynamic import
// cannot leak into another test's idea of the world. Every import below is deliberately dynamic —
// a static one would be hoisted above the assignment and read an empty value.
//
// What it proves: with a base URL configured, a REAL manual send posts links a receiver can click,
// and it is the SAME send path — same route, same payload builder, same local receiver — that the
// relative case exercises. Nothing outside 127.0.0.1 is contacted.

import assert from "node:assert/strict";
import http from "node:http";
import { after, test } from "node:test";

const BASE_URL = "https://bench.example.test";
process.env.APP_BASE_URL = BASE_URL;

const servers: http.Server[] = [];
after(async () => {
  for (const s of servers.splice(0)) await new Promise<void>((r) => s.close(() => r()));
});

test("with APP_BASE_URL set, a real send posts ABSOLUTE, openable links", async () => {
  // Dynamic, and after the assignment above — this is the whole point of the file.
  const crypto = await import("node:crypto");
  const Database = (await import("better-sqlite3")).default;
  const Fastify = (await import("fastify")).default;
  const shared = await import("@mcp-token-footprint/shared");
  const { applyMigrations } = await import("../src/db/database.js");
  const { schemaSql } = await import("../src/db/schema.js");
  const { SecretStore } = await import("../src/secrets/secret-store.js");
  const { SuiteRunRepository } = await import("../src/suites/suite-run-repository.js");
  const { RunRepository } = await import("../src/testing/run-repository.js");
  const { registerManualSendRoutes } = await import("../src/watch/manual-send.js");
  const { WatchRuleRepository } = await import("../src/watch/repository.js");
  const { config } = await import("../src/config/env.js");

  // Guard the guard: if this is undefined the assertions below would pass vacuously against the
  // relative fallback, which is precisely the state the OTHER file already covers.
  assert.equal(config.appBaseUrl, BASE_URL, "the configured state must actually be configured");

  const received: Array<{ body: string }> = [];
  const receiver = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received.push({ body });
      res.writeHead(204);
      res.end();
    });
  });
  servers.push(receiver);
  await new Promise<void>((r) => receiver.listen(0, r));
  const hookUrl = `http://127.0.0.1:${(receiver.address() as { port: number }).port}/hook`;

  const db = new Database(":memory:") as unknown as import("../src/db/database.js").AppDatabase;
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);

  const rules = new WatchRuleRepository(db, new SecretStore(crypto.randomBytes(32)));
  const runs = new RunRepository(db);
  const suiteRuns = new SuiteRunRepository(db);

  const now = "2026-08-22T00:00:00.000Z";
  db.prepare(
    "INSERT INTO provider_credentials (id, kind, label, created_at, updated_at) VALUES ('p1','anthropic','Claude',@now,@now)",
  ).run({ now });
  db.prepare(
    "INSERT INTO scenarios (id, name, provider_id, model, created_at, updated_at) VALUES ('s1','Nightly','p1','claude-sonnet-4',@now,@now)",
  ).run({ now });
  db.prepare(
    "INSERT INTO tests (id, name, user_prompt, created_at, updated_at) VALUES ('t1','Ledger','Go.',@now,@now)",
  ).run({ now });
  db.prepare(
    `INSERT INTO runs (id, test_id, scenario_id, mode, status, started_at, cost_usd, tokens_in, tokens_out)
       VALUES ('run-abs','t1','s1','automated','completed',@now,0.5,10,5)`,
  ).run({ now });

  const app = Fastify({ logger: false });
  await registerManualSendRoutes(app, { rules, runs, suiteRuns });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  const rule = rules.create({
    name: "ops",
    trigger: "on_terminal",
    filter: {},
    actions: [{ type: "webhook", url: hookUrl }],
  });

  const res = await fetch(`http://127.0.0.1:${port}/api/runs/run-abs/send-to-webhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ruleId: rule.id }),
  });
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as shared.WatchRuleEventResult).ok, true);

  assert.equal(received.length, 1);
  const body = JSON.parse(received[0]?.body ?? "{}") as shared.ManualSendPayload;
  assert.equal(body.link, `${BASE_URL}/testing/runs/run-abs`);
  assert.equal(body.reportLink, `${BASE_URL}/api/reports/run/run-abs/markdown`);
  assert.equal(body.run?.id, "run-abs");

  // The preview endpoint agrees with what actually went out — an operator who read the dialog saw
  // the same absolute links the receiver got.
  const preview = (await (
    await fetch(`http://127.0.0.1:${port}/api/runs/run-abs/webhook-payload`)
  ).json()) as shared.ManualSendPayload;
  assert.deepEqual(JSON.parse(JSON.stringify(preview)), body);

  await app.close();
  db.close();
});
