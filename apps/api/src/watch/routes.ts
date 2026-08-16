// Observability — watch-rule CRUD + audit + windowed-preview routes (roadmap/observability/, WP4.1 +
// WP4.2, D-OB19/D-OB21).
//
//   GET/POST   /api/watch-rules
//   POST       /api/watch-rules/preview       (WP4.2 — score a window config against history; no save)
//   GET/PATCH/DELETE /api/watch-rules/:id
//   GET        /api/watch-rules/:id/events    (the append-only audit log)
//
// Thin: validate the body with the shared zod (a bad filter/action → ZodError → 400 via the central
// handler), then delegate to {@link WatchRuleRepository} / the windowed {@link WatchWindowEvaluator}. A
// webhook action's plaintext `url` is consumed here on the wire but NEVER returned — the repository
// encrypts it into the secret store and the response carries only the opaque `secretRef`. No route
// spawns anything or touches a live run.

import {
  watchRuleInputSchema,
  watchRulePatchSchema,
  watchWindowPreviewRequestSchema,
} from "@mcp-token-footprint/shared";
import type { FastifyInstance } from "fastify";
import { httpError } from "../utils/errors.js";
import type { WatchWindowEvaluator } from "./engine.js";
import type { WatchRuleRepository } from "./repository.js";

export async function registerWatchRoutes(
  app: FastifyInstance,
  rules: WatchRuleRepository,
  /** The windowed evaluator drives the historical preview (WP4.2). Optional so WP4.1-only callers/tests
   *  that don't need the preview can omit it (the route is registered only when it is supplied). */
  evaluator?: WatchWindowEvaluator,
): Promise<void> {
  app.get("/api/watch-rules", async () => rules.list());

  // WP4.2 — historical preview. Registered BEFORE `/:id` (different method, so no collision) only when
  // an evaluator is supplied. Rejects `q` (FTS is not part of the metrics aggregation — never a silent
  // half-apply, mirroring `GET /api/metrics/runs`).
  if (evaluator) {
    app.post("/api/watch-rules/preview", async (request) => {
      const body = watchWindowPreviewRequestSchema.parse(request.body);
      if (body.filter.q !== undefined) {
        throw httpError(400, "`q` (full-text search) is not supported by the windowed preview");
      }
      const nowMs = body.asOf !== undefined ? Date.parse(body.asOf) : Date.now();
      return evaluator.preview(body.filter, body.window, body.windows ?? 0, nowMs);
    });
  }

  app.get("/api/watch-rules/:id", async (request) => {
    const { id } = request.params as { id: string };
    return rules.get(id);
  });

  app.post("/api/watch-rules", async (request, reply) => {
    const input = watchRuleInputSchema.parse(request.body);
    const rule = rules.create(input);
    return reply.code(201).send(rule);
  });

  app.patch("/api/watch-rules/:id", async (request) => {
    const { id } = request.params as { id: string };
    const patch = watchRulePatchSchema.parse(request.body);
    return rules.update(id, patch);
  });

  app.delete("/api/watch-rules/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    rules.delete(id);
    return reply.code(204).send();
  });

  app.get("/api/watch-rules/:id/events", async (request) => {
    const { id } = request.params as { id: string };
    return rules.listEvents(id);
  });
}
