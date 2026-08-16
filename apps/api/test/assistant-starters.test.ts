import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import {
  ASSISTANT_STARTER_CATALOG,
  type AssistantStarter,
  type SuiteAggregates,
} from "@mcp-token-footprint/shared";
import { ensureLocalCollection, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { ScanRepository, type ToolScanInsert } from "../src/scans/repository.js";
import { ServerRepository } from "../src/servers/repository.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { SkillRepository, type CreateVersionFootprint } from "../src/skills/repository.js";
import { SuiteRunRepository } from "../src/suites/suite-run-repository.js";
import { RunRepository } from "../src/testing/run-repository.js";
import { ScenarioRepository } from "../src/testing/scenario-repository.js";
import { TestRepository } from "../src/testing/test-repository.js";
import {
  deriveStarters,
  type StarterCatalog,
  type StarterDeps,
} from "../src/assistant/starters.js";

// Assistant Refinement R3 (WP R3.1) — `deriveStarters` exercised directly against a seeded fixture DB
// (same pattern as `assistant-tools.test.ts`: fixtures are built through the REAL repositories, not
// hand-typed SQL). Covers: base sets per surface, each implemented conditional firing ONLY when its
// data holds (and staying silent otherwise), the skill tab-override precedence, scope-filtering, and
// that the whole thing is read-only + deterministic.
//
// SKIPPED conditionals (documented in `starters.ts`'s module banner, not re-litigated here):
//   - skill `[?quality score low]` — needs the full async quality-engine pipeline, not a cheap read.

const databases: AppDatabase[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function createDatabase(): AppDatabase {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  ensureLocalCollection(db);
  databases.push(db);
  return db;
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

/** `SkillRepository.createVersion` leaves token counts at 0 unless a footprint is supplied explicitly
 *  ("Token counts are 0 here (WP 1.2/1.3 backfill them)" — see the repository's own doc comment); the
 *  real ingest routes compute this via the token counter, but a fixture can just assert the number it
 *  wants `l2BodyTokens` to carry. */
function skillFootprint(l2: number): CreateVersionFootprint {
  return { l1: 10, l2, l3: 0, total: 10 + l2, byPath: new Map([["SKILL.md", l2]]) };
}

function aggregates(passRateAt05: number | null, cellsCompleted = 4): SuiteAggregates {
  return {
    cellsTotal: cellsCompleted,
    cellsCompleted,
    meanGrade: 0.5,
    gradeStdDev: 0.1,
    passRateAt05,
    totalTokens: 1000,
    execCostUsd: 0.1,
    judgeCostUsd: 0.05,
  };
}

type Repos = {
  db: AppDatabase;
  servers: ServerRepository;
  scans: ScanRepository;
  runs: RunRepository;
  suiteRuns: SuiteRunRepository;
  skills: SkillRepository;
  environments: ScenarioRepository;
  tests: TestRepository;
};

function buildRepos(): Repos {
  const db = createDatabase();
  const secrets = new SecretStore(Buffer.alloc(32, 9));
  return {
    db,
    servers: new ServerRepository(db, secrets),
    scans: new ScanRepository(db),
    runs: new RunRepository(db),
    suiteRuns: new SuiteRunRepository(db),
    skills: new SkillRepository(db, secrets),
    environments: new ScenarioRepository(db),
    tests: new TestRepository(db),
  };
}

/** A generous L2 ceiling that no fixture skill body will ever exceed (proves the "not over budget" case). */
const GENEROUS_L2_CEILING = 100_000;

function starterDeps(repos: Repos, skillQualityL2TokenCeiling = GENEROUS_L2_CEILING): StarterDeps {
  return {
    scans: repos.scans,
    servers: repos.servers,
    runs: repos.runs,
    suiteRuns: repos.suiteRuns,
    skills: repos.skills,
    skillQualityL2TokenCeiling,
  };
}

function seedProvider(db: AppDatabase): void {
  db.prepare(
    `INSERT INTO provider_credentials (id, kind, label, api_key_encrypted, created_at, updated_at)
     VALUES ('prov-1', 'anthropic', 'Claude', 'enc:v1:abc', @now, @now)`,
  ).run({ now: "2026-07-01T00:00:00.000Z" });
}

function seedServer(repos: Repos, name: string) {
  return repos.servers.create({
    name,
    transport: "stdio",
    command: "npx",
    args: ["-y", "server"],
    env: {},
  });
}

function seedEnvironmentAndTest(repos: Repos) {
  seedProvider(repos.db);
  const environment = repos.environments.create({
    name: "Env",
    providerId: "prov-1",
    model: "claude-sonnet-4",
    params: {},
    systemPrompt: "You are a test harness.",
    allowedServers: [],
    allowedSkills: [],
    defaultProfiles: ["generic_o200k"],
    guardrails: { maxTurns: 10 },
    toolLoadingMode: "eager",
  });
  const testRow = repos.tests.create({
    name: "T",
    userPrompt: "Do the thing.",
    addedProfiles: [],
    tags: [],
  });
  return { environmentId: environment.id, testId: testRow.id };
}

let runSeq = 0;
function seedRun(
  repos: Repos,
  environmentId: string,
  testId: string,
  status: "completed" | "error" | "aborted" | "stopped",
  outcome?:
    | "completed"
    | "error"
    | "context_overflow"
    | "assertions_failed"
    | "aborted"
    | "stopped_guardrail",
): string {
  runSeq += 1;
  const runId = `run-${runSeq}`;
  repos.runs.createRun(runId, { testId, scenarioId: environmentId, mode: "automated" });
  repos.runs.onEvent(runId, { type: "status", status, outcome });
  return runId;
}

// ── Base sets per surface (no entity, no conditionals firing) ────────────────────────────────────

test("global surface: returns exactly the 3 base starters when nothing is amiss", () => {
  const repos = buildRepos();
  const res = deriveStarters(starterDeps(repos), {});
  assert.equal(res.surface, "global");
  assert.equal(res.version, 1);
  assert.deepEqual(
    res.starters.map((s) => s.id),
    ["global.most-expensive-server", "global.token-savings", "global.recent-failures"],
  );
});

test("compare surface (resolved via route, no entity pin): base analysis starters only", () => {
  const repos = buildRepos();
  const res = deriveStarters(starterDeps(repos), { route: "/compare/scans" });
  assert.equal(res.surface, "compare");
  assert.deepEqual(
    res.starters.map((s) => s.id),
    [
      "compare.explain-the-differences",
      "compare.what-drove-cost-up",
      "compare.recommend-a-verdict",
    ],
  );
});

test("compatibility surface (resolved via route): base analysis starters only, no actions possible", () => {
  const repos = buildRepos();
  const res = deriveStarters(starterDeps(repos), { route: "/testing/compatibility" });
  assert.equal(res.surface, "compatibility");
  assert.ok(res.starters.every((s) => s.kind === "analysis"));
  assert.equal(res.starters.length, 2);
});

test("collection surface: the in-scope action starter (Organize) is present", () => {
  const repos = buildRepos();
  const res = deriveStarters(starterDeps(repos), { entityKind: "collection", entityId: "col-1" });
  const organize = res.starters.find((s) => s.id === "collection.organize");
  assert.ok(organize);
  assert.equal(organize?.writeTool, "collections_modify");
});

test("run/scan surfaces (read-only scope) never carry an action starter, even hypothetically", () => {
  const repos = buildRepos();
  for (const entityKind of ["run", "scan"] as const) {
    const res = deriveStarters(starterDeps(repos), { entityKind, entityId: "whatever" });
    assert.ok(
      res.starters.every((s) => s.kind === "analysis"),
      `${entityKind} must be analysis-only`,
    );
  }
});

// ── server: [?last scan failed] ───────────────────────────────────────────────────────────────────

test("server surface: debug-the-failed-scan fires only when the LATEST scan actually failed", () => {
  const repos = buildRepos();
  const server = seedServer(repos, "Flaky");

  // No scans yet — conditional silent, base set only.
  let res = deriveStarters(starterDeps(repos), { entityKind: "server", entityId: server.id });
  assert.ok(!res.starters.some((s) => s.id === "server.debug-the-failed-scan"));

  const failing = repos.scans.createRunningScan(server.id, "generic_o200k");
  repos.scans.failScan(failing.id, "boom");
  repos.db
    .prepare("UPDATE mcp_scans SET scanned_at = @scannedAt WHERE id = @id")
    .run({ id: failing.id, scannedAt: "2026-07-01T00:00:00.000Z" });
  res = deriveStarters(starterDeps(repos), { entityKind: "server", entityId: server.id });
  assert.ok(res.starters.some((s) => s.id === "server.debug-the-failed-scan"));

  // A later successful scan supersedes the failed one as "latest" — conditional goes silent again.
  // Both scans get an explicit, strictly-ordered `scanned_at` (matching `assistant-tools.test.ts`'s
  // fixture pattern) since `createRunningScan` stamps the real wall clock, which can race/misorder a
  // hardcoded single-sided timestamp.
  const succeeding = repos.scans.createRunningScan(server.id, "generic_o200k");
  repos.db
    .prepare("UPDATE mcp_scans SET scanned_at = @scannedAt WHERE id = @id")
    .run({ id: succeeding.id, scannedAt: "2026-07-01T00:00:01.000Z" });
  repos.scans.completeScan(succeeding.id, scanSummary(1, 50, "a", 50), [toolInsert("a", 50)]);
  res = deriveStarters(starterDeps(repos), { entityKind: "server", entityId: server.id });
  assert.ok(!res.starters.some((s) => s.id === "server.debug-the-failed-scan"));
});

test("server surface with an unknown entityId degrades gracefully (no crash, base set only)", () => {
  const repos = buildRepos();
  const res = deriveStarters(starterDeps(repos), {
    entityKind: "server",
    entityId: "does-not-exist",
  });
  assert.ok(!res.starters.some((s) => s.id === "server.debug-the-failed-scan"));
  assert.ok(res.starters.some((s) => s.id === "server.explain-footprint"));
});

// ── scan: [?scan failed] ──────────────────────────────────────────────────────────────────────────

test("scan surface: why-did-it-fail fires only for a failed scan", () => {
  const repos = buildRepos();
  const server = seedServer(repos, "S");
  const ok = repos.scans.createRunningScan(server.id, "generic_o200k");
  repos.scans.completeScan(ok.id, scanSummary(1, 10, "a", 10), [toolInsert("a", 10)]);
  const failed = repos.scans.createRunningScan(server.id, "generic_o200k");
  repos.scans.failScan(failed.id, "connection refused");

  const okRes = deriveStarters(starterDeps(repos), { entityKind: "scan", entityId: ok.id });
  assert.ok(!okRes.starters.some((s) => s.id === "scan.why-did-it-fail"));

  const failedRes = deriveStarters(starterDeps(repos), { entityKind: "scan", entityId: failed.id });
  assert.ok(failedRes.starters.some((s) => s.id === "scan.why-did-it-fail"));
});

// ── global: [?any server's latest scan failed] + [?recent run pass-rate low] ────────────────────────

test("global: debug-failed-scans counts servers whose LATEST scan failed, and names the count", () => {
  const repos = buildRepos();
  const a = seedServer(repos, "A");
  const b = seedServer(repos, "B");
  const c = seedServer(repos, "C");

  const scanA = repos.scans.createRunningScan(a.id, "generic_o200k");
  repos.scans.failScan(scanA.id, "x");
  const scanB = repos.scans.createRunningScan(b.id, "generic_o200k");
  repos.scans.completeScan(scanB.id, scanSummary(1, 10, "t", 10), [toolInsert("t", 10)]);
  const scanC = repos.scans.createRunningScan(c.id, "generic_o200k");
  repos.scans.failScan(scanC.id, "y");

  const res = deriveStarters(starterDeps(repos), {});
  const starter = res.starters.find((s) => s.id === "global.debug-failed-scans");
  assert.ok(starter);
  assert.match(starter?.prompt ?? "", /^2 servers'/);
});

test("global: debug-failed-scans is silent when no server's latest scan failed", () => {
  const repos = buildRepos();
  const a = seedServer(repos, "A");
  const scan = repos.scans.createRunningScan(a.id, "generic_o200k");
  repos.scans.completeScan(scan.id, scanSummary(1, 10, "t", 10), [toolInsert("t", 10)]);

  const res = deriveStarters(starterDeps(repos), {});
  assert.ok(!res.starters.some((s) => s.id === "global.debug-failed-scans"));
});

test("global: why-are-runs-failing fires when the recent-run pass rate drops below the threshold", () => {
  const repos = buildRepos();
  const { environmentId, testId } = seedEnvironmentAndTest(repos);
  // 2 pass, 4 fail among 6 terminal runs -> 33% pass rate, below the 50% threshold, and >= the
  // minimum-sample floor.
  seedRun(repos, environmentId, testId, "completed", "completed");
  seedRun(repos, environmentId, testId, "completed", "completed");
  seedRun(repos, environmentId, testId, "error", "error");
  seedRun(repos, environmentId, testId, "error", "error");
  seedRun(repos, environmentId, testId, "aborted", "aborted");
  seedRun(repos, environmentId, testId, "aborted", "aborted");

  const res = deriveStarters(starterDeps(repos), {});
  assert.ok(res.starters.some((s) => s.id === "global.why-are-runs-failing"));
});

test("global: why-are-runs-failing stays silent with a healthy pass rate or too few terminal runs", () => {
  const healthy = buildRepos();
  const seededHealthy = seedEnvironmentAndTest(healthy);
  for (let i = 0; i < 5; i += 1) {
    seedRun(healthy, seededHealthy.environmentId, seededHealthy.testId, "completed", "completed");
  }
  const healthyRes = deriveStarters(starterDeps(healthy), {});
  assert.ok(!healthyRes.starters.some((s) => s.id === "global.why-are-runs-failing"));

  const sparse = buildRepos();
  const seededSparse = seedEnvironmentAndTest(sparse);
  // Only 2 terminal runs, both failed -> below MIN_TERMINAL_RUNS_FOR_PASS_RATE, must stay silent.
  seedRun(sparse, seededSparse.environmentId, seededSparse.testId, "error", "error");
  seedRun(sparse, seededSparse.environmentId, seededSparse.testId, "error", "error");
  const sparseRes = deriveStarters(starterDeps(sparse), {});
  assert.ok(!sparseRes.starters.some((s) => s.id === "global.why-are-runs-failing"));
});

// ── run: [?failed/errored] / [?context_overflow] / [?assertions_failed] ─────────────────────────────

test("run surface: each of the three run conditionals fires only for its matching run, never for a clean run", () => {
  const repos = buildRepos();
  const { environmentId, testId } = seedEnvironmentAndTest(repos);
  const clean = seedRun(repos, environmentId, testId, "completed", "completed");
  const errored = seedRun(repos, environmentId, testId, "error", "error");
  const overflowed = seedRun(repos, environmentId, testId, "stopped", "context_overflow");
  const assertionsFailed = seedRun(repos, environmentId, testId, "completed", "assertions_failed");

  const cleanRes = deriveStarters(starterDeps(repos), { entityKind: "run", entityId: clean });
  assert.deepEqual(
    cleanRes.starters.filter(
      (s) =>
        s.id.startsWith("run.") &&
        s.id !== "run.summarize-this-run" &&
        s.id !== "run.most-expensive-turns",
    ),
    [],
  );

  const erroredRes = deriveStarters(starterDeps(repos), { entityKind: "run", entityId: errored });
  assert.ok(erroredRes.starters.some((s) => s.id === "run.why-did-this-fail"));
  assert.ok(!erroredRes.starters.some((s) => s.id === "run.explain-the-overflow"));
  assert.ok(!erroredRes.starters.some((s) => s.id === "run.which-expectations-failed"));

  const overflowRes = deriveStarters(starterDeps(repos), {
    entityKind: "run",
    entityId: overflowed,
  });
  assert.ok(overflowRes.starters.some((s) => s.id === "run.explain-the-overflow"));
  assert.ok(!overflowRes.starters.some((s) => s.id === "run.why-did-this-fail"));

  const assertionsRes = deriveStarters(starterDeps(repos), {
    entityKind: "run",
    entityId: assertionsFailed,
  });
  assert.ok(assertionsRes.starters.some((s) => s.id === "run.which-expectations-failed"));
  assert.ok(!assertionsRes.starters.some((s) => s.id === "run.why-did-this-fail"));
});

test("run surface with an unknown entityId degrades gracefully", () => {
  const repos = buildRepos();
  const res = deriveStarters(starterDeps(repos), { entityKind: "run", entityId: "no-such-run" });
  assert.ok(res.starters.some((s) => s.id === "run.summarize-this-run"));
  assert.equal(
    res.starters.filter(
      (s) =>
        s.id.includes("why-did-this-fail") ||
        s.id.includes("overflow") ||
        s.id.includes("expectations"),
    ).length,
    0,
  );
});

// ── suite_run: [?pass-rate low] ───────────────────────────────────────────────────────────────────

test("suite_run surface: investigate-the-failures fires only below the pass-rate threshold, with completed cells", () => {
  const repos = buildRepos();
  const low = repos.suiteRuns.create(null, { repetitions: 1, maxConcurrency: 1 }, "adhoc");
  repos.suiteRuns.finalize(low.id, "completed", aggregates(0.25, 4));
  const high = repos.suiteRuns.create(null, { repetitions: 1, maxConcurrency: 1 }, "adhoc");
  repos.suiteRuns.finalize(high.id, "completed", aggregates(0.9, 4));
  const pending = repos.suiteRuns.create(null, { repetitions: 1, maxConcurrency: 1 }, "adhoc");
  // Still pending — no aggregates at all yet.

  const lowRes = deriveStarters(starterDeps(repos), { entityKind: "suite_run", entityId: low.id });
  assert.ok(lowRes.starters.some((s) => s.id === "suite_run.investigate-the-failures"));

  const highRes = deriveStarters(starterDeps(repos), {
    entityKind: "suite_run",
    entityId: high.id,
  });
  assert.ok(!highRes.starters.some((s) => s.id === "suite_run.investigate-the-failures"));

  const pendingRes = deriveStarters(starterDeps(repos), {
    entityKind: "suite_run",
    entityId: pending.id,
  });
  assert.ok(!pendingRes.starters.some((s) => s.id === "suite_run.investigate-the-failures"));
});

// ── skill: [?L2 over budget] + tab overrides (quality conditional intentionally SKIPPED) ────────────

test("skill surface: split-oversized-body fires only when the CURRENT version's L2 exceeds the ceiling", () => {
  const repos = buildRepos();
  const skill = repos.skills.create({
    name: "pdf-tools",
    sourceType: "upload",
    description: "Work with PDFs",
  });
  const version = repos.skills.createVersion(
    skill.id,
    [{ path: "SKILL.md", bytes: Buffer.from("---\nname: pdf-tools\n---\nA modest body.", "utf8") }],
    {
      sourceKind: "upload",
      importedFrom: "upload",
      manifest: { name: "pdf-tools", description: "Work with PDFs" },
      footprint: skillFootprint(9_000),
    },
  );
  assert.equal(version.unchanged, false);
  assert.equal(version.version.l2BodyTokens, 9_000);

  // A ceiling far below the version's L2 token count -> fires.
  const tightRes = deriveStarters(starterDeps(repos, 1), {
    entityKind: "skill",
    entityId: skill.id,
  });
  assert.ok(tightRes.starters.some((s) => s.id === "skill.split-oversized-body"));

  // A generous ceiling -> silent.
  const looseRes = deriveStarters(starterDeps(repos, GENEROUS_L2_CEILING), {
    entityKind: "skill",
    entityId: skill.id,
  });
  assert.ok(!looseRes.starters.some((s) => s.id === "skill.split-oversized-body"));
});

test("skill surface with an unknown entityId degrades gracefully", () => {
  const repos = buildRepos();
  const res = deriveStarters(starterDeps(repos, 1), {
    entityKind: "skill",
    entityId: "no-such-skill",
  });
  assert.ok(!res.starters.some((s) => s.id === "skill.split-oversized-body"));
  assert.ok(res.starters.some((s) => s.id === "skill.explain-footprint"));
});

test("skill surface: the quality tab override is surfaced FIRST, ahead of both any conditional and the base set", () => {
  const repos = buildRepos();
  const skill = repos.skills.create({
    name: "pdf-tools",
    sourceType: "upload",
    description: "Work with PDFs",
  });
  repos.skills.createVersion(
    skill.id,
    [{ path: "SKILL.md", bytes: Buffer.from("---\nname: pdf-tools\n---\nBody.", "utf8") }],
    {
      sourceKind: "upload",
      importedFrom: "upload",
      manifest: { name: "pdf-tools", description: "Work with PDFs" },
      footprint: skillFootprint(500),
    },
  );

  const res = deriveStarters(starterDeps(repos, 1), {
    entityKind: "skill",
    entityId: skill.id,
    tab: "quality",
  });
  assert.equal(res.starters[0]?.id, "skill.tab.quality.fix-top-findings");
  // The conditional (also fired, ceiling=1) and the base set still follow.
  assert.ok(res.starters.some((s) => s.id === "skill.split-oversized-body"));
  assert.ok(res.starters.some((s) => s.id === "skill.explain-footprint"));
});

test("skill surface: an unrecognized tab falls through to the base overview set with no override prepended", () => {
  const repos = buildRepos();
  const skill = repos.skills.create({
    name: "pdf-tools",
    sourceType: "upload",
    description: "Work with PDFs",
  });
  repos.skills.createVersion(
    skill.id,
    [{ path: "SKILL.md", bytes: Buffer.from("---\nname: pdf-tools\n---\nBody.", "utf8") }],
    {
      sourceKind: "upload",
      importedFrom: "upload",
      manifest: { name: "pdf-tools", description: "Work with PDFs" },
    },
  );

  const res = deriveStarters(starterDeps(repos), {
    entityKind: "skill",
    entityId: skill.id,
    tab: "not-a-real-tab",
  });
  assert.deepEqual(
    res.starters.map((s) => s.id),
    ["skill.improve-from-recent-runs", "skill.explain-footprint", "skill.tighten-triggers"],
  );
});

// ── Determinism + read-only ───────────────────────────────────────────────────────────────────────

test("deriveStarters is deterministic: the same query against unchanged data returns an identical result", () => {
  const repos = buildRepos();
  const server = seedServer(repos, "S");
  const scan = repos.scans.createRunningScan(server.id, "generic_o200k");
  repos.scans.failScan(scan.id, "boom");

  const first = deriveStarters(starterDeps(repos), { entityKind: "server", entityId: server.id });
  const second = deriveStarters(starterDeps(repos), { entityKind: "server", entityId: server.id });
  assert.deepEqual(first, second);
});

test("deriveStarters never mutates the database (row counts unchanged before/after)", () => {
  const repos = buildRepos();
  const server = seedServer(repos, "S");
  const scan = repos.scans.createRunningScan(server.id, "generic_o200k");
  repos.scans.failScan(scan.id, "boom");

  const countRows = (table: string) =>
    (repos.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  const before = { servers: countRows("mcp_servers"), scans: countRows("mcp_scans") };

  deriveStarters(starterDeps(repos), { entityKind: "server", entityId: server.id });
  deriveStarters(starterDeps(repos), {});
  deriveStarters(starterDeps(repos), { entityKind: "scan", entityId: scan.id });

  const after = { servers: countRows("mcp_servers"), scans: countRows("mcp_scans") };
  assert.deepEqual(after, before);
});

// ── FIX 2: the runtime scope-filter is proven to actually strip an out-of-scope action starter ──────
// These use the TEST-ONLY injected-catalog seam (`deriveStarters`'s 3rd param) to feed a crafted base
// set containing an action starter whose writeTool is NOT in scope for the surface, then assert it's
// gone from the output. Without the runtime `.filter(...)` these would fail — so they pin its behavior
// (deleting the filter can no longer pass the suite).

/** A shallow clone of the real catalog with one surface's base set replaced. */
function catalogWith(
  surface: keyof StarterCatalog,
  starters: readonly AssistantStarter[],
): StarterCatalog {
  return { ...ASSISTANT_STARTER_CATALOG, [surface]: starters };
}

const OUT_OF_SCOPE_ACTION: AssistantStarter = {
  id: "crafted.out-of-scope-action",
  kind: "action",
  label: "Crafted out-of-scope action",
  prompt: "This would be denied by the scope-lock — it must never be offered.",
  // Not in SCOPE_WRITE_TOOLS.server (that surface only allows servers_update_config).
  writeTool: "collections_modify",
};

const CONTROL_ANALYSIS: AssistantStarter = {
  id: "crafted.control-analysis",
  kind: "analysis",
  label: "Control analysis",
  prompt: "An analysis starter is never scope-filtered — it must survive.",
};

test("FIX 2: the runtime filter strips an out-of-scope action from a scopable surface (writeTool not in SCOPE_WRITE_TOOLS)", () => {
  const repos = buildRepos();
  const crafted = catalogWith("server", [CONTROL_ANALYSIS, OUT_OF_SCOPE_ACTION]);
  const res = deriveStarters(
    starterDeps(repos),
    { entityKind: "server", entityId: "srv-x" },
    crafted,
  );
  assert.ok(
    res.starters.some((s) => s.id === CONTROL_ANALYSIS.id),
    "the analysis control must survive",
  );
  assert.ok(
    !res.starters.some((s) => s.id === OUT_OF_SCOPE_ACTION.id),
    "an action whose writeTool is out of scope for the surface must be stripped",
  );
});

test("FIX 2: the runtime filter strips ALL action starters on a read-only surface (empty SCOPE_WRITE_TOOLS)", () => {
  const repos = buildRepos();
  // `run` is a read-only surface (SCOPE_WRITE_TOOLS.run === []); even a plausibly-scoped-looking action
  // must be dropped. Give it a writeTool that IS valid on some OTHER surface to prove the check is
  // per-surface, not global.
  const crafted = catalogWith("run", [
    CONTROL_ANALYSIS,
    {
      id: "crafted.run-action",
      kind: "action",
      label: "x",
      prompt: "x",
      writeTool: "servers_update_config",
    },
  ]);
  const res = deriveStarters(starterDeps(repos), { entityKind: "run", entityId: "run-x" }, crafted);
  assert.ok(res.starters.some((s) => s.id === CONTROL_ANALYSIS.id));
  assert.ok(!res.starters.some((s) => s.id === "crafted.run-action"));
});

test("FIX 2: the runtime filter strips ALL action starters on a non-entity surface (global has no SCOPE_WRITE_TOOLS key)", () => {
  const repos = buildRepos();
  const crafted = catalogWith("global", [
    CONTROL_ANALYSIS,
    {
      id: "crafted.global-action",
      kind: "action",
      label: "x",
      prompt: "x",
      writeTool: "servers_update_config",
    },
  ]);
  const res = deriveStarters(starterDeps(repos), {}, crafted);
  assert.ok(res.starters.some((s) => s.id === CONTROL_ANALYSIS.id));
  assert.ok(!res.starters.some((s) => s.id === "crafted.global-action"));
});

test("FIX 2 (positive control): an IN-scope action on a scopable surface survives the filter", () => {
  const repos = buildRepos();
  const crafted = catalogWith("server", [
    {
      id: "crafted.in-scope-action",
      kind: "action",
      label: "x",
      prompt: "x",
      writeTool: "servers_update_config",
    },
  ]);
  const res = deriveStarters(
    starterDeps(repos),
    { entityKind: "server", entityId: "srv-x" },
    crafted,
  );
  assert.ok(
    res.starters.some((s) => s.id === "crafted.in-scope-action"),
    "an in-scope action must NOT be stripped",
  );
});

// ── FIX 4: RunRepository.listRuns bounds the newest-first result at the SQL level ────────────────────

test("FIX 4: listRuns({ limit }) returns exactly the N newest runs (bounded at SQL level), unbounded when omitted", () => {
  const repos = buildRepos();
  const { environmentId, testId } = seedEnvironmentAndTest(repos);
  // 25 runs, backdated to strictly-increasing started_at so "newest first" is deterministic (not a
  // wall-clock race). run-25 is the newest.
  const ids: string[] = [];
  for (let i = 0; i < 25; i += 1) {
    const id = seedRun(repos, environmentId, testId, "completed", "completed");
    repos.db
      .prepare("UPDATE runs SET started_at = @startedAt WHERE id = @id")
      .run({ id, startedAt: `2026-07-01T00:00:${String(i).padStart(2, "0")}.000Z` });
    ids.push(id);
  }
  const newest20 = ids.slice(-20).reverse(); // newest-first

  const limited = repos.runs.listRuns({ limit: 20 });
  assert.equal(limited.length, 20, "LIMIT must bound the row count");
  assert.deepEqual(
    limited.map((r) => r.id),
    newest20,
    "must be the 20 newest, newest-first",
  );

  const unbounded = repos.runs.listRuns();
  assert.equal(unbounded.length, 25, "omitting limit returns the full history (back-compatible)");

  // A non-positive / non-integer limit is ignored (treated as unbounded), never a SQL error.
  assert.equal(repos.runs.listRuns({ limit: 0 }).length, 25);
  assert.equal(repos.runs.listRuns({ limit: -5 }).length, 25);
  assert.equal(repos.runs.listRuns({ limit: 2.5 }).length, 25);
});

test("FIX 4: the global pass-rate conditional only inspects the bounded recent window", () => {
  const repos = buildRepos();
  const { environmentId, testId } = seedEnvironmentAndTest(repos);
  // 20 OLD passing runs (backdated), then 6 RECENT failing runs. Over the whole history the pass rate
  // is healthy (20/26), but within the most-recent-20 window it is 14/20 pass ... still healthy. Make
  // the recent window clearly unhealthy: 20 recent FAILs after 20 old PASSes -> window is all fails.
  for (let i = 0; i < 20; i += 1) {
    const id = seedRun(repos, environmentId, testId, "completed", "completed");
    repos.db
      .prepare("UPDATE runs SET started_at = @s WHERE id = @id")
      .run({ id, s: `2020-01-01T00:00:${String(i).padStart(2, "0")}.000Z` });
  }
  for (let i = 0; i < 20; i += 1) {
    const id = seedRun(repos, environmentId, testId, "error", "error");
    repos.db
      .prepare("UPDATE runs SET started_at = @s WHERE id = @id")
      .run({ id, s: `2026-07-01T00:00:${String(i).padStart(2, "0")}.000Z` });
  }
  // The recent window is all failures -> conditional fires; the old passes are outside the window.
  const res = deriveStarters(starterDeps(repos), {});
  assert.ok(res.starters.some((s) => s.id === "global.why-are-runs-failing"));
});
