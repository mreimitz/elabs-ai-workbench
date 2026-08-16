import assert from "node:assert/strict";
import crypto from "node:crypto";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import {
  runTraceResponseSchema,
  traceEventSchema,
  type RunSummary,
  type TraceEvent,
} from "@mcp-token-footprint/shared";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import type { AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import type { McpSession } from "../src/mcp/client.js";
import { OAuthRepository } from "../src/oauth/repository.js";
import { OAuthService } from "../src/oauth/service.js";
import { ProviderRepository } from "../src/providers/repository.js";
import type { DecryptedCredential } from "../src/providers/registry.js";
import { ScanRepository } from "../src/scans/repository.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { ServerRepository } from "../src/servers/repository.js";
import { SkillRepository, type SkillFileInput } from "../src/skills/repository.js";
import { registerSkillflowRoutes } from "../src/skillflow/routes.js";
import { traceFromRun } from "../src/skillflow/run-trace.js";
import { RunManager } from "../src/testing/run-manager.js";
import { RunRepository } from "../src/testing/run-repository.js";
import { RunService, type ModelFactory, type SessionOpener } from "../src/testing/run-service.js";
import { ScenarioRepository } from "../src/testing/scenario-repository.js";
import { ScenarioService } from "../src/testing/scenario-service.js";
import { TestRepository } from "../src/testing/test-repository.js";
import { TestService } from "../src/testing/test-service.js";
import { toErrorMessage } from "../src/utils/errors.js";

// Derive the low-level provider stream-part type from the mock model's own doStream signature (same
// trick as run-persistence.test.ts / run-stream-routes.test.ts — no extra dependency).
type MockStreamResult = Awaited<ReturnType<NonNullable<MockLanguageModelV3["doStream"]>>>;
type LanguageModelV3StreamPart = MockStreamResult["stream"] extends ReadableStream<infer P>
  ? P
  : never;

const databases: AppDatabase[] = [];
const apps: FastifyInstance[] = [];

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const db of databases.splice(0)) db.close();
});

function createDatabase(): AppDatabase {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  databases.push(db);
  return db;
}

const NOW = "2026-06-20T00:00:00.000Z";

function file(path: string, text: string): SkillFileInput {
  return { path, bytes: Buffer.from(text, "utf8") };
}

/** Seed provider + scenario + test FK parents a `runs` row needs. Returns the scenario/test ids. */
function seedParents(db: AppDatabase, scenarioId: string, testId: string): void {
  db.prepare(
    `INSERT INTO provider_credentials (id, kind, label, base_url, api_key_encrypted, created_at, updated_at)
     VALUES ('prov-1', 'anthropic', 'Claude', NULL, 'enc:v1:abc', @now, @now)`,
  ).run({ now: NOW });
  db.prepare(
    `INSERT INTO scenarios (id, name, provider_id, model, params_json, system_prompt, default_profiles_json, guardrails_json, created_at, updated_at)
     VALUES (@id, 'Baseline', 'prov-1', 'claude-sonnet-4', '{}', '', '[]', '{}', @now, @now)`,
  ).run({ id: scenarioId, now: NOW });
  db.prepare(
    `INSERT INTO tests (id, name, user_prompt, added_profiles_json, created_at, updated_at)
     VALUES (@id, 'Report', 'Generate the report.', '[]', @now, @now)`,
  ).run({ id: testId, now: NOW });
}

/** Insert a `runs` row directly (repository-level seeding, no model key needed). */
function seedRun(db: AppDatabase, runId: string, scenarioId: string, testId: string): void {
  db.prepare(
    `INSERT INTO runs (id, test_id, scenario_id, mode, status, started_at)
     VALUES (@id, @testId, @scenarioId, 'automated', 'completed', @now)`,
  ).run({ id: runId, testId, scenarioId, now: NOW });
}

/** Insert one `run_steps` row (payload serialized like the real TEXT column). */
function seedStep(
  db: AppDatabase,
  runId: string,
  step: {
    idx: number;
    type: string;
    label: string;
    status?: string;
    toolName?: string;
    assistantText?: string;
    resultBytes?: number;
    payload?: unknown;
  },
): void {
  db.prepare(
    `INSERT INTO run_steps (id, run_id, idx, type, label, status, tool_name, assistant_text, result_bytes, payload_json)
     VALUES (@id, @runId, @idx, @type, @label, @status, @toolName, @assistantText, @resultBytes, @payloadJson)`,
  ).run({
    id: `${runId}:step:${step.idx}`,
    runId,
    idx: step.idx,
    type: step.type,
    label: step.label,
    status: step.status ?? "ok",
    toolName: step.toolName ?? null,
    assistantText: step.assistantText ?? null,
    resultBytes: step.resultBytes ?? null,
    payloadJson: JSON.stringify(step.payload ?? {}),
  });
}

/** Seed a run whose steps cover all six run_steps types, incl. two real-shaped read_skill_file calls. */
function seedAllSixStepTypes(db: AppDatabase, runId: string): void {
  // idx 0 — user_message
  seedStep(db, runId, {
    idx: 0,
    type: "user_message",
    label: "User request",
    payload: { text: "Generate the report." },
  });
  // idx 1 — llm_request (SKIPPED by the normalizer)
  seedStep(db, runId, { idx: 1, type: "llm_request", label: "request", payload: { messages: 1 } });
  // idx 2 — llm_response → turn (text from the assistant_text column)
  seedStep(db, runId, {
    idx: 2,
    type: "llm_response",
    label: "Plan",
    assistantText: "Reading the skill instructions.",
  });
  // idx 3 — read_skill_file tool_call → skill_file_read (REAL persisted shape: input under `args`)
  seedStep(db, runId, {
    idx: 3,
    type: "tool_call",
    label: "read_skill_file",
    toolName: "read_skill_file",
    payload: { toolCallId: "c1", args: { skill: "data-report", path: "SKILL.md" } },
  });
  // idx 4 — tool_result for the read
  seedStep(db, runId, {
    idx: 4,
    type: "tool_result",
    label: "SKILL.md contents",
    toolName: "read_skill_file",
    resultBytes: 1450,
    payload: {
      toolCallId: "c1",
      result: { skill: "data-report", path: "SKILL.md", contents: "…" },
    },
  });
  // idx 5 — a second read_skill_file tool_call
  seedStep(db, runId, {
    idx: 5,
    type: "tool_call",
    label: "read_skill_file",
    toolName: "read_skill_file",
    payload: { toolCallId: "c2", args: { skill: "data-report", path: "reference/format-spec.md" } },
  });
  // idx 6 — tool_result for the second read
  seedStep(db, runId, {
    idx: 6,
    type: "tool_result",
    label: "format-spec.md contents",
    toolName: "read_skill_file",
    resultBytes: 320,
    payload: {
      toolCallId: "c2",
      result: { skill: "data-report", path: "reference/format-spec.md", contents: "…" },
    },
  });
  // idx 7 — a NON-skill tool_call → tool_call (name only)
  seedStep(db, runId, {
    idx: 7,
    type: "tool_call",
    label: "Bash",
    toolName: "Bash",
    payload: { toolCallId: "c3", args: { command: "python3 scripts/validate.py input.csv" } },
  });
  // idx 8 — a FAILED tool_result → tool_result (status:error). Exit codes are NOT extracted (WP 2.2).
  seedStep(db, runId, {
    idx: 8,
    type: "tool_result",
    label: "validate.py result",
    status: "error",
    toolName: "Bash",
    resultBytes: 40,
    payload: { toolCallId: "c3", result: { isError: true } },
  });
  // idx 9 — a second llm_response → turn
  seedStep(db, runId, {
    idx: 9,
    type: "llm_response",
    label: "Done",
    assistantText: "Report complete.",
  });
  // idx 10 — context_event (SKIPPED by the normalizer)
  seedStep(db, runId, {
    idx: 10,
    type: "context_event",
    label: "Final checkpoint",
    payload: { note: "done" },
  });
}

// ── (1) Normalization: every covered step type maps correctly, idx ordering is stable ────────────

test("traceFromRun maps all six run_steps types into the shared vocabulary, preserving idx", () => {
  const db = createDatabase();
  seedParents(db, "scn-1", "test-1");
  seedRun(db, "run-1", "scn-1", "test-1");
  seedAllSixStepTypes(db, "run-1");

  const runs = new RunRepository(db);
  const events = traceFromRun({ runs }, "run-1");

  // llm_request (idx 1) + context_event (idx 10) are skipped → 9 events, idx preserved with gaps.
  assert.deepEqual(
    events.map((e) => e.idx),
    [0, 2, 3, 4, 5, 6, 7, 8, 9],
    "run_steps.idx is preserved as the event idx (skipped types leave gaps)",
  );

  const byIdx = new Map(events.map((e) => [e.idx, e]));

  // user_message → user_message
  assert.deepEqual(byIdx.get(0), {
    type: "user_message",
    idx: 0,
    payload: { text: "Generate the report." },
  });

  // llm_response → turn (assistant role + text from the assistant_text column)
  assert.deepEqual(byIdx.get(2), {
    type: "turn",
    idx: 2,
    payload: { role: "assistant", text: "Reading the skill instructions." },
  });
  assert.deepEqual(byIdx.get(9), {
    type: "turn",
    idx: 9,
    payload: { role: "assistant", text: "Report complete." },
  });

  // read_skill_file tool_call → skill_file_read carrying { skill, path } parsed from the persisted args
  assert.deepEqual(byIdx.get(3), {
    type: "skill_file_read",
    idx: 3,
    payload: { skill: "data-report", path: "SKILL.md" },
  });
  assert.deepEqual(byIdx.get(5), {
    type: "skill_file_read",
    idx: 5,
    payload: { skill: "data-report", path: "reference/format-spec.md" },
  });

  // a non-skill tool_call → tool_call (name only; args omitted)
  assert.deepEqual(byIdx.get(7), { type: "tool_call", idx: 7, payload: { tool: "Bash" } });

  // tool_result → tool_result (tool + status + bytes; no exit code invented)
  assert.deepEqual(byIdx.get(4), {
    type: "tool_result",
    idx: 4,
    payload: { tool: "read_skill_file", status: "ok", bytes: 1450 },
  });
  assert.deepEqual(byIdx.get(8), {
    type: "tool_result",
    idx: 8,
    payload: { tool: "Bash", status: "error", bytes: 40 },
  });

  // Every produced event is schema-valid against the WP 1.0 trace-event vocabulary.
  for (const event of events) {
    assert.doesNotThrow(
      () => traceEventSchema.parse(event),
      `event idx ${event.idx} is schema-valid`,
    );
  }

  // No skipped type leaked through.
  assert.ok(
    !events.some((e) => e.idx === 1 || e.idx === 10),
    "llm_request + context_event are not emitted",
  );
});

// ── (2) run_skills rows written by the REAL run-service path when a scenario has attached skills ──

const USAGE = {
  inputTokens: { total: 40, noCache: 40, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 9, text: 9, reasoning: 0 },
} as const;

/** A one-turn model that just answers (no tool calls) — enough to drive a run to completion. */
function mockAnswer(): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "t1" },
          { type: "text-delta", id: "t1", delta: "Answer." },
          { type: "text-end", id: "t1" },
          { type: "finish", finishReason: { unified: "stop", raw: "end_turn" }, usage: USAGE },
        ] as LanguageModelV3StreamPart[],
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

/** Build a RunService over an in-memory DB with a mock model + stub session (no provider/MCP key). */
function makeRunService(db: AppDatabase, secrets: SecretStore) {
  const scans = new ScanRepository(db);
  const servers = new ServerRepository(db, secrets);
  const providers = new ProviderRepository(db, secrets);
  const oauthService = new OAuthService(servers, new OAuthRepository(db, secrets));
  const skills = new SkillRepository(db, secrets);
  const scenarioRepo = new ScenarioRepository(db);
  const scenarioService = new ScenarioService(scenarioRepo, scans, skills);
  const testService = new TestService(new TestRepository(db));
  const runRepo = new RunRepository(db);
  const runManager = new RunManager(runRepo);
  const modelFactory: ModelFactory = (_cred: DecryptedCredential) => mockAnswer();
  const sessionOpener: SessionOpener = async () => stubSession();
  const runService = new RunService(
    scenarioService,
    testService,
    providers,
    servers,
    oauthService,
    runManager,
    runRepo,
    modelFactory,
    sessionOpener,
    skills,
  );
  return { scanService: scans, skills, scenarioRepo, testService, runRepo, runService };
}

test("run-service writes run_skills rows for a scenario's attached skills (and none when there are none)", async () => {
  const db = createDatabase();
  const secrets = new SecretStore(crypto.randomBytes(32));
  db.prepare(
    `INSERT INTO provider_credentials (id, kind, label, base_url, api_key_encrypted, created_at, updated_at)
     VALUES ('prov-1', 'anthropic', 'Claude', NULL, @key, @now, @now)`,
  ).run({ key: secrets.encryptText("dummy-not-a-real-key"), now: NOW });

  const { skills, scenarioRepo, testService, runService } = makeRunService(db, secrets);

  // A skill with a current version.
  const skill = skills.create({ name: "data-report", sourceType: "upload" });
  const version = skills.createVersion(
    skill.id,
    [file("SKILL.md", "# Data report\n\n## Steps\n")],
    {
      sourceKind: "upload",
      importedFrom: "upload",
    },
  );
  assert.equal(version.unchanged, false);

  const withSkill = scenarioRepo.create({
    name: "With skill",
    providerId: "prov-1",
    model: "claude-sonnet-4",
    params: {},
    systemPrompt: "",
    allowedServers: [],
    allowedSkills: [{ skillId: skill.id, versionMode: "latest" }],
    defaultProfiles: ["generic_o200k"],
    guardrails: {},
    toolLoadingMode: "eager",
  });
  const noSkill = scenarioRepo.create({
    name: "No skill",
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
  const testRow = testService.create({
    name: "Report",
    userPrompt: "Go.",
    systemPromptOverride: undefined,
    addedProfiles: [],
  });

  // Drive the real run-service path (start → resolve → run loop → terminal) for the skill scenario.
  const withSkillRun = runService.start(testRow.id, withSkill.id, "automated");
  await withSkillRun.done;

  const rows = db
    .prepare("SELECT * FROM run_skills WHERE run_id = ?")
    .all(withSkillRun.runId) as Array<{
    skill_id: string;
    skill_version_id: string;
    version_label: string;
    eager: number;
  }>;
  assert.equal(rows.length, 1, "one run_skills row per resolved attachment");
  assert.equal(rows[0]?.skill_id, skill.id);
  assert.equal(
    rows[0]?.skill_version_id,
    (version as { version: { id: string } }).version.id,
    "records the concrete resolved version id",
  );
  assert.equal(
    rows[0]?.version_label,
    (version as { version: { versionLabel: string } }).version.versionLabel,
    "denormalized label recorded",
  );
  assert.equal(rows[0]?.eager, 0, "eager defaults to 0");

  // A scenario with no attached skills writes NO run_skills rows.
  const noSkillRun = runService.start(testRow.id, noSkill.id, "automated");
  await noSkillRun.done;
  const none = db
    .prepare("SELECT COUNT(*) AS n FROM run_skills WHERE run_id = ?")
    .get(noSkillRun.runId) as { n: number };
  assert.equal(none.n, 0, "a scenario with no skills writes no run_skills rows");
});

// ── (3) + (4) Routes: versions/:vid/runs and runs/:runId/trace ───────────────────────────────────

/** A Fastify app with ONLY the skillflow routes registered over the given repos + an error handler. */
async function makeRouteApp(
  skills: SkillRepository,
  runs: RunRepository,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ error: "Validation failed" });
    const typed = error as Error & { statusCode?: number };
    return reply.code(typed.statusCode ?? 500).send({ error: toErrorMessage(error) });
  });
  await registerSkillflowRoutes(app, skills, runs);
  apps.push(app);
  return app;
}

/** Seed a skill + a current version; return the ids. */
function seedSkillVersion(
  skills: SkillRepository,
  name: string,
): { skillId: string; versionId: string } {
  const skill = skills.create({ name, sourceType: "upload" });
  const created = skills.createVersion(skill.id, [file("SKILL.md", `# ${name}\n\n## Steps\n`)], {
    sourceKind: "upload",
    importedFrom: "upload",
  });
  return { skillId: skill.id, versionId: created.version.id };
}

test("GET /api/skills/:id/versions/:vid/runs returns the run that resolved the version, 404s on unknown", async () => {
  const db = createDatabase();
  const secrets = new SecretStore(Buffer.alloc(32, 7));
  const skills = new SkillRepository(db, secrets);
  const runs = new RunRepository(db);
  const { skillId, versionId } = seedSkillVersion(skills, "data-report");

  seedParents(db, "scn-1", "test-1");
  seedRun(db, "run-1", "scn-1", "test-1");
  db.prepare(
    `INSERT INTO run_skills (run_id, skill_id, skill_version_id, version_label, eager)
     VALUES ('run-1', @skillId, @versionId, 'v1', 0)`,
  ).run({ skillId, versionId });

  const app = await makeRouteApp(skills, runs);

  const ok = await app.inject({
    method: "GET",
    url: `/api/skills/${skillId}/versions/${versionId}/runs`,
  });
  assert.equal(ok.statusCode, 200);
  const list = ok.json() as RunSummary[];
  assert.equal(list.length, 1, "the seeded run is listed");
  assert.equal(list[0]?.id, "run-1");
  assert.equal(list[0]?.scenarioId, "scn-1", "returns the RunSummary shape");

  // Unknown version → 404.
  const missing = await app.inject({
    method: "GET",
    url: `/api/skills/${skillId}/versions/does-not-exist/runs`,
  });
  assert.equal(missing.statusCode, 404, "unknown version 404s");
});

test("GET /api/runs/:runId/trace returns schema-valid events; ambiguity + old runs handled", async () => {
  const db = createDatabase();
  const secrets = new SecretStore(Buffer.alloc(32, 8));
  const skills = new SkillRepository(db, secrets);
  const runs = new RunRepository(db);
  const a = seedSkillVersion(skills, "data-report");
  const b = seedSkillVersion(skills, "helper");

  seedParents(db, "scn-1", "test-1");

  // run-1: exactly ONE resolved skill version + the six-type step corpus.
  seedRun(db, "run-1", "scn-1", "test-1");
  seedAllSixStepTypes(db, "run-1");
  db.prepare(
    `INSERT INTO run_skills (run_id, skill_id, skill_version_id, version_label, eager)
     VALUES ('run-1', @skillId, @versionId, 'v1', 0)`,
  ).run({ skillId: a.skillId, versionId: a.versionId });

  // run-2: TWO resolved skill versions (ambiguous without ?skillVersionId=).
  seedRun(db, "run-2", "scn-1", "test-1");
  seedStep(db, "run-2", { idx: 0, type: "user_message", label: "u", payload: { text: "hi" } });
  db.prepare(
    `INSERT INTO run_skills (run_id, skill_id, skill_version_id, version_label, eager)
     VALUES ('run-2', @sa, @va, 'v1', 0), ('run-2', @sb, @vb, 'v1', 0)`,
  ).run({ sa: a.skillId, va: a.versionId, sb: b.skillId, vb: b.versionId });

  // run-old: a run with NO run_skills rows (predates WP 2.1 / no attached skills).
  seedRun(db, "run-old", "scn-1", "test-1");
  seedStep(db, "run-old", { idx: 0, type: "user_message", label: "u", payload: { text: "hi" } });

  const app = await makeRouteApp(skills, runs);

  // Single-skill run: 200 with schema-valid events + the implied skillVersionId.
  const single = await app.inject({ method: "GET", url: "/api/runs/run-1/trace" });
  assert.equal(single.statusCode, 200);
  const parsed = runTraceResponseSchema.parse(single.json());
  assert.equal(parsed.source, "run");
  assert.equal(parsed.ref, "run-1");
  assert.equal(parsed.skillVersionId, a.versionId, "implied from the only resolved version");
  assert.deepEqual(
    parsed.events.map((e: TraceEvent) => e.type),
    [
      "user_message",
      "turn",
      "skill_file_read",
      "tool_result",
      "skill_file_read",
      "tool_result",
      "tool_call",
      "tool_result",
      "turn",
    ],
    "the normalized event stream is schema-valid and correctly typed",
  );

  // Ambiguous multi-skill run without the query param → 400.
  const ambiguous = await app.inject({ method: "GET", url: "/api/runs/run-2/trace" });
  assert.equal(
    ambiguous.statusCode,
    400,
    "multiple resolved versions without ?skillVersionId= is a 400",
  );

  // …but disambiguating with the query param succeeds.
  const disambiguated = await app.inject({
    method: "GET",
    url: `/api/runs/run-2/trace?skillVersionId=${b.versionId}`,
  });
  assert.equal(disambiguated.statusCode, 200);
  assert.equal((disambiguated.json() as { skillVersionId: string }).skillVersionId, b.versionId);

  // A skillVersionId not resolved by the run → 400.
  const wrong = await app.inject({
    method: "GET",
    url: "/api/runs/run-1/trace?skillVersionId=not-a-version",
  });
  assert.equal(wrong.statusCode, 400, "a skillVersionId the run never resolved is a 400");

  // An old run with no run_skills → 404 with a clear reason.
  const old = await app.inject({ method: "GET", url: "/api/runs/run-old/trace" });
  assert.equal(old.statusCode, 404, "a run with no recorded skill versions 404s");

  // A genuinely unknown run → 404.
  const unknown = await app.inject({ method: "GET", url: "/api/runs/nope/trace" });
  assert.equal(unknown.statusCode, 404, "an unknown run 404s");
});
