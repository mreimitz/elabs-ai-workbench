// Observability — model pricing CRUD routes (planning/Roadmap/RM-17-observability/, WP2.6, D-OB22).
//
//   GET    /api/pricing          — list every entry (seed + user)
//   GET    /api/pricing/:id      — one entry
//   POST   /api/pricing          — create a user entry (regex compile-checked server-side)
//   PATCH  /api/pricing/:id      — patch a user entry (seed rows are read-only → 400)
//   DELETE /api/pricing/:id      — delete a user entry (seed rows are read-only → 400)
//
// Thin: validate the body with the shared zod (an invalid regex / negative price is a ZodError ->
// 400) then delegate to the repository (which re-compile-checks the effective regex and enforces the
// seed-read-only rule). No route touches secrets or spawns anything — a read/write over one table.

import { modelPricingInputSchema, modelPricingPatchSchema } from "@mcp-token-footprint/shared";
import type { FastifyInstance } from "fastify";
import type { PricingRepository } from "./pricing-repository.js";

export async function registerPricingRoutes(
  app: FastifyInstance,
  pricing: PricingRepository,
): Promise<void> {
  app.get("/api/pricing", async () => pricing.list());

  app.get("/api/pricing/:id", async (request) => {
    const { id } = request.params as { id: string };
    return pricing.get(id);
  });

  app.post("/api/pricing", async (request, reply) => {
    const input = modelPricingInputSchema.parse(request.body);
    return reply.code(201).send(pricing.create(input));
  });

  app.patch("/api/pricing/:id", async (request) => {
    const { id } = request.params as { id: string };
    const patch = modelPricingPatchSchema.parse(request.body);
    return pricing.update(id, patch);
  });

  app.delete("/api/pricing/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    pricing.delete(id);
    return reply.code(204).send();
  });
}
