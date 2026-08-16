import assert from "node:assert/strict";
import { test } from "node:test";
import { promptGetRequestSchema, resourceReadRequestSchema } from "@mcp-token-footprint/shared";

// The resources/read + prompts/get MCP round-trip is verified live by the orchestrator. These
// tests lock only the request contract (the wire shape parsed by the routes), mirroring how the
// tool-call path validates `toolCallRequestSchema`.

test("resourceReadRequestSchema requires a non-empty uri", () => {
  assert.equal(resourceReadRequestSchema.safeParse({}).success, false);
  assert.equal(resourceReadRequestSchema.safeParse({ uri: "" }).success, false);
});

test("resourceReadRequestSchema accepts a uri and leaves tokenProfile undefined when absent", () => {
  const parsed = resourceReadRequestSchema.parse({ uri: "file:///doc.txt" });
  assert.equal(parsed.uri, "file:///doc.txt");
  assert.equal(parsed.tokenProfile, undefined);
});

test("resourceReadRequestSchema accepts an explicit tokenProfile", () => {
  const parsed = resourceReadRequestSchema.parse({
    uri: "file:///doc.txt",
    tokenProfile: "generic_cl100k",
  });
  assert.equal(parsed.tokenProfile, "generic_cl100k");
});

test("resourceReadRequestSchema rejects an unknown tokenProfile", () => {
  assert.equal(
    resourceReadRequestSchema.safeParse({ uri: "file:///doc.txt", tokenProfile: "nope" }).success,
    false,
  );
});

test("promptGetRequestSchema defaults arguments to an empty record", () => {
  const parsed = promptGetRequestSchema.parse({});
  assert.deepEqual(parsed.arguments, {});
  assert.equal(parsed.tokenProfile, undefined);
});

test("promptGetRequestSchema accepts a string-keyed argument record", () => {
  const parsed = promptGetRequestSchema.parse({ arguments: { topic: "tokens", lang: "en" } });
  assert.deepEqual(parsed.arguments, { topic: "tokens", lang: "en" });
});

test("promptGetRequestSchema rejects non-string argument values", () => {
  assert.equal(promptGetRequestSchema.safeParse({ arguments: { count: 3 } }).success, false);
});

test("promptGetRequestSchema accepts an explicit tokenProfile", () => {
  const parsed = promptGetRequestSchema.parse({ tokenProfile: "raw_json_rough" });
  assert.equal(parsed.tokenProfile, "raw_json_rough");
});
