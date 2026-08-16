// Assistant Hub — WP1.R Wave-1 ADVERSARIAL REVIEW probes (roadmap/assistant-hub/, D-AH18).
//
// These are REFUTATION probes authored by the Wave-1 reviewer (read-only on implementation). They
// attack the Wave-1 invariants at the seams the owning WPs' own happy-path tests do NOT cover:
//
//   • Invariant 4 (budget under a PARALLEL race) — hub-missions.test.ts only trips the budget with
//     maxParallel:1 (sequential, deterministic). This drives a genuine parallel fan-out to expose the
//     total-cost overshoot bound and to PROVE the maxParallel / maxAgents caps are hard. FIXED (WP1.R):
//     the cap used to be inert for single-wave missions (`orchestrator.ts` checked it only between
//     launch waves); it is now checked before every launch and after every settle, independent of
//     `cursor` — see the INV4 test.
//   • Invariant 1 (event-log reconstruction, R-SES1) — hub-missions.test.ts covers the mission board and
//     hub-citations.test.ts the citation baseline; NEITHER replays a single CHAT session carrying BOTH
//     event-sourced tasks AND artifacts from `listEvents` alone, nor pins the documented artifact-content
//     nuance (content lives in the immutable version store, referenced by the event).
//   • Invariant 3 (domain isolation) — no existing test asserts, at RUNTIME after a real mission + chat
//     turn, that ZERO rows land in the testing tables (runs/run_steps/run_events/run_grades/suites/
//     suite_runs/scenarios) or the dock tables (assistant_threads/assistant_events).
//   • Invariant 2 (citation integrity through synthesis) — a narrow deterministic-fallback mis-attribution
//     edge the resolve-test did not catch. FIXED (WP1.R): `synthesis.ts`'s `remapOrDropMarkers` now
//     DROPS a raw `[n]` marker an agent doesn't own instead of leaving it un-remapped — see the INV2 test.
//
// Every probe PASSES (they are permanent regression guards); a probe that once merely DOCUMENTED a
// refuted invariant is noted FIXED above once the owning WP closed it. No real provider/API key/MCP
// server is contacted — the model seams are the same `MockLanguageModelV3` / stub-function pattern the
// owning WPs' tests use.

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import type {
  HubAgentReport,
  HubEvent,
  HubMissionPlan,
  HubPlannedAgent,
  HubSession,
  HubToolGrants,
} from "@mcp-token-footprint/shared";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { applyMigrations, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { getTokenCounter } from "../src/token-counting/profiles.js";
import { hubCapabilitiesForKind } from "../src/hub/capabilities.js";
import { HubRepository } from "../src/hub/repository.js";
import { reconstructTasks, tasksCreate, artifactsCreate } from "../src/hub/tools/builtins/index.js";
import { reconstructCitationBaseline } from "../src/hub/citations.js";
import { ensureHubWorkspaceRoot } from "../src/hub/workspace.js";
import {
  buildHubBuiltinTools,
  HubSteeringQueue,
  reconstructMessages,
  runHubTurn,
  type HubTurnSink,
} from "../src/hub/turn-engine.js";
import {
  HubMissionService,
  reconstructMission,
  type HubAgentRunner,
  type HubMissionServiceConfig,
  type HubPlanner,
  type HubSynthesizer,
} from "../src/hub/missions/index.js";

// ── Harness ─────────────────────────────────────────────────────────────────────────────────────

const databases: AppDatabase[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function openDb(): { repo: HubRepository; db: AppDatabase } {
  const db = new Database(":memory:") as unknown as AppDatabase;
  databases.push(db);
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  return { repo: new HubRepository(db), db };
}

function collectSink(): { sink: HubTurnSink; events: HubEvent[] } {
  const events: HubEvent[] = [];
  return { sink: { onEvent: (e) => events.push(e), onDelta: () => {} }, events };
}

const EMPTY_GRANTS: HubToolGrants = { servers: {}, builtins: [] };

function plannedAgent(over: Partial<HubPlannedAgent> & { key: string }): HubPlannedAgent {
  return {
    name: over.name ?? over.key,
    systemPrompt: `You are ${over.key}.`,
    model: "gpt-4o",
    toolGrants: EMPTY_GRANTS,
    skillIds: [],
    brief: `Do the work for ${over.key}.`,
    target: `Target ${over.key}`,
    expectedOutcome: "A structured report.",
    ...over,
  };
}

function report(over: Partial<HubAgentReport> = {}): HubAgentReport {
  return {
    findings: [{ summary: "A finding." }],
    citations: [],
    artifacts: [],
    confidence: "medium",
    openQuestions: [],
    ...over,
  };
}

const DEFAULT_CONFIG: HubMissionServiceConfig = {
  maxAgents: 6,
  maxParallel: 3,
  defaultBudgetUsd: 2.0,
  maxBudgetUsd: 10.0,
  askAboveAgents: 3,
  askAboveUsd: 1.0,
  defaultAutonomy: "always_ask",
};

function makeService(over: {
  repository: HubRepository;
  planner: HubPlanner;
  runAgent: HubAgentRunner;
  synthesizer?: HubSynthesizer;
  config?: Partial<HubMissionServiceConfig>;
}): HubMissionService {
  return new HubMissionService({
    repository: over.repository,
    planner: over.planner,
    runAgent: over.runAgent,
    synthesizer:
      over.synthesizer ??
      (async () => ({ text: "Synthesis of the agents [1].", usage: { tokensIn: 5, tokensOut: 5 }, costUsd: 0.05 })),
    config: { ...DEFAULT_CONFIG, ...over.config },
    now: () => "2026-07-17T00:00:00.000Z",
  });
}

type MockStreamResult = Awaited<ReturnType<NonNullable<MockLanguageModelV3["doStream"]>>>;
type V3Part = MockStreamResult["stream"] extends ReadableStream<infer P> ? P : never;
const USAGE = {
  inputTokens: { total: 12, noCache: 12, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 7, text: 7, reasoning: 0 },
} as const;
function streamOf(chunks: V3Part[]) {
  return { stream: simulateReadableStream({ chunks }) };
}
function toolCallStep(toolCallId: string, toolName: string, input: unknown): V3Part[] {
  return [
    { type: "stream-start", warnings: [] },
    { type: "tool-call", toolCallId, toolName, input: JSON.stringify(input) },
    { type: "finish", finishReason: { unified: "tool-calls", raw: "tool_use" }, usage: USAGE },
  ];
}
function textStep(text: string): V3Part[] {
  return [
    { type: "stream-start", warnings: [] },
    { type: "text-start", id: "t1" },
    { type: "text-delta", id: "t1", delta: text },
    { type: "text-end", id: "t1" },
    { type: "finish", finishReason: { unified: "stop", raw: "end_turn" }, usage: USAGE },
  ];
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// INVARIANT 4 — budget enforcement under a PARALLEL race (D-AH9 "hard caps")
// ══════════════════════════════════════════════════════════════════════════════════════════════════

// FIXED (owning WP: WP1.7, MEDIUM severity — was: contradicted D-AH9's "total cost is a hard cap").
// Previously the total-cost budget was checked in `orchestrator.ts` ONLY between launch waves, gated by
// `cumulativeCost >= budgetCap && cursor < spawned.length`. When `maxParallel >= (planned agent count)`
// — the COMMON case (default maxParallel 3; most small missions have ≤3 agents) — every agent launched
// in the first wave, so `cursor` reached `spawned.length` immediately and the trip guard was NEVER
// satisfied: the cost cap was INERT, all agents ran to completion regardless of cumulative spend, and
// the mission was never marked partial. Fixed: the cap is now checked BEFORE every launch (including the
// first wave) AND after every settle, independent of `cursor` — a trip stops further launches, aborts
// whatever is still in flight, and the mission always synthesizes honestly PARTIAL once spend crosses
// the cap (already-incurred spend on agents that had already started can't be un-spent, but nothing
// further launches and the overspend is never silent). This is now a permanent regression guard: PASSES
// asserting the FIXED behavior (maxParallel remains hard; the trip fires within the first wave; partial
// is honestly true). (Per-agent budgets are still not enforced inside the production
// `createStructuredAgentRunner` — a single `generateObject` with no stopWhen — that seam remains
// owner-acceptance / not gate-tested; this probe pins the observable stubbed behavior only.)
test("INV4 FIXED: the total-cost cap trips even when maxParallel >= agent count (single first wave)", async () => {
  const { repo } = openDb();
  const session = repo.createSession({ mode: "mission", model: "gpt-4o", autonomy: "auto" });
  const { sink, events } = collectSink();

  // 3 agents, each $1.50. Cap = $2, maxParallel = 3 (>= agent count) — all 3 launch in the SAME first
  // wave. The fix must still trip: once two agents' cost lands ($3.00 >= $2 cap), the cap stops the
  // mission from silently running the rest to completion, and the mission ends honestly partial.
  const plan: HubMissionPlan = {
    topology: "parallel",
    autonomy: "auto",
    agents: Array.from({ length: 3 }, (_, i) => plannedAgent({ key: `a${i}` })),
  };
  const concurrency = { current: 0, max: 0 };
  const runAgent: HubAgentRunner = async () => {
    concurrency.current += 1;
    concurrency.max = Math.max(concurrency.max, concurrency.current);
    await new Promise((r) => setTimeout(r, 5));
    concurrency.current -= 1;
    return { report: report(), costUsd: 1.5, tokensIn: 10, tokensOut: 5 };
  };
  const service = makeService({
    repository: repo,
    planner: async () => plan,
    runAgent,
    config: { maxAgents: 6, maxParallel: 3, defaultBudgetUsd: 2.0 },
  });

  const mission = await service.proposePlan({ sessionId: session.id, text: "three-agent mission", sink });

  // HARD caps hold: concurrency never exceeded maxParallel.
  assert.ok(concurrency.max <= 3, `maxParallel is a hard cap (observed peak ${concurrency.max})`);

  const reports = events.filter((e) => e.type === "agent_report");
  // The trip fires as soon as cumulative spend crosses $2 (after the 2nd agent settles at $3.00), even
  // though every agent already launched in the first wave — the 3rd agent (still in flight at that
  // point) is aborted and its report discarded, so NOT all three complete.
  assert.ok(reports.length < 3, `the cap stopped at least one agent from completing (got ${reports.length})`);
  assert.ok(mission.costUsd > 2.0, `spend already committed before the trip is not undone ($${mission.costUsd})`);
  // The critical fix: the overspend is no longer silent — the synthesis IS honestly marked partial.
  const synth = events.find((e): e is Extract<HubEvent, { type: "mission_synthesis" }> => e.type === "mission_synthesis");
  assert.equal(synth?.partial, true, "the over-budget mission IS marked partial (an honest trip signal)");
});

// The cost cap DOES fire when there is genuinely un-launched work behind the parallel window (the case
// hub-missions.test.ts covers with maxParallel:1). This confirms the guard works — it is just the
// `cursor < spawned.length` scope that makes it inert for single-wave missions above.
test("INV4: the cost cap DOES trip when agents exceed the parallel window (multi-wave)", async () => {
  const { repo } = openDb();
  const session = repo.createSession({ mode: "mission", model: "gpt-4o", autonomy: "auto" });
  const { sink, events } = collectSink();
  const plan: HubMissionPlan = {
    topology: "parallel",
    autonomy: "auto",
    agents: Array.from({ length: 4 }, (_, i) => plannedAgent({ key: `a${i}` })),
  };
  const service = makeService({
    repository: repo,
    planner: async () => plan,
    // Sequential (maxParallel 1) so the first agent's $1 trips the $0.5 cap before the rest launch.
    runAgent: async (input) =>
      input.abortSignal.aborted
        ? { report: undefined, costUsd: 0, tokensIn: 0, tokensOut: 0, aborted: true }
        : { report: report(), costUsd: 1, tokensIn: 10, tokensOut: 5 },
    config: { maxAgents: 6, maxParallel: 1, defaultBudgetUsd: 0.5 },
  });
  await service.proposePlan({ sessionId: session.id, text: "serial mission", sink });
  const reports = events.filter((e) => e.type === "agent_report");
  assert.equal(reports.length, 1, "only the first agent ran before the cost cap tripped");
  const synth = events.find((e): e is Extract<HubEvent, { type: "mission_synthesis" }> => e.type === "mission_synthesis");
  assert.equal(synth?.partial, true, "the tripped mission is honestly marked partial");
});

// The maxAgents fan-out cap, by contrast, IS hard (clamped at propose time, before any launch).
test("INV4: maxAgents is a hard cap — an over-eager plan is clamped before any agent launches", async () => {
  const { repo } = openDb();
  const session = repo.createSession({ mode: "mission", model: "gpt-4o", autonomy: "always_ask" });
  const { sink } = collectSink();
  const plan: HubMissionPlan = {
    topology: "parallel",
    autonomy: "always_ask",
    agents: Array.from({ length: 20 }, (_, i) => plannedAgent({ key: `a${i}` })),
    budgets: { maxAgents: 99, maxParallel: 99, maxCostUsd: 9999 }, // the planner tries to widen the caps
  };
  const service = makeService({
    repository: repo,
    planner: async () => plan,
    runAgent: async () => ({ report: report(), costUsd: 0, tokensIn: 0, tokensOut: 0 }),
    config: { maxAgents: 4, maxParallel: 2 },
  });
  const mission = await service.proposePlan({ sessionId: session.id, text: "huge", sink });
  assert.equal(mission.plan.agents.length, 4, "20 agents clamped to the maxAgents cap of 4");
  assert.equal(mission.plan.budgets?.maxAgents, 4, "the plan's own maxAgents is clamped DOWN, never up");
  assert.equal(mission.plan.budgets?.maxParallel, 2, "the plan's own maxParallel is clamped DOWN, never up");
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// INVARIANT 1 — a rich CHAT session reconstructs from hub_events ALONE (R-SES1)
// ══════════════════════════════════════════════════════════════════════════════════════════════════

test("INV1: a chat turn's transcript + tasks + artifact metadata all reconstruct from listEvents alone", async () => {
  const { repo, db } = openDb();
  const session = repo.createSession({ mode: "chat", model: "gpt-4o" });
  repo.appendEvent(session.id, { type: "user_message", messageId: "u1", text: "Plan and produce a doc." });

  // A real turn whose model (step 1) creates a task, (step 2) creates an artifact, (step 3) answers.
  const dataDir = ensureHubWorkspaceRoot("/tmp/hub-wp1r-inv1", session.id).replace(/\/ws\/.*/, "");
  const execCtx = {
    sessionId: session.id,
    workspaceRoot: ensureHubWorkspaceRoot(dataDir, session.id),
    repository: repo,
    tokenCounter: getTokenCounter("generic_o200k"),
  };
  const tools = buildHubBuiltinTools([tasksCreate, artifactsCreate], execCtx);

  let call = 0;
  const model = new MockLanguageModelV3({
    // The provider only ever sees the SANITIZED tool names — the turn engine re-keys the dotted internal
    // built-in keys (`tasks.create`/`artifacts.create`) to `tasks_create`/`artifacts_create` at the model
    // boundary (the P0 fix), so a faithful model calls them back by the safe names; the engine restores
    // the dotted internal names in the persisted tool_call events via `toInternalName`.
    doStream: async () => {
      call += 1;
      if (call === 1) return streamOf(toolCallStep("tc-task", "tasks_create", { title: "Draft the doc" }));
      if (call === 2)
        return streamOf(
          toolCallStep("tc-art", "artifacts_create", {
            kind: "markdown",
            title: "The Doc",
            content: "# The Doc\n\nSECRET_ARTIFACT_BODY_v1",
          }),
        );
      return streamOf(textStep("Done — I created a task and the artifact."));
    },
  });

  await runHubTurn(
    { repository: repo },
    {
      session: repo.getSession(session.id),
      promptMode: "chat",
      model,
      providerKind: "openai",
      modelId: "gpt-4o",
      capabilities: hubCapabilitiesForKind("openai"),
      contextWindow: 128000,
      toolset: { tools, sources: { "tasks.create": "builtin", "artifacts.create": "builtin" } },
      abortSignal: new AbortController().signal,
      steering: new HubSteeringQueue(session.id, repo),
      sink: { onEvent: () => {}, onDelta: () => {} },
    },
  );

  // ── Replay from the event log ALONE (no service, no live objects).
  const events = repo.listEvents(session.id);

  // (a) transcript — reconstructMessages rebuilds the user + assistant turns.
  const messages = reconstructMessages(events);
  assert.ok(messages.some((m) => m.role === "user" && m.content === "Plan and produce a doc."));
  assert.ok(messages.some((m) => m.role === "assistant"), "the assistant turn reconstructs from events");

  // (b) tasks — the live task widget rebuilds purely from tasks.create tool-call/result pairs.
  const tasks = reconstructTasks(events);
  assert.equal(tasks.length, 1, "the task reconstructs from the event log alone");
  assert.equal(tasks[0]?.title, "Draft the doc");

  // (c) artifact metadata — an artifact_created event carries id/title/kind/version (R-SES1).
  const created = events.filter((e): e is Extract<HubEvent, { type: "artifact_created" }> => e.type === "artifact_created");
  assert.equal(created.length, 1, "an artifact_created event is in the log");
  assert.equal(created[0]?.title, "The Doc");

  // Replay is SIDE-EFFECT-FREE and DETERMINISTIC.
  const before = repo.listEvents(session.id).length;
  assert.deepEqual(reconstructTasks(repo.listEvents(session.id)), tasks);
  assert.equal(repo.listEvents(session.id).length, before, "reconstruction wrote nothing");

  // NUANCE (documented, NOT a refutation): the artifact CONTENT is not carried by the artifact_created
  // event — it lives in the immutable version store (hub_artifact_versions), referenced by versionId, by
  // design (§1.3). It IS recoverable from the event log for the MODEL path (the tools.create tool_call
  // event persists the `content` arg), but NOT via the discrete artifact_created event alone.
  const artifactCreatedPayload = JSON.stringify(created[0]);
  assert.equal(
    artifactCreatedPayload.includes("SECRET_ARTIFACT_BODY_v1"),
    false,
    "artifact_created carries a reference (versionId), not the body — content lives in the version store",
  );
  const toolCallArgs = JSON.stringify(
    events.filter((e) => e.type === "tool_call").map((e) => (e.type === "tool_call" ? e.part.args : null)),
  );
  assert.ok(
    toolCallArgs.includes("SECRET_ARTIFACT_BODY_v1"),
    "the artifact body IS recoverable from the model path's tool_call args (so the log is not lossy for the model path)",
  );

  // The content is present in the artifact table (the authoritative store the reference points at).
  const versionRow = db
    .prepare("SELECT content FROM hub_artifact_versions WHERE id = ?")
    .get(created[0]?.versionId) as { content: string } | undefined;
  assert.equal(versionRow?.content, "# The Doc\n\nSECRET_ARTIFACT_BODY_v1");
});

// A full mission ALSO reconstructs inert from the parent log (composes with the chat-session case above).
test("INV1: a full mission's board + citation baseline reconstruct from the parent log alone", async () => {
  const { repo } = openDb();
  const session = repo.createSession({ mode: "mission", model: "gpt-4o", autonomy: "auto" });
  const { sink } = collectSink();
  const plan: HubMissionPlan = {
    topology: "parallel",
    autonomy: "auto",
    agents: [plannedAgent({ key: "a" }), plannedAgent({ key: "b" })],
  };
  const reports: Record<string, HubAgentReport> = {
    a: report({ citations: [{ id: "1", title: "Src A", url: "https://a.example/x" }], findings: [{ summary: "A [1]", citationIds: ["1"] }] }),
    b: report({ citations: [{ id: "1", title: "Src B", url: "https://b.example/y" }], findings: [{ summary: "B [1]", citationIds: ["1"] }] }),
  };
  const service = makeService({
    repository: repo,
    planner: async () => plan,
    runAgent: async (input) => ({ report: reports[input.key] ?? report(), costUsd: 0, tokensIn: 0, tokensOut: 0 }),
    synthesizer: async () => ({ text: "Both agents agree [1][2].", usage: { tokensIn: 5, tokensOut: 5 }, costUsd: 0 }),
  });
  await service.proposePlan({ sessionId: session.id, text: "compare A and B", sink });

  const events = repo.listEvents(session.id);
  const board = reconstructMission(events);
  assert.ok(board, "the mission board reconstructs from the parent log alone");
  assert.equal(board?.agents.length, 2);

  // The session's citation baseline (what a next turn would resume numbering from) rebuilds from the log.
  const baseline = reconstructCitationBaseline(events);
  assert.equal(baseline.length, 2, "both merged synthesis citations rebuild from the event log");
  const ids = new Set(baseline.map((c) => c.id));
  assert.ok(ids.has("1") && ids.has("2"), "the merged numbering is recoverable purely from events");
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// INVARIANT 3 — the hub writes ONLY hub_* tables at runtime (D-AH3 domain isolation)
// ══════════════════════════════════════════════════════════════════════════════════════════════════

test("INV3: a real mission + chat turn write ZERO rows to the testing/dock tables", async () => {
  const { repo, db } = openDb();

  // (1) A full mission (planner → 3 parallel agents → synthesis).
  const missionSession = repo.createSession({ mode: "mission", model: "gpt-4o", autonomy: "auto" });
  const { sink } = collectSink();
  const plan: HubMissionPlan = {
    topology: "parallel",
    autonomy: "auto",
    agents: [plannedAgent({ key: "a" }), plannedAgent({ key: "b" }), plannedAgent({ key: "c" })],
  };
  const service = makeService({
    repository: repo,
    planner: async () => plan,
    runAgent: async () => ({ report: report(), costUsd: 0.1, tokensIn: 10, tokensOut: 5 }),
  });
  await service.proposePlan({ sessionId: missionSession.id, text: "do the mission", sink });

  // (2) A chat turn through the real turn engine (stub model).
  const chat = repo.createSession({ mode: "chat", model: "gpt-4o" });
  repo.appendEvent(chat.id, { type: "user_message", messageId: "u1", text: "hi" });
  await runHubTurn(
    { repository: repo },
    {
      session: repo.getSession(chat.id),
      promptMode: "chat",
      model: new MockLanguageModelV3({ doStream: async () => streamOf(textStep("Hello!")) }),
      providerKind: "openai",
      modelId: "gpt-4o",
      capabilities: hubCapabilitiesForKind("openai"),
      contextWindow: 128000,
      toolset: { tools: {} },
      abortSignal: new AbortController().signal,
      steering: new HubSteeringQueue(chat.id, repo),
      sink: { onEvent: () => {}, onDelta: () => {} },
    },
  );

  // Sanity: the hub DID write its own tables.
  const hubEventCount = (db.prepare("SELECT COUNT(*) AS n FROM hub_events").get() as { n: number }).n;
  assert.ok(hubEventCount > 0, "the hub populated hub_events");
  const hubSessionCount = (db.prepare("SELECT COUNT(*) AS n FROM hub_sessions").get() as { n: number }).n;
  assert.ok(hubSessionCount >= 5, "the hub created the parent + 3 agent children + the chat session");

  // The refutation attempt: NOTHING landed in the testing/grading/suite or dock tables.
  const forbidden = [
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
  for (const table of forbidden) {
    const n = (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
    assert.equal(n, 0, `the hub wrote 0 rows to ${table} (domain isolation, D-AH3)`);
  }
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// INVARIANT 2 — citation integrity through synthesis: a documented mis-attribution edge
// ══════════════════════════════════════════════════════════════════════════════════════════════════

// FIXED (owning WP: WP1.7, LOW severity — was: a documented mis-attribution edge). On the
// DETERMINISTIC-FALLBACK synthesis path (the LLM synthesizer threw/returned empty), an agent whose
// finding text cited a RAW `[n]` marker that was NOT in its OWN citations[] used to be left un-remapped
// (the agent-scoped remap has no entry for it). If that number happened to coincide with a DIFFERENT
// agent's merged number, the rendered `[n]` resolved to the WRONG source (mis-attribution) — the
// resolve-test ("every rendered [n] resolves to A source") still held (the number did resolve), but the
// provenance was wrong. Fixed: `remapOrDropMarkers` (the single helper both `remapFindingText` and
// `deterministicSynthesis` now route through) DROPS an unowned raw marker instead of leaving it as a
// literal `[n]` — so it can never coincidentally collide with a different agent's merged citation number.
// This is now a permanent regression guard: PASSES asserting the stray marker is gone and every rendered
// `[n]` resolves to its true owner.
test("INV2 FIXED: deterministic-fallback synthesis drops (never mis-attributes) a raw agent marker absent from its own citations", async () => {
  const { repo } = openDb();
  const session = repo.createSession({ mode: "mission", model: "gpt-4o", autonomy: "auto" });
  const { sink, events } = collectSink();
  const plan: HubMissionPlan = {
    topology: "parallel",
    autonomy: "auto",
    agents: [plannedAgent({ key: "a" }), plannedAgent({ key: "b" })],
  };
  const reports: Record<string, HubAgentReport> = {
    // Agent A cites a RAW `[2]` in its finding text but only lists source id "1" — an inconsistency the
    // report schema does not forbid.
    a: report({
      agentSessionId: undefined,
      citations: [{ id: "1", title: "Source A", url: "https://a.example/doc" }],
      findings: [{ summary: "A claim, see [2].", citationIds: ["1"] }],
    }),
    b: report({
      agentSessionId: undefined,
      citations: [{ id: "1", title: "Source B", url: "https://b.example/doc" }],
      findings: [{ summary: "B claim [1].", citationIds: ["1"] }],
    }),
  };
  const service = makeService({
    repository: repo,
    planner: async () => plan,
    runAgent: async (input) => ({ report: reports[input.key] ?? report(), costUsd: 0, tokensIn: 0, tokensOut: 0 }),
    // The synthesizer FAILS → the deterministic fallback (the reports' own bodies, markers remapped) runs.
    synthesizer: async () => {
      throw new Error("synthesizer unavailable");
    },
  });
  await service.proposePlan({ sessionId: session.id, text: "compare", sink });

  const synth = events.find((e): e is Extract<HubEvent, { type: "mission_synthesis" }> => e.type === "mission_synthesis");
  assert.ok(synth, "the mission still synthesized deterministically");
  const assistant = events.find(
    (e): e is Extract<HubEvent, { type: "assistant_message" }> =>
      e.type === "assistant_message" && e.messageId === synth?.messageId,
  );
  assert.ok(assistant, "a deterministic synthesis message was persisted");

  // The message's citations[] is the clean merged set (2 real sources) — the store is correct.
  assert.equal(assistant?.citations.length, 2, "both real sources are in the merged citations[]");

  const text = assistant?.parts.map((p) => (p.type === "text" ? p.text : "")).join("") ?? "";

  // Agent A's stray raw `[2]` (absent from A's own citations) is DROPPED — it never survives into the
  // deterministic body as a literal bracket, so it can never coincidentally resolve to a DIFFERENT
  // agent's merged citation.
  assert.ok(text.includes("A claim, see."), "A's finding renders WITHOUT its unowned stray marker");
  assert.ok(!text.includes("see [2]"), "A's stray [2] does not survive into the body");
  const findingALine = text.split("\n").find((line) => line.includes("A claim"));
  assert.ok(findingALine, "A's finding line is present");
  assert.equal(
    /\[\d{1,4}\]/.test(findingALine ?? ""),
    false,
    "A's finding carries NO citation marker at all now — its only one was unowned, so it is dropped rather than mis-attributed",
  );

  // Agent B's OWN `[1]` — a real, owned citation — still correctly remaps to the merged `[2]`.
  assert.ok(text.includes("B claim [2]."), "B's own citation correctly remaps to the merged numbering");
  const citation2 = assistant?.citations.find((c) => c.id === "2");
  assert.equal(citation2?.title, "Source B", "merged [2] is Source B — and only B's OWN claim now points at it");

  // Every rendered marker still resolves to a real merged source (the resolve-test's hard guarantee) —
  // AND, the fix above ensures it resolves to the CORRECT (owning) agent's source, not just SOME source.
  for (const m of text.matchAll(/\[(\d{1,4})\]/g)) {
    const n = Number(m[1]);
    const resolvable = assistant?.citations.some((c) => Number(c.id) === n) ?? false;
    assert.ok(resolvable, `rendered marker [${n}] resolves to some real merged source (resolve-test holds)`);
  }
});
