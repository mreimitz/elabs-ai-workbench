// Auto-Rating (WP 2.2) — the Claude-CLI judge: a {@link JudgeGenerate} that runs ONE tools-less
// Agent-SDK one-shot on the owner's Claude subscription, so an LLM judge can grade WITHOUT a provider
// API key (AR16 — the caller's chain, WP 2.3, tries this first and falls through on a limit/auth error).
//
// It drives the raw {@link AgentSessionDriver} DIRECTLY — never through `AssistantSessionManager` (no
// thread, no permission machinery, no active-session cap). The one-shot is `maxTurns: 1`,
// `mcpServers: {}`, the built-in exec/network/mutation tools disallowed, and the caller's judge system
// prompt (`opts.system`) forwarded verbatim as the driver's `systemPrompt` — NEVER the assistant persona
// (D-AS9 is satisfied by forwarding `opts.system`, since this module never references the persona prompt).
//
// HARD invariants (planning/Roadmap/RM-06-auto-rating/item.md AR11/AR13/AR14/AR16, D-AS9/D-AS11/D-AS17):
//   - AR14: a memory semaphore (default 1, `AUTO_RATING_MAX_CONCURRENCY`) bounds concurrent CLI children
//     (~1 GiB each) — acquired BEFORE spawning, released in a `finally`.
//   - AR13: real token counts come from WP 2.1's `turn_done.usage`; cost is the CALLER's concern (0 for a
//     subscription). This module returns real {@link JudgeUsage} and no `ratingLogprobs` (the CLI exposes
//     none → the grader falls back to `single_sample`, which is expected).
//   - AR16 / honest degradation: no subscription, a CLI limit/auth error, or a timeout throws a
//     DISTINGUISHABLE, catchable {@link ClaudeCliJudgeError} carrying a `kind` — NEVER a fake result,
//     NEVER a silent 0. WP 2.3's chain catches it to fall through to the provider judge.
//   - Secret boundary (`.claude/rules/mcp-and-security.md`, D-AS17): the decrypted subscription token
//     stays server-side, injected ONLY into the throwaway child env by `buildAssistantSpawnEnv`; it is
//     never logged nor placed in an error message. A per-call THROWAWAY temp dir holds the SDK's HOME /
//     CLAUDE_CONFIG_DIR (where the per-call JSONL transcript lands) and is removed in a `finally` — the
//     real assistant home is never touched.
//
// WP 3.3 (planning/Roadmap/RM-09-claude-subscription/, D-CS10) confirmation — this module rates BOTH kinds of run
// (API-keyed and `claude_subscription`) identically; there is nothing kind-aware in this file. When a
// `claude_subscription` run is being rated, its judge call above is a SIBLING ~1 GiB child of the run
// that just finished, so `deps.gate` (WP 2.1's `SubscriptionConcurrencyPool.shared`, injected from
// `index.ts` into BOTH this judge and `RunService`) is what keeps the total in flight bounded — never a
// private judge-only semaphore racing a separate run-only one. And per AR13 above, this module NEVER
// returns `ratingLogprobs`, so `outcome_judge`/`trajectory_judge` always fall back to the honest
// `single_sample` method for a subscription-influenced rating (see `judge.ts`'s `JudgeGenerateResult`
// doc) — never a crash, never a fabricated logprob-weighted number. See
// `apps/api/test/claude-subscription-rating.test.ts` for the end-to-end proof through the real
// `RunService`/`GradeService`/`createOutcomeJudge` wiring (a scripted fake driver — no real child).
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { JudgeSettings } from "@mcp-token-footprint/shared";
import type { AgentSessionDriver, DriverSession } from "../assistant/session-driver.js";
import { type AssistantAuthSource, buildAssistantSpawnEnv } from "../assistant/spawn-env.js";
import { AsyncSemaphore, type ConcurrencyGate } from "../testing/subscription-concurrency.js";
import type { JudgeGenerate, JudgeGenerateResult, JudgeUsage } from "./judge.js";

/** The locked CLI-judge default model when the caller's {@link JudgeSettings.model} is null/blank. */
export const CLI_JUDGE_DEFAULT_MODEL = "claude-sonnet-4-5";

/**
 * Default bound (ms) on ONE CLI one-shot, measured from AFTER the AR14 semaphore is acquired (the
 * queue wait never counts against it — the graders' outer backstop covers that). More generous than
 * the provider judge's 60s because each call pays a cold CLI child spawn (~seconds) on top of the
 * model round-trip.
 */
export const CLI_JUDGE_ONESHOT_TIMEOUT_MS = 120_000;

/**
 * The built-in tools removed from the judge one-shot. The judge only READS the prompt and answers, so it
 * needs no tools at all; `mcpServers: {}` already gives it no in-process MCP tools, and this list strips
 * the SDK's exec/network/mutation/native file built-ins so a wayward judge cannot touch the filesystem,
 * shell out, or reach the network. (Superset of `ASSISTANT_DISALLOWED_TOOLS` — the assistant deliberately
 * KEEPS Read/Edit/Write for skill editing; the judge does not, so those are added here.)
 */
export const CLI_JUDGE_DISALLOWED_TOOLS: readonly string[] = [
  "Bash",
  "BashOutput",
  "KillShell",
  "WebSearch",
  "WebFetch",
  "Read",
  "Glob",
  "Grep",
  "Edit",
  "Write",
  "MultiEdit",
  "NotebookEdit",
  "Task",
  "TaskStop",
  "Agent",
  "Monitor",
];

/** The failure category a {@link ClaudeCliJudgeError} carries so WP 2.3's chain can decide fall-through. */
export type ClaudeCliJudgeErrorKind =
  /** No Claude subscription is signed in — the CLI judge is unusable; fall through to the provider judge. */
  | "auth"
  /** The CLI hit a usage/capacity limit (`limit_error` rate_limit) — fall through (AR16). */
  | "rate_limit"
  /** The one-shot exceeded its timeout and was aborted. */
  | "timeout"
  /** The driver surfaced a generic error, or the stream ended without a completed turn. */
  | "driver";

/**
 * A distinguishable, catchable failure of the Claude-CLI judge. Its `kind` lets the caller's judge chain
 * (WP 2.3) tell "the CLI judge is unavailable / limited" (fall through to the provider judge) from a
 * genuine bug. NEVER carries the token or any secret in its message (secret boundary).
 */
export class ClaudeCliJudgeError extends Error {
  readonly kind: ClaudeCliJudgeErrorKind;
  constructor(kind: ClaudeCliJudgeErrorKind, message: string) {
    super(message);
    this.name = "ClaudeCliJudgeError";
    this.kind = kind;
  }
}

/** A throwaway workspace for one CLI-judge call: a directory + its idempotent, defensive cleanup. */
export type ThrowawayWorkspace = { dir: string; cleanup: () => Promise<void> };

/** Factory for a {@link ThrowawayWorkspace}. Injected in tests so they never touch the real filesystem. */
export type CreateThrowawayWorkspace = () => Promise<ThrowawayWorkspace>;

/**
 * The production {@link CreateThrowawayWorkspace}: a fresh, unique temp dir under `tempRoot`
 * (default `os.tmpdir()`). It holds the child's scoped HOME / CLAUDE_CONFIG_DIR + cwd, so the SDK's
 * per-call JSONL transcript lands here and is removed by `cleanup` — the real assistant home is never
 * touched. `cleanup` is defensive (recursive+force, swallows errors) so it can run in a `finally`.
 */
export function createThrowawayWorkspace(tempRoot: string = os.tmpdir()): CreateThrowawayWorkspace {
  return async () => {
    const dir = await fs.mkdtemp(path.join(tempRoot, "mcpfp-cli-judge-"));
    return {
      dir,
      cleanup: async () => {
        await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
      },
    };
  };
}

/** Dependencies for {@link createClaudeCliJudgeGenerate} — all injected so the judge is offline-testable. */
export type ClaudeCliJudgeDeps = {
  /** The raw SDK driver seam (production: `SdkAgentSessionDriver`; tests: a scripted fake). */
  driver: AgentSessionDriver;
  /** Resolve the DECRYPTED subscription auth source, or `null` when unsigned (→ an `auth` error). */
  resolveJudgeAuth: () => AssistantAuthSource | null;
  /**
   * WP 2.1 (D-CS10) — the SHARED runs+judge concurrency gate. When present it is the SAME
   * {@link SubscriptionConcurrencyPool.shared} instance a subscription RUN acquires, so the two draw
   * from ONE budget: the TOTAL of (in-flight CLI judges + in-flight subscription runs) can never exceed
   * the bound (a suite of runs + their ratings no longer risks 2N ~1 GiB children). Production injects
   * it from `index.ts`; when ABSENT this falls back to a private semaphore of {@link maxConcurrency} so
   * existing callers/tests that don't inject a gate keep their old, judge-only serialization.
   */
  gate?: ConcurrencyGate;
  /** AR14 fallback concurrency when no shared {@link gate} is injected; defaults to 1. */
  maxConcurrency?: number;
  /** Bound on a single one-shot (post-acquire); defaults to {@link CLI_JUDGE_ONESHOT_TIMEOUT_MS}. */
  timeoutMs?: number;
  /** Throwaway-workspace factory; defaults to {@link createThrowawayWorkspace} under the OS temp dir. */
  createWorkspace?: CreateThrowawayWorkspace;
};

/**
 * Build the Claude-CLI {@link JudgeGenerate}. The returned function mirrors
 * {@link createProviderJudgeGenerate}'s signature exactly: `(settings, prompt, { system, signal })`. On
 * each call it acquires the shared runs+judge gate (AR14/D-CS10 — the SAME instance a subscription RUN
 * acquires, when injected), resolves the subscription auth, runs ONE tools-less `maxTurns: 1` one-shot on
 * the injected driver (forwarding `opts.system` as the system prompt), maps WP 2.1's `turn_done.usage`
 * to {@link JudgeUsage}, and returns `{ text, usage }` with NO `ratingLogprobs`. Every failure path
 * throws a {@link ClaudeCliJudgeError} — never a fake result.
 */
export function createClaudeCliJudgeGenerate(deps: ClaudeCliJudgeDeps): JudgeGenerate {
  // The SHARED gate (runs + judges) when injected, else a private fallback of `maxConcurrency` — so
  // a suite of subscription runs + their CLI-judge ratings contend on ONE budget (never 2N children).
  const semaphore = deps.gate ?? new AsyncSemaphore(deps.maxConcurrency ?? 1);
  const timeoutMs = deps.timeoutMs ?? CLI_JUDGE_ONESHOT_TIMEOUT_MS;
  const createWorkspace = deps.createWorkspace ?? createThrowawayWorkspace();

  return async (settings, prompt, opts) => {
    await semaphore.acquire();
    try {
      return await runOneShot(deps, settings, prompt, opts, { timeoutMs, createWorkspace });
    } finally {
      semaphore.release();
    }
  };
}

/** One acquired-semaphore call: resolve auth, spin up a throwaway workspace, drive the one-shot, clean up. */
async function runOneShot(
  deps: ClaudeCliJudgeDeps,
  settings: JudgeSettings,
  prompt: string,
  opts: { system: string; signal: AbortSignal },
  runtime: { timeoutMs: number; createWorkspace: CreateThrowawayWorkspace },
): Promise<JudgeGenerateResult> {
  // AR16: no subscription → a distinguishable `auth` error BEFORE spawning anything (no temp dir, no child).
  const auth = deps.resolveJudgeAuth();
  if (!auth) {
    throw new ClaudeCliJudgeError(
      "auth",
      "the Claude-CLI judge needs a signed-in Claude subscription",
    );
  }

  const workspace = await runtime.createWorkspace();
  try {
    // The throwaway dir scopes the child's HOME / CLAUDE_CONFIG_DIR (transcript lands here) and its cwd —
    // never the real assistant home. `buildAssistantSpawnEnv` drops every other secret/config from the env.
    const env = buildAssistantSpawnEnv({ auth, assistantDataDir: workspace.dir });
    const model = settings.model?.trim() || CLI_JUDGE_DEFAULT_MODEL;
    const abortController = new AbortController();

    const session = deps.driver.start({
      model,
      cwd: workspace.dir,
      maxTurns: 1,
      systemPrompt: opts.system, // D-AS9: the caller's judge prompt, NEVER the assistant persona.
      env,
      mcpServers: {}, // tools-less: no in-process MCP tools.
      disallowedTools: CLI_JUDGE_DISALLOWED_TOOLS,
      abortController,
    });

    return await driveWithTimeout(session, prompt, abortController, opts.signal, runtime.timeoutMs);
  } finally {
    // Defensive cleanup — never throws out of the `finally` (the factory's cleanup already swallows).
    await workspace.cleanup().catch(() => {});
  }
}

/**
 * Send the prompt, consume the normalized event stream to the first `turn_done`, and race the whole thing
 * against the timeout AND the caller's abort signal. On timeout/abort the driver is torn down
 * (`abortController.abort()`) and a distinguishable error is thrown; on success the driver is likewise
 * torn down in the `finally` (a one-shot is done after one turn). NEVER hangs.
 */
async function driveWithTimeout(
  session: DriverSession,
  prompt: string,
  abortController: AbortController,
  callerSignal: AbortSignal,
  timeoutMs: number,
): Promise<JudgeGenerateResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const onCallerAbort = () => abortController.abort();

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      abortController.abort();
      reject(
        new ClaudeCliJudgeError("timeout", `the Claude-CLI judge timed out after ${timeoutMs}ms`),
      );
    }, timeoutMs);
  });

  // Honor an already-aborted caller signal up front, and link a later abort to the driver teardown.
  if (callerSignal.aborted) {
    abortController.abort();
    if (timer) clearTimeout(timer);
    throw new ClaudeCliJudgeError("timeout", "the Claude-CLI judge was aborted before it started");
  }
  callerSignal.addEventListener("abort", onCallerAbort, { once: true });

  const consumePromise = consume(session, prompt);
  try {
    return await Promise.race([consumePromise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
    callerSignal.removeEventListener("abort", onCallerAbort);
    // Tear the one-shot down whichever way it settled (success, timeout, or driver error).
    abortController.abort();
    // If `consume` LOST the race (timeout/abort won), aborting above ends its stream and it will reject
    // late with a "driver" error — swallow that so it never becomes an unhandled rejection. When `consume`
    // won, this catch attaches to an already-settled promise and is a harmless no-op.
    consumePromise.catch(() => {});
  }
}

/**
 * Drive one one-shot: push the prompt, then walk the normalized {@link DriverEvent} stream. Concatenate
 * `assistant_message.text`, return on the first `turn_done` (mapping its optional {@link DriverUsage} to
 * {@link JudgeUsage} — real counts for AR13, 0/0 when the SDK omits usage), and turn a `limit_error` /
 * `error` / an early stream end into a distinguishable {@link ClaudeCliJudgeError}.
 */
async function consume(session: DriverSession, prompt: string): Promise<JudgeGenerateResult> {
  session.send({ text: prompt });
  let text = "";
  for await (const event of session.events) {
    switch (event.type) {
      case "assistant_message":
        text += event.text;
        break;
      case "turn_done": {
        const usage: JudgeUsage = event.usage
          ? { inputTokens: event.usage.inputTokens, outputTokens: event.usage.outputTokens }
          : { inputTokens: 0, outputTokens: 0 };
        return { text, usage };
      }
      case "limit_error":
        throw new ClaudeCliJudgeError(event.kind === "auth" ? "auth" : "rate_limit", event.message);
      case "error":
        throw new ClaudeCliJudgeError("driver", event.message);
      default:
        // `session` / `assistant_delta` / `tool_*` — not part of a tools-less judge one-shot; ignore.
        break;
    }
  }
  // The stream ended without a `turn_done` (an abort races here too, but the timeout/caller path already
  // threw its own distinguishable error before the loop unwound).
  throw new ClaudeCliJudgeError(
    "driver",
    "the Claude-CLI judge produced no result before the session ended",
  );
}
