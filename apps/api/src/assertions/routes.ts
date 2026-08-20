// The CI assertions endpoint (planning/Roadmap/RM-08-ci/, WP 1.3): `POST /api/assertions/evaluate`.
//
// Thin route, per the API convention: parse the shared zod body, delegate to the engine, let the
// central error handler format anything thrown (`ZodError` → 400; `httpError(400, …)` → 400). It
// reads persisted scans and nothing else — no MCP connection, no scan, no secret, no write, no
// migration.
//
// **D-C10 — this is a POST that only reads, and WP M.2 has now said so on the wire.** WP 1.1's guard
// mapped scopes COARSELY by HTTP method (`requiredScopesForMethod`: safe methods need `read`, unsafe
// methods need an execute scope), so a REMOTE caller with a `read`-only token used to be refused here
// even though nothing is written. Carving an exception into `requiredScopesForMethod` was explicitly
// rejected at the time; WP M.2 instead added the per-route table this endpoint now sits in —
// `API_TOKEN_ROUTE_SCOPES` in `packages/shared/src/api-tokens.ts` maps
// `POST /api/assertions/evaluate → read`, so an assert-only token needs nothing but `read`. A
// loopback caller still needs no token at all (D-C2).

import { assertionEvaluateSchema } from "@mcp-token-footprint/shared";
import type { FastifyInstance } from "fastify";
import { type AssertionPorts, evaluateAssertions } from "./service.js";

export async function registerAssertionRoutes(app: FastifyInstance, ports: AssertionPorts) {
  app.post("/api/assertions/evaluate", async (request) => {
    const body = assertionEvaluateSchema.parse(request.body);
    return evaluateAssertions(ports, body);
  });
}
