import { ASSISTANT_DEFAULT_MODEL_ROSTER, type AvailableModel } from "@mcp-token-footprint/shared";
import { httpError, toErrorMessage } from "../utils/errors.js";
import type { DecryptedCredential } from "./registry.js";
import type { SubscriptionModelSource } from "./subscription-models.js";

/**
 * The ONE place provider list-models REST calls live — the live counterpart to
 * {@link ./registry.ts | registry.ts} (which is the one place AI SDK *inference* wrappers are
 * built). The `@ai-sdk/*` packages do NOT expose a "list models" surface, so we call each
 * provider's own roster endpoint directly with `fetch`, using the same `DecryptedCredential` the
 * registry consumes. This runs only in the API process (runtime boundary): the key is decrypted
 * here, the call goes out from here, and only normalized, non-secret model ids/labels come back.
 *
 * Parsing + filtering are split into small pure functions (`parse*Models`, `isChatModelId`) so the
 * provider response shapes can be unit-tested without a network round-trip.
 */

const ANTHROPIC_VERSION = "2023-06-01";
// Ollama exposes an OpenAI-compatible surface at `/v1`; mirror registry.ts's default base URL.
const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434/v1";
// Hard ceiling on pagination loops so a misbehaving provider can never spin forever.
const MAX_PAGES = 10;

/** The injectable fetch seam — defaults to the global `fetch`, letting tests stub it directly. */
export type FetchLike = typeof fetch;

export async function listAvailableModels(
  cred: DecryptedCredential,
  subscriptionModels?: SubscriptionModelSource,
): Promise<AvailableModel[]> {
  switch (cred.kind) {
    case "anthropic":
      return listAnthropic(cred);
    case "openai":
      return listOpenAi(cred);
    case "google":
      return listGoogle(cred);
    case "openai_compatible": {
      const baseUrl = requireBaseUrl(cred, "openai_compatible");
      return listOpenAiCompatible(baseUrl, cred.apiKey, "openai_compatible");
    }
    case "ollama": {
      const baseUrl = cred.baseUrl?.trim() ? cred.baseUrl.trim() : DEFAULT_OLLAMA_BASE_URL;
      return listOpenAiCompatible(baseUrl, cred.apiKey, "Ollama");
    }
    case "claude_subscription":
      return listClaudeSubscription(subscriptionModels);
    default: {
      const exhaustive: never = cred.kind;
      throw httpError(400, `Unsupported provider kind: ${String(exhaustive)}`);
    }
  }
}

// --- Provider fetchers -------------------------------------------------------------------------

async function listAnthropic(cred: DecryptedCredential): Promise<AvailableModel[]> {
  const apiKey = requireKey(cred, "Anthropic");
  const headers = { "x-api-key": apiKey, "anthropic-version": ANTHROPIC_VERSION };
  const out: AvailableModel[] = [];
  let afterId: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = new URL("https://api.anthropic.com/v1/models");
    url.searchParams.set("limit", "1000");
    if (afterId) url.searchParams.set("after_id", afterId);
    const payload = await fetchJson(url.toString(), headers, "Anthropic");
    out.push(...parseAnthropicModels(payload));
    const record = asRecord(payload);
    const lastId = asString(record?.last_id);
    if (record?.has_more !== true || !lastId) break;
    afterId = lastId;
  }
  return sortModels(out);
}

async function listOpenAi(cred: DecryptedCredential): Promise<AvailableModel[]> {
  const apiKey = requireKey(cred, "OpenAI");
  const payload = await fetchJson(
    "https://api.openai.com/v1/models",
    { authorization: `Bearer ${apiKey}` },
    "OpenAI",
  );
  // The OpenAI roster mixes in embeddings/audio/image models with no capability flag to filter on,
  // so we drop the non-chat ones by id heuristic (see isChatModelId).
  return sortModels(parseOpenAiModels(payload, true));
}

async function listGoogle(cred: DecryptedCredential): Promise<AvailableModel[]> {
  const apiKey = requireKey(cred, "Google");
  // Pass the key as a header (not a query param) so it never lands in a URL log.
  const headers = { "x-goog-api-key": apiKey };
  const out: AvailableModel[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = new URL("https://generativelanguage.googleapis.com/v1beta/models");
    url.searchParams.set("pageSize", "1000");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const payload = await fetchJson(url.toString(), headers, "Google");
    out.push(...parseGoogleModels(payload));
    const next = asString(asRecord(payload)?.nextPageToken);
    if (!next) break;
    pageToken = next;
  }
  return sortModels(out);
}

async function listOpenAiCompatible(
  baseUrl: string,
  apiKey: string | undefined,
  label: string,
): Promise<AvailableModel[]> {
  const headers: Record<string, string> = {};
  if (apiKey?.trim()) headers.authorization = `Bearer ${apiKey.trim()}`;
  const payload = await fetchJson(joinUrl(baseUrl, "models"), headers, label);
  // The user controls these endpoints (self-hosted / proxy); assume the roster is already chat-only.
  return sortModels(parseOpenAiModels(payload, false));
}

/**
 * Claude subscription (roadmap/claude-subscription/) — this kind's "models" are the Claude tiers the
 * signed-in subscription grants, NOT a REST roster: there is no per-credential API key to call a
 * provider with (auth resolves from the owner's signed-in Claude subscription — see
 * `apps/api/src/assistant/`). The LIVE list comes from the Agent SDK's own roster
 * (`Query.supportedModels()`, the CLI picker's source) via the injected {@link SubscriptionModelSource}
 * ({@link import("./subscription-models.js").SubscriptionModelResolver}) — cached, and internally
 * falling back to the static {@link ASSISTANT_DEFAULT_MODEL_ROSTER} on any error/timeout/not-signed-in,
 * so it NEVER throws and always returns a usable list. When no resolver is wired (a pure-parser unit
 * test, or a caller with no SDK access) this returns the same honest static roster directly.
 */
async function listClaudeSubscription(
  subscriptionModels: SubscriptionModelSource | undefined,
): Promise<AvailableModel[]> {
  if (subscriptionModels) return subscriptionModels.resolve();
  return ASSISTANT_DEFAULT_MODEL_ROSTER.map((id) => ({ id }));
}

// --- Pure parsers (unit-tested in apps/api/test/provider-model-catalog.test.ts) ----------------

/** Anthropic `GET /v1/models` → `{ data: [{ id, display_name, type }], has_more, last_id }`. */
export function parseAnthropicModels(payload: unknown): AvailableModel[] {
  const out: AvailableModel[] = [];
  for (const entry of asArray(asRecord(payload)?.data)) {
    const record = asRecord(entry);
    const id = asString(record?.id);
    if (!id) continue;
    out.push({ id, displayName: asString(record?.display_name) });
  }
  return out;
}

/** OpenAI `GET /v1/models` → `{ data: [{ id, object: "model" }] }`. `filterChat` drops non-chat ids. */
export function parseOpenAiModels(payload: unknown, filterChat: boolean): AvailableModel[] {
  const out: AvailableModel[] = [];
  for (const entry of asArray(asRecord(payload)?.data)) {
    const id = asString(asRecord(entry)?.id);
    if (!id) continue;
    if (filterChat && !isChatModelId(id)) continue;
    out.push({ id });
  }
  return out;
}

/** Google `GET /v1beta/models` → `{ models: [{ name, displayName, inputTokenLimit,
 *  supportedGenerationMethods }], nextPageToken }`. Keep only text-generation models. */
export function parseGoogleModels(payload: unknown): AvailableModel[] {
  const out: AvailableModel[] = [];
  for (const entry of asArray(asRecord(payload)?.models)) {
    const record = asRecord(entry);
    const rawName = asString(record?.name);
    if (!rawName) continue;
    const methods = asArray(record?.supportedGenerationMethods);
    if (!methods.some((method) => method === "generateContent")) continue;
    const id = rawName.startsWith("models/") ? rawName.slice("models/".length) : rawName;
    out.push({
      id,
      displayName: asString(record?.displayName),
      contextWindow: asNumber(record?.inputTokenLimit),
    });
  }
  return out;
}

// Best-effort chat/text filter for OpenAI: the `/v1/models` list carries no capability flags, so we
// exclude ids that name a non-chat modality (embeddings, audio, image, moderation, legacy bases).
// Imperfect, but far better than the previous hardcoded roster — a true chat model is never dropped.
const NON_CHAT_MODEL_PATTERN =
  /(embedding|whisper|tts|dall-e|moderation|audio|realtime|image|transcribe|\bsearch\b|babbage|davinci|computer-use)/i;

export function isChatModelId(id: string): boolean {
  return !NON_CHAT_MODEL_PATTERN.test(id);
}

// --- Helpers -----------------------------------------------------------------------------------

async function fetchJson(
  url: string,
  headers: Record<string, string>,
  providerLabel: string,
  fetchImpl: FetchLike = fetch,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(url, { headers });
  } catch (error) {
    throw httpError(502, `Could not reach ${providerLabel}: ${toErrorMessage(error)}`);
  }
  if (!response.ok) {
    const detail = await describeUpstreamError(response);
    const hint = response.status === 401 || response.status === 403 ? " — check the API key" : "";
    throw httpError(
      502,
      `${providerLabel} returned ${response.status}${hint}${detail ? `: ${detail}` : ""}`,
    );
  }
  try {
    return await response.json();
  } catch {
    throw httpError(502, `${providerLabel} returned an unreadable response.`);
  }
}

/** Pull a short, single-line message out of a provider error body for the surfaced error. */
async function describeUpstreamError(response: Response): Promise<string> {
  let detail = "";
  try {
    const text = await response.text();
    if (text) {
      try {
        const json = asRecord(JSON.parse(text));
        const errorField = json?.error;
        const message =
          asString(asRecord(errorField)?.message) ??
          asString(errorField) ??
          asString(json?.message);
        detail = message ?? text;
      } catch {
        detail = text;
      }
    }
  } catch {
    // Body already consumed or unreadable — fall back to just the status code.
  }
  return detail.replace(/\s+/g, " ").trim().slice(0, 200);
}

function requireKey(cred: DecryptedCredential, label: string): string {
  const key = cred.apiKey?.trim();
  if (!key)
    throw httpError(400, `${label} credential has no API key — add one to list its models.`);
  return key;
}

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

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path}`;
}

/** Dedupe by id (pagination can overlap) and sort alphabetically for a stable picker order. */
function sortModels(models: AvailableModel[]): AvailableModel[] {
  const byId = new Map<string, AvailableModel>();
  for (const model of models) if (!byId.has(model.id)) byId.set(model.id, model);
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
