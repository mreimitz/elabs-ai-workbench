import assert from "node:assert/strict";
import { test } from "node:test";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { isAuthRequiredError, isOAuthHttpServer } from "../src/mcp/auth-error.js";

// The reauth gate hinges on classifying "this failure means the user must sign in again". The SDK
// surfaces that two ways: an `UnauthorizedError` (refresh failed) or a `StreamableHTTPError` with a
// 401/403 code. We also accept the same signal in a bare message string (the run engine flattens the
// transport error to a string before the fatal handler classifies it).

test("isAuthRequiredError is true for the SDK's UnauthorizedError (refresh failed)", () => {
  assert.equal(isAuthRequiredError(new UnauthorizedError()), true);
  assert.equal(isAuthRequiredError(new UnauthorizedError("token expired")), true);
});

test("isAuthRequiredError is true for StreamableHTTPError 401/403", () => {
  assert.equal(isAuthRequiredError(new StreamableHTTPError(401, "Unauthorized")), true);
  assert.equal(isAuthRequiredError(new StreamableHTTPError(403, "Forbidden")), true);
});

test("isAuthRequiredError is false for other StreamableHTTPError codes", () => {
  assert.equal(isAuthRequiredError(new StreamableHTTPError(500, "Server error")), false);
  assert.equal(isAuthRequiredError(new StreamableHTTPError(404, "Not found")), false);
});

test("isAuthRequiredError matches the auth signal in a bare message string (run-engine path)", () => {
  assert.equal(isAuthRequiredError("Unauthorized"), true);
  assert.equal(isAuthRequiredError("HTTP 401"), true);
  assert.equal(isAuthRequiredError("request forbidden (403)"), true);
});

test("isAuthRequiredError is false for transport/DNS failures", () => {
  assert.equal(
    isAuthRequiredError(
      new TypeError("fetch failed", { cause: { code: "ECONNREFUSED", port: 7030 } }),
    ),
    false,
  );
  assert.equal(isAuthRequiredError(new Error("Could not resolve hostname")), false);
  assert.equal(isAuthRequiredError(undefined), false);
});

test("isOAuthHttpServer is true only for streamable-HTTP + oauth", () => {
  assert.equal(isOAuthHttpServer({ transport: "streamable_http", authType: "oauth" }), true);
  assert.equal(isOAuthHttpServer({ transport: "streamable_http", authType: "bearer" }), false);
  assert.equal(isOAuthHttpServer({ transport: "streamable_http", authType: "none" }), false);
  assert.equal(isOAuthHttpServer({ transport: "stdio", authType: "oauth" }), false);
});
