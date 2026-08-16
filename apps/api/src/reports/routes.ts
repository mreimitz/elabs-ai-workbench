import type { FastifyInstance } from "fastify";
import {
  digestGenerateQuerySchema,
  digestListQuerySchema,
  digestScheduleSchema,
  serverReportQuerySchema,
  suiteRunReportQuerySchema,
  type RunDetail,
} from "@mcp-token-footprint/shared";
import type { ScanRepository } from "../scans/repository.js";
import type { ServerRepository } from "../servers/repository.js";
import type { GradeRepository } from "../grading/grade-repository.js";
import type { RunReportService } from "../grading/run-report.js";
import { parseGraderQuery } from "../suites/analytics.js";
import type { SuiteReportRepository } from "../suites/suite-report-repository.js";
import type { SuiteService } from "../suites/service.js";
import type { SuiteRunRepository } from "../suites/suite-run-repository.js";
import { deriveLegacyAnswerStep } from "../testing/qlik-answers-message.js";
import type { RunRepository } from "../testing/run-repository.js";
import type { ScenarioService } from "../testing/scenario-service.js";
import type { TestService } from "../testing/test-service.js";
import { DEFAULT_HEATMAP_MODELS } from "../compatibility/dataset.js";
import { createDigestMarkdownReport } from "./digest-markdown.js";
import { DigestReportRepository, DigestScheduleService } from "./digest.js";
import {
  createJsonReport,
  createMarkdownReport,
  createRunJsonReport,
  createRunMarkdownReport,
} from "./reports.js";
import { createServerReport } from "./server-report.js";
import { createServerMarkdownReport } from "./server-report-markdown.js";
import {
  collectSuiteRunReportData,
  createSuiteRunJsonReport,
  createSuiteRunMarkdownReport,
  type SuiteRunReportDeps,
} from "./suite-run-report.js";

export async function registerReportRoutes(
  app: FastifyInstance,
  scans: ScanRepository,
  servers: ServerRepository,
  runRepository: RunRepository,
  testService: TestService,
  scenarioService: ScenarioService,
  suiteRunRepository: SuiteRunRepository,
  gradeRepository: GradeRepository,
  suiteService: SuiteService,
  runReports: RunReportService,
  suiteReports: SuiteReportRepository,
  // Observability WP5.5 (D-OB22) — the scheduled digest report family. `digestRepository` is exposed
  // directly for `GET /api/reports/digest[?...]` reads; `digestSchedule` owns the schedule config +
  // the manual on-demand generation path (the scheduler tick calls the SAME service — see index.ts).
  digestRepository: DigestReportRepository,
  digestSchedule: DigestScheduleService,
) {
  // The suite-run report reads only DERIVED state (child runs + grades + test/scenario/suite names) PLUS
  // (Auto-Rating WP 4.3) the persisted cross-run `SuiteReport`, if one has landed — additive, absent when
  // none exists yet (mirrors the run export's optional `rating` block, WP 1.5).
  const suiteReportDeps: SuiteRunReportDeps = {
    suiteRuns: suiteRunRepository,
    runs: runRepository,
    grades: gradeRepository,
    tests: testService,
    scenarios: scenarioService,
    suites: suiteService,
    suiteReports,
  };
  app.get("/api/reports/scan/:id/json", async (request) => {
    const { id } = request.params as { id: string };
    return createJsonReport(scans.getDetail(id));
  });

  app.get("/api/reports/scan/:id/markdown", async (request, reply) => {
    const { id } = request.params as { id: string };
    const scan = scans.getDetail(id);
    reply.header("content-type", "text/markdown; charset=utf-8");
    reply.header("content-disposition", `attachment; filename="mcp-token-footprint-${scan.id}.md"`);
    return createMarkdownReport(scan);
  });

  // ── Server-level Export Report (HTML → print-to-PDF). One typed payload the web report view
  // renders with @brand/ui. `:scanId` is the scan to report on (the web picks the latest successful
  // scan for a server, or a specific historical scan). A missing scan surfaces as a 404 via
  // `scans.getDetail`'s own throw. Reads only — redaction upheld by `servers.getPublic`. ─────────
  app.get("/api/reports/server/:scanId", async (request) => {
    const { scanId } = request.params as { scanId: string };
    const { models, client } = serverReportQuerySchema.parse(request.query);
    const scan = scans.getDetail(scanId);
    const server = servers.getPublic(scan.serverId);
    return createServerReport(scan, server, models ?? DEFAULT_HEATMAP_MODELS, client);
  });

  // ── Server report as a single Markdown document (the second export format). Same payload as the
  // HTML/PDF route above, serialized to one self-contained Markdown file with every tool listed (no
  // truncation) and colour replaced by bracket severity tags. `detail` (min severity) is applied at
  // serialization time — the HTML route filters client-side and ignores it. Redaction upheld by
  // `servers.getPublic`; UTF-8 declared so the document saves intact. ─────────────────────────────
  app.get("/api/reports/server/:scanId/markdown", async (request, reply) => {
    const { scanId } = request.params as { scanId: string };
    const { models, client, detail } = serverReportQuerySchema.parse(request.query);
    const scan = scans.getDetail(scanId);
    const server = servers.getPublic(scan.serverId);
    const report = createServerReport(scan, server, models ?? DEFAULT_HEATMAP_MODELS, client);
    reply.header("content-type", "text/markdown; charset=utf-8");
    reply.header(
      "content-disposition",
      `attachment; filename="mcp-token-footprint-server-${scan.id}.md"`,
    );
    return createServerMarkdownReport(report, detail);
  });

  // ── Run report (WP 4.2) — mirrors the scan routes for a finished testing run. The run record only
  // carries IDs, so resolve the enrichment (test + scenario) before building the report. A missing run
  // surfaces as a 404 via `runRepository.getRun`'s own throw (central error handler); we don't
  // hand-roll an error body. Auto-Rating WP 1.5 (AR1): also compose the rating/grades block via the
  // SAME `RunReportService` the `GET /api/runs/:id/report` endpoint uses, so the export and the endpoint
  // can never disagree — additive (existing fields unchanged). Qlik Answers Phase 5 (WP 5.6): apply the
  // SAME read-time `deriveLegacyAnswerStep` projection `GET /api/runs/:id` uses (`testing/routes.ts`) so
  // a LEGACY qlik_answers run (rawResponse captured, no blocks/reasoningSections yet) reports the Phase 5
  // rendering fields too — no migration, no row rewrite. A non-qlik / post-5.2 run maps to itself
  // (byte-identical). ─────────────────────────────────────────────────────────────────────────────────
  app.get("/api/reports/run/:id/json", async (request) => {
    const { id } = request.params as { id: string };
    const run = withDerivedAnswerSteps(runRepository.getRun(id));
    const test = testService.get(run.testId);
    const scenario = scenarioService.get(run.scenarioId);
    return createRunJsonReport(run, { test, scenario }, runReports.compose(id));
  });

  app.get("/api/reports/run/:id/markdown", async (request, reply) => {
    const { id } = request.params as { id: string };
    const run = withDerivedAnswerSteps(runRepository.getRun(id));
    const test = testService.get(run.testId);
    const scenario = scenarioService.get(run.scenarioId);
    reply.header("content-type", "text/markdown; charset=utf-8");
    reply.header(
      "content-disposition",
      `attachment; filename="mcp-token-footprint-run-${run.id}.md"`,
    );
    return createRunMarkdownReport(run, { test, scenario }, runReports.compose(id));
  });

  // ── Suite-run report (WP 3.4) — mirrors the run report for a suite mass-run: the frozen config
  // snapshot, the derived aggregates (exec + judge cost), per-cell status/score, and the quality×cost
  // analytics (the same payload as GET /api/suite-runs/:id/analytics). `?grader=` selects the score
  // dimension (default = primary-grader priority). A missing suite run surfaces as a 404 via
  // `suiteRunRepository.getRun`'s own throw. ────────────────────────────────────────────────────────
  app.get("/api/reports/suite-run/:id/json", async (request) => {
    const { id } = request.params as { id: string };
    const { grader, embed } = suiteRunReportQuerySchema.parse(request.query);
    const suiteRun = suiteRunRepository.getRun(id);
    const data = collectSuiteRunReportData(
      suiteReportDeps,
      suiteRun,
      parseGraderQuery(grader),
      embed,
    );
    return createSuiteRunJsonReport(suiteRun, data);
  });

  app.get("/api/reports/suite-run/:id/markdown", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { grader, embed } = suiteRunReportQuerySchema.parse(request.query);
    const suiteRun = suiteRunRepository.getRun(id);
    const data = collectSuiteRunReportData(
      suiteReportDeps,
      suiteRun,
      parseGraderQuery(grader),
      embed,
    );
    reply.header("content-type", "text/markdown; charset=utf-8");
    reply.header(
      "content-disposition",
      `attachment; filename="mcp-token-footprint-suite-run-${suiteRun.id}.md"`,
    );
    return createSuiteRunMarkdownReport(suiteRun, data);
  });

  // ── Scheduled digest report (WP5.5, D-OB22) — mirrors the run/suite-run report `GET …/{json,
  // markdown}` shape exactly. `GET /api/reports/digest` lists recent digests (optionally by cadence);
  // `POST /api/reports/digest/generate?window=daily|weekly` generates one on demand (never `late`);
  // the schedule GET/PUT persists the off|daily|weekly + hour config the scheduler tick reads
  // (`watch/scheduler.ts`'s additive `onDigest` seam, wired in index.ts). ─────────────────────────────
  app.get("/api/reports/digest", async (request) => {
    const { kind, limit } = digestListQuerySchema.parse(request.query);
    return digestRepository.list({ kind, limit });
  });

  app.get("/api/reports/digest/schedule", async () => digestSchedule.getSchedule());

  app.put("/api/reports/digest/schedule", async (request) => {
    const schedule = digestScheduleSchema.parse(request.body);
    return digestSchedule.setSchedule(schedule);
  });

  app.post("/api/reports/digest/generate", async (request) => {
    const { window } = digestGenerateQuerySchema.parse(request.query);
    const report = digestSchedule.generateOnDemand(window);
    return { id: report.id, windowKind: report.windowKind, late: report.late };
  });

  app.get("/api/reports/digest/:id/json", async (request) => {
    const { id } = request.params as { id: string };
    return digestRepository.get(id);
  });

  app.get("/api/reports/digest/:id/markdown", async (request, reply) => {
    const { id } = request.params as { id: string };
    const report = digestRepository.get(id);
    reply.header("content-type", "text/markdown; charset=utf-8");
    reply.header(
      "content-disposition",
      `attachment; filename="mcp-token-footprint-digest-${report.id}.md"`,
    );
    return createDigestMarkdownReport(report);
  });
}

/**
 * Qlik Answers Phase 5 (WP 5.6, D-QA8): apply {@link deriveLegacyAnswerStep} to every step of a run
 * before it reaches the (pure, DB-free) report builders — mirrors the exact `detail.steps.map(...)`
 * projection `GET /api/runs/:id` already applies (`../testing/routes.ts`). A step that isn't a legacy
 * qlik_answers answer (no `rawResponse`, already carries `blocks`, or isn't `qlik_answers` at all) maps
 * to itself, so a non-qlik run's report stays byte-identical to before this WP.
 */
function withDerivedAnswerSteps(run: RunDetail): RunDetail {
  return { ...run, steps: run.steps.map(deriveLegacyAnswerStep) };
}
