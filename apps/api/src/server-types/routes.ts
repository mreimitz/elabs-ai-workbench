import type { FastifyInstance } from "fastify";
import { serverTypeInputSchema, serverTypeUpdateSchema } from "@mcp-token-footprint/shared";
import type { ServerTypeRepository } from "./repository.js";

/**
 * Server-type CRUD (planning/Roadmap/completed/RM-21-server-types WP 1.1). Thin routes over the repository; the central
 * error handler formats 400 (zod / unknown typeId), 404, and 409 (duplicate name).
 */
export async function registerServerTypeRoutes(
  app: FastifyInstance,
  serverTypes: ServerTypeRepository,
) {
  app.get("/api/server-types", async () => serverTypes.list());

  app.post("/api/server-types", async (request, reply) => {
    const input = serverTypeInputSchema.parse(request.body);
    return reply.code(201).send(serverTypes.create(input));
  });

  app.get("/api/server-types/:id", async (request) => {
    const { id } = request.params as { id: string };
    return serverTypes.get(id);
  });

  app.put("/api/server-types/:id", async (request) => {
    const { id } = request.params as { id: string };
    const update = serverTypeUpdateSchema.parse(request.body);
    return serverTypes.update(id, update);
  });

  app.delete("/api/server-types/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    serverTypes.delete(id);
    return reply.code(204).send();
  });
}
