import type { Scenario, Test } from "@mcp-token-footprint/shared";
import type { RunReportService } from "../grading/run-report.js";
import type { RunRepository } from "../testing/run-repository.js";
import { createRunJsonReport, createRunMarkdownReport } from "./reports.js";

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
};

/** Fetch + enrich + compose, once. Throws the repositories' own 404 for an unknown run. */
function assemble(sources: RunReportSources, runId: string) {
  const run = sources.runs.getRun(runId);
  const test = sources.tests.get(run.testId);
  const scenario = sources.scenarios.get(run.scenarioId);
  return { run, enrich: { test, scenario }, rating: sources.runReports.compose(runId) } as const;
}

/** The run's JSON export document. */
export function buildRunJsonReport(sources: RunReportSources, runId: string) {
  const { run, enrich, rating } = assemble(sources, runId);
  return createRunJsonReport(run, enrich, rating);
}

/** The run's Markdown export document. */
export function buildRunMarkdownReport(sources: RunReportSources, runId: string): string {
  const { run, enrich, rating } = assemble(sources, runId);
  return createRunMarkdownReport(run, enrich, rating);
}
