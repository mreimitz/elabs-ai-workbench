import {
  API_TOKEN_AUTH_REQUIRED_ERROR_CODE,
  API_TOKEN_INVALID_ERROR_CODE,
  API_TOKEN_SCOPE_FORBIDDEN_ERROR_CODE,
  type ApiTokenScope,
  FEATURE_DISABLED_ERROR_CODE,
} from "@mcp-token-footprint/shared";
import type { ResolvedConfig } from "./config.js";
import { CliError } from "./errors.js";

/**
 * The HTTP layer — **global `fetch`, no dependency** (D-C5). Node 22 ships it; undici's errors are
 * translated here into sentences an operator can act on, because the errors a CI user actually hits
 * are auth and connectivity ones and "TypeError: fetch failed" tells them nothing.
 *
 * Every failure in this module exits **2** (D-C7): a non-2xx response is an execution error, not an
 * assertion failure. That distinction is the contract WP 1.3 builds `mcpfp assert` on top of — "the
 * gate said no" (`1`) and "the gate could not run" (`2`) must never collapse into one code.
 *
 * The bearer token is attached **only when one is configured**, which is what makes the loopback
 * posture (D-C2 — local is open unless `API_AUTH_REQUIRED=true`) usable with no credential at all.
 * It appears in exactly one place: the `Authorization` header on the wire. It is never logged, never
 * put in an error message, and never echoed even if the API were to send it back — see
 * `redactTokens` in `output.ts`, which every stream goes through.
 */

/** The additive `{ error, code }` body the API's central error handler sends. Both fields optional. */
type ApiErrorBody = { error?: unknown; code?: unknown };

export type ApiRequest = {
  method: "GET" | "POST";
  /** An absolute API path, e.g. `/api/servers`. Joined onto the configured base URL. */
  path: string;
  body?: unknown;
  /** `json` parses the response; `markdown` returns it verbatim. */
  accept: "json" | "markdown";
  /**
   * The service-token scope this request needs, when it is a specific one. Used ONLY to make a
   * `403 scope_forbidden` say which scope is missing — `mcpfp scan` naming `scan:run` is the case
   * that matters, because a read-only CI token is the obvious way to get that 403.
   */
  scope?: ApiTokenScope;
};

export type WorkbenchClient = {
  json: <T>(request: ApiRequest) => Promise<T>;
  text: (request: ApiRequest) => Promise<string>;
};

export function createClient(config: ResolvedConfig): WorkbenchClient {
  return {
    json: <T>(request: ApiRequest) => send(config, request) as Promise<T>,
    text: (request: ApiRequest) => send(config, request) as Promise<string>,
  };
}

async function send(config: ResolvedConfig, request: ApiRequest): Promise<unknown> {
  // Concatenated rather than `new URL(path, base)`, which would DISCARD a base that carries a path
  // prefix (`https://host/workbench` + `/api/servers` → `https://host/api/servers`). An instance
  // behind a reverse-proxy sub-path is a normal deployment; silently dropping the prefix is not.
  const url = `${config.apiUrl}${request.path}`;

  const headers: Record<string, string> = {
    accept: request.accept === "json" ? "application/json" : "text/markdown, text/plain, */*",
  };
  if (config.token !== undefined) headers.authorization = `Bearer ${config.token}`;
  if (request.body !== undefined) headers["content-type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(url, {
      method: request.method,
      headers,
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch (error) {
    throw new CliError(describeTransportError(error, config));
  }

  if (!response.ok) {
    throw new CliError(await describeHttpError(response, request, config), {
      status: response.status,
    });
  }

  if (request.accept === "markdown") return response.text();

  const raw = await response.text();
  if (raw.trim() === "") return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new CliError(
      `The workbench API at ${config.apiUrl} answered ${response.status} with a body that is not JSON.`,
      { details: [`Requested: ${request.method} ${request.path}`] },
    );
  }
}

/**
 * Translate a non-2xx into an operator sentence. The WP 1.1 guard's four codes get a specific one
 * each, because those are the errors a headless caller hits first and a bare "401" leaves them
 * guessing which of "no token", "wrong token" and "wrong scope" they are looking at.
 */
async function describeHttpError(
  response: Response,
  request: ApiRequest,
  config: ResolvedConfig,
): Promise<string> {
  const body = await readErrorBody(response);
  const code = typeof body?.code === "string" ? body.code : undefined;
  const apiMessage = typeof body?.error === "string" ? body.error : undefined;

  if (response.status === 401 && code === API_TOKEN_AUTH_REQUIRED_ERROR_CODE) {
    return `This instance requires a service token. Create one in Settings › API tokens and pass it with \`--token\` or \`MCPFP_TOKEN\`.`;
  }
  if (response.status === 401 && code === API_TOKEN_INVALID_ERROR_CODE) {
    return "The service token was rejected (unknown, revoked or expired).";
  }
  if (response.status === 403 && code === API_TOKEN_SCOPE_FORBIDDEN_ERROR_CODE) {
    const needs = request.scope ? ` This command needs the \`${request.scope}\` scope.` : "";
    return `The token authenticated but lacks the scope for this request.${needs}`;
  }
  if (response.status === 403 && code === FEATURE_DISABLED_ERROR_CODE) {
    return "That feature is switched off in Settings › Features.";
  }
  if (response.status === 404) {
    return `Not found: ${request.method} ${request.path} (the workbench API at ${config.apiUrl} answered 404).`;
  }

  const detail = apiMessage ? `: ${apiMessage}` : "";
  return `The workbench API at ${config.apiUrl} answered ${response.status} for ${request.method} ${request.path}${detail}.`;
}

async function readErrorBody(response: Response): Promise<ApiErrorBody | undefined> {
  try {
    const raw = await response.text();
    if (raw.trim() === "") return undefined;
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === "object" && parsed !== null ? (parsed as ApiErrorBody) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Translate a thrown `fetch` failure. **The URL is named, the token never is** — "is it running?"
 * is the question an operator needs answered, and the credential has nothing to do with the answer.
 */
function describeTransportError(error: unknown, config: ResolvedConfig): string {
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return `The workbench API at ${config.apiUrl} did not answer within ${config.timeoutMs} ms (raise it with \`--timeout\` or \`MCPFP_TIMEOUT_MS\`).`;
  }

  const cause =
    error instanceof Error ? (error.cause as { code?: unknown } | undefined) : undefined;
  const code = typeof cause?.code === "string" ? cause.code : undefined;
  if (code === "ECONNREFUSED" || code === "ECONNRESET" || code === "EHOSTUNREACH") {
    return `No workbench API at ${config.apiUrl} — is it running?`;
  }
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return `Could not resolve the host in ${config.apiUrl}.`;
  }
  if (code === "CERT_HAS_EXPIRED" || code === "DEPTH_ZERO_SELF_SIGNED_CERT") {
    return `The TLS certificate of ${config.apiUrl} was rejected (${code}).`;
  }

  const detail = error instanceof Error ? error.message : "unknown error";
  return `Could not reach the workbench API at ${config.apiUrl}: ${detail}`;
}
