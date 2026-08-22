// Orchestration: turn a scan (+ optional multi-scan environment) into the Server×Model / Tool×Model
// heatmap the web view renders. Pure over its inputs (loads only the bundled dataset); the route
// supplies the scan(s) from the DB, honouring the runtime boundary.

import type {
  CompatibilityBand,
  CompatibilityCell,
  CompatibilityHeatmap,
  CompatibilityHeatmapRow,
  CompatibilityReportModel,
  CompatibilityResult,
  CompatibilitySeverity,
  CompatibilityTestEntry,
  CompatibilityTestReport,
  ScanDetail,
  ToolFindingEntry,
  ToolFindingTool,
  ToolFindingsReport,
  ToolSeveritySummary,
} from "@mcp-token-footprint/shared";
import { getTest } from "./catalog.js";
import { getModel, listModelRefs } from "./dataset.js";
import {
  runServerLevel,
  runToolLevel,
  scoreCell,
  type EnvInput,
  type ScanInput,
  type ToolInput,
} from "./runner.js";

function toScanInput(scan: ScanDetail): ScanInput {
  return {
    scanId: scan.id,
    serverName: scan.serverName,
    totalTools: scan.totalTools,
    totalTokens: scan.totalTokens,
    totalRawBytes: scan.totalRawBytes,
    tools: scan.tools.map(toToolInput),
  };
}

function toToolInput(t: ScanDetail["tools"][number]): ToolInput {
  return {
    toolName: t.toolName,
    description: t.description,
    descriptionTokens: t.descriptionTokens,
    totalTokens: t.totalTokens,
    inputSchema: t.inputSchema,
    annotations: t.annotations,
  };
}

function aggregate(scans: ScanInput[]): EnvInput {
  return {
    totalTools: scans.reduce((a, s) => a + s.totalTools, 0),
    totalTokens: scans.reduce((a, s) => a + s.totalTokens, 0),
    totalRawBytes: scans.reduce((a, s) => a + s.totalRawBytes, 0),
  };
}

// `untested` ranks LOWEST so a server rollup reflects the worst REAL evidence — one untested tool
// never dominates tools that were actually measured — while an all-untested rollup correctly stays
// `untested` (seeded below), instead of the old seed "green" that made a wholly-untested server read
// as verified (the same "absence of evidence ≠ positive evidence" defect T6 fixed at the cell level).
const BAND_RANK: Record<CompatibilityBand, number> = { untested: -1, green: 0, amber: 1, red: 2 };

function worstBand(bands: CompatibilityBand[]): CompatibilityBand {
  return bands.reduce<CompatibilityBand>(
    (worst, b) => (BAND_RANK[b] > BAND_RANK[worst] ? b : worst),
    "untested",
  );
}

export type HeatmapOpts = {
  view: "server" | "tool";
  rollup: "worst-tool" | "average-tool";
  client?: string;
  /** Extra scans folded into the aggregate environment totals (for ENV_AGGREGATE_* caps). */
  envScans?: ScanDetail[];
};

export function buildHeatmap(
  scan: ScanDetail,
  modelIds: string[],
  opts: HeatmapOpts,
): CompatibilityHeatmap {
  const known = modelIds.filter((id) => getModel(id));
  const refs = listModelRefs();
  const models = known.map((id) => {
    const r = refs.find((m) => m.id === id);
    return { id, providerId: r?.providerId ?? "unknown", displayName: r?.displayName ?? id };
  });

  const scanInput = toScanInput(scan);
  const env = aggregate([scanInput, ...(opts.envScans ?? []).map(toScanInput)]);

  const rows: CompatibilityHeatmapRow[] =
    opts.view === "tool"
      ? scanInput.tools.map((tool) => ({
          subjectType: "tool" as const,
          subjectId: tool.toolName,
          label: tool.toolName,
          cells: known.map((modelId) =>
            scoreCell(modelId, runToolLevel(tool, modelId, { client: opts.client })),
          ),
        }))
      : [
          {
            subjectType: "server" as const,
            subjectId: scan.id,
            label: scan.serverName,
            cells: known.map((modelId) => serverCell(scanInput, modelId, env, opts)),
          },
        ];

  return { view: opts.view, rollup: opts.rollup, client: opts.client, models, rows };
}

// --- Per-test report (the "Tests" tab) -----------------------------------------------------------

const SEVERITY_WEIGHT: Record<string, number> = { blocker: 4, high: 3, medium: 2, low: 1, na: 0 };

function reportModels(modelIds: string[]): CompatibilityReportModel[] {
  const byId = new Map(listModelRefs().map((r) => [r.id, r]));
  return modelIds
    .map((id) => byId.get(id))
    .filter((r): r is NonNullable<typeof r> => Boolean(r))
    .map((r) => ({
      id: r.id,
      providerId: r.providerId,
      providerName: r.providerName,
      displayName: r.displayName,
      group: r.group,
    }));
}

/**
 * Group per-model results by test into report entries. `runFor` returns one model's results (already
 * filtered to the relevant level); we transpose to test → [one result per model], tally severities,
 * and order the most severe non-pass findings first.
 */
function buildEntries(
  modelIds: string[],
  runFor: (modelId: string) => CompatibilityResult[],
): CompatibilityTestEntry[] {
  const byTest = new Map<string, CompatibilityResult[]>();
  for (const modelId of modelIds) {
    for (const result of runFor(modelId)) {
      const arr = byTest.get(result.testId) ?? [];
      arr.push(result);
      byTest.set(result.testId, arr);
    }
  }

  const entries: CompatibilityTestEntry[] = [];
  for (const [testId, results] of byTest) {
    const first = results[0];
    if (!first) continue;
    const test = getTest(testId);
    // Outcome tally: a passing model counts as `pass`, n/a as `na`, and only a failing/warning model
    // contributes its resolved severity. (A passing test must not read as "33 blocker".)
    const statusCounts: Partial<Record<"pass" | "na" | CompatibilitySeverity, number>> = {};
    for (const r of results) {
      const key =
        r.verdict === "pass"
          ? "pass"
          : r.verdict === "na"
            ? "na"
            : (r.severity as CompatibilitySeverity);
      statusCounts[key] = (statusCounts[key] ?? 0) + 1;
    }
    entries.push({
      testId,
      techName: first.techName,
      userFacingName: first.userFacingName,
      findingName: first.findingName,
      level: first.level,
      category: test?.category ?? "",
      executionMode: test?.execution_mode ?? "static_connection",
      whatItDoes: first.message,
      recommendation: first.recommendation,
      statusCounts,
      results,
    });
  }

  const rank = (e: CompatibilityTestEntry): number =>
    Math.max(
      0,
      ...e.results
        .filter((r) => r.verdict === "fail" || r.verdict === "warn")
        .map((r) => SEVERITY_WEIGHT[r.severity] ?? 0),
    );
  entries.sort((a, b) => rank(b) - rank(a) || a.userFacingName.localeCompare(b.userFacingName));
  return entries;
}

/** Server-LEVEL test report for a scan (environment + session tests are excluded — they live elsewhere). */
export function buildServerTestReport(
  scan: ScanDetail,
  modelIds: string[],
  client?: string,
): CompatibilityTestReport {
  const known = modelIds.filter((id) => getModel(id));
  const scanInput = toScanInput(scan);
  const env = aggregate([scanInput]);
  const entries = buildEntries(known, (modelId) =>
    runServerLevel(scanInput, modelId, { client }, env).filter((r) => r.level === "server"),
  );
  return {
    subjectType: "server",
    subjectId: scan.id,
    subjectLabel: scan.serverName,
    models: reportModels(known),
    entries,
  };
}

/**
 * The single test-driven findings model, transposed two ways from ONE tool×test×model run:
 *  • `byTest` — tool-level tests aggregated across tools (the offending tools attached), so the server
 *    Overview can show e.g. "Thin descriptions — 11 tools" with links, alongside the server tests.
 *  • `byTool` — per-tool severity tally, for the tool-list "Issues" column.
 * A (tool, test) "finding" is the worst non-pass/non-na severity across the requested models.
 */
export function buildToolFindings(
  scan: ScanDetail,
  modelIds: string[],
  client?: string,
): ToolFindingsReport {
  const known = modelIds.filter((id) => getModel(id));
  const worse = (a: CompatibilitySeverity, b: CompatibilitySeverity) =>
    (SEVERITY_WEIGHT[a] ?? 0) > (SEVERITY_WEIGHT[b] ?? 0) ? a : b;

  // tool name -> (testId -> worst severity across models)
  const perTool = new Map<string, Map<string, CompatibilitySeverity>>();
  for (const tool of scan.tools) {
    const input = toToolInput(tool);
    const tests = new Map<string, CompatibilitySeverity>();
    for (const modelId of known) {
      for (const r of runToolLevel(input, modelId, { client })) {
        if (r.verdict === "pass" || r.verdict === "na" || r.severity === "na") continue;
        const sev = r.severity as CompatibilitySeverity;
        const prev = tests.get(r.testId);
        tests.set(r.testId, prev ? worse(sev, prev) : sev);
      }
    }
    perTool.set(tool.toolName, tests);
  }

  const byTool: ToolSeveritySummary[] = scan.tools.map((tool) => {
    const tests = perTool.get(tool.toolName) ?? new Map<string, CompatibilitySeverity>();
    const counts: Partial<Record<CompatibilitySeverity, number>> = {};
    for (const sev of tests.values()) counts[sev] = (counts[sev] ?? 0) + 1;
    return { toolName: tool.toolName, counts, total: tests.size };
  });

  const byTestMap = new Map<string, ToolFindingTool[]>();
  for (const [toolName, tests] of perTool) {
    for (const [testId, severity] of tests) {
      const arr = byTestMap.get(testId) ?? [];
      arr.push({ toolName, severity });
      byTestMap.set(testId, arr);
    }
  }

  const byTest: ToolFindingEntry[] = [];
  for (const [testId, tools] of byTestMap) {
    const test = getTest(testId);
    const first = tools[0];
    if (!test || !first) continue;
    tools.sort(
      (a, b) =>
        (SEVERITY_WEIGHT[b.severity] ?? 0) - (SEVERITY_WEIGHT[a.severity] ?? 0) ||
        a.toolName.localeCompare(b.toolName),
    );
    byTest.push({
      testId,
      techName: test.tech_name,
      userFacingName: test.user_facing_name,
      findingName: test.finding_name,
      category: test.category ?? "",
      failureMode: test.impact?.failure_mode ?? "",
      recommendation: test.recommendation ?? "",
      worstSeverity: tools[0]!.severity,
      tools,
    });
  }
  byTest.sort(
    (a, b) =>
      (SEVERITY_WEIGHT[b.worstSeverity] ?? 0) - (SEVERITY_WEIGHT[a.worstSeverity] ?? 0) ||
      b.tools.length - a.tools.length ||
      a.userFacingName.localeCompare(b.userFacingName),
  );

  return { scanId: scan.id, models: reportModels(known), byTest, byTool };
}

/** Tool-LEVEL test report for one tool in a scan. */
export function buildToolTestReport(
  scan: ScanDetail,
  toolName: string,
  modelIds: string[],
  client?: string,
): CompatibilityTestReport {
  const known = modelIds.filter((id) => getModel(id));
  const toolScan = scan.tools.find((t) => t.toolName === toolName);
  const entries = toolScan
    ? buildEntries(known, (modelId) => runToolLevel(toToolInput(toolScan), modelId, { client }))
    : [];
  return {
    subjectType: "tool",
    subjectId: toolName,
    subjectLabel: toolName,
    models: reportModels(known),
    entries,
  };
}

/** Server cell = server/environment results rolled up with the tool rows (default: worst-tool). */
function serverCell(
  scan: ScanInput,
  modelId: string,
  env: EnvInput,
  opts: HeatmapOpts,
): CompatibilityCell {
  const serverResults = runServerLevel(scan, modelId, { client: opts.client }, env);
  const serverCellOnly = scoreCell(modelId, serverResults);

  const toolCells = scan.tools.map((tool) =>
    scoreCell(modelId, runToolLevel(tool, modelId, { client: opts.client })),
  );
  const toolResults: CompatibilityResult[] = scan.tools.flatMap((tool) =>
    runToolLevel(tool, modelId, { client: opts.client }),
  );

  // Combined drill-down carries server/env + every tool result.
  const results = [...serverResults, ...toolResults];

  if (opts.rollup === "average-tool" || toolCells.length === 0) {
    // Average-tool: score the whole combined set together.
    return scoreCell(modelId, results);
  }

  // Worst-tool (default): band = worst of (server cell, tool cells); score = min non-null.
  const band = worstBand([serverCellOnly.band, ...toolCells.map((c) => c.band)]);
  const scores = [serverCellOnly.score, ...toolCells.map((c) => c.score)].filter(
    (s): s is number => s !== null,
  );
  const score = scores.length ? Math.min(...scores) : null;
  return { modelId, score, band, results };
}
