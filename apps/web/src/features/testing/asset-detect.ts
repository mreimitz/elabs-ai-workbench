import type { RunStep } from "@mcp-token-footprint/shared";

/**
 * Detect managed-asset image paths inside a `tool_result` step so {@link AssetGallery} can render
 * them. The Asset Management MCP tools (e.g. `assets_search`) return asset PATHS as text inside the
 * tool result; the model only writes those paths, so the user otherwise sees a bare string like
 * `icons/ai-automation/app-automation-robot.svg` instead of the image.
 *
 * The `tool_result` payload is `{ result: <mcpOutput> }` where `<mcpOutput>` is
 * `{ content: [{ type: "text", text: "{\"results\":[\"icons/…svg\"]}" }], … }`. We pull every text
 * block, `JSON.parse` it, and collect path strings from the known shapes (`results: string[]`,
 * `asset.path`, `assets[].path`) that look like image assets. Entirely defensive — the payload is
 * `unknown` (and may be redacted) — and returns `[]` when nothing image-like is found.
 */

const IMAGE_EXT = /\.(svg|png|jpe?g|gif|webp|avif)$/i;

export function detectAssets(step: RunStep | undefined): string[] {
  if (!step) return [];
  const result = readResultPayload(step.payload);
  if (result === undefined) return [];

  const texts = readContentTexts(result);
  const paths = new Set<string>();
  for (const text of texts) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      continue;
    }
    for (const candidate of collectPaths(parsed)) {
      if (isImagePath(candidate)) paths.add(candidate);
    }
  }
  return [...paths];
}

/** The `tool_result` payload is `{ result }` (an error step is `{ error }` → no assets). */
function readResultPayload(payload: unknown): unknown {
  if (payload && typeof payload === "object" && "result" in payload) {
    return (payload as { result: unknown }).result;
  }
  return undefined;
}

/** Pull every `content[].text` string out of an MCP tool-output object. */
function readContentTexts(result: unknown): string[] {
  if (!result || typeof result !== "object") return [];
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return [];
  const texts: string[] = [];
  for (const block of content) {
    if (block && typeof block === "object" && (block as { text?: unknown }).text) {
      const text = (block as { text?: unknown }).text;
      if (typeof text === "string") texts.push(text);
    }
  }
  return texts;
}

/** Collect path-like strings from the known asset shapes in one parsed JSON payload. */
function collectPaths(parsed: unknown): string[] {
  if (!parsed || typeof parsed !== "object") return [];
  const out: string[] = [];

  // `{ results: string[] }` — assets_search.
  const results = (parsed as { results?: unknown }).results;
  if (Array.isArray(results)) {
    for (const r of results) {
      if (typeof r === "string") out.push(r);
      else pushPath(out, r); // results may also be objects with a `path`
    }
  }

  // `{ asset: { path } }` — assets_get.
  pushPath(out, (parsed as { asset?: unknown }).asset);

  // `{ assets: [{ path }] }` — list-style results.
  const assets = (parsed as { assets?: unknown }).assets;
  if (Array.isArray(assets)) {
    for (const a of assets) {
      if (typeof a === "string") out.push(a);
      else pushPath(out, a);
    }
  }

  return out;
}

/** Push `value.path` if `value` is an object carrying a string `path`. */
function pushPath(out: string[], value: unknown): void {
  if (value && typeof value === "object") {
    const path = (value as { path?: unknown }).path;
    if (typeof path === "string") out.push(path);
  }
}

function isImagePath(value: string): boolean {
  return IMAGE_EXT.test(value.trim());
}
