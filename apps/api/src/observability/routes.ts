// Observability — metrics + saved-view + human-feedback + custom-chart + review-rubric routes
// (planning/Roadmap/RM-17-observability/, WP1.2/WP1.4/WP1.5/WP2.7/WP4.5, D-OB13/D-OB14/D-OB15/D-OB22).
//
//   GET /api/metrics/runs?filter=<RunFilter>&from&to&bucket=hour|day|week&groupBy=…&measures=…
//   GET /api/metrics/scans?from&to&bucket=…&serverId=…
//   GET/POST /api/run-views, PATCH/DELETE /api/run-views/:id
//   GET/POST /api/runs/:id/feedback, DELETE /api/runs/:id/feedback/:feedbackId
//   GET/POST /api/dashboard-charts, GET/PATCH/DELETE /api/dashboard-charts/:id,
//     POST /api/dashboard-charts/:id/clone, POST /api/dashboard-charts/reorder
//   GET/POST /api/review-rubrics, GET/PATCH/DELETE /api/review-rubrics/:id
//
// Thin: validate the query/body with the shared zod + the shared `parseRunFilterFromQuery` helper (so
// the `?filter=` grammar is byte-identical to `GET /api/runs`), then delegate to the pure `metrics.ts`
// aggregation or the `views.ts`/`feedback.ts`/`dashboard-charts.ts`/`rubrics.ts` repositories. No route
// touches secrets or spawns anything; everything is a read/write over persisted rows. The WP4.5 review
// SURFACE itself (the run queue + keyboard flow) is web-only — every verdict it writes goes through the
// EXISTING `POST /api/runs/:id/feedback` route above, never a new endpoint.

import {
  dashboardChartInputSchema,
  dashboardChartPatchSchema,
  dashboardChartReorderInputSchema,
  metricsBucketSchema,
  parseRunFilterFromQuery,
  RunFilterError,
  runFeedbackInputSchema,
  runMetricsGroupBySchema,
  runMetricsMeasuresSchema,
  reviewRubricInputSchema,
  reviewRubricPatchSchema,
  runViewInputSchema,
  runViewPatchSchema,
} from "@mcp-token-footprint/shared";
import type { FastifyInstance } from "fastify";
import type { AppDatabase } from "../db/database.js";
import { DashboardChartRepository } from "./dashboard-charts.js";
import { RunFeedbackRepository } from "./feedback.js";
import { computeRunMetrics, computeScanMetrics } from "./metrics.js";
import { ReviewRubricRepository } from "./rubrics.js";
import { RunViewRepository } from "./views.js";

/** Split a comma-joined or repeated query value into a trimmed, de-duplicated, order-preserving list. */
function toList(value: unknown): string[] {
  const parts = (Array.isArray(value) ? value : [value])
    .filter((v): v is string => typeof v === "string")
    .flatMap((v) => v.split(","))
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
  return [...new Set(parts)];
}

function firstString(value: unknown): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  if (typeof v !== "string") return undefined;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export async function registerObservabilityRoutes(
  app: FastifyInstance,
  db: AppDatabase,
): Promise<void> {
  app.get("/api/metrics/runs", async (request) => {
    const query = (request.query ?? {}) as Record<string, unknown>;

    const filter = parseRunFilterFromQuery(query);
    // Full-text `q` is not enabled until WP1.3 (mirrors the runs feed) — reject rather than silently drop.
    if (filter.q !== undefined) {
      throw new RunFilterError("`q` (full-text search) is not enabled until WP1.3");
    }

    const bucket = metricsBucketSchema.parse(firstString(query.bucket) ?? "day");
    const groupByRaw = firstString(query.groupBy);
    const groupBy = groupByRaw !== undefined ? runMetricsGroupBySchema.parse(groupByRaw) : undefined;
    const measures = runMetricsMeasuresSchema.parse(toList(query.measures));
    const from = firstString(query.from);
    const to = firstString(query.to);

    return computeRunMetrics(db, { filter, from, to, bucket, groupBy, measures });
  });

  app.get("/api/metrics/scans", async (request) => {
    const query = (request.query ?? {}) as Record<string, unknown>;
    const bucket = metricsBucketSchema.parse(firstString(query.bucket) ?? "day");
    const from = firstString(query.from);
    const to = firstString(query.to);
    const serverId = firstString(query.serverId);

    return computeScanMetrics(db, { from, to, bucket, serverId });
  });

  // --- Saved views (WP1.4) — name + reuse a RunFilter; delete is HARD, never soft. ---
  const views = new RunViewRepository(db);

  app.get("/api/run-views", async () => views.list());

  app.get("/api/run-views/:id", async (request) => {
    const { id } = request.params as { id: string };
    return views.get(id);
  });

  app.post("/api/run-views", async (request, reply) => {
    const input = runViewInputSchema.parse(request.body);
    const view = views.create(input);
    return reply.code(201).send(view);
  });

  app.patch("/api/run-views/:id", async (request) => {
    const { id } = request.params as { id: string };
    const patch = runViewPatchSchema.parse(request.body);
    return views.update(id, patch);
  });

  app.delete("/api/run-views/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    views.delete(id);
    return reply.code(204).send();
  });

  // --- Human feedback (WP1.5, D-OB15) — score/note on a run or one of its steps. UPSERT keyed on
  // (run, step, key, source='human'); STRICTLY SEPARATE from grading (see the WP1.5 separation
  // regression test). The console UI that writes this is WP2.5; the review queue is WP4.5. ---
  const feedback = new RunFeedbackRepository(db);

  app.get("/api/runs/:id/feedback", async (request) => {
    const { id } = request.params as { id: string };
    return feedback.list(id);
  });

  app.post("/api/runs/:id/feedback", async (request, reply) => {
    const { id } = request.params as { id: string };
    const input = runFeedbackInputSchema.parse(request.body);
    const row = feedback.upsert(id, input);
    return reply.code(201).send(row);
  });

  app.delete("/api/runs/:id/feedback/:feedbackId", async (request, reply) => {
    const { id, feedbackId } = request.params as { id: string; feedbackId: string };
    feedback.delete(id, feedbackId);
    return reply.code(204).send();
  });

  // --- Custom chart composer (WP2.7, D-OB22) — user-defined charts on the Testing dashboard. Renders
  // ONLY what /api/metrics/* already returns (this module holds NO aggregation logic); same-unit
  // multi-measure is enforced by the shared zod on write (400 on a mixed-unit or invalid-filter
  // config). `reorder` is registered BEFORE `/:id` (a different, static path segment; Fastify's router
  // handles this fine either way, but the static-before-param ordering mirrors the watch-rules
  // `/preview` convention). ---
  const charts = new DashboardChartRepository(db);

  app.get("/api/dashboard-charts", async () => charts.list());

  app.post("/api/dashboard-charts/reorder", async (request) => {
    const body = dashboardChartReorderInputSchema.parse(request.body);
    return charts.reorder(body.orderedIds);
  });

  app.get("/api/dashboard-charts/:id", async (request) => {
    const { id } = request.params as { id: string };
    return charts.get(id);
  });

  app.post("/api/dashboard-charts", async (request, reply) => {
    const input = dashboardChartInputSchema.parse(request.body);
    const chart = charts.create(input);
    return reply.code(201).send(chart);
  });

  app.patch("/api/dashboard-charts/:id", async (request) => {
    const { id } = request.params as { id: string };
    const patch = dashboardChartPatchSchema.parse(request.body);
    return charts.update(id, patch);
  });

  app.post("/api/dashboard-charts/:id/clone", async (request, reply) => {
    const { id } = request.params as { id: string };
    const chart = charts.clone(id);
    return reply.code(201).send(chart);
  });

  app.delete("/api/dashboard-charts/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    charts.delete(id);
    return reply.code(204).send();
  });

  // --- Review rubrics (WP4.5, D-OB22) — a persisted, named checklist for structured human review.
  // The review SURFACE (run queue + keyboard flow) is web-only; every verdict it writes goes through
  // the EXISTING `POST /api/runs/:id/feedback` route above (source='human', key = the rubric key's own
  // name) — this repository holds NO feedback data, only the rubric definition. ---
  const rubrics = new ReviewRubricRepository(db);

  app.get("/api/review-rubrics", async () => rubrics.list());

  app.get("/api/review-rubrics/:id", async (request) => {
    const { id } = request.params as { id: string };
    return rubrics.get(id);
  });

  app.post("/api/review-rubrics", async (request, reply) => {
    const input = reviewRubricInputSchema.parse(request.body);
    const rubric = rubrics.create(input);
    return reply.code(201).send(rubric);
  });

  app.patch("/api/review-rubrics/:id", async (request) => {
    const { id } = request.params as { id: string };
    const patch = reviewRubricPatchSchema.parse(request.body);
    return rubrics.update(id, patch);
  });

  app.delete("/api/review-rubrics/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    rubrics.delete(id);
    return reply.code(204).send();
  });
}
