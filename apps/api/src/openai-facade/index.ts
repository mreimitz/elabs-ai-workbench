/**
 * OpenAI-compatible facade around Qlik Answers (unified-sessions WP4.1, decision D-US12 — Option A;
 * hardened WP4.2 — concurrency cap + live-stream flag). Public surface: the Fastify plugin + the
 * facade-key minter + the deps contract. WP5.1 mounts it from `apps/api/src/index.ts` with ONE line
 * (see the WP report).
 */

export { registerOpenAiFacade } from "./routes.js";
export { loadOrMintFacadeKey, checkFacadeAuth, bearerToken } from "./auth.js";
export { ThreadAffinityCache } from "./affinity-cache.js";
export {
  FacadeError,
  FacadeContentFilterError,
  classifyUpstream,
  extractAeCode,
  parseRetryAfterSeconds,
  concurrencyLimitExceeded,
} from "./mapping.js";
export type { OpenAiErrorEnvelope } from "./mapping.js";
export type { OpenAiFacadeDeps, ChatMessage, FacadeAnswer, QlikAnswersAuth } from "./types.js";
export { FacadeConcurrencyLimiter } from "./concurrency.js";
export {
  DEFAULT_FACADE_MAX_CONCURRENCY,
  DEFAULT_FACADE_CONCURRENCY_RETRY_AFTER_SECONDS,
  DEFAULT_FACADE_LIVE_STREAM,
  MAX_CONCURRENCY_ENV_VAR,
  LIVE_STREAM_ENV_VAR,
  resolveMaxConcurrency,
  resolveLiveStream,
} from "./config.js";
