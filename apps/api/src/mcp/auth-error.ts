// Auth-error classification + the "is this an OAuth streamable-HTTP server" predicate, shared by
// every MCP entry point (probe, scan, tool/resource/prompt calls, the connectivity preflight, and
// the testing run engine). Centralized here so all layers classify identically — see the reauth
// gate plan. Sits next to `connection-error.ts` (which formats transport errors; this one only
// CLASSIFIES auth failures).

import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { ServerAuthType, TransportType } from "@mcp-token-footprint/shared";
import { toErrorMessage } from "../utils/errors.js";

/**
 * True when an MCP operation failed because the server requires (re)authentication — i.e. a 401/403.
 *
 * The streamable-HTTP transport, on a 401 with an `authProvider`, tries a silent token refresh; if
 * that ALSO fails it throws {@link UnauthorizedError} (message "Unauthorized"). Hard HTTP failures
 * throw {@link StreamableHTTPError} with a numeric `.code`. We also keep a message heuristic so the
 * classifier works on a plain string (the run engine flattens the transport error to a message
 * before it reaches the fatal handler) and on errors that only carry the status in their text.
 */
export function isAuthRequiredError(error: unknown): boolean {
  if (error instanceof UnauthorizedError) return true;
  if (error instanceof StreamableHTTPError && (error.code === 401 || error.code === 403))
    return true;
  const message = toErrorMessage(error).toLowerCase();
  return (
    message.includes("401") ||
    message.includes("403") ||
    message.includes("unauthorized") ||
    message.includes("forbidden")
  );
}

/**
 * The single predicate for "this server can do interactive OAuth reauth" — streamable-HTTP + oauth.
 * Mirrors the guard previously inlined in `ScanService.getAuthProvider`, `RunService.authProviderFor`,
 * and the asset-proxy `authProviderFor`. Only these servers ever get the `authRequired` flag / modal.
 */
export function isOAuthHttpServer(server: {
  transport: TransportType;
  authType: ServerAuthType;
}): boolean {
  return server.transport === "streamable_http" && server.authType === "oauth";
}
