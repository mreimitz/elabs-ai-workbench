import assert from "node:assert/strict";
import { test } from "node:test";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  createEmptyToolServer,
  type DriverEvent,
  mapSdkMessage,
  toSdkPermissionResult,
} from "../src/assistant/session-driver.js";

// Assistant (WP 1.1) — the SDK boundary's PURE mapper (SDKMessage → DriverEvent). Offline: it never
// calls `query()`, never spawns a child, never reaches Anthropic — it only maps synthetic message
// objects shaped like the installed SDK's `SDKMessage` union (verified against `sdk.d.ts` 0.3.206).
// This locks the mapping that the live streaming loop (owner-acceptance) depends on.

const asMessage = (value: unknown): SDKMessage => value as SDKMessage;

test("toSdkPermissionResult: an ALLOW always carries updatedInput (SDK runtime requires it)", () => {
  const input = { runId: "r-1" };
  // Plain allow (no owner edit) → the SDK still needs updatedInput; pass the ORIGINAL input through.
  // Regression: returning `{ behavior: 'allow' }` alone made the SDK reject EVERY tool call with
  // "Tool permission request failed: … expected record, received undefined".
  assert.deepEqual(toSdkPermissionResult({ behavior: "allow" }, input), {
    behavior: "allow",
    updatedInput: input,
  });
  // Owner-edited input is preserved.
  const edited = { runId: "r-2" };
  assert.deepEqual(toSdkPermissionResult({ behavior: "allow", updatedInput: edited }, input), {
    behavior: "allow",
    updatedInput: edited,
  });
  // Deny is passed through untouched (it carries its message, no updatedInput).
  assert.deepEqual(toSdkPermissionResult({ behavior: "deny", message: "nope" }, input), {
    behavior: "deny",
    message: "nope",
  });
});

test("system/init → a session event carrying the SDK session id", () => {
  const events = mapSdkMessage(
    asMessage({ type: "system", subtype: "init", session_id: "sess-1", model: "m" }),
  );
  assert.deepEqual(events, [{ type: "session", sessionId: "sess-1" }]);
  // A non-init system message is ignored.
  assert.deepEqual(
    mapSdkMessage(asMessage({ type: "system", subtype: "status", status: null })),
    [],
  );
});

test("assistant text + tool_use content → assistant_message + tool_call (empty/whitespace text dropped)", () => {
  const events = mapSdkMessage(
    asMessage({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "  " }, // whitespace-only → dropped
          { type: "text", text: "Here is the run." },
          { type: "tool_use", id: "tu-9", name: "runs_get", input: { runId: "r-1" } },
          { type: "thinking", thinking: "…" }, // non-emitted block → ignored
        ],
      },
    }),
  );
  assert.deepEqual(events, [
    { type: "assistant_message", text: "Here is the run." },
    { type: "tool_call", toolUseId: "tu-9", toolName: "runs_get", input: { runId: "r-1" } },
  ] satisfies DriverEvent[]);
});

test("assistant error classification → limit_error (rate_limit vs auth) or a plain error", () => {
  const rate = mapSdkMessage(
    asMessage({
      type: "assistant",
      error: "rate_limit",
      message: { role: "assistant", content: [] },
    }),
  );
  assert.equal(rate[0]?.type, "limit_error");
  assert.equal((rate[0] as Extract<DriverEvent, { type: "limit_error" }>).kind, "rate_limit");

  const auth = mapSdkMessage(
    asMessage({
      type: "assistant",
      error: "authentication_failed",
      message: { role: "assistant", content: [] },
    }),
  );
  assert.equal((auth[0] as Extract<DriverEvent, { type: "limit_error" }>).kind, "auth");

  const other = mapSdkMessage(
    asMessage({
      type: "assistant",
      error: "model_not_found",
      message: { role: "assistant", content: [] },
    }),
  );
  assert.equal(other[0]?.type, "error");
});

test("user tool_result content → a tool_result event (name is correlated later by the manager)", () => {
  const events = mapSdkMessage(
    asMessage({
      type: "user",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "tu-9",
            content: [{ type: "text", text: "ok" }],
            is_error: false,
          },
        ],
      },
    }),
  );
  assert.deepEqual(events, [
    {
      type: "tool_result",
      toolUseId: "tu-9",
      result: [{ type: "text", text: "ok" }],
      isError: false,
    },
  ] satisfies DriverEvent[]);
});

test("stream_event text_delta → a transient assistant_delta; other deltas ignored", () => {
  const textDelta = mapSdkMessage(
    asMessage({
      type: "stream_event",
      event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hel" } },
    }),
  );
  assert.deepEqual(textDelta, [{ type: "assistant_delta", text: "Hel" }]);

  const thinkingDelta = mapSdkMessage(
    asMessage({
      type: "stream_event",
      event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "…" } },
    }),
  );
  assert.deepEqual(thinkingDelta, []);
});

test("result success → turn_done; an error result → error + turn_done", () => {
  const ok = mapSdkMessage(
    asMessage({ type: "result", subtype: "success", num_turns: 3, result: "done" }),
  );
  assert.deepEqual(ok, [{ type: "turn_done", turnIndex: 3 }]);

  const maxTurns = mapSdkMessage(
    asMessage({ type: "result", subtype: "error_max_turns", num_turns: 50, errors: [] }),
  );
  assert.equal(maxTurns[0]?.type, "error");
  assert.match(
    (maxTurns[0] as Extract<DriverEvent, { type: "error" }>).message,
    /maximum number of turns/i,
  );
  assert.deepEqual(maxTurns[1], { type: "turn_done", turnIndex: 50 });
});

test("result with usage → turn_done carries a camelCased DriverUsage (WP 2.1, AR13's judge ledger)", () => {
  const ok = mapSdkMessage(
    asMessage({
      type: "result",
      subtype: "success",
      num_turns: 3,
      result: "done",
      usage: {
        input_tokens: 120,
        output_tokens: 45,
        cache_read_input_tokens: 10,
        cache_creation_input_tokens: 5,
      },
    }),
  );
  assert.deepEqual(ok, [
    {
      type: "turn_done",
      turnIndex: 3,
      usage: {
        inputTokens: 120,
        outputTokens: 45,
        cacheReadInputTokens: 10,
        cacheCreationInputTokens: 5,
      },
    },
  ] satisfies DriverEvent[]);

  // An error-subtype result ALSO carries usage (the SDK's usage field is present on both subtypes).
  const errored = mapSdkMessage(
    asMessage({
      type: "result",
      subtype: "error_max_turns",
      num_turns: 50,
      errors: [],
      usage: {
        input_tokens: 999,
        output_tokens: 1,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    }),
  );
  assert.deepEqual((errored[1] as Extract<DriverEvent, { type: "turn_done" }>).usage, {
    inputTokens: 999,
    outputTokens: 1,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
  });
});

test("result with missing/partial usage → no throw; usage omitted or coalesced to 0", () => {
  // No `usage` key at all → the event carries no `usage` field (not even `usage: undefined`).
  const missing = mapSdkMessage(
    asMessage({ type: "result", subtype: "success", num_turns: 1, result: "done" }),
  );
  assert.deepEqual(missing, [{ type: "turn_done", turnIndex: 1 }]);
  assert.ok(!("usage" in (missing[0] as object)));

  // `usage` present but partial (missing/non-numeric fields) → those fields coalesce to 0.
  const partial = mapSdkMessage(
    asMessage({
      type: "result",
      subtype: "success",
      num_turns: 2,
      result: "done",
      usage: { input_tokens: 42 },
    }),
  );
  assert.deepEqual((partial[0] as Extract<DriverEvent, { type: "turn_done" }>).usage, {
    inputTokens: 42,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
  });

  // `usage` present but not an object (shape drift) → omitted entirely, no throw.
  const notObject = mapSdkMessage(
    asMessage({ type: "result", subtype: "success", num_turns: 3, result: "done", usage: "bogus" }),
  );
  assert.deepEqual(notObject, [{ type: "turn_done", turnIndex: 3 }]);
});

test("non-result messages never carry a usage field", () => {
  const assistantEvents = mapSdkMessage(
    asMessage({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: "hi" }] },
    }),
  );
  assert.ok(assistantEvents.every((event) => !("usage" in (event as object))));

  const userEvents = mapSdkMessage(
    asMessage({
      type: "user",
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "tu-1", content: [], is_error: false }],
      },
    }),
  );
  assert.ok(userEvents.every((event) => !("usage" in (event as object))));
});

test("rate_limit_event → limit_error only when the status is `rejected`", () => {
  assert.equal(
    mapSdkMessage(
      asMessage({ type: "rate_limit_event", rate_limit_info: { status: "rejected" } }),
    )[0]?.type,
    "limit_error",
  );
  assert.deepEqual(
    mapSdkMessage(asMessage({ type: "rate_limit_event", rate_limit_info: { status: "allowed" } })),
    [],
  );
});

test("createEmptyToolServer builds an in-process SDK MCP server (no child, no network)", () => {
  const server = createEmptyToolServer() as { type?: string; name?: string; instance?: unknown };
  assert.equal(server.type, "sdk", "an SDK-transport in-process server config");
  assert.equal(server.name, "assistant-app");
  assert.ok(server.instance, "carries the in-process MCP server instance");
});
