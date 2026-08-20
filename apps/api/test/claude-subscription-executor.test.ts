import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { RunEvent, RunStep } from "@mcp-token-footprint/shared";
import type {
  AgentSessionDriver,
  DriverEvent,
  DriverSession,
  DriverStartOptions,
  DriverUserMessage,
} from "../src/assistant/session-driver.js";
import type { AssistantAuthSource } from "../src/assistant/spawn-env.js";
import { estimateCost } from "../src/providers/pricing.js";
import type { SessionClockTime } from "../src/testing/session-clock.js";
import {
  AsyncSemaphore,
  type ClaudeSubscriptionRunConfig,
  type ConcurrencyGate,
  type CreateThrowawayWorkspace,
  runClaudeSubscription,
  runClaudeSubscriptionInteractive,
  SUBSCRIPTION_DISALLOWED_TOOLS,
} from "../src/testing/claude-subscription-executor.js";
import type { ResolvedSkill } from "../src/testing/skill-context.js";
import {
  LIST_SKILL_FILES_TOOL,
  READ_SKILL_FILE_TOOL,
  SUBSCRIPTION_SKILLS_MCP_KEY,
  type SkillFileBytesReader,
} from "../src/testing/subscription-skill-tools.js";

// WP 1.1 (planning/Roadmap/RM-09-claude-subscription/) — the subscription run executor, exercised ENTIRELY through a
// SCRIPTED FAKE driver + a stub auth resolver + a fake throwaway-workspace factory. NO SDK is imported,
// NO child is spawned, NO Anthropic call is made, and the real filesystem is never touched. Live
// subscription behavior is OWNER-ACCEPTANCE — never faked or asserted here.

// ── A tiny pushable async iterable (the fake's normalized event stream) — SDK-free ────────────────────
class Pushable<T> implements AsyncIterable<T> {
  private readonly buffer: T[] = [];
  private readonly waiters: Array<(r: IteratorResult<T>) => void> = [];
  private ended = false;
  push(item: T): void {
    if (this.ended) return;
    const w = this.waiters.shift();
    if (w) w({ value: item, done: false });
    else this.buffer.push(item);
  }
  end(): void {
    if (this.ended) return;
    this.ended = true;
    let w = this.waiters.shift();
    while (w) {
      w({ value: undefined as unknown as T, done: true });
      w = this.waiters.shift();
    }
  }
  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const b = this.buffer.shift();
        if (b !== undefined) return Promise.resolve({ value: b, done: false });
        if (this.ended) return Promise.resolve({ value: undefined as unknown as T, done: true });
        return new Promise<IteratorResult<T>>((resolve) => this.waiters.push(resolve));
      },
    };
  }
}

// ── The scripted fake driver ──────────────────────────────────────────────────────────────────────────
class FakeSession implements DriverSession {
  readonly out = new Pushable<DriverEvent>();
  readonly sent: string[] = [];
  readonly options: DriverStartOptions;
  /** Test hook: invoked on every `send()` so a turn's events can be scripted in response to a user turn. */
  onSend?: (text: string, session: FakeSession) => void;
  constructor(options: DriverStartOptions) {
    this.options = options;
    // The SDK's `system/init` carries the session id — emit it up front (ignored by the run loop).
    this.out.push({ type: "session", sessionId: "sess-fake" });
    // Aborting the shared controller (deadline/stop/teardown) ends the stream, like the real driver.
    options.abortController.signal.addEventListener("abort", () => this.out.end(), { once: true });
  }
  get events(): AsyncIterable<DriverEvent> {
    return this.out;
  }
  send(message: DriverUserMessage): void {
    this.sent.push(message.text);
    this.onSend?.(message.text, this);
  }
  async interrupt(): Promise<void> {}
  sessionId(): string | undefined {
    return "sess-fake";
  }
  /** Test hook: push a scripted normalized event into this session's stream. */
  emit(event: DriverEvent): void {
    this.out.push(event);
  }
}

class FakeDriver implements AgentSessionDriver {
  readonly sessions: FakeSession[] = [];
  active = 0;
  maxActive = 0;
  /** Called synchronously after each `start()` so a test can auto-script (or leave it manual). */
  onStart?: (session: FakeSession) => void;
  /** Wired onto every session's `send` so a test can script each turn's response. */
  onSend?: (text: string, session: FakeSession) => void;
  start(options: DriverStartOptions): DriverSession {
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    // A run is torn down (abortController.abort) when it settles — decrement then.
    options.abortController.signal.addEventListener(
      "abort",
      () => {
        this.active -= 1;
      },
      { once: true },
    );
    const session = new FakeSession(options);
    session.onSend = this.onSend;
    this.sessions.push(session);
    this.onStart?.(session);
    return session;
  }
}

// ── Shared fixtures ─────────────────────────────────────────────────────────────────────────────────
const AUTH: AssistantAuthSource = {
  kind: "claude_oauth",
  token: "sk-ant-oat01-fake-subscription-token-1234",
};
const MODEL = "claude-sonnet-4-5";
const PROMPT = "Summarize the taxi dataset.";
const USAGE: DriverEvent = {
  type: "turn_done",
  turnIndex: 3,
  usage: {
    inputTokens: 100,
    outputTokens: 40,
    cacheReadInputTokens: 20,
    cacheCreationInputTokens: 5,
  },
};

/** A fake throwaway-workspace factory that never touches the FS; records created dirs + cleanup calls. */
function fakeWorkspaces(): {
  create: CreateThrowawayWorkspace;
  dirs: string[];
  cleanups: () => number;
} {
  const dirs: string[] = [];
  let cleanups = 0;
  const create: CreateThrowawayWorkspace = async () => {
    const dir = `/fake/tmp/ws-${dirs.length}`;
    dirs.push(dir);
    return {
      dir,
      cleanup: async () => {
        cleanups += 1;
      },
    };
  };
  return { create, dirs, cleanups: () => cleanups };
}

// ── WP 1.4 fixtures — a REAL throwaway workspace (materialization writes actual files), with cleanup
// deferred to the TEST (not the executor's `finally`) so the materialized tree survives past the run for
// inspection. Every test that uses this removes its own dir at the end. ────────────────────────────────
function realWorkspaceInspectable(): { create: CreateThrowawayWorkspace; dirs: string[] } {
  const dirs: string[] = [];
  const create: CreateThrowawayWorkspace = async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mcpfp-subscription-skill-test-"));
    dirs.push(dir);
    return { dir, cleanup: async () => {} }; // the test inspects the tree post-run, then removes it itself
  };
  return { create, dirs };
}

/** A resolved skill fixture (unit-level, no DB) — mirrors `skill-context.test.ts`'s equivalent helper. */
function resolvedSkillFixture(over: Partial<ResolvedSkill> = {}): ResolvedSkill {
  return {
    skillId: "sk-1",
    name: "pdf-processing",
    description: "Extract PDF text, fill forms, merge PDFs.",
    versionId: "ver-1",
    versionLabel: "v1",
    version: {
      versionLabel: "v1",
      manifest: { name: "pdf-processing", description: "" },
    } as ResolvedSkill["version"],
    manifest: { name: "pdf-processing", description: "" },
    files: [
      {
        path: "SKILL.md",
        size: 20,
        isBinary: false,
        isSkillMd: true,
        kind: "skill_md",
        tokenTotal: 5,
      },
      {
        path: "reference.md",
        size: 10,
        isBinary: false,
        isSkillMd: false,
        kind: "reference",
        tokenTotal: 3,
      },
    ],
    skillMdBody: "---\nname: pdf-processing\n---\nbody",
    eager: false,
    ...over,
  };
}

const SKILL_FILE_TEXT: Record<string, Record<string, string>> = {
  "ver-1": { "SKILL.md": "---\nname: pdf-processing\n---\nbody", "reference.md": "See appendix." },
};

/** A stub `SkillFileBytesReader` backed by {@link SKILL_FILE_TEXT} — no DB. */
function stubSkillReader(): SkillFileBytesReader {
  return {
    getFileBytes: (versionId, filePath) => {
      const text = SKILL_FILE_TEXT[versionId]?.[filePath];
      if (text === undefined) throw new Error(`no such file ${versionId}/${filePath}`);
      return { bytes: Buffer.from(text, "utf8"), isBinary: false };
    },
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

// WP1.4 (Unified Sessions) — a fully controllable, synchronous fake SessionClock time source, mirroring
// `session-clock.test.ts`'s `createFakeSessionClockTime`. SessionClock's REAL time source deliberately
// `unref()`s its timers (so a pending clock never by itself keeps the Node process alive past an
// otherwise-finished run) — with this test's purely in-memory FakeDriver/Pushable providing no OTHER
// libuv work, a real short deadline would race the test runner's own "is the event loop empty yet"
// check and could get cancelled before it ever fires. The fake time sidesteps that: `advance(ms)` fires
// due timers synchronously, deterministically, with no real waiting at all.
type FakeTimerEntry = { id: number; at: number; fn: () => void; canceled: boolean; fired: boolean };
function createFakeClockTime(): { time: SessionClockTime; advance: (ms: number) => void } {
  let current = 0;
  let nextId = 1;
  const timers: FakeTimerEntry[] = [];
  const time: SessionClockTime = {
    now: () => current,
    schedule: (fn, ms) => {
      const entry: FakeTimerEntry = {
        id: nextId++,
        at: current + Math.max(0, ms),
        fn,
        canceled: false,
        fired: false,
      };
      timers.push(entry);
      return () => {
        entry.canceled = true;
      };
    },
  };
  function advance(ms: number): void {
    const target = current + ms;
    for (;;) {
      const due = timers
        .filter((t) => !t.canceled && !t.fired && t.at <= target)
        .sort((a, b) => a.at - b.at || a.id - b.id);
      const next = due[0];
      if (!next) break;
      current = next.at;
      next.fired = true;
      next.fn();
    }
    current = target;
  }
  return { time, advance };
}

/** Build a config, defaulting every DI seam to an offline stub (a fresh gate so tests never share one). */
function makeConfig(
  driver: FakeDriver,
  overrides: Partial<ClaudeSubscriptionRunConfig> = {},
): ClaudeSubscriptionRunConfig {
  return {
    model: MODEL,
    prompt: PROMPT,
    system: "You are a data analyst agent.",
    maxTurns: 12,
    driver,
    resolveAuth: () => AUTH,
    concurrency: new AsyncSemaphore(1),
    createWorkspace: fakeWorkspaces().create,
    ...overrides,
  };
}

/** Collect every emitted RunEvent, return them + a tiny query helper. */
function collector(): { emit: (e: RunEvent) => void; events: RunEvent[] } {
  const events: RunEvent[] = [];
  return { emit: (e) => events.push(e), events };
}

type StatusEvent = { type: "status"; status: string; outcome?: string; stopReason?: string };
type KpiEvent = {
  type: "kpi";
  turns: number;
  toolCalls: number;
  tokensIn: number;
  tokensOut: number;
  contextTokens: number;
  costUsd: number;
  costBasis?: string;
};
type DeltaEvent = { type: "delta"; channel: string; text: string; turnIndex?: number };

const steps = (events: RunEvent[]): RunStep[] =>
  events.flatMap((e) => (e.type === "step" ? [e.step] : []));
const kpis = (events: RunEvent[]): KpiEvent[] =>
  events.filter((e) => e.type === "kpi") as unknown as KpiEvent[];
const statuses = (events: RunEvent[]): StatusEvent[] =>
  events.filter((e) => e.type === "status") as unknown as StatusEvent[];
const deltas = (events: RunEvent[]): DeltaEvent[] =>
  events.filter((e) => e.type === "delta") as unknown as DeltaEvent[];

// ── Happy path (automated single-turn) — D-CS3 event/step/KPI shapes ──────────────────────────────────
test("happy path: user_message + delta + llm_response + kpi + completed; exact usage; one-shot driver shape", async () => {
  const driver = new FakeDriver();
  driver.onStart = (s) => {
    s.emit({ type: "assistant_delta", text: "The average " });
    s.emit({ type: "assistant_delta", text: "fare was $18.50." });
    s.emit({ type: "assistant_message", text: "The average fare was $18.50." });
    s.emit(USAGE);
  };
  const ws = fakeWorkspaces();
  const { emit, events } = collector();
  const cfg = makeConfig(driver, { createWorkspace: ws.create });

  const result = await runClaudeSubscription("run-1", cfg, emit);

  // Terminal LoopResult.
  assert.equal(result.status, "completed");
  assert.equal(result.outcome, "completed");
  assert.equal(result.turns, 1);
  assert.equal(result.tokensIn, 125); // 100 input + 20 cache-read + 5 cache-write (billed input incl. cache)
  assert.equal(result.tokensOut, 40);

  // Ordered RunEvents — status running first, terminal completed last (D-CS3: same envelope as AI-SDK path).
  assert.equal(events[0]?.type, "status");
  assert.equal(statuses(events)[0]?.status, "running");
  assert.equal(statuses(events).at(-1)?.status, "completed");
  assert.equal(statuses(events).at(-1)?.outcome, "completed");

  // Opener user_message step (turnIndex 0), then the llm_response step.
  const stepList = steps(events);
  const userStep = stepList.find((s) => s.type === "user_message");
  assert.ok(userStep, "emitted a user_message step");
  assert.equal(userStep?.turnIndex, 0);
  assert.deepEqual(userStep?.payload, { text: PROMPT });

  // Live text deltas on the `text` channel with the turn's index.
  const deltaEvents = deltas(events);
  assert.equal(deltaEvents.length, 2);
  assert.equal(deltaEvents[0]?.channel, "text");
  assert.equal(deltaEvents[0]?.turnIndex, 0);

  // The closing llm_response step — EXACT usage (no est. on counts), label = model, meteringEstimated
  // (turn-granular context), settled assistant prose, wall-clock timing.
  const llm = stepList.find((s) => s.type === "llm_response");
  assert.ok(llm, "emitted an llm_response step");
  assert.equal(llm?.label, MODEL);
  assert.equal(llm?.status, "ok");
  assert.equal(llm?.turnIndex, 0);
  assert.equal(llm?.assistantText, "The average fare was $18.50.");
  assert.deepEqual(llm?.usageActual, {
    inputTokens: 125,
    outputTokens: 40,
    cachedInputTokens: 25,
    cacheReadTokens: 20,
    cacheWriteTokens: 5,
  });
  assert.equal(
    llm?.meteringEstimated,
    true,
    "turn-granular context/footprint is flagged estimated",
  );
  assert.equal(llm?.cumulativeTokens, 165);
  assert.ok(typeof llm?.startedAt === "string" && typeof llm?.endedAt === "string");

  // The final KPI — cumulative EXACT tokens, turn-granular peak context, the SHADOW reference cost
  // (D-CS8) + the subscription basis. `costUsd` = estimateCost(model, exact usage), priced the SAME way
  // an API-keyed Claude run is (marginal subscription cost is $0); costBasis flags it "est. · subscription".
  const kpi = kpis(events).at(-1);
  assert.ok(kpi);
  assert.equal(kpi.turns, 1);
  assert.equal(kpi.toolCalls, 0);
  assert.equal(kpi.tokensIn, 125);
  assert.equal(kpi.tokensOut, 40);
  assert.equal(kpi.contextTokens, 165);
  const expectedUsage = {
    inputTokens: 125,
    outputTokens: 40,
    cachedInputTokens: 25,
    cacheReadTokens: 20,
    cacheWriteTokens: 5,
  };
  // Exactly the same function the AI-SDK path prices with — a concrete positive number (≈ $0.00092475
  // for claude-sonnet-4-5: 100·$3 + 20·$0.30 + 5·$3.75 + 40·$15, per 1e6 tokens).
  assert.equal(kpi.costUsd, estimateCost(MODEL, expectedUsage));
  assert.ok(kpi.costUsd > 0, "a priced model yields a positive shadow cost");
  assert.ok(Math.abs(kpi.costUsd - 0.00092475) < 1e-9, "concrete shadow cost");
  assert.equal(kpi.costBasis, "subscription_reference");

  // Driver session shape — tools-less multi-turn (maxTurns from guardrails), forwarded system prompt.
  const opts = driver.sessions[0]!.options;
  assert.equal(opts.model, MODEL);
  assert.equal(opts.maxTurns, 12);
  assert.equal(opts.systemPrompt, "You are a data analyst agent.");
  assert.deepEqual(opts.mcpServers, {}); // tools-less at THIS WP
  assert.deepEqual([...opts.disallowedTools], [...SUBSCRIPTION_DISALLOWED_TOOLS]);
  assert.deepEqual(driver.sessions[0]!.sent, [PROMPT]);

  // Child env — the subscription token + a throwaway HOME/CLAUDE_CONFIG_DIR; no API key; token never logged.
  assert.equal(opts.env.CLAUDE_CODE_OAUTH_TOKEN, AUTH.token);
  assert.equal(opts.env.ANTHROPIC_API_KEY, undefined);
  assert.ok(opts.env.HOME?.startsWith(ws.dirs[0]!), "HOME scoped under the throwaway dir");
  assert.ok(
    opts.env.CLAUDE_CONFIG_DIR?.startsWith(ws.dirs[0]!),
    "CLAUDE_CONFIG_DIR scoped under it",
  );

  // Workspace cleaned up + the session torn down.
  assert.equal(ws.cleanups(), 1);
  assert.equal(driver.sessions[0]!.options.abortController.signal.aborted, true);
});

test("turn_done without usage → no usageActual, no meteringEstimated, zeroed token KPIs (never crashes)", async () => {
  const driver = new FakeDriver();
  driver.onStart = (s) => {
    s.emit({ type: "assistant_message", text: "done" });
    s.emit({ type: "turn_done" }); // no usage field
  };
  const { emit, events } = collector();
  const result = await runClaudeSubscription("run-nousage", makeConfig(driver), emit);
  assert.equal(result.status, "completed");
  const llm = steps(events).find((s) => s.type === "llm_response");
  assert.equal("usageActual" in (llm ?? {}), false);
  assert.equal(llm?.meteringEstimated, undefined);
  const kpi = kpis(events).at(-1);
  assert.equal(kpi?.tokensIn, 0);
  assert.equal(kpi?.tokensOut, 0);
});

// ── Tool-step mapping seam (WP 1.3) — wired but not exercised by policy at THIS WP ────────────────────
test("tool_call/tool_result map to tool steps (the WP 1.3 seam): running call + ok result + toolCalls KPI", async () => {
  const driver = new FakeDriver();
  driver.onStart = (s) => {
    s.emit({ type: "tool_call", toolUseId: "tu-1", toolName: "search_docs", input: { q: "fare" } });
    s.emit({ type: "tool_result", toolUseId: "tu-1", result: { rows: 3 } });
    s.emit({ type: "assistant_message", text: "Found 3." });
    s.emit(USAGE);
  };
  const { emit, events } = collector();
  const result = await runClaudeSubscription("run-tools", makeConfig(driver), emit);
  assert.equal(result.status, "completed");

  const stepList = steps(events);
  const call = stepList.find((s) => s.type === "tool_call");
  assert.equal(call?.status, "running");
  assert.equal(call?.toolName, "search_docs");
  assert.equal(call?.turnIndex, 0);
  assert.deepEqual(call?.payload, { toolCallId: "tu-1", args: { q: "fare" } });

  const toolResult = stepList.find((s) => s.type === "tool_result");
  assert.equal(toolResult?.status, "ok");
  assert.equal(toolResult?.toolName, "search_docs");
  assert.deepEqual(toolResult?.payload, { toolCallId: "tu-1", result: { rows: 3 } });

  assert.equal(kpis(events).at(-1)?.toolCalls, 1);

  // Observability WP3.1 (D-OB17) — the `tool_io` child is ENGINE-PATH ONLY (emitted by the engine's
  // MCP-bridge accounting sink). The subscription executor owns its MCP internally and emits its own
  // tool_call/tool_result steps WITHOUT that sink, so it never emits a tool_io child.
  assert.equal(
    stepList.filter((s) => s.spanKind === "tool_io").length,
    0,
    "the subscription path emits no tool_io child (its MCP is internal; not the engine sink)",
  );
});

test("tool_result with isError → a FAILED tool step, not a thrown run", async () => {
  const driver = new FakeDriver();
  driver.onStart = (s) => {
    s.emit({ type: "tool_call", toolUseId: "tu-9", toolName: "broken", input: {} });
    s.emit({ type: "tool_result", toolUseId: "tu-9", result: { message: "boom" }, isError: true });
    s.emit(USAGE);
  };
  const { emit, events } = collector();
  const result = await runClaudeSubscription("run-toolerr", makeConfig(driver), emit);
  assert.equal(result.status, "completed"); // a tool-level failure does not fail the run
  assert.equal(steps(events).find((s) => s.type === "tool_result")?.status, "error");
});

// ── Interactive multi-turn ────────────────────────────────────────────────────────────────────────────
test("interactive: opener + 2 follow-ups on one warm session, cumulative KPIs, ends aborted", async () => {
  const driver = new FakeDriver();
  // Each user turn (opener + follow-ups) gets answered on the SAME session via `send`.
  let turnNo = 0;
  driver.onSend = (_text, s) => {
    turnNo += 1;
    s.emit({ type: "assistant_message", text: `answer ${turnNo}` });
    s.emit({
      type: "turn_done",
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
      },
    });
  };
  const queue = ["follow up 1", "follow up 2", null] as (string | null)[];
  const turns = { nextTurn: async () => queue.shift() ?? null };
  const { emit, events } = collector();

  const result = await runClaudeSubscriptionInteractive("run-int", makeConfig(driver), turns, emit);

  // One warm session drove all three user turns.
  assert.equal(driver.sessions.length, 1);
  assert.deepEqual(driver.sessions[0]!.sent, [PROMPT, "follow up 1", "follow up 2"]);

  // Three user_message + three llm_response steps, turnIndex 0..2.
  const stepList = steps(events);
  const userSteps = stepList.filter((s) => s.type === "user_message");
  const llmSteps = stepList.filter((s) => s.type === "llm_response");
  assert.equal(userSteps.length, 3);
  assert.equal(llmSteps.length, 3);
  assert.deepEqual(
    llmSteps.map((s) => s.turnIndex),
    [0, 1, 2],
  );

  // KPIs are cumulative (turns 1→2→3; tokens accumulate).
  const kpiList = kpis(events);
  assert.deepEqual(
    kpiList.map((k) => k.turns),
    [1, 2, 3],
  );
  assert.equal(kpiList.at(-1)?.tokensIn, 30);
  assert.equal(kpiList.at(-1)?.tokensOut, 15);
  assert.equal(kpiList.at(-1)?.costBasis, "subscription_reference");

  // A conversation ended by the user (nextTurn → null) is an aborted terminal (never "completed").
  assert.equal(result.status, "aborted");
  assert.equal(result.outcome, "aborted");
  assert.equal(result.turns, 3);
});

// ── Honest degradation (D-CS7) ────────────────────────────────────────────────────────────────────────
test("auth absent → honest `error` terminal; nothing spawned, no workspace created", async () => {
  const driver = new FakeDriver();
  const ws = fakeWorkspaces();
  const { emit, events } = collector();
  const cfg = makeConfig(driver, { resolveAuth: () => null, createWorkspace: ws.create });

  const result = await runClaudeSubscription("run-noauth", cfg, emit);

  assert.equal(result.status, "error");
  assert.equal(result.outcome, "error");
  assert.match(result.stopReason ?? "", /signed-in Claude subscription/);
  assert.equal(driver.sessions.length, 0, "never started a child");
  assert.equal(ws.dirs.length, 0, "never created a throwaway workspace");
  // An error event + terminal error status were surfaced (never a fabricated success).
  assert.ok(events.some((e) => e.type === "error"));
  assert.equal(statuses(events).at(-1)?.status, "error");
});

test("driver limit_error → honest `error` terminal carrying the truthful message (auth + rate_limit)", async () => {
  for (const kind of ["rate_limit", "auth"] as const) {
    const driver = new FakeDriver();
    driver.onStart = (s) =>
      s.emit({ type: "limit_error", message: "the subscription hit a limit", kind });
    const ws = fakeWorkspaces();
    const { emit, events } = collector();
    const result = await runClaudeSubscription(
      "run-limit",
      makeConfig(driver, { createWorkspace: ws.create }),
      emit,
    );
    assert.equal(result.status, "error");
    assert.equal(result.outcome, "error");
    assert.equal(result.stopReason, "the subscription hit a limit");
    assert.equal(statuses(events).at(-1)?.status, "error");
    // Torn down + cleaned up even on the error path.
    assert.equal(driver.sessions[0]!.options.abortController.signal.aborted, true);
    assert.equal(ws.cleanups(), 1);
  }
});

test("driver `error` event → honest `error` terminal", async () => {
  const driver = new FakeDriver();
  driver.onStart = (s) => s.emit({ type: "error", message: "the model failed" });
  const { emit, events } = collector();
  const result = await runClaudeSubscription("run-err", makeConfig(driver), emit);
  assert.equal(result.outcome, "error");
  assert.equal(result.stopReason, "the model failed");
  assert.equal(statuses(events).at(-1)?.status, "error");
});

test("stream ends before turn_done → honest `error` terminal (no fabricated success)", async () => {
  const driver = new FakeDriver();
  driver.onStart = (s) => {
    s.emit({ type: "assistant_message", text: "partial…" });
    s.out.end(); // stream ends without a turn_done
  };
  const { emit, events } = collector();
  const result = await runClaudeSubscription("run-early-end", makeConfig(driver), emit);
  assert.equal(result.outcome, "error");
  assert.match(result.stopReason ?? "", /no result before the session ended/);
  assert.equal(statuses(events).at(-1)?.status, "error");
});

test("wall-clock deadline → stopped_guardrail (driver never completes; deadline aborts it)", async () => {
  const driver = new FakeDriver(); // no onStart → the turn never completes
  const { emit, events } = collector();
  const { time, advance } = createFakeClockTime();
  const startedAt = Date.now();
  const resultPromise = runClaudeSubscription(
    "run-deadline",
    makeConfig(driver, { maxRunDurationMs: 25, clockTime: time }),
    emit,
  );
  // Wait until the session actually exists (SessionClock.start() — and so the 25ms wall-cap timer —
  // always precedes session creation), THEN fire the fake clock forward deterministically.
  await waitFor(() => driver.sessions.length === 1);
  advance(25);
  const result = await resultPromise;
  assert.ok(Date.now() - startedAt < 2000, "settled well within the bound (no hang)");
  assert.equal(result.status, "stopped");
  assert.equal(result.outcome, "stopped_guardrail");
  assert.match(result.stopReason ?? "", /maxRunDurationMs \(25ms\) reached/);
  assert.equal(statuses(events).at(-1)?.outcome, "stopped_guardrail");
  assert.equal(driver.sessions[0]!.options.abortController.signal.aborted, true);
});

test("user stop → aborted (abort wins over the generic driver error)", async () => {
  const controller = new AbortController();
  const driver = new FakeDriver();
  // The user stops the run right as it starts (the session is torn down mid-turn).
  driver.onStart = () => controller.abort();
  const { emit, events } = collector();
  const result = await runClaudeSubscription(
    "run-stop",
    makeConfig(driver, { abortSignal: controller.signal }),
    emit,
  );
  assert.equal(result.status, "aborted");
  assert.equal(result.outcome, "aborted");
  assert.equal(result.stopReason, "Run aborted by user");
  assert.equal(statuses(events).at(-1)?.status, "aborted");
});

// ── WP 1.3: MCP tools via the SDK mcpServers option + allow-list enforcement ──────────────────────────
test("mcpServers + allowedTools are threaded to the driver; canUseTool default-denies a non-allow-listed tool", async () => {
  const driver = new FakeDriver();
  driver.onStart = (s) => {
    s.emit({ type: "assistant_message", text: "done" });
    s.emit(USAGE);
  };
  const mcpServers = { "srv-1": { type: "stdio", command: "noop" } };
  const allowedTools = ["mcp__srv-1__alpha", "mcp__srv-1__beta"];
  const { emit } = collector();
  const cfg = makeConfig(driver, { mcpServers, allowedTools });

  await runClaudeSubscription("run-tools-wired", cfg, emit);

  const opts = driver.sessions[0]!.options;
  // (a) The allow-listed server + patterns reach the driver verbatim.
  assert.deepEqual(opts.mcpServers, mcpServers);
  assert.deepEqual([...(opts.allowedTools ?? [])], allowedTools);
  // The built-in exec/network blocks are still applied (MCP tools ride mcpServers/allowedTools, not this list).
  assert.deepEqual([...opts.disallowedTools], [...SUBSCRIPTION_DISALLOWED_TOOLS]);

  // (b) A DEFAULT-DENY canUseTool gate makes a non-allow-listed tool genuinely uncallable.
  assert.equal(typeof opts.canUseTool, "function");
  const signal = new AbortController().signal;
  const allowDecision = await opts.canUseTool!({
    toolName: "mcp__srv-1__alpha",
    input: {},
    toolUseId: "t1",
    signal,
  });
  assert.equal(allowDecision.behavior, "allow");
  const denyDecision = await opts.canUseTool!({
    toolName: "mcp__srv-1__gamma", // scanned on the server but NOT allow-listed
    input: {},
    toolUseId: "t2",
    signal,
  });
  assert.equal(denyDecision.behavior, "deny");
  assert.match(
    denyDecision.behavior === "deny" ? denyDecision.message : "",
    /not on this run's allow-list/,
  );
});

test("a tools-less run wires NO allowedTools/canUseTool (WP 1.1/1.2 shape unchanged)", async () => {
  const driver = new FakeDriver();
  driver.onStart = (s) => {
    s.emit({ type: "assistant_message", text: "done" });
    s.emit(USAGE);
  };
  const { emit } = collector();
  // No mcpServers/allowedTools override → defaults (tools-less).
  await runClaudeSubscription("run-no-tools", makeConfig(driver), emit);
  const opts = driver.sessions[0]!.options;
  assert.deepEqual(opts.mcpServers, {});
  assert.equal(opts.allowedTools, undefined, "no allow patterns on a tools-less run");
  assert.equal(opts.canUseTool, undefined, "no permission gate on a tools-less run");
});

test("tool_result carries ESTIMATED, MARKED metering (resultBytes + profileTokens) and does NOT inflate usageActual", async () => {
  const driver = new FakeDriver();
  driver.onStart = (s) => {
    s.emit({ type: "tool_call", toolUseId: "tu-1", toolName: "search_docs", input: { q: "fare" } });
    s.emit({ type: "tool_result", toolUseId: "tu-1", result: { rows: 3 } });
    s.emit({ type: "assistant_message", text: "Found 3." });
    s.emit(USAGE); // exact provider counts: 125 billed input / 40 output
  };
  const { emit, events } = collector();
  const cfg = makeConfig(driver, {
    mcpServers: { "srv-1": { type: "stdio", command: "noop" } },
    allowedTools: ["mcp__srv-1__search_docs"],
    profiles: ["generic_o200k", "generic_cl100k"],
  });

  const result = await runClaudeSubscription("run-tool-metering", cfg, emit);
  assert.equal(result.status, "completed");

  // The tool_result step is ESTIMATED + MARKED: lenses per profile, byte size, meteringEstimated flag.
  const toolResult = steps(events).find((s) => s.type === "tool_result")!;
  assert.equal(toolResult.status, "ok");
  assert.equal(
    toolResult.meteringEstimated,
    true,
    "the local per-tool footprint is flagged estimated",
  );
  assert.equal(toolResult.resultBytes, Buffer.byteLength(JSON.stringify({ rows: 3 }), "utf8"));
  assert.ok((toolResult.profileTokens.generic_o200k ?? 0) > 0, "counted under the primary lens");
  assert.ok(
    (toolResult.profileTokens.generic_cl100k ?? 0) > 0,
    "counted under every effective lens",
  );
  // Crucially it never inflates the EXACT token totals (those stay from turn_done.usage only).
  assert.equal("usageActual" in toolResult, false, "a tool_result step carries no usageActual");
  const llm = steps(events).find((s) => s.type === "llm_response")!;
  assert.equal(llm.usageActual?.inputTokens, 125);
  assert.equal(llm.usageActual?.outputTokens, 40);
  const kpi = kpis(events).at(-1)!;
  assert.equal(kpi.tokensIn, 125, "tool-result tokens are NOT folded into the exact input total");
  assert.equal(kpi.tokensOut, 40);
  assert.equal(kpi.toolCalls, 1);
});

test("tool `isError` → a FAILED step (still metered) and the run CONTINUES to completion", async () => {
  const driver = new FakeDriver();
  driver.onStart = (s) => {
    s.emit({ type: "tool_call", toolUseId: "tu-9", toolName: "broken", input: {} });
    s.emit({ type: "tool_result", toolUseId: "tu-9", result: { message: "boom" }, isError: true });
    s.emit({ type: "assistant_message", text: "recovered" });
    s.emit(USAGE);
  };
  const { emit, events } = collector();
  const cfg = makeConfig(driver, {
    mcpServers: { "srv-1": { type: "stdio", command: "noop" } },
    allowedTools: ["mcp__srv-1__broken"],
  });
  const result = await runClaudeSubscription("run-toolerr-1_3", cfg, emit);

  // A tool-level failure is a failed STEP, never a failed run.
  assert.equal(result.status, "completed");
  const toolResult = steps(events).find((s) => s.type === "tool_result")!;
  assert.equal(toolResult.status, "error");
  assert.equal(
    toolResult.meteringEstimated,
    true,
    "a failed tool result is still metered + marked",
  );
  assert.ok((toolResult.resultBytes ?? 0) > 0);
});

test("a genuine MCP transport failure (driver `error` mid-tool) FAILS the run with an honest terminal", async () => {
  const driver = new FakeDriver();
  driver.onStart = (s) => {
    // The model calls a tool; the SDK then surfaces the MCP server's connection/transport failure as a
    // stream-level error (the SDK maps a `result` error subtype → a driver `error` event).
    s.emit({ type: "tool_call", toolUseId: "tu-x", toolName: "search_docs", input: {} });
    s.emit({ type: "error", message: "MCP server srv-1 failed to connect" });
  };
  const { emit, events } = collector();
  const cfg = makeConfig(driver, {
    mcpServers: { "srv-1": { type: "stdio", command: "noop" } },
    allowedTools: ["mcp__srv-1__search_docs"],
  });
  const result = await runClaudeSubscription("run-transport-fail", cfg, emit);

  assert.equal(result.status, "error");
  assert.equal(result.outcome, "error");
  assert.equal(result.stopReason, "MCP server srv-1 failed to connect");
  assert.equal(statuses(events).at(-1)?.status, "error");
  assert.ok(
    events.some((e) => e.type === "error"),
    "surfaced an honest error (never a fake tool result)",
  );
});

// ── Concurrency gate (D-CS10) — shared budget serializes ~1 GiB children ──────────────────────────────
test("concurrency gate (permits 1): two overlapping runs never start two drivers at once", async () => {
  const driver = new FakeDriver(); // manual scripting — do NOT auto-complete on start
  const gate: ConcurrencyGate = new AsyncSemaphore(1);
  const a = collector();
  const b = collector();

  const callA = runClaudeSubscription("run-A", makeConfig(driver, { concurrency: gate }), a.emit);
  const callB = runClaudeSubscription("run-B", makeConfig(driver, { concurrency: gate }), b.emit);

  // A holds the sole permit and starts; B is blocked on `acquire`, so only ONE child exists.
  await waitFor(() => driver.sessions.length === 1);
  assert.equal(driver.active, 1);

  // Complete A → releases the permit → B may start.
  driver.sessions[0]!.emit(USAGE);
  const resultA = await callA;
  await waitFor(() => driver.sessions.length === 2);
  driver.sessions[1]!.emit(USAGE);
  const resultB = await callB;

  assert.equal(driver.maxActive, 1, "never two subscription children at once");
  assert.equal(resultA.outcome, "completed");
  assert.equal(resultB.outcome, "completed");
});

// ── WP 1.5 (D-CS8): shadow-priced cost cap + unpriced-model rejection ──────────────────────────────────

// A single automated turn's exact usage → its shadow cost (priced the SAME way as an API-keyed run).
const ONE_TURN_USAGE = {
  inputTokens: 125,
  outputTokens: 40,
  cachedInputTokens: 25,
  cacheReadTokens: 20,
  cacheWriteTokens: 5,
};
const ONE_TURN_COST = estimateCost(MODEL, ONE_TURN_USAGE); // ≈ 0.00092475 for claude-sonnet-4-5

/** Run one automated turn (USAGE) under a given `maxCostUsd`, returning the terminal + events. */
async function runWithCap(
  maxCostUsd: number,
): Promise<{ result: Awaited<ReturnType<typeof runClaudeSubscription>>; events: RunEvent[] }> {
  const driver = new FakeDriver();
  driver.onStart = (s) => {
    s.emit({ type: "assistant_message", text: "done" });
    s.emit(USAGE);
  };
  const { emit, events } = collector();
  const result = await runClaudeSubscription("run-cap", makeConfig(driver, { maxCostUsd }), emit);
  return { result, events };
}

test("cost cap (D-CS8): the >= boundary — cost EQUAL to maxCostUsd trips stopped_guardrail; strictly under does NOT", async () => {
  assert.ok(ONE_TURN_COST > 0, "the fixture prices to a positive shadow cost");

  // EQUAL → trips (proves `>=`, not `>`): cost exactly reaches the cap → stop with the named budget.
  {
    const { result, events } = await runWithCap(ONE_TURN_COST);
    assert.equal(result.status, "stopped");
    assert.equal(result.outcome, "stopped_guardrail");
    assert.match(result.stopReason ?? "", /maxCostUsd/);
    assert.equal(statuses(events).at(-1)?.outcome, "stopped_guardrail");
    // Token COUNTS stay EXACT even when stopped by cost (from turn_done.usage; pricing never touches them).
    assert.equal(result.tokensIn, 125);
    assert.equal(result.tokensOut, 40);
    const kpi = kpis(events).at(-1)!;
    assert.equal(kpi.costUsd, ONE_TURN_COST);
    assert.equal(kpi.costBasis, "subscription_reference");
  }

  // OVER (cap well below the cost) → trips.
  {
    const { result } = await runWithCap(ONE_TURN_COST / 2);
    assert.equal(result.outcome, "stopped_guardrail");
  }

  // STRICTLY UNDER (cap just ABOVE the cost) → does NOT trip → completes normally (the sign is right:
  // a cost below the budget must not stop the run).
  {
    const { result, events } = await runWithCap(ONE_TURN_COST + 1e-9);
    assert.equal(result.status, "completed");
    assert.equal(result.outcome, "completed");
    assert.equal(kpis(events).at(-1)?.costUsd, ONE_TURN_COST);
  }
});

test("cost cap (D-CS8): an interactive run STOPS mid-conversation once the cumulative shadow cost crosses maxCostUsd", async () => {
  const perTurnUsage = {
    inputTokens: 10,
    outputTokens: 5,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
  };
  const perTurnCost = estimateCost(MODEL, { inputTokens: 10, outputTokens: 5 });
  const driver = new FakeDriver();
  driver.onSend = (_text, s) => {
    s.emit({ type: "assistant_message", text: "answer" });
    s.emit({ type: "turn_done", usage: perTurnUsage });
  };
  // Cap = exactly TWO turns' cost → not tripped after turn 1 (cost < cap), tripped after turn 2 (cost ==
  // cap, the >= boundary) — i.e. mid-conversation, with follow-ups still queued.
  const queue = ["follow up 1", "follow up 2", "follow up 3", null] as (string | null)[];
  const turns = { nextTurn: async () => queue.shift() ?? null };
  const { emit, events } = collector();

  const result = await runClaudeSubscriptionInteractive(
    "run-cap-int",
    makeConfig(driver, { maxCostUsd: perTurnCost * 2 }),
    turns,
    emit,
  );

  assert.equal(result.status, "stopped");
  assert.equal(result.outcome, "stopped_guardrail");
  assert.match(result.stopReason ?? "", /maxCostUsd/);
  // Opener + exactly ONE follow-up were sent before the cap stopped it; later queued turns never ran.
  assert.deepEqual(driver.sessions[0]!.sent, [PROMPT, "follow up 1"]);
  assert.equal(result.turns, 2);
  // Token COUNTS stay exact and cumulative; the cost is the SUM of the per-turn shadow costs.
  assert.equal(result.tokensIn, 20);
  assert.equal(result.tokensOut, 10);
  const kpi = kpis(events).at(-1)!;
  assert.equal(kpi.costUsd, perTurnCost * 2);
  assert.equal(kpi.costBasis, "subscription_reference");
});

test("cost cap (D-CS8) set on an UNPRICED model → honest fail-fast BEFORE anything is spawned", async () => {
  const driver = new FakeDriver();
  const ws = fakeWorkspaces();
  const { emit, events } = collector();
  const cfg = makeConfig(driver, {
    model: "claude-unpriced-xyz", // not in the pricing table → estimateCost would be 0 forever
    maxCostUsd: 0.01,
    createWorkspace: ws.create,
  });

  const result = await runClaudeSubscription("run-unpriced-cap", cfg, emit);

  assert.equal(result.status, "error");
  assert.equal(result.outcome, "error");
  assert.match(result.stopReason ?? "", /no known pricing/);
  assert.match(result.stopReason ?? "", /Refusing to run/);
  assert.equal(driver.sessions.length, 0, "never spawned a child");
  assert.equal(ws.dirs.length, 0, "never created a workspace");
  assert.ok(events.some((e) => e.type === "error"));
  assert.equal(statuses(events).at(-1)?.status, "error");
});

test("an UNPRICED model WITHOUT a cost cap runs fine — cost is a floor of $0 (subscription_reference); counts still exact", async () => {
  const driver = new FakeDriver();
  driver.onStart = (s) => {
    s.emit({ type: "assistant_message", text: "done" });
    s.emit(USAGE);
  };
  const { emit, events } = collector();
  const cfg = makeConfig(driver, { model: "claude-unpriced-xyz" }); // no maxCostUsd → no rejection

  const result = await runClaudeSubscription("run-unpriced-nocap", cfg, emit);

  assert.equal(result.status, "completed");
  const kpi = kpis(events).at(-1)!;
  assert.equal(
    kpi.costUsd,
    0,
    "an unpriced model prices at a floor of 0 (never a run-blocker without a cap)",
  );
  assert.equal(kpi.costBasis, "subscription_reference");
  // Token COUNTS remain EXACT regardless of whether the model can be priced.
  assert.equal(kpi.tokensIn, 125);
  assert.equal(kpi.tokensOut, 40);
});

// ── WP 1.4 (D-CS9, skills half): skills materialized read-only into the SDK workspace ─────────────────

test("no resolvedSkills on the config → no skills dir, no extra mcpServer/allowedTools/additionalDirectories (byte-for-byte unchanged)", async () => {
  const driver = new FakeDriver();
  driver.onStart = (s) => {
    s.emit({ type: "assistant_message", text: "done" });
    s.emit(USAGE);
  };
  const { emit } = collector();
  // makeConfig's default carries no resolvedSkills/skillFileReader at all.
  await runClaudeSubscription("run-no-skills", makeConfig(driver), emit);
  const opts = driver.sessions[0]!.options;
  assert.deepEqual(opts.mcpServers, {}, "no skills mcpServer entry");
  assert.equal(opts.allowedTools, undefined, "no allow patterns");
  assert.equal(opts.canUseTool, undefined, "no permission gate");
  assert.equal(opts.additionalDirectories, undefined, "no widened permission scope");
});

test("resolvedSkills present but NO skillFileReader injected → materialization is skipped gracefully (defensive default)", async () => {
  const driver = new FakeDriver();
  driver.onStart = (s) => {
    s.emit({ type: "assistant_message", text: "done" });
    s.emit(USAGE);
  };
  const { emit } = collector();
  const cfg = makeConfig(driver, { resolvedSkills: [resolvedSkillFixture()] }); // skillFileReader omitted
  await runClaudeSubscription("run-skills-no-reader", cfg, emit);
  const opts = driver.sessions[0]!.options;
  assert.deepEqual(opts.mcpServers, {}, "nothing was materialized, so no skills server is wired");
  assert.equal(opts.allowedTools, undefined);
  assert.equal(opts.additionalDirectories, undefined);
});

test("an attached skill's files are materialized read-only into the run's skills dir and wired to the driver (additionalDirectories + the skills mcpServer + allowedTools)", async () => {
  const driver = new FakeDriver();
  driver.onStart = (s) => {
    s.emit({ type: "assistant_message", text: "done" });
    s.emit(USAGE);
  };
  const { emit } = collector();
  const ws = realWorkspaceInspectable();
  const cfg = makeConfig(driver, {
    createWorkspace: ws.create,
    resolvedSkills: [resolvedSkillFixture()],
    skillFileReader: stubSkillReader(),
  });

  const result = await runClaudeSubscription("run-skills-materialized", cfg, emit);
  assert.equal(result.status, "completed");

  const opts = driver.sessions[0]!.options;
  const workspaceDir = ws.dirs[0]!;
  const skillsDir = path.join(workspaceDir, "skills");

  // (a) additionalDirectories widens the permission scope to the materialized skills dir.
  assert.deepEqual(opts.additionalDirectories, [skillsDir]);

  // (b) the skills in-process MCP server + its two allow patterns are wired.
  assert.ok(opts.mcpServers[SUBSCRIPTION_SKILLS_MCP_KEY], "the skills mcpServer entry is present");
  assert.deepEqual(
    [...(opts.allowedTools ?? [])].sort(),
    [
      `mcp__${SUBSCRIPTION_SKILLS_MCP_KEY}__${LIST_SKILL_FILES_TOOL}`,
      `mcp__${SUBSCRIPTION_SKILLS_MCP_KEY}__${READ_SKILL_FILE_TOOL}`,
    ].sort(),
  );

  // (c) a DEFAULT-DENY canUseTool gate covers exactly the skill tools (no MCP servers were allow-listed).
  assert.equal(typeof opts.canUseTool, "function");
  const signal = new AbortController().signal;
  const allow = await opts.canUseTool!({
    toolName: `mcp__${SUBSCRIPTION_SKILLS_MCP_KEY}__${READ_SKILL_FILE_TOOL}`,
    input: {},
    toolUseId: "t1",
    signal,
  });
  assert.equal(allow.behavior, "allow");
  const deny = await opts.canUseTool!({
    toolName: "mcp__other__tool",
    input: {},
    toolUseId: "t2",
    signal,
  });
  assert.equal(deny.behavior, "deny");

  // (d) the files are ACTUALLY on disk, read-only, under <skillsDir>/<skillId>/<path> (never executed —
  // materializeSkills only ever writes bytes; see subscription-skill-tools.test.ts for the tool-handler
  // proof that reading a "script" file returns its literal source text, not a run result).
  const skillMdPath = path.join(skillsDir, "sk-1", "SKILL.md");
  assert.equal(await fs.readFile(skillMdPath, "utf8"), SKILL_FILE_TEXT["ver-1"]!["SKILL.md"]);
  const mode = (await fs.stat(skillMdPath)).mode;
  assert.equal(mode & 0o222, 0, "materialized file carries no write permission bits");

  await fs.rm(workspaceDir, { recursive: true, force: true });
});

test("a skill-disclosure tool_result is metered ESTIMATED + MARKED exactly like any other MCP tool result, and never inflates usageActual", async () => {
  const driver = new FakeDriver();
  const toolName = `mcp__${SUBSCRIPTION_SKILLS_MCP_KEY}__${READ_SKILL_FILE_TOOL}`;
  driver.onStart = (s) => {
    s.emit({
      type: "tool_call",
      toolUseId: "tu-skill-1",
      toolName,
      input: { skill: "pdf-processing", path: "SKILL.md" },
    });
    s.emit({
      type: "tool_result",
      toolUseId: "tu-skill-1",
      result: {
        skill: "pdf-processing",
        path: "SKILL.md",
        contents: SKILL_FILE_TEXT["ver-1"]!["SKILL.md"],
      },
    });
    s.emit({ type: "assistant_message", text: "Read the skill." });
    s.emit(USAGE);
  };
  const ws = realWorkspaceInspectable();
  const { emit, events } = collector();
  const cfg = makeConfig(driver, {
    createWorkspace: ws.create,
    resolvedSkills: [resolvedSkillFixture()],
    skillFileReader: stubSkillReader(),
    profiles: ["generic_o200k"],
  });

  const result = await runClaudeSubscription("run-skill-disclosure-metered", cfg, emit);
  assert.equal(result.status, "completed");

  const toolResult = steps(events).find((s) => s.type === "tool_result")!;
  assert.equal(toolResult.status, "ok");
  assert.equal(
    toolResult.meteringEstimated,
    true,
    "the skill-disclosure result is flagged estimated (D-CS4/D-CS9)",
  );
  assert.ok((toolResult.profileTokens.generic_o200k ?? 0) > 0, "counted under the run's profile");
  assert.equal("usageActual" in toolResult, false, "a tool_result step carries no usageActual");

  const llm = steps(events).find((s) => s.type === "llm_response")!;
  assert.equal(
    llm.usageActual?.inputTokens,
    125,
    "the EXACT total is untouched by the skill-disclosure read",
  );
  assert.equal(llm.usageActual?.outputTokens, 40);
  const kpi = kpis(events).at(-1)!;
  assert.equal(kpi.toolCalls, 1);

  await fs.rm(ws.dirs[0]!, { recursive: true, force: true });
});

test("the built-in exec/network/native-file blocks stay disallowed even when skills are wired (never executed)", async () => {
  const driver = new FakeDriver();
  driver.onStart = (s) => {
    s.emit({ type: "assistant_message", text: "done" });
    s.emit(USAGE);
  };
  const { emit } = collector();
  const ws = realWorkspaceInspectable();
  const cfg = makeConfig(driver, {
    createWorkspace: ws.create,
    resolvedSkills: [resolvedSkillFixture()],
    skillFileReader: stubSkillReader(),
  });

  await runClaudeSubscription("run-skills-still-sandboxed", cfg, emit);
  const opts = driver.sessions[0]!.options;
  // Read/Glob/Grep/Bash/Edit/Write/… are STILL blocked — the skills mcpServer/allowedTools additions
  // never touch `disallowedTools`. This (not any per-file permission bit) is what makes a skill's own
  // scripts genuinely unrunnable: the child has no exec built-in to run them with.
  assert.deepEqual([...opts.disallowedTools], [...SUBSCRIPTION_DISALLOWED_TOOLS]);
  assert.ok(opts.disallowedTools.includes("Bash"));
  assert.ok(opts.disallowedTools.includes("Read"));

  await fs.rm(ws.dirs[0]!, { recursive: true, force: true });
});
