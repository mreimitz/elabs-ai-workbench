// ── Server-level Export Report builder (HTML → print-to-PDF) ────────────────────────────────────
// A PURE function (no DB) that aggregates the full server-level report payload from ONE ScanDetail +
// its redacted ServerConfig: the server profile + footprint + EVERY server-level test (findings AND
// passes) + the tool-findings rollup + the full tool-test report for each FLAGGED tool (≥1 finding).
// It reuses the existing compatibility engine builders — no new test logic lives here — so the report
// is identical to what the live "Tests" tabs / Overview "Findings" card show. Unit-testable over a
// fixture scan, exactly like createMarkdownReport / createRunMarkdownReport.

import type {
  CompatibilitySeverity,
  CompatibilityTestReport,
  ScanDetail,
  SecurityPostureSection,
  ServerConfig,
  ServerReport,
  ToolSeveritySummary,
} from "@mcp-token-footprint/shared";
import {
  buildServerTestReport,
  buildToolFindings,
  buildToolTestReport,
} from "../compatibility/service.js";
import { dataPackStamp } from "../data-pack/stamp.js";

const SEVERITY_WEIGHT: Record<CompatibilitySeverity, number> = {
  blocker: 1000,
  high: 100,
  medium: 10,
  low: 1,
};

/** Worst-first ordering weight for a tool's issue tally (blocker ≫ high ≫ medium ≫ low). */
function severityScore(summary: ToolSeveritySummary): number {
  let score = 0;
  for (const [sev, count] of Object.entries(summary.counts)) {
    score += (SEVERITY_WEIGHT[sev as CompatibilitySeverity] ?? 0) * (count ?? 0);
  }
  return score;
}

/**
 * RM-20 WP 2.2 — `security` is the posture section, and it is the LAST parameter and **optional**
 * (D-SP24) so every pre-existing call site is untouched. It is composed here rather than in each
 * renderer so the HTML/JSON payload and its Markdown twin report the same posture: both formats
 * render this ONE document, exactly as they already do for every other section.
 */
export function createServerReport(
  scan: ScanDetail,
  server: ServerConfig,
  modelIds: string[],
  client?: string,
  security?: SecurityPostureSection,
): ServerReport {
  const serverTests = buildServerTestReport(scan, modelIds, client);
  const toolFindings = buildToolFindings(scan, modelIds, client);

  // Flagged tools = tools with ≥1 tool-test finding, worst-first. Only these get the full per-tool
  // drill-down (the "detail if flagged" decision); clean tools stay in the compact inventory.
  const flaggedToolNames = toolFindings.byTool
    .filter((t) => t.total > 0)
    .sort((a, b) => severityScore(b) - severityScore(a) || a.toolName.localeCompare(b.toolName))
    .map((t) => t.toolName);

  const flaggedToolTests: CompatibilityTestReport[] = flaggedToolNames.map((toolName) =>
    buildToolTestReport(scan, toolName, modelIds, client),
  );

  return {
    // RM-38 D-DP8 — the pack behind this document's compatibility verdicts and security section.
    ...dataPackStamp(),
    generatedAt: new Date().toISOString(),
    server,
    scan,
    // Use the engine-resolved model list (filters unknown ids, carries provider/group metadata).
    models: serverTests.models,
    ...(client ? { client } : {}),
    serverTests,
    toolFindings,
    flaggedToolTests,
    ...(security === undefined ? {} : { security }),
  };
}
