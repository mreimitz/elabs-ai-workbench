import type { InternalServerConfig } from "../servers/repository.js";
import { httpError } from "../utils/errors.js";

/**
 * Qlik Answers dual-auth (WP 0.2, D-QA1) — resolve a `qlik_answers` provider credential's LINKED source
 * (`provider_credentials.mcp_server_id`) into a usable bearer token + tenant origin, reusing an already
 * connected MCP server's auth instead of a standalone API key. This lives BEHIND the runtime boundary
 * (apps/api only): decrypted OAuth tokens / auth headers are read here and turned into a bearer for the
 * downstream roster (WP 0.3) / executor (WP 1.1); they never leave the process, appear in a response, or
 * appear in an error message.
 *
 * A broken link (server row gone / no usable auth / no tenant origin) throws a clear, NON-LEAKING error
 * so the provider is listed as "auth broken" and runs refuse until the server is reconnected or an API
 * key is set — the error never embeds a token or header value.
 */
export interface LinkedAuthResolver {
  /**
   * Resolve a linked MCP server's auth into `{ apiKey (bearer token), baseUrl (tenant origin) }`, or
   * throw {@link brokenLinkError} when the link is unusable. Never returns a partial result.
   */
  resolve(serverId: string): { apiKey: string; baseUrl: string };
}

/** Minimal `ServerRepository` slice the resolver needs — `getInternal` throws (404) if the row is gone. */
export interface LinkedServerReader {
  getInternal(id: string): InternalServerConfig;
}

/** Minimal `OAuthRepository` slice the resolver needs — an OAuth server's stored access token. */
export interface LinkedOAuthReader {
  getCredentials(serverId: string): { tokens?: { access_token?: string } };
}

/**
 * The single clear, non-leaking error for a broken link. Deliberately generic (no server name, no token,
 * no header) so it is safe to surface in any run/roster response.
 */
const BROKEN_LINK_MESSAGE =
  "Qlik Answers provider's linked MCP server auth is unavailable — reconnect the server or set an API key.";

/** A clear 400 for a broken link — NEVER embeds a token, header value, or other secret. */
export function brokenLinkError(): ReturnType<typeof httpError> {
  return httpError(400, BROKEN_LINK_MESSAGE);
}

export class McpServerLinkedAuth implements LinkedAuthResolver {
  constructor(
    private readonly servers: LinkedServerReader,
    private readonly oauth: LinkedOAuthReader,
  ) {}

  resolve(serverId: string): { apiKey: string; baseUrl: string } {
    let config: InternalServerConfig;
    try {
      config = this.servers.getInternal(serverId);
    } catch {
      // The linked server row is gone (getInternal → 404) → the link is broken.
      throw brokenLinkError();
    }

    const baseUrl = tenantOrigin(config);
    if (!baseUrl) throw brokenLinkError();

    const apiKey = resolveBearerToken(config, this.oauth.getCredentials(serverId));
    if (!apiKey) throw brokenLinkError();

    return { apiKey, baseUrl };
  }
}

/**
 * The tenant origin (scheme + host, no path) of a streamable-HTTP server's URL; undefined for a stdio
 * server, a missing URL, or an unparseable URL (each → broken link).
 */
function tenantOrigin(config: InternalServerConfig): string | undefined {
  if (config.transport !== "streamable_http" || !config.url) return undefined;
  try {
    return new URL(config.url).origin;
  } catch {
    return undefined;
  }
}

/**
 * Resolve a bearer token from the linked server's auth. Returns the RAW token (no `Bearer ` prefix) —
 * Qlik Answers re-wraps it as `Authorization: Bearer <token>` downstream. Order:
 *  - OAuth server → its stored access token.
 *  - bearer / api_key / custom_headers server → the (decrypted) stored headers: an `Authorization`
 *    header (strip an optional `Bearer ` prefix), else the first non-empty header value (an api-key
 *    server with a custom header name, e.g. `qlik-api-key`).
 *  - `none` auth (no usable credential) → undefined (broken link).
 */
function resolveBearerToken(
  config: InternalServerConfig,
  oauth: { tokens?: { access_token?: string } },
): string | undefined {
  if (config.authType === "oauth") {
    const token = oauth.tokens?.access_token?.trim();
    return token ? token : undefined;
  }

  const headers = config.headers ?? {};
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() === "authorization" && value.trim()) {
      return value.trim().replace(/^Bearer\s+/i, "");
    }
  }
  // An api-key server with a custom header name: the header value is the token itself.
  for (const value of Object.values(headers)) {
    if (value.trim()) return value.trim();
  }
  return undefined;
}
