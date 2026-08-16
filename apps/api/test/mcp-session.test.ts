import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { openSession } from "../src/mcp/client.js";
import type { InternalServerConfig } from "../src/servers/repository.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const ECHO_SERVER = path.join(here, "fixtures", "echo-mcp-server.mjs");

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-session-test-"));
  tempDirs.push(dir);
  return dir;
}

function stdioConfig(bootLog: string, callLog: string): InternalServerConfig {
  const now = new Date().toISOString();
  return {
    id: "test-echo",
    name: "echo-stub",
    transport: "stdio",
    command: process.execPath, // node, so we don't depend on tsx for the child
    args: [ECHO_SERVER],
    env: { ECHO_BOOT_LOG: bootLog, ECHO_CALL_LOG: callLog },
    authType: "none",
    createdAt: now,
    updatedAt: now,
  };
}

function readLines(file: string): string[] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // ESRCH => no such process. EPERM => alive but not ours to signal (still alive).
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function waitForExit(pid: number, timeoutMs = 5_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return !isAlive(pid);
}

test("openSession issues N sequential callTools over ONE reused connection, then closes cleanly", async () => {
  const dir = makeTempDir();
  const bootLog = path.join(dir, "boot.log");
  const callLog = path.join(dir, "calls.log");

  const session = await openSession(stdioConfig(bootLog, callLog));

  // listTools works over the persistent connection.
  const tools = (await session.listTools()) as { tools?: Array<{ name?: string }> };
  assert.deepEqual(
    (tools.tools ?? []).map((t) => t.name),
    ["echo"],
    "the persistent session lists the stub's single tool",
  );

  // Exactly one process was spawned at session open.
  const bootPids = readLines(bootLog);
  assert.equal(bootPids.length, 1, "exactly one MCP server process spawned for the session");
  const serverPid = Number(bootPids[0]);
  assert.ok(Number.isInteger(serverPid) && serverPid > 0, "stub reported a valid pid");
  assert.equal(
    isAlive(serverPid),
    true,
    "the spawned MCP server is alive while the session is open",
  );

  // N SEQUENTIAL callTools on the SAME connection.
  const N = 5;
  for (let i = 0; i < N; i++) {
    const result = (await session.callTool("echo", { message: `msg-${i}` })) as {
      isError?: boolean;
      content?: Array<{ type?: string; text?: string }>;
    };
    assert.notEqual(result.isError, true, `call ${i} resolved without a tool error`);
    assert.equal(result.content?.[0]?.text, `echo:msg-${i}`, `call ${i} echoed its argument`);
  }

  // Still exactly ONE boot line: no extra process was spawned for the additional calls
  // (the single connection was reused, not reconnected per call).
  assert.equal(
    readLines(bootLog).length,
    1,
    "no additional MCP server process spawned across the N sequential calls (connection reused)",
  );

  // All N calls were served by the SAME process pid (proving one live connection handled them).
  const callLines = readLines(callLog);
  assert.equal(callLines.length, N, "the stub recorded exactly N tool invocations");
  const callPids = new Set(callLines.map((line) => line.split(":")[0]));
  assert.equal(callPids.size, 1, "all N calls were handled by a single server process");
  assert.equal(
    [...callPids][0],
    String(serverPid),
    "calls were served by the originally spawned process",
  );

  // close() tears the connection down cleanly and the child process exits (no leak).
  await session.close();
  assert.equal(
    await waitForExit(serverPid),
    true,
    "the MCP server process exits after close() — no leak",
  );
});

test("openSession.callTool RESOLVES (does not throw) on a tool-level error", async () => {
  const dir = makeTempDir();
  const bootLog = path.join(dir, "boot.log");
  const callLog = path.join(dir, "calls.log");

  const session = await openSession(stdioConfig(bootLog, callLog));
  try {
    const result = (await session.callTool("echo", { message: "__fail__" })) as {
      isError?: boolean;
      content?: Array<{ text?: string }>;
    };
    assert.equal(result.isError, true, "a tool-level failure resolves with isError: true");
    assert.match(result.content?.[0]?.text ?? "", /intentional tool error/);
  } finally {
    await session.close();
  }
});

test("openSession honors MCP_TIMEOUT_MS via withTimeout on a non-spawnable command", async () => {
  // A command that exits immediately produces a transport that never completes the MCP
  // handshake; connect() must reject (initialize failure surfaced through withTimeout/transport),
  // proving openSession does not hang and propagates transport/request failures.
  const now = new Date().toISOString();
  const badConfig: InternalServerConfig = {
    id: "test-bad",
    name: "bad-stub",
    transport: "stdio",
    command: process.execPath,
    args: ["-e", "process.exit(0)"],
    env: {},
    authType: "none",
    createdAt: now,
    updatedAt: now,
  };

  await assert.rejects(
    openSession(badConfig),
    "connect to a server that immediately exits rejects",
  );
});

test("H-11: openSession closes the client (no leak) and rethrows when connect fails/hangs", async () => {
  // The persistent-session path RETURNS the live client on success (unlike the one-shot helpers, it has
  // no `finally` close). The leak the fix targets is the `withTimeout`-wins-the-race case: when a stdio
  // handshake HANGS, `client.connect()` stays pending, so the SDK's own connect-catch (which closes on
  // an initialize REJECTION) never fires — `withTimeout` rejects while `connect()` is still in flight,
  // leaving the spawned child orphaned. To lock this deterministically (without a 30s timeout wait), we
  // spy on the client and force `connect()` to reject BEFORE the SDK's internal initialize try/catch —
  // exactly the gap the fix must cover — then assert `openSession` closed the client and rethrew.
  const originalConnect = Client.prototype.connect;
  const originalClose = Client.prototype.close;
  const connectFailure = new Error("simulated hung/failed MCP connect");
  let closeCalls = 0;
  Client.prototype.connect = async function failingConnect() {
    // Reject like a `withTimeout` loss — the SDK never gets to run its own `void this.close()`.
    throw connectFailure;
  };
  Client.prototype.close = async function countingClose() {
    closeCalls += 1;
  };

  try {
    const dir = makeTempDir();
    await assert.rejects(
      openSession(stdioConfig(path.join(dir, "boot.log"), path.join(dir, "calls.log"))),
      (err) => err === connectFailure,
      "openSession rethrows the original connect failure (does not swallow it)",
    );
    assert.equal(
      closeCalls,
      1,
      "openSession closed the client exactly once on the failed connect — no leaked transport/child (H-11)",
    );
  } finally {
    Client.prototype.connect = originalConnect;
    Client.prototype.close = originalClose;
  }
});
