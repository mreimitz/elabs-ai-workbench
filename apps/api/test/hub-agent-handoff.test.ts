// Assistant Hub — end-user UX pass: the `@AgentName` HANDOFF. A prompt that `@`-mentions saved agents
// hands the task to exactly those agents as a deterministic team (approve-first). Driven by the
// repository + STUBBED planner/model (no provider key), this proves:
//   • `instantiateAgentsPlan` turns explicit roles into a plan (1 = single handoff, N = parallel team;
//     empty → 400) — deterministic, reusing `roleToPlannedAgent`;
//   • `proposePlan({ agentIds })` takes the deterministic path (the planner is NEVER called), works in a
//     CHAT-mode session (the relaxed guard), and under `always_ask` stays `proposed` (approve-first);
//   • `dispatchMessage` short-circuits a `mentionedAgentIds` message to the handoff seam INSTEAD of
//     running a chat turn (the model is never resolved), persisting the ask + returning `{kind:"handoff"}`.

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { DEFAULT_TOKEN_PROFILE, type HubAgentRole, type HubEvent } from "@mcp-token-footprint/shared";
import { applyMigrations, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { getTokenCounter } from "../src/token-counting/profiles.js";
import { HubRepository } from "../src/hub/repository.js";
import { HubSessionService } from "../src/hub/session-service.js";
import { instantiateAgentsPlan } from "../src/hub/missions/topologies.js";
import {
  HubMissionService,
  type HubMissionServiceConfig,
  type HubPlanner,
} from "../src/hub/missions/index.js";

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-handoff-"));
  tempDirs.push(dir);
  return dir;
}

const NOW = "2026-07-20T00:00:00.000Z";
function makeRole(id: string, name: string, over: Partial<HubAgentRole> = {}): HubAgentRole {
  return {
    id,
    name,
    systemPrompt: `You are ${name}.`,
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

// ── instantiateAgentsPlan (pure) ──────────────────────────────────────────────────────────────────────

test("instantiateAgentsPlan: N roles → a parallel team; each role becomes a plan agent", () => {
  const plan = instantiateAgentsPlan({
    roles: [makeRole("a1", "Analyst"), makeRole("a2", "Writer")],
    ask: "Investigate.",
    autonomy: "always_ask",
  });
  assert.equal(plan.topology, "parallel");
  assert.equal(plan.agents.length, 2);
  assert.equal(plan.agents[0]?.roleId, "a1");
  assert.equal(plan.agents[0]?.systemPrompt, "You are Analyst.");
  assert.equal(plan.agents[1]?.roleId, "a2");
});

test("instantiateAgentsPlan: a single role is a valid single-agent handoff; empty throws 400", () => {
  const plan = instantiateAgentsPlan({ roles: [makeRole("a1", "Analyst")], ask: "x", autonomy: "auto" });
  assert.equal(plan.agents.length, 1);
  assert.throws(
    () => instantiateAgentsPlan({ roles: [], ask: "x", autonomy: "auto" }),
    /mentioned agents could be found/i,
  );
});

// ── proposePlan({ agentIds }) — deterministic, planner-free, chat-mode, approve-first ─────────────────

function missionConfig(): HubMissionServiceConfig {
  return {
    maxAgents: 6,
    maxParallel: 3,
    defaultBudgetUsd: 2,
    maxBudgetUsd: 10,
    askAboveAgents: 3,
    askAboveUsd: 1,
    defaultAutonomy: "always_ask",
    agentRunnerMode: "session",
  };
}
const plannerMustNotRun: HubPlanner = async () => {
  throw new Error("the planner must NOT run for an explicit @mention handoff");
};

test("proposePlan({ agentIds }): deterministic (planner bypassed), works in CHAT mode, waits under always_ask", async () => {
  const repo = openRepo();
  const role = makeRole("role-1", "Analyst", { systemPrompt: "REAL ANALYST PROMPT" });
  const mission = new HubMissionService({
    repository: repo,
    config: missionConfig(),
    planner: plannerMustNotRun,
    runAgent: async () => {
      throw new Error("runAgent must not be called for an always_ask propose");
    },
    synthesizer: async () => {
      throw new Error("synthesizer must not be called");
    },
    resolveAgents: (ids) => (ids.includes("role-1") ? [role] : []),
    now: () => NOW,
  });

  // A plain CHAT session (not mission/auto) — the relaxed guard allows an explicit-agents handoff.
  const session = repo.createSession({ mode: "chat", model: "gpt-4o", autonomy: "always_ask" });
  const events: HubEvent[] = [];
  const sink = { onEvent: (e: HubEvent) => events.push(e), onDelta: () => undefined };
  const proposed = await mission.proposePlan({
    sessionId: session.id,
    text: "Investigate the target.",
    sink,
    agentIds: ["role-1"],
  });

  assert.equal(proposed.status, "proposed", "always_ask waits for approval (approve-first)");
  const persisted = repo.getMission(proposed.id).plan;
  assert.equal(persisted.agents.length, 1, "a single mentioned agent → a one-agent team");
  assert.equal(persisted.agents[0]?.roleId, "role-1");
  assert.equal(persisted.agents[0]?.systemPrompt, "REAL ANALYST PROMPT", "the saved role's real config is used");
  assert.ok(
    events.some((e) => e.type === "plan_proposed"),
    "a team plan card was proposed",
  );
});

// ── dispatchMessage short-circuit — a mention message hands off, never runs a chat turn ───────────────

function sessionServiceWith(repo: HubRepository, handoffCalls: unknown[]): HubSessionService {
  return new HubSessionService({
    repository: repo,
    tokenCounter: getTokenCounter(DEFAULT_TOKEN_PROFILE),
    // A handoff must NEVER resolve a model / run a chat turn.
    resolveModel: () => {
      throw new Error("resolveModel must not be called for an @mention handoff");
    },
    mcpGrantsProvider: () => null,
    handoffToAgentsForTurn: async (input) => {
      handoffCalls.push(input);
    },
    config: {
      maxActiveSessions: 4,
      idleReleaseMs: 0,
      autoTitle: false,
      dataDir: tempDataDir(),
      toolLoadingDefault: "eager",
      autoFraction: 0.1,
      skillListingBudgetFraction: 0.01,
      skillEntryMaxChars: 1536,
      skillLoadBudgets: { perSkillTokens: 5000, totalTokens: 25_000 },
    },
  });
}

test("dispatchMessage: a mentionedAgentIds message routes to the handoff seam and skips the chat turn", async () => {
  const repo = openRepo();
  const handoffCalls: Array<{ agentIds: string[]; text: string }> = [];
  const service = sessionServiceWith(repo, handoffCalls as unknown[]);
  const session = repo.createSession({ mode: "chat", model: "gpt-4o" });
  const events: HubEvent[] = [];
  const sink = { onEvent: (e: HubEvent) => events.push(e), onDelta: () => undefined };

  const result = await service.dispatchMessage(
    session.id,
    { text: "@Analyst summarize Q3", mentionedAgentIds: ["role-1"] },
    sink,
  );

  assert.equal(result.kind, "handoff", "the dispatch reports a handoff (no chat turn ran)");
  assert.equal(handoffCalls.length, 1, "the handoff seam was invoked exactly once");
  assert.deepEqual(handoffCalls[0]?.agentIds, ["role-1"]);
  assert.equal(handoffCalls[0]?.text, "@Analyst summarize Q3");
  // The ask was still persisted for the transcript.
  const userMessages = repo.listEvents(session.id).filter((e) => e.type === "user_message");
  assert.equal(userMessages.length, 1, "the user's ask is recorded");
});

test("dispatchMessage: a FAILING handoff surfaces an error + settles the turn (no dangling user message)", async () => {
  const repo = openRepo();
  const service = new HubSessionService({
    repository: repo,
    tokenCounter: getTokenCounter(DEFAULT_TOKEN_PROFILE),
    resolveModel: () => {
      throw new Error("resolveModel must not be called for an @mention handoff");
    },
    mcpGrantsProvider: () => null,
    // The handoff throws (e.g. a 409 existing-mission, or a 400 all-agents-deleted).
    handoffToAgentsForTurn: async () => {
      throw Object.assign(new Error("This session already has a mission in progress."), {
        statusCode: 409,
      });
    },
    config: {
      maxActiveSessions: 4,
      idleReleaseMs: 0,
      autoTitle: false,
      dataDir: tempDataDir(),
      toolLoadingDefault: "eager",
      autoFraction: 0.1,
      skillListingBudgetFraction: 0.01,
      skillEntryMaxChars: 1536,
      skillLoadBudgets: { perSkillTokens: 5000, totalTokens: 25_000 },
    },
  });
  const session = repo.createSession({ mode: "chat", model: "gpt-4o" });
  const events: HubEvent[] = [];
  const sink = { onEvent: (e: HubEvent) => events.push(e), onDelta: () => undefined };

  const result = await service.dispatchMessage(
    session.id,
    { text: "@Analyst do it", mentionedAgentIds: ["role-1"] },
    sink,
  );

  assert.equal(result.kind, "handoff");
  const error = events.find((e) => e.type === "error");
  assert.ok(error, "the failure surfaced as an error event");
  assert.equal(
    error?.type === "error" && error.message,
    "This session already has a mission in progress.",
  );
  assert.ok(
    events.some((e) => e.type === "turn_done"),
    "the turn settled (no dangling user message)",
  );
});

test("dispatchMessage: a message WITHOUT mentions does not touch the handoff seam", async () => {
  const repo = openRepo();
  const handoffCalls: unknown[] = [];
  const service = sessionServiceWith(repo, handoffCalls);
  const session = repo.createSession({ mode: "chat", model: "gpt-4o" });
  const events: HubEvent[] = [];
  const sink = { onEvent: (e: HubEvent) => events.push(e), onDelta: () => undefined };

  // No mentions ⇒ the normal path runs, which here hits this fixture's throwing `resolveModel` — the
  // probe that proves the short-circuit did NOT fire for a plain message.
  //
  // model-identity WP4.4 — that throw no longer REJECTS the dispatch. A model-resolution failure is now
  // settled over the sink (`error` + `turn_done`) exactly like a failed handoff, because the `/messages`
  // route already answered 202 and a rejection there is only a `log.warn` nobody sees. The probe is
  // unchanged in intent — `resolveModel` still ran, and the handoff seam still didn't.
  const result = await service.dispatchMessage(session.id, { text: "just a normal question" }, sink);

  assert.equal(result.kind, "failed", "an unresolvable model settles as a refusal, not a silent no-op");
  const error = events.find((e) => e.type === "error");
  assert.match(
    (error?.type === "error" && error.message) || "",
    /resolveModel must not be called/,
    "the real resolution failure reached the client over the sink",
  );
  assert.equal(handoffCalls.length, 0, "no mention ⇒ no handoff");
});
