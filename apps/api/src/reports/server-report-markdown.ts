// ── Server-level Export Report → single Markdown document ───────────────────────────────────────────
// The Markdown twin of the HTML/print-to-PDF report rendered by apps/web ServerReportView. A PURE
// function over a ServerReport payload (built by createServerReport) — unit-testable over a fixture,
// exactly like createMarkdownReport / createRunMarkdownReport. Mirrors the same 7 sections (A–G) and
// reuses the SAME pure derivation helpers as the web renderer (from @mcp-token-footprint/shared), so
// the two reports never drift on severity ordering, the detail filter, or per-model finding grouping.
//
// Two deliberate differences from the HTML:
//  1. COMPLETENESS — every tool list is emitted in FULL. The HTML truncates the per-test "tools with a
//     severity" list at 18 and affected-tool lists at 16 ("+N more"); Markdown lists them all.
//  2. NO COLOUR — the HTML conveys severity with coloured badges. Markdown can't colour cells, so every
//     severity/outcome is a bracket TEXT TAG ([BLOCKER]/[HIGH]/[MEDIUM]/[LOW]/[PASS]/[N/A]) with a
//     one-time legend. The tag is the source of truth, so nothing is lost (and it survives pandoc→Word).

import type {
  CompatibilityAffectedTool,
  CompatibilityEvidence,
  CompatibilityReportModel,
  CompatibilitySeverity,
  CompatibilityTestEntry,
  CompatibilityTestReport,
  DetailLevel,
  ServerReport,
  StatusKey,
  ToolSeveritySummary,
} from "@mcp-token-footprint/shared";
import {
  DETAIL_OPTIONS,
  FINDING_SEVERITIES,
  MANUAL_REVIEW_CONCERNS,
  SEVERITY_RANK,
  STATUS_ORDER,
  cleanRationale,
  clientLabel,
  formatEvidenceValue,
  formatLimit,
  formatNumber,
  formatPercent,
  formatDateTime,
  groupExplanations,
  isDetailed,
  outcomeKey,
  shortModelName,
  worstSeverity,
} from "@mcp-token-footprint/shared";
import { escapeMarkdownTable, escapeText } from "./reports.js";

// ── Markdown vocabulary (the only NEW presentation knowledge — bracket tags, no colour, no emoji) ───

const STATUS_TAG: Record<StatusKey, string> = {
  blocker: "[BLOCKER]",
  high: "[HIGH]",
  medium: "[MEDIUM]",
  low: "[LOW]",
  pass: "[PASS]",
  na: "[N/A]",
};

const CONFIDENCE_LABEL: Record<string, string> = {
  high: "Verified",
  medium: "Likely",
  low: "Estimated",
  "n/a": "Unverified",
};

/** Worst-first severity chips, e.g. "[BLOCKER] ×2 · [HIGH] ×1" (empty string when there are none). */
function severityTally(counts: Partial<Record<CompatibilitySeverity, number>>): string {
  return FINDING_SEVERITIES.filter((s) => (counts[s] ?? 0) > 0)
    .map((s) => `${STATUS_TAG[s]} ×${counts[s]}`)
    .join(" · ");
}

/** Worst-first outcome chips across ALL outcomes incl. pass/na (the full ledger tally). */
function outcomeTally(counts: Partial<Record<StatusKey, number>>): string {
  return STATUS_ORDER.filter((s) => (counts[s] ?? 0) > 0)
    .map((s) => `${STATUS_TAG[s]} ×${counts[s]}`)
    .join(" · ");
}

/** Single-line clip with an ellipsis (for inline prose / evidence values; keeps lists/tables intact). */
function clip(value: string, max: number): string {
  const s = value.replace(/[\r\n]+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** A backtick-guarded inline code span (picks a fence longer than any backtick run in the body). */
function inlineCode(value: string): string {
  const clean = value.replace(/[\r\n]+/g, " ");
  const longestRun = (clean.match(/`+/g) ?? []).reduce((m, r) => Math.max(m, r.length), 0);
  const fence = "`".repeat(longestRun + 1);
  return `${fence}${clean}${fence}`;
}

/** A tool name as inline code, safe inside a table cell (pipe-escaped AND backtick-guarded). */
function codeCell(name: string): string {
  return inlineCode(escapeMarkdownTable(name));
}

/** The worst finding severity across a tool's tool-test entries (null = no findings). */
function toolWorstSeverity(report: CompatibilityTestReport): CompatibilitySeverity | null {
  let worst: CompatibilitySeverity | null = null;
  for (const e of report.entries) {
    const s = worstSeverity(e.statusCounts);
    if (s && (!worst || SEVERITY_RANK[s] > SEVERITY_RANK[worst])) worst = s;
  }
  return worst;
}

// ── Builder ─────────────────────────────────────────────────────────────────────────────────────────

export function createServerMarkdownReport(report: ServerReport, detail: DetailLevel): string {
  const { server, scan, models } = report;
  const lines: string[] = [];
  const byId = new Map(models.map((m) => [m.id, m] as const));
  const detailLabel = DETAIL_OPTIONS.find((o) => o.value === detail)?.label ?? detail;

  // Server-level findings = server tests with ≥1 non-pass outcome, worst-first (same sort as the HTML).
  const serverFindings = report.serverTests.entries
    .filter((e) => worstSeverity(e.statusCounts) !== null)
    .sort(
      (a, b) =>
        SEVERITY_RANK[worstSeverity(b.statusCounts)!] -
          SEVERITY_RANK[worstSeverity(a.statusCounts)!] ||
        a.userFacingName.localeCompare(b.userFacingName),
    );
  const totalFindings = serverFindings.length + report.toolFindings.byTest.length;

  // Title + legend.
  lines.push(`# MCP Server Compatibility & Footprint Report — ${escapeText(server.name)}`, "");
  lines.push(`Generated ${formatDateTime(report.generatedAt)}.`, "");
  lines.push(
    "**Legend** — severity (worst → least): `[BLOCKER]` > `[HIGH]` > `[MEDIUM]` > `[LOW]`. " +
      "Outcomes: `[PASS]` (no issue on that model) · `[N/A]` (no documented limit for that model). " +
      "A count like `[BLOCKER] ×2` means two models hit that severity.",
    "",
  );

  renderHeader(lines, report, detailLabel);
  renderExecutiveSummary(lines, report, serverFindings, totalFindings);
  renderServerFindings(lines, serverFindings, byId, detail, detailLabel);
  renderServerLedger(lines, report);
  renderToolDetail(lines, report, byId, detail, detailLabel);
  renderToolSummary(lines, report);
  renderAppendix(lines, report);

  return `${lines.join("\n")}\n`;
}

// ── §A Header ─────────────────────────────────────────────────────────────────────────────────────

function renderHeader(lines: string[], report: ServerReport, detailLabel: string): void {
  const { server, scan } = report;
  const endpoint = server.transport === "stdio" ? (server.command ?? "—") : (server.url ?? "—");
  const secrets =
    server.hasEnvSecrets || server.hasHeaderSecrets
      ? [server.hasEnvSecrets ? "env" : null, server.hasHeaderSecrets ? "headers" : null]
          .filter(Boolean)
          .join(" + ")
      : "none";
  const client = clientLabel(report.client);
  const resources = scan.resources ?? [];
  const prompts = scan.prompts ?? [];

  lines.push(
    "## Server",
    "",
    `- **Name:** ${escapeText(server.name)}`,
    `- **Transport:** ${server.transport}`,
    `- **Endpoint:** ${inlineCode(endpoint)}`,
    `- **Auth:** ${server.authType}`,
    `- **Secrets:** ${secrets}`,
    `- **Scan date:** ${formatDateTime(scan.scannedAt)}`,
    `- **Token profile:** ${scan.tokenProfile}`,
    `- **Tools / resources / prompts:** ${formatNumber(scan.totalTools)} / ${formatNumber(resources.length)} / ${formatNumber(prompts.length)}`,
    `- **Models:** ${report.models.map((m) => escapeText(m.displayName)).join(", ")}`,
    `- **Host client:** ${client ? escapeText(client) : "none"}`,
    `- **Detailed findings:** ${escapeText(detailLabel)}`,
    `- **Report generated:** ${formatDateTime(report.generatedAt)}`,
    "",
  );
  lines.push(
    "> **Scope & method.** Generated from a static-connection scan of the server's tool surface evaluated",
    "> against a provenanced model dataset. Findings cite the documented limit and its source. Concerns",
    "> that need a human review (auth/audience binding, prompt-injection, PII, transport hardening, hidden",
    "> secrets, workflow safety) are out of static scope — see “Not tested” in the appendix.",
    "",
  );
}

// ── §B Executive summary ────────────────────────────────────────────────────────────────────────────

function renderExecutiveSummary(
  lines: string[],
  report: ServerReport,
  serverFindings: CompatibilityTestEntry[],
  totalFindings: number,
): void {
  const { scan, models } = report;
  const top3Share =
    scan.totalTokens > 0
      ? ([...scan.tools]
          .sort((a, b) => b.totalTokens - a.totalTokens)
          .slice(0, 3)
          .reduce((a, t) => a + t.totalTokens, 0) /
          scan.totalTokens) *
        100
      : 0;

  lines.push(
    "## Executive summary",
    "",
    `- **Startup tokens:** ${formatNumber(scan.totalTokens)} (tool definitions)`,
    `- **Tools:** ${formatNumber(scan.totalTools)} (avg ${formatNumber(scan.averageTokensPerTool)} tok)`,
    `- **Top-3 share:** ${formatPercent(top3Share)} of startup tokens`,
    `- **Largest tool:** ${formatNumber(scan.largestToolTokens)} tok${scan.largestToolName ? ` (${escapeText(scan.largestToolName)})` : ""}`,
    "",
  );

  // Findings tally = server findings' worst severities ∪ tool-level findings' worst severities.
  const tally: Partial<Record<CompatibilitySeverity, number>> = {};
  for (const e of serverFindings) {
    const w = worstSeverity(e.statusCounts)!;
    tally[w] = (tally[w] ?? 0) + 1;
  }
  for (const t of report.toolFindings.byTest)
    tally[t.worstSeverity] = (tally[t.worstSeverity] ?? 0) + 1;

  if (totalFindings === 0) {
    lines.push(
      `**No compatibility findings.** All ${report.serverTests.entries.length} server-level tests and the ` +
        `tool-level checks pass across the ${models.length} selected model${models.length === 1 ? "" : "s"}.`,
      "",
    );
  } else {
    lines.push(
      `**${totalFindings} finding${totalFindings === 1 ? "" : "s"} across ${models.length} model${models.length === 1 ? "" : "s"}** — ${severityTally(tally)}`,
      "",
    );
  }

  // Server-test outcomes by model (worst-case contrast across the roster).
  lines.push(
    "### Server-test outcomes by model",
    "",
    `Worst-case across the ${report.serverTests.entries.length} server-level tests.`,
    "",
    "| Model | Worst | Outcomes |",
    "|---|---|---|",
  );
  for (const m of models) {
    const counts: Partial<Record<StatusKey, number>> = {};
    for (const e of report.serverTests.entries) {
      const r = e.results.find((x) => x.modelId === m.id);
      if (!r) continue;
      const k = outcomeKey(r);
      counts[k] = (counts[k] ?? 0) + 1;
    }
    const worst: StatusKey =
      FINDING_SEVERITIES.find((s) => (counts[s] ?? 0) > 0) ?? (counts.pass ? "pass" : "na");
    lines.push(
      `| ${escapeText(shortModelName(m.displayName))} (${escapeText(m.providerId)}) | ${STATUS_TAG[worst]} | ${outcomeTally(counts) || "—"} |`,
    );
  }
  lines.push("");
}

// ── §C Server-level findings ──────────────────────────────────────────────────────────────────────

function renderServerFindings(
  lines: string[],
  findings: CompatibilityTestEntry[],
  byId: Map<string, CompatibilityReportModel>,
  detail: DetailLevel,
  detailLabel: string,
): void {
  const detailed = findings.filter((e) => isDetailed(worstSeverity(e.statusCounts)!, detail));
  const hidden = findings.length - detailed.length;

  lines.push("## Server-level findings", "");
  if (detailed.length === 0) {
    lines.push(
      findings.length === 0
        ? "_No server-level findings — every server test passes across the selected models._"
        : `_No server-level findings at ${detailLabel.toLowerCase()}. ${hidden} lower-severity finding${hidden === 1 ? "" : "s"} are in the ledger below._`,
      "",
    );
    return;
  }

  for (const entry of detailed) {
    const worst = worstSeverity(entry.statusCounts)!;
    lines.push(
      `### ${STATUS_TAG[worst]} ${escapeText(entry.userFacingName)} (${escapeText(entry.techName)})`,
      "",
    );
    lines.push(`- **Outcomes:** ${outcomeTally(entry.statusCounts)}`);
    if (entry.whatItDoes)
      lines.push(`- **What we tested:** ${escapeText(clip(entry.whatItDoes, 1500))}`);
    lines.push("");
    lines.push("**Per-model reasoning & evidence**", "");
    lines.push(...reasoningLines(entry, byId));
    if (entry.recommendation)
      lines.push("", `**Recommendation:** ${escapeText(clip(entry.recommendation, 1500))}`);
    lines.push("");
  }
  if (hidden > 0) {
    lines.push(
      `_+ ${hidden} lower-severity finding${hidden === 1 ? "" : "s"} not detailed here — see the ledger below._`,
      "",
    );
  }
}

// ── §D Server-level test ledger (every server test, incl. passes — the audit trail) ─────────────────

function renderServerLedger(lines: string[], report: ServerReport): void {
  lines.push(
    "## Server-level test ledger",
    "",
    `Every server-level test run across the ${report.models.length} selected models — including the ones that passed.`,
    "",
    "| Test | Category | What it checks | Outcomes |",
    "|---|---|---|---|",
  );
  for (const e of report.serverTests.entries) {
    const name = `${escapeText(e.userFacingName)} · ${codeCell(e.techName)}`;
    const category = e.category ? escapeText(e.category) : "—";
    const checks = escapeText(clip(e.whatItDoes, 300));
    lines.push(`| ${name} | ${category} | ${checks} | ${outcomeTally(e.statusCounts) || "—"} |`);
  }
  lines.push("");
}

// ── §E Tool detail (full per-tool results for flagged tools meeting the chosen severity) ────────────

function renderToolDetail(
  lines: string[],
  report: ServerReport,
  byId: Map<string, CompatibilityReportModel>,
  detail: DetailLevel,
  detailLabel: string,
): void {
  const toolByName = new Map(report.scan.tools.map((t) => [t.toolName, t] as const));
  const detailedTools = report.flaggedToolTests.filter((tr) => {
    const w = toolWorstSeverity(tr);
    return w !== null && isDetailed(w, detail);
  });

  lines.push("## Tool detail", "");
  if (detailedTools.length === 0) {
    lines.push(
      report.flaggedToolTests.length === 0
        ? "_No tools were flagged — every tool passes its tool-level tests across the selected models._"
        : `_No tools have a finding at ${detailLabel.toLowerCase()} — see the tool summary below._`,
      "",
    );
    return;
  }

  for (const toolReport of detailedTools) {
    const tool = toolByName.get(toolReport.subjectId);
    const meta = tool
      ? ` — ${formatNumber(tool.totalTokens)} tok · ${formatPercent(tool.contributionPercent)} of server`
      : "";
    lines.push(`### ${codeCell(toolReport.subjectLabel)}${meta}`, "");

    const findings = toolReport.entries.filter((e) => {
      const s = worstSeverity(e.statusCounts);
      return s !== null && (detail === "all" || isDetailed(s, detail));
    });
    for (const entry of findings) {
      const worst = worstSeverity(entry.statusCounts)!;
      lines.push(
        `#### ${STATUS_TAG[worst]} ${escapeText(entry.userFacingName)} (${escapeText(entry.techName)})`,
        "",
      );
      if (entry.whatItDoes)
        lines.push(`- **What we tested:** ${escapeText(clip(entry.whatItDoes, 1500))}`, "");
      lines.push(...reasoningLines(entry, byId));
      if (entry.recommendation)
        lines.push("", `**Recommendation:** ${escapeText(clip(entry.recommendation, 1500))}`);
      lines.push("");
    }

    // Full per-tool ledger only in full-detail mode (mirrors the HTML's `detail === "all"` gate).
    if (detail === "all") {
      lines.push("**All tool tests**", "", "| Test | Outcomes |", "|---|---|");
      for (const e of toolReport.entries) {
        lines.push(
          `| ${escapeText(e.userFacingName)} · ${codeCell(e.techName)} | ${outcomeTally(e.statusCounts) || "—"} |`,
        );
      }
      lines.push("");
    }
  }
}

// ── §F Tool summary (tool-level findings — ALL tools listed — then the complete inventory) ──────────

function renderToolSummary(lines: string[], report: ServerReport): void {
  const issuesByTool = new Map<string, ToolSeveritySummary>(
    report.toolFindings.byTool.map((s) => [s.toolName, s]),
  );
  const tools = [...report.scan.tools].sort((a, b) => b.totalTokens - a.totalTokens);

  lines.push(
    "## Tool summary",
    "",
    "Every tool by token footprint, with its issue tally across the tool-level tests. The complete roster — no truncation.",
    "",
  );

  if (report.toolFindings.byTest.length > 0) {
    lines.push(
      "### Tool-level findings",
      "",
      "Tool-level tests that flag at least one tool (worst-first).",
      "",
    );
    for (const t of report.toolFindings.byTest) {
      lines.push(
        `#### ${STATUS_TAG[t.worstSeverity]} ${escapeText(t.userFacingName)} · ${t.tools.length} tool${t.tools.length === 1 ? "" : "s"}`,
        "",
      );
      if (t.recommendation) lines.push(`${escapeText(clip(t.recommendation, 1500))}`, "");
      // Every affected tool, tagged by its OWN severity — the full list (HTML truncates at 18).
      lines.push(
        t.tools
          .map((tool) => `${STATUS_TAG[tool.severity]} ${inlineCode(tool.toolName)}`)
          .join(", "),
        "",
      );
    }
  }

  lines.push(
    "### Tool inventory",
    "",
    "| # | Tool | Total | Desc | Schema | Share | Issues |",
    "|---:|---|---:|---:|---:|---:|---|",
  );
  tools.forEach((tool, i) => {
    const issues = issuesByTool.get(tool.toolName);
    const tally = issues && issues.total > 0 ? severityTally(issues.counts) : "";
    lines.push(
      `| ${i + 1} | ${codeCell(tool.toolName)} | ${formatNumber(tool.totalTokens)} | ${formatNumber(tool.descriptionTokens)} | ${formatNumber(tool.schemaTokens)} | ${formatPercent(tool.contributionPercent)} | ${tally || "[PASS]"} |`,
    );
  });
  lines.push("");
}

// ── §G Appendix ────────────────────────────────────────────────────────────────────────────────────

function renderAppendix(lines: string[], report: ServerReport): void {
  lines.push("## Appendix", "");

  lines.push(
    "### Method & scoring",
    "",
    "Each test evaluates the scanned tool surface against a per-model limit resolved from a provenanced " +
      "dataset. A test yields a verdict per model — **pass**, **warn**, **fail**, or **n/a** (no documented " +
      "limit) — and a per-model severity (Blocker → Low) that reflects the real-world consequence on that " +
      "model. Evidence carries the cited value, its source link, and a confidence label " +
      "(Verified / Likely / Estimated / Unverified) derived from the dataset's source tier.",
    "",
  );

  lines.push(
    "### Models & provenance",
    "",
    `${report.models.length} models evaluated; limits come from the provenanced dataset.`,
    "",
  );
  for (const m of report.models)
    lines.push(`- ${escapeText(m.providerName)} · ${escapeText(m.displayName)}`);
  lines.push("");

  lines.push(
    "### Not tested (manual review required)",
    "",
    "These concerns can't be inferred from a static tool surface + a model dataset — they need a " +
      "human/behavioural review. The report does not claim coverage of them.",
    "",
  );
  for (const c of MANUAL_REVIEW_CONCERNS)
    lines.push(`- **${escapeText(c.title)}** — ${escapeText(c.detail)}`);
  lines.push("");
}

// ── Per-model reasoning (shared by §C and §E) ───────────────────────────────────────────────────────

function reasoningLines(
  entry: CompatibilityTestEntry,
  byId: Map<string, CompatibilityReportModel>,
): string[] {
  const out: string[] = [];
  for (const g of groupExplanations(entry.results)) {
    const r = g.rep;
    const names = g.modelIds
      .map((id) => shortModelName(byId.get(id)?.displayName ?? id))
      .join(", ");
    const failure =
      r.failureMode && r.failureMode !== "none"
        ? ` — ${escapeText(r.failureMode.replace(/_/g, " "))}`
        : "";
    out.push(`- **${STATUS_TAG[g.outcome]} ${escapeText(names)}**${failure}`);

    const rationale = cleanRationale(r.rationale);
    if (rationale) out.push(`  - ${escapeText(clip(rationale, 800))}`);

    const measured = formatLimit(r.measured.value, r.measured.unit);
    const limit = formatLimit(r.threshold.value, r.threshold.unit);
    if (measured || limit) {
      const bits = [
        measured ? `Measured ${escapeText(measured)}` : null,
        limit ? `Limit ${escapeText(limit)}` : null,
      ].filter(Boolean);
      out.push(`  - ${bits.join(" · ")}`);
    }

    if (r.affectedTools && r.affectedTools.length > 0)
      out.push(`  - ${affectedToolsInline(r.affectedTools)}`);
    if (r.evidence.length > 0) out.push(`  - ${evidenceInline(r.evidence)}`);
  }
  return out;
}

/** ALL affected tools (offenders lead), full list — the HTML truncates this at 16. Not in a table → backticks suffice. */
function affectedToolsInline(tools: CompatibilityAffectedTool[]): string {
  const offenders = tools.filter((t) => t.over);
  const lead = offenders.length > 0 ? offenders : tools;
  const label =
    offenders.length > 0 ? `Tools over the limit (${offenders.length})` : "Top contributors";
  const items = lead.map(
    (t) =>
      `${inlineCode(t.namespacedName ?? t.toolName)} ${formatNumber(t.value)}${t.unit ? ` ${t.unit}` : ""}`,
  );
  return `_${label}:_ ${items.join(", ")}`;
}

function evidenceInline(evidence: CompatibilityEvidence[]): string {
  const items = evidence.map((e) => {
    const val = clip(formatEvidenceValue(e.value), 160);
    const conf = e.confidence ? ` (${CONFIDENCE_LABEL[e.confidence] ?? e.confidence})` : "";
    const text = `${escapeText(e.field)}=${escapeText(val)}${conf}`;
    // Angle-bracket the URL so parens/spaces in it don't break the markdown link.
    return e.sourceUrl ? `[${text}](<${e.sourceUrl}>)` : text;
  });
  return `_Evidence:_ ${items.join("; ")}`;
}
