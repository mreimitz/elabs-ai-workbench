import path from "node:path";
import { config } from "../config/env.js";

/**
 * A single decrypted auth credential for the Claude Agent SDK child process. Exactly one of
 * these is ever injected into the child env — never both, never a fallback silently chosen by
 * this module (per D-AS14: the caller/session decides the source; this module only wires it).
 */
export type AssistantAuthSource =
  | { readonly kind: "claude_oauth"; readonly token: string }
  | { readonly kind: "api_key"; readonly apiKey: string };

export interface SpawnEnvOptions {
  /** The single decrypted credential to inject as CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY. */
  auth: AssistantAuthSource;
  /**
   * Base directory the SDK child's HOME and CLAUDE_CONFIG_DIR are scoped under. Defaults to
   * `config.assistantDataDir` (`<DATA_DIR>/assistant`). Overridable for tests so they don't touch
   * the real data directory.
   */
  assistantDataDir?: string;
  /** Overridable for tests; defaults to the current process's PATH. */
  pathEnv?: string;
}

/**
 * Builds the MINIMAL environment for the Claude Agent SDK child process.
 *
 * The SDK's `query({ options: { env } })` REPLACES the subprocess environment entirely rather
 * than merging with `process.env` (see the installed `@anthropic-ai/claude-agent-sdk` `.d.ts`,
 * `Options.env`) — so whatever this function returns *is* the child's whole environment.
 *
 * Per `.claude/rules/mcp-and-security.md` and D-AS17 (roadmap/assistant/decisions.md), the child
 * must carry ONLY what it needs to run the CLI and authenticate — never `MCP_SECRET_KEY`,
 * `DATABASE_PATH`, or any other app secret/config. `HOME` and `CLAUDE_CONFIG_DIR` are scoped
 * under the assistant data dir so the child never reads or writes the operator's real `~/.claude`
 * state (confirmed against the SDK's compiled `sdk.mjs`: `CLAUDE_CONFIG_DIR` — and `HOME` as its
 * fallback via `os.homedir()` — is where the CLI looks for `.credentials.json`; passing an
 * explicit auth env var short-circuits that lookup entirely, so no credentials file is ever
 * written or read for this child).
 *
 * `PATH` is included because the SDK still needs to locate the `node`/`bun`/`deno` runtime (and
 * the CLI itself may shell out for a handful of operations); everything else the parent process
 * carries (secrets, DB config, unrelated env) is deliberately dropped.
 */
export function buildAssistantSpawnEnv(options: SpawnEnvOptions): Record<string, string> {
  const dataDir = path.resolve(options.assistantDataDir ?? config.assistantDataDir);
  const home = path.join(dataDir, "home");
  const claudeConfigDir = path.join(dataDir, "claude");

  const env: Record<string, string> = {
    HOME: home,
    CLAUDE_CONFIG_DIR: claudeConfigDir,
    PATH: options.pathEnv ?? process.env.PATH ?? "",
  };

  if (options.auth.kind === "claude_oauth") {
    env.CLAUDE_CODE_OAUTH_TOKEN = options.auth.token;
  } else {
    env.ANTHROPIC_API_KEY = options.auth.apiKey;
  }

  return env;
}
