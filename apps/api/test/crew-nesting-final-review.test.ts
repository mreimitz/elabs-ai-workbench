// Crew nesting (planning/Roadmap/RM-10-crew-nesting/, WP5.R · D-CN10 refute doctrine · README §6 invariants) — the
// FINAL, WHOLE-FEATURE adversarial refute-review, run end-to-end across the fully-integrated feature
// (execution engine + board/replay + report), AFTER every Phase 2-4 WP landed (2.1/2.2/2.3/2.R,
// 3.1/3.2, 4.1/4.2/4.3). This is the D-CN10 close-out capstone — it (a) re-runs every invariant `2.R`
// refuted against the NOW-integrated code to prove Phases 3-4 introduced no regression (P-REG1), and
// (b) mounts the invariants only reachable once the whole tree is assembled (whole-tree budget
// aggregation at depth >= 2, best-of-N judge blindness across levels, per-subtree topology fidelity,
// nested-tree replay-from-events, domain isolation, legacy-flat report fidelity).
//
// It is NOT a summary pass: each probe below is a CONCRETE ATTACK — a branchy depth-2 tree, a
// save-then-mutate cycle, a zero-allocation child, a nested `auto` crew, an empty-crew-ref grant, a
// nested unready server, a nested best_of_n whose result flows into a parent judge — mounted as a
// DETERMINISTIC test that either fails to break the system (→ the invariant holds, REFUTED) or succeeds
// (→ a FINDING, kept as a `.skip`/xtest with a `// FINDING:` comment so the gate stays green). Every
// probe drives the SAME injectable stub-runner seam `hub-crew-nesting-wp2r-review.test.ts` uses — NO
// provider key, NO real child process, NO MCP server, NO live child spawn. The verdict for each probe
// is recorded in `planning/Roadmap/RM-10-crew-nesting/phase-5-close/5.R-review.md` with the product `file:line` it
// refutes against.
//
// The probe set (the WP-5.R-final-review.md ledger — every one gets an explicit verdict, none "n/a"):
//   P-BUD1 whole-tree budget aggregation (D-CN3)      P-GRA1 transitive grant intersection (D-CN9)
//   P-BUD2 BUG-4 recurrence, shared accumulator (INV4) P-GRA2 missionUnreadyServers recursion (D-CN9)
//   P-BUD3 cascading trip abort at depth 2 (D-CN3)     P-SCOPE1 frozen scope vocabulary (D-CN9)
//   P-BUD4 zero-alloc != unlimited (D-CN3)             P-ISO1 brief-only isolation at every level (D-CN9)
//   P-CYC1 author-time cycle/exists/depth (D-CN4)      P-TOPO1 per-subtree topology fidelity (D-CN2)
//   P-CYC2 run-time cycle guard (D-CN4)                P-TOPO2 best-of-N judge blindness across levels
//   P-CYC3 depth cap + total-agent backstop (D-CN10)   P-REP1 nested-tree replay-from-events (D-CN7)
//   P-GATE1 no propose-gate relaxation (D-CN1)         P-REP2 domain isolation + additive lineage (D-CN6)
//   P-HITL1 nested shouldAutoApprove over the tree     P-REP3 legacy flat mission unchanged (WP3.2)
//   P-HITL2 nested HITL deny-never-runs                P-REG1 no Phase 3-4 regression (re-run 2.R)
//   P-AUT1 transitive autonomy non-escalation (D-CN9)

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import {
  ASSISTANT_ENTITY_KINDS,
  HUB_MISSION_MAX_DEPTH,
  HUB_MISSION_MAX_TOTAL_AGENTS,
  SCOPE_EXEMPT_ACTION_TOOLS,
  SCOPE_WRITE_TOOLS,
  type HubAgentReport,
  type HubAgentRole,
  type HubAgentRoleInput,
  type HubCrew,
  type HubCrewMember,
  type HubEvent,
  type HubToolGrants,
  type HubTopology,
} from "@mcp-token-footprint/shared";
import { applyMigrations, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { HubRepository } from "../src/hub/repository.js";
import type { HubTurnSink } from "../src/hub/turn-engine.js";
import { assertCrewGraphValid } from "../src/hub/missions/crew-resolution.js";
import { reconstructMission, reconstructMissionById } from "../src/hub/missions/board.js";
import { buildMissionTraceForest } from "../src/hub/mission-trace.js";
import { buildHubSessionJsonReport, buildHubSessionMarkdownReport } from "../src/hub/session-report.js";
import { effectiveAgentGrants } from "../src/hub/tools/grants.js";
import { DEFAULT_CHAT_BUILTIN_NAMES, missionProposePlan } from "../src/hub/tools/builtins/index.js";
import {
  allocateChildBudget,
  HubMissionService,
  shouldAutoApprove,
  type HubAgentRunInput,
  type HubAgentRunner,
  type HubJudge,
  type HubJudgeAttempt,
  type HubMissionServiceConfig,
  type HubPlanner,
  type HubResolvedCrew,
  type HubSynthesizer,
} from "../src/hub/missions/index.js";

// ── Harness (extends hub-crew-nesting-wp2r-review.test.ts with an injectable `judge` seam) ─────────────

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
  maxAgents: 24,
  maxParallel: 3,
  defaultBudgetUsd: 100,
  maxBudgetUsd: 500,
  askAboveAgents: 50,
  askAboveUsd: 1000,
  defaultAutonomy: "auto",
  maxDepth: 4,
  maxTotalAgents: 64,
};

const synthesizerFree: HubSynthesizer = async () => ({
  text: "Combined synthesis.",
  usage: { tokensIn: 5, tokensOut: 5 },
  costUsd: 0,
});

const plannerNever: HubPlanner = async () => {
  throw new Error("the planner must never run on a crew-instantiation path");
};

/** Hand-built crew-graph substrate so a cyclic / over-depth / over-cap graph can be injected AFTER save
 *  (the D-CN4 run-time guard's "graph mutated between save and run" attack). A member may carry a
 *  `toolGrants` override (the scope probes). Mirrors the 2.R harness verbatim. */
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
  judge?: HubJudge;
  synthesizer?: HubSynthesizer;
  logger?: { warn?: (msg: string) => void };
}): HubMissionService {
  return new HubMissionService({
    repository: over.repository,
    planner: plannerNever,
    runAgent: over.runAgent,
    synthesizer: over.synthesizer ?? synthesizerFree,
    resolveCrew: over.resolveCrew,
    config: { ...DEFAULT_CONFIG, ...over.config },
    ...(over.isServerRunReady ? { isServerRunReady: over.isServerRunReady } : {}),
    ...(over.judge ? { judge: over.judge } : {}),
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

/** A leaf runner returning a report (structured mode). Records invocations by role name, the FULL input
 *  (brief-isolation + pipeline-handoff probes), and the returned cost. */
function leafRunner(opts: {
  costPerLeaf?: number;
  reportFor?: (roleName: string) => HubAgentReport;
  invocations?: string[];
  inputs?: HubAgentRunInput[];
}): HubAgentRunner {
  return async (input: HubAgentRunInput) => {
    if (input.abortSignal.aborted) return { report: undefined, costUsd: 0, tokensIn: 0, tokensOut: 0, aborted: true };
    opts.invocations?.push(input.roleName);
    opts.inputs?.push(input);
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
function errorEvents(events: HubEvent[]) {
  return events.filter((e): e is Extract<HubEvent, { type: "error" }> => e.type === "error");
}

/** The ROOT mission for a session (no `parentMissionId`) — NOT `getMissionBySession` (DESC-LIMIT-1 under a
 *  fixed clock can tie-return a sub-mission). */
function rootMissionId(repo: HubRepository, sessionId: string): string {
  const root = repo.listMissions().find((m) => m.sessionId === sessionId && m.parentMissionId === undefined);
  assert.ok(root, "the root mission exists");
  return root.id;
}

function sessionRowCount(db: AppDatabase): number {
  return (db.prepare("SELECT COUNT(*) AS c FROM hub_sessions").get() as { c: number }).c;
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════════
//  P-BUD1 — Whole-tree budget aggregation (D-CN3).  Attack: a BRANCHY depth-2 tree — root `parallel` of 3
//  `pipeline` sub-crews, each nesting a `parallel` sub-crew at DEPTH 2 (12 leaves total). Assert the
//  aggregate whole-tree spend <= root min(requested, HUB_MISSION_MAX_BUDGET_USD); no descendant re-reads
//  caps.maxBudgetUsd (a child NAMING the env ceiling gets min(requested, parentRemaining), never $500).
//  Anchors: allocateChildBudget planner.ts:359; at-spawn reservation runSubCrew orchestrator.ts:1298-1303;
//  shared accumulator+trip orchestrator.ts:1197-1201; root clamp planner.ts:648.
// ══════════════════════════════════════════════════════════════════════════════════════════════════════

/** Build a branchy depth-2 tree: root `parallel` of `branches` `pipeline` sub-crews, each = 2 leaves + a
 *  DEPTH-2 `parallel` sub-crew of 2 leaves. Returns the number of leaves. `branchBudget` (when given) is
 *  named on each ROOT crew-ref so the sibling branches each get a fair share (a crew-ref naming NO budget
 *  inherits the WHOLE parent remaining, starving its siblings — the intentional D-CN3 cascade); `deepBudget`
 *  is named on each depth-2 crew-ref. */
function buildBranchyDepth2Tree(
  g: ReturnType<typeof graph>,
  branches: number,
  opts: { branchBudget?: number; deepBudget?: number } = {},
): number {
  let leaves = 0;
  const rootMembers: HubCrewMember[] = [];
  for (let b = 0; b < branches; b++) {
    const deepLeaves = [1, 2].map((i) => ({ agentId: g.role(`B${b}-Deep${i}`).id }));
    leaves += 2;
    const deepCrew = g.crew(`crewDeep${b}`, `Deep ${b}`, "parallel", deepLeaves);
    const midLeaves = [1, 2].map((i) => ({ agentId: g.role(`B${b}-Mid${i}`).id }));
    leaves += 2;
    const midCrew = g.crew(`crewMid${b}`, `Mid ${b}`, "pipeline", [
      ...midLeaves,
      { crewId: deepCrew.id, ...(opts.deepBudget !== undefined ? { budgets: { maxCostUsd: opts.deepBudget } } : {}) },
    ]);
    rootMembers.push({ crewId: midCrew.id, ...(opts.branchBudget !== undefined ? { budgets: { maxCostUsd: opts.branchBudget } } : {}) });
  }
  g.crew("crewRoot", "Root", "parallel", rootMembers);
  return leaves;
}

test("P-BUD1 REFUTED — a branchy DEPTH-2 tree (3 pipelines × a depth-2 parallel, 12 leaves) aggregates <= the root ceiling", async () => {
  const { repo } = open();
  const g = graph(repo);
  // Each root branch NAMES a $30 fair share (3 × $30 = $90 ≤ the $100 root cap) so all three run; without a
  // named budget the first branch inherits the whole pool and starves its siblings (the D-CN3 cascade).
  const leafCount = buildBranchyDepth2Tree(g, 3, { branchBudget: 30 });
  assert.equal(leafCount, 12, "the tree has 12 leaves across 3 branches at depth 2");

  const invocations: string[] = [];
  const { sink } = collectSink();
  // A generous root cap ($100) so the WHOLE tree runs; each leaf $1 ⇒ aggregate $12. maxParallel 1 so the
  // deterministic ordering is provable. maxDepth 4 so a depth-2 sub-mission actually runs.
  const service = makeService({
    repository: repo,
    resolveCrew: g.resolveCrew,
    runAgent: leafRunner({ costPerLeaf: 1, invocations }),
    config: { defaultBudgetUsd: 100, maxBudgetUsd: 500, maxParallel: 1, maxDepth: 4, maxTotalAgents: 64 },
  });

  const session = missionSession(repo);
  const mission = await service.proposePlan({ sessionId: session.id, text: "run", sink, crewId: "crewRoot" });
  assert.equal(mission.status, "completed");

  const rootId = rootMissionId(repo, session.id);
  const root = repo.getMission(rootId);
  const ceiling = Math.min(100, 500); // the root clamp: min(requested, maxBudgetUsd) — planner.ts:648
  // A DEPTH-2 sub-mission really ran (proving whole-tree aggregation reaches depth 2, not a flat sum).
  assert.ok(repo.listMissions().some((m) => (m.depth ?? 0) === 2), "a depth-2 sub-mission ran");
  // Every one of the 12 leaves ran (the tree fit the ceiling) and the settled whole-tree cost is the leaf
  // sum ($12, the 0-cost synthesizer + no judge), which is <= the root ceiling.
  assert.equal(invocations.length, 12, "all 12 leaves ran within the ceiling");
  assert.ok((root.costUsd ?? 0) <= ceiling + 1e-9, `whole-tree spend ${root.costUsd} <= root ceiling ${ceiling}`);
  assert.ok(Math.abs((root.costUsd ?? 0) - 12) < 1e-9, "whole-tree spend = the 12-leaf sum ($12)");
});

test("P-BUD1 REFUTED — a TIGHT root ceiling bounds the whole tree even when depth-1 AND depth-2 children NAME the env ceiling ($500)", async () => {
  const { repo } = open();
  const g = graph(repo);
  // Depth-2 sub-crews each NAME maxCostUsd = 500 (EXACTLY caps.maxBudgetUsd). If any descendant re-read the
  // env cap it would get $500 and blow the $6 root ceiling; the monotone cascade bounds it to parentRemaining.
  buildBranchyDepth2Tree(g, 3, { deepBudget: 500 });

  const invocations: string[] = [];
  const { sink } = collectSink();
  const service = makeService({
    repository: repo,
    resolveCrew: g.resolveCrew,
    runAgent: leafRunner({ costPerLeaf: 1, invocations }),
    // Root cap $6 (defaultBudgetUsd), env ceiling $500. At most ~6 leaves may run tree-wide.
    config: { defaultBudgetUsd: 6, maxBudgetUsd: 500, maxParallel: 1, maxDepth: 4, maxTotalAgents: 64 },
  });

  const session = missionSession(repo);
  const mission = await service.proposePlan({ sessionId: session.id, text: "run", sink, crewId: "crewRoot" });
  assert.equal(mission.status, "completed");
  const root = repo.getMission(rootMissionId(repo, session.id));
  // Bounded by the $6 ROOT ceiling, never the $500 the depth-2 children named. maxParallel 1 ⇒ the single
  // leaf that crosses the cap is the only overshoot (identical to a flat mission's trip, never amplified).
  assert.ok(invocations.length <= 6, `aggregate leaves ${invocations.length} bounded by the $6 root ceiling, not $500`);
  assert.ok((root.costUsd ?? 0) <= 6.000001, `whole-tree spend ${root.costUsd} <= the $6 root ceiling`);
});

test("P-BUD1 REFUTED — allocateChildBudget takes NO caps argument (structurally cannot re-read an env ceiling below the root)", () => {
  // The monotone primitive: min(requested, parentRemaining), floored at 0. It has no `caps` parameter, so a
  // descendant naming the env ceiling ($500) gets the parent's remaining ($2), not $500 re-read from env.
  assert.equal(allocateChildBudget(500, 2), 2, "a child naming the env ceiling is bounded to parentRemaining");
  assert.equal(allocateChildBudget(1000, 4), 4, "a child request above the pool is clamped to the pool");
  assert.equal(allocateChildBudget(1, 4), 1, "a child request under the pool passes through");
  assert.equal(allocateChildBudget.length, 2, "the primitive has exactly two params — no `caps` arg exists to re-read");
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════
//  P-BUD2 — BUG-4 recurrence / INV4 (shared cumulative accumulator).  Attack: a nested level with
//  `maxParallel >= agentCount` so ALL its leaves launch in ONE wave (the exact BUG-4 condition that made a
//  per-slot between-launch trip inert). Assert the SHARED cumulative accumulator (threaded via
//  TopologyContext, not a fresh per-mission closure) STILL trips the sub-mission's budget after the leaves
//  settle, and the branch is marked honest-partial. Anchors: shared accumulator runtime.cost
//  orchestrator.ts:364-374/1197; composed isTripped makeLevelBudget orchestrator.ts:222; post-settle
//  partial runMissionLevel orchestrator.ts:1085.
// ══════════════════════════════════════════════════════════════════════════════════════════════════════

test("P-BUD2 REFUTED — a nested wave with maxParallel >= agentCount still trips on the SHARED accumulator (BUG-4 inertness refuted)", async () => {
  const { repo } = open();
  const g = graph(repo);
  const leaves = [1, 2, 3, 4].map((i) => ({ agentId: g.role(`W${i}`).id }));
  const crewC = g.crew("crewC", "Wave Crew", "parallel", leaves);
  // The crew-ref names a $2 budget; its 4 leaves cost $1 each. maxParallel 8 >= 4 ⇒ all four launch in ONE
  // wave (the BUG-4 condition). A fresh-per-wave trip would be inert; the shared cumulative accumulator + the
  // post-settle partial mark must still fire.
  g.crew("crewP", "Parent", "parallel", [{ crewId: crewC.id, budgets: { maxCostUsd: 2 } }]);

  const invocations: string[] = [];
  const { sink, events } = collectSink();
  const service = makeService({
    repository: repo,
    resolveCrew: g.resolveCrew,
    runAgent: leafRunner({ costPerLeaf: 1, invocations }),
    config: { defaultBudgetUsd: 100, maxParallel: 8, maxDepth: 4 },
  });

  const session = missionSession(repo);
  const mission = await service.proposePlan({ sessionId: session.id, text: "run", sink, crewId: "crewP" });
  assert.equal(mission.status, "completed");

  // All 4 leaves launched (the wave) — this IS the BUG-4 posture.
  assert.equal(invocations.length, 4, "all four leaves launched in one wave (maxParallel 8 >= 4)");
  // Despite the wave, the sub-mission's $2 budget TRIPPED (spent $4 >= cap $2) and the branch is honestly
  // partial — the shared cumulative accumulator recorded the whole wave, the trip was NOT inert.
  const subMission = repo.listMissions().find((m) => (m.depth ?? 0) === 1);
  assert.ok(subMission, "the sub-mission exists");
  assert.equal(synthesisEvents(events, subMission.id)[0]?.partial, true, "the sub-mission is honestly partial (its own budget tripped)");
  assert.equal(synthesisEvents(events, mission.id)[0]?.partial, true, "the partial propagates to the root synthesis");
  assert.ok((subMission.costUsd ?? 0) >= 4 - 1e-9, "the shared accumulator recorded the WHOLE wave ($4), not a per-slot reset");
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════
//  P-BUD3 — Cascading trip abort at DEPTH 2 (D-CN3).  Attack: force a ROOT budget trip WHILE a DEPTH-2
//  descendant leaf is in flight; assert the SHARED abort halts the in-flight depth-2 leaf (not a fresh
//  AbortController per level), the next depth-2 launch is suppressed, and the tree settles honest-partial
//  (a trip is a PARTIAL, never "stopped"). Also regression-guards BUG-4 (maxParallel >= agentCount per
//  level). Anchors: shared leafAborts orchestrator.ts:903/1170, tripBudget:911-913; composed isTripped:222.
// ══════════════════════════════════════════════════════════════════════════════════════════════════════

test("P-BUD3 REFUTED — a ROOT trip aborts an in-flight DEPTH-2 leaf via the SHARED abort AND suppresses the next depth-2 launch", async () => {
  const { repo } = open();
  const g = graph(repo);
  const rootLeaf = g.role("Root Leaf");
  const deepBlocker = g.role("Deep Blocker");
  const deepSecond = g.role("Deep Second");
  // maxParallel 2 >= each level's agent count (BUG-4 posture).
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
    // Deep Blocker (depth 2): announce in-flight, then block until an ANCESTOR (root) trip aborts it.
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
  assert.ok(sawDeepAbort, "the ROOT trip aborted the in-flight DEPTH-2 leaf through the SHARED leafAborts set");
  assert.equal(deepSecondRan, false, "the composed isBudgetTripped suppressed the NEXT depth-2 launch after the ancestor trip");
  assert.equal(synthesisEvents(events, mission.id)[0]?.partial, true, "the whole tree is honestly partial (a trip, not stopped)");
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════
//  P-BUD4 — Zero-alloc != unlimited (D-CN3).  Attack: hand a child a 0/exhausted remaining allocation;
//  assert it is treated as DENY (skipped, never spawned), never "unlimited". Anchors: childCap<=0 guard
//  runSubCrew orchestrator.ts:1308-1315; the `budget.cap > 0` leaf guard orchestrator.ts:1201.
// ══════════════════════════════════════════════════════════════════════════════════════════════════════

test("P-BUD4 REFUTED — a sub-crew handed a 0 allocation (parent pool exhausted) is SKIPPED, never treated as unlimited", async () => {
  const { repo } = open();
  const g = graph(repo);
  const firstLeaves = [1, 2].map((i) => ({ agentId: g.role(`First${i}`).id }));
  const secondLeaves = [1, 2, 3].map((i) => ({ agentId: g.role(`Second${i}`).id }));
  const crewFirst = g.crew("crewFirst", "First", "parallel", firstLeaves);
  const crewSecond = g.crew("crewSecond", "Second", "parallel", secondLeaves);
  // Root cap $2. The first crew-ref RESERVES the whole $2 pool (min(2, 2) = 2), but its leaves are CHEAP
  // ($0.1 each ⇒ $0.2 spent) so the root NEVER trips — the pool is exhausted by RESERVATION, not by spend.
  // The second crew-ref then reaches runSubCrew with reservable 0 → childCap = 0 → the childCap<=0 DENY path
  // (skipped + a loud "budget exhausted" warn), the exact "zero-alloc != unlimited" seam under attack.
  g.crew("crewP", "Parent", "parallel", [
    { crewId: crewFirst.id, budgets: { maxCostUsd: 2 } },
    { crewId: crewSecond.id, budgets: { maxCostUsd: 2 } },
  ]);

  const invocations: string[] = [];
  const warnings: string[] = [];
  const { sink, events } = collectSink();
  const service = makeService({
    repository: repo,
    resolveCrew: g.resolveCrew,
    runAgent: leafRunner({ costPerLeaf: 0.1, invocations }),
    config: { defaultBudgetUsd: 2, maxBudgetUsd: 500, maxParallel: 1, maxDepth: 4 },
    logger: { warn: (m) => warnings.push(m) },
  });

  const session = missionSession(repo);
  const mission = await service.proposePlan({ sessionId: session.id, text: "run", sink, crewId: "crewP" });
  assert.equal(mission.status, "completed");
  // The second crew's leaves NEVER ran — a 0 allocation is a deny, NOT "unbounded".
  assert.ok(!invocations.some((n) => n.startsWith("Second")), "the 0-allocation sub-crew was SKIPPED (never treated as unlimited)");
  assert.ok(warnings.some((m) => /exhausted|0 allocation/i.test(m)), "the skip was logged loudly as budget-exhausted");
  assert.equal(synthesisEvents(events, mission.id)[0]?.partial, true, "the root is honestly partial (the skipped branch surfaces)");
});

test("P-BUD4 REFUTED — allocateChildBudget(x, 0) === 0 and allocateChildBudget(0, y) === 0 (a 0 pool is deny, never unlimited)", () => {
  assert.equal(allocateChildBudget(100, 0), 0, "an exhausted pool hands a child 0 (deny), never the request");
  assert.equal(allocateChildBudget(0, 100), 0, "a 0 request is 0, never the whole pool");
  assert.equal(allocateChildBudget(-5, 100), 0, "a negative request floors at 0");
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════
//  P-CYC1 — Author-time cycle/exists/depth (D-CN4 author-time half).  Attack: (a) a transitive cycle
//  A→B→A; (b) a non-existent crewId; (c) nesting past HUB_MISSION_MAX_DEPTH — each a LOUD reject at write,
//  never a silent skip. Mounted BOTH on the pure heart (`assertCrewGraphValid`) AND the INTEGRATED
//  repository (`createCrew`/`updateCrew`). Anchors: assertCrewGraphValid crew-resolution.ts:33-80;
//  repository createCrew:443 / updateCrew:481.
// ══════════════════════════════════════════════════════════════════════════════════════════════════════

test("P-CYC1 REFUTED — assertCrewGraphValid throws on a transitive cycle, a missing crewId, and over-depth", () => {
  const crew = (id: string, members: HubCrewMember[]): HubCrew => ({
    id,
    name: id,
    topology: "parallel",
    members,
    createdAt: "t",
    updatedAt: "t",
  });
  // (a) transitive cycle A→B→A.
  const cyclic = new Map<string, HubCrew>([
    ["A", crew("A", [{ crewId: "B" }])],
    ["B", crew("B", [{ crewId: "A" }])],
  ]);
  assert.throws(
    () => assertCrewGraphValid({ rootId: "A", crewsById: cyclic, maxCrewDepth: 4 }),
    /cycle/i,
    "a transitive cycle is a loud reject",
  );
  // (b) a non-existent nested crewId.
  const missing = new Map<string, HubCrew>([["A", crew("A", [{ crewId: "ghost" }])]]);
  assert.throws(
    () => assertCrewGraphValid({ rootId: "A", crewsById: missing, maxCrewDepth: 4 }),
    /does not exist/i,
    "a missing nested crew is a loud reject",
  );
  // (c) over-depth: with maxCrewDepth 2, a 3-level chain A→B→C is rejected (C would sit at depth 2 >= 2).
  const deep = new Map<string, HubCrew>([
    ["A", crew("A", [{ crewId: "B" }])],
    ["B", crew("B", [{ crewId: "C" }])],
    ["C", crew("C", [{ agentId: "leaf" }])],
  ]);
  assert.throws(
    () => assertCrewGraphValid({ rootId: "A", crewsById: deep, maxCrewDepth: 2 }),
    /maximum depth/i,
    "an over-depth chain is a loud reject",
  );
  // maxCrewDepth 1 (the D-CN10 off-switch) rejects ANY crewId member.
  const oneLevel = new Map<string, HubCrew>([
    ["A", crew("A", [{ crewId: "B" }])],
    ["B", crew("B", [{ agentId: "leaf" }])],
  ]);
  assert.throws(
    () => assertCrewGraphValid({ rootId: "A", crewsById: oneLevel, maxCrewDepth: 1 }),
    /maximum depth/i,
    "maxCrewDepth 1 rejects any crewId member (reproduces today's flat semantics at author time)",
  );
});

test("P-CYC1 REFUTED — the INTEGRATED repository createCrew/updateCrew rejects a cycle at write time (default maxCrewDepth = HUB_MISSION_MAX_DEPTH)", () => {
  const { repo } = open();
  const leaf = repo.createAgentRole(roleInput({ name: "Leaf" }));
  const a = repo.createCrew({ name: "A", topology: "parallel", members: [{ agentId: leaf.id }] });
  const b = repo.createCrew({ name: "B", topology: "parallel", members: [{ crewId: a.id }] });
  // updateCrew(A) to add a member crewId=B closes the cycle A→B→A — the integrated author-time guard rejects.
  assert.throws(
    () => repo.updateCrew(a.id, { members: [{ agentId: leaf.id }, { crewId: b.id }] }),
    /cycle/i,
    "updateCrew rejects a members patch that closes a transitive cycle",
  );
  // createCrew referencing a non-existent nested crew is rejected at write.
  assert.throws(
    () => repo.createCrew({ name: "Bad", topology: "parallel", members: [{ crewId: "does-not-exist" }] }),
    /does not exist/i,
    "createCrew rejects a missing nested crewId",
  );
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════
//  P-CYC2 — Run-time cycle guard (D-CN4 run-time half).  Attack: a MUTUAL cycle A→B→A hand-built in the
//  stub graph to bypass the author-time check (a graph mutated after save), then executed; assert the
//  run-time visited-set rejects re-entry LOUDLY with a BOUNDED hub_sessions row count (no infinite spawn).
//  Anchors: run-time cycle guard runSubCrew orchestrator.ts:1250; visited-set thread orchestrator.ts:1375.
// ══════════════════════════════════════════════════════════════════════════════════════════════════════

test("P-CYC2 REFUTED — a MUTUAL run-time cycle A→B→A rejects loudly + terminates with a BOUNDED session-row count", async () => {
  const { repo, db } = open();
  const g = graph(repo);
  g.crew("crewA", "Alpha", "parallel", [{ crewId: "crewB" }]);
  g.crew("crewB", "Beta", "parallel", [{ crewId: "crewA" }]);

  const warnings: string[] = [];
  const { sink } = collectSink();
  const service = makeService({
    repository: repo,
    resolveCrew: g.resolveCrew,
    runAgent: leafRunner({}),
    config: { maxDepth: 8 }, // high so the CYCLE guard (not the depth guard) is what trips
    logger: { warn: (m) => warnings.push(m) },
  });

  const session = missionSession(repo);
  const mission = await service.proposePlan({ sessionId: session.id, text: "run", sink, crewId: "crewA" });
  assert.ok(warnings.some((m) => /circular|cycle/i.test(m)), "the run-time cycle was rejected loudly");
  assert.ok(repo.getMissionTree(mission.id).length <= 6, `the mission tree is bounded (${repo.getMissionTree(mission.id).length})`);
  assert.ok(sessionRowCount(db) <= 12, `hub_sessions is bounded — no infinite spawn (${sessionRowCount(db)})`);
  assert.equal(mission.status, "completed", "the mutated cyclic branch did not crash the whole tree");
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════
//  P-CYC3 — Depth cap + total-agent backstop (D-CN4/D-CN10).  Attacks: (a) maxDepth=1 rejects ANY crewId
//  unit (reproduces today's flat semantics); (b) a WIDE-but-shallow tree over HUB_MISSION_MAX_TOTAL_AGENTS
//  is rejected at propose (loud, never a silent subtree drop); (c) a chain mutated to over-depth after
//  propose is rejected at run-time. Anchors: propose total-agent backstop orchestrator.ts:589; propose
//  depth backstop:598; run-time over-depth guard:1242; run-time total-agent backstop:1286.
// ══════════════════════════════════════════════════════════════════════════════════════════════════════

test("P-CYC3 REFUTED — maxDepth=1 reproduces today's flat semantics (any crewId unit rejected at run-time)", async () => {
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
    config: { maxDepth: 1 }, // the D-CN10 off-switch
    logger: { warn: (m) => warnings.push(m) },
  });

  const session = missionSession(repo);
  const mission = await service.proposePlan({ sessionId: session.id, text: "run", sink, crewId: "crewP" });
  assert.deepEqual(invocations, ["Root Leaf"], "only the leaf ran; the crewId unit was rejected (depth off-switch)");
  assert.ok(warnings.some((m) => /depth/i.test(m)), "the reject was logged loudly");
  assert.equal(synthesisEvents(events, mission.id)[0]?.partial, true, "the mission is honestly partial");
  assert.equal(repo.listChildMissions(mission.id).length, 0, "no sub-mission was created (depth 1 = today's flat semantics)");
});

test("P-CYC3 REFUTED — a WIDE-but-shallow tree over HUB_MISSION_MAX_TOTAL_AGENTS is rejected LOUDLY at propose", async () => {
  const { repo } = open();
  const g = graph(repo);
  // A root parallel of 3 crew-refs, each a parallel crew of 5 leaves = 15 transitive agents (depth 1), over
  // a maxTotalAgents cap of 8. Each branch NAMES a fair budget share so the whole-tree count reflects all 15
  // (a branch with a 0 allocation would be dropped from the count — the D-CN3 cascade). The propose-time
  // whole-tree total-agent backstop must throw, not silently drop a subtree.
  const rootMembers: HubCrewMember[] = [];
  for (let b = 0; b < 3; b++) {
    const leaves = [1, 2, 3, 4, 5].map((i) => ({ agentId: g.role(`W${b}-${i}`).id }));
    const crew = g.crew(`crewW${b}`, `Wide ${b}`, "parallel", leaves);
    rootMembers.push({ crewId: crew.id, budgets: { maxCostUsd: 30 } });
  }
  g.crew("crewP", "Parent", "parallel", rootMembers);

  const { sink } = collectSink();
  const service = makeService({
    repository: repo,
    resolveCrew: g.resolveCrew,
    runAgent: leafRunner({}),
    config: { defaultBudgetUsd: 100, maxDepth: 4, maxTotalAgents: 8 },
  });
  const session = missionSession(repo);
  await assert.rejects(
    () => service.proposePlan({ sessionId: session.id, text: "run", sink, crewId: "crewP" }),
    /over the limit of 8|agents across its nested crews/i,
    "a 15-agent tree over the 8-agent cap is rejected loudly at propose (never a silent subtree drop)",
  );
});

test("P-CYC3 REFUTED — a chain MUTATED to over-depth AFTER propose is rejected at run-time (belt-and-suspenders)", async () => {
  const { repo } = open();
  const g = graph(repo);
  const midLeaf = g.role("Mid Leaf");
  const deepLeaf = g.role("Deep Leaf");
  const crewDeep = g.crew("crewDeep", "Deep Crew", "parallel", [{ agentId: deepLeaf.id }]);
  const crewMid = g.crew("crewMid", "Mid Crew", "parallel", [{ agentId: midLeaf.id }]);
  g.crew("crewP", "Parent", "parallel", [{ crewId: crewMid.id }]);

  const warnings: string[] = [];
  const invocations: string[] = [];
  const { sink, events } = collectSink();
  const service = makeService({
    repository: repo,
    resolveCrew: g.resolveCrew,
    runAgent: leafRunner({ invocations }),
    config: { maxDepth: 2, defaultAutonomy: "always_ask" },
    logger: { warn: (m) => warnings.push(m) },
  });

  const session = missionSession(repo, "always_ask");
  const proposed = await service.proposePlan({ sessionId: session.id, text: "run", sink, crewId: "crewP" });
  assert.equal(proposed.status, "proposed", "the legal depth-1 tree passes the propose gate");
  // MUTATE crewMid AFTER save — it now nests crewDeep, pushing it to depth 2 (>= maxDepth 2 → rejected).
  crewMid.members = [{ agentId: midLeaf.id }, { crewId: crewDeep.id }];
  await service.approve({ missionId: proposed.id, sink });
  const mission = repo.getMission(proposed.id);
  assert.ok(invocations.includes("Mid Leaf"), "the mid-level leaf still ran");
  assert.ok(!invocations.includes("Deep Leaf"), "the over-depth deep leaf never ran (run-time guard caught the mutation)");
  assert.ok(warnings.some((m) => /depth/i.test(m)), "the run-time over-depth reject was logged loudly");
  assert.equal(synthesisEvents(events, mission.id)[0]?.partial, true, "the tree is honestly partial");
  assert.ok(!repo.listMissions().some((m) => (m.depth ?? 0) >= 2), "no depth-2 sub-mission row exists");
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════
//  P-GATE1 — No propose-gate relaxation (D-CN1/D-CN6).  Attacks: (a) proposePlan's `kind==='chat'` gate
//  rejects a non-chat session; (b) the `mission.propose_plan` builtin is WITHHELD from the ordinary
//  (chat/research) default grant; (c) a nested sub-mission is born DIRECTLY (its session_id = the root
//  chat session, and it has NO plan_approved — it never routes through approve()/HITL). Anchors:
//  kind==='chat' gate proposePlan orchestrator.ts:490; withheld builtin builtins/index.ts:40-42;
//  sub-mission created directly runSubCrew orchestrator.ts:1320-1343.
// ══════════════════════════════════════════════════════════════════════════════════════════════════════

test("P-GATE1 REFUTED — the kind!=='chat' propose gate + the withheld mission.propose_plan builtin are unchanged", async () => {
  const { repo } = open();
  const g = graph(repo);
  g.crew("crewP", "Parent", "parallel", [{ agentId: g.role("Leaf").id }]);
  const { sink } = collectSink();
  const service = makeService({ repository: repo, resolveCrew: g.resolveCrew, runAgent: leafRunner({}) });

  // (a) a non-chat (agent) session can NEVER propose a mission (the structural D-CN1 gate).
  const agentSession = repo.createSession({ mode: "mission", model: "gpt-4o", kind: "agent" });
  await assert.rejects(
    () => service.proposePlan({ sessionId: agentSession.id, text: "run", sink, crewId: "crewP" }),
    /top-level chat session/i,
    "proposePlan's kind==='chat' gate rejects an agent-session propose",
  );
  // (b) the planner-only builtin is WITHHELD from the ordinary default grant (agents never gain it).
  assert.ok(
    !DEFAULT_CHAT_BUILTIN_NAMES.includes(missionProposePlan.name),
    "mission.propose_plan is NOT in the default chat/research grant (withheld — agents cannot spawn)",
  );
});

test("P-GATE1 REFUTED — a nested sub-mission is born DIRECTLY (session_id = root chat session, no plan_approved for the child)", async () => {
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
  const child = repo.listChildMissions(mission.id)[0];
  assert.ok(child, "the sub-mission exists");
  // Every mission in the tree keeps session_id = the root chat session (D-CN6) — the tree is expressed only
  // by parent_mission_id.
  assert.equal(child.sessionId, session.id, "the sub-mission's session_id = the ROOT chat session (D-CN6)");
  assert.equal(child.parentMissionId, mission.id, "the tree is expressed by parent_mission_id");
  // The child emitted a plan_proposed EVENT (event-sourcing) but NO plan_approved — born directly, no HITL.
  assert.equal(agentReports(all, child.id).length, 1, "the sub-mission ran its leaf directly");
  assert.equal(planApprovedEvents(all, child.id).length, 0, "NO plan_approved for the child — it is not routed through approve()/HITL");
  assert.equal(planApprovedEvents(all).length, 1, "exactly one plan_approved tree-wide — the root's");
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════
//  P-HITL1 — Nested shouldAutoApprove over the transitive tree (D-CN1).  Attack: a `threshold` mission
//  whose DIRECT members are tiny (one crew-ref) but whose TRANSITIVE tree is large; assert the auto-approve
//  gate is computed over the transitive count, so a large hidden tree cannot slip past `threshold`.
//  Anchors: whole-tree gate proposePlan orchestrator.ts:578-604; shouldAutoApprove orchestrator.ts:1926.
// ══════════════════════════════════════════════════════════════════════════════════════════════════════

test("P-HITL1 REFUTED — a THRESHOLD mission hiding a large transitive tree behind ONE direct crew-ref does NOT auto-run", async () => {
  const { repo } = open();
  const g = graph(repo);
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
  assert.equal(mission.status, "proposed", "the TRANSITIVE count (6) exceeds askAboveAgents (3) ⇒ awaits approval");

  const caps = { askAboveAgents: 3, askAboveUsd: 1000 };
  assert.equal(shouldAutoApprove("threshold", 1, 0, caps), true, "the flat DIRECT count of 1 (<= 3) WOULD auto-run");
  assert.equal(shouldAutoApprove("threshold", 6, 0, caps), false, "the transitive count (6 > 3) blocks auto-run");
  assert.equal(shouldAutoApprove("always_ask", 1, 0, caps), false, "always_ask never auto-approves");
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════
//  P-HITL2 — Nested HITL deny-never-runs.  Attack: a DENIED nested agent (its runner produces no report)
//  under an `always_ask` mission must NEVER silently fabricate a report; the sub-mission settles honest-
//  partial and the parent synthesis reflects the denied branch. Anchors: runAgentStructured no-report path
//  orchestrator.ts:1751-1757; settleSkippedChild; sub-mission born directly (no plan_approved).
//  NOTE (scope, from 2.R probe 6): `releaseTurn`'s awaiter cleanup (hitl.ts:318-342) lives on the SESSION
//  runner path the deterministic STRUCTURED stub bypasses — this probe verifies the observable deny→partial
//  behaviour; a live HITL awaiter-cleanup walk is an owner-acceptance item (residual-risk summary).
// ══════════════════════════════════════════════════════════════════════════════════════════════════════

test("P-HITL2 REFUTED — a DENIED nested agent (no report) never silently runs; the sub-mission + parent are honestly partial", async () => {
  const { repo } = open();
  const g = graph(repo);
  const denied = g.role("Denied Agent");
  const crewC = g.crew("crewC", "Child", "parallel", [{ agentId: denied.id }]);
  g.crew("crewP", "Parent", "parallel", [{ crewId: crewC.id }]);

  const { sink, events } = collectSink();
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
  const child = repo.listChildMissions(mission.id)[0];
  assert.ok(child, "the sub-mission exists");
  assert.equal(agentReports(events, child.id).length, 0, "the denied nested agent produced no report (never silently run)");
  assert.equal(synthesisEvents(events, mission.id)[0]?.partial, true, "the parent synthesis honestly reflects the denied branch (partial)");
  assert.equal(planApprovedEvents(events, child.id).length, 0, "no plan_approved for the child even under always_ask (born directly)");
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════
//  P-AUT1 — Transitive autonomy non-escalation (D-CN9).  Attack: a nested tree under an `always_ask`
//  parent; assert autonomy is `min` down the path — a nested level can never loosen `always_ask`.
//  Anchors: runSubCrew autonomy: mission.autonomy orchestrator.ts:1276/1323.
// ══════════════════════════════════════════════════════════════════════════════════════════════════════

test("P-AUT1 REFUTED — every sub-mission inherits the parent's always_ask; a nested tree can never loosen autonomy down the path", async () => {
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

  const tree = repo.getMissionTree(rootId);
  assert.ok(tree.length >= 3, "the tree has a root + 2 nested levels");
  for (const m of tree) {
    assert.equal(m.autonomy, "always_ask", `mission ${m.id} (depth ${m.depth ?? 0}) inherited always_ask — never loosened`);
  }
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════
//  P-GRA1 — Transitive grant intersection L2∩L1∩L0 (D-CN9/D-HF5).  Attack: a DEPTH-2 role whose OWN Access
//  grants MORE than the root scope allows (a root-dropped server), behind TWO empty crew-refs; assert the
//  root-dropped server is STILL absent at level 3 (the empty passthrough composes, never re-widens).
//  Anchors: subCrewParentScope orchestrator.ts:2012; effectiveAgentGrants grants.ts:80; parentScope thread
//  runSubCrew orchestrator.ts:1360; spawn intersection orchestrator.ts:1004.
// ══════════════════════════════════════════════════════════════════════════════════════════════════════

test("P-GRA1 REFUTED — a root-dropped server is STILL absent at level 3 through two empty crew-refs (transitive intersection composes)", async () => {
  const { repo } = open();
  const g = graph(repo);
  const deepLeaf = g.role("Deep Leaf", {
    servers: { alpha: ["read", "write"], beta: "all", gamma: "all" },
    builtins: ["memory.save", "artifacts.create"],
  });
  const crewC = g.crew("crewC", "Deep Crew", "parallel", [{ agentId: deepLeaf.id }]);
  const crewMid = g.crew("crewMid", "Mid Crew", "parallel", [{ crewId: crewC.id }]);
  g.crew("crewP", "Parent", "parallel", [{ crewId: crewMid.id }]);

  const rootScope: HubToolGrants = { servers: { alpha: "all", beta: ["read"] }, builtins: ["memory.save"] };
  const { sink } = collectSink();
  const service = makeService({ repository: repo, resolveCrew: g.resolveCrew, runAgent: leafRunner({}), config: { maxDepth: 4 } });
  const session = scopedSession(repo, rootScope);
  const mission = await service.proposePlan({ sessionId: session.id, text: "deep", sink, crewId: "crewP" });
  assert.equal(mission.status, "completed");

  const deepMission = repo.listMissions().find((m) => (m.depth ?? 0) === 2);
  assert.ok(deepMission, "a depth-2 sub-mission exists");
  const level3 = repo.listMissionAgentSessions(deepMission.id)[0]!;
  const expected = effectiveAgentGrants(deepLeaf.toolGrants, rootScope);
  assert.deepEqual(level3.toolScope?.servers, expected.servers, "level-3 servers = the transitive intersection with the ROOT scope");
  assert.equal("gamma" in (level3.toolScope?.servers ?? {}), false, "the ROOT-DROPPED server is absent at level 3 (no escalation)");
  assert.deepEqual(level3.toolScope?.builtins, ["memory.save"], "root-ungranted built-ins stay dropped at level 3");
});

test("P-GRA1 REFUTED — effectiveAgentGrants only ever NARROWS (a broad plan cannot re-add a server the enclosing scope dropped)", () => {
  const enclosing: HubToolGrants = { servers: { alpha: ["read"], beta: "all" }, builtins: ["memory.save"] };
  const broad = effectiveAgentGrants({ servers: { alpha: "all", gamma: "all" }, builtins: ["skills.load"] }, enclosing);
  assert.equal("gamma" in broad.servers, false, "gamma stays out — a broad plan cannot re-add a dropped server");
  assert.deepEqual(broad.servers.alpha, ["read"], "alpha is bounded by the enclosing [read], not the plan's 'all'");
  assert.deepEqual(broad.builtins, [], "skills.load is dropped — the enclosing builtins bound it");
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════
//  P-GRA2 — missionUnreadyServers recursion (D-CN9).  Attack: a DEPTH-2 nested crew's leaf grants an
//  UNREADY MCP server; assert the pre-run readiness gate recurses into the nested crew's grants and blocks
//  approve() with an auth-required error naming the NESTED server (never silently runs a tool-less nested
//  agent). Anchors: missionUnreadyServers recursion orchestrator.ts:770-830; approve() gate:726-743.
// ══════════════════════════════════════════════════════════════════════════════════════════════════════

test("P-GRA2 REFUTED — the readiness gate recurses into a DEPTH-2 nested crew's grants and blocks approve() naming the nested server", async () => {
  const { repo } = open();
  const g = graph(repo);
  const deepLeaf = g.role("Deep Leaf", { servers: { acme: "all" }, builtins: [] });
  const crewC = g.crew("crewC", "Deep Crew", "parallel", [{ agentId: deepLeaf.id }]);
  const crewMid = g.crew("crewMid", "Mid Crew", "parallel", [{ crewId: crewC.id }]);
  g.crew("crewP", "Parent", "parallel", [{ crewId: crewMid.id }]);

  const { sink, events } = collectSink();
  const service = makeService({
    repository: repo,
    resolveCrew: g.resolveCrew,
    runAgent: leafRunner({}),
    config: { defaultAutonomy: "always_ask", maxDepth: 4 },
    // The nested server "acme" is NOT ready (e.g. an OAuth server with no token).
    isServerRunReady: (serverId) => (serverId === "acme" ? { ready: false, serverName: "Acme" } : { ready: true }),
  });

  const session = missionSession(repo, "always_ask");
  const proposed = await service.proposePlan({ sessionId: session.id, text: "run", sink, crewId: "crewP" });
  assert.equal(proposed.status, "proposed", "always_ask settles proposed");
  await service.approve({ missionId: proposed.id, sink });
  const mission = repo.getMission(proposed.id);

  // The readiness gate recursed to DEPTH 2, found "acme" unready, and blocked the run — the mission stays
  // `proposed` (re-approvable once connected), and NO agent ever ran a tool-less nested Acme agent.
  assert.equal(mission.status, "proposed", "approve() left the mission proposed — the nested unready server blocked the whole tree");
  const errs = errorEvents(events).filter((e) => e.authRequired === true);
  assert.ok(errs.length >= 1, "an auth-required error was surfaced");
  assert.ok(errs.some((e) => (e.serverIds ?? []).includes("acme")), "the error names the NESTED (depth-2) server 'acme'");
  assert.equal(agentReports(events, mission.id).length, 0, "no agent ran — the tree was blocked before spawning");
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════
//  P-SCOPE1 — Frozen scope vocabulary (D-CN9).  Assert the security boundary is untouched: the two
//  hub_crew_* write tools stay in SCOPE_EXEMPT_ACTION_TOOLS (write-classified ⇒ approval-gated); the
//  9-entry ASSISTANT_ENTITY_KINDS is unchanged (no crew/agent/hub kind); SCOPE_WRITE_TOOLS keys == the 9
//  kinds; crew nesting added VALIDATION logic, not tool names or entity kinds. Anchors: assistant-scope.ts
//  SCOPE_EXEMPT_ACTION_TOOLS:119-127, ASSISTANT_ENTITY_KINDS constants.ts:1159.
// ══════════════════════════════════════════════════════════════════════════════════════════════════════

test("P-SCOPE1 REFUTED — the frozen scope vocabulary (entity kinds + write-scope tools) is untouched by crew nesting", () => {
  // The 9 frozen entity kinds — crew nesting added NONE (D-CN9/D-AO3). No `crew`/`agent`/`hub` kind exists.
  assert.deepEqual(
    [...ASSISTANT_ENTITY_KINDS].sort(),
    ["collection", "compare", "run", "scan", "scenario", "server", "skill", "suite_run", "test"].sort(),
    "ASSISTANT_ENTITY_KINDS is the 9 frozen kinds — no crew/agent/hub kind added",
  );
  assert.equal(ASSISTANT_ENTITY_KINDS.length, 9, "exactly 9 entity kinds (the frozen security boundary)");
  for (const kind of ["crew", "agent", "hub", "mission"]) {
    assert.ok(!(ASSISTANT_ENTITY_KINDS as readonly string[]).includes(kind), `no '${kind}' entity kind`);
  }
  // SCOPE_WRITE_TOOLS is keyed by exactly the 9 entity kinds (no new key).
  assert.deepEqual(Object.keys(SCOPE_WRITE_TOOLS).sort(), [...ASSISTANT_ENTITY_KINDS].sort(), "SCOPE_WRITE_TOOLS keys == the frozen kinds");
  // The Hub crew write tools are scope-EXEMPT (page-scope-lock exempt) but STILL write-classified/approval-gated.
  assert.ok(SCOPE_EXEMPT_ACTION_TOOLS.has("hub_crew_create"), "hub_crew_create stays in SCOPE_EXEMPT_ACTION_TOOLS (approval-gated)");
  assert.ok(SCOPE_EXEMPT_ACTION_TOOLS.has("hub_crew_update"), "hub_crew_update stays in SCOPE_EXEMPT_ACTION_TOOLS (approval-gated)");
  // The exempt set is NOT widened by crew nesting — it is exactly the D-AO7 set.
  assert.deepEqual(
    [...SCOPE_EXEMPT_ACTION_TOOLS].sort(),
    ["hub_agent_create", "hub_agent_update", "hub_crew_create", "hub_crew_update", "mcp_tool_call", "rating_issue_file"].sort(),
    "SCOPE_EXEMPT_ACTION_TOOLS is the frozen D-AO7 set — crew nesting added no tool name",
  );
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════
//  P-ISO1 — Brief-only isolation at EVERY level (D-CN9/D-AH9).  Attack: seed the ROOT session with a
//  distinctive prior-transcript marker; assert a DEPTH-2 descendant's brief carries ONLY the curated ask +
//  focus chain, never the parent transcript. Anchors: composeCrewBrief topologies.ts:649; child user_message
//  = brief runAgentStructured orchestrator.ts:1737.
// ══════════════════════════════════════════════════════════════════════════════════════════════════════

test("P-ISO1 REFUTED — a DEPTH-2 descendant receives the curated brief only (ask + focus), never the parent transcript", async () => {
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
  assert.ok(deepInput.brief.includes(ASK_TOKEN), "the depth-2 brief carries the curated ask (the task)");
  assert.ok(deepInput.brief.includes(TOP_FOCUS) && deepInput.brief.includes(MID_FOCUS), "the depth-2 brief carries the focus chain down the path");
  assert.equal(deepInput.brief.includes(MARKER), false, "the depth-2 brief carries NO parent transcript (isolation at depth 2)");
  assert.equal(deepInput.systemPrompt.includes(MARKER), false, "the depth-2 role prompt carries no parent transcript");

  const deepMission = repo.listMissions().find((m) => (m.depth ?? 0) === 2)!;
  const level2Session = repo.listMissionAgentSessions(deepMission.id)[0]!;
  const userTurns = repo
    .listEvents(level2Session.id)
    .filter((e): e is Extract<HubEvent, { type: "user_message" }> => e.type === "user_message");
  assert.equal(userTurns.length, 1, "the depth-2 child has exactly one input (its brief)");
  assert.equal(userTurns[0]!.text.includes(MARKER), false, "the depth-2 child's input carries no parent transcript");
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════
//  P-TOPO1 — Per-subtree topology fidelity (D-CN2).  Attack: a `pipeline` sub-crew inside a `parallel`
//  parent; assert the sub-crew runs under ITS OWN topology (ordered hand-offs — a later stage's brief
//  carries the upstream results), and the parent consumes its synthesised answer as ONE stamped
//  HubAgentReport (topology: "pipeline", subMissionId, childReports). Anchors: runSubCrew projection
//  orchestrator.ts:1397-1423; runPipeline topologies.ts:201-216 (composeHandoffBrief).
// ══════════════════════════════════════════════════════════════════════════════════════════════════════

test("P-TOPO1 REFUTED — a pipeline sub-crew inside a parallel parent runs its OWN topology + projects to ONE stamped report", async () => {
  const { repo } = open();
  const g = graph(repo);
  const rootLeaf = g.role("Root Leaf");
  const p1 = g.role("Pipe One");
  const p2 = g.role("Pipe Two");
  // The sub-crew is a PIPELINE (ordered); the parent is PARALLEL. If the sub-crew ran under the PARENT's
  // topology it would run parallel and Pipe Two's brief would carry no upstream hand-off.
  const crewPipe = g.crew("crewPipe", "Pipeline Crew", "pipeline", [{ agentId: p1.id }, { agentId: p2.id }]);
  g.crew("crewP", "Parent", "parallel", [{ agentId: rootLeaf.id }, { crewId: crewPipe.id }]);

  const inputs: HubAgentRunInput[] = [];
  const { sink, events } = collectSink();
  const service = makeService({
    repository: repo,
    resolveCrew: g.resolveCrew,
    runAgent: leafRunner({ inputs }),
    config: { maxParallel: 1, maxDepth: 4 },
  });

  const session = missionSession(repo);
  const mission = await service.proposePlan({ sessionId: session.id, text: "run", sink, crewId: "crewP" });
  assert.equal(mission.status, "completed");

  // The sub-mission ran under its OWN topology (pipeline).
  const subMission = repo.listMissions().find((m) => (m.depth ?? 0) === 1);
  assert.ok(subMission, "the sub-mission exists");
  assert.equal(subMission.topology, "pipeline", "the sub-crew ran under ITS OWN pipeline topology, not the parent's parallel");
  // Pipe Two's brief carries Pipe One's upstream results — proof it ran as an ORDERED pipeline, not parallel.
  const p2Input = inputs.find((i) => i.roleName === "Pipe Two");
  assert.ok(p2Input, "Pipe Two ran");
  assert.ok(/upstream results/i.test(p2Input.brief), "Pipe Two's brief carries the pipeline hand-off (upstream results) — ordered execution");
  // The parent consumed the sub-crew as ONE stamped report (topology pipeline, subMissionId, childReports).
  const rootReports = agentReports(events, mission.id);
  assert.equal(rootReports.length, 2, "the parent saw exactly two reports: the leaf + the ONE crew-node report");
  const crewNodeReport = rootReports.map((e) => e.report).find((r) => r.subMissionId !== undefined);
  assert.ok(crewNodeReport, "the crew-node projected exactly one stamped HubAgentReport");
  assert.equal(crewNodeReport.topology, "pipeline", "the projected report is stamped with the sub-crew's topology");
  assert.equal(crewNodeReport.subMissionId, subMission.id, "the projected report names the sub-mission id");
  assert.equal(crewNodeReport.childReports?.length, 2, "the projected report carries the sub-crew's two member reports");
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════
//  P-TOPO2 — best-of-N judge blindness across levels (R-SK7).  Attack: a nested `best_of_n` sub-crew whose
//  result flows UP into a parent `best_of_n` judge; assert BOTH judges see ONLY anonymized {label, report}
//  — no child authoring model/role leaks into either judge. Anchors: runBestOfN anonymization
//  topologies.ts:330-333; renderAnonymizedAttempt:366; renderReportText (no heading) shared.ts:81-99.
// ══════════════════════════════════════════════════════════════════════════════════════════════════════

test("P-TOPO2 REFUTED — a nested best_of_n whose result flows up sees only anonymized {label, report} at EVERY judge (no author leak)", async () => {
  const { repo } = open();
  const g = graph(repo);
  const AUTHOR_MARKER = "AUTHORING_ROLE_LEAK_MARKER_zz9";
  const MODEL_MARKER = "gpt-secret-model-LEAK";
  // Nested best_of_n leaves carry a distinctive roleName/model in their REPORT (fields renderReportText does
  // NOT emit) — if the judge ever saw the author/model the marker would leak into an attempt.
  const reportFor = (roleName: string): HubAgentReport =>
    report({ summary: `A neutral finding for ${roleName.replace(/\W/g, "")}.`, roleName: `${AUTHOR_MARKER}-${roleName}`, agentSessionId: MODEL_MARKER });
  const nestedLeaves = [1, 2, 3].map((i) => ({ agentId: g.role(`BoNLeaf${i}`).id, model: MODEL_MARKER }));
  const crewBoN = g.crew("crewBoN", "Best-of-N Crew", "best_of_n", nestedLeaves);
  const siblingLeaf = g.role("Sibling");
  // The PARENT is ALSO best_of_n (>= 2 attempts ⇒ a judge runs): the crew-ref (projected report) + a sibling.
  g.crew("crewP", "Parent", "best_of_n", [{ crewId: crewBoN.id }, { agentId: siblingLeaf.id }]);

  const judgeSaw: HubJudgeAttempt[][] = [];
  const judge: HubJudge = async ({ attempts }) => {
    judgeSaw.push(attempts.map((a) => ({ ...a }))); // snapshot every judge's exact inputs
    return { winnerIndex: 0, costUsd: 0 };
  };

  const { sink } = collectSink();
  const service = makeService({
    repository: repo,
    resolveCrew: g.resolveCrew,
    runAgent: leafRunner({ reportFor }),
    judge,
    config: { maxParallel: 3, maxDepth: 4 },
  });

  const session = missionSession(repo);
  const mission = await service.proposePlan({ sessionId: session.id, text: "run", sink, crewId: "crewP" });
  assert.equal(mission.status, "completed");

  assert.ok(judgeSaw.length >= 2, "both the nested and the parent best_of_n invoked the blind judge");
  for (const attempts of judgeSaw) {
    for (const [i, a] of attempts.entries()) {
      // Blindness: an attempt carries EXACTLY {label, report} — no authoring model/role field.
      assert.deepEqual(Object.keys(a).sort(), ["label", "report"], "an attempt carries exactly {label, report}");
      assert.equal(a.label, `Attempt ${i + 1}`, "the label is the anonymous position, never the author");
      assert.equal(a.report.includes(AUTHOR_MARKER), false, "no authoring role name leaks into the judged body");
      assert.equal(a.report.includes(MODEL_MARKER), false, "no authoring model leaks into the judged body");
    }
  }
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════
//  P-REP1 (API half) — Nested-tree replay-from-events (D-CN7).  Attack: run a >=2-level tree through the
//  REAL engine (stub runner), then reconstruct from `hub_events` ALONE via reconstructMission /
//  reconstructMissionById; assert the replayed board equals the live run (structure + per-level cost
//  roll-up + determinism/inertness). The WEB half (reconstructMissionBoard) is in the .tsx file. Anchors:
//  reconstructMission board.ts:297; reconstructMissionById:307; rollUpCost:177.
// ══════════════════════════════════════════════════════════════════════════════════════════════════════

test("P-REP1 REFUTED (API) — a live 2-level tree reconstructs from hub_events ALONE (structure + per-level cost roll-up + inertness)", async () => {
  const { repo } = open();
  const g = graph(repo);
  const rootLeaf = g.role("Root Leaf");
  const m1 = g.role("Member One");
  const m2 = g.role("Member Two");
  const crewC = g.crew("crewC", "Child Crew", "parallel", [{ agentId: m1.id }, { agentId: m2.id }]);
  g.crew("crewP", "Parent", "parallel", [{ agentId: rootLeaf.id }, { crewId: crewC.id }]);

  const { sink } = collectSink();
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

  const events = repo.listEvents(session.id);
  const board = reconstructMission(events);
  assert.ok(board, "the nested mission reconstructs from hub_events alone");
  assert.equal(board.missionId, mission.id, "the ROOT board is returned (not a later nested plan_proposed)");
  assert.equal(board.agents.length, 2, "two top-level agents (a leaf + a crew node)");
  const crewNode = board.agents.find((a) => a.subMissionId !== undefined)!;
  assert.ok(crewNode, "one top-level agent is a crew node with a subMissionId");
  assert.equal(crewNode.children?.length, 2, "the crew node grafts its sub-mission's two members");
  const childId = repo.listChildMissions(mission.id)[0]!.id;
  assert.equal(crewNode.subMissionId, childId, "the crew node names its live sub-mission id");
  assert.ok(Math.abs((crewNode.costUsd ?? 0) - 0.5) < 1e-9, `the crew node's rolled cost = sum(children) = 0.50 (got ${crewNode.costUsd})`);
  const leafNode = board.agents.find((a) => a.subMissionId === undefined)!;
  assert.ok(Math.abs((leafNode.costUsd ?? 0) - 0.1) < 1e-9, "the leaf's rolled cost = its own report cost 0.10");

  const sub = reconstructMissionById(events, childId);
  assert.ok(sub, "the sub-mission reconstructs by id");
  assert.deepEqual(sub.agents.map((a) => a.roleName).sort(), ["Member One", "Member Two"], "the sub-board carries its two members");

  const pristine = structuredClone(events);
  assert.deepEqual(reconstructMission(events), board, "reconstruction is deterministic");
  assert.deepEqual(events, pristine, "reconstruction does not mutate the event log (inert)");
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════
//  P-REP2 — Domain isolation + additive lineage (D-CN6).  Attack: run a nested tree, then prove nested
//  missions wrote ONLY hub tables (0 foreign-table rows — a baseline-delta check), every tree mission keeps
//  session_id = the root chat session, and the tree is expressed ONLY by parent_mission_id (v54 columns
//  additive nullable). Anchors: schema.ts hub_missions (parent_mission_id/depth/root_mission_id);
//  runSubCrew createMission orchestrator.ts:1320-1329.
// ══════════════════════════════════════════════════════════════════════════════════════════════════════

/** All non-hub user tables and their current row counts (excludes sqlite internals). */
function nonHubTableCounts(db: AppDatabase): Map<string, number> {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'hub_%'")
    .all() as { name: string }[];
  const counts = new Map<string, number>();
  for (const { name } of rows) {
    counts.set(name, (db.prepare(`SELECT COUNT(*) AS c FROM "${name}"`).get() as { c: number }).c);
  }
  return counts;
}

test("P-REP2 REFUTED — a nested tree writes ONLY hub tables (0 foreign-table rows) with session_id=root + tree via parent_mission_id", async () => {
  const { repo, db } = open();
  const g = graph(repo);
  const rootLeaf = g.role("Root Leaf");
  const midLeaf = g.role("Mid Leaf");
  const deepLeaf = g.role("Deep Leaf");
  const crewDeep = g.crew("crewDeep", "Deep", "parallel", [{ agentId: deepLeaf.id }]);
  const crewMid = g.crew("crewMid", "Mid", "parallel", [{ agentId: midLeaf.id }, { crewId: crewDeep.id }]);
  g.crew("crewP", "Parent", "parallel", [{ agentId: rootLeaf.id }, { crewId: crewMid.id }]);

  // Baseline non-hub table counts BEFORE the run (so any migration/seed rows are handled honestly).
  const before = nonHubTableCounts(db);

  const { sink } = collectSink();
  const service = makeService({ repository: repo, resolveCrew: g.resolveCrew, runAgent: leafRunner({}), config: { maxParallel: 1, maxDepth: 4 } });
  const session = missionSession(repo);
  const mission = await service.proposePlan({ sessionId: session.id, text: "run", sink, crewId: "crewP" });
  assert.equal(mission.status, "completed");

  // (1) NO foreign-table row was written by the nested run — every non-hub table's count is unchanged.
  const after = nonHubTableCounts(db);
  for (const [name, count] of after) {
    assert.equal(count, before.get(name) ?? 0, `foreign table "${name}" gained no rows from the nested mission (domain isolation)`);
  }

  // (2) Every mission in the tree keeps session_id = the root chat session; the tree is expressed only by
  //     parent_mission_id (+ the denormalised root_mission_id), and depth/parent columns are additive.
  const rootId = rootMissionId(repo, session.id);
  const tree = repo.getMissionTree(rootId);
  assert.ok(tree.length >= 3, "the tree spans a root + 2 nested levels");
  for (const m of tree) {
    assert.equal(m.sessionId, session.id, `mission ${m.id} keeps session_id = the root chat session (D-CN6)`);
  }
  const root = tree.find((m) => m.parentMissionId === undefined)!;
  assert.equal(root.id, rootId, "the root has no parentMissionId");
  assert.equal((root.depth ?? 0), 0, "the root is depth 0");
  for (const m of tree.filter((x) => x.id !== rootId)) {
    assert.ok(m.parentMissionId !== undefined, `sub-mission ${m.id} is linked only by parent_mission_id`);
    assert.ok((m.depth ?? 0) >= 1, "a sub-mission is depth >= 1");
  }
  // (3) The denormalised `root_mission_id` (a DB-INTERNAL O(1)-rollup column, not a wire field) points at
  //     the root for EVERY tree row — the additive v54 lineage is populated; a root self-references its id.
  const rows = db
    .prepare("SELECT id, root_mission_id AS rootId, depth FROM hub_missions ORDER BY depth")
    .all() as { id: string; rootId: string | null; depth: number }[];
  assert.ok(rows.length >= 3, "the DB holds the whole tree");
  for (const row of rows) {
    assert.equal(row.rootId, rootId, `hub_missions.root_mission_id for ${row.id} points at the root (additive v54 lineage)`);
  }
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════
//  P-REP3 — Legacy flat mission unchanged (WP3.2).  Attack: a FLAT (pre-nesting) mission must reconstruct
//  and render in the run report (JSON + Markdown) as exactly one root trace node with children:[] — the
//  legacy guarantee is STRUCTURAL, not a special case. Anchors: buildMissionTraceForest mission-trace.ts:83
//  (the "nobody's parent + no parent of its own ⇒ one root, children:[]" invariant); session-report.ts.
// ══════════════════════════════════════════════════════════════════════════════════════════════════════

test("P-REP3 REFUTED — a FLAT mission reconstructs to exactly one root trace node (children:[]) + renders in JSON + Markdown unchanged", async () => {
  const { repo } = open();
  const g = graph(repo);
  const a = g.role("Flat A");
  const b = g.role("Flat B");
  // A flat (non-nested) crew — no crewId members anywhere.
  g.crew("crewFlat", "Flat Crew", "parallel", [{ agentId: a.id }, { agentId: b.id }]);

  const { sink } = collectSink();
  const service = makeService({ repository: repo, resolveCrew: g.resolveCrew, runAgent: leafRunner({ costPerLeaf: 0.15 }) });
  const session = missionSession(repo);
  const mission = await service.proposePlan({ sessionId: session.id, text: "run", sink, crewId: "crewFlat" });
  assert.equal(mission.status, "completed");

  const events = repo.listEvents(session.id);
  // The trace forest is exactly ONE root node with NO children (the structural legacy guarantee).
  const forest = buildMissionTraceForest(events);
  assert.equal(forest.length, 1, "a flat mission yields exactly one root trace node");
  assert.equal(forest[0]!.depth, 0, "the root trace node is depth 0");
  assert.deepEqual(forest[0]!.children, [], "the flat root has NO children (byte-shaped as pre-nesting)");
  assert.equal(forest[0]!.agents.length, 2, "the flat root carries its two leaf agents directly");
  assert.equal(forest[0]!.roleName, undefined, "a root trace node has no parent-slot roleName");

  // The JSON report carries the forest; the Markdown renders the mission-trace section without crashing.
  const sessionRow = repo.getSession(session.id);
  const json = buildHubSessionJsonReport(sessionRow, events, "2026-07-27T00:00:00.000Z");
  assert.ok(json.missionTraces && json.missionTraces.length === 1, "the JSON report carries the single flat trace");
  assert.equal(json.missionTraces[0]!.children.length, 0, "the JSON trace's flat root has no children");
  const md = buildHubSessionMarkdownReport(sessionRow, events, "2026-07-27T00:00:00.000Z");
  assert.ok(md.includes("## Mission trace"), "the Markdown report renders the mission-trace section");
  assert.ok(md.includes("1 mission tree"), "the Markdown names exactly one (flat) mission tree");
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════
//  P-REG1 — No Phase 3-4 regression.  The 2.R suite (`hub-crew-nesting-wp2r-review.test.ts`, 17 subtests)
//  was authored against the Phase-2 engine + WP3.1 replay; Phases 3-4 then changed board.ts, mission-trace/
//  session-report, and the web reducers. Every probe ABOVE re-mounts a 2.R-refuted invariant against the
//  NOW-integrated code (budget monotonicity P-BUD*, cycle/depth P-CYC*, autonomy P-AUT1, grants P-GRA1,
//  isolation P-ISO1, replay P-REP1) and holds — so P-REG1 is largely SUBSUMED. This probe adds an explicit
//  integration re-check of the two invariants most exposed to the Phase-3 board/replay changes: replay
//  fidelity under a budget-TRIPPED nested tree, and per-level roll-up correctness. The FULL 2.R suite is
//  ALSO run in the gate as the regression witness (see 5.R-review.md §4).
// ══════════════════════════════════════════════════════════════════════════════════════════════════════

test("P-REG1 REFUTED — a budget-TRIPPED nested tree still replays its PARTIAL mark from events after Phases 3-4 (no board.ts regression)", async () => {
  const { repo } = open();
  const g = graph(repo);
  const a = g.role("Nested A");
  const b = g.role("Nested B");
  const c = g.role("Nested C");
  const crewC = g.crew("crewC", "Child", "parallel", [{ agentId: a.id }, { agentId: b.id }, { agentId: c.id }]);
  // The nested allocation is small ($1) so the SUB-mission trips its OWN budget; the $100 root never trips.
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
  assert.equal(board.synthesis?.partial, true, "the budget-trip partial mark survives replay at the root");
  const childId = repo.listChildMissions(mission.id)[0]!.id;
  const sub = reconstructMissionById(events, childId);
  assert.equal(sub?.synthesis?.partial, true, "the sub-mission's own partial mark survives replay (board.ts tree reducer intact)");

  // The Phase-3.2 report trace also rolls the tripped sub-mission up correctly (mission-trace.ts intact).
  const forest = buildMissionTraceForest(events);
  assert.equal(forest.length, 1, "one root trace node");
  assert.ok(forest[0]!.children.length >= 1, "the root trace node carries the nested sub-mission as a child");
  assert.equal(forest[0]!.synthesis?.partial, true, "the report trace preserves the root partial mark");
});
