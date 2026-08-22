// Observability WP4.1 — watch-rule CRUD + validation + webhook-secret redaction + migration v38.
//
// Proves (acceptance):
//   1. Rule CRUD round-trips; a bad filter / bad action → 400; enable/disable honored
//      (listEnabledByTrigger).
//   5. The webhook secret (URL) NEVER appears in a response, in watch_rules.actions_json, or in the
//      audit — it is held encrypted in watch_secrets and resolvable only via resolveWebhookUrl.
//   6. Migration v38 lands watch_rules/watch_rule_events/watch_secrets + tests.draft on BOTH the fresh
//      (schema.ts baseline) and the pre-v38 upgrade path; idempotent; LATEST advanced to 39 (v39 adds
//      watch_rules.last_evaluated_at — see watch-windowed.test.ts for that column's both-path proof).
//
// (The on-terminal ENGINE acceptance — fire-once-after-rating, deterministic sample, action isolation,
// run-pipeline-unaffected, promote_to_test draft mapping, webhook local-receiver — is watch-engine.test.ts.)

import assert from "node:assert/strict";
import crypto from "node:crypto";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import type { WatchRule, WatchRuleEvent } from "@mcp-token-footprint/shared";
import { applyMigrations, LATEST_SCHEMA_VERSION, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { toErrorMessage } from "../src/utils/errors.js";
import { WatchRuleRepository } from "../src/watch/repository.js";
import { registerWatchRoutes } from "../src/watch/routes.js";

const NOW = "2026-07-16T00:00:00.000Z";
const SECRET = "https://hooks.example.test/abc123-super-secret";

const databases: AppDatabase[] = [];
const apps: FastifyInstance[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const db of databases.splice(0)) db.close();
});

function track(db: AppDatabase): AppDatabase {
  databases.push(db);
  return db;
}

function tableExists(db: AppDatabase, table: string): boolean {
  return (
    (
      db
        .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name=?")
        .get(table) as {
        n: number;
      }
    ).n === 1
  );
}

function columns(db: AppDatabase, table: string): string[] {
  return (db.pragma(`table_info(${table})`) as Array<{ name: string }>).map((c) => c.name);
}

function openFresh(): AppDatabase {
  const db = track(new Database(":memory:"));
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  return db;
}

async function setup(): Promise<{
  db: AppDatabase;
  app: FastifyInstance;
  repo: WatchRuleRepository;
  secrets: SecretStore;
}> {
  const db = openFresh();
  const secrets = new SecretStore(crypto.randomBytes(32));
  const repo = new WatchRuleRepository(db, secrets);

  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: "Validation failed", issues: error.issues });
    }
    const typed = error as Error & { statusCode?: number; code?: string };
    const code =
      typeof typed.statusCode === "number" && typeof typed.code === "string"
        ? typed.code
        : undefined;
    return reply
      .code(typed.statusCode ?? 500)
      .send({ error: toErrorMessage(error), ...(code ? { code } : {}) });
  });
  await registerWatchRoutes(app, repo);
  await app.ready();
  apps.push(app);
  return { db, app, repo, secrets };
}

// ── (1) CRUD round-trip ──────────────────────────────────────────────────────────────────────────

test("POST creates a rule; GET lists + fetches it; the filter/actions round-trip", async () => {
  const { app } = await setup();
  const created = await app.inject({
    method: "POST",
    url: "/api/watch-rules",
    payload: {
      name: "Pin errors",
      trigger: "on_terminal",
      filter: { hasError: true },
      actions: [{ type: "pin" }],
    },
  });
  assert.equal(created.statusCode, 201);
  const rule = created.json() as WatchRule;
  assert.equal(rule.name, "Pin errors");
  assert.equal(rule.enabled, true, "enabled defaults to true");
  assert.equal(rule.trigger, "on_terminal");
  assert.deepEqual(rule.filter, { hasError: true });
  assert.deepEqual(rule.actions, [{ type: "pin" }]);
  assert.ok(rule.id && rule.createdAt);

  const listed = await app.inject({ method: "GET", url: "/api/watch-rules" });
  assert.equal((listed.json() as WatchRule[]).length, 1);

  const fetched = await app.inject({ method: "GET", url: `/api/watch-rules/${rule.id}` });
  assert.deepEqual(fetched.json(), rule);
});

test("PATCH is a REAL partial update; DELETE is hard (404 afterwards)", async () => {
  const { app } = await setup();
  const rule = (
    await app.inject({
      method: "POST",
      url: "/api/watch-rules",
      payload: {
        name: "Rule",
        trigger: "on_terminal",
        filter: { status: ["completed"] },
        actions: [{ type: "pin" }],
      },
    })
  ).json() as WatchRule;

  // Patch ONLY enabled — name/filter/actions must survive.
  const patched = (
    await app.inject({
      method: "PATCH",
      url: `/api/watch-rules/${rule.id}`,
      payload: { enabled: false },
    })
  ).json() as WatchRule;
  assert.equal(patched.enabled, false);
  assert.equal(patched.name, "Rule");
  assert.deepEqual(patched.filter, { status: ["completed"] });
  assert.deepEqual(patched.actions, [{ type: "pin" }]);

  const del = await app.inject({ method: "DELETE", url: `/api/watch-rules/${rule.id}` });
  assert.equal(del.statusCode, 204);
  const gone = await app.inject({ method: "GET", url: `/api/watch-rules/${rule.id}` });
  assert.equal(gone.statusCode, 404);
});

// ── (1) Validation → 400 ──────────────────────────────────────────────────────────────────────────

test("a bad filter key (RunFilter is .strict) → 400", async () => {
  const { app } = await setup();
  const res = await app.inject({
    method: "POST",
    url: "/api/watch-rules",
    payload: {
      name: "Bad filter",
      trigger: "on_terminal",
      filter: { nonsenseKey: true },
      actions: [{ type: "pin" }],
    },
  });
  assert.equal(res.statusCode, 400);
});

test("a bad action (unknown type / missing field / bad webhook url) → 400", async () => {
  const { app } = await setup();
  const base = { name: "X", trigger: "on_terminal" as const, filter: {} };
  for (const actions of [
    [{ type: "not_an_action" }],
    [{ type: "add_to_collection" }], // missing collectionId
    [{ type: "webhook", url: "not-a-url" }],
    [], // empty action set
  ]) {
    const res = await app.inject({
      method: "POST",
      url: "/api/watch-rules",
      payload: { ...base, actions },
    });
    assert.equal(res.statusCode, 400, `actions ${JSON.stringify(actions)} → 400`);
  }
});

test("enable/disable is honored by listEnabledByTrigger", async () => {
  const { repo } = await setup();
  const on = repo.create({
    name: "on",
    trigger: "on_terminal",
    filter: {},
    actions: [{ type: "pin" }],
  });
  repo.create({
    name: "off",
    trigger: "on_terminal",
    enabled: false,
    filter: {},
    actions: [{ type: "pin" }],
  });
  repo.create({ name: "win", trigger: "windowed", filter: {}, actions: [{ type: "pin" }] });
  const enabled = repo.listEnabledByTrigger("on_terminal");
  assert.deepEqual(
    enabled.map((r) => r.id),
    [on.id],
    "only the enabled on_terminal rule is returned",
  );
});

// ── (5) Webhook secret is NEVER surfaced ───────────────────────────────────────────────────────────

test("a webhook URL is encrypted + stored out of watch_rules; the response/DB never carry it", async () => {
  const { app, db, repo } = await setup();
  const created = await app.inject({
    method: "POST",
    url: "/api/watch-rules",
    payload: {
      name: "Alert",
      trigger: "on_terminal",
      filter: {},
      actions: [{ type: "webhook", url: SECRET, template: "custom" }],
    },
  });
  assert.equal(created.statusCode, 201);
  const rule = created.json() as WatchRule;

  // The RESPONSE carries a secretRef, never the URL.
  const webhook = rule.actions[0] as { type: "webhook"; secretRef: string; template?: string };
  assert.equal(webhook.type, "webhook");
  assert.ok(webhook.secretRef && webhook.secretRef.length > 0);
  assert.equal(webhook.template, "custom");
  assert.ok(
    !JSON.stringify(created.json()).includes(SECRET),
    "the URL is absent from the POST response",
  );

  // GET (list + detail) never carry the URL either.
  const list = await app.inject({ method: "GET", url: "/api/watch-rules" });
  assert.ok(!list.body.includes(SECRET), "the URL is absent from the GET list");
  const detail = await app.inject({ method: "GET", url: `/api/watch-rules/${rule.id}` });
  assert.ok(!detail.body.includes(SECRET), "the URL is absent from the GET detail");

  // watch_rules.actions_json holds the secretRef, NOT the URL.
  const actionsJson = (
    db.prepare("SELECT actions_json FROM watch_rules WHERE id = ?").get(rule.id) as {
      actions_json: string;
    }
  ).actions_json;
  assert.ok(!actionsJson.includes(SECRET), "watch_rules.actions_json never carries the URL");
  assert.ok(
    actionsJson.includes(webhook.secretRef),
    "watch_rules.actions_json carries only the secretRef",
  );

  // watch_secrets stores the ENCRYPTED value (not plaintext) — and it decrypts back via the repo.
  const secretRow = db
    .prepare("SELECT encrypted_value FROM watch_secrets WHERE ref = ?")
    .get(webhook.secretRef) as { encrypted_value: string };
  assert.ok(secretRow.encrypted_value.startsWith("enc:v1:"), "the URL is stored encrypted");
  assert.ok(!secretRow.encrypted_value.includes(SECRET), "the plaintext URL is never at rest");
  assert.equal(
    repo.resolveWebhookUrl(webhook.secretRef),
    SECRET,
    "resolveWebhookUrl decrypts it back",
  );
});

test("updating the actions ROTATES the webhook secret (old ref dropped, new minted)", async () => {
  const { db, repo } = await setup();
  const rule = repo.create({
    name: "Alert",
    trigger: "on_terminal",
    filter: {},
    actions: [{ type: "webhook", url: SECRET }],
  });
  const oldRef = (rule.actions[0] as { secretRef: string }).secretRef;

  const updated = repo.update(rule.id, {
    actions: [{ type: "webhook", url: "https://hooks.example.test/rotated" }],
  });
  const newRef = (updated.actions[0] as { secretRef: string }).secretRef;
  assert.notEqual(newRef, oldRef, "a new secretRef is minted on action replacement");
  assert.equal(repo.resolveWebhookUrl(oldRef), undefined, "the old secret is gone");
  assert.equal(repo.resolveWebhookUrl(newRef), "https://hooks.example.test/rotated");
  const count = (
    db.prepare("SELECT COUNT(*) AS n FROM watch_secrets WHERE rule_id = ?").get(rule.id) as {
      n: number;
    }
  ).n;
  assert.equal(count, 1, "exactly one secret survives the rotation");
});

test("deleting a rule cascade-drops its webhook secrets + audit rows", async () => {
  const { db, repo } = await setup();
  const rule = repo.create({
    name: "Alert",
    trigger: "on_terminal",
    filter: {},
    actions: [{ type: "webhook", url: SECRET }],
  });
  repo.recordEvent(rule.id, "run-1", "webhook", { ok: true, detail: "responded 204" });
  repo.delete(rule.id);
  assert.equal(
    (
      db.prepare("SELECT COUNT(*) AS n FROM watch_secrets WHERE rule_id = ?").get(rule.id) as {
        n: number;
      }
    ).n,
    0,
    "secrets cascade-deleted",
  );
  assert.equal(
    (
      db.prepare("SELECT COUNT(*) AS n FROM watch_rule_events WHERE rule_id = ?").get(rule.id) as {
        n: number;
      }
    ).n,
    0,
    "audit rows cascade-deleted",
  );
});

// ── Audit list ─────────────────────────────────────────────────────────────────────────────────────

test("GET /:id/events lists the audit log, newest first", async () => {
  const { app, repo } = await setup();
  const rule = repo.create({
    name: "R",
    trigger: "on_terminal",
    filter: {},
    actions: [{ type: "pin" }],
  });
  repo.recordEvent(rule.id, "run-1", "pin", { ok: true, detail: "pinned run" });
  repo.recordEvent(rule.id, "run-2", "pin", { ok: false, error: "boom" });
  const events = (
    await app.inject({ method: "GET", url: `/api/watch-rules/${rule.id}/events` })
  ).json() as WatchRuleEvent[];
  assert.equal(events.length, 2);
  assert.equal(
    events.every((e) => e.action === "pin"),
    true,
  );
  assert.equal(
    events.some((e) => e.result.ok === false && e.result.error === "boom"),
    true,
  );
});

// ── (6) Migration v38 — fresh + upgrade + idempotent ─────────────────────────────────────────────

test("migration v38 — a fresh DB carries the watch tables + tests.draft; LATEST is 55", () => {
  const db = openFresh();
  assert.equal(
    LATEST_SCHEMA_VERSION,
    62,
    "LATEST_SCHEMA_VERSION auto-derived to 62 (v38 watch_rules + v39 watch_rules.last_evaluated_at + v40 notifications + v41 fleet issue aggregation + v42 runs fork lineage + v43 digest reports + v44 model pricing + v45 dashboard charts + v46 review_rubrics; v47 = hub_* tables, Assistant Hub WP0.2; v48 = hub_session_skills, Assistant Hub WP2.4; v49 = hub_memory.scope/scope_id + hub_agents.display_name + hub_crews.color + hub_sessions.archived_at, Assistant Hub UX WP1.0s; v50 = hub_sessions.tool_scope_json, end-user UX pass; v54 = hub_missions.parent_mission_id/depth/root_mission_id, crew-nesting mission-tree lineage; v55 = hub_sessions/hub_agents.provider_credential_id, model identity D-MI1; v56 = the acme_answers provider kind removed (purge + narrowed kind CHECK, mcp_server_id + scenarios.answers_mode dropped); v57 = notification/digest deep-link repair (stale /assistant/s/ + /testing/observability/issues/ paths rewritten); v58 = api_tokens, service tokens for headless/CI callers, planning/Roadmap/RM-08-ci WP 1.1; v59 = runs.cache_read_tokens/cache_write_tokens, the prompt-cache split on the run row, planning/Roadmap/RM-33-cache-aware-token-accounting WP 1.2; v60 = grade_feedback, human verdicts ON grades + the derived calibration set, planning/Roadmap/RM-07-benchmarks WP 6.1; v61 = watch_rules.paused_until + min_interval_minutes, watch-rule pause + on-terminal renotification interval, planning/Roadmap/RM-17-observability Phase 6 AM-OB10; v62 = skill_box_positions, canvas box positions kept APP-SIDE per skill so a position comment never inflates the metered SKILL.md body, planning/Roadmap/RM-30-ux-overhaul WP 7.8 decision 5)",
  );
  assert.equal(db.pragma("user_version", { simple: true }), 62, "fresh DB stamped at 62");
  for (const t of ["watch_rules", "watch_rule_events", "watch_secrets"]) {
    assert.ok(tableExists(db, t), `fresh DB has ${t}`);
  }
  assert.ok(columns(db, "tests").includes("draft"), "fresh DB has tests.draft");
  assert.ok(
    columns(db, "watch_rules").includes("last_evaluated_at"),
    "fresh DB has watch_rules.last_evaluated_at (v39)",
  );
});

test("migration v38 — a pre-v38 (v37) DB gains the watch tables + tests.draft; neighboring rows survive; idempotent", () => {
  const db = track(new Database(":memory:"));
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql); // everything at latest…
  // …then rewind to a pre-v38 (v37) DB: drop the three new tables + the additive tests.draft column.
  db.exec("DROP TABLE IF EXISTS watch_secrets;");
  db.exec("DROP TABLE IF EXISTS watch_rule_events;");
  db.exec("DROP TABLE IF EXISTS watch_rules;");
  db.exec("ALTER TABLE tests DROP COLUMN draft;");
  db.pragma("user_version = 37");
  assert.ok(!tableExists(db, "watch_rules"), "sanity: the v37 fixture lacks watch_rules");
  assert.ok(!columns(db, "tests").includes("draft"), "sanity: the v37 fixture lacks tests.draft");

  // A pre-existing test row (written before the draft column existed).
  db.prepare(
    "INSERT INTO tests (id, name, user_prompt, created_at, updated_at) VALUES ('test-pre38','T','go',@now,@now)",
  ).run({ now: NOW });

  applyMigrations(db);

  assert.equal(
    db.pragma("user_version", { simple: true }),
    LATEST_SCHEMA_VERSION,
    "stamped to LATEST (62) after v38+v39+v40+v41+v42+v43+v44+v45+v46",
  );
  for (const t of ["watch_rules", "watch_rule_events", "watch_secrets"]) {
    assert.ok(tableExists(db, t), `v38 created ${t}`);
  }
  assert.ok(columns(db, "tests").includes("draft"), "v38 added tests.draft");
  const pre = db.prepare("SELECT draft FROM tests WHERE id = 'test-pre38'").get() as {
    draft: number;
  };
  assert.equal(pre.draft, 0, "a pre-v38 test reads back non-draft (default 0)");

  // The watch tables are immediately usable.
  db.prepare(
    "INSERT INTO watch_rules (id, name, enabled, trigger, filter_json, actions_json, created_at, updated_at) VALUES ('w1','R',1,'on_terminal','{}','[]',@now,@now)",
  ).run({ now: NOW });
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM watch_rules").get() as { n: number }).n,
    1,
    "watch_rules usable post-migration",
  );

  assert.doesNotThrow(() => applyMigrations(db), "re-applying v38+v39+v40+v41+v42+v43+v44+v45+v46 is a no-op");
  assert.equal(
    db.pragma("user_version", { simple: true }),
    LATEST_SCHEMA_VERSION,
    "version unchanged after the re-run",
  );
});
