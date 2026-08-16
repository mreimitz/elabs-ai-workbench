#!/usr/bin/env node
// hub-fixes WP2.1 (RC2) — a minimal stdio MCP server exposing ONE READ-ONLY-annotated tool
// (`read_echo`, `annotations.readOnlyHint: true`), for the mission-agent tool-calling e2e. A mission
// agent runs autonomously with no operator, so the minimal mission-`auto` approval policy only
// AUTO-RUNS read-only-annotated tools (it gates the rest closed) — this fixture is the "read-only,
// safe to auto-run" tool the e2e's granted agent actually calls, proving the child turn produces a
// real tool_call + tool_result. Deliberately separate from the plain `echo-mcp-server.mjs` fixture
// (whose bare `echo` tool carries no read-only hint) so the shared fixture is untouched.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer(
  { name: "readonly-echo-stub", version: "0.0.1" },
  { capabilities: { tools: {} } },
);

server.registerTool(
  "read_echo",
  {
    description: "Read-only echo: returns the provided query verbatim. Safe to run without approval.",
    inputSchema: { query: z.string() },
    annotations: { readOnlyHint: true },
  },
  async ({ query }) => ({ content: [{ type: "text", text: `read_echo:${query}` }] }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
