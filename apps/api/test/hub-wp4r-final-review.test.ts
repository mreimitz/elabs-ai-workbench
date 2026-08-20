// Assistant Hub (planning/Roadmap/RM-03-assistant-hub/, WP4.R — FINAL review + owner-acceptance assembly, D-AH18).
//
// These are the WP4.R final-reviewer SEED PROBES: they seed realistic sessions/missions through the
// REAL engine with a STUBBED model (no provider key, no network) and assert end-to-end behavior across
// all four waves' seams composed on the INTEGRATED tip. The distinguishing move from the per-wave
// tests + the earlier wave reviews (WP1.R/WP2.R/WP3.R, which inject the `planner`/`runAgent`/
// `synthesizer` FUNCTIONS directly) is that these drive the PRODUCTION model-call seams end-to-end:
//   • `createStructuredPlanner` / `createStructuredAgentRunner` / `createTextSynthesizer` /
//     `createStructuredJudge` — the real `generateObject`/`generateText` glue that NO existing gate test
//     exercises (they all stub the seam function). Here only the underlying `LanguageModel` is a mock.
// So a whole mission of EVERY topology, a chat/research turn, a budget trip, a branch, and an artifact
// review all run through the real orchestration + the real AI-SDK production seams, stubbed only at the
// model boundary. Everything reconstructs from `hub_events` alone (R-SES1) and the mission board settles
// honestly. Nothing here contacts a real provider — a live run is owner-acceptance (see STATUS).
//
// One deterministic DISCRIMINATING model stands in for every model call: it inspects the assembled
// prompt/response-format and answers as a planner (a plan for the topology named in the ask), an agent
// (a structured report), a blind judge (a verdict), or a synthesizer (final text) — see
// `discriminatingModel`. It is the API-level analogue of the WP4.4 e2e `hub-stub-llm-server.ts`.

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import {
  DEFAULT_TOKEN_PROFILE,
  type HubAgentReport,
  type HubArtifact,
  type HubEvent,
  type HubMissionPlan,
  type HubReview,
  type HubReviewDecisionResult,
  type HubTopology,
} from "@mcp-token-footprint/shared";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import type { LanguageModel } from "ai";
import { applyMigrations, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { getTokenCounter } from "../src/token-counting/profiles.js";
import { beginHubCitationTurn } from "../src/hub/citations.js";
import { HubRepository } from "../src/hub/repository.js";
import {
  HubSessionService,
  promptModeFor,
  type HubSessionServiceConfig,
} from "../src/hub/session-service.js";
import type { HubTurnSink } from "../src/hub/turn-engine.js";
import {
  createStructuredAgentRunner,
  createStructuredJudge,
  createStructuredPlanner,
  createTextSynthesizer,
  DEBATE_ROUND_BRIEF_INTRO,
  HubMissionService,
  isMissionBoardTerminal,
  reconstructMission,
  type HubAgentRunner,
  type HubMissionServiceConfig,
} from "../src/hub/missions/index.js";
import {
  registerHubRoutes,
  type HubReviewAgentInput,
  type HubReviewAgentResult,
} from "../src/hub/routes.js";
import { ProviderRepository } from "../src/providers/repository.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { toErrorMessage } from "../src/utils/errors.js";

// ── Harness ──────────────────────────────────────────────────────────────────────────────────────

const databases: AppDatabase[] = [];
const tempDirs: string[] = [];
const harnesses: FastifyInstance[] = [];

afterEach(async () => {
  for (const app of harnesses.splice(0)) await app.close();
  for (const db of databases.splice(0)) db.close();
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function openRepo(): { repo: HubRepository; db: AppDatabase } {
  const db = new Database(":memory:") as unknown as AppDatabase;
  databases.push(db);
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  return { repo: new HubRepository(db), db };
}

function tempDataDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-wp4r-"));
  tempDirs.push(dir);
  return dir;
}

function collectSink(): { sink: HubTurnSink; events: HubEvent[] } {
  const events: HubEvent[] = [];
  return { sink: { onEvent: (e) => events.push(e), onDelta: () => undefined }, events };
}

// ── Deterministic stubbed model — the single discriminating LanguageModel ──────────────────────────

const STUB_MODEL = "stub-model";
const ASK_MARKER = "[[wp4r-ask]]";
const BRIEF_MARKER = "[[wp4r-brief]]";
const SYNTH_TEXT = "Final synthesis drawing on the agent reports [1].";
const GEN_USAGE = { inputTokens: 12, outputTokens: 8, totalTokens: 20 } as const;

type MockStreamResult = Awaited<ReturnType<NonNullable<MockLanguageModelV3["doStream"]>>>;
type V3Part = MockStreamResult["stream"] extends ReadableStream<infer P> ? P : never;
const STREAM_USAGE = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
} as const;

/** A structured agent report (schema-valid) — the same one every stubbed agent returns; its single
 *  citation drives the merge + resolve-test through the PRODUCTION synthesizer. */
const AGENT_REPORT: HubAgentReport = {
  summary: "Completed the assigned slice of the investigation.",
  findings: [
    { summary: "A concrete, evidence-backed finding [1].", citationIds: ["1"], confidence: "high" },
  ],
  citations: [{ id: "1", title: "Shared research source", url: "https://src.example/report" }],
  artifacts: [],
  confidence: "high",
  openQuestions: [],
};

/** The plan the stubbed planner authors for a requested topology: two distinctly-NAMED agents (the
 *  names let the best_of_n blindness probe assert the judge never sees an author's role name). */
function planFor(topology: HubTopology): HubMissionPlan {
  return {
    topology,
    autonomy: "auto",
    rationale: `A two-agent ${topology} plan for the WP4.R final-review seed.`,
    estimatedCostUsd: 0.02,
    agents: ["AlphaAuthor", "BetaAuthor"].map((name, i) => ({
      key: `agent-${i + 1}`,
      name,
      systemPrompt: `You are ${name}, a focused specialist.`,
      model: STUB_MODEL,
      toolGrants: { servers: {}, builtins: [] },
      skillIds: [],
      brief: `${BRIEF_MARKER} Investigate slice ${i + 1} and report structured findings.`,
      target: `Investigate slice ${i + 1}.`,
      expectedOutcome: "A structured report with 1-2 findings.",
      rationale: `Agent ${i + 1} covers one slice.`,
    })),
  };
}

function readTopology(all: string): HubTopology {
  const m = all.match(/TOPOLOGY=(parallel|pipeline|debate|best_of_n)/);
  return (m?.[1] as HubTopology | undefined) ?? "parallel";
}

type CallLog = { planner: string[]; agent: string[]; judge: string[]; synth: string[] };
function newLog(): CallLog {
  return { planner: [], agent: [], judge: [], synth: [] };
}

/** The single stubbed model behind ALL four production mission seams. Discriminates structurally
 *  (generateObject sets `responseFormat.type==="json"`; generateText does not) then by content. */
function discriminatingModel(log: CallLog): LanguageModel {
  return new MockLanguageModelV3({
    doGenerate: async (opts) => {
      const all = JSON.stringify(opts.prompt);
      const isJson = (opts.responseFormat as { type?: string } | undefined)?.type === "json";
      let text: string;
      if (!isJson) {
        // The ONLY generateText call is the synthesizer (createTextSynthesizer).
        log.synth.push(all);
        text = SYNTH_TEXT;
      } else if (all.includes("BLIND, impartial judge")) {
        // The best_of_n blind judge (createStructuredJudge) — its system prompt is unmistakable.
        log.judge.push(all);
        text = JSON.stringify({ winnerIndex: 1, rationale: "Attempt 2 reads as more thorough." });
      } else if (all.includes(BRIEF_MARKER)) {
        // A per-agent report call (createStructuredAgentRunner) — the brief carries the marker.
        log.agent.push(all);
        text = JSON.stringify(AGENT_REPORT);
      } else {
        // Otherwise the mission planner (createStructuredPlanner) — read the topology from the ask.
        log.planner.push(all);
        text = JSON.stringify(planFor(readTopology(all)));
      }
      return {
        content: [{ type: "text", text }],
        finishReason: "stop",
        usage: GEN_USAGE,
        warnings: [],
      };
    },
  }) as unknown as LanguageModel;
}

/** A streaming (doStream) text model for the session-service chat/research/composition turns. */
function textStreamModel(text: string): LanguageModel {
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "t1" },
          { type: "text-delta", id: "t1", delta: text },
          { type: "text-end", id: "t1" },
          { type: "finish", finishReason: { unified: "stop", raw: "end_turn" }, usage: STREAM_USAGE },
        ] as V3Part[],
      }),
    }),
  }) as unknown as LanguageModel;
}

/** A model that first calls the `files.write` workspace built-in, then answers — the composition probe. */
function writeThenAnswerModel(): LanguageModel {
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
                // The provider only ever sees the sanitized tool name (the turn engine re-keys the
                // dotted internal `files.write` to `files_write` at the model boundary — the P0 fix), so
                // a faithful model calls it back by that safe name; the engine restores `files.write`
                // in the persisted tool_call/tool_result events via `toInternalName`.
                type: "tool-call",
                toolCallId: "tc-write",
                toolName: "files_write",
                input: JSON.stringify({ path: "note.md", content: "# WP4.R composition note\n" }),
              },
              { type: "finish", finishReason: { unified: "tool-calls", raw: "tool_use" }, usage: STREAM_USAGE },
            ] as V3Part[],
          }),
        };
      }
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "t1" },
            { type: "text-delta", id: "t1", delta: "Done — I wrote the note to the workspace." },
            { type: "text-end", id: "t1" },
            { type: "finish", finishReason: { unified: "stop", raw: "end_turn" }, usage: STREAM_USAGE },
          ] as V3Part[],
        }),
      };
    },
  }) as unknown as LanguageModel;
}

const MISSION_CONFIG: HubMissionServiceConfig = {
  maxAgents: 6,
  maxParallel: 3,
  defaultBudgetUsd: 2.0,
  maxBudgetUsd: 10.0,
  askAboveAgents: 3,
  askAboveUsd: 1.0,
  defaultAutonomy: "always_ask",
};

function baseSessionConfig(dataDir: string): HubSessionServiceConfig {
  return {
    maxActiveSessions: 4,
    idleReleaseMs: 0,
    autoTitle: true,
    dataDir,
    toolLoadingDefault: "eager",
    autoFraction: 0.1,
    skillListingBudgetFraction: 0.01,
    skillEntryMaxChars: 1536,
    skillLoadBudgets: { perSkillTokens: 5000, totalTokens: 25000 },
  };
}

const TESTING_AND_DOCK_TABLES = [
  "runs",
  "run_steps",
  "run_events",
  "run_grades",
  "suites",
  "suite_runs",
  "scenarios",
  "assistant_threads",
  "assistant_events",
];

function assertZeroTestingTableWrites(db: AppDatabase): void {
  for (const table of TESTING_AND_DOCK_TABLES) {
    const n = (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
    assert.equal(n, 0, `domain isolation (D-AH3): the hub wrote 0 rows to ${table}`);
  }
}

function findSynthesisMessage(
  events: HubEvent[],
): Extract<HubEvent, { type: "assistant_message" }> | undefined {
  const synthEvent = events.find(
    (e): e is Extract<HubEvent, { type: "mission_synthesis" }> => e.type === "mission_synthesis",
  );
  return events.find(
    (e): e is Extract<HubEvent, { type: "assistant_message" }> =>
      e.type === "assistant_message" && e.messageId === synthEvent?.messageId,
  );
}

function messageText(message: Extract<HubEvent, { type: "assistant_message" }> | undefined): string {
  return message?.parts.map((p) => (p.type === "text" ? p.text : "")).join("") ?? "";
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// SEED 1 — every mission TOPOLOGY end-to-end through the PRODUCTION planner/agent/synth/judge seams
// ══════════════════════════════════════════════════════════════════════════════════════════════════

for (const topology of ["parallel", "pipeline", "debate", "best_of_n"] as const) {
  test(`[topology] '${topology}' mission runs end-to-end through the PRODUCTION seams + replays from events`, async () => {
    const { repo, db } = openRepo();
    const log = newLog();
    const buildModel = (): LanguageModel => discriminatingModel(log);
    const service = new HubMissionService({
      repository: repo,
      config: MISSION_CONFIG,
      planner: createStructuredPlanner({ buildModel }),
      runAgent: createStructuredAgentRunner({ buildModel }),
      synthesizer: createTextSynthesizer({ buildModel }),
      judge: createStructuredJudge({ buildModel }),
      now: () => "2026-07-18T00:00:00.000Z",
    });

    const session = repo.createSession({ mode: "mission", model: STUB_MODEL, autonomy: "auto" });
    const { sink, events } = collectSink();
    const ask = `Investigate the WP4.R final-review question. TOPOLOGY=${topology} ${ASK_MARKER}`;
    const mission = await service.proposePlan({ sessionId: session.id, text: ask, sink });

    // The production PLANNER seam ran (a real generateObject) and produced the requested topology.
    assert.ok(log.planner.length >= 1, "the production planner seam (generateObject) was invoked");
    assert.equal(mission.plan.topology, topology, "the clamped plan preserves the requested topology");
    assert.equal(mission.plan.agents.length, 2, "the plan carries two agents");

    // The mission ran to completion (auto-approved → agents → synthesis) via the production seams.
    assert.equal(mission.status, "completed", `the ${topology} mission completed`);
    assert.ok(log.agent.length >= 1, "the production agent-runner seam (generateObject) was invoked");
    assert.equal(log.synth.length, 1, "the production synthesizer seam (generateText) ran exactly once");

    // R-SES1 — the whole board reconstructs from the PARENT hub_events ALONE and settles terminal.
    const board = reconstructMission(repo.listEvents(session.id));
    assert.ok(board, "the mission board reconstructs from the event log alone");
    assert.equal(board?.agents.length, 2, "both agents are on the reconstructed board");
    assert.ok(board && isMissionBoardTerminal(board), "the reconstructed board is terminal (done)");
    assert.equal(board?.synthesis?.partial, false, "a fully-completed mission is honestly NOT partial");

    // §1.7 resolve-test — every rendered [n] in the PRODUCTION synthesis resolves to a merged source.
    const synth = findSynthesisMessage(events);
    assert.ok(synth, "the synthesis assistant_message is persisted");
    const body = messageText(synth);
    for (const m of body.matchAll(/\[(\d{1,4})\]/g)) {
      const n = Number(m[1]);
      assert.ok(
        synth?.citations.some((c) => Number(c.id) === n),
        `rendered marker [${n}] resolves to a merged citation`,
      );
    }

    // D-AH3 — a full production-seam mission wrote ZERO rows to the testing/dock tables.
    assertZeroTestingTableWrites(db);

    // Replay is deterministic + side-effect-free.
    const before = repo.listEvents(session.id).length;
    const board2 = reconstructMission(repo.listEvents(session.id));
    assert.equal(board2?.agents.length, 2, "replay is repeatable");
    assert.equal(repo.listEvents(session.id).length, before, "reconstruction wrote nothing");

    // ── Per-topology invariants ──────────────────────────────────────────────────────────────────
    if (topology === "pipeline") {
      // Ordered hand-off: stage 2's brief (its child's sole user_message) was ENRICHED with stage 1's
      // settled report — proof stage 2 started only after stage 1 settled (the ordering invariant).
      const secondChild = mission.agentSessionIds[1];
      assert.ok(secondChild, "a second agent child session exists");
      const briefEvent = repo
        .listEvents(secondChild!)
        .find((e): e is Extract<HubEvent, { type: "user_message" }> => e.type === "user_message");
      const briefText = briefEvent?.text ?? "";
      assert.ok(
        briefText.includes("Upstream results from earlier pipeline stages"),
        "pipeline stage 2's brief folds in the upstream report",
      );
    }

    if (topology === "debate") {
      // hub-fixes WP4.4 (D-HF3) — round-based debate: each debater runs an opening turn AND a rebuttal
      // turn, so its child has TWO user_messages. The REBUTTAL round's brief folds in the OTHER debater's
      // opening via the debate-round framing (the round-2 cross-visibility invariant) — proof the rebuttal
      // round ran after the openings settled, not a single sequential pass.
      const secondChild = mission.agentSessionIds[1];
      assert.ok(secondChild, "a second agent child session exists");
      const userMessages = repo
        .listEvents(secondChild!)
        .filter((e): e is Extract<HubEvent, { type: "user_message" }> => e.type === "user_message");
      assert.ok(userMessages.length >= 2, "a round-based debater ran an opening turn AND a rebuttal turn");
      assert.ok(
        userMessages.some((e) => e.text.includes(DEBATE_ROUND_BRIEF_INTRO)),
        "the debate's rebuttal round folds in the opposing opening (cross-visibility)",
      );
    }

    if (topology === "best_of_n") {
      // The production BLIND judge ran exactly once, and R-SK7 blindness holds: the judge saw the
      // anonymized attempts, NEVER the authoring role names or the authoring model id.
      assert.equal(log.judge.length, 1, "the production blind judge seam ran once (2 attempts)");
      const judgePrompt = log.judge[0] ?? "";
      assert.ok(
        !judgePrompt.includes("AlphaAuthor") && !judgePrompt.includes("BetaAuthor"),
        "R-SK7: the judge never sees the authoring role names",
      );
      assert.ok(!judgePrompt.includes(STUB_MODEL), "R-SK7: the judge never sees the authoring model id");
    } else {
      assert.equal(log.judge.length, 0, `no judge runs for '${topology}'`);
    }
  });
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// SEED 2 — the chat + research MODES run a real turn through the session service + turn engine
// ══════════════════════════════════════════════════════════════════════════════════════════════════

for (const mode of ["chat", "research"] as const) {
  test(`[mode] a '${mode}' session runs a real turn through the session service + turn engine, and replays`, async () => {
    const { repo } = openRepo();
    const service = new HubSessionService({
      repository: repo,
      tokenCounter: getTokenCounter(DEFAULT_TOKEN_PROFILE),
      resolveModel: () => ({
        providerKind: "openai",
        modelId: STUB_MODEL,
        contextWindow: 128000,
        buildModel: () => textStreamModel(`A settled ${mode} reply from the hub turn engine.`),
      }),
      resolveToolset: () => ({ tools: {} }),
      config: baseSessionConfig(tempDataDir()),
    });

    const session = await service.createSession({ mode, model: STUB_MODEL });
    // The session-service maps the wire mode to the prompt engine's addendum mode inside the turn.
    assert.equal(promptModeFor({ mode }), mode === "research" ? "research" : "chat");

    const { sink } = collectSink();
    const outcome = await service.dispatchMessage(session.id, { text: "Hello, assistant." }, sink);
    assert.equal(outcome.kind, "ran", "the dispatch ran a turn (not a queued steering message)");

    // Replay: the settled turn reconstructs from hub_events alone.
    const events = repo.listEvents(session.id);
    assert.ok(
      events.some((e) => e.type === "user_message" && e.text === "Hello, assistant."),
      "the user turn is in the event log",
    );
    const asst = events.find(
      (e): e is Extract<HubEvent, { type: "assistant_message" }> => e.type === "assistant_message",
    );
    assert.ok(asst, `the ${mode} turn settled an assistant_message`);
    assert.ok(messageText(asst).includes(mode), "the settled reply text is persisted");
    assert.ok(events.some((e) => e.type === "turn_done"), "the turn settled a turn_done");
  });
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// SEED 3 — a budget TRIP stops clean and synthesizes an honestly-PARTIAL answer (real orchestrator +
//          real production synthesizer seam; a costed runner drives the hard-cap enforcement)
// ══════════════════════════════════════════════════════════════════════════════════════════════════

test("[budget-trip] a mission that crosses its hard cost cap stops clean + synthesizes PARTIAL (production synthesizer)", async () => {
  const { repo, db } = openRepo();
  const log = newLog();
  const buildModel = (): LanguageModel => discriminatingModel(log);
  // The production `createStructuredAgentRunner` reports costUsd:0 (a documented owner-acceptance gap —
  // no per-agent metering in a single generateObject), so a realistic budget trip is driven with a
  // COSTED runner; what's under test is the ORCHESTRATOR's hard-cap enforcement + the PRODUCTION
  // synthesizer honestly marking the result partial.
  const costedRunner: HubAgentRunner = async (input) =>
    input.abortSignal.aborted
      ? { report: undefined, costUsd: 0, tokensIn: 0, tokensOut: 0, aborted: true }
      : { report: AGENT_REPORT, costUsd: 1.0, tokensIn: 10, tokensOut: 5 };

  const service = new HubMissionService({
    repository: repo,
    config: { ...MISSION_CONFIG, maxParallel: 1, defaultBudgetUsd: 0.5 },
    planner: createStructuredPlanner({ buildModel }),
    runAgent: costedRunner,
    synthesizer: createTextSynthesizer({ buildModel }),
    now: () => "2026-07-18T00:00:00.000Z",
  });

  const session = repo.createSession({ mode: "mission", model: STUB_MODEL, autonomy: "auto" });
  const { sink, events } = collectSink();
  const mission = await service.proposePlan({
    sessionId: session.id,
    text: `Do the work. TOPOLOGY=parallel ${ASK_MARKER}`,
    sink,
  });

  // Sequential (maxParallel 1): the first agent's $1 crosses the $0.5 cap before the second launches.
  const reports = events.filter((e) => e.type === "agent_report");
  assert.equal(reports.length, 1, "only the first agent completed before the cost cap tripped");
  assert.equal(mission.status, "completed", "the tripped mission still ended cleanly (not 'failed')");

  const synthEvent = events.find(
    (e): e is Extract<HubEvent, { type: "mission_synthesis" }> => e.type === "mission_synthesis",
  );
  assert.equal(synthEvent?.partial, true, "the over-budget synthesis is honestly marked PARTIAL");
  assert.ok(log.synth.length === 1, "the production synthesizer still composed a (partial) answer");
  const body = messageText(findSynthesisMessage(events));
  assert.ok(body.includes("PARTIAL"), "the synthesis body carries the PARTIAL banner");

  // Replay + isolation still hold on the tripped path.
  const board = reconstructMission(repo.listEvents(session.id));
  assert.ok(board && isMissionBoardTerminal(board), "the tripped mission's board replays terminal");
  assert.equal(board?.synthesis?.partial, true, "the reconstructed board marks the synthesis partial");
  assertZeroTestingTableWrites(db);
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// SEED 4 — COMPOSITION: built-ins + workspace + genui + citations apparatus coexist in ONE real turn
//          (the DEFAULT toolset resolver builds them all together — a name collision / build error
//          would throw; a settled turn that ran a built-in is the coexistence proof)
// ══════════════════════════════════════════════════════════════════════════════════════════════════

test("[composition] built-ins + workspace + genui + citations coexist in one real turn (default toolset)", async () => {
  const { repo } = openRepo();
  const dataDir = tempDataDir();
  const service = new HubSessionService({
    repository: repo,
    tokenCounter: getTokenCounter(DEFAULT_TOKEN_PROFILE),
    resolveModel: () => ({
      providerKind: "openai",
      modelId: STUB_MODEL,
      contextWindow: 128000,
      buildModel: () => writeThenAnswerModel(),
    }),
    // NO resolveToolset override → the DEFAULT resolver assembles built-ins + the deferred/eager tool
    // surface + the genui `present`/`prompt_user` tools together, over the confined session workspace.
    beginCitationTurn: beginHubCitationTurn,
    config: baseSessionConfig(dataDir),
  });

  const session = await service.createSession({ mode: "chat", model: STUB_MODEL, autonomy: "auto" });
  const { sink } = collectSink();
  await service.dispatchMessage(session.id, { text: "Write a note, then confirm." }, sink);

  const events = repo.listEvents(session.id);
  // The workspace built-in actually ran (its tool_call + a non-error tool_result settled).
  const toolCall = events.find(
    (e): e is Extract<HubEvent, { type: "tool_call" }> =>
      e.type === "tool_call" && e.part.toolName === "files.write",
  );
  assert.ok(toolCall, "the files.write built-in was called in the composed turn");
  const toolResult = events.find(
    (e): e is Extract<HubEvent, { type: "tool_result" }> =>
      e.type === "tool_result" && e.toolCallId === toolCall?.part.toolCallId,
  );
  assert.ok(toolResult, "the files.write call settled a tool_result");
  assert.equal(toolResult?.state, "output-available", "the workspace write settled successfully (not errored/denied)");

  // The file landed inside the session's CONFINED workspace (never outside /data/hub/ws/<sessionId>/).
  const wsFile = path.join(dataDir, "hub", "ws", session.id, "note.md");
  assert.ok(fs.existsSync(wsFile), "the note was written inside the confined session workspace");

  // The composed turn still settled its assistant reply.
  assert.ok(
    events.some((e) => e.type === "assistant_message"),
    "the composed turn settled an assistant_message",
  );
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// SEED 5 — BRANCH + artifact REVIEW through the real REST routes (Fastify over a real HubRepository)
// ══════════════════════════════════════════════════════════════════════════════════════════════════

function seedAnthropicCredential(db: AppDatabase, secrets: SecretStore): void {
  const now = "2026-07-18T00:00:00.000Z";
  db.prepare(
    `INSERT INTO provider_credentials (id, kind, label, base_url, api_key_encrypted, created_at, updated_at)
     VALUES ('prov-1', 'anthropic', 'Claude', NULL, @key, @now, @now)`,
  ).run({ key: secrets.encryptText("dummy-not-a-real-key"), now });
}

async function makeRoutesApp(
  options: { reviewAgentRunner?: (input: HubReviewAgentInput) => Promise<HubReviewAgentResult> } = {},
): Promise<{ baseUrl: string; repo: HubRepository }> {
  const { repo, db } = openRepo();
  const secrets = new SecretStore(crypto.randomBytes(32));
  seedAnthropicCredential(db, secrets);
  const providers = new ProviderRepository(db, secrets);
  const service = new HubSessionService({
    repository: repo,
    tokenCounter: getTokenCounter(DEFAULT_TOKEN_PROFILE),
    resolveToolset: () => ({ tools: {} }),
    resolveModel: () => ({
      providerKind: "openai",
      modelId: STUB_MODEL,
      contextWindow: 128000,
      buildModel: () => textStreamModel("hi"),
    }),
    config: baseSessionConfig(tempDataDir()),
  });

  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ error: "Validation failed" });
    const typed = error as Error & { statusCode?: number };
    return reply.code(typed.statusCode ?? 500).send({ error: toErrorMessage(error) });
  });
  await registerHubRoutes(app, {
    repository: repo,
    sessionService: service,
    providers,
    ...(options.reviewAgentRunner ? { reviewAgentRunner: options.reviewAgentRunner } : {}),
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  harnesses.push(app);
  const address = app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return { baseUrl: `http://127.0.0.1:${port}`, repo };
}

test("[branch] POST /branch forks a session, copies the conversation, emits branch_created, and replays", async () => {
  const { baseUrl, repo } = await makeRoutesApp();

  // A source chat session with a settled exchange (created directly; the branch route copies the
  // conversational event types only).
  const src = repo.createSession({ mode: "chat", model: STUB_MODEL });
  repo.appendEvent(src.id, { type: "user_message", messageId: "u1", text: "the original question" });
  repo.appendEvent(src.id, {
    type: "assistant_message",
    messageId: "a1",
    model: STUB_MODEL,
    parts: [{ type: "text", text: "the original answer" }],
    citations: [],
    artifactsTouched: [],
    finishReason: "stop",
  });

  const res = await fetch(`${baseUrl}/api/hub/sessions/${src.id}/branch`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ label: "WP4.R branch" }),
  });
  assert.equal(res.status, 201, "the branch route forks a new session");
  const forked = (await res.json()) as { id: string; title: string };
  assert.notEqual(forked.id, src.id, "the fork is a distinct session");

  // The source log records a branch_created pointing at the fork (R-SES1 replay completeness).
  const branchEvent = repo
    .listEvents(src.id)
    .find((e): e is Extract<HubEvent, { type: "branch_created" }> => e.type === "branch_created");
  assert.ok(branchEvent, "branch_created recorded on the source session log");
  assert.equal(branchEvent?.branchSessionId, forked.id, "branch_created points at the fork");

  // The fork carries the copied conversation — its state reconstructs from its OWN event log alone.
  const forkedEvents = repo.listEvents(forked.id);
  assert.ok(
    forkedEvents.some((e) => e.type === "user_message" && e.text === "the original question"),
    "the fork carries the copied user turn",
  );
  assert.ok(
    forkedEvents.some((e) => e.type === "assistant_message"),
    "the fork carries the copied assistant turn",
  );
});

test("[review] a critic review → accept a suggestion → a new immutable artifact version is created", async () => {
  // The critic model is a pure DI seam (no real model). It anchors a comment to a locatable quote with
  // a suggested edit — the D-AH12 review contract.
  const { baseUrl } = await makeRoutesApp({
    reviewAgentRunner: async (input) => {
      // The critic is "spawned" with a non-empty lens + the artifact content in its brief.
      assert.ok(input.systemPrompt.trim().length > 0, "the critic is spawned with a non-empty system prompt");
      return {
        comments: [
          { body: "Confirm the launch date.", anchor: { quote: "March 1st" }, suggestedEdit: "March 3rd" },
        ],
      };
    },
  });

  const createArtifact = await fetch(`${baseUrl}/api/hub/artifacts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "markdown", title: "Release notes", content: "The launch date is March 1st." }),
  });
  assert.equal(createArtifact.status, 201, "the artifact was created");
  const artifact = (await createArtifact.json()) as HubArtifact;

  // POST a review — spawns the critic, stamps a pending, agent-authored comment.
  const openReview = await fetch(`${baseUrl}/api/hub/artifacts/${artifact.id}/reviews`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: STUB_MODEL }),
  });
  assert.equal(openReview.status, 201, "the review was opened (critic spawned)");
  const review = (await openReview.json()) as HubReview;
  const comment = review.comments[0];
  assert.ok(comment, "the critic produced an anchored comment");
  assert.equal(comment?.decision, "pending", "the comment starts pending");

  // Accept the suggestion → a new IMMUTABLE version (version 2) carrying the edit.
  const decide = await fetch(`${baseUrl}/api/hub/reviews/${review.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ decision: { commentId: comment!.id, decision: "accepted" } }),
  });
  assert.equal(decide.status, 200, "the decision was applied");
  const result = (await decide.json()) as HubReviewDecisionResult;
  assert.equal(result.review.comments[0]?.decision, "accepted", "the comment is now accepted");
  assert.equal(result.resultingVersion?.version, 2, "accepting a suggestion appends a new immutable version");
  assert.ok(
    result.resultingVersion?.content.includes("March 3rd"),
    "the new version carries the accepted edit",
  );
});
