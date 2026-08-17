// Observability WP4.1 — the on-terminal watch-rule ENGINE.
//
// Proves (acceptance):
//   2. On-terminal evaluation fires EXACTLY ONCE per run AFTER the rating axis settles; matches per the
//      RunFilter grammar; deterministic sampling proven (same run id → same decision).
//   3. Every action executes + audits; one failing action (webhook 500) ISOLATES the others; the run
//      pipeline is UNAFFECTED by a rule/action outcome (a throwing rule never changes run state).
//   4. promote_to_test creates the documented DRAFT test (field mapping, draft flag, no auto-run).
//   5. Webhook secret NEVER leaks — a LOCAL receiver proves the template + appended fields land while
//      the URL is absent from every response/audit/log.

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import type { WatchRuleEvent } from "@mcp-token-footprint/shared";
import { CollectionRepository } from "../src/collections/repository.js";
import { CollectionService } from "../src/collections/service.js";
import type { AppDatabase } from "../src/db/database.js";
import { applyMigrations } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { GradeRepository } from "../src/grading/grade-repository.js";
import { GradeService } from "../src/grading/grade-service.js";
import type { McpSession } from "../src/mcp/client.js";
import { OAuthRepository } from "../src/oauth/repository.js";
import { OAuthService } from "../src/oauth/service.js";
import { ProviderRepository } from "../src/providers/repository.js";
import type { DecryptedCredential } from "../src/providers/registry.js";
import { ScanRepository } from "../src/scans/repository.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { ServerRepository } from "../src/servers/repository.js";
import { SkillRepository } from "../src/skills/repository.js";
import { RunManager } from "../src/testing/run-manager.js";
import { RunRepository } from "../src/testing/run-repository.js";
import { RunService, type ModelFactory, type SessionOpener } from "../src/testing/run-service.js";
import { ScenarioRepository } from "../src/testing/scenario-repository.js";
import { ScenarioService } from "../src/testing/scenario-service.js";
import { TestRepository } from "../src/testing/test-repository.js";
import { TestService } from "../src/testing/test-service.js";
import { WatchEngine, sampleDecision } from "../src/watch/engine.js";
import { WatchRuleRepository } from "../src/watch/repository.js";
import type { WatchActionServices } from "../src/watch/actions.js";

type StreamResult = Awaited<ReturnType<NonNullable<MockLanguageModelV3["doStream"]>>>;
type StreamPart = StreamResult["stream"] extends ReadableStream<infer P> ? P : never;

const NOW = "2026-07-16T00:00:00.000Z";
const USAGE = { inputTokens: 10, outputTokens: 5, totalTokens: 15 } as const;

const databases: AppDatabase[] = [];
const servers: http.Server[] = [];
const tmpDirs: string[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await new Promise<void>((r) => s.close(() => r()));
  for (const db of databases.splice(0)) db.close();
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function makeDb(): AppDatabase {
  const db = new Database(":memory:") as unknown as AppDatabase;
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  databases.push(db);
  return db;
}

function tmpAttachmentsDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "watch-att-"));
  tmpDirs.push(dir);
  return dir;
}

/** A harness with the real services the watch action executor drives. */
function makeHarness(fetchImpl?: typeof fetch) {
  const db = makeDb();
  const secrets = new SecretStore(crypto.randomBytes(32));
  const runRepo = new RunRepository(db);
  const testRepo = new TestRepository(db);
  const testService = new TestService(testRepo, tmpAttachmentsDir());
  const collections = new CollectionService(new CollectionRepository(db, secrets));
  const gradeService = new GradeService(new GradeRepository(db), testService, runRepo);
  const watchRepo = new WatchRuleRepository(db, secrets);

  const grades: string[] = [];
  const services: WatchActionServices = {
    pinRun: (runId) => runRepo.setPinned(runId, true),
    addRunToCollection: (runId, collectionId) =>
      collections.assignTest(collectionId, runRepo.getSummary(runId).testId),
    promoteRunToTest: (runId, collectionId) => {
      const run = runRepo.getSummary(runId);
      const source = testService.get(run.testId);
      const tags = source.tags.includes("draft") ? source.tags : [...source.tags, "draft"];
      const draft = testService.create({
        name: `[Draft] ${source.name}`,
        userPrompt: source.userPrompt,
        addedProfiles: source.addedProfiles,
        ...(source.expectations !== undefined ? { expectations: source.expectations } : {}),
        tags,
        collectionId,
        draft: true,
      });
      for (const rec of testRepo.listAttachmentRecords(source.id)) {
        testService.addAttachment(draft.id, {
          kind: rec.kind,
          name: rec.name,
          contentBase64: fs.readFileSync(rec.path).toString("base64"),
        });
      }
      return draft.id;
    },
    runGrader: async (runId, graderId) => {
      grades.push(`${runId}:${graderId}`);
    },
    resolveWebhookUrl: (ref) => watchRepo.resolveWebhookUrl(ref),
    ...(fetchImpl ? { fetchImpl } : {}),
  };
  const engine = new WatchEngine(watchRepo, runRepo, services);
  return {
    db,
    secrets,
    runRepo,
    testRepo,
    testService,
    collections,
    gradeService,
    watchRepo,
    engine,
    services,
    grades,
  };
}

/** Seed provider + scenario + one run row (defaults fill the accounting columns). */
function seedRun(
  db: AppDatabase,
  opts: { runId: string; testId: string; status?: string; suiteRunId?: string | null },
): void {
  db.prepare(
    "INSERT OR IGNORE INTO provider_credentials (id, kind, label, created_at, updated_at) VALUES ('prov-1','anthropic','Claude',@now,@now)",
  ).run({ now: NOW });
  db.prepare(
    "INSERT OR IGNORE INTO scenarios (id, name, provider_id, model, created_at, updated_at) VALUES ('scn-1','Baseline','prov-1','claude-sonnet-4',@now,@now)",
  ).run({ now: NOW });
  db.prepare(
    "INSERT INTO runs (id, test_id, scenario_id, mode, status, started_at, cost_usd, tokens_in, tokens_out) VALUES (@id,@testId,'scn-1','automated',@status,@now,0.5,100,50)",
  ).run({ id: opts.runId, testId: opts.testId, status: opts.status ?? "completed", now: NOW });
}

function auditFor(watchRepo: WatchRuleRepository, ruleId: string): WatchRuleEvent[] {
  return watchRepo.listEvents(ruleId);
}

// ── (2) On-terminal matching ────────────────────────────────────────────────────────────────────

test("a matching rule executes + audits its action; a non-matching rule does nothing", async () => {
  const h = makeHarness();
  const test1 = h.testService.create({ name: "T", userPrompt: "Go.", addedProfiles: [] });
  seedRun(h.db, { runId: "run-ok", testId: test1.id, status: "completed" });

  const match = h.watchRepo.create({
    name: "pin completed",
    trigger: "on_terminal",
    filter: { status: ["completed"] },
    actions: [{ type: "pin" }],
  });
  const noMatch = h.watchRepo.create({
    name: "pin errors",
    trigger: "on_terminal",
    filter: { status: ["error"] },
    actions: [{ type: "pin" }],
  });

  await h.engine.onRunSettled("run-ok");

  assert.equal(h.runRepo.getSummary("run-ok").pinned, true, "the matching rule pinned the run");
  const matchAudit = auditFor(h.watchRepo, match.id);
  assert.equal(matchAudit.length, 1);
  assert.equal(matchAudit[0]?.action, "pin");
  assert.equal(matchAudit[0]?.result.ok, true);
  assert.equal(
    auditFor(h.watchRepo, noMatch.id).length,
    0,
    "the non-matching rule left no audit trail",
  );
});

test("a disabled rule never fires (listEnabledByTrigger gate)", async () => {
  const h = makeHarness();
  const test1 = h.testService.create({ name: "T", userPrompt: "Go.", addedProfiles: [] });
  seedRun(h.db, { runId: "run-ok", testId: test1.id });
  const rule = h.watchRepo.create({
    name: "disabled",
    trigger: "on_terminal",
    enabled: false,
    filter: {},
    actions: [{ type: "pin" }],
  });
  await h.engine.onRunSettled("run-ok");
  assert.equal(h.runRepo.getSummary("run-ok").pinned, false, "a disabled rule does not fire");
  assert.equal(auditFor(h.watchRepo, rule.id).length, 0);
});

// ── (2) Deterministic sampling ─────────────────────────────────────────────────────────────────

test("sampleDecision is deterministic + reproducible; boundaries 0/1/undefined honored", () => {
  assert.equal(sampleDecision("r", "run-x", 1), true, "sample 1 always fires");
  assert.equal(sampleDecision("r", "run-x", undefined), true, "no sample always fires");
  assert.equal(sampleDecision("r", "run-x", 0), false, "sample 0 never fires");
  // Same (rule, run) → SAME decision every call (no RNG, no wall-clock).
  const first = sampleDecision("rule-9", "run-42", 0.5);
  for (let i = 0; i < 5; i++) {
    assert.equal(sampleDecision("rule-9", "run-42", 0.5), first, "same (rule,run) → same decision");
  }
  // Different rules sample the same run independently (not all identical).
  const decisions = ["a", "b", "c", "d", "e", "f", "g", "h"].map((r) =>
    sampleDecision(r, "run-42", 0.5),
  );
  assert.ok(
    new Set(decisions).size === 2,
    "different rules produce a mix of fire/skip for the same run",
  );
});

test("a sampled-OUT match audits `sampled_out` + runs no action; the SAME run reproduces the decision", async () => {
  const h = makeHarness();
  const test1 = h.testService.create({ name: "T", userPrompt: "Go.", addedProfiles: [] });
  seedRun(h.db, { runId: "run-ok", testId: test1.id });
  // sample 0 → guaranteed sampled out.
  const rule = h.watchRepo.create({
    name: "sampled",
    trigger: "on_terminal",
    filter: {},
    sample: 0,
    actions: [{ type: "pin" }],
  });
  await h.engine.onRunSettled("run-ok");
  assert.equal(h.runRepo.getSummary("run-ok").pinned, false, "a sampled-out rule runs no action");
  const audit = auditFor(h.watchRepo, rule.id);
  assert.equal(audit.length, 1);
  assert.equal(audit[0]?.action, "sampled_out");

  // Re-evaluating the SAME run reproduces the SAME (sampled-out) decision — a second sampled_out row.
  await h.engine.onRunSettled("run-ok");
  const audit2 = auditFor(h.watchRepo, rule.id);
  assert.equal(audit2.length, 2, "reproducible: the same run samples out again");
  assert.ok(audit2.every((e) => e.action === "sampled_out"));
});

// ── (3) Action isolation + run-pipeline-unaffected ──────────────────────────────────────────────

test("one failing action (webhook 500) ISOLATES — the other actions still execute + all audit; run state is untouched", async () => {
  // A local receiver that always 500s → the webhook action fails, in isolation.
  const receiver = http.createServer((_req, res) => {
    res.writeHead(500);
    res.end("nope");
  });
  await new Promise<void>((r) => receiver.listen(0, r));
  servers.push(receiver);
  const url = `http://127.0.0.1:${(receiver.address() as { port: number }).port}/hook`;

  const h = makeHarness();
  const source = h.testService.create({ name: "Src", userPrompt: "Go.", addedProfiles: [] });
  const target = h.collections.create({ name: "Promoted" });
  seedRun(h.db, { runId: "run-ok", testId: source.id });
  const before = h.runRepo.getSummary("run-ok");

  // pin (ok) → webhook (fails 500) → promote_to_test (ok). The webhook failure must not block promote.
  const rule = h.watchRepo.create({
    name: "mixed",
    trigger: "on_terminal",
    filter: {},
    actions: [
      { type: "pin" },
      { type: "webhook", url },
      { type: "promote_to_test", collectionId: target.id },
    ],
  });
  await h.engine.onRunSettled("run-ok");

  const audit = auditFor(h.watchRepo, rule.id);
  assert.equal(audit.length, 3, "every action audited exactly once");
  const byAction = new Map(audit.map((e) => [e.action, e.result]));
  assert.equal(byAction.get("pin")?.ok, true, "pin succeeded");
  assert.equal(byAction.get("webhook")?.ok, false, "webhook 500 audited as a failure");
  assert.equal(
    byAction.get("promote_to_test")?.ok,
    true,
    "promote ran DESPITE the earlier webhook failure",
  );
  assert.equal(h.runRepo.getSummary("run-ok").pinned, true, "pin still took effect");

  // Run state (status/outcome/totals) is UNTOUCHED by any rule outcome.
  const after = h.runRepo.getSummary("run-ok");
  assert.equal(after.status, before.status);
  assert.equal(after.outcome, before.outcome);
  assert.equal(after.costUsd, before.costUsd);
  assert.equal(after.tokensIn, before.tokensIn);
});

test("a THROWING action is caught + audited; the rest of the rule set + the run continue", async () => {
  const h = makeHarness();
  const test1 = h.testService.create({ name: "T", userPrompt: "Go.", addedProfiles: [] });
  seedRun(h.db, { runId: "run-ok", testId: test1.id });
  // Sabotage pinRun to throw — the engine must isolate + audit it, then run the next rule.
  h.services.pinRun = () => {
    throw new Error("pin exploded");
  };
  const thrower = h.watchRepo.create({
    name: "throws",
    trigger: "on_terminal",
    filter: {},
    actions: [{ type: "pin" }],
  });
  const grader = h.watchRepo.create({
    name: "grader",
    trigger: "on_terminal",
    filter: {},
    actions: [{ type: "run_grader", graderId: "rouge1" }],
  });

  await assert.doesNotReject(h.engine.onRunSettled("run-ok"), "the engine never throws");

  const throwAudit = auditFor(h.watchRepo, thrower.id);
  assert.equal(throwAudit.length, 1);
  assert.equal(throwAudit[0]?.result.ok, false, "the throwing action is audited as a failure");
  assert.equal(auditFor(h.watchRepo, grader.id)[0]?.result.ok, true, "the next rule still ran");
  assert.deepEqual(h.grades, ["run-ok:rouge1"], "the grader action fired after the throwing rule");
  assert.equal(h.runRepo.getSummary("run-ok").status, "completed", "the run is untouched");
});

// ── (4) promote_to_test draft mapping ───────────────────────────────────────────────────────────

test("promote_to_test creates the documented DRAFT test (field mapping, draft flag, attachment carried, NO auto-run)", async () => {
  const h = makeHarness();
  const target = h.collections.create({ name: "Promoted" });
  const source = h.testService.create({
    name: "Revenue Q",
    userPrompt: "What was revenue?",
    addedProfiles: [],
    expectations: { expectedInsight: "revenue grew" },
    tags: ["finance"],
  });
  h.testService.addAttachment(source.id, {
    kind: "text",
    name: "context.txt",
    contentBase64: Buffer.from("some context").toString("base64"),
  });
  seedRun(h.db, { runId: "run-ok", testId: source.id });
  const runsBefore = (h.db.prepare("SELECT COUNT(*) AS n FROM runs").get() as { n: number }).n;

  const rule = h.watchRepo.create({
    name: "promote",
    trigger: "on_terminal",
    filter: {},
    actions: [{ type: "promote_to_test", collectionId: target.id }],
  });
  await h.engine.onRunSettled("run-ok");

  // Find the drafted test (the one that isn't the source).
  const all = h.testService.list();
  const draft = all.find((t) => t.id !== source.id);
  assert.ok(draft, "a draft test was created");
  assert.equal(draft?.name, "[Draft] Revenue Q", "name marks it a draft");
  assert.equal(
    draft?.userPrompt,
    "What was revenue?",
    "prompt carried from the run's first user prompt",
  );
  assert.deepEqual(
    draft?.expectations,
    { expectedInsight: "revenue grew" },
    "expectations carried",
  );
  assert.equal(draft?.draft, true, "the draft FLAG is set");
  assert.equal(draft?.collectionId, target.id, "assigned to the target collection");
  assert.ok(draft?.tags.includes("draft"), "tagged draft");
  assert.equal(draft?.attachments.length, 1, "the attachment was carried");
  assert.equal(draft?.attachments[0]?.name, "context.txt");

  // NO auto-run: promote_to_test creates a test, never a run.
  const runsAfter = (h.db.prepare("SELECT COUNT(*) AS n FROM runs").get() as { n: number }).n;
  assert.equal(runsAfter, runsBefore, "promote_to_test never starts a run");
  const audit = auditFor(h.watchRepo, rule.id);
  assert.equal(audit[0]?.result.ok, true);
  assert.ok(
    audit[0]?.result.detail?.includes(draft!.id),
    "the audit records the new draft test id",
  );
});

// ── (5) Webhook local receiver — template + appended fields land; the URL never leaks ────────────

test("webhook posts the template + appended fields to a LOCAL receiver; the URL is absent from every audit", async () => {
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
  await new Promise<void>((r) => receiver.listen(0, r));
  servers.push(receiver);
  const url = `http://127.0.0.1:${(receiver.address() as { port: number }).port}/hook`;

  const h = makeHarness();
  const test1 = h.testService.create({ name: "T", userPrompt: "Go.", addedProfiles: [] });
  seedRun(h.db, { runId: "run-ok", testId: test1.id });
  const rule = h.watchRepo.create({
    name: "alert",
    trigger: "on_terminal",
    filter: {},
    actions: [{ type: "webhook", url, template: "on-error-alert" }],
  });

  await h.engine.onRunSettled("run-ok");

  assert.equal(received.length, 1, "the receiver got exactly one POST");
  const payload = JSON.parse(received[0]!.body) as {
    run: { id: string };
    link: string;
    template: string;
  };
  assert.equal(payload.run.id, "run-ok", "appended field: the run summary");
  assert.equal(payload.link, "/testing/runs/run-ok", "appended field: the run link");
  assert.equal(payload.template, "on-error-alert", "the caller's template string is included");

  // The audit records success WITHOUT the URL anywhere.
  const audit = auditFor(h.watchRepo, rule.id);
  assert.equal(audit[0]?.result.ok, true);
  assert.ok(!JSON.stringify(audit).includes(url), "the webhook URL never appears in the audit log");
  assert.ok(!JSON.stringify(audit).includes("127.0.0.1"), "not even the host leaks into the audit");
});

// ── (2 + 3) RunService integration: fire-once-after-rating + pipeline-unaffected ─────────────────

function mockAnswer(): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "t1" },
          { type: "text-delta", id: "t1", delta: "done." },
          { type: "text-end", id: "t1" },
          { type: "finish", finishReason: { unified: "stop", raw: "end_turn" }, usage: USAGE },
        ] as StreamPart[],
      }),
    }),
  });
}

function stubSession(): McpSession {
  return {
    listTools: async () => ({ tools: [] }),
    callTool: async (name: string) => ({ content: [{ type: "text", text: `${name}:ok` }] }),
    close: async () => undefined,
  };
}

function makeRunServiceWithWatch(h: ReturnType<typeof makeHarness>, watch: WatchEngine) {
  const db = h.db;
  const secrets = h.secrets;
  const scans = new ScanRepository(db);
  const serverRepo = new ServerRepository(db, secrets);
  const providers = new ProviderRepository(db, secrets);
  const oauthService = new OAuthService(serverRepo, new OAuthRepository(db, secrets));
  const skills = new SkillRepository(db, secrets);
  const scenarioService = new ScenarioService(new ScenarioRepository(db), scans, skills);
  const runManager = new RunManager(h.runRepo);
  const modelFactory: ModelFactory = (_c: DecryptedCredential) => mockAnswer();
  const sessionOpener: SessionOpener = async () => stubSession();
  const runService = new RunService(
    scenarioService,
    h.testService,
    providers,
    serverRepo,
    oauthService,
    runManager,
    h.runRepo,
    modelFactory,
    sessionOpener,
    skills,
    h.gradeService,
    undefined, // issues
    undefined, // subscriptionDriver
    undefined, // subscriptionAuth
    undefined, // subscriptionConcurrency
    undefined, // subscriptionModels
    watch,
  );
  return { scenarioService, runService, providers };
}

function seedProviderScenario(db: AppDatabase, secrets: SecretStore): void {
  db.prepare(
    `INSERT INTO provider_credentials (id, kind, label, base_url, api_key_encrypted, created_at, updated_at)
     VALUES ('prov-1','anthropic','Claude',NULL,@key,@now,@now)`,
  ).run({ key: secrets.encryptText("dummy"), now: NOW });
}

test("RunService fires the watch engine EXACTLY ONCE per run, AFTER the rating axis has settled", async () => {
  const h = makeHarness();
  seedProviderScenario(h.db, h.secrets);

  // Spy that wraps the REAL engine + records the ratingState at the moment of the call.
  const calls: string[] = [];
  const ratingAtCall: string[] = [];
  const spy = {
    onRunSettled: async (runId: string) => {
      calls.push(runId);
      ratingAtCall.push(h.runRepo.getSummary(runId).ratingState);
      await h.engine.onRunSettled(runId);
    },
  } as unknown as WatchEngine;

  const { scenarioService, runService } = makeRunServiceWithWatch(h, spy);
  const scenario = scenarioService.create({
    name: "Sc",
    providerId: "prov-1",
    model: "claude-sonnet-4",
    params: {},
    systemPrompt: "",
    allowedServers: [],
    allowedSkills: [],
    defaultProfiles: ["generic_o200k"],
    guardrails: {},
    toolLoadingMode: "eager",
  });
  const testX = h.testService.create({ name: "T", userPrompt: "Go.", addedProfiles: [] });
  h.watchRepo.create({
    name: "pin all",
    trigger: "on_terminal",
    filter: {},
    actions: [{ type: "pin" }],
  });

  const handle = runService.start(testX.id, scenario.id, "automated");
  await handle.done;

  assert.deepEqual(calls, [handle.runId], "onRunSettled fired exactly once, for this run");
  assert.ok(
    ["rated", "skipped"].includes(ratingAtCall[0] ?? ""),
    `watch ran AFTER the rating settled (was '${ratingAtCall[0]}')`,
  );
  assert.equal(
    h.runRepo.getSummary(handle.runId).pinned,
    true,
    "the rule pinned the completed run",
  );
});

test("a rule/action that THROWS never changes run state (the run still completes cleanly)", async () => {
  const h = makeHarness();
  seedProviderScenario(h.db, h.secrets);
  // A watch engine whose onRunSettled throws — the run pipeline must be UNAFFECTED (run-service guards it).
  const exploding = {
    onRunSettled: async () => {
      throw new Error("watch engine exploded");
    },
  } as unknown as WatchEngine;

  const { scenarioService, runService } = makeRunServiceWithWatch(h, exploding);
  const scenario = scenarioService.create({
    name: "Sc",
    providerId: "prov-1",
    model: "claude-sonnet-4",
    params: {},
    systemPrompt: "",
    allowedServers: [],
    allowedSkills: [],
    defaultProfiles: ["generic_o200k"],
    guardrails: {},
    toolLoadingMode: "eager",
  });
  const testX = h.testService.create({ name: "T", userPrompt: "Go.", addedProfiles: [] });

  const handle = runService.start(testX.id, scenario.id, "automated");
  const result = await handle.done; // must NOT reject
  assert.equal(result.status, "completed", "the run completes despite the watch-engine crash");
  const summary = h.runRepo.getSummary(handle.runId);
  assert.equal(summary.status, "completed", "run status untouched by the throwing rule");
  assert.ok(["rated", "skipped"].includes(summary.ratingState), "the rating axis still settled");
});
