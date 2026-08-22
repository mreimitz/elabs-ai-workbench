import assert from "node:assert/strict";
import crypto from "node:crypto";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import {
  CLAUDE_CLI_PROVIDER_ID,
  type ErrorFinding,
  type JudgeSettings,
  type RatingIssue,
  ratingIssueSchema,
  type RunDetail,
  type RunGrade,
  type RunSkill,
  type RunStep,
} from "@mcp-token-footprint/shared";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { applyMigrations, LATEST_SCHEMA_VERSION, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import type { GradeService } from "../src/grading/grade-service.js";
import {
  RatingIssueRepository,
  type RatingIssueOccurrenceInsert,
} from "../src/grading/issue-repository.js";
import { createIssuesMarkdownReport, registerRatingIssueRoutes } from "../src/grading/issue-routes.js";
import {
  buildTriagePrompt,
  findingDigest,
  maxSeverity,
  RatingIssueService,
  type RatingIssueServiceDeps,
} from "../src/grading/issue-service.js";
import type { JudgeGenerate } from "../src/grading/judge.js";
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

// Rating Issues registry — DISTINCT, deduplicated, persistent issues distilled from error_forensics
// findings. Everything here is offline: the judge is an injected stub (no provider/CLI is ever
// contacted), MCP sessions are stubs, and the DB is in-memory.

const NOW = "2026-07-12T00:00:00.000Z";
const PRICED_MODEL = "claude-sonnet-4"; // in the pricing table → isModelPriced true

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

function tableExists(db: AppDatabase, name: string): boolean {
  return (
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(name) !== undefined
  );
}

// ── Fixtures ───────────────────────────────────────────────────────────────────────────────────────

function makeRun(over: Partial<RunDetail> = {}): RunDetail {
  return {
    id: "run-1",
    testId: "t-1",
    scenarioId: "sc-1",
    mode: "automated",
    status: "error",
    startedAt: NOW,
    turns: 1,
    toolCalls: 0,
    peakContextTokens: 0,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    steps: [],
    events: [],
    skills: [],
    ...over,
  } as unknown as RunDetail;
}

function runSkill(over: Partial<RunSkill> = {}): RunSkill {
  return {
    skillId: "sk-1",
    name: "My Skill",
    versionLabel: "v3",
    skillVersionId: "skv-3",
    eager: false,
    footprint: null,
    disclosureReads: 0,
    disclosureTokens: 0,
    ...over,
  };
}

function toolStep(index: number, serverId: string): RunStep {
  return {
    id: `s${index}`,
    runId: "run-1",
    index,
    type: "tool_call",
    label: "search",
    status: "error",
    serverId,
    toolName: "search",
    profileTokens: {},
    payload: null,
  };
}

function makeFinding(over: Partial<ErrorFinding> = {}): ErrorFinding {
  return {
    id: "ef-0",
    description: "Tool call failed: search on srv-a.",
    category: "failed_tool_call",
    bucket: "mcp_server",
    fixTarget: "mcp_server",
    draftFix: "server: search rejects its own documented limit param",
    evidenceSteps: [1],
    evidenceEventIds: [],
    ...over,
  };
}

function forensicsGrade(runId: string, findings: ErrorFinding[]): RunGrade {
  return {
    id: `g-${runId}`,
    runId,
    graderId: "error_forensics",
    kind: "llm",
    status: "graded",
    score: 0.5,
    rawScore: findings.length,
    method: "error_forensics_v1",
    reasoning: null,
    evidence: findings,
    judgeProviderId: null,
    judgeModel: null,
    judgeTokensIn: 0,
    judgeTokensOut: 0,
    judgeCostUsd: 0,
    gradingVersion: 1,
    createdAt: NOW,
  };
}

/** A judge `generate` stub returning fixed JSON (or a raw string), recording call count + last prompt. */
function judgeStub(response: unknown): {
  generate: JudgeGenerate;
  calls: () => number;
  lastPrompt: () => string;
} {
  let calls = 0;
  let lastPrompt = "";
  const generate: JudgeGenerate = async (_settings, prompt) => {
    calls += 1;
    lastPrompt = prompt;
    return {
      text: typeof response === "string" ? response : JSON.stringify(response),
      usage: { inputTokens: 100, outputTokens: 20 },
    };
  };
  return { generate, calls: () => calls, lastPrompt: () => lastPrompt };
}

const providerJudge: JudgeSettings = { providerCredentialId: "prov-1", model: PRICED_MODEL };
const cliJudge: JudgeSettings = {
  providerCredentialId: CLAUDE_CLI_PROVIDER_ID,
  model: "claude-sonnet-4-5",
};

type ServiceOpts = {
  run: RunDetail;
  findings: ErrorFinding[];
  judge?: JudgeSettings | null;
  generate?: JudgeGenerate;
  serverNames?: Record<string, string>;
  allowedServers?: string[];
};

function makeService(
  db: AppDatabase,
  opts: ServiceOpts,
): { repo: RatingIssueRepository; service: RatingIssueService } {
  const repo = new RatingIssueRepository(db);
  const deps: RatingIssueServiceDeps = {
    issues: repo,
    runs: { getRun: () => opts.run },
    grades: { latestByGrader: (runId) => [forensicsGrade(runId, opts.findings)] },
    scenarios: {
      get: () => ({
        allowedServers: (opts.allowedServers ?? []).map((serverId) => ({ serverId })),
      }),
    },
    servers: {
      getPublic: (id) => {
        const name = opts.serverNames?.[id];
        if (!name) throw new Error("Server not found");
        return { name };
      },
    },
    resolveJudge: () => opts.judge ?? null,
    generate:
      opts.generate ??
      (async () => {
        throw new Error("generate must not be called in this test");
      }),
  };
  return { repo, service: new RatingIssueService(deps) };
}

// ── (1) Create-new, deterministic (no judge) ───────────────────────────────────────────────────────

test("no judge → deterministic new issue against the run's skill (templated title, medium severity)", async () => {
  const db = createDatabase();
  const run = makeRun({ skills: [runSkill()] });
  const finding = makeFinding({ bucket: "skill", fixTarget: "skill" });
  const { repo, service } = makeService(db, { run, findings: [finding], judge: null });

  await service.processRun(run.id);

  const issues = repo.listByTarget("skill", "sk-1");
  assert.equal(issues.length, 1, "one issue created");
  const issue = issues[0] as RatingIssue;
  assert.doesNotThrow(() => ratingIssueSchema.parse(issue), "wire-shape valid");
  assert.equal(issue.targetKind, "skill");
  assert.equal(issue.targetId, "sk-1");
  assert.equal(issue.targetName, "My Skill", "denormalized target name");
  assert.equal(issue.skillVersionId, "skv-3", "resolved skill version pinned");
  assert.equal(issue.title, "skill in My Skill", "templated <bucket> in <targetName> title");
  assert.equal(issue.severity, "medium", "deterministic fallback severity");
  assert.equal(issue.status, "open");
  assert.equal(issue.timesSeen, 1);
  assert.equal(issue.draftFix, finding.draftFix, "the finding's own draftFix is kept");
  assert.equal(issue.judgeProviderId, null, "no judge shaped this row");
  assert.equal(issue.occurrences.length, 1);
  assert.equal(issue.occurrences[0]?.runId, run.id, "the contributing run is linked");
});

test("occurrence carries the finding's concrete evidence (tool + sent args + exact error) and the triage prompt names it", async () => {
  const db = createDatabase();
  const run = makeRun({ steps: [toolStep(1, "srv-a")] });
  const finding = makeFinding({
    toolName: "search",
    sentArguments: JSON.stringify({ limit: "ten" }),
    errorMessage: "limit must be an integer",
  });
  const stub = judgeStub({
    matchIssueId: null,
    title: "search rejects a string limit",
    summary: "The tool was called with limit=\"ten\" but requires an integer.",
    draftFix: "pass an integer to `limit`",
    severity: "high",
  });
  const { repo, service } = makeService(db, {
    run,
    findings: [finding],
    judge: providerJudge,
    generate: stub.generate,
    serverNames: { "srv-a": "Search Server" },
  });

  await service.processRun(run.id);

  // The triage prompt saw the ACTUAL wrong call + exact error (so the judge can be specific).
  assert.match(stub.lastPrompt(), /arguments sent: .*limit.*ten/);
  assert.match(stub.lastPrompt(), /exact error: limit must be an integer/);

  const occurrence = repo.listByTarget("mcp_server", "srv-a")[0]?.occurrences[0];
  assert.ok(occurrence, "the issue has one occurrence");
  assert.equal(occurrence?.toolName, "search");
  assert.equal(occurrence?.sentArguments, JSON.stringify({ limit: "ten" }));
  assert.equal(occurrence?.errorMessage, "limit must be an integer");
});

test("deterministic dedup: a SECOND run with the same (bucket, fixTarget) folds into the existing issue", async () => {
  const db = createDatabase();
  const finding = makeFinding();
  const first = makeRun({ id: "run-1", steps: [toolStep(1, "srv-a")] });
  const opts = { findings: [finding], judge: null, serverNames: { "srv-a": "Alpha" } };
  const s1 = makeService(db, { ...opts, run: first });
  await s1.service.processRun("run-1");

  const second = makeRun({ id: "run-2", steps: [toolStep(1, "srv-a")], suiteRunId: "sr-9" });
  const s2 = makeService(db, { ...opts, run: second });
  await s2.service.processRun("run-2");

  const issues = s2.repo.listByTarget("mcp_server", "srv-a");
  assert.equal(issues.length, 1, "still ONE distinct issue");
  assert.equal(issues[0]?.timesSeen, 2, "second sighting counted");
  assert.equal(issues[0]?.occurrences.length, 2, "both runs linked");
  assert.deepEqual(
    issues[0]?.occurrences.map((o) => o.runId),
    ["run-1", "run-2"],
  );
  assert.equal(issues[0]?.occurrences[1]?.suiteRunId, "sr-9", "suite-run link carried");
});

// ── (2) Judge match → enhance + automatic re-open ──────────────────────────────────────────────────

test("judge match → enhance (timesSeen+1, improved summary/draftFix, max severity) + automatic re-open of a resolved issue", async () => {
  const db = createDatabase();
  const finding = makeFinding();
  const run1 = makeRun({ id: "run-1", steps: [toolStep(1, "srv-a")] });
  const seed = makeService(db, {
    run: run1,
    findings: [finding],
    judge: null,
    serverNames: { "srv-a": "Alpha" },
  });
  await seed.service.processRun("run-1");
  const seeded = seed.repo.listByTarget("mcp_server", "srv-a")[0] as RatingIssue;
  seed.repo.setStatus(seeded.id, "resolved");
  assert.ok(seed.repo.get(seeded.id).resolvedAt, "resolved stamps resolvedAt");

  const stub = judgeStub({
    matchIssueId: seeded.id,
    title: "search tool rejects its own limit param",
    summary: "The server's search tool rejects the documented limit argument.",
    draftFix: "server: accept limit as documented (integer 1-100).",
    severity: "high",
  });
  const run2 = makeRun({ id: "run-2", steps: [toolStep(1, "srv-a")] });
  const { repo, service } = makeService(db, {
    run: run2,
    findings: [finding],
    judge: providerJudge,
    generate: stub.generate,
    serverNames: { "srv-a": "Alpha" },
  });
  await service.processRun("run-2");

  assert.equal(stub.calls(), 1, "exactly ONE triage call for the finding-target pair");
  assert.ok(stub.lastPrompt().includes(seeded.id), "the prompt lists the existing issue's id");
  const issues = repo.listByTarget("mcp_server", "srv-a");
  assert.equal(issues.length, 1, "no duplicate issue");
  const issue = issues[0] as RatingIssue;
  assert.equal(issue.status, "open", "a resolved issue seen again RE-OPENS automatically");
  assert.equal(issue.resolvedAt, undefined, "re-open clears resolvedAt");
  assert.equal(issue.timesSeen, 2);
  assert.equal(issue.summary, "The server's search tool rejects the documented limit argument.");
  assert.equal(issue.draftFix, "server: accept limit as documented (integer 1-100).");
  assert.equal(issue.severity, "high", "max-wins severity raised by the judge");
  assert.equal(issue.judgeProviderId, "prov-1", "judge provenance stamped on the enhanced row");
  assert.equal(issue.judgeModel, PRICED_MODEL);
  assert.equal(issue.occurrences.length, 2, "the new run is linked");
});

test("judge INVENTED matchIssueId → treated as no-match: a NEW issue is created (never trust an unknown id)", async () => {
  const db = createDatabase();
  const finding = makeFinding();
  const run1 = makeRun({ id: "run-1", steps: [toolStep(1, "srv-a")] });
  const seed = makeService(db, {
    run: run1,
    findings: [finding],
    judge: null,
    serverNames: { "srv-a": "Alpha" },
  });
  await seed.service.processRun("run-1");

  const stub = judgeStub({
    matchIssueId: "totally-invented-id",
    title: "A judge-authored title",
    summary: "Judge summary.",
    draftFix: "Judge fix.",
    severity: "low",
  });
  // A DIFFERENT finding digest (different description) so the idempotency short-circuit doesn't hide the path.
  const other = makeFinding({ description: "MCP connection failure on srv-a: refused." });
  const run2 = makeRun({ id: "run-2", steps: [toolStep(1, "srv-a")] });
  const { repo, service } = makeService(db, {
    run: run2,
    findings: [other],
    judge: cliJudge, // the CLI judge is exempt from the pricing guard
    generate: stub.generate,
    serverNames: { "srv-a": "Alpha" },
  });
  await service.processRun("run-2");

  const issues = repo.listByTarget("mcp_server", "srv-a");
  assert.equal(issues.length, 2, "the invented id created a NEW issue, not a bogus enhance");
  const created = issues.find((i) => i.title === "A judge-authored title");
  assert.ok(created, "judge-authored fields used on the new issue");
  assert.equal(created?.severity, "low");
  assert.equal(created?.judgeProviderId, CLAUDE_CLI_PROVIDER_ID, "CLI provenance stamped");
});

test("unparseable judge response → deterministic fallback (the finding is never lost)", async () => {
  const db = createDatabase();
  const stub = judgeStub("I refuse to answer in JSON.");
  const run = makeRun({ id: "run-1", steps: [toolStep(1, "srv-a")] });
  const { repo, service } = makeService(db, {
    run,
    findings: [makeFinding()],
    judge: providerJudge,
    generate: stub.generate,
    serverNames: { "srv-a": "Alpha" },
  });
  await service.processRun("run-1");
  assert.equal(stub.calls(), 1);
  const issues = repo.listByTarget("mcp_server", "srv-a");
  assert.equal(issues.length, 1, "deterministic templated issue created despite judge garbage");
  assert.equal(issues[0]?.title, "mcp_server in Alpha");
  assert.equal(issues[0]?.judgeProviderId, null, "no judge provenance on a deterministic row");
});

// ── (3) Occurrence idempotency ─────────────────────────────────────────────────────────────────────

test("reprocessing the SAME run is a strict no-op (same run + digest → no judge call, no counter bump)", async () => {
  const db = createDatabase();
  const finding = makeFinding();
  const run = makeRun({ id: "run-1", steps: [toolStep(1, "srv-a")] });
  const stub = judgeStub({ matchIssueId: null, title: "x", summary: "y", draftFix: "z", severity: "low" });
  const opts: ServiceOpts = {
    run,
    findings: [finding],
    judge: null,
    serverNames: { "srv-a": "Alpha" },
  };
  const first = makeService(db, opts);
  await first.service.processRun("run-1");

  // Second pass has a CONFIGURED judge — the short-circuit must skip it entirely.
  const second = makeService(db, {
    ...opts,
    judge: providerJudge,
    generate: stub.generate,
  });
  await second.service.processRun("run-1");

  assert.equal(stub.calls(), 0, "idempotency short-circuit made NO judge call");
  const issues = second.repo.listByTarget("mcp_server", "srv-a");
  assert.equal(issues.length, 1);
  assert.equal(issues[0]?.timesSeen, 1, "timesSeen NOT double-counted");
  assert.equal(issues[0]?.occurrences.length, 1, "occurrence NOT duplicated");
});

test("repository addOccurrence is idempotent via the UNIQUE key (INSERT OR IGNORE)", () => {
  const db = createDatabase();
  const repo = new RatingIssueRepository(db);
  const occurrence: RatingIssueOccurrenceInsert = {
    runId: "run-1",
    findingDigest: "d1",
    category: "failed_tool_call",
    message: "boom",
  };
  const issue = repo.insert({
    targetKind: "mcp_server",
    targetId: "srv-a",
    targetName: "Alpha",
    title: "t",
    summary: "s",
    bucket: "mcp_server",
    fixTarget: "mcp_server",
    draftFix: "f",
    severity: "medium",
    ratingVersion: 1,
    occurrence,
  });
  assert.equal(repo.addOccurrence(issue.id, occurrence), false, "duplicate ignored");
  assert.equal(
    repo.addOccurrence(issue.id, { ...occurrence, findingDigest: "d2" }),
    true,
    "a different digest on the same run IS a new occurrence",
  );
  assert.equal(repo.listOccurrences(issue.id).length, 2);
});

// ── (4) Target resolution ──────────────────────────────────────────────────────────────────────────

test("mcp_server targets: tool-call steps' serverIds win; scenario.allowedServers is the no-evidence fallback; deleted server falls back to its id", async () => {
  const db = createDatabase();
  // (a) tool-step evidence: two distinct servers → two issues.
  const run = makeRun({ id: "run-1", steps: [toolStep(1, "srv-a"), toolStep(2, "srv-b")] });
  const { repo, service } = makeService(db, {
    run,
    findings: [makeFinding()],
    judge: null,
    serverNames: { "srv-a": "Alpha" }, // srv-b resolves to no name (deleted) → id fallback
    allowedServers: ["srv-ignored"],
  });
  await service.processRun("run-1");
  assert.equal(repo.listByTarget("mcp_server", "srv-a").length, 1);
  assert.equal(repo.listByTarget("mcp_server", "srv-b")[0]?.targetName, "srv-b", "id fallback name");
  assert.equal(repo.listByTarget("mcp_server", "srv-ignored").length, 0, "allow-list NOT used when evidence exists");

  // (b) no tool-step evidence → the scenario allow-list is the fallback.
  const run2 = makeRun({ id: "run-2", steps: [] });
  const fallback = makeService(db, {
    run: run2,
    findings: [makeFinding({ description: "MCP connection failure: refused." })],
    judge: null,
    serverNames: { "srv-c": "Gamma" },
    allowedServers: ["srv-c"],
  });
  await fallback.service.processRun("run-2");
  assert.equal(fallback.repo.listByTarget("mcp_server", "srv-c").length, 1, "allow-list fallback used");
});

test("a skill-target finding on a run with NO skills is skipped (no concrete target, no issue)", async () => {
  const db = createDatabase();
  const run = makeRun({ id: "run-1", skills: [] });
  const { repo, service } = makeService(db, {
    run,
    findings: [makeFinding({ bucket: "skill", fixTarget: "skill" })],
    judge: null,
  });
  await service.processRun("run-1");
  assert.equal(repo.listAll().length, 0, "no issue without a concrete target");
});

// ── (5) The service never throws ───────────────────────────────────────────────────────────────────

test("processRun is fully guarded: an exploding repository/reader never throws to the caller", async () => {
  const db = createDatabase();
  const service = new RatingIssueService({
    issues: new RatingIssueRepository(db),
    runs: {
      getRun: () => {
        throw new Error("run reader exploded");
      },
    },
    grades: { latestByGrader: () => [] },
    scenarios: { get: () => ({ allowedServers: [] }) },
    servers: { getPublic: () => ({ name: "x" }) },
    resolveJudge: () => null,
    generate: async () => {
      throw new Error("never");
    },
  });
  await assert.doesNotReject(() => service.processRun("run-x"));
});

// ── (6) Run-service hook (fires post-grading, never throws) ────────────────────────────────────────

const USAGE = {
  inputTokens: { total: 40, noCache: 40, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 9, text: 9, reasoning: 0 },
} as const;

type MockStreamResult = Awaited<ReturnType<NonNullable<MockLanguageModelV3["doStream"]>>>;
type LanguageModelV3StreamPart = MockStreamResult["stream"] extends ReadableStream<infer P>
  ? P
  : never;

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

function makeRunService(
  db: AppDatabase,
  secrets: SecretStore,
  grades: GradeService | undefined,
  issues: RatingIssueService | undefined,
) {
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
    grades,
    issues,
  );
  return { scenarioRepo, testService, runRepo, runService };
}

function seedProvider(db: AppDatabase, secrets: SecretStore): void {
  db.prepare(
    `INSERT INTO provider_credentials (id, kind, label, base_url, api_key_encrypted, created_at, updated_at)
     VALUES ('prov-1', 'anthropic', 'Claude', NULL, @key, @now, @now)`,
  ).run({ key: secrets.encryptText("dummy-not-a-real-key"), now: NOW });
}

function scenarioInput(name: string) {
  return {
    name,
    providerId: "prov-1",
    model: PRICED_MODEL,
    params: {},
    systemPrompt: "",
    allowedServers: [],
    allowedSkills: [],
    defaultProfiles: ["generic_o200k" as const],
    guardrails: {},
    toolLoadingMode: "eager" as const,
  };
}

test("run-service hook: processRun fires AFTER gradeRun on the settled run", async () => {
  const db = createDatabase();
  const secrets = new SecretStore(crypto.randomBytes(32));
  seedProvider(db, secrets);
  const order: string[] = [];
  const gradeSpy = {
    gradeRun: async () => {
      order.push("grade");
      return [];
    },
  } as unknown as GradeService;
  const issueSpy = {
    processRun: async (runId: string) => {
      order.push(`issues:${runId}`);
    },
  } as unknown as RatingIssueService;
  const { scenarioRepo, testService, runService } = makeRunService(db, secrets, gradeSpy, issueSpy);

  const scenario = scenarioRepo.create(scenarioInput("Sc"));
  const created = testService.create({ name: "T", userPrompt: "Go.", addedProfiles: [] });
  const run = runService.start(created.id, scenario.id, "automated");
  await run.done;

  assert.deepEqual(
    order,
    ["grade", `issues:${run.runId}`],
    "issue processing chained immediately AFTER grading",
  );
});

test("run-service hook is fully guarded: a THROWING issue service never breaks run completion", async () => {
  const db = createDatabase();
  const secrets = new SecretStore(crypto.randomBytes(32));
  seedProvider(db, secrets);
  const faulty = {
    processRun: async () => {
      throw new Error("issue service exploded");
    },
  } as unknown as RatingIssueService;
  const { scenarioRepo, testService, runRepo, runService } = makeRunService(
    db,
    secrets,
    undefined,
    faulty,
  );

  const scenario = scenarioRepo.create(scenarioInput("Sc"));
  const created = testService.create({ name: "T", userPrompt: "Go.", addedProfiles: [] });
  const run = runService.start(created.id, scenario.id, "automated");
  const result = await run.done; // must NOT reject
  assert.equal(result.status, "completed", "the run still completes despite the issues crash");
  assert.equal(runRepo.getSummary(run.runId).status, "completed");
});

// ── (7) Routes ─────────────────────────────────────────────────────────────────────────────────────

async function makeApp(db: AppDatabase): Promise<{ app: FastifyInstance; repo: RatingIssueRepository }> {
  const repo = new RatingIssueRepository(db);
  const app = Fastify({ logger: false });
  // Mirror index.ts's central error handler so ZodError → 400 and typed errors keep their statusCode.
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError)
      return reply.code(400).send({ error: "Validation failed", issues: error.issues });
    const typed = error as Error & { statusCode?: number };
    return reply.code(typed.statusCode ?? 500).send({ error: typed.message });
  });
  await registerRatingIssueRoutes(app, repo);
  apps.push(app);
  return { app, repo };
}

function seedIssue(repo: RatingIssueRepository, over: Partial<Parameters<RatingIssueRepository["insert"]>[0]> = {}) {
  return repo.insert({
    targetKind: "skill",
    targetId: "sk-1",
    targetName: "My Skill",
    skillVersionId: "skv-3",
    title: "SKILL.md omits the required fields param",
    summary: "The skill never tells the model to pass fields=… to acme_get_app.",
    bucket: "skill",
    fixTarget: "skill",
    draftFix: "add to SKILL.md: always pass fields=… to acme_get_app",
    severity: "high",
    ratingVersion: 1,
    occurrence: {
      runId: "run-1",
      findingDigest: "d1",
      category: "assertions_failed",
      message: "assertion failed",
    },
    ...over,
  });
}

test("routes: list + filters + per-target reads + 404", async () => {
  const db = createDatabase();
  const { app, repo } = await makeApp(db);
  const skillIssue = seedIssue(repo);
  const serverIssue = seedIssue(repo, {
    targetKind: "mcp_server",
    targetId: "srv-a",
    targetName: "Alpha",
    bucket: "mcp_server",
    fixTarget: "mcp_server",
    title: "search rejects limit",
  });
  repo.setStatus(serverIssue.id, "resolved");

  const all = await app.inject({ method: "GET", url: "/api/issues" });
  assert.equal(all.statusCode, 200);
  assert.equal((all.json() as { issues: RatingIssue[] }).issues.length, 2);

  const open = await app.inject({ method: "GET", url: "/api/issues?status=open" });
  assert.deepEqual(
    (open.json() as { issues: RatingIssue[] }).issues.map((i) => i.id),
    [skillIssue.id],
  );

  const byTarget = await app.inject({
    method: "GET",
    url: "/api/issues?targetKind=mcp_server&targetId=srv-a",
  });
  assert.deepEqual(
    (byTarget.json() as { issues: RatingIssue[] }).issues.map((i) => i.id),
    [serverIssue.id],
  );

  const skillView = await app.inject({ method: "GET", url: "/api/skills/sk-1/issues" });
  assert.equal((skillView.json() as { issues: RatingIssue[] }).issues.length, 1);
  const serverView = await app.inject({ method: "GET", url: "/api/servers/srv-a/issues" });
  const serverList = (serverView.json() as { issues: RatingIssue[] }).issues;
  assert.equal(serverList.length, 1);
  assert.equal(serverList[0]?.occurrences.length, 1, "occurrences included");

  const one = await app.inject({ method: "GET", url: `/api/issues/${skillIssue.id}` });
  assert.equal(one.statusCode, 200);
  assert.doesNotThrow(() => ratingIssueSchema.parse(one.json()));

  const missing = await app.inject({ method: "GET", url: "/api/issues/nope" });
  assert.equal(missing.statusCode, 404);

  const badFilter = await app.inject({ method: "GET", url: "/api/issues?targetKind=bogus" });
  assert.equal(badFilter.statusCode, 400, "invalid targetKind → zod 400");
});

test("routes: PATCH resolve stamps resolvedAt; PATCH open clears it (manual lifecycle)", async () => {
  const db = createDatabase();
  const { app, repo } = await makeApp(db);
  const issue = seedIssue(repo);

  const resolved = await app.inject({
    method: "PATCH",
    url: `/api/issues/${issue.id}`,
    payload: { status: "resolved" },
  });
  assert.equal(resolved.statusCode, 200);
  const resolvedBody = resolved.json() as RatingIssue;
  assert.equal(resolvedBody.status, "resolved");
  assert.ok(resolvedBody.resolvedAt, "resolvedAt stamped");

  const reopened = await app.inject({
    method: "PATCH",
    url: `/api/issues/${issue.id}`,
    payload: { status: "open" },
  });
  const reopenedBody = reopened.json() as RatingIssue;
  assert.equal(reopenedBody.status, "open");
  assert.equal(reopenedBody.resolvedAt, undefined, "re-open clears resolvedAt");

  const bad = await app.inject({
    method: "PATCH",
    url: `/api/issues/${issue.id}`,
    payload: { status: "wontfix" },
  });
  assert.equal(bad.statusCode, 400, "unknown status → zod 400");
});

test("routes: markdown + json exports carry attachment headers and the issue content", async () => {
  const db = createDatabase();
  const { app, repo } = await makeApp(db);
  const issue = seedIssue(repo);
  repo.addOccurrence(issue.id, {
    runId: "run-2",
    findingDigest: "d2",
    category: "assertions_failed",
    message: "again",
  });

  const md = await app.inject({
    method: "GET",
    url: "/api/issues/export/markdown?targetKind=skill&targetId=sk-1",
  });
  assert.equal(md.statusCode, 200);
  assert.match(md.headers["content-type"] as string, /text\/markdown/);
  assert.match(md.headers["content-disposition"] as string, /attachment; filename="rating-issues-skill-sk-1\.md"/);
  assert.ok(md.body.includes("# Rating issues — My Skill"), "title carries the denormalized name");
  assert.ok(md.body.includes(issue.title), "issue title present");
  assert.ok(md.body.includes("### Draft fix"), "draft fix section present");
  assert.ok(md.body.includes("`run-1`") && md.body.includes("`run-2`"), "linked run ids present");

  const json = await app.inject({
    method: "GET",
    url: "/api/issues/export/json?targetKind=skill&targetId=sk-1",
  });
  assert.equal(json.statusCode, 200);
  assert.match(json.headers["content-disposition"] as string, /attachment; filename="rating-issues-skill-sk-1\.json"/);
  const payload = json.json() as { target: { kind: string; name: string }; issues: RatingIssue[] };
  assert.equal(payload.target.kind, "skill");
  assert.equal(payload.target.name, "My Skill");
  assert.equal(payload.issues.length, 1);
  assert.equal(payload.issues[0]?.occurrences.length, 2);

  const missingQuery = await app.inject({ method: "GET", url: "/api/issues/export/markdown" });
  assert.equal(missingQuery.statusCode, 400, "export without a target → zod 400");

  // An empty target still produces an honest document (no broken export).
  const emptyMd = createIssuesMarkdownReport("mcp_server", "srv-none", []);
  assert.ok(emptyMd.includes("No rating issues recorded"), "empty-state line present");
});

// ── (8) Migration v26 ──────────────────────────────────────────────────────────────────────────────

test("migration v26 — fresh DB stamps LATEST (55) and carries rating_issues + rating_issue_occurrences", () => {
  const db = createDatabase();
  applyMigrations(db);
  assert.equal(
    LATEST_SCHEMA_VERSION,
    62,
    "LATEST_SCHEMA_VERSION auto-derived to 62 (v27 = rating_state; v28 = provider_credentials claude_subscription kind; v29 = runs.cost_basis; v30 = rating_issue_occurrences concrete evidence; v31 = unified-sessions runs columns; v32 = observability metrics indexes; v33 = observability FTS5 search index; v34 = run_views; v35 = runs.pinned; v36 = run_feedback; v37 = run_steps hierarchy; v38 = watch_rules; v39 = watch_rules.last_evaluated_at; v40 = notifications; v41 = fleet issue aggregation; v42 = runs fork lineage; v43 = digest reports; v44 = model pricing; v45 = dashboard charts; v46 = review_rubrics; v47 = hub_* tables, Assistant Hub WP0.2; v48 = hub_session_skills, Assistant Hub WP2.4; v49 = hub_memory.scope/scope_id + hub_agents.display_name + hub_crews.color + hub_sessions.archived_at, Assistant Hub UX WP1.0s; v50 = hub_sessions.tool_scope_json, end-user UX pass; v54 = hub_missions.parent_mission_id/depth/root_mission_id, crew-nesting mission-tree lineage; v55 = hub_sessions/hub_agents.provider_credential_id, model identity D-MI1; v56 = the acme_answers provider kind removed (purge + narrowed kind CHECK, mcp_server_id + scenarios.answers_mode dropped); v57 = notification/digest deep-link repair (stale /assistant/s/ + /testing/observability/issues/ paths rewritten); v58 = api_tokens, service tokens for headless/CI callers, planning/Roadmap/RM-08-ci WP 1.1; v59 = runs.cache_read_tokens/cache_write_tokens, the prompt-cache split on the run row, planning/Roadmap/RM-33-cache-aware-token-accounting WP 1.2; v60 = grade_feedback, human verdicts ON grades + the derived calibration set, planning/Roadmap/RM-07-benchmarks WP 6.1; v61 = watch_rules.paused_until + min_interval_minutes, watch-rule pause + on-terminal renotification interval, planning/Roadmap/RM-17-observability Phase 6 AM-OB10; v62 = skill_box_positions, canvas box positions kept APP-SIDE per skill so a position comment never inflates the metered SKILL.md body, planning/Roadmap/RM-30-ux-overhaul WP 7.8 decision 5)",
  );
  assert.equal(db.pragma("user_version", { simple: true }), 62, "fresh DB stamped at 62");
  assert.ok(tableExists(db, "rating_issues"));
  assert.ok(tableExists(db, "rating_issue_occurrences"));
  // v30 — the concrete-evidence columns exist on a fresh DB (schema.ts baseline).
  const cols = (db.pragma("table_info(rating_issue_occurrences)") as { name: string }[]).map(
    (c) => c.name,
  );
  for (const col of ["tool_name", "sent_arguments", "error_message"]) {
    assert.ok(cols.includes(col), `fresh rating_issue_occurrences has ${col}`);
  }
});

test("migration v26 — a pre-v26 DB (stamped 25, no tables) is brought forward additively", () => {
  const db = new Database(":memory:");
  databases.push(db);
  db.pragma("user_version = 25"); // a MINIMAL fixture: nothing but the version stamp (the v19/v24 guard pattern)
  assert.ok(!tableExists(db, "rating_issues"));
  applyMigrations(db);
  assert.equal(db.pragma("user_version", { simple: true }), 62, "stamped forward to LATEST (62)");
  assert.ok(tableExists(db, "rating_issues"), "v26 created rating_issues");
  assert.ok(tableExists(db, "rating_issue_occurrences"), "v26 created rating_issue_occurrences");
});

test("migration v30 — a pre-v30 occurrences table (no evidence columns) gains them, existing rows preserved", () => {
  const db = new Database(":memory:");
  databases.push(db);
  // Recreate the pre-v30 shape: the v26 table WITHOUT tool_name/sent_arguments/error_message, stamped 29.
  db.exec(`
    CREATE TABLE rating_issue_occurrences (
      id TEXT PRIMARY KEY, issue_id TEXT NOT NULL, run_id TEXT NOT NULL, suite_run_id TEXT,
      finding_digest TEXT NOT NULL, category TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL,
      UNIQUE (issue_id, run_id, finding_digest)
    );
    INSERT INTO rating_issue_occurrences (id, issue_id, run_id, finding_digest, category, message, created_at)
      VALUES ('o1', 'i1', 'r1', 'd1', 'failed_tool_call', 'legacy', '2026-01-01T00:00:00.000Z');
  `);
  db.pragma("user_version = 29");

  applyMigrations(db as unknown as AppDatabase);

  assert.equal(db.pragma("user_version", { simple: true }), 62, "stamped forward to LATEST (62)");
  const cols = (db.pragma("table_info(rating_issue_occurrences)") as { name: string }[]).map(
    (c) => c.name,
  );
  for (const col of ["tool_name", "sent_arguments", "error_message"]) {
    assert.ok(cols.includes(col), `v30 added ${col}`);
  }
  const row = db
    .prepare("SELECT message, tool_name FROM rating_issue_occurrences WHERE id = 'o1'")
    .get() as { message: string; tool_name: string | null };
  assert.equal(row.message, "legacy", "the pre-v30 occurrence row survives the additive migration");
  assert.equal(row.tool_name, null, "its new evidence columns default to NULL");
});

// ── (9) Pure helpers ───────────────────────────────────────────────────────────────────────────────

test("findingDigest is stable across whitespace/case noise and distinct across buckets", () => {
  const a = makeFinding({ description: "Tool  call FAILED:  search on srv-a." });
  const b = makeFinding({ description: "tool call failed: search on srv-a." });
  assert.equal(findingDigest(a), findingDigest(b), "normalized message → same digest");
  const c = makeFinding({ bucket: "skill" });
  assert.notEqual(findingDigest(makeFinding()), findingDigest(c), "bucket participates in the digest");
});

test("maxSeverity is max-wins; buildTriagePrompt bounds content and demands raw JSON", () => {
  assert.equal(maxSeverity("low", "high"), "high");
  assert.equal(maxSeverity("high", "medium"), "high");
  assert.equal(maxSeverity("medium", "medium"), "medium");

  const long = "x".repeat(2000);
  const prompt = buildTriagePrompt(
    makeFinding({ description: long }),
    { kind: "mcp_server", id: "srv-a", name: "Alpha" },
    [],
  );
  assert.ok(prompt.includes("ONLY a raw JSON object"), "raw-JSON instruction present");
  assert.ok(prompt.length < long.length + 2500, "finding content is bounded in the prompt");
  assert.ok(prompt.includes("(none yet)"), "empty candidate list rendered honestly");
});
