import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import {
  ASSERTION_DETAIL_LIMIT,
  ASSERTION_RULE_KINDS,
  ASSERTION_RULE_META,
  ASSERTIONS_VERSION,
  type AssertionEvaluateRequest,
  assertionDocumentSchema,
  assertionEvaluateSchema,
  assertionRuleFamily,
  assertionTargetFamily,
  MCPFP_ASSERT_FILE_NAME,
  type RatingState,
  type ScanDetail,
  type ScanSummary,
  type ServerConfig,
  type Suite,
  type SuiteAggregates,
  type SuiteRun,
  type SuiteRunStatus,
  type ToolScan,
} from "@mcp-token-footprint/shared";
import { registerAssertionRoutes } from "../src/assertions/routes.js";
import { type AssertionPorts, evaluateAssertions } from "../src/assertions/service.js";
import { applyMigrations, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { ScanRepository } from "../src/scans/repository.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { ServerRepository } from "../src/servers/repository.js";

// The CI assertions engine (roadmap/ci/ WP 1.3 — A1..A4). No DB, no network, no MCP: the engine
// takes three read functions, so a test hands it scans directly and the whole rule surface,
// including every D-C8 unevaluable case, is exercised in-process.

// ── fixtures ────────────────────────────────────────────────────────────────────────────────────

/** The two families, derived from the shared meta rather than re-listed — D-C13's own answer. */
const SCAN_RULE_KINDS = ASSERTION_RULE_KINDS.filter((kind) => assertionRuleFamily(kind) === "scan");
const SUITE_RULE_KINDS = ASSERTION_RULE_KINDS.filter(
  (kind) => assertionRuleFamily(kind) === "suite",
);

function tool(toolName: string, totalTokens: number): ToolScan {
  return {
    id: `tool_${toolName}`,
    scanId: "scan",
    toolName,
    description: `Does ${toolName}`,
    inputSchema: { type: "object" },
    annotations: undefined,
    rawTool: {},
    totalTokens,
    nameTokens: 2,
    descriptionTokens: 3,
    schemaTokens: Math.max(totalTokens - 5, 0),
    annotationsTokens: 0,
    rawBytes: totalTokens * 4,
    contributionPercent: 0,
  };
}

function scan(overrides: Partial<ScanDetail> & { id: string; tools: ToolScan[] }): ScanDetail {
  const totalTokens = overrides.tools.reduce((sum, entry) => sum + entry.totalTokens, 0);
  return {
    serverId: "srv_1",
    serverName: "Everything",
    tokenProfile: "generic_o200k",
    scannedAt: "2026-08-19T10:00:00.000Z",
    status: "success",
    totalTools: overrides.tools.length,
    totalTokens,
    totalRawBytes: totalTokens * 4,
    averageTokensPerTool: overrides.tools.length ? totalTokens / overrides.tools.length : 0,
    largestToolTokens: Math.max(0, ...overrides.tools.map((entry) => entry.totalTokens)),
    totalResources: 0,
    totalResourceTemplates: 0,
    totalPrompts: 0,
    totalResourceTokens: 0,
    totalPromptTokens: 0,
    largestResourceTokens: 0,
    largestPromptTokens: 0,
    countingVersion: 2,
    resources: [],
    prompts: [],
    events: [],
    ...overrides,
  };
}

function summaryOf(detail: ScanDetail): ScanSummary {
  const { tools: _tools, resources: _r, prompts: _p, events: _e, ...summary } = detail;
  return summary;
}

const SERVERS: ServerConfig[] = [
  {
    id: "srv_1",
    name: "Everything",
    transport: "stdio",
    command: "npx",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    hasEnvSecrets: false,
    hasHeaderSecrets: false,
    authType: "none",
  },
  {
    id: "srv_2",
    name: "Twin",
    transport: "stdio",
    command: "npx",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    hasEnvSecrets: false,
    hasHeaderSecrets: false,
    authType: "none",
  },
  {
    id: "srv_3",
    name: "Twin",
    transport: "stdio",
    command: "npx",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    hasEnvSecrets: false,
    hasHeaderSecrets: false,
    authType: "none",
  },
];

// ── WP 2.2 — the SUITE family's fixtures ────────────────────────────────────────────────────────

function aggregates(overrides: Partial<SuiteAggregates> = {}): SuiteAggregates {
  return {
    cellsTotal: 6,
    cellsCompleted: 6,
    meanGrade: 0.84,
    gradeStdDev: 0.05,
    passRateAt05: 1,
    totalTokens: 12_000,
    execCostUsd: 0.9,
    judgeCostUsd: 0.12,
    ...overrides,
  };
}

function suiteRun(
  overrides: Partial<SuiteRun> & { id: string } & { aggregates?: SuiteAggregates },
): SuiteRun {
  return {
    suiteId: "ste_1",
    status: "completed" as SuiteRunStatus,
    configSnapshot: { repetitions: 1, maxConcurrency: 3 },
    startedAt: "2026-08-19T09:00:00.000Z",
    endedAt: "2026-08-19T09:30:00.000Z",
    source: "suite",
    ratingState: "rated" as RatingState,
    aggregates: aggregates(),
    ...overrides,
  };
}

const SUITES: Suite[] = [
  {
    id: "ste_1",
    name: "Nightly",
    config: { repetitions: 1, maxConcurrency: 3 },
    testIds: [],
    scenarioIds: [],
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  },
  {
    id: "ste_2",
    name: "Twin suite",
    config: { repetitions: 1, maxConcurrency: 3 },
    testIds: [],
    scenarioIds: [],
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  },
  {
    id: "ste_3",
    name: "Twin suite",
    config: { repetitions: 1, maxConcurrency: 3 },
    testIds: [],
    scenarioIds: [],
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  },
];

/** A port set over an in-memory list of scans. `getDetail` throws the repository's 404 shape. */
function portsFor(
  scans: ScanDetail[],
  servers: ServerConfig[] = SERVERS,
  runs: SuiteRun[] = [],
  suites: Suite[] = SUITES,
): AssertionPorts {
  return {
    scans: {
      getDetail: (scanId) => {
        const found = scans.find((entry) => entry.id === scanId);
        if (!found) {
          const error = new Error("Scan not found") as Error & { statusCode: number };
          error.statusCode = 404;
          throw error;
        }
        return found;
      },
      // Newest first, exactly like `ScanRepository.listSummariesByServer`'s ORDER BY.
      listSummariesByServer: (serverId) =>
        scans
          .filter((entry) => entry.serverId === serverId)
          .sort((a, b) => b.scannedAt.localeCompare(a.scannedAt))
          .map(summaryOf),
    },
    servers: { list: () => servers },
    suites: { list: () => suites },
    suiteRuns: {
      getRun: (id) => {
        const found = runs.find((entry) => entry.id === id);
        if (!found) {
          const error = new Error("Suite run not found") as Error & { statusCode: number };
          error.statusCode = 404;
          throw error;
        }
        return found;
      },
      // Newest first, exactly like `SuiteRunRepository.listRuns`'s ORDER BY.
      listRuns: (suiteId) =>
        runs
          .filter((entry) => suiteId === undefined || entry.suiteId === suiteId)
          .sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
    },
    now: () => new Date("2026-08-19T12:00:00.000Z"),
  };
}

/** A port set for a suite-family gate: no scans needed, only suite runs. */
function suitePortsFor(runs: SuiteRun[], suites: Suite[] = SUITES): AssertionPorts {
  return portsFor([], SERVERS, runs, suites);
}

function request(document: unknown, overrides: Record<string, unknown> = {}) {
  return assertionEvaluateSchema.parse({ document, ...overrides }) as AssertionEvaluateRequest;
}

function statusOf(
  report: { results: { rule: string; status: string }[] },
  rule: string,
): string | undefined {
  return report.results.find((result) => result.rule === rule)?.status;
}

// The pair used by most tests: an OLDER baseline and a NEWER subject that added a tool, removed one
// and grew by 180 tokens.
const OLDER = scan({
  id: "scn_old",
  scannedAt: "2026-08-18T10:00:00.000Z",
  tools: [tool("alpha", 400), tool("beta", 600), tool("gone", 200)],
});
const NEWER = scan({
  id: "scn_new",
  scannedAt: "2026-08-19T10:00:00.000Z",
  tools: [tool("alpha", 400), tool("beta", 780), tool("brand_new", 200)],
});

// ── A1 — the contract ───────────────────────────────────────────────────────────────────────────

test("A1 — the contract is declared once in shared, strict, and covers every rule kind", () => {
  assert.equal(ASSERTIONS_VERSION, 1);
  assert.equal(MCPFP_ASSERT_FILE_NAME, "mcpfp.assert.json");
  // WP 2.2 APPENDED exactly two kinds (D-C13's suite family) and reordered nothing. The tuple's
  // order is the `mcpfp help assert` table's order.
  assert.deepEqual(
    [...ASSERTION_RULE_KINDS],
    [
      "max-server-tokens",
      "max-tool-tokens",
      "max-tool-count",
      "no-new-tools",
      "no-removed-tools",
      "max-scan-delta",
      "min-suite-score",
      "max-suite-cost",
    ],
  );
  // Every kind carries prose, so `mcpfp help assert` and the user guide cannot describe a rule the
  // schema does not accept (or miss one it does) — and a family, so D-C13 can be enforced.
  for (const kind of ASSERTION_RULE_KINDS) {
    assert.ok(ASSERTION_RULE_META[kind].summary.length > 0, kind);
    assert.ok(["scan", "suite"].includes(ASSERTION_RULE_META[kind].family), kind);
    assert.equal(assertionRuleFamily(kind), ASSERTION_RULE_META[kind].family, kind);
  }
  assert.deepEqual(SCAN_RULE_KINDS, [
    "max-server-tokens",
    "max-tool-tokens",
    "max-tool-count",
    "no-new-tools",
    "no-removed-tools",
    "max-scan-delta",
  ]);
  assert.deepEqual(SUITE_RULE_KINDS, ["min-suite-score", "max-suite-cost"]);

  const valid = {
    version: 1,
    target: { server: "Everything" },
    rules: [{ rule: "max-server-tokens", max: 3000 }],
  };
  assert.ok(assertionDocumentSchema.safeParse(valid).success);

  // `.strict()` at every level: a typo'd key is an error, never a silently dropped rule.
  assert.ok(!assertionDocumentSchema.safeParse({ ...valid, extra: 1 }).success);
  assert.ok(
    !assertionDocumentSchema.safeParse({ ...valid, target: { serverName: "Everything" } }).success,
  );
  assert.ok(
    !assertionDocumentSchema.safeParse({
      ...valid,
      rules: [{ rule: "max-server-tokens", max: 3000, tool: "x" }],
    }).success,
  );
  // Naming BOTH a server and a scan is a validation error, not a silent precedence rule.
  assert.ok(
    !assertionDocumentSchema.safeParse({ ...valid, target: { server: "a", scan: "b" } }).success,
  );
  // An empty gate that exits 0 is worse than no gate.
  assert.ok(!assertionDocumentSchema.safeParse({ ...valid, rules: [] }).success);
  // `max-scan-delta` needs at least one bound, and the issue points at the offending rule.
  const bare = assertionDocumentSchema.safeParse({
    ...valid,
    rules: [{ rule: "max-scan-delta" }],
  });
  assert.ok(!bare.success);
  assert.deepEqual(bare.error?.issues[0]?.path, ["rules", 0]);
});

test("A1 — a higher document version is refused with a sentence naming both versions", () => {
  const result = assertionDocumentSchema.safeParse({
    version: ASSERTIONS_VERSION + 1,
    target: { scan: "scn_new" },
    rules: [{ rule: "max-tool-count", max: 5 }],
  });
  assert.ok(!result.success);
  assert.match(
    result.error?.issues[0]?.message ?? "",
    /written for assertions v2; this workbench speaks v1/,
  );
});

// ── A2 — all six kinds, itemized, no short-circuit ──────────────────────────────────────────────

test("A2 — every rule kind is evaluated against a seeded scan and counts agree with results", () => {
  const report = evaluateAssertions(
    portsFor([OLDER, NEWER]),
    request({
      version: 1,
      target: { scan: "scn_new" },
      baseline: "previous",
      rules: [
        { rule: "max-server-tokens", max: 3000 }, // 1380 → pass
        { rule: "max-server-tokens", max: 1000 }, // 1380 → fail
        { rule: "max-tool-count", max: 3 }, // 3 → pass
        { rule: "max-tool-tokens", max: 500 }, // beta 780 → fail
        { rule: "max-tool-tokens", max: 900, tool: "beta" }, // 780 → pass
        { rule: "max-tool-tokens", max: 100, tool: "vanished" }, // missing → fail
        { rule: "no-new-tools" }, // brand_new → fail
        { rule: "no-removed-tools" }, // gone → fail
        { rule: "max-scan-delta", maxTokens: 250, maxPercent: 50 }, // +180 → pass
      ],
    }),
  );

  // ALL nine were evaluated — no short-circuit on the first failure.
  assert.equal(report.results.length, 9);
  assert.deepEqual(
    report.results.map((result) => result.status),
    ["pass", "fail", "pass", "fail", "pass", "fail", "fail", "fail", "pass"],
  );
  assert.deepEqual(report.counts, { total: 9, passed: 4, failed: 5, skipped: 0 });
  assert.equal(report.passed, false);
  assert.equal(report.assertionsVersion, ASSERTIONS_VERSION);
  assert.equal(report.evaluatedAt, "2026-08-19T12:00:00.000Z");

  // The itemization an operator actually reads.
  const overBudget = report.results[3];
  assert.deepEqual(overBudget?.details, ["beta — 780 > 500"]);
  assert.equal(overBudget?.observed, 780);
  assert.equal(overBudget?.limit, 500);
  assert.match(report.results[5]?.message ?? "", /"vanished" is not in this scan/);
  assert.deepEqual(report.results[6]?.details, ["+ brand_new (200 tokens)"]);
  assert.deepEqual(report.results[7]?.details, ["- gone (200 tokens)"]);
  assert.match(report.results[8]?.message ?? "", /\+180 tokens \(\+15\.0%\)/);

  assert.equal(report.subject.scanId, "scn_new");
  assert.equal(report.subject.totalTokens, 1380);
  assert.equal(report.subject.countingVersion, 2);
});

test("A2 — a gate whose rules all pass reports passed:true", () => {
  const report = evaluateAssertions(
    portsFor([NEWER]),
    request({
      version: 1,
      target: { scan: "scn_new" },
      rules: [
        { rule: "max-server-tokens", max: 3000 },
        { rule: "max-tool-count", max: 10 },
        { rule: "max-tool-tokens", max: 1000 },
      ],
    }),
  );
  assert.equal(report.passed, true);
  assert.deepEqual(report.counts, { total: 3, passed: 3, failed: 0, skipped: 0 });
  // No rule needed a baseline, so none was resolved.
  assert.equal(report.baseline, null);
});

test("A2 — the comparison direction is pinned: onlyInB is NEW, onlyInA is REMOVED", () => {
  // The single most invertible thing in this engine: `buildComparison(baseline, subject)`. If the
  // arguments are ever swapped, "no new tools" starts reporting removals and every gate lies.
  const report = evaluateAssertions(
    portsFor([OLDER, NEWER]),
    request({
      version: 1,
      target: { scan: "scn_new" },
      baseline: "scn_old",
      rules: [{ rule: "no-new-tools" }, { rule: "no-removed-tools" }],
    }),
  );
  assert.deepEqual(report.results[0]?.details, ["+ brand_new (200 tokens)"]);
  assert.deepEqual(report.results[1]?.details, ["- gone (200 tokens)"]);
});

test("A2 — a max-scan-delta breach names the direction, and a DROP fails too", () => {
  // Asserting the newer scan against itself-as-subject is not interesting; assert the OLD scan with
  // the NEW one as baseline, so the delta is negative.
  const report = evaluateAssertions(
    portsFor([OLDER, NEWER]),
    request({
      version: 1,
      target: { scan: "scn_old" },
      baseline: "scn_new",
      rules: [{ rule: "max-scan-delta", maxTokens: 50 }],
    }),
  );
  assert.equal(report.results[0]?.status, "fail");
  assert.equal(report.results[0]?.observed, 180);
  assert.match(report.results[0]?.message ?? "", /−180 tokens/);
});

test("A2 — details are capped at ASSERTION_DETAIL_LIMIT with an `…and N more` line", () => {
  const many = scan({
    id: "scn_many",
    tools: Array.from({ length: ASSERTION_DETAIL_LIMIT + 5 }, (_, index) => tool(`t${index}`, 900)),
  });
  const report = evaluateAssertions(
    portsFor([many]),
    request({
      version: 1,
      target: { scan: "scn_many" },
      rules: [{ rule: "max-tool-tokens", max: 100 }],
    }),
  );
  const details = report.results[0]?.details ?? [];
  assert.equal(details.length, ASSERTION_DETAIL_LIMIT + 1);
  assert.equal(details.at(-1), "…and 5 more");
});

// ── A3 (D-C3) — symbolic in, concrete out ───────────────────────────────────────────────────────

test("A3 — `previous` resolves to the newest earlier succeeded scan of the SUBJECT'S OWN server", () => {
  const foreign = scan({
    id: "scn_foreign",
    serverId: "srv_2",
    serverName: "Twin",
    scannedAt: "2026-08-18T23:00:00.000Z",
    tools: [tool("alpha", 1)],
  });
  const failed = scan({
    id: "scn_failed",
    scannedAt: "2026-08-18T23:30:00.000Z",
    status: "failed",
    tools: [],
  });
  const older = scan({
    id: "scn_older",
    scannedAt: "2026-08-17T10:00:00.000Z",
    tools: [tool("alpha", 100)],
  });

  const report = evaluateAssertions(
    portsFor([older, OLDER, failed, foreign, NEWER]),
    request({
      version: 1,
      target: { scan: "scn_new" },
      baseline: "previous",
      rules: [{ rule: "no-new-tools" }],
    }),
  );

  // Not the failed one (newer), not the foreign server's, not the oldest — the newest earlier
  // SUCCEEDED scan of srv_1.
  assert.equal(report.baseline?.requested, "previous");
  assert.equal(report.baseline?.scan.scanId, "scn_old");
  assert.equal(report.baseline?.scan.scannedAt, "2026-08-18T10:00:00.000Z");
  assert.equal(report.baseline?.scan.serverId, "srv_1");
});

test("A3 — `previous` and the explicit id it resolves to produce the same evaluation", () => {
  const document = {
    version: 1,
    target: { scan: "scn_new" },
    rules: [
      { rule: "no-new-tools" },
      { rule: "no-removed-tools" },
      { rule: "max-scan-delta", maxTokens: 250 },
    ],
  };
  const symbolic = evaluateAssertions(
    portsFor([OLDER, NEWER]),
    request({ ...document, baseline: "previous" }),
  );
  const explicit = evaluateAssertions(
    portsFor([OLDER, NEWER]),
    request({ ...document, baseline: "scn_old" }),
  );

  // Everything but the echoed `requested` is identical — that field is the whole point of D-C3: the
  // report records BOTH what was asked for and the one concrete scan it resolved to.
  assert.equal(symbolic.baseline?.requested, "previous");
  assert.equal(explicit.baseline?.requested, "scn_old");
  assert.deepEqual(symbolic.results, explicit.results);
  assert.deepEqual(symbolic.counts, explicit.counts);
  assert.deepEqual(symbolic.subject, explicit.subject);
  assert.deepEqual(symbolic.baseline?.scan, explicit.baseline?.scan);
});

test("A3 — a server target uses that server's newest succeeded scan, by id or exact name", () => {
  const ports = portsFor([OLDER, NEWER]);
  const document = {
    version: 1,
    target: { server: "srv_1" },
    rules: [{ rule: "max-tool-count", max: 99 }],
  };
  assert.equal(evaluateAssertions(ports, request(document)).subject.scanId, "scn_new");
  assert.equal(
    evaluateAssertions(ports, request({ ...document, target: { server: "Everything" } })).subject
      .scanId,
    "scn_new",
  );
  // A CLI flag override sits on top of the document's own target.
  assert.equal(
    evaluateAssertions(ports, request(document, { target: { scan: "scn_old" } })).subject.scanId,
    "scn_old",
  );
});

test("A3 — an ambiguous server name names both ids rather than picking one", () => {
  assert.throws(
    () =>
      evaluateAssertions(
        portsFor([OLDER, NEWER]),
        request({
          version: 1,
          target: { server: "Twin" },
          rules: [{ rule: "max-tool-count", max: 5 }],
        }),
      ),
    (error: Error & { statusCode?: number }) =>
      error.statusCode === 400 && /srv_2, srv_3/.test(error.message),
  );
});

test("A3 — a server with no completed scan is a 400 telling you to scan it first", () => {
  const failedOnly = scan({ id: "scn_bad", status: "failed", tools: [] });
  assert.throws(
    () =>
      evaluateAssertions(
        portsFor([failedOnly]),
        request({
          version: 1,
          target: { server: "srv_1" },
          rules: [{ rule: "max-tool-count", max: 5 }],
        }),
      ),
    (error: Error & { statusCode?: number }) =>
      error.statusCode === 400 && /run `mcpfp scan srv_1` first/.test(error.message),
  );
});

// ── A4 (D-C8) — the three unevaluable cases ─────────────────────────────────────────────────────

test("A4 case 1 — no earlier scan: baseline rules SKIP with a reason, and the report still passes", () => {
  const report = evaluateAssertions(
    portsFor([NEWER]),
    request({
      version: 1,
      target: { scan: "scn_new" },
      baseline: "previous",
      rules: [
        { rule: "max-server-tokens", max: 3000 },
        { rule: "no-new-tools" },
        { rule: "no-removed-tools" },
        { rule: "max-scan-delta", maxTokens: 10 },
      ],
    }),
  );

  assert.equal(report.baseline, null);
  assert.deepEqual(report.counts, { total: 4, passed: 1, failed: 0, skipped: 3 });
  // `passed` is false ONLY on a real failure — a first-ever scan must not fail a pipeline.
  assert.equal(report.passed, true);
  for (const rule of ["no-new-tools", "no-removed-tools", "max-scan-delta"]) {
    const result = report.results.find((entry) => entry.rule === rule);
    assert.equal(result?.status, "skipped", rule);
    assert.match(result?.skipReason ?? "", /is the first one/);
  }
});

test("A4 case 2 — a named baseline that does not resolve is a 400, never a quiet skip", () => {
  const foreign = scan({
    id: "scn_foreign",
    serverId: "srv_2",
    serverName: "Twin",
    tools: [tool("alpha", 100)],
  });
  const failed = scan({ id: "scn_failed", status: "failed", tools: [] });
  const ports = portsFor([OLDER, NEWER, foreign, failed]);
  const document = {
    version: 1,
    target: { scan: "scn_new" },
    rules: [{ rule: "no-new-tools" }],
  };

  for (const [baseline, pattern] of [
    ["scn_typo", /does not exist on this workbench/],
    ["scn_foreign", /belongs to server "Twin"/],
    ["scn_failed", /cannot be a baseline/],
  ] as const) {
    assert.throws(
      () => evaluateAssertions(ports, request({ ...document, baseline })),
      (error: Error & { statusCode?: number }) =>
        error.statusCode === 400 && pattern.test(error.message),
      baseline,
    );
  }
});

test("A4 case 3 — an incomparable baseline is a 400 for max-scan-delta, not a suppressed-0 PASS", () => {
  // A different token profile makes `buildComparison` suppress every token delta to 0. A
  // `max-scan-delta` measured against that 0 would pass every time — which is exactly the failure a
  // footprint gate exists to catch, so it must be an error.
  const otherProfile = scan({
    id: "scn_other_profile",
    scannedAt: "2026-08-18T10:00:00.000Z",
    tokenProfile: "generic_cl100k",
    tools: [tool("alpha", 400), tool("beta", 600), tool("gone", 200)],
  });
  const ports = portsFor([otherProfile, NEWER]);

  assert.throws(
    () =>
      evaluateAssertions(
        ports,
        request({
          version: 1,
          target: { scan: "scn_new" },
          baseline: "previous",
          // A zero allowance: were the delta really suppressed to 0, this would PASS.
          rules: [{ rule: "max-scan-delta", maxTokens: 0 }],
        }),
      ),
    (error: Error & { statusCode?: number }) =>
      error.statusCode === 400 &&
      /not on the same scale/.test(error.message) &&
      /generic_cl100k/.test(error.message) &&
      /generic_o200k/.test(error.message) &&
      /counting versions 2 vs 2/.test(error.message),
  );

  // …while tool matching IS still valid in that state (the ScanComparison contract's own words), so
  // the two tool rules evaluate normally and the request succeeds.
  const report = evaluateAssertions(
    ports,
    request({
      version: 1,
      target: { scan: "scn_new" },
      baseline: "previous",
      rules: [{ rule: "no-new-tools" }, { rule: "no-removed-tools" }],
    }),
  );
  assert.equal(statusOf(report, "no-new-tools"), "fail");
  assert.equal(statusOf(report, "no-removed-tools"), "fail");
  assert.deepEqual(report.results[0]?.details, ["+ brand_new (200 tokens)"]);
});

test("A4 case 3 — a differing counting version is equally incomparable", () => {
  const olderCounting = scan({
    id: "scn_v1",
    scannedAt: "2026-08-18T10:00:00.000Z",
    countingVersion: 1,
    tools: [tool("alpha", 400)],
  });
  assert.throws(
    () =>
      evaluateAssertions(
        portsFor([olderCounting, NEWER]),
        request({
          version: 1,
          target: { scan: "scn_new" },
          baseline: "previous",
          rules: [{ rule: "max-scan-delta", maxPercent: 1 }],
        }),
      ),
    (error: Error & { statusCode?: number }) =>
      error.statusCode === 400 && /counting versions 1 vs 2/.test(error.message),
  );
});

test("A4 — a failed or in-flight subject scan is refused rather than gated against", () => {
  const failed = scan({ id: "scn_failed", status: "failed", tools: [] });
  const running = scan({ id: "scn_running", status: "running", tools: [] });
  for (const target of ["scn_failed", "scn_running"]) {
    assert.throws(
      () =>
        evaluateAssertions(
          portsFor([failed, running]),
          request({
            version: 1,
            target: { scan: target },
            // With zero tools this budget would otherwise "pass" a server that could not be reached.
            rules: [{ rule: "max-server-tokens", max: 10 }],
          }),
        ),
      (error: Error & { statusCode?: number }) =>
        error.statusCode === 400 && /cannot be asserted against/.test(error.message),
      target,
    );
  }
});

// ── A2 — the route, over a REAL Fastify app + the REAL repositories ──────────────────────────────
// The service tests above prove the arithmetic against fixtures; this proves the WIRING: that
// `ScanRepository`/`ServerRepository` really satisfy the engine's read ports at runtime (not just
// structurally at compile time), that the body is validated, and that a typed 400 leaves as a 400.

const databases: AppDatabase[] = [];
const apps: FastifyInstance[] = [];

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const db of databases.splice(0)) db.close();
});

type Harness = {
  baseUrl: string;
  db: AppDatabase;
  servers: ServerRepository;
  scans: ScanRepository;
};

async function makeApp(): Promise<Harness> {
  const db = new Database(":memory:") as unknown as AppDatabase;
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  databases.push(db);

  const secrets = new SecretStore(Buffer.alloc(32, 7));
  const servers = new ServerRepository(db, secrets);
  const scans = new ScanRepository(db);

  const app = Fastify({ logger: false });
  // The same mapping the real app installs (`apps/api/src/index.ts`).
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: "Validation failed", issues: error.issues });
    }
    const typed = error as Error & { statusCode?: number };
    return reply.code(typed.statusCode ?? 500).send({ error: error.message });
  });
  await registerAssertionRoutes(app, { scans, servers });
  await app.listen({ port: 0, host: "127.0.0.1" });
  apps.push(app);

  const address = app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return { baseUrl: `http://127.0.0.1:${port}`, db, servers, scans };
}

function seedScan(
  h: Harness,
  serverId: string,
  tools: { name: string; tokens: number }[],
  scannedAt: string,
): string {
  const created = h.scans.createRunningScan(serverId, "generic_o200k");
  const totalTokens = tools.reduce((sum, entry) => sum + entry.tokens, 0);
  const largest = [...tools].sort((a, b) => b.tokens - a.tokens)[0];
  h.scans.completeScan(
    created.id,
    {
      totalTools: tools.length,
      totalTokens,
      totalRawBytes: totalTokens * 4,
      averageTokensPerTool: tools.length === 0 ? 0 : totalTokens / tools.length,
      largestToolName: largest?.name ?? null,
      largestToolTokens: largest?.tokens ?? 0,
      totalResources: 0,
      totalResourceTemplates: 0,
      totalPrompts: 0,
      totalResourceTokens: 0,
      totalPromptTokens: 0,
      largestResourceName: null,
      largestResourceTokens: 0,
      largestPromptName: null,
      largestPromptTokens: 0,
    },
    tools.map((entry) => ({
      toolName: entry.name,
      description: `Does ${entry.name}`,
      rawTool: { name: entry.name },
      totalTokens: entry.tokens,
      nameTokens: 2,
      descriptionTokens: 3,
      schemaTokens: Math.max(entry.tokens - 5, 0),
      annotationsTokens: 0,
      rawBytes: entry.tokens * 4,
      contributionPercent: totalTokens === 0 ? 0 : (entry.tokens / totalTokens) * 100,
    })),
  );
  // Two scans seeded in the same millisecond would otherwise share an instant, and "the newest one"
  // would depend on an id tie-break rather than on what the test is actually about.
  h.db.prepare("UPDATE mcp_scans SET scanned_at = ? WHERE id = ?").run(scannedAt, created.id);
  return created.id;
}

/**
 * The response body is deliberately typed loosely: these tests assert against what came back OVER
 * THE WIRE, not against a locally re-derived `AssertionReport` — casting it to the type would make
 * a route that returned the wrong shape still typecheck.
 */
type WireResponse = { status: number; body: Record<string, unknown> };

async function postEvaluate(h: Harness, body: unknown): Promise<WireResponse> {
  const response = await fetch(`${h.baseUrl}/api/assertions/evaluate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

/** Read a dotted path out of a wire body. Keeps the assertions readable without an `any`. */
function at(body: Record<string, unknown>, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (value, key) => (value as Record<string, unknown> | undefined)?.[key],
      body as unknown,
    );
}

test("A2 — POST /api/assertions/evaluate returns an itemized report over the real repositories", async () => {
  const h = await makeApp();
  const serverId = h.servers.create({
    name: "Everything",
    transport: "stdio",
    command: "node",
    args: [],
    env: {},
    headers: {},
  }).id;
  const first = seedScan(
    h,
    serverId,
    [
      { name: "alpha", tokens: 400 },
      { name: "gone", tokens: 200 },
    ],
    "2026-08-18T10:00:00.000Z",
  );
  const second = seedScan(
    h,
    serverId,
    [
      { name: "alpha", tokens: 400 },
      { name: "brand_new", tokens: 900 },
    ],
    "2026-08-19T10:00:00.000Z",
  );
  assert.notEqual(first, second);

  const { status, body } = await postEvaluate(h, {
    document: {
      version: ASSERTIONS_VERSION,
      target: { server: "Everything" },
      baseline: "previous",
      rules: [
        { rule: "max-server-tokens", max: 5000 },
        { rule: "max-tool-tokens", max: 500 },
        { rule: "max-tool-count", max: 2 },
        { rule: "no-new-tools" },
        { rule: "no-removed-tools" },
        { rule: "max-scan-delta", maxTokens: 1000, maxPercent: 500 },
      ],
    },
  });

  assert.equal(status, 200);
  assert.equal(at(body, "subject.scanId"), second, "the newest succeeded scan is the subject");
  assert.equal(at(body, "baseline.requested"), "previous");
  assert.equal(at(body, "baseline.scan.scanId"), first, "D-C3: the resolved scan is echoed");

  const results = body.results as { rule: string; status: string }[];
  // The SCAN family — a gate document is single-family (D-C13), so a scan target's document lists
  // exactly these six and never the two suite rules.
  assert.deepEqual(
    results.map((result) => result.rule),
    SCAN_RULE_KINDS,
  );
  assert.deepEqual(body.counts, { total: 6, passed: 3, failed: 3, skipped: 0 });
  assert.equal(body.passed, false);
  // `counts` and `passed` agree with `results` — nothing is computed twice.
  assert.equal(
    at(body, "counts.failed"),
    results.filter((result) => result.status === "fail").length,
  );
});

test("A2 — a malformed body is a 400 from the shared schema, not a 500", async () => {
  const h = await makeApp();
  for (const body of [
    {},
    { document: { version: ASSERTIONS_VERSION, target: { server: "x" }, rules: [] } },
    {
      document: {
        version: 99,
        target: { server: "x" },
        rules: [{ rule: "max-tool-count", max: 1 }],
      },
    },
    {
      document: { version: ASSERTIONS_VERSION, target: { server: "x" }, rules: [{ rule: "nope" }] },
    },
  ]) {
    const response = await postEvaluate(h, body);
    assert.equal(response.status, 400, JSON.stringify(body));
  }
});

test("A2 — an unresolvable target leaves the route as a 400 with an operator sentence", async () => {
  const h = await makeApp();
  const response = await postEvaluate(h, {
    document: {
      version: ASSERTIONS_VERSION,
      target: { server: "nope" },
      rules: [{ rule: "max-tool-count", max: 1 }],
    },
  });
  assert.equal(response.status, 400);
  assert.match(
    String(response.body.error),
    /No registered server with the id or exact name "nope"/,
  );
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// WP 2.2 — the SUITE family (A1..A6) + D-C13 / D-C14 / D-C16
// ══════════════════════════════════════════════════════════════════════════════════════════════════

const SUITE_RUN = suiteRun({ id: "sr_new", startedAt: "2026-08-19T09:00:00.000Z" });
const SUITE_RUN_OLDER = suiteRun({
  id: "sr_old",
  startedAt: "2026-08-18T09:00:00.000Z",
  aggregates: aggregates({ meanGrade: 0.79, execCostUsd: 1.2, judgeCostUsd: 0.11 }),
});

/** A one-rule suite gate against `sr_new`, so each test names only what it is about. */
function suiteGate(rules: unknown[], overrides: Record<string, unknown> = {}) {
  return request({ version: 1, target: { suiteRun: "sr_new" }, rules, ...overrides });
}

// ── A1 — the two new rules, and ONLY those two ──────────────────────────────────────────────────

test("A1 (WP 2.2) — exactly two rules were added, both suite-family, both absolute", () => {
  assert.equal(SUITE_RULE_KINDS.length, 2);
  for (const kind of SUITE_RULE_KINDS) {
    assert.equal(ASSERTION_RULE_META[kind].family, "suite", kind);
    assert.equal(ASSERTION_RULE_META[kind].needsBaseline, false, kind);
  }
  // WP 3.1's `no-new-security-findings` is NOT front-run, and no `family: "security"` placeholder
  // was left behind for it.
  assert.ok(!ASSERTION_RULE_KINDS.includes("no-new-security-findings" as never));
  const families = new Set(ASSERTION_RULE_KINDS.map((kind) => ASSERTION_RULE_META[kind].family));
  assert.deepEqual([...families].sort(), ["scan", "suite"]);
});

test("A1 (WP 2.2) — the two rules and the two targets validate STRICTLY", () => {
  const base = { version: 1, target: { suite: "Nightly" } };
  const ok = (rules: unknown[], target: unknown = base.target) =>
    assertionDocumentSchema.safeParse({ ...base, target, rules }).success;

  assert.ok(ok([{ rule: "min-suite-score", min: 0.8 }]));
  assert.ok(ok([{ rule: "min-suite-score", min: 0 }]), "0 is a legal floor");
  assert.ok(ok([{ rule: "min-suite-score", min: 1 }]), "1 is a legal floor");
  assert.ok(ok([{ rule: "max-suite-cost", maxUsd: 2.5 }]));
  assert.ok(ok([{ rule: "min-suite-score", min: 0.8 }], { suiteRun: "sr_new" }));

  // A grade is a 0–1 fraction, and a budget of zero is not a budget.
  assert.ok(!ok([{ rule: "min-suite-score", min: 1.5 }]));
  assert.ok(!ok([{ rule: "min-suite-score", min: -0.1 }]));
  assert.ok(!ok([{ rule: "max-suite-cost", maxUsd: 0 }]));
  assert.ok(!ok([{ rule: "max-suite-cost", maxUsd: -1 }]));
  // `.strict()` at every level — a typo'd key is a named error, never a dropped rule.
  assert.ok(!ok([{ rule: "min-suite-score", min: 0.8, tool: "x" }]));
  assert.ok(!ok([{ rule: "max-suite-cost", max: 2 }]));
  // Two target keys at once is a validation error, exactly as `{server}` + `{scan}` is.
  assert.ok(!ok([{ rule: "max-suite-cost", maxUsd: 2 }], { suite: "a", suiteRun: "b" }));

  assert.equal(assertionTargetFamily({ suite: "a" }), "suite");
  assert.equal(assertionTargetFamily({ suiteRun: "a" }), "suite");
  assert.equal(assertionTargetFamily({ server: "a" }), "scan");
  assert.equal(assertionTargetFamily({ scan: "a" }), "scan");
});

// ── A2 — the arithmetic, including the boundaries and the null grade ────────────────────────────

test("A2 (WP 2.2) — min-suite-score passes, fails, and treats `=== min` as a pass", () => {
  const ports = suitePortsFor([SUITE_RUN]);
  const scoreOf = (min: number) =>
    evaluateAssertions(ports, suiteGate([{ rule: "min-suite-score", min }])).results[0];

  assert.equal(scoreOf(0.8)?.status, "pass");
  assert.equal(scoreOf(0.84)?.status, "pass", "the boundary is inclusive");
  assert.equal(scoreOf(0.85)?.status, "fail");
  assert.equal(scoreOf(0.9)?.observed, 0.84, "the OBSERVED value is the mean grade itself");
  assert.equal(scoreOf(0.9)?.limit, 0.9);
  assert.match(scoreOf(0.9)?.message ?? "", /Mean grade 0\.84 is below the required 0\.90\./);
  assert.match(scoreOf(0.8)?.message ?? "", /Mean grade 0\.84 is at least the required 0\.80\./);
});

test("A2 (WP 2.2) — a completed suite run whose meanGrade is null FAILS, and says why", () => {
  // NOT a skip: the run is settled (D-C16), so "no score" is the final answer. A gate that demanded
  // a score and got none has not been satisfied.
  const ungraded = suiteRun({ id: "sr_new", aggregates: aggregates({ meanGrade: null }) });
  const report = evaluateAssertions(
    suitePortsFor([ungraded]),
    suiteGate([{ rule: "min-suite-score", min: 0.5 }]),
  );
  assert.equal(report.results[0]?.status, "fail");
  assert.equal(report.passed, false);
  assert.equal(report.counts.skipped, 0, "a null grade is a FAILURE, never a skip");
  assert.equal(report.results[0]?.observed, undefined);
  assert.equal(report.results[0]?.limit, 0.5);
  assert.match(report.results[0]?.message ?? "", /No member run .* produced a graded score/);
});

test("A2 (WP 2.2) — max-suite-cost sums both halves, names both, and `=== maxUsd` passes", () => {
  // exec 0.90 + judge 0.12 = 1.02 exactly.
  const ports = suitePortsFor([SUITE_RUN]);
  const costOf = (maxUsd: number) =>
    evaluateAssertions(ports, suiteGate([{ rule: "max-suite-cost", maxUsd }])).results[0];

  assert.equal(costOf(2)?.status, "pass");
  assert.equal(costOf(1.02)?.status, "pass", "the boundary is inclusive");
  assert.equal(costOf(1)?.status, "fail");
  assert.equal(costOf(1)?.observed, 1.02);
  assert.equal(costOf(1)?.limit, 1);
  // Both halves are named: "the judge blew the budget" and "the matrix blew the budget" are
  // different problems.
  assert.match(costOf(1)?.message ?? "", /execution \$0\.90 \+ judge \$0\.12/);
  assert.match(costOf(1)?.message ?? "", /exceeds the \$1\.00 budget by \$0\.02\./);
  assert.match(costOf(2)?.message ?? "", /execution \$0\.90 \+ judge \$0\.12/);
});

test("A2 (WP 2.2) — both rules are evaluated, and the subject ref carries the suite identity", () => {
  const report = evaluateAssertions(
    suitePortsFor([SUITE_RUN]),
    suiteGate([
      { rule: "min-suite-score", min: 0.9 },
      { rule: "max-suite-cost", maxUsd: 5 },
    ]),
  );
  assert.deepEqual(
    report.results.map((result) => result.status),
    ["fail", "pass"],
    "no short-circuit on the first failure",
  );
  assert.deepEqual(report.counts, { total: 2, passed: 1, failed: 1, skipped: 0 });
  assert.deepEqual(report.subject, {
    kind: "suite_run",
    suiteRunId: "sr_new",
    suiteName: "Nightly",
    startedAt: "2026-08-19T09:00:00.000Z",
    status: "completed",
    cellsTotal: 6,
    cellsCompleted: 6,
    meanGrade: 0.84,
    execCostUsd: 0.9,
    judgeCostUsd: 0.12,
    suiteId: "ste_1",
    source: "suite",
    endedAt: "2026-08-19T09:30:00.000Z",
  });
});

// ── A3 (D-C13) — one target, one family of rules ────────────────────────────────────────────────

test("A3 (D-C13) — a MIXED document is refused, with the issue path at the offending rule index", () => {
  const suiteRuleInScanGate = assertionDocumentSchema.safeParse({
    version: 1,
    target: { server: "Everything" },
    rules: [
      { rule: "max-server-tokens", max: 3000 },
      { rule: "min-suite-score", min: 0.8 },
    ],
  });
  assert.ok(!suiteRuleInScanGate.success);
  assert.deepEqual(suiteRuleInScanGate.error?.issues[0]?.path, ["rules", 1]);
  assert.match(
    suiteRuleInScanGate.error?.issues[0]?.message ?? "",
    /"min-suite-score" is a suite rule, but this document's target is a scan target/,
  );

  const scanRuleInSuiteGate = assertionDocumentSchema.safeParse({
    version: 1,
    target: { suiteRun: "sr_new" },
    rules: [
      { rule: "min-suite-score", min: 0.8 },
      { rule: "max-suite-cost", maxUsd: 2 },
      { rule: "max-tool-count", max: 30 },
    ],
  });
  assert.ok(!scanRuleInSuiteGate.success);
  assert.deepEqual(scanRuleInSuiteGate.error?.issues[0]?.path, ["rules", 2]);

  // Every offending rule is named, not just the first — a CI log that lists one problem at a time
  // costs a round trip per problem.
  const two = assertionDocumentSchema.safeParse({
    version: 1,
    target: { suite: "Nightly" },
    rules: [
      { rule: "max-tool-count", max: 30 },
      { rule: "min-suite-score", min: 0.8 },
      { rule: "no-new-tools" },
    ],
  });
  assert.ok(!two.success);
  assert.deepEqual(
    two.error?.issues.map((issue) => issue.path),
    [
      ["rules", 0],
      ["rules", 2],
    ],
  );
});

test("A3 (D-C13) — a single-family document of EITHER family validates, and v1 is unchanged", () => {
  assert.equal(ASSERTIONS_VERSION, 1, "every WP 2.2 change is additive");
  assert.ok(
    assertionDocumentSchema.safeParse({
      version: 1,
      target: { suite: "Nightly" },
      rules: [
        { rule: "min-suite-score", min: 0.8 },
        { rule: "max-suite-cost", maxUsd: 2 },
      ],
    }).success,
  );

  // The repo's own worked example — the v1 gate file shipped by WP 1.3 — still validates unchanged.
  const example = JSON.parse(
    fs.readFileSync(
      path.join(import.meta.dirname, "..", "..", "..", "mcpfp.assert.example.json"),
      "utf8",
    ),
  );
  const parsed = assertionDocumentSchema.safeParse(example);
  assert.ok(parsed.success, JSON.stringify(parsed.error?.issues));
  assert.equal(example.version, ASSERTIONS_VERSION);
});

// ── A4 (D-C14) — a NAMED baseline is always resolved and always echoed ──────────────────────────

test("A4 (D-C14) — a named baseline is resolved and echoed even when NO rule needs one", () => {
  const report = evaluateAssertions(
    suitePortsFor([SUITE_RUN, SUITE_RUN_OLDER]),
    suiteGate([{ rule: "min-suite-score", min: 0.5 }], { baseline: "previous" }),
  );
  // Both suite rules are absolute, so without D-C14 this report would carry `baseline: null` and the
  // PR comment would have nothing to compare.
  assert.equal(report.baseline?.requested, "previous");
  assert.equal(report.baseline?.scan.kind, "suite_run");
  assert.equal(
    report.baseline?.scan.kind === "suite_run" ? report.baseline.scan.suiteRunId : undefined,
    "sr_old",
  );
  assert.equal(report.counts.skipped, 0, "resolving a baseline nobody needed skips nothing");

  // The same holds for a SCAN subject with only absolute rules.
  const scanReport = evaluateAssertions(
    portsFor([OLDER, NEWER]),
    request({
      version: 1,
      target: { scan: "scn_new" },
      baseline: "previous",
      rules: [{ rule: "max-server-tokens", max: 5000 }],
    }),
  );
  assert.equal(scanReport.baseline?.scan.kind, "scan");
  assert.equal(
    scanReport.baseline?.scan.kind === "scan" ? scanReport.baseline.scan.scanId : undefined,
    "scn_old",
  );
});

test("A4 (D-C14) — an UNNAMED baseline with only absolute rules still resolves nothing", () => {
  const scanReport = evaluateAssertions(
    portsFor([OLDER, NEWER]),
    request({
      version: 1,
      target: { scan: "scn_new" },
      rules: [{ rule: "max-server-tokens", max: 5000 }],
    }),
  );
  assert.equal(scanReport.baseline, null);
  assert.equal(scanReport.baselineSkipReason, undefined, "nothing was asked for, so nothing is said");

  const suiteReport = evaluateAssertions(
    suitePortsFor([SUITE_RUN, SUITE_RUN_OLDER]),
    suiteGate([{ rule: "max-suite-cost", maxUsd: 5 }]),
  );
  assert.equal(suiteReport.baseline, null);
  assert.equal(suiteReport.baselineSkipReason, undefined);
});

test("A4 (D-C14/D-C8) — a suite baseline honours all three D-C8 outcomes", () => {
  // Case 1 — nothing earlier yet: `baseline: null`, a reason, and still a pass.
  const first = evaluateAssertions(
    suitePortsFor([SUITE_RUN]),
    suiteGate([{ rule: "min-suite-score", min: 0.5 }], { baseline: "previous" }),
  );
  assert.equal(first.baseline, null);
  assert.equal(first.passed, true);
  assert.match(first.baselineSkipReason ?? "", /is the first one/);

  // Case 2 — a NAMED baseline that does not resolve is a 400, never a quiet skip.
  const foreign = suiteRun({ id: "sr_foreign", suiteId: "ste_2" });
  const unsettled = suiteRun({ id: "sr_unsettled", ratingState: "rating" });
  const ports = suitePortsFor([SUITE_RUN, SUITE_RUN_OLDER, foreign, unsettled]);
  for (const [baseline, pattern] of [
    ["sr_typo", /does not exist on this workbench/],
    ["sr_foreign", /belongs to suite "ste_2"/],
    ["sr_unsettled", /its review has not settled/],
  ] as const) {
    assert.throws(
      () => evaluateAssertions(ports, suiteGate([{ rule: "min-suite-score", min: 0.5 }], { baseline })),
      (error: Error & { statusCode?: number }) =>
        error.statusCode === 400 && pattern.test(error.message),
      baseline,
    );
  }

  // An explicit id and the `"previous"` that resolves to it produce the same comparison.
  const symbolic = evaluateAssertions(
    suitePortsFor([SUITE_RUN, SUITE_RUN_OLDER]),
    suiteGate([{ rule: "min-suite-score", min: 0.5 }], { baseline: "previous" }),
  );
  const explicit = evaluateAssertions(
    suitePortsFor([SUITE_RUN, SUITE_RUN_OLDER]),
    suiteGate([{ rule: "min-suite-score", min: 0.5 }], { baseline: "sr_old" }),
  );
  assert.deepEqual(symbolic.baseline?.scan, explicit.baseline?.scan);
  assert.equal(explicit.baseline?.requested, "sr_old");
});

test("A4 — a `previous` baseline for a run that belongs to NO saved suite is a loud skip, not a pick", () => {
  // A collection/adhoc plan runs as a suite run but owns no Suite row, so "the previous run of this
  // suite" names nothing. Picking some other plan's run would be the silent wrong answer.
  const { suiteId: _suiteId, ...adhoc } = suiteRun({ id: "sr_new", source: "adhoc" });
  const other = suiteRun({ id: "sr_other", startedAt: "2026-08-18T09:00:00.000Z" });
  const report = evaluateAssertions(
    suitePortsFor([adhoc, other]),
    suiteGate([{ rule: "max-suite-cost", maxUsd: 5 }], { baseline: "previous" }),
  );
  assert.equal(report.baseline, null);
  assert.match(report.baselineSkipReason ?? "", /belongs to no saved suite/);
  assert.equal(
    report.subject.kind === "suite_run" ? report.subject.suiteName : undefined,
    "(no saved suite — adhoc plan)",
  );
});

// ── A5 (D-C14 shape) — the discriminated subject ref ────────────────────────────────────────────

test("A5 (D-C14) — a scan report's JSON gains `kind` and NOTHING else", () => {
  const report = evaluateAssertions(
    portsFor([OLDER, NEWER]),
    request({
      version: 1,
      target: { scan: "scn_new" },
      baseline: "scn_old",
      rules: [{ rule: "no-new-tools" }],
    }),
  );
  // WP 1.3's exact members, plus `kind`.
  assert.deepEqual(Object.keys(report.subject).sort(), [
    "countingVersion",
    "kind",
    "scanId",
    "scannedAt",
    "serverId",
    "serverName",
    "tokenProfile",
    "totalTokens",
    "totalTools",
  ]);
  assert.equal(report.subject.kind, "scan");
  assert.deepEqual(Object.keys(report.subject).sort(), Object.keys(report.baseline?.scan ?? {}).sort());
  // The report itself gains no field when a baseline resolved.
  assert.deepEqual(Object.keys(report).sort(), [
    "assertionsVersion",
    "baseline",
    "counts",
    "evaluatedAt",
    "passed",
    "results",
    "subject",
  ]);
  // …nor when no baseline was asked for.
  const noBaseline = evaluateAssertions(
    portsFor([NEWER]),
    request({
      version: 1,
      target: { scan: "scn_new" },
      rules: [{ rule: "max-tool-count", max: 99 }],
    }),
  );
  assert.deepEqual(Object.keys(noBaseline).sort(), [
    "assertionsVersion",
    "baseline",
    "counts",
    "evaluatedAt",
    "passed",
    "results",
    "subject",
  ]);
});

// ── A6 (D-C16) — an unsettled suite run is a 400, never a score ─────────────────────────────────

test("A6 (D-C16) — every non-completed status named as the SUBJECT is a 400", () => {
  for (const status of ["running", "pending", "capped", "stopped", "error"] as SuiteRunStatus[]) {
    const run = suiteRun({ id: "sr_new", status });
    assert.throws(
      () =>
        evaluateAssertions(
          suitePortsFor([run]),
          // A floor of 0 would be met by ANY score — so an implementation that let this through
          // would report a green gate off a half-finished matrix.
          suiteGate([{ rule: "min-suite-score", min: 0 }]),
        ),
      (error: Error & { statusCode?: number }) =>
        error.statusCode === 400 &&
        new RegExp(`has status "${status}"`).test(error.message) &&
        /cannot be asserted against/.test(error.message),
      status,
    );
  }
});

test("A6 (D-C16) — a `completed` run whose rating has not settled is equally a 400", () => {
  for (const ratingState of ["pending", "rating"] as RatingState[]) {
    const run = suiteRun({ id: "sr_new", ratingState });
    assert.throws(
      () =>
        evaluateAssertions(suitePortsFor([run]), suiteGate([{ rule: "min-suite-score", min: 0 }])),
      (error: Error & { statusCode?: number }) =>
        error.statusCode === 400 &&
        /its review has not settled/.test(error.message) &&
        new RegExp(`rating state "${ratingState}"`).test(error.message),
      ratingState,
    );
  }

  // An ABSENT rating state fails closed for the same reason: the column is NOT NULL, so a run
  // without one is not a run whose review is over.
  const { ratingState: _ratingState, ...legacy } = suiteRun({ id: "sr_new" });
  assert.throws(
    () => evaluateAssertions(suitePortsFor([legacy]), suiteGate([{ rule: "max-suite-cost", maxUsd: 9 }])),
    (error: Error & { statusCode?: number }) => error.statusCode === 400,
  );

  // Every SETTLED state is accepted — `failed`/`skipped` mean the review is over, not pending.
  for (const ratingState of ["rated", "failed", "skipped"] as RatingState[]) {
    const run = suiteRun({ id: "sr_new", ratingState });
    const report = evaluateAssertions(
      suitePortsFor([run]),
      suiteGate([{ rule: "max-suite-cost", maxUsd: 9 }]),
    );
    assert.equal(report.results[0]?.status, "pass", ratingState);
  }
});

test("A6 (D-C16) — the filter applies to a `{suite}` target's CANDIDATES, not just the named run", () => {
  // The newest run of the suite is still running; the gate must fall back to the newest COMPLETED +
  // settled one rather than measuring the live matrix.
  const live = suiteRun({ id: "sr_live", startedAt: "2026-08-20T09:00:00.000Z", status: "running" });
  const report = evaluateAssertions(
    suitePortsFor([live, SUITE_RUN, SUITE_RUN_OLDER]),
    request({
      version: 1,
      target: { suite: "Nightly" },
      rules: [{ rule: "min-suite-score", min: 0.5 }],
    }),
  );
  assert.equal(
    report.subject.kind === "suite_run" ? report.subject.suiteRunId : undefined,
    "sr_new",
  );

  // …and a suite with NO usable run at all is a 400 telling you to run it, never a zero-score pass.
  assert.throws(
    () =>
      evaluateAssertions(
        suitePortsFor([live]),
        request({
          version: 1,
          target: { suite: "ste_1" },
          rules: [{ rule: "min-suite-score", min: 0.5 }],
        }),
      ),
    (error: Error & { statusCode?: number }) =>
      error.statusCode === 400 && /run `mcpfp suite run ste_1` first/.test(error.message),
  );
});

test("A6 — a `{suite}` target resolves by id or exact name, and an ambiguous name names both ids", () => {
  const ports = suitePortsFor([SUITE_RUN, SUITE_RUN_OLDER]);
  for (const suite of ["ste_1", "Nightly"]) {
    const report = evaluateAssertions(
      ports,
      request({ version: 1, target: { suite }, rules: [{ rule: "min-suite-score", min: 0.5 }] }),
    );
    assert.equal(
      report.subject.kind === "suite_run" ? report.subject.suiteRunId : undefined,
      "sr_new",
      suite,
    );
  }

  assert.throws(
    () =>
      evaluateAssertions(
        ports,
        request({
          version: 1,
          target: { suite: "Twin suite" },
          rules: [{ rule: "min-suite-score", min: 0.5 }],
        }),
      ),
    (error: Error & { statusCode?: number }) =>
      error.statusCode === 400 && /ste_2, ste_3/.test(error.message),
  );

  assert.throws(
    () =>
      evaluateAssertions(
        ports,
        request({
          version: 1,
          target: { suite: "nope" },
          rules: [{ rule: "min-suite-score", min: 0.5 }],
        }),
      ),
    (error: Error & { statusCode?: number }) =>
      error.statusCode === 400 && /No saved suite with the id or exact name "nope"/.test(error.message),
  );
});

test("A6 — the suite subject uses the SAME total-order tie-break as the scan subject", () => {
  // Two runs started in the same millisecond: the id tie-break (descending) decides, deterministically.
  const twinA = suiteRun({ id: "sr_aaa", startedAt: "2026-08-19T09:00:00.000Z" });
  const twinB = suiteRun({ id: "sr_bbb", startedAt: "2026-08-19T09:00:00.000Z" });
  for (const order of [
    [twinA, twinB],
    [twinB, twinA],
  ]) {
    const report = evaluateAssertions(
      suitePortsFor(order),
      request({
        version: 1,
        target: { suite: "ste_1" },
        rules: [{ rule: "min-suite-score", min: 0.5 }],
      }),
    );
    assert.equal(
      report.subject.kind === "suite_run" ? report.subject.suiteRunId : undefined,
      "sr_bbb",
      "the id tie-break makes the choice independent of row order",
    );
  }
});

test("A2 (WP 2.2) — a suite rule reaching a SCAN subject throws rather than passing silently", () => {
  // D-C13 makes this a VALIDATION error, so it is unreachable through the schema — which is exactly
  // why the evaluator still has to refuse it. "Unreachable" is a claim about today's schema, and a
  // rule that quietly passes because its subject was the wrong shape is the failure this whole
  // workstream exists to prevent. The cast is the only way to build the request at all.
  const smuggled = {
    document: {
      version: 1,
      target: { scan: "scn_new" },
      rules: [{ rule: "min-suite-score", min: 0.9 }],
    },
  } as unknown as AssertionEvaluateRequest;
  assert.throws(
    () => evaluateAssertions(portsFor([NEWER]), smuggled),
    (error: Error & { statusCode?: number }) =>
      error.statusCode === 500 && /not a suite run/.test(error.message),
  );
});
