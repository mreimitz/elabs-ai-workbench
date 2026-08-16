import { nanoid } from "nanoid";
import {
  auth,
  discoverOAuthProtectedResourceMetadata,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInput,
  OAuthStartResponse,
  OAuthStatusResponse,
} from "@mcp-token-footprint/shared";
import { config } from "../config/env.js";
import type { ServerRepository } from "../servers/repository.js";
import { httpError, toErrorMessage } from "../utils/errors.js";
import { StoredOAuthProvider } from "./provider.js";
import type { OAuthRepository } from "./repository.js";
import type { OAuthFlowRow } from "../db/rows.js";

export class OAuthService {
  constructor(
    private readonly servers: ServerRepository,
    private readonly oauth: OAuthRepository,
  ) {}

  createProvider(serverId: string, state?: string): StoredOAuthProvider {
    return new StoredOAuthProvider(
      this.oauth,
      serverId,
      config.oauthRedirectUrl,
      state ?? nanoid(),
    );
  }

  async start(serverId: string, oauthClient?: OAuthClientInput): Promise<OAuthStartResponse> {
    const server = this.servers.getInternal(serverId);
    if (server.transport !== "streamable_http" || !server.url) {
      throw httpError(400, "OAuth is only available for streamable HTTP servers");
    }

    if (oauthClient?.clientId?.trim()) {
      this.oauth.saveConfiguredClientInformation(serverId, oauthClient);
    }

    const state = nanoid();
    this.oauth.createFlow(state, serverId);
    const provider = this.createProvider(serverId, state);
    const result = await auth(provider, { serverUrl: server.url });

    if (result === "AUTHORIZED") {
      this.oauth.deleteFlow(state);
      return { serverId, status: "authorized" };
    }

    if (!provider.authorizationUrl) {
      throw httpError(502, "OAuth provider did not return an authorization URL");
    }

    return {
      serverId,
      status: "redirect",
      authorizationUrl: provider.authorizationUrl.toString(),
    };
  }

  async finish(input: { code?: string; state?: string; error?: string }): Promise<{
    serverId?: string;
    ok: boolean;
    message: string;
  }> {
    if (input.error) {
      const message = `OAuth failed: ${input.error}`;
      if (input.state) {
        const flow = this.oauth.getFlow(input.state);
        if (flow?.completed_at) return completedFlowResult(flow);
        if (flow) {
          this.oauth.completeFlow(input.state, message);
          return { serverId: flow.server_id, ok: false, message };
        }
      }
      return { ok: false, message };
    }

    if (!input.code || !input.state) {
      return { ok: false, message: "OAuth callback is missing code or state" };
    }

    const flow = this.oauth.getFlow(input.state);
    if (!flow) {
      return { ok: false, message: "OAuth state was not recognized or has expired" };
    }

    if (flow.completed_at) return completedFlowResult(flow);

    const server = this.servers.getInternal(flow.server_id);
    if (server.transport !== "streamable_http" || !server.url) {
      const message = "OAuth server configuration is invalid";
      this.oauth.completeFlow(input.state, message);
      return { serverId: flow.server_id, ok: false, message };
    }

    const provider = this.createProvider(flow.server_id, input.state);
    try {
      await auth(provider, { serverUrl: server.url, authorizationCode: input.code });
    } catch (error) {
      const message = toErrorMessage(error);
      this.oauth.completeFlow(input.state, message);
      return { serverId: flow.server_id, ok: false, message };
    }
    this.oauth.completeFlow(input.state);

    return { serverId: flow.server_id, ok: true, message: "OAuth authentication complete" };
  }

  status(serverId: string): OAuthStatusResponse {
    return {
      serverId,
      authenticated: this.oauth.hasTokens(serverId),
    };
  }

  clear(serverId: string): OAuthStatusResponse {
    this.oauth.clear(serverId);
    return this.status(serverId);
  }

  async hasOAuthMetadata(url: string): Promise<boolean> {
    try {
      const metadata = await discoverOAuthProtectedResourceMetadata(url);
      return Boolean(metadata?.authorization_servers?.length);
    } catch {
      return false;
    }
  }
}

function completedFlowResult(flow: OAuthFlowRow): {
  serverId: string;
  ok: boolean;
  message: string;
} {
  if (flow.error_message) {
    return { serverId: flow.server_id, ok: false, message: flow.error_message };
  }

  return { serverId: flow.server_id, ok: true, message: "OAuth authentication complete" };
}
