/**
 * Server-side Qlik-tenant detection (Qlik Answers, WP 2.1) — URL-based, mirroring the web heuristic
 * `isLikelyQlikMcpUrl()` in `apps/web/src/features/servers/ServerWizard.tsx`. The `initialize`
 * `serverInfo` is intentionally DISCARDED (it is server-controlled / spoofable and not a reliable
 * key); the streamable-HTTP URL is the only thing we key on. A stdio server has no URL and is never
 * a Qlik tenant.
 *
 * This module is pure (no network, no secrets) so both the probe route and the URL-first
 * `POST /api/servers/probe` folding can share one detection rule.
 */

/**
 * True when `url` looks like a Qlik Cloud MCP endpoint — its host ends `.qlikcloud.com` AND its path
 * includes `/api/ai/mcp` (verbatim mirror of the web `isLikelyQlikMcpUrl` heuristic). An empty /
 * unparseable / stdio (undefined) URL is never a Qlik tenant.
 */
export function isLikelyQlikTenantUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.hostname.endsWith(".qlikcloud.com") && parsed.pathname.includes("/api/ai/mcp");
  } catch {
    return false;
  }
}

/** The origin (scheme + host, no path) of any parseable URL; undefined for stdio / an unparseable URL. */
export function safeUrlOrigin(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

/**
 * The Qlik tenant origin (scheme + host, no path) for a URL that passes {@link isLikelyQlikTenantUrl};
 * undefined otherwise. The Qlik Answers REST base (`/api/v1/assistants`) is resolved against this
 * origin — never against the MCP path.
 */
export function qlikTenantOrigin(url: string | null | undefined): string | undefined {
  return isLikelyQlikTenantUrl(url) ? safeUrlOrigin(url) : undefined;
}
