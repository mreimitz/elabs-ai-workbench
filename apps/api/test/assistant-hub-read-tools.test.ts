// Assistant operability (planning/Roadmap/RM-05-assistant-operability/, WP 3.1) — the Hub READ toolset
// (hub_agents_list/hub_crews_list/hub_usage_summary), exercised DIRECTLY against a seeded fixture
// `HubRepository`: each tool's `.handler(args, {})` is called exactly as the SDK would call it — no
// SDK session, no MCP protocol round-trip (unit level, per the ground rules — mirrors
// assistant-tools.test.ts's pattern for the WP 1.2 read toolset).

import assert from "node:assert/strict";
import crypto from "node:crypto";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import { applyMigrations, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import {
  buildHubReadToolDefinitions,
  type HubReadToolDeps,
} from "../src/assistant/tools/hub-read-tools.js";
import { HubRepository } from "../src/hub/repository.js";
import { ProviderRepository } from "../src/providers/repository.js";
import { SecretStore } from "../src/secrets/secret-store.js";

const databases: AppDatabase[] = [];
/** model-identity WP3.3 — the `providers` dep `hub_usage_summary` now needs, one per opened database
 *  (a `ProviderRepository` over the SAME connection), so `depsFor` never has to guess which db a repo
 *  belongs to. Attribution behaviour itself is locked in `hub-usage-provider-attribution.test.ts`. */
const providersByRepo = new WeakMap<HubRepository, ProviderRepository>();
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function openRepo(): HubRepository {
  const db = new Database(":memory:") as unknown as AppDatabase;
  databases.push(db);
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  const repo = new HubRepository(db);
  providersByRepo.set(repo, new ProviderRepository(db, new SecretStore(crypto.randomBytes(32))));
  return repo;
}

/** The tools' dependency bag for a fixture repo. */
function depsFor(repo: HubRepository): HubReadToolDeps {
  const providers = providersByRepo.get(repo);
  if (!providers) throw new Error("repo was not created by openRepo()");
  return { hub: repo, providers };
}

/** Look up one tool definition by name from a deps bag's toolset (fails loudly if it's missing). */
function toolFor(deps: HubReadToolDeps, name: string) {
  const def = buildHubReadToolDefinitions(deps).find((d) => d.name === name);
  if (!def) throw new Error(`no tool registered named "${name}"`);
  return def;
}

/** Call a tool and parse its single JSON text content block. */
async function call<T = unknown>(
  deps: HubReadToolDeps,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const def = toolFor(deps, name);
  const result = await def.handler(args as never, {});
  assert.equal(result.isError, undefined, `${name} unexpectedly errored`);
  const block = result.content[0] as { type: "text"; text: string };
  assert.equal(block.type, "text");
  return JSON.parse(block.text) as T;
}

const LONG_DESCRIPTION = "d".repeat(1000);
const LONG_SYSTEM_PROMPT = "You are a very verbose agent. ".repeat(200);

function seedAgentsAndCrews(repo: HubRepository) {
  const researcher = repo.createAgentRole({
    name: "Researcher",
    displayName: "Rex the Researcher",
    description: LONG_DESCRIPTION,
    icon: "lucide:search",
    systemPrompt: LONG_SYSTEM_PROMPT,
    defaultModel: "claude-opus-4-8",
    toolGrants: {
      servers: { "srv-1": "all", "srv-2": ["toolA", "toolB"] },
      builtins: ["artifacts.create"],
    },
    skills: [{ skillId: "skill-1" }],
    target: "Research a topic thoroughly.",
    expectedOutcome: "A cited findings report.",
    budgets: { maxCostUsd: 5 },
  });

  const writer = repo.createAgentRole({
    name: "Writer",
    systemPrompt: "You are a writer.",
    defaultModel: "gpt-5.5",
    target: "Draft the doc.",
    expectedOutcome: "A polished draft.",
  });

  const retiredRaw = repo.createAgentRole({
    name: "Retired",
    systemPrompt: "You are retired.",
    defaultModel: "gemini-2.5-pro",
    target: "Nothing.",
    expectedOutcome: "Nothing.",
  });
  const retired = repo.updateAgentRole(retiredRaw.id, { archived: true });

  const crew = repo.createCrew({
    name: "Research Crew",
    description: "Researcher + writer, parallel.",
    topology: "parallel",
    members: [{ agentId: researcher.id }, { agentId: writer.id }],
  });

  return { researcher, writer, retired, crew };
}

// ── hub_agents_list ──────────────────────────────────────────────────────────────────────────────

test("hub_agents_list returns active agent roles compacted — systemPrompt dropped, description bounded, archived excluded by default", async () => {
  const repo = openRepo();
  const { researcher, writer, retired } = seedAgentsAndCrews(repo);
  const deps: HubReadToolDeps = depsFor(repo);

  const out = await call<{ agents: Array<Record<string, unknown>>; total: number; truncated: boolean }>(
    deps,
    "hub_agents_list",
    {},
  );

  assert.equal(out.total, 2, "archived role excluded by default");
  assert.equal(out.truncated, false);
  const ids = out.agents.map((a) => a.id);
  assert.ok(ids.includes(researcher.id));
  assert.ok(ids.includes(writer.id));
  assert.ok(!ids.includes(retired.id));

  const rex = out.agents.find((a) => a.id === researcher.id) as Record<string, unknown>;
  assert.equal(rex.name, "Researcher");
  assert.equal(rex.displayName, "Rex the Researcher");
  assert.equal(rex.defaultModel, "claude-opus-4-8");
  assert.equal(rex.archived, false);
  assert.equal("systemPrompt" in rex, false, "the (long) system prompt must never be echoed");
  assert.ok((rex.description as string).length < LONG_DESCRIPTION.length, "description is bounded");
  assert.match(rex.description as string, /chars truncated/);
  assert.deepEqual(rex.skillIds, ["skill-1"]);
  assert.equal(rex.skillCount, 1);
  const toolGrants = rex.toolGrants as {
    servers: string[];
    serverToolCounts: Record<string, unknown>;
    builtins: string[];
  };
  assert.deepEqual(toolGrants.servers.sort(), ["srv-1", "srv-2"]);
  assert.equal(toolGrants.serverToolCounts["srv-1"], "all");
  assert.equal(toolGrants.serverToolCounts["srv-2"], 2);
  assert.deepEqual(toolGrants.builtins, ["artifacts.create"]);
});

test("hub_agents_list includeArchived:true includes the archived role too", async () => {
  const repo = openRepo();
  const { retired } = seedAgentsAndCrews(repo);
  const deps: HubReadToolDeps = depsFor(repo);

  const out = await call<{ agents: Array<{ id: string; archived: boolean }>; total: number }>(
    deps,
    "hub_agents_list",
    { includeArchived: true },
  );
  assert.equal(out.total, 3);
  const found = out.agents.find((a) => a.id === retired.id);
  assert.ok(found, "the archived role is present when includeArchived is true");
  assert.equal(found?.archived, true);
});

test("hub_agents_list caps with an explicit limit + reports the real total via the truncated marker", async () => {
  const repo = openRepo();
  seedAgentsAndCrews(repo);
  const deps: HubReadToolDeps = depsFor(repo);

  const out = await call<{ agents: unknown[]; total: number; truncated: boolean }>(
    deps,
    "hub_agents_list",
    { limit: 1 },
  );
  assert.equal(out.agents.length, 1);
  assert.equal(out.total, 2); // 2 active roles (archived excluded)
  assert.equal(out.truncated, true);
});

test("hub_agents_list on an empty DB returns an empty list, not a throw", async () => {
  const repo = openRepo();
  const deps: HubReadToolDeps = depsFor(repo);
  const out = await call<{ agents: unknown[]; total: number; truncated: boolean }>(
    deps,
    "hub_agents_list",
    {},
  );
  assert.deepEqual(out.agents, []);
  assert.equal(out.total, 0);
  assert.equal(out.truncated, false);
});

// ── hub_crews_list ───────────────────────────────────────────────────────────────────────────────

test("hub_crews_list returns the seeded crew compacted — topology + member agent ids, description bounded", async () => {
  const repo = openRepo();
  const { researcher, writer, crew } = seedAgentsAndCrews(repo);
  const deps: HubReadToolDeps = depsFor(repo);

  const out = await call<{ crews: Array<Record<string, unknown>>; total: number; truncated: boolean }>(
    deps,
    "hub_crews_list",
    {},
  );
  assert.equal(out.total, 1);
  assert.equal(out.truncated, false);
  const found = out.crews[0] as Record<string, unknown>;
  assert.equal(found.id, crew.id);
  assert.equal(found.name, "Research Crew");
  assert.equal(found.topology, "parallel");
  assert.equal(found.memberCount, 2);
  assert.deepEqual((found.memberAgentIds as string[]).sort(), [researcher.id, writer.id].sort());
});

test("hub_crews_list echoes memberCrewIds/memberAgentCount/memberCrewCount/totalAgentCount for a nested crew (WP1.2, D-CN5)", async () => {
  const repo = openRepo();
  const { researcher } = seedAgentsAndCrews(repo);
  const child = repo.createCrew({
    name: "Child Crew",
    topology: "parallel",
    members: [{ agentId: researcher.id }],
  });
  const parent = repo.createCrew({
    name: "Parent Crew",
    topology: "parallel",
    members: [{ crewId: child.id }],
  });
  const deps: HubReadToolDeps = depsFor(repo);

  const out = await call<{ crews: Array<Record<string, unknown>>; total: number }>(
    deps,
    "hub_crews_list",
    {},
  );
  assert.equal(out.total, 3, "the seeded Research Crew + Child Crew + Parent Crew");

  const foundParent = out.crews.find((c) => c.id === parent.id) as Record<string, unknown>;
  assert.deepEqual(foundParent.memberCrewIds, [child.id]);
  assert.deepEqual(foundParent.memberAgentIds, []);
  assert.equal(foundParent.memberAgentCount, 0);
  assert.equal(foundParent.memberCrewCount, 1);
  assert.equal(
    foundParent.totalAgentCount,
    1,
    "parent's recursive rollup walks into child: child has 1 direct agent",
  );

  const foundChild = out.crews.find((c) => c.id === child.id) as Record<string, unknown>;
  assert.deepEqual(foundChild.memberAgentIds, [researcher.id]);
  assert.equal(foundChild.totalAgentCount, 1, "child's own rollup: 1 direct agent, no nesting");
});

test("hub_crews_list caps with an explicit limit + reports the real total via the truncated marker", async () => {
  const repo = openRepo();
  const { researcher } = seedAgentsAndCrews(repo);
  repo.createCrew({ name: "Solo Crew A", topology: "parallel", members: [{ agentId: researcher.id }] });
  repo.createCrew({ name: "Solo Crew B", topology: "parallel", members: [{ agentId: researcher.id }] });
  const deps: HubReadToolDeps = depsFor(repo);

  const out = await call<{ crews: unknown[]; total: number; truncated: boolean }>(deps, "hub_crews_list", {
    limit: 1,
  });
  assert.equal(out.crews.length, 1);
  assert.equal(out.total, 3); // the seeded "Research Crew" + the two solo crews
  assert.equal(out.truncated, true);
});

test("hub_crews_list on an empty DB returns an empty list, not a throw", async () => {
  const repo = openRepo();
  const deps: HubReadToolDeps = depsFor(repo);
  const out = await call<{ crews: unknown[]; total: number }>(deps, "hub_crews_list", {});
  assert.deepEqual(out.crews, []);
  assert.equal(out.total, 0);
});

// ── hub_usage_summary ────────────────────────────────────────────────────────────────────────────

test("hub_usage_summary aggregates totals + byModel/byMode/byDay for seeded sessions, with truncation markers wired", async () => {
  const repo = openRepo();
  const chat = repo.createSession({ mode: "chat", model: "claude-opus-4-8" });
  repo.setSessionLifecycle(chat.id, { costUsd: 1, tokensIn: 100, tokensOut: 50 });
  const research = repo.createSession({ mode: "research", model: "gpt-5.5" });
  repo.setSessionLifecycle(research.id, { costUsd: 2, tokensIn: 200, tokensOut: 80 });
  const deps: HubReadToolDeps = depsFor(repo);

  const out = await call<{
    totals: { sessions: number; costUsd: number; tokensIn: number; tokensOut: number };
    byModel: Array<{ key: string }>;
    byModelTruncated: boolean;
    byModelTotal: number;
    byDayTruncated: boolean;
    missionsTruncated: boolean;
  }>(deps, "hub_usage_summary", {});

  assert.equal(out.totals.sessions, 2);
  assert.equal(out.totals.costUsd, 3);
  assert.equal(out.totals.tokensIn, 300);
  assert.deepEqual(
    out.byModel.map((b) => b.key).sort(),
    ["claude-opus-4-8", "gpt-5.5"],
  );
  // truncateFields wires an explicit `${key}Truncated`/`${key}Total` marker for every capped array
  // field, even when nothing was actually cut — proves the plumbing, not just the happy path.
  assert.equal(out.byModelTruncated, false);
  assert.equal(out.byModelTotal, 2);
  assert.equal(out.byDayTruncated, false);
  assert.equal(out.missionsTruncated, false);
});

test("hub_usage_summary honors from/to — a session outside the range is excluded", async () => {
  const repo = openRepo();
  const db = databases[databases.length - 1] as AppDatabase;
  const early = repo.createSession({ mode: "chat", model: "claude-opus-4-8" });
  db.prepare("UPDATE hub_sessions SET created_at = ? WHERE id = ?").run(
    "2026-01-01T00:00:00.000Z",
    early.id,
  );
  repo.setSessionLifecycle(early.id, { costUsd: 1, tokensIn: 1, tokensOut: 1 });

  const late = repo.createSession({ mode: "chat", model: "claude-opus-4-8" });
  db.prepare("UPDATE hub_sessions SET created_at = ? WHERE id = ?").run(
    "2026-06-01T00:00:00.000Z",
    late.id,
  );
  repo.setSessionLifecycle(late.id, { costUsd: 3, tokensIn: 3, tokensOut: 3 });
  const deps: HubReadToolDeps = depsFor(repo);

  const out = await call<{ totals: { sessions: number; costUsd: number } }>(deps, "hub_usage_summary", {
    from: "2026-03-01T00:00:00.000Z",
  });
  assert.equal(out.totals.sessions, 1);
  assert.equal(out.totals.costUsd, 3);
});

test("hub_usage_summary honors projectId — scopes to one Hub project", async () => {
  const repo = openRepo();
  const project = repo.createProject({ name: "Proj A" });
  const inProject = repo.createSession({ mode: "chat", model: "claude-opus-4-8", projectId: project.id });
  repo.setSessionLifecycle(inProject.id, { costUsd: 5, tokensIn: 5, tokensOut: 5 });
  const outsideProject = repo.createSession({ mode: "chat", model: "claude-opus-4-8" });
  repo.setSessionLifecycle(outsideProject.id, { costUsd: 9, tokensIn: 9, tokensOut: 9 });
  const deps: HubReadToolDeps = depsFor(repo);

  const out = await call<{ totals: { sessions: number; costUsd: number }; range: { projectId?: string } }>(
    deps,
    "hub_usage_summary",
    { projectId: project.id },
  );
  assert.equal(out.totals.sessions, 1);
  assert.equal(out.totals.costUsd, 5);
  assert.equal(out.range.projectId, project.id);
});

test("hub_usage_summary on an empty DB returns an all-zero summary, not a throw", async () => {
  const repo = openRepo();
  const deps: HubReadToolDeps = depsFor(repo);
  const out = await call<{ totals: { sessions: number; costUsd: number; tokensIn: number; tokensOut: number } }>(
    deps,
    "hub_usage_summary",
    {},
  );
  assert.deepEqual(out.totals, { sessions: 0, costUsd: 0, tokensIn: 0, tokensOut: 0 });
});
