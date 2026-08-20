/**
 * Manual, ONE-TURN smoke test for the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`).
 *
 * NOT wired into `pnpm test` — it makes a real network call to Anthropic, spawns the real SDK
 * CLI child process, and requires a real Claude Pro/Max OAuth token or Anthropic API key.
 * Ground rule: automated tests in this repo stay fully offline; this script is the deliberate,
 * human-run exception for verifying the SDK integration end to end.
 *
 * Written against the REAL exported `query()` of the INSTALLED
 * apps/api/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts (the Claude Agent SDK, a
 * separate product from the Claude Messages API / Managed Agents surface — do not confuse the
 * two; see the `claude-api` skill's own disambiguation note).
 *
 * Usage:
 *   CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-... pnpm --filter @mcp-token-footprint/api exec tsx scripts/assistant-smoke.ts
 *   ANTHROPIC_API_KEY=sk-ant-api03-...       pnpm --filter @mcp-token-footprint/api exec tsx scripts/assistant-smoke.ts
 *
 * (CLAUDE_CODE_OAUTH_TOKEN is obtained by running `claude setup-token` interactively and pasting
 * the resulting token — the same PTY flow WP 0.2 wires into Settings. This script bypasses that
 * UI and just takes the token directly via env, for a fast confidence check that the pinned SDK
 * version + minimal child env actually completes a turn.)
 */
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { type AssistantAuthSource, buildAssistantSpawnEnv } from "../src/assistant/spawn-env.js";

function resolveAuthSource(): AssistantAuthSource {
  const oauthToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  if (oauthToken) {
    return { kind: "claude_oauth", token: oauthToken };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey) {
    return { kind: "api_key", apiKey };
  }

  console.error(
    "assistant-smoke: set CLAUDE_CODE_OAUTH_TOKEN (from `claude setup-token`) or ANTHROPIC_API_KEY " +
      "in the environment before running this script. Neither was found — nothing was called.",
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const auth = resolveAuthSource();
  // A throwaway scratch dir — never the developer's real ~/.claude, never the app's /data
  // (mirrors buildAssistantSpawnEnv's production contract of an isolated HOME/CLAUDE_CONFIG_DIR).
  const scratchDir = mkdtempSync(path.join(os.tmpdir(), "mcp-fp-assistant-smoke-"));
  const env = buildAssistantSpawnEnv({ auth, assistantDataDir: scratchDir });

  console.log(`assistant-smoke: auth source = ${auth.kind}`);
  console.log(`assistant-smoke: scratch dir = ${scratchDir}`);
  console.log("assistant-smoke: starting a 1-turn query()...");

  let sawResult = false;
  let sawError = false;

  try {
    for await (const message of query({
      prompt: "Reply with exactly the single word: ok",
      options: {
        env,
        cwd: scratchDir,
        maxTurns: 1,
        // D-AS17 sandbox rule (planning/Roadmap/RM-02-assistant/decisions.md): no filesystem settings, no
        // built-in tools — this smoke only needs one text turn, nothing else.
        settingSources: [],
        tools: [],
        persistSession: false,
      },
    })) {
      switch (message.type) {
        case "system":
          if (message.subtype === "init") {
            console.log(`assistant-smoke: session initialized (model=${message.model})`);
          }
          break;
        case "assistant": {
          const text = message.message.content
            .map((block) => (block.type === "text" ? block.text : ""))
            .join("");
          console.log(`assistant-smoke: assistant said: ${JSON.stringify(text)}`);
          break;
        }
        case "result":
          sawResult = true;
          sawError = message.is_error;
          console.log(
            `assistant-smoke: result subtype=${message.subtype} is_error=${message.is_error} ` +
              `num_turns=${message.num_turns} cost_usd=${message.total_cost_usd}`,
          );
          break;
        default:
          // Other event types (status/hooks/tool-progress/etc.) — not interesting for a minimal
          // 1-turn, no-tools smoke; ignore.
          break;
      }
    }
  } finally {
    rmSync(scratchDir, { recursive: true, force: true });
  }

  if (!sawResult) {
    console.error(
      "assistant-smoke: FAILED — query() completed without ever emitting a result message",
    );
    process.exit(1);
  }
  if (sawError) {
    console.error("assistant-smoke: FAILED — the query() result reported is_error");
    process.exit(1);
  }

  console.log("assistant-smoke: OK");
}

main().catch((error) => {
  console.error("assistant-smoke: FAILED", error);
  process.exit(1);
});
