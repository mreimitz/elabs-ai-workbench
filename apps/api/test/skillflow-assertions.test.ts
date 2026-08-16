import assert from "node:assert/strict";
import crypto from "node:crypto";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import { ZodError } from "zod";
import type {
  AssertionResult,
  SkillGraph,
  SkillGraphEdge,
  SkillGraphNode,
  TestAssertions,
  TraceAlignment,
  TraceVerdict,
  TraceVerdictConfidence,
  TraceVerdictStatus,
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
import { evaluateAssertions, type SkillAlignment } from "../src/skillflow/assertions.js";
import { projectSkillGraph } from "../src/skillflow/projector.js";
import { RunManager } from "../src/testing/run-manager.js";
import { RunRepository } from "../src/testing/run-repository.js";
import { RunService, type ModelFactory, type SessionOpener } from "../src/testing/run-service.js";
import { ScenarioRepository } from "../src/testing/scenario-repository.js";
import { ScenarioService } from "../src/testing/scenario-service.js";
import { TestRepository } from "../src/testing/test-repository.js";
import { TestService } from "../src/testing/test-service.js";

type MockStreamResult = Awaited<ReturnType<NonNullable<MockLanguageModelV3["doStream"]>>>;
type LanguageModelV3StreamPart = MockStreamResult["stream"] extends ReadableStream<infer P>
  ? P
  : never;

const databases: AppDatabase[] = [];
afterEach(() => {
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

// ── Synthetic-graph/alignment builders (unit matrix — no projector needed) ────────────────────────

function graph(nodes: SkillGraphNode[], edges: SkillGraphEdge[] = []): SkillGraph {
  return { nodes, edges, warnings: [] };
}

function subroutine(id: string): SkillGraphNode {
  return {
    id,
    kind: "subroutine",
    label: id,
    anchor: { headingPath: [id], startLine: 1, endLine: 1 },
    source: "inferred",
  };
}
function gatekeeper(id: string): SkillGraphNode {
  return {
    id,
    kind: "gatekeeper",
    label: id,
    anchor: { headingPath: [id], startLine: 1, endLine: 1 },
    source: "inferred",
  };
}
function gate(id: string, script = `scripts/${id}.py`): SkillGraphNode {
  return {
    id,
    kind: "validation_gate",
    label: id,
    anchor: { headingPath: [id], startLine: 1, endLine: 1 },
    source: "inferred",
    script,
    expectation: "exit 0",
  };
}
function edge(id: string, from: string, to: string, condition?: string): SkillGraphEdge {
  return { id, from, to, ...(condition ? { condition } : {}) };
}

function verdict(
  nodeId: string,
  status: TraceVerdictStatus,
  opts: { evidence?: number[]; confidence?: TraceVerdictConfidence } = {},
): TraceVerdict {
  return {
    nodeId,
    status,
    reason: `${nodeId}:${status}`,
    evidence: opts.evidence ?? [],
    ...(opts.confidence ? { confidence: opts.confidence } : {}),
  };
}

function alignment(
  verdicts: TraceVerdict[],
  edgeTraversals: Record<string, number> = {},
): TraceAlignment {
  return {
    nodeVisits: {},
    edgeTraversals,
    verdicts,
    unmatchedEvents: [],
    projectorVersion: 1,
    alignerVersion: 2,
  };
}

function align(g: SkillGraph, a: TraceAlignment, versionId = "v1"): SkillAlignment {
  return { versionId, graph: g, alignment: a };
}

function statusesOf(results: AssertionResult[]): string[] {
  return results.map((r) => r.status);
}

// ── (1) Evaluation matrix — skillGates ────────────────────────────────────────────────────────────

test("skillGate expect:'visited' — pass for a visited/fractured node, fail for unvisited", () => {
  const g = graph([subroutine("s1"), gate("g1")]);
  const a = alignment([verdict("s1", "ok"), verdict("g1", "unvisited")]);
  const map = new Map<string, SkillAlignment>([["skill-a", align(g, a)]]);

  const results = evaluateAssertions(
    {
      skillGates: [
        { skillId: "skill-a", nodeId: "s1", expect: "visited" }, // ok → visited → pass
        { skillId: "skill-a", nodeId: "g1", expect: "visited" }, // unvisited → fail
      ],
    },
    map,
  );
  assert.deepEqual(statusesOf(results), ["pass", "fail"]);

  // A fractured node is still "visited".
  const fractured = evaluateAssertions(
    { skillGates: [{ skillId: "skill-a", nodeId: "g1", expect: "visited" }] },
    new Map([["skill-a", align(g, alignment([verdict("g1", "fracture")]))]]),
  );
  assert.equal(fractured[0]?.status, "pass", "a fracture verdict is not `unvisited`");
});

test("skillGate expect:'pass' — pass only on `ok`; fracture and (merely) unvisited gate fail", () => {
  const g = graph([gate("g1"), subroutine("s1")]);
  const map = new Map<string, SkillAlignment>([
    [
      "skill-a",
      align(
        g,
        alignment([
          verdict("g1", "ok", { confidence: "exact", evidence: [4] }),
          verdict("s1", "ok"),
        ]),
      ),
    ],
  ]);
  const okResults = evaluateAssertions(
    { skillGates: [{ skillId: "skill-a", nodeId: "g1", expect: "pass" }] },
    map,
  );
  assert.equal(okResults[0]?.status, "pass");
  assert.equal(okResults[0]?.confidence, "exact", "confidence propagates from the verdict");
  assert.deepEqual(okResults[0]?.evidence, [4], "evidence propagates from the verdict");

  // A validation_gate that is merely `unvisited` must NOT pass (D: not silently passed).
  const unvisited = evaluateAssertions(
    { skillGates: [{ skillId: "skill-a", nodeId: "g1", expect: "pass" }] },
    new Map([["skill-a", align(g, alignment([verdict("g1", "unvisited")]))]]),
  );
  assert.equal(unvisited[0]?.status, "fail", "an unvisited gate fails an expect:pass");

  // A fractured gate fails.
  const fractured = evaluateAssertions(
    { skillGates: [{ skillId: "skill-a", nodeId: "g1", expect: "pass" }] },
    new Map([["skill-a", align(g, alignment([verdict("g1", "fracture")]))]]),
  );
  assert.equal(fractured[0]?.status, "fail");
});

test("skillGate expect:'pass' works for a non-gate node (subroutine ok → pass)", () => {
  const g = graph([subroutine("s1")]);
  const results = evaluateAssertions(
    { skillGates: [{ skillId: "skill-a", nodeId: "s1", expect: "pass" }] },
    new Map([["skill-a", align(g, alignment([verdict("s1", "ok")]))]]),
  );
  assert.equal(results[0]?.status, "pass");
});

test("skillGate unevaluable — wrong skill (not attached) and unknown node id", () => {
  const g = graph([subroutine("s1")]);
  const map = new Map<string, SkillAlignment>([
    ["skill-a", align(g, alignment([verdict("s1", "ok")]))],
  ]);

  const wrongSkill = evaluateAssertions(
    { skillGates: [{ skillId: "skill-ZZZ", nodeId: "s1", expect: "pass" }] },
    map,
  );
  assert.equal(wrongSkill[0]?.status, "unevaluable");
  assert.match(wrongSkill[0]?.reason ?? "", /not attached/);

  const unknownNode = evaluateAssertions(
    { skillGates: [{ skillId: "skill-a", nodeId: "does-not-exist", expect: "pass" }] },
    map,
  );
  assert.equal(unknownNode[0]?.status, "unevaluable");
  assert.match(unknownNode[0]?.reason ?? "", /not in skill/);
});

// ── (2) Evaluation matrix — skillRoutes ───────────────────────────────────────────────────────────

test("skillRoute — pass when the edge was traversed, fail when it was not", () => {
  const g = graph(
    [gatekeeper("gk"), subroutine("a"), subroutine("b")],
    [edge("e-csv", "gk", "a", "csv"), edge("e-json", "gk", "b", "json")],
  );
  const a = alignment([verdict("gk", "ok")], { "e-csv": 1 });
  const map = new Map<string, SkillAlignment>([["skill-a", align(g, a)]]);

  const taken = evaluateAssertions(
    { skillRoutes: [{ skillId: "skill-a", gatekeeperId: "gk", expectedEdgeId: "e-csv" }] },
    map,
  );
  assert.equal(taken[0]?.status, "pass");

  const notTaken = evaluateAssertions(
    { skillRoutes: [{ skillId: "skill-a", gatekeeperId: "gk", expectedEdgeId: "e-json" }] },
    map,
  );
  assert.equal(notTaken[0]?.status, "fail");
  assert.match(notTaken[0]?.reason ?? "", /never taken/);
});

test("skillRoute unevaluable — unknown gatekeeper, unknown edge, and edge not owned by the gatekeeper", () => {
  const g = graph(
    [gatekeeper("gk"), gatekeeper("gk2"), subroutine("a")],
    [edge("e-a", "gk", "a"), edge("e-other", "gk2", "a")],
  );
  const map = new Map<string, SkillAlignment>([["skill-a", align(g, alignment([]))]]);

  const unknownGk = evaluateAssertions(
    { skillRoutes: [{ skillId: "skill-a", gatekeeperId: "nope", expectedEdgeId: "e-a" }] },
    map,
  );
  assert.equal(unknownGk[0]?.status, "unevaluable");
  assert.match(unknownGk[0]?.reason ?? "", /gatekeeper/);

  const unknownEdge = evaluateAssertions(
    { skillRoutes: [{ skillId: "skill-a", gatekeeperId: "gk", expectedEdgeId: "no-edge" }] },
    map,
  );
  assert.equal(unknownEdge[0]?.status, "unevaluable");
  assert.match(unknownEdge[0]?.reason ?? "", /edge .* is not in skill/);

  // The edge exists but belongs to a DIFFERENT gatekeeper → misconfiguration → unevaluable.
  const notOwned = evaluateAssertions(
    { skillRoutes: [{ skillId: "skill-a", gatekeeperId: "gk", expectedEdgeId: "e-other" }] },
    map,
  );
  assert.equal(notOwned[0]?.status, "unevaluable");
  assert.match(notOwned[0]?.reason ?? "", /not an outgoing edge/);
});

// ── (3) Evaluation matrix — noFractures ───────────────────────────────────────────────────────────

test("noFractures — pass with no fractures, fail across skills, unevaluable on an empty map", () => {
  const g1 = graph([subroutine("s1"), gate("g1")]);
  const clean = new Map<string, SkillAlignment>([
    ["skill-a", align(g1, alignment([verdict("s1", "ok"), verdict("g1", "ok")]))],
  ]);
  const pass = evaluateAssertions({ noFractures: true }, clean);
  assert.equal(pass[0]?.status, "pass");
  assert.match(pass[0]?.reason ?? "", /no fractures/);

  const g2 = graph([gate("g2")]);
  const withFracture = new Map<string, SkillAlignment>([
    ["skill-a", align(g1, alignment([verdict("s1", "ok"), verdict("g1", "ok")]))],
    [
      "skill-b",
      align(g2, alignment([verdict("g2", "fracture", { evidence: [7], confidence: "exact" })])),
    ],
  ]);
  const fail = evaluateAssertions({ noFractures: true }, withFracture);
  assert.equal(fail[0]?.status, "fail");
  assert.match(fail[0]?.reason ?? "", /skill-b/);
  assert.deepEqual(fail[0]?.evidence, [7]);
  assert.equal(fail[0]?.confidence, "exact");

  const empty = evaluateAssertions({ noFractures: true }, new Map());
  assert.equal(empty[0]?.status, "unevaluable");
});

test("evaluateAssertions preserves declaration order (gates, routes, noFractures) and skips absent kinds", () => {
  const g = graph([subroutine("s1"), gatekeeper("gk")], [edge("e", "gk", "s1")]);
  const map = new Map<string, SkillAlignment>([
    ["skill-a", align(g, alignment([verdict("s1", "ok"), verdict("gk", "ok")], { e: 1 }))],
  ]);
  const results = evaluateAssertions(
    {
      skillGates: [{ skillId: "skill-a", nodeId: "s1", expect: "visited" }],
      skillRoutes: [{ skillId: "skill-a", gatekeeperId: "gk", expectedEdgeId: "e" }],
      noFractures: true,
    },
    map,
  );
  assert.deepEqual(
    results.map((r) => r.assertion.kind),
    ["skillGate", "skillRoute", "noFractures"],
  );
  assert.deepEqual(statusesOf(results), ["pass", "pass", "pass"]);
  // noFractures:false / undefined produces NO result.
  assert.equal(evaluateAssertions({}, map).length, 0);
});

// ── (4) CRUD round-trip of assertions on a test (zod reject malformed) ─────────────────────────────

test("test CRUD persists + round-trips assertions; malformed shapes are rejected (zod → 400)", () => {
  const db = createDatabase();
  const repo = new TestRepository(db);

  const assertions: TestAssertions = {
    skillGates: [{ skillId: "s", nodeId: "gate-x", expect: "pass" }],
    skillRoutes: [{ skillId: "s", gatekeeperId: "gk", expectedEdgeId: "e-1" }],
    noFractures: true,
  };
  const created = repo.create({ name: "T", userPrompt: "Go.", addedProfiles: [], assertions });
  assert.deepEqual(created.assertions, assertions, "assertions round-trip on create");

  const reloaded = repo.get(created.id);
  assert.deepEqual(reloaded.assertions, assertions, "assertions round-trip on read");

  // Update can change/clear assertions.
  const updated = repo.update(created.id, { name: "T", userPrompt: "Go.", addedProfiles: [] });
  assert.equal(updated.assertions, undefined, "clearing assertions round-trips to undefined");

  // Malformed: an invalid `expect` value.
  assert.throws(
    () =>
      repo.create({
        name: "Bad",
        userPrompt: "Go.",
        addedProfiles: [],
        // @ts-expect-error — deliberately malformed for the zod-rejection test
        assertions: { skillGates: [{ skillId: "s", nodeId: "n", expect: "maybe" }] },
      }),
    (error: unknown) => error instanceof ZodError,
  );

  // Malformed: a skillGate missing its nodeId.
  assert.throws(
    () =>
      repo.create({
        name: "Bad2",
        userPrompt: "Go.",
        addedProfiles: [],
        // @ts-expect-error — deliberately malformed for the zod-rejection test
        assertions: { skillGates: [{ skillId: "s", expect: "pass" }] },
      }),
    (error: unknown) => error instanceof ZodError,
  );
});

// ── (5) Run-completion wiring (real run-service + mock model) ──────────────────────────────────────

const USAGE = {
  inputTokens: { total: 40, noCache: 40, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 9, text: 9, reasoning: 0 },
} as const;

/** One-turn model that just answers (no tool calls / skill reads) — drives a run to `completed`. */
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
  return { skills, scenarioRepo, testService, runRepo, runService };
}

/** A SKILL.md whose "Validate" section infers a `validation_gate` for `scripts/check.py`. */
const GATE_SKILL_MD = [
  "# Data report",
  "",
  "## Steps",
  "Produce the report.",
  "",
  "## Validate",
  "Run `scripts/check.py` to verify the output. The script must exit 0 before finishing.",
  "",
].join("\n");

/** The projected graph of a version's SKILL.md (reads the text blob, projects it). */
function projectVersion(skills: SkillRepository, versionId: string): SkillGraph {
  const content = skills.getFileContent(versionId, "SKILL.md");
  const text = content.isBinary ? "" : content.text;
  return projectSkillGraph(text, skills.listFiles(versionId));
}

function seedProvider(db: AppDatabase, secrets: SecretStore): void {
  db.prepare(
    `INSERT INTO provider_credentials (id, kind, label, base_url, api_key_encrypted, created_at, updated_at)
     VALUES ('prov-1', 'anthropic', 'Claude', NULL, @key, @now, @now)`,
  ).run({ key: secrets.encryptText("dummy-not-a-real-key"), now: NOW });
}

test("a completed run with a FAILING gate assertion persists results + flips outcome to assertions_failed", async () => {
  const db = createDatabase();
  const secrets = new SecretStore(crypto.randomBytes(32));
  seedProvider(db, secrets);
  const { skills, scenarioRepo, testService, runRepo, runService } = makeRunService(db, secrets);

  const skill = skills.create({ name: "data-report", sourceType: "upload" });
  const created = skills.createVersion(
    skill.id,
    [file("SKILL.md", GATE_SKILL_MD), file("scripts/check.py", "print('ok')\n")],
    { sourceKind: "upload", importedFrom: "upload" },
  );
  const versionId = created.version.id;

  // Discover the projected validation_gate node id (the run reads nothing, so it stays unvisited).
  const projected = projectVersion(skills, versionId);
  const gateNode = projected.nodes.find((n) => n.kind === "validation_gate");
  assert.ok(gateNode, "SKILL.md projects a validation_gate node");

  const scenario = scenarioRepo.create({
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

  const testRow = testService.create({
    name: "Gate test",
    userPrompt: "Go.",
    addedProfiles: [],
    assertions: {
      skillGates: [{ skillId: skill.id, nodeId: gateNode!.id, expect: "pass" }],
      noFractures: true,
    },
  });

  const run = runService.start(testRow.id, scenario.id, "automated");
  await run.done;

  const summary = runRepo.getSummary(run.runId);
  assert.equal(summary.status, "completed", "run completed");
  // OWNER DECISION 2026-07-03 (WP 5.1 follow-up): a completed run with ≥1 FAILED assertion flips
  // `outcome` to the additive `assertions_failed` (was left as `completed` before this change).
  assert.equal(
    summary.outcome,
    "assertions_failed",
    "a failed assertion flips outcome to assertions_failed",
  );

  const results = summary.assertionResults;
  assert.ok(results, "assertion results were persisted");
  assert.equal(results!.length, 2);
  const gateResult = results!.find((r) => r.assertion.kind === "skillGate");
  const noFracturesResult = results!.find((r) => r.assertion.kind === "noFractures");
  // The gate was never reached (no script_result) → expect:pass fails.
  assert.equal(gateResult?.status, "fail", "an unvisited gate fails expect:pass");
  // A trace of pure turns has no fractures.
  assert.equal(noFracturesResult?.status, "pass", "no fractures in a clean trace");

  // The additive column is also visible on the detail read.
  const detail = runRepo.getRun(run.runId);
  assert.equal(detail.assertionResults?.length, 2);
  assert.equal(
    detail.outcome,
    "assertions_failed",
    "the flipped outcome is visible on the detail read",
  );
});

test("a completed run whose assertions all PASS keeps outcome 'completed'", async () => {
  const db = createDatabase();
  const secrets = new SecretStore(crypto.randomBytes(32));
  seedProvider(db, secrets);
  const { skills, scenarioRepo, testService, runRepo, runService } = makeRunService(db, secrets);

  const skill = skills.create({ name: "data-report", sourceType: "upload" });
  const created = skills.createVersion(
    skill.id,
    [file("SKILL.md", GATE_SKILL_MD), file("scripts/check.py", "print('ok')\n")],
    { sourceKind: "upload", importedFrom: "upload" },
  );
  const versionId = created.version.id;
  const gateNode = projectVersion(skills, versionId).nodes.find(
    (n) => n.kind === "validation_gate",
  );
  assert.ok(gateNode);

  const scenario = scenarioRepo.create({
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

  // Declare only assertions that resolve to pass/unevaluable (NO fail) to prove the flip does NOT
  // fire: `noFractures` passes on the clean pure-turn trace; a skillGate targeting a skill that is
  // NOT attached to the run is `unevaluable` (never a silent pass/fail).
  const testRow = testService.create({
    name: "Passing test",
    userPrompt: "Go.",
    addedProfiles: [],
    assertions: {
      skillGates: [{ skillId: "not-attached", nodeId: gateNode!.id, expect: "pass" }],
      noFractures: true,
    },
  });

  const run = runService.start(testRow.id, scenario.id, "automated");
  await run.done;

  const summary = runRepo.getSummary(run.runId);
  assert.equal(summary.status, "completed", "run completed");
  // Only a `pass` (noFractures) + an `unevaluable` (non-attached skillGate) — NO `fail` → no flip.
  assert.equal(
    summary.outcome,
    "completed",
    "passing/unevaluable-only assertions leave outcome 'completed'",
  );
  const statuses = (summary.assertionResults ?? []).map((r) => r.status).sort();
  assert.deepEqual(statuses, ["pass", "unevaluable"], "one pass + one unevaluable, no fail");
});

test("an engine-failure outcome is NEVER masked by a failed assertion (repository precedence guard)", () => {
  const db = createDatabase();
  const secrets = new SecretStore(crypto.randomBytes(32));
  seedProvider(db, secrets);
  const { scenarioRepo, testService, runRepo } = makeRunService(db, secrets);

  const scenario = scenarioRepo.create({
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
  const testRow = testService.create({ name: "T", userPrompt: "Go.", addedProfiles: [] });

  // Seed a run that ended in an ENGINE-failure state (the closest reachable to the mock harness's
  // guardrail/overflow/error family): status 'error', outcome 'error'. Persist a FAILED assertion
  // result on it, then invoke the outcome-flip path directly.
  runRepo.createRun("run-err", { testId: testRow.id, scenarioId: scenario.id, mode: "automated" });
  db.prepare("UPDATE runs SET status = 'error', outcome = 'error' WHERE id = 'run-err'").run();
  const failing: AssertionResult[] = [
    { assertion: { kind: "noFractures" }, status: "fail", reason: "boom" },
  ];
  runRepo.saveAssertionResults("run-err", failing);

  // The precedence guard must refuse to overwrite a non-'completed' engine outcome.
  runRepo.markAssertionsFailedOutcome("run-err");

  const summary = runRepo.getSummary("run-err");
  assert.equal(summary.outcome, "error", "engine outcome 'error' is preserved, never masked");
  assert.equal(
    summary.assertionResults?.[0]?.status,
    "fail",
    "the failed assertion results are still persisted",
  );
});

test("a run whose test has NO assertions persists nothing (zero behavior change)", async () => {
  const db = createDatabase();
  const secrets = new SecretStore(crypto.randomBytes(32));
  seedProvider(db, secrets);
  const { skills, scenarioRepo, testService, runRepo, runService } = makeRunService(db, secrets);

  const skill = skills.create({ name: "data-report", sourceType: "upload" });
  skills.createVersion(skill.id, [file("SKILL.md", GATE_SKILL_MD)], {
    sourceKind: "upload",
    importedFrom: "upload",
  });

  const scenario = scenarioRepo.create({
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
  const testRow = testService.create({
    name: "No assertions",
    userPrompt: "Go.",
    addedProfiles: [],
  });

  const run = runService.start(testRow.id, scenario.id, "automated");
  await run.done;

  assert.equal(runRepo.getSummary(run.runId).status, "completed");
  const raw = db.prepare("SELECT assertion_results_json FROM runs WHERE id = ?").get(run.runId) as {
    assertion_results_json: string | null;
  };
  assert.equal(
    raw.assertion_results_json,
    null,
    "no assertions → column stays NULL, nothing persisted",
  );
  assert.equal(
    runRepo.getSummary(run.runId).assertionResults,
    undefined,
    "no assertionResults on the summary",
  );
});

test("evaluation-crash safety — a force-deleted skill version yields unevaluable, run still completes", async () => {
  const db = createDatabase();
  const secrets = new SecretStore(crypto.randomBytes(32));
  seedProvider(db, secrets);
  const { skills, scenarioRepo, testService, runRepo, runService } = makeRunService(db, secrets);

  const skill = skills.create({ name: "data-report", sourceType: "upload" });
  const created = skills.createVersion(
    skill.id,
    [file("SKILL.md", GATE_SKILL_MD), file("scripts/check.py", "print('ok')\n")],
    { sourceKind: "upload", importedFrom: "upload" },
  );
  const versionId = created.version.id;
  const gateNode = projectVersion(skills, versionId).nodes.find(
    (n) => n.kind === "validation_gate",
  );
  assert.ok(gateNode);

  const scenario = scenarioRepo.create({
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
  const testRow = testService.create({
    name: "Gate test",
    userPrompt: "Go.",
    addedProfiles: [],
    assertions: { skillGates: [{ skillId: skill.id, nodeId: gateNode!.id, expect: "pass" }] },
  });

  // Force-delete the version's FILES (leaving the version row so run-time resolution still works) —
  // projection during assertion evaluation now throws, exercising the per-skill guard.
  db.prepare("DELETE FROM skill_files WHERE version_id = ?").run(versionId);

  const run = runService.start(testRow.id, scenario.id, "automated");
  await run.done;

  const summary = runRepo.getSummary(run.runId);
  assert.equal(
    summary.status,
    "completed",
    "the run still completes despite the unprojectable version",
  );
  const results = summary.assertionResults;
  assert.ok(results, "results were persisted");
  assert.equal(
    results![0]?.status,
    "unevaluable",
    "the assertion is surfaced as unevaluable, not silently passed/failed",
  );
});
