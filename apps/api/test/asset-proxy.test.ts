import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AssetProxyError,
  isImageMime,
  MAX_ASSET_BYTES,
  parseAssetResult,
  resolveAssetFetchUrl,
} from "../src/servers/asset-proxy.js";

/** The exact `assets_get` shape the proxy receives: `{ content: [{ type, text }], ... }`. */
function assetGetResult(asset: unknown): unknown {
  return { content: [{ type: "text", text: JSON.stringify({ ok: true, asset }) }] };
}

test("parseAssetResult reads url/mime/size from the assets_get content text", () => {
  const raw = assetGetResult({
    path: "icons/ai-automation/app-automation-robot.svg",
    filename: "app-automation-robot.svg",
    mime: "image/svg+xml",
    size: 1234,
    url: "/asset-files?path=icons%2Fai-automation%2Fapp-automation-robot.svg",
  });

  const asset = parseAssetResult(raw);
  assert.equal(asset.mime, "image/svg+xml");
  assert.equal(asset.size, 1234);
  assert.equal(asset.url, "/asset-files?path=icons%2Fai-automation%2Fapp-automation-robot.svg");
});

test("parseAssetResult accepts a bare asset object (no { ok, asset } wrapper)", () => {
  const raw = {
    content: [{ type: "text", text: JSON.stringify({ url: "/a.png", mime: "image/png" }) }],
  };
  const asset = parseAssetResult(raw);
  assert.equal(asset.url, "/a.png");
  assert.equal(asset.mime, "image/png");
});

test("parseAssetResult rejects malformed / redacted payloads as 404", () => {
  const cases: unknown[] = [
    undefined,
    null,
    {},
    { content: [] },
    { content: [{ type: "text", text: "not json" }] },
    assetGetResult({ filename: "x.svg" }), // no url/mime
    assetGetResult({ url: "/a.png" }), // no mime
  ];
  for (const raw of cases) {
    assert.throws(
      () => parseAssetResult(raw),
      (err: unknown) => err instanceof AssetProxyError && err.statusCode === 404,
      `expected 404 for ${JSON.stringify(raw)}`,
    );
  }
});

test("isImageMime is true only for image/* types", () => {
  assert.equal(isImageMime("image/png"), true);
  assert.equal(isImageMime("image/svg+xml"), true);
  assert.equal(isImageMime("IMAGE/JPEG"), true);
  assert.equal(isImageMime("application/json"), false);
  assert.equal(isImageMime("text/html"), false);
  assert.equal(isImageMime(""), false);
});

test("resolveAssetFetchUrl resolves the asset url against the MCP endpoint origin", () => {
  const url = resolveAssetFetchUrl(
    { url: "/asset-files?path=icons%2Frobot.svg", mime: "image/svg+xml" },
    "https://assets.example.com/mcp",
  );
  assert.equal(url.origin, "https://assets.example.com");
  assert.equal(url.pathname, "/asset-files");
  assert.equal(url.searchParams.get("path"), "icons/robot.svg");
});

test("resolveAssetFetchUrl rejects non-image assets", () => {
  assert.throws(
    () =>
      resolveAssetFetchUrl(
        { url: "/a.json", mime: "application/json" },
        "https://x.example.com/mcp",
      ),
    (err: unknown) => err instanceof AssetProxyError && err.statusCode === 404,
  );
});

test("resolveAssetFetchUrl rejects an asset url that escapes the MCP origin", () => {
  // The model must not be able to steer the proxy at an arbitrary host via an absolute url.
  assert.throws(
    () =>
      resolveAssetFetchUrl(
        { url: "https://evil.example.net/secret", mime: "image/png" },
        "https://safe.example.com/mcp",
      ),
    (err: unknown) => err instanceof AssetProxyError && err.statusCode === 404,
  );
});

test("resolveAssetFetchUrl rejects an oversized declared asset", () => {
  assert.throws(
    () =>
      resolveAssetFetchUrl(
        { url: "/big.png", mime: "image/png", size: MAX_ASSET_BYTES + 1 },
        "https://x.example.com/mcp",
      ),
    (err: unknown) => err instanceof AssetProxyError && err.statusCode === 413,
  );
});
