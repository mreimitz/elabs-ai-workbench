import assert from "node:assert/strict";
import { test } from "node:test";
import type { NormalizedToolDefinition } from "@mcp-token-footprint/shared";
import type { McpSession } from "../src/mcp/client.js";
import {
  deferredToolSearchTool,
  isHaikuModel,
  supportsToolSearch,
  TOOL_SEARCH_TOOL_KEY,
} from "../src/providers/registry.js";
import { buildTools, type AllowedTool } from "../src/testing/tool-bridge.js";

// A no-op MCP session (no child process, no network) — these tests only inspect the BUILT tool
// definitions, never execute a call.
function stubSession(): McpSession {
  return {
    listTools: async () => ({ tools: [] }),
    callTool: async () => ({ content: [] }),
    close: async () => undefined,
  };
}

const DEF: NormalizedToolDefinition = {
  name: "alpha",
  description: "Alpha tool",
  inputSchema: { type: "object" },
  raw: {},
};

const allowed: AllowedTool[] = [{ serverId: "srv", def: DEF }];

test("supportsToolSearch is Anthropic-only and excludes Haiku", () => {
  assert.equal(supportsToolSearch("anthropic", "claude-sonnet-4-5"), true);
  assert.equal(supportsToolSearch("anthropic", "claude-opus-4-8"), true);
  // Haiku is excluded even on Anthropic (tool search is unsupported there).
  assert.equal(supportsToolSearch("anthropic", "claude-haiku-4-5"), false);
  // Every other provider falls back to eager (no tool search).
  assert.equal(supportsToolSearch("openai", "gpt-4o"), false);
  assert.equal(supportsToolSearch("google", "gemini-2.5-pro"), false);
  assert.equal(supportsToolSearch("openai_compatible", "llama3.1"), false);
});

test("isHaikuModel matches the haiku family case-insensitively", () => {
  assert.equal(isHaikuModel("claude-haiku-4-5"), true);
  assert.equal(isHaikuModel("Claude-3-5-HAIKU"), true);
  assert.equal(isHaikuModel("claude-sonnet-4-5"), false);
});

test("eager mode (default) builds tools with no deferred provider options", () => {
  const tools = buildTools(allowed, new Map([["srv", stubSession()]]), { toolCall() {} });
  assert.equal(tools.alpha?.providerOptions, undefined, "eager tools carry no providerOptions");
});

test("deferred mode tags every built tool with anthropic.deferLoading", () => {
  const tools = buildTools(
    allowed,
    new Map([["srv", stubSession()]]),
    { toolCall() {} },
    undefined,
    { deferLoading: true },
  );
  const anthropic = tools.alpha?.providerOptions?.anthropic as
    | { deferLoading?: boolean }
    | undefined;
  assert.equal(anthropic?.deferLoading, true, "each tool is marked deferred behind tool search");
});

test("the deferred tool-search tool is a usable tool registered under a non-colliding key", () => {
  const searchTool = deferredToolSearchTool();
  assert.ok(searchTool, "a tool-search tool is produced");
  // The key must not be a plausible MCP tool name (so it never shadows an allow-listed tool).
  assert.equal(TOOL_SEARCH_TOOL_KEY, "tool_search_tool_regex");
  assert.equal(
    allowed.some((a) => a.def.name === TOOL_SEARCH_TOOL_KEY),
    false,
  );
});
