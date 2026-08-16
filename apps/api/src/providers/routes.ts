import type { FastifyInstance } from "fastify";
import {
  providerCredentialInputSchema,
  providerCredentialUpdateSchema,
} from "@mcp-token-footprint/shared";
import type { ProviderService } from "./service.js";
import type { SubscriptionModelSource } from "./subscription-models.js";

export async function registerProviderRoutes(
  app: FastifyInstance,
  providers: ProviderService,
  // The LIVE Claude-subscription roster resolver (roadmap/claude-subscription/ follow-up), threaded from
  // `index.ts` DI (mirrors the `fetchImpl` injectable-seam style). Optional so existing callers/tests
  // construct the routes unchanged; when absent, a `claude_subscription` credential falls back to the
  // static roster inside `listModels`.
  subscriptionModels?: SubscriptionModelSource,
) {
  app.get("/api/providers", async () => providers.list());

  // The live model roster for one credential, fetched from the provider's own API — drives the
  // scenario model picker. Returns only non-secret model ids/labels; never the key. A 404 (unknown
  // id) or upstream error flows through the central error handler.
  app.get("/api/providers/:id/models", async (request) => {
    const { id } = request.params as { id: string };
    const models = await providers.listModels(id, subscriptionModels);
    return { models, source: "provider" as const };
  });

  app.post("/api/providers", async (request, reply) => {
    const input = providerCredentialInputSchema.parse(request.body);
    const credential = providers.create(input);
    return reply.code(201).send(credential);
  });

  app.put("/api/providers/:id", async (request) => {
    const { id } = request.params as { id: string };
    const update = providerCredentialUpdateSchema.parse(request.body);
    return providers.update(id, update);
  });

  app.delete("/api/providers/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    providers.delete(id);
    return reply.code(204).send();
  });
}
