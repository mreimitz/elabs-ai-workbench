// The advisor API (WP 1.2): `GET /api/advisor/report?scope=server|scenario|fleet&id=…`.
//
// Thin route, per the API convention: parse the shared zod query, delegate. Read-only — it opens no
// MCP connection, spawns nothing, needs no provider key, and touches no secret. The response is the
// shared `AdvisorReport`.

import { advisorReportQuerySchema } from "@mcp-token-footprint/shared";
import type { FastifyInstance } from "fastify";
import { createAdvisorContext, type AdvisorRepositories } from "./repository.js";
import { buildAdvisorReport } from "./service.js";

export async function registerAdvisorRoutes(app: FastifyInstance, deps: AdvisorRepositories) {
  app.get("/api/advisor/report", async (request) => {
    const query = advisorReportQuerySchema.parse(request.query);
    // A fresh context per request: the clock is read once, at the top of the report, so every
    // number in it belongs to the same instant.
    return buildAdvisorReport(createAdvisorContext(deps), query);
  });
}
