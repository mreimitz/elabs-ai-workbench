import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, test } from "node:test";
import type { RunStep } from "@mcp-token-footprint/shared";
import {
  buildAssistantToolDefinitions,
  type AssistantToolDeps,
} from "../src/assistant/tools/index.js";
import { ASSISTANT_ACTION_WRITE_TOOL_NAMES } from "../src/assistant/tools/action-tools.js";
import { ASSISTANT_HUB_WRITE_TOOL_NAMES } from "../src/assistant/tools/hub-write-tools.js";
import { ASSISTANT_ISSUE_LOOP_ACTION_TOOL_NAMES } from "../src/assistant/tools/issue-loop-tools.js";
import { IssueVerificationStore } from "../src/grading/issue-verification.js";
import { ASSISTANT_READ_TOOL_NAMES } from "../src/assistant/tools/read-tool-names.js";
import { ASSISTANT_WORKSPACE_TOOL_NAMES } from "../src/assistant/tools/workspace-tools.js";
import { ASSISTANT_UI_TOOL_NAMES } from "../src/assistant/tools/ui-tools.js";
import { ASSISTANT_WRITE_TOOL_NAMES } from "../src/assistant/tools/write-tools.js";
import { CollectionRepository } from "../src/collections/repository.js";
import { ensureLocalCollection, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { GradeRepository } from "../src/grading/grade-repository.js";
import { RatingIssueRepository } from "../src/grading/issue-repository.js";
import { HubRepository } from "../src/hub/repository.js";
import { ProviderRepository } from "../src/providers/repository.js";
import { ScanRepository, type ToolScanInsert } from "../src/scans/repository.js";
import type { ScanService } from "../src/scans/service.js";
import { ServerRepository } from "../src/servers/repository.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { SkillRepository } from "../src/skills/repository.js";
import { SuiteRepository } from "../src/suites/repository.js";
import { SuiteRunRepository } from "../src/suites/suite-run-repository.js";
import { RunRepository } from "../src/testing/run-repository.js";
import { ScenarioRepository } from "../src/testing/scenario-repository.js";
import { TestRepository } from "../src/testing/test-repository.js";
import { TestService } from "../src/testing/test-service.js";

// Assistant (WP 1.2) — the read toolset, exercised DIRECTLY against a seeded fixture DB: each tool's
// `.handler(args, {})` is called exactly as the SDK would call it (no SDK session, no MCP protocol
// round-trip, no Anthropic call — unit level, per the ground rules). Fixtures are built through the
// SAME repositories the tools call (ServerRepository.create, ScanRepository.completeScan,
// RunRepository.createRun/onEvent, SkillRepository.createVersion, …), not hand-typed SQL, so what's
// asserted is what a real scan/run/skill actually looks like on the wire.

const databases: AppDatabase[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

/** A trivial in-memory `app_settings`-shaped KV — enough for the WP5.4 verification store's read path. */
class InMemoryKv {
  private readonly store = new Map<string, unknown>();
  get(key: string): unknown {
    return this.store.get(key);
  }
  put(key: string, value: unknown): void {
    this.store.set(key, value);
  }
}

const NOW = "2026-07-01T00:00:00.000Z";
const SECRET_ENV_VALUE = "sk-super-secret-server-token-should-never-leak";

function createDatabase(): AppDatabase {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  ensureLocalCollection(db); // seeds the reserved default "Local" collection (D-T4)
  databases.push(db);
  return db;
}

function seedProvider(db: AppDatabase): void {
  db.prepare(
    `INSERT INTO provider_credentials (id, kind, label, api_key_encrypted, created_at, updated_at)
     VALUES ('prov-1', 'anthropic', 'Claude', 'enc:v1:abc', @now, @now)`,
  ).run({ now: NOW });
}

function toolInsert(name: string, totalTokens: number): ToolScanInsert {
  return {
    toolName: name,
    description: `desc for ${name}`,
    inputSchema: { type: "object", properties: {} },
    annotations: undefined,
    rawTool: { name },
    totalTokens,
    nameTokens: 3,
    descriptionTokens: 8,
    schemaTokens: Math.max(totalTokens - 11, 1),
    annotationsTokens: 0,
    rawBytes: 100,
    contributionPercent: 0,
  };
}

function scanSummary(
  totalTools: number,
  totalTokens: number,
  largestName: string,
  largestTokens: number,
) {
  return {
    totalTools,
    totalTokens,
    totalRawBytes: 500,
    averageTokensPerTool: totalTools > 0 ? totalTokens / totalTools : 0,
    largestToolName: largestName,
    largestToolTokens: largestTokens,
    totalResources: 0,
    totalResourceTemplates: 0,
    totalPrompts: 0,
    totalResourceTokens: 0,
    totalPromptTokens: 0,
    largestResourceName: null,
    largestResourceTokens: 0,
    largestPromptName: null,
    largestPromptTokens: 0,
  };
}

function stepFixture(
  index: number,
  type: RunStep["type"],
  label: string,
  payload: unknown,
): RunStep {
  return {
    id: `step-${index}`,
    runId: "n/a", // unused by RunRepository.onEvent's insert — the runId argument drives persistence
    index,
    type,
    label,
    status: "ok",
    profileTokens: { generic_o200k: 10 + index },
    payload,
  };
}

type Fixture = {
  deps: AssistantToolDeps;
  serverId: string;
  scanIdA: string;
  scanIdB: string;
  environmentId: string;
  testId: string;
  runId: string;
  bigRunId: string;
  skillId: string;
  versionFromId: string;
  versionToId: string;
  suiteRunId: string;
  otherSuiteRunId: string;
  collectionId: string;
};

const BIG_FILE_TEXT = "x".repeat(25_000); // > the tool's 20,000-char text-file bound

function buildFixture(): Fixture {
  const db = createDatabase();
  const secrets = new SecretStore(Buffer.alloc(32, 7));
  const servers = new ServerRepository(db, secrets);
  const scans = new ScanRepository(db);
  const skills = new SkillRepository(db, secrets);
  const suiteRuns = new SuiteRunRepository(db);
  const grades = new GradeRepository(db);
  const runs = new RunRepository(db);
  const environments = new ScenarioRepository(db);
  const tests = new TestRepository(db);
  const testService = new TestService(
    tests,
    path.join(
      os.tmpdir(),
      `mcp-assistant-tools-attachments-${Math.random().toString(36).slice(2)}`,
    ),
  );
  const collections = new CollectionRepository(db, secrets);
  const suites = new SuiteRepository(db);

  seedProvider(db);

  const server = servers.create({
    name: "Filesystem MCP",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem"],
    env: { API_TOKEN: SECRET_ENV_VALUE },
  });

  // Scan A (baseline: alpha + beta) and Scan B (later: alpha grew, beta removed, gamma added) — the
  // pair compare_run diffs.
  const scanA = scans.createRunningScan(server.id, "generic_o200k");
  scans.completeScan(scanA.id, scanSummary(2, 200, "alpha", 120), [
    toolInsert("alpha", 120),
    toolInsert("beta", 80),
  ]);

  const scanB = scans.createRunningScan(server.id, "generic_o200k");
  scans.completeScan(scanB.id, scanSummary(2, 210, "alpha", 130), [
    toolInsert("alpha", 130),
    toolInsert("gamma", 80),
  ]);
  // `createRunningScan` stamps `scanned_at` from the real wall clock, so A and B can land on the same
  // millisecond (or even sort "wrong" relative to a hardcoded fixture time) — pin BOTH to known,
  // strictly-ordered values so `scans_list`'s "newest first" ordering is deterministic, not a race.
  db.prepare("UPDATE mcp_scans SET scanned_at = @scannedAt WHERE id = @id").run({
    id: scanA.id,
    scannedAt: "2026-07-01T00:00:00.000Z",
  });
  db.prepare("UPDATE mcp_scans SET scanned_at = @scannedAt WHERE id = @id").run({
    id: scanB.id,
    scannedAt: "2026-07-01T00:00:01.000Z",
  });

  const environment = environments.create({
    name: "Baseline environment",
    providerId: "prov-1",
    model: "claude-sonnet-4",
    params: {},
    systemPrompt: "You are a test harness.",
    allowedServers: [{ serverId: server.id, allowedTools: null }],
    allowedSkills: [],
    defaultProfiles: ["generic_o200k"],
    guardrails: { maxTurns: 10 },
    toolLoadingMode: "eager",
  });

  const testRow = tests.create({
    name: "List files",
    userPrompt: "List the files, then answer.",
    addedProfiles: [],
    tags: [],
  });

  const skill = skills.create({
    name: "pdf-tools",
    sourceType: "upload",
    description: "Work with PDFs",
  });
  const v1 = skills.createVersion(
    skill.id,
    [{ path: "SKILL.md", bytes: Buffer.from("---\nname: pdf-tools\n---\nOriginal body.", "utf8") }],
    {
      sourceKind: "upload",
      importedFrom: "upload",
      manifest: { name: "pdf-tools", description: "Work with PDFs" },
    },
  );
  const v2 = skills.createVersion(
    skill.id,
    [
      { path: "SKILL.md", bytes: Buffer.from("---\nname: pdf-tools\n---\nUpdated body.", "utf8") },
      { path: "references/BIG.md", bytes: Buffer.from(BIG_FILE_TEXT, "utf8") },
    ],
    {
      sourceKind: "upload",
      importedFrom: "upload",
      manifest: { name: "pdf-tools", description: "Work with PDFs v2" },
    },
  );
  if (v1.unchanged || v2.unchanged) throw new Error("fixture setup expected two distinct versions");

  // A completed run with a few steps + a resolved skill.
  const runId = "run-main";
  runs.createRun(runId, { testId: testRow.id, scenarioId: environment.id, mode: "automated" });
  runs.onEvent(runId, {
    type: "step",
    step: stepFixture(0, "user_message", "user", { text: "List the files, then answer." }),
  });
  runs.onEvent(runId, {
    type: "step",
    step: {
      ...stepFixture(1, "tool_call", "alpha", {
        args: { path: "/tmp", apiKey: "should-be-redacted-upstream" },
      }),
      serverId: server.id,
      toolName: "alpha",
    },
  });
  runs.onEvent(runId, {
    type: "step",
    step: {
      ...stepFixture(2, "tool_result", "alpha", { result: { files: ["a.txt"] } }),
      serverId: server.id,
      toolName: "alpha",
    },
  });
  runs.onEvent(runId, {
    type: "kpi",
    turns: 1,
    toolCalls: 1,
    tokensIn: 100,
    tokensOut: 20,
    contextTokens: 500,
    costUsd: 0.01,
  });
  runs.onEvent(runId, { type: "status", status: "completed", outcome: "completed" });
  runs.recordRunSkills(runId, [
    {
      skillId: skill.id,
      skillVersionId: v2.version.id,
      versionLabel: v2.version.versionLabel,
      eager: true,
    },
  ]);

  // A big run (180 steps, no resolved skill, different day) — proves runs_get's default truncation and
  // runs_search's since/until + skillId filters (this run must be excluded by a skillId filter).
  const bigRunId = "run-big";
  runs.createRun(bigRunId, { testId: testRow.id, scenarioId: environment.id, mode: "automated" });
  for (let i = 0; i < 180; i += 1) {
    runs.onEvent(bigRunId, { type: "step", step: stepFixture(i, "tool_call", `step-${i}`, { i }) });
  }
  runs.onEvent(bigRunId, { type: "status", status: "completed", outcome: "completed" });
  // Backdate it outside the `runs_search` date-range fixture window used below.
  db.prepare("UPDATE runs SET started_at = @startedAt WHERE id = @id").run({
    id: bigRunId,
    startedAt: "2020-01-01T00:00:00.000Z",
  });

  // A suite run whose one member is the main run, graded.
  const suiteRun = suiteRuns.create(null, { repetitions: 1, maxConcurrency: 1 }, "adhoc");
  runs.linkRunToSuite(runId, suiteRun.id, 1);
  grades.insert({
    runId,
    graderId: "tool_hygiene",
    kind: "deterministic",
    status: "graded",
    score: 0.9,
    method: "tool_hygiene_v1",
  });
  suiteRuns.updateStatus(suiteRun.id, "completed");

  // A second, empty suite run — proves suite_runs_list's status filter + suiteId scoping.
  const otherSuiteRun = suiteRuns.create(null, { repetitions: 1, maxConcurrency: 1 }, "adhoc");
  suiteRuns.updateStatus(otherSuiteRun.id, "error");

  const collection = collections.create({ name: "Nightly" });

  // WP 2.2 — the two per-session fields (threadId + assistantDataDir). This file only ever calls
  // the READ tools, so the workspace tools' actual behavior isn't exercised here (that's
  // assistant-workspace-tools.test.ts's job); a throwaway, never-created tmpdir is fine.
  // WP 2.3 — `testService`/`suites` are required by `AssistantToolDeps` (the write toolset), but this
  // file only ever calls the READ tools too — the write tools' actual behavior is exercised in
  // assistant-write-tools.test.ts's own fixture.
  const deps: AssistantToolDeps = {
    runs,
    suiteRuns,
    grades,
    skills,
    scans,
    servers,
    tests,
    environments,
    collections,
    testService,
    suites,
    // Action tools (owner refinement): this file only ever calls the READ tools + enumerates the tool
    // INVENTORY — the action tools' behavior is exercised in `action-tools.test.ts` — so `issues` is a
    // real (trivial) repository and `scanService` is a never-invoked stub. Building the tool DEFINITIONS
    // never touches either (they're only read inside handlers).
    issues: new RatingIssueRepository(db),
    scanService: {} as unknown as ScanService,
    // WP5.4 — the issue-loop tools' two extra deps. This file only enumerates the tool INVENTORY + calls
    // READ tools, so `runService` is a never-invoked stub and `verification` is a real store over an
    // in-memory KV (its read path returns [] for a missing key).
    runService: { rerun: () => ({ runId: "run-stub" }) },
    verification: new IssueVerificationStore(new InMemoryKv()),
    // Assistant-operability WP 3.1 — the Hub read tools' one dependency. This file only enumerates
    // the tool INVENTORY + calls the WP 1.2 read tools, so a real (empty) HubRepository over the
    // SAME fixture DB is enough (the hub tools' own behavior is exercised in
    // assistant-hub-read-tools.test.ts's dedicated fixture).
    hub: new HubRepository(db),
    // model-identity WP3.3 — the Hub read tools' second dep (`hub_usage_summary` attributes spend to
    // the credential a session is pinned to). Same posture as `hub` above: a real (empty) repository
    // over the SAME fixture DB; the attribution behaviour is locked in
    // hub-usage-provider-attribution.test.ts.
    providers: new ProviderRepository(db, secrets),
    threadId: "assistant-tools-fixture-thread",
    assistantDataDir: path.join(
      os.tmpdir(),
      `mcp-assistant-tools-fixture-${Math.random().toString(36).slice(2)}`,
    ),
  };

  return {
    deps,
    serverId: server.id,
    scanIdA: scanA.id,
    scanIdB: scanB.id,
    environmentId: environment.id,
    testId: testRow.id,
    runId,
    bigRunId,
    skillId: skill.id,
    versionFromId: v1.version.id,
    versionToId: v2.version.id,
    suiteRunId: suiteRun.id,
    otherSuiteRunId: otherSuiteRun.id,
    collectionId: collection.id,
  };
}

/** Look up one tool definition by name from the fixture's toolset (fails loudly if it's missing). */
function toolFor(deps: AssistantToolDeps, name: string) {
  const def = buildAssistantToolDefinitions(deps).find((d) => d.name === name);
  if (!def) throw new Error(`no tool registered named "${name}"`);
  return def;
}

/** Call a tool and parse its single JSON text content block. */
async function call<T = unknown>(
  deps: AssistantToolDeps,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const def = toolFor(deps, name);
  const result = await def.handler(args as never, {});
  assert.equal(result.isError, undefined, `${name} unexpectedly errored`);
  const block = result.content[0] as { type: "text"; text: string };
  assert.equal(block.type, "text");
  return JSON.parse(block.text) as T;
}

// ── Tool inventory sanity ────────────────────────────────────────────────────────────────────────

test("buildAssistantToolDefinitions registers exactly the WP 1.2 read toolset + WP 2.2 workspace tools + WP 3.1 ui_* navigation toolset + WP 2.3 app-data write tools + cross-entity action tools, no duplicates", () => {
  const { deps } = buildFixture();
  const names = buildAssistantToolDefinitions(deps).map((d) => d.name);
  // Bound to the SDK-free ASSISTANT_READ_TOOL_NAMES the WP 2.1 classifier auto-allows (which now also
  // holds the two READ action tools mcp_tools_list/rating_issues_list), PLUS the WP 2.2 workspace write
  // tools (ASSISTANT_WORKSPACE_TOOL_NAMES), the WP 3.1 ui_* navigation tools (ASSISTANT_UI_TOOL_NAMES,
  // auto-allowed by the classifier's separate `ui` band), the WP 2.3 app-data write tools
  // (ASSISTANT_WRITE_TOOL_NAMES), the WRITE-shaped cross-entity action tools
  // (ASSISTANT_ACTION_WRITE_TOOL_NAMES), and the WP 5.1 scope-exempt Hub write action tools
  // (ASSISTANT_HUB_WRITE_TOOL_NAMES). A tool added to any toolset without updating its own name list
  // fails THIS assertion, so a new tool can never silently end up gated (fail-safe) or a rogue write
  // silently auto-allowed. This is the build-binding gate: each toolset's array and its list must match.
  const expected = [
    ...ASSISTANT_READ_TOOL_NAMES,
    ...ASSISTANT_WORKSPACE_TOOL_NAMES,
    ...ASSISTANT_UI_TOOL_NAMES,
    ...ASSISTANT_WRITE_TOOL_NAMES,
    ...ASSISTANT_ACTION_WRITE_TOOL_NAMES,
    // WP5.4 — the issue-loop gated action tools (its READ tools are already in ASSISTANT_READ_TOOL_NAMES).
    ...ASSISTANT_ISSUE_LOOP_ACTION_TOOL_NAMES,
    // Assistant-operability WP 5.1 (D-AO7) — the four scope-exempt Hub WRITE action tools.
    ...ASSISTANT_HUB_WRITE_TOOL_NAMES,
  ];
  assert.deepEqual([...names].sort(), [...expected].sort());
  assert.equal(new Set(names).size, names.length, "no duplicate tool names");
  for (const def of buildAssistantToolDefinitions(deps)) {
    assert.ok(def.description.length > 10, `${def.name} needs a real description`);
  }
});

// ── runs_get / runs_list / runs_search / run_report_markdown ───────────────────────────────────────

test("runs_get returns a compact summary + compacted steps for a normal run", async () => {
  const { deps, runId, testId, environmentId } = buildFixture();
  const out = await call<{
    id: string;
    testId: string;
    scenarioId: string;
    status: string;
    steps: Array<Record<string, unknown>>;
    stepsTotal: number;
    stepsTruncated: boolean;
    skills: Array<{ skillId: string }>;
    events?: unknown;
  }>(deps, "runs_get", { runId });

  assert.equal(out.id, runId);
  assert.equal(out.testId, testId);
  assert.equal(out.scenarioId, environmentId);
  assert.equal(out.status, "completed");
  assert.equal(out.stepsTotal, 3);
  assert.equal(out.stepsTruncated, false);
  assert.equal(out.steps.length, 3);
  assert.equal(out.skills.length, 1);
  assert.equal(out.events, undefined, "events omitted unless includeEvents is set");

  // The raw payload is never echoed verbatim — only a bounded preview under a distinct key.
  const toolCallStep = out.steps[1] as { payload?: unknown; payloadPreview?: string };
  assert.equal(toolCallStep.payload, undefined);
  assert.ok(typeof toolCallStep.payloadPreview === "string");
});

test("runs_get includeEvents returns the raw settled event log too", async () => {
  const { deps, runId } = buildFixture();
  const out = await call<{ events: unknown[]; eventsTotal: number; eventsTruncated: boolean }>(
    deps,
    "runs_get",
    {
      runId,
      includeEvents: true,
    },
  );
  assert.ok(out.events.length >= 5); // 3 step + 1 kpi + 1 status
  assert.equal(out.eventsTruncated, false);
});

test("runs_get truncates a large step count with an explicit marker (default cap)", async () => {
  const { deps, bigRunId } = buildFixture();
  const out = await call<{ steps: unknown[]; stepsTotal: number; stepsTruncated: boolean }>(
    deps,
    "runs_get",
    {
      runId: bigRunId,
    },
  );
  assert.equal(out.stepsTotal, 180);
  assert.equal(out.stepsTruncated, true);
  assert.ok(out.steps.length < 180);
});

test("runs_get honors an explicit stepLimit", async () => {
  const { deps, bigRunId } = buildFixture();
  const out = await call<{ steps: unknown[]; stepsTruncated: boolean }>(deps, "runs_get", {
    runId: bigRunId,
    stepLimit: 5,
  });
  assert.equal(out.steps.length, 5);
  assert.equal(out.stepsTruncated, true);
});

test("runs_get on an unknown id returns isError, not a thrown exception", async () => {
  const { deps } = buildFixture();
  const def = toolFor(deps, "runs_get");
  const result = await def.handler({ runId: "does-not-exist" } as never, {});
  assert.equal(result.isError, true);
});

test("runs_list filters by scenarioId/testId/status", async () => {
  const { deps, environmentId, testId } = buildFixture();
  const byScenario = await call<{ runs: Array<{ id: string }>; total: number }>(deps, "runs_list", {
    scenarioId: environmentId,
  });
  assert.equal(byScenario.total, 2); // run-main + run-big

  const byStatus = await call<{ runs: Array<{ id: string }> }>(deps, "runs_list", {
    testId,
    status: "completed",
  });
  assert.equal(byStatus.runs.length, 2);

  const byBadStatus = await call<{ runs: unknown[] }>(deps, "runs_list", { status: "error" });
  assert.equal(byBadStatus.runs.length, 0);
});

test("runs_list truncates with an explicit marker + reports the real total", async () => {
  const { deps } = buildFixture();
  const out = await call<{ runs: unknown[]; total: number; truncated: boolean }>(
    deps,
    "runs_list",
    { limit: 1 },
  );
  assert.equal(out.runs.length, 1);
  assert.equal(out.total, 2);
  assert.equal(out.truncated, true);
});

test("runs_search filters by skillId — only the run that resolved that skill matches", async () => {
  const { deps, skillId, runId } = buildFixture();
  const out = await call<{ runs: Array<{ id: string }> }>(deps, "runs_search", { skillId });
  assert.deepEqual(
    out.runs.map((r) => r.id),
    [runId],
  );
});

test("runs_search filters by since/until on startedAt", async () => {
  const { deps, runId } = buildFixture();
  const out = await call<{ runs: Array<{ id: string }> }>(deps, "runs_search", {
    since: "2025-01-01T00:00:00.000Z",
  });
  // run-big was backdated to 2020, so only run-main (started "now") is in range.
  assert.deepEqual(
    out.runs.map((r) => r.id),
    [runId],
  );

  const onlyOld = await call<{ runs: Array<{ id: string }> }>(deps, "runs_search", {
    until: "2021-01-01T00:00:00.000Z",
  });
  assert.deepEqual(
    onlyOld.runs.map((r) => r.id),
    ["run-big"],
  );
});

test("run_report_markdown renders the full session-log report and never leaks a redacted secret", async () => {
  const { deps, runId } = buildFixture();
  const def = toolFor(deps, "run_report_markdown");
  const result = await def.handler({ runId } as never, {});
  const text = (result.content[0] as { text: string }).text;
  assert.match(text, /# MCP Token Footprint Run Report/);
  assert.match(text, /## 1\. Rating & verdict/);
  assert.match(text, /## 2\. Summary/);
  assert.match(text, /## 3\. Statistics/);
  assert.match(text, /## 4\. Session setup/);
  assert.match(text, /## 5\. Steps/);
  assert.equal(
    text.includes("should-be-redacted-upstream"),
    false,
    "tool-arg secret must stay redacted",
  );
});

test("run_report_markdown on an unknown run returns isError", async () => {
  const { deps } = buildFixture();
  const def = toolFor(deps, "run_report_markdown");
  const result = await def.handler({ runId: "nope" } as never, {});
  assert.equal(result.isError, true);
});

// ── suite_runs_get / suite_runs_list ────────────────────────────────────────────────────────────

test("suite_runs_get returns member run ids + each member's latest grade", async () => {
  const { deps, suiteRunId, runId } = buildFixture();
  const out = await call<{
    id: string;
    status: string;
    memberRunIds: string[];
    memberGrades: Array<{
      runId: string;
      grades: Array<{ graderId: string; score: number | null }>;
    }>;
  }>(deps, "suite_runs_get", { suiteRunId });

  assert.equal(out.id, suiteRunId);
  assert.equal(out.status, "completed");
  assert.deepEqual(out.memberRunIds, [runId]);
  assert.equal(out.memberGrades.length, 1);
  assert.equal(out.memberGrades[0]?.grades[0]?.graderId, "tool_hygiene");
  assert.equal(out.memberGrades[0]?.grades[0]?.score, 0.9);
});

test("suite_runs_get omits grades when includeGrades is false", async () => {
  const { deps, suiteRunId } = buildFixture();
  const out = await call<{ memberGrades?: unknown }>(deps, "suite_runs_get", {
    suiteRunId,
    includeGrades: false,
  });
  assert.equal(out.memberGrades, undefined);
});

test("suite_runs_list filters by status", async () => {
  const { deps, suiteRunId, otherSuiteRunId } = buildFixture();
  const completed = await call<{ suiteRuns: Array<{ id: string }> }>(deps, "suite_runs_list", {
    status: "completed",
  });
  assert.deepEqual(
    completed.suiteRuns.map((r) => r.id),
    [suiteRunId],
  );

  const errored = await call<{ suiteRuns: Array<{ id: string }> }>(deps, "suite_runs_list", {
    status: "error",
  });
  assert.deepEqual(
    errored.suiteRuns.map((r) => r.id),
    [otherSuiteRunId],
  );
});

// ── skills_get / skills_versions / skills_files / skills_file_content / skills_diff ────────────────

test("skills_get returns the skill's public metadata (2 versions)", async () => {
  const { deps, skillId, versionToId } = buildFixture();
  const out = await call<{
    id: string;
    displayName: string;
    versionCount: number;
    currentVersionId: string;
  }>(deps, "skills_get", { skillId });
  assert.equal(out.id, skillId);
  assert.equal(out.versionCount, 2);
  assert.equal(out.currentVersionId, versionToId);
});

test("skills_versions lists newest first", async () => {
  const { deps, skillId, versionFromId, versionToId } = buildFixture();
  const out = await call<{ versions: Array<{ id: string; seq: number }> }>(
    deps,
    "skills_versions",
    { skillId },
  );
  assert.deepEqual(
    out.versions.map((v) => v.id),
    [versionToId, versionFromId],
  );
});

test("skills_files lists the file tree for one version", async () => {
  const { deps, versionToId } = buildFixture();
  const out = await call<{ files: Array<{ path: string }> }>(deps, "skills_files", {
    versionId: versionToId,
  });
  assert.deepEqual(out.files.map((f) => f.path).sort(), ["SKILL.md", "references/BIG.md"]);
});

test("skills_file_content returns full text for a small file", async () => {
  const { deps, versionToId } = buildFixture();
  const out = await call<{ isBinary: boolean; text: string; truncated: boolean }>(
    deps,
    "skills_file_content",
    {
      versionId: versionToId,
      path: "SKILL.md",
    },
  );
  assert.equal(out.isBinary, false);
  assert.match(out.text, /Updated body\./);
  assert.equal(out.truncated, false);
});

test("skills_file_content bounds an oversized text file with an explicit truncation marker", async () => {
  const { deps, versionToId } = buildFixture();
  const out = await call<{ text: string; truncated: boolean }>(deps, "skills_file_content", {
    versionId: versionToId,
    path: "references/BIG.md",
  });
  assert.equal(out.truncated, true);
  assert.ok(out.text.length < BIG_FILE_TEXT.length);
  assert.match(out.text, /chars truncated/);
});

test("skills_file_content on a missing path returns isError", async () => {
  const { deps, versionToId } = buildFixture();
  const def = toolFor(deps, "skills_file_content");
  const result = await def.handler({ versionId: versionToId, path: "nope.md" } as never, {});
  assert.equal(result.isError, true);
});

test("skills_diff reports the modified SKILL.md and the added reference file", async () => {
  const { deps, versionFromId, versionToId } = buildFixture();
  const out = await call<{
    entries: Array<{ path: string; status: string }>;
    rollup: { filesAdded: number };
  }>(deps, "skills_diff", { fromVersionId: versionFromId, toVersionId: versionToId });
  const byPath = new Map(out.entries.map((e) => [e.path, e.status]));
  assert.equal(byPath.get("SKILL.md"), "modified");
  assert.equal(byPath.get("references/BIG.md"), "added");
  assert.equal(out.rollup.filesAdded, 1);
});

// ── scans_get / scans_list / scans_tools ────────────────────────────────────────────────────────

test("scans_get returns the scan summary (no per-tool breakdown)", async () => {
  const { deps, scanIdA, serverId } = buildFixture();
  const out = await call<{ id: string; serverId: string; totalTools: number; totalTokens: number }>(
    deps,
    "scans_get",
    { scanId: scanIdA },
  );
  assert.equal(out.id, scanIdA);
  assert.equal(out.serverId, serverId);
  assert.equal(out.totalTools, 2);
  assert.equal(out.totalTokens, 200);
});

test("scans_list scopes to one server and reports newest first", async () => {
  const { deps, serverId, scanIdA, scanIdB } = buildFixture();
  const out = await call<{ scans: Array<{ id: string }>; total: number }>(deps, "scans_list", {
    serverId,
  });
  assert.equal(out.total, 2);
  assert.deepEqual(
    out.scans.map((s) => s.id),
    [scanIdB, scanIdA],
  );
});

test("scans_tools paginates with limit/offset and an explicit truncated marker", async () => {
  const { deps, scanIdA } = buildFixture();
  const page1 = await call<{
    tools: Array<{ toolName: string }>;
    total: number;
    truncated: boolean;
  }>(deps, "scans_tools", { scanId: scanIdA, limit: 1, offset: 0 });
  assert.equal(page1.total, 2);
  assert.equal(page1.tools.length, 1);
  assert.equal(page1.truncated, true);

  const page2 = await call<{ tools: Array<{ toolName: string }>; truncated: boolean }>(
    deps,
    "scans_tools",
    {
      scanId: scanIdA,
      limit: 1,
      offset: 1,
    },
  );
  assert.equal(page2.tools.length, 1);
  assert.equal(page2.truncated, false);
  assert.notEqual(page1.tools[0]?.toolName, page2.tools[0]?.toolName);
});

// ── servers_list (redaction proof) ──────────────────────────────────────────────────────────────

test("servers_list returns REDACTED configs only — the secret value never appears on the wire", async () => {
  const { deps, serverId } = buildFixture();
  const def = toolFor(deps, "servers_list");
  const result = await def.handler({} as never, {});
  const text = (result.content[0] as { text: string }).text;

  assert.equal(
    text.includes(SECRET_ENV_VALUE),
    false,
    "the raw secret value must never be serialized",
  );

  const parsed = JSON.parse(text) as { servers: Array<Record<string, unknown>> };
  const server = parsed.servers.find((s) => s.id === serverId);
  assert.ok(server, "the fixture server is present");
  assert.equal(server?.hasEnvSecrets, true);
  assert.equal(server?.hasHeaderSecrets, false);
  assert.equal(server?.env, undefined, "no env field at all, redacted or otherwise");
  assert.equal(server?.headers, undefined);
});

// ── compare_run ──────────────────────────────────────────────────────────────────────────────────

test("compare_run diffs two scans at the tool level (matched/onlyInA/onlyInB)", async () => {
  const { deps, scanIdA, scanIdB } = buildFixture();
  const out = await call<{
    matched: Array<{ a: { toolName: string }; b: { toolName: string }; deltaTokens: number }>;
    onlyInA: Array<{ toolName: string }>;
    onlyInB: Array<{ toolName: string }>;
  }>(deps, "compare_run", { scanIdA, scanIdB });

  assert.equal(out.matched.length, 1);
  assert.equal(out.matched[0]?.a.toolName, "alpha");
  assert.equal(out.matched[0]?.deltaTokens, 10);
  assert.deepEqual(
    out.onlyInA.map((t) => t.toolName),
    ["beta"],
  );
  assert.deepEqual(
    out.onlyInB.map((t) => t.toolName),
    ["gamma"],
  );
});

test("compare_run on an unknown scan id returns isError", async () => {
  const { deps, scanIdA } = buildFixture();
  const def = toolFor(deps, "compare_run");
  const result = await def.handler({ scanIdA, scanIdB: "does-not-exist" } as never, {});
  assert.equal(result.isError, true);
});

// ── compatibility_heatmap ────────────────────────────────────────────────────────────────────────

test("compatibility_heatmap scores a scan's tools against the default model set", async () => {
  const { deps, scanIdA } = buildFixture();
  const out = await call<{ view: string; models: Array<{ id: string }>; rows: unknown[] }>(
    deps,
    "compatibility_heatmap",
    {
      scanId: scanIdA,
    },
  );
  assert.equal(out.view, "server");
  assert.ok(out.models.length > 0);
  assert.ok(out.rows.length > 0);
});

test("compatibility_heatmap honors an explicit model list + tool view", async () => {
  const { deps, scanIdA } = buildFixture();
  const out = await call<{ view: string; models: Array<{ id: string }> }>(
    deps,
    "compatibility_heatmap",
    {
      scanId: scanIdA,
      models: ["claude-opus-4-8"],
      view: "tool",
    },
  );
  assert.equal(out.view, "tool");
  assert.equal(out.models.length, 1);
});

// ── tests_list / tests_get ──────────────────────────────────────────────────────────────────────

test("tests_list / tests_get round-trip the fixture test's full definition", async () => {
  const { deps, testId } = buildFixture();
  const list = await call<{ tests: Array<{ id: string }> }>(deps, "tests_list", {});
  assert.ok(list.tests.some((t) => t.id === testId));

  const one = await call<{ id: string; userPrompt: string }>(deps, "tests_get", { testId });
  assert.equal(one.id, testId);
  assert.equal(one.userPrompt, "List the files, then answer.");
});

// ── environments_list / environments_get ────────────────────────────────────────────────────────

test("environments_list / environments_get round-trip the fixture environment's full config", async () => {
  const { deps, environmentId, serverId } = buildFixture();
  const list = await call<{ environments: Array<{ id: string }> }>(deps, "environments_list", {});
  assert.ok(list.environments.some((e) => e.id === environmentId));

  const one = await call<{
    id: string;
    model: string;
    allowedServers: Array<{ serverId: string }>;
  }>(deps, "environments_get", { environmentId });
  assert.equal(one.id, environmentId);
  assert.equal(one.model, "claude-sonnet-4");
  assert.deepEqual(
    one.allowedServers.map((s) => s.serverId),
    [serverId],
  );
});

// ── collections_list / collections_get ──────────────────────────────────────────────────────────

test("collections_list includes both the default 'Local' collection and the fixture's own", async () => {
  const { deps, collectionId } = buildFixture();
  const out = await call<{ collections: Array<{ id: string; name: string; isDefault?: boolean }> }>(
    deps,
    "collections_list",
    {},
  );
  assert.ok(out.collections.some((c) => c.isDefault === true && c.name === "Local"));
  assert.ok(out.collections.some((c) => c.id === collectionId && c.name === "Nightly"));
});

test("collections_get never returns a PAT value — only hasPat", async () => {
  const { deps, collectionId } = buildFixture();
  const out = await call<{ id: string; hasPat: boolean }>(deps, "collections_get", {
    collectionId,
  });
  assert.equal(out.id, collectionId);
  assert.equal(out.hasPat, false);
  assert.equal((out as { pat?: unknown }).pat, undefined);
});
