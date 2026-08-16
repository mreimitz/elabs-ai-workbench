import assert from "node:assert/strict";
import { test } from "node:test";
import { formatProbeErrorMessage } from "../src/servers/routes.js";

test("formats Docker DNS probe failures with a host.docker.internal hint", () => {
  const error = new TypeError("fetch failed", {
    cause: { code: "ENOTFOUND", hostname: "mcp-textops" },
  });

  const message = formatProbeErrorMessage(error, "http://mcp-textops:7030/mcp", true);

  assert.match(message, /Could not resolve hostname "mcp-textops"/);
  assert.match(message, /http:\/\/host\.docker\.internal:7030\/mcp/);
  assert.match(message, /same Docker network/);
});

test("formats localhost probe failures for Docker-host services", () => {
  const message = formatProbeErrorMessage(
    new TypeError("fetch failed"),
    "http://localhost:7030/mcp",
    true,
  );

  assert.match(message, /localhost points at the MCP Token Footprint container/);
  assert.match(message, /http:\/\/host\.docker\.internal:7030\/mcp/);
});
