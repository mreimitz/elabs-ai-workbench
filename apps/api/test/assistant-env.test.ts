import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { ASSISTANT_DEFAULT_MODEL_ROSTER } from "@mcp-token-footprint/shared";

/** The subset of `config` (apps/api/src/config/env.ts) these tests care about. */
interface AssistantConfigSlice {
  assistantDataDir: string;
  assistantMaxTurns: number;
  assistantIdleTimeoutMs: number;
  assistantMaxActiveSessions: number;
  assistantSessionRetentionDays: number;
  assistantModelRoster: string[];
}

// config/env.ts computes `config` once at module-evaluation time from process.env, so exercising
// different env-var combinations needs a fresh module instance per scenario. A cache-busting query
// string on the dynamic import specifier forces Node's ESM loader to re-evaluate the module instead
// of returning the cached one (env.ts is pure computation from process.env + path.resolve, so
// re-evaluating it repeatedly has no side effects to worry about).
let importCounter = 0;
async function freshConfig(env: Record<string, string | undefined>): Promise<AssistantConfigSlice> {
  const saved: Record<string, string | undefined> = {};
  const keys = [
    "ASSISTANT_DATA_DIR",
    "ASSISTANT_MAX_TURNS",
    "ASSISTANT_IDLE_TIMEOUT_MS",
    "ASSISTANT_MAX_ACTIVE_SESSIONS",
    "ASSISTANT_SESSION_RETENTION_DAYS",
    "ASSISTANT_MODEL_ROSTER",
    "DATA_DIR",
  ];
  for (const key of keys) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) process.env[key] = value;
  }

  try {
    const mod = (await import(`../src/config/env.js?case=${importCounter++}`)) as {
      config: AssistantConfigSlice;
    };
    return mod.config;
  } finally {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

test("assistant env defaults apply when nothing is set", async () => {
  const config = await freshConfig({});
  assert.equal(config.assistantMaxTurns, 50);
  assert.equal(config.assistantIdleTimeoutMs, 600_000);
  assert.equal(config.assistantMaxActiveSessions, 2);
  assert.equal(config.assistantSessionRetentionDays, 0);
  assert.ok(config.assistantDataDir.endsWith(`${path.sep}assistant`));
});

test("ASSISTANT_DATA_DIR defaults under DATA_DIR when unset", async () => {
  const config = await freshConfig({ DATA_DIR: "/tmp/mcp-fp-test-data" });
  assert.equal(config.assistantDataDir, path.resolve("/tmp/mcp-fp-test-data", "assistant"));
});

test("ASSISTANT_DATA_DIR override is honored verbatim (resolved)", async () => {
  const config = await freshConfig({ ASSISTANT_DATA_DIR: "/tmp/custom-assistant-dir" });
  assert.equal(config.assistantDataDir, "/tmp/custom-assistant-dir");
});

test("ASSISTANT_MAX_TURNS override is parsed as a positive int", async () => {
  const config = await freshConfig({ ASSISTANT_MAX_TURNS: "17" });
  assert.equal(config.assistantMaxTurns, 17);
});

test("ASSISTANT_MAX_TURNS falls back to the default on a non-positive value", async () => {
  const config = await freshConfig({ ASSISTANT_MAX_TURNS: "0" });
  assert.equal(config.assistantMaxTurns, 50);
});

test("ASSISTANT_IDLE_TIMEOUT_MS override is parsed as a positive int", async () => {
  const config = await freshConfig({ ASSISTANT_IDLE_TIMEOUT_MS: "120000" });
  assert.equal(config.assistantIdleTimeoutMs, 120_000);
});

test("ASSISTANT_MAX_ACTIVE_SESSIONS override is parsed as a positive int", async () => {
  const config = await freshConfig({ ASSISTANT_MAX_ACTIVE_SESSIONS: "5" });
  assert.equal(config.assistantMaxActiveSessions, 5);
});

test("ASSISTANT_SESSION_RETENTION_DAYS accepts 0 (disabled) and positive overrides", async () => {
  const disabled = await freshConfig({ ASSISTANT_SESSION_RETENTION_DAYS: "0" });
  assert.equal(disabled.assistantSessionRetentionDays, 0);

  const enabled = await freshConfig({ ASSISTANT_SESSION_RETENTION_DAYS: "30" });
  assert.equal(enabled.assistantSessionRetentionDays, 30);
});

test("ASSISTANT_SESSION_RETENTION_DAYS falls back to the default on a negative value", async () => {
  const config = await freshConfig({ ASSISTANT_SESSION_RETENTION_DAYS: "-3" });
  assert.equal(config.assistantSessionRetentionDays, 0);
});

test("assistantModelRoster defaults to the static ASSISTANT_DEFAULT_MODEL_ROSTER when unset", async () => {
  const config = await freshConfig({});
  assert.deepEqual(config.assistantModelRoster, [...ASSISTANT_DEFAULT_MODEL_ROSTER]);
});

test("ASSISTANT_MODEL_ROSTER override is parsed as a trimmed comma-separated list", async () => {
  const config = await freshConfig({
    ASSISTANT_MODEL_ROSTER: " claude-opus-4-8 , claude-haiku-4-5 ",
  });
  assert.deepEqual(config.assistantModelRoster, ["claude-opus-4-8", "claude-haiku-4-5"]);
});

test("ASSISTANT_MODEL_ROSTER falls back to the default on an empty/whitespace-only value", async () => {
  const config = await freshConfig({ ASSISTANT_MODEL_ROSTER: "   " });
  assert.deepEqual(config.assistantModelRoster, [...ASSISTANT_DEFAULT_MODEL_ROSTER]);
});
