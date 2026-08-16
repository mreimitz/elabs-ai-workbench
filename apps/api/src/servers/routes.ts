import type { FastifyInstance } from "fastify";
import {
  serverConfigInputSchema,
  serverConfigUpdateSchema,
  serverProbeRequestSchema,
  type ServerAuthInput,
  type ServerProbeResponse,
} from "@mcp-token-footprint/shared";
import { callTool, discoverTools } from "../mcp/client.js";
import { isAuthRequiredError, isOAuthHttpServer } from "../mcp/auth-error.js";
import { formatConnectionError } from "../mcp/connection-error.js";
import type { OAuthService } from "../oauth/service.js";
import type { LinkedAuthResolver } from "../providers/linked-auth.js";
import type { ScanService } from "../scans/service.js";
import { httpError, toErrorMessage } from "../utils/errors.js";
import {
  AssetProxyError,
  assetCacheControl,
  fetchAssetBytes,
  MAX_ASSET_BYTES,
  parseAssetResult,
  resolveAssetFetchUrl,
} from "./asset-proxy.js";
import { probeRequestAnswers, probeServerAnswers } from "./qlik-answers-probe.js";
import type { InternalServerConfig, ServerRepository } from "./repository.js";

// Kept as a named export (re-exported from the shared formatter) for backward-compat with callers
// and tests that import `formatProbeErrorMessage` from this module.
export const formatProbeErrorMessage = formatConnectionError;

export async function registerServerRoutes(
  app: FastifyInstance,
  servers: ServerRepository,
  scanService: ScanService,
  oauthService: OAuthService,
  linkedAuth: LinkedAuthResolver,
) {
  app.get("/api/servers", async () => servers.list());

  app.post("/api/servers/probe", async (request): Promise<ServerProbeResponse> => {
    const input = serverProbeRequestSchema.parse(request.body);
    const startedAt = Date.now();

    try {
      const result = await discoverTools(
        {
          id: "probe",
          name: input.name?.trim() || new URL(input.url).hostname,
          transport: "streamable_http",
          url: input.url,
          headers: headersFromAuth(input.auth),
          args: [],
          env: {},
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          authType: input.auth?.type ?? "none",
        },
        () => undefined,
      );

      // Qlik Answers (WP 2.1) — when the probed URL looks like a Qlik Cloud tenant, fold in the free,
      // list-only assistants availability check using the probe's OWN supplied auth (the server isn't
      // saved yet). `undefined` for any non-Qlik URL, so every other probe is unchanged. List-only by
      // construction — a probe never consumes a question.
      const qlikTenant = await probeRequestAnswers(input.url, input.auth);
      return {
        ok: true,
        url: input.url,
        authRequired: false,
        oauthAvailable: false,
        tools: result.tools.length,
        durationMs: Date.now() - startedAt,
        message: `Connection OK. ${result.tools.length} tools listed.`,
        authMethods: [input.auth?.type ?? "none"],
        ...(qlikTenant ? { qlikTenant } : {}),
      };
    } catch (error) {
      const authRequired = isAuthRequiredError(error);
      const oauthAvailable = authRequired ? await oauthService.hasOAuthMetadata(input.url) : false;
      return {
        ok: false,
        url: input.url,
        authRequired,
        oauthAvailable,
        tools: 0,
        durationMs: Date.now() - startedAt,
        message: authRequired ? "Authentication is required." : "Connection failed.",
        authMethods: authRequired
          ? ["bearer", "api_key", ...(oauthAvailable ? (["oauth"] as const) : [])]
          : [],
        errorMessage: formatProbeErrorMessage(error, input.url),
      };
    }
  });

  app.post("/api/servers", async (request, reply) => {
    const input = serverConfigInputSchema.parse(request.body);
    const server = servers.create(input);
    return reply.code(201).send(server);
  });

  app.get("/api/servers/:id", async (request) => {
    const { id } = request.params as { id: string };
    return servers.getPublic(id);
  });

  app.put("/api/servers/:id", async (request) => {
    const { id } = request.params as { id: string };
    const update = serverConfigUpdateSchema.parse(request.body);
    return servers.update(id, update);
  });

  app.delete("/api/servers/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    servers.delete(id);
    return reply.code(204).send();
  });

  app.post("/api/servers/:id/test", async (request) => {
    const { id } = request.params as { id: string };
    return scanService.testServer(id);
  });

  /**
   * Qlik Answers availability probe (WP 2.1) for a SAVED server — detect (URL-based) then, only for a
   * Qlik tenant with resolvable OWN credentials, run the LIST-ONLY `GET /api/v1/assistants` check. Thin:
   * delegates to `probeServerAnswers`, which is list-only BY CONSTRUCTION (it can never invoke/stream a
   * question). Returns the redacted `QlikTenantProbe` (origin + booleans + a count) — never a secret.
   * A 401/403 from the tenant → `needsOwnKey:true` (the wizard offers an API-key fallback). An unknown
   * server id 404s (via `getInternal` inside the helper).
   */
  app.post("/api/servers/:id/qlik/answers-probe", async (request) => {
    const { id } = request.params as { id: string };
    return probeServerAnswers({ servers, auth: linkedAuth }, id);
  });

  /**
   * Binary proxy for a managed asset returned by the Asset Management MCP tools. The model only
   * writes asset PATHS (text), so the browser can't render the image — it lives behind the MCP
   * server's base URL + auth + CORS. This endpoint resolves the path → bytes server-side:
   *   1. `assets_get { path }` over a one-shot MCP connection → `{ asset: { url, mime, size, … } }`.
   *   2. Validate it is an `image/*` under the size cap, and resolve the asset's OWN returned url
   *      against the MCP endpoint origin (never an arbitrary host — see asset-proxy.ts).
   *   3. `fetch` it with the server's auth headers and stream the bytes back as the asset's mime.
   * Any failure (not streamable_http, not found, not an image, fetch error) → 404 with a small JSON
   * error (the central error handler shape). Never echoes secrets; stays inside the runtime boundary.
   */
  app.get("/api/servers/:id/assets/file", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { path } = (request.query ?? {}) as { path?: string };
    if (!path || typeof path !== "string") {
      throw httpError(400, "Missing asset path");
    }

    const config = servers.getInternal(id);
    if (config.transport !== "streamable_http" || !config.url) {
      throw httpError(404, "Asset files are only available for streamable HTTP servers");
    }

    try {
      const raw = await callTool(
        config,
        "assets_get",
        { path },
        { authProvider: authProviderFor(config) },
      );
      const asset = parseAssetResult(raw);
      const fetchUrl = resolveAssetFetchUrl(asset, config.url);

      // SSRF + credential-leak guard (M1): pin to the MCP origin, refuse every 3xx redirect (so the
      // stored auth header is never replayed off-origin), and abort a hanging upstream. See
      // asset-proxy.ts:fetchAssetBytes.
      const response = await fetchAssetBytes(fetchUrl, config.headers ?? {});
      if (!response.ok || !response.body) {
        throw new AssetProxyError(404, "Asset could not be fetched");
      }

      const declaredLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(declaredLength) && declaredLength > MAX_ASSET_BYTES) {
        throw new AssetProxyError(413, "Asset is too large to proxy");
      }

      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.byteLength > MAX_ASSET_BYTES) {
        throw new AssetProxyError(413, "Asset is too large to proxy");
      }

      reply.header("content-type", asset.mime);
      reply.header("cache-control", assetCacheControl());
      return reply.send(bytes);
    } catch (error) {
      if (error instanceof AssetProxyError) {
        return reply.code(error.statusCode).send({ error: error.message });
      }
      // Any MCP/connection/parse failure degrades to a 404 (never echo the raw error / secrets).
      request.log.warn({ err: toErrorMessage(error), serverId: id }, "Asset proxy failed");
      return reply.code(404).send({ error: "Asset not found" });
    }
  });

  /** OAuth provider only for streamable-HTTP + oauth servers (mirrors ScanService.getAuthProvider). */
  function authProviderFor(config: InternalServerConfig) {
    if (!isOAuthHttpServer(config)) return undefined;
    return oauthService.createProvider(config.id);
  }
}

function headersFromAuth(auth: ServerAuthInput | undefined): Record<string, string> {
  if (!auth || auth.type === "none" || auth.type === "oauth") return {};
  if (auth.type === "bearer")
    return auth.token?.trim() ? { Authorization: `Bearer ${auth.token.trim()}` } : {};
  if (auth.type === "api_key")
    return auth.key?.trim() ? { [auth.headerName]: auth.key.trim() } : {};
  return auth.headers ?? {};
}
