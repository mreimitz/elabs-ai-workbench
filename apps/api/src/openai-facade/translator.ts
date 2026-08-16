/**
 * Translator (WP4.1) — turns a settled {@link FacadeAnswer} into OpenAI Chat Completions output:
 * streaming `chat.completion.chunk` frames (hold-back order) or one non-streaming `chat.completion`.
 *
 * Contract facts honored (research 04 §1, OpenAI OpenAPI spec):
 *   - streaming = SSE `chat.completion.chunk` frames with `choices[].delta.{role,content}`,
 *     terminated by `data: [DONE]`;
 *   - a final **usage** chunk (empty `choices`, populated `usage`) is emitted BEFORE `[DONE]` — the
 *     facade emits it **unconditionally** (WP4.1), harmless to strict clients;
 *   - reasoning uses the de-facto `reasoning_content` field (mirrored to `reasoning`), which
 *     `@ai-sdk/openai-compatible` parses into first-class reasoning parts;
 *   - citations use Perplexity's top-level `citations`; full Qlik fidelity lives under the vendor
 *     field `qlik_answers` (both on the finish chunk / completion object);
 *   - `finish_reason ∈ stop | content_filter` here (`length`/`tool_calls` never occur).
 *
 * **Hold-back streaming (default).** `reasoning_content` is streamed LIVE as it arrives (see the
 * qlik-call sequence); the ANSWER text is held back and emitted as ONE settled `content` delta —
 * never a half-parsed answer. (A `live-stream` config flag is WP4.2; this module just leaves the
 * seam — the caller decides when to call {@link contentChunk}.)
 */

import crypto from "node:crypto";
import type { TokenProfileId } from "@mcp-token-footprint/shared";
import { DEFAULT_TOKEN_PROFILE } from "@mcp-token-footprint/shared";
import { estimateRequestCost } from "../providers/pricing.js";
import { getTokenCounter } from "../token-counting/profiles.js";
import type { FacadeAnswer } from "./types.js";

export type FinishReason = "stop" | "content_filter";

export type OpenAiUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
};

/** The `qlik_answers` vendor object + Perplexity-style `citations` attached to the output. */
export type FacadeVendorFields = {
  citations: import("@mcp-token-footprint/shared").AnswersSource[];
  qlik_answers: {
    threadId: string;
    appId: string;
    messageId?: string;
    assistantVersion?: string;
    questionsConsumed: number;
    /** Every token figure is OUR estimate — the Qlik API reports no usage (M4). */
    estimatedTokens: true;
    costUsd: number;
    expressions?: string[];
    snapshots?: import("@mcp-token-footprint/shared").AnswersSnapshot[];
    blocks?: import("@mcp-token-footprint/shared").AnswersAnswerBlock[];
    reasoningSections?: import("@mcp-token-footprint/shared").ReasoningSection[];
    rejected?: boolean;
  };
};

export type ChatCompletionChunk = {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: "assistant";
      content?: string;
      reasoning_content?: string;
      reasoning?: string;
    };
    finish_reason: FinishReason | null;
  }>;
  usage?: OpenAiUsage;
  /** Perplexity-style top-level citations (present on the finish chunk). */
  citations?: FacadeVendorFields["citations"];
  /** Full vendor fidelity on the finish chunk; the minimal `{ estimatedTokens: true }` marker on the usage chunk. */
  qlik_answers?: FacadeVendorFields["qlik_answers"] | { estimatedTokens: true };
};

export type ChatCompletion = {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: { role: "assistant"; content: string; reasoning_content?: string };
    finish_reason: FinishReason;
  }>;
  usage: OpenAiUsage;
} & FacadeVendorFields;

/** A fresh completion id (`chatcmpl-…`), stable across all chunks of one response. */
export function newCompletionId(): string {
  return `chatcmpl-${crypto.randomBytes(16).toString("hex")}`;
}

const base = (id: string, model: string, created: number) => ({
  id,
  object: "chat.completion.chunk" as const,
  created,
  model,
});

/** First streaming chunk: announces the assistant role. */
export function roleChunk(id: string, model: string, created: number): ChatCompletionChunk {
  return {
    ...base(id, model, created),
    choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
  };
}

/** A live reasoning delta — `reasoning_content` mirrored into `reasoning` (research 04 §1). */
export function reasoningChunk(
  id: string,
  model: string,
  created: number,
  text: string,
): ChatCompletionChunk {
  return {
    ...base(id, model, created),
    choices: [
      { index: 0, delta: { reasoning_content: text, reasoning: text }, finish_reason: null },
    ],
  };
}

/** The settled answer as a `content` delta (hold-back: emitted once the answer is final). */
export function contentChunk(
  id: string,
  model: string,
  created: number,
  text: string,
): ChatCompletionChunk {
  return {
    ...base(id, model, created),
    choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
  };
}

/** The finish chunk — empty delta + `finish_reason`, carrying the vendor fields (citations + qlik_answers). */
export function finishChunk(
  id: string,
  model: string,
  created: number,
  finishReason: FinishReason,
  vendor: FacadeVendorFields,
): ChatCompletionChunk {
  return {
    ...base(id, model, created),
    choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
    citations: vendor.citations,
    qlik_answers: vendor.qlik_answers,
  };
}

/**
 * The final usage chunk (`choices: []`, populated `usage`) emitted before `[DONE]`. Carries the
 * `estimatedTokens` marker in a minimal vendor field so a client that only reads the usage chunk
 * still sees the metering is estimated (WP4.1).
 */
export function usageChunk(
  id: string,
  model: string,
  created: number,
  usage: OpenAiUsage,
): ChatCompletionChunk {
  return {
    ...base(id, model, created),
    choices: [],
    usage,
    qlik_answers: { estimatedTokens: true },
  };
}

/** A whole non-streaming `chat.completion` (stream:false) — the settled answer in one shot. */
export function completionResponse(args: {
  id: string;
  model: string;
  created: number;
  content: string;
  reasoning?: string;
  finishReason: FinishReason;
  usage: OpenAiUsage;
  vendor: FacadeVendorFields;
}): ChatCompletion {
  return {
    id: args.id,
    object: "chat.completion",
    created: args.created,
    model: args.model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: args.content,
          ...(args.reasoning ? { reasoning_content: args.reasoning } : {}),
        },
        finish_reason: args.finishReason,
      },
    ],
    usage: args.usage,
    citations: args.vendor.citations,
    qlik_answers: args.vendor.qlik_answers,
  };
}

/**
 * Build the vendor fields from a settled answer. `citations` is the Perplexity-style top-level slot
 * (the document `sources`, `[]` for an app-backed assistant); `qlik_answers` carries the full Qlik
 * fidelity losslessly for AI-SDK callers (`metadataExtractor` → `providerMetadata`).
 */
export function buildVendorFields(
  model: string,
  answer: FacadeAnswer,
  opts?: { rejected?: boolean },
): FacadeVendorFields {
  return {
    citations: answer.sources,
    qlik_answers: {
      threadId: answer.threadId,
      appId: answer.appId,
      ...(answer.messageId ? { messageId: answer.messageId } : {}),
      ...(answer.assistantVersion ? { assistantVersion: answer.assistantVersion } : {}),
      questionsConsumed: answer.questionsConsumed,
      estimatedTokens: true,
      costUsd: estimateRequestCost(model, answer.questionsConsumed),
      ...(answer.expressions.length > 0 ? { expressions: answer.expressions } : {}),
      ...(answer.snapshots.length > 0 ? { snapshots: answer.snapshots } : {}),
      ...(answer.blocks && answer.blocks.length > 0 ? { blocks: answer.blocks } : {}),
      ...(answer.reasoningSections.length > 0
        ? { reasoningSections: answer.reasoningSections }
        : {}),
      ...(opts?.rejected ? { rejected: true } : {}),
    },
  };
}

/** The vendor fields for a rejected (AE-4 → content_filter) turn — no answer, minimal identity. */
export function rejectedVendorFields(
  model: string,
  ctx: { threadId?: string; appId?: string; assistantVersion?: string },
): FacadeVendorFields {
  return {
    citations: [],
    qlik_answers: {
      threadId: ctx.threadId ?? "",
      appId: ctx.appId ?? "",
      ...(ctx.assistantVersion ? { assistantVersion: ctx.assistantVersion } : {}),
      questionsConsumed: 1,
      estimatedTokens: true,
      costUsd: estimateRequestCost(model, 1),
      rejected: true,
    },
  };
}

/**
 * BPE usage estimate. `prompt` is the last user turn (the only text sent to Qlik — thread affinity
 * handles prior turns), `completion` is the settled answer. Uses the real js-tiktoken counter; the
 * figures are marked estimated everywhere they surface (the Qlik API reports no real usage).
 */
export async function estimateUsage(
  prompt: string,
  completion: string,
  profile: TokenProfileId = DEFAULT_TOKEN_PROFILE,
): Promise<OpenAiUsage> {
  const counter = getTokenCounter(profile);
  const promptTokens = await counter.countText(prompt);
  const completionTokens = await counter.countText(completion);
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
  };
}

/** Serialize one SSE frame for a chunk. */
export function sseFrame(chunk: ChatCompletionChunk): string {
  return `data: ${JSON.stringify(chunk)}\n\n`;
}

/** The terminating SSE frame. */
export const SSE_DONE = "data: [DONE]\n\n";
