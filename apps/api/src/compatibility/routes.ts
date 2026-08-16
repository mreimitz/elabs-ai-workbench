// MCP × Model compatibility routes (Phase 5, static MVP). Thin: parse the shared query schema, load
// the scan(s) from the DB, hand off to the engine. Reads only — no MCP/secret access.

import type { FastifyInstance } from "fastify";
import {
  compatibilityHeatmapQuerySchema,
  compatibilityTestsQuerySchema,
  type ScanDetail,
} from "@mcp-token-footprint/shared";
import type { ScanRepository } from "../scans/repository.js";
import type { RunRepository } from "../testing/run-repository.js";
import type { ScenarioService } from "../testing/scenario-service.js";
import { DEFAULT_HEATMAP_MODELS, getModel, listModelIds, listModelRefs } from "./dataset.js";
import { scoreCell } from "./runner.js";
import { runSessionLevel, sessionRunFromDetail } from "./session.js";
import {
  buildHeatmap,
  buildServerTestReport,
  buildToolFindings,
  buildToolTestReport,
} from "./service.js";

function loadScanOrNull(scans: ScanRepository, scanId: string): ScanDetail | null {
  try {
    return scans.getDetail(scanId);
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode === 404) return null;
    throw error;
  }
}

export async function registerCompatibilityRoutes(app: FastifyInstance, scans: ScanRepository) {
  // The dataset model roster (for the heatmap column picker).
  app.get("/api/compatibility/models", async () => ({ models: listModelRefs() }));

  // The heatmap for a scan: GET /api/scans/:scanId/heatmap?models=&view=&rollup=&client=&envScans=
  app.get("/api/scans/:scanId/heatmap", async (request, reply) => {
    const { scanId } = request.params as { scanId: string };
    const { models, view, rollup, client, envScans } = compatibilityHeatmapQuerySchema.parse(
      request.query,
    );

    const scan = loadScanOrNull(scans, scanId);
    if (!scan) return reply.code(404).send({ error: "Scan not found" });

    const envScanDetails = (envScans ?? [])
      .map((id) => loadScanOrNull(scans, id))
      .filter((s): s is ScanDetail => s !== null);

    return buildHeatmap(scan, models ?? DEFAULT_HEATMAP_MODELS, {
      view,
      rollup,
      client,
      envScans: envScanDetails,
    });
  });

  // Server-LEVEL test report for the "Tests" tab on a server: GET /api/scans/:scanId/tests?models=
  app.get("/api/scans/:scanId/tests", async (request, reply) => {
    const { scanId } = request.params as { scanId: string };
    const { models } = compatibilityTestsQuerySchema.parse(request.query);
    const scan = loadScanOrNull(scans, scanId);
    if (!scan) return reply.code(404).send({ error: "Scan not found" });
    return buildServerTestReport(scan, models ?? listModelIds());
  });

  // Tool-LEVEL test report for the "Tests" tab on a tool: GET /api/scans/:scanId/tools/:toolName/tests?models=
  app.get("/api/scans/:scanId/tools/:toolName/tests", async (request, reply) => {
    const { scanId, toolName } = request.params as { scanId: string; toolName: string };
    const { models } = compatibilityTestsQuerySchema.parse(request.query);
    const scan = loadScanOrNull(scans, scanId);
    if (!scan) return reply.code(404).send({ error: "Scan not found" });
    return buildToolTestReport(scan, toolName, models ?? listModelIds());
  });

  // Tool-level findings aggregated for the server Overview (byTest, with offending tools) + the
  // tool-list "Issues" column (byTool severity tally): GET /api/scans/:scanId/tool-findings?models=
  app.get("/api/scans/:scanId/tool-findings", async (request, reply) => {
    const { scanId } = request.params as { scanId: string };
    const { models } = compatibilityTestsQuerySchema.parse(request.query);
    const scan = loadScanOrNull(scans, scanId);
    if (!scan) return reply.code(404).send({ error: "Scan not found" });
    return buildToolFindings(scan, models ?? listModelIds());
  });
}

/**
 * Session-level (live-run) compatibility (WP 5.6). Thin: load the run + its scenario model, adapt the
 * persisted replay into the session-evaluator input, score the 8 `session` catalog tests. Reads only —
 * no MCP/secret access. 404 on an unknown run (the run repo throws a 404 `httpError`).
 */
export async function registerRunCompatibilityRoutes(
  app: FastifyInstance,
  runs: RunRepository,
  scenarios: ScenarioService,
) {
  // POST /api/runs/:runId/compatibility?client=  → session-level CompatibilityResult[] + the rolled cell.
  app.post("/api/runs/:runId/compatibility", async (request, reply) => {
    const { runId } = request.params as { runId: string };
    const { client } = (request.query ?? {}) as { client?: string };

    let detail: ReturnType<RunRepository["getRun"]>;
    try {
      detail = runs.getRun(runId); // throws a 404 httpError for an unknown run
    } catch (error) {
      if ((error as { statusCode?: number }).statusCode === 404) {
        return reply.code(404).send({ error: "Run not found" });
      }
      throw error;
    }

    const modelId = scenarios.get(detail.scenarioId).model;
    // Guard: a model not in the compatibility dataset would otherwise yield an empty result set that
    // scoreCell paints as a misleading green "compatible" cell. Surface it explicitly instead.
    if (!getModel(modelId)) {
      request.log.warn(
        { runId, modelId },
        "run model not in compatibility dataset; session compatibility unavailable",
      );
      return reply.code(422).send({
        error: "unknown_model",
        message: `Model "${modelId}" is not in the compatibility dataset, so session compatibility cannot be scored.`,
        modelId,
      });
    }
    const sessionRun = sessionRunFromDetail(detail);
    const results = runSessionLevel(sessionRun, modelId, { client });
    return { runId, modelId, results, cell: scoreCell(modelId, results) };
  });
}
