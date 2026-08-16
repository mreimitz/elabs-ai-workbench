// Assistant Hub (roadmap/assistant-hub/, WP1.7) — the mission orchestrator, driven by STUBBED model
// seams (no provider/API key). File lives at `apps/api/test/` because the api runner globs
// `test/*.test.ts`.
//
// Proves (per-Acceptance + per-MUST):
//   • the planner emits a valid structured `HubMissionPlan` (`plan_proposed`), clamped to the hard caps;
//   • the plan is editable (`editPlan`/`plan_updated`) + approvable, and always_ask waits for approval;
//   • on approve, parallel child sessions spawn with the caps honored (excess dropped; maxParallel
//     bounds concurrency) and ISOLATED briefs — an agent's input never contains the parent transcript;
//   • agents produce structured `HubAgentReport`s (`agent_report`);
//   • synthesis cites the agent reports with their citations PRESERVED + re-numbered (every `[n]` resolves);
//   • a tripped budget stops cleanly + synthesizes PARTIALLY, honestly marked;
//   • the whole mission REPLAYS INERT from `hub_events` alone (`reconstructMission`).

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import {
  hubMissionPlanSchema,
  type HubAgentReport,
  type HubEvent,
  type HubMissionPlan,
  type HubPlannedAgent,
  type HubToolGrants,
} from "@mcp-token-footprint/shared";
import { applyMigrations, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { HubRepository } from "../src/hub/repository.js";
import { findCitationMarkers } from "../src/hub/citations.js";
import { reconstructMessages } from "../src/hub/turn-engine.js";
import type { HubNotifyEvent, HubNotifySink, HubTurnSink } from "../src/hub/turn-engine.js";
import { toErrorMessage } from "../src/utils/errors.js";
import {
  buildMissionPlannerPrompt,
  buildPlannerServerCatalog,
  clampGrantsToCatalog,
  clampPlanToBudgets,
  createStructuredPlanner,
  estimateAgentCostUsd,
  estimatePlanCostUsd,
  HubMissionService,
  mergeAgentCitations,
  reconstructMission,
  registerHubMissionRoutes,
  shouldAutoApprove,
  type HubAgentRunInput,
  type HubAgentRunner,
  type HubMissionServiceConfig,
  type HubPlanner,
  type HubPlannerServerCatalog,
  type HubSynthesizer,
} from "../src/hub/missions/index.js";
import type { HubMcpServerCatalog } from "../src/hub/tools/index.js";
import { buildHubUsageAggregates } from "../src/hub/usage.js";

// ── Harness ─────────────────────────────────────────────────────────────────────────────────────

const databases: AppDatabase[] = [];
const harnesses: FastifyInstance[] = [];
afterEach(async () => {
  for (const app of harnesses.splice(0)) await app.close();
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

function collectSink(): { sink: HubTurnSink; events: HubEvent[] } {
  const events: HubEvent[] = [];
  return {
    sink: { onEvent: (e) => events.push(e), onDelta: () => {} },
    events,
  };
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

/** A planner stub returning a fixed plan (the same shape a real `generateObject` would). */
function plannerReturning(plan: HubMissionPlan): HubPlanner {
  return async () => plan;
}

/** An agent-runner stub returning a fixed report per agent key, capturing every input for isolation
 *  assertions + a concurrency tracker. */
function agentRunnerReturning(
  reports: Record<string, HubAgentReport>,
  opts: {
    inputs?: HubAgentRunInput[];
    costUsd?: number;
    delayMs?: number;
    concurrency?: { current: number; max: number };
  } = {},
): HubAgentRunner {
  return async (input) => {
    opts.inputs?.push(input);
    if (opts.concurrency) {
      opts.concurrency.current += 1;
      opts.concurrency.max = Math.max(opts.concurrency.max, opts.concurrency.current);
    }
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
    if (opts.concurrency) opts.concurrency.current -= 1;
    if (input.abortSignal.aborted) {
      return { report: undefined, costUsd: 0, tokensIn: 0, tokensOut: 0, aborted: true };
    }
    return {
      report: reports[input.key] ?? report(),
      costUsd: opts.costUsd ?? 0.1,
      tokensIn: 100,
      tokensOut: 50,
    };
  };
}

/** A synthesizer stub returning a fixed answer citing `[1][2]` (verifies citation resolution). */
const synthesizerCiting: HubSynthesizer = async () => ({
  text: "Combining the agents: point one [1] and point two [2].",
  usage: { tokensIn: 30, tokensOut: 20 },
  costUsd: 0.05,
});

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
    synthesizer: over.synthesizer ?? synthesizerCiting,
    config: { ...DEFAULT_CONFIG, ...over.config },
    now: () => "2026-07-17T00:00:00.000Z",
  });
}

function missionSession(repo: HubRepository, autonomy: "always_ask" | "threshold" | "auto") {
  return repo.createSession({ mode: "mission", model: "gpt-4o", autonomy });
}

function agentReportEvents(events: HubEvent[]) {
  return events.filter((e): e is Extract<HubEvent, { type: "agent_report" }> => e.type === "agent_report");
}
function synthEvent(events: HubEvent[]) {
  return events.find((e): e is Extract<HubEvent, { type: "mission_synthesis" }> => e.type === "mission_synthesis");
}

// ── (1) planner → a valid, clamped plan_proposed; always_ask WAITS ─────────────────────────────────

test("propose emits a valid structured plan_proposed and (always_ask) waits for approval", async () => {
  const repo = openRepo();
  const session = missionSession(repo, "always_ask");
  const { sink, events } = collectSink();
  const plan: HubMissionPlan = {
    topology: "parallel",
    autonomy: "auto", // the planner's suggestion — overridden by the session dial on clamp
    agents: [plannedAgent({ key: "a" }), plannedAgent({ key: "b" })],
    rationale: "Two disjoint subtopics.",
  };
  const service = makeService({ repository: repo, planner: plannerReturning(plan), runAgent: agentRunnerReturning({}) });

  const mission = await service.proposePlan({ sessionId: session.id, text: "Research X and Y", sink });

  const proposed = events.find(
    (e): e is Extract<HubEvent, { type: "plan_proposed" }> => e.type === "plan_proposed",
  );
  assert.ok(proposed, "a plan_proposed event was emitted");
  assert.doesNotThrow(() => hubMissionPlanSchema.parse(proposed.plan), "the proposed plan is wire-valid");
  assert.equal(proposed.plan.autonomy, "always_ask", "autonomy is pinned to the session dial, not the planner");
  assert.equal(mission.status, "proposed", "always_ask leaves the mission proposed (no auto-run)");
  // No launch happened.
  assert.equal(events.some((e) => e.type === "mission_started"), false);
  assert.equal(agentReportEvents(events).length, 0);
  // The planning turn is settled so the composer frees.
  assert.ok(events.some((e) => e.type === "turn_done"));
  // R-SES5 — proposing a mission auto-titles the (untitled) session from the ask.
  const titled = repo.getSession(session.id);
  assert.equal(titled.titleState, "auto");
  assert.equal(titled.title, "Research X and Y");
});

// ── (2) editable plan + explicit approval runs it ─────────────────────────────────────────────────

test("a proposed plan is editable (plan_updated) then approvable, and running it reports + synthesizes", async () => {
  const repo = openRepo();
  const session = missionSession(repo, "always_ask");
  const { sink, events } = collectSink();
  const plan: HubMissionPlan = {
    topology: "parallel",
    autonomy: "always_ask",
    agents: [plannedAgent({ key: "a" }), plannedAgent({ key: "b" })],
  };
  const service = makeService({
    repository: repo,
    planner: plannerReturning(plan),
    runAgent: agentRunnerReturning({ a: report({ summary: "A done" }), b: report({ summary: "B done" }) }),
  });

  const mission = await service.proposePlan({ sessionId: session.id, text: "task", sink });

  // Edit: drop agent b.
  const edited: HubMissionPlan = { ...plan, agents: [plannedAgent({ key: "a" })] };
  const updated = service.editPlan({ missionId: mission.id, plan: edited, sink });
  assert.equal(updated.plan.agents.length, 1, "the edited plan has one agent");
  assert.ok(
    events.some((e) => e.type === "plan_updated"),
    "a plan_updated event was emitted",
  );

  // Approve + run.
  const done = await service.approve({ missionId: mission.id, sink });
  assert.equal(done.status, "completed");
  assert.ok(events.some((e) => e.type === "plan_approved"));
  assert.ok(events.some((e) => e.type === "mission_started"));
  assert.equal(agentReportEvents(events).length, 1, "the single remaining agent reported");
  assert.equal(synthEvent(events)?.partial, false, "a full mission synthesizes non-partial");
});

// ── assistant-hub v1-fixes F1/F2/F7 (roadmap/assistant-hub/mission-session-analysis-2026-07-20.md) ──
test("v1-fixes F1/F2/F7: a completed mission synthesizes on a NON-facade model and persists mission_digest + mission_followups", async () => {
  const repo = openRepo();
  const session = missionSession(repo, "always_ask"); // session model: gpt-4o (structured-capable)
  const { sink, events } = collectSink();
  const plan: HubMissionPlan = {
    topology: "parallel",
    autonomy: "always_ask",
    // Every AGENT runs on a facade model — the pre-fix synthesis pick (`agents[0].model`) would have
    // run the synthesis blind on it (the observed production failure).
    agents: [
      plannedAgent({ key: "a", model: "assistant|tenant|analytics" }),
      plannedAgent({ key: "b", model: "assistant|tenant|analytics" }),
    ],
  };
  const synthesizerModels: string[] = [];
  const synthesizer: HubSynthesizer = async (input) => {
    synthesizerModels.push(input.model);
    return { text: "Combined answer.", usage: { tokensIn: 10, tokensOut: 5 }, costUsd: 0.01 };
  };
  const service = makeService({
    repository: repo,
    planner: plannerReturning(plan),
    runAgent: agentRunnerReturning({
      a: report({
        summary: "A done",
        roleName: "analyst-a",
        openQuestions: ["How is FC Attainment defined?", "Shared question?"],
      }),
      b: report({
        summary: "B done",
        roleName: "analyst-b",
        openQuestions: ["shared question?", "Are prior-year actuals available?"],
      }),
    }),
    synthesizer,
  });
  const mission = await service.proposePlan({ sessionId: session.id, text: "task", sink });
  const done = await service.approve({ missionId: mission.id, sink });
  assert.equal(done.status, "completed");

  // F1 — the synthesis ran on the PARENT session's model, never the facade agents' model.
  assert.deepEqual(synthesizerModels, ["gpt-4o"], "synthesis model is the structured session model");

  // F2 — the mission_digest event exists and carries every agent's findings + open questions.
  const digest = events.find(
    (e): e is Extract<HubEvent, { type: "mission_digest" }> => e.type === "mission_digest",
  );
  assert.ok(digest, "a mission_digest event was emitted");
  assert.match(digest.text, /Mission results digest \(2 agent reports\)/);
  assert.match(digest.text, /How is FC Attainment defined\?/);
  // roleName is stamped authoritatively from the planned agent label (`stampReport`), not the runner stub.
  assert.match(digest.text, /### b — confidence medium/);
  assert.deepEqual(digest.agentReportRefs?.length, 2, "digest refs both agent sessions");

  // F2 — reconstruction folds the digest into later model context as an assistant turn, and labels
  // the synthesis message as a mission synthesis.
  const messages = reconstructMessages(repo.listEvents(session.id));
  const texts = messages
    .filter((m) => m.role === "assistant")
    .map((m) => (typeof m.content === "string" ? m.content : ""));
  assert.ok(
    texts.some((t) => t.includes("Mission results digest")),
    "the digest is model-visible in reconstructed history",
  );
  assert.ok(
    texts.some((t) => t.startsWith("[Mission synthesis — composed from 2 agent reports]")),
    "the synthesis message is labeled in reconstructed history",
  );

  // F7 — followups dedupe case-insensitively, keep attribution, and cover both agents.
  const followups = events.find(
    (e): e is Extract<HubEvent, { type: "mission_followups" }> => e.type === "mission_followups",
  );
  assert.ok(followups, "a mission_followups event was emitted");
  assert.equal(followups.followups.length, 3, "4 raw questions dedupe to 3");
  assert.equal(followups.followups[0]?.roleName, "a");
  assert.ok(followups.followups.every((f) => f.question.trim().length > 0));
});

test("editPlan is refused once the mission is approved (the plan is frozen)", async () => {
  const repo = openRepo();
  const session = missionSession(repo, "auto");
  const { sink } = collectSink();
  const plan: HubMissionPlan = {
    topology: "parallel",
    autonomy: "auto",
    agents: [plannedAgent({ key: "a" })],
  };
  const service = makeService({ repository: repo, planner: plannerReturning(plan), runAgent: agentRunnerReturning({}) });
  const mission = await service.proposePlan({ sessionId: session.id, text: "task", sink }); // auto → runs + completes
  assert.throws(
    () => service.editPlan({ missionId: mission.id, plan, sink }),
    /frozen/,
    "a completed mission's plan cannot be edited",
  );
});

// ── (3) approve → parallel child sessions, caps honored, ISOLATED briefs ───────────────────────────

test("caps: excess planned agents are dropped to maxAgents at propose time", async () => {
  const repo = openRepo();
  const session = missionSession(repo, "always_ask");
  const { sink } = collectSink();
  const plan: HubMissionPlan = {
    topology: "parallel",
    autonomy: "always_ask",
    agents: Array.from({ length: 5 }, (_, i) => plannedAgent({ key: `a${i}` })),
  };
  const service = makeService({
    repository: repo,
    planner: plannerReturning(plan),
    runAgent: agentRunnerReturning({}),
    config: { maxAgents: 3 },
  });
  const mission = await service.proposePlan({ sessionId: session.id, text: "task", sink });
  assert.equal(mission.plan.agents.length, 3, "the 5-agent plan is clamped to the maxAgents cap of 3");
});

test("maxParallel bounds concurrency; every agent runs as a child session with parent+mission linkage", async () => {
  const repo = openRepo();
  const session = missionSession(repo, "auto");
  const { sink, events } = collectSink();
  const plan: HubMissionPlan = {
    topology: "parallel",
    autonomy: "auto",
    agents: Array.from({ length: 4 }, (_, i) => plannedAgent({ key: `a${i}` })),
  };
  const concurrency = { current: 0, max: 0 };
  const service = makeService({
    repository: repo,
    planner: plannerReturning(plan),
    runAgent: agentRunnerReturning({}, { delayMs: 8, concurrency }),
    config: { maxParallel: 2 },
  });

  const mission = await service.proposePlan({ sessionId: session.id, text: "task", sink });

  assert.equal(concurrency.max, 2, "no more than maxParallel agents run at once");
  assert.equal(agentReportEvents(events).length, 4, "all four agents reported");
  const children = repo.listMissionAgentSessions(mission.id);
  assert.equal(children.length, 4, "four child agent sessions exist");
  for (const child of children) {
    assert.equal(child.kind, "agent");
    assert.equal(child.parentSessionId, session.id, "child parented to the mission session");
    assert.equal(child.missionId, mission.id, "child linked to the mission");
  }
});

test("ISOLATION: an agent's input never contains the parent transcript (D-AH9)", async () => {
  const repo = openRepo();
  const session = missionSession(repo, "auto");
  const { sink } = collectSink();
  const MARKER = "PARENT_SECRET_TRANSCRIPT_MARKER_9x7";
  // Seed a prior parent turn carrying the marker, then a mission ask that ALSO carries it.
  repo.appendEvent(session.id, { type: "user_message", messageId: "p0", text: `Earlier private note: ${MARKER}` });
  repo.appendEvent(session.id, {
    type: "assistant_message",
    messageId: "p1",
    model: "gpt-4o",
    parts: [{ type: "text", text: `Ack ${MARKER}` }],
    citations: [],
    artifactsTouched: [],
  });

  const plan: HubMissionPlan = {
    topology: "parallel",
    autonomy: "auto",
    // Briefs are the planner's CURATED output — they must not echo the parent transcript.
    agents: [plannedAgent({ key: "researcher", brief: "Investigate the public facts about topic X." })],
  };
  const inputs: HubAgentRunInput[] = [];
  const service = makeService({
    repository: repo,
    planner: plannerReturning(plan),
    runAgent: agentRunnerReturning({}, { inputs }),
  });

  const mission = await service.proposePlan({ sessionId: session.id, text: `Do the mission. ${MARKER}`, sink });

  assert.equal(inputs.length, 1, "the agent ran");
  const agentInput = inputs[0]!;
  assert.equal(agentInput.systemPrompt.includes(MARKER), false, "the role prompt carries no parent transcript");
  assert.equal(agentInput.brief.includes(MARKER), false, "the brief carries no parent transcript");

  // The child session's ONLY user turn is the curated brief — never the parent conversation.
  const child = repo.listMissionAgentSessions(mission.id)[0]!;
  const childUserTurns = repo
    .listEvents(child.id)
    .filter((e): e is Extract<HubEvent, { type: "user_message" }> => e.type === "user_message");
  assert.equal(childUserTurns.length, 1, "the child agent has exactly one input (its brief)");
  assert.equal(childUserTurns[0]!.text, "Investigate the public facts about topic X.");
  assert.equal(childUserTurns[0]!.text.includes(MARKER), false);
});

// ── WP2.3 (D-HF5) — grant inheritance at spawn: effective child grants = plan grants ∩ parent scope ────

function scopedMissionSession(
  repo: HubRepository,
  autonomy: "always_ask" | "threshold" | "auto",
  toolScope: HubToolGrants,
) {
  return repo.createSession({ mode: "mission", model: "gpt-4o", autonomy, toolScope });
}

test("spawn: a scoped parent narrows a planned agent's grants to the intersection (D-HF5)", async () => {
  const repo = openRepo();
  const session = scopedMissionSession(repo, "auto", {
    servers: { qlik: ["search", "list_apps"] },
    builtins: ["memory.save"],
  });
  const { sink, events } = collectSink();
  const plan: HubMissionPlan = {
    topology: "parallel",
    autonomy: "auto",
    agents: [
      plannedAgent({
        key: "a",
        toolGrants: {
          // "all" on qlik is bounded DOWN to the parent's own list; "files" is outside the parent's
          // scope entirely; "artifacts.create" is a built-in outside the parent's scope.
          servers: { qlik: "all", files: ["read_file"] },
          builtins: ["memory.save", "artifacts.create"],
        },
      }),
    ],
  };
  const inputs: HubAgentRunInput[] = [];
  const service = makeService({
    repository: repo,
    planner: plannerReturning(plan),
    runAgent: agentRunnerReturning({}, { inputs }),
  });

  const mission = await service.proposePlan({ sessionId: session.id, text: "task", sink });
  assert.equal(mission.status, "completed");

  const child = repo.listMissionAgentSessions(mission.id)[0]!;
  assert.deepEqual(
    child.toolScope,
    { servers: { qlik: ["search", "list_apps"] }, builtins: ["memory.save"] },
    "the child's persisted scope is plan grants ∩ parent scope, not the raw plan grants WP2.1 passed through",
  );

  // The role prompt tells the agent about its EFFECTIVE access, never the raw crew-role promise.
  assert.equal(inputs.length, 1, "the agent ran");
  assert.match(inputs[0]!.roleTemplate!.agentToolSignatures, /qlik: search, list_apps/);
  assert.equal(
    inputs[0]!.roleTemplate!.agentToolSignatures.includes("files"),
    false,
    "the agent is never told about a server the intersection dropped",
  );

  // The board's agent_spawned event carries a plan-visible note explaining the narrowing (additive reuse
  // of the EXISTING `brief` free-text field — no new event type).
  const spawned = events.find((e): e is Extract<HubEvent, { type: "agent_spawned" }> => e.type === "agent_spawned");
  assert.ok(spawned, "an agent_spawned event was emitted");
  assert.match(spawned!.brief ?? "", /reduced by the session's own tool scope/);
  assert.match(spawned!.brief ?? "", /removed access to files/);
  assert.match(spawned!.brief ?? "", /narrowed the tools granted on qlik/);
  assert.match(spawned!.brief ?? "", /removed built-ins artifacts\.create/);
});

test("negative: a plan grant to a server OUTSIDE the parent's scope can never be resolved by the child (D-HF5)", async () => {
  const repo = openRepo();
  // The parent session is scoped to ONE server only.
  const session = scopedMissionSession(repo, "auto", { servers: { "qlik-mreimitz": "all" }, builtins: [] });
  const { sink } = collectSink();
  // A crew role's own Access tab grants a DIFFERENT server, entirely outside the parent's scope.
  const plan: HubMissionPlan = {
    topology: "parallel",
    autonomy: "auto",
    agents: [plannedAgent({ key: "a", toolGrants: { servers: { "other-server": "all" }, builtins: [] } })],
  };
  const service = makeService({
    repository: repo,
    planner: plannerReturning(plan),
    runAgent: agentRunnerReturning({}),
  });

  const mission = await service.proposePlan({ sessionId: session.id, text: "task", sink });
  assert.equal(mission.status, "completed");

  const child = repo.listMissionAgentSessions(mission.id)[0]!;
  // "other-server" is ABSENT from the child's persisted scope — not an empty allowlist, genuinely absent.
  // Every scope-honoring grants provider (WP1.2's production `resolveHubMcpGrants`, and this test suite's
  // own `scopeHonoringGrants` in `hub-agent-runner.test.ts`) reads `scope.servers[id]`; an absent key is
  // `undefined`, which is uniformly treated as "never expose this server" — so the child can NEVER
  // resolve/call it this mission, regardless of what the crew role's own Access tab promised.
  assert.deepEqual(child.toolScope?.servers, {}, "the out-of-scope server grant was dropped entirely at spawn");
  assert.equal("other-server" in (child.toolScope?.servers ?? {}), false);
});

test("spawn: a null (auto/unscoped) parent passes plan grants through unchanged — no narrowing, no note (D-HF5)", async () => {
  const repo = openRepo();
  const session = missionSession(repo, "auto"); // no toolScope ⇒ null parent
  const { sink, events } = collectSink();
  const plan: HubMissionPlan = {
    topology: "parallel",
    autonomy: "auto",
    agents: [plannedAgent({ key: "a", toolGrants: { servers: { anything: "all" }, builtins: ["memory.save"] } })],
  };
  const service = makeService({ repository: repo, planner: plannerReturning(plan), runAgent: agentRunnerReturning({}) });

  const mission = await service.proposePlan({ sessionId: session.id, text: "task", sink });
  const child = repo.listMissionAgentSessions(mission.id)[0]!;
  assert.deepEqual(child.toolScope, { servers: { anything: "all" }, builtins: ["memory.save"] });

  const spawned = events.find((e): e is Extract<HubEvent, { type: "agent_spawned" }> => e.type === "agent_spawned");
  assert.equal(spawned!.brief, plannedAgent({ key: "a" }).brief, "no narrowing note appended — nothing was narrowed");
});

// ── (4)+(5) structured reports + (6) synthesis preserves citations (every [n] resolves) ────────────

test("synthesis cites the agent reports with their citations preserved + re-numbered (every [n] resolves)", async () => {
  const repo = openRepo();
  const session = missionSession(repo, "auto");
  const { sink, events } = collectSink();
  const plan: HubMissionPlan = {
    topology: "parallel",
    autonomy: "auto",
    agents: [plannedAgent({ key: "a" }), plannedAgent({ key: "b" })],
  };
  // Two agents that BOTH number their (different) source `[1]` locally — the merge must give them
  // distinct global numbers and keep each source's provenance.
  const reports: Record<string, HubAgentReport> = {
    a: report({
      summary: "A summary",
      citations: [{ id: "1", title: "Source A", url: "https://a.example/doc" }],
      findings: [{ summary: "Fact A [1]", citationIds: ["1"] }],
    }),
    b: report({
      summary: "B summary",
      citations: [{ id: "1", title: "Source B", url: "https://b.example/doc" }],
      findings: [{ summary: "Fact B [1]", citationIds: ["1"] }],
    }),
  };
  const service = makeService({
    repository: repo,
    planner: plannerReturning(plan),
    runAgent: agentRunnerReturning(reports),
  });

  const mission = await service.proposePlan({ sessionId: session.id, text: "task", sink });

  // Each agent's report is present + carries its agentRef (provenance).
  const reportEvents = agentReportEvents(events);
  assert.equal(reportEvents.length, 2);
  const children = repo.listMissionAgentSessions(mission.id);
  for (const rep of reportEvents) {
    assert.ok(rep.report.citations.every((c) => !!c.agentRef), "every report citation carries an agentRef");
    assert.ok(children.some((c) => c.id === rep.report.agentSessionId));
  }

  // The synthesis message: full merged citation set, both distinct, agentRef preserved.
  const synthMessageId = synthEvent(events)?.messageId;
  const assistant = events.find(
    (e): e is Extract<HubEvent, { type: "assistant_message" }> =>
      e.type === "assistant_message" && e.messageId === synthMessageId,
  );
  assert.ok(assistant, "a synthesis assistant_message was persisted");
  assert.equal(assistant.citations.length, 2, "both sources survive into the synthesis");
  const byTitle = new Map(assistant.citations.map((c) => [c.title, c]));
  assert.ok(byTitle.get("Source A")?.agentRef, "Source A keeps its agent provenance");
  assert.ok(byTitle.get("Source B")?.agentRef, "Source B keeps its agent provenance");
  assert.notEqual(
    byTitle.get("Source A")?.agentRef,
    byTitle.get("Source B")?.agentRef,
    "the two sources trace back to DIFFERENT agents",
  );

  // The resolve invariant (§1.7): every [n] the synthesis rendered maps to a real citation id.
  const text = assistant.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
  const markers = findCitationMarkers(text);
  const ids = new Set(assistant.citations.map((c) => Number(c.id)));
  assert.ok(markers.length >= 2, "the synthesis cited at least two sources");
  for (const n of markers) assert.ok(ids.has(n), `rendered marker [${n}] resolves to a real source`);
});

// ── (7) budget trip → clean stop + partial synthesis, honestly marked ──────────────────────────────

test("a tripped total-cost budget stops launching cleanly and synthesizes PARTIALLY", async () => {
  const repo = openRepo();
  const session = missionSession(repo, "auto");
  const { sink, events } = collectSink();
  const plan: HubMissionPlan = {
    topology: "parallel",
    autonomy: "auto",
    agents: [plannedAgent({ key: "a" }), plannedAgent({ key: "b" }), plannedAgent({ key: "c" })],
  };
  const service = makeService({
    repository: repo,
    planner: plannerReturning(plan),
    // Each agent costs $1; sequential (maxParallel 1) so the trip is deterministic. Cap $0.50 → the
    // FIRST agent's cost trips it, agents b + c never launch.
    runAgent: agentRunnerReturning({}, { costUsd: 1 }),
    config: { maxParallel: 1, defaultBudgetUsd: 0.5 },
  });

  const mission = await service.proposePlan({ sessionId: session.id, text: "task", sink });

  assert.equal(agentReportEvents(events).length, 1, "only the first agent produced a report (budget tripped)");
  const synth = synthEvent(events);
  assert.ok(synth, "the mission still synthesized");
  assert.equal(synth.partial, true, "the synthesis is honestly marked PARTIAL");
  assert.equal(mission.status, "completed", "a budget-tripped mission completes (partial), it does not fail");

  // The skipped agents' child sessions settled honestly (aborted, no report).
  const children = repo.listMissionAgentSessions(mission.id);
  const aborted = children.filter((c) => c.status === "aborted");
  assert.equal(aborted.length, 2, "the two un-launched agents are settled aborted");

  // The partial marker is visible in the synthesis text (R-UX9).
  const assistant = events.find(
    (e): e is Extract<HubEvent, { type: "assistant_message" }> =>
      e.type === "assistant_message" && e.messageId === synth.messageId,
  );
  assert.ok(assistant?.parts.some((p) => p.type === "text" && /PARTIAL/i.test(p.text)));
});

// ── (7b) hub-fixes WP2.4 — cost/budget integrity ────────────────────────────────────────────────────

test("WP2.4: real per-agent cost/tokens land on the agent_report event and the mission rollup (structured runner)", async () => {
  const repo = openRepo();
  const session = missionSession(repo, "auto");
  const { sink, events } = collectSink();
  const plan: HubMissionPlan = {
    topology: "parallel",
    autonomy: "auto",
    agents: [plannedAgent({ key: "a" }), plannedAgent({ key: "b" })],
  };
  const service = makeService({
    repository: repo,
    planner: plannerReturning(plan),
    runAgent: agentRunnerReturning(
      { a: report({ summary: "A" }), b: report({ summary: "B" }) },
      { costUsd: 0.4 },
    ),
  });

  const mission = await service.proposePlan({ sessionId: session.id, text: "task", sink });
  assert.equal(mission.status, "completed");

  // Every `agent_report` board event carries the agent's real cost/tokens (no more silent 0 — the
  // pre-fix bug analysis.md RC2 names). The board (`MissionBoard.tsx`) reads these directly.
  const reports = agentReportEvents(events);
  assert.equal(reports.length, 2);
  for (const e of reports) {
    assert.equal(e.costUsd, 0.4, "the report event carries the agent's real cost");
    assert.equal(e.tokensIn, 100, "the report event carries the agent's real input tokens");
    assert.equal(e.tokensOut, 50, "the report event carries the agent's real output tokens");
  }

  // The mission's own rollup (existing `updateMission` aggregation) sums the real per-agent costs plus
  // the synthesis cost (0.4 + 0.4 + the stub synthesizer's 0.05) — never the old inert 0.
  const persisted = repo.getMission(mission.id);
  assert.ok(persisted.costUsd !== undefined, "the mission carries a rolled-up cost");
  assert.ok(
    Math.abs((persisted.costUsd ?? 0) - 0.85) < 1e-9,
    `mission.costUsd should sum the real agent + synthesis costs (got ${persisted.costUsd})`,
  );
});

test("WP2.4: a session-mode agent's child row + the parent usage rollup reflect the runner's REAL total", async () => {
  const repo = openRepo();
  const session = missionSession(repo, "auto");
  const { sink } = collectSink();
  const plan: HubMissionPlan = {
    topology: "parallel",
    autonomy: "auto",
    agents: [plannedAgent({ key: "a" }), plannedAgent({ key: "b" })],
  };
  const service = makeService({
    repository: repo,
    planner: plannerReturning(plan),
    // agentRunnerMode "session" — the path a REAL turn-engine-backed runner takes (WP2.1). Here a plain
    // stub stands in for `createSessionAgentRunner`; the orchestrator's own job (WP2.4) is to true the
    // child session ROW up to whatever total the runner reports, since the turn engine alone only ever
    // sees the turn's own slice (never a report-extraction call's cost on top of it).
    runAgent: agentRunnerReturning(
      { a: report({ summary: "A" }), b: report({ summary: "B" }) },
      { costUsd: 0.4 },
    ),
    config: { agentRunnerMode: "session" },
  });

  const mission = await service.proposePlan({ sessionId: session.id, text: "task", sink });
  assert.equal(mission.status, "completed");

  // Every mission-agent child SESSION row (not just the event) carries the runner's real total.
  const children = repo.listMissionAgentSessions(mission.id);
  assert.equal(children.length, 2);
  for (const child of children) {
    assert.equal(child.costUsd, 0.4, "the child session row carries the agent's real cost");
    assert.equal(child.tokensIn, 100, "the child session row carries the agent's real input tokens");
    assert.equal(child.tokensOut, 50, "the child session row carries the agent's real output tokens");
  }

  // The parent's usage aggregates (`hub/usage.ts`) sum every session's `costUsd`, and a mission-agent
  // child is a session like any other — so the mission's real spend surfaces there too, unmodified.
  const usage = buildHubUsageAggregates(repo, {}, () => undefined);
  assert.ok(
    usage.totals.costUsd >= 0.8 - 1e-9,
    `usage totals should include both children's real cost (got ${usage.totals.costUsd})`,
  );
  assert.ok(
    usage.totals.tokensIn >= 200,
    `usage totals should include both children's real tokensIn (got ${usage.totals.tokensIn})`,
  );
});

test("WP2.4: the planner's cost estimate is never 0 for a non-empty plan, even when no agent names one", () => {
  const plan: HubMissionPlan = {
    topology: "parallel",
    autonomy: "auto",
    // Neither the plan nor any agent carries an `estimatedCostUsd` — the pre-fix bug (analysis.md:
    // "mission costUsd / plan estimatedCostUsd 0 / 0") would leave this at 0.
    agents: [plannedAgent({ key: "a", model: "gpt-4o" }), plannedAgent({ key: "b", model: "gpt-4o" })],
  };
  const est = estimatePlanCostUsd(plan);
  assert.ok(est > 0, `a non-empty plan on a priced model must estimate > 0 (got ${est})`);

  // Per-agent, same guarantee — and it's a real heuristic (agents × envelope × the model's own rate),
  // not a fixed constant: a pricier model estimates higher than a cheaper one for the SAME envelope.
  const cheap = estimateAgentCostUsd({ model: "gpt-4o-mini" });
  const pricey = estimateAgentCostUsd({ model: "claude-opus-4-1" });
  assert.ok(cheap > 0 && pricey > 0, "both models yield a positive estimate");
  assert.ok(pricey > cheap, "a pricier model's heuristic estimate is higher for the same token envelope");

  // An explicit positive per-agent estimate is trusted as-is (the planner model's own figure wins).
  assert.equal(estimateAgentCostUsd({ model: "gpt-4o", estimatedCostUsd: 0.33 }), 0.33);

  // `clampPlanToBudgets` stamps this same non-zero estimate onto the plan it returns (the value the
  // plan card renders, prefixed "≈" — already labeled an estimate there).
  const clamped = clampPlanToBudgets(
    plan,
    { maxAgents: 6, maxParallel: 3, defaultBudgetUsd: 2, maxBudgetUsd: 10, askAboveAgents: 3, askAboveUsd: 1 },
    "auto",
  );
  assert.ok((clamped.estimatedCostUsd ?? 0) > 0, "clampPlanToBudgets stamps a non-zero estimate");
});

// ── (8) replay renders the whole mission INERT from hub_events alone ────────────────────────────────

test("the whole mission replays INERT from hub_events alone (reconstructMission)", async () => {
  const repo = openRepo();
  const session = missionSession(repo, "auto");
  const { sink } = collectSink();
  const plan: HubMissionPlan = {
    topology: "parallel",
    autonomy: "auto",
    agents: [plannedAgent({ key: "a" }), plannedAgent({ key: "b" })],
    rationale: "Two subtopics.",
  };
  const service = makeService({
    repository: repo,
    planner: plannerReturning(plan),
    runAgent: agentRunnerReturning({
      a: report({ summary: "A", confidence: "high", openQuestions: ["What about Z?"] }),
      b: report({ summary: "B", confidence: "low" }),
    }),
  });
  const mission = await service.proposePlan({ sessionId: session.id, text: "task", sink });

  // Reconstruct PURELY from the persisted parent log — no service, no DB writes.
  const beforeCount = repo.listEvents(session.id).length;
  const board = reconstructMission(repo.listEvents(session.id));
  const board2 = reconstructMission(repo.listEvents(session.id));
  const afterCount = repo.listEvents(session.id).length;

  assert.ok(board, "the mission reconstructs from events alone");
  assert.equal(afterCount, beforeCount, "reconstruction is side-effect-free (inert)");
  assert.deepEqual(board, board2, "reconstruction is deterministic");
  assert.equal(board.missionId, mission.id);
  assert.equal(board.phase, "done");
  assert.equal(board.approved, true);
  assert.equal(board.autoApproved, true);
  assert.equal(board.agents.length, 2, "both agents are on the reconstructed board");
  assert.ok(board.agents.every((a) => a.reported && a.report), "every agent's report is reconstructed");
  const a = board.agents.find((ag) => ag.key === "a");
  assert.equal(a?.report?.confidence, "high");
  assert.deepEqual(a?.report?.openQuestions, ["What about Z?"], "open questions survive replay (R-UX9)");
  assert.equal(board.synthesis?.partial, false);
  assert.deepEqual(board.plan.agents.map((ag) => ag.key), ["a", "b"]);
});

// ── Stop: the mission stop synthesizes partially ───────────────────────────────────────────────────

test("stopping a proposed mission cancels it to stopped", async () => {
  const repo = openRepo();
  const session = missionSession(repo, "always_ask");
  const { sink } = collectSink();
  const plan: HubMissionPlan = { topology: "parallel", autonomy: "always_ask", agents: [plannedAgent({ key: "a" })] };
  const service = makeService({ repository: repo, planner: plannerReturning(plan), runAgent: agentRunnerReturning({}) });
  const mission = await service.proposePlan({ sessionId: session.id, text: "task", sink });
  service.stop(mission.id);
  assert.equal(repo.getMission(mission.id).status, "stopped");
});

// ── Autonomy dial (threshold) ──────────────────────────────────────────────────────────────────────

test("threshold autonomy auto-runs a small/cheap plan but waits for a large one", async () => {
  const repo = openRepo();
  const { sink } = collectSink();
  const small: HubMissionPlan = {
    topology: "parallel",
    autonomy: "threshold",
    agents: [plannedAgent({ key: "a", estimatedCostUsd: 0.2 })],
  };
  const big: HubMissionPlan = {
    topology: "parallel",
    autonomy: "threshold",
    agents: Array.from({ length: 5 }, (_, i) => plannedAgent({ key: `a${i}`, estimatedCostUsd: 0.5 })),
  };

  const s1 = missionSession(repo, "threshold");
  const svc1 = makeService({ repository: repo, planner: plannerReturning(small), runAgent: agentRunnerReturning({}) });
  const m1 = await svc1.proposePlan({ sessionId: s1.id, text: "task", sink });
  assert.equal(m1.status, "completed", "a 1-agent, $0.20 plan auto-runs under the threshold");

  const s2 = missionSession(repo, "threshold");
  const svc2 = makeService({
    repository: repo,
    planner: plannerReturning(big),
    runAgent: agentRunnerReturning({}),
    config: { maxAgents: 6 },
  });
  const m2 = await svc2.proposePlan({ sessionId: s2.id, text: "task", sink });
  assert.equal(m2.status, "proposed", "a 5-agent / $2.50 plan exceeds the threshold and waits for approval");
});

// ── Unit: clampPlanToBudgets / shouldAutoApprove / mergeAgentCitations ─────────────────────────────

test("clampPlanToBudgets caps agents, PRESERVES topology, pins autonomy, de-dupes keys, fills budgets", () => {
  const raw: HubMissionPlan = {
    topology: "debate", // WP2.2 — a real topology is PRESERVED (all four executors now exist)
    autonomy: "auto",
    agents: [
      plannedAgent({ key: "dup" }),
      plannedAgent({ key: "dup" }),
      plannedAgent({ key: "x" }),
      plannedAgent({ key: "y" }),
    ],
    budgets: { maxAgents: 99, maxParallel: 99, maxCostUsd: 5 },
  };
  const clamped = clampPlanToBudgets(
    raw,
    { maxAgents: 2, maxParallel: 2, defaultBudgetUsd: 1, maxBudgetUsd: 10, askAboveAgents: 3, askAboveUsd: 1 },
    "always_ask",
  );
  assert.equal(clamped.topology, "debate", "topology is preserved (WP2.2 — no longer coerced to parallel)");
  assert.equal(clamped.autonomy, "always_ask", "autonomy is pinned to the session dial");
  assert.equal(clamped.agents.length, 2, "agents capped to maxAgents");
  assert.equal(clamped.budgets?.maxAgents, 2, "mission maxAgents clamped DOWN to the cap");
  assert.equal(clamped.budgets?.maxParallel, 2, "mission maxParallel clamped DOWN to the cap");
  assert.equal(clamped.budgets?.maxCostUsd, 5, "the plan's own cost cap is kept when UNDER the hard ceiling");
  assert.doesNotThrow(() => hubMissionPlanSchema.parse(clamped));
});

test("clampPlanToBudgets caps maxCostUsd at the ABSOLUTE ceiling regardless of what the plan/crew/edit names (D-AH9, Wave-2 review finding b)", () => {
  const raw: HubMissionPlan = {
    topology: "parallel",
    autonomy: "auto",
    agents: [plannedAgent({ key: "a" })],
    budgets: { maxCostUsd: 999 }, // an arbitrarily large mission budget
  };
  const clamped = clampPlanToBudgets(
    raw,
    { maxAgents: 6, maxParallel: 3, defaultBudgetUsd: 2, maxBudgetUsd: 10, askAboveAgents: 3, askAboveUsd: 1 },
    "always_ask",
  );
  assert.equal(clamped.budgets?.maxCostUsd, 10, "$999 is clamped DOWN to the $10 hard ceiling, never passed through");
  assert.doesNotThrow(() => hubMissionPlanSchema.parse(clamped));
});

test("clampPlanToBudgets: the DEFAULT budget (when the plan names none) is itself bounded by the hard ceiling", () => {
  const raw: HubMissionPlan = {
    topology: "parallel",
    autonomy: "auto",
    agents: [plannedAgent({ key: "a" })],
    // no budgets at all — falls back to caps.defaultBudgetUsd
  };
  const clamped = clampPlanToBudgets(
    raw,
    { maxAgents: 6, maxParallel: 3, defaultBudgetUsd: 25, maxBudgetUsd: 10, askAboveAgents: 3, askAboveUsd: 1 },
    "always_ask",
  );
  assert.equal(
    clamped.budgets?.maxCostUsd,
    10,
    "even a misconfigured default ABOVE the ceiling never survives the clamp",
  );
});

test("shouldAutoApprove honors the autonomy dial + thresholds", () => {
  const caps = { askAboveAgents: 3, askAboveUsd: 1 };
  assert.equal(shouldAutoApprove("auto", 10, 100, caps), true, "auto always launches");
  assert.equal(shouldAutoApprove("always_ask", 1, 0, caps), false, "always_ask never auto-launches");
  assert.equal(shouldAutoApprove("threshold", 3, 1, caps), true, "threshold auto-launches at the ceiling");
  assert.equal(shouldAutoApprove("threshold", 4, 0.5, caps), false, "threshold waits above the agent ceiling");
  assert.equal(shouldAutoApprove("threshold", 2, 1.5, caps), false, "threshold waits above the cost ceiling");
});

// ── WP2.2 (RC2.4) — planner server catalog + grant clamp ───────────────────────────────────────────

test("buildPlannerServerCatalog projects the reachable MCP catalog into compact, sorted entries", () => {
  const map = new Map<string, HubMcpServerCatalog>([
    ["s2", { serverName: "Zeta", tools: [{ name: "a", raw: {} }, { name: "b", raw: {} }] }],
    ["s1", { serverName: "Alpha", tools: [{ name: "search", raw: {} }] }],
  ]);
  const entries = buildPlannerServerCatalog(map);
  assert.deepEqual(
    entries.map((e) => e.id),
    ["s1", "s2"],
    "sorted by server name (Alpha before Zeta), not insertion order",
  );
  assert.equal(entries[0]?.name, "Alpha");
  assert.equal(entries[0]?.toolCount, 1);
  assert.match(entries[1]?.capability ?? "", /e\.g\. a, b/);
});

test("buildMissionPlannerPrompt injects the grantable-server catalog + a least-privilege contract (RC2.4)", () => {
  const catalog: HubPlannerServerCatalog = [
    { id: "qlik-mreimitz", name: "Qlik", toolCount: 42, capability: "e.g. search, list_apps, get_measure" },
    { id: "files", name: "Files", toolCount: 3, capability: "e.g. read_file" },
  ];
  const withCatalog = buildMissionPlannerPrompt({
    session: { title: "Q4 revenue", mode: "mission", model: "anthropic/claude-opus" },
    caps: DEFAULT_CONFIG,
    serverCatalog: catalog,
    now: "2026-07-19",
  });
  // Snapshot-style assertions on the injected section: the header, EACH grantable server id + its name +
  // tool count + capability line, and the least-privilege contract copy the WP requires.
  assert.match(withCatalog, /## Grantable MCP servers/);
  assert.match(withCatalog, /the ONLY servers you may grant to agents/);
  assert.match(withCatalog, /never invent a server id or name/);
  assert.match(withCatalog, /Grant least privilege/);
  assert.match(withCatalog, /use `"all"` only for a broad analyst role/);
  assert.match(withCatalog, /- `qlik-mreimitz` \(Qlik\) · 42 tools — e\.g\. search, list_apps, get_measure/);
  assert.match(withCatalog, /- `files` \(Files\) · 3 tools — e\.g\. read_file/);
  // Backward compatible: no catalog ⇒ the section is absent (the pre-WP2.2 planner prompt is unchanged).
  const without = buildMissionPlannerPrompt({
    session: { title: "Q4 revenue", mode: "mission", model: "anthropic/claude-opus" },
    caps: DEFAULT_CONFIG,
    now: "2026-07-19",
  });
  assert.ok(!without.includes("## Grantable MCP servers"), "no catalog section without a catalog");
});

test("clampGrantsToCatalog strips grants to unknown servers + records a LOUD, idempotent plan note (RC2.4)", () => {
  const catalog: HubPlannerServerCatalog = [{ id: "known", name: "Known", toolCount: 2, capability: "" }];
  const raw: HubMissionPlan = {
    topology: "parallel",
    autonomy: "always_ask",
    agents: [
      plannedAgent({
        key: "a",
        name: "Analyst",
        toolGrants: { servers: { known: "all", ghost: ["x"] }, builtins: [] },
      }),
    ],
    rationale: "Original planner rationale.",
  };
  const { plan, removed } = clampGrantsToCatalog(raw, catalog);
  assert.deepEqual(plan.agents[0]?.toolGrants.servers, { known: "all" }, "the unknown server is stripped");
  assert.deepEqual(removed, { a: ["ghost"] }, "the removed ids are reported per agent key");
  assert.ok(plan.rationale?.includes("Original planner rationale."), "the base rationale is preserved");
  assert.match(plan.rationale ?? "", /Analyst — removed a grant to "ghost"/);
  assert.match(plan.rationale ?? "", /not reachable from this session/);
  // Idempotent: re-clamping the already-clean plan drops the stale strip note (no accumulation).
  const again = clampGrantsToCatalog(plan, catalog).plan;
  assert.equal(again.rationale, "Original planner rationale.");
});

test("clampGrantsToCatalog notes a half-configured (placeholder) role (RC2.4)", () => {
  const raw: HubMissionPlan = {
    topology: "parallel",
    autonomy: "always_ask",
    agents: [
      plannedAgent({
        key: "a",
        name: "Halfbaked",
        systemPrompt: "You are Halfbaked. Finish configuring this agent's instructions in its profile.",
      }),
    ],
  };
  const { plan } = clampGrantsToCatalog(raw, []);
  assert.match(plan.rationale ?? "", /1 role is not fully configured \(Halfbaked\)/);
});

test("clampPlanToBudgets forwards a serverCatalog to strip unknown grants; absent ⇒ pass-through (RC2.4)", () => {
  const catalog: HubPlannerServerCatalog = [{ id: "known", name: "Known", toolCount: 0, capability: "" }];
  const raw: HubMissionPlan = {
    topology: "parallel",
    autonomy: "auto",
    agents: [plannedAgent({ key: "a", toolGrants: { servers: { known: "all", ghost: "all" }, builtins: [] } })],
  };
  const clamped = clampPlanToBudgets(raw, DEFAULT_CONFIG, "always_ask", catalog);
  assert.deepEqual(clamped.agents[0]?.toolGrants.servers, { known: "all" }, "ghost stripped when a catalog is passed");
  assert.match(clamped.rationale ?? "", /"ghost"/);
  assert.doesNotThrow(() => hubMissionPlanSchema.parse(clamped));
  const passthrough = clampPlanToBudgets(raw, DEFAULT_CONFIG, "always_ask");
  assert.deepEqual(
    passthrough.agents[0]?.toolGrants.servers,
    { known: "all", ghost: "all" },
    "no catalog ⇒ grants pass through unchanged (backward compatible)",
  );
});

// ── WP2.3 — Part B: the WP2.2 propose-path carry-forward (RC2.4) ───────────────────────────────────────
//
// WP2.2 built `buildPlannerServerCatalog`/the `serverCatalog` params on `buildMissionPlannerPrompt` and
// `clampPlanToBudgets`, and wired them at EDIT time (`missions/routes.ts`'s PATCH route, tested above).
// It explicitly left the PROPOSE path unwired ("the propose-path wiring of this catalog into the
// orchestrator is WP2.3" — see `planner.ts`'s doc comments). These tests prove `proposePlan` now builds
// the catalog from the new `mcpCatalog` dep and both (i) injects it into the planner prompt and
// (ii) hands it to the INITIAL clamp — completing WP2.2's own Acceptance-1 ("stub plan proposes
// non-empty grants for a data question").

test("Part B: proposePlan injects the reachable catalog into the planner prompt — a stub plan proposes NON-EMPTY grants for a data question, surviving the initial clamp", async () => {
  const repo = openRepo();
  const session = missionSession(repo, "always_ask");
  const { sink } = collectSink();

  const catalog = new Map<string, HubMcpServerCatalog>([
    [
      "qlik-mreimitz",
      {
        serverName: "Qlik",
        tools: [
          { name: "search", raw: {} },
          { name: "get_measure", raw: {} },
        ],
      },
    ],
  ]);

  // A stub planner that behaves like the REAL one would (rule 1 — never invent a server id): it can
  // only grant a server it was actually TOLD about in its own system prompt. Absent the WP2.2 catalog
  // section it returns EMPTY grants (the pre-WP2.3 "no MCP tools are granted" outcome, RC2.4's own
  // finding); the catalog section present ⇒ it grants the named, real server — proving the propose path
  // genuinely injects it, not just that the function CAN accept one.
  let sawCatalogSection = false;
  const planner: HubPlanner = async ({ systemPrompt }) => {
    sawCatalogSection =
      systemPrompt.includes("## Grantable MCP servers") && systemPrompt.includes("`qlik-mreimitz`");
    return {
      topology: "parallel",
      autonomy: "always_ask",
      agents: [
        plannedAgent({
          key: "analyst",
          name: "Data analyst",
          toolGrants: sawCatalogSection
            ? { servers: { "qlik-mreimitz": ["search", "get_measure"] }, builtins: [] }
            : { servers: {}, builtins: [] },
        }),
      ],
    };
  };

  const service = new HubMissionService({
    repository: repo,
    config: DEFAULT_CONFIG,
    planner,
    runAgent: agentRunnerReturning({}),
    synthesizer: synthesizerCiting,
    mcpCatalog: () => catalog,
    now: () => "2026-07-19T00:00:00.000Z",
  });

  const mission = await service.proposePlan({
    sessionId: session.id,
    text: "What are our top measures in Qlik?",
    sink,
  });

  assert.ok(
    sawCatalogSection,
    "the planner's system prompt carried the Grantable MCP servers section naming qlik-mreimitz",
  );
  assert.deepEqual(
    mission.plan.agents[0]?.toolGrants.servers,
    { "qlik-mreimitz": ["search", "get_measure"] },
    "the stub plan's non-empty, REAL grants survive the initial clampPlanToBudgets (not stripped as unknown)",
  );
});

test("Part B: absent mcpCatalog dep ⇒ propose path unchanged (pre-WP2.3 backward compatible — no catalog section)", async () => {
  const repo = openRepo();
  const session = missionSession(repo, "always_ask");
  const { sink } = collectSink();
  let sawCatalogSection = true;
  const planner: HubPlanner = async ({ systemPrompt }) => {
    sawCatalogSection = systemPrompt.includes("## Grantable MCP servers");
    return { topology: "parallel", autonomy: "always_ask", agents: [plannedAgent({ key: "a" })] };
  };
  const service = makeService({ repository: repo, planner, runAgent: agentRunnerReturning({}) });
  await service.proposePlan({ sessionId: session.id, text: "task", sink });
  assert.equal(sawCatalogSection, false, "no mcpCatalog dep ⇒ no Grantable MCP servers section injected");
});

test("Part B: the initial propose-time clamp strips a hallucinated server id using the injected catalog (not just at edit time)", async () => {
  const repo = openRepo();
  const session = missionSession(repo, "always_ask");
  const { sink } = collectSink();
  const catalog = new Map<string, HubMcpServerCatalog>([["known", { serverName: "Known", tools: [] }]]);
  const plan: HubMissionPlan = {
    topology: "parallel",
    autonomy: "always_ask",
    agents: [plannedAgent({ key: "a", toolGrants: { servers: { known: "all", ghost: "all" }, builtins: [] } })],
  };
  const service = new HubMissionService({
    repository: repo,
    config: DEFAULT_CONFIG,
    planner: plannerReturning(plan),
    runAgent: agentRunnerReturning({}),
    synthesizer: synthesizerCiting,
    mcpCatalog: () => catalog,
    now: () => "2026-07-19T00:00:00.000Z",
  });

  const mission = await service.proposePlan({ sessionId: session.id, text: "task", sink });

  assert.deepEqual(
    mission.plan.agents[0]?.toolGrants.servers,
    { known: "all" },
    "ghost (unreachable/hallucinated) stripped at PROPOSE time — WP2.2 only caught this at EDIT time",
  );
  assert.match(mission.plan.rationale ?? "", /"ghost"/, "the strip is noted loudly in the plan rationale");
});

test("routes: PATCH strips a grant to a server outside the parent catalog, with a plan note (RC2.4)", async () => {
  const repo = openRepo();
  const session = missionSession(repo, "always_ask");
  const plan: HubMissionPlan = {
    topology: "parallel",
    autonomy: "always_ask",
    agents: [plannedAgent({ key: "a", toolGrants: { servers: { known: "all" }, builtins: [] } })],
  };
  const service = makeService({
    repository: repo,
    planner: plannerReturning(plan),
    runAgent: agentRunnerReturning({}),
  });
  const catalog: HubPlannerServerCatalog = [{ id: "known", name: "Known", toolCount: 1, capability: "" }];
  const { base } = await makeMissionApp(repo, service, undefined, () => catalog);

  await postJson(base, `/api/hub/sessions/${session.id}/mission`, { text: "go" });
  await waitForMissionEvent(repo, session.id, "plan_proposed");
  const mission = repo.getMissionBySession(session.id)!;

  // Edit the plan to add a grant to a server OUTSIDE the parent catalog.
  const edited: HubMissionPlan = {
    ...plan,
    agents: [plannedAgent({ key: "a", toolGrants: { servers: { known: "all", ghost: ["y"] }, builtins: [] } })],
  };
  const res = await fetch(`${base}/api/hub/missions/${mission.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ plan: edited }),
  });
  assert.equal(res.status, 200);
  const persisted = repo.getMission(mission.id).plan;
  assert.deepEqual(
    persisted.agents[0]?.toolGrants.servers,
    { known: "all" },
    "the ghost server is stripped server-side, not persisted",
  );
  assert.match(persisted.rationale ?? "", /"ghost"/);
});

test("mergeAgentCitations re-numbers stably, de-dupes by url, preserves agentRef", () => {
  const reports: HubAgentReport[] = [
    report({ agentSessionId: "s1", citations: [{ id: "1", title: "Shared", url: "https://x/1", agentRef: "s1" }] }),
    report({
      agentSessionId: "s2",
      citations: [
        { id: "1", title: "Shared", url: "https://x/1", agentRef: "s2" }, // same URL → dedup, keeps s1
        { id: "2", title: "Unique", url: "https://x/2", agentRef: "s2" },
      ],
    }),
  ];
  const merged = mergeAgentCitations(reports);
  assert.equal(merged.citations.length, 2, "the shared URL de-dupes to one merged citation");
  assert.deepEqual(merged.citations.map((c) => c.id), ["1", "2"], "re-numbered 1..N stably");
  assert.equal(merged.citations[0]!.agentRef, "s1", "first occurrence keeps its agentRef");
  // s2's local `[1]` remaps to the shared merged `[1]`, its local `[2]` to the new `[2]`.
  assert.equal(merged.remaps.get("s2")?.get("1"), "1");
  assert.equal(merged.remaps.get("s2")?.get("2"), "2");
});

// ── Production planner factory typechecks + delegates (stubbed model) ───────────────────────────────

test("createStructuredPlanner builds a model per the planning model id", async () => {
  // A tiny fake LanguageModel isn't needed — assert the factory wires buildModel with the input model.
  const seen: string[] = [];
  const planner = createStructuredPlanner({
    buildModel: (modelId) => {
      seen.push(modelId);
      // generateObject would call this; short-circuit by throwing a recognizable marker so we don't
      // need a real provider — the point is only that buildModel receives the model id.
      throw new Error("stub-model");
    },
  });
  await assert.rejects(() => planner({ systemPrompt: "sys", userText: "hi", model: "claude-x" }), /stub-model/);
  assert.deepEqual(seen, ["claude-x"], "the planner builds the model it was asked to plan on");
});

// ── Routes smoke: propose / patch / approve / stop / agent-stop over a real Fastify app ─────────────

async function makeMissionApp(
  repo: HubRepository,
  service: HubMissionService,
  notify?: HubNotifySink,
  mcpServerCatalog?: () => HubPlannerServerCatalog | Promise<HubPlannerServerCatalog>,
  /** model-identity WP6.1 (F7/F8) — the D-MI9 pin guard the production wiring passes. Absent ⇒ the
   *  graceful-degrade path (no validation), which is what every pre-existing test exercises. */
  assertPinUsable?: (providerCredentialId: string, modelId: string) => void,
  /** mission-planner-guard (2026-07-27) — the "can this model back the planner turn?" guard the
   *  production wiring passes. Absent ⇒ graceful-degrade (no validation), the pre-existing behavior. */
  assertPlannerModelUsable?: (modelId: string, providerCredentialId?: string) => void,
): Promise<{ app: FastifyInstance; base: string }> {
  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ error: "Validation failed" });
    const typed = error as Error & { statusCode?: number };
    return reply.code(typed.statusCode ?? 500).send({ error: toErrorMessage(error) });
  });
  // A per-session in-process channel that just discards (the routes only need `sinkFor`).
  const channels = { sinkFor: (): HubTurnSink => ({ onEvent: () => {}, onDelta: () => {} }) };
  registerHubMissionRoutes(
    app,
    {
      repository: repo,
      missionService: service,
      assertConfigured: () => {},
      ...(notify ? { notify } : {}),
      ...(mcpServerCatalog ? { mcpServerCatalog: () => mcpServerCatalog() } : {}),
      ...(assertPinUsable ? { assertPinUsable } : {}),
      ...(assertPlannerModelUsable ? { assertPlannerModelUsable } : {}),
    },
    channels,
  );
  await app.listen({ port: 0, host: "127.0.0.1" });
  harnesses.push(app);
  const addr = app.server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return { app, base: `http://127.0.0.1:${port}` };
}

async function postJson(base: string, path: string, body?: unknown): Promise<Response> {
  // Only set the JSON content-type when there IS a body — Fastify 400s on an empty json body.
  return fetch(`${base}${path}`, {
    method: "POST",
    ...(body !== undefined
      ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
      : {}),
  });
}

async function waitForMissionEvent(
  repo: HubRepository,
  sessionId: string,
  type: HubEvent["type"],
  timeoutMs = 2000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (repo.listEvents(sessionId).some((e) => e.type === type)) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`timed out waiting for a ${type} event`);
}

test("routes: POST .../mission (202) proposes; PATCH edits; approve runs; stop is idempotent", async () => {
  const repo = openRepo();
  const session = missionSession(repo, "always_ask");
  const plan: HubMissionPlan = {
    topology: "parallel",
    autonomy: "always_ask",
    agents: [plannedAgent({ key: "a" }), plannedAgent({ key: "b" })],
  };
  const service = makeService({ repository: repo, planner: plannerReturning(plan), runAgent: agentRunnerReturning({}) });
  const { base } = await makeMissionApp(repo, service);

  // Propose (fire-and-forget) → 202, then plan_proposed lands.
  const proposeRes = await postJson(base, `/api/hub/sessions/${session.id}/mission`, { text: "Research it" });
  assert.equal(proposeRes.status, 202);
  await waitForMissionEvent(repo, session.id, "plan_proposed");
  const mission = repo.getMissionBySession(session.id)!;
  assert.equal(mission.status, "proposed");

  // Edit the plan (synchronous 200).
  const edited: HubMissionPlan = { ...plan, agents: [plannedAgent({ key: "a" })] };
  const patchRes = await fetch(`${base}/api/hub/missions/${mission.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ plan: edited }),
  });
  assert.equal(patchRes.status, 200);
  assert.equal(repo.getMission(mission.id).plan.agents.length, 1);

  // Approve (fire-and-forget) → 202, then the mission runs to a synthesis.
  const approveRes = await postJson(base, `/api/hub/missions/${mission.id}/approve`);
  assert.equal(approveRes.status, 202);
  await waitForMissionEvent(repo, session.id, "mission_synthesis");
  assert.equal(repo.getMission(mission.id).status, "completed");

  // A second approve is refused (already run).
  const reApprove = await postJson(base, `/api/hub/missions/${mission.id}/approve`);
  assert.equal(reApprove.status, 409);

  // Stop is idempotent (already terminal) → 202.
  const stopRes = await postJson(base, `/api/hub/missions/${mission.id}/stop`);
  assert.equal(stopRes.status, 202);
});

// ── model-identity WP6.1 (F7/F8) — the propose + edit hops carry, and validate, the pin ─────────────

/** A pin guard shaped like the production one: refuses exactly `prov-bad`, in the D-MI9 409 posture. */
function pinGuard(seen: Array<{ pin: string; model: string }>) {
  return (providerCredentialId: string, modelId: string): void => {
    seen.push({ pin: providerCredentialId, model: modelId });
    if (providerCredentialId === "prov-bad") {
      throw Object.assign(
        new Error(`The provider credential "${providerCredentialId}" pinned for model "${modelId}" no longer exists.`),
        { statusCode: 409 },
      );
    }
  };
}

test("F7: POST .../mission carries the composer's model + credential into the PLANNER turn", async () => {
  const repo = openRepo();
  const session = missionSession(repo, "always_ask");
  const plannerSaw: Array<{ model: string; pin?: string }> = [];
  const planner: HubPlanner = async ({ model, providerCredentialId }) => {
    plannerSaw.push({ model, ...(providerCredentialId ? { pin: providerCredentialId } : {}) });
    return { topology: "parallel", autonomy: "always_ask", agents: [plannedAgent({ key: "a" })] };
  };
  const service = makeService({ repository: repo, planner, runAgent: agentRunnerReturning({}) });
  const seen: Array<{ pin: string; model: string }> = [];
  const { base } = await makeMissionApp(repo, service, undefined, undefined, pinGuard(seen));

  const res = await postJson(base, `/api/hub/sessions/${session.id}/mission`, {
    text: "Research it",
    model: "claude-sonnet-5",
    providerCredentialId: "prov-cli",
  });
  assert.equal(res.status, 202, "the .strict() body accepts the two additive fields (it used to 400)");
  await waitForMissionEvent(repo, session.id, "plan_proposed");
  assert.deepEqual(
    plannerSaw,
    [{ model: "claude-sonnet-5", pin: "prov-cli" }],
    "the planner ran on the composer's explicit pick, not the session's model with no pin",
  );
  assert.deepEqual(seen, [{ pin: "prov-cli", model: "claude-sonnet-5" }], "and the pin was validated");
});

test("F7: an UNUSABLE propose pin is a 409 BEFORE the 202 — never swallowed by the fire-and-forget catch", async () => {
  const repo = openRepo();
  const session = missionSession(repo, "always_ask");
  let plannerRan = false;
  const planner: HubPlanner = async () => {
    plannerRan = true;
    return { topology: "parallel", autonomy: "always_ask", agents: [plannedAgent({ key: "a" })] };
  };
  const service = makeService({ repository: repo, planner, runAgent: agentRunnerReturning({}) });
  const { base } = await makeMissionApp(repo, service, undefined, undefined, pinGuard([]));

  const res = await postJson(base, `/api/hub/sessions/${session.id}/mission`, {
    text: "Research it",
    model: "claude-sonnet-5",
    providerCredentialId: "prov-bad",
  });
  assert.equal(res.status, 409, "a refusal the operator can see — this route answers 202 and forgets");
  assert.match(String(((await res.json()) as { error?: string }).error), /no longer exists/);
  assert.equal(plannerRan, false, "and nothing was kicked off");
  assert.equal(repo.getMissionBySession(session.id), undefined, "no mission row was written");
});

test("F7: omitting model/credential leaves the planner on the session's own pair (regression lock)", async () => {
  const repo = openRepo();
  const session = missionSession(repo, "always_ask");
  const plannerSaw: Array<{ model: string; pin?: string }> = [];
  const planner: HubPlanner = async ({ model, providerCredentialId }) => {
    plannerSaw.push({ model, ...(providerCredentialId ? { pin: providerCredentialId } : {}) });
    return { topology: "parallel", autonomy: "always_ask", agents: [plannedAgent({ key: "a" })] };
  };
  const service = makeService({ repository: repo, planner, runAgent: agentRunnerReturning({}) });
  const { base } = await makeMissionApp(repo, service);

  await postJson(base, `/api/hub/sessions/${session.id}/mission`, { text: "Research it" });
  await waitForMissionEvent(repo, session.id, "plan_proposed");
  assert.deepEqual(plannerSaw, [{ model: "gpt-4o" }], "unchanged: the session's model, unpinned");
});

// ── mission-planner-guard (2026-07-27) — a planner model that cannot BUILD is refused up front, and a
//    post-kickoff failure SETTLES over the sink instead of vanishing into `.catch(log.warn)` ─────────
//
// The defect these lock: a mission-mode session pinned to a `claude_subscription` credential accepted
// the ask, persisted it as a `user_message`, answered 202 — and then `hubBuildModel` threw inside the
// planner promise. The session sat at `pending` with a dangling message and no mission, forever, while
// the console showed a turn that looked live. `assertPinUsable` never caught it: it validates the
// CREDENTIAL (exists · hub-eligible · not auth-broken), never whether it can build a model.

/** A planner-model guard shaped like the production one: refuses exactly the subscription pin. */
function plannerModelGuard(seen: Array<{ model: string; pin?: string }>) {
  return (modelId: string, providerCredentialId?: string): void => {
    seen.push({ model: modelId, ...(providerCredentialId ? { pin: providerCredentialId } : {}) });
    if (providerCredentialId === "prov-subscription") {
      throw Object.assign(
        new Error(
          `Model "${modelId}" cannot plan a mission (no AI-SDK model builder — e.g. a subscription model).`,
        ),
        { statusCode: 400 },
      );
    }
  };
}

test("planner-guard: a subscription pin is refused at the 202 boundary, with nothing left dangling", async () => {
  const repo = openRepo();
  const session = missionSession(repo, "always_ask");
  let plannerRan = false;
  const planner: HubPlanner = async () => {
    plannerRan = true;
    return { topology: "parallel", autonomy: "always_ask", agents: [plannedAgent({ key: "a" })] };
  };
  const service = makeService({ repository: repo, planner, runAgent: agentRunnerReturning({}) });
  const seen: Array<{ model: string; pin?: string }> = [];
  const { base } = await makeMissionApp(
    repo,
    service,
    undefined,
    undefined,
    undefined,
    plannerModelGuard(seen),
  );

  // The composer's own wire shape (model + its credential travel together, D-MI1).
  const res = await postJson(base, `/api/hub/sessions/${session.id}/mission`, {
    text: "Research it",
    model: "claude-sonnet-5",
    providerCredentialId: "prov-subscription",
  });
  assert.equal(res.status, 400, "a real HTTP refusal the composer can surface — not a 202 then silence");
  assert.match(String(((await res.json()) as { error?: string }).error), /cannot plan a mission/);
  assert.deepEqual(
    seen,
    [{ model: "claude-sonnet-5", pin: "prov-subscription" }],
    "the guard saw the effective pair the planner would have run on",
  );
  assert.equal(plannerRan, false, "nothing was kicked off");
  assert.equal(repo.getMissionBySession(session.id), undefined, "no mission row");
  assert.deepEqual(repo.listEvents(session.id), [], "and NO dangling user_message was persisted");
});

test("planner-guard: with no override it checks the SESSION's own model (the stuck-session case)", async () => {
  const repo = openRepo();
  const session = missionSession(repo, "always_ask"); // model: "gpt-4o", unpinned
  const service = makeService({
    repository: repo,
    planner: plannerReturning({ topology: "parallel", autonomy: "always_ask", agents: [] }),
    runAgent: agentRunnerReturning({}),
  });
  const seen: Array<{ model: string; pin?: string }> = [];
  const { base } = await makeMissionApp(
    repo,
    service,
    undefined,
    undefined,
    undefined,
    plannerModelGuard(seen),
  );

  await postJson(base, `/api/hub/sessions/${session.id}/mission`, { text: "Research it" });
  assert.deepEqual(
    seen,
    [{ model: "gpt-4o" }],
    "the session's own model, unpinned — the pair proposePlan itself would compute",
  );
});

test("planner-guard: skipped on the deterministic CREW path, which makes no planner model call", async () => {
  const repo = openRepo();
  const session = missionSession(repo, "always_ask");
  const service = makeService({
    repository: repo,
    planner: plannerReturning({ topology: "parallel", autonomy: "always_ask", agents: [] }),
    runAgent: agentRunnerReturning({}),
  });
  const seen: Array<{ model: string; pin?: string }> = [];
  const { base } = await makeMissionApp(
    repo,
    service,
    undefined,
    undefined,
    undefined,
    plannerModelGuard(seen),
  );

  // A named crew takes `instantiateCrew` — deterministic, no model call — so guarding the planner
  // model there would refuse a propose that would have succeeded.
  const res = await postJson(base, `/api/hub/sessions/${session.id}/mission`, {
    text: "Research it",
    crewId: "crew-1",
    model: "claude-sonnet-5",
    providerCredentialId: "prov-subscription",
  });
  assert.equal(res.status, 202, "accepted despite the subscription pin");
  assert.deepEqual(seen, [], "and the guard never ran");
});

test("planner-guard: a post-kickoff propose failure SETTLES as error + turn_done over the parent sink", async () => {
  const repo = openRepo();
  const session = missionSession(repo, "always_ask");
  const planner: HubPlanner = async () => {
    // Exactly the production shape: `hubBuildModel` throwing inside the planner promise, which the
    // route can only reach through its fire-and-forget `.catch`.
    throw new Error('Model "claude-sonnet-5" cannot back a mission agent (no AI-SDK model builder).');
  };
  const service = makeService({ repository: repo, planner, runAgent: agentRunnerReturning({}) });
  const { base } = await makeMissionApp(repo, service);

  const res = await postJson(base, `/api/hub/sessions/${session.id}/mission`, { text: "Research it" });
  assert.equal(res.status, 202, "the 202 contract is unchanged");
  await waitForMissionEvent(repo, session.id, "error");

  const types = repo.listEvents(session.id).map((e) => e.type);
  assert.deepEqual(
    types,
    ["user_message", "error", "turn_done"],
    "the ask is answered by a settled error turn — never left dangling mid-turn",
  );
  const errorEvent = repo
    .listEvents(session.id)
    .find((e): e is Extract<HubEvent, { type: "error" }> => e.type === "error")!;
  assert.match(
    errorEvent.message,
    /no AI-SDK model builder/,
    "and the thrown reason IS the operator-facing message",
  );
});

test("F8: PATCH .../missions/:id 409s on an unvalidated planned-agent pin instead of persisting a spawn-time 500", async () => {
  const repo = openRepo();
  const session = missionSession(repo, "always_ask");
  const plan: HubMissionPlan = {
    topology: "parallel",
    autonomy: "always_ask",
    agents: [plannedAgent({ key: "a" })],
  };
  const service = makeService({
    repository: repo,
    planner: plannerReturning(plan),
    runAgent: agentRunnerReturning({}),
  });
  const seen: Array<{ pin: string; model: string }> = [];
  const { base } = await makeMissionApp(repo, service, undefined, undefined, pinGuard(seen));

  await postJson(base, `/api/hub/sessions/${session.id}/mission`, { text: "go" });
  await waitForMissionEvent(repo, session.id, "plan_proposed");
  const mission = repo.getMissionBySession(session.id)!;

  const patch = async (pin: string): Promise<Response> =>
    fetch(`${base}/api/hub/missions/${mission.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        plan: { ...plan, agents: [plannedAgent({ key: "a", model: "gpt-4o", providerCredentialId: pin })] },
      }),
    });

  const refused = await patch("prov-bad");
  assert.equal(refused.status, 409, "an operator-asserted pin that cannot be honoured is a 409 (D-MI9)");
  assert.match(String(((await refused.json()) as { error?: string }).error), /no longer exists/);
  assert.equal(
    repo.getMission(mission.id).plan.agents[0]?.providerCredentialId,
    undefined,
    "the refused edit persisted nothing — previously it was written and only 500'd at spawn time",
  );

  // A usable pin edits normally and IS persisted, so the child spawns on it.
  const ok = await patch("prov-cli");
  assert.equal(ok.status, 200);
  assert.equal(repo.getMission(mission.id).plan.agents[0]?.providerCredentialId, "prov-cli");
  assert.deepEqual(seen.at(-1), { pin: "prov-cli", model: "gpt-4o" }, "validated against the agent's model");
});

// WP4.3 (R-SES9/R-UX11) — the mission-terminal notification hook: fired once `/approve`'s run-to-
// completion promise settles, carrying the REAL terminal status. Absent `notify` (every test above)
// stays a no-op — this is the one test that supplies it.
test("routes: approve fires notify({kind:'mission_terminal', status:'completed'}) once the mission settles", async () => {
  const repo = openRepo();
  const session = missionSession(repo, "always_ask");
  const plan: HubMissionPlan = {
    topology: "parallel",
    autonomy: "always_ask",
    agents: [plannedAgent({ key: "a" })],
  };
  const service = makeService({ repository: repo, planner: plannerReturning(plan), runAgent: agentRunnerReturning({}) });
  const notifications: HubNotifyEvent[] = [];
  const notify: HubNotifySink = (event) => notifications.push(event);
  const { base } = await makeMissionApp(repo, service, notify);

  const proposeRes = await postJson(base, `/api/hub/sessions/${session.id}/mission`, { text: "Research it" });
  assert.equal(proposeRes.status, 202);
  await waitForMissionEvent(repo, session.id, "plan_proposed");
  const mission = repo.getMissionBySession(session.id)!;

  const approveRes = await postJson(base, `/api/hub/missions/${mission.id}/approve`);
  assert.equal(approveRes.status, 202);
  await waitForMissionEvent(repo, session.id, "mission_synthesis");

  // The notify callback runs in the SAME `.then()` chain as the mission settling — poll briefly for it
  // rather than assuming it landed the instant `mission_synthesis` did.
  const deadline = Date.now() + 2000;
  while (notifications.length === 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.equal(notifications.length, 1);
  assert.deepEqual(notifications[0], {
    kind: "mission_terminal",
    missionId: mission.id,
    sessionId: session.id,
    status: "completed",
  });
});

test("routes: 404 for an unknown mission; 400 proposing in a non-mission session", async () => {
  const repo = openRepo();
  const chat = repo.createSession({ mode: "chat", model: "gpt-4o" });
  const plan: HubMissionPlan = { topology: "parallel", autonomy: "auto", agents: [plannedAgent({ key: "a" })] };
  const service = makeService({ repository: repo, planner: plannerReturning(plan), runAgent: agentRunnerReturning({}) });
  const { base } = await makeMissionApp(repo, service);

  const unknown = await postJson(base, `/api/hub/missions/nope/approve`);
  assert.equal(unknown.status, 404);

  const wrongMode = await postJson(base, `/api/hub/sessions/${chat.id}/mission`, { text: "hi" });
  assert.equal(wrongMode.status, 400, "a chat-mode session cannot host a mission");

  const agentStop404 = await postJson(base, `/api/hub/missions/nope/agents/x/stop`);
  assert.equal(agentStop404.status, 404);
});

// ── WP2.3 — steering a running mission agent (R-SES3 durable queue / R-UX4) ──────────────────────────

test("steerAgent enqueues a DURABLE queued_user_message on the running child; validates targets", async () => {
  const repo = openRepo();
  const session = missionSession(repo, "auto"); // auto → auto-approves + runs
  const { sink } = collectSink();
  const plan: HubMissionPlan = { topology: "parallel", agents: [plannedAgent({ key: "a" })] };

  // A runner that BLOCKS until we release it, so the agent's child session stays `running` while we steer.
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const runAgent: HubAgentRunner = async (input) => {
    await gate;
    return { report: report(), costUsd: 0.1, tokensIn: 10, tokensOut: 5 };
  };
  const service = makeService({ repository: repo, planner: plannerReturning(plan), runAgent });

  // Kick off (auto-approves + runs) WITHOUT awaiting — the runner is parked on the gate.
  const running = service.proposePlan({ sessionId: session.id, text: "go", sink });

  // Wait for the agent to spawn + its child to be `running`.
  let agentSessionId = "";
  for (let i = 0; i < 200 && !agentSessionId; i += 1) {
    const spawned = repo
      .listEvents(session.id)
      .find((e): e is Extract<HubEvent, { type: "agent_spawned" }> => e.type === "agent_spawned");
    if (spawned && repo.getSession(spawned.agentSessionId).status === "running") {
      agentSessionId = spawned.agentSessionId;
    } else {
      await new Promise((r) => setTimeout(r, 5));
    }
  }
  assert.ok(agentSessionId, "the agent child session started running");
  const mission = repo.getMissionBySession(session.id)!;

  // Steer it — a durable queued_user_message lands on the CHILD's own log (R-SES3).
  const event = service.steerAgent(mission.id, agentSessionId, "focus on the pricing table");
  assert.equal(event.type, "queued_user_message");
  const childQueued = repo
    .listEvents(agentSessionId)
    .filter((e) => e.type === "queued_user_message");
  assert.equal(childQueued.length, 1, "the steering message is durably persisted on the child");
  assert.equal(
    childQueued[0]?.type === "queued_user_message" && childQueued[0].text,
    "focus on the pricing table",
  );

  // A non-agent session id is rejected; a bogus mission is a 404.
  assert.throws(() => service.steerAgent(mission.id, session.id, "x"), /not an agent/);

  release();
  await running;

  // Once the mission is done, the agent is no longer steerable.
  assert.throws(() => service.steerAgent(mission.id, agentSessionId, "late"), /not running/);
});

// ── hub-fixes WP6.1 (RC7) — `auto` sessions may propose; chat/research may not; the gate still applies ─

/** A minimal single-agent plan for the auto-mode gate tests. */
const AUTO_PLAN: HubMissionPlan = {
  topology: "parallel",
  autonomy: "auto",
  agents: [plannedAgent({ key: "a" })],
  rationale: "One angle.",
};

test("proposePlan accepts an AUTO-mode session and emits plan_proposed (RC7)", async () => {
  const repo = openRepo();
  const session = repo.createSession({ mode: "auto", model: "gpt-4o", autonomy: "always_ask" });
  const { sink, events } = collectSink();
  const service = makeService({
    repository: repo,
    planner: plannerReturning(AUTO_PLAN),
    runAgent: agentRunnerReturning({}),
  });

  const mission = await service.proposePlan({ sessionId: session.id, text: "Compare X and Y", sink });

  assert.ok(
    events.some((e) => e.type === "plan_proposed"),
    "an auto-mode session proposes (plan_proposed emitted)",
  );
  assert.equal(mission.status, "proposed", "an always_ask auto mission WAITS — it is not launched");
  assert.equal(
    events.some((e) => e.type === "mission_started"),
    false,
    "no silent launch — the plan-approval autonomy gate still applies to auto mode",
  );
});

test("proposePlan REJECTS chat and research sessions (only mission or auto may propose)", async () => {
  const repo = openRepo();
  const service = makeService({
    repository: repo,
    planner: plannerReturning(AUTO_PLAN),
    runAgent: agentRunnerReturning({}),
  });
  for (const mode of ["chat", "research"] as const) {
    const session = repo.createSession({ mode, model: "gpt-4o", autonomy: "always_ask" });
    const { sink } = collectSink();
    await assert.rejects(
      () => service.proposePlan({ sessionId: session.id, text: "do it", sink }),
      /mission-mode or auto-mode session/,
      `proposePlan rejects a ${mode} session`,
    );
  }
});

test("mission-mode propose is UNCHANGED by the RC7 gate lift (still proposes)", async () => {
  const repo = openRepo();
  const session = missionSession(repo, "always_ask");
  const { sink, events } = collectSink();
  const service = makeService({
    repository: repo,
    planner: plannerReturning(AUTO_PLAN),
    runAgent: agentRunnerReturning({}),
  });
  const mission = await service.proposePlan({ sessionId: session.id, text: "task", sink });
  assert.ok(events.some((e) => e.type === "plan_proposed"));
  assert.equal(mission.status, "proposed");
});

test("proposePlan with echoUserMessage:false does NOT persist a user_message (the auto bridge already did)", async () => {
  const repo = openRepo();
  const session = repo.createSession({ mode: "auto", model: "gpt-4o", autonomy: "always_ask" });
  const { sink, events } = collectSink();
  const service = makeService({
    repository: repo,
    planner: plannerReturning(AUTO_PLAN),
    runAgent: agentRunnerReturning({}),
  });

  await service.proposePlan({
    sessionId: session.id,
    text: "the ask the routing turn already persisted",
    sink,
    echoUserMessage: false,
  });

  assert.equal(
    repo.listEvents(session.id).some((e) => e.type === "user_message"),
    false,
    "no duplicate user_message is written when the bridge suppresses the echo",
  );
  // The proposal still happened.
  assert.ok(events.some((e) => e.type === "plan_proposed"));

  // Contrast: the DEFAULT (echoUserMessage omitted) still echoes — mission-mode path unchanged.
  const missionSess = missionSession(repo, "always_ask");
  const { sink: sink2 } = collectSink();
  await service.proposePlan({ sessionId: missionSess.id, text: "ask", sink: sink2 });
  assert.ok(
    repo.listEvents(missionSess.id).some((e) => e.type === "user_message"),
    "the default path still echoes the user ask (mission mode unchanged)",
  );
});

// ── The "balanced" model guard + the LAYER-8 roster injection ──────────────────────────────────────

test('propose: a planner-emitted tier label ("balanced") is replaced by the session model and noted', async () => {
  const repo = openRepo();
  const session = missionSession(repo, "always_ask"); // model: "gpt-4o"
  const { sink, events } = collectSink();
  const plan: HubMissionPlan = {
    topology: "parallel",
    autonomy: "always_ask",
    agents: [
      plannedAgent({ key: "a", model: "balanced" }), // a bare tier label — not a resolvable model
      plannedAgent({ key: "b", model: "claude-opus-4-8" }), // a concrete id — must survive
    ],
  };
  const service = makeService({ repository: repo, planner: plannerReturning(plan), runAgent: agentRunnerReturning({}) });

  const mission = await service.proposePlan({ sessionId: session.id, text: "task", sink });

  const a = mission.plan.agents.find((agent) => agent.key === "a");
  const b = mission.plan.agents.find((agent) => agent.key === "b");
  assert.equal(a?.model, "gpt-4o", "the tier label is replaced by the session's own model");
  assert.equal(b?.model, "claude-opus-4-8", "a concrete model id is left untouched");
  assert.match(mission.plan.rationale ?? "", /Model check:/, "the substitution is noted on the plan card");

  // The proposed plan is still wire-valid.
  const proposed = events.find(
    (e): e is Extract<HubEvent, { type: "plan_proposed" }> => e.type === "plan_proposed",
  );
  assert.ok(proposed);
  assert.doesNotThrow(() => hubMissionPlanSchema.parse(proposed.plan));
});

test("the model roster (when wired) is injected into the planner system prompt", async () => {
  const repo = openRepo();
  const session = missionSession(repo, "always_ask");
  const { sink } = collectSink();
  let capturedPrompt = "";
  const planner: HubPlanner = async (input) => {
    capturedPrompt = input.systemPrompt;
    return { topology: "parallel", autonomy: "always_ask", agents: [plannedAgent({ key: "a" })] };
  };
  const service = new HubMissionService({
    repository: repo,
    planner,
    runAgent: agentRunnerReturning({}),
    synthesizer: synthesizerCiting,
    config: DEFAULT_CONFIG,
    now: () => "2026-07-17T00:00:00.000Z",
    // async, mirroring the production live-roster builder
    roster: async () => "- frontier: claude-opus-4-8\n- balanced: gpt-4o",
  });

  await service.proposePlan({ sessionId: session.id, text: "task", sink });

  assert.match(capturedPrompt, /claude-opus-4-8/, "the roster string reaches the planner prompt");
  assert.match(capturedPrompt, /- balanced: gpt-4o/, "the tier-tagged roster is present verbatim");
});

test("v1-fixes F8: a facade agent's brief folds the role instructions in; a normal agent keeps the clean brief", async () => {
  // Facade agent (assistant|…): the system prompt never reaches the model, so the brief must carry
  // the role's own instructions + the report expectations.
  const repoA = openRepo();
  const sessionA = missionSession(repoA, "always_ask");
  const sinkA = collectSink();
  const inputsA: HubAgentRunInput[] = [];
  const planA: HubMissionPlan = {
    topology: "parallel",
    autonomy: "always_ask",
    agents: [
      plannedAgent({
        key: "a",
        model: "assistant|tenant|analytics",
        systemPrompt: "Always include evidence as a table.",
        target: "Not yet configured — set this agent's objective in its profile.",
      }),
    ],
  };
  const serviceA = makeService({
    repository: repoA,
    planner: plannerReturning(planA),
    runAgent: agentRunnerReturning({ a: report() }, { inputs: inputsA }),
  });
  const missionA = await serviceA.proposePlan({ sessionId: sessionA.id, text: "task", sink: sinkA.sink });
  await serviceA.approve({ missionId: missionA.id, sink: sinkA.sink });
  assert.equal(inputsA.length, 1);
  const facadeInput = inputsA[0];
  assert.ok(facadeInput);
  assert.match(facadeInput.brief, /^Role instructions: Always include evidence as a table\./);
  assert.match(facadeInput.brief, /Do the work for a\./);
  assert.match(facadeInput.brief, /open questions/);
  assert.ok(
    !facadeInput.systemPrompt.includes("Not yet configured"),
    "profile placeholders are scrubbed from the assembled role prompt",
  );

  // Non-facade agent: the clean planned brief, untouched.
  const repoB = openRepo();
  const sessionB = missionSession(repoB, "always_ask");
  const sinkB = collectSink();
  const inputsB: HubAgentRunInput[] = [];
  const planB: HubMissionPlan = {
    topology: "parallel",
    autonomy: "always_ask",
    agents: [plannedAgent({ key: "b", model: "gpt-4o", systemPrompt: "Be terse." })],
  };
  const serviceB = makeService({
    repository: repoB,
    planner: plannerReturning(planB),
    runAgent: agentRunnerReturning({ b: report() }, { inputs: inputsB }),
  });
  const missionB = await serviceB.proposePlan({ sessionId: sessionB.id, text: "task", sink: sinkB.sink });
  await serviceB.approve({ missionId: missionB.id, sink: sinkB.sink });
  assert.equal(inputsB[0]?.brief, "Do the work for b.");
});
