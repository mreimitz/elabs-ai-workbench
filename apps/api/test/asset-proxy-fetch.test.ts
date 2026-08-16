import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AssetProxyError,
  ASSET_FETCH_TIMEOUT_MS,
  type FetchLike,
  fetchAssetBytes,
  isRedirectStatus,
} from "../src/servers/asset-proxy.js";

/**
 * Security lock for 06-security-review M1: the asset proxy must NOT follow redirects and must NOT
 * replay the configured server's stored custom auth header off the pinned MCP origin, and a hanging
 * upstream must abort via the timeout. These tests exercise the `fetchAssetBytes` guard with a
 * recording mock fetch — no live network. (A real internal-host SSRF target — 169.254.169.254 — can
 * never be contacted here; we assert the guard refuses to reach it, which is the load-bearing
 * behaviour.)
 */

type RecordedCall = { url: string; init: RequestInit | undefined };

/** A recording mock fetch: captures every (url, init) and returns the caller-supplied responses. */
function recordingFetch(responses: Array<Response | (() => Promise<Response>)>): {
  fetchImpl: FetchLike;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  let i = 0;
  const fetchImpl: FetchLike = async (input, init) => {
    calls.push({ url: input.toString(), init });
    const next = responses[i++];
    if (next === undefined) throw new Error(`unexpected fetch call #${i}`);
    return typeof next === "function" ? await next() : next;
  };
  return { fetchImpl, calls };
}

const PINNED = new URL("https://assets.example.com/asset-files?path=robot.svg");
const AUTH_HEADERS = { "X-API-Key": "super-secret-key" };

test("fetchAssetBytes passes redirect:manual + an AbortSignal to the fetch", async () => {
  const { fetchImpl, calls } = recordingFetch([
    new Response("PNG", { status: 200, headers: { "content-type": "image/png" } }),
  ]);

  await fetchAssetBytes(PINNED, AUTH_HEADERS, { fetchImpl });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.init?.redirect, "manual");
  assert.ok(calls[0]?.init?.signal instanceof AbortSignal, "an AbortSignal must be supplied");
});

test("fetchAssetBytes refuses an off-origin 302 redirect (SSRF) — does NOT follow it", async () => {
  // The upstream (an on-origin asset URL) 302s to an internal metadata host. The guard must refuse.
  const { fetchImpl, calls } = recordingFetch([
    new Response(null, {
      status: 302,
      headers: { location: "http://169.254.169.254/latest/meta-data/" },
    }),
    // A second entry that MUST NOT be consumed — following the redirect would be the bug.
    new Response("SECRET", { status: 200 }),
  ]);

  await assert.rejects(
    () => fetchAssetBytes(PINNED, AUTH_HEADERS, { fetchImpl }),
    (err: unknown) => err instanceof AssetProxyError && err.statusCode === 404,
  );

  // Exactly ONE request was made — the internal host was never contacted.
  assert.equal(calls.length, 1, "the redirect target must never be fetched");
  assert.equal(new URL(calls[0]!.url).origin, "https://assets.example.com");
});

test("fetchAssetBytes never leaks the stored auth header off the pinned origin", async () => {
  const { fetchImpl, calls } = recordingFetch([
    new Response(null, {
      status: 307,
      headers: { location: "https://evil.example.net/collect" },
    }),
    new Response("SECRET", { status: 200 }),
  ]);

  await assert.rejects(
    () => fetchAssetBytes(PINNED, AUTH_HEADERS, { fetchImpl }),
    (err: unknown) => err instanceof AssetProxyError && err.statusCode === 404,
  );

  // The custom auth header was sent ONLY to the pinned origin, and no request reached the off-origin
  // redirect target — so the credential could not have leaked.
  assert.equal(calls.length, 1);
  const sentHeaders = calls[0]?.init?.headers as Record<string, string> | undefined;
  assert.equal(new URL(calls[0]!.url).origin, "https://assets.example.com");
  assert.equal(sentHeaders?.["X-API-Key"], "super-secret-key");
});

test("fetchAssetBytes aborts a hanging upstream via the timeout", async () => {
  // A mock that never resolves on its own — it only settles when the abort signal fires.
  const { fetchImpl, calls } = recordingFetch([
    () =>
      new Promise<Response>((_resolve, reject) => {
        // read the signal from the recorded init once the call is captured
        const init = calls[calls.length - 1]?.init;
        const signal = init?.signal;
        assert.ok(signal instanceof AbortSignal, "timeout path needs a signal");
        signal.addEventListener("abort", () => {
          const abortErr = new Error("The operation was aborted");
          abortErr.name = "AbortError";
          reject(abortErr);
        });
      }),
  ]);

  await assert.rejects(
    () => fetchAssetBytes(PINNED, AUTH_HEADERS, { fetchImpl, timeoutMs: 15 }),
    (err: unknown) => err instanceof AssetProxyError && err.statusCode === 504,
  );
  assert.equal(calls.length, 1);
});

test("fetchAssetBytes proxies a normal same-origin 200 image (no regression)", async () => {
  const body = "PNGBYTES";
  const { fetchImpl, calls } = recordingFetch([
    new Response(body, {
      status: 200,
      headers: { "content-type": "image/png", "content-length": String(body.length) },
    }),
  ]);

  const response = await fetchAssetBytes(PINNED, AUTH_HEADERS, { fetchImpl });

  assert.equal(response.status, 200);
  assert.equal(response.ok, true);
  assert.ok(response.body, "a successful response must expose a readable body to stream back");
  assert.equal(await response.text(), body);
  // The header WAS sent to the pinned origin on the legitimate path.
  assert.equal(calls.length, 1);
  assert.equal(
    (calls[0]?.init?.headers as Record<string, string> | undefined)?.["X-API-Key"],
    "super-secret-key",
  );
});

test("fetchAssetBytes propagates a non-abort network error to the caller (route degrades it to 404)", async () => {
  const { fetchImpl } = recordingFetch([
    () => Promise.reject(new TypeError("fetch failed")),
  ]);

  await assert.rejects(
    () => fetchAssetBytes(PINNED, AUTH_HEADERS, { fetchImpl }),
    // Not an AssetProxyError — a genuine connection failure surfaces for the route's generic handler.
    (err: unknown) => err instanceof TypeError && !(err instanceof AssetProxyError),
  );
});

test("isRedirectStatus flags 3xx only", () => {
  assert.equal(isRedirectStatus(299), false);
  assert.equal(isRedirectStatus(300), true);
  assert.equal(isRedirectStatus(302), true);
  assert.equal(isRedirectStatus(308), true);
  assert.equal(isRedirectStatus(399), true);
  assert.equal(isRedirectStatus(400), false);
  assert.equal(isRedirectStatus(200), false);
});

test("ASSET_FETCH_TIMEOUT_MS is a sane positive default", () => {
  assert.ok(ASSET_FETCH_TIMEOUT_MS > 0 && ASSET_FETCH_TIMEOUT_MS <= 60_000);
});
