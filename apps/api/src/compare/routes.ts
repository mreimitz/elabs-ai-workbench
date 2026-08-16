// Cross-server / tool-level compare endpoint (north-star #4): `GET /api/compare?a=&b=&threshold=`.
// Thin route — parse the shared query schema, load both scans, hand off to buildComparison. Logic
// lives in service.ts / matching.ts (the runtime-boundary rule). Reads the DB only.

import type { FastifyInstance } from "fastify";
import { compareQuerySchema, DEFAULT_COMPARE_THRESHOLD } from "@mcp-token-footprint/shared";
import type { ScanDetail } from "@mcp-token-footprint/shared";
import type { ScanRepository } from "../scans/repository.js";
import { buildComparison } from "./service.js";

/**
 * Load a scan's detail, returning `null` for a missing id instead of throwing. The repository's
 * `getDetail`/`getSummary` throw `httpError(404, …)` for an unknown scan; we convert that one case
 * into `null` so the route can answer with the documented 404 body (mirrors the
 * `/api/servers/:id/latest-scan` pattern). Any other error propagates to the central handler.
 */
function loadScanOrNull(scans: ScanRepository, scanId: string): ScanDetail | null {
  try {
    return scans.getDetail(scanId);
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode === 404) return null;
    throw error;
  }
}

export async function registerCompareRoutes(app: FastifyInstance, scans: ScanRepository) {
  app.get("/api/compare", async (request, reply) => {
    const { a, b, threshold } = compareQuerySchema.parse(request.query);

    const scanA = loadScanOrNull(scans, a);
    if (!scanA) return reply.code(404).send({ error: "Scan not found" });

    const scanB = loadScanOrNull(scans, b);
    if (!scanB) return reply.code(404).send({ error: "Scan not found" });

    return buildComparison(scanA, scanB, threshold ?? DEFAULT_COMPARE_THRESHOLD);
  });
}
