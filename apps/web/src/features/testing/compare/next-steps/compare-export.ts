// Client-side comparison export (audit §H7 — "save comparison as a baseline report"). The run-level
// report endpoints (`GET /api/reports/run/:id/{json,markdown}`) export ONE run; a COMPARISON is a
// cross-run artifact the API has no endpoint for, so — exactly as the WP allows — it is composed on
// the client from the resolved workspace set + the computed verdict. Pure + React/DOM-free so it is
// node-testable; the browser download wrapper lives in the card component.

import type { CompareVerdict, WorkspaceRun } from "../compare-runs";
import { formatCostUsd, formatDuration, formatNumber } from "../../../../lib/format";

/** One run's row in the exported comparison (the summary-level metrics, no trace). */
type ExportRow = {
  letter: string;
  environment: string;
  model: string;
  baseline: boolean;
  status: string;
  turns: number;
  toolCalls: number;
  tokensIn: number;
  tokensOut: number;
  totalTokens: number;
  peakContextTokens: number;
  costUsd: number;
  durationMs: number | null;
  startedAt: string;
};

function toRow(run: WorkspaceRun): ExportRow {
  const s = run.run;
  return {
    letter: run.letter,
    environment: run.scenarioName,
    model: run.model,
    baseline: run.isBaseline,
    status: run.statusLabel,
    turns: s.turns,
    toolCalls: s.toolCalls,
    tokensIn: s.tokensIn,
    tokensOut: s.tokensOut,
    totalTokens: s.tokensIn + s.tokensOut,
    peakContextTokens: s.peakContextTokens,
    costUsd: s.costUsd,
    durationMs: s.durationMs ?? null,
    startedAt: s.startedAt,
  };
}

/** The serializable comparison payload (JSON export). Additive/stable shape. */
export type ComparisonExport = {
  kind: "run-comparison";
  generatedAt: string;
  baselineLetter: string | null;
  verdict: { tone: CompareVerdict["tone"]; headline: string; reasons: string[] } | null;
  runs: ExportRow[];
};

export function buildComparisonExport(
  runs: WorkspaceRun[],
  verdict: CompareVerdict | null,
): ComparisonExport {
  return {
    kind: "run-comparison",
    generatedAt: new Date().toISOString(),
    baselineLetter: runs.find((r) => r.isBaseline)?.letter ?? null,
    verdict: verdict
      ? {
          tone: verdict.tone,
          headline: verdict.headline,
          reasons: verdict.reasons.map((r) => r.text),
        }
      : null,
    runs: runs.map(toRow),
  };
}

export function buildComparisonJson(runs: WorkspaceRun[], verdict: CompareVerdict | null): string {
  return `${JSON.stringify(buildComparisonExport(runs, verdict), null, 2)}\n`;
}

/** A GitHub-flavoured Markdown comparison report — the verdict, then a metric table (one column/run). */
export function buildComparisonMarkdown(
  runs: WorkspaceRun[],
  verdict: CompareVerdict | null,
): string {
  const rows = runs.map(toRow);
  const lines: string[] = [];
  lines.push("# Run comparison");
  lines.push("");
  lines.push(`_Generated ${new Date().toISOString()}_`);
  lines.push("");

  if (verdict) {
    lines.push(`## Verdict — ${verdict.tone}`);
    lines.push("");
    lines.push(verdict.headline);
    if (verdict.reasons.length > 0) {
      lines.push("");
      for (const reason of verdict.reasons) lines.push(`- ${reason.text}`);
    }
    lines.push("");
  }

  lines.push("## Runs");
  lines.push("");
  const header = ["Metric", ...rows.map((r) => `${r.letter}${r.baseline ? " (baseline)" : ""}`)];
  lines.push(`| ${header.join(" | ")} |`);
  lines.push(`| ${header.map(() => "---").join(" | ")} |`);

  const metricRow = (label: string, cell: (r: ExportRow) => string) =>
    `| ${label} | ${rows.map(cell).join(" | ")} |`;

  lines.push(metricRow("Environment", (r) => r.environment));
  lines.push(metricRow("Model", (r) => r.model));
  lines.push(metricRow("Outcome", (r) => r.status));
  lines.push(metricRow("Turns", (r) => formatNumber(r.turns)));
  lines.push(metricRow("Tool calls", (r) => formatNumber(r.toolCalls)));
  lines.push(metricRow("Tokens in", (r) => formatNumber(r.tokensIn)));
  lines.push(metricRow("Tokens out", (r) => formatNumber(r.tokensOut)));
  lines.push(metricRow("Total tokens", (r) => formatNumber(r.totalTokens)));
  lines.push(metricRow("Peak context", (r) => formatNumber(r.peakContextTokens)));
  lines.push(metricRow("Cost", (r) => formatCostUsd(r.costUsd)));
  lines.push(
    metricRow("Duration", (r) => (r.durationMs == null ? "—" : formatDuration(r.durationMs))),
  );
  lines.push("");
  return lines.join("\n");
}
