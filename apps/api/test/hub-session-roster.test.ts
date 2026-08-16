// Assistant Hub — end-user UX pass: the session Agents & Crews ROSTER (a preferred pool for the mission
// planner). Driven by the repository + STUBBED planner (no provider key, no live model), this proves:
//   • the roster round-trips through create / read / update (replace + clear + no-change), stored inline
//     like `toolScope`; absent ⇒ null;
//   • `buildPlannerRosterCatalog` + `buildMissionPlannerPrompt` inject a "Preferred agents & crews"
//     section (roleIds + the prefer/reuse-by-roleId contract);
//   • `hydratePlannedAgentFromRole` swaps a planner-paraphrased agent's config for the saved role's REAL
//     config while keeping the planner's task brief/key;
//   • end-to-end, `proposePlan` feeds the roster to the planner AND hydrates any agent the planner reused
//     by `roleId` — so the saved agent runs as configured, not as the model paraphrased it.

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import type {
  HubAgentRole,
  HubCrew,
  HubMissionPlan,
  HubPlannedAgent,
} from "@mcp-token-footprint/shared";
import { applyMigrations, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { HubRepository } from "../src/hub/repository.js";
import {
  buildMissionPlannerPrompt,
  buildPlannerRosterCatalog,
  type HubMissionCaps,
} from "../src/hub/missions/planner.js";
import { hydratePlannedAgentFromRole } from "../src/hub/missions/topologies.js";
import {
  HubMissionService,
  type HubAgentRunner,
  type HubMissionServiceConfig,
  type HubPlanner,
  type HubSynthesizer,
} from "../src/hub/missions/index.js";

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

const NOW = "2026-07-20T00:00:00.000Z";
function makeRole(over: Partial<HubAgentRole> & { id: string; name: string }): HubAgentRole {
  return {
    systemPrompt: `You are ${over.name}.`,
    defaultModel: "gpt-4o",
    toolGrants: { servers: {}, builtins: [] },
    skills: [],
    target: "Do the work.",
    expectedOutcome: "A result.",
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}
function makeCrew(id: string, name: string, memberAgentIds: string[]): HubCrew {
  return {
    id,
    name,
    topology: "parallel",
    members: memberAgentIds.map((agentId) => ({ agentId })),
    createdAt: NOW,
    updatedAt: NOW,
  };
}

// ── (A) repository round-trip ─────────────────────────────────────────────────────────────────────────

test("roster round-trips through create + read (stored inline, like toolScope)", () => {
  const repo = openRepo();
  const s = repo.createSession({
    mode: "mission",
    model: "gpt-4o",
    roster: { crewIds: ["c1"], agentIds: ["a1", "a2"] },
  });
  assert.deepEqual(repo.getSession(s.id).roster, { crewIds: ["c1"], agentIds: ["a1", "a2"] });
});

test("roster absent ⇒ null; updateSession replaces, clears (null), and leaves it unchanged (undefined)", () => {
  const repo = openRepo();
  const s = repo.createSession({ mode: "mission", model: "gpt-4o" });
  assert.equal(repo.getSession(s.id).roster, null, "absent roster reads back null");

  repo.updateSession(s.id, { roster: { crewIds: [], agentIds: ["a9"] } });
  assert.deepEqual(repo.getSession(s.id).roster, { crewIds: [], agentIds: ["a9"] }, "replace");

  // An unrelated patch leaves the roster unchanged (three-way absent/null/value convention).
  repo.updateSession(s.id, { title: "Renamed" });
  assert.deepEqual(repo.getSession(s.id).roster, { crewIds: [], agentIds: ["a9"] }, "undefined = no change");

  repo.updateSession(s.id, { roster: null });
  assert.equal(repo.getSession(s.id).roster, null, "null clears it");
});

// ── (B) planner catalog injection ─────────────────────────────────────────────────────────────────────

const CAPS: HubMissionCaps = {
  maxAgents: 6,
  maxParallel: 3,
  defaultBudgetUsd: 2,
  maxBudgetUsd: 10,
  askAboveAgents: 3,
  askAboveUsd: 1,
};

test("buildPlannerRosterCatalog + buildMissionPlannerPrompt inject the preferred-pool section", () => {
  const role = makeRole({ id: "role-1", name: "Analyst", target: "Deep analysis" });
  const catalog = buildPlannerRosterCatalog({
    roles: [role],
    crews: [{ crew: makeCrew("crew-1", "Research crew", [role.id]), roles: [role] }],
  });
  assert.equal(catalog.roles[0]?.roleId, "role-1");
  assert.equal(catalog.crews[0]?.name, "Research crew");

  const prompt = buildMissionPlannerPrompt({
    session: { title: "t", mode: "mission", model: "gpt-4o" },
    caps: CAPS,
    rosterCatalog: catalog,
  });
  assert.match(prompt, /Preferred agents & crews/, "the section header is injected");
  assert.match(prompt, /role-1/, "the roleId is shown so the planner can reference it");
  assert.match(prompt, /Research crew/, "the saved crew is shown");

  // Empty roster ⇒ no section (backward compatible).
  const bare = buildMissionPlannerPrompt({
    session: { title: "t", mode: "mission", model: "gpt-4o" },
    caps: CAPS,
    rosterCatalog: { roles: [], crews: [] },
  });
  assert.doesNotMatch(bare, /Preferred agents & crews/, "an empty roster injects nothing");
});

// ── (C) hydration unit ────────────────────────────────────────────────────────────────────────────────

test("hydratePlannedAgentFromRole: saved role's real config wins; planner's brief/key kept", () => {
  const role = makeRole({
    id: "role-1",
    name: "Analyst",
    systemPrompt: "REAL PROMPT",
    defaultModel: "claude-opus-4-8",
    toolGrants: { servers: { srv: "all" }, builtins: [] },
    skills: [{ skillId: "sk-1", versionMode: "latest", invocationMode: "model_invocable" }],
    target: "Deep analysis",
    expectedOutcome: "A cited report.",
  });
  const planned: HubPlannedAgent = {
    key: "agent-1",
    roleId: "role-1",
    name: "paraphrased name",
    systemPrompt: "the model's GUESS at the prompt",
    model: "gpt-4o",
    toolGrants: { servers: {}, builtins: [] },
    skillIds: [],
    brief: "the task-specific brief",
    target: "guess",
    expectedOutcome: "guess",
    rationale: "planner rationale",
  };
  const h = hydratePlannedAgentFromRole(planned, role);
  assert.equal(h.systemPrompt, "REAL PROMPT", "real system prompt applied");
  assert.equal(h.model, "claude-opus-4-8", "role's model applied");
  assert.deepEqual(h.toolGrants, { servers: { srv: "all" }, builtins: [] }, "role's grants applied");
  assert.deepEqual(h.skillIds, ["sk-1"], "role's skills applied");
  assert.equal(h.target, "Deep analysis", "role's target applied");
  assert.equal(h.expectedOutcome, "A cited report.", "role's expected outcome applied");
  assert.equal(h.name, "Analyst", "role's canonical name applied");
  assert.equal(h.brief, "the task-specific brief", "planner's task brief KEPT");
  assert.equal(h.key, "agent-1", "planner's key KEPT");
});

test("hydratePlannedAgentFromRole drops the planner's per-model estimatedCostUsd (reprices from the hydrated model)", () => {
  const role = makeRole({ id: "role-1", name: "Analyst", defaultModel: "claude-opus-4-8" });
  const planned: HubPlannedAgent = {
    key: "agent-1",
    roleId: "role-1",
    name: "paraphrased",
    systemPrompt: "guess",
    model: "gpt-4o-mini", // the planner guessed a CHEAP model…
    toolGrants: { servers: {}, builtins: [] },
    skillIds: [],
    brief: "b",
    target: "t",
    expectedOutcome: "o",
    estimatedCostUsd: 0.02, // …and priced the agent for it
  };
  const h = hydratePlannedAgentFromRole(planned, role);
  assert.equal(h.model, "claude-opus-4-8", "the role's real (expensive) model is applied");
  assert.equal(
    h.estimatedCostUsd,
    undefined,
    "the stale per-model estimate is dropped so estimateAgentCostUsd reprices from the hydrated model",
  );
});

// ── (D) orchestrator end-to-end: roster seeds the planner AND hydrates a reused roleId ─────────────────

const notRun: HubAgentRunner = async () => {
  throw new Error("runAgent must not be called for an always_ask propose (it only settles)");
};
const notSynthesized: HubSynthesizer = async () => {
  throw new Error("synthesizer must not be called for an always_ask propose");
};
function missionConfig(): HubMissionServiceConfig {
  return { ...CAPS, defaultAutonomy: "always_ask", agentRunnerMode: "session" };
}

test("proposePlan: the roster seeds the planner prompt AND hydrates the agent the planner reused by roleId", async () => {
  const repo = openRepo();
  const role = makeRole({
    id: "role-1",
    name: "Analyst",
    systemPrompt: "REAL ANALYST PROMPT",
    defaultModel: "claude-opus-4-8",
    toolGrants: { servers: { srv: "all" }, builtins: [] },
    target: "Deep analysis",
  });

  let seenPrompt = "";
  const planner: HubPlanner = async ({ systemPrompt }) => {
    seenPrompt = systemPrompt;
    // The planner "reused" the saved role — it set roleId but PARAPHRASED the config.
    const plan: HubMissionPlan = {
      topology: "parallel",
      autonomy: "always_ask",
      agents: [
        {
          key: "agent-1",
          roleId: "role-1",
          name: "paraphrased",
          systemPrompt: "the model's paraphrase",
          model: "gpt-4o",
          toolGrants: { servers: {}, builtins: [] },
          skillIds: [],
          brief: "task brief",
          target: "guess",
          expectedOutcome: "guess",
        },
      ],
    };
    return plan;
  };

  const mission = new HubMissionService({
    repository: repo,
    config: missionConfig(),
    planner,
    runAgent: notRun,
    synthesizer: notSynthesized,
    resolveRoster: (roster) => ({
      roles: roster.agentIds.includes("role-1") ? [role] : [],
      crews: [],
    }),
    now: () => NOW,
  });

  const session = repo.createSession({
    mode: "mission",
    model: "gpt-4o",
    autonomy: "always_ask",
    roster: { crewIds: [], agentIds: ["role-1"] },
  });
  const events: unknown[] = [];
  const sink = { onEvent: (e: unknown) => events.push(e), onDelta: () => undefined };
  const proposed = await mission.proposePlan({ sessionId: session.id, text: "Investigate.", sink });

  assert.equal(proposed.status, "proposed", "always_ask settles without running (plan approval preserved)");
  // The roster catalog was injected into the planner prompt.
  assert.match(seenPrompt, /Preferred agents & crews/, "the planner saw the preferred-pool section");
  assert.match(seenPrompt, /role-1/, "the planner saw the roleId to reuse");
  // The persisted plan's reused agent was HYDRATED from the saved role.
  const persisted = repo.getMission(proposed.id).plan.agents[0];
  assert.equal(persisted?.systemPrompt, "REAL ANALYST PROMPT", "the saved role's real prompt won");
  assert.equal(persisted?.model, "claude-opus-4-8", "the saved role's model won");
  assert.deepEqual(persisted?.toolGrants, { servers: { srv: "all" }, builtins: [] }, "the saved role's grants won");
  assert.equal(persisted?.brief, "task brief", "the planner's task brief was kept");
});

test("proposePlan: an empty roster leaves the planner un-seeded and the plan un-hydrated (backward compatible)", async () => {
  const repo = openRepo();
  let seenPrompt = "";
  const planner: HubPlanner = async ({ systemPrompt }) => {
    seenPrompt = systemPrompt;
    return {
      topology: "parallel",
      autonomy: "always_ask",
      agents: [
        {
          key: "agent-1",
          name: "Invented",
          systemPrompt: "planner-invented prompt",
          model: "gpt-4o",
          toolGrants: { servers: {}, builtins: [] },
          skillIds: [],
          brief: "brief",
          target: "t",
          expectedOutcome: "o",
        },
      ],
    };
  };
  const mission = new HubMissionService({
    repository: repo,
    config: missionConfig(),
    planner,
    runAgent: notRun,
    synthesizer: notSynthesized,
    resolveRoster: () => ({ roles: [], crews: [] }),
    now: () => NOW,
  });
  const session = repo.createSession({ mode: "mission", model: "gpt-4o", autonomy: "always_ask" });
  const proposed = await mission.proposePlan({
    sessionId: session.id,
    text: "Investigate.",
    sink: { onEvent: () => undefined, onDelta: () => undefined },
  });
  assert.doesNotMatch(seenPrompt, /Preferred agents & crews/, "no roster ⇒ no preferred-pool section");
  assert.equal(
    repo.getMission(proposed.id).plan.agents[0]?.systemPrompt,
    "planner-invented prompt",
    "the planner-invented agent is left untouched",
  );
});
