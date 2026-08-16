import assert from "node:assert/strict";
import { test } from "node:test";
import { describeError, formatConnectionError } from "../src/mcp/connection-error.js";

// Node/undici reports transport failures as a bare `TypeError: fetch failed` with the real reason in
// `error.cause`. These tests lock the "no more dead-end error messages" behaviour (bug fix).

test("describeError unwraps the cause chain (ECONNREFUSED address:port) instead of just 'fetch failed'", () => {
  const error = new TypeError("fetch failed", {
    cause: { code: "ECONNREFUSED", address: "192.168.65.254", port: 7040 },
  });
  const message = describeError(error);
  assert.match(message, /fetch failed/);
  assert.match(message, /ECONNREFUSED/);
  assert.match(message, /192\.168\.65\.254:7040/);
});

test("formatConnectionError turns ECONNREFUSED into actionable guidance (Docker)", () => {
  const error = new TypeError("fetch failed", {
    cause: { code: "ECONNREFUSED", address: "192.168.65.254", port: 7040 },
  });
  const message = formatConnectionError(error, "http://host.docker.internal:7040/mcp", true);
  assert.match(message, /Connection refused/);
  assert.match(message, /7040/);
  assert.match(message, /isn't running|not running|started/);
  assert.match(message, /0\.0\.0\.0|host\.docker\.internal|127\.0\.0\.1/);
});

test("formatConnectionError keeps the ENOTFOUND + localhost-in-Docker hints", () => {
  const enotfound = formatConnectionError(
    new TypeError("fetch failed", { cause: { code: "ENOTFOUND", hostname: "mcp-textops" } }),
    "http://mcp-textops:7030/mcp",
    true,
  );
  assert.match(enotfound, /Could not resolve hostname "mcp-textops"/);
  assert.match(enotfound, /host\.docker\.internal:7030/);

  const localhost = formatConnectionError(
    new TypeError("fetch failed"),
    "http://localhost:7030/mcp",
    true,
  );
  assert.match(localhost, /localhost points at the MCP Token Footprint container/);
  assert.match(localhost, /host\.docker\.internal:7030/);
});

test("non-Docker ECONNREFUSED stays informative without the Docker hint", () => {
  const message = formatConnectionError(
    new TypeError("fetch failed", {
      cause: { code: "ECONNREFUSED", address: "127.0.0.1", port: 7030 },
    }),
    "http://127.0.0.1:7030/mcp",
    false,
  );
  assert.match(message, /Connection refused/);
  assert.doesNotMatch(message, /Docker/);
});
