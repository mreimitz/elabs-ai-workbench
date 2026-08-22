import type { FastifyInstance } from "fastify";
import { renderDiagnosticsMarkdown } from "./markdown.js";
import { buildDiagnosticsBundle, type DiagnosticsPorts } from "./service.js";

/**
 * `GET /api/diagnostics{,/markdown}` — planning/Roadmap/RM-18-platform/ WP 1.3.
 *
 * Two renderings of ONE builder, mirroring the `/api/reports/**` `{json,markdown}` convention. The
 * Markdown route composes the bundle and hands it to `renderDiagnosticsMarkdown`, whose only
 * parameter is that payload — so the two formats are the same document and cannot drift into a
 * situation where only one of them is the tested one.
 *
 * Both are plain reads. They need no new service-token scope: `requiredScopesForMethod("GET")`
 * already answers `read`, exactly as it does for every other report route, and adding a rule to
 * `API_TOKEN_ROUTE_SCOPES` would only ever *relax* one. Nothing here writes, and nothing here is
 * behind a feature flag.
 */
export function registerDiagnosticsRoutes(app: FastifyInstance, ports: DiagnosticsPorts): void {
  app.get("/api/diagnostics", async () => buildDiagnosticsBundle(ports));

  app.get("/api/diagnostics/markdown", async (_request, reply) => {
    const bundle = buildDiagnosticsBundle(ports);
    reply.header("content-type", "text/markdown; charset=utf-8");
    reply.header(
      "content-disposition",
      'attachment; filename="mcp-token-footprint-diagnostics.md"',
    );
    return renderDiagnosticsMarkdown(bundle);
  });
}
