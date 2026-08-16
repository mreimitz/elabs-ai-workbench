import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, test } from "node:test";
import { checkConnection } from "../src/mcp/client.js";
import type { InternalServerConfig } from "../src/servers/repository.js";

// The reauth gate's throttled preflight calls `checkConnection` (connect → close, no discovery).
// These lock its two outcomes against the stdio echo fixture (no network): a good server resolves;
// an unspawnable command rejects (which the service then classifies + formats).

const here = path.dirname(fileURLToPath(import.meta.url));
const ECHO_SERVER = path.join(here, "fixtures", "echo-mcp-server.mjs");

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "connectivity-test-"));
  tempDirs.push(dir);
  return dir;
}

function echoConfig(): InternalServerConfig {
  const dir = makeTempDir();
  const now = new Date().toISOString();
  return {
    id: "test-echo",
    name: "echo-stub",
    transport: "stdio",
    command: process.execPath, // node, so we don't depend on tsx for the child
    args: [ECHO_SERVER],
    env: { ECHO_BOOT_LOG: path.join(dir, "boot.log"), ECHO_CALL_LOG: path.join(dir, "call.log") },
    authType: "none",
    createdAt: now,
    updatedAt: now,
  };
}

test("checkConnection resolves for a server that initializes", async () => {
  await assert.doesNotReject(() => checkConnection(echoConfig()));
});

test("checkConnection rejects when the server cannot be reached", async () => {
  const now = new Date().toISOString();
  const config: InternalServerConfig = {
    id: "test-missing",
    name: "missing",
    transport: "stdio",
    command: path.join(makeTempDir(), "does-not-exist"),
    args: [],
    env: {},
    authType: "none",
    createdAt: now,
    updatedAt: now,
  };
  await assert.rejects(() => checkConnection(config));
});
