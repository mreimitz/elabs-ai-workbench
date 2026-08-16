// The single MCP reauthentication gate. When an MCP op needs (re)authentication, we route the user
// to the SAME settings window they'd use to configure the server (the ServerWizard "Edit MCP server"
// dialog) — there is deliberately NO separate reauth modal. App owns that dialog and injects
// `openReauth`, which opens it for one server and resolves once the user finishes (a confirmed
// sign-in) or closes it (a cancel). This gate adds only the scope guard + the throttled connectivity
// preflight on top:
//
//   • ensureAuthenticated(serverIds) — PROACTIVE, throttled. Skips servers verified within the TTL
//     window (~3h); for stale ones runs a lightweight connectivity preflight and, only when it
//     reports `authRequired`, opens the settings window. Non-auth failures are ignored (the real op
//     surfaces them). Resolves once every in-scope server is authenticated (or the user cancels).
//   • requestReauth(serverId) — REACTIVE. Opens the settings window directly for one server (used
//     when an MCP op comes back with `authRequired`). The caller then retries.
//
// Only streamable-HTTP + oauth servers are ever gated (isOAuthHttpServer); everything else keeps the
// plain error toast. All secret/token work stays in the API — this only decides WHEN to open the
// settings window and polls the redacted connectivity endpoint.
import { createContext, useCallback, useContext, useMemo, useRef, type ReactNode } from "react";
import type { ServerConfig } from "@mcp-token-footprint/shared";
import { checkConnectivity } from "../../lib/api";
import { isOAuthHttpServer, isServerVerifiedRecently, markServerVerified } from "./oauth-helpers";

export type EnsureResult = { ok: boolean; cancelled?: boolean };

/**
 * Optional copy context for the reauth settings window — the interrupted ACTION ("the scan you
 * started") and, when known, the PROVIDER whose session expired. Threaded verbatim into the
 * `ServerWizard`'s reauth title/description so the sign-in names what the user was doing instead of
 * reading like "your config is wrong" (T7 / P0). Additive — a caller that omits it gets a sane
 * generic default ("finish what you started"), so the many existing `requestReauth(serverId)` call
 * sites keep working unchanged.
 */
export type ReauthContext = { action?: string; provider?: string };

type McpAuthApi = {
  /** Throttled proactive preflight for a set of servers; opens the settings window only when reauth is needed. */
  ensureAuthenticated: (serverIds: string[]) => Promise<EnsureResult>;
  /** Reactive: open the settings window for one server (after an op returned authRequired). */
  requestReauth: (serverId: string, context?: ReauthContext) => Promise<EnsureResult>;
};

const McpAuthContext = createContext<McpAuthApi | null>(null);

/** Access the reauth gate from any descendant of the McpAuthContext provider (mounted in App). */
export function useMcpAuth(): McpAuthApi {
  const ctx = useContext(McpAuthContext);
  if (!ctx) throw new Error("useMcpAuth must be used within the McpAuth provider");
  return ctx;
}

/** Null-tolerant variant — returns the auth API, or `null` when rendered outside the provider (e.g. an
 *  isolated component test). Callers gate their auth affordance on a non-null result. */
export function useMcpAuthOptional(): McpAuthApi | null {
  return useContext(McpAuthContext);
}

/**
 * The gate's implementation. Called once in App (where `servers` + the ServerWizard live) so App's
 * own handlers and the context-consuming descendants share one queue + one settings window.
 * `servers` supplies the scope guard; `openReauth` opens the settings window for a server and
 * resolves when the user finishes or cancels.
 */
export function useMcpAuthGate(
  servers: ServerConfig[],
  openReauth: (server: ServerConfig, context?: ReauthContext) => Promise<EnsureResult>,
): { api: McpAuthApi } {
  const serversRef = useRef(servers);
  serversRef.current = servers;
  const openReauthRef = useRef(openReauth);
  openReauthRef.current = openReauth;

  const inScopeById = useCallback((id: string): ServerConfig | null => {
    const server = serversRef.current.find((s) => s.id === id);
    return server && isOAuthHttpServer(server) ? server : null;
  }, []);

  // Open the settings window for one server; on a confirmed sign-in refresh its TTL so the next use
  // skips the preflight.
  const reauthOne = useCallback(
    async (server: ServerConfig, context?: ReauthContext): Promise<EnsureResult> => {
      const result = await openReauthRef.current(server, context);
      if (result.ok) markServerVerified(server.id);
      return result;
    },
    [],
  );

  const requestReauth = useCallback(
    (serverId: string, context?: ReauthContext): Promise<EnsureResult> => {
      const server = inScopeById(serverId);
      if (!server) return Promise.resolve({ ok: false });
      return reauthOne(server, context);
    },
    [inScopeById, reauthOne],
  );

  const ensureAuthenticated = useCallback(
    async (serverIds: string[]): Promise<EnsureResult> => {
      const candidates = [...new Set(serverIds)]
        .map(inScopeById)
        .filter((s): s is ServerConfig => s !== null);
      if (candidates.length === 0) return { ok: true };

      const need: ServerConfig[] = [];
      for (const server of candidates) {
        if (isServerVerifiedRecently(server.id)) continue;
        try {
          const result = await checkConnectivity(server.id);
          if (result.ok) markServerVerified(server.id);
          else if (result.authRequired) need.push(server);
          // a non-auth failure is ignored here — the real operation will surface it with context
        } catch {
          // the preflight itself couldn't reach the API — don't block; let the real op surface it
        }
      }

      // Walk the servers that need sign-in one at a time through the settings window. A cancel stops
      // the walk (the caller treats `!ok` as "don't proceed").
      for (const server of need) {
        const result = await reauthOne(server);
        if (!result.ok) return result;
      }
      return { ok: true };
    },
    [inScopeById, reauthOne],
  );

  const api = useMemo<McpAuthApi>(
    () => ({ ensureAuthenticated, requestReauth }),
    [ensureAuthenticated, requestReauth],
  );

  return { api };
}

/** Wraps children so descendants can call `useMcpAuth()`. App supplies the gate's `api`. */
export function McpAuthContextProvider({
  api,
  children,
}: { api: McpAuthApi; children: ReactNode }) {
  return <McpAuthContext.Provider value={api}>{children}</McpAuthContext.Provider>;
}
