/**
 * WP4.2 config flags for the OpenAI-compat facade — the concurrency cap and the live-stream
 * opt-in — read directly from `process.env` with a documented default. `apps/api/src/config/env.ts`
 * is WP1.4's central env module and is deliberately NOT touched here (out of WP4.2 scope): a
 * deployment that wants these tunable sets the env vars below, or a caller of
 * {@link import("./routes.js").registerOpenAiFacade} passes an explicit
 * {@link import("./types.js").OpenAiFacadeDeps} field, which ALWAYS wins over the env var so tests
 * stay deterministic and never depend on process.env.
 */

/** Default per-facade in-flight cap on `/chat/completions` before a `429` (WP4.2). */
export const DEFAULT_FACADE_MAX_CONCURRENCY = 4;

/** `Retry-After` seconds sent with a concurrency-cap `429` — a short, fixed backoff hint. */
export const DEFAULT_FACADE_CONCURRENCY_RETRY_AFTER_SECONDS = 1;

/** D-US12: hold-back streaming is the default; raw live-answer streaming is an explicit opt-in. */
export const DEFAULT_FACADE_LIVE_STREAM = false;

/** Overrides {@link DEFAULT_FACADE_MAX_CONCURRENCY} when set to a positive integer. */
export const MAX_CONCURRENCY_ENV_VAR = "OPENAI_FACADE_MAX_CONCURRENCY";

/** Overrides {@link DEFAULT_FACADE_LIVE_STREAM} when set to `"true"` or `"1"` (case-insensitive). */
export const LIVE_STREAM_ENV_VAR = "OPENAI_FACADE_LIVE_STREAM";

/**
 * Resolve the concurrency cap: an explicit `deps.maxConcurrency` wins, then
 * `OPENAI_FACADE_MAX_CONCURRENCY`, else {@link DEFAULT_FACADE_MAX_CONCURRENCY}. Non-positive /
 * non-finite values (an explicit `0`, a malformed env var, …) are ignored in favor of the next
 * source — this never resolves to a cap of zero.
 */
export function resolveMaxConcurrency(explicit?: number): number {
  if (isPositiveFinite(explicit)) return Math.floor(explicit);
  const fromEnv = Number(process.env[MAX_CONCURRENCY_ENV_VAR]);
  if (isPositiveFinite(fromEnv)) return Math.floor(fromEnv);
  return DEFAULT_FACADE_MAX_CONCURRENCY;
}

/**
 * Resolve the live-stream flag: an explicit `deps.liveStream` wins, then
 * `OPENAI_FACADE_LIVE_STREAM` (`"true"`/`"1"`, case-insensitive), else
 * {@link DEFAULT_FACADE_LIVE_STREAM} (`false` — hold-back stays the default per D-US12).
 */
export function resolveLiveStream(explicit?: boolean): boolean {
  if (typeof explicit === "boolean") return explicit;
  const raw = process.env[LIVE_STREAM_ENV_VAR]?.trim().toLowerCase();
  if (raw === "true" || raw === "1") return true;
  return DEFAULT_FACADE_LIVE_STREAM;
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
