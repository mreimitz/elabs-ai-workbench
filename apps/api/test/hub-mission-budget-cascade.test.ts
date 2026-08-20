// Crew nesting (planning/Roadmap/RM-10-crew-nesting/, WP2.2 · D-CN3, closing R4/R1/R3) — the WHOLE-TREE BUDGET CASCADE:
// a monotone-non-increasing allocation (`sum(child allocations) ≤ parent allocation` at EVERY node, so
// aggregate spend can never exceed the root `min(requested, HUB_MISSION_MAX_BUDGET_USD)`), a whole-tree
// propose gate (transitive agent count / tree-bounded cost / total-agent 400), a cascading run-time trip,
// the R3c zero-allocation trap, and honest-partial propagation. Driven by STUBS only — no real provider or
// MCP server is ever contacted. Lives in `apps/api/test/` because the api runner globs `test/*.test.ts`.
//
// Proves (per-Acceptance):
//   • `allocateChildBudget` is exactly `Math.max(0, Math.min(req, remaining))` and takes NO `caps` arg;
//   • the CRITICAL monotone property over randomized branchy/deep trees (both the pure allocation discipline
//     and `summarizeMissionTree` over random crew graphs): sum(child allocations) ≤ node allocation, and
//     sum(leaf allocations) ≤ root allocation === min(rootRequested, caps.maxBudgetUsd);
//   • the propose gate is WHOLE-TREE (a crew hiding transitive agents past the threshold does NOT auto-run,
//     whereas the same flat count would), and a tree over maxTotalAgents throws a loud 400;
//   • the run-time cascading trip: a nested mission tripping ITS OWN allocation yields a low-confidence,
//     truncation-noted sub-report and a PARTIAL parent synthesis — WITHOUT the whole-tree cap being reached;
//   • a parent trip aborts in-flight nested descendants + halts further nested launches (composed isTripped);
//   • R3c: a crew-ref handed a 0 allocation is settled skipped/partial, never spawned unbounded.

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
  HubMissionPlan,
  HubPlannedAgent,
  HubTopology,
} from "@mcp-token-footprint/shared";
import { applyMigrations, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { HubRepository } from "../src/hub/repository.js";
import type { HubTurnSink } from "../src/hub/turn-engine.js";
import {
  allocateChildBudget,
  clampPlanToBudgets,
  estimatePlanCostUsd,
  HubMissionService,
  summarizeMissionTree,
  type HubAgentRunInput,
  type HubAgentRunner,
  type HubMissionCaps,
  type HubMissionServiceConfig,
  type HubPlanner,
  type HubResolvedCrew,
  type HubSynthesizer,
} from "../src/hub/missions/index.js";

// ── (1) the primitive: allocateChildBudget === Math.max(0, Math.min(req, remaining)), no caps ──────────

test("allocateChildBudget is exactly max(0, min(req, remaining)) and takes NO caps argument", () => {
  // Signature: exactly two numeric params (no `caps`) — structurally it can never re-read an env ceiling.
  assert.equal(allocateChildBudget.length, 2, "allocateChildBudget takes exactly two args (no caps)");
  const cases: Array<[number, number]> = [
    [5, 10],
    [10, 5],
    [-3, 10],
    [10, -3],
    [0, 10],
    [10, 0],
    [7.5, 7.5],
    [3.2, 8.1],
  ];
  for (const [req, remaining] of cases) {
    assert.equal(
      allocateChildBudget(req, remaining),
      Math.max(0, Math.min(req, remaining)),
      `allocateChildBudget(${req}, ${remaining})`,
    );
  }
});

// ── (2a) CRITICAL monotone property over randomized branchy/deep trees (the pure discipline) ───────────

/** A deterministic LCG so the property test is reproducible (a failure is inspectable, never flaky). */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

type BudgetNode = {
  /** This subtree's REQUESTED budget. `undefined` ⇒ a crew that names none → inherits the parent's
   *  remaining (the summarizeMissionTree rule); a leaf always carries a concrete non-negative cost. */
  requestedUsd: number | undefined;
  children: BudgetNode[];
};

/** Generate a random branchy/deep tree of requested budgets (some undefined, some 0, some positive). */
function randomTree(rng: () => number, depth: number, maxDepth: number): BudgetNode {
  const req = (() => {
    const roll = rng();
    if (roll < 0.25) return undefined; // names none → inherit
    if (roll < 0.35) return 0; // an explicit zero
    return Math.round(rng() * 2000) / 100; // $0.00 .. $20.00
  })();
  const children: BudgetNode[] = [];
  if (depth < maxDepth) {
    const n = Math.floor(rng() * 5); // 0..4 children (branchy)
    for (let i = 0; i < n; i++) children.push(randomTree(rng, depth + 1, maxDepth));
  }
  return { requestedUsd: req, children };
}

/**
 * Walk a tree top-down subdividing `allocationUsd` EXACTLY as summarizeMissionTree / the run-time cascade
 * do (a `reservable` pool + {@link allocateChildBudget}; a node that names none inherits the remaining),
 * asserting `sum(child allocations) ≤ node allocation` at EVERY node. Returns the subtree's LEAF-allocation
 * sum so the caller can assert `sum(leaf allocations) ≤ root allocation`.
 */
function walkAssertMonotone(node: BudgetNode, allocationUsd: number, path: string): number {
  let reservable = allocationUsd;
  let allocated = 0;
  let leafSum = 0;
  node.children.forEach((child, i) => {
    const alloc =
      child.requestedUsd !== undefined && child.requestedUsd > 0
        ? allocateChildBudget(child.requestedUsd, reservable)
        : Math.max(0, reservable);
    // Each individual allocation never exceeds what remains (the load-bearing per-child bound).
    assert.ok(
      alloc <= reservable + 1e-9,
      `${path}/${i}: child allocation ${alloc} ≤ remaining ${reservable}`,
    );
    assert.ok(alloc >= 0, `${path}/${i}: allocation is non-negative`);
    reservable -= alloc;
    allocated += alloc;
    leafSum += child.children.length === 0 ? alloc : walkAssertMonotone(child, alloc, `${path}/${i}`);
  });
  // (a) sum(child allocations) ≤ node allocation, at EVERY node.
  assert.ok(
    allocated <= allocationUsd + 1e-9,
    `${path}: sum(child allocations) ${allocated} ≤ node allocation ${allocationUsd}`,
  );
  return leafSum;
}

test("CRITICAL: sum(child allocations) ≤ node allocation at EVERY node, over 400 randomized trees", () => {
  for (let seed = 1; seed <= 400; seed++) {
    const rng = makeRng(seed);
    const rootRequested = Math.round(rng() * 5000) / 100; // $0..$50
    const maxBudgetUsd = Math.round(rng() * 3000) / 100; // $0..$30 (the env ceiling)
    // (b) the root allocation is EXACTLY min(rootRequested, caps.maxBudgetUsd).
    const rootAllocation = Math.min(rootRequested, maxBudgetUsd);
    const tree = randomTree(rng, 0, 4);
    const leafSum = walkAssertMonotone(tree, rootAllocation, `seed${seed}`);
    // (b) sum(leaf allocations) ≤ root allocation === min(rootRequested, maxBudgetUsd) — NEVER violated.
    assert.ok(
      leafSum <= rootAllocation + 1e-9,
      `seed${seed}: sum(leaf allocations) ${leafSum} ≤ root allocation ${rootAllocation}`,
    );
  }
});

// ── (2b) CRITICAL monotone property over randomized crew GRAPHS through summarizeMissionTree ───────────

const PRICED_MODEL = "gpt-4o";

/** Build a minimal role/crew object (only the fields summarizeMissionTree reads) — cheap + cast-clean. */
function fakeRole(id: string): HubAgentRole {
  return { id, defaultModel: PRICED_MODEL } as unknown as HubAgentRole;
}
function fakeCrew(id: string, members: HubCrewMember[]): HubCrew {
  return { id, name: id, topology: "parallel", members } as unknown as HubCrew;
}
function leafAgent(key: string, budget?: number): HubPlannedAgent {
  return {
    key,
    name: key,
    systemPrompt: "",
    model: PRICED_MODEL,
    toolGrants: { servers: {}, builtins: [] },
    skillIds: [],
    brief: "",
    target: "",
    expectedOutcome: "",
    ...(budget !== undefined ? { budgets: { maxCostUsd: budget } } : {}),
  };
}
function crewRefAgent(key: string, crewId: string, budget?: number): HubPlannedAgent {
  return { ...leafAgent(key, budget), model: "", crewId };
}

test("CRITICAL: summarizeMissionTree estimatedCostUsd ≤ root allocation over 200 randomized crew graphs", () => {
  const caps: Pick<HubMissionCaps, "maxDepth" | "maxTotalAgents"> = { maxDepth: 4, maxTotalAgents: 64 };
  for (let seed = 1; seed <= 200; seed++) {
    const rng = makeRng(seed * 7 + 3);
    const crews = new Map<string, HubCrew>();
    const roles = new Map<string, HubAgentRole>();
    const crewCount = 1 + Math.floor(rng() * 5);
    // Build crews index-ordered; a crewId member may only reference a LOWER-indexed crew ⇒ acyclic (a DAG).
    for (let c = 0; c < crewCount; c++) {
      const members: HubCrewMember[] = [];
      const memberCount = Math.floor(rng() * 4);
      for (let m = 0; m < memberCount; m++) {
        if (c > 0 && rng() < 0.4) {
          const target = Math.floor(rng() * c); // strictly lower ⇒ no cycle
          members.push({
            crewId: `crew${target}`,
            ...(rng() < 0.5 ? { budgets: { maxCostUsd: Math.round(rng() * 500) / 100 } } : {}),
          });
        } else {
          const roleId = `role-${c}-${m}`;
          roles.set(roleId, fakeRole(roleId));
          members.push({ agentId: roleId });
        }
      }
      crews.set(`crew${c}`, fakeCrew(`crew${c}`, members));
    }
    const resolveCrew = (id: string): HubResolvedCrew | undefined => {
      const crew = crews.get(id);
      if (!crew) return undefined;
      const wanted = new Set(crew.members.map((mm) => mm.agentId).filter((v): v is string => !!v));
      return { crew, roles: [...roles.values()].filter((r) => wanted.has(r.id)) };
    };

    // Root planned agents: a random mix of leaves + crew-refs into the top crew.
    const rootAgents: HubPlannedAgent[] = [];
    const rootLeaves = Math.floor(rng() * 3);
    for (let i = 0; i < rootLeaves; i++) rootAgents.push(leafAgent(`root-leaf-${i}`));
    rootAgents.push(crewRefAgent("root-crew", `crew${crewCount - 1}`, rng() < 0.5 ? Math.round(rng() * 800) / 100 : undefined));

    const rootRequested = Math.round(rng() * 4000) / 100;
    const maxBudgetUsd = Math.round(rng() * 2500) / 100;
    const rootAllocationUsd = Math.min(rootRequested, maxBudgetUsd);
    const summary = summarizeMissionTree({ agents: rootAgents, rootAllocationUsd, resolveCrew }, caps);

    // summarizeMissionTree's estimate is itself MONOTONE: it can never exceed the root allocation.
    assert.ok(
      summary.estimatedCostUsd <= rootAllocationUsd + 1e-9,
      `seed${seed}: estimatedCostUsd ${summary.estimatedCostUsd} ≤ root allocation ${rootAllocationUsd}`,
    );
    assert.ok(summary.estimatedCostUsd >= 0, `seed${seed}: estimate is non-negative`);
    assert.ok(Number.isFinite(summary.transitiveAgentCount), `seed${seed}: count is finite`);
    assert.ok(summary.maxDepth <= caps.maxDepth!, `seed${seed}: maxDepth within cap`);
  }
});

// ── (2c) root allocation === min(rootRequested, caps.maxBudgetUsd) via the clamp ──────────────────────

test("the clamp pins the root allocation to min(rootRequested, caps.maxBudgetUsd) — the tree ceiling", () => {
  const caps: HubMissionCaps = {
    maxAgents: 8,
    maxParallel: 3,
    defaultBudgetUsd: 5,
    maxBudgetUsd: 12,
    askAboveAgents: 8,
    askAboveUsd: 100,
    maxDepth: 2,
    maxTotalAgents: 24,
  };
  // A plan requesting WAY over the env ceiling is clamped DOWN to it — that clamped value is the tree root.
  const plan: HubMissionPlan = {
    topology: "parallel",
    autonomy: "auto",
    agents: [leafAgent("a"), leafAgent("b")],
    budgets: { maxCostUsd: 999 },
  };
  const clamped = clampPlanToBudgets(plan, caps, "auto");
  assert.equal(clamped.budgets?.maxCostUsd, 12, "root allocation === min(999, maxBudgetUsd 12)");

  // A modest request rides through as-is (min(3, 12) = 3).
  const modest = clampPlanToBudgets({ ...plan, budgets: { maxCostUsd: 3 } }, caps, "auto");
  assert.equal(modest.budgets?.maxCostUsd, 3, "root allocation === min(3, 12)");
});

// ── (9) FLAT missions unaffected: transitiveAgentCount === agents.length, maxDepth 0, estimate == flat ──

test("summarizeMissionTree on a FLAT plan: count === agents.length, maxDepth 0, estimate == estimatePlanCostUsd", () => {
  const caps: Pick<HubMissionCaps, "maxDepth" | "maxTotalAgents"> = { maxDepth: 2, maxTotalAgents: 24 };
  const agents = [leafAgent("a"), leafAgent("b"), leafAgent("c")];
  const rootAllocationUsd = 100; // generous ⇒ no bounding, so the tree estimate equals the flat sum
  const summary = summarizeMissionTree(
    { agents, rootAllocationUsd, resolveCrew: () => undefined },
    caps,
  );
  assert.equal(summary.transitiveAgentCount, 3, "transitiveAgentCount === plan.agents.length");
  assert.equal(summary.maxDepth, 0, "a flat mission has maxDepth 0");
  const flat = estimatePlanCostUsd({ topology: "parallel", autonomy: "auto", agents });
  assert.ok(
    Math.abs(summary.estimatedCostUsd - flat) < 1e-9,
    `flat estimate matches estimatePlanCostUsd (${summary.estimatedCostUsd} vs ${flat})`,
  );
});

// ── Run-time harness (a real service over stubbed seams) ───────────────────────────────────────────────

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
  defaultModel: PRICED_MODEL,
  target: `Target for ${over.name}`,
  expectedOutcome: "A report.",
  ...over,
});

function report(over: Partial<HubAgentReport> = {}): HubAgentReport {
  return { findings: [{ summary: "A finding." }], citations: [], artifacts: [], confidence: "medium", openQuestions: [], ...over };
}

const DEFAULT_CONFIG: HubMissionServiceConfig = {
  maxAgents: 8,
  maxParallel: 3,
  defaultBudgetUsd: 100,
  maxBudgetUsd: 500,
  askAboveAgents: 20,
  askAboveUsd: 1000,
  defaultAutonomy: "auto",
  maxDepth: 3,
  maxTotalAgents: 24,
};

const synthesizerCiting: HubSynthesizer = async () => ({
  text: "Combined synthesis.",
  usage: { tokensIn: 5, tokensOut: 5 },
  costUsd: 0,
});

const plannerNever: HubPlanner = async () => {
  throw new Error("the planner must never run on a crew-instantiation path");
};

function graph(repo: HubRepository) {
  const crews = new Map<string, HubCrew>();
  const roles = new Map<string, HubAgentRole>();
  const now = "2026-07-26T00:00:00.000Z";
  return {
    role(name: string): HubAgentRole {
      const r = repo.createAgentRole(roleInput({ name }));
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
  logger?: { warn?: (msg: string) => void };
}): HubMissionService {
  return new HubMissionService({
    repository: over.repository,
    planner: plannerNever,
    runAgent: over.runAgent,
    synthesizer: synthesizerCiting,
    resolveCrew: over.resolveCrew,
    config: { ...DEFAULT_CONFIG, ...over.config },
    ...(over.logger ? { logger: over.logger } : {}),
    now: () => "2026-07-26T00:00:00.000Z",
  });
}

function session(repo: HubRepository, autonomy: "always_ask" | "threshold" | "auto" = "auto") {
  return repo.createSession({ mode: "mission", model: PRICED_MODEL, autonomy });
}

function leafRunner(opts: { costPerLeaf?: number; invocations?: string[] }): HubAgentRunner {
  return async (input: HubAgentRunInput) => {
    if (input.abortSignal.aborted) return { report: undefined, costUsd: 0, tokensIn: 0, tokensOut: 0, aborted: true };
    opts.invocations?.push(input.roleName);
    return { report: report({ summary: input.roleName, roleName: input.roleName }), costUsd: opts.costPerLeaf ?? 0.1, tokensIn: 10, tokensOut: 5 };
  };
}

function synthesisEvents(events: HubEvent[], missionId?: string) {
  return events.filter(
    (e): e is Extract<HubEvent, { type: "mission_synthesis" }> =>
      e.type === "mission_synthesis" && (missionId === undefined || e.missionId === missionId),
  );
}
function agentReports(events: HubEvent[], missionId?: string) {
  return events.filter(
    (e): e is Extract<HubEvent, { type: "agent_report" }> =>
      e.type === "agent_report" && (missionId === undefined || e.missionId === missionId),
  );
}

// ── (4) the propose gate is WHOLE-TREE (transitive count, not direct members) ─────────────────────────

test("propose gate is whole-tree: a threshold crew hiding transitive agents past the ceiling does NOT auto-run", async () => {
  const { repo } = open();
  const g = graph(repo);
  // Two nested crews of 4 leaves each ⇒ transitive 8 (>5); flatly the root has only 2 direct crew-ref members.
  const leaves = (prefix: string) => [1, 2, 3, 4].map((i) => ({ agentId: g.role(`${prefix}${i}`).id }));
  const crewX = g.crew("crewX", "X", "parallel", leaves("X"));
  const crewY = g.crew("crewY", "Y", "parallel", leaves("Y"));
  // Each crew-ref names its own budget so the parent's pool is SHARED (not greedily grabbed by the first) —
  // so BOTH sub-crews run their 4 leaves ⇒ transitive 8, each within its allocation.
  g.crew("crewP", "Parent", "parallel", [
    { crewId: crewX.id, budgets: { maxCostUsd: 10 } },
    { crewId: crewY.id, budgets: { maxCostUsd: 10 } },
  ]);

  const { sink } = collectSink();
  const service = makeService({
    repository: repo,
    resolveCrew: g.resolveCrew,
    runAgent: leafRunner({}),
    // askAboveAgents 5: a FLAT count of 2 (the direct members) would auto-run; the transitive 8 must NOT.
    config: { askAboveAgents: 5, askAboveUsd: 1000, defaultAutonomy: "threshold", maxDepth: 2, maxTotalAgents: 24 },
  });

  const s = session(repo, "threshold");
  const mission = await service.proposePlan({ sessionId: s.id, text: "run", sink, crewId: "crewP" });
  assert.equal(
    mission.status,
    "proposed",
    "the whole-tree count (8) exceeds askAboveAgents (5) ⇒ waits for approval, not auto-run",
  );

  // Control: a FLAT crew with the SAME direct count (2 leaves) auto-runs — proving the flat count WOULD have.
  const flatA = g.role("FlatA");
  const flatB = g.role("FlatB");
  g.crew("crewFlat", "Flat", "parallel", [{ agentId: flatA.id }, { agentId: flatB.id }]);
  const s2 = session(repo, "threshold");
  const flatMission = await service.proposePlan({ sessionId: s2.id, text: "run", sink, crewId: "crewFlat" });
  assert.equal(flatMission.status, "completed", "the same FLAT count (2 ≤ 5) auto-approves and runs");
});

// ── (5) maxTotalAgents enforced at PROPOSE with a loud 400 (never a silent subtree drop) ───────────────

test("a tree over HUB_MISSION_MAX_TOTAL_AGENTS throws a loud 400 at propose (D-CN4)", async () => {
  const { repo } = open();
  const g = graph(repo);
  const leaves = [1, 2, 3, 4, 5].map((i) => ({ agentId: g.role(`Big${i}`).id }));
  const crewBig = g.crew("crewBig", "Big", "parallel", leaves);
  g.crew("crewP", "Parent", "parallel", [{ crewId: crewBig.id }]);

  const { sink } = collectSink();
  const service = makeService({
    repository: repo,
    resolveCrew: g.resolveCrew,
    runAgent: leafRunner({}),
    config: { maxTotalAgents: 3, maxDepth: 3 },
  });

  const s = session(repo, "auto");
  await assert.rejects(
    () => service.proposePlan({ sessionId: s.id, text: "run", sink, crewId: "crewP" }),
    (err: unknown) => {
      const e = err as { statusCode?: number; message?: string };
      assert.equal(e.statusCode, 400, "a whole-tree overflow is a loud 400");
      assert.match(String(e.message), /over the limit of 3/i, "the message names the total-agent limit");
      return true;
    },
  );
});

// ── (6) run-time cascading trip: a NESTED mission trips ITS OWN allocation (not the whole-tree cap) ─────

test("cascading trip: a nested mission tripping ITS OWN budget → low-confidence, truncation-noted, PARTIAL parent", async () => {
  const { repo } = open();
  const g = graph(repo);
  const a = g.role("Nested A");
  const b = g.role("Nested B");
  const c = g.role("Nested C");
  const crewC = g.crew("crewC", "Child Crew", "parallel", [{ agentId: a.id }, { agentId: b.id }, { agentId: c.id }]);
  // The crew-ref member names a SMALL budget ($1) — the child crew's own subtree allocation. The ROOT budget
  // is huge ($100), so the whole-tree cap is never reached: only the NESTED allocation trips.
  g.crew("crewP", "Parent", "parallel", [{ crewId: crewC.id, budgets: { maxCostUsd: 1 } }]);

  const invocations: string[] = [];
  const { sink, events } = collectSink();
  const service = makeService({
    repository: repo,
    resolveCrew: g.resolveCrew,
    runAgent: leafRunner({ costPerLeaf: 1, invocations }),
    config: { defaultBudgetUsd: 100, maxParallel: 1 }, // root cap $100 ⇒ never trips the whole tree
  });

  const s = session(repo, "auto");
  const mission = await service.proposePlan({ sessionId: s.id, text: "run", sink, crewId: "crewP" });
  assert.equal(mission.status, "completed");

  // Exactly ONE nested leaf ran ($1 = the child's OWN allocation) — its budget tripped, not the $100 root cap.
  assert.equal(invocations.length, 1, "the nested allocation ($1) tripped after one $1 leaf; the rest skipped");

  const childId = repo.listChildMissions(mission.id)[0]!.id;
  assert.equal(synthesisEvents(events, childId)[0]?.partial, true, "the sub-mission is partial (its own budget tripped)");

  // Design D — the rolled-up crew-ref report is honest-partial: low confidence + the truncation open-question.
  const crewReport = agentReports(events, mission.id).find((e) => e.report.subMissionId !== undefined)!;
  assert.equal(crewReport.report.confidence, "low", "the crew-ref report's confidence is lowered to low");
  assert.ok(
    crewReport.report.openQuestions.some((q) => /stopped early|budget exhausted|partial/i.test(q)),
    "the crew-ref report carries the truncation open-question",
  );

  // The PARENT synthesis carries PARTIAL (childPartial propagated up even though the crew-ref DID produce a report).
  assert.equal(synthesisEvents(events, mission.id)[0]?.partial, true, "the parent synthesis is marked PARTIAL");
});

// ── (7) a PARENT budget trip aborts in-flight nested descendants + halts further nested launches ───────

test("a parent (root) budget trip aborts the in-flight nested leaf AND stops the next nested launch", async () => {
  const { repo } = open();
  const g = graph(repo);
  const rootLeaf = g.role("Root Leaf");
  const nested1 = g.role("Nested One");
  const nested2 = g.role("Nested Two");
  const crewC = g.crew("crewC", "Child", "parallel", [{ agentId: nested1.id }, { agentId: nested2.id }]);
  g.crew("crewP", "Parent", "parallel", [{ agentId: rootLeaf.id }, { crewId: crewC.id }]);

  const { sink } = collectSink();
  let signalNestedInFlight: (() => void) | undefined;
  const nestedInFlight = new Promise<void>((resolve) => {
    signalNestedInFlight = resolve;
  });
  let sawNestedAbort = false;
  let nested2Ran = false;
  const runAgent: HubAgentRunner = async (input) => {
    if (input.roleName === "Root Leaf") {
      // Wait until a nested leaf is in flight, THEN spend enough to trip the $1 root cap ($2 > $1).
      await nestedInFlight;
      return { report: report({ roleName: input.roleName }), costUsd: 2, tokensIn: 1, tokensOut: 1 };
    }
    if (input.roleName === "Nested Two") {
      nested2Ran = true;
      return { report: report({ roleName: input.roleName }), costUsd: 0.1, tokensIn: 1, tokensOut: 1 };
    }
    // Nested One: announce it is in flight, then block until aborted by the ancestor (root) trip.
    signalNestedInFlight?.();
    await new Promise<void>((resolve) => {
      if (input.abortSignal.aborted) {
        sawNestedAbort = true;
        resolve();
        return;
      }
      input.abortSignal.addEventListener("abort", () => {
        sawNestedAbort = true;
        resolve();
      });
    });
    return { report: undefined, costUsd: 0, tokensIn: 0, tokensOut: 0, aborted: true };
  };
  const service = makeService({
    repository: repo,
    resolveCrew: g.resolveCrew,
    runAgent,
    // Root cap $1; maxParallel 2 so the root leaf + a nested leaf overlap. defaultBudgetUsd is the root cap.
    config: { defaultBudgetUsd: 1, maxParallel: 2 },
  });

  const s = session(repo, "auto");
  await service.proposePlan({ sessionId: s.id, text: "run", sink, crewId: "crewP" });

  assert.ok(sawNestedAbort, "the ANCESTOR (root) budget trip aborted the in-flight nested descendant");
  assert.equal(nested2Ran, false, "the composed isBudgetTripped halted the NEXT nested launch after the ancestor trip");
});

// ── (8) R3c: a crew-ref handed a 0 allocation is settled skipped/partial, NEVER spawned unbounded ──────

test("R3c: a sibling crew-ref allocated 0 (pool exhausted) is settled skipped, never run unbounded", async () => {
  const { repo } = open();
  const g = graph(repo);
  const leafA = g.role("Leaf A");
  const leafB = g.role("Leaf B");
  const crewA = g.crew("crewA", "Crew A", "parallel", [{ agentId: leafA.id }]);
  const crewB = g.crew("crewB", "Crew B", "parallel", [{ agentId: leafB.id }]);
  // Two crew-ref siblings, NEITHER names a budget ⇒ the FIRST inherits the whole root pool, the SECOND gets 0.
  g.crew("crewP", "Parent", "parallel", [{ crewId: crewA.id }, { crewId: crewB.id }]);

  const invocations: string[] = [];
  const warnings: string[] = [];
  const { sink, events } = collectSink();
  const service = makeService({
    repository: repo,
    resolveCrew: g.resolveCrew,
    runAgent: leafRunner({ costPerLeaf: 0.1, invocations }),
    config: { defaultBudgetUsd: 10, maxParallel: 1 }, // sequential ⇒ crewA reserves the whole $10 before crewB
    logger: { warn: (m) => warnings.push(m) },
  });

  const s = session(repo, "auto");
  const mission = await service.proposePlan({ sessionId: s.id, text: "run", sink, crewId: "crewP" });
  assert.equal(mission.status, "completed", "a 0-allocation skip does not crash the tree");

  assert.deepEqual(invocations, ["Leaf A"], "crewA (inherited the pool) ran; crewB (0 allocation) never ran unbounded");
  assert.ok(warnings.some((m) => /exhausted|skipped|0 allocation/i.test(m)), "the 0-allocation skip was logged loudly");

  // Exactly ONE sub-mission row exists (crewA) — the 0-allocation crewB was never spawned.
  assert.equal(repo.listChildMissions(mission.id).length, 1, "only crewA became a sub-mission; crewB was never spawned");
  // The crewB container settled skipped (aborted), and the root is honestly PARTIAL.
  const errored = repo.listMissionAgentSessions(mission.id).filter((sess) => sess.status === "aborted");
  assert.ok(errored.length >= 1, "the 0-allocation crew-ref container settled skipped (aborted)");
  assert.equal(synthesisEvents(events, mission.id)[0]?.partial, true, "the root synthesis is honestly PARTIAL (a member was skipped)");
});
