import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_TOKEN_PROFILE,
  TOKEN_COUNTING_VERSION,
  WORKBENCH_MCP_DEFINITION_TOKEN_BUDGET,
  WORKBENCH_MCP_READ_TOOL_NAMES,
  WORKBENCH_MCP_RESOURCE_TEMPLATES,
} from "@mcp-token-footprint/shared";
import {
  formatSelfScanHeadline,
  renderSelfScanJson,
  renderSelfScanMarkdown,
  runWorkbenchSelfScan,
  type WorkbenchSelfScanResult,
} from "../src/mcp-server/self-scan.js";

// ==================================================================================================
// The self-scan gate (D-MCP5) inside the normal test run
// ==================================================================================================
// `pnpm mcp:self-scan` is the CI job; this is the same routine invoked in-process, so the dogfood
// assertion cannot rot between CI runs. It boots the real mount on an ephemeral loopback port,
// registers it as an ordinary streamable-HTTP server in a throwaway database, and runs the app's own
// discovery scan against it — no network beyond loopback, no provider key, no MCP child process.
//
// One scan is shared by every assertion below: it is a real scan (initialize + tools/list +
// resources/list + templates + prompts, then a BPE count per tool), which is cheap but not free.

let cached: Promise<WorkbenchSelfScanResult> | undefined;
const selfScan = () => {
  cached ??= runWorkbenchSelfScan();
  return cached;
};

test("the app can scan its OWN MCP mount with its own discovery scanner", async () => {
  const result = await selfScan();

  // A real scan row, produced by ScanService — not a hand-built summary.
  assert.equal(result.scan.status, "success");
  assert.equal(result.scan.serverName, "Workbench MCP server (self-scan)");
  assert.equal(result.tokenProfile, DEFAULT_TOKEN_PROFILE);
  assert.equal(result.countingVersion, TOKEN_COUNTING_VERSION);
  assert.ok(result.scan.scannedAt.length > 0);

  // The scan really talked MCP: its event log is the discovery conversation.
  const events = result.scan.events.map((event) => event.message).join("\n");
  assert.match(events, /MCP initialize completed/);
  assert.match(events, /tools\/list returned/);
  assert.ok(
    result.scan.events.every((event) => event.level !== "error"),
    `self-scan logged an error event:\n${events}`,
  );
});

test("the self-scan sees exactly the tool surface the shared contract declares", async () => {
  const result = await selfScan();

  assert.equal(result.declaredToolCount, WORKBENCH_MCP_READ_TOOL_NAMES.length);
  assert.equal(result.toolCount, WORKBENCH_MCP_READ_TOOL_NAMES.length);
  assert.deepEqual(
    result.tools.map((tool) => tool.name).sort(),
    [...WORKBENCH_MCP_READ_TOOL_NAMES].sort(),
  );
  // Every tool cost something and the shares add up — a zeroed count would make the budget vacuous.
  assert.ok(result.tools.every((tool) => tool.totalTokens > 0));
  const contribution = result.tools.reduce((sum, tool) => sum + tool.contributionPercent, 0);
  assert.ok(Math.abs(contribution - 100) < 0.001, `contributions summed to ${contribution}`);

  // The four report resource templates are part of the scanned definition surface too.
  assert.equal(
    result.resourceTemplateCount,
    Object.keys(WORKBENCH_MCP_RESOURCE_TEMPLATES).length,
    "the scan should see all four report resource templates",
  );
});

test("the measured definition footprint is under the declared budget (the gate)", async () => {
  const result = await selfScan();

  // Printed so a test run records the real number, exactly as the CI job does.
  console.log(formatSelfScanHeadline(result));

  assert.equal(result.budget, WORKBENCH_MCP_DEFINITION_TOKEN_BUDGET);
  assert.equal(result.measuredTokens, result.scan.totalTokens);
  assert.equal(result.overBudget, false);
  assert.ok(
    result.measuredTokens < WORKBENCH_MCP_DEFINITION_TOKEN_BUDGET,
    `tool definitions cost ${result.measuredTokens} tokens, over the ${WORKBENCH_MCP_DEFINITION_TOKEN_BUDGET} budget`,
  );
});

test("both artifacts render, carry the verdict, and expose no local path", async () => {
  const result = await selfScan();

  const json = JSON.parse(renderSelfScanJson(result)) as WorkbenchSelfScanResult;
  assert.equal(json.measuredTokens, result.measuredTokens);
  assert.equal(json.toolCount, result.toolCount);
  assert.equal(json.scan.tools.length, result.toolCount);

  const markdown = renderSelfScanMarkdown(result);
  assert.match(markdown, /# Workbench MCP server — self-scan/);
  assert.match(markdown, /within budget/);
  assert.ok(markdown.includes(String(result.measuredTokens)));
  // The scan report the app would export for any other server is embedded, not re-derived here.
  assert.match(markdown, /# MCP Token Footprint Report/);

  // An artifact is uploaded by CI: it may name the loopback mount, never a filesystem location.
  assert.match(result.mountUrl, /^http:\/\/127\.0\.0\.1:\d+\/api\/mcp$/);
  for (const body of [json.mountUrl, markdown]) {
    assert.ok(!body.includes("/Users/"), "artifact leaked an absolute local path");
    assert.ok(!body.includes("/tmp/"), "artifact leaked a temp-directory path");
  }
});
