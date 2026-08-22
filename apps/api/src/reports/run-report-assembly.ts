import {
  buildRunReportHumanFeedback,
  type RunDetail,
  type RunFeedback,
  type Scenario,
  type Test,
} from "@mcp-token-footprint/shared";
import type { RunReportService } from "../grading/run-report.js";
import { computeCostBreakdown } from "../providers/pricing.js";
import type { RunRepository } from "../testing/run-repository.js";
import {
  aggregateRunUsage,
  createRunJsonReport,
  createRunMarkdownReport,
  type RunReportEnrichment,
} from "./reports.js";

/**
 * Run-report assembly — the four-step "fetch the run, resolve its test + environment, compose its
 * rating" recipe that both `createRunJsonReport` and `createRunMarkdownReport` need before they can
 * build anything.
 *
 * It exists as its own module because there are now TWO callers: the HTTP export routes
 * (`GET /api/reports/run/:id/{json,markdown}`) and the workbench MCP server's `run_report` tool +
 * `workbench://reports/run/{runId}.{md,json}` resources (planning/Roadmap/RM-08-ci/mcp-server.md, D-MCP4 — the MCP
 * layer re-projects existing server-side code, it never re-derives it). Keeping the recipe here means
 * the export and the MCP resource can never disagree about what a run report contains.
 *
 * The report BUILDERS themselves stay pure (no DB) — this module is only the argument assembly.
 */
export type RunReportSources = {
  runs: Pick<RunRepository, "getRun">;
  /** `TestService` in the app; narrowed to the one method so a test can pass a stub. */
  tests: { get(id: string): Test };
  /** `ScenarioService` in the app (the wire entity is still "scenario"; the UI label is Environment). */
  scenarios: { get(id: string): Scenario };
  runReports: Pick<RunReportService, "compose">;
  /**
   * RM-17 Phase 6 (AM-OB2) — `RunFeedbackRepository`, narrowed to its one read. REQUIRED, mirroring
   * the `security: ReportSecurityPorts` decision in `reports/routes.ts`: an export that quietly lost
   * its human-feedback block would read as "nobody said anything", and a caller must decide rather
   * than inherit a default. The BUILDERS still take it optionally — that is how an intentionally
   * cheap caller (the assistant's `run_report` tool, an embedded suite-member report) omits the
   * block honestly — but anything assembled through here always carries it.
   */
  feedback: { list(runId: string): RunFeedback[] };
};

/**
 * RM-33 WP 3.2 — the ONE place a run report's {@link RunReportEnrichment} is built, so the HTTP
 * export, the workbench MCP `run_report` tool and the suite-run report's embedded member reports all
 * carry the same cost decomposition.
 *
 * It lives here, not in the (pure) report builders, because pricing a model goes through
 * `resolvePrice`, which may consult the pricing-editor table in the database. `computeCostBreakdown`
 * is the app's SINGLE cost formula (D-CT5) — never write a second one — and it is entered with the
 * run's own aggregated usage, so the four terms decompose the tokens this run actually billed.
 *
 * A caveat worth stating rather than hiding: `statistics.estimatedCostUsd` is the run's PERSISTED
 * cost, accumulated turn by turn while it executed (and per-step with whatever model that step used).
 * The breakdown re-prices the same tokens at the price on file NOW, against the environment's model.
 * For an ordinary single-model run at unchanged prices they agree; if the price was edited since, or
 * the run spanned models, the persisted figure is the authoritative one.
 */
export function buildRunReportEnrichment(
  run: RunDetail,
  test: Test,
  scenario: Scenario,
): RunReportEnrichment {
  return {
    test,
    scenario,
    costBreakdown: computeCostBreakdown(scenario.model, aggregateRunUsage(run)),
  };
}

/** Fetch + enrich + compose, once. Throws the repositories' own 404 for an unknown run. */
function assemble(sources: RunReportSources, runId: string) {
  const run = sources.runs.getRun(runId);
  const test = sources.tests.get(run.testId);
  const scenario = sources.scenarios.get(run.scenarioId);
  return {
    run,
    enrich: buildRunReportEnrichment(run, test, scenario),
    rating: sources.runReports.compose(runId),
    // AM-OB2 — read SEPARATELY from `compose`, deliberately: `RunReportService` is the grading
    // module, and D-OB15/AR6 says nothing in grading reads `run_feedback`. Two reads, two ledgers.
    humanFeedback: buildRunReportHumanFeedback(sources.feedback.list(runId)),
  } as const;
}

/** The run's JSON export document. */
export function buildRunJsonReport(sources: RunReportSources, runId: string) {
  const { run, enrich, rating, humanFeedback } = assemble(sources, runId);
  return createRunJsonReport(run, enrich, rating, humanFeedback);
}

/** The run's Markdown export document. */
export function buildRunMarkdownReport(sources: RunReportSources, runId: string): string {
  const { run, enrich, rating, humanFeedback } = assemble(sources, runId);
  return createRunMarkdownReport(run, enrich, rating, humanFeedback);
}
