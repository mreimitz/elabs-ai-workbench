#!/usr/bin/env node
// In-process stub MCP server for the persistent-session test (WP 1.2).
//
// It speaks MCP over stdio (the same transport `openSession` builds via `createTransport`) and
// exposes a single `echo` tool. On boot it appends its PID to the file given in
// `ECHO_BOOT_LOG`, and each `echo` call appends a marker to `ECHO_CALL_LOG`. The test reads
// those logs to prove that N sequential callTool()s ran over ONE spawned process (one boot line,
// one live PID) and that close() terminates it (no leak).

import fs from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const bootLog = process.env.ECHO_BOOT_LOG;
const callLog = process.env.ECHO_CALL_LOG;

if (bootLog) {
  fs.appendFileSync(bootLog, `${process.pid}\n`);
}

const server = new McpServer(
  { name: "echo-stub", version: "0.0.1" },
  { capabilities: { tools: {} } },
);

server.tool(
  "echo",
  "Echoes the provided message back to the caller.",
  { message: z.string() },
  async ({ message }) => {
    if (callLog) {
      fs.appendFileSync(callLog, `${process.pid}:${message}\n`);
    }
    // Resolve a tool-level error for a sentinel input so the test can assert that callTool
    // RESOLVES (does not throw) on tool-level failure, per MCP SDK semantics.
    if (message === "__fail__") {
      return { isError: true, content: [{ type: "text", text: "intentional tool error" }] };
    }
    return { content: [{ type: "text", text: `echo:${message}` }] };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
