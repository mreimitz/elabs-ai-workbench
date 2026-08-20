// The built-in `ask_user` tool — the ONE interaction primitive that lets an agent pause a live
// INTERACTIVE run to ask the human operator a question, then continue with their answer.
//
// Why this exists (and why it isn't the SDK's native `AskUserQuestion`): a test run drives the model
// HEADLESSLY on the server — there is no interactive frontend for the Agent SDK's own `AskUserQuestion`
// to render into, and the API-keyed (AI-SDK) path has no such built-in AT ALL. So instead of enabling a
// provider-specific built-in (which would be non-functional headlessly AND make the two run paths
// non-comparable), we define our OWN tool and expose the SAME one on BOTH paths:
//   - AI-SDK path (`ai` `tool()`), injected into the engine's ToolSet next to the skill-disclosure tools;
//   - Claude-subscription path (an in-process `createSdkMcpServer`, mirroring the skills server).
// Both handlers run IN the API process, so both emit a `question` RunEvent and block on a per-run promise
// the operator's `POST /api/runs/:id/answers` (or a run stop) resolves. Exposed ONLY on interactive runs.
import { createSdkMcpServer, tool as sdkTool } from "@anthropic-ai/claude-agent-sdk";
import type { RunEvent, RunQuestionOption } from "@mcp-token-footprint/shared";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { type JSONSchema7, jsonSchema, tool as aiTool, type Tool } from "ai";
import { z } from "zod";
import type { McpToolResult } from "./tool-bridge.js";
import { toolPattern } from "./subscription-tools.js";

/** The `mcpServers` map key for the in-process ask-the-operator server (`mcp__ask__ask_user`). */
export const ASK_USER_MCP_KEY = "ask";
/** The tool name, identical on both paths so a run's tool surface reads the same regardless of provider. */
export const ASK_USER_TOOL = "ask_user";

/** The `mcp__ask__ask_user` allow pattern — added to the subscription path's allow-list + default-deny gate. */
export function askUserToolPattern(): string {
  return toolPattern(ASK_USER_MCP_KEY, ASK_USER_TOOL);
}

const ASK_USER_DESCRIPTION =
  "Ask the human operator running this interactive test a question and PAUSE the run until they answer. " +
  "Use this ONLY when you genuinely need a decision, clarification, or a piece of information you cannot " +
  "obtain from your other tools — do not use it to narrate progress. Provide a clear, self-contained " +
  "`question`; optionally offer `options` (predefined choices the operator can pick from). The operator's " +
  "answer is returned to you as the tool result so you can continue.";

/** Validated `ask_user` arguments (the model supplies these). */
export type AskUserArgs = {
  question: string;
  options?: RunQuestionOption[];
  allowOther?: boolean;
};

/**
 * Per-run seam the tool uses to emit events and block on the operator's answer. The run service
 * implements it over the run's `RunManager` (emit) + a per-run pending-question map (waitForAnswer),
 * keeping this module free of any run/DB/nanoid dependency (a test injects a trivial fake).
 */
export interface AskUserBridge {
  /** Emit a run event (`question` / `question_resolved`) onto the run's SSE stream + persistence. */
  emit(event: RunEvent): void;
  /**
   * Register the pending question and resolve when the operator answers (their text) or the run is
   * stopped/aborted before answering (`null`). Never rejects — a `null` answer is the abort signal.
   */
  waitForAnswer(questionId: string): Promise<string | null>;
  /** A fresh correlation id for one question (the run service supplies `nanoid`). */
  newQuestionId(): string;
  /**
   * Unified Sessions (planning/Roadmap/completed/RM-29-unified-sessions/, WP1.3, D-US1/D-US3) — bracket this ask_user wait
   * with the run's SessionClock, the SAME way a `nextTurn` wait is bracketed: entering pauses stall
   * accounting and arms the wait-budget timer (the identical budget a `nextTurn` wait uses, per
   * D-US3 — "the wait budget applies to BOTH"); returns the clock's server-authored ISO-8601
   * deadline (if one is armed), so `runAsk` can carry it on the `waiting_input` phase event.
   * Optional — an executor that hasn't adopted SessionClock yet (or a test) simply omits this, and
   * `runAsk` skips the bracketing (byte-identical old behavior: no phase event, no clock coupling).
   */
  enterWaiting?(): string | undefined;
  /**
   * Resume from the wait: re-arms the stall timer and clears the run's persisted `phase` back to "no
   * distinct phase" (the wire has no "none" phase member — see `RunRepository.setPhase`'s doc).
   * Optional, mirroring {@link enterWaiting}.
   */
  resumeFromWaiting?(): void;
}

/** JSON-Schema input contract for the AI-SDK path (the subscription path uses the equivalent zod shape). */
const ASK_USER_INPUT_SCHEMA: JSONSchema7 = {
  type: "object",
  properties: {
    question: { type: "string", description: "The question to ask the operator." },
    options: {
      type: "array",
      description: "Optional predefined choices to offer the operator.",
      items: {
        type: "object",
        properties: {
          label: { type: "string", description: "The choice text (returned verbatim if picked)." },
          description: { type: "string", description: "Optional one-line hint about the choice." },
        },
        required: ["label"],
      },
    },
    allowOther: {
      type: "boolean",
      description: "Whether the operator may type a free-text answer instead of picking an option (default true).",
    },
  },
  required: ["question"],
};

/** Drop malformed/blank options so the console never renders an empty choice. */
function normalizeOptions(options: unknown): RunQuestionOption[] {
  if (!Array.isArray(options)) return [];
  const clean: RunQuestionOption[] = [];
  for (const raw of options) {
    if (!raw || typeof raw !== "object") continue;
    const label = (raw as { label?: unknown }).label;
    if (typeof label !== "string" || label.trim().length === 0) continue;
    const description = (raw as { description?: unknown }).description;
    clean.push({
      label,
      ...(typeof description === "string" && description.length > 0 ? { description } : {}),
    });
  }
  return clean;
}

/** Coerce untrusted tool args into a well-formed {@link AskUserArgs} (never throws — degrades gracefully). */
function coerceArgs(args: unknown): AskUserArgs {
  const record = (args ?? {}) as Record<string, unknown>;
  const question = typeof record.question === "string" ? record.question : "";
  return {
    question,
    options: normalizeOptions(record.options),
    ...(typeof record.allowOther === "boolean" ? { allowOther: record.allowOther } : {}),
  };
}

/** The text the model receives back as the tool result (the answer, or an honest note if the run stopped). */
function answerResultText(answer: string | null): string {
  return answer === null
    ? "The operator stopped the run without answering this question."
    : answer;
}

/**
 * Core ask → emit `question`, block on the operator's answer, emit `question_resolved`, return the
 * answer text (or `null` if the run was stopped before an answer). Shared by both path adapters below.
 *
 * Unified Sessions (planning/Roadmap/completed/RM-29-unified-sessions/, WP1.3, D-US1/D-US3) — the wait itself is bracketed by
 * the bridge's optional {@link AskUserBridge.enterWaiting}/{@link AskUserBridge.resumeFromWaiting}
 * (an executor's SessionClock coupling): entering emits the `waiting_input` phase event (reason
 * `"question"`, carrying the clock's deadline when one is armed) before the wait, and resuming clears
 * it after. Both are no-ops when the bridge doesn't implement them (byte-identical old behavior).
 */
async function runAsk(bridge: AskUserBridge, rawArgs: unknown): Promise<string | null> {
  const args = coerceArgs(rawArgs);
  const questionId = bridge.newQuestionId();
  const options = normalizeOptions(args.options);
  bridge.emit({
    type: "question",
    questionId,
    prompt: args.question,
    ...(options.length > 0 ? { options } : {}),
    allowOther: args.allowOther ?? true,
  });
  const deadlineAt = bridge.enterWaiting?.();
  if (bridge.enterWaiting) {
    bridge.emit({
      type: "phase",
      phase: "waiting_input",
      detail: { reason: "question", ...(deadlineAt ? { deadlineAt } : {}) },
    });
  }
  const answer = await bridge.waitForAnswer(questionId);
  bridge.resumeFromWaiting?.();
  bridge.emit({ type: "question_resolved", questionId, answer });
  return answer;
}

/**
 * AI-SDK path — the `ask_user` tool as an `ai` `tool()`, injected into the engine's ToolSet
 * (`Object.assign(tools, buildAskUserAiTool(bridge))`) exactly like the skill-disclosure tools. Only
 * wired for interactive runs.
 */
export function buildAskUserAiTool(bridge: AskUserBridge): Record<string, Tool> {
  return {
    [ASK_USER_TOOL]: aiTool({
      description: ASK_USER_DESCRIPTION,
      inputSchema: jsonSchema(ASK_USER_INPUT_SCHEMA),
      execute: async (args: unknown): Promise<McpToolResult> => {
        const answer = await runAsk(bridge, args);
        return {
          content: [{ type: "text", text: answerResultText(answer) }],
          ...(answer === null ? { isError: true } : {}),
        };
      },
    }),
  };
}

/**
 * Claude-subscription path — the `ask_user` tool as an in-process Agent-SDK MCP server, merged into the
 * run's `mcpServers` (its `mcp__ask__ask_user` pattern added to the allow-list + default-deny gate).
 * Mirrors {@link buildSubscriptionSkillToolServer}. Only wired for interactive runs.
 */
export function buildAskUserSdkServer(bridge: AskUserBridge): unknown {
  return createSdkMcpServer({
    name: ASK_USER_MCP_KEY,
    version: "0.0.0",
    tools: [
      sdkTool(
        ASK_USER_TOOL,
        ASK_USER_DESCRIPTION,
        {
          question: z.string().describe("The question to ask the operator."),
          options: z
            .array(
              z.object({
                label: z.string().describe("The choice text (returned verbatim if picked)."),
                description: z.string().optional().describe("Optional one-line hint about the choice."),
              }),
            )
            .optional()
            .describe("Optional predefined choices to offer the operator."),
          allowOther: z
            .boolean()
            .optional()
            .describe("Whether the operator may type a free-text answer instead of picking an option (default true)."),
        },
        async (args): Promise<CallToolResult> => {
          const answer = await runAsk(bridge, args);
          return {
            content: [{ type: "text", text: answerResultText(answer) }],
            ...(answer === null ? { isError: true } : {}),
          };
        },
      ),
    ],
  });
}
