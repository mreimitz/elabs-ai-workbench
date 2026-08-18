import {
  type AppFeatureFlagsResponse,
  appFeatureFlagsUpdateSchema,
  FEATURE_DISABLED_ERROR_CODE,
} from "@mcp-token-footprint/shared";
import type { FastifyInstance } from "fastify";
import { httpError } from "../utils/errors.js";
import type { FeatureFlagsService } from "./service.js";

/**
 * Settings › Features — the operator's on/off switches for whole app capabilities.
 *
 * `GET  /api/features` → `{ flags }` (every registered feature, defaults filled in).
 * `PUT  /api/features` → apply a PARTIAL patch (`{ assistant: false }`), returns the new `{ flags }`.
 *
 * Plus the **guard**: one `onRequest` hook that rejects any `/api/...` request owned by a DISABLED
 * feature with `403 { error, code: "feature_disabled" }`. Hiding the UI is not an off-switch on its
 * own — a stale browser tab, a bookmarked deep link, or a direct `curl` would still start assistant
 * sessions and spend provider tokens. The guard is what makes "off" mean off.
 *
 * The hook is registered on the ROOT instance (these routes are mounted with a direct call, not an
 * encapsulated plugin), so it sees every route regardless of registration order — including routes
 * registered after this one. `/api/features` is never covered by a feature's prefixes, so the switch
 * can always be flipped back on.
 */
export function registerFeatureRoutes(app: FastifyInstance, features: FeatureFlagsService): void {
  app.addHook("onRequest", async (request) => {
    const blocked = features.blockingFeature(request.url);
    if (!blocked) return;
    throw httpError(
      403,
      `The ${blocked.label} feature is turned off. Turn it back on in Settings › Features.`,
      FEATURE_DISABLED_ERROR_CODE,
    );
  });

  app.get("/api/features", async (): Promise<AppFeatureFlagsResponse> => ({
    flags: features.getFlags(),
  }));

  app.put("/api/features", async (request): Promise<AppFeatureFlagsResponse> => {
    const patch = appFeatureFlagsUpdateSchema.parse(request.body ?? {});
    return { flags: features.setFlags(patch) };
  });
}
