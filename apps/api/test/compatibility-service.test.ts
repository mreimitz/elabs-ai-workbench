import assert from "node:assert/strict";
import { test } from "node:test";
import type { ScanDetail, ToolScan } from "@mcp-token-footprint/shared";
import { buildHeatmap } from "../src/compatibility/service.js";

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
    schemaTokens: totalTokens - 10,
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

const MODELS = ["gpt-5.5", "microsoft/phi-4"];

test("server heatmap: one row, a cell per model, with results for drill-down", () => {
  const scan = makeScan([tool("search", 300), tool("fetch", 250)]);
  const hm = buildHeatmap(scan, MODELS, { view: "server", rollup: "worst-tool" });
  assert.equal(hm.view, "server");
  assert.equal(hm.models.length, 2);
  assert.equal(hm.rows.length, 1);
  assert.equal(hm.rows[0]?.cells.length, 2);
  assert.ok((hm.rows[0]?.cells[0]?.results.length ?? 0) > 0, "cell carries results for drill-down");
});

test("tool heatmap: one row per tool", () => {
  const scan = makeScan([tool("search", 300), tool("fetch", 250)]);
  const hm = buildHeatmap(scan, MODELS, { view: "tool", rollup: "worst-tool" });
  assert.equal(hm.view, "tool");
  assert.equal(hm.rows.length, 2);
  assert.deepEqual(hm.rows.map((r) => r.subjectId).sort(), ["fetch", "search"]);
});

test("same server is worse on a small-window model than a 1M-window one (the heatmap thesis)", () => {
  // A heavy server: ~12k tool-definition tokens — trivial on gpt-5.5 (1.05M), fatal on Phi-4 (16k).
  const big = makeScan([tool("a", 4000), tool("b", 4000), tool("c", 4000)]);
  const hm = buildHeatmap(big, MODELS, { view: "server", rollup: "worst-tool" });
  const cellFor = (id: string) => hm.rows[0]?.cells.find((c) => c.modelId === id);
  assert.equal(cellFor("microsoft/phi-4")?.band, "red", "12k tokens overflows Phi-4's 16k window");
  assert.notEqual(cellFor("gpt-5.5")?.band, "red", "trivial footprint on a 1M-window model");
});

test("unknown model ids are dropped from the column set", () => {
  const hm = buildHeatmap(makeScan([tool("x", 100)]), ["gpt-5.5", "not-a-real-model"], {
    view: "server",
    rollup: "worst-tool",
  });
  assert.equal(hm.models.length, 1);
  assert.equal(hm.models[0]?.id, "gpt-5.5");
});
