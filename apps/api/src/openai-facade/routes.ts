/**
 * The OpenAI-compatible facade routes (WP4.1; hardened WP4.2) — a self-contained Fastify plugin
 * mounted at `/openai/v1`. `registerOpenAiFacade(app, deps)` is wired by WP5.1 with ONE line in
 * `apps/api/src/index.ts` (see the WP report); tests build a Fastify instance in-test and register
 * it with stubbed deps, so this module's gate is green without touching `index.ts`.
 *
 * Endpoints (research 04 §3):
 *   - `POST /openai/v1/chat/completions` — hold-back streaming (default) or a non-streaming
 *     completion; reasoning mirrored live, the settled extracted answer emitted as the final content;
 *     a usage chunk always emitted; AE-4 → `content_filter`; vendor fields (`qlik_answers` + `citations`);
 *     admission-controlled by a per-facade concurrency cap (WP4.2, `concurrency.ts`) → `429` +
 *     `Retry-After` over capacity; the settled hold-back can be swapped for live raw-delta streaming
 *     via the `live-stream` config flag (WP4.2, `config.ts`, OFF by default per D-US12). The thread-
 *     affinity cache always stores under the key the CLIENT actually saw (the live deltas in
 *     live-stream mode, the settled text otherwise — WP4.R GAP-2 fix) so an honest append still
 *     reuses the thread even when live text drifts from the settled answer.
 *   - `GET /openai/v1/models` — the resolvable Qlik assistants, listed as models (`owned_by: "qlik"`).
 *
 * Errors use the OpenAI envelope `{ error: { message, type, param, code } }` — this module NEVER lets
 * an error reach the app's central handler (whose shape differs). The facade key never appears in a
 * response, log, or the tenant call.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { DEFAULT_TOKEN_PROFILE, type TokenProfileId } from "@mcp-token-footprint/shared";
import { checkFacadeAuth } from "./auth.js";
import { ThreadAffinityCache } from "./affinity-cache.js";
import {
  DEFAULT_FACADE_CONCURRENCY_RETRY_AFTER_SECONDS,
  resolveLiveStream,
  resolveMaxConcurrency,
} from "./config.js";
import { FacadeConcurrencyLimiter } from "./concurrency.js";
import { badRequest, FacadeContentFilterError, FacadeError, modelNotFound } from "./mapping.js";
import { consumeQlikStream, openQlikStream, type OpenStreamArgs } from "./qlik-call.js";
import { messageText } from "./affinity-cache.js";
import {
  buildVendorFields,
  completionResponse,
  contentChunk,
  estimateUsage,
  finishChunk,
  newCompletionId,
  reasoningChunk,
  rejectedVendorFields,
  roleChunk,
  sseFrame,
  SSE_DONE,
  usageChunk,
} from "./translator.js";
import type { ChatMessage, OpenAiFacadeDeps, QlikAnswersAuth } from "./types.js";

const O200K_PROFILE: TokenProfileId = "generic_o200k";

/** Register the facade at `/openai/v1`. Returns nothing; throws only on a genuine registration bug. */
export async function registerOpenAiFacade(
  app: FastifyInstance,
  deps: OpenAiFacadeDeps,
): Promise<void> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const profile: TokenProfileId = deps.tokenProfile ?? O200K_PROFILE ?? DEFAULT_TOKEN_PROFILE;
  const now = deps.now ?? Date.now;
  const cache = new ThreadAffinityCache({
    maxEntries: deps.cache?.maxEntries,
    ttlMs: deps.cache?.ttlMs,
    now,
  });
  // WP4.2 — facade-side admission control + the live-stream opt-in (both resolved ONCE at
  // registration: an explicit dep wins, else the documented env var, else the default; see
  // config.ts). `limiter` guards `/chat/completions` only — GET /models never calls the tenant.
  const limiter = new FacadeConcurrencyLimiter(
    resolveMaxConcurrency(deps.maxConcurrency),
    DEFAULT_FACADE_CONCURRENCY_RETRY_AFTER_SECONDS,
  );
  const liveStream = resolveLiveStream(deps.liveStream);

  app.get("/openai/v1/models", async (request, reply) => {
    try {
      checkFacadeAuth(request.headers.authorization, deps.facadeKey);
      const models = await deps.listModels();
      const created = Math.floor(now() / 1000);
      return reply.code(200).send({
        object: "list",
        data: models.map((m) => ({
          id: m.id,
          object: "model",
          created,
          owned_by: "qlik",
          ...(m.displayName ? { display_name: m.displayName } : {}),
        })),
      });
    } catch (error) {
      return sendError(reply, error, false);
    }
  });

  app.post("/openai/v1/chat/completions", async (request, reply) => {
    let committed = false;
    let acquiredSlot = false;
    try {
      checkFacadeAuth(request.headers.authorization, deps.facadeKey);
      const parsed = parseChatRequest(request.body);
      const auth = await Promise.resolve(deps.resolveModel(parsed.model));
      if (!auth) throw modelNotFound(parsed.model);

      // WP4.2 admission control: auth/parse/model-resolution above never touch the tenant, so they
      // never consume a slot; everything below always does (thread create-or-reuse, actions/stream,
      // the settled messages fetch) — acquire right before that work starts, release once this
      // whole request (streaming or not) has fully settled (see the outer `finally`).
      if (!limiter.tryAcquire()) throw limiter.rejection();
      acquiredSlot = true;

      const prompt = lastUserPrompt(parsed.messages);
      const id = newCompletionId();
      const created = Math.floor(now() / 1000);
      const cachedThreadId = cache.lookup(parsed.model, parsed.messages);

      const controller = new AbortController();
      // Abort the tenant fetch if the client disconnects mid-stream (best-effort cleanup).
      request.raw.on("close", () => {
        if (!reply.raw.writableEnded) controller.abort();
      });
      const openArgs: OpenStreamArgs = {
        auth,
        assistantId: parsed.model,
        prompt,
        fetchImpl,
        signal: controller.signal,
        ...(cachedThreadId ? { existingThreadId: cachedThreadId } : {}),
      };

      if (!parsed.stream) {
        return await handleNonStreaming({
          reply,
          openArgs,
          model: parsed.model,
          messages: parsed.messages,
          prompt,
          id,
          created,
          profile,
          cache,
          cachedThreadId,
        });
      }

      // ── Streaming (hold-back default) ──────────────────────────────────────────────────────────
      let open: Awaited<ReturnType<typeof openQlikStream>>;
      try {
        open = await openQlikStream(openArgs);
      } catch (error) {
        if (error instanceof FacadeContentFilterError) {
          committed = true;
          writeSseHead(reply);
          await writeRejectedStream(reply, {
            id,
            model: parsed.model,
            created,
            prompt,
            profile,
            threadId: cachedThreadId,
            assistantVersion: error.assistantVersion,
          });
          return;
        }
        return sendError(reply, error, false);
      }

      // The stream POST succeeded — commit the SSE head; from here errors surface in-stream.
      committed = true;
      writeSseHead(reply);
      writeChunk(reply, roleChunk(id, parsed.model, created));
      try {
        // WP4.2 live-stream (opt-in, default OFF — D-US12 keeps hold-back the default): when ON,
        // every raw answer chunk is ALSO forwarded live as a `content` delta, in addition to being
        // accumulated for the fallback below. `liveAnswerStreamed` tracks whether anything was
        // actually forwarded so the settled content is still emitted as a safety net if the tenant
        // stream carried NO live answer text at all (matches hold-back's own fallback behavior).
        // `liveAnswerText` accumulates exactly what was forwarded — the CLIENT's view of the answer.
        let liveAnswerStreamed = false;
        let liveAnswerText = "";
        const answer = await consumeQlikStream(
          open,
          openArgs,
          (text) => writeChunk(reply, reasoningChunk(id, parsed.model, created, text)),
          liveStream
            ? (text) => {
                liveAnswerStreamed = true;
                liveAnswerText += text;
                writeChunk(reply, contentChunk(id, parsed.model, created, text));
              }
            : undefined,
        );
        // WP4.R GAP-2 fix: the affinity cache's store key MUST match what the client actually
        // received and will echo back on its next turn. In live-stream mode that's the raw live
        // deltas (`liveAnswerText`), which can drift from the settled `answer.answer` — storing the
        // settled text under a key the client will never reproduce silently forks a new Qlik thread
        // on every appended turn (undocumented amnesia the user-guide doesn't promise). When nothing
        // streamed live (empty-card fallback, or hold-back with `liveStream` off), the client's only
        // view IS the settled answer, so the store key is unchanged. The settled truth still rides
        // the `qlik_answers` vendor field regardless of which text keys the cache.
        const cacheAnswerText = liveAnswerStreamed ? liveAnswerText : answer.answer;
        cache.store(parsed.model, parsed.messages, cacheAnswerText, answer.threadId);
        if (answer.answer && !liveAnswerStreamed)
          writeChunk(reply, contentChunk(id, parsed.model, created, answer.answer));
        const usage = await estimateUsage(prompt, answer.answer, profile);
        writeChunk(
          reply,
          finishChunk(id, parsed.model, created, "stop", buildVendorFields(parsed.model, answer)),
        );
        writeChunk(reply, usageChunk(id, parsed.model, created, usage));
        writeDone(reply);
      } catch (error) {
        // Post-commit failure (e.g. the settled-message fetch): SSE is open, so no HTTP status is
        // possible — emit a terminal error frame then close.
        const message =
          error instanceof FacadeError
            ? error.message
            : "Upstream error while settling the answer.";
        writeRaw(
          reply,
          `data: ${JSON.stringify({ error: { message, type: "api_error", code: "upstream_error", param: null } })}\n\n`,
        );
        writeDone(reply);
      } finally {
        endStream(reply);
      }
      return;
    } catch (error) {
      return sendError(reply, error, committed);
    } finally {
      if (acquiredSlot) limiter.release();
    }
  });
}

// ── Non-streaming ───────────────────────────────────────────────────────────────────────────────

async function handleNonStreaming(ctx: {
  reply: FastifyReply;
  openArgs: OpenStreamArgs;
  model: string;
  messages: ChatMessage[];
  prompt: string;
  id: string;
  created: number;
  profile: TokenProfileId;
  cache: ThreadAffinityCache;
  cachedThreadId: string | undefined;
}): Promise<FastifyReply> {
  try {
    const open = await openQlikStream(ctx.openArgs);
    const answer = await consumeQlikStream(open, ctx.openArgs);
    ctx.cache.store(ctx.model, ctx.messages, answer.answer, answer.threadId);
    const usage = await estimateUsage(ctx.prompt, answer.answer, ctx.profile);
    return ctx.reply.code(200).send(
      completionResponse({
        id: ctx.id,
        model: ctx.model,
        created: ctx.created,
        content: answer.answer,
        ...(answer.reasoning ? { reasoning: answer.reasoning } : {}),
        finishReason: "stop",
        usage,
        vendor: buildVendorFields(ctx.model, answer),
      }),
    );
  } catch (error) {
    if (error instanceof FacadeContentFilterError) {
      const usage = await estimateUsage(ctx.prompt, "", ctx.profile);
      return ctx.reply.code(200).send(
        completionResponse({
          id: ctx.id,
          model: ctx.model,
          created: ctx.created,
          content: "",
          finishReason: "content_filter",
          usage,
          vendor: rejectedVendorFields(ctx.model, {
            threadId: ctx.cachedThreadId,
            assistantVersion: error.assistantVersion,
          }),
        }),
      );
    }
    return sendError(ctx.reply, error, false);
  }
}

/** Emit the SSE frames for an AE-4 (content_filter) turn: role → finish(content_filter) → usage → [DONE]. */
async function writeRejectedStream(
  reply: FastifyReply,
  ctx: {
    id: string;
    model: string;
    created: number;
    prompt: string;
    profile: TokenProfileId;
    threadId: string | undefined;
    assistantVersion: string | undefined;
  },
): Promise<void> {
  writeChunk(reply, roleChunk(ctx.id, ctx.model, ctx.created));
  writeChunk(
    reply,
    finishChunk(
      ctx.id,
      ctx.model,
      ctx.created,
      "content_filter",
      rejectedVendorFields(ctx.model, {
        threadId: ctx.threadId,
        assistantVersion: ctx.assistantVersion,
      }),
    ),
  );
  const usage = await estimateUsage(ctx.prompt, "", ctx.profile);
  writeChunk(reply, usageChunk(ctx.id, ctx.model, ctx.created, usage));
  writeDone(reply);
  endStream(reply);
}

// ── Request parsing ─────────────────────────────────────────────────────────────────────────────

type ParsedChatRequest = { model: string; messages: ChatMessage[]; stream: boolean };

/** Validate + normalize the chat request body into the fields the facade uses. */
export function parseChatRequest(body: unknown): ParsedChatRequest {
  const record = asRecord(body);
  if (!record) throw badRequest("The request body must be a JSON object.");

  const model = record.model;
  if (typeof model !== "string" || model.trim().length === 0) {
    throw badRequest("you must provide a model parameter", "model");
  }

  const rawMessages = record.messages;
  if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
    throw badRequest(
      "you must provide the messages parameter with at least one message",
      "messages",
    );
  }
  const messages: ChatMessage[] = rawMessages.map((entry) => {
    const m = asRecord(entry);
    const role = typeof m?.role === "string" ? m.role : "user";
    const content = (m?.content ?? null) as ChatMessage["content"];
    return { role, content };
  });

  return { model: model.trim(), messages, stream: record.stream === true };
}

/** The prompt sent to Qlik: the LAST user message's text (falls back to the last message overall). */
export function lastUserPrompt(messages: ChatMessage[]): string {
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const source = lastUser ?? messages[messages.length - 1];
  const text = source ? messageText(source.content).trim() : "";
  if (!text) throw badRequest("the final message must contain non-empty user text", "messages");
  return text;
}

// ── SSE + error plumbing ──────────────────────────────────────────────────────────────────────────

function writeSseHead(reply: FastifyReply): void {
  reply.hijack();
  reply.raw.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
}

function writeChunk(reply: FastifyReply, chunk: Parameters<typeof sseFrame>[0]): void {
  writeRaw(reply, sseFrame(chunk));
}

function writeRaw(reply: FastifyReply, text: string): void {
  if (!reply.raw.writableEnded) reply.raw.write(text);
}

function writeDone(reply: FastifyReply): void {
  writeRaw(reply, SSE_DONE);
}

function endStream(reply: FastifyReply): void {
  if (!reply.raw.writableEnded) reply.raw.end();
}

/**
 * Render an error as an OpenAI envelope. When the SSE stream is already committed (`committed`) a
 * status can't be sent, so a terminal error frame is emitted instead. A non-{@link FacadeError} is
 * masked as a generic 500 (its message is never leaked to the client / logs).
 */
function sendError(reply: FastifyReply, error: unknown, committed: boolean): FastifyReply {
  const facade =
    error instanceof FacadeError
      ? error
      : new FacadeError({
          httpStatus: 500,
          type: "api_error",
          code: null,
          message: "Internal facade error.",
        });

  if (committed) {
    writeRaw(reply, `data: ${JSON.stringify(facade.envelope())}\n\n`);
    writeDone(reply);
    endStream(reply);
    return reply;
  }
  if (facade.retryAfterSeconds !== undefined) {
    reply.header("retry-after", String(facade.retryAfterSeconds));
  }
  return reply.code(facade.httpStatus).send(facade.envelope());
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export type { OpenAiFacadeDeps, QlikAnswersAuth };
