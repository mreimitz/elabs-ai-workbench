import assert from "node:assert/strict";
import { test } from "node:test";
import type { ScanDetail, ToolScan } from "@mcp-token-footprint/shared";
import { buildServerTestReport, buildToolTestReport } from "../src/compatibility/service.js";

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
  };
}

const MODELS = ["gpt-5.5", "claude-opus-4-8", "microsoft/phi-4"];

test("server test report contains ONLY server-level tests (no environment/tool/session)", () => {
  const report = buildServerTestReport(makeScan([tool("search", 300)]), MODELS);
  assert.equal(report.subjectType, "server");
  assert.equal(report.models.length, 3);
  assert.ok(report.entries.length > 0);
  assert.ok(
    report.entries.every((e) => e.level === "server"),
    "every entry must be a server-level test",
  );
  assert.ok(
    !report.entries.some((e) => e.testId.startsWith("ENV_")),
    "no environment tests on the server tab",
  );
  // each entry carries one result per requested model.
  for (const e of report.entries)
    assert.equal(e.results.length, 3, `${e.testId} should have a result per model`);
});

test("tool test report contains ONLY tool-level tests, per tool", () => {
  const report = buildToolTestReport(
    makeScan([tool("search", 300), tool("fetch", 200)]),
    "search",
    MODELS,
  );
  assert.equal(report.subjectType, "tool");
  assert.equal(report.subjectId, "search");
  assert.ok(report.entries.length > 0);
  assert.ok(
    report.entries.every((e) => e.level === "tool"),
    "every entry must be a tool-level test",
  );
  assert.ok(report.entries.every((e) => e.results.every((r) => r.subjectId === "search")));
});

test("status counts are VERDICT-aware: a passing test reads 'pass', never a scary severity", () => {
  // A clean small server: no duplicate names → every model PASSES SERVER_TOOL_NAME_DUPLICATE.
  const report = buildServerTestReport(makeScan([tool("search", 300), tool("fetch", 200)]), MODELS);
  const dup = report.entries.find((e) => e.testId === "SERVER_TOOL_NAME_DUPLICATE");
  assert.ok(dup, "duplicate-name test present");
  assert.deepEqual(
    dup.statusCounts,
    { pass: 3 },
    "all-pass test must read '3 pass', not '3 blocker'",
  );

  // A heavy footprint genuinely fails on a tiny window → that one shows up as a severity, the rest pass.
  const heavy = buildServerTestReport(
    makeScan([tool("a", 4000), tool("b", 4000), tool("c", 4000)]),
    MODELS,
  );
  const fp = heavy.entries.find((e) => e.testId === "SERVER_DEFINITION_FOOTPRINT");
  assert.ok(fp, "footprint test present");
  const total = Object.values(fp.statusCounts).reduce((a, n) => a + (n ?? 0), 0);
  assert.equal(total, 3, "counts cover all three models");
  assert.ok((fp.statusCounts.pass ?? 0) >= 1, "large-window models pass");
  assert.ok((fp.statusCounts.blocker ?? 0) >= 1, "the tiny-window model is a real blocker finding");
});

test("models richer-than-heatmap refs carry provider name + group for the UI grouping", () => {
  const report = buildServerTestReport(makeScan([tool("x", 100)]), ["gpt-5.5"]);
  assert.equal(report.models[0]?.providerName, "OpenAI (GPT)");
  assert.equal(report.models[0]?.group, "saas");
});

test("unknown tool name → empty report (no throw)", () => {
  const report = buildToolTestReport(makeScan([tool("x", 100)]), "nope", MODELS);
  assert.equal(report.entries.length, 0);
});
