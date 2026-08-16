/**
 * Pure helpers for the asset-file proxy route (`GET /api/servers/:id/assets/file`).
 *
 * The route resolves a managed-asset PATH (returned by the Asset Management MCP tools) into the
 * actual image bytes by calling the server's `assets_get` tool, then fetching the asset's own
 * returned URL with the server's auth headers and streaming the bytes back. The browser cannot do
 * this fetch itself (server-side base URL + auth + CORS), so the API proxies it.
 *
 * Everything that decides WHAT to fetch lives here as side-effect-free functions so it can be
 * unit-tested without a live MCP server or network: parsing the `assets_get` JSON, validating that
 * the asset is an image, capping its size, and resolving the fetch URL against the MCP endpoint
 * origin (NEVER an arbitrary host — the model must not be able to make us fetch other servers).
 *
 * The one network-touching helper, {@link fetchAssetBytes}, is also here (with an injectable fetch)
 * because it carries the redirect-based SSRF + credential-leak defence (M1): it pins the request to
 * the MCP origin, refuses every 3xx (so the stored auth header can never be replayed off-origin),
 * and enforces an abort timeout.
 */

/** Max asset size we will proxy. Anything larger is rejected (a thumbnail gallery, not a CDN). */
export const MAX_ASSET_BYTES = 5 * 1024 * 1024;

/**
 * Max time we will wait on the upstream asset fetch before aborting. A hanging/slow upstream (a
 * compromised MCP server, a slowloris asset host) must not be able to stall the API request forever.
 */
export const ASSET_FETCH_TIMEOUT_MS = 15_000;

const IMAGE_MIME_PREFIX = "image/";

/** The slice of an `assets_get` asset object this proxy needs. */
export type ResolvedAsset = {
  /** The asset server's OWN relative (or absolute-same-origin) URL for the bytes. */
  url: string;
  /** MIME type as reported by the server (validated to be `image/*` before we fetch). */
  mime: string;
  /** Declared byte size, when present (used for an early size cap). */
  size?: number;
};

export class AssetProxyError extends Error {
  readonly statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.name = "AssetProxyError";
  }
}

/**
 * Parse the raw `assets_get` MCP tool result into a {@link ResolvedAsset}. The tool result shape is
 * `{ content: [{ type: "text", text: "<json>" }], ... }` where `<json>` is `{ ok, asset: {...} }`.
 * Defensive against every malformed/redacted shape — throws an {@link AssetProxyError} (404) rather
 * than returning a half-formed asset, so the route degrades to "not found".
 */
export function parseAssetResult(raw: unknown): ResolvedAsset {
  const text = readContentText(raw);
  if (text === undefined) {
    throw new AssetProxyError(404, "Asset metadata not found");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AssetProxyError(404, "Asset metadata was not valid JSON");
  }

  const asset = readAsset(parsed);
  if (!asset) {
    throw new AssetProxyError(404, "Asset not found");
  }

  const url = typeof asset.url === "string" ? asset.url.trim() : "";
  const mime = typeof asset.mime === "string" ? asset.mime.trim() : "";
  if (!url || !mime) {
    throw new AssetProxyError(404, "Asset has no url or mime");
  }

  const size =
    typeof asset.size === "number" && Number.isFinite(asset.size) ? asset.size : undefined;
  return { url, mime, size };
}

/** True only for `image/*` MIME types (the single kind this proxy is allowed to serve). */
export function isImageMime(mime: string): boolean {
  return mime.toLowerCase().startsWith(IMAGE_MIME_PREFIX);
}

/**
 * Resolve the asset's OWN returned `url` against the MCP endpoint origin and validate it:
 *  - must be an image MIME (else this proxy refuses it);
 *  - declared size (if any) must be within {@link MAX_ASSET_BYTES};
 *  - the resolved URL must stay on the SAME origin as the MCP endpoint — a path/url that escapes to
 *    another host (so the model can't steer us at an arbitrary server) is rejected.
 *
 * Returns the absolute URL to fetch. Throws {@link AssetProxyError} on any violation.
 */
export function resolveAssetFetchUrl(asset: ResolvedAsset, mcpEndpoint: string): URL {
  if (!isImageMime(asset.mime)) {
    throw new AssetProxyError(404, "Asset is not an image");
  }
  if (asset.size !== undefined && asset.size > MAX_ASSET_BYTES) {
    throw new AssetProxyError(413, "Asset is too large to proxy");
  }

  const origin = new URL(mcpEndpoint).origin;
  let resolved: URL;
  try {
    resolved = new URL(asset.url, origin);
  } catch {
    throw new AssetProxyError(404, "Asset url could not be resolved");
  }

  if (resolved.origin !== origin) {
    throw new AssetProxyError(404, "Asset url is outside the MCP server origin");
  }

  return resolved;
}

/** True for any HTTP 3xx redirect status. */
export function isRedirectStatus(status: number): boolean {
  return status >= 300 && status < 400;
}

/**
 * The subset of the global `fetch` signature this proxy needs. Injectable so the redirect/timeout/
 * header guard below is unit-testable without a live network (tests pass a recording mock).
 */
export type FetchLike = (input: URL | string, init?: RequestInit) => Promise<Response>;

/**
 * Fetch the (already same-origin-pinned) asset URL with the configured server's stored auth headers,
 * defending against the redirect-based SSRF + credential-leak class.
 *
 * SECURITY (06-security-review M1): `resolveAssetFetchUrl` pins `fetchUrl` to the MCP endpoint
 * origin, but a compromised/malicious MCP server can still return an on-origin asset whose bytes
 * then 3xx-redirect to an internal or attacker host. undici's DEFAULT `redirect: "follow"` would
 *  (a) follow that hop — reaching e.g. `http://169.254.169.254/…` (SSRF) — and
 *  (b) replay the stored custom auth header (`X-API-Key`, …) to the new host, because undici only
 *      strips the *standard* Authorization/Cookie headers cross-origin, not arbitrary custom ones.
 *
 * Defence (all three from M1):
 *   1. `redirect: "manual"` — undici never auto-follows; the 3xx surfaces to us.
 *   2. REFUSE EVERY 3xx. We deliberately do NOT follow asset redirects at all — the simplest, safest
 *      of the two options the review lists: a legitimate content-addressed asset host serves the
 *      bytes directly on the pinned origin. Because we never follow, the stored auth header is only
 *      ever sent to the pinned origin (`fetchUrl`) and can NEVER reach a redirect target — there is
 *      no header-stripping juggling to get subtly wrong.
 *   3. An `AbortSignal` timeout so a hanging/slow upstream cannot stall the request indefinitely.
 *
 * Returns the settled (non-redirect) upstream `Response`; the caller still enforces the MIME/size
 * caps. Throws {@link AssetProxyError} on a refused redirect (404) or a timeout (504). Non-abort
 * network errors propagate to the caller (which degrades them to a 404 without echoing details).
 */
export async function fetchAssetBytes(
  fetchUrl: URL,
  headers: Record<string, string>,
  options: { fetchImpl?: FetchLike; timeoutMs?: number } = {},
): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as FetchLike);
  const timeoutMs = options.timeoutMs ?? ASSET_FETCH_TIMEOUT_MS;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(fetchUrl, {
      // Auth headers are sent ONLY to the pinned origin (`fetchUrl`); refusing every redirect below
      // guarantees they are never replayed to a redirect target.
      headers,
      redirect: "manual",
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new AssetProxyError(504, "Asset fetch timed out");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }

  // Refuse ALL redirects (see the SECURITY note). With `redirect: "manual"` undici surfaces the real
  // 3xx (status + Location) instead of following it; we treat every 3xx as a hard refusal so the
  // stored credential can never be replayed to the redirect target (SSRF / credential leak).
  if (isRedirectStatus(response.status)) {
    throw new AssetProxyError(404, "Asset url redirected off the MCP server origin");
  }

  return response;
}

/** A conservative, public cache header for proxied (content-addressed) asset bytes. */
export function assetCacheControl(): string {
  return "private, max-age=300";
}

/** Pull the first text content block out of an MCP tool result (`content[].text`). */
function readContentText(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const content = (raw as { content?: unknown }).content;
  if (!Array.isArray(content)) return undefined;
  for (const block of content) {
    if (block && typeof block === "object" && (block as { type?: unknown }).type === "text") {
      const text = (block as { text?: unknown }).text;
      if (typeof text === "string") return text;
    }
  }
  return undefined;
}

/** Read the `asset` object from a parsed `assets_get` JSON payload (`{ ok, asset }` or bare asset). */
function readAsset(parsed: unknown): { url?: unknown; mime?: unknown; size?: unknown } | undefined {
  if (!parsed || typeof parsed !== "object") return undefined;
  const withAsset = parsed as { asset?: unknown; ok?: unknown };
  if (withAsset.asset && typeof withAsset.asset === "object") {
    return withAsset.asset as { url?: unknown; mime?: unknown; size?: unknown };
  }
  // Some servers may return the asset object directly.
  const bare = parsed as { url?: unknown; mime?: unknown };
  if (typeof bare.url === "string" || typeof bare.mime === "string") {
    return bare as { url?: unknown; mime?: unknown; size?: unknown };
  }
  return undefined;
}
