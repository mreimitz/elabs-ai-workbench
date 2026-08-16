// Reusable predicate + connectivity-throttle helpers for the MCP reauth gate (McpAuthProvider). The
// browser never touches tokens — these only classify a server and poll the redacted connectivity
// endpoint; all OAuth/secret work stays in the API and the ServerWizard settings window.

import type { ServerAuthType, TransportType } from "@mcp-token-footprint/shared";

/**
 * The single predicate for "this server can do interactive OAuth reauth" (streamable-HTTP + oauth) —
 * mirrors the API's `isOAuthHttpServer`. Only these servers get routed to the settings window for
 * reauth; everything else keeps the plain error toast.
 */
export function isOAuthHttpServer(server: {
  transport: TransportType;
  authType: ServerAuthType;
}): boolean {
  return server.transport === "streamable_http" && server.authType === "oauth";
}

// ── Connectivity throttle ──────────────────────────────────────────────────────────────────────
// The owner's constraint: do NOT preflight on every MCP call. We verify a server at most once per
// window (default ~3h) and skip the connectivity round-trip inside it; a mid-window failure is caught
// reactively instead. The "last verified OK" timestamps persist in localStorage so the window
// survives reloads. A successful reauth refreshes the timestamp; an auth failure clears it.

const VERIFIED_STORAGE_KEY = "mcp-token-footprint.mcp-auth-verified";
export const MCP_CONNECTIVITY_TTL_MS = 3 * 60 * 60 * 1000; // 3 hours

function readVerified(): Record<string, number> {
  try {
    const raw = window.localStorage.getItem(VERIFIED_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : {};
    return parsed && typeof parsed === "object" ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function writeVerified(map: Record<string, number>): void {
  try {
    window.localStorage.setItem(VERIFIED_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // localStorage unavailable — the worst case is an extra preflight next time.
  }
}

/** True when this server was confirmed reachable within the TTL window (skip the preflight). */
export function isServerVerifiedRecently(serverId: string, now: number = Date.now()): boolean {
  const at = readVerified()[serverId];
  return typeof at === "number" && now - at < MCP_CONNECTIVITY_TTL_MS;
}

/** Record a successful connectivity check / reauth so the next use skips the preflight. */
export function markServerVerified(serverId: string, now: number = Date.now()): void {
  const map = readVerified();
  map[serverId] = now;
  writeVerified(map);
}

/** Forget a server's verification (e.g. after an auth failure) so the next use re-checks. */
export function clearServerVerified(serverId: string): void {
  const map = readVerified();
  if (serverId in map) {
    delete map[serverId];
    writeVerified(map);
  }
}
