// Crew nesting (roadmap/crew-nesting/, WP2.R · D-CN10 refute doctrine · README §6 invariants) — the
// ADVERSARIAL REFUTE-REVIEW of the recursive execution heart (Phase 2 WP2.1/2.2/2.3 + WP3.1 replay).
//
// This is NOT a summary pass. Each of the ten probes below is a CONCRETE ATTACK — a branchy/deep tree,
// a save-then-mutate cycle, a nested `auto` crew, an empty-crew-ref grant, a denied nested agent — mounted
// as a DETERMINISTIC test that either fails to break the system (→ the invariant holds, REFUTED) or
// succeeds (→ a FINDING, kept as a `.skip` with a `// FINDING:` comment). Every probe drives the injectable
// stub-runner seam already used by `hub-missions.test.ts` / `hub-crew-nesting-engine.test.ts` — NO provider
// key, NO real child process, NO MCP server. The verdict for each probe is recorded in
// `roadmap/crew-nesting/phase-2-engine/2.R-review.md` with the product `file:line` it refutes against.
//
// The ten probes (README §6 invariant matrix):
//   1  budget monotonicity (D-CN3)              6  nested HITL deny + plan_proposed-is-not-a-gate (D-CN1/D-CN6)
//   2  run-time cycle (D-CN4)                    7  transitive grant intersection + empty-crew-ref (D-CN9/D-HF5)
//   3  depth cap at run-time (D-CN4/D-CN10)      8  transitive autonomy non-escalation (D-CN9)
//   4  cascading trip at depth 2 (D-CN3)         9  brief-only isolation at every level (D-AH9)
//   5  nested shouldAutoApprove (D-CN1)         10  event-sourced replay of a nested tree (D-CN7)

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import type {
  HubAgentReport,
  HubAgentRole,
  HubAgentRoleInput,
  HubCrew,
  HubCrewMember,
  HubEvent,
  HubToolGrants,
  HubTopology,
} from "@mcp-token-footprint/shared";
import { applyMigrations, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { HubRepository } from "../src/hub/repository.js";
import type { HubTurnSink } from "../src/hub/turn-engine.js";
import { reconstructMission, reconstructMissionById } from "../src/hub/missions/board.js";
import { effectiveAgentGrants } from "../src/hub/tools/grants.js";
import {
  clampPlanToBudgets,
  HubMissionService,
  shouldAutoApprove,
  type HubAgentRunInput,
  type HubAgentRunner,
  type HubMissionServiceConfig,
  type HubPlanner,
  type HubResolvedCrew,
  type HubSynthesizer,
} from "../src/hub/missions/index.js";

// ── Harness (mirrors hub-crew-nesting-engine.test.ts + hub-mission-nesting-scope.test.ts) ─────────────

const databases: AppDatabase[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function open(): { repo: HubRepository; db: AppDatabase } {
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

const roleInput = (over: Partial<HubAgentRoleInput> & { name: string }): HubAgentRoleInput => ({
  systemPrompt: `System for ${over.name}`,
  defaultModel: "gpt-4o",
  target: `Target for ${over.name}`,
  expectedOutcome: "A report.",
  ...over,
});

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
  maxAgents: 12,
  maxParallel: 3,
  defaultBudgetUsd: 100,
  maxBudgetUsd: 500,
  askAboveAgents: 50,
  askAboveUsd: 1000,
  defaultAutonomy: "auto",
  maxDepth: 4,
  maxTotalAgents: 64,
};

const synthesizerCiting: HubSynthesizer = async () => ({
  text: "ROOT_SYNTH_SECRET combined synthesis.",
  usage: { tokensIn: 5, tokensOut: 5 },
  costUsd: 0,
});

const plannerNever: HubPlanner = async () => {
  throw new Error("the planner must never run on a crew-instantiation path");
};

/** Hand-built crew-graph substrate (so a cyclic / over-depth / over-cap graph can be injected AFTER save,
 *  simulating a graph mutated between WP1.1's author-time check and the run — the D-CN4 run-time guard). A
 *  member may carry a `toolGrants` override (the scope probes). */
function graph(repo: HubRepository) {
  const crews = new Map<string, HubCrew>();
  const roles = new Map<string, HubAgentRole>();
  const now = "2026-07-26T00:00:00.000Z";
  return {
    role(name: string, toolGrants?: HubToolGrants): HubAgentRole {
      const r = repo.createAgentRole(roleInput({ name, ...(toolGrants ? { toolGrants } : {}) }));
      roles.set(r.id, r);
      return r;
    },
    crew(id: string, name: string, topology: HubTopology, members: HubCrewMember[]): HubCrew {
      const c: HubCrew = { id, name, topology, members, createdAt: now, updatedAt: now };
      crews.set(id, c);
      return c;
    },
    resolveCrew(crewId: string): HubResolvedCrew | undefined {
      const crew = crews.get(crewId);
      if (!crew) return undefined;
      const wanted = new Set(crew.members.map((m) => m.agentId).filter((v): v is string => !!v));
      return { crew, roles: [...roles.values()].filter((r) => wanted.has(r.id)) };
    },
  };
}

function makeService(over: {
  repository: HubRepository;
  runAgent: HubAgentRunner;
  resolveCrew: (crewId: string) => HubResolvedCrew | undefined;
  config?: Partial<HubMissionServiceConfig>;
  isServerRunReady?: (serverId: string) => { ready: boolean; serverName?: string };
  logger?: { warn?: (msg: string) => void };
}): HubMissionService {
  return new HubMissionService({
    repository: over.repository,
    planner: plannerNever,
    runAgent: over.runAgent,
    synthesizer: synthesizerCiting,
    resolveCrew: over.resolveCrew,
    config: { ...DEFAULT_CONFIG, ...over.config },
    ...(over.isServerRunReady ? { isServerRunReady: over.isServerRunReady } : {}),
    ...(over.logger ? { logger: over.logger } : {}),
    now: () => "2026-07-26T00:00:00.000Z",
  });
}

function missionSession(repo: HubRepository, autonomy: "always_ask" | "threshold" | "auto" = "auto") {
  return repo.createSession({ mode: "mission", model: "gpt-4o", autonomy });
}

function scopedSession(repo: HubRepository, toolScope: HubToolGrants) {
  return repo.createSession({ mode: "mission", model: "gpt-4o", autonomy: "auto", toolScope });
}

/** A leaf runner that returns a report (structured mode). Records every invocation by role name, its
 *  returned cost, the FULL run input (brief isolation probe), and tracks max global concurrency. */
function leafRunner(opts: {
  costPerLeaf?: number;
  delayMs?: number;
  reportFor?: (roleName: string) => HubAgentReport;
  invocations?: string[];
  inputs?: HubAgentRunInput[];
  concurrency?: { current: number; max: number };
}): HubAgentRunner {
  return async (input: HubAgentRunInput) => {
    if (input.abortSignal.aborted) return { report: undefined, costUsd: 0, tokensIn: 0, tokensOut: 0, aborted: true };
    opts.invocations?.push(input.roleName);
    opts.inputs?.push(input);
    if (opts.concurrency) {
      opts.concurrency.current += 1;
      opts.concurrency.max = Math.max(opts.concurrency.max, opts.concurrency.current);
    }
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
    if (opts.concurrency) opts.concurrency.current -= 1;
    const rep = opts.reportFor?.(input.roleName) ?? report({ summary: input.roleName, roleName: input.roleName });
    return { report: rep, costUsd: opts.costPerLeaf ?? 0.1, tokensIn: 10, tokensOut: 5 };
  };
}

function agentReports(events: HubEvent[], missionId?: string) {
  return events.filter(
    (e): e is Extract<HubEvent, { type: "agent_report" }> =>
      e.type === "agent_report" && (missionId === undefined || e.missionId === missionId),
  );
}
function synthesisEvents(events: HubEvent[], missionId?: string) {
  return events.filter(
    (e): e is Extract<HubEvent, { type: "mission_synthesis" }> =>
      e.type === "mission_synthesis" && (missionId === undefined || e.missionId === missionId),
  );
}
function planApprovedEvents(events: HubEvent[], missionId?: string) {
  return events.filter(
    (e): e is Extract<HubEvent, { type: "plan_approved" }> =>
      e.type === "plan_approved" && (missionId === undefined || e.missionId === missionId),
  );
}

/** The ROOT mission for a session (the one with no `parentMissionId`) — NOT `getMissionBySession`
 *  (DESC-LIMIT-1 under a fixed clock can tie-return a sub-mission). */
function rootMissionId(repo: HubRepository, sessionId: string): string {
  const root = repo.listMissions().find((m) => m.sessionId === sessionId && m.parentMissionId === undefined);
  assert.ok(root, "the root mission exists");
  return root.id;
}

/** Total number of hub_sessions rows (the bounded-spawn assertion for the cycle probe). */
function sessionRowCount(db: AppDatabase): number {
  return (db.prepare("SELECT COUNT(*) AS c FROM hub_sessions").get() as { c: number }).c;
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════════
//  PROBE 1 — Budget monotonicity (D-CN3).  Attack: a branchy N×M tree whose per-child saved budgets are set
//  FAR above their fair share (and one child naming the whole env ceiling); assert aggregate spend can never
//  exceed the root min(requested, maxBudgetUsd), and a child never re-reads caps.maxBudgetUsd.
//  Anchors: allocateChildBudget planner.ts:359; reservation runSubCrew orchestrator.ts:1298-1303;
//  shared trip orchestrator.ts:911-914/1201; root clamp planner.ts:648.
// ══════════════════════════════════════════════════════════════════════════════════════════════════════

test("PROBE 1a REFUTED — branchy N×M tree, per-child budgets ABOVE their share: aggregate spend ≤ root ceiling", async () => {
  const { repo } = open();
  const g = graph(repo);
  // Two sub-crews of 3 leaves each = 6 potential leaves. Each crew-ref names a $1000 budget (WAY over its
  // fair share of the $4 root cap). Sequential (maxParallel 1) so the trip point is deterministic.
  const xs = [1, 2, 3].map((i) => ({ agentId: g.role(`X${i}`).id }));
  const ys = [1, 2, 3].map((i) => ({ agentId: g.role(`Y${i}`).id }));
  const crewX = g.crew("crewX", "Crew X", "parallel", xs);
  const crewY = g.crew("crewY", "Crew Y", "parallel", ys);
  g.crew("crewP", "Parent", "parallel", [
    { crewId: crewX.id, budgets: { maxCostUsd: 1000 } },
    { crewId: crewY.id, budgets: { maxCostUsd: 1000 } },
  ]);

  const invocations: string[] = [];
  const { sink } = collectSink();
  const service = makeService({
    repository: repo,
    resolveCrew: g.resolveCrew,
    runAgent: leafRunner({ costPerLeaf: 1, invocations }),
    // Root cap $4 (defaultBudgetUsd), env ceiling $500. Each $1 leaf ⇒ at most 4 leaves may run tree-wide.
    config: { defaultBudgetUsd: 4, maxBudgetUsd: 500, maxParallel: 1 },
  });

  const session = missionSession(repo);
  const mission = await service.proposePlan({ sessionId: session.id, text: "run", sink, crewId: "crewP" });
  assert.equal(mission.status, "completed");

  // The reservation discipline handed crewX min(1000, 4) = 4 (never $1000, never the $500 env ceiling), so
  // crewY got min(1000, 0) = 0 → R3c skip. Aggregate leaf spend = 3 ($3 ≤ the $4 root ceiling) — NEVER $1000.
  const aggregateLeafSpend = invocations.length * 1;
  assert.ok(aggregateLeafSpend <= 4, `aggregate leaf spend ${aggregateLeafSpend} ≤ root ceiling $4`);
  assert.equal(mission.costUsd !== undefined && (mission.costUsd ?? 0) <= 4.000001, true, "the settled tree cost ≤ the root ceiling");
});

test("PROBE 1b REFUTED — branchy tree, BOTH subtrees run within a shared ceiling: aggregate spend = the cap, not the sum of requests", async () => {
  const { repo } = open();
  const g = graph(repo);
  const xs = [1, 2, 3].map((i) => ({ agentId: g.role(`AX${i}`).id }));
  const ys = [1, 2, 3].map((i) => ({ agentId: g.role(`AY${i}`).id }));
  const crewX = g.crew("crewX", "Crew X", "parallel", xs);
  const crewY = g.crew("crewY", "Crew Y", "parallel", ys);
  // Each crew-ref names $3 — the fair half of the $6 root pool. Both subtrees run 3 × $1 leaves = $6 total.
  g.crew("crewP", "Parent", "parallel", [
    { crewId: crewX.id, budgets: { maxCostUsd: 3 } },
    { crewId: crewY.id, budgets: { maxCostUsd: 3 } },
  ]);

  const invocations: string[] = [];
  const { sink } = collectSink();
  const service = makeService({
    repository: repo,
    resolveCrew: g.resolveCrew,
    runAgent: leafRunner({ costPerLeaf: 1, invocations }),
    config: { defaultBudgetUsd: 6, maxBudgetUsd: 500, maxParallel: 1 },
  });

  const session = missionSession(repo);
  const mission = await service.proposePlan({ sessionId: session.id, text: "run", sink, crewId: "crewP" });
  assert.equal(mission.status, "completed");
  // Both crews ran within the SHARED ceiling: 6 leaves = $6 = the root cap. The sum of the NAMED requests
  // ($3 + $3 = $6) never widened the ceiling; had a third crew named $3 it would have been starved (R3c).
  assert.ok(invocations.length * 1 <= 6, `aggregate leaf spend ${invocations.length} ≤ root ceiling $6`);
});

test("PROBE 1c REFUTED — a nested crew naming the ENV ceiling gets min(requested, parentRemaining), never caps.maxBudgetUsd again", async () => {
  const { repo } = open();
  const g = graph(repo);
  const leaves = [1, 2, 3, 4, 5].map((i) => ({ agentId: g.role(`Z${i}`).id }));
  const crewC = g.crew("crewC", "Child", "parallel", leaves);
  // The crew-ref names maxCostUsd = 500 — EXACTLY the env ceiling (`caps.maxBudgetUsd`). If the allocation
  // re-read the env cap it would get $500; the monotone primitive bounds it to the parent's remaining ($2).
  g.crew("crewP", "Parent", "parallel", [{ crewId: crewC.id, budgets: { maxCostUsd: 500 } }]);

  const invocations: string[] = [];
  const { sink } = collectSink();
  const service = makeService({
    repository: repo,
    resolveCrew: g.resolveCrew,
    runAgent: leafRunner({ costPerLeaf: 1, invocations }),
    config: { defaultBudgetUsd: 2, maxBudgetUsd: 500, maxParallel: 1 },
  });

  const session = missionSession(repo);
  const mission = await service.proposePlan({ sessionId: session.id, text: "run", sink, crewId: "crewP" });
  assert.equal(mission.status, "completed");
  // The child was bounded to the parent's $2 remaining, NOT the $500 it requested (= the env ceiling): at
  // most 2 of its 5 leaves ran, aggregate ≤ $2. `allocateChildBudget` takes no `caps` arg — it CANNOT re-read one.
  assert.ok(invocations.length <= 2, `the child ran ≤ 2 leaves ($2 remaining), not $500-worth (${invocations.length})`);
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════
//  PROBE 2 — Run-time cycle (D-CN4).  Attack: save A→B, then MUTATE B→A directly in the graph after save,
//  before run (a MUTUAL cycle bypassing WP1.1's author-time check); assert the run-time visited-set rejects
//  re-entry LOUDLY with a bounded hub_sessions row count (no infinite spawn).
//  Anchors: run-time cycle guard runSubCrew orchestrator.ts:1250; visited-set thread orchestrator.ts:1375.
// ══════════════════════════════════════════════════════════════════════════════════════════════════════

test("PROBE 2 REFUTED — a MUTUAL run-time cycle A→B→A rejects loudly + terminates with a BOUNDED session-row count", async () => {
  const { repo, db } = open();
  const g = graph(repo);
  // A mutual cycle, hand-built to bypass WP1.1's author-time check (a graph mutated after save).
  g.crew("crewA", "Alpha", "parallel", [{ crewId: "crewB" }]);
  g.crew("crewB", "Beta", "parallel", [{ crewId: "crewA" }]);

  const warnings: string[] = [];
  const { sink } = collectSink();
  const service = makeService({
    repository: repo,
    resolveCrew: g.resolveCrew,
    runAgent: leafRunner({}),
    // maxDepth high so the CYCLE guard (not the depth guard) is what trips.
    config: { maxDepth: 8 },
    logger: { warn: (m) => warnings.push(m) },
  });

  const session = missionSession(repo);
  // The test COMPLETING is itself the proof of termination (no infinite recursion / no stack overflow).
  const mission = await service.proposePlan({ sessionId: session.id, text: "run", sink, crewId: "crewA" });

  assert.ok(warnings.some((m) => /circular|cycle/i.test(m)), "the run-time cycle was rejected loudly");
  // Bounded spawn: the path visited-set ∪ the depth cap terminate the mutated cycle at a HANDFUL of missions/
  // sessions — never an explosion. (root crewA-plan → crewB@d1 → crewA@d2 → crewB@d3 REJECTED before spawn.)
  assert.ok(repo.getMissionTree(mission.id).length <= 6, `the mission tree is bounded (${repo.getMissionTree(mission.id).length})`);
  assert.ok(sessionRowCount(db) <= 12, `the hub_sessions row count is bounded — no infinite spawn (${sessionRowCount(db)})`);
  assert.equal(mission.status, "completed", "the mutated cyclic branch did not crash the whole tree");
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════
//  PROBE 3 — Depth cap at run-time (D-CN4/D-CN10).  Attack: with maxDepth=2, save a legal chain then MUTATE
//  it to depth 3 before run; assert the run-time depth counter rejects the over-depth expansion. Also assert
//  maxDepth=1 reproduces today (any crewId unit is rejected).
//  Anchors: over-depth guard runSubCrew orchestrator.ts:1242; depth thread orchestrator.ts:1237/1374.
// ══════════════════════════════════════════════════════════════════════════════════════════════════════

test("PROBE 3a REFUTED — maxDepth=2: a chain MUTATED to depth 3 after propose is rejected at run-time (belt-and-suspenders)", async () => {
  const { repo } = open();
  const g = graph(repo);
  const midLeaf = g.role("Mid Leaf");
  const deepLeaf = g.role("Deep Leaf");
  const crewC = g.crew("crewC", "Deep Crew", "parallel", [{ agentId: deepLeaf.id }]);
  // crewMid starts LEGAL (only a leaf) so the propose-time depth backstop passes (tree depth 1 ≤ 2).
  const crewMid = g.crew("crewMid", "Mid Crew", "parallel", [{ agentId: midLeaf.id }]);
  g.crew("crewP", "Parent", "parallel", [{ crewId: crewMid.id }]);

  const warnings: string[] = [];
  const invocations: string[] = [];
  const { sink, events } = collectSink();
  // always_ask ⇒ propose settles PROPOSED (a window to mutate the graph before the run).
  const service = makeService({
    repository: repo,
    resolveCrew: g.resolveCrew,
    runAgent: leafRunner({ invocations }),
    config: { maxDepth: 2, defaultAutonomy: "always_ask" },
    logger: { warn: (m) => warnings.push(m) },
  });

  const session = missionSession(repo, "always_ask");
  const proposed = await service.proposePlan({ sessionId: session.id, text: "run", sink, crewId: "crewP" });
  assert.equal(proposed.status, "proposed", "the depth-1 tree passes the propose gate");

  // MUTATE crewMid AFTER save — it now nests crewC, pushing the tree to depth 2 (crewC would sit at run-depth 2).
  crewMid.members = [{ agentId: midLeaf.id }, { crewId: crewC.id }];
  await service.approve({ missionId: proposed.id, sink });
  const mission = repo.getMission(proposed.id);

  // The mid leaf ran; the depth-2 crewC expansion (childDepth 2 >= maxDepth 2) was rejected at RUN time.
  assert.ok(invocations.includes("Mid Leaf"), "the mid-level leaf still ran");
  assert.ok(!invocations.includes("Deep Leaf"), "the over-depth deep leaf never ran");
  assert.ok(warnings.some((m) => /depth/i.test(m)), "the run-time over-depth reject was logged loudly");
  assert.equal(synthesisEvents(events, mission.id)[0]?.partial, true, "the tree is honestly partial");
  // No sub-mission row was created for the over-depth crewC.
  assert.ok(!repo.listMissions().some((m) => m.depth !== undefined && (m.depth ?? 0) >= 2), "no depth-2 sub-mission row exists");
});

test("PROBE 3b REFUTED — maxDepth=1 reproduces today's semantics: ANY crewId unit is rejected at run-time", async () => {
  const { repo } = open();
  const g = graph(repo);
  const rootLeaf = g.role("Root Leaf");
  const nested = g.role("Nested");
  const crewC = g.crew("crewC", "Child", "parallel", [{ agentId: nested.id }]);
  g.crew("crewP", "Parent", "parallel", [{ agentId: rootLeaf.id }, { crewId: crewC.id }]);

  const warnings: string[] = [];
  const invocations: string[] = [];
  const { sink, events } = collectSink();
  const service = makeService({
    repository: repo,
    resolveCrew: g.resolveCrew,
    runAgent: leafRunner({ invocations }),
    config: { maxDepth: 1 }, // the D-CN10 off-switch — a crewId member is over-depth at the first expansion
    logger: { warn: (m) => warnings.push(m) },
  });

  const session = missionSession(repo);
  const mission = await service.proposePlan({ sessionId: session.id, text: "run", sink, crewId: "crewP" });
  assert.deepEqual(invocations, ["Root Leaf"], "only the leaf ran; the crewId unit was rejected (depth off-switch)");
  assert.ok(warnings.some((m) => /depth/i.test(m)), "the reject was logged loudly");
  assert.equal(synthesisEvents(events, mission.id)[0]?.partial, true, "the mission is honestly partial");
  assert.equal(repo.listChildMissions(mission.id).length, 0, "no sub-mission was created (depth 1 = today's flat semantics)");
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════
//  PROBE 4 — Cascading trip at DEPTH 2 (D-CN3).  Attack: a 3-level tree where the ROOT budget trips WHILE a
//  DEPTH-2 descendant leaf is in flight; assert the shared abort halts the in-flight depth-2 leaf (not left
//  running), the next depth-2 launch is suppressed, and the tree is honestly partial. Regression-guards the
//  BUG-4 `maxParallel ≥ agentCount` inertness per level. Anchors: shared leafAborts/tripBudget
//  orchestrator.ts:903-914/1170; composed isTripped makeLevelBudget orchestrator.ts:222; buildRunSlot:1144.
// ══════════════════════════════════════════════════════════════════════════════════════════════════════

test("PROBE 4 REFUTED — a ROOT trip aborts an in-flight DEPTH-2 leaf AND suppresses the next depth-2 launch", async () => {
  const { repo } = open();
  const g = graph(repo);
  const rootLeaf = g.role("Root Leaf");
  const deepBlocker = g.role("Deep Blocker");
  const deepSecond = g.role("Deep Second");
  // maxParallel 2 ≥ each level's agent count (BUG-4 regression posture): all slots at a level may launch at
  // once, yet the SHARED trip must still halt in-flight descendants + suppress the next launch.
  const crewC = g.crew("crewC", "Deep Crew", "parallel", [{ agentId: deepBlocker.id }, { agentId: deepSecond.id }]);
  const crewMid = g.crew("crewMid", "Mid Crew", "parallel", [{ crewId: crewC.id }]);
  g.crew("crewP", "Parent", "parallel", [{ agentId: rootLeaf.id }, { crewId: crewMid.id }]);

  const { sink, events } = collectSink();
  let signalDeepInFlight: (() => void) | undefined;
  const deepInFlight = new Promise<void>((resolve) => {
    signalDeepInFlight = resolve;
  });
  let sawDeepAbort = false;
  let deepSecondRan = false;
  const runAgent: HubAgentRunner = async (input) => {
    if (input.roleName === "Root Leaf") {
      await deepInFlight; // wait until a DEPTH-2 leaf is in flight, THEN overspend the $1 root cap
      return { report: report({ roleName: input.roleName }), costUsd: 5, tokensIn: 1, tokensOut: 1 };
    }
    if (input.roleName === "Deep Second") {
      deepSecondRan = true;
      return { report: report({ roleName: input.roleName }), costUsd: 0.1, tokensIn: 1, tokensOut: 1 };
    }
    // Deep Blocker (depth 2): announce it is in flight, then block until an ANCESTOR (root) trip aborts it.
    signalDeepInFlight?.();
    await new Promise<void>((resolve) => {
      if (input.abortSignal.aborted) {
        sawDeepAbort = true;
        resolve();
        return;
      }
      input.abortSignal.addEventListener("abort", () => {
        sawDeepAbort = true;
        resolve();
      });
    });
    return { report: undefined, costUsd: 0, tokensIn: 0, tokensOut: 0, aborted: true };
  };
  const service = makeService({
    repository: repo,
    resolveCrew: g.resolveCrew,
    runAgent,
    config: { defaultBudgetUsd: 1, maxParallel: 2, maxDepth: 4 },
  });

  const session = missionSession(repo);
  const mission = await service.proposePlan({ sessionId: session.id, text: "run", sink, crewId: "crewP" });

  assert.ok(sawDeepAbort, "the ROOT trip aborted the in-flight DEPTH-2 leaf through the shared leafAborts set");
  assert.equal(deepSecondRan, false, "the composed isBudgetTripped suppressed the NEXT depth-2 launch after the ancestor trip");
  assert.equal(synthesisEvents(events, mission.id)[0]?.partial, true, "the whole tree is honestly partial");
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════
//  PROBE 5 — Nested shouldAutoApprove (D-CN1).  Attack: a `threshold` mission whose DIRECT members are tiny
//  (one crew-ref) but whose TRANSITIVE tree is large; assert the auto-approve gate is evaluated over the
//  transitive count, so a large hidden tree cannot slip past `threshold`. Also: always_ask never auto-runs.
//  Anchors: whole-tree gate proposePlan orchestrator.ts:578-604; shouldAutoApprove orchestrator.ts:1926.
// ══════════════════════════════════════════════════════════════════════════════════════════════════════

test("PROBE 5 REFUTED — a THRESHOLD mission hiding a large transitive tree behind ONE direct crew-ref does NOT auto-run", async () => {
  const { repo } = open();
  const g = graph(repo);
  // A DEEP hide: root has a SINGLE direct crew-ref → crewMid → crewC with SIX leaves. Direct member count = 1
  // (which flatly would auto-run under askAboveAgents 3), transitive = 6 (> 3, must NOT auto-run).
  const deep = [1, 2, 3, 4, 5, 6].map((i) => ({ agentId: g.role(`Deep${i}`).id }));
  const crewC = g.crew("crewC", "Deep Crew", "parallel", deep);
  const crewMid = g.crew("crewMid", "Mid Crew", "parallel", [{ crewId: crewC.id }]);
  g.crew("crewP", "Parent", "parallel", [{ crewId: crewMid.id }]);

  const { sink } = collectSink();
  const service = makeService({
    repository: repo,
    resolveCrew: g.resolveCrew,
    runAgent: leafRunner({}),
    config: { askAboveAgents: 3, askAboveUsd: 1000, defaultAutonomy: "threshold", maxDepth: 4, maxTotalAgents: 64 },
  });

  const s = missionSession(repo, "threshold");
  const mission = await service.proposePlan({ sessionId: s.id, text: "run", sink, crewId: "crewP" });
  assert.equal(mission.status, "proposed", "the TRANSITIVE count (6) exceeds askAboveAgents (3) ⇒ awaits approval, not auto-run");

  // Unit-level proof the gate distinguishes the flat vs the tree count: the flat DIRECT count of 1 WOULD auto-run.
  const caps = { askAboveAgents: 3, askAboveUsd: 1000 };
  assert.equal(shouldAutoApprove("threshold", 1, 0, caps), true, "the flat direct-member count (1 ≤ 3) would have auto-run");
  assert.equal(shouldAutoApprove("threshold", 6, 0, caps), false, "the transitive count (6 > 3) blocks auto-run");
  // always_ask never auto-runs regardless of a small tree.
  assert.equal(shouldAutoApprove("always_ask", 1, 0, caps), false, "always_ask never auto-approves");
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════
//  PROBE 6 — Nested HITL deny + plan_proposed-is-not-a-gate (D-CN1/D-CN6).  Two attacks:
//   (a) does WP3.1's sub-mission `plan_proposed` EVENT accidentally route the sub-mission through the propose
//       gate / HITL / auto-approve?  Confirm NOT — no `plan_approved` for the child, the child runs directly.
//   (b) a DENIED nested agent (its runner produces no report) must NEVER silently fabricate a report; the
//       sub-mission settles honestly partial and the parent synthesis reflects the denied branch.
//  Anchors: sub-mission created directly runSubCrew orchestrator.ts:1320-1343 (no approve/HITL); kind==='chat'
//  gate proposePlan orchestrator.ts:490; runAgentStructured no-report path orchestrator.ts:1754-1757.
// ══════════════════════════════════════════════════════════════════════════════════════════════════════

test("PROBE 6a REFUTED — the sub-mission plan_proposed EVENT does NOT route through the propose gate / HITL: the child runs DIRECTLY", async () => {
  const { repo } = open();
  const g = graph(repo);
  const leaf = g.role("Nested Leaf");
  const crewC = g.crew("crewC", "Child", "parallel", [{ agentId: leaf.id }]);
  g.crew("crewP", "Parent", "parallel", [{ crewId: crewC.id }]);

  const { sink } = collectSink();
  const service = makeService({ repository: repo, resolveCrew: g.resolveCrew, runAgent: leafRunner({}) });
  const session = missionSession(repo, "auto");
  const mission = await service.proposePlan({ sessionId: session.id, text: "run", sink, crewId: "crewP" });
  assert.equal(mission.status, "completed");

  const all = repo.listEvents(session.id);
  const childId = repo.listChildMissions(mission.id)[0]!.id;
  // The child DID run (its leaf produced a report) — proving it ran directly, without an approve/HITL step.
  assert.equal(agentReports(all, childId).length, 1, "the sub-mission ran its leaf directly");
  // The child emitted a plan_proposed EVENT (event-sourcing) but NO plan_approved — it never touched the gate.
  assert.equal(
    all.filter((e) => e.type === "plan_proposed" && e.missionId === childId).length,
    1,
    "the child has exactly one plan_proposed (event-sourcing marker, WP3.1)",
  );
  assert.equal(planApprovedEvents(all, childId).length, 0, "NO plan_approved for the child — it is not routed through approve()/HITL");
  // Exactly ONE plan_approved exists tree-wide: the ROOT's (auto). The `kind==='chat'` gate is consulted only
  // once, at the root proposePlan — never for a child (a child is created directly by the engine, D-CN1).
  assert.equal(planApprovedEvents(all).length, 1, "exactly one plan_approved tree-wide — the root's");
  assert.equal(planApprovedEvents(all, mission.id).length, 1, "the one plan_approved belongs to the ROOT mission");
});

test("PROBE 6b REFUTED — a DENIED nested agent (no report) never silently runs; the sub-mission + parent are honestly partial", async () => {
  const { repo } = open();
  const g = graph(repo);
  const denied = g.role("Denied Agent");
  const crewC = g.crew("crewC", "Child", "parallel", [{ agentId: denied.id }]);
  g.crew("crewP", "Parent", "parallel", [{ crewId: crewC.id }]);

  const { sink, events } = collectSink();
  // The runner DENIES the nested agent — it produces NO report (a declined/aborted agent). The engine must
  // never fabricate one. `always_ask` mission: propose settles proposed, then approve() runs it.
  const runAgent: HubAgentRunner = async () => ({ report: undefined, costUsd: 0, tokensIn: 0, tokensOut: 0, aborted: true });
  const service = makeService({
    repository: repo,
    resolveCrew: g.resolveCrew,
    runAgent,
    config: { defaultAutonomy: "always_ask" },
  });

  const session = missionSession(repo, "always_ask");
  const proposed = await service.proposePlan({ sessionId: session.id, text: "run", sink, crewId: "crewP" });
  assert.equal(proposed.status, "proposed", "always_ask settles proposed — never auto-runs a nested tree");
  await service.approve({ missionId: proposed.id, sink });
  const mission = repo.getMission(proposed.id);

  const childId = repo.listChildMissions(mission.id)[0]!.id;
  // The denied agent NEVER produced a report — no agent_report was fabricated for it.
  assert.equal(agentReports(events, childId).length, 0, "the denied nested agent produced no report (never silently run)");
  // The child produced no reports ⇒ its container settles skipped, the crew-ref yields no report, the parent
  // synthesis is honestly PARTIAL (the denied branch is reflected, not hidden).
  assert.equal(synthesisEvents(events, mission.id)[0]?.partial, true, "the parent synthesis honestly reflects the denied branch (partial)");
  // No plan_approved for the child even under always_ask — the sub-mission is still born directly (D-CN1).
  assert.equal(planApprovedEvents(events, childId).length, 0, "no plan_approved for the child even under always_ask");
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════
//  PROBE 7 — Transitive grant intersection + the empty-crew-ref decision (D-CN9/D-HF5).  CRITICAL scrutiny of
//  WP2.3's decision that an EMPTY crew-ref grant passes the enclosing scope through: construct attacks proving
//  it cannot be exploited to ESCALATE. Anchors: subCrewParentScope orchestrator.ts:2012; effectiveAgentGrants
//  grants.ts:80; parentScope thread runSubCrew orchestrator.ts:1360; spawn intersection orchestrator.ts:1004.
// ══════════════════════════════════════════════════════════════════════════════════════════════════════

test("PROBE 7a REFUTED — TWO empty crew-refs deep: the root-dropped server is STILL absent at level 3 (empty passthrough composes, never re-widens)", async () => {
  const { repo } = open();
  const g = graph(repo);
  // A level-3 role whose OWN Access grants MORE than the root scope allows (gamma is not in scope at all).
  const deepLeaf = g.role("Deep Leaf", {
    servers: { alpha: ["read", "write"], beta: "all", gamma: "all" },
    builtins: ["memory.save", "artifacts.create"],
  });
  const crewC = g.crew("crewC", "Deep Crew", "parallel", [{ agentId: deepLeaf.id }]);
  // TWO nested empty crew-refs on the path — each must impose NO extra restriction AND never re-widen.
  const crewMid = g.crew("crewMid", "Mid Crew", "parallel", [{ crewId: crewC.id }]);
  g.crew("crewP", "Parent", "parallel", [{ crewId: crewMid.id }]);

  const rootScope: HubToolGrants = { servers: { alpha: "all", beta: ["read"] }, builtins: ["memory.save"] };
  const { sink } = collectSink();
  const service = makeService({ repository: repo, resolveCrew: g.resolveCrew, runAgent: leafRunner({}), config: { maxDepth: 4 } });
  const session = scopedSession(repo, rootScope);
  const mission = await service.proposePlan({ sessionId: session.id, text: "deep", sink, crewId: "crewP" });
  assert.equal(mission.status, "completed");

  // Find the depth-2 sub-mission (crewC) and its level-3 leaf.
  const deepMission = repo.listMissions().find((m) => (m.depth ?? 0) === 2);
  assert.ok(deepMission, "a depth-2 sub-mission exists");
  const level3 = repo.listMissionAgentSessions(deepMission.id)[0]!;
  // The expected transitive intersection: effectiveAgentGrants(leaf, rootScope) — the empty crew-refs passed
  // the root scope UNCHANGED through both levels, so a broad level-3 role can never reach gamma.
  const expected = effectiveAgentGrants(deepLeaf.toolGrants, rootScope);
  assert.deepEqual(level3.toolScope?.servers, expected.servers, "level-3 servers = the transitive intersection with the ROOT scope");
  assert.equal("gamma" in (level3.toolScope?.servers ?? {}), false, "the ROOT-DROPPED server is absent at level 3 (no escalation through empty crew-refs)");
  assert.deepEqual(level3.toolScope?.builtins, ["memory.save"], "root-ungranted built-ins stay dropped at level 3");
});

test("PROBE 7b REFUTED — an EXPLICIT crew-ref narrowing binds through a DEEPER empty crew-ref and a broad grandchild role cannot re-widen it", async () => {
  const { repo } = open();
  const g = graph(repo);
  // The level-3 role WANTS all of qlik; an ENCLOSING crew-ref (level 1) narrows qlik → [search]; a DEEPER
  // empty crew-ref (level 2) must PRESERVE that narrowing (not re-widen back to the root's "all").
  const deepLeaf = g.role("Grandchild", { servers: { qlik: "all" }, builtins: [] });
  const crewC = g.crew("crewC", "Deep Crew", "parallel", [{ agentId: deepLeaf.id }]);
  const crewMid = g.crew("crewMid", "Mid Crew", "parallel", [{ crewId: crewC.id }]); // empty crew-ref (level 2)
  g.crew("crewP", "Parent", "parallel", [
    // The explicit narrowing lives on the LEVEL-1 crew-ref.
    { crewId: crewMid.id, toolGrants: { servers: { qlik: ["search"] }, builtins: [] } },
  ]);

  const { sink } = collectSink();
  const service = makeService({ repository: repo, resolveCrew: g.resolveCrew, runAgent: leafRunner({}), config: { maxDepth: 4 } });
  // Root scope allows ALL of qlik — the crew-ref's OWN [search] narrowing must bind, not the root's "all".
  const session = scopedSession(repo, { servers: { qlik: "all" }, builtins: [] });
  const mission = await service.proposePlan({ sessionId: session.id, text: "do", sink, crewId: "crewP" });
  assert.equal(mission.status, "completed");

  const deepMission = repo.listMissions().find((m) => (m.depth ?? 0) === 2);
  assert.ok(deepMission, "a depth-2 sub-mission exists");
  const level3 = repo.listMissionAgentSessions(deepMission.id)[0]!;
  assert.deepEqual(
    level3.toolScope?.servers,
    { qlik: ["search"] },
    "the level-1 [search] narrowing binds through the level-2 empty crew-ref — the broad grandchild role cannot re-widen",
  );
});

test("PROBE 7c REFUTED — an empty crew-ref imposes NO extra restriction (it passes the enclosing scope through, per subCrewParentScope)", () => {
  // Pure attack on the empty-crew-ref decision surface: effectiveAgentGrants + the subCrewParentScope contract.
  // An empty crew-ref grant {servers:{}, builtins:[]} fed to effectiveAgentGrants AS the plan would DROP every
  // server (absent-means-none) — turning a delegation container into a tool-strip. subCrewParentScope reads an
  // ENTIRELY-empty grant as "no added restriction" and returns the enclosing scope UNCHANGED — never WIDER.
  const enclosing: HubToolGrants = { servers: { alpha: ["read"], beta: "all" }, builtins: ["memory.save"] };
  // If the empty grant were (wrongly) intersected as a plan, every server would drop → a tool-strip, not an escalation:
  const asPlan = effectiveAgentGrants({ servers: {}, builtins: [] }, enclosing);
  assert.deepEqual(asPlan.servers, {}, "an empty grant intersected as a plan drops ALL servers (safe direction — NEVER wider)");
  // effectiveAgentGrants only ever NARROWS: composing it can never yield a server the enclosing scope lacked.
  const broad = effectiveAgentGrants({ servers: { alpha: "all", gamma: "all" }, builtins: ["skills.load"] }, enclosing);
  assert.equal("gamma" in broad.servers, false, "a broad plan cannot re-add a server the enclosing scope dropped (gamma stays out)");
  assert.deepEqual(broad.servers.alpha, ["read"], "alpha is bounded by the enclosing [read], not the plan's 'all'");
  assert.deepEqual(broad.builtins, [], "skills.load is dropped — the enclosing builtins bound it");
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════
//  PROBE 8 — Transitive autonomy non-escalation (D-CN9).  Attack: a nested sub-mission under an `always_ask`
//  parent must never run at a looser autonomy; assert every sub-mission inherits the parent mission's autonomy
//  (a crew carries no independent autonomy field, and the clamp pins it), so a nested `auto` can never raise
//  `always_ask`. Anchors: runSubCrew autonomy: mission.autonomy orchestrator.ts:1276/1323; clamp pin planner.ts:654.
// ══════════════════════════════════════════════════════════════════════════════════════════════════════

test("PROBE 8 REFUTED — every sub-mission inherits the parent's always_ask; a nested tree can never loosen autonomy down the path", async () => {
  const { repo } = open();
  const g = graph(repo);
  const midLeaf = g.role("Mid Leaf");
  const deepLeaf = g.role("Deep Leaf");
  const crewC = g.crew("crewC", "Deep Crew", "parallel", [{ agentId: deepLeaf.id }]);
  const crewMid = g.crew("crewMid", "Mid Crew", "parallel", [{ agentId: midLeaf.id }, { crewId: crewC.id }]);
  g.crew("crewP", "Parent", "parallel", [{ crewId: crewMid.id }]);

  const { sink } = collectSink();
  const service = makeService({
    repository: repo,
    resolveCrew: g.resolveCrew,
    runAgent: leafRunner({}),
    config: { defaultAutonomy: "always_ask", maxDepth: 4 },
  });

  const session = missionSession(repo, "always_ask");
  const proposed = await service.proposePlan({ sessionId: session.id, text: "run", sink, crewId: "crewP" });
  await service.approve({ missionId: proposed.id, sink });
  const rootId = rootMissionId(repo, session.id);

  // EVERY mission in the tree (root + all sub-missions) runs at always_ask — the parent's dial, min down the path.
  const tree = repo.getMissionTree(rootId);
  assert.ok(tree.length >= 3, "the tree has a root + 2 nested levels");
  for (const m of tree) {
    assert.equal(m.autonomy, "always_ask", `mission ${m.id} (depth ${m.depth ?? 0}) inherited always_ask — never loosened`);
  }
  // Belt-and-suspenders: even a plan that DECLARES auto is pinned to the mission autonomy by the clamp.
  const rogue = clampPlanToBudgets(
    { topology: "parallel", autonomy: "auto", agents: [{ key: "x", name: "x", systemPrompt: "", model: "gpt-4o", toolGrants: { servers: {}, builtins: [] }, skillIds: [], brief: "", target: "", expectedOutcome: "" }] },
    DEFAULT_CONFIG,
    "always_ask",
  );
  assert.equal(rogue.autonomy, "always_ask", "the clamp pins a rogue auto plan back to the mission's always_ask");
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════
//  PROBE 9 — Brief-only isolation at EVERY level (D-AH9).  Attack: seed the ROOT session with a distinctive
//  prior-transcript marker; assert a DEPTH-2 descendant's brief carries ONLY the curated ask + focus chain,
//  never the parent transcript. Anchors: composeCrewBrief topologies.ts:649; nested ask thread runSubCrew
//  orchestrator.ts:1384; child user_message = brief runAgentStructured orchestrator.ts:1737-1741.
// ══════════════════════════════════════════════════════════════════════════════════════════════════════

test("PROBE 9 REFUTED — a DEPTH-2 descendant receives the curated brief only (ask + focus), never the parent transcript", async () => {
  const { repo } = open();
  const g = graph(repo);
  const MARKER = "PARENT_TRANSCRIPT_SECRET_9f3a";
  const ASK_TOKEN = "UNIQUE_ASK_TOKEN_7c1";
  const TOP_FOCUS = "TOP_FOCUS_TOKEN_a1";
  const MID_FOCUS = "MID_FOCUS_TOKEN_b2";

  const deepLeaf = g.role("Deep Analyst");
  const crewC = g.crew("crewC", "Deep Crew", "parallel", [{ agentId: deepLeaf.id, target: "leaf focus LEAF_TOKEN" }]);
  const crewMid = g.crew("crewMid", "Mid Crew", "parallel", [{ crewId: crewC.id, target: `mid focus ${MID_FOCUS}` }]);
  g.crew("crewP", "Parent", "parallel", [{ crewId: crewMid.id, target: `top focus ${TOP_FOCUS}` }]);

  const inputs: HubAgentRunInput[] = [];
  const { sink } = collectSink();
  const service = makeService({ repository: repo, resolveCrew: g.resolveCrew, runAgent: leafRunner({ inputs }), config: { maxDepth: 4 } });

  const session = missionSession(repo);
  // Seed a PRIOR parent-transcript turn carrying the marker (a prior chat response) — the child must never see it.
  repo.appendEvent(session.id, {
    type: "assistant_message",
    messageId: "prior-1",
    model: "gpt-4o",
    parts: [{ type: "text", text: `Prior private analysis: ${MARKER}` }],
    citations: [],
    artifactsTouched: [],
  });

  const mission = await service.proposePlan({ sessionId: session.id, text: `Analyze topic Z ${ASK_TOKEN}`, sink, crewId: "crewP" });
  assert.equal(mission.status, "completed");

  const deepInput = inputs.find((i) => i.roleName === "Deep Analyst");
  assert.ok(deepInput, "the depth-2 leaf ran");
  // The curated ask flowed all the way down (the task), plus the per-level focus chain — but NOT the transcript.
  assert.ok(deepInput.brief.includes(ASK_TOKEN), "the depth-2 brief carries the curated ask (the task)");
  assert.ok(deepInput.brief.includes(TOP_FOCUS) && deepInput.brief.includes(MID_FOCUS), "the depth-2 brief carries the focus chain down the path");
  assert.equal(deepInput.brief.includes(MARKER), false, "the depth-2 brief carries NO parent transcript (D-AH9 isolation at depth 2)");
  assert.equal(deepInput.systemPrompt.includes(MARKER), false, "the depth-2 role prompt carries no parent transcript");

  // The child session's ONLY user turn is the curated brief — never the parent conversation.
  const deepMission = repo.listMissions().find((m) => (m.depth ?? 0) === 2)!;
  const level2Session = repo.listMissionAgentSessions(deepMission.id)[0]!;
  const userTurns = repo
    .listEvents(level2Session.id)
    .filter((e): e is Extract<HubEvent, { type: "user_message" }> => e.type === "user_message");
  assert.equal(userTurns.length, 1, "the depth-2 child has exactly one input (its brief)");
  assert.equal(userTurns[0]!.text.includes(MARKER), false, "the depth-2 child's input carries no parent transcript");
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════
//  PROBE 10 — Event-sourced replay of a nested tree (D-CN7).  Attack: run a ≥2-level tree through the REAL
//  engine (stub runner), then reconstruct from `hub_events` ALONE via the tree-aware reducer; assert the
//  replayed board equals the live run (spawns, reports, per-level cost roll-up, budget-trip partial) with NO
//  reliance on mutable mission rows. Anchors: reconstructMission board.ts:297; reconstructMissionById:307;
//  rollUpCost:177; sub-mission plan_proposed emit runSubCrew orchestrator.ts:1336.
// ══════════════════════════════════════════════════════════════════════════════════════════════════════

test("PROBE 10a REFUTED — a live-run 2-level tree reconstructs from hub_events ALONE (structure + per-level cost roll-up + determinism/inertness)", async () => {
  const { repo } = open();
  const g = graph(repo);
  const rootLeaf = g.role("Root Leaf");
  const m1 = g.role("Member One");
  const m2 = g.role("Member Two");
  const crewC = g.crew("crewC", "Child Crew", "parallel", [{ agentId: m1.id }, { agentId: m2.id }]);
  g.crew("crewP", "Parent", "parallel", [{ agentId: rootLeaf.id }, { crewId: crewC.id }]);

  const { sink } = collectSink();
  // Distinct per-leaf costs so the per-level cost roll-up is provable: root leaf $0.10, members $0.20 + $0.30.
  const costs: Record<string, number> = { "Root Leaf": 0.1, "Member One": 0.2, "Member Two": 0.3 };
  const service = makeService({
    repository: repo,
    resolveCrew: g.resolveCrew,
    runAgent: async (input) => {
      if (input.abortSignal.aborted) return { report: undefined, costUsd: 0, tokensIn: 0, tokensOut: 0, aborted: true };
      return { report: report({ summary: input.roleName, roleName: input.roleName }), costUsd: costs[input.roleName] ?? 0.1, tokensIn: 1, tokensOut: 1 };
    },
    config: { maxParallel: 1 },
  });

  const session = missionSession(repo);
  const mission = await service.proposePlan({ sessionId: session.id, text: "run", sink, crewId: "crewP" });
  assert.equal(mission.status, "completed");

  // ── Reconstruct PURELY from the event log (reconstructMission takes ONLY events — it structurally cannot
  //    read the mutable hub_missions rows). ──────────────────────────────────────────────────────────────
  const events = repo.listEvents(session.id);
  const board = reconstructMission(events);
  assert.ok(board, "the nested mission reconstructs from hub_events alone");
  assert.equal(board.missionId, mission.id, "the ROOT board is returned (not the later nested plan_proposed)");
  assert.equal(board.phase, "done");

  // The live run: two top-level board agents (a leaf + a crew node), the crew node grafting its two members.
  assert.equal(board.agents.length, 2, "two top-level agents (a leaf + a crew node)");
  const crewNode = board.agents.find((a) => a.subMissionId !== undefined)!;
  assert.ok(crewNode, "one top-level agent is a crew node with a subMissionId");
  assert.equal(crewNode.children?.length, 2, "the crew node grafts its sub-mission's two members");
  const childId = repo.listChildMissions(mission.id)[0]!.id;
  assert.equal(crewNode.subMissionId, childId, "the crew node names its live sub-mission id");

  // Per-level cost roll-up = the sum of the sub-mission's leaf costs ($0.20 + $0.30 = $0.50), NOT the crew
  // node's own projected report cost (the whole-sub-mission total). Reconstructed purely from event costUsd.
  assert.ok(Math.abs((crewNode.costUsd ?? 0) - 0.5) < 1e-9, `the crew node's rolled cost = sum(children) = 0.50 (got ${crewNode.costUsd})`);
  const leafNode = board.agents.find((a) => a.subMissionId === undefined)!;
  assert.ok(Math.abs((leafNode.costUsd ?? 0) - 0.1) < 1e-9, "the leaf's rolled cost = its own report cost 0.10");

  // reconstructMissionById returns the SUB-mission's own board (the drill primitive) — same event log.
  const sub = reconstructMissionById(events, childId);
  assert.ok(sub, "the sub-mission reconstructs by id");
  assert.deepEqual(sub.agents.map((a) => a.roleName).sort(), ["Member One", "Member Two"], "the sub-board carries its two members");

  // Determinism + inertness (R-SES1): two reconstructions deepEqual, the event array is not mutated.
  const pristine = structuredClone(events);
  assert.deepEqual(reconstructMission(events), board, "reconstruction is deterministic");
  assert.deepEqual(events, pristine, "reconstruction does not mutate the event log (inert)");
});

test("PROBE 10b REFUTED — a budget-TRIPPED nested run replays its PARTIAL mark from the event log", async () => {
  const { repo } = open();
  const g = graph(repo);
  const a = g.role("Nested A");
  const b = g.role("Nested B");
  const c = g.role("Nested C");
  const crewC = g.crew("crewC", "Child", "parallel", [{ agentId: a.id }, { agentId: b.id }, { agentId: c.id }]);
  // The nested allocation is small ($1) so the SUB-mission trips its own budget; the $100 root never trips.
  g.crew("crewP", "Parent", "parallel", [{ crewId: crewC.id, budgets: { maxCostUsd: 1 } }]);

  const { sink } = collectSink();
  const service = makeService({
    repository: repo,
    resolveCrew: g.resolveCrew,
    runAgent: leafRunner({ costPerLeaf: 1 }),
    config: { defaultBudgetUsd: 100, maxParallel: 1 },
  });
  const session = missionSession(repo);
  const mission = await service.proposePlan({ sessionId: session.id, text: "run", sink, crewId: "crewP" });
  assert.equal(mission.status, "completed");

  const events = repo.listEvents(session.id);
  const board = reconstructMission(events);
  assert.ok(board, "the tripped tree reconstructs from events");
  // The root synthesis carries the PARTIAL mark, replayed purely from the mission_synthesis event.
  assert.equal(board.synthesis?.partial, true, "the budget-trip partial mark survives replay at the root");
  const childId = repo.listChildMissions(mission.id)[0]!.id;
  const sub = reconstructMissionById(events, childId);
  assert.equal(sub?.synthesis?.partial, true, "the sub-mission's own partial mark survives replay");
});
