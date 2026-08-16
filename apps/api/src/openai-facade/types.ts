/**
 * OpenAI-compatible facade around Qlik Answers (roadmap/unified-sessions/, WP4.1; research
 * `research/unified-run-sessions/04-openai-compat-wrapper.md`; decision **D-US12** — Option A only).
 *
 * This is an EXTERNAL interop endpoint: it makes an app-backed Qlik Answers assistant selectable
 * from any OpenAI-compatible client (Open WebUI, LiteLLM, another benchmark harness) by speaking the
 * **Chat Completions** protocol. It is a self-contained module of NEW files — the internal
 * qlik-answers executor ({@link import("../testing/qlik-answers-executor.js")}) is **untouched**
 * (D-US12): internal runs never route through the facade. The facade REUSES the executor's proven,
 * exported pure functions (`resolveQlikAnswersAppContext`, `extractAnswerMessage`, `findMessageById`,
 * the SSE parser + reasoning cleaner, `parseReasoningSections`) so the settled answer text it emits
 * is **byte-identical** to what the executor extracts for the same tenant message (proven by a
 * golden test).
 *
 * Hard invariant: **stub fetch ONLY** — every tenant HTTP call goes through the injected
 * {@link OpenAiFacadeDeps.fetchImpl}; a real Qlik tenant is NEVER contacted from code or tests.
 */

import type { AvailableModel, TokenProfileId } from "@mcp-token-footprint/shared";
import type { QlikAnswersAuth } from "../providers/model-catalog.js";

/** Re-export so consumers of the facade don't reach into the providers module directly. */
export type { QlikAnswersAuth } from "../providers/model-catalog.js";

// ── OpenAI Chat Completions request shapes (the subset the facade reads) ──────────────────────────

/** One content part of a multimodal message. Only `text` parts contribute to the Qlik prompt. */
export type ChatContentPart = { type?: string; text?: string; [key: string]: unknown };

/** One Chat Completions message. `content` is a string, an array of parts, or null (tool/system). */
export type ChatMessage = {
  role: string;
  content?: string | ChatContentPart[] | null;
  [key: string]: unknown;
};

/**
 * The `POST /openai/v1/chat/completions` request body. Sampling params (`temperature`/`top_p`/
 * `max_tokens`) are accepted-and-ignored (no Qlik equivalent — standard compat-server behavior).
 */
export type ChatCompletionRequest = {
  model?: unknown;
  messages?: unknown;
  stream?: unknown;
  stream_options?: { include_usage?: unknown } | null;
  [key: string]: unknown;
};

// ── Dependency injection seam (wired by WP5.1; stubbed in tests) ──────────────────────────────────

/**
 * Everything {@link import("./routes.js").registerOpenAiFacade} needs, injected so the module is
 * self-contained and stub-testable. WP5.1 wires the real implementations (a locally-minted key, a
 * `qlik_answers` provider-credential resolver, the live assistant roster) at integration time; the
 * facade itself never reaches into the DB, the provider repository, or a live tenant.
 */
export type OpenAiFacadeDeps = {
  /**
   * The locally-minted facade bearer token every request must present
   * (`Authorization: Bearer <facadeKey>`). Minted with the mcp-secret file pattern
   * ({@link import("./auth.js").loadOrMintFacadeKey}) and NEVER logged or forwarded to the tenant.
   */
  facadeKey: string;
  /**
   * Resolve a request `model` (a Qlik assistant id) → the Qlik Cloud tenant auth to run it, or
   * `undefined` when the model can't be resolved (→ 404 `model_not_found`). WP5.1 wires this from a
   * `qlik_answers` provider credential; it NEVER re-exposes the stored credential to the client.
   */
  resolveModel: (
    model: string,
  ) => Promise<QlikAnswersAuth | undefined> | QlikAnswersAuth | undefined;
  /**
   * The resolvable Qlik assistants, listed as OpenAI models for `GET /openai/v1/models` (id = the
   * assistant id, `owned_by: "qlik"`). WP5.1 drives this from the live assistant roster
   * ({@link import("../providers/model-catalog.js").listAvailableModels}); tests stub it.
   */
  listModels: () => Promise<AvailableModel[]> | AvailableModel[];
  /**
   * Injectable fetch — ALL tenant HTTP (app-context resolution, thread, actions/stream, messages)
   * goes through this. Defaults to the global `fetch`; tests inject a stub so NO real tenant is ever
   * contacted (the repo invariant). Mirrors the executor's `fetchImpl` seam.
   */
  fetchImpl?: typeof fetch;
  /** BPE profile for the (estimated) usage token counts. Defaults to `generic_o200k`. */
  tokenProfile?: TokenProfileId;
  /** Thread-affinity cache tuning (LRU size + TTL). Sensible defaults in {@link import("./affinity-cache.js").ThreadAffinityCache}. */
  cache?: { maxEntries?: number; ttlMs?: number };
  /** Clock seam for cache TTL + chunk `created` timestamps (tests inject determinism). Defaults to `Date.now`. */
  now?: () => number;
  /**
   * Max concurrent in-flight `/chat/completions` requests this facade instance admits before
   * returning `429` (WP4.2 — research 04 §6: the Qlik tenant's own rate-limit tier is shared by
   * every facade client). An explicit value here ALWAYS wins; otherwise resolved from the
   * `OPENAI_FACADE_MAX_CONCURRENCY` env var, else a default of 4
   * ({@link import("./config.js").resolveMaxConcurrency}).
   */
  maxConcurrency?: number;
  /**
   * Stream the raw Qlik answer text live, delta-by-delta, INSTEAD of the default hold-back
   * behavior (D-US12 keeps hold-back the DEFAULT — this is an explicit opt-in that accepts
   * live/settled drift, research 04 §4 M2). An explicit value here ALWAYS wins; otherwise resolved
   * from the `OPENAI_FACADE_LIVE_STREAM` env var (`"true"`/`"1"`), else `false`
   * ({@link import("./config.js").resolveLiveStream}).
   */
  liveStream?: boolean;
};

/**
 * The settled result of one facade turn against Qlik Answers — the authority the translator turns
 * into Chat Completions output. `answer` is the byte-identical extracted answer (see module header).
 */
export type FacadeAnswer = {
  /** The settled, extracted answer text — byte-identical to the executor's `extractAnswerMessage(...).answer` (with the same `|| streamedText` fallback). */
  answer: string;
  /** The full agent-process reasoning (streamed + cleaned, or the card's pre-Conclusion text). */
  reasoning: string;
  /** The Qlik Answers thread this turn ran in (created fresh on a cache miss, reused on a hit). */
  threadId: string;
  /** The Qlik Sense app id bound as the assistant's data context. */
  appId: string;
  /** The cloud-assistants message id that carried the answer, when observed. */
  messageId?: string;
  /** The response `Etag` = the assistant's version at answer time (drift signal). */
  assistantVersion?: string;
  /** The hypercube measure definitions behind the answer (`qMeasures[].qDef.qDef`). */
  expressions: string[];
  /** The `Qlik.Snapshot` insights (charts + measures/dimensions/reason/data). */
  snapshots: import("@mcp-token-footprint/shared").AnswersSnapshot[];
  /** The ordered card-body answer sequence (text ⟷ snapshot refs), when the card yielded one. */
  blocks?: import("@mcp-token-footprint/shared").AnswersAnswerBlock[];
  /** The structured reasoning phases parsed from {@link reasoning}. */
  reasoningSections: import("@mcp-token-footprint/shared").ReasoningSection[];
  /** Document citations for a document-backed assistant (`[]` for an app-backed one). */
  sources: import("@mcp-token-footprint/shared").AnswersSource[];
  /** The full official cloud-assistants message (lossless). */
  rawResponse: unknown;
  /** Questions drawn from the tenant quota by this turn (always 1). */
  questionsConsumed: number;
};

/** Bearer-token auth on the resolved Qlik tenant. */
export type ResolvedModelAuth = QlikAnswersAuth;
