import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { afterEach, test } from "node:test";
import type { ErrorFinding, RunDetail, RunGrade, RunStep } from "@mcp-token-footprint/shared";
import {
  type IssueLoopToolDeps,
  buildIssueLoopToolDefinitions,
} from "../src/assistant/tools/issue-loop-tools.js";
import { type AppDatabase, applyMigrations } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import {
  type IssueRegressionNotice,
  IssueSweepService,
} from "../src/grading/issue-clustering.js";
import { RatingIssueRepository } from "../src/grading/issue-repository.js";
import { IssueVerificationStore } from "../src/grading/issue-verification.js";

// Observability WP5.4 acceptance #4 — the LOOP end to end WITH WP5.1's watch (auto-reopen). The
// assistant resolves an issue through the GATED `issues_update` tool ("fix merged"); a clean sweep keeps
// it resolved; a later run reintroducing the SAME cluster auto-`regressed`s it AND fires the WP4.1/WP5.1
// regression notification — "watch = nothing new" proven. Everything is deterministic + stubbed (no LLM).

const databases: AppDatabase[] = [];
afterEach(() => {
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

function insertRun(db: AppDatabase, id: string, endedAt: string): void {
  db.pragma("foreign_keys = OFF");
  db.prepare(
    `INSERT INTO runs (id, test_id, scenario_id, mode, status, started_at, ended_at)
     VALUES (@id, 't-1', 'sc-1', 'automated', 'error', @at, @at)`,
  ).run({ id, at: endedAt });
  db.pragma("foreign_keys = ON");
}

function toolStep(serverId: string, toolName: string): RunStep {
  return {
    id: "s0",
    runId: "run-x",
    index: 0,
    type: "tool_result",
    label: toolName,
    status: "error",
    serverId,
    toolName,
    profileTokens: {},
    payload: null,
  } as unknown as RunStep;
}

function makeRun(id: string, endedAt: string): RunDetail {
  return {
    id,
    testId: "t-1",
    scenarioId: "sc-1",
    mode: "automated",
    status: "error",
    startedAt: endedAt,
    endedAt,
    turns: 1,
    toolCalls: 0,
    peakContextTokens: 0,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    steps: [toolStep("srv-1", "get_app")],
    events: [],
    skills: [],
  } as unknown as RunDetail;
}

function forensicsGrade(id: string): RunGrade {
  const finding: ErrorFinding = {
    id: "ef-0",
    description: "Tool call failed: get_app on srv-1.",
    category: "failed_tool_call",
    bucket: "mcp_server",
    fixTarget: "mcp_server",
    draftFix: "server: get_app rejects its documented param",
    evidenceSteps: [0],
    evidenceEventIds: [],
    toolName: "get_app",
    errorMessage: "HTTP 404 not found for app 1",
  } as unknown as ErrorFinding;
  return {
    id: `g-${id}`,
    runId: id,
    graderId: "error_forensics",
    kind: "llm",
    status: "graded",
    score: 0.5,
    rawScore: 1,
    method: "error_forensics_v1",
    reasoning: null,
    evidence: [finding],
    judgeProviderId: null,
    judgeModel: null,
    judgeTokensIn: 0,
    judgeTokensOut: 0,
    judgeCostUsd: 0,
    gradingVersion: 1,
    createdAt: endedAtFor(id),
  } as unknown as RunGrade;
}

function endedAtFor(_id: string): string {
  return "2026-07-10T00:00:00.000Z";
}

/** Build the `issues_update` tool over the real issue repo (the rest of the deps are unused stubs). */
function issuesUpdateTool(issues: RatingIssueRepository) {
  const deps = {
    issues,
    runs: {} as never,
    tests: {} as never,
    testService: {} as never,
    collections: {} as never,
    runService: { rerun: () => ({ runId: "unused" }) },
    verification: new IssueVerificationStore(new Map() as never),
  } satisfies Partial<IssueLoopToolDeps> as unknown as IssueLoopToolDeps;
  const def = buildIssueLoopToolDefinitions(deps).find((d) => d.name === "issues_update");
  if (!def) throw new Error("issues_update tool missing");
  return def;
}

test("the loop closes: assistant resolves via issues_update, a clean sweep keeps it resolved, a recurrence regresses + notifies", async () => {
  const db = createDatabase();
  const repo = new RatingIssueRepository(db);
  const runs = new Map<string, RunDetail>();
  const grades = new Map<string, RunGrade[]>();
  const notices: IssueRegressionNotice[] = [];
  let clock = Date.parse("2026-07-11T00:00:00.000Z");

  const sweep = new IssueSweepService({
    issues: repo,
    runs: {
      getRun(runId) {
        const run = runs.get(runId);
        if (!run) throw new Error(`no run ${runId}`);
        return run;
      },
    },
    grades: { latestByGrader: (runId) => grades.get(runId) ?? [] },
    scenarios: { get: () => ({ model: "claude-x", allowedServers: [] }) },
    servers: { getPublic: (id) => ({ name: `Server ${id}` }) },
    notifyRegression: (notice) => notices.push(notice),
    now: () => clock,
  });

  const seed = (id: string, endedAt: string) => {
    insertRun(db, id, endedAt);
    runs.set(id, makeRun(id, endedAt));
    grades.set(id, [forensicsGrade(id)]);
  };

  // 1) Two runs open the fleet cluster.
  seed("run-1", "2026-07-10T09:00:00.000Z");
  seed("run-2", "2026-07-10T10:00:00.000Z");
  sweep.runSweep(); // watermark → 07-11T00:00
  const issue = repo.listAll({ lifecycle: "open" })[0];
  assert.ok(issue, "the cluster opened");

  // 2) The assistant "merges the fix" — resolves the issue through the GATED issues_update tool.
  const update = issuesUpdateTool(repo);
  const res = await update.handler(
    { issueId: issue.id, action: "resolve", note: "fixed the server schema" } as never,
    {},
  );
  const body = JSON.parse((res.content[0] as { text: string }).text) as { lifecycle: string };
  assert.equal(res.isError, undefined, "the resolve applied cleanly");
  assert.equal(body.lifecycle, "resolved");
  assert.equal(repo.get(issue.id).fleet?.lifecycle, "resolved");

  // 3) A clean re-sweep (no NEW runs) leaves it resolved and fires no regression.
  clock = Date.parse("2026-07-11T12:00:00.000Z");
  const clean = sweep.runSweep();
  assert.equal(clean.issuesRegressed, 0, "a clean sweep does not regress a resolved cluster");
  assert.equal(repo.get(issue.id).fleet?.lifecycle, "resolved");
  assert.equal(notices.length, 0, "no notification while nothing recurs");

  // 4) A later run reintroduces the SAME cluster → auto-regressed + exactly one notification (the watch).
  seed("run-3", "2026-07-12T06:00:00.000Z");
  clock = Date.parse("2026-07-13T00:00:00.000Z");
  const regressResult = sweep.runSweep();
  assert.equal(regressResult.issuesRegressed, 1, "the resolved cluster regressed on recurrence");
  assert.equal(repo.get(issue.id).fleet?.lifecycle, "regressed");
  assert.equal(notices.length, 1, "exactly one regression notification fired");
  assert.equal(notices[0]?.issueId, issue.id, "the notification names the regressed issue");
  assert.equal(notices[0]?.runId, "run-3", "the notification names the triggering run");
});
