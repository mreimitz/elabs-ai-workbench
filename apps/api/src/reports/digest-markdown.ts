// ── Scheduled digest report → Markdown ──────────────────────────────────────────────────────────────
// The Markdown twin of a {@link DigestReport} (built by `composeDigestReport`), mirroring the house
// pattern (`server-report-markdown.ts`, `createRunMarkdownReport`): a PURE function over the already-
// composed JSON, unit-testable over a fixture. Deliberately TERSE — a briefing, not a dashboard dump
// (WP5.5 NOTES) — every section renders its top-N entries or an honest "no changes"/"no runs" line;
// nothing is padded to look busier than the window actually was.

import type { DigestMetricDelta, DigestReport } from "@mcp-token-footprint/shared";
import { escapeMarkdownTable, escapeText } from "./reports.js";

const CADENCE_LABEL: Record<DigestReport["windowKind"], string> = {
  daily: "Daily",
  weekly: "Weekly",
};

const SEVERITY_TAG: Record<string, string> = {
  low: "[LOW]",
  medium: "[MEDIUM]",
  high: "[HIGH]",
};

const REASON_LABEL: Record<string, string> = {
  top_cost: "top cost",
  guardrail_stop: "guardrail stop",
};

/** A signed percentage-point delta string, e.g. "+4.2pp" / "-1.0pp" / "±0.0pp". */
function pctDelta(d: DigestMetricDelta): string {
  const pts = d.delta * 100;
  const sign = pts > 0 ? "+" : pts < 0 ? "" : "±";
  return `${sign}${pts.toFixed(1)}pp`;
}

/** A signed count/currency delta string, e.g. "+12" / "-3" / "±0". */
function numDelta(value: number, digits = 0): string {
  const sign = value > 0 ? "+" : value < 0 ? "" : "±";
  return `${sign}${value.toFixed(digits)}`;
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function usd(value: number): string {
  return `$${value.toFixed(2)}`;
}

export function createDigestMarkdownReport(report: DigestReport): string {
  const lines: string[] = [];
  const cadence = CADENCE_LABEL[report.windowKind];

  lines.push(`# ${cadence} digest — ${formatWindowLabel(report)}`, "");
  lines.push(
    `Generated ${report.generatedAt}${report.late ? " (late — generated on catch-up, after the window closed)" : ""}.`,
    `Compared against the prior ${report.windowKind === "daily" ? "day" : "week"} (${report.prevWindowFrom} → ${report.prevWindowTo}).`,
    "",
  );

  renderHeadline(lines, report);
  renderIssues(lines, report);
  renderMovers(lines, report);
  renderNotableRuns(lines, report);
  renderScanMovers(lines, report);

  return `${lines.join("\n")}\n`;
}

function formatWindowLabel(report: DigestReport): string {
  return `${report.windowFrom} → ${report.windowTo}`;
}

function renderHeadline(lines: string[], report: DigestReport): void {
  const { headline } = report;
  lines.push("## Headline", "");
  lines.push(
    `- **Runs:** ${headline.runs.current} (${numDelta(headline.runs.delta)} vs ${headline.runs.previous})`,
  );
  if (headline.errorRate === null) {
    lines.push("- **Error rate:** no runs in either window.");
  } else {
    lines.push(
      `- **Error rate:** ${pct(headline.errorRate.current)} (${pctDelta(headline.errorRate)} vs ${pct(headline.errorRate.previous)})`,
    );
  }
  const bases = Object.entries(headline.costByBasis);
  if (bases.length === 0) {
    lines.push("- **Cost:** no cost-bearing runs in either window.");
  } else {
    lines.push("- **Cost by basis:**");
    for (const [basis, d] of bases) {
      lines.push(`  - ${escapeText(basis)}: ${usd(d.current)} (${numDelta(d.delta, 2)} vs ${usd(d.previous)})`);
    }
  }
  lines.push("");
}

function renderIssues(lines: string[], report: DigestReport): void {
  lines.push("## Issues", "");
  const sections: Array<{ title: string; items: DigestReport["newIssues"] }> = [
    { title: "New", items: report.newIssues },
    { title: "Regressed", items: report.regressedIssues },
    { title: "Resolved", items: report.resolvedIssues },
  ];
  const anyIssues = sections.some((s) => s.items.length > 0);
  if (!anyIssues) {
    lines.push("_No new, regressed, or resolved issues this window._", "");
    return;
  }
  for (const section of sections) {
    if (section.items.length === 0) continue;
    lines.push(`### ${section.title} (${section.items.length})`, "");
    for (const issue of section.items) {
      const tag = SEVERITY_TAG[issue.severity] ?? `[${issue.severity.toUpperCase()}]`;
      lines.push(
        `- ${tag} ${escapeText(issue.title)} — ${issue.targetKind === "skill" ? "skill" : "MCP server"} ${inlineCode(issue.targetName)} (${issue.linkPath})`,
      );
    }
    lines.push("");
  }
}

function renderMovers(lines: string[], report: DigestReport): void {
  lines.push("## Movers", "");
  if (report.movers.length === 0) {
    lines.push("_No server/model/suite had activity in either window._", "");
    return;
  }
  lines.push("| Dimension | Entity | Error rate | Cost |", "|---|---|---|---|");
  for (const m of report.movers) {
    const errCell = m.errorRate === null ? "—" : `${pct(m.errorRate.current)} (${pctDelta(m.errorRate)})`;
    const costCell = `${usd(m.costUsd.current)} (${numDelta(m.costUsd.delta, 2)})`;
    lines.push(
      `| ${m.dimension} | ${escapeMarkdownTable(m.label)} | ${errCell} | ${costCell} |`,
    );
  }
  lines.push("");
}

function renderNotableRuns(lines: string[], report: DigestReport): void {
  lines.push("## Notable runs", "");
  if (report.notableRuns.length === 0) {
    lines.push("_No notable runs (no cost-bearing runs, no guardrail stops) this window._", "");
    return;
  }
  lines.push("| Reason | Run | Test | Cost | Stop reason |", "|---|---|---|---:|---|");
  for (const r of report.notableRuns) {
    lines.push(
      `| ${REASON_LABEL[r.reason] ?? r.reason} | ${inlineCode(r.runId)} (${r.linkPath}) | ${inlineCode(r.testId)} | ${usd(r.costUsd)} | ${r.stopReasonCode ? escapeText(r.stopReasonCode) : "—"} |`,
    );
  }
  lines.push("");
}

function renderScanMovers(lines: string[], report: DigestReport): void {
  lines.push("## Scan footprint movers", "");
  if (report.scanMovers.length === 0) {
    lines.push("_No server was scanned in this window._", "");
    return;
  }
  lines.push("| Server | Profile | Tokens | Δ |", "|---|---|---:|---:|");
  for (const s of report.scanMovers) {
    const tokens = s.totalTokens === null ? "—" : s.totalTokens.toLocaleString("en-US");
    const d = s.deltaComparable && s.deltaTotalTokens !== null ? numDelta(s.deltaTotalTokens) : "n/a";
    lines.push(
      `| ${escapeMarkdownTable(s.serverName ?? s.serverId)} | ${s.tokenProfile} | ${tokens} | ${d} |`,
    );
  }
  lines.push("");
}

/** A backtick-guarded inline code span (mirrors `server-report-markdown.ts`'s helper — picks a fence
 *  longer than any backtick run in the body). */
function inlineCode(value: string): string {
  const clean = value.replace(/[\r\n]+/g, " ");
  const longestRun = (clean.match(/`+/g) ?? []).reduce((m, r) => Math.max(m, r.length), 0);
  const fence = "`".repeat(longestRun + 1);
  return `${fence}${clean}${fence}`;
}
