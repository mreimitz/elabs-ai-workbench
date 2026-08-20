// The security-posture endpoint (roadmap/security-posture/, WP 1.2):
// `GET /api/scans/:scanId/security` → `SecurityReport`.
//
// Thin, per the API convention: read the param, delegate, let the central error handler format
// anything thrown (the scan repository's 404 for an unknown id, the service's D-SP10 400 for a
// non-`success` scan). Read-only — it opens no MCP connection, runs no scan, writes nothing,
// persists nothing (D-SP8) and returns no secret value.
//
// The one thing this file adds on top of the service is a LOGGER for a rule that threw on a malformed
// tool definition. The analyzer is pure by construction (D-SP7) and so has no logger of its own; the
// route is the first layer that has one, so it passes a callback down rather than letting a swallowed
// exception become a blind spot nobody can see.

import type { FastifyInstance } from "fastify";
import { type SecurityAnalyzerPorts, analyzeScan } from "./service.js";

export async function registerSecurityRoutes(app: FastifyInstance, ports: SecurityAnalyzerPorts) {
  app.get("/api/scans/:scanId/security", async (request) => {
    const { scanId } = request.params as { scanId: string };
    return analyzeScan(
      {
        ...ports,
        onRuleError: (ruleId, error) => {
          request.log.warn(
            { ruleId, scanId, err: error },
            "security rule threw on a malformed tool definition; it contributed no finding",
          );
        },
      },
      scanId,
    );
  });
}
