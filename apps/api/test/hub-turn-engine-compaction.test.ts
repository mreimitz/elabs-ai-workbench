// Assistant Hub (roadmap/assistant-hub/, WP3.3, R-SES8) — the turn engine's compaction SEAM, driven by
// the same stubbed AI-SDK model harness the WP1.1 engine tests use. Proves the engine integration
// (distinct from `hub-compaction.test.ts`, which proves the compaction logic itself):
//   • ready path — a compaction runs at turn start, its `compaction` event is persisted BEFORE the
//     assistant reply (through the engine's own choke point), and the model still answers;
//   • thrash path — the engine stops the turn honestly (stopped/context_overflow + an `error` event)
//     WITHOUT ever calling the model (no re-summarize loop);
//   • no compactor — byte-identical to pre-WP3.3 (covered by the WP1.1 suite; re-asserted here).

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import type { HubEvent, HubSession } from "@mcp-token-footprint/shared";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { applyMigrations, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { hubCapabilitiesForKind } from "../src/hub/capabilities.js";
import { HubRepository } from "../src/hub/repository.js";
import type { TokenCounter } from "../src/token-counting/types.js";
import { createHubCompactor } from "../src/hub/compaction.js";
import {
  HubSteeringQueue,
  runHubTurn,
  type HubTurnCompactor,
  type HubTurnInput,
  type HubTurnSink,
} from "../src/hub/turn-engine.js";

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

function textStream(text: string): V3Part[] {
  return [
    { type: "stream-start", warnings: [] },
    { type: "text-start", id: "t1" },
    { type: "text-delta", id: "t1", delta: text },
    { type: "text-end", id: "t1" },
    { type: "finish", finishReason: { unified: "stop", raw: "end_turn" }, usage: USAGE },
  ];
}

function collectSink(): { sink: HubTurnSink; events: HubEvent[] } {
  const events: HubEvent[] = [];
  const sink: HubTurnSink = { onEvent: (e) => events.push(e), onDelta: () => {} };
  return { sink, events };
}

const charCounter: TokenCounter = {
  id: "char",
  label: "char",
  countText: async (text) => text.length,
  countJson: async (value) => JSON.stringify(value ?? null).length,
  countToolDefinition: async () => {
    throw new Error("unused");
  },
  countResourceDefinition: async () => {
    throw new Error("unused");
  },
  countPromptDefinition: async () => {
    throw new Error("unused");
  },
};

function baseInput(
  over: {
    session: HubSession;
    model: HubTurnInput["model"];
    sink: HubTurnSink;
    steering: HubSteeringQueue;
    compactor?: HubTurnCompactor;
  } & Partial<HubTurnInput>,
): HubTurnInput {
  return {
    promptMode: "chat",
    providerKind: "openai",
    modelId: "gpt-4o",
    capabilities: hubCapabilitiesForKind("openai"),
    contextWindow: 128000,
    toolset: { tools: {} },
    abortSignal: new AbortController().signal,
    ...over,
  };
}

function typesOf(events: HubEvent[]): string[] {
  return events.map((e) => e.type);
}

// ── (1) ready path — a real compactor over a large session emits a `compaction` event, then answers ──

test("a real compactor over a large session compacts at turn start, then the model answers", async () => {
  const repo = openRepo();
  const session = repo.createSession({ mode: "chat", model: "gpt-4o" });
  const sid = session.id;
  // Seed a long history (well over the char-window threshold) with cold turns to compact.
  repo.appendEvent(sid, { type: "user_message", messageId: "u1", text: `RULE: use metric units. ${"q".repeat(500)}` });
  repo.appendEvent(sid, { type: "assistant_message", messageId: "a1", model: "gpt-4o", parts: [{ type: "text", text: "A".repeat(500) }], citations: [], artifactsTouched: [] });
  repo.appendEvent(sid, { type: "user_message", messageId: "u2", text: "q".repeat(500) });
  repo.appendEvent(sid, { type: "assistant_message", messageId: "a2", model: "gpt-4o", parts: [{ type: "text", text: "B".repeat(500) }], citations: [], artifactsTouched: [] });
  repo.appendEvent(sid, { type: "user_message", messageId: "u3", text: "the newest question" });
  const fresh = repo.getSession(sid);

  const { sink, events } = collectSink();
  const steering = new HubSteeringQueue(sid, repo);
  const model = new MockLanguageModelV3({ doStream: async () => streamOf(textStream("Answer.")) });
  // A large window (no thrash — the real system prompt inflates char counts) with a tiny threshold so the
  // ~2000-char seeded history reliably trips compaction.
  const compactor = createHubCompactor({
    repository: repo,
    tokenCounter: charCounter,
    config: { sessionId: sid, contextWindow: 1_000_000, thresholdFraction: 0.001, keepRecentTurns: 1 },
  });

  const result = await runHubTurn({ repository: repo }, baseInput({ session: fresh, model, sink, steering, compactor }));

  assert.equal(result.status, "completed");
  const persisted = repo.listEvents(sid);
  const types = typesOf(persisted);
  assert.ok(types.includes("compaction"), "a compaction event was persisted");
  assert.ok(types.includes("assistant_message"), "the model still answered");

  // The compaction event lands BEFORE the NEW assistant reply (the compacted context feeds the model).
  // The seeded history has prior assistant messages, so compare against the LAST one (this turn's reply).
  const compactionIdx = persisted.findIndex((e) => e.type === "compaction");
  const replyIdx = persisted.map((e) => e.type).lastIndexOf("assistant_message");
  assert.ok(compactionIdx >= 0 && compactionIdx < replyIdx, "compaction precedes the new assistant reply");

  // The compaction event streamed to the sink too (it went through the engine's choke point).
  assert.ok(events.some((e) => e.type === "compaction"), "the compaction event was forwarded live");

  // A rolling summary row was persisted, and the early constraint survives verbatim in it.
  const summary = repo.getLatestSessionSummary(sid);
  assert.ok(summary, "a summary was persisted");
  assert.match(summary!.content, /use metric units/);
});

// ── (2) thrash path — the engine stops honestly WITHOUT calling the model ────────────────────────────

test("a compactor thrash stops the turn as stopped/context_overflow with an error event and NO model call", async () => {
  const repo = openRepo();
  const session = repo.createSession({ mode: "chat", model: "gpt-4o" });
  const sid = session.id;
  repo.appendEvent(sid, { type: "user_message", messageId: "u1", text: "a question" });
  const fresh = repo.getSession(sid);

  const { sink, events } = collectSink();
  const steering = new HubSteeringQueue(sid, repo);
  let doStreamCalls = 0;
  const model = new MockLanguageModelV3({
    doStream: async () => {
      doStreamCalls += 1;
      return streamOf(textStream("should never run"));
    },
  });
  const thrashCompactor: HubTurnCompactor = {
    prepareTurn: async () => ({ kind: "thrash", message: "cannot compact — recent turns exceed the window" }),
  };

  const result = await runHubTurn({ repository: repo }, baseInput({ session: fresh, model, sink, steering, compactor: thrashCompactor }));

  // Terminal is the shared context_overflow stop (the closest cause), NOT a completed turn.
  assert.equal(result.status, "stopped");
  assert.equal(result.outcome, "context_overflow");
  assert.equal(result.completed, false);
  assert.equal(doStreamCalls, 0, "the model is never called on a thrash (no loop)");

  const persisted = repo.listEvents(sid);
  const types = typesOf(persisted);
  assert.ok(!types.includes("assistant_message"), "no assistant reply on a thrash");
  const errorEvt = persisted.find((e): e is Extract<HubEvent, { type: "error" }> => e.type === "error");
  assert.ok(errorEvt, "an honest error event was persisted");
  assert.match(errorEvt!.message, /cannot compact/);
  assert.equal(errorEvt!.recoverable, false);
  assert.ok(events.some((e) => e.type === "error"), "the thrash error was forwarded live");

  const finalSession = repo.getSession(sid);
  assert.equal(finalSession.status, "stopped");
  assert.equal(finalSession.stopReasonCode, "context_overflow");
});

// ── (3) no compactor — unchanged (byte-identical to WP1.1) ──────────────────────────────────────────

test("with no compactor wired the engine reconstructs verbatim — no compaction event ever appears", async () => {
  const repo = openRepo();
  const session = repo.createSession({ mode: "chat", model: "gpt-4o" });
  const sid = session.id;
  repo.appendEvent(sid, { type: "user_message", messageId: "u1", text: "hello" });
  const fresh = repo.getSession(sid);

  const { sink } = collectSink();
  const steering = new HubSteeringQueue(sid, repo);
  const model = new MockLanguageModelV3({ doStream: async () => streamOf(textStream("hi there")) });

  const result = await runHubTurn({ repository: repo }, baseInput({ session: fresh, model, sink, steering }));
  assert.equal(result.status, "completed");
  assert.ok(!typesOf(repo.listEvents(sid)).includes("compaction"), "no compaction without a compactor");
});
