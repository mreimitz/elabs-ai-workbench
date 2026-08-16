import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import {
  CLUSTER_KEY_VERSION,
  type ErrorFinding,
  type RatingIssue,
  type RunDetail,
  type RunGrade,
  type RunSkill,
  type RunStep,
} from "@mcp-token-footprint/shared";
import { type AppDatabase, applyMigrations } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import {
  buildClusterKey,
  type IssueRegressionNotice,
  IssueSweepService,
  normalizeErrorSignature,
  severityForFinding,
  sweepOccurrenceDigest,
} from "../src/grading/issue-clustering.js";
import { RatingIssueRepository } from "../src/grading/issue-repository.js";
import { registerRatingIssueRoutes } from "../src/grading/issue-routes.js";

// Fleet issue aggregation (Observability WP5.1, D-OB20) — the DETERMINISTIC sweep + clustering. No
// LLM anywhere: the run details + error_forensics grades are stubbed in memory; the DB is in-memory.

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
  applyMigrations(db);
  databases.push(db);
  return db;
}

/** Insert a minimal terminal `runs` row (FK toggled OFF so no test/scenario parents are needed). */
function insertRun(
  db: AppDatabase,
  input: { id: string; status?: string; startedAt: string; endedAt?: string },
): void {
  db.pragma("foreign_keys = OFF");
  db.prepare(
    `INSERT INTO runs (id, test_id, scenario_id, mode, status, started_at, ended_at)
     VALUES (@id, 't-1', 'sc-1', 'automated', @status, @startedAt, @endedAt)`,
  ).run({
    id: input.id,
    status: input.status ?? "error",
    startedAt: input.startedAt,
    endedAt: input.endedAt ?? null,
  });
  db.pragma("foreign_keys = ON");
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

function toolStep(index: number, serverId: string, toolName: string): RunStep {
  return {
    id: `s${index}`,
    runId: "run-x",
    index,
    type: "tool_result",
    label: toolName,
    status: "error",
    serverId,
    toolName,
    profileTokens: {},
    payload: null,
  } as unknown as RunStep;
}

function makeRun(over: Partial<RunDetail> = {}): RunDetail {
  return {
    id: "run-x",
    testId: "t-1",
    scenarioId: "sc-1",
    mode: "automated",
    status: "error",
    startedAt: "2026-07-10T00:00:00.000Z",
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

function makeFinding(over: Partial<ErrorFinding> = {}): ErrorFinding {
  return {
    id: "ef-0",
    description: "Tool call failed: get_app on srv-1.",
    category: "failed_tool_call",
    bucket: "mcp_server",
    fixTarget: "mcp_server",
    draftFix: "server: get_app rejects its documented param",
    evidenceSteps: [0],
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
    createdAt: "2026-07-10T00:00:00.000Z",
  };
}

/** Build a sweep service over the DB + in-memory run/grade fixtures + a notice collector. */
function buildSweep(
  db: AppDatabase,
  runs: Map<string, RunDetail>,
  grades: Map<string, RunGrade[]>,
  opts: { nowMs?: () => number; model?: string } = {},
): {
  repo: RatingIssueRepository;
  sweep: IssueSweepService;
  notices: IssueRegressionNotice[];
} {
  const repo = new RatingIssueRepository(db);
  const notices: IssueRegressionNotice[] = [];
  const sweep = new IssueSweepService({
    issues: repo,
    runs: {
      getRun(runId) {
        const run = runs.get(runId);
        if (!run) throw new Error(`no run ${runId}`);
        return run;
      },
    },
    grades: {
      latestByGrader(runId) {
        return grades.get(runId) ?? [];
      },
    },
    scenarios: {
      get: () => ({ model: opts.model ?? "claude-x", allowedServers: [] }),
    },
    servers: {
      getPublic: (id) => ({ name: `Server ${id}` }),
    },
    notifyRegression: (notice) => notices.push(notice),
    ...(opts.nowMs ? { now: opts.nowMs } : {}),
  });
  return { repo, sweep, notices };
}

/** A stable, comparable snapshot of a fleet issue (excludes the volatile row id). */
function snapshot(issue: RatingIssue) {
  const f = issue.fleet;
  if (!f) throw new Error("expected a fleet issue");
  return {
    clusterKey: f.clusterKey,
    clusterKeyVersion: f.clusterKeyVersion,
    lifecycle: f.lifecycle,
    occurrenceCount: f.occurrenceCount,
    firstSeenAt: f.firstSeenAt,
    lastSeenAt: f.lastSeenAt,
    affected: f.affected,
    trend: f.trend,
    bucket: issue.bucket,
    targetKind: issue.targetKind,
    targetId: issue.targetId,
  };
}

function fleetIssues(repo: RatingIssueRepository): RatingIssue[] {
  return repo
    .listAll({})
    .filter((i) => i.fleet)
    .sort((a, b) =>
      (a.fleet?.clusterKey ?? "") < (b.fleet?.clusterKey ?? "") ? -1 : 1,
    );
}

// ── (1) The error normalizer — TABLE-DRIVEN (acceptance #2) ──────────────────────────────────────────

test("normalizeErrorSignature collapses id / number / path / url variance (table-driven)", () => {
  const cases: Array<{ a: string; b: string; expect: string; why: string }> = [
    {
      a: "HTTP 404 not found for app 111",
      b: "HTTP 404 not found for app 222",
      expect: "http <n> not found for app <n>",
      why: "trailing numbers collapse to <n>",
    },
    {
      a: "timeout after 3000ms",
      b: "timeout after 12ms",
      expect: "timeout after <n>ms",
      why: "numeric durations collapse",
    },
    {
      a: "failed at /data/apps/9f2a.json",
      b: "failed at /data/apps/be71.json",
      expect: "failed at <path>",
      why: "filesystem paths collapse to <path>",
    },
    {
      a: "call to https://tenant-a.example.com/v1/x?y=1 failed",
      b: "call to https://tenant-b.example.com/v1/x?y=9 failed",
      expect: "call to <url> failed",
      why: "URLs collapse to <url>",
    },
    {
      a: "run 3f2504e0-4f89-41d3-9a0c-0305e82c3301 aborted",
      b: "run 7c9e6679-7425-40de-944b-e07fc1f90ae7 aborted",
      expect: "run <id> aborted",
      why: "UUIDs collapse to <id>",
    },
    {
      a: "session sk_live_aB12Cd34Ef56 rejected",
      b: "session sk_live_zY98Xw76Vu54 rejected",
      expect: "session <id> rejected",
      why: "long opaque ids (letters+digits ≥12) collapse to <id>",
    },
  ];
  for (const c of cases) {
    assert.equal(normalizeErrorSignature(c.a), c.expect, `${c.why} (a)`);
    assert.equal(normalizeErrorSignature(c.b), c.expect, `${c.why} (b)`);
    assert.equal(
      normalizeErrorSignature(c.a),
      normalizeErrorSignature(c.b),
      `${c.why}: a and b normalize equal`,
    );
  }
  // A genuinely different error stays different.
  assert.notEqual(
    normalizeErrorSignature("HTTP 404 not found"),
    normalizeErrorSignature("HTTP 500 internal error"),
    "distinct errors keep distinct signatures",
  );
  // Empty / whitespace → a stable sentinel (never an empty key).
  assert.equal(normalizeErrorSignature("   "), "(no signature)");
});

// ── (2) The cluster key — versioned; discriminates on bucket / target / tool / signature ─────────────

test("buildClusterKey is versioned and discriminates on each component", () => {
  const base = {
    bucket: "mcp_server",
    targetKind: "mcp_server" as const,
    targetId: "srv-1",
    toolName: "get_app",
    signature: "http <n> not found",
  };
  const key = buildClusterKey(base);
  assert.ok(key.startsWith(`v${CLUSTER_KEY_VERSION} | `), "key is stamped with the version");
  assert.equal(buildClusterKey(base), key, "same components → same key (deterministic)");

  assert.notEqual(buildClusterKey({ ...base, bucket: "skill" }), key, "bucket discriminates");
  assert.notEqual(buildClusterKey({ ...base, targetId: "srv-2" }), key, "target id discriminates");
  assert.notEqual(buildClusterKey({ ...base, toolName: "search" }), key, "tool name discriminates");
  assert.notEqual(
    buildClusterKey({ ...base, signature: "http <n> internal" }),
    key,
    "signature discriminates",
  );
  // The occurrence digest lives in a DISTINCT namespace from the AR pipeline's finding digests.
  assert.ok(sweepOccurrenceDigest(key).length === 24, "occurrence digest is a bounded hex slice");
  assert.equal(
    sweepOccurrenceDigest(key),
    sweepOccurrenceDigest(key),
    "the occurrence digest is stable per cluster (one occurrence per (cluster, run))",
  );
});

test("severityForFinding is deterministic (terminal failures weigh most)", () => {
  assert.equal(severityForFinding(makeFinding({ category: "context_overflow" })), "high");
  assert.equal(severityForFinding(makeFinding({ category: "guardrail_stop" })), "high");
  assert.equal(severityForFinding(makeFinding({ category: "mcp_connection_failure" })), "high");
  assert.equal(severityForFinding(makeFinding({ category: "failed_tool_call" })), "medium");
});

// ── (3) Sweep clustering vs HAND-COMPUTED + idempotent re-sweep + rebuild (acceptance #1, #5) ─────────

/**
 * A mixed corpus:
 *   run-A, run-B → srv-1 / get_app / "http <n> not found for app <n>"  → ONE cluster (2 runs, day 07-10)
 *   run-C        → srv-1 / search  / "http <n>"                         → its own cluster (1 run, 07-11)
 *   run-D        → srv-2 / get_app / "http <n> not found for app <n>"   → its own cluster (1 run, 07-11)
 */
function seedCorpus(db: AppDatabase): { runs: Map<string, RunDetail>; grades: Map<string, RunGrade[]> } {
  const runs = new Map<string, RunDetail>();
  const grades = new Map<string, RunGrade[]>();

  const add = (
    id: string,
    server: string,
    tool: string,
    errorMessage: string,
    endedAt: string,
  ) => {
    insertRun(db, { id, startedAt: endedAt, endedAt });
    runs.set(
      id,
      makeRun({ id, endedAt, steps: [toolStep(0, server, tool)] }),
    );
    grades.set(id, [
      forensicsGrade(id, [
        makeFinding({ toolName: tool, errorMessage, description: `Tool call failed: ${tool} on ${server}.` }),
      ]),
    ]);
  };

  add("run-A", "srv-1", "get_app", "HTTP 404 not found for app 111", "2026-07-10T10:00:00.000Z");
  add("run-B", "srv-1", "get_app", "HTTP 404 not found for app 222", "2026-07-10T12:00:00.000Z");
  add("run-C", "srv-1", "search", "HTTP 500 internal error", "2026-07-11T09:00:00.000Z");
  add("run-D", "srv-2", "get_app", "HTTP 404 not found for app 333", "2026-07-11T11:00:00.000Z");
  return { runs, grades };
}

test("sweep clusters a mixed corpus into the hand-computed fleet issues", () => {
  const db = createDatabase();
  const { runs, grades } = seedCorpus(db);
  const { repo, sweep } = buildSweep(db, runs, grades, {
    nowMs: () => Date.parse("2026-07-12T00:00:00.000Z"),
  });

  const result = sweep.runSweep();
  assert.equal(result.runsScanned, 4, "all four terminal runs scanned");
  assert.equal(result.issuesOpened, 3, "three distinct clusters opened");
  assert.equal(result.occurrencesAdded, 4, "four occurrences folded");
  assert.equal(result.issuesRegressed, 0, "nothing regressed on a first sweep");

  const issues = fleetIssues(repo);
  assert.equal(issues.length, 3, "exactly three fleet issues");

  // The srv-1 / get_app cluster — runs A + B, both on 07-10.
  const getAppSrv1 = issues.find(
    (i) => i.targetId === "srv-1" && i.fleet?.clusterKey.includes("get_app"),
  );
  assert.ok(getAppSrv1, "the srv-1/get_app cluster exists");
  assert.equal(getAppSrv1?.fleet?.occurrenceCount, 2, "A + B folded into one issue");
  assert.equal(getAppSrv1?.fleet?.firstSeenAt, "2026-07-10T10:00:00.000Z", "first seen = run-A");
  assert.equal(getAppSrv1?.fleet?.lastSeenAt, "2026-07-10T12:00:00.000Z", "last seen = run-B");
  assert.deepEqual(
    getAppSrv1?.fleet?.trend,
    [{ day: "2026-07-10", count: 2 }],
    "two sightings on 07-10",
  );
  assert.deepEqual(getAppSrv1?.fleet?.affected.servers, ["srv-1"], "affected server = srv-1");
  assert.deepEqual(getAppSrv1?.fleet?.affected.tests, ["t-1"], "affected test = t-1");
  assert.deepEqual(getAppSrv1?.fleet?.affected.models, ["claude-x"], "affected model");
  assert.equal(getAppSrv1?.fleet?.lifecycle, "open");
  assert.equal(getAppSrv1?.fleet?.clusterKeyVersion, CLUSTER_KEY_VERSION, "key version stamped");

  // The other two clusters are singletons.
  const search = issues.find((i) => i.fleet?.clusterKey.includes("search"));
  assert.equal(search?.fleet?.occurrenceCount, 1, "search is its own singleton cluster");
  const srv2 = issues.find((i) => i.targetId === "srv-2");
  assert.equal(srv2?.fleet?.occurrenceCount, 1, "srv-2/get_app is its own singleton cluster");
});

test("re-sweeping the same window is fully idempotent", () => {
  const db = createDatabase();
  const { runs, grades } = seedCorpus(db);
  const { repo, sweep } = buildSweep(db, runs, grades, {
    nowMs: () => Date.parse("2026-07-12T00:00:00.000Z"),
  });

  sweep.runSweep();
  const before = fleetIssues(repo).map(snapshot);

  // Re-scan ALL of history again (since: null) — the occurrence INSERT-OR-IGNORE dedupes.
  const second = sweep.runSweep({ since: null });
  assert.equal(second.occurrencesAdded, 0, "no new occurrences on a re-sweep");
  assert.equal(second.issuesOpened, 0, "no new issues on a re-sweep");

  const after = fleetIssues(repo).map(snapshot);
  assert.deepEqual(after, before, "the fleet is byte-identical after an idempotent re-sweep");
});

test("rebuild drops + re-derives every fleet issue identically (derived-once proof)", () => {
  const db = createDatabase();
  const { runs, grades } = seedCorpus(db);
  const { repo, sweep } = buildSweep(db, runs, grades, {
    nowMs: () => Date.parse("2026-07-12T00:00:00.000Z"),
  });

  sweep.runSweep();
  const before = fleetIssues(repo).map(snapshot);

  const result = sweep.rebuild();
  assert.equal(result.issueCount, 3, "rebuild reports three fleet issues");
  assert.equal(result.occurrenceCount, 4, "rebuild reports four occurrences");

  const after = fleetIssues(repo).map(snapshot);
  assert.deepEqual(after, before, "a from-scratch rebuild reproduces byte-identical derived caches");
});

// ── (4) Lifecycle: resolve → regressed auto-reopen + notification (acceptance #3) ─────────────────────

test("a resolved cluster reappearing auto-regresses and emits ONE notification", () => {
  const db = createDatabase();
  const runs = new Map<string, RunDetail>();
  const grades = new Map<string, RunGrade[]>();
  const seed = (id: string, endedAt: string) => {
    insertRun(db, { id, startedAt: endedAt, endedAt });
    runs.set(id, makeRun({ id, endedAt, steps: [toolStep(0, "srv-1", "get_app")] }));
    grades.set(id, [
      forensicsGrade(id, [
        makeFinding({ toolName: "get_app", errorMessage: "HTTP 404 not found for app 1" }),
      ]),
    ]);
  };

  // First window: two runs open the cluster.
  seed("run-1", "2026-07-10T09:00:00.000Z");
  seed("run-2", "2026-07-10T10:00:00.000Z");
  let clock = Date.parse("2026-07-11T00:00:00.000Z");
  const { repo, sweep, notices } = buildSweep(db, runs, grades, { nowMs: () => clock });

  sweep.runSweep(); // watermark → 07-11T00:00
  const issue = fleetIssues(repo)[0];
  assert.ok(issue, "the cluster opened");
  assert.equal(issue.fleet?.occurrenceCount, 2);

  // The operator resolves it.
  repo.setLifecycle(issue.id, "resolved", "believed fixed");
  assert.equal(repo.get(issue.id).fleet?.lifecycle, "resolved");
  assert.equal(repo.get(issue.id).fleet?.resolutionNote, "believed fixed");

  // A NEW run on 07-11 exhibits the SAME cluster → regression.
  seed("run-3", "2026-07-11T06:00:00.000Z");
  clock = Date.parse("2026-07-12T00:00:00.000Z");
  const result = sweep.runSweep(); // since = watermark (07-11T00:00) → picks up run-3 only
  assert.equal(result.runsScanned, 1, "only the new run is in the window");
  assert.equal(result.issuesRegressed, 1, "the resolved cluster regressed");

  const regressed = repo.get(issue.id);
  assert.equal(regressed.fleet?.lifecycle, "regressed", "lifecycle auto-transitioned to regressed");
  assert.equal(regressed.fleet?.occurrenceCount, 3, "the new sighting was folded in");
  assert.equal(regressed.fleet?.resolvedAt, undefined, "resolved_at cleared on regression");

  assert.equal(notices.length, 1, "exactly one regression notification emitted");
  assert.equal(notices[0]?.issueId, issue.id, "the notification names the regressed issue");
  assert.equal(notices[0]?.runId, "run-3", "the notification names the triggering run");
});

// ── (5) The routes — sweep / rebuild / lifecycle are additive + wired (smoke) ─────────────────────────

async function buildApp(
  db: AppDatabase,
  runs: Map<string, RunDetail>,
  grades: Map<string, RunGrade[]>,
): Promise<{ app: FastifyInstance; repo: RatingIssueRepository }> {
  const { repo, sweep } = buildSweep(db, runs, grades, {
    nowMs: () => Date.parse("2026-07-12T00:00:00.000Z"),
  });
  const app = Fastify();
  await registerRatingIssueRoutes(app, repo, sweep);
  await app.ready();
  apps.push(app);
  return { app, repo };
}

test("POST /api/issues/sweep + /rebuild + lifecycle routes are live and additive", async () => {
  const db = createDatabase();
  const { runs, grades } = seedCorpus(db);
  const { app } = await buildApp(db, runs, grades);

  const sweepRes = await app.inject({ method: "POST", url: "/api/issues/sweep", payload: {} });
  assert.equal(sweepRes.statusCode, 200);
  assert.equal(sweepRes.json().issuesOpened, 3, "the sweep route opened three fleet issues");

  // GET /api/issues?lifecycle=open returns the clustered fleet issues (each carries a `fleet` block).
  const listRes = await app.inject({ method: "GET", url: "/api/issues?lifecycle=open" });
  assert.equal(listRes.statusCode, 200);
  const list = listRes.json().issues as RatingIssue[];
  assert.equal(list.length, 3, "three open fleet issues listed by lifecycle");
  assert.ok(
    list.every((i) => i.fleet && i.fleet.lifecycle === "open"),
    "every listed issue carries a fleet block",
  );

  const issueId = list[0]?.id as string;

  // resolve → ignore → reopen transitions round-trip.
  const resolveRes = await app.inject({
    method: "POST",
    url: `/api/issues/${issueId}/resolve`,
    payload: { note: "fixed upstream" },
  });
  assert.equal(resolveRes.statusCode, 200);
  assert.equal((resolveRes.json() as RatingIssue).fleet?.lifecycle, "resolved");
  assert.equal((resolveRes.json() as RatingIssue).fleet?.resolutionNote, "fixed upstream");

  const reopenRes = await app.inject({ method: "POST", url: `/api/issues/${issueId}/reopen`, payload: {} });
  assert.equal((reopenRes.json() as RatingIssue).fleet?.lifecycle, "open");
  assert.equal((reopenRes.json() as RatingIssue).fleet?.resolutionNote, undefined, "reopen clears the note");

  const ignoreRes = await app.inject({ method: "POST", url: `/api/issues/${issueId}/ignore`, payload: {} });
  assert.equal((ignoreRes.json() as RatingIssue).fleet?.lifecycle, "resolved");
  assert.equal((ignoreRes.json() as RatingIssue).fleet?.resolutionNote, "Ignored", "ignore records a default note");

  // rebuild reproduces the fleet and returns its totals.
  const rebuildRes = await app.inject({ method: "POST", url: "/api/issues/rebuild", payload: {} });
  assert.equal(rebuildRes.statusCode, 200);
  assert.equal(rebuildRes.json().issueCount, 3, "rebuild rebuilt three fleet issues");
  assert.equal(rebuildRes.json().occurrenceCount, 4);
});

// ── (6) The per-run AR pipeline is untouched — a fleet issue never sets a NULL-cluster AR issue ───────

test("fleet issues carry a cluster_key; a hand-filed AR issue keeps cluster_key NULL (registry unchanged)", () => {
  const db = createDatabase();
  const repo = new RatingIssueRepository(db);
  // An ordinary per-run AR issue (the existing insert path) — no fleet block.
  const ar = repo.insert({
    targetKind: "mcp_server",
    targetId: "srv-1",
    targetName: "Srv 1",
    title: "AR issue",
    summary: "s",
    bucket: "mcp_server",
    fixTarget: "mcp_server",
    draftFix: "d",
    severity: "medium",
    ratingVersion: 1,
    judgeProviderId: null,
    judgeModel: null,
    occurrence: {
      runId: "run-1",
      findingDigest: "d1",
      category: "failed_tool_call",
      message: "boom",
    },
  });
  assert.equal(ar.fleet, undefined, "an AR issue has no fleet block (cluster_key NULL)");

  const row = db
    .prepare("SELECT cluster_key, lifecycle FROM rating_issues WHERE id = ?")
    .get(ar.id) as { cluster_key: string | null; lifecycle: string | null };
  assert.equal(row.cluster_key, null, "the AR issue's cluster_key is NULL");
  assert.equal(row.lifecycle, null, "the AR issue's lifecycle is NULL");

  // A fleet lifecycle filter never returns the AR issue.
  assert.equal(
    repo.listAll({ lifecycle: "open" }).length,
    0,
    "the fleet lifecycle filter excludes NULL-lifecycle AR issues",
  );
});
