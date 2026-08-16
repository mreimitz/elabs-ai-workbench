/**
 * Error mapping (WP4.1) — Qlik / facade failures → the OpenAI error envelope `{ error: { message,
 * type, param, code } }` with the right HTTP status, per research 04 §3:
 *
 *   - facade key missing/wrong           → 401 `invalid_api_key`
 *   - unresolvable model / app context   → 404 `model_not_found`
 *   - HTTP 429 or a Qlik `AE-6` body     → 429 `rate_limit_exceeded` (+ `Retry-After`; clients auto-retry)
 *   - tenant 401 / 403 (e.g. `AE-3`)     → 401 (the STORED Qlik credential is unauthorized upstream)
 *   - tenant 5xx / other upstream error  → 502 `upstream_error`
 *   - Qlik `AE-4` "Prompt is rejected"   → NOT an HTTP error: a `content_filter` finish_reason
 *
 * The AE-code + Retry-After extraction mirrors the executor's private helpers (this is error
 * *classification*, independent of the byte-identical answer *extraction*, so replicating it here
 * cannot cause answer drift). The executor itself is untouched (D-US12).
 */

/** The OpenAI error envelope body. */
export type OpenAiErrorEnvelope = {
  error: { message: string; type: string; param: string | null; code: string | null };
};

/** A classified facade failure carrying the HTTP status + envelope fields (never a secret). */
export class FacadeError extends Error {
  readonly httpStatus: number;
  readonly type: string;
  readonly code: string | null;
  readonly param: string | null;
  readonly retryAfterSeconds?: number;

  constructor(init: {
    httpStatus: number;
    type: string;
    code?: string | null;
    param?: string | null;
    message: string;
    retryAfterSeconds?: number;
  }) {
    super(init.message);
    this.name = "FacadeError";
    this.httpStatus = init.httpStatus;
    this.type = init.type;
    this.code = init.code ?? null;
    this.param = init.param ?? null;
    if (init.retryAfterSeconds !== undefined) this.retryAfterSeconds = init.retryAfterSeconds;
  }

  envelope(): OpenAiErrorEnvelope {
    return {
      error: { message: this.message, type: this.type, param: this.param, code: this.code },
    };
  }
}

/** Convenience constructor. */
export function facadeError(init: ConstructorParameters<typeof FacadeError>[0]): FacadeError {
  return new FacadeError(init);
}

/**
 * The DISTINCT "prompt rejected" (Qlik `AE-4`) outcome. It is NOT an HTTP error: the client gets a
 * normal completion whose `finish_reason` is `content_filter` and whose content is empty (the
 * assistant's own guardrail declined the prompt). Carried as a thrown sentinel so the pre-commit
 * call path can surface it before any SSE frame is written.
 */
export class FacadeContentFilterError extends Error {
  constructor(
    message = "The assistant declined to answer this prompt (Qlik Answers guardrail).",
    readonly assistantVersion?: string,
  ) {
    super(message);
    this.name = "FacadeContentFilterError";
  }
}

/** A model that can't be resolved to a tenant/app → 404 `model_not_found`. */
export function modelNotFound(model: string, detail?: string): FacadeError {
  return facadeError({
    httpStatus: 404,
    type: "invalid_request_error",
    code: "model_not_found",
    param: "model",
    message: detail
      ? `The model \`${model}\` could not be resolved to a Qlik Answers assistant: ${detail}`
      : `The model \`${model}\` does not exist or is not a resolvable Qlik Answers assistant.`,
  });
}

/**
 * The facade's OWN admission-control rejection (WP4.2) — distinct from {@link classifyUpstream}'s
 * `rate_limit_exceeded` (which reflects the Qlik TENANT's `429`/`AE-6`). This fires BEFORE any
 * tenant call, when the facade's own per-instance in-flight cap
 * ({@link import("./concurrency.js").FacadeConcurrencyLimiter}) is already full — same OpenAI
 * envelope, same `429` + `Retry-After` contract so official clients auto-retry identically.
 */
export function concurrencyLimitExceeded(retryAfterSeconds: number): FacadeError {
  return facadeError({
    httpStatus: 429,
    type: "rate_limit_error",
    code: "facade_concurrency_limit_exceeded",
    message:
      "This facade instance is at its concurrent in-flight request limit. Retry after the indicated delay.",
    retryAfterSeconds,
  });
}

/** A malformed request (missing/invalid `model` or `messages`) → 400. */
export function badRequest(message: string, param?: string): FacadeError {
  return facadeError({
    httpStatus: 400,
    type: "invalid_request_error",
    code: null,
    param: param ?? null,
    message,
  });
}

/**
 * Classify a non-OK tenant response into a {@link FacadeError}. Reads the (already-parsed-or-raw)
 * body for a Qlik `AE-x` code. NOTE: `AE-4` is handled by the caller BEFORE this (it becomes a
 * `content_filter` finish, not an HTTP error) — this classifier only sees the remaining failures.
 */
export function classifyUpstream(
  status: number,
  body: unknown,
  headers: { get(name: string): string | null },
  phase: "resolve" | "thread" | "stream" | "messages",
): FacadeError {
  const aeCode = extractAeCode(body);

  // Rate limit: HTTP 429 or a Qlik AE-6 body → 429 + Retry-After (official clients auto-retry).
  if (status === 429 || aeCode === "AE-6") {
    const retryAfterSeconds = parseRetryAfterSeconds(headers.get("retry-after")) ?? 1;
    return facadeError({
      httpStatus: 429,
      type: "rate_limit_error",
      code: "rate_limit_exceeded",
      message:
        "The upstream Qlik Answers tenant is rate limited. Retry after the indicated delay." +
        (aeCode ? ` (${aeCode})` : ""),
      retryAfterSeconds,
    });
  }

  // Upstream authorization failure (the STORED Qlik credential, not the facade key) → 401.
  if (status === 401 || status === 403 || aeCode === "AE-3") {
    return facadeError({
      httpStatus: 401,
      type: "invalid_request_error",
      code: "invalid_api_key",
      message:
        "The Qlik Answers tenant rejected the stored credential (upstream authorization failed)." +
        (aeCode ? ` (${aeCode})` : ""),
    });
  }

  // Everything else (tenant 5xx, or any other AE-x / 4xx on an internal API) → a 502 upstream error.
  return facadeError({
    httpStatus: 502,
    type: "api_error",
    code: "upstream_error",
    message:
      `The Qlik Answers ${phase} request failed (HTTP ${status})` +
      (aeCode ? `: ${aeCode}` : "") +
      ".",
  });
}

/**
 * Pull a Qlik `AE-x` code out of an error body. Tolerant of the two shapes seen in the wild — the
 * REST envelope `{ errors: [{ code }] }` and a flat `{ code }` — plus a last-resort scan for an
 * `AE-\d` token anywhere in the serialized body (mirrors the executor's `extractApiError`/`scanAeCode`).
 */
export function extractAeCode(body: unknown): string | undefined {
  const record = asRecord(body);
  if (record) {
    const errors = Array.isArray(record.errors) ? record.errors : undefined;
    const first = errors ? asRecord(errors[0]) : undefined;
    const code = asString(first?.code) ?? asString(record.code);
    if (code) return code;
  }
  try {
    return JSON.stringify(body).match(/AE-\d/)?.[0];
  } catch {
    return undefined;
  }
}

/** Parse a `Retry-After` header (delta-seconds OR an HTTP-date) into whole seconds, if present. */
export function parseRetryAfterSeconds(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const dateMs = Date.parse(header);
  if (Number.isNaN(dateMs)) return undefined;
  return Math.max(0, Math.ceil((dateMs - Date.now()) / 1000));
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
