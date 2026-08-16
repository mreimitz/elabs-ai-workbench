import type {
  ConnectivityResponse,
  PromptGetResult,
  QlikTenantProbe,
  ResourceReadResult,
  ServerTestResponse,
  TokenProfileId,
  ToolCallResult,
} from "@mcp-token-footprint/shared";
import { config } from "../config/env.js";
import {
  callTool as mcpCallTool,
  checkConnection,
  discoverTools,
  getPrompt as mcpGetPrompt,
  readResource as mcpReadResource,
} from "../mcp/client.js";
import { isAuthRequiredError, isOAuthHttpServer } from "../mcp/auth-error.js";
import { formatConnectionError } from "../mcp/connection-error.js";
import type { OAuthService } from "../oauth/service.js";
import { normalizePrompt, normalizeResource, normalizeTool } from "../mcp/normalize.js";
import { isLikelyQlikTenantUrl } from "../servers/qlik-detect.js";
import type { ServerRepository } from "../servers/repository.js";
import { getTokenCounter } from "../token-counting/profiles.js";

/**
 * Qlik Answers (WP 2.1) — a list-only tenant-assistants availability probe for a saved server, injected
 * (optional) so `ScanService` stays free of any tenant-auth/HTTP knowledge (the sensitive logic lives in
 * `servers/qlik-answers-probe.ts`, behind the runtime boundary). Only ever invoked for a Qlik-tenant
 * server (see {@link ScanService.checkConnectivity}); it can never consume a question — it is list-only
 * by construction.
 */
export type QlikTenantProber = (serverId: string) => Promise<QlikTenantProbe>;

/** One tool from a live {@link ScanService.listTools} — the lean subset the agent needs to call it. */
export type ListedTool = {
  name: string;
  description?: string;
  inputSchema?: unknown;
  annotations?: unknown;
};

/** The result of a live {@link ScanService.listTools} — the server's current invokable tool surface. */
export type ListToolsResult = {
  serverId: string;
  serverName: string;
  tools: ListedTool[];
};
import { jsonBytes } from "../utils/json.js";
import type {
  PromptScanInsert,
  ResourceScanInsert,
  ScanRepository,
  ToolScanInsert,
} from "./repository.js";

export class ScanService {
  constructor(
    private readonly servers: ServerRepository,
    private readonly scans: ScanRepository,
    private readonly oauth: OAuthService,
    private readonly qlikTenantProbe?: QlikTenantProber,
  ) {}

  async testServer(serverId: string): Promise<ServerTestResponse> {
    const server = this.servers.getInternal(serverId);
    const events: string[] = [];
    const startedAt = Date.now();

    try {
      const result = await discoverTools(
        server,
        (_level, message) => {
          events.push(message);
        },
        { authProvider: this.getAuthProvider(server) },
      );

      return {
        ok: true,
        serverId,
        tools: result.tools.length,
        durationMs: Date.now() - startedAt,
        events,
      };
    } catch (error) {
      return {
        ok: false,
        serverId,
        tools: 0,
        durationMs: Date.now() - startedAt,
        errorMessage: formatConnectionError(error, server.url),
        events,
        authRequired: isOAuthHttpServer(server) && isAuthRequiredError(error),
      };
    }
  }

  /**
   * Live `tools/list` for one server, normalized (name / description / input schema / annotations) —
   * the accurate "what can I call right now" surface. Used by the Assistant's `mcp_tools_list` tool so
   * the agent builds a valid `mcp_tool_call` against the CURRENT schema (a persisted scan can be stale
   * or absent). Reuses the same connection + auth-provider path as {@link testServer}/{@link callTool},
   * so it stays inside the runtime boundary (no secrets leave the API). Throws on a connection/auth
   * failure — the caller surfaces it (via `safeTool`); an oauth-http auth failure is recognizable via
   * {@link isAuthRequiredError}.
   */
  async listTools(serverId: string): Promise<ListToolsResult> {
    const server = this.servers.getInternal(serverId);
    const result = await discoverTools(server, () => {}, {
      authProvider: this.getAuthProvider(server),
    });
    return {
      serverId,
      serverName: server.name,
      tools: result.tools.map((raw) => {
        const tool = normalizeTool(raw);
        return {
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: tool.annotations,
        };
      }),
    };
  }

  /**
   * Lightweight connectivity preflight (connect → close, no discovery) used by the web reauth gate's
   * throttled check before using a server. A still-refreshable OAuth token passes silently (`ok`);
   * `authRequired` (only for oauth-http servers) means interactive reauth is needed. Non-auth
   * failures come back `ok:false, authRequired:false` so the gate ignores them (the real op surfaces
   * them with proper context).
   */
  async checkConnectivity(serverId: string): Promise<ConnectivityResponse> {
    const server = this.servers.getInternal(serverId);
    // Qlik Answers (WP 2.1) — for a Qlik-tenant server, fold in the list-only assistants availability
    // check (never consumes a question). Gated on the already-fetched URL so non-Qlik servers do NO
    // extra work and carry no `qlikTenant` field. Never throws (the prober degrades to not-available).
    const qlikTenant = isLikelyQlikTenantUrl(server.url)
      ? await this.qlikTenantProbe?.(serverId)
      : undefined;

    try {
      await checkConnection(server, { authProvider: this.getAuthProvider(server) });
      return {
        serverId,
        ok: true,
        authRequired: false,
        oauthAvailable: false,
        message: "Connection OK.",
        qlikTenant,
      };
    } catch (error) {
      const authRequired = isOAuthHttpServer(server) && isAuthRequiredError(error);
      const oauthAvailable =
        authRequired && server.url ? await this.oauth.hasOAuthMetadata(server.url) : false;
      return {
        serverId,
        ok: false,
        authRequired,
        oauthAvailable,
        message: authRequired ? "Authentication is required." : "Connection failed.",
        errorMessage: formatConnectionError(error, server.url),
        qlikTenant,
      };
    }
  }

  async runScan(serverId: string, tokenProfile: TokenProfileId = config.defaultTokenProfile) {
    const server = this.servers.getInternal(serverId);
    const scan = this.scans.createRunningScan(server.id, tokenProfile);
    await this.scans.addEvent(scan.id, "info", `Started scan for ${server.name}`);

    try {
      const discovery = await discoverTools(
        server,
        async (level, message) => {
          await this.scans.addEvent(scan.id, level, message);
        },
        { authProvider: this.getAuthProvider(server) },
      );
      const normalizedTools = discovery.tools.map(normalizeTool);
      const counter = getTokenCounter(tokenProfile);
      await this.scans.addEvent(scan.id, "info", `Counting tokens with ${counter.label}`);

      const countedTools: ToolScanInsert[] = [];
      for (const tool of normalizedTools) {
        const breakdown = await counter.countToolDefinition(tool);
        countedTools.push({
          toolName: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: tool.annotations,
          rawTool: tool.raw,
          contributionPercent: 0,
          ...breakdown,
        });
      }

      const totalTokens = countedTools.reduce((sum, tool) => sum + tool.totalTokens, 0);
      const averageTokensPerTool = countedTools.length > 0 ? totalTokens / countedTools.length : 0;
      const largestTool = countedTools.reduce<ToolScanInsert | null>(
        (largest, tool) => (!largest || tool.totalTokens > largest.totalTokens ? tool : largest),
        null,
      );

      const toolsWithContribution = countedTools.map((tool) => ({
        ...tool,
        contributionPercent: totalTokens > 0 ? (tool.totalTokens / totalTokens) * 100 : 0,
      }));

      // Resources + resource templates share one surface (distinguished by `kind`); contribution is
      // each row's share of the combined resource-token total. Definition footprint only — no reads.
      const normalizedResources = [
        ...discovery.resources.map((raw) => normalizeResource(raw, "resource")),
        ...discovery.resourceTemplates.map((raw) => normalizeResource(raw, "template")),
      ];
      const countedResources: ResourceScanInsert[] = [];
      for (const resource of normalizedResources) {
        const breakdown = await counter.countResourceDefinition(resource);
        countedResources.push({
          kind: resource.kind,
          uri: resource.uri,
          name: resource.name,
          description: resource.description,
          mimeType: resource.mimeType,
          rawResource: resource.raw,
          contributionPercent: 0,
          ...breakdown,
        });
      }

      const normalizedPrompts = discovery.prompts.map(normalizePrompt);
      const countedPrompts: PromptScanInsert[] = [];
      for (const prompt of normalizedPrompts) {
        const breakdown = await counter.countPromptDefinition(prompt);
        countedPrompts.push({
          promptName: prompt.name,
          description: prompt.description,
          arguments: prompt.arguments,
          rawPrompt: prompt.raw,
          contributionPercent: 0,
          ...breakdown,
        });
      }

      const totalResourceTokens = countedResources.reduce((sum, r) => sum + r.totalTokens, 0);
      const totalPromptTokens = countedPrompts.reduce((sum, p) => sum + p.totalTokens, 0);

      const resourcesWithContribution = countedResources.map((resource) => ({
        ...resource,
        contributionPercent:
          totalResourceTokens > 0 ? (resource.totalTokens / totalResourceTokens) * 100 : 0,
      }));
      const promptsWithContribution = countedPrompts.map((prompt) => ({
        ...prompt,
        contributionPercent:
          totalPromptTokens > 0 ? (prompt.totalTokens / totalPromptTokens) * 100 : 0,
      }));

      const totalResources = countedResources.filter((r) => r.kind === "resource").length;
      const totalResourceTemplates = countedResources.filter((r) => r.kind === "template").length;
      const largestResource = countedResources.reduce<ResourceScanInsert | null>(
        (largest, resource) =>
          !largest || resource.totalTokens > largest.totalTokens ? resource : largest,
        null,
      );
      const largestPrompt = countedPrompts.reduce<PromptScanInsert | null>(
        (largest, prompt) =>
          !largest || prompt.totalTokens > largest.totalTokens ? prompt : largest,
        null,
      );
      const largestResourceLabel = largestResource?.name ?? largestResource?.uri ?? null;

      // totalRawBytes extends to include the raw resource + prompt lists alongside tools/list, so the
      // payload-size figure reflects the FULL definition surface captured this scan (not tools only).
      // A capability the server doesn't advertise yields an `undefined` raw list — and
      // `jsonBytes(undefined)` throws (JSON.stringify(undefined) is not a string), so skip those:
      // an absent capability contributes 0 bytes.
      const rawListBytes = (list: unknown): number => (list === undefined ? 0 : jsonBytes(list));
      const totalRawBytes =
        rawListBytes(discovery.rawToolsList) +
        rawListBytes(discovery.rawResourcesList) +
        rawListBytes(discovery.rawResourceTemplatesList) +
        rawListBytes(discovery.rawPromptsList);

      this.scans.completeScan(
        scan.id,
        {
          totalTools: countedTools.length,
          totalTokens,
          totalRawBytes,
          averageTokensPerTool,
          largestToolName: largestTool?.toolName ?? null,
          largestToolTokens: largestTool?.totalTokens ?? 0,
          totalResources,
          totalResourceTemplates,
          totalPrompts: countedPrompts.length,
          totalResourceTokens,
          totalPromptTokens,
          largestResourceName: largestResourceLabel,
          largestResourceTokens: largestResource?.totalTokens ?? 0,
          largestPromptName: largestPrompt?.promptName ?? null,
          largestPromptTokens: largestPrompt?.totalTokens ?? 0,
        },
        toolsWithContribution,
        resourcesWithContribution,
        promptsWithContribution,
      );
      await this.scans.addEvent(scan.id, "info", "Scan completed");

      // Retention (issue #19): opt-in "keep last N scans per server". Disabled by default
      // (config.scanRetentionPerServer === 0). Never prunes the scan just written (it's the newest).
      if (config.scanRetentionPerServer > 0) {
        const pruned = this.scans.pruneServerScans(server.id, config.scanRetentionPerServer);
        if (pruned.length > 0) {
          await this.scans.addEvent(
            scan.id,
            "info",
            `Retention: pruned ${pruned.length} older scan(s), keeping the last ${config.scanRetentionPerServer}`,
          );
        }
      }

      return this.scans.getDetail(scan.id);
    } catch (error) {
      const message = formatConnectionError(error, server.url);
      this.scans.failScan(scan.id, message);
      await this.scans.addEvent(scan.id, "error", message);
      const detail = this.scans.getDetail(scan.id);
      if (isOAuthHttpServer(server) && isAuthRequiredError(error)) {
        return { ...detail, authRequired: true };
      }
      return detail;
    }
  }

  async callTool(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>,
    tokenProfile: TokenProfileId = config.defaultTokenProfile,
  ): Promise<ToolCallResult> {
    const server = this.servers.getInternal(serverId);
    const counter = getTokenCounter(tokenProfile);
    const startedAt = Date.now();
    const requestPayload = { name: toolName, arguments: args };
    const requestTokens = await counter.countJson(requestPayload);
    const requestBytes = jsonBytes(requestPayload);

    try {
      const raw = await mcpCallTool(server, toolName, args, {
        authProvider: this.getAuthProvider(server),
      });
      const result = (raw ?? {}) as {
        content?: unknown;
        structuredContent?: unknown;
        isError?: boolean;
      };
      const responsePayload = result.structuredContent ?? result.content ?? raw;
      const responseTokens = await counter.countJson(responsePayload);
      const responseBytes = jsonBytes(raw);
      return {
        toolName,
        isError: Boolean(result.isError),
        durationMs: Date.now() - startedAt,
        tokenProfile,
        requestTokens,
        requestBytes,
        responseTokens,
        responseBytes,
        content: result.content ?? null,
        structuredContent: result.structuredContent,
        raw,
      };
    } catch (error) {
      return {
        toolName,
        isError: true,
        durationMs: Date.now() - startedAt,
        tokenProfile,
        requestTokens,
        requestBytes,
        responseTokens: 0,
        responseBytes: 0,
        content: null,
        raw: null,
        errorMessage: formatConnectionError(error, server.url),
        authRequired: isOAuthHttpServer(server) && isAuthRequiredError(error),
      };
    }
  }

  async readResource(
    serverId: string,
    uri: string,
    tokenProfile: TokenProfileId = config.defaultTokenProfile,
  ): Promise<ResourceReadResult> {
    const server = this.servers.getInternal(serverId);
    const counter = getTokenCounter(tokenProfile);
    const startedAt = Date.now();
    const requestPayload = { uri };
    const requestTokens = await counter.countJson(requestPayload);
    const requestBytes = jsonBytes(requestPayload);

    try {
      const raw = await mcpReadResource(server, uri, {
        authProvider: this.getAuthProvider(server),
      });
      const result = (raw ?? {}) as { contents?: unknown };
      const responsePayload = result.contents ?? raw;
      const responseTokens = await counter.countJson(responsePayload);
      const responseBytes = jsonBytes(raw);
      return {
        uri,
        isError: false,
        durationMs: Date.now() - startedAt,
        tokenProfile,
        requestTokens,
        requestBytes,
        responseTokens,
        responseBytes,
        contents: result.contents ?? null,
        raw,
      };
    } catch (error) {
      return {
        uri,
        isError: true,
        durationMs: Date.now() - startedAt,
        tokenProfile,
        requestTokens,
        requestBytes,
        responseTokens: 0,
        responseBytes: 0,
        contents: null,
        raw: null,
        errorMessage: formatConnectionError(error, server.url),
        authRequired: isOAuthHttpServer(server) && isAuthRequiredError(error),
      };
    }
  }

  async getPrompt(
    serverId: string,
    promptName: string,
    args: Record<string, string>,
    tokenProfile: TokenProfileId = config.defaultTokenProfile,
  ): Promise<PromptGetResult> {
    const server = this.servers.getInternal(serverId);
    const counter = getTokenCounter(tokenProfile);
    const startedAt = Date.now();
    const requestPayload = { name: promptName, arguments: args };
    const requestTokens = await counter.countJson(requestPayload);
    const requestBytes = jsonBytes(requestPayload);

    try {
      const raw = await mcpGetPrompt(server, promptName, args, {
        authProvider: this.getAuthProvider(server),
      });
      const result = (raw ?? {}) as { description?: string; messages?: unknown };
      const responsePayload = result.messages ?? raw;
      const responseTokens = await counter.countJson(responsePayload);
      const responseBytes = jsonBytes(raw);
      return {
        promptName,
        isError: false,
        durationMs: Date.now() - startedAt,
        tokenProfile,
        requestTokens,
        requestBytes,
        responseTokens,
        responseBytes,
        description: result.description,
        messages: result.messages ?? null,
        raw,
      };
    } catch (error) {
      return {
        promptName,
        isError: true,
        durationMs: Date.now() - startedAt,
        tokenProfile,
        requestTokens,
        requestBytes,
        responseTokens: 0,
        responseBytes: 0,
        messages: null,
        raw: null,
        errorMessage: formatConnectionError(error, server.url),
        authRequired: isOAuthHttpServer(server) && isAuthRequiredError(error),
      };
    }
  }

  private getAuthProvider(server: ReturnType<ServerRepository["getInternal"]>) {
    if (!isOAuthHttpServer(server)) return undefined;
    return this.oauth.createProvider(server.id);
  }
}
