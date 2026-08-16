import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAssistantSpawnEnv } from "../src/assistant/spawn-env.js";

// Secrets discipline (.claude/rules/mcp-and-security.md): the Claude Agent SDK child process env
// is a full REPLACEMENT of the subprocess environment (per the installed SDK's `Options.env` — it
// does not merge with process.env), so whatever buildAssistantSpawnEnv returns is the child's
// *entire* environment. These tests prove the two forbidden vars are never present and that
// exactly one auth var is set, matching the source credential.

const FORBIDDEN_KEYS = ["MCP_SECRET_KEY", "DATABASE_PATH"];

test("spawn env never carries MCP_SECRET_KEY or DATABASE_PATH (oauth source)", () => {
  const env = buildAssistantSpawnEnv({
    auth: { kind: "claude_oauth", token: "sk-ant-oat01-fake-token" },
    assistantDataDir: "/tmp/mcp-fp-assistant-test",
  });

  for (const key of FORBIDDEN_KEYS) {
    assert.equal(key in env, false, `${key} must never be present in the SDK child env`);
  }
});

test("spawn env never carries MCP_SECRET_KEY or DATABASE_PATH (api key source)", () => {
  const env = buildAssistantSpawnEnv({
    auth: { kind: "api_key", apiKey: "sk-ant-api03-fake-key" },
    assistantDataDir: "/tmp/mcp-fp-assistant-test",
  });

  for (const key of FORBIDDEN_KEYS) {
    assert.equal(key in env, false, `${key} must never be present in the SDK child env`);
  }
});

test("spawn env sets exactly CLAUDE_CODE_OAUTH_TOKEN for an oauth source, never ANTHROPIC_API_KEY", () => {
  const env = buildAssistantSpawnEnv({
    auth: { kind: "claude_oauth", token: "sk-ant-oat01-fake-token" },
    assistantDataDir: "/tmp/mcp-fp-assistant-test",
  });

  assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, "sk-ant-oat01-fake-token");
  assert.equal("ANTHROPIC_API_KEY" in env, false);
});

test("spawn env sets exactly ANTHROPIC_API_KEY for an api-key source, never CLAUDE_CODE_OAUTH_TOKEN", () => {
  const env = buildAssistantSpawnEnv({
    auth: { kind: "api_key", apiKey: "sk-ant-api03-fake-key" },
    assistantDataDir: "/tmp/mcp-fp-assistant-test",
  });

  assert.equal(env.ANTHROPIC_API_KEY, "sk-ant-api03-fake-key");
  assert.equal("CLAUDE_CODE_OAUTH_TOKEN" in env, false);
});

test("spawn env carries exactly one auth var — never both — for either source", () => {
  const oauthEnv = buildAssistantSpawnEnv({
    auth: { kind: "claude_oauth", token: "token-a" },
    assistantDataDir: "/tmp/mcp-fp-assistant-test",
  });
  const authKeysOauth = ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY"].filter(
    (k) => k in oauthEnv,
  );
  assert.deepEqual(authKeysOauth, ["CLAUDE_CODE_OAUTH_TOKEN"]);

  const apiKeyEnv = buildAssistantSpawnEnv({
    auth: { kind: "api_key", apiKey: "key-b" },
    assistantDataDir: "/tmp/mcp-fp-assistant-test",
  });
  const authKeysApiKey = ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY"].filter(
    (k) => k in apiKeyEnv,
  );
  assert.deepEqual(authKeysApiKey, ["ANTHROPIC_API_KEY"]);
});

test("spawn env scopes HOME and CLAUDE_CONFIG_DIR under the assistant data dir, never the real HOME", () => {
  const env = buildAssistantSpawnEnv({
    auth: { kind: "claude_oauth", token: "token" },
    assistantDataDir: "/tmp/mcp-fp-assistant-test",
  });

  assert.ok(env.HOME.startsWith("/tmp/mcp-fp-assistant-test"));
  assert.ok(env.CLAUDE_CONFIG_DIR.startsWith("/tmp/mcp-fp-assistant-test"));
  assert.notEqual(env.HOME, process.env.HOME);
  assert.notEqual(env.CLAUDE_CONFIG_DIR, process.env.HOME);
});

test("spawn env carries PATH so the SDK can locate the node/bun/deno runtime", () => {
  const env = buildAssistantSpawnEnv({
    auth: { kind: "claude_oauth", token: "token" },
    assistantDataDir: "/tmp/mcp-fp-assistant-test",
    pathEnv: "/usr/bin:/bin",
  });

  assert.equal(env.PATH, "/usr/bin:/bin");
});

test("spawn env result contains exactly the expected key set — nothing extra leaks in", () => {
  const env = buildAssistantSpawnEnv({
    auth: { kind: "claude_oauth", token: "token" },
    assistantDataDir: "/tmp/mcp-fp-assistant-test",
    pathEnv: "/usr/bin",
  });

  assert.deepEqual(
    Object.keys(env).sort(),
    ["CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CONFIG_DIR", "HOME", "PATH"].sort(),
  );
});
