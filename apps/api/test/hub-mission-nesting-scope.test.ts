// Crew nesting (roadmap/crew-nesting/, WP2.3 · D-CN6/D-CN9 · map §2 R6 / §5-6) — the SECURITY ENVELOPE +
// RUN-CONTROL reaching EVERY level of a nested crew tree, driven entirely by STUBBED seams (injected
// `runAgent`/`resolveCrew`; NO real provider or MCP server is ever contacted). File lives at `apps/api/test/`
// because the api runner globs `test/*.test.ts`.
//
// Proves (per-Acceptance):
//   (i)  a level-2 agent's child-session toolScope equals the TRANSITIVE intersection down its path — a
//        root-dropped server is absent at level-2 even though its role's Access grants it, a root-narrowed
//        server is narrowed, a root-allowed server survives — and an explicit crew-ref narrowing binds the
//        whole sub-crew (transitive non-escalation, never re-widened from a nested crew's own Access — R6);
//   (ii) `missionUnreadyServers` RECURSES into a nested crew, so `approve()` blocks the WHOLE tree with the
//        actionable auth error naming a NESTED unready server; an all-ready tree runs to completion;
//   (iii) a top-level `stop()` aborts a level-2 in-flight agent (it settles `aborted`, no report; the
//        sub-mission + tree end `stopped`/partial; every descendant child is terminal; no `this.running`
//        entry leaks), and `stopAgent`/`steerAgent(subMissionId, agentId)` reach a level-2 agent.

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
import {
  HubMissionService,
  type HubAgentRunInput,
  type HubAgentRunner,
  type HubMissionServiceConfig,
  type HubPlanner,
  type HubResolvedCrew,
  type HubSynthesizer,
} from "../src/hub/missions/index.js";

/** The `isServerRunReady` readiness shape (inlined so this test needs no new export from the module). */
type ServerReadiness = { ready: boolean; serverName?: string };

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

/** A crew-graph substrate resolved by `resolveCrew` (roles created in the repo so leaves are real; crews are
 *  plain objects the stub resolver reads — a member may carry a `toolGrants` override for the narrowing case). */
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
  isServerRunReady?: (serverId: string) => ServerReadiness;
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

function scopedSession(repo: HubRepository, toolScope: HubToolGrants) {
  return repo.createSession({ mode: "mission", model: "gpt-4o", autonomy: "auto", toolScope });
}

/** A leaf runner that returns a report (structured mode) — records every invocation by role name. */
function leafRunner(invocations?: string[]): HubAgentRunner {
  return async (input: HubAgentRunInput) => {
    if (input.abortSignal.aborted) return { report: undefined, costUsd: 0, tokensIn: 0, tokensOut: 0, aborted: true };
    invocations?.push(input.roleName);
    return { report: report({ summary: input.roleName, roleName: input.roleName }), costUsd: 0.1, tokensIn: 10, tokensOut: 5 };
  };
}

/** A BLOCKING runner: announces a leaf is in flight (via `signalInFlight`) then waits until its abort signal
 *  fires — the stop/steer probe. Returns aborted with no report. */
function blockingRunner(hooks: { onInFlight: (input: HubAgentRunInput) => void; sawAbort: { value: boolean } }): HubAgentRunner {
  return async (input) =>
    new Promise((resolve) => {
      const finish = () => {
        hooks.sawAbort.value = true;
        resolve({ report: undefined, costUsd: 0, tokensIn: 0, tokensOut: 0, aborted: true });
      };
      hooks.onInFlight(input);
      if (input.abortSignal.aborted) return finish();
      input.abortSignal.addEventListener("abort", finish, { once: true });
    });
}

function synthesisEvents(events: HubEvent[], missionId?: string) {
  return events.filter(
    (e): e is Extract<HubEvent, { type: "mission_synthesis" }> =>
      e.type === "mission_synthesis" && (missionId === undefined || e.missionId === missionId),
  );
}

/** The ROOT mission id for a session — the one with no `parentMissionId`. NOT `getMissionBySession` (which is
 *  `created_at DESC LIMIT 1`): a sub-mission shares the ROOT chat session (D-CN6) and, under the fixed test
 *  clock, the same `created_at`, so that tie-break can return the sub-mission instead of the root. */
function rootMissionId(repo: HubRepository, sessionId: string): string {
  const root = repo.listMissions().find((m) => m.sessionId === sessionId && m.parentMissionId === undefined);
  assert.ok(root, "the root mission exists");
  return root.id;
}

// ── (i) a level-2 agent's toolScope === the TRANSITIVE intersection down its path ──────────────────────

test("(i) a level-2 agent's child toolScope is the TRANSITIVE intersection (root-dropped absent; root-allowed kept)", async () => {
  const { repo } = open();
  const g = graph(repo);
  // A level-2 role whose OWN Access grants MORE than the root scope allows.
  const leaf = g.role("Deep Leaf", {
    servers: { alpha: ["read", "write"], beta: "all", gamma: "all" },
    builtins: ["memory.save", "artifacts.create"],
  });
  const crewC = g.crew("crewC", "Child Crew", "parallel", [{ agentId: leaf.id }]);
  // The crew-ref member carries NO explicit grants (the common case) — it must NOT strip the sub-crew.
  g.crew("crewP", "Parent Crew", "parallel", [{ crewId: crewC.id }]);

  const { sink } = collectSink();
  const service = makeService({ repository: repo, resolveCrew: g.resolveCrew, runAgent: leafRunner() });
  // Root scope: alpha fully allowed, beta only [read], gamma NOT in scope; memory.save only.
  const session = scopedSession(repo, {
    servers: { alpha: "all", beta: ["read"] },
    builtins: ["memory.save"],
  });
  const mission = await service.proposePlan({ sessionId: session.id, text: "Analyze deep", sink, crewId: "crewP" });
  assert.equal(mission.status, "completed");

  const childId = repo.listChildMissions(mission.id)[0]!.id;
  const level2 = repo.listMissionAgentSessions(childId)[0]!;
  // effectiveAgentGrants(leaf.grants, rootScope) — the crew-ref (empty grants) passed the root scope through:
  //  alpha: [read,write] ∩ "all" = [read,write]; beta: "all" ∩ [read] = [read]; gamma dropped (root has none);
  //  builtins: [memory.save, artifacts.create] ∩ [memory.save] = [memory.save].
  assert.deepEqual(
    level2.toolScope?.servers,
    { alpha: ["read", "write"], beta: ["read"] },
    "the level-2 child's servers are the transitive intersection with the ROOT scope, not the raw role grants",
  );
  assert.equal("gamma" in (level2.toolScope?.servers ?? {}), false, "the root-dropped server is ABSENT at level-2");
  assert.deepEqual(level2.toolScope?.builtins, ["memory.save"], "root-ungranted built-ins are dropped at level-2");
});

test("(i-b) an EXPLICIT crew-ref narrowing binds the whole sub-crew (transitive non-escalation)", async () => {
  const { repo } = open();
  const g = graph(repo);
  // The level-2 role WANTS all of qlik; the enclosing crew-ref narrows qlik down to [search] for its sub-crew.
  const leaf = g.role("Sub Leaf", { servers: { qlik: "all" }, builtins: [] });
  const crewC = g.crew("crewC", "Child", "parallel", [{ agentId: leaf.id }]);
  g.crew("crewP", "Parent", "parallel", [
    { crewId: crewC.id, toolGrants: { servers: { qlik: ["search"] }, builtins: [] } },
  ]);

  const { sink } = collectSink();
  const service = makeService({ repository: repo, resolveCrew: g.resolveCrew, runAgent: leafRunner() });
  // Root scope allows ALL of qlik — the crew-ref's OWN narrowing (not the root) is what must bind the sub-crew.
  const session = scopedSession(repo, { servers: { qlik: "all" }, builtins: [] });
  const mission = await service.proposePlan({ sessionId: session.id, text: "Do", sink, crewId: "crewP" });
  assert.equal(mission.status, "completed");

  const childId = repo.listChildMissions(mission.id)[0]!.id;
  const level2 = repo.listMissionAgentSessions(childId)[0]!;
  assert.deepEqual(
    level2.toolScope?.servers,
    { qlik: ["search"] },
    "the crew-ref's [search] narrowing bounds the sub-crew even though root + the role both grant all of qlik",
  );
});

// ── (ii) missionUnreadyServers RECURSES into nested crews; approve() blocks the whole tree ─────────────

test("(ii) a NESTED crew granting an unready server → approve() BLOCKS the whole tree naming that server", async () => {
  const { repo } = open();
  const g = graph(repo);
  // The unready server is granted ONLY by a level-2 role — the flat root plan never names it.
  const leaf = g.role("Nested Qlik", { servers: { "srv-nested": "all" }, builtins: [] });
  const crewC = g.crew("crewC", "Child", "parallel", [{ agentId: leaf.id }]);
  g.crew("crewP", "Parent", "parallel", [{ crewId: crewC.id }]);

  const { sink, events } = collectSink();
  const service = makeService({
    repository: repo,
    resolveCrew: g.resolveCrew,
    runAgent: async () => {
      throw new Error("runAgent must not be called when the readiness gate blocks");
    },
    // srv-nested is registered but unauthenticated (a headless child can't OAuth); everything else is ready.
    isServerRunReady: (id) => (id === "srv-nested" ? { ready: false, serverName: "qlik-nested" } : { ready: true }),
  });
  // The session scopes srv-nested IN so it survives to the nested spawn.
  const session = scopedSession(repo, { servers: { "srv-nested": "all" }, builtins: [] });

  const mission = await service.proposePlan({ sessionId: session.id, text: "run", sink, crewId: "crewP" });
  assert.equal(mission.status, "proposed", "the whole tree is BLOCKED (re-approvable) — not run");
  assert.equal(repo.listChildMissions(mission.id).length, 0, "no sub-mission was created (blocked before the run)");
  const err = events.find((e): e is Extract<HubEvent, { type: "error" }> => e.type === "error");
  assert.ok(err, "a recoverable authenticate error was emitted");
  assert.equal(err!.authRequired, true, "the error flags authRequired");
  assert.deepEqual(err!.serverIds, ["srv-nested"], "the NESTED unready server id is named");
  assert.ok(err!.message.includes("qlik-nested"), "the message names the nested server to connect");
});

test("(ii) an all-ready nested tree is NOT blocked — it runs to completion", async () => {
  const { repo } = open();
  const g = graph(repo);
  const leaf = g.role("Nested Ready", { servers: { "srv-ok": "all" }, builtins: [] });
  const crewC = g.crew("crewC", "Child", "parallel", [{ agentId: leaf.id }]);
  g.crew("crewP", "Parent", "parallel", [{ crewId: crewC.id }]);

  const { sink } = collectSink();
  const invocations: string[] = [];
  const service = makeService({
    repository: repo,
    resolveCrew: g.resolveCrew,
    runAgent: leafRunner(invocations),
    isServerRunReady: () => ({ ready: true }),
  });
  const session = scopedSession(repo, { servers: { "srv-ok": "all" }, builtins: [] });
  const mission = await service.proposePlan({ sessionId: session.id, text: "run", sink, crewId: "crewP" });
  assert.equal(mission.status, "completed", "an all-ready tree runs to completion");
  assert.deepEqual(invocations, ["Nested Ready"], "the nested leaf ran (the gate let the tree through)");
});

// ── (iii) top-level stop reaches a level-2 agent; stopAgent/steerAgent reach it by sub-mission id ──────

test("(iii) a top-level stop() aborts a level-2 in-flight agent → aborted/no report, tree stopped/partial, no leak", async () => {
  const { repo } = open();
  const g = graph(repo);
  const leaf = g.role("Deep Blocker");
  const crewC = g.crew("crewC", "Child", "parallel", [{ agentId: leaf.id }]);
  g.crew("crewP", "Parent", "parallel", [{ crewId: crewC.id }]);

  const { sink, events } = collectSink();
  const sawAbort = { value: false };
  let signalInFlight: (() => void) | undefined;
  const inFlight = new Promise<void>((resolve) => {
    signalInFlight = resolve;
  });
  const service = makeService({
    repository: repo,
    resolveCrew: g.resolveCrew,
    runAgent: blockingRunner({ onInFlight: () => signalInFlight?.(), sawAbort }),
  });

  const session = scopedSession(repo, { servers: {}, builtins: [] });
  const run = service.proposePlan({ sessionId: session.id, text: "run", sink, crewId: "crewP" });
  await inFlight; // a level-2 leaf is now in flight (blocking)

  const rootId = rootMissionId(repo, session.id);
  const subId = repo.listChildMissions(rootId)[0]!.id;
  const leafSessionId = repo.listMissionAgentSessions(subId)[0]!.id;

  service.stop(rootId); // stop the ROOT — must cascade DOWN to the level-2 leaf
  await run;

  assert.ok(sawAbort.value, "the top-level stop aborted the in-flight LEVEL-2 agent (downward missionAbort cascade)");
  // The level-2 leaf settled aborted with NO report.
  assert.equal(repo.getSession(leafSessionId).status, "aborted", "the level-2 leaf settled aborted");
  assert.equal(
    events.filter((e) => e.type === "agent_report" && e.missionId === subId).length,
    0,
    "the aborted level-2 leaf produced no report",
  );
  // The sub-mission + the root both end stopped, and both syntheses are honestly partial.
  assert.equal(repo.getMission(subId).status, "stopped", "the sub-mission ends stopped");
  assert.equal(repo.getMission(rootId).status, "stopped", "the root ends stopped");
  assert.equal(synthesisEvents(events, rootId)[0]?.partial, true, "the root synthesis is honestly partial");
  // Every descendant child session is terminal (no dangling running).
  for (const child of repo.listMissionAgentSessions(rootId).concat(repo.listMissionAgentSessions(subId))) {
    assert.ok(
      child.status === "aborted" || child.status === "completed" || child.status === "error",
      `descendant ${child.id} is terminal (was ${child.status})`,
    );
  }
  // No `this.running` entry leaks — neither the root nor the sub-mission stays registered.
  assert.equal(service.isRunning(rootId), false, "the root control was removed");
  assert.equal(service.isRunning(subId), false, "the sub-mission control was removed (no leak)");
});

test("(iii) stopAgent + steerAgent reach a LEVEL-2 agent through its sub-mission id (no method changes)", async () => {
  const { repo } = open();
  const g = graph(repo);
  const leaf = g.role("Deep Steerable");
  const crewC = g.crew("crewC", "Child", "parallel", [{ agentId: leaf.id }]);
  g.crew("crewP", "Parent", "parallel", [{ crewId: crewC.id }]);

  const { sink } = collectSink();
  const sawAbort = { value: false };
  let signalInFlight: (() => void) | undefined;
  const inFlight = new Promise<void>((resolve) => {
    signalInFlight = resolve;
  });
  const service = makeService({
    repository: repo,
    resolveCrew: g.resolveCrew,
    runAgent: blockingRunner({ onInFlight: () => signalInFlight?.(), sawAbort }),
  });

  const session = scopedSession(repo, { servers: {}, builtins: [] });
  const run = service.proposePlan({ sessionId: session.id, text: "run", sink, crewId: "crewP" });
  await inFlight;

  const rootId = rootMissionId(repo, session.id);
  const subId = repo.listChildMissions(rootId)[0]!.id;
  const leafSessionId = repo.listMissionAgentSessions(subId)[0]!.id;

  // The sub-mission is registered under its OWN id (WP2.3) — so both control methods resolve through it.
  assert.equal(service.isRunning(subId), true, "the sub-mission is registered in this.running under its own id");

  // steerAgent(subMissionId, agentId) reaches the running level-2 agent (durable queued message).
  const steered = service.steerAgent(subId, leafSessionId, "Focus on the north region.");
  assert.equal(steered.type, "queued_user_message", "steerAgent queued a durable message on the level-2 child");

  // stopAgent(subMissionId, agentId) aborts the level-2 agent specifically.
  service.stopAgent(subId, leafSessionId);
  await run;

  assert.ok(sawAbort.value, "stopAgent(subMissionId, agentId) aborted the level-2 agent");
  assert.equal(repo.getSession(leafSessionId).status, "aborted", "the level-2 agent settled aborted");
  // stopAgent is not a whole-mission stop — the root/sub complete (partial), never marked stopped.
  assert.equal(repo.getMission(rootId).status, "completed", "stopping ONE agent does not stop the whole mission");
  assert.equal(service.isRunning(rootId), false, "no this.running leak after the run settles");
  assert.equal(service.isRunning(subId), false, "no this.running leak for the sub-mission");
});
