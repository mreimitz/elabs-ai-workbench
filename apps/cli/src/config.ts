import fs from "node:fs";
import path from "node:path";
import {
  API_TOKEN_PREFIX,
  API_TOKEN_PREFIX_LENGTH,
  looksLikeApiToken,
  MCPFP_CONFIG_FILE_NAME,
  MCPFP_DEFAULT_API_URL,
  MCPFP_DEFAULT_TIMEOUT_MS,
  mcpfpConfigFileSchema,
  type McpfpConfigFile,
} from "@mcp-token-footprint/shared";
import { CliError } from "./errors.js";

/**
 * Config resolution — ONE resolver, ONE precedence, stated once and tested per level:
 *
 * ```
 * flag  >  environment variable  >  mcpfp.config.json  >  built-in default
 * ```
 *
 * | Setting  | Flag        | Env                | File        | Default                  |
 * | -------- | ----------- | ------------------ | ----------- | ------------------------ |
 * | Base URL | `--url`     | `MCPFP_URL`        | `url`       | `http://127.0.0.1:8080`  |
 * | Token    | `--token`   | `MCPFP_TOKEN`      | `token`     | *(none — loopback open)* |
 * | Timeout  | `--timeout` | `MCPFP_TIMEOUT_MS` | `timeoutMs` | `120000` ms              |
 *
 * **The token is never printed, by any path in this CLI.** Where it must be acknowledged (`config
 * show`, the "which source did this come from" warning) only its display prefix is rendered, derived
 * from `API_TOKEN_PREFIX_LENGTH` in `packages/shared/src/api-tokens.ts` rather than a literal `8`
 * here — the two must never be able to disagree about how much of a secret is safe to show.
 *
 * Not having a token is a NORMAL state, not an error (D-C2): against a loopback instance the API is
 * open unless `API_AUTH_REQUIRED=true`, so `mcpfp servers` against `127.0.0.1` works with no
 * credential at all. Remote instances answer `401 authentication_required`, which the client
 * translates into an instruction rather than a status code.
 */
export type ResolvedConfig = {
  /** The base URL, normalized with any trailing slash removed so path joining is unambiguous. */
  apiUrl: string;
  /** The plaintext service token, or `undefined`. **Never write this to any stream.** */
  token: string | undefined;
  /** Where the token came from — drives the "prefer MCPFP_TOKEN in CI" warning. */
  tokenSource: ConfigSource | undefined;
  timeoutMs: number;
  /** The `mcpfp.config.json` that was read, if any. Absolute path. */
  configPath: string | undefined;
};

export type ConfigSource = "flag" | "env" | "file" | "default";

/** The subset of parsed CLI flags config resolution cares about. */
export type ConfigFlags = {
  url?: string | undefined;
  token?: string | undefined;
  timeout?: string | undefined;
  config?: string | undefined;
};

export type ConfigInputs = {
  flags: ConfigFlags;
  env: Record<string, string | undefined>;
  cwd: string;
};

/**
 * Render a token the only way it may ever appear in output: `mcpfp_ab12cd34…`.
 *
 * `looksLikeApiToken` guarantees the secret half is LONGER than {@link API_TOKEN_PREFIX_LENGTH}, so
 * the ellipsis is always hiding something — this can never accidentally print a whole short token.
 */
export function describeTokenPrefix(token: string): string {
  const secret = token.slice(API_TOKEN_PREFIX.length);
  return `${API_TOKEN_PREFIX}${secret.slice(0, API_TOKEN_PREFIX_LENGTH)}…`;
}

/**
 * Walk UP from `cwd` to the filesystem root looking for `mcpfp.config.json`; first hit wins.
 * Returns `undefined` when there is none — an absent config file is the normal case, not an error.
 */
export function findConfigFile(cwd: string): string | undefined {
  let directory = path.resolve(cwd);
  for (;;) {
    const candidate = path.join(directory, MCPFP_CONFIG_FILE_NAME);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

/**
 * Read + validate one config file. A missing EXPLICIT `--config` path is a `2` rather than a silent
 * fall-through to the discovered/default config: a CI job that names a file it cannot find has a
 * broken checkout, and quietly running against `http://127.0.0.1:8080` instead would be worse than
 * stopping.
 */
function readConfigFile(filePath: string, explicit: boolean): McpfpConfigFile {
  if (!fs.existsSync(filePath)) {
    if (explicit) throw new CliError(`No config file at ${filePath}.`);
    return {};
  }

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    throw new CliError(
      `Could not read ${filePath}: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new CliError(
      `${filePath} is not valid JSON: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }

  const result = mcpfpConfigFileSchema.safeParse(parsed);
  if (!result.success) {
    // `.strict()` means an unrecognized key lands here rather than being dropped — surface the key
    // names so "I set apiUrl and nothing happened" is a one-line diagnosis.
    const issues = result.error.issues.map(
      (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
    );
    throw new CliError(`${filePath} is not a valid mcpfp config.`, { details: issues });
  }
  return result.data;
}

/** Parse a timeout from a flag or an env var, naming which one so the error is actionable. */
function parseTimeout(value: string, origin: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new CliError(
      `${origin} must be a positive whole number of milliseconds (got "${value}").`,
    );
  }
  return parsed;
}

/**
 * Validate + normalize the base URL. A non-`http:`/`https:` protocol is refused up front rather than
 * left to `fetch` — "unsupported protocol" from deep inside undici is not an operator-grade message.
 */
function normalizeApiUrl(value: string, origin: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CliError(`${origin} is not a valid URL: "${value}".`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new CliError(
      `${origin} must be an http:// or https:// URL (got "${url.protocol}//" in "${value}").`,
    );
  }
  return value.replace(/\/+$/, "");
}

export function resolveConfig(inputs: ConfigInputs): ResolvedConfig {
  const { flags, env, cwd } = inputs;

  const explicitConfig = flags.config !== undefined;
  const configPath = explicitConfig
    ? path.resolve(cwd, flags.config as string)
    : findConfigFile(cwd);
  const file = configPath ? readConfigFile(configPath, explicitConfig) : {};

  const urlChoice = pick(flags.url, env.MCPFP_URL, file.url);
  const apiUrl = urlChoice
    ? normalizeApiUrl(urlChoice.value, urlOrigin(urlChoice.source, configPath))
    : MCPFP_DEFAULT_API_URL;

  const timeoutChoice = pick(
    flags.timeout,
    env.MCPFP_TIMEOUT_MS,
    file.timeoutMs === undefined ? undefined : String(file.timeoutMs),
  );
  const timeoutMs = timeoutChoice
    ? parseTimeout(timeoutChoice.value, timeoutOrigin(timeoutChoice.source, configPath))
    : MCPFP_DEFAULT_TIMEOUT_MS;

  const tokenChoice = pick(flags.token, env.MCPFP_TOKEN, file.token);
  if (tokenChoice && !looksLikeApiToken(tokenChoice.value)) {
    // Refused BEFORE any network call. A truncated secret pasted into a CI variable should fail with
    // "that is not a workbench token", not with a confusing 401 three seconds later — and the
    // rejected value is never echoed back, because echoing it is exactly how a secret ends up in a
    // build log.
    throw new CliError(
      `That is not a workbench token (${tokenSourceLabel(tokenChoice.source, configPath)}).`,
      {
        details: [
          `A service token starts with "${API_TOKEN_PREFIX}" and is longer than ${
            API_TOKEN_PREFIX.length + API_TOKEN_PREFIX_LENGTH
          } characters.`,
          "Create one in Settings › API tokens; the plaintext is shown exactly once.",
        ],
      },
    );
  }

  return {
    apiUrl,
    token: tokenChoice?.value,
    tokenSource: tokenChoice?.source,
    configPath,
    timeoutMs,
  };
}

/** flag > env > file. Returns the winning value together with WHERE it came from. */
function pick(
  flag: string | undefined,
  envValue: string | undefined,
  fileValue: string | undefined,
): { value: string; source: ConfigSource } | undefined {
  if (flag !== undefined) return { value: flag, source: "flag" };
  if (envValue !== undefined && envValue !== "") return { value: envValue, source: "env" };
  if (fileValue !== undefined) return { value: fileValue, source: "file" };
  return undefined;
}

function urlOrigin(source: ConfigSource, configPath: string | undefined): string {
  if (source === "flag") return "--url";
  if (source === "env") return "MCPFP_URL";
  return `"url" in ${configPath ?? MCPFP_CONFIG_FILE_NAME}`;
}

function timeoutOrigin(source: ConfigSource, configPath: string | undefined): string {
  if (source === "flag") return "--timeout";
  if (source === "env") return "MCPFP_TIMEOUT_MS";
  return `"timeoutMs" in ${configPath ?? MCPFP_CONFIG_FILE_NAME}`;
}

/** Where a token came from, phrased for an operator. Never includes the token itself. */
export function tokenSourceLabel(source: ConfigSource, configPath: string | undefined): string {
  if (source === "flag") return "from --token";
  if (source === "env") return "from MCPFP_TOKEN";
  return `from "token" in ${configPath ?? MCPFP_CONFIG_FILE_NAME}`;
}
