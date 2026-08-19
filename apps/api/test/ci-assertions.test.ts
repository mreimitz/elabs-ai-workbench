import assert from "node:assert/strict";
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
  MCPFP_ASSERT_FILE_NAME,
  type ScanDetail,
  type ScanSummary,
  type ServerConfig,
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

/** A port set over an in-memory list of scans. `getDetail` throws the repository's 404 shape. */
function portsFor(scans: ScanDetail[], servers: ServerConfig[] = SERVERS): AssertionPorts {
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
    now: () => new Date("2026-08-19T12:00:00.000Z"),
  };
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
  assert.deepEqual(
    [...ASSERTION_RULE_KINDS],
    [
      "max-server-tokens",
      "max-tool-tokens",
      "max-tool-count",
      "no-new-tools",
      "no-removed-tools",
      "max-scan-delta",
    ],
  );
  // Every kind carries prose, so `mcpfp help assert` and the user guide cannot describe a rule the
  // schema does not accept (or miss one it does).
  for (const kind of ASSERTION_RULE_KINDS) {
    assert.ok(ASSERTION_RULE_META[kind].summary.length > 0, kind);
  }

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
    tools: Array.from({ length: ASSERTION_DETAIL_LIMIT + 5 }, (_, index) =>
      tool(`t${index}`, 900),
    ),
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

async function postEvaluate(h: Harness, body: unknown): Promise<{ status: number; body: any }> {
  const response = await fetch(`${h.baseUrl}/api/assertions/evaluate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
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
  assert.equal(body.subject.scanId, second, "the newest succeeded scan is the subject");
  assert.equal(body.baseline.requested, "previous");
  assert.equal(body.baseline.scan.scanId, first, "D-C3: the concrete resolved scan is echoed");
  assert.equal(body.results.length, ASSERTION_RULE_KINDS.length);
  assert.deepEqual(
    body.results.map((result: { rule: string }) => result.rule),
    [...ASSERTION_RULE_KINDS],
  );
  assert.deepEqual(body.counts, { total: 6, passed: 3, failed: 3, skipped: 0 });
  assert.equal(body.passed, false);
  // `counts` and `passed` agree with `results` — nothing is computed twice.
  assert.equal(
    body.counts.failed,
    body.results.filter((result: { status: string }) => result.status === "fail").length,
  );
});

test("A2 — a malformed body is a 400 from the shared schema, not a 500", async () => {
  const h = await makeApp();
  for (const body of [
    {},
    { document: { version: ASSERTIONS_VERSION, target: { server: "x" }, rules: [] } },
    { document: { version: 99, target: { server: "x" }, rules: [{ rule: "max-tool-count", max: 1 }] } },
    { document: { version: ASSERTIONS_VERSION, target: { server: "x" }, rules: [{ rule: "nope" }] } },
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
  assert.match(response.body.error, /No registered server with the id or exact name "nope"/);
});
