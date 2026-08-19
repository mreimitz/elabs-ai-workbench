import {
  type ApiTokenCreateResponse,
  type ApiTokenListResponse,
  apiTokenCreateSchema,
} from "@mcp-token-footprint/shared";
import type { FastifyInstance } from "fastify";
import { httpError } from "../utils/errors.js";
import type { ApiTokenService } from "./service.js";

/**
 * Service-token CRUD (roadmap/ci/ WP 1.1) — Settings › API tokens talks to exactly these three routes.
 *
 * `GET    /api/tokens`     → `{ tokens }` — redacted rows (prefix only; `ApiToken` has no secret field).
 * `POST   /api/tokens`     → `{ token, secret }` — **the only place the plaintext ever appears**.
 * `DELETE /api/tokens/:id` → `204`. Revocation is removal of the row: immediate, no tombstone.
 *
 * The guard (`guard.ts`) refuses a TOKEN-authenticated request to any of these with 403, so these
 * routes are reachable only by the unauthenticated local caller — the browser on the host. A token
 * may never mint or revoke another token.
 *
 * Thin by design: no logic here beyond validation and status codes.
 */
export function registerApiTokenRoutes(app: FastifyInstance, service: ApiTokenService): void {
  app.get("/api/tokens", async (): Promise<ApiTokenListResponse> => ({ tokens: service.list() }));

  app.post("/api/tokens", async (request, reply): Promise<ApiTokenCreateResponse> => {
    const input = apiTokenCreateSchema.parse(request.body ?? {});
    // NOTE: `request.body` is never logged here, and the response's `secret` is never logged either —
    // it exists only in this return value, on its way to the one-time reveal in the UI.
    reply.code(201);
    return service.create(input);
  });

  app.delete<{ Params: { id: string } }>("/api/tokens/:id", async (request, reply) => {
    if (!service.revoke(request.params.id)) {
      throw httpError(404, "No such service token.");
    }
    reply.code(204);
    return null;
  });
}
