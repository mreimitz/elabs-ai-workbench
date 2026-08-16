import assert from "node:assert/strict";
import { test } from "node:test";
import type { ScanDetail, ServerConfig, ToolScan } from "@mcp-token-footprint/shared";
import { createServerReport } from "../src/reports/server-report.js";

function tool(name: string, totalTokens: number, over: Partial<ToolScan> = {}): ToolScan {
  return {
    id: `t_${name}`,
    scanId: "scan_1",
    toolName: name,
    description: "Does a thing.",
    inputSchema: { type: "object", properties: { q: { type: "string" } } },
    annotations: undefined,
    rawTool: {},
    contributionPercent: 0,
    totalTokens,
    nameTokens: 2,
    descriptionTokens: 8,
    schemaTokens: Math.max(0, totalTokens - 10),
    annotationsTokens: 0,
    rawBytes: totalTokens * 4,
    ...over,
  };
}

function makeScan(tools: ToolScan[]): ScanDetail {
  const totalTokens = tools.reduce((a, t) => a + t.totalTokens, 0);
  return {
    id: "scan_1",
    serverId: "srv_1",
    serverName: "Demo Server",
    tokenProfile: "generic_o200k",
    scannedAt: new Date(0).toISOString(),
    status: "success",
    totalTools: tools.length,
    totalTokens,
    totalRawBytes: totalTokens * 4,
    averageTokensPerTool: tools.length ? totalTokens / tools.length : 0,
    largestToolTokens: tools.reduce((m, t) => Math.max(m, t.totalTokens), 0),
    tools,
    events: [],
  } as unknown as ScanDetail;
}

const SERVER: ServerConfig = {
  id: "srv_1",
  name: "Demo Server",
  transport: "streamable_http",
  url: "https://demo.example/mcp",
  authType: "none",
  hasEnvSecrets: false,
  hasHeaderSecrets: false,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

// A real small-window model (phi-4) makes the footprint test a genuine blocker; the flagships pass.
const MODELS = ["claude-opus-4-8", "gpt-5.5", "microsoft/phi-4"];

test("server report carries the redacted profile, the scan, and the selected models", () => {
  const report = createServerReport(makeScan([tool("search", 300)]), SERVER, MODELS);
  assert.equal(report.server.id, "srv_1");
  assert.equal(report.server.hasEnvSecrets, false, "redacted profile (booleans only)");
  assert.equal(report.scan.id, "scan_1");
  assert.equal(report.models.length, 3);
  assert.ok(typeof report.generatedAt === "string" && report.generatedAt.length > 0);
});

test("server tests are the FULL ledger — findings AND passes both present", () => {
  // Heavy footprint on a tiny window fails; duplicate-name on a clean server passes.
  const report = createServerReport(
    makeScan([tool("a", 4000), tool("b", 4000), tool("c", 4000)]),
    SERVER,
    MODELS,
  );
  assert.ok(report.serverTests.entries.length > 0);
  assert.ok(report.serverTests.entries.every((e) => e.level === "server"));

  const dup = report.serverTests.entries.find((e) => e.testId === "SERVER_TOOL_NAME_DUPLICATE");
  assert.ok(dup && (dup.statusCounts.pass ?? 0) >= 1, "a passing test is included in the ledger");

  const fp = report.serverTests.entries.find((e) => e.testId === "SERVER_DEFINITION_FOOTPRINT");
  assert.ok(fp, "footprint test present");
  assert.ok((fp.statusCounts.blocker ?? 0) >= 1, "tiny-window model is a real blocker finding");
  // R&D evidence: every result carries a filled rationale; the aggregate test attaches affected tools.
  assert.ok(fp.results.every((r) => typeof r.rationale === "string"));
  const flagged = fp.results.find((r) => (r.affectedTools?.length ?? 0) > 0);
  assert.ok(flagged && flagged.affectedTools, "footprint finding lists the offending tools");
});

test("flagged tools (≥1 finding) get a full per-tool report; clean detail is omitted", () => {
  // A 80-char tool name trips TOOL_NAME_LENGTH on models with a documented cap.
  const longName = `search_${"x".repeat(80)}`;
  const report = createServerReport(
    makeScan([tool(longName, 300), tool("ok", 100)]),
    SERVER,
    MODELS,
  );

  const flaggedSummary = report.toolFindings.byTool.find((t) => t.toolName === longName);
  assert.ok(flaggedSummary && flaggedSummary.total > 0, "the long-named tool is flagged in byTool");

  const detail = report.flaggedToolTests.find((r) => r.subjectId === longName);
  assert.ok(detail, "flagged tool has a full tool-test report");
  assert.ok(detail.entries.length > 0 && detail.entries.every((e) => e.level === "tool"));
  // Reasoning material is present per the R&D requirement.
  assert.ok(detail.entries.some((e) => e.results.some((r) => r.verdict !== "pass")));
  assert.ok(detail.entries.every((e) => typeof e.whatItDoes === "string"));
});

test("passing host-client target is accepted and does not throw", () => {
  const report = createServerReport(makeScan([tool("search", 300)]), SERVER, MODELS, "cursor");
  assert.equal(report.client, "cursor");
  assert.ok(report.serverTests.entries.length > 0);
});
