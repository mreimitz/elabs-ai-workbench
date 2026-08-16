// hub-fixes WP3.2 (RC4, D-HF4) — mission synthesis through the TURN engine with GenUI, over STUBBED
// seams (no provider/API key). Proves:
//   • the REAL `HubSessionService.runSynthesisTurn` runs the synthesis as a turn of the PARENT session,
//     grants the GenUI `present` tool (NOT MCP), and persists a settled `assistant_message` whose parts
//     include a rendered-eligible genui tool_call part — with the merged citations stamped on + the
//     partial note prepended (the citation post-pass);
//   • `synthesizeMission` prefers the turn path when wired, links the `mission_synthesis` marker to the
//     turn's message id, and returns the turn's cost;
//   • the FALLBACK path (`synthesisMode: "text"`, or a thrown turn) is byte-compatible with the pre-fix
//     tool-less synthesizer — a single text-only `assistant_message` + `mission_synthesis` + `turn_done`,
//     no double-persist;
//   • BOTH event orderings (pre-fix text path AND the new turn path) replay to the same board state.

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import {
  DEFAULT_TOKEN_PROFILE,
  type HubAgentReport,
  type HubCitation,
  type HubEvent,
  type HubMissionPlan,
  type HubToolPart,
} from "@mcp-token-footprint/shared";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { nanoid } from "nanoid";
import { applyMigrations, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { getTokenCounter } from "../src/token-counting/profiles.js";
import { HubRepository } from "../src/hub/repository.js";
import {
  HubSessionService,
  type HubSynthesisTurn,
} from "../src/hub/session-service.js";
import type { HubTurnSink } from "../src/hub/turn-engine.js";
import {
  mergeAgentCitations,
  synthesizeMission,
  type HubSynthesizer,
} from "../src/hub/missions/synthesis.js";
import { reconstructMission } from "../src/hub/missions/board.js";

type MockStreamResult = Awaited<ReturnType<NonNullable<MockLanguageModelV3["doStream"]>>>;
type V3Part = MockStreamResult["stream"] extends ReadableStream<infer P> ? P : never;

const USAGE = {
  inputTokens: { total: 12, noCache: 12, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 6, text: 6, reasoning: 0 },
} as const;

const databases: AppDatabase[] = [];
const tempDirs: string[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function openRepo(): HubRepository {
  const db = new Database(":memory:") as unknown as AppDatabase;
  databases.push(db);
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  return new HubRepository(db);
}
function tempDataDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-synth-"));
  tempDirs.push(dir);
  return dir;
}

function collectSink(): { sink: HubTurnSink; events: HubEvent[] } {
  const events: HubEvent[] = [];
  return { sink: { onEvent: (e) => events.push(e), onDelta: () => {} }, events };
}

const SERVICE_CONFIG = {
  maxActiveSessions: 4,
  idleReleaseMs: 0,
  autoTitle: false,
  toolLoadingDefault: "eager" as const,
  autoFraction: 0.1,
  skillListingBudgetFraction: 0.01,
  skillEntryMaxChars: 1536,
  skillLoadBudgets: { perSkillTokens: 5000, totalTokens: 25000 },
};

/** A valid GenUI `present` root the synthesis widget uses — a compact StatGroup (the nudge's preferred
 *  shape for rankings), so a rendered-eligible genui part lands on the settled synthesis message. */
const PRESENT_ROOT = {
  root: {
    $type: "StatGroup",
    props: { stats: [{ label: "Agents reporting", value: "2" }, { label: "Confidence", value: "High" }] },
  },
};

/** A model that first calls the granted `present` GenUI tool (a valid StatGroup), then answers with
 *  prose citing `[1]` — exactly the WP3.2 target (a widget PLUS cited prose). */
function mockPresentThenCite(): MockLanguageModelV3 {
  let call = 0;
  return new MockLanguageModelV3({
    doStream: async () => {
      call += 1;
      if (call === 1) {
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start", warnings: [] },
              {
                type: "tool-call",
                toolCallId: "tc-present",
                toolName: "present",
                input: JSON.stringify(PRESENT_ROOT),
              },
              { type: "finish", finishReason: { unified: "tool-calls", raw: "tool_use" }, usage: USAGE },
            ] as V3Part[],
          }),
        };
      }
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "t1" },
            { type: "text-delta", id: "t1", delta: "Both agents converged on the same finding[1]." },
            { type: "text-end", id: "t1" },
            { type: "finish", finishReason: { unified: "stop", raw: "end_turn" }, usage: USAGE },
          ] as V3Part[],
        }),
      };
    },
  });
}

function buildService(repo: HubRepository, model: () => MockLanguageModelV3): HubSessionService {
  return new HubSessionService({
    repository: repo,
    tokenCounter: getTokenCounter(DEFAULT_TOKEN_PROFILE),
    resolveModel: () => ({
      providerKind: "openai",
      modelId: "gpt-4o",
      contextWindow: 128000,
      buildModel: () => model() as never,
    }),
    config: { ...SERVICE_CONFIG, dataDir: tempDataDir() },
  });
}

const MERGED_CITATIONS: HubCitation[] = [
  { id: "1", title: "Agent A source", url: "https://example.com/a", agentRef: "agent-a" },
];

function assistantMessages(events: readonly HubEvent[]) {
  return events.filter(
    (e): e is Extract<HubEvent, { type: "assistant_message" }> => e.type === "assistant_message",
  );
}

// ── (1) the REAL runSynthesisTurn — genui part + merged citations + partial prefix ─────────────────

test("runSynthesisTurn persists a synthesis assistant_message with a rendered-eligible genui part + merged citations", async () => {
  const repo = openRepo();
  const service = buildService(repo, mockPresentThenCite);
  const session = await service.createSession({ mode: "mission", model: "gpt-4o" });
  // Seed the parent's mission ask so the reconstructed history ends with a user turn (as in the real flow).
  repo.appendEvent(session.id, { type: "user_message", messageId: nanoid(), text: "Summarize the mission." });

  const { sink, events } = collectSink();
  const result = await service.runSynthesisTurn({
    sessionId: session.id,
    model: "gpt-4o",
    systemPromptOverride: "You are the synthesizer. Compose the final answer citing [1].",
    citations: MERGED_CITATIONS,
    partialPrefix: "PARTIAL — ",
    sink,
  });

  assert.ok(result.messageId, "the turn returned the settled message id");

  const persisted = repo.listEvents(session.id);
  const [am] = assistantMessages(persisted);
  assert.ok(am, "a synthesis assistant_message was persisted into the PARENT session");
  assert.equal(am.messageId, result.messageId, "the returned id is the persisted assistant_message's id");

  // A rendered-eligible GenUI part (the `present` call, tagged source:"genui" → the GenUiPart widget path).
  const gp = am.parts.find((p): p is HubToolPart => p.type === "tool_call" && p.source === "genui");
  assert.ok(gp, "the synthesis message carries a genui tool_call part");
  assert.equal(gp.toolName, "present", "the genui part is a `present` widget call");

  // The prose part carries the partial prefix (deterministic) + the model's cited text.
  const textPart = am.parts.find((p) => p.type === "text");
  assert.ok(textPart && textPart.type === "text");
  assert.ok(textPart.text.startsWith("PARTIAL — "), "the partial note is prepended to the first text part");
  assert.match(textPart.text, /\[1\]/, "the cited [1] marker is preserved");

  // The merged citation set is stamped on (every [n] resolves — the §1.7 contract, unchanged).
  assert.deepEqual(am.citations, MERGED_CITATIONS, "the merged citations are stamped on the message");

  // No MCP tool was granted for the synthesis turn (it reasons over reports; it never re-queries): the
  // only tool_call is the genui one.
  const mcpCall = persisted.find((e) => e.type === "tool_call" && e.part.source === "mcp");
  assert.equal(mcpCall, undefined, "no MCP tool was granted/called during synthesis");

  // The engine settled the turn (turn_done) and forwarded the assistant_message live.
  assert.ok(events.some((e) => e.type === "assistant_message"), "the assistant_message was forwarded live");
  assert.ok(events.some((e) => e.type === "turn_done"), "the turn settled (turn_done)");
});

// ── (2) synthesizeMission prefers the turn path + links mission_synthesis to it ────────────────────

function seedMission(repo: HubRepository, autonomy: "auto" | "always_ask" = "auto") {
  const session = repo.createSession({ mode: "mission", model: "gpt-4o", autonomy });
  const plan: HubMissionPlan = {
    topology: "parallel",
    autonomy,
    rationale: "A test mission.",
    agents: [
      {
        key: "a",
        name: "Agent A",
        systemPrompt: "You are Agent A.",
        model: "gpt-4o",
        toolGrants: { servers: {}, builtins: [] },
        skillIds: [],
        brief: "Do A.",
        target: "T",
        expectedOutcome: "A report.",
      },
    ],
  };
  const mission = repo.createMission({ sessionId: session.id, topology: "parallel", autonomy, plan });
  return { session, mission };
}

const REPORTS: HubAgentReport[] = [
  {
    agentSessionId: "agent-a",
    roleName: "Agent A",
    summary: "A summary.",
    findings: [{ summary: "Finding one [1].", citationIds: ["1"] }],
    citations: [{ id: "1", title: "Agent A source", url: "https://example.com/a" }],
    artifacts: [],
    confidence: "high",
    openQuestions: [],
  },
];

/** A synthesizer text stub that records whether it was called (to prove the turn path bypasses it). */
function recordingSynthesizer(calls: { count: number }): HubSynthesizer {
  return async () => {
    calls.count += 1;
    return { text: "Fallback synthesis [1].", usage: { tokensIn: 5, tokensOut: 5 }, costUsd: 0.01 };
  };
}

/** A `runSynthesisTurn` stub that EMULATES the engine: it persists a settled synthesis assistant_message
 *  (with a genui part + the merged citations) + a `turn_done` into the parent, then returns the id/cost —
 *  exactly what the real seam does, without a model. */
function stubTurn(repo: HubRepository, opts: { fail?: boolean } = {}): HubSynthesisTurn {
  return async (input) => {
    if (opts.fail) throw new Error("stub turn failure");
    const messageId = nanoid();
    const am = repo.appendEvent(input.sessionId, {
      type: "assistant_message",
      messageId,
      model: input.model,
      parts: [
        { type: "tool_call", toolCallId: "tc-1", toolName: "present", source: "genui", state: "input-available", args: {} },
        { type: "text", text: `${input.partialPrefix ?? ""}Turn synthesis [1].` },
      ],
      citations: input.citations,
      artifactsTouched: [],
      costUsd: 0.07,
      costBasis: "api_exact",
      finishReason: "stop",
    });
    input.sink.onEvent(am);
    const td = repo.appendEvent(input.sessionId, { type: "turn_done", messageId, costUsd: 0.07, costBasis: "api_exact" });
    input.sink.onEvent(td);
    return { messageId, costUsd: 0.07 };
  };
}

test("synthesizeMission uses the turn path when wired and links mission_synthesis to its message", async () => {
  const repo = openRepo();
  const { session, mission } = seedMission(repo);
  const { sink, events } = collectSink();
  const synthCalls = { count: 0 };

  const out = await synthesizeMission(
    {
      repository: repo,
      synthesizer: recordingSynthesizer(synthCalls),
      runSynthesisTurn: stubTurn(repo),
      synthesisMode: "turn",
    },
    { mission, sessionId: session.id, userText: "ask", model: "gpt-4o", reports: REPORTS, partial: false, sink },
  );

  assert.equal(synthCalls.count, 0, "the fallback text synthesizer was NOT called on the turn path");

  const persisted = repo.listEvents(session.id);
  const [am] = assistantMessages(persisted);
  assert.ok(am, "the turn persisted a synthesis assistant_message");
  const gp = am.parts.find((p): p is HubToolPart => p.type === "tool_call" && p.source === "genui");
  assert.ok(gp, "the synthesis message carries a genui part");

  const synth = persisted.find((e) => e.type === "mission_synthesis");
  assert.ok(synth && synth.type === "mission_synthesis");
  assert.equal(synth.messageId, am.messageId, "mission_synthesis links the SAME assistant_message id");
  assert.equal(synth.messageId, out.messageId);
  assert.equal(out.costUsd, 0.07, "the turn cost is returned to the orchestrator");
  assert.deepEqual(out.citations, mergeAgentCitations(REPORTS).citations);

  // Exactly ONE assistant_message + ONE turn_done + ONE mission_synthesis (no double-persist).
  assert.equal(assistantMessages(persisted).length, 1);
  assert.equal(persisted.filter((e) => e.type === "turn_done").length, 1);
  assert.equal(persisted.filter((e) => e.type === "mission_synthesis").length, 1);
  // The marker was forwarded live too.
  assert.ok(events.some((e) => e.type === "mission_synthesis"));
});

// ── (3) fallback (synthesisMode "text") is byte-compatible with the pre-fix synthesizer ────────────

test("synthesizeMission falls back to the byte-compatible text path when synthesisMode is 'text'", async () => {
  const repo = openRepo();
  const { session, mission } = seedMission(repo);
  const { sink } = collectSink();
  const synthCalls = { count: 0 };

  const out = await synthesizeMission(
    {
      repository: repo,
      synthesizer: recordingSynthesizer(synthCalls),
      // A turn seam is wired, but `text` forces the fallback.
      runSynthesisTurn: stubTurn(repo),
      synthesisMode: "text",
    },
    { mission, sessionId: session.id, userText: "ask", model: "gpt-4o", reports: REPORTS, partial: false, sink },
  );

  assert.equal(synthCalls.count, 1, "the text synthesizer WAS used (the fallback path)");
  const persisted = repo.listEvents(session.id);

  // The exact pre-fix shape: a SINGLE text-only assistant_message (no genui part), the merged citations,
  // then mission_synthesis, then turn_done — the byte-compatible ordering.
  const ordering = persisted
    .map((e) => e.type)
    .filter((t) => t === "assistant_message" || t === "mission_synthesis" || t === "turn_done");
  assert.deepEqual(ordering, ["assistant_message", "mission_synthesis", "turn_done"], "the pre-fix event order");

  const [am] = assistantMessages(persisted);
  assert.ok(am);
  assert.deepEqual(
    am.parts,
    [{ type: "text", text: "Fallback synthesis [1]." }],
    "the fallback message is text-only (no genui) — byte-compatible with the pre-fix synthesizer",
  );
  assert.deepEqual(am.citations, out.citations, "the merged citations are stamped on");
  assert.equal(am.parts.some((p) => p.type === "tool_call"), false, "no genui/tool part on the fallback");
});

// ── (4) a thrown turn falls back to the text path with NO double-persist ───────────────────────────

test("a failing synthesis turn falls back to the text synthesizer without double-persisting", async () => {
  const repo = openRepo();
  const { session, mission } = seedMission(repo);
  const { sink } = collectSink();
  const synthCalls = { count: 0 };
  const warnings: string[] = [];

  await synthesizeMission(
    {
      repository: repo,
      synthesizer: recordingSynthesizer(synthCalls),
      runSynthesisTurn: stubTurn(repo, { fail: true }),
      synthesisMode: "turn",
      logger: { warn: (m) => warnings.push(m) },
    },
    { mission, sessionId: session.id, userText: "ask", model: "gpt-4o", reports: REPORTS, partial: true, sink },
  );

  assert.equal(synthCalls.count, 1, "the text synthesizer took over after the turn threw");
  assert.ok(warnings.some((w) => /synthesis turn failed/.test(w)), "the fallback was logged");

  const persisted = repo.listEvents(session.id);
  assert.equal(assistantMessages(persisted).length, 1, "exactly ONE assistant_message (no double-persist)");
  assert.equal(persisted.filter((e) => e.type === "mission_synthesis").length, 1);

  // A PARTIAL mission's fallback marks it partial in the text body.
  const [am] = assistantMessages(persisted);
  assert.ok(am.parts.some((p) => p.type === "text" && /PARTIAL/i.test(p.text)), "the partial note is present");
});

// ── (5) both event orderings replay to the same board state (replay-compatible) ────────────────────

test("the turn-path and text-path synthesis orderings both replay to phase 'done' with the synthesis", () => {
  const missionId = "m1";
  const plan: HubMissionPlan = {
    topology: "parallel",
    autonomy: "auto",
    agents: [
      {
        key: "a",
        name: "Agent A",
        systemPrompt: "s",
        model: "gpt-4o",
        toolGrants: { servers: {}, builtins: [] },
        skillIds: [],
        brief: "b",
        target: "t",
        expectedOutcome: "o",
      },
    ],
  };
  const proposed: HubEvent = { type: "plan_proposed", missionId, plan } as HubEvent;
  const approved: HubEvent = { type: "plan_approved", missionId, approvedBy: "user" } as HubEvent;
  const am: HubEvent = {
    type: "assistant_message",
    messageId: "synth-msg",
    model: "gpt-4o",
    parts: [{ type: "text", text: "Answer." }],
    citations: [],
    artifactsTouched: [],
    costUsd: 0,
    costBasis: "api_exact",
  } as HubEvent;
  const turnDone: HubEvent = { type: "turn_done", messageId: "synth-msg", costUsd: 0, costBasis: "api_exact" } as HubEvent;
  const synth: HubEvent = {
    type: "mission_synthesis",
    missionId,
    messageId: "synth-msg",
    partial: false,
    agentReportRefs: ["agent-a"],
  } as HubEvent;

  // Pre-fix / text path ordering: assistant_message → mission_synthesis → turn_done.
  const textOrder = [proposed, approved, am, synth, turnDone];
  // New turn-path ordering: assistant_message → turn_done → mission_synthesis (the engine settles the
  // turn before the marker is appended).
  const turnOrder = [proposed, approved, am, turnDone, synth];

  for (const [label, log] of [["text", textOrder], ["turn", turnOrder]] as const) {
    const board = reconstructMission(log);
    assert.ok(board, `${label}: the board reconstructs`);
    assert.equal(board.phase, "done", `${label}: phase is done`);
    assert.equal(board.synthesis?.messageId, "synth-msg", `${label}: synthesis links the message`);
    assert.equal(board.synthesis?.partial, false, `${label}: partial flag preserved`);
  }
});
