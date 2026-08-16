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

/**
 * The injectable fetch seam (WP 0.3). Only the `qlik_answers` path threads this through today —
 * the other listers call global `fetch` directly and are exercised only at the pure-parser level
 * (see the file-header note); `qlik_answers` needs full fetch/pagination coverage with NO real
 * tenant ever contacted, so `listAvailableModels`/`listQlikAnswers`/`fetchJson` all accept an
 * optional `fetchImpl` that defaults to the global `fetch`, letting tests stub it directly.
 */
export type FetchLike = typeof fetch;

export async function listAvailableModels(
  cred: DecryptedCredential,
  fetchImpl: FetchLike = fetch,
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
    case "qlik_answers":
      return listQlikAnswers(cred, fetchImpl);
    case "claude_subscription":
      return listClaudeSubscription(subscriptionModels);
    default: {
      const exhaustive: never = cred.kind;
      throw httpError(400, `Unsupported provider kind: ${String(exhaustive)}`);
    }
  }
}

// --- Qlik Answers app-context resolution (Phase 4 cloud-assistants rework, 2026-07-11) ----------
//
// A Qlik Answers **app**-backed assistant is executed through the internal `/api/v1/cloud-assistants/`
// API, which binds a Qlik Sense **app** as the run's data context (`context:{type:"app", id: APP_ID}`)
// rather than an assistant UUID. The env "model" stays the assistant UUID; we resolve its bound app id
// here (once, cached) from the assistant's own metadata. The public `/api/v1/assistants/{id}` detail
// carries `knowledgeBases[]` (and possibly the app directly); the app id, when not inline, is found by
// walking the assistant → knowledge-base → data-source metadata. All GETs are FREE (metadata only — no
// question consumed). Set `QLIK_ANSWERS_DEBUG=1` to log every candidate response's raw shape.

/** Thrown when no Qlik Sense app can be resolved for an assistant — the run cannot bind a data context. */
export class QlikAnswersAppResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QlikAnswersAppResolutionError";
  }
}

/** Resolved tenant auth for the cloud-assistants calls (mirrors the executor's `auth`). */
export type QlikAnswersAuth = { apiKey: string; baseUrl: string };

const APP_CONTEXT_TTL_MS = 5 * 60_000;
const appContextCache = new Map<string, { appId: string; expires: number }>();

function qaDebug(label: string, data: unknown): void {
  if (process.env.QLIK_ANSWERS_DEBUG) {
    try {
      console.error(`[QA-DEBUG ${label}]`, JSON.stringify(data ?? null).slice(0, 20000));
    } catch {
      console.error(`[QA-DEBUG ${label}] <unserializable>`);
    }
  }
}

/**
 * Resolve the Qlik Sense app id bound to a Qlik Answers assistant, so a run can send it as the
 * cloud-assistants data context. Cached per `(baseUrl, assistantId)` for {@link APP_CONTEXT_TTL_MS}
 * (the binding is stable). Probes, in order: the public assistant detail, the internal cloud-assistants
 * detail, then each linked knowledge base's data sources. Throws {@link QlikAnswersAppResolutionError}
 * when nothing yields an app id (the owner-locked "STOP" case). `fetchImpl` is injectable so tests never
 * contact a real tenant.
 */
export async function resolveQlikAnswersAppContext(
  auth: QlikAnswersAuth,
  assistantId: string,
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  const key = `${auth.baseUrl}::${assistantId}`;
  const cached = appContextCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.appId;

  const headers = { authorization: `Bearer ${auth.apiKey}` };
  const get = async (path: string): Promise<unknown> => {
    try {
      const res = await fetchImpl(joinUrl(auth.baseUrl, path), { headers });
      const body = res.ok ? await res.json().catch(() => undefined) : undefined;
      qaDebug(`resolve GET ${path} -> ${res.status}`, body ?? null);
      return body;
    } catch (error) {
      qaDebug(`resolve GET ${path} threw`, toErrorMessage(error));
      return undefined;
    }
  };

  // 1) public assistant detail — may carry the app inline; always carries `knowledgeBases[]`.
  const detail = await get(`api/v1/assistants/${encodeURIComponent(assistantId)}`);
  let appId = findAppId(detail);
  // 2) internal cloud-assistants detail — the Answers UI's own source for the bound app/context.
  if (!appId) appId = findAppId(await get(`api/v1/cloud-assistants/${encodeURIComponent(assistantId)}`));
  // 3) walk the assistant's knowledge bases → their data sources for a Qlik app id.
  if (!appId) {
    const kbIds = asArray(asRecord(detail)?.knowledgeBases).filter(
      (value): value is string => typeof value === "string",
    );
    for (const kbId of kbIds) {
      appId =
        findAppId(await get(`api/v1/knowledge-bases/${encodeURIComponent(kbId)}`)) ??
        findAppId(await get(`api/v1/knowledge-bases/${encodeURIComponent(kbId)}/data-sources`)) ??
        findAppId(await get(`api/v1/knowledgebases/${encodeURIComponent(kbId)}/datasources`));
      if (appId) break;
    }
  }

  if (!appId) {
    throw new QlikAnswersAppResolutionError(
      `Could not resolve the Qlik Sense app bound to Qlik Answers assistant "${assistantId}". An ` +
        `app-backed assistant needs its app id as the run's data context, but none was present in the ` +
        `assistant detail, the cloud-assistants detail, or its knowledge-base data sources. Re-run with ` +
        `QLIK_ANSWERS_DEBUG=1 to capture the raw metadata shapes.`,
    );
  }
  appContextCache.set(key, { appId, expires: Date.now() + APP_CONTEXT_TTL_MS });
  return appId;
}

/** Test-only: clear the resolved-app-context cache between cases. */
export function _clearQlikAnswersAppContextCache(): void {
  appContextCache.clear();
}

// String-valued app-id keys, and array-valued ones. `appIds` (plural array) is what a live Qlik Answers
// **app**-backed assistant carries (verified 2026-07-11: `GET /api/v1/assistants/{id}` →
// `{ …, appIds:["<app-guid>"], knowledgeBases:[] }`). We do NOT match arbitrary arrays (e.g.
// `knowledgeBases`) — only the explicit app-id keys — so an assistant UUID or a KB id is never grabbed.
const APP_ID_STRING_KEYS = new Set(["appid", "app_id", "qlikappid", "sourceappid", "senseappid"]);
const APP_ID_ARRAY_KEYS = new Set(["appids", "app_ids"]);

/**
 * Depth-first search of Qlik metadata for a Qlik Sense app id. Field-guided (an assistant UUID is ALSO a
 * GUID, so we never grab an arbitrary GUID): matches an `appIds[]` array (the live shape) or a singular
 * app-id key, a `{type:"app", id}` context object, or a `qri:app:sense://<guid>` resource identifier.
 * Returns the FIRST match — a multi-app assistant binds its first app (a documented v1 limitation).
 */
export function findAppId(obj: unknown): string | undefined {
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = findAppId(item);
      if (found) return found;
    }
    return undefined;
  }
  const record = asRecord(obj);
  if (!record) return undefined;
  if (record.type === "app" && typeof record.id === "string" && record.id.length > 0) return record.id;
  for (const [rawKey, value] of Object.entries(record)) {
    const key = rawKey.toLowerCase();
    if (APP_ID_STRING_KEYS.has(key) && typeof value === "string" && value.length > 0) return value;
    if (APP_ID_ARRAY_KEYS.has(key) && Array.isArray(value)) {
      const first = value.find((entry) => typeof entry === "string" && entry.length > 0);
      if (typeof first === "string") return first;
    }
    if ((key === "qri" || key === "qriid" || key === "resourceid") && typeof value === "string") {
      const match =
        value.match(/app[:/]sense:\/\/([0-9a-fA-F-]{16,})/) ?? value.match(/app[:/]([0-9a-fA-F-]{16,})/);
      if (match) return match[1];
    }
  }
  for (const value of Object.values(record)) {
    const found = findAppId(value);
    if (found) return found;
  }
  return undefined;
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

/**
 * Qlik Answers `GET /api/v1/assistants` (roadmap/qlik-answers/, WP 0.3) — bearer-authed, cursor
 * paged via `links.next.href` (a full URL to the next page; verified against the public
 * `qlik-oss/qlik-api-ts` generated types + qlik.dev OpenAPI spec for the assistants API — the
 * response is `{ data: Assistant[], links?: { next?: { href } }, meta? }`). This call is list-only
 * and consumes no question. `cred.apiKey` carries either the tenant API key or — for a
 * server-linked credential — the resolved OAuth access token (WP 0.2 populates that
 * transparently); this function only ever reads `apiKey`/`baseUrl`.
 *
 * CLASSIC-ONLY FILTER (D-QA7) — NOT APPLIED, FLAGGED FOR THE OWNER: the public `Assistant` schema
 * (qlik.dev OpenAPI spec + the generated TS types, checked 2026-07-11) has NO field that
 * distinguishes a classic assistant from an agentic one — no `type`/`kind`/`mode`/`assistantType`.
 * The one anomaly, an undocumented `legacy` entry in the OpenAPI schema's `required` array with
 * ZERO type/description in `properties`, is too ambiguous to hang a filtering decision on (unknown
 * type, unverified semantics, never checked against a live tenant). This is exactly the stop
 * condition the qlik-answers kickoff prompt pre-flagged ("the assistants list API can't
 * distinguish classic vs agentic — affects D-QA7 filtering"). Until the owner confirms a real
 * field (or another signal) against a live tenant, this roster returns EVERY assistant the tenant
 * reports, unfiltered — do not silently narrow this list without a documented, verified field.
 */
async function listQlikAnswers(
  cred: DecryptedCredential,
  fetchImpl: FetchLike,
): Promise<AvailableModel[]> {
  const baseUrl = requireBaseUrl(cred, "qlik_answers");
  const apiKey = requireKey(cred, "Qlik Answers");
  const headers = { authorization: `Bearer ${apiKey}` };
  const out: AvailableModel[] = [];
  let url: string | undefined = `${joinUrl(baseUrl, "api/v1/assistants")}?limit=100`;
  for (let page = 0; page < MAX_PAGES && url; page += 1) {
    const payload = await fetchJson(url, headers, "Qlik Answers", fetchImpl);
    const record = asRecord(payload);
    out.push(...parseQlikAnswersAssistants(record?.data));
    url = asString(asRecord(asRecord(record?.links)?.next)?.href);
  }
  return sortModels(out);
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

/**
 * Qlik Answers assistants `data[]` entries → `AvailableModel { id, displayName }`. Per the
 * `Assistant` schema, `id` is the assistant's uuid and `name` its display name (`title` is a
 * separate, optional, human-facing field the schema doesn't guarantee — `name` is required).
 * See {@link listQlikAnswers} for why no classic/agentic filter is applied here.
 */
export function parseQlikAnswersAssistants(payload: unknown): AvailableModel[] {
  const out: AvailableModel[] = [];
  for (const entry of asArray(payload)) {
    const record = asRecord(entry);
    const id = asString(record?.id);
    if (!id) continue;
    out.push({ id, displayName: asString(record?.name) });
  }
  return out;
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
