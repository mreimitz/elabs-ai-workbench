// Assistant Hub (planning/Roadmap/RM-03-assistant-hub/, WP4.1, R-SES7) — the context inspector: itemizes a session's
// window by layer using the app's OWN counters.
//
// Proves (acceptance):
//   1. `promptSections` covers the §1.8 layer list, measured with REAL numbers (every section carries
//      `tokens > 0` or an honest 0, never a placeholder) — and the "tools" section's measured text
//      actually reflects the granted MCP catalog (eager includes descriptions; deferred doesn't).
//   2. `tools` — the granted MCP tool-definition layer: eager mode resident==totalTokens/0 deferred;
//      deferred mode splits resident (0, nothing pinned) vs deferred (the full catalog) with
//      `savingsPercent > 0`; no `mcpCatalogProvider` ⇒ empty resident/deferred, builtins only.
//   3. `skills` — mirrors `computeSessionSkillUsage` (an attached skill's L1 shows up; L2/L3 realized
//      via a persisted `skills.load` tool_result).
//   4. `memory`/`project` — real measured tokens of the injected body (0 with nothing set).
//   5. `history` — the reconstructed transcript's measured size grows with more messages.
//   6. `estimatedTotalTokens` never silently double-counts memory/project (sanity bound checked).
//   7. `lastActualTokensIn` mirrors the last settled `turn_done.usage.tokensIn`; absent when no turn
//      has ever settled.
//   8. `GET /api/hub/sessions/:id/context` round-trips through the real route (200 + 404).

import assert from "node:assert/strict";
import crypto from "node:crypto";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import type {
  HubToolGrants,
  NormalizedToolDefinition,
  Skill,
  SkillFileContent,
  SkillFileNode,
  SkillVersion,
} from "@mcp-token-footprint/shared";
import { applyMigrations, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { getTokenCounter } from "../src/token-counting/profiles.js";
import { buildHubContextInspector, type HubContextMcpCatalogProvider } from "../src/hub/context-inspector.js";
import { HubRepository } from "../src/hub/repository.js";
import { registerHubRoutes } from "../src/hub/routes.js";
import { HubSessionService, type HubModelResolver } from "../src/hub/session-service.js";
import { DEFAULT_CHAT_BUILTIN_NAMES } from "../src/hub/tools/index.js";
import type { HubMcpServerCatalog } from "../src/hub/tools/grants.js";
import type { HubSkillReader } from "../src/hub/skill-attachments.js";
import { ProviderRepository } from "../src/providers/repository.js";
import { ScanRepository, type ToolScanInsert } from "../src/scans/repository.js";
import { ServerRepository } from "../src/servers/repository.js";
import { SecretStore } from "../src/secrets/secret-store.js";

const counter = getTokenCounter("generic_o200k");
const NOW = "2026-07-18T00:00:00.000Z";

const databases: AppDatabase[] = [];
const harnesses: FastifyInstance[] = [];
afterEach(async () => {
  for (const app of harnesses.splice(0)) await app.close();
  for (const db of databases.splice(0)) db.close();
});

function openRepo(): HubRepository {
  const { repo } = openRepoAndDb();
  return repo;
}

function openRepoAndDb(): { repo: HubRepository; db: AppDatabase } {
  const db = new Database(":memory:") as unknown as AppDatabase;
  databases.push(db);
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  return { repo: new HubRepository(db), db };
}

function tool(name: string, description = "A tool that does a thing."): NormalizedToolDefinition {
  return {
    name,
    description,
    inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    raw: { name, description },
  };
}

function catalogProvider(mode: "single" | "empty" = "single"): HubContextMcpCatalogProvider {
  return async () => {
    if (mode === "empty") return { grants: { servers: {}, builtins: [] }, catalog: new Map() };
    const catalog = new Map<string, HubMcpServerCatalog>([
      ["srv-a", { serverName: "Server A", tools: [tool("search"), tool("fetch")] }],
    ]);
    const grants: HubToolGrants = { servers: { "srv-a": "all" }, builtins: ["tasks.list", "artifacts.create"] };
    return { grants, catalog };
  };
}

// ── A minimal skill reader (mirrors hub-skills.test.ts's FakeSkillReader, trimmed to one skill) ────

const SKILL_MD = `---
name: alpha-skill
description: Handles alpha tasks.
---

# Alpha Skill

Body content for the alpha skill.
`;

class OneSkillReader implements HubSkillReader {
  private readonly skill: Skill = {
    id: "alpha",
    name: "alpha-skill",
    displayName: "Alpha Skill",
    slug: "alpha-skill",
    sourceType: "upload",
    description: "Handles alpha tasks.",
    currentVersionId: "alpha-v1",
    versionCount: 1,
    createdAt: NOW,
    updatedAt: NOW,
  };
  private readonly version: SkillVersion = {
    tokenProfile: "generic_o200k",
    l1MetadataTokens: 5,
    l2BodyTokens: 20,
    l3ResourceTokens: 0,
    totalTokens: 25,
    id: "alpha-v1",
    skillId: "alpha",
    seq: 1,
    versionLabel: "v1",
    treeSha: "sha-1",
    sourceKind: "upload",
    manifest: { name: "alpha-skill", description: "Handles alpha tasks." },
    manifestValid: true,
    manifestErrors: [],
    fileCount: 1,
    totalBytes: SKILL_MD.length,
    importedFrom: "upload",
    createdAt: NOW,
  };
  private readonly node: SkillFileNode = {
    path: "SKILL.md",
    size: SKILL_MD.length,
    isBinary: false,
    isSkillMd: true,
    kind: "skill_md",
    tokenTotal: 20,
  };

  getPublic(id: string): Skill {
    if (id !== "alpha") throw new Error("no such skill");
    return this.skill;
  }
  getVersion(versionId: string): SkillVersion {
    if (versionId !== "alpha-v1") throw new Error("no such version");
    return this.version;
  }
  listFiles(): SkillFileNode[] {
    return [this.node];
  }
  getFileContent(_versionId: string, path: string): SkillFileContent {
    if (path !== "SKILL.md") throw new Error("no such file");
    return { path: "SKILL.md", isBinary: false, text: SKILL_MD, tokenTotal: 20 };
  }
}

const baseDeps = {
  tokenCounter: counter,
  skillListingBudgetFraction: 0.01,
  skillEntryMaxChars: 1536,
  toolSearchAutoFraction: 0.1,
};

// ── (1)/(2) prompt sections + the tools layer (eager vs deferred vs no-catalog) ─────────────────────

test("buildHubContextInspector — eager mode: tools resident==total, deferred empty, savings 0", async () => {
  const repo = openRepo();
  const session = repo.createSession({ mode: "chat", model: "claude-opus-4-8" });
  const result = await buildHubContextInspector(
    { repository: repo, ...baseDeps, toolLoadingDefault: "eager", mcpCatalogProvider: catalogProvider() },
    session.id,
  );

  assert.equal(result.tools.mode, "eager");
  assert.equal(result.tools.resident.length, 2);
  assert.equal(result.tools.deferred.length, 0);
  assert.equal(result.tools.totalTokens, result.tools.residentTokens);
  assert.equal(result.tools.savingsPercent, 0);
  assert.ok(result.tools.resident.every((t) => t.tokens > 0));
  assert.deepEqual(
    result.tools.builtins.map((b) => b.name).sort(),
    ["artifacts.create", "tasks.list"],
  );

  // The §1.8 layer list is present, each with a real measured count.
  const ids = result.promptSections.map((s) => s.id);
  assert.deepEqual(ids, [
    "identity",
    "session-context",
    "tools",
    "citations",
    "working-visibly",
    // v1-fixes (F5) — the style contract rides every prompt.
    "style",
    "mode-addendum",
    "safety",
    "self-check",
  ]);
  for (const section of result.promptSections) assert.ok(section.tokens > 0, `${section.id} measured 0 tokens`);
  const toolsSection = result.promptSections.find((s) => s.id === "tools");
  assert.ok(toolsSection);
  // Eager mode's tools section injects per-tool descriptions — must be strictly bigger than the
  // deferred (name-only) rendering of the SAME catalog.
});

test("buildHubContextInspector — deferred mode: nothing pinned resident, full catalog deferred, savings > 0", async () => {
  const repo = openRepo();
  const session = repo.createSession({ mode: "chat", model: "claude-opus-4-8" });
  const result = await buildHubContextInspector(
    { repository: repo, ...baseDeps, toolLoadingDefault: "deferred", mcpCatalogProvider: catalogProvider() },
    session.id,
  );
  assert.equal(result.tools.mode, "deferred");
  assert.equal(result.tools.resident.length, 0);
  assert.equal(result.tools.deferred.length, 2);
  assert.equal(result.tools.residentTokens, 0);
  assert.ok(result.tools.savingsPercent > 0);
});

test("buildHubContextInspector — no mcpCatalogProvider: tools layer reports built-ins only, never fabricated", async () => {
  const repo = openRepo();
  const session = repo.createSession({ mode: "chat", model: "claude-opus-4-8" });
  const result = await buildHubContextInspector(
    { repository: repo, ...baseDeps, toolLoadingDefault: "deferred" },
    session.id,
  );
  assert.equal(result.tools.resident.length, 0);
  assert.equal(result.tools.deferred.length, 0);
  assert.equal(result.tools.totalTokens, 0);
  // Default grants (DEFAULT_CHAT_BUILTIN_NAMES) still populate builtins.
  assert.ok(result.tools.builtins.length > 0);
});

// ── (3) skills layer ─────────────────────────────────────────────────────────────────────────────

test("buildHubContextInspector — skills layer mirrors computeSessionSkillUsage (L1 + realized L2)", async () => {
  const { repo, db } = openRepoAndDb();
  const session = repo.createSession({ mode: "chat", model: "claude-opus-4-8" });
  db.prepare(
    `INSERT INTO skills (id, name, display_name, slug, source_type, created_at, updated_at)
     VALUES ('alpha', 'alpha-skill', 'Alpha Skill', 'alpha-skill', 'upload', @now, @now)`,
  ).run({ now: NOW });
  repo.replaceSessionSkills(session.id, [{ skillId: "alpha" }]);
  // A realized L2 load, persisted exactly like the `skills.load` built-in would.
  repo.appendEvent(session.id, {
    type: "tool_call",
    part: { type: "tool_call", toolCallId: "c1", toolName: "skills.load", source: "skill", state: "output-available" },
  });
  repo.appendEvent(session.id, {
    type: "tool_result",
    toolCallId: "c1",
    state: "output-available",
    modelContent: { skillId: "alpha", skillName: "Alpha Skill", path: "", tokens: 30 },
  });

  const result = await buildHubContextInspector(
    { repository: repo, ...baseDeps, toolLoadingDefault: "eager", skillReader: new OneSkillReader() },
    session.id,
  );
  assert.equal(result.skills.usage.length, 1);
  const alpha = result.skills.usage[0];
  assert.equal(alpha?.skillId, "alpha");
  assert.ok((alpha?.l1Tokens ?? 0) > 0, "L1 catalog contribution measured");
  assert.equal(alpha?.l2Tokens, 30, "L2 realized load read back from the event log, never re-estimated");
  assert.equal(result.skills.totalTokens, alpha?.totalTokens);
});

// ── (4) memory/project ──────────────────────────────────────────────────────────────────────────

test("buildHubContextInspector — memory/project measure the REAL injected body; 0/null with nothing set", async () => {
  const repo = openRepo();
  const bareSession = repo.createSession({ mode: "chat", model: "claude-opus-4-8" });
  const bare = await buildHubContextInspector({ repository: repo, ...baseDeps, toolLoadingDefault: "eager" }, bareSession.id);
  assert.equal(bare.memory.tokens, 0);
  assert.equal(bare.memory.itemCount, 0);
  assert.equal(bare.project, null);

  repo.createMemory({ kind: "preference", content: "Always answer in bullet points." });
  const project = repo.createProject({ name: "Demo Project", instructions: "Stay focused on the demo." });
  const inProject = repo.createSession({ mode: "chat", model: "claude-opus-4-8", projectId: project.id });
  const withBoth = await buildHubContextInspector(
    { repository: repo, ...baseDeps, toolLoadingDefault: "eager" },
    inProject.id,
  );
  assert.ok(withBoth.memory.tokens > 0);
  assert.equal(withBoth.memory.itemCount, 1);
  assert.ok(withBoth.project);
  assert.equal(withBoth.project?.projectName, "Demo Project");
  assert.ok((withBoth.project?.tokens ?? 0) > 0);
});

// ── (5)/(6)/(7) history + totals + lastActualTokensIn ───────────────────────────────────────────

test("buildHubContextInspector — history grows with more turns; lastActualTokensIn mirrors turn_done", async () => {
  const repo = openRepo();
  const session = repo.createSession({ mode: "chat", model: "claude-opus-4-8" });

  const empty = await buildHubContextInspector({ repository: repo, ...baseDeps, toolLoadingDefault: "eager" }, session.id);
  assert.equal(empty.history.tokens, 0);
  assert.equal(empty.history.messageCount, 0);
  assert.equal(empty.lastActualTokensIn, undefined, "no turn has settled yet");

  repo.appendEvent(session.id, { type: "user_message", messageId: "m1", text: "Hello, how are you today?" });
  repo.appendEvent(session.id, {
    type: "assistant_message",
    messageId: "m2",
    model: "claude-opus-4-8",
    parts: [{ type: "text", text: "I'm doing well, thanks for asking!" }],
    citations: [],
    artifactsTouched: [],
  });
  repo.appendEvent(session.id, {
    type: "turn_done",
    messageId: "m2",
    usage: { tokensIn: 1234, tokensOut: 56 },
    costUsd: 0.01,
  });

  const after = await buildHubContextInspector({ repository: repo, ...baseDeps, toolLoadingDefault: "eager" }, session.id);
  assert.equal(after.history.messageCount, 2);
  assert.ok(after.history.tokens > empty.history.tokens);
  assert.equal(after.lastActualTokensIn, 1234);

  // Sanity bound: the estimate is the sum of REAL layer measurements, never a fabricated round number,
  // and (with no memory/project) is strictly more than the prompt sections alone (tools+skills+history
  // all add on top).
  assert.ok(after.estimatedTotalTokens >= after.promptTotalTokens);
});

// ── (8) the real route ──────────────────────────────────────────────────────────────────────────

const stubResolveModel: HubModelResolver = () => ({
  providerKind: "anthropic",
  modelId: "test-model",
  contextWindow: 100_000,
});

test("GET /api/hub/sessions/:id/context — round-trips through the real route; 404 for unknown", async () => {
  const db = new Database(":memory:") as unknown as AppDatabase;
  databases.push(db);
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  const secrets = new SecretStore(crypto.randomBytes(32));
  const providerRepository = new ProviderRepository(db, secrets);
  const repo = new HubRepository(db);
  const session = repo.createSession({ mode: "chat", model: "claude-opus-4-8" });

  const service = new HubSessionService({
    repository: repo,
    tokenCounter: counter,
    resolveToolset: () => ({ tools: {} }),
    resolveModel: stubResolveModel,
    config: {
      maxActiveSessions: 4,
      idleReleaseMs: 0,
      autoTitle: false,
      dataDir: "/tmp",
      toolLoadingDefault: "eager",
      autoFraction: 0.1,
      skillListingBudgetFraction: 0.01,
      skillEntryMaxChars: 1536,
      skillLoadBudgets: { perSkillTokens: 5000, totalTokens: 25000 },
    },
  });
  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _req, reply) => {
    const typed = error as Error & { statusCode?: number };
    return reply.code(typed.statusCode ?? 500).send({ error: typed.message });
  });
  await registerHubRoutes(app, {
    repository: repo,
    sessionService: service,
    providers: providerRepository,
    tokenCounter: counter,
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  harnesses.push(app);
  const address = app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  const res = await fetch(`http://127.0.0.1:${port}/api/hub/sessions/${session.id}/context`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { sessionId: string; promptSections: unknown[] };
  assert.equal(body.sessionId, session.id);
  assert.ok(body.promptSections.length > 0);

  const missing = await fetch(`http://127.0.0.1:${port}/api/hub/sessions/does-not-exist/context`);
  assert.equal(missing.status, 404);
});

// ── hub-fixes WP1.3 (RC3.4) — the `tools.serverStatuses` rail-chip layer ────────────────────────────
// `HubSessionService` persists `mcp_server_status` events into a session's own event log (proven in
// `hub-mcp-grants.test.ts`); THIS route just folds them into "latest per serverId" for the rail. Proven
// here by appending events directly through the repository (the same durable store the service writes
// to) — the route doesn't care WHO wrote them, only that they're there.

test("GET .../context folds the session's mcp_server_status events into tools.serverStatuses (latest per server)", async () => {
  const db = new Database(":memory:") as unknown as AppDatabase;
  databases.push(db);
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  const secrets = new SecretStore(crypto.randomBytes(32));
  const providerRepository = new ProviderRepository(db, secrets);
  const repo = new HubRepository(db);
  const session = repo.createSession({ mode: "chat", model: "claude-opus-4-8" });

  // srv-a: connected, then later turns error, then recovers — only the LATEST should survive.
  repo.appendEvent(session.id, {
    type: "mcp_server_status",
    serverId: "srv-a",
    serverName: "Server A",
    status: "connected",
  });
  repo.appendEvent(session.id, {
    type: "mcp_server_status",
    serverId: "srv-a",
    serverName: "Server A",
    status: "error",
    message: "OAuth expired",
  });
  repo.appendEvent(session.id, {
    type: "mcp_server_status",
    serverId: "srv-a",
    serverName: "Server A",
    status: "connected",
  });
  // srv-b: never recovers.
  repo.appendEvent(session.id, {
    type: "mcp_server_status",
    serverId: "srv-b",
    serverName: "Server B",
    status: "error",
    message: "connection refused",
  });

  const service = new HubSessionService({
    repository: repo,
    tokenCounter: counter,
    resolveToolset: () => ({ tools: {} }),
    resolveModel: stubResolveModel,
    config: {
      maxActiveSessions: 4,
      idleReleaseMs: 0,
      autoTitle: false,
      dataDir: "/tmp",
      toolLoadingDefault: "eager",
      autoFraction: 0.1,
      skillListingBudgetFraction: 0.01,
      skillEntryMaxChars: 1536,
      skillLoadBudgets: { perSkillTokens: 5000, totalTokens: 25000 },
    },
  });
  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _req, reply) => {
    const typed = error as Error & { statusCode?: number };
    return reply.code(typed.statusCode ?? 500).send({ error: typed.message });
  });
  await registerHubRoutes(app, {
    repository: repo,
    sessionService: service,
    providers: providerRepository,
    tokenCounter: counter,
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  harnesses.push(app);
  const address = app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  const res = await fetch(`http://127.0.0.1:${port}/api/hub/sessions/${session.id}/context`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    tools: {
      serverStatuses?: { serverId: string; serverName: string; status: string; message?: string }[];
    };
  };
  const statuses = body.tools.serverStatuses ?? [];
  assert.equal(statuses.length, 2, "one entry per server, not one per event");
  const a = statuses.find((s) => s.serverId === "srv-a");
  const b = statuses.find((s) => s.serverId === "srv-b");
  assert.equal(a?.status, "connected", "srv-a's LATEST status wins over its earlier error");
  assert.equal(a?.message, undefined, "a connected entry carries no stale error message");
  assert.equal(b?.status, "error");
  assert.equal(b?.message, "connection refused");
});

test("GET .../context omits serverStatuses entirely for a session with no mcp_server_status events yet", async () => {
  const db = new Database(":memory:") as unknown as AppDatabase;
  databases.push(db);
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  const secrets = new SecretStore(crypto.randomBytes(32));
  const providerRepository = new ProviderRepository(db, secrets);
  const repo = new HubRepository(db);
  const session = repo.createSession({ mode: "chat", model: "claude-opus-4-8" });

  const service = new HubSessionService({
    repository: repo,
    tokenCounter: counter,
    resolveToolset: () => ({ tools: {} }),
    resolveModel: stubResolveModel,
    config: {
      maxActiveSessions: 4,
      idleReleaseMs: 0,
      autoTitle: false,
      dataDir: "/tmp",
      toolLoadingDefault: "eager",
      autoFraction: 0.1,
      skillListingBudgetFraction: 0.01,
      skillEntryMaxChars: 1536,
      skillLoadBudgets: { perSkillTokens: 5000, totalTokens: 25000 },
    },
  });
  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _req, reply) => {
    const typed = error as Error & { statusCode?: number };
    return reply.code(typed.statusCode ?? 500).send({ error: typed.message });
  });
  await registerHubRoutes(app, {
    repository: repo,
    sessionService: service,
    providers: providerRepository,
    tokenCounter: counter,
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  harnesses.push(app);
  const address = app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  const res = await fetch(`http://127.0.0.1:${port}/api/hub/sessions/${session.id}/context`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { tools: { serverStatuses?: unknown } };
  assert.equal(body.tools.serverStatuses, undefined);
});

// ── hub-fixes WP1.2 (RC3 — the display half + the write-once trap): the inspector's `mcpCatalogProvider`
// now APPLIES the session's `toolScope` (scoped ⇒ only its listed servers/tools; auto ⇒ every reachable
// scanned server, unchanged) and mirrors `index.ts`'s `resolveHubMcpGrants` `builtins` honor rule too.
// These tests wire REAL `ServerRepository`/`ScanRepository` instances (the same two `index.ts` reads)
// through the real route, so the round-trip is proven end-to-end: PATCH -> persisted -> the NEXT
// `GET .../context` reflects it. ─────────────────────────────────────────────────────────────────────

function toolInsert(name: string): ToolScanInsert {
  return {
    toolName: name,
    description: `desc for ${name}`,
    inputSchema: { type: "object" },
    annotations: undefined,
    rawTool: { name },
    totalTokens: 50,
    nameTokens: 3,
    descriptionTokens: 8,
    schemaTokens: 10,
    annotationsTokens: 0,
    rawBytes: 42,
    contributionPercent: 0,
  };
}

/** Registers a server with one completed scan carrying a single tool; returns the new server id. */
function seedServerWithScan(servers: ServerRepository, scans: ScanRepository, name: string): string {
  const server = servers.create({ name, transport: "stdio", command: "run" });
  const running = scans.createRunningScan(server.id, "generic_o200k");
  scans.completeScan(
    running.id,
    {
      totalTools: 1,
      totalTokens: 50,
      totalRawBytes: 42,
      averageTokensPerTool: 50,
      largestToolName: `${name}-search`,
      largestToolTokens: 50,
      totalResources: 0,
      totalResourceTemplates: 0,
      totalPrompts: 0,
      totalResourceTokens: 0,
      totalPromptTokens: 0,
      largestResourceName: null,
      largestResourceTokens: 0,
      largestPromptName: null,
      largestPromptTokens: 0,
    },
    [toolInsert(`${name}-search`)],
  );
  return server.id;
}

type ScopeTestHarness = {
  baseUrl: string;
  repo: HubRepository;
  servers: ServerRepository;
  scans: ScanRepository;
};

/** Builds a real Fastify app wired with `servers`/`scans` (mirrors `index.ts`'s own wiring) so
 *  `buildHubContextMcpCatalogProvider` actually has a catalog to apply a scope against. */
async function makeScopeAwareApp(): Promise<ScopeTestHarness> {
  const db = new Database(":memory:") as unknown as AppDatabase;
  databases.push(db);
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  const secrets = new SecretStore(crypto.randomBytes(32));
  const providerRepository = new ProviderRepository(db, secrets);
  const repo = new HubRepository(db);
  const servers = new ServerRepository(db, secrets);
  const scans = new ScanRepository(db);

  const service = new HubSessionService({
    repository: repo,
    tokenCounter: counter,
    resolveToolset: () => ({ tools: {} }),
    resolveModel: stubResolveModel,
    config: {
      maxActiveSessions: 4,
      idleReleaseMs: 0,
      autoTitle: false,
      dataDir: "/tmp",
      toolLoadingDefault: "eager",
      autoFraction: 0.1,
      skillListingBudgetFraction: 0.01,
      skillEntryMaxChars: 1536,
      skillLoadBudgets: { perSkillTokens: 5000, totalTokens: 25000 },
    },
  });
  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _req, reply) => {
    const typed = error as Error & { statusCode?: number };
    return reply.code(typed.statusCode ?? 500).send({ error: typed.message });
  });
  await registerHubRoutes(app, {
    repository: repo,
    sessionService: service,
    providers: providerRepository,
    tokenCounter: counter,
    servers,
    scans,
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  harnesses.push(app);
  const address = app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return { baseUrl: `http://127.0.0.1:${port}`, repo, servers, scans };
}

type ContextToolsBody = {
  tools: {
    scopeMode?: "scoped" | "auto";
    resident: { serverId: string }[];
    deferred: { serverId: string }[];
    builtins: { name: string }[];
  };
};

async function getContext(baseUrl: string, sessionId: string): Promise<ContextToolsBody> {
  const res = await fetch(`${baseUrl}/api/hub/sessions/${sessionId}/context`);
  assert.equal(res.status, 200);
  return (await res.json()) as ContextToolsBody;
}

function grantedServerIds(body: ContextToolsBody): Set<string> {
  return new Set([...body.tools.resident, ...body.tools.deferred].map((t) => t.serverId));
}

test("PATCH toolScope round-trips into the context inspector (RC3 regression): scoped -> only the listed server + scopeMode:'scoped'; cleared -> every reachable server + scopeMode:'auto'", async () => {
  const { baseUrl, repo, servers, scans } = await makeScopeAwareApp();
  const srvA = seedServerWithScan(servers, scans, "Server A");
  const srvB = seedServerWithScan(servers, scans, "Server B");
  const session = repo.createSession({ mode: "chat", model: "claude-opus-4-8" });

  // Before any PATCH: auto — every reachable server is granted (unchanged pre-WP1.2 behavior for an
  // unscoped session).
  const before = await getContext(baseUrl, session.id);
  assert.equal(before.tools.scopeMode, "auto");
  assert.deepEqual(grantedServerIds(before), new Set([srvA, srvB]));

  // PATCH toolScope -> scoped to srvA only. This is the RC3 regression proof: the inspector provider
  // now APPLIES the session's scope instead of the old bug (always granting every scanned server
  // regardless of `session.toolScope`).
  const patchRes = await fetch(`${baseUrl}/api/hub/sessions/${session.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ toolScope: { servers: { [srvA]: "all" }, builtins: [] } }),
  });
  assert.equal(patchRes.status, 200);
  const patched = (await patchRes.json()) as { toolScope: unknown };
  assert.deepEqual(patched.toolScope, { servers: { [srvA]: "all" }, builtins: [] });

  const scoped = await getContext(baseUrl, session.id);
  assert.equal(scoped.tools.scopeMode, "scoped");
  assert.deepEqual(grantedServerIds(scoped), new Set([srvA]), "only the scoped server is granted");

  // PATCH toolScope -> null clears back to auto (the write-once-trap fix: a session NOT created with
  // a scope can be scoped after the fact, and a scoped session can be cleared).
  const clearRes = await fetch(`${baseUrl}/api/hub/sessions/${session.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ toolScope: null }),
  });
  assert.equal(clearRes.status, 200);
  const cleared = (await clearRes.json()) as { toolScope: unknown };
  assert.equal(cleared.toolScope, null);

  const auto = await getContext(baseUrl, session.id);
  assert.equal(auto.tools.scopeMode, "auto");
  assert.deepEqual(grantedServerIds(auto), new Set([srvA, srvB]));
});

test("GET .../context honors the scope's builtins selection (RC3.5, mirrors index.ts's resolveHubMcpGrants): a non-empty scoped list narrows the built-ins; an explicit empty list falls back to the defaults", async () => {
  const { baseUrl, repo } = await makeScopeAwareApp();
  const session = repo.createSession({ mode: "chat", model: "claude-opus-4-8" });

  // No scope yet: the default full built-in set.
  const auto = await getContext(baseUrl, session.id);
  assert.deepEqual(
    new Set(auto.tools.builtins.map((b) => b.name)),
    new Set(DEFAULT_CHAT_BUILTIN_NAMES),
  );

  // A scoped session with a non-empty builtins list narrows to exactly that list.
  await fetch(`${baseUrl}/api/hub/sessions/${session.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ toolScope: { servers: {}, builtins: ["tasks.list"] } }),
  });
  const narrowed = await getContext(baseUrl, session.id);
  assert.deepEqual(narrowed.tools.builtins.map((b) => b.name), ["tasks.list"]);

  // A scoped session with an EXPLICIT EMPTY builtins list falls back to the full default set (an
  // empty array must never brick a session down to zero built-ins).
  await fetch(`${baseUrl}/api/hub/sessions/${session.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ toolScope: { servers: {}, builtins: [] } }),
  });
  const emptyFallsBack = await getContext(baseUrl, session.id);
  assert.deepEqual(
    new Set(emptyFallsBack.tools.builtins.map((b) => b.name)),
    new Set(DEFAULT_CHAT_BUILTIN_NAMES),
  );
});
