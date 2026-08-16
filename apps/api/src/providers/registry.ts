import { anthropic, createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI, google } from "@ai-sdk/google";
import { createOpenAI, openai } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  HUB_WEB_SEARCH_PROVIDER_KINDS,
  type ProviderKind,
  type Scenario,
} from "@mcp-token-footprint/shared";
import type { LanguageModel, Tool } from "ai";
import { httpError } from "../utils/errors.js";

// A decrypted credential — never leaves the API process. Mirrors
// ProviderRepository.getDecrypted's return shape.
//
// Qlik Answers (WP 0.2, D-QA1): a `qlik_answers` credential resolves to a usable `apiKey` + `baseUrl`
// from EITHER source, transparently — the downstream roster (WP 0.3) / executor (WP 1.1) read only
// `apiKey` (the bearer token) + `baseUrl` (the tenant origin) and never know which source produced it:
//   - own-key credential → `apiKey` is the decrypted stored key, `baseUrl` is the stored tenant origin.
//   - linked credential  → `apiKey` is the linked MCP server's OAuth access token or its auth-header
//     bearer, `baseUrl` is that server's tenant origin, and `mcpServerId` records the link.
// A broken link never yields a partial credential — `getDecrypted` throws before returning one.
export type DecryptedCredential = {
  kind: ProviderKind;
  baseUrl?: string;
  apiKey?: string;
  // Set only when the credential resolved its auth from a linked MCP server (the link's server id).
  mcpServerId?: string;
};

// Default base URL for a local Ollama daemon's OpenAI-compatible endpoint. Ollama exposes an
// OpenAI-compatible surface at `/v1` (its native `/api` is a different shape), so we drive it
// through `@ai-sdk/openai-compatible` — there is NO separate `ollama` package (WP 0.2 decision:
// "Ollama deferred to WP 2.3 — use openai-compatible"). The spec's `createOllama(...)` sketch is
// superseded by that ground-truth decision.
const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434/v1";

/**
 * The ONE place AI SDK provider packages are imported and turned into a model.
 *
 * Each provider kind in the contract maps to an `@ai-sdk/*` factory:
 *   - `anthropic`          → `@ai-sdk/anthropic`
 *   - `openai`             → `@ai-sdk/openai`
 *   - `google`             → `@ai-sdk/google` (`createGoogleGenerativeAI`)
 *   - `openai_compatible`  → `@ai-sdk/openai-compatible` (requires an explicit `baseUrl`)
 *   - `ollama`             → `@ai-sdk/openai-compatible` pointed at the Ollama OpenAI endpoint
 *
 * `openai_compatible` and `ollama` need a base URL to reach a local/self-hosted server; we validate
 * it here and throw a clear 400 (not a cryptic SDK error) when it is missing.
 */
export function modelFor(cred: DecryptedCredential, model: string): LanguageModel {
  switch (cred.kind) {
    case "anthropic":
      return createAnthropic({ apiKey: cred.apiKey })(model);
    case "openai":
      return createOpenAI({ apiKey: cred.apiKey })(model);
    case "google":
      return createGoogleGenerativeAI({ apiKey: cred.apiKey })(model);
    case "openai_compatible": {
      const baseURL = requireBaseUrl(cred, "openai_compatible");
      return createOpenAICompatible({ name: "openai_compatible", baseURL, apiKey: cred.apiKey })(
        model,
      );
    }
    case "ollama": {
      // Ollama runs locally with no auth by default; the base URL defaults to the local daemon but
      // an explicit one (remote daemon / custom port) still wins. An empty string is rejected.
      const baseURL = cred.baseUrl?.trim() ? cred.baseUrl.trim() : DEFAULT_OLLAMA_BASE_URL;
      return createOpenAICompatible({ name: "ollama", baseURL, apiKey: cred.apiKey })(model);
    }
    case "qlik_answers":
      // Qlik Answers is not chat-completions-shaped (a RAG product API, not an LLM). It never runs
      // through the AI SDK loop / `modelFor()` — the run engine branches to a dedicated executor
      // (`qlik-answers-executor`, roadmap/qlik-answers/, WP 1.1) at `RunService.execute()` instead.
      throw httpError(400, "qlik_answers uses the answers executor, not modelFor()");
    case "claude_subscription":
      // Claude subscription (roadmap/claude-subscription/, WP 0.1) mirrors `qlik_answers`: it never
      // runs through the AI SDK loop / `modelFor()` (no API key — auth resolves from the owner's
      // signed-in subscription). The run engine branches to a dedicated executor
      // (`claude-subscription-executor`, later WP) at `RunService.execute()` instead.
      throw httpError(400, "claude_subscription uses the subscription executor, not modelFor()");
    default: {
      const exhaustive: never = cred.kind;
      throw httpError(400, `Unsupported provider kind: ${String(exhaustive)}`);
    }
  }
}

/** Validate a required base URL for self-hosted providers; throw a 400 (not an SDK crash) if missing. */
function requireBaseUrl(cred: DecryptedCredential, kind: string): string {
  const baseUrl = cred.baseUrl?.trim();
  if (!baseUrl) {
    throw httpError(
      400,
      `Provider kind "${kind}" requires a base URL (set baseUrl on the credential).`,
    );
  }
  return baseUrl;
}

// --- Escape hatch: provider-native options ----------------------------------------------------

/**
 * AI SDK `providerOptions` passthrough, keyed by provider name. The SDK forwards each sub-object to
 * the matching provider's request, so this is how we reach provider-native features the SDK doesn't
 * surface as first-class params — e.g. Anthropic prompt caching (`cacheControl`), extended thinking,
 * or the context-management beta. Loosely typed on purpose (one builder, many providers); the
 * engine derives the concrete `providerOptions` field type from `streamText` itself.
 */
export type ProviderOptions = Record<string, Record<string, unknown>>;

/**
 * Build the provider-native `providerOptions` for a run from the credential + scenario.
 *
 * This is the escape hatch (decision #3). Today it surfaces **Anthropic** native context management:
 *   - `cacheControl: { type: "ephemeral" }` — opt into prompt caching so repeated system prompts +
 *     tool definitions are cached (the `cache_read_input_tokens` we already normalize in accounting).
 *   - `thinking: { type: "enabled", budgetTokens }` — extended thinking when the scenario asks for a
 *     high reasoning effort (mapped from `params.reasoningEffort`).
 *
 * Returns `undefined` when there is nothing to pass, so the engine omits `providerOptions` entirely.
 *
 * NOTE (native-SDK fallback): the AI SDK exposes Anthropic caching + thinking via this passthrough,
 * so no native `@anthropic-ai/sdk` is needed here. If a future Anthropic beta (e.g. a new
 * context-management header) is NOT reachable through `providerOptions.anthropic`, the sanctioned
 * fallback is a native `@anthropic-ai/sdk` call behind the same `engine.ts` seam — that dependency
 * is intentionally NOT added now (no current feature requires it).
 */
export function providerOptions(
  cred: DecryptedCredential,
  scenario: Pick<Scenario, "params">,
): ProviderOptions | undefined {
  switch (cred.kind) {
    case "anthropic": {
      const anthropic: Record<string, unknown> = {
        // Cache the stable prefix (system prompt + tool definitions) so re-runs read from cache.
        cacheControl: { type: "ephemeral" },
      };
      // Map a "high" reasoning effort to Anthropic extended thinking with a conservative budget.
      if (scenario.params.reasoningEffort === "high") {
        anthropic.thinking = { type: "enabled", budgetTokens: 4000 };
      }
      return { anthropic };
    }
    case "openai":
    case "google":
    case "openai_compatible":
    case "ollama":
    default:
      // No provider-native escape hatch needed for these yet; the SDK's first-class params
      // (temperature, maxOutputTokens, reasoningEffort) cover them. Add a case here when one does.
      return undefined;
  }
}

// --- Deferred tool loading: Anthropic tool search ---------------------------------------------

/**
 * Tool-set key under which the Anthropic tool-search tool is registered when a scenario runs
 * `deferred`. It is NOT an MCP tool name (those are the allow-listed tool ids), so it never collides
 * with an allow-listed tool.
 */
export const TOOL_SEARCH_TOOL_KEY = "tool_search_tool_regex";

/**
 * True when the provider + model can actually run the `deferred` tool-loading mode. The tool-search
 * tool is **Anthropic-only** and is **not** available on Haiku models. For any other provider/model a
 * deferred scenario transparently runs **eager** (the run surfaces a notice — it never fails), per the
 * spec's "verify non-Haiku and warn, not fail" constraint.
 */
export function supportsToolSearch(kind: ProviderKind, model: string): boolean {
  return kind === "anthropic" && !isHaikuModel(model);
}

/** A model id counts as Haiku when its id contains `haiku` (case-insensitive) — excluded from search. */
export function isHaikuModel(model: string): boolean {
  return /haiku/i.test(model);
}

/**
 * The Anthropic **regex** tool-search tool used in `deferred` mode. Registered in the run's tool set
 * alongside the (defer-loaded) MCP tools; the provider serializes its spec into the request and keeps
 * the deferred tool definitions out of the billed prompt prefix, so the resident footprint is ~0 until
 * a tool is searched for. The regex variant mirrors the spec's `tool_search_tool_regex`. The factory
 * only emits the tool spec (no API key needed), so the default provider instance is used.
 */
export function deferredToolSearchTool(): Tool {
  return anthropic.tools.toolSearchRegex_20251119() as unknown as Tool;
}

// --- hub-fixes WP5.1 (RC5, D-HF2): provider-native web search ----------------------------------
//
// Each AI-SDK provider ships a PROVIDER-EXECUTED web-search / grounding tool (verified against the
// installed SDKs at implementation time — the "spike first" the WP mandates):
//   • @ai-sdk/anthropic@4.0.5 → `anthropic.tools.webSearch_20250305()` (id `anthropic.web_search_20250305`)
//   • @ai-sdk/openai@4.0.5    → `openai.tools.webSearch()`            (id `openai.web_search`)
//   • @ai-sdk/google@4.0.6    → `google.tools.googleSearch()`        (id `google.google_search`)
// All three are `{ type: "provider", isProviderExecuted: true }` tools: the PROVIDER runs the search
// server-side and streams the results back inline — there is no local `execute`, no API key needed to
// BUILD the spec (the factory only emits the tool descriptor). `openai_compatible`/`ollama` expose no
// native search and are deliberately excluded (`providerSupportsWebSearch` returns false), so the
// composition seam omits `web.search` from their toolset and the tools prompt says why when requested.

/** True when the provider kind's own model surface can back `web.search` (Anthropic/OpenAI/Google). The
 *  capability derivation the composition seam + UI both read (never an ad-hoc `kind === …` branch). */
export function providerSupportsWebSearch(kind: ProviderKind): boolean {
  return (HUB_WEB_SEARCH_PROVIDER_KINDS as readonly ProviderKind[]).includes(kind);
}

/**
 * Build the provider-native web-search tool for a kind, or `undefined` when the kind has no native
 * search (`openai_compatible`/`ollama`/non-AI-SDK kinds). The returned {@link Tool} is added to the
 * turn's toolset under the internal name `web.search`; the provider executes it and the results surface
 * as `tool-result` parts (Anthropic/OpenAI) or grounding metadata (Google) the citation apparatus maps.
 * The factory needs no credential — the default provider instance emits only the descriptor.
 */
export function nativeWebSearchTool(kind: ProviderKind): Tool | undefined {
  switch (kind) {
    case "anthropic":
      return anthropic.tools.webSearch_20250305() as unknown as Tool;
    case "openai":
      return openai.tools.webSearch() as unknown as Tool;
    case "google":
      return google.tools.googleSearch({}) as unknown as Tool;
    default:
      return undefined;
  }
}

/** A web source lifted out of a provider search response, before it is numbered into a citation. */
export type ProviderWebSource = { title: string; url?: string; snippet?: string };

/**
 * Extract citable web sources from a Google `groundingMetadata` block (the shape `@ai-sdk/google` puts
 * on a step's `providerMetadata.google.groundingMetadata`). Google grounding does NOT surface its
 * sources as a tool-result output the way Anthropic/OpenAI do — the cited pages live in
 * `groundingChunks[].web.{uri,title}` — so the turn engine reads them from the step metadata and hands
 * them to the citation seam. Only http(s) URLs are kept; a chunk without a usable web uri is skipped.
 * Never throws — a malformed/absent metadata shape yields `[]` (graceful, per the WP).
 */
export function extractGroundingWebSources(providerMetadata: unknown): ProviderWebSource[] {
  const meta = providerMetadata as
    | { google?: { groundingMetadata?: { groundingChunks?: unknown } } }
    | undefined;
  const chunks = meta?.google?.groundingMetadata?.groundingChunks;
  if (!Array.isArray(chunks)) return [];
  const out: ProviderWebSource[] = [];
  for (const chunk of chunks) {
    const web = (chunk as { web?: { uri?: unknown; title?: unknown } } | null)?.web;
    const uri = typeof web?.uri === "string" ? web.uri.trim() : "";
    if (!/^https?:\/\//i.test(uri)) continue;
    const title = typeof web?.title === "string" && web.title.trim() ? web.title.trim() : uri;
    out.push({ title, url: uri });
  }
  return out;
}
