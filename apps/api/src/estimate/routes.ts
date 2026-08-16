// UX overhaul WP 3.5 (G7, D-UX12) — `GET /api/estimate/run-plan`: the launcher's advisory cost
// preview. Thin route — parse the shared query schema, delegate to the service (DB + pricing behind
// the runtime boundary). Read-only; needs NO provider key; blocks nothing.

import type { FastifyInstance } from "fastify";
import { runPlanEstimateQuerySchema } from "@mcp-token-footprint/shared";
import { buildRunPlanEstimate, type EstimateDeps } from "./service.js";

export async function registerEstimateRoutes(app: FastifyInstance, deps: EstimateDeps) {
  app.get("/api/estimate/run-plan", async (request) => {
    const { testIds, environmentIds, repetitions } = runPlanEstimateQuerySchema.parse(
      request.query,
    );
    return buildRunPlanEstimate(deps, { testIds, environmentIds, repetitions });
  });
}
