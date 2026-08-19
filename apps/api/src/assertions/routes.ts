// The CI assertions endpoint (roadmap/ci/, WP 1.3): `POST /api/assertions/evaluate`.
//
// Thin route, per the API convention: parse the shared zod body, delegate to the engine, let the
// central error handler format anything thrown (`ZodError` → 400; `httpError(400, …)` → 400). It
// reads persisted scans and nothing else — no MCP connection, no scan, no secret, no write, no
// migration.
//
// **D-C10 — this is a POST that only reads, and that has a consequence we chose NOT to paper over.**
// WP 1.1's guard maps scopes COARSELY by HTTP method (`requiredScopesForMethod`: safe methods need
// `read`, unsafe methods need an execute scope). So a REMOTE caller with a `read`-only token is
// refused here even though nothing is written; it needs one of the execute scopes (`scan:run` is the
// natural one for a footprint pipeline, which will already hold it to run the scan this evaluates).
// A loopback caller needs no token at all (D-C2). Carving an exception into
// `requiredScopesForMethod` or the guard was explicitly rejected: WP 1.1 deferred per-route mapping
// to WP M.2 and that file is security-critical, so the ledger records
// `POST /api/assertions/evaluate → read` as mapping work for WP M.2 instead.

import { assertionEvaluateSchema } from "@mcp-token-footprint/shared";
import type { FastifyInstance } from "fastify";
import { type AssertionPorts, evaluateAssertions } from "./service.js";

export async function registerAssertionRoutes(app: FastifyInstance, ports: AssertionPorts) {
  app.post("/api/assertions/evaluate", async (request) => {
    const body = assertionEvaluateSchema.parse(request.body);
    return evaluateAssertions(ports, body);
  });
}
