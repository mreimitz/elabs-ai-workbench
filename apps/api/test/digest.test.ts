// Observability WP5.5 — the scheduled digest report: composition (headline/movers/issues/notable
// runs/scan movers), the honest empty window, MD/JSON parity, and append-only persistence.
//
// Proves (acceptance):
//   1. Digest JSON generated from a seeded window MATCHES hand-computed expectations; an empty window
//      says so plainly (no padding — DigestHeadline.errorRate is null, every list is []).
//   2. Every number is DELEGATED to `computeRunMetrics`/`computeScanMetrics`/`RatingIssueRepository` —
//      proven by construction (the composer takes no raw SQL of its own beyond a name lookup).
//   3. Markdown renders the SAME figures the JSON carries (parity), and the empty-window Markdown says
//      "no runs"/"no changes" rather than a padded 0%.
//   4. `DigestReportRepository` persists/retrieves/lists/prunes correctly.

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import type { AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { createDigestMarkdownReport } from "../src/reports/digest-markdown.js";
import {
  composeDigestReport,
  DigestReportRepository,
  enumerateDigestWindowEnds,
  type DigestComposerDeps,
} from "../src/reports/digest.js";
import { RatingIssueRepository } from "../src/grading/issue-repository.js";
import { RunRepository } from "../src/testing/run-repository.js";

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

const NOW = "2026-07-02T12:00:00.000Z";

// The digest window under test: a full UTC day. Previous window is the day before.
const WINDOW_FROM = "2026-07-02T00:00:00.000Z";
const WINDOW_TO = "2026-07-03T00:00:00.000Z";
const PREV_FROM = "2026-07-01T00:00:00.000Z";

function baseGraph(db: AppDatabase): void {
  db.prepare(
    "INSERT INTO provider_credentials (id, kind, label, created_at, updated_at) VALUES ('prov-ant','anthropic','Claude',@now,@now)",
  ).run({ now: NOW });
  db.prepare(
    "INSERT INTO provider_credentials (id, kind, label, created_at, updated_at) VALUES ('prov-oai','openai','OpenAI',@now,@now)",
  ).run({ now: NOW });
  db.prepare(
    "INSERT INTO mcp_servers (id, name, transport, command, created_at, updated_at) VALUES ('srv-1','Server One','stdio','x',@now,@now)",
  ).run({ now: NOW });
  db.prepare(
    "INSERT INTO scenarios (id, name, provider_id, model, created_at, updated_at) VALUES ('scn-a','A','prov-ant','claude-sonnet-4',@now,@now)",
  ).run({ now: NOW });
  db.prepare(
    "INSERT INTO scenarios (id, name, provider_id, model, created_at, updated_at) VALUES ('scn-b','B','prov-oai','gpt-5',@now,@now)",
  ).run({ now: NOW });
  db.prepare(
    "INSERT INTO scenario_servers (scenario_id, server_id) VALUES ('scn-a','srv-1')",
  ).run();
  db.prepare(
    "INSERT INTO tests (id, name, user_prompt, created_at, updated_at) VALUES ('t-1','T1','go',@now,@now)",
  ).run({ now: NOW });
  db.prepare(
    "INSERT INTO suites (id, name, config_json, created_at, updated_at) VALUES ('suite-1','Suite One','{}',@now,@now)",
  ).run({ now: NOW });
  db.prepare(
    "INSERT INTO suite_runs (id, suite_id, status, started_at) VALUES ('sr-1','suite-1','completed',@now)",
  ).run({ now: NOW });
}

type RunSeed = {
  id: string;
  scenarioId: string;
  status: string;
  outcome?: string;
  stopReasonCode?: string;
  startedAt: string;
  costUsd?: number;
  suiteRunId?: string;
};

function insertRuns(db: AppDatabase, runs: RunSeed[]): void {
  const stmt = db.prepare(
    `INSERT INTO runs (
       id, test_id, scenario_id, mode, status, outcome, stop_reason_code, started_at,
       tokens_in, tokens_out, cost_usd, turns, active_duration_ms, total_duration_ms,
       capabilities_json, suite_run_id
     ) VALUES (
       @id, 't-1', @scenarioId, 'automated', @status, @outcome, @stopReasonCode, @startedAt,
       10, 20, @costUsd, 1, 1000, 1000, NULL, @suiteRunId
     )`,
  );
  for (const r of runs) {
    stmt.run({
      id: r.id,
      scenarioId: r.scenarioId,
      status: r.status,
      outcome: r.outcome ?? null,
      stopReasonCode: r.stopReasonCode ?? null,
      startedAt: r.startedAt,
      costUsd: r.costUsd ?? 0,
      suiteRunId: r.suiteRunId ?? null,
    });
  }
}

/** Direct SQL seed of a fleet rating issue — bypasses the repository's real-clock insert/setLifecycle
 *  so the test controls firstSeenAt/lastSeenAt/resolvedAt precisely (the repository's public write
 *  path always stamps `new Date()`, unusable for a historical-window fixture). */
function seedFleetIssue(
  db: AppDatabase,
  input: {
    id: string;
    title: string;
    firstSeenAt: string;
    lastSeenAt: string;
    resolvedAt?: string | null;
    lifecycle: "open" | "resolved" | "regressed";
    fleet?: boolean; // false → a per-run (non-fleet) issue: cluster_key stays NULL
    severity?: "low" | "medium" | "high";
  },
): void {
  db.prepare(
    `INSERT INTO rating_issues (
       id, target_kind, target_id, target_name, title, summary, bucket, fix_target, draft_fix,
       severity, status, times_seen, first_seen_at, last_seen_at, resolved_at, rating_version,
       cluster_key, cluster_key_version, occurrences, affected_json, lifecycle, resolution_note, trend_json
     ) VALUES (
       @id, 'mcp_server', 'srv-1', 'Server One', @title, 'summary', 'mcp_server', 'mcp_server', 'fix it',
       @severity, @status, 1, @firstSeenAt, @lastSeenAt, @resolvedAt, 1,
       @clusterKey, @clusterKeyVersion, 1, '{"servers":[],"skills":[],"tests":[],"models":[]}', @lifecycle, NULL, '[]'
     )`,
  ).run({
    id: input.id,
    title: input.title,
    severity: input.severity ?? "medium",
    status: input.lifecycle === "resolved" ? "resolved" : "open",
    firstSeenAt: input.firstSeenAt,
    lastSeenAt: input.lastSeenAt,
    resolvedAt: input.resolvedAt ?? null,
    clusterKey: input.fleet === false ? null : `cluster-${input.id}`,
    clusterKeyVersion: input.fleet === false ? null : 1,
    lifecycle: input.fleet === false ? null : input.lifecycle,
  });
}

function deps(db: AppDatabase): DigestComposerDeps {
  return { db, runs: new RunRepository(db), issues: new RatingIssueRepository(db) };
}

// ═══ (1) Headline + movers — hand-computed expectations ═══════════════════════════════════════════

test("digest composer: headline runs/errorRate/cost + server/model/suite movers match hand-computed figures", () => {
  const db = createDatabase();
  baseGraph(db);
  insertRuns(db, [
    // Previous window (2026-07-01): scn-a only — 2 runs, 1 error. cost 1.0 + 0.5 = 1.5.
    { id: "r-prev-1", scenarioId: "scn-a", status: "completed", outcome: "completed", costUsd: 1.0, startedAt: "2026-07-01T10:00:00.000Z" },
    { id: "r-prev-2", scenarioId: "scn-a", status: "error", outcome: "error", costUsd: 0.5, startedAt: "2026-07-01T11:00:00.000Z" },
    // Current window (2026-07-02): scn-a x3 (2 in suite-1), scn-b x1 (guardrail stop).
    { id: "r-cur-1", scenarioId: "scn-a", status: "completed", outcome: "completed", costUsd: 5.0, startedAt: "2026-07-02T09:00:00.000Z", suiteRunId: "sr-1" },
    { id: "r-cur-2", scenarioId: "scn-a", status: "completed", outcome: "completed", costUsd: 3.0, startedAt: "2026-07-02T09:30:00.000Z", suiteRunId: "sr-1" },
    { id: "r-cur-3", scenarioId: "scn-a", status: "error", outcome: "error", costUsd: 0.1, startedAt: "2026-07-02T10:00:00.000Z" },
    { id: "r-cur-4", scenarioId: "scn-b", status: "stopped", outcome: "stopped_guardrail", stopReasonCode: "guardrail_max_cost", costUsd: 0.2, startedAt: "2026-07-02T12:00:00.000Z" },
  ]);

  const report = composeDigestReport(deps(db), {
    id: "d1",
    windowKind: "daily",
    windowFrom: WINDOW_FROM,
    windowTo: WINDOW_TO,
    generatedAt: NOW,
    late: false,
  });

  // ── Headline ── runs 4 vs 2 (Δ+2); errorRate 1/4=0.25 vs 1/2=0.5 (Δ-0.25); cost 8.3 vs 1.5 (Δ+6.8),
  // ALL under the single `api_exact` basis (both providers are ordinary API kinds — never blended).
  assert.equal(report.headline.runs.current, 4);
  assert.equal(report.headline.runs.previous, 2);
  assert.equal(report.headline.runs.delta, 2);
  assert.ok(report.headline.errorRate !== null);
  assert.equal(report.headline.errorRate?.current, 0.25);
  assert.equal(report.headline.errorRate?.previous, 0.5);
  assert.ok(Math.abs((report.headline.errorRate?.delta ?? 0) - -0.25) < 1e-9);
  assert.equal(Object.keys(report.headline.costByBasis).length, 1, "single cost basis, never blended");
  const apiExact = report.headline.costByBasis.api_exact;
  assert.ok(apiExact);
  assert.ok(Math.abs(apiExact.current - 8.3) < 1e-9);
  assert.ok(Math.abs(apiExact.previous - 1.5) < 1e-9);
  assert.ok(Math.abs(apiExact.delta - 6.8) < 1e-9);

  // ── Movers ── server srv-1 mirrors scn-a exactly (its only linked scenario); model claude-sonnet-4
  // mirrors scn-a; model gpt-5 and suite-1 have NO previous-window activity (0/0 → previous 0, honest).
  const byKey = (dimension: string, key: string) =>
    report.movers.find((m) => m.dimension === dimension && m.key === key);

  const server = byKey("server", "srv-1");
  assert.ok(server, "srv-1 is a mover (scn-a's linked server)");
  assert.equal(server?.label, "Server One", "server label resolved from mcp_servers.name");
  assert.ok(Math.abs((server?.costUsd.current ?? 0) - 8.1) < 1e-9); // 5+3+0.1 (scn-a only)
  assert.ok(Math.abs((server?.costUsd.previous ?? 0) - 1.5) < 1e-9);
  assert.ok(Math.abs((server?.errorRate?.current ?? 0) - 1 / 3) < 1e-9);

  const model = byKey("model", "claude-sonnet-4");
  assert.ok(model);
  assert.ok(Math.abs((model?.costUsd.current ?? 0) - 8.1) < 1e-9);

  const gpt5 = byKey("model", "gpt-5");
  assert.ok(gpt5, "gpt-5 appears (current-window activity) despite zero previous runs");
  assert.equal(gpt5?.costUsd.previous, 0);
  assert.equal(gpt5?.errorRate?.previous, 0, "no prior runs reads as 0, never fabricated otherwise");

  const suite = byKey("suite", "suite-1");
  assert.ok(suite, "suite-1 appears (2 current runs), even with zero previous-window suite runs");
  assert.ok(Math.abs((suite?.costUsd.current ?? 0) - 8.0) < 1e-9); // r-cur-1 + r-cur-2
  assert.equal(suite?.costUsd.previous, 0);

  // ── Notable runs ── top cost = the 4 cost-bearing current-window runs, cost-desc; the guardrail
  // stop (r-cur-4) ALSO appears as its own "guardrail_stop" entry — a run can honestly be both.
  const topCost = report.notableRuns.filter((r) => r.reason === "top_cost");
  assert.deepEqual(topCost.map((r) => r.runId), ["r-cur-1", "r-cur-2", "r-cur-4", "r-cur-3"]);
  const guardrail = report.notableRuns.filter((r) => r.reason === "guardrail_stop");
  assert.equal(guardrail.length, 1);
  assert.equal(guardrail[0]?.runId, "r-cur-4");
  assert.equal(guardrail[0]?.stopReasonCode, "guardrail_max_cost");

  // ── Rank: worst |error-rate swing| first (moverRank's documented primary key) — never more than
  // DIGEST_TOP_N (5) entries.
  assert.ok(report.movers.length <= 5);
  for (let i = 1; i < report.movers.length; i++) {
    const prevAbs = Math.abs(report.movers[i - 1]?.errorRate?.delta ?? 0);
    const curAbs = Math.abs(report.movers[i]?.errorRate?.delta ?? 0);
    assert.ok(prevAbs >= curAbs, "movers are sorted worst |error-rate swing| first");
  }
});

// ═══ (2) Issues — new / regressed / resolved, window-filtered ═════════════════════════════════════

test("digest composer: new/regressed/resolved fleet issues are window-filtered; per-run + out-of-window issues excluded", () => {
  const db = createDatabase();
  baseGraph(db);

  seedFleetIssue(db, {
    id: "issue-new",
    title: "New fleet issue",
    firstSeenAt: "2026-07-02T08:00:00.000Z",
    lastSeenAt: "2026-07-02T08:00:00.000Z",
    lifecycle: "open",
  });
  seedFleetIssue(db, {
    id: "issue-regressed",
    title: "Regressed fleet issue",
    firstSeenAt: "2026-06-01T00:00:00.000Z", // first seen long ago — NOT "new"
    lastSeenAt: "2026-07-02T09:00:00.000Z", // regressed (re-sighted) THIS window
    lifecycle: "regressed",
  });
  seedFleetIssue(db, {
    id: "issue-resolved",
    title: "Resolved fleet issue",
    firstSeenAt: "2026-06-01T00:00:00.000Z",
    lastSeenAt: "2026-07-02T10:00:00.000Z",
    resolvedAt: "2026-07-02T10:00:00.000Z",
    lifecycle: "resolved",
  });
  // Distractors: outside the window, and a non-fleet (per-run) issue seen inside the window.
  seedFleetIssue(db, {
    id: "issue-old",
    title: "Old fleet issue",
    firstSeenAt: "2026-06-01T00:00:00.000Z",
    lastSeenAt: "2026-06-01T00:00:00.000Z",
    lifecycle: "open",
  });
  seedFleetIssue(db, {
    id: "issue-per-run",
    title: "Per-run issue (not fleet)",
    firstSeenAt: "2026-07-02T08:30:00.000Z",
    lastSeenAt: "2026-07-02T08:30:00.000Z",
    lifecycle: "open",
    fleet: false,
  });

  const report = composeDigestReport(deps(db), {
    id: "d1",
    windowKind: "daily",
    windowFrom: WINDOW_FROM,
    windowTo: WINDOW_TO,
    generatedAt: NOW,
    late: false,
  });

  assert.deepEqual(report.newIssues.map((i) => i.id), ["issue-new"]);
  assert.deepEqual(report.regressedIssues.map((i) => i.id), ["issue-regressed"]);
  assert.deepEqual(report.resolvedIssues.map((i) => i.id), ["issue-resolved"]);
  assert.equal(report.newIssues[0]?.linkPath, "/testing/observability/issues/issue-new");
  assert.equal(report.newIssues[0]?.targetName, "Server One");
});

// ═══ (3) Scan movers — delegated to computeScanMetrics's own bucket-over-bucket delta ═════════════

test("digest composer: scan movers read the delta straight off computeScanMetrics (never recomputed)", () => {
  const db = createDatabase();
  baseGraph(db);
  db.prepare(
    `INSERT INTO mcp_scans (id, server_id, token_profile, scanned_at, status, total_tools, total_tokens, counting_version)
     VALUES ('sc-prev','srv-1','generic_o200k','2026-07-01T10:00:00.000Z','success',10,1000,2)`,
  ).run();
  db.prepare(
    `INSERT INTO mcp_scans (id, server_id, token_profile, scanned_at, status, total_tools, total_tokens, counting_version)
     VALUES ('sc-cur','srv-1','generic_o200k','2026-07-02T10:00:00.000Z','success',12,1300,2)`,
  ).run();

  const report = composeDigestReport(deps(db), {
    id: "d1",
    windowKind: "daily",
    windowFrom: WINDOW_FROM,
    windowTo: WINDOW_TO,
    generatedAt: NOW,
    late: false,
  });

  assert.equal(report.scanMovers.length, 1);
  const mover = report.scanMovers[0];
  assert.equal(mover?.serverId, "srv-1");
  assert.equal(mover?.serverName, "Server One");
  assert.equal(mover?.totalTokens, 1300);
  assert.equal(mover?.deltaComparable, true);
  assert.equal(mover?.deltaTotalTokens, 300);
});

// ═══ (4) Honest empty window ════════════════════════════════════════════════════════════════════

test("digest composer + markdown: an empty window (no runs, no issues, no scans) says so plainly — no padding", () => {
  const db = createDatabase();
  baseGraph(db);

  const report = composeDigestReport(deps(db), {
    id: "d-empty",
    windowKind: "daily",
    windowFrom: WINDOW_FROM,
    windowTo: WINDOW_TO,
    generatedAt: NOW,
    late: false,
  });

  assert.deepEqual(report.headline.runs, { current: 0, previous: 0, delta: 0 });
  assert.equal(report.headline.errorRate, null, "no runs in EITHER window → null, never a fabricated 0%");
  assert.deepEqual(report.headline.costByBasis, {});
  assert.deepEqual(report.movers, []);
  assert.deepEqual(report.newIssues, []);
  assert.deepEqual(report.regressedIssues, []);
  assert.deepEqual(report.resolvedIssues, []);
  assert.deepEqual(report.notableRuns, []);
  assert.deepEqual(report.scanMovers, []);

  const md = createDigestMarkdownReport(report);
  assert.match(md, /no runs in either window/);
  assert.match(md, /no cost-bearing runs in either window/);
  assert.match(md, /No new, regressed, or resolved issues this window/);
  assert.match(md, /No server\/model\/suite had activity in either window/);
  assert.match(md, /No notable runs/);
  assert.match(md, /No server was scanned in this window/);
  assert.doesNotMatch(md, /0\.0%/, "never a padded 0.0% for a window with no data");
});

// ═══ (5) MD/JSON parity over the populated fixture ═════════════════════════════════════════════

test("digest markdown renders the SAME figures the JSON carries (parity)", () => {
  const db = createDatabase();
  baseGraph(db);
  insertRuns(db, [
    { id: "r-prev-1", scenarioId: "scn-a", status: "completed", outcome: "completed", costUsd: 1.0, startedAt: "2026-07-01T10:00:00.000Z" },
    { id: "r-cur-1", scenarioId: "scn-a", status: "completed", outcome: "completed", costUsd: 5.0, startedAt: "2026-07-02T09:00:00.000Z" },
    { id: "r-cur-2", scenarioId: "scn-a", status: "error", outcome: "error", costUsd: 0.1, startedAt: "2026-07-02T10:00:00.000Z" },
  ]);
  seedFleetIssue(db, {
    id: "issue-new",
    title: "A brand-new fleet issue",
    firstSeenAt: "2026-07-02T08:00:00.000Z",
    lastSeenAt: "2026-07-02T08:00:00.000Z",
    lifecycle: "open",
  });

  const report = composeDigestReport(deps(db), {
    id: "d1",
    windowKind: "daily",
    windowFrom: WINDOW_FROM,
    windowTo: WINDOW_TO,
    generatedAt: NOW,
    late: false,
  });
  const md = createDigestMarkdownReport(report);

  assert.match(md, /\*\*Runs:\*\* 2 \(\+1 vs 1\)/);
  assert.match(md, new RegExp(`### New \\(${report.newIssues.length}\\)`));
  assert.match(md, /A brand-new fleet issue/);
  assert.match(md, /r-cur-1/);
  assert.match(md, /\$5\.00/, "the top-cost run's cost figure appears in the table");
  assert.match(md, /top cost/, "the notable-runs reason label renders");
  assert.doesNotMatch(md, /guardrail stop/, "no guardrail-stop run in this fixture");
  assert.match(md, /# Daily digest/);
});

// ═══ (6) enumerateDigestWindowEnds — the calendar-grid + catch-up enumerator, directly ════════════

test("enumerateDigestWindowEnds: single most-recent window on first sight; bounded catch-up otherwise", () => {
  const dayMs = 86_400_000;
  const now = Date.parse("2026-07-05T09:00:00.000Z"); // past the default 8h trigger for today's boundary
  // First sight (afterMs=null) → only the single most recently DUE window.
  const first = enumerateDigestWindowEnds(null, now, "daily", 8, 8);
  assert.equal(first.ends.length, 1);
  assert.equal(new Date(first.ends[0] as number).toISOString(), "2026-07-05T00:00:00.000Z");
  assert.equal(first.truncated, false);

  // Catch-up from 2 days back → both missed daily windows enumerated, oldest first.
  const after = Date.parse("2026-07-03T00:00:00.000Z");
  const catchUp = enumerateDigestWindowEnds(after, now, "daily", 8, 8);
  assert.deepEqual(
    catchUp.ends.map((e) => new Date(e).toISOString()),
    ["2026-07-04T00:00:00.000Z", "2026-07-05T00:00:00.000Z"],
  );
  assert.equal(catchUp.truncated, false);

  // A tiny cap truncates to the most recent N, but still reports the truncation.
  const capped = enumerateDigestWindowEnds(Date.parse("2026-06-01T00:00:00.000Z"), now, "daily", 8, 2);
  assert.equal(capped.ends.length, 2);
  assert.equal(capped.truncated, true);
  assert.equal(new Date(capped.ends[capped.ends.length - 1] as number).toISOString(), "2026-07-05T00:00:00.000Z");

  // Nothing new due since the last generation → empty.
  const upToDate = enumerateDigestWindowEnds(Date.parse("2026-07-05T00:00:00.000Z"), now, "daily", 8, 8);
  assert.deepEqual(upToDate.ends, []);

  // Before the trigger hour has passed for today, the most recent due window is YESTERDAY's.
  const early = Date.parse("2026-07-05T03:00:00.000Z"); // 03:00 UTC < the 8h trigger
  const notYetDue = enumerateDigestWindowEnds(null, early, "daily", 8, 8);
  assert.equal(new Date(notYetDue.ends[0] as number).toISOString(), "2026-07-04T00:00:00.000Z");
});

test("enumerateDigestWindowEnds: weekly cadence aligns to Monday 00:00 UTC", () => {
  // 2026-07-06 is a Monday; a weekly digest becomes due at Monday+8h.
  const now = Date.parse("2026-07-06T09:00:00.000Z");
  const { ends } = enumerateDigestWindowEnds(null, now, "weekly", 8, 8);
  assert.equal(new Date(ends[0] as number).toISOString(), "2026-07-06T00:00:00.000Z");
});

// ═══ (7) DigestReportRepository — persistence ══════════════════════════════════════════════════

test("DigestReportRepository: insert/get/list/latestWindowToByKind/pruneOlderThan", () => {
  const db = createDatabase();
  baseGraph(db);
  const repo = new DigestReportRepository(db);

  const report = composeDigestReport(deps(db), {
    id: "d1",
    windowKind: "daily",
    windowFrom: WINDOW_FROM,
    windowTo: WINDOW_TO,
    generatedAt: "2026-07-02T08:00:00.000Z",
    late: false,
  });
  repo.insert({
    windowKind: "daily",
    windowFrom: WINDOW_FROM,
    windowTo: WINDOW_TO,
    generatedAt: "2026-07-02T08:00:00.000Z",
    late: false,
    report,
  });

  const fetched = repo.get("d1");
  assert.deepEqual(fetched, report, "round-trips byte-identical");

  assert.throws(() => repo.get("missing"), /Digest report not found/);

  const list = repo.list({ kind: "daily" });
  assert.equal(list.length, 1);
  assert.equal(list[0]?.id, "d1");
  assert.deepEqual(repo.list({ kind: "weekly" }), []);

  assert.equal(repo.latestWindowToByKind("daily"), WINDOW_TO);
  assert.equal(repo.latestWindowToByKind("weekly"), null);

  // Pruning: `days <= 0` is a no-op; a large retention keeps everything; a tiny one (relative to a
  // real `Date.now()` cutoff, far past this fixture's 2026 generatedAt) prunes it.
  assert.deepEqual(repo.pruneOlderThan(0), { retentionDays: 0, prunedDigestIds: [] });
  assert.deepEqual(repo.pruneOlderThan(36500), { retentionDays: 36500, prunedDigestIds: [] });
  const pruned = repo.pruneOlderThan(1);
  assert.deepEqual(pruned.prunedDigestIds, ["d1"]);
  assert.throws(() => repo.get("d1"), /Digest report not found/);
});
