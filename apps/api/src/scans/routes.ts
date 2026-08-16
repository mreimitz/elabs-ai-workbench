import type { FastifyInstance } from "fastify";
import {
  promptGetRequestSchema,
  resourceReadRequestSchema,
  scanRequestSchema,
  toolCallRequestSchema,
} from "@mcp-token-footprint/shared";
import type { ScanRepository } from "./repository.js";
import type { ScanService } from "./service.js";

export async function registerScanRoutes(
  app: FastifyInstance,
  scans: ScanRepository,
  scanService: ScanService,
) {
  app.post("/api/servers/:id/scan", async (request) => {
    const { id } = request.params as { id: string };
    const { tokenProfile } = scanRequestSchema.parse(request.body ?? {});
    return scanService.runScan(id, tokenProfile);
  });

  // Lightweight connectivity preflight (connect → close, no discovery) for the web reauth gate's
  // throttled check. Bodyless, like POST /api/servers/:id/test.
  app.post("/api/servers/:id/connectivity", async (request) => {
    const { id } = request.params as { id: string };
    return scanService.checkConnectivity(id);
  });

  app.post("/api/servers/:id/tools/:toolName/call", async (request) => {
    const { id, toolName } = request.params as { id: string; toolName: string };
    const { arguments: args, tokenProfile } = toolCallRequestSchema.parse(request.body ?? {});
    return scanService.callTool(id, decodeURIComponent(toolName), args, tokenProfile);
  });

  app.post("/api/servers/:id/resources/read", async (request) => {
    const { id } = request.params as { id: string };
    const { uri, tokenProfile } = resourceReadRequestSchema.parse(request.body ?? {});
    return scanService.readResource(id, uri, tokenProfile);
  });

  app.post("/api/servers/:id/prompts/:name/get", async (request) => {
    const { id, name } = request.params as { id: string; name: string };
    const { arguments: args, tokenProfile } = promptGetRequestSchema.parse(request.body ?? {});
    return scanService.getPrompt(id, decodeURIComponent(name), args, tokenProfile);
  });

  app.get("/api/scans", async () => scans.listSummaries());

  app.get("/api/scans/:id", async (request) => {
    const { id } = request.params as { id: string };
    return scans.getDetail(id);
  });

  // Delete a scan (cascades to its tool/resource/prompt scans + events). Returns what was removed so
  // the UI can confirm the cascade. 404 if unknown (repository throws a 404 httpError).
  app.delete("/api/scans/:id", async (request) => {
    const { id } = request.params as { id: string };
    return scans.delete(id);
  });

  app.get("/api/servers/:id/scans", async (request) => {
    const { id } = request.params as { id: string };
    return scans.listSummariesByServer(id);
  });

  app.get("/api/servers/:id/latest-scan", async (request, reply) => {
    const { id } = request.params as { id: string };
    const scan = scans.getLatestForServer(id);
    if (!scan) return reply.code(404).send({ error: "No scans found for server" });
    return scan;
  });
}
