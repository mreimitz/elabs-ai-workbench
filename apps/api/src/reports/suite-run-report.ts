import type {
  CostBasis,
  FailureBucket,
  GraderId,
  RunDetail,
  RunGrade,
  SuiteAnalytics,
  SuiteBreakdownSlice,
  SuiteReport,
  SuiteReportBaseline,
  SuiteReportTestGroup,
  SuiteReportVariance,
  SuiteRootCauseRollupEntry,
  SuiteRun,
  SuiteRunReportEmbed,
  SuiteScatterPoint,
} from "@mcp-token-footprint/shared";
import type { GradeRepository } from "../grading/grade-repository.js";
import { buildSuiteAnalytics, selectRunScore } from "../suites/analytics.js";
import type { SuiteReportRepository } from "../suites/suite-report-repository.js";
import type { SuiteRunRepository } from "../suites/suite-run-repository.js";
import type { SuiteService } from "../suites/service.js";
import type { RunRepository } from "../testing/run-repository.js";
import type { ScenarioService } from "../testing/scenario-service.js";
import type { TestService } from "../testing/test-service.js";
import { stableStringify } from "../utils/json.js";
import {
  createRunJsonReport,
  createRunMarkdownReport,
  escapeMarkdownTable,
  escapeText,
  isSubscriptionCostBasis,
  SUBSCRIPTION_COST_FOOTNOTE,
  type RunReportEnrichment,
} from "./reports.js";

/**
 * Benchmarks (WP 3.4) — the suite-RUN report export, the suite-scope analogue of the run report
 * (`./reports.ts` `createRun*Report`). It mirrors that route's shape: the persisted {@link SuiteRun}
 * carries only ids + cached aggregates, so the route resolves the enrichment (suite name, per-cell
 * rows, the derived analytics) and hands it to the two PURE builders — one JSON payload, one
 * self-contained Markdown document. Everything here is DERIVED (recomputable from the child runs +
 * their grades + test metadata); nothing is a source of truth. A "cell" in the report IS one child run
 * (test × scenario × repetition), so every cited child-run link resolves to a real run report.
 *
 * Both documents read insights-first (most important → appendix), in five sections:
 *   1. Cross-run rating report — the persisted Auto-Rating {@link SuiteReport}: narrative FIRST, then
 *      per-test-group consistency + variance (with per-group findings), baseline deltas vs. a previous
 *      comparable run, root-cause roll-up, error clustering, provenance. ALWAYS rendered in Markdown —
 *      an honest one-liner stands in when no report has landed (stakeholder-facing completeness).
 *   2. Summary — suite-run identity + the derived aggregates (cells, mean grade, pass rate, costs).
 *   3. Statistics — the quality × cost scatter, metadata breakdowns, and the per-cell table.
 *   4. Run details — each member's complete embedded run report (`embed=full`; an honest note otherwise).
 *   5. Appendix — the frozen config snapshot the run executed under (reference material, last).
 */

/** One reported matrix cell — a single child run, with its resolved names + primary/selected score. */
export type SuiteRunReportCell = {
  runId: string;
  testId: string;
  testName: string;
  scenarioId: string;
  scenarioName: string;
  /** 1-based repetition ordinal within its (test, scenario) subject (reconstructed in start order). */
  repetition: number;
  status: string;
  /** The selected-grader (default primary) score, or null when this run has no graded score. */
  score: number | null;
  // Per-member spend — ALWAYS present (from the same `summary` we already fetch). This is what turns
  // the export from "just links" into real numbers you can read without opening every run.
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  turns: number;
  toolCalls: number;
  /**
   * Claude subscription (WP 3.2, D-CS4/D-CS8) — this member's {@link CostBasis}, read off the SAME
   * `summary` the other spend fields come from. Present only for a `claude_subscription` member
   * (`"subscription_reference"` — `costUsd` above is a shadow reference, not a billed charge); absent
   * for every ordinary member, so an all-`api_exact` suite run's cells stay byte-identical to before.
   */
  costBasis?: CostBasis;
  /**
   * `embed=full` only — the member's COMPLETE run report (the full `RunDetail` + statistics +
   * per-step KPIs, same payload as `GET /api/reports/run/:id/json`) embedded inline, so the export
   * carries what actually happened inside the run, not a link to it. Absent for `embed=summary`.
   */
  detail?: ReturnType<typeof createRunJsonReport>;
  /** `embed=full` only — the member's latest-per-grader grade rows (absent for `embed=summary`). */
  grades?: RunGrade[];
};

/** A member run whose FULL report is embedded (`embed=full`) — carried for the Markdown detail section. */
type EmbeddedMemberRun = {
  runId: string;
  testName: string;
  scenarioName: string;
  run: RunDetail;
  enrich: RunReportEnrichment;
};

/** The resolved enrichment a suite-run report is built from (all derived from persisted state). */
export type SuiteRunReportData = {
  suiteName: string | null;
  cells: SuiteRunReportCell[];
  analytics: SuiteAnalytics;
  /** Which embed level produced this data (drives the Markdown "Run details" section). */
  embed: SuiteRunReportEmbed;
  /** `embed=full` only — the ordered member run reports the Markdown builder appends verbatim. */
  members?: EmbeddedMemberRun[];
  /**
   * Auto-Rating (WP 4.3, AR7) — the LATEST persisted cross-run {@link SuiteReport}, or `null` when none
   * has landed yet (fewer than 2 members, or generation hasn't finished). The JSON builder omits the
   * `suiteReport` key entirely when this is `null` (never a null placeholder); the Markdown builder
   * still renders section 1 with an honest one-liner so the stakeholder document stays complete.
   */
  suiteReport: SuiteReport | null;
};

/** The repositories/services the collector reads (the report route already owns all of these). */
export type SuiteRunReportDeps = {
  suiteRuns: SuiteRunRepository;
  runs: RunRepository;
  grades: GradeRepository;
  tests: TestService;
  scenarios: ScenarioService;
  suites: SuiteService;
  /** Auto-Rating (WP 4.3) — reads only the LATEST persisted report; never generates one. */
  suiteReports: SuiteReportRepository;
};

/**
 * Resolve the enrichment for a suite run: the suite name, the per-cell rows, and the derived analytics
 * (same {@link buildSuiteAnalytics} the `/analytics` endpoint returns, so the report's scatter/breakdowns
 * match the console's exactly). `grader` selects the score dimension (default = primary-grader priority).
 */
export function collectSuiteRunReportData(
  deps: SuiteRunReportDeps,
  suiteRun: SuiteRun,
  grader?: GraderId,
  embed: SuiteRunReportEmbed = "summary",
): SuiteRunReportData {
  const runIds = deps.suiteRuns.listChildRunIds(suiteRun.id);
  const analytics = buildSuiteAnalytics(deps.runs, deps.grades, deps.tests, runIds, grader);
  const { cells, members } = buildReportCells(deps, runIds, grader, embed);
  // Auto-Rating (WP 4.3) — a pure read of the LATEST persisted report; `null` when none exists yet.
  // The persisted ROW's status is echoed onto the report at READ time (additive; the stored
  // report_json is never rewritten, so a pre-stamp row still surfaces `ready`/`partial`/`error`).
  const latestReport = deps.suiteReports.latest(suiteRun.id);
  return {
    suiteName: safeSuiteName(deps.suites, suiteRun.suiteId),
    cells,
    analytics,
    embed,
    ...(embed === "full" ? { members } : {}),
    suiteReport: latestReport ? { ...latestReport.report, status: latestReport.status } : null,
  };
}

/**
 * Per-cell rows: one child run each, with a reconstructed repetition ordinal + resolved names + score
 * + per-member spend (tokens/cost/turns/toolCalls, always). For `embed=full`, additionally embed the
 * member's complete run report inline (`cell.detail`) + its grades, and collect the raw run + its
 * enrichment for the Markdown "Run details" section. Every heavier fetch (`getRun`, `tests.get`,
 * `scenarios.get`) is wrapped so a single deleted parent degrades THAT cell to summary-only rather
 * than failing the whole export.
 */
function buildReportCells(
  deps: SuiteRunReportDeps,
  runIds: readonly string[],
  grader: GraderId | undefined,
  embed: SuiteRunReportEmbed,
): { cells: SuiteRunReportCell[]; members: EmbeddedMemberRun[] } {
  const repCounter = new Map<string, number>();
  const testNames = new Map<string, string>();
  const scenarioNames = new Map<string, string>();
  const cells: SuiteRunReportCell[] = [];
  const members: EmbeddedMemberRun[] = [];
  for (const runId of runIds) {
    let summary: ReturnType<RunRepository["getSummary"]>;
    try {
      summary = deps.runs.getSummary(runId);
    } catch {
      continue; // run deleted — nothing to report for it
    }
    const latestByGrader = new Map<GraderId, RunGrade>();
    for (const grade of deps.grades.listByRun(runId)) latestByGrader.set(grade.graderId, grade);
    // `listChildRunIds` is ordered by started_at ASC, so the per-subject counter reproduces a stable
    // 1-based repetition ordinal (fallback for a legacy/null `repetition`; the persisted ordinal wins).
    const subjectKey = `${summary.testId} ${summary.scenarioId}`;
    const nextOrdinal = (repCounter.get(subjectKey) ?? 0) + 1;
    repCounter.set(subjectKey, nextOrdinal);
    const testName = resolveName(testNames, summary.testId, (id) => deps.tests.get(id).name);
    const scenarioName = resolveName(
      scenarioNames,
      summary.scenarioId,
      (id) => deps.scenarios.get(id).name,
    );
    const cell: SuiteRunReportCell = {
      runId,
      testId: summary.testId,
      testName,
      scenarioId: summary.scenarioId,
      scenarioName,
      repetition: summary.repetition ?? nextOrdinal,
      status: summary.status,
      score: selectRunScore(latestByGrader, grader),
      tokensIn: summary.tokensIn,
      tokensOut: summary.tokensOut,
      costUsd: summary.costUsd,
      turns: summary.turns,
      toolCalls: summary.toolCalls,
      // Claude subscription (WP 3.2) — same presence rule as the run report: omit rather than carry a
      // `null`/`"api_exact"` placeholder for an ordinary member.
      ...(summary.costBasis ? { costBasis: summary.costBasis } : {}),
    };
    if (embed === "full") {
      // Embed the member's full run report (steps/events/stats). One deleted test/scenario/run must
      // degrade this cell to summary-only, never 500 the export (mirrors resolveName/safeSuiteName).
      try {
        const run = deps.runs.getRun(runId);
        const enrich: RunReportEnrichment = {
          test: deps.tests.get(summary.testId),
          scenario: deps.scenarios.get(summary.scenarioId),
        };
        cell.detail = createRunJsonReport(run, enrich);
        cell.grades = deps.grades.listByRun(runId);
        members.push({ runId, testName, scenarioName, run, enrich });
      } catch {
        // Leave the cell as summary-only — its tokens/cost/score are already populated above.
      }
    }
    cells.push(cell);
  }
  return { cells, members };
}

function resolveName(
  cache: Map<string, string>,
  id: string,
  lookup: (id: string) => string,
): string {
  const cached = cache.get(id);
  if (cached !== undefined) return cached;
  let name = id;
  try {
    name = lookup(id);
  } catch {
    // Entity deleted after the run — fall back to the id so the report stays readable + linkable.
  }
  cache.set(id, name);
  return name;
}

function safeSuiteName(suites: SuiteService, suiteId: string | undefined): string | null {
  // WP 2.2 — a collection/adhoc plan run has no owning suite, so there is no name to resolve.
  if (suiteId === undefined) return null;
  try {
    return suites.get(suiteId).name;
  } catch {
    return null; // suite deleted after the run — the suite run + its children still report
  }
}

// ── Builders (pure) ───────────────────────────────────────────────────────────────────────────────

export function createSuiteRunJsonReport(suiteRun: SuiteRun, data: SuiteRunReportData) {
  // Key insertion order is insights-first (identity → rating report → aggregates → analytics → cells
  // → the frozen config last) so the serialized document reads top-down like the Markdown export.
  // Every key keeps its existing name and shape — only the order changed (consumers address keys by
  // name, never by position).
  return {
    generatedAt: new Date().toISOString(),
    suiteRun: {
      id: suiteRun.id,
      // WP 2.2 — a collection/adhoc plan run has no owning suite; `source` records which plan launched it.
      suiteId: suiteRun.suiteId ?? null,
      source: suiteRun.source ?? null,
      suiteName: data.suiteName,
      status: suiteRun.status,
      startedAt: suiteRun.startedAt,
      ...(suiteRun.endedAt !== undefined ? { endedAt: suiteRun.endedAt } : {}),
    },
    // Auto-Rating (WP 4.3) — the cross-run rating report, the highest-value insight; ABSENT (not
    // `null`) when none has landed yet, so a report-less export carries no placeholder key.
    ...(data.suiteReport ? { suiteReport: data.suiteReport } : {}),
    // Derived roll-up (exec cost + a SEPARATE judge-cost ledger); null when the run never cached one.
    aggregates: suiteRun.aggregates ?? null,
    // The quality×cost scatter + metadata breakdowns (same payload as GET /api/suite-runs/:id/analytics).
    analytics: data.analytics,
    // Per-cell (= per child run) status + score + spend; for embed=full each carries its full run report.
    cells: data.cells,
    // How much per-member detail the cells carry ("summary" numbers vs "full" embedded run reports).
    embed: data.embed,
    // Appendix — the frozen config the run executed under (freezes even if the suite is later edited/deleted).
    configSnapshot: suiteRun.configSnapshot,
  };
}

export function createSuiteRunMarkdownReport(suiteRun: SuiteRun, data: SuiteRunReportData): string {
  const lines: string[] = ["# MCP Token Footprint Suite Run Report", ""];
  // Insights first, reference material last: rating report → summary → statistics → run details →
  // the frozen config appendix. Every section always renders (honest one-liners stand in for absent
  // content) so a stakeholder document never silently drops a numbered section.
  renderSuiteReport(lines, data.suiteReport, data.cells);
  renderSummary(lines, suiteRun, data);
  renderStatistics(lines, data);
  renderRunDetails(lines, data);
  renderConfigAppendix(lines, suiteRun);
  return `${lines.join("\n")}\n`;
}

// ── Section 2 — Summary (suite-run identity + derived aggregates) ───────────────────────────────────

function renderSummary(lines: string[], suiteRun: SuiteRun, data: SuiteRunReportData): void {
  lines.push(
    "## 2. Summary",
    "",
    // WP 2.2 — a collection/adhoc plan run has no owning suite; show the plan source + a dash for the id.
    `- Source: ${suiteRun.source ?? "suite"}`,
    `- Suite: ${suiteRun.suiteId === undefined ? "—" : (data.suiteName ?? "(deleted)")}`,
    `- Suite run ID: ${suiteRun.id}`,
    `- Suite ID: ${suiteRun.suiteId ?? "—"}`,
    `- Status: ${suiteRun.status}`,
    `- Started: ${suiteRun.startedAt}`,
    `- Ended: ${suiteRun.endedAt ?? "n/a"}`,
    "",
  );
  const aggregates = suiteRun.aggregates;
  if (!aggregates) {
    lines.push("_No aggregates cached for this suite run._", "");
    return;
  }
  lines.push(
    `- Cells: ${aggregates.cellsCompleted} / ${aggregates.cellsTotal} completed`,
    `- Mean grade: ${formatScore(aggregates.meanGrade)}`,
    `- Grade std dev: ${formatScore(aggregates.gradeStdDev)}`,
    `- Pass rate (≥ 0.5): ${aggregates.passRateAt05 === null ? "n/a" : formatPercent(aggregates.passRateAt05)}`,
    `- Total tokens: ${aggregates.totalTokens}`,
    // Exec cost + judge cost are SEPARATE ledgers (judge is never folded into exec); both estimated.
    `- Exec cost: $${aggregates.execCostUsd.toFixed(4)} (estimated)`,
    `- Judge cost: $${aggregates.judgeCostUsd.toFixed(4)} (estimated)`,
    "",
  );
}

// ── Section 3 — Statistics (scatter + breakdowns + per-cell table) ──────────────────────────────────

function renderStatistics(lines: string[], data: SuiteRunReportData): void {
  lines.push("## 3. Statistics", "");
  renderScatter(lines, data.analytics.scatter, data.cells);
  renderBreakdowns(lines, data.analytics.breakdowns, data.cells);
  renderCells(lines, data.cells);
}

function renderCells(lines: string[], cells: SuiteRunReportCell[]): void {
  lines.push("### Cells", "");
  if (cells.length === 0) {
    lines.push("_No child runs are linked to this suite run._", "");
    return;
  }
  // Real per-member numbers (tokens/cost) inline — not just a link — plus a link to the full run report.
  lines.push(
    "| Test | Scenario | Rep | Status | Score | Turns | Tools | Tokens | Cost | Run |",
    "|---|---|---:|---|---:|---:|---:|---:|---:|---|",
  );
  // Claude subscription (WP 3.2) — track whether ANY cell's cost is a subscription shadow reference so
  // the table footnote renders only when it's actually relevant (byte-identical for an all-`api_exact`
  // suite run).
  let hasSubscriptionMember = false;
  for (const cell of cells) {
    // Cite the child run by id AND a resolvable link to its own run report (GET /api/reports/run/:id/json).
    const link = `[${cell.runId}](/api/reports/run/${cell.runId}/json)`;
    const tokens = cell.tokensIn + cell.tokensOut;
    const isSubscription = isSubscriptionCostBasis(cell.costBasis);
    if (isSubscription) hasSubscriptionMember = true;
    const cost = `$${cell.costUsd.toFixed(4)}${isSubscription ? " *" : ""}`;
    lines.push(
      `| ${escapeMarkdownTable(cell.testName)} | ${escapeMarkdownTable(cell.scenarioName)} | ${cell.repetition} | ${cell.status} | ${formatScore(cell.score)} | ${cell.turns} | ${cell.toolCalls} | ${tokens} | ${cost} | ${link} |`,
    );
  }
  lines.push("");
  if (hasSubscriptionMember) {
    lines.push(
      `> **\\* Cost note — subscription reference.** ${SUBSCRIPTION_COST_FOOTNOTE} Applies to every ` +
        "`*`-marked Cost above; see that member's own run report for its full statement.",
      "",
    );
  }
}

function renderScatter(
  lines: string[],
  scatter: SuiteScatterPoint[],
  cells: SuiteRunReportCell[],
): void {
  lines.push("### Quality × cost (per subject, repetitions averaged)", "");
  if (scatter.length === 0) {
    lines.push("_No graded subjects to plot._", "");
    return;
  }
  const testName = nameLookup(cells, (c) => [c.testId, c.testName]);
  const scenarioName = nameLookup(cells, (c) => [c.scenarioId, c.scenarioName]);
  lines.push(
    "| Test | Scenario | Mean score | Mean tokens | Mean cost | Reps |",
    "|---|---|---:|---:|---:|---:|",
  );
  for (const point of scatter) {
    lines.push(
      `| ${escapeMarkdownTable(testName(point.testId))} | ${escapeMarkdownTable(scenarioName(point.scenarioId))} | ${formatScore(point.meanScore)} | ${Math.round(point.meanTokens)} | $${point.meanCostUsd.toFixed(4)} | ${point.reps} |`,
    );
  }
  lines.push("");
}

function renderBreakdowns(
  lines: string[],
  breakdowns: SuiteBreakdownSlice[],
  cells: SuiteRunReportCell[],
): void {
  lines.push("### Metadata breakdowns", "");
  if (breakdowns.length === 0) {
    lines.push("_No category / difficulty / tag metadata on the tests in this run._", "");
    return;
  }
  const scenarioName = nameLookup(cells, (c) => [c.scenarioId, c.scenarioName]);
  lines.push(
    "| Dimension | Key | Scenario | Mean score | Mean cost | Count |",
    "|---|---|---|---:|---:|---:|",
  );
  for (const slice of breakdowns) {
    lines.push(
      `| ${slice.dimension} | ${escapeMarkdownTable(slice.key)} | ${escapeMarkdownTable(scenarioName(slice.scenarioId))} | ${formatScore(slice.meanScore)} | $${slice.meanCostUsd.toFixed(4)} | ${slice.count} |`,
    );
  }
  lines.push("");
}

// ── Section 4 — embedded run details ────────────────────────────────────────────────────────────────

/**
 * Append every member run's COMPLETE Markdown report (the same document `GET /api/reports/run/:id/
 * markdown` serves) under one section, so an `embed=full` export carries the actual session logs, not
 * just links. Each member's report is reused verbatim from {@link createRunMarkdownReport} (pure) with
 * its headings demoted so the one-document hierarchy stays sane (section H2 > member H3 > report ≥H4).
 * For `embed=summary` the section still renders (stable numbering) with an honest pointer instead.
 */
function renderRunDetails(lines: string[], data: SuiteRunReportData): void {
  lines.push("## 4. Run details", "");
  if (data.embed !== "full") {
    lines.push(
      "_Member run details are not embedded in a summary export — re-export with `embed=full` to include each member's complete session log._",
      "",
    );
    return;
  }
  const members = data.members ?? [];
  if (members.length === 0) {
    lines.push("_No member run details are embedded._", "");
    return;
  }
  for (const member of members) {
    lines.push(
      `### Run ${member.runId} — ${escapeText(member.testName)} · ${escapeText(member.scenarioName)}`,
      "",
    );
    lines.push(demoteMarkdownHeadings(createRunMarkdownReport(member.run, member.enrich), 3), "");
  }
}

/** Demote every ATX heading in a Markdown blob by `by` levels (clamped at 6) so an embedded document
 *  nests under its host section instead of colliding heading levels. Only line-leading `#` runs match. */
function demoteMarkdownHeadings(markdown: string, by: number): string {
  return markdown.replace(/^(#{1,6})(?=\s)/gm, (hashes) =>
    "#".repeat(Math.min(6, hashes.length + by)),
  );
}

// ── Section 1 — Cross-run rating report (Auto-Rating WP 4.3) ───────────────────────────────────────
// The document LEADS with this — it is the highest-value insight for a stakeholder. Renders the
// persisted {@link SuiteReport} the caller resolved via the SAME `SuiteReportRepository`
// `GET /api/suite-runs/:id/report` reads — the export and the endpoint can never disagree. The section
// ALWAYS renders: when no report has landed (fewer than 2 members, or generation is pending) an honest
// one-liner stands in rather than silently omitting the section. Inside, the narrative comes FIRST,
// then per-test-group consistency + variance (with per-group findings), baseline deltas vs. a previous
// comparable suite run, root-cause roll-up, error clustering, and provenance.

function renderSuiteReport(
  lines: string[],
  report: SuiteReport | null,
  cells: SuiteRunReportCell[],
): void {
  lines.push("## 1. Cross-run rating report", "");

  if (!report) {
    lines.push(
      "_No cross-run rating report was generated (fewer than 2 members, or generation is pending)._",
      "",
    );
    return;
  }

  // Honest status callout for a report that isn't fully `ready` (suite-report enrichment, additive).
  if (report.status === "partial") {
    lines.push(
      "> **Report status: partial** — some member ratings never landed; the sections below may be incomplete.",
      "",
    );
  } else if (report.status === "error") {
    lines.push(
      "> **Report status: error** — report generation failed part-way; treat the sections below as incomplete.",
      "",
    );
  }

  // Narrative FIRST — the composed cross-run story is the section's headline.
  lines.push("### Narrative", "");
  lines.push(
    report.narrative.trim().length > 0 ? report.narrative : "_No narrative composed._",
    "",
  );

  const testName = nameLookup(cells, (c) => [c.testId, c.testName]);
  renderTestGroups(lines, report.testGroups, testName);
  if (report.baseline) renderBaseline(lines, report.baseline, testName);
  renderRootCauseRollup(lines, report.rootCauseRollup);
  renderErrorClustering(lines, report.errorClustering);

  lines.push(
    "### Provenance",
    "",
    `- Judge: ${report.judgeProvenance.judgeProviderId ?? "none"}${report.judgeProvenance.judgeModel ? ` (${report.judgeProvenance.judgeModel})` : ""}`,
    `- Rating version: ${report.ratingVersion}`,
    `- Generated: ${report.generatedAt}`,
    "",
  );
}

/**
 * Baseline deltas (suite-report enrichment) — this report's per-test means minus the most recent
 * EARLIER comparable suite run's ({@link SuiteReportBaseline}). Only rendered when the report carries
 * one; a null delta renders "n/a" (never a fabricated 0).
 */
function renderBaseline(
  lines: string[],
  baseline: SuiteReportBaseline,
  testName: (id: string) => string,
): void {
  lines.push(
    `### Compared to previous run ${baseline.suiteRunId}`,
    "",
    `_Baseline report generated: ${baseline.generatedAt}_`,
    "",
  );
  if (baseline.perTest.length === 0) {
    lines.push("_No per-test deltas were computable against the baseline run._", "");
    return;
  }
  lines.push(
    "| Test | Score Δ (mean) | Cost Δ (mean) | Turns Δ (mean) | Agreement flipped |",
    "|---|---:|---:|---:|---|",
  );
  for (const row of baseline.perTest) {
    lines.push(
      `| ${escapeMarkdownTable(testName(row.testId))} | ${formatDelta(row.scoreMeanDelta)} | ${formatDelta(row.costMeanDelta, "$")} | ${formatDelta(row.turnsMeanDelta)} | ${row.agreementFlipped ? "⚠ yes" : "no"} |`,
    );
  }
  lines.push("");
}

function renderTestGroups(
  lines: string[],
  testGroups: readonly SuiteReportTestGroup[],
  testName: (id: string) => string,
): void {
  lines.push("### Per-test-group consistency + variance", "");
  if (testGroups.length === 0) {
    lines.push("_No test groups to report on._", "");
    return;
  }
  lines.push(
    "| Test | Agreement | Score (mean ± std) | Cost (mean ± std) | Turns (mean ± std) | Tool-path variance |",
    "|---|---|---:|---:|---:|---:|",
  );
  for (const group of testGroups) {
    const agreement = `${group.agreement.contradicts ? "⚠ contradicts" : "agrees"} (${group.agreement.agreeCount}/${group.agreement.totalCount})`;
    lines.push(
      `| ${escapeMarkdownTable(testName(group.testId))} | ${escapeMarkdownTable(agreement)} | ${formatVariance(group.score)} | ${formatVariance(group.costUsd, "$")} | ${formatVariance(group.turns)} | ${group.toolPathVariance} |`,
    );
    if (group.agreement.summary) {
      lines.push(`  - ${escapeText(group.agreement.summary)}`);
    }
    // Deterministic per-group highlight findings (suite-report enrichment) — sub-bullets under the row.
    for (const finding of group.findings ?? []) {
      lines.push(`  - ${escapeText(finding)}`);
    }
  }
  lines.push("");
}

function renderRootCauseRollup(
  lines: string[],
  rollup: readonly SuiteRootCauseRollupEntry[],
): void {
  lines.push("### Root-cause roll-up", "");
  if (rollup.length === 0) {
    lines.push("_No cross-run error findings to roll up (operationally clean)._", "");
    return;
  }
  lines.push(
    "| Bucket | Fix target | Frequency | Representative draft fix |",
    "|---|---|---:|---|",
  );
  for (const entry of rollup) {
    lines.push(
      `| ${entry.bucket} | ${entry.fixTarget} | ${entry.frequency} | ${escapeMarkdownTable(entry.draftFix)} |`,
    );
  }
  lines.push("");
}

function renderErrorClustering(lines: string[], buckets: readonly FailureBucket[]): void {
  lines.push("### Error clustering", "");
  if (buckets.length === 0) {
    lines.push("_No error clusters (operationally clean)._", "");
    return;
  }
  lines.push("| Cluster | Share | Member runs |", "|---|---:|---|");
  for (const bucket of buckets) {
    lines.push(
      `| ${escapeMarkdownTable(bucket.label)} | ${(bucket.share * 100).toFixed(1)}% | ${bucket.memberRunIds.length} |`,
    );
  }
  lines.push("");
}

/** A variance's "mean ± std", prefixed (e.g. `$`) when given; "n/a" when unevaluable (never a forced 0). */
function formatVariance(variance: SuiteReportVariance, prefix = ""): string {
  if (variance.mean === null || variance.stdDev === null) return "n/a";
  const decimals = prefix === "$" ? 4 : 2;
  return `${prefix}${variance.mean.toFixed(decimals)} ± ${prefix}${variance.stdDev.toFixed(decimals)}`;
}

/** A signed baseline delta (`+0.05` / `-$0.0020`); "n/a" when null (never a fabricated 0). */
function formatDelta(delta: number | null, prefix = ""): string {
  if (delta === null) return "n/a";
  const decimals = prefix === "$" ? 4 : 2;
  const sign = delta < 0 ? "-" : "+";
  return `${sign}${prefix}${Math.abs(delta).toFixed(decimals)}`;
}

// ── Section 5 — Appendix: frozen config snapshot ────────────────────────────────────────────────────

/** The exact config the run executed under (freezes even if the suite is later edited/deleted) —
 *  pure reference material, so it closes the document. */
function renderConfigAppendix(lines: string[], suiteRun: SuiteRun): void {
  const config = suiteRun.configSnapshot;
  lines.push(
    "## 5. Appendix — frozen config snapshot",
    "",
    `- Repetitions: ${config.repetitions}`,
    `- Max concurrency: ${config.maxConcurrency}`,
    `- Aggregate cost cap: ${config.aggregateCostCapUsd === undefined ? "—" : `$${config.aggregateCostCapUsd}`}`,
    "",
  );
  const body = stableStringify(config);
  const fence = body.includes("```") ? "````" : "```";
  lines.push(`${fence}json`, body, fence, "");
}

// ── Helpers ───────────────────────────────────────────────────────────────────────────────────────

/** Build an id→name resolver from the reported cells (falls back to the id for an unmapped subject). */
function nameLookup(
  cells: SuiteRunReportCell[],
  pick: (cell: SuiteRunReportCell) => [string, string],
): (id: string) => string {
  const map = new Map<string, string>();
  for (const cell of cells) {
    const [id, name] = pick(cell);
    if (!map.has(id)) map.set(id, name);
  }
  return (id: string) => map.get(id) ?? id;
}

/** A 0–1 score to two decimals, or "n/a" when null (never fabricate a 0 for an ungraded subject). */
function formatScore(score: number | null): string {
  return score === null ? "n/a" : score.toFixed(2);
}

/** A 0–1 rate as a whole percent. */
function formatPercent(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}
