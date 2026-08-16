import assert from "node:assert/strict";
import { test } from "node:test";
import type { ScanDetail, ServerConfig, ToolScan } from "@mcp-token-footprint/shared";
import { createServerReport } from "../src/reports/server-report.js";
import { createServerMarkdownReport } from "../src/reports/server-report-markdown.js";

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

test("markdown report has the title, legend, and every section heading", () => {
  const md = createServerMarkdownReport(
    createServerReport(
      makeScan([tool("a", 4000), tool("b", 4000), tool("c", 4000)]),
      SERVER,
      MODELS,
    ),
    "all",
  );
  assert.ok(
    md.startsWith("# MCP Server Compatibility & Footprint Report — Demo Server"),
    "title present",
  );
  assert.ok(md.includes("**Legend**") && md.includes("[BLOCKER]"), "legend + bracket tags present");
  for (const heading of [
    "## Server",
    "## Executive summary",
    "## Server-level findings",
    "## Server-level test ledger",
    "## Tool detail",
    "## Tool summary",
    "## Tool inventory",
    "## Appendix",
  ]) {
    assert.ok(md.includes(heading), `missing section: ${heading}`);
  }
  // Colour is replaced by bracket tags, not emoji.
  assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(md), "no emoji in the document");
});

test("a real blocker finding surfaces a [BLOCKER] tag", () => {
  const md = createServerMarkdownReport(
    createServerReport(
      makeScan([tool("a", 4000), tool("b", 4000), tool("c", 4000)]),
      SERVER,
      MODELS,
    ),
    "all",
  );
  assert.ok(md.includes("[BLOCKER]"), "the tiny-window footprint blocker shows a [BLOCKER] tag");
});

test("tool lists are COMPLETE — no '+N more' truncation marker", () => {
  // 25 tools each tripping TOOL_NAME_LENGTH (an 80-char name) → the tool-level findings list every one.
  const tools = Array.from({ length: 25 }, (_, i) => tool(`search_${i}_${"x".repeat(80)}`, 300));
  const report = createServerReport(makeScan(tools), SERVER, MODELS);
  const md = createServerMarkdownReport(report, "all");

  assert.ok(!md.includes(" more"), "no '+N more' truncation marker anywhere");
  // The complete inventory table lists all 25 tools (one numbered row each).
  for (let i = 1; i <= 25; i += 1)
    assert.ok(md.includes(`| ${i} | `), `inventory row ${i} present`);
  // Every tool name appears (the full per-test severity list + inventory).
  for (const t of tools) assert.ok(md.includes(t.toolName), `tool ${t.toolName} listed`);
});

test("the detail filter gates the detail blocks (blocker-only ≤ all)", () => {
  const report = createServerReport(
    makeScan([tool("a", 4000), tool("b", 4000), tool("c", 4000)]),
    SERVER,
    MODELS,
  );
  const all = createServerMarkdownReport(report, "all");
  const blocker = createServerMarkdownReport(report, "blocker");

  const countDetailHeadings = (md: string) => (md.match(/^### \[/gm) ?? []).length;
  assert.ok(
    countDetailHeadings(blocker) <= countDetailHeadings(all),
    "blocker-only yields no more server-finding detail blocks than all",
  );
  // The "All tool tests" per-tool ledger only renders in full-detail mode.
  assert.ok(all.includes("**All tool tests**"), "full ledger present at detail=all");
  assert.ok(
    !blocker.includes("**All tool tests**"),
    "per-tool full ledger suppressed at a severity filter",
  );
});

test("host-client target is reflected and the report still builds", () => {
  const md = createServerMarkdownReport(
    createServerReport(makeScan([tool("search", 300)]), SERVER, MODELS, "cursor"),
    "all",
  );
  assert.ok(md.includes("**Host client:** Cursor"), "host client label rendered");
});
