// Assistant Hub (roadmap/assistant-hub/, WP1.1) — the turn engine, driven by a STUBBED AI-SDK model
// (the `MockLanguageModelV3` + `simulateReadableStream` pattern the Testing engine tests use — no real
// provider, no API key). File lives at `apps/api/test/` because the api runner globs `test/*.test.ts`.
//
// Proves (per-Acceptance): a full turn assembles → streams → persists SETTLED events only (deltas
// forwarded, never persisted) → meters cost → terminates via `terminalFor` clocked by `SessionClock`;
// the durable steering queue injects a mid-run message at the next step boundary and survives; Stop
// preserves completed work with an explicit note; a limit error surfaces a retry-on-other-source event;
// a SessionClock wall-cap fire routes through `terminalFor`.

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import {
  HUB_ATTACHMENT_TEXT_INLINE_MAX_CHARS,
  type HubEvent,
  type HubSession,
  type HubTextPart,
} from "@mcp-token-footprint/shared";
import { tool } from "ai";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { z } from "zod";
import { applyMigrations, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { hubCapabilitiesForKind } from "../src/hub/capabilities.js";
import { HubRepository } from "../src/hub/repository.js";
import type { SessionClockTime } from "../src/testing/session-clock.js";
import {
  HubSteeringQueue,
  isBudgetTripStopReason,
  reconstructMessages,
  retrySourcesFor,
  runHubTurn,
  wrapSinkForWaitingInputNotify,
  type HubNotifyEvent,
  type HubStreamDelta,
  type HubTurnInput,
  type HubTurnSink,
} from "../src/hub/turn-engine.js";

// Derive the low-level provider (V3) stream-part type from MockLanguageModelV3's own `doStream` (matches
// the installed SDK, no extra dep — the exact trick agent-loop.test.ts uses).
type MockStreamResult = Awaited<ReturnType<NonNullable<MockLanguageModelV3["doStream"]>>>;
type V3Part = MockStreamResult["stream"] extends ReadableStream<infer P> ? P : never;

const USAGE = {
  inputTokens: { total: 12, noCache: 12, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 7, text: 7, reasoning: 0 },
} as const;

const databases: AppDatabase[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function openRepo(): HubRepository {
  const db = new Database(":memory:") as unknown as AppDatabase;
  databases.push(db);
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  return new HubRepository(db);
}

function streamOf(chunks: V3Part[]) {
  return { stream: simulateReadableStream({ chunks }) };
}

function textStream(text: string, finish: "stop" | "tool-calls" = "stop"): V3Part[] {
  return [
    { type: "stream-start", warnings: [] },
    { type: "text-start", id: "t1" },
    { type: "text-delta", id: "t1", delta: text },
    { type: "text-end", id: "t1" },
    {
      type: "finish",
      finishReason: { unified: finish, raw: finish === "stop" ? "end_turn" : "tool_use" },
      usage: USAGE,
    },
  ];
}

/** A settled-event + delta collector that stands in for the WP1.2 SSE transport. `state.onDelta` is a
 *  mutable hook so a test can react to a live delta (e.g. press Stop mid-stream). */
function collectSink(): {
  sink: HubTurnSink;
  events: HubEvent[];
  deltas: HubStreamDelta[];
  state: { onDelta?: (delta: HubStreamDelta) => void };
} {
  const events: HubEvent[] = [];
  const deltas: HubStreamDelta[] = [];
  const state: { onDelta?: (delta: HubStreamDelta) => void } = {};
  const sink: HubTurnSink = {
    onEvent: (e) => events.push(e),
    onDelta: (d) => {
      deltas.push(d);
      state.onDelta?.(d);
    },
  };
  return { sink, events, deltas, state };
}

/** Create a chat session and persist its opener `user_message` (what the session-service does before a
 *  turn), returning the fresh session snapshot. */
function seedSession(repo: HubRepository, text: string, model = "gpt-4o"): HubSession {
  const session = repo.createSession({ mode: "chat", model });
  repo.appendEvent(session.id, { type: "user_message", messageId: "u1", text });
  return repo.getSession(session.id);
}

function baseInput(
  over: {
    session: HubSession;
    model: HubTurnInput["model"];
    sink: HubTurnSink;
    steering: HubSteeringQueue;
    abort?: AbortController;
  } & Partial<HubTurnInput>,
): HubTurnInput {
  const { abort, ...rest } = over;
  return {
    promptMode: "chat",
    providerKind: "openai",
    modelId: "gpt-4o",
    capabilities: hubCapabilitiesForKind("openai"),
    contextWindow: 128000,
    toolset: { tools: {} },
    abortSignal: (abort ?? new AbortController()).signal,
    ...rest,
  };
}

function assistantMessages(events: HubEvent[]) {
  return events.filter(
    (e): e is Extract<HubEvent, { type: "assistant_message" }> => e.type === "assistant_message",
  );
}
function textOf(parts: readonly { type: string }[]): string {
  return parts
    .filter((p): p is HubTextPart => p.type === "text")
    .map((p) => p.text)
    .join("");
}

// ── (1) full turn — assemble → stream → persist settled events → meter → terminate ─────────────────

test("a full turn streams, persists only settled events, meters cost, and completes via the clock", async () => {
  const repo = openRepo();
  const session = seedSession(repo, "What is the capital of France?");
  const { sink, events, deltas } = collectSink();
  const steering = new HubSteeringQueue(session.id, repo);
  const model = new MockLanguageModelV3({
    doStream: async () => streamOf(textStream("The capital of France is Paris.")),
  });

  const result = await runHubTurn(
    { repository: repo },
    baseInput({ session, model, sink, steering }),
  );

  // Terminal via `terminalFor` happy path + clock-derived durations.
  assert.equal(result.status, "completed");
  assert.equal(result.outcome, "completed");
  assert.equal(result.completed, true);
  assert.equal(result.stopReasonCode, undefined);
  assert.ok(
    result.totalDurationMs >= 0 && result.activeDurationMs >= 0,
    "durations came from the SessionClock",
  );

  // Metering (provider-actual usage × MODEL_PRICING).
  assert.equal(result.tokensIn, USAGE.inputTokens.total);
  assert.equal(result.tokensOut, USAGE.outputTokens.total);
  assert.ok(result.costUsd > 0, "priced model (gpt-4o) yields a non-zero cost");

  // Deltas were FORWARDED to the transport…
  assert.ok(deltas.length >= 1, "text deltas forwarded to the sink");
  assert.equal(deltas.map((d) => d.text).join(""), "The capital of France is Paris.");

  // …but the PERSISTED event log holds SETTLED events only — no delta ever lands in `hub_events`.
  const persisted = repo.listEvents(session.id);
  const types = persisted.map((e) => e.type);
  assert.ok(!types.includes("text_delta" as never), "no delta event is ever persisted");
  assert.deepEqual(
    persisted.filter((e) => e.type !== "user_message").map((e) => e.type),
    ["phase", "phase", "assistant_message", "turn_done"],
    "settled events: phase(starting), phase(null), assistant_message, turn_done",
  );

  // The settled assistant_message carries the full text as ordered parts (R-SES2), the effective model
  // id (R-SES10), a prompt version (D-AH14), and the api-exact cost basis.
  const [am] = assistantMessages(persisted);
  assert.ok(am);
  assert.equal(textOf(am.parts), "The capital of France is Paris.");
  assert.equal(am.model, "gpt-4o");
  assert.ok(am.promptVersion && am.promptVersion.length > 0, "prompt version stamped");
  assert.equal(am.costBasis, "api_exact");
  assert.equal(am.citations.length, 0);

  // Phase events (R-UX3) at start; capability manifest persisted on the session (D-US4).
  const phases = persisted.filter(
    (e): e is Extract<HubEvent, { type: "phase" }> => e.type === "phase",
  );
  assert.deepEqual(
    phases.map((p) => p.phase),
    ["starting", null],
  );
  const finalSession = repo.getSession(session.id);
  assert.equal(finalSession.status, "completed");
  assert.deepEqual(finalSession.capabilities, hubCapabilitiesForKind("openai"));
  assert.equal(finalSession.tokensIn, USAGE.inputTokens.total);
  assert.ok(
    (finalSession.totalDurationMs ?? -1) >= 0,
    "session durations folded in from the clock",
  );

  // History reconstruction is event-sourced (R-SES1): user + assistant turns rebuilt from the log.
  const rebuilt = reconstructMessages(persisted);
  assert.deepEqual(rebuilt, [
    { role: "user", content: "What is the capital of France?" },
    { role: "assistant", content: "The capital of France is Paris." },
  ]);
});

// ── WP3.4 — multimodal attachment pass-through in `reconstructMessages` ────────────────────────────

test("reconstructMessages folds resolvable attachments into the user turn: text inlines, binary becomes a file part, an unresolvable one is skipped", () => {
  const events: HubEvent[] = [
    {
      type: "user_message",
      messageId: "m1",
      text: "See attached",
      attachmentFileIds: ["f-text", "f-bin", "f-missing"],
      seq: 1,
    },
  ];
  const resolver = (fileId: string) => {
    if (fileId === "f-text") {
      return { filename: "notes.txt", mime: "text/plain", content: Buffer.from("hello world") };
    }
    if (fileId === "f-bin") {
      return {
        filename: "logo.png",
        mime: "image/png",
        content: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      };
    }
    return undefined; // f-missing: e.g. a deleted upload — skipped, never a thrown turn
  };

  const messages = reconstructMessages(events, resolver);
  assert.equal(messages.length, 1);
  const content = messages[0]?.content;
  assert.ok(Array.isArray(content), "attachments present ⇒ structured content, not a bare string");
  assert.equal(
    content.length,
    3,
    "original text + 1 inlined text attachment + 1 file part (f-missing skipped)",
  );
  assert.deepEqual(content[0], { type: "text", text: "See attached" });
  const textAttachment = content[1] as { type: string; text: string };
  assert.equal(textAttachment.type, "text");
  assert.match(textAttachment.text, /notes\.txt/);
  assert.match(textAttachment.text, /hello world/);
  const fileAttachment = content[2] as { type: string; mediaType?: string; filename?: string };
  assert.equal(fileAttachment.type, "file");
  assert.equal(fileAttachment.mediaType, "image/png");
  assert.equal(fileAttachment.filename, "logo.png");
});

test("reconstructMessages truncates an oversized text attachment rather than inlining it unbounded", () => {
  const huge = "x".repeat(HUB_ATTACHMENT_TEXT_INLINE_MAX_CHARS + 500);
  const events: HubEvent[] = [
    { type: "user_message", messageId: "m1", text: "dump", attachmentFileIds: ["f1"], seq: 1 },
  ];
  const resolver = () => ({ filename: "big.txt", mime: "text/plain", content: Buffer.from(huge) });
  const messages = reconstructMessages(events, resolver);
  const content = messages[0]?.content as Array<{ type: string; text?: string }>;
  const attachment = content[1];
  assert.ok(
    attachment?.text && attachment.text.length < huge.length,
    "truncated, not the full body",
  );
  assert.match(attachment?.text ?? "", /truncated/);
});

test("reconstructMessages leaves a user turn as plain text when no resolver is supplied (pre-WP3.4 behavior)", () => {
  const events: HubEvent[] = [
    { type: "user_message", messageId: "m1", text: "hi", attachmentFileIds: ["f1"], seq: 1 },
  ];
  assert.deepEqual(reconstructMessages(events), [{ role: "user", content: "hi" }]);
});

// ── (2) steering queue (R-SES3) — durable, injected at the next step boundary ──────────────────────

test("a message typed mid-run queues durably and injects at the next step boundary", async () => {
  const repo = openRepo();
  const session = seedSession(repo, "Compare Paris and Berlin.");
  const { sink } = collectSink();
  const steering = new HubSteeringQueue(session.id, repo);

  // Pass 1's doStream enqueues a steering message (simulating the operator typing WHILE running); the
  // engine drains it after the pass and injects it as a `user_message`, then runs pass 2.
  let call = 0;
  const model = new MockLanguageModelV3({
    doStream: async () => {
      call += 1;
      if (call === 1) {
        steering.enqueue({ text: "Also add Rome." });
        return streamOf(textStream("Paris and Berlin are both large capitals."));
      }
      return streamOf(textStream("Rome is the largest of the three."));
    },
  });

  const result = await runHubTurn(
    { repository: repo },
    baseInput({ session, model, sink, steering }),
  );
  assert.equal(result.status, "completed");

  const events = repo.listEvents(session.id);

  // The steering message SURVIVES as a persisted `queued_user_message` (losing it is a bug).
  const queued = events.filter(
    (e): e is Extract<HubEvent, { type: "queued_user_message" }> =>
      e.type === "queued_user_message",
  );
  assert.equal(queued.length, 1);
  assert.equal(queued[0]?.text, "Also add Rome.");

  // It was INJECTED as a `user_message` (correlated by id) — and a SECOND assistant turn incorporated it.
  const injected = events.filter(
    (e): e is Extract<HubEvent, { type: "user_message" }> =>
      e.type === "user_message" && e.text === "Also add Rome.",
  );
  assert.equal(injected.length, 1, "the queued message injected exactly once");
  assert.equal(
    injected[0]?.messageId,
    queued[0]?.queuedMessageId,
    "injected id correlates to the queued id",
  );

  const ams = assistantMessages(events);
  assert.equal(ams.length, 2, "two assistant turns (opener + steering continuation)");
  assert.equal(textOf(ams[1]!.parts), "Rome is the largest of the three.");

  // After injection nothing is left pending (durability bookkeeping is correct).
  assert.deepEqual(HubSteeringQueue.reconstructPending(events), []);
});

// model-identity WP6.1 (F4) — the steering path used to (a) have no slot for `providerCredentialId`, so
// the caller's credential was dropped with no trace, and (b) stamp the injected `user_message` with the
// queued message's `model`, which never ran: the pass executes on the resolution fixed BEFORE the loop.
// The transcript is what an operator reads to reconstruct which provider billed a turn, so a model that
// executed no tokens must not appear there as though it had.
test("F4: a queued override is RECORDED as the ask, and the injected user_message is stamped with the model that actually ran", async () => {
  const repo = openRepo();
  const session = seedSession(repo, "Summarize the capitals.");
  const { sink } = collectSink();
  const steering = new HubSteeringQueue(session.id, repo);

  let call = 0;
  const model = new MockLanguageModelV3({
    doStream: async () => {
      call += 1;
      if (call === 1) {
        // The operator steers mid-turn, asking for a DIFFERENT model on a DIFFERENT credential.
        steering.enqueue({
          text: "Also add Rome.",
          model: "claude-opus-4-8",
          providerCredentialId: "cred-anthropic-cli",
        });
        return streamOf(textStream("Paris and Berlin."));
      }
      return streamOf(textStream("Rome too."));
    },
  });

  // The turn runs on `gpt-4o` (baseInput's `modelId`) throughout — a queued override cannot change it.
  const result = await runHubTurn(
    { repository: repo },
    baseInput({ session, model, sink, steering }),
  );
  assert.equal(result.status, "completed");

  const events = repo.listEvents(session.id);
  const queued = events.filter(
    (e): e is Extract<HubEvent, { type: "queued_user_message" }> => e.type === "queued_user_message",
  );
  assert.equal(queued[0]?.model, "claude-opus-4-8", "the requested model is preserved on the ask");
  assert.equal(
    queued[0]?.providerCredentialId,
    "cred-anthropic-cli",
    "the requested credential is no longer dropped on the floor",
  );

  const injected = events.find(
    (e): e is Extract<HubEvent, { type: "user_message" }> =>
      e.type === "user_message" && e.text === "Also add Rome.",
  );
  assert.equal(
    injected?.model,
    "gpt-4o",
    "the injected turn is stamped with the model that RAN, never the un-applied request",
  );

  // Round-trip: the ask survives a restart reconstruction too.
  const rebuilt = HubSteeringQueue.reconstructPending([
    events.find((e) => e.type === "queued_user_message")!,
  ]);
  assert.equal(rebuilt[0]?.providerCredentialId, "cred-anthropic-cli");
});

test("reconstructPending surfaces an un-injected queued message (restart durability)", () => {
  const events = [
    { type: "user_message", messageId: "u1", text: "hi", seq: 1, at: "t" },
    { type: "queued_user_message", queuedMessageId: "q1", text: "still pending", seq: 2, at: "t" },
    {
      type: "queued_user_message",
      queuedMessageId: "q2",
      text: "already injected",
      seq: 3,
      at: "t",
    },
    { type: "user_message", messageId: "q2", text: "already injected", seq: 4, at: "t" },
  ] as HubEvent[];
  const pending = HubSteeringQueue.reconstructPending(events);
  assert.equal(pending.length, 1);
  assert.equal(pending[0]?.queuedMessageId, "q1");
});

// ── (3) Stop preserves completed work with an explicit note (R-SES3 / R-SES11) ─────────────────────

test("Stop cancels the running step but preserves the partial answer with a cut-off note", async () => {
  const repo = openRepo();
  const session = seedSession(repo, "Write a long essay.");
  const collector = collectSink();
  const steering = new HubSteeringQueue(session.id, repo);
  const abort = new AbortController();
  // Abort the moment the first text delta is forwarded (the operator pressing Stop mid-stream).
  collector.state.onDelta = (delta) => {
    if (delta.text.includes("Partial")) abort.abort();
  };
  const model = new MockLanguageModelV3({
    doStream: async () =>
      streamOf([
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "t1" },
        { type: "text-delta", id: "t1", delta: "Partial draft so far" },
        { type: "text-delta", id: "t1", delta: " and more" },
        { type: "text-end", id: "t1" },
        { type: "finish", finishReason: { unified: "stop", raw: "end_turn" }, usage: USAGE },
      ]),
  });

  const result = await runHubTurn(
    { repository: repo },
    baseInput({ session, model, sink: collector.sink, steering, abort }),
  );

  assert.equal(result.status, "aborted");
  assert.equal(result.outcome, "aborted");
  assert.equal(result.stopReasonCode, "user_stop");
  assert.equal(result.completed, false);

  const events = repo.listEvents(session.id);
  const [am] = assistantMessages(events);
  assert.ok(am);
  const parts = am.parts;
  assert.ok(textOf(parts).includes("Partial"), "the partial answer is preserved");
  assert.ok(
    parts.some((p) => p.type === "text" && (p as HubTextPart).text.includes("Response stopped")),
    "an explicit cut-off note is appended",
  );
  // A `stopping` phase was surfaced before the terminal.
  assert.ok(
    events.some((e) => e.type === "phase" && e.phase === "stopping"),
    "a stopping phase preceded the terminal",
  );
  assert.equal(repo.getSession(session.id).status, "aborted");
});

// ── (4) limit error → retry-on-other-source event (R-SES11 / D-AH17) ───────────────────────────────

test("a provider limit error emits a limit_error event with retry-on-other-source options", async () => {
  const repo = openRepo();
  const session = seedSession(repo, "Summarize this.");
  const { sink } = collectSink();
  const steering = new HubSteeringQueue(session.id, repo);
  const model = new MockLanguageModelV3({
    doStream: async () => {
      throw new Error("429 Too Many Requests — rate limit exceeded");
    },
  });

  const result = await runHubTurn(
    { repository: repo },
    baseInput({ session, model, sink, steering }),
  );

  // A limit error is a hard terminal (rate_limit → error), with partial work preserved + a cut-off note.
  assert.equal(result.status, "error");

  const events = repo.listEvents(session.id);
  const limit = events.filter(
    (e): e is Extract<HubEvent, { type: "limit_error" }> => e.type === "limit_error",
  );
  assert.equal(limit.length, 1, "a limit_error event is emitted");
  assert.ok(limit[0]?.message.includes("429"));
  assert.deepEqual(
    limit[0]?.retrySources,
    ["subscription", "other_model"],
    "the OTHER sources to retry on",
  );
  assert.deepEqual(retrySourcesFor("claude_subscription"), ["api_key", "other_model"]);

  const [am] = assistantMessages(events);
  assert.ok(
    am?.parts.some((p) => p.type === "text" && (p as HubTextPart).text.includes("provider limit")),
    "the answer is cut off with an explicit note",
  );
  assert.equal(repo.getSession(session.id).status, "error");
});

// ── (5) SessionClock wall-cap → terminalFor (D-US3) ────────────────────────────────────────────────

test("a SessionClock wall-cap fire terminates the turn through terminalFor", async () => {
  const repo = openRepo();
  const session = seedSession(repo, "Do something slow.");
  const { sink } = collectSink();
  const steering = new HubSteeringQueue(session.id, repo);

  // A fully deterministic fake time source: `advance(ms)` runs every due scheduled callback.
  let now = 0;
  let seq = 0;
  const timers: Array<{ id: number; at: number; fn: () => void; cancelled: boolean }> = [];
  const time: SessionClockTime = {
    now: () => now,
    schedule: (fn, ms) => {
      const id = seq++;
      timers.push({ id, at: now + ms, fn, cancelled: false });
      return () => {
        const t = timers.find((x) => x.id === id);
        if (t) t.cancelled = true;
      };
    },
  };
  const advance = (ms: number): void => {
    now += ms;
    for (const t of [...timers].sort((a, b) => a.at - b.at)) {
      if (!t.cancelled && t.at <= now) {
        t.cancelled = true;
        t.fn();
      }
    }
  };

  // The model pushes the fake clock past the 100ms wall cap inside doStream → the cap fires → the turn's
  // combined abort signal aborts → the engine reads `clock.fired` and terminates via terminalFor.
  const model = new MockLanguageModelV3({
    doStream: async () => {
      advance(200);
      return streamOf(textStream("late answer"));
    },
  });

  const result = await runHubTurn(
    { repository: repo },
    baseInput({ session, model, sink, steering, clockOptions: { time, maxDurationMs: 100 } }),
  );

  assert.equal(result.status, "stopped");
  assert.equal(result.outcome, "stopped_guardrail");
  assert.equal(result.stopReasonCode, "max_duration");
  assert.equal(result.totalDurationMs, 200, "durations measured on the injected clock");
  assert.equal(repo.getSession(session.id).stopReasonCode, "max_duration");
});

// ── WP4.3 (R-SES9/R-UX11) — the notification-center hook's pure building blocks ─────────────────────

test("isBudgetTripStopReason: true for the 5 budget-meter codes, false for guardrail/failure codes and undefined", () => {
  for (const code of [
    "max_turns",
    "max_tokens",
    "max_context_tokens",
    "max_cost",
    "max_tool_calls",
  ] as const) {
    assert.equal(isBudgetTripStopReason(code), true, code);
  }
  for (const code of [
    "user_stop",
    "stalled",
    "wait_expired",
    "context_overflow",
    "provider_error",
    "auth",
    "rate_limit",
  ] as const) {
    assert.equal(isBudgetTripStopReason(code), false, code);
  }
  assert.equal(isBudgetTripStopReason(undefined), false);
});

test("wrapSinkForWaitingInputNotify: fires notify({kind:'waiting_input'}) on a waiting_input phase event, forwards every event to the base sink unchanged, and is a plain passthrough when notify is absent", () => {
  const forwarded: HubEvent[] = [];
  const base: HubTurnSink = { onEvent: (e) => forwarded.push(e), onDelta: () => {} };

  // Absent notify -> the SAME object back (zero overhead, no wrapping at all).
  assert.equal(wrapSinkForWaitingInputNotify(base, "s1", undefined), base);

  const notifications: HubNotifyEvent[] = [];
  const wrapped = wrapSinkForWaitingInputNotify(base, "s1", (event) => notifications.push(event));

  wrapped.onEvent({ type: "phase", phase: "starting" });
  assert.equal(notifications.length, 0, "a non-waiting_input phase event fires nothing");

  wrapped.onEvent({
    type: "phase",
    phase: "waiting_input",
    detail: { reason: "elicitation" },
  });
  assert.deepEqual(notifications, [{ kind: "waiting_input", sessionId: "s1", reason: "elicitation" }]);

  wrapped.onEvent({ type: "phase", phase: "waiting_input" }); // no detail.reason at all
  assert.deepEqual(notifications[1], { kind: "waiting_input", sessionId: "s1" });

  assert.equal(forwarded.length, 3, "every event still reaches the base sink, in order");
  assert.deepEqual(
    forwarded.map((e) => e.type),
    ["phase", "phase", "phase"],
  );
});

// ── WP1.1 (hub-fixes, D-HF1) — per-step deferred-tool gating (prepareStep/activeTools) ─────────────

/** The tool names the SDK forwarded to the provider for a step (a gated tool is filtered out before
 *  `doStream` sees it). */
function toolNamesSeen(options: unknown): string[] {
  const tools = (options as { tools?: Array<{ name: string }> }).tools ?? [];
  return tools.map((t) => t.name).sort();
}

test("prepareStep gates a deferred tool OFF until tool_search promotes it into the shared set", async () => {
  const repo = openRepo();
  const session = seedSession(repo, "use the deferred capability");
  const { sink, events } = collectSink();
  const steering = new HubSteeringQueue(session.id, repo);

  // The shared per-turn promotion set — the same object `tool_search.execute` mutates and the engine's
  // prepareStep reads.
  const promoted = new Set<string>();
  const deferredName = "mcp__srv__do_it";
  const seen: string[][] = [];
  let called = false;

  const tools = {
    tool_search: tool({
      description: "discover a deferred tool",
      inputSchema: z.object({ query: z.string() }),
      execute: async () => {
        promoted.add(deferredName);
        return { matches: [deferredName], promoted: [deferredName] };
      },
    }),
    [deferredName]: tool({
      description: "the granted-but-deferred tool",
      inputSchema: z.object({}),
      execute: async () => {
        called = true;
        return { ok: true };
      },
    }),
  };

  let call = 0;
  const model = new MockLanguageModelV3({
    doStream: async (options) => {
      call += 1;
      seen.push(toolNamesSeen(options));
      if (call === 1) {
        return streamOf([
          { type: "stream-start", warnings: [] },
          { type: "tool-call", toolCallId: "s1", toolName: "tool_search", input: JSON.stringify({ query: "do" }) },
          { type: "finish", finishReason: { unified: "tool-calls", raw: "tool_use" }, usage: USAGE },
        ] as V3Part[]);
      }
      if (call === 2) {
        return streamOf([
          { type: "stream-start", warnings: [] },
          { type: "tool-call", toolCallId: "c1", toolName: deferredName, input: "{}" },
          { type: "finish", finishReason: { unified: "tool-calls", raw: "tool_use" }, usage: USAGE },
        ] as V3Part[]);
      }
      return streamOf(textStream("done"));
    },
  });

  const result = await runHubTurn(
    { repository: repo },
    baseInput({
      session,
      model,
      sink,
      steering,
      toolset: {
        tools,
        deferredNames: new Set([deferredName]),
        promoted,
        sources: { [deferredName]: "mcp", tool_search: "builtin" },
      },
    }),
  );

  assert.equal(result.status, "completed");
  // The gate: the deferred tool is invisible to the model until the search promotes it.
  assert.ok(seen[0]?.includes("tool_search"), "step 1 offers tool_search");
  assert.ok(!seen[0]?.includes(deferredName), "step 1 hides the un-promoted deferred tool");
  assert.ok(seen[1]?.includes(deferredName), "step 2 exposes the promoted deferred tool");
  assert.equal(called, true, "the promoted deferred tool actually executed");
  // It settled into a persisted tool_result.
  const results = events.filter((e) => e.type === "tool_result");
  assert.ok(results.length >= 1, "the promoted tool's result was persisted");
});

test("eager-mode toolset (no deferredNames) runs with no per-step gating — every tool is always active", async () => {
  const repo = openRepo();
  const session = seedSession(repo, "call the tool");
  const { sink } = collectSink();
  const steering = new HubSteeringQueue(session.id, repo);
  const seen: string[][] = [];

  const tools = {
    always_on: tool({
      description: "an eager tool",
      inputSchema: z.object({}),
      execute: async () => ({ ok: true }),
    }),
  };

  let call = 0;
  const model = new MockLanguageModelV3({
    doStream: async (options) => {
      call += 1;
      seen.push(toolNamesSeen(options));
      if (call === 1) {
        return streamOf([
          { type: "stream-start", warnings: [] },
          { type: "tool-call", toolCallId: "c1", toolName: "always_on", input: "{}" },
          { type: "finish", finishReason: { unified: "tool-calls", raw: "tool_use" }, usage: USAGE },
        ] as V3Part[]);
      }
      return streamOf(textStream("done"));
    },
  });

  const result = await runHubTurn(
    { repository: repo },
    baseInput({ session, model, sink, steering, toolset: { tools } }),
  );

  assert.equal(result.status, "completed");
  // No prepareStep gating: the tool is offered from the very first step (byte-compatible with pre-WP1.1).
  assert.ok(seen[0]?.includes("always_on"), "an eager tool is active from step 1 with no gating");
});
