// ── Fleet report → Markdown (Advisor WP 2.2) ────────────────────────────────────────────────────
// The Markdown twin of a {@link FleetReport}, following the house pattern (`server-report.ts` +
// `server-report-markdown.ts`, `digest.ts` + `digest-markdown.ts`): a PURE function over the
// ALREADY-composed JSON, so both export formats are the same document rendered twice and there is
// no second data path to drift.
//
// EVERY SECTION IS ALWAYS RENDERED, populated or not. A section that had nothing to report prints
// its `gap` as an italic line naming what is missing — the reader learns "not measured", never
// silence they would read as "nothing to report". Same for a single row: an entry carrying a `gap`
// prints it beneath itself rather than letting its placeholder zeros pass as figures.

import type {
  FleetEnvironmentEntry,
  FleetReport,
  FleetScanRef,
  FleetServerEntry,
  FleetSuiteEntry,
} from "@mcp-token-footprint/shared";
import type { AdvisorRecommendation } from "@mcp-token-footprint/shared";
import { escapeMarkdownTable, escapeText } from "./reports.js";

/** Digit grouping without `toLocaleString` — locale-dependent output would break the byte-identical
 *  determinism contract on a machine with different ICU data (mirrors `advisor/rules/shared.ts`). */
function count(value: number): string {
  const rounded = Math.round(value);
  const negative = rounded < 0;
  const digits = Math.abs(rounded).toString();
  let grouped = "";
  for (let i = 0; i < digits.length; i += 1) {
    if (i > 0 && (digits.length - i) % 3 === 0) grouped += ",";
    grouped += digits[i];
  }
  return negative ? `-${grouped}` : grouped;
}

/** A signed count, e.g. "+1,204" / "-96" / "±0". */
function signedCount(value: number): string {
  if (value === 0) return "±0";
  return value > 0 ? `+${count(value)}` : `-${count(Math.abs(value))}`;
}

function usd(value: number): string {
  return `$${value.toFixed(4)}`;
}

/** A grade in [0,1] as a two-decimal number, or an em dash when there is none. */
function grade(value: number | null): string {
  return value === null ? "—" : value.toFixed(2);
}

function percent(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

/** The one way this document renders an honest gap. */
function gapLine(lines: string[], gap: string | undefined): void {
  if (gap === undefined) return;
  lines.push(`_${escapeText(gap)}_`, "");
}

function scanCell(scan: FleetScanRef | null): string {
  if (!scan) return "—";
  const tools = `${count(scan.totalTools)} ${scan.totalTools === 1 ? "tool" : "tools"}`;
  return `${scan.scannedAt} · ${tools} · ${count(scan.totalTokens)} tokens (${scan.tokenProfile}, counting v${scan.countingVersion})`;
}

export function createFleetMarkdownReport(report: FleetReport): string {
  const lines: string[] = [];

  lines.push("# Fleet report", "");
  lines.push(
    `Generated ${report.generatedAt}.`,
    `Advisor version ${report.advisorVersion} — figures produced under a different advisor version are never directly compared.`,
    "",
  );

  renderServers(lines, report);
  renderEnvironments(lines, report);
  renderSuites(lines, report);
  renderPosture(lines, report);
  renderAdvisor(lines, report);

  return `${lines.join("\n")}\n`;
}

// ── Servers + drift ─────────────────────────────────────────────────────────────────────────────

function renderServers(lines: string[], report: FleetReport): void {
  lines.push("## Servers & drift", "");
  gapLine(lines, report.servers.gap);

  if (report.servers.entries.length === 0) return;

  lines.push(
    "| Server | Transport | Latest successful scan | Tools +/−/~ | Token Δ |",
    "|---|---|---|---|---:|",
  );
  for (const entry of report.servers.entries) {
    lines.push(
      `| ${escapeMarkdownTable(entry.serverName)} | ${entry.transport} | ${escapeMarkdownTable(scanCell(entry.latestScan))} | ${driftCountsCell(entry)} | ${driftTokensCell(entry)} |`,
    );
  }
  lines.push("");

  // Per-row gaps are listed under the table rather than crammed into a cell — a row whose numbers
  // are absent has a reason, and the reason is a sentence, not a dash.
  const gapped = report.servers.entries.filter((entry) => entry.gap !== undefined);
  if (gapped.length > 0) {
    for (const entry of gapped) {
      lines.push(`- **${escapeText(entry.serverName)}** — ${escapeText(entry.gap ?? "")}`);
    }
    lines.push("");
  }
}

function driftCountsCell(entry: FleetServerEntry): string {
  if (!entry.drift) return "—";
  const { toolsAdded, toolsRemoved, toolsChanged } = entry.drift;
  return `+${toolsAdded} / −${toolsRemoved} / ~${toolsChanged} vs ${entry.drift.previousScan.scannedAt}`;
}

function driftTokensCell(entry: FleetServerEntry): string {
  if (!entry.drift) return "—";
  if (!entry.drift.deltasComparable || entry.drift.deltaTokens === null) {
    // Not "0" — the two scans were counted on different scales, so subtracting them would conflate
    // a tokenizer change with a real surface change (TOKEN_COUNTING_VERSION discipline).
    return "not comparable";
  }
  const pct = entry.drift.deltaPercent === null ? "" : ` (${entry.drift.deltaPercent.toFixed(1)}%)`;
  return `${signedCount(entry.drift.deltaTokens)}${pct}`;
}

// ── Environment costs ───────────────────────────────────────────────────────────────────────────

function renderEnvironments(lines: string[], report: FleetReport): void {
  lines.push("## Environment costs", "");
  gapLine(lines, report.environments.gap);

  if (report.environments.entries.length === 0) return;

  lines.push(
    "| Environment | Model | Loading | Runs | Billed cost | Mean / run | Tokens in/out |",
    "|---|---|---|---:|---:|---:|---:|",
  );
  for (const entry of report.environments.entries) {
    lines.push(
      `| ${escapeMarkdownTable(entry.name)} | ${escapeMarkdownTable(entry.model)} | ${entry.toolLoadingMode} | ${entry.runs} (${entry.completedRuns} completed) | ${usd(entry.billedCostUsd)} | ${entry.meanBilledCostUsd === null ? "—" : usd(entry.meanBilledCostUsd)} | ${count(entry.tokensIn)} / ${count(entry.tokensOut)} |`,
    );
  }
  lines.push("");

  renderEnvironmentNotes(lines, report.environments.entries);
}

function renderEnvironmentNotes(lines: string[], entries: FleetEnvironmentEntry[]): void {
  const subscription = entries.filter((entry) => entry.subscriptionReferenceRuns > 0);
  if (subscription.length > 0) {
    lines.push(
      "> **Cost note — subscription reference.** The billed column above EXCLUDES runs executed on the " +
        "Claude subscription, whose marginal cost was $0; their reference figures (exact tokens × the " +
        "Anthropic list price, not a billed charge) are listed separately below. The two are never added.",
      "",
    );
    for (const entry of subscription) {
      lines.push(
        `- **${escapeText(entry.name)}** — ${entry.subscriptionReferenceRuns} subscription ${entry.subscriptionReferenceRuns === 1 ? "run" : "runs"}, ${usd(entry.subscriptionReferenceCostUsd)} reference.`,
      );
    }
    lines.push("");
  }

  const gapped = entries.filter((entry) => entry.gap !== undefined);
  if (gapped.length > 0) {
    for (const entry of gapped) {
      lines.push(`- **${escapeText(entry.name)}** — ${escapeText(entry.gap ?? "")}`);
    }
    lines.push("");
  }
}

// ── Suite grades ────────────────────────────────────────────────────────────────────────────────

function renderSuites(lines: string[], report: FleetReport): void {
  lines.push("## Suite grades", "");
  gapLine(lines, report.suites.gap);

  if (report.suites.entries.length === 0) return;

  if (report.suites.entries.length < report.suites.totalSuiteRuns) {
    lines.push(
      `Showing the ${report.suites.entries.length} most recent of ${report.suites.totalSuiteRuns} suite runs.`,
      "",
    );
  }

  lines.push(
    "| Suite run | Status | Started | Cells | Mean grade | σ | Pass @0.5 | Exec / judge cost |",
    "|---|---|---|---:|---:|---:|---:|---:|",
  );
  for (const entry of report.suites.entries) {
    lines.push(
      `| ${escapeMarkdownTable(entry.label)} | ${entry.status} | ${entry.startedAt} | ${entry.cellsCompleted}/${entry.cellsTotal} | ${grade(entry.meanGrade)} | ${grade(entry.gradeStdDev)} | ${percent(entry.passRateAt05)} | ${usd(entry.execCostUsd)} / ${usd(entry.judgeCostUsd)} |`,
    );
  }
  lines.push("");

  const gapped = report.suites.entries.filter((entry) => entry.gap !== undefined);
  if (gapped.length > 0) {
    for (const entry of gapped) {
      lines.push(
        `- **${escapeText(entry.label)}** (${escapeText(entry.suiteRunId)}) — ${escapeText(entry.gap ?? "")}`,
      );
    }
    lines.push("");
  }
}

// ── Posture ─────────────────────────────────────────────────────────────────────────────────────

function renderPosture(lines: string[], report: FleetReport): void {
  lines.push("## Security posture", "");
  gapLine(lines, report.posture.gap);

  const summary = report.posture.summary;
  if (!summary) return;

  lines.push(
    `- **Score:** ${summary.score === null ? "not scored" : summary.score.toFixed(1)} (analyzer version ${summary.analyzerVersion})`,
  );
  if (summary.findingCounts.length === 0) {
    lines.push("- **Findings:** none reported.");
  } else {
    lines.push(
      `- **Findings:** ${summary.findingCounts.map((f) => `${escapeText(f.severity)} ${f.count}`).join(", ")}`,
    );
  }
  lines.push("");

  if (summary.subjects.length > 0) {
    lines.push("| Subject | Kind | Score | Findings |", "|---|---|---:|---:|");
    for (const subject of summary.subjects) {
      lines.push(
        `| ${escapeMarkdownTable(subject.name)} | ${subject.kind} | ${subject.score === null ? "—" : subject.score.toFixed(1)} | ${subject.findings} |`,
      );
    }
    lines.push("");
  }
}

// ── Advisor recommendations ─────────────────────────────────────────────────────────────────────

function renderAdvisor(lines: string[], report: FleetReport): void {
  lines.push("## Advisor recommendations", "");
  gapLine(lines, report.advisor.gap);

  const advisor = report.advisor.report;
  if (advisor.recommendations.length === 0) {
    if (report.advisor.gap === undefined) {
      lines.push("_No recommendation was produced for this fleet._", "");
    }
  } else {
    for (const rec of advisor.recommendations) {
      renderRecommendation(lines, rec);
    }
  }

  // The advisor's own honest gaps are part of the report, not a footnote: a rule that could not run
  // is a fact about the fleet's data, and hiding it would let an empty list read as "all clear".
  lines.push("### Data gaps", "");
  if (advisor.insufficientData.length === 0) {
    lines.push("_Every applicable advisor rule had the data it needed._", "");
    return;
  }
  for (const gap of advisor.insufficientData) {
    lines.push(`- \`${escapeText(gap.ruleId)}\` — ${escapeText(gap.reason)}`);
  }
  lines.push("");
}

function renderRecommendation(lines: string[], rec: AdvisorRecommendation): void {
  lines.push(`### [${rec.severity.toUpperCase()}] ${escapeText(rec.title)}`, "");
  if (rec.detail.trim().length > 0) lines.push(escapeText(rec.detail), "");
  if (rec.savings) {
    // "Estimate" is stated in the sentence, not implied by the number — README invariant 4.
    lines.push(
      `- **Estimated saving:** ${count(rec.savings.value)} ${rec.savings.unit} — estimate, basis: ${escapeText(rec.savings.basis)}`,
    );
  }
  lines.push(
    `- **Evidence:** ${rec.evidence.map((ref) => `${ref.kind} \`${escapeText(ref.id)}\` (${escapeText(ref.label)})`).join(", ")}`,
  );
  if (rec.assumptions.length > 0) {
    lines.push("- **Assumptions:**");
    for (const assumption of rec.assumptions) lines.push(`  - ${escapeText(assumption)}`);
  }
  lines.push(`- **Rule:** \`${escapeText(rec.ruleId)}\``, "");
}
