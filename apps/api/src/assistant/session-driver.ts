// Assistant (WP 1.1) — the SDK boundary as a DEPENDENCY-INJECTION seam.
//
// `AgentSessionDriver` is the ONLY thing in the session engine that touches
// `@anthropic-ai/claude-agent-sdk`. The session manager (session-manager.ts) drives threads entirely
// through this interface, so tests inject a SCRIPTED FAKE driver and NEVER spawn a child / call
// `query()` / reach Anthropic. Production wires {@link SdkAgentSessionDriver} in `index.ts`.
//
// The interface is deliberately SDK-agnostic (no SDK types leak out of the normalized {@link DriverEvent}
// union), so this module is the single place SDK message shapes are mapped — verified against the
// installed `@anthropic-ai/claude-agent-sdk@0.3.206` `sdk.d.ts` (`query`, `Options`, `SDKMessage`,
// `SDKUserMessage`, `createSdkMcpServer`) — and the fake driver in tests never imports the SDK at all.
import {
  createSdkMcpServer,
  query,
  type Options,
  type SDKMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { toErrorMessage } from "../utils/errors.js";

/**
 * A normalized event out of a live session, SDK-shape-free so the manager (and the fake driver in
 * tests) never depend on `@anthropic-ai/claude-agent-sdk` types. {@link SdkAgentSessionDriver} maps the
 * SDK's `SDKMessage` union onto this; the manager maps THESE onto the persisted `AssistantEvent`
 * vocabulary. `assistant_delta` is transient (streamed, never persisted); everything else is settled.
 */
export type DriverEvent =
  | { type: "session"; sessionId: string }
  | { type: "assistant_delta"; text: string }
  | { type: "assistant_message"; text: string }
  | { type: "tool_call"; toolUseId: string; toolName: string; input: unknown }
  | { type: "tool_result"; toolUseId: string; result: unknown; isError?: boolean }
  | { type: "turn_done"; turnIndex?: number; usage?: DriverUsage }
  | { type: "limit_error"; message: string; kind: "rate_limit" | "auth" }
  | { type: "error"; message: string };

/**
 * A settled turn's real token usage (WP 2.1 — auto-rating AR13's judge ledger), SDK-shape-free
 * (camelCase, no `NonNullableUsage`/snake_case) so it fits the rest of the normalized
 * {@link DriverEvent} union. Optional on `turn_done` and consumed by GRADING only — the assistant
 * itself stays unmetered (D-AS11 untouched; the manager ignores this field).
 */
export type DriverUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
};

/** A user message pushed into a live session (already envelope-rendered by the manager). */
export type DriverUserMessage = { text: string };

/**
 * A tool-permission ask surfaced by the SDK's `canUseTool` before a tool runs (WP 2.1), normalized
 * SDK-free so the manager (and the fake driver in tests) never depend on the SDK's `CanUseTool`
 * options shape. {@link SdkAgentSessionDriver} maps the SDK's `(toolName, input, options)` call onto
 * this; the fake driver constructs it directly to exercise the choke point.
 */
export type DriverPermissionRequest = {
  /** The model-facing tool name as the SDK reports it — for an in-process MCP tool this is the
   *  fully-qualified `mcp__<server>__<tool>` form (the manager's classifier strips the prefix). */
  toolName: string;
  /** The tool's arguments (the agent's own args — no secrets by construction in this app). */
  input: Record<string, unknown>;
  /** The SDK `toolUseID` — correlates this ask with the `tool_call` the same tool use later emits. */
  toolUseId: string;
  /** Aborted when the turn is torn down (park/detach/sign-out) — the manager settles pending asks on it. */
  signal: AbortSignal;
};

/**
 * The manager's decision for one {@link DriverPermissionRequest}: allow (optionally with owner-edited
 * input) or deny-with-a-message. `updatedInput` is OPTIONAL here (the manager omits it for a plain
 * allow), but it is REQUIRED on the wire to the SDK — see {@link toSdkPermissionResult}.
 */
export type DriverPermissionResult =
  | { behavior: "allow"; updatedInput?: Record<string, unknown> }
  | { behavior: "deny"; message: string };

/**
 * Normalize a {@link DriverPermissionResult} into what the SDK's `PermissionResult` demands AT RUNTIME.
 * The SDK's `.d.ts` marks the allow branch's `updatedInput` OPTIONAL, but its runtime zod schema
 * REQUIRES it (a record): returning `{ behavior: "allow" }` alone fails validation with "expected
 * record, received undefined", which the SDK surfaces to the agent as "Tool permission request failed"
 * on EVERY tool call (reads included) — so the agent can never read app data. Verified against the
 * running container @0.3.206. An allow therefore always carries `updatedInput`: the owner's edited
 * input when present, else the tool's ORIGINAL `input` unchanged. Deny is passed through.
 */
export function toSdkPermissionResult(
  result: DriverPermissionResult,
  input: Record<string, unknown>,
):
  | { behavior: "allow"; updatedInput: Record<string, unknown> }
  | { behavior: "deny"; message: string } {
  if (result.behavior === "allow") {
    return { behavior: "allow", updatedInput: result.updatedInput ?? input };
  }
  return result;
}

/**
 * The permission choke point the driver invokes before every gated tool use (→ the SDK's
 * `Options.canUseTool`). The manager supplies this per session; the SDK blocks the tool until the
 * returned promise resolves, so the manager owns the ask→decision round-trip + its timeout.
 */
export type DriverCanUseTool = (
  request: DriverPermissionRequest,
) => Promise<DriverPermissionResult>;

/** Options for starting one live session (the manager resolves each field per thread). */
export interface DriverStartOptions {
  /** The Claude model id to run (thread's `model`). */
  model: string;
  /** Per-thread scratch cwd under the assistant data dir. */
  cwd: string;
  /**
   * WP 2.2 (D-AS13) — absolute directories, ADDITIONAL to `cwd`, the SDK's native file tools may read
   * and write. Verified against the installed SDK's `sdk.d.ts` @0.3.206: `Options.additionalDirectories`
   * ("Additional directories Claude can access beyond the current working directory. Paths should be
   * absolute") — it widens the SAME permission scope `cwd` grants, so the native Read/Edit/Write/
   * Glob/Grep tools stay confined to `cwd` UNION these directories and nothing else (never app source,
   * the DB, or secrets). Set once at session start to the thread's workspace root
   * (`workspace.ts`'s `workspaceRootFor`) — covers every skill the thread opens under it, so no
   * mid-session widening is needed. (The SDK's `Query.applyFlagSettings({ permissions:
   * { additionalDirectories } })` CAN widen this mid-session on an already-running session — verified
   * present on the `Query` control-request surface — but this app never needs it: one root per thread,
   * created up front, is enough.) Optional so simple tests (WP 1.1's baseline) can omit it.
   */
  additionalDirectories?: string[];
  /**
   * Turn cap for the WHOLE warm session → the SDK's `maxTurns` ("Maximum number of conversation turns
   * before the query stops" — verified against the installed SDK's `sdk.d.ts`). NOT reset per message:
   * one `query()` (started here) serves every message the session handles until it's parked/aborted, so
   * this budget is shared across all of them.
   */
  maxTurns: number;
  /**
   * The app's CUSTOM system prompt (a plain string → the SDK's custom-prompt mode, NOT the `claude_code`
   * preset). Carries the app description, the untrusted-content / prompt-injection defense (§3.6, D-AS17)
   * and the D-AS9 identity rule ("never call yourself Claude Code"). Must always be set.
   */
  systemPrompt: string;
  /** The MINIMAL child env from `spawn-env.ts` (REPLACES the child env entirely — see `Options.env`). */
  env: Record<string, string>;
  /**
   * In-process MCP tool server(s) — the SDK's `mcpServers` map. Typed loosely so the fake driver (and
   * the manager's default empty-server path) don't have to import the SDK's `McpServerConfig`; the real
   * driver casts at the `query()` boundary.
   */
  mcpServers: Record<string, unknown>;
  /** Built-in exec/network/mutation tools removed from the model (the manager's `ASSISTANT_DISALLOWED_TOOLS`). */
  disallowedTools: readonly string[];
  /**
   * Tool-name patterns AUTO-ALLOWED without prompting → the SDK's `Options.allowedTools` ("List of
   * tool names that are auto-allowed without prompting for permission", verified against the installed
   * SDK's `sdk.d.ts` @0.3.206). Claude-subscription RUNS (WP 1.3) set this to the scenario allow-list's
   * `mcp__<serverKey>__<toolName>` patterns so those MCP tools run without a permission round-trip; the
   * executor additionally wires a default-deny {@link DriverCanUseTool} over the SAME set so anything
   * else is uncallable. Optional so the assistant + every WP-1.1 baseline path omit it entirely.
   */
  allowedTools?: readonly string[];
  /** Shared abort controller; aborting stops the query + closes the input (park/stop/detach all use it). */
  abortController: AbortController;
  /** Persisted `sdkSessionId` for a parked/idle thread — resumes the prior conversation (D-AS6). */
  resume?: string;
  /**
   * The write-permission choke point (WP 2.1) → the SDK's `Options.canUseTool`. Optional so a session
   * with no gating (WP 1.1 baseline, and simple tests) can omit it; when set, the driver blocks each
   * gated tool on the returned decision. The manager wires its classifier + ask/decision protocol here.
   */
  canUseTool?: DriverCanUseTool;
}

/** A live session handle. `events` runs for the whole session (many turns) until parked/aborted/errored. */
export interface DriverSession {
  /** Push a user message — starts (or queues) a turn in streaming-input mode. No-op after teardown. */
  send(message: DriverUserMessage): void;
  /** Normalized events in emission order, until the session ends. */
  readonly events: AsyncIterable<DriverEvent>;
  /** Abort the IN-FLIGHT turn (SDK `interrupt()`); the session stays warm for the next message. */
  interrupt(): Promise<void>;
  /** The SDK session id once the `system/init` message has arrived; `undefined` until then. */
  sessionId(): string | undefined;
}

/**
 * One entry of the SDK's LIVE model roster (`Query.supportedModels()`, the CLI picker's own source),
 * normalized SDK-shape-free so callers never import the SDK's `ModelInfo`. `value` = the id to use in
 * API calls; `resolvedModel` = the canonical wire id an alias resolves to (e.g. `sonnet` →
 * `claude-sonnet-5`, verified in the pinned `sdk.d.ts`); `displayName` = the human-readable label (the
 * SDK requires it, but it's optional here so a shape drift degrades gracefully).
 */
export type DriverModelInfo = {
  value: string;
  resolvedModel?: string;
  displayName?: string;
};

/** Options for a short-lived {@link AgentSessionDriver.supportedModels} probe. */
export type DriverSupportedModelsOptions = {
  /** The MINIMAL child env from `spawn-env.ts` (the subscription token injected). */
  env: Record<string, string>;
  /** A throwaway cwd scoping the child's HOME / CLAUDE_CONFIG_DIR (the probe writes nothing lasting). */
  cwd: string;
  /** Aborted after the roster is read (and on timeout) to tear the short-lived child down. */
  abortController?: AbortController;
};

/** The DI seam the manager drives. Production = {@link SdkAgentSessionDriver}; tests = a scripted fake. */
export interface AgentSessionDriver {
  start(options: DriverStartOptions): DriverSession;
  /**
   * Fetch the SDK's LIVE model roster (`Query.supportedModels()` — the exact call the CLI picker uses).
   * Production spawns a SHORT-LIVED `query()` with the subscription spawn env, asks for the roster, then
   * tears the child down; tests inject a fake returning a FIXED list (NO real child). Never used on a hot
   * path — the caller ({@link import("../providers/subscription-models.js").SubscriptionModelResolver})
   * caches the result and always falls back to a static roster on any failure.
   */
  supportedModels(options: DriverSupportedModelsOptions): Promise<DriverModelInfo[]>;
}

/** The SDK `SDKAssistantMessage.error` values that mean "subscription/OAuth auth failed" (→ retry-on-key). */
const AUTH_ERROR_VALUES = new Set([
  "authentication_failed",
  "oauth_org_not_allowed",
  "billing_error",
]);
/** The SDK `SDKAssistantMessage.error` values that mean "rate/capacity limit" (→ retry). */
const LIMIT_ERROR_VALUES = new Set(["rate_limit", "overloaded"]);

/**
 * The default empty in-process MCP tool server (WP 1.1). The manager passes this until WP 1.2's real
 * `buildAssistantTools` factory is wired in (execution-plan wave W3). Created via the SDK's
 * `createSdkMcpServer` — an in-process server instance, NO child process / network call, safe to build
 * even in the (fake-driver) tests. Verified signature: `createSdkMcpServer({ name, version?, tools? })`.
 */
export function createEmptyToolServer(): unknown {
  return createSdkMcpServer({ name: "assistant-app", version: "0.0.0", tools: [] });
}

/**
 * A minimal, single-consumer pushable async iterable. Backs BOTH the SDK streaming-input `prompt`
 * (user messages) and the normalized `events` output. `push` delivers to a waiting `next()` or buffers;
 * `end` resolves any waiter with `done` and makes subsequent `push` a no-op. One iterator only (the SDK
 * consumes the input; the manager consumes the output) — sufficient here and dependency-free.
 */
export class PushableAsyncIterable<T> implements AsyncIterable<T> {
  private readonly buffer: T[] = [];
  private readonly waiters: Array<(result: IteratorResult<T>) => void> = [];
  private ended = false;

  push(item: T): void {
    if (this.ended) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value: item, done: false });
    else this.buffer.push(item);
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    let waiter = this.waiters.shift();
    while (waiter) {
      waiter({ value: undefined as unknown as T, done: true });
      waiter = this.waiters.shift();
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        const buffered = this.buffer.shift();
        if (buffered !== undefined) return Promise.resolve({ value: buffered, done: false });
        if (this.ended) return Promise.resolve({ value: undefined as unknown as T, done: true });
        return new Promise((resolve) => this.waiters.push(resolve));
      },
    };
  }
}

/**
 * The production driver: wraps the Agent SDK `query()` in STREAMING-INPUT mode. One `query()` runs the
 * whole session — user messages are fed through a pushable `AsyncIterable<SDKUserMessage>` (`send`), the
 * yielded `SDKMessage`s are normalized to {@link DriverEvent}s, and aborting the shared controller both
 * stops the query and closes the input so the generator returns cleanly.
 *
 * NOT exercised by tests (they inject a fake driver) — the real `query()` streaming loop, park/resume
 * against a live child, and Anthropic auth are owner-acceptance items.
 */
export class SdkAgentSessionDriver implements AgentSessionDriver {
  start(options: DriverStartOptions): DriverSession {
    const input = new PushableAsyncIterable<SDKUserMessage>();
    const output = new PushableAsyncIterable<DriverEvent>();
    let sessionId: string | undefined;

    const sdkOptions: Options = {
      env: options.env,
      cwd: options.cwd,
      // WP 2.2 (D-AS13) — widen the native file tools' permission scope to the thread's workspace root
      // (see the field's doc on DriverStartOptions above). Omitted entirely when unset, matching every
      // other optional passthrough on this options object.
      ...(options.additionalDirectories
        ? { additionalDirectories: options.additionalDirectories }
        : {}),
      model: options.model,
      maxTurns: options.maxTurns,
      // Custom app system prompt (string → NOT the claude_code preset): app identity (D-AS9) +
      // untrusted-content / prompt-injection defense (§3.6). Omitting it would give the agent no
      // system prompt at all — the injection guard + naming rule would be inert.
      systemPrompt: options.systemPrompt,
      // The in-process tool server(s). Typed loosely on the seam; the SDK expects `McpServerConfig`.
      mcpServers: options.mcpServers as Options["mcpServers"],
      includePartialMessages: true,
      // SDK isolation mode: load NO filesystem settings/CLAUDE.md, so the child can't re-enable a
      // denied built-in or read the operator's config.
      settingSources: [],
      disallowedTools: [...options.disallowedTools],
      // WP 1.3 (claude-subscription) — auto-allow the scenario's allow-listed MCP tools. Omitted
      // entirely when unset so the assistant + WP-1.1 baseline requests are byte-for-byte unchanged.
      ...(options.allowedTools && options.allowedTools.length > 0
        ? { allowedTools: [...options.allowedTools] }
        : {}),
      abortController: options.abortController,
      ...(options.resume ? { resume: options.resume } : {}),
      // WP 2.1 — the write-permission choke point. Map the SDK's positional `canUseTool` signature
      // (verified against `@anthropic-ai/claude-agent-sdk@0.3.206`: `(toolName, input, { toolUseID,
      // signal, requestId, … }) => Promise<PermissionResult | null>`) onto the manager's SDK-free
      // {@link DriverCanUseTool}. `DriverPermissionResult` is a subset of the SDK's non-null
      // `PermissionResult`, so the promise is returned straight through (never `null` — we always
      // answer in-band). Omitted when the manager passes no handler.
      ...(options.canUseTool
        ? {
            canUseTool: async (toolName, input, sdkOpts) =>
              // Normalize to the SDK's runtime-required shape (allow MUST carry `updatedInput`) — see
              // toSdkPermissionResult. Without this every tool call fails "Tool permission request failed".
              toSdkPermissionResult(
                await options.canUseTool!({
                  toolName,
                  input,
                  toolUseId: sdkOpts.toolUseID,
                  signal: sdkOpts.signal,
                }),
                input,
              ),
          }
        : {}),
    };

    const q = query({ prompt: input, options: sdkOptions });

    // Consume the SDK stream → normalized events. Runs for the session's whole lifetime.
    void (async () => {
      try {
        for await (const message of q) {
          for (const event of mapSdkMessage(message)) {
            if (event.type === "session") sessionId = event.sessionId;
            output.push(event);
          }
        }
      } catch (error) {
        // An abort (park/stop/detach) races the generator; that's expected teardown, not an error.
        if (!options.abortController.signal.aborted) {
          output.push({ type: "error", message: toErrorMessage(error) });
        }
      } finally {
        output.end();
      }
    })();

    // Aborting the shared controller must also close the input so the streaming-input generator returns.
    options.abortController.signal.addEventListener("abort", () => input.end(), { once: true });

    return {
      send: (message) => input.push(toSdkUserMessage(message)),
      events: output,
      interrupt: async () => {
        // Best-effort: interrupting a turn that's already settling can reject — swallow it.
        try {
          await q.interrupt();
        } catch {
          /* interrupt on a settling/ended turn is a no-op */
        }
      },
      sessionId: () => sessionId,
    };
  }

  /**
   * Ask the SDK for its LIVE model roster. `supportedModels()` is a CONTROL request, so it needs a
   * streaming-input `query()`: we start a minimal one (a never-fed pushable prompt — no message is ever
   * sent, no turn runs), await the roster, then abort the query + close the input so the short-lived
   * child is torn down in the `finally`. NOT exercised by tests (they inject a fake) — the real
   * `query()` control round-trip against a live child is an owner-acceptance item.
   */
  async supportedModels(options: DriverSupportedModelsOptions): Promise<DriverModelInfo[]> {
    const abortController = options.abortController ?? new AbortController();
    const input = new PushableAsyncIterable<SDKUserMessage>();
    const sdkOptions: Options = {
      env: options.env,
      cwd: options.cwd,
      // SDK isolation mode (same as start()): load NO filesystem settings/CLAUDE.md.
      settingSources: [],
      abortController,
    };
    const q = query({ prompt: input, options: sdkOptions });
    try {
      const models = await q.supportedModels();
      return models.map((model) => ({
        value: model.value,
        ...(model.resolvedModel ? { resolvedModel: model.resolvedModel } : {}),
        ...(model.displayName ? { displayName: model.displayName } : {}),
      }));
    } finally {
      // Tear the short-lived child down: abort the query + close the streaming input so the generator
      // returns cleanly (mirrors start()'s teardown wiring).
      abortController.abort();
      input.end();
    }
  }
}

/** Wrap a plain user message as the SDK's streaming-input `SDKUserMessage`. */
function toSdkUserMessage(message: DriverUserMessage): SDKUserMessage {
  return {
    type: "user",
    message: { role: "user", content: message.text },
    parent_tool_use_id: null,
  };
}

/**
 * Map one SDK `SDKMessage` onto zero or more normalized {@link DriverEvent}s. Structural, defensive
 * access (mirrors the codebase's `joinTextBlocks` style) so a shape drift degrades gracefully rather
 * than throwing into the stream. Only the members the manager needs are mapped; the rest are ignored.
 */
export function mapSdkMessage(message: SDKMessage): DriverEvent[] {
  switch (message.type) {
    case "system":
      // The `init` system message carries the session id (also present on every message, but init is the
      // authoritative first one — persist it promptly so a park immediately after start can still resume).
      if (message.subtype === "init") return [{ type: "session", sessionId: message.session_id }];
      return [];

    case "assistant": {
      const events: DriverEvent[] = [];
      // Provider/auth/limit error on the turn (rate limit, overloaded, auth failed, …).
      if (message.error) {
        if (AUTH_ERROR_VALUES.has(message.error)) {
          events.push({
            type: "limit_error",
            message: describeAssistantError(message.error),
            kind: "auth",
          });
        } else if (LIMIT_ERROR_VALUES.has(message.error)) {
          events.push({
            type: "limit_error",
            message: describeAssistantError(message.error),
            kind: "rate_limit",
          });
        } else {
          events.push({ type: "error", message: describeAssistantError(message.error) });
        }
      }
      for (const block of contentBlocks(message.message)) {
        if (
          block.type === "text" &&
          typeof block.text === "string" &&
          block.text.trim().length > 0
        ) {
          events.push({ type: "assistant_message", text: block.text });
        } else if (block.type === "tool_use" && typeof block.id === "string") {
          events.push({
            type: "tool_call",
            toolUseId: block.id,
            toolName: typeof block.name === "string" ? block.name : "",
            input: block.input,
          });
        }
      }
      return events;
    }

    case "user": {
      // Tool RESULT blocks (the outcome of an in-process MCP `tools/call`) ride a synthetic user message.
      const events: DriverEvent[] = [];
      for (const block of contentBlocks(message.message)) {
        if (block.type === "tool_result" && typeof block.tool_use_id === "string") {
          events.push({
            type: "tool_result",
            toolUseId: block.tool_use_id,
            result: block.content,
            ...(typeof block.is_error === "boolean" ? { isError: block.is_error } : {}),
          });
        }
      }
      return events;
    }

    case "stream_event": {
      // Partial streaming: forward only assistant TEXT deltas (transient — never persisted).
      const event = message.event as { type?: string; delta?: { type?: string; text?: unknown } };
      if (
        event?.type === "content_block_delta" &&
        event.delta?.type === "text_delta" &&
        typeof event.delta.text === "string" &&
        event.delta.text.length > 0
      ) {
        return [{ type: "assistant_delta", text: event.delta.text }];
      }
      return [];
    }

    case "result": {
      const events: DriverEvent[] = [];
      if (message.subtype !== "success") {
        events.push({ type: "error", message: describeResultError(message) });
      }
      // WP 2.1 (AR13) — real usage for the judge ledger, captured for BOTH the success and error
      // subtypes (the SDK's `sdk.d.ts` gives `usage: NonNullableUsage` on both `SDKResultSuccess` and
      // `SDKResultError`); `resultUsage` is defensive so a shape drift on either omits the field
      // rather than throwing.
      const usage = resultUsage(message);
      events.push({ type: "turn_done", turnIndex: message.num_turns, ...(usage ? { usage } : {}) });
      return events;
    }

    case "rate_limit_event":
      // A hard `rejected` rate limit → surface it; `allowed`/`allowed_warning` are informational (ignored).
      if (message.rate_limit_info?.status === "rejected") {
        return [
          { type: "limit_error", message: "The Assistant hit a usage limit.", kind: "rate_limit" },
        ];
      }
      return [];

    default:
      return [];
  }
}

/** A message's content as a defensively-typed block array (BetaMessage / MessageParam both carry one). */
function contentBlocks(message: unknown): Array<{
  type?: string;
  text?: unknown;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
}> {
  const content = (message as { content?: unknown } | undefined)?.content;
  return Array.isArray(content) ? content : [];
}

/**
 * A `result` message's `usage` as a defensively-typed {@link DriverUsage} (snake_case → camelCase),
 * mirroring `contentBlocks`' structural-access style — no throwing on shape drift. Returns `undefined`
 * when `usage` itself is missing/not an object (nothing to report, `turn_done` omits the field
 * entirely); when `usage` IS present but an individual counter is missing/non-numeric, that counter
 * coalesces to `0` rather than dropping the whole event.
 */
function resultUsage(message: unknown): DriverUsage | undefined {
  const usage = (message as { usage?: unknown } | undefined)?.usage;
  if (typeof usage !== "object" || usage === null) return undefined;
  const raw = usage as Record<string, unknown>;
  const numberOr0 = (value: unknown): number => (typeof value === "number" ? value : 0);
  return {
    inputTokens: numberOr0(raw.input_tokens),
    outputTokens: numberOr0(raw.output_tokens),
    cacheReadInputTokens: numberOr0(raw.cache_read_input_tokens),
    cacheCreationInputTokens: numberOr0(raw.cache_creation_input_tokens),
  };
}

function describeAssistantError(error: string): string {
  switch (error) {
    case "rate_limit":
      return "The Assistant hit a rate limit.";
    case "overloaded":
      return "The Assistant is overloaded. Try again in a moment.";
    case "authentication_failed":
      return "Assistant authentication failed. Re-sign-in in Settings.";
    case "oauth_org_not_allowed":
      return "This account isn't allowed to use the Assistant.";
    case "billing_error":
      return "The Assistant hit a billing limit.";
    default:
      return `The Assistant reported an error (${error}).`;
  }
}

function describeResultError(message: { subtype: string; errors?: string[] }): string {
  switch (message.subtype) {
    case "error_max_turns":
      // WP 3.3 fix: this budget is for the WHOLE warm session (the SDK's maxTurns applies per
      // query(), not per message — see DriverStartOptions.maxTurns's doc) — a message-scoped wording
      // here would misleadingly suggest ONLY this message's tool calls were too many.
      return "Reached the maximum number of turns for this session. A fresh budget starts the next time it's parked and resumed.";
    case "error_max_budget_usd":
      return "Reached the cost budget for this message.";
    default:
      return message.errors?.[0] ?? `The Assistant run ended with an error (${message.subtype}).`;
  }
}
