// Crew nesting (planning/Roadmap/RM-10-crew-nesting/, WP2.1 · D-CN1/D-CN2/D-CN3/D-CN4/D-CN6) — the RECURSION HEART of the
// engine, driven entirely by STUBBED seams (injected `runAgent`/`resolveCrew`; NO real provider or MCP
// server is ever contacted). File lives at `apps/api/test/` because the api runner globs `test/*.test.ts`.
//
// Proves (per-Acceptance):
//   • a 2-level crew runs as a sub-mission and projects ONE stamped `HubAgentReport` through the existing
//     `HubAgentRunResult` channel (subMissionId/topology/childReports set), stamped on the CONTAINER child —
//     the parent topology stays agnostic about leaf-vs-sub-crew;
//   • the child `hub_missions` row is created by the ENGINE with parent_mission_id / depth+1 / root_mission_id
//     and session_id = the ROOT chat session — created DIRECTLY, NOT via the proposePlan gate: its plan is
//     EVENT-SOURCED (WP3.1) as a `plan_proposed` carrying parent-linkage, but there is NO `plan_approved` (no HITL);
//   • the SHARED abort/cost/limiter are threaded through all levels (no fresh per level): a nested tree's
//     aggregate leaf spend is ≤ the root cost cap via the shared accumulator + shared trip (mid-tree trip),
//     and global concurrent leaf runs never exceed the root `maxParallel`;
//   • run-time over-depth, path-cycle, and maxTotalAgents overflow each reject LOUDLY (a warn + a failed
//     container + an honest partial branch) — never an infinite loop, silent skip, or whole-tree crash.

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
  HubTopology,
} from "@mcp-token-footprint/shared";
import { applyMigrations, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { HubRepository } from "../src/hub/repository.js";
import type { HubTurnSink } from "../src/hub/turn-engine.js";
import {
  HubMissionService,
  type HubAgentRunInput,
  type HubAgentRunner,
  type HubMissionServiceConfig,
  type HubPlanner,
  type HubResolvedCrew,
  type HubSynthesizer,
} from "../src/hub/missions/index.js";

// ── Harness ─────────────────────────────────────────────────────────────────────────────────────

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
  maxAgents: 8,
  maxParallel: 3,
  defaultBudgetUsd: 5.0,
  maxBudgetUsd: 20.0,
  askAboveAgents: 8,
  askAboveUsd: 100.0,
  defaultAutonomy: "auto",
  // Depth 2 = root + one nested level; total-agent ceiling roomy — individual tests tighten these.
  maxDepth: 2,
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

/**
 * A crew-graph substrate resolved by `resolveCrew` (hand-built so a cyclic / over-cap graph can be injected,
 * simulating a graph mutated AFTER WP1.1's author-time check — exactly what the run-time guard defends). Roles
 * are created in the repo (so leaves are real); crews are plain objects the stub resolver reads.
 */
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

function missionSession(repo: HubRepository) {
  return repo.createSession({ mode: "mission", model: "gpt-4o", autonomy: "auto" });
}

/** Leaf runner keyed by role name (structured mode — returns a report directly). Records every invocation
 *  (roleName), its returned cost, and tracks max concurrency via a small delay so overlap is observable. */
function leafRunner(opts: {
  costPerLeaf?: number;
  delayMs?: number;
  reportFor?: (roleName: string) => HubAgentReport;
  invocations?: string[];
  concurrency?: { current: number; max: number };
}): HubAgentRunner {
  return async (input: HubAgentRunInput) => {
    if (input.abortSignal.aborted) {
      return { report: undefined, costUsd: 0, tokensIn: 0, tokensOut: 0, aborted: true };
    }
    opts.invocations?.push(input.roleName);
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

// ── (1) a 2-level crew runs as a sub-mission → ONE stamped report + child-row lineage ──────────────────

test("a nested crew runs as a SUB-MISSION → one stamped report; parent topology agnostic; child-row lineage", async () => {
  const { repo, db } = open();
  const g = graph(repo);
  const leaf1 = g.role("Leaf One");
  const leaf2 = g.role("Leaf Two");
  const leaf3 = g.role("Leaf Three");
  const crewC = g.crew("crewC", "Child Crew", "parallel", [{ agentId: leaf2.id }, { agentId: leaf3.id }]);
  g.crew("crewP", "Parent Crew", "parallel", [{ agentId: leaf1.id }, { crewId: crewC.id }]);

  const { sink } = collectSink();
  const service = makeService({
    repository: repo,
    resolveCrew: g.resolveCrew,
    runAgent: leafRunner({
      reportFor: (name) =>
        name === "Leaf Two"
          ? report({ summary: "L2", roleName: name, citations: [{ id: "1", title: "Source X", url: "https://x/1" }] })
          : name === "Leaf Three"
            ? report({ summary: "L3", roleName: name, citations: [{ id: "1", title: "Source Y", url: "https://y/1" }] })
            : report({ summary: name, roleName: name }),
    }),
  });

  const session = missionSession(repo);
  const mission = await service.proposePlan({ sessionId: session.id, text: "Analyze topic Z", sink, crewId: "crewP" });
  assert.equal(mission.status, "completed", "the root mission completed");

  const all = repo.listEvents(session.id);

  // The PARENT log carries exactly TWO agent_reports for the ROOT mission: the leaf agent + the crew-ref
  // (the whole sub-crew surfaced as ONE normal agent_report — the parent topology never knew the difference).
  const parentReports = agentReports(all, mission.id);
  assert.equal(parentReports.length, 2, "the root mission saw two agent_reports (a leaf + a crew-ref)");
  const crewReport = parentReports.find((e) => e.report.subMissionId !== undefined);
  assert.ok(crewReport, "one of the root's agent_reports rolls up a sub-mission");
  assert.equal(crewReport.report.topology, "parallel", "the crew-ref report carries the child crew's topology");
  assert.equal(crewReport.report.roleName, "Child Crew", "the crew-ref report is stamped with the child crew name");
  assert.equal(crewReport.report.childReports?.length, 2, "childReports = the sub-mission's two leaf reports");
  assert.equal(crewReport.report.depth, 1, "the crew-ref report's depth is root+1");
  // The projected report is stamped on the CONTAINER child session (agentSessionId), like any leaf.
  assert.equal(crewReport.report.agentSessionId, crewReport.agentSessionId, "stamped on the container child");
  // The merged member citations flowed up into the one report (agentRef re-stamped to the container).
  assert.equal(crewReport.report.citations.length, 2, "both members' sources merged into the crew-ref report");
  assert.ok(
    crewReport.report.citations.every((c) => c.agentRef === crewReport.agentSessionId),
    "the merged citations are re-stamped to the container (the parent sees one agent)",
  );

  // The child hub_missions row was created BY THE ENGINE with the WP0.2 lineage (D-CN6).
  const children = repo.listChildMissions(mission.id);
  assert.equal(children.length, 1, "one child mission row exists");
  const child = children[0]!;
  assert.equal(child.parentMissionId, mission.id, "parent_mission_id = the expanding (root) mission");
  assert.equal(child.depth, 1, "depth = parent + 1");
  assert.equal(child.sessionId, session.id, "session_id = the ROOT chat session (D-CN6)");
  const row = db.prepare("SELECT root_mission_id FROM hub_missions WHERE id = ?").get(child.id) as {
    root_mission_id: string;
  };
  assert.equal(row.root_mission_id, mission.id, "root_mission_id points at the root mission");
  assert.equal(repo.getMissionTree(mission.id).length, 2, "the tree is the root + its one child");

  // The sub-mission ran its OWN two leaves (agent_reports tagged with the child mission id).
  assert.equal(agentReports(all, child.id).length, 2, "the sub-mission produced its own two leaf reports");

  // Crew nesting (WP3.1 / D-CN7, R-SES1) — the child's plan is EVENT-SOURCED: exactly one `plan_proposed`
  // for the child, carrying parent-linkage back to the expanding mission + its crew-node slot, so the whole
  // tree reconstructs from `hub_events` alone. This is a plan_proposed EVENT, not the `proposePlan` gate.
  const crewNodeKey = mission.plan.agents.find((a) => a.crewId !== undefined)!.key;
  const childProposed = all.filter(
    (e): e is Extract<HubEvent, { type: "plan_proposed" }> =>
      e.type === "plan_proposed" && e.missionId === child.id,
  );
  assert.equal(childProposed.length, 1, "the child emits exactly one plan_proposed (event-sourced hierarchy)");
  assert.equal(childProposed[0]!.parentMissionId, mission.id, "the child plan_proposed links to the parent mission");
  assert.equal(childProposed[0]!.parentAgentKey, crewNodeKey, "the child plan_proposed names the parent crew-node slot");
  // D-CN1 — but still created DIRECTLY by the engine, NEVER via the HITL propose/approve gate: no approval.
  assert.equal(
    all.filter((e) => e.type === "plan_approved" && e.missionId === child.id).length,
    0,
    "no plan_approved event for the child (no HITL/approve path)",
  );

  // The container child session settled completed (not clobbered to aborted by the bulk skip pass).
  const containerSession = repo.getSession(crewReport.agentSessionId);
  assert.equal(containerSession.status, "completed", "the crew-ref container session completed");
});

// ── (2) shared cost accumulator + shared trip: aggregate leaf spend ≤ the root cap (mid-tree trip) ─────

test("SHARED cost accumulator + trip: a nested tree's aggregate leaf spend is bounded by the ROOT cap", async () => {
  const { repo } = open();
  const g = graph(repo);
  const leaf1 = g.role("Root Leaf");
  const c2 = g.role("Nested A");
  const c3 = g.role("Nested B");
  const c4 = g.role("Nested C");
  const c5 = g.role("Nested D");
  const crewC = g.crew("crewC", "Child", "parallel", [
    { agentId: c2.id },
    { agentId: c3.id },
    { agentId: c4.id },
    { agentId: c5.id },
  ]);
  g.crew("crewP", "Parent", "parallel", [{ agentId: leaf1.id }, { crewId: crewC.id }]);

  const invocations: string[] = [];
  const { sink, events } = collectSink();
  // maxParallel:1 ⇒ leaves run strictly one at a time GLOBALLY (deterministic trip point). Each leaf costs $1,
  // the ROOT cap is $3 ⇒ after leaf1 + two nested leaves ($3) the shared trip fires; the rest never launch.
  const service = makeService({
    repository: repo,
    resolveCrew: g.resolveCrew,
    runAgent: leafRunner({ costPerLeaf: 1, invocations }),
    config: { maxParallel: 1, defaultBudgetUsd: 3 },
  });

  const session = missionSession(repo);
  const mission = await service.proposePlan({ sessionId: session.id, text: "run", sink, crewId: "crewP" });

  // The shared accumulator + shared trip bound the WHOLE tree: exactly 3 leaves ran ($3 = the cap), and the
  // remaining two nested leaves were skipped — aggregate leaf spend ≤ the root's min(requested, maxBudgetUsd).
  assert.equal(invocations.length, 3, "the trip stopped the tree at the cap (3 of 5 potential leaves ran)");
  const aggregateLeafSpend = invocations.length * 1;
  assert.ok(aggregateLeafSpend <= 3, "aggregate leaf spend ≤ the root cost cap ($3)");
  assert.equal(mission.status, "completed");

  // Both the sub-mission and the root are honestly PARTIAL (a budget trip left planned work unrun).
  const childId = repo.listChildMissions(mission.id)[0]!.id;
  assert.equal(synthesisEvents(events, childId)[0]?.partial, true, "the sub-mission is partial (budget-tripped)");
  assert.equal(synthesisEvents(events, mission.id)[0]?.partial, true, "the root is partial (shared trip)");
});

// ── (3) global concurrency never exceeds the ROOT maxParallel (the shared limiter, not per-level) ──────

test("global concurrent leaf runs never exceed the ROOT maxParallel across nested levels", async () => {
  const { repo } = open();
  const g = graph(repo);
  const leaf1 = g.role("Root Leaf");
  const c2 = g.role("Nested A");
  const c3 = g.role("Nested B");
  const c4 = g.role("Nested C");
  const crewC = g.crew("crewC", "Child", "parallel", [{ agentId: c2.id }, { agentId: c3.id }, { agentId: c4.id }]);
  g.crew("crewP", "Parent", "parallel", [{ agentId: leaf1.id }, { crewId: crewC.id }]);

  const concurrency = { current: 0, max: 0 };
  const { sink } = collectSink();
  // Root maxParallel:2. Without a SHARED limiter, leaf1 (root level) + up to 2 nested (child level) could reach
  // 3 concurrent — the shared limiter pins it to 2 (a crew slot delegates without taking a permit).
  const service = makeService({
    repository: repo,
    resolveCrew: g.resolveCrew,
    runAgent: leafRunner({ delayMs: 15, concurrency }),
    config: { maxParallel: 2 },
  });

  const session = missionSession(repo);
  await service.proposePlan({ sessionId: session.id, text: "run", sink, crewId: "crewP" });

  assert.ok(concurrency.max <= 2, `global concurrent leaf runs (${concurrency.max}) never exceeded root maxParallel (2)`);
  assert.equal(concurrency.max, 2, "the shared limiter bites (concurrency reached but did not exceed 2)");
});

// ── (4) run-time guards reject LOUDLY + partial (never a loop / silent skip / whole-tree crash) ────────

test("run-time OVER-DEPTH rejects loudly (warn + failed container + partial); the leaf still runs", async () => {
  const { repo } = open();
  const g = graph(repo);
  const leaf1 = g.role("Root Leaf");
  const c2 = g.role("Nested");
  const crewC = g.crew("crewC", "Child", "parallel", [{ agentId: c2.id }]);
  g.crew("crewP", "Parent", "parallel", [{ agentId: leaf1.id }, { crewId: crewC.id }]);

  const warnings: string[] = [];
  const invocations: string[] = [];
  const { sink, events } = collectSink();
  // maxDepth:1 ⇒ ANY nested crew is over-depth at the first expansion (childDepth 1 >= 1).
  const service = makeService({
    repository: repo,
    resolveCrew: g.resolveCrew,
    runAgent: leafRunner({ invocations }),
    config: { maxDepth: 1 },
    logger: { warn: (m) => warnings.push(m) },
  });

  const session = missionSession(repo);
  const mission = await service.proposePlan({ sessionId: session.id, text: "run", sink, crewId: "crewP" });

  assert.deepEqual(invocations, ["Root Leaf"], "the leaf still ran; the over-depth crew-ref did NOT expand");
  assert.ok(warnings.some((m) => /depth/i.test(m)), "the over-depth reject was logged loudly");
  const errored = repo.listMissionAgentSessions(mission.id).filter((s) => s.status === "error");
  assert.equal(errored.length, 1, "the crew-ref container settled FAILED (a loud reject, not a silent skip)");
  assert.equal(synthesisEvents(events, mission.id)[0]?.partial, true, "the mission is honestly partial");
  assert.equal(mission.status, "completed", "one rejected branch does NOT crash the whole tree");
  assert.equal(repo.listChildMissions(mission.id).length, 0, "no sub-mission row was created for the rejected crew");
});

test("run-time CYCLE rejects loudly + terminates (a graph mutated after the author-time check)", async () => {
  const { repo, db } = open();
  const g = graph(repo);
  // A self-referencing crew, hand-built to bypass WP1.1's author-time cycle check (post-save mutation).
  g.crew("crewA", "Alpha", "parallel", [{ crewId: "crewA" }]);

  const warnings: string[] = [];
  const { sink } = collectSink();
  // maxDepth high so the CYCLE guard (not the depth guard) is what trips.
  const service = makeService({
    repository: repo,
    resolveCrew: g.resolveCrew,
    runAgent: leafRunner({}),
    config: { maxDepth: 5 },
    logger: { warn: (m) => warnings.push(m) },
  });

  const session = missionSession(repo);
  // The test COMPLETING is itself the proof of termination (no infinite recursion).
  const mission = await service.proposePlan({ sessionId: session.id, text: "run", sink, crewId: "crewA" });

  assert.ok(warnings.some((m) => /circular|cycle/i.test(m)), "the run-time cycle was rejected loudly");
  // The re-entrant crew-ref container settled FAILED (it belongs to the DEEPER sub-mission, so scan the tree).
  const erroredCount = db.prepare("SELECT COUNT(*) AS c FROM hub_sessions WHERE status = 'error'").get() as {
    c: number;
  };
  assert.ok(erroredCount.c >= 1, "the re-entrant crew-ref container settled FAILED");
  // The path visited-set ∪ the depth cap bound the recursion: at most a handful of missions are created.
  assert.ok(repo.getMissionTree(mission.id).length <= 4, "the mutated cyclic tree terminated (bounded)");
  assert.equal(mission.status, "completed", "the mutated cyclic branch did not crash the whole tree");
});

test("run-time maxTotalAgents overflow rejects the over-cap sub-crew branch loudly (graph mutated after propose)", async () => {
  // WP2.2 makes the WHOLE-TREE total-agent check the PRIMARY guard (at PROPOSE — see the budget-cascade
  // suite). The RUN-TIME backstop (D-CN4) now defends a graph MUTATED between save and run: this test
  // proposes a WITHIN-cap tree (so the propose gate passes), grows the nested crew past the cap, then runs
  // it — exercising the run-time `runSubCrew` leaf-count reject that catches what author-time could not.
  const { repo } = open();
  const g = graph(repo);
  const leaf1 = g.role("Root Leaf");
  const c2 = g.role("Nested A");
  const c3 = g.role("Nested B");
  const c4 = g.role("Nested C");
  // crewC starts with ONE member (within cap at propose: root leaf + 1 nested = 2 ≤ 2).
  const crewC = g.crew("crewC", "Child", "parallel", [{ agentId: c2.id }]);
  g.crew("crewP", "Parent", "parallel", [{ agentId: leaf1.id }, { crewId: crewC.id }]);

  const warnings: string[] = [];
  const invocations: string[] = [];
  const { sink } = collectSink();
  // maxTotalAgents:2. always_ask so proposePlan settles PROPOSED (no auto-run) — a window to mutate the graph.
  const service = makeService({
    repository: repo,
    resolveCrew: g.resolveCrew,
    runAgent: leafRunner({ invocations }),
    config: { maxTotalAgents: 2, maxDepth: 3, defaultAutonomy: "always_ask" },
    logger: { warn: (m) => warnings.push(m) },
  });

  const session = repo.createSession({ mode: "mission", model: "gpt-4o", autonomy: "always_ask" });
  const proposed = await service.proposePlan({ sessionId: session.id, text: "run", sink, crewId: "crewP" });
  assert.equal(proposed.status, "proposed", "the within-cap tree passes the propose gate and waits for approval");

  // The graph MUTATES after save — crewC grows to 3 direct leaves (D-CN4: never trust author-time at run).
  crewC.members = [{ agentId: c2.id }, { agentId: c3.id }, { agentId: c4.id }];
  await service.approve({ missionId: proposed.id, sink });
  const mission = repo.getMission(proposed.id);

  assert.deepEqual(invocations, ["Root Leaf"], "only the root leaf ran; the over-cap sub-crew was rejected");
  assert.ok(warnings.some((m) => /total agents/i.test(m)), "the maxTotalAgents overflow was rejected loudly");
  assert.equal(
    repo.listMissionAgentSessions(mission.id).filter((s) => s.status === "error").length,
    1,
    "the over-cap crew-ref container settled FAILED",
  );
  assert.equal(repo.listChildMissions(mission.id).length, 0, "no sub-mission row was created for the over-cap crew");
});

// ── (5) top-level stop reaches an in-flight nested leaf (the SHARED control map) ───────────────────────

test("stop(rootMissionId) reaches an in-flight NESTED leaf (registered in the shared agentAborts)", async () => {
  const { repo } = open();
  const g = graph(repo);
  const c2 = g.role("Nested Leaf");
  const crewC = g.crew("crewC", "Child", "parallel", [{ agentId: c2.id }]);
  g.crew("crewP", "Parent", "parallel", [{ crewId: crewC.id }]);

  const { sink } = collectSink();
  let sawAbort = false;
  let stopControl: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    stopControl = resolve;
  });
  const runAgent: HubAgentRunner = async (input) => {
    // Signal that a nested leaf is in flight, then wait — the mission Stop must abort THIS leaf.
    stopControl?.();
    await new Promise<void>((resolve) => {
      if (input.abortSignal.aborted) {
        sawAbort = true;
        resolve();
        return;
      }
      input.abortSignal.addEventListener("abort", () => {
        sawAbort = true;
        resolve();
      });
    });
    return { report: undefined, costUsd: 0, tokensIn: 0, tokensOut: 0, aborted: true };
  };
  const service = makeService({ repository: repo, resolveCrew: g.resolveCrew, runAgent });

  const session = missionSession(repo);
  const run = service.proposePlan({ sessionId: session.id, text: "run", sink, crewId: "crewP" });
  await started; // a nested leaf is now in flight
  const missionId = repo.getMissionBySession(session.id)!.id;
  service.stop(missionId); // stop the ROOT — must reach the nested leaf via the shared control
  await run;

  assert.ok(sawAbort, "the top-level stop aborted the in-flight NESTED leaf (shared control.agentAborts)");
});
