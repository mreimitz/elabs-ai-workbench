/**
 * The Qlik Answers call sequence behind the facade (WP4.1). It performs the SAME cloud-assistants
 * flow the internal executor does — resolve app context → (reuse|create) thread → `actions/stream` →
 * fetch the settled message → extract — but the executor is UNTOUCHED (D-US12). Answer extraction
 * REUSES the executor's exported pure functions, so the settled answer is **byte-identical** to the
 * executor's for the same tenant message (proven by a golden test). Thread creation is factored so
 * an affinity cache hit can REUSE a thread (which the executor can't do), the one behavior the
 * facade adds on top.
 *
 * The split (`openQlikStream` = pre-commit, `consumeQlikStream` = post-commit) exists so the route
 * can decide the HTTP status BEFORE writing any SSE frame: pre-flight failures (unresolvable app,
 * thread create, the `actions/stream` POST itself) map to HTTP status codes; `AE-4` surfaces as a
 * `content_filter` finish; only once the stream is OPEN does the route commit the SSE head and pipe
 * reasoning live, then settle the held-back answer.
 *
 * Every tenant fetch goes through the injected `fetchImpl` — a real tenant is NEVER contacted from
 * tests (the repo invariant).
 */

import type { AnswersSnapshot, ReasoningSection } from "@mcp-token-footprint/shared";
import {
  QlikAnswersAppResolutionError,
  resolveQlikAnswersAppContext,
  type QlikAnswersAuth,
} from "../providers/model-catalog.js";
import { extractAnswerMessage, findMessageById } from "../testing/qlik-answers-message.js";
import { parseReasoningSections } from "../testing/qlik-answers-reasoning.js";
import { QlikAnswersSseParser, QlikReasoningCleaner } from "../testing/qlik-answers-sse.js";
import {
  classifyUpstream,
  extractAeCode,
  FacadeContentFilterError,
  modelNotFound,
} from "./mapping.js";
import type { FacadeAnswer } from "./types.js";

/** The data context binding a Qlik Sense app in live mode (mirrors the executor / `call_answers.py`). */
function appContext(appId: string): { type: "app"; id: string; data: { mode: "live" } } {
  return { type: "app", id: appId, data: { mode: "live" } };
}

function authHeaders(apiKey: string): Record<string, string> {
  return {
    authorization: `Bearer ${apiKey}`,
    "content-type": "application/json",
    accept: "application/json",
  };
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

/** Read a non-OK response body as JSON (best-effort) so the error classifier can see any `AE-x` code. */
async function readErrorBody(response: Response): Promise<unknown> {
  try {
    return await response.clone().json();
  } catch {
    try {
      return await response.clone().text();
    } catch {
      return undefined;
    }
  }
}

export type OpenStreamArgs = {
  auth: QlikAnswersAuth;
  assistantId: string;
  prompt: string;
  fetchImpl: typeof fetch;
  signal: AbortSignal;
  /** A cached thread to REUSE (affinity hit); when absent, a fresh thread is created. */
  existingThreadId?: string;
};

export type OpenStreamResult = {
  threadId: string;
  appId: string;
  /** The OK `actions/stream` response, body not yet read (consumed by {@link consumeQlikStream}). */
  response: Response;
  assistantVersion?: string;
};

/**
 * Pre-commit: resolve app context, (reuse|create) the thread, and issue the `actions/stream` POST.
 * Returns the OK response (ready to stream) — or throws a mapped error BEFORE anything is sent to
 * the client:
 *   - {@link QlikAnswersAppResolutionError} → 404 `model_not_found`;
 *   - a thread-create / stream-POST failure → {@link classifyUpstream} (429 / 401 / 502);
 *   - a Qlik `AE-4` on the stream POST → {@link FacadeContentFilterError} (→ a `content_filter` finish).
 */
export async function openQlikStream(args: OpenStreamArgs): Promise<OpenStreamResult> {
  let appId: string;
  try {
    appId = await resolveQlikAnswersAppContext(args.auth, args.assistantId, args.fetchImpl);
  } catch (error) {
    if (error instanceof QlikAnswersAppResolutionError) {
      throw modelNotFound(args.assistantId, error.message);
    }
    throw error;
  }

  const threadId = args.existingThreadId ?? (await createThread(args, appId));

  const url = joinUrl(
    args.auth.baseUrl,
    `api/v1/cloud-assistants/${encodeURIComponent(threadId)}/actions/stream`,
  );
  const body = { context: appContext(appId), content: [{ text: args.prompt }] };
  const response = await args.fetchImpl(url, {
    method: "POST",
    headers: authHeaders(args.auth.apiKey),
    body: JSON.stringify(body),
    signal: args.signal,
  });

  if (!response.ok) {
    const errorBody = await readErrorBody(response);
    // AE-4 "Prompt is rejected" → a content_filter finish, NOT an HTTP error.
    if (extractAeCode(errorBody) === "AE-4") {
      throw new FacadeContentFilterError(undefined, response.headers.get("etag") ?? undefined);
    }
    throw classifyUpstream(response.status, errorBody, response.headers, "stream");
  }

  return {
    threadId,
    appId,
    response,
    assistantVersion: response.headers.get("etag") ?? undefined,
  };
}

/** Create the (kept) cloud-assistants thread bound to the resolved app. Non-OK → a mapped error. */
async function createThread(args: OpenStreamArgs, appId: string): Promise<string> {
  const url = joinUrl(args.auth.baseUrl, "api/v1/cloud-assistants/threads");
  const facadeThreadName = `mcpfp facade ${Math.random().toString(36).slice(2, 10)}`;
  const response = await args.fetchImpl(url, {
    method: "POST",
    headers: authHeaders(args.auth.apiKey),
    body: JSON.stringify({ name: facadeThreadName, context: appContext(appId) }),
    signal: args.signal,
  });
  if (!response.ok) {
    throw classifyUpstream(
      response.status,
      await readErrorBody(response),
      response.headers,
      "thread",
    );
  }
  const parsed = (await response.json().catch(() => ({}))) as { id?: unknown };
  if (typeof parsed.id !== "string" || parsed.id.length === 0) {
    throw classifyUpstream(502, { message: "no thread id" }, response.headers, "thread");
  }
  return parsed.id;
}

/**
 * Post-commit: read the `actions/stream` body — piping cleaned reasoning text LIVE via `onReasoning`
 * (hold-back streams reasoning, holds the answer) — then fetch the settled message and extract the
 * authoritative answer. The answer is `extractAnswerMessage(...).answer || streamedText`, the EXACT
 * same fallback the executor uses, so a golden test can assert byte-identity. A messages-fetch
 * failure throws a mapped error (the caller decides how to surface it once SSE is already open).
 *
 * `onAnswerDelta` is the WP4.2 **live-stream** seam: hold-back (`onAnswerDelta` omitted, the
 * default) still accumulates every raw answer chunk into `streamedText` as a fallback ONLY — never
 * forwarded live. When the caller passes `onAnswerDelta` (the `live-stream` config flag is ON), the
 * SAME raw chunks are ALSO forwarded to it AS THEY ARRIVE, in addition to the fallback accumulation
 * — an explicit opt-in that accepts live/settled drift (research 04 §4 M2); the route layer decides
 * whether the settled answer is still emitted afterward.
 */
export async function consumeQlikStream(
  open: OpenStreamResult,
  args: OpenStreamArgs,
  onReasoning?: (text: string) => void,
  onAnswerDelta?: (text: string) => void,
): Promise<FacadeAnswer> {
  const parser = new QlikAnswersSseParser();
  const reasoningCleaner = new QlikReasoningCleaner();
  let messageId: string | undefined;
  let streamedText = "";
  let reasoning = "";

  const apply = (chunk: ReturnType<QlikAnswersSseParser["push"]>[number]): void => {
    if (chunk.kind === "messageId") {
      messageId = chunk.messageId;
    } else if (chunk.kind === "reasoning") {
      const clean = reasoningCleaner.push(chunk.text);
      if (clean) {
        reasoning += clean;
        onReasoning?.(clean);
      }
    } else if (chunk.kind === "answer") {
      // Hold-back (default): the live answer text is accumulated as a FALLBACK only; it is never
      // streamed to the client — the settled, extracted answer (below) is the truth (research 04
      // §4 M2). live-stream (WP4.2, opt-in): the SAME chunk is ALSO forwarded live via `onAnswerDelta`.
      //
      // assistant-hub v1-fixes (F8) — OVERLAP GUARD: observed tenant streams occasionally re-send the
      // tail of the previous frame at the head of the next one, which verbatim accumulation turned
      // into mid-word duplication in settled hub messages ("visualizations:izations:izations:",
      // repeated sentence tails — mission-session-analysis-2026-07-20.md, collateral finding 3). When
      // an incoming chunk's head replicates the accumulated tail for ≥ MIN_ANSWER_OVERLAP chars, the
      // duplicated head is dropped. The threshold keeps legitimate short repetitions ("no no no")
      // untouched; only pathological frame overlaps are deduplicated.
      const appended = dropStreamOverlap(streamedText, chunk.text);
      streamedText += appended;
      if (appended) onAnswerDelta?.(appended);
    }
  };

  const body = open.response.body;
  if (body) {
    const decoder = new TextDecoder();
    const iterable = body as unknown as AsyncIterable<Uint8Array>;
    for await (const bytes of iterable) {
      for (const chunk of parser.push(decoder.decode(bytes, { stream: true }))) apply(chunk);
    }
    const tail = decoder.decode();
    if (tail) for (const chunk of parser.push(tail)) apply(chunk);
  } else {
    for (const chunk of parser.push(await open.response.text())) apply(chunk);
  }
  for (const chunk of parser.finish()) apply(chunk);
  const reasoningTail = reasoningCleaner.flush();
  if (reasoningTail) {
    reasoning += reasoningTail;
    onReasoning?.(reasoningTail);
  }

  const message = await fetchAnswerMessage(open, args, messageId);
  const extracted = extractAnswerMessage(message);
  const answer = extracted.answer || streamedText;
  const reasoningText = (extracted.reasoning ?? reasoning).trim() || reasoning.trim();
  const sections: ReasoningSection[] = reasoningText
    ? parseReasoningSections(reasoningText, answer)
    : [];
  const snapshots: AnswersSnapshot[] = extracted.snapshots;

  return {
    answer,
    reasoning: reasoning.trim(),
    threadId: open.threadId,
    appId: open.appId,
    ...(messageId ? { messageId } : {}),
    ...(open.assistantVersion ? { assistantVersion: open.assistantVersion } : {}),
    expressions: extracted.expressions,
    snapshots,
    ...(extracted.blocks && extracted.blocks.length > 0 ? { blocks: extracted.blocks } : {}),
    reasoningSections: sections,
    sources: [],
    rawResponse: message,
    questionsConsumed: 1,
  };
}

/** Fetch the answer message from the thread and pick the one matching `messageId` (fallback: last). */
async function fetchAnswerMessage(
  open: OpenStreamResult,
  args: OpenStreamArgs,
  messageId: string | undefined,
): Promise<unknown> {
  const url = joinUrl(
    args.auth.baseUrl,
    `api/v1/cloud-assistants/threads/${encodeURIComponent(open.threadId)}/messages`,
  );
  const response = await args.fetchImpl(url, {
    method: "GET",
    headers: authHeaders(args.auth.apiKey),
    signal: args.signal,
  });
  if (!response.ok) {
    throw classifyUpstream(
      response.status,
      await readErrorBody(response),
      response.headers,
      "messages",
    );
  }
  const payload = await response.json().catch(() => undefined);
  const message = findMessageById(payload, messageId);
  if (message === undefined) {
    throw classifyUpstream(502, { message: "no messages" }, response.headers, "messages");
  }
  return message;
}

// ── assistant-hub v1-fixes (F8) — the answer-stream overlap guard ─────────────────────────────────

/** Minimum head/tail replication length treated as a frame overlap (below it, repetition is assumed
 *  to be legitimate text — "no no no" must survive). */
export const MIN_ANSWER_OVERLAP = 8;
/** How far back the overlap scan looks — frame overlaps are short; no need to scan a whole answer. */
const MAX_ANSWER_OVERLAP_SCAN = 400;

/**
 * Return the part of `incoming` that should actually be appended to `existing`: when the head of
 * `incoming` replicates the tail of `existing` for at least {@link MIN_ANSWER_OVERLAP} chars, that
 * duplicated head is dropped (longest overlap wins). Pure; unit-tested against the duplication shapes
 * observed in settled hub messages ("visualizations:izations:", repeated sentence tails).
 */
export function dropStreamOverlap(existing: string, incoming: string): string {
  if (!incoming) return "";
  const max = Math.min(existing.length, incoming.length, MAX_ANSWER_OVERLAP_SCAN);
  for (let k = max; k >= MIN_ANSWER_OVERLAP; k--) {
    if (existing.endsWith(incoming.slice(0, k))) return incoming.slice(k);
  }
  return incoming;
}
